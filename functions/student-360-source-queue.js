'use strict'

const { createHash, randomUUID } = require('node:crypto')
const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { atOrBefore, coalesceProjectionRebuild, student360FailureFields } = require('./student-360-projection-writes')

const STUDENT360_SOURCE_QUEUE = 'systemJobs/student360SourceQueue/subjects'
const STUDENT360_SOURCE_QUEUE_DOCUMENT = `${STUDENT360_SOURCE_QUEUE}/{studentId}`
const QUEUE_LEASE_MS = 4 * 60_000
const millis = value => typeof value?.toMillis === 'function' ? value.toMillis() : 0
const generation = value => Number.isSafeInteger(value) && value > 0 ? value : 0
const pending = state => generation(state.generation) > generation(state.completedGeneration)

function sourceQueueReference(db, studentId) {
  if (typeof studentId !== 'string' || !studentId.trim() || studentId.includes('/')) throw new Error('INVALID_STUDENT360_QUEUE_SUBJECT')
  return db.doc(`${STUDENT360_SOURCE_QUEUE}/${studentId}`)
}

function sourceEventKey(event) {
  const before = event.data?.before, after = event.data?.after
  const version = after?.exists ? after.updateTime : before?.updateTime
  return createHash('sha256').update(JSON.stringify([
    event.id || '', after?.ref?.path || before?.ref?.path || '',
    Boolean(after?.exists), version?.seconds ?? null, version?.nanoseconds ?? null,
  ])).digest('hex')
}

function latestVersion(left, right) {
  if (!left) return right || null
  return right && atOrBefore(left, right) ? right : left
}

/** Source deliveries acknowledge only after a durable per-student request exists. */
async function enqueueStudent360Source({ db, studentId, event, scope, now = Date.now }) {
  if (!['full', 'operations'].includes(scope)) throw new Error('INVALID_STUDENT360_SOURCE_SCOPE')
  const reference = sourceQueueReference(db, studentId)
  const leaseReference = db.doc(`systemJobs/student360Rebuild/subjects/${studentId}`)
  const version = event.data?.after?.exists ? event.data.after.updateTime || null : null
  const eventKey = sourceEventKey(event)
  return db.runTransaction(async transaction => {
    const [snapshot, lease] = await transaction.getAll(reference, leaseReference)
    const state = snapshot.data() || {}, coverage = lease.data() || {}
    if (version && (atOrBefore(version, coverage.coveredThrough)
      || (scope === 'operations' && atOrBefore(version, coverage.operationsCoveredThrough)))) {
      return { queued: false, reason: 'covered_by_rebuild' }
    }
    const recent = Array.isArray(state.recentEventKeys) ? state.recentEventKeys : []
    if (recent.includes(eventKey)) return { queued: false, reason: 'duplicate_delivery' }
    const nextGeneration = generation(state.generation) + 1
    const wasPending = pending(state)
    transaction.set(reference, {
      studentId, generation: nextGeneration,
      requestedAt: FieldValue.serverTimestamp(),
      recentEventKeys: [...recent.slice(-31), eventKey],
      ...(scope === 'full' ? { fullGeneration: nextGeneration } : {}),
      // Delete events have no commit watermark. Their generation must be
      // rebuilt even if a previous worker advanced source coverage.
      ...(!version ? { forceGeneration: nextGeneration } : {}),
      [`${scope}Version`]: latestVersion(state[`${scope}Version`], version),
      // Preserve an owner's lease/backoff. A producer never steals work or
      // makes an existing pending retry immediately runnable again.
      ...(!wasPending ? { status: 'queued', dueAt: Timestamp.fromMillis(now()), attempts: 0, lastError: FieldValue.delete() } : {}),
    }, { merge: true })
    return { queued: true, generation: nextGeneration }
  })
}

/**
 * A single student owner consumes a bounded number of generations. Every
 * projection write still uses the existing token fence shared with legacy
 * workers, synchronous refreshes and the separate stale-read queue.
 */
async function processStudent360Source({ db, studentId, event, rebuild, logger = console, now = Date.now }) {
  if (event) {
    const after = event.data?.after
    if (!after?.exists) return { skipped: true, reason: 'queue_deleted' }
    const before = event.data?.before?.exists ? event.data.before.data() || {} : {}
    if (generation(before.generation) === generation(after.data()?.generation)) return { skipped: true, reason: 'status_update' }
    studentId = event.params?.studentId
  }
  const reference = sourceQueueReference(db, studentId)
  let passes = 0, rebuilt = 0
  for (; passes < 3; passes++) {
    const token = randomUUID()
    const claim = await db.runTransaction(async transaction => {
      const state = (await transaction.get(reference)).data() || {}
      if (!pending(state)) return { skipped: true, reason: 'already_processed' }
      if (millis(state.leaseUntil) > now()) return { skipped: true, reason: 'queue_busy' }
      if (millis(state.dueAt) > now()) return { skipped: true, reason: 'deferred' }
      const scope = generation(state.fullGeneration) > generation(state.completedGeneration) ? 'full' : 'operations'
      const version = scope === 'full' ? latestVersion(state.fullVersion, state.operationsVersion) : state.operationsVersion
      const leaseUntil = Timestamp.fromMillis(now() + QUEUE_LEASE_MS)
      transaction.set(reference, {
        token, leaseUntil, dueAt: leaseUntil, status: 'processing',
        attempts: generation(state.attempts) + 1,
      }, { merge: true })
      return { generation: generation(state.generation), scope,
        version: generation(state.forceGeneration) > generation(state.completedGeneration) ? null : version,
        attempts: generation(state.attempts) + 1,
      }
    })
    if (claim.skipped) return { ...claim, passes, rebuilt }
    try {
      const result = await coalesceProjectionRebuild({
        db, studentId, scope: claim.scope, now,
        event: claim.version ? { data: { after: { exists: true, updateTime: claim.version } } } : undefined,
        rebuild: lease => rebuild({ studentId, scope: claim.scope, lease }),
      })
      rebuilt += Number(result.rebuilt)
      const settled = await db.runTransaction(async transaction => {
        const current = (await transaction.get(reference)).data() || {}
        if (current.token !== token) return { owned: false }
        const newer = generation(current.generation) > claim.generation
        transaction.set(reference, {
          completedGeneration: claim.generation, token: null, leaseUntil: null,
          status: newer ? 'queued' : 'completed',
          dueAt: newer ? Timestamp.fromMillis(now()) : FieldValue.delete(),
          processedAt: FieldValue.serverTimestamp(), attempts: 0, lastError: FieldValue.delete(),
        }, { merge: true })
        return { owned: true, newer }
      })
      if (!settled.owned) return { skipped: true, reason: 'lease_replaced', passes: passes + 1, rebuilt }
      if (!settled.newer) {
        logger.info('student_360_source_queue_processed', { passes: passes + 1, rebuilt })
        return { completed: true, passes: passes + 1, rebuilt }
      }
    } catch (error) {
      const classification = student360FailureFields(error)
      const code = typeof error?.code === 'string' ? error.code.slice(0, 80) : 'unknown'
      // A successful durable defer replaces Eventarc retries. If this write
      // fails, throw and retain transport retry as the final recovery path.
      const deferred = await db.runTransaction(async transaction => {
        const current = (await transaction.get(reference)).data() || {}
        if (current.token !== token) return false
        const delay = Math.min(300_000, 5_000 * 2 ** Math.min(6, claim.attempts - 1))
        transaction.set(reference, {
          token: null, leaseUntil: null, status: 'queued', lastError: code,
          dueAt: Timestamp.fromMillis(now() + delay),
        }, { merge: true })
        return true
      })
      const fields = { code, deferred, projectionScope: claim.scope, ...classification }
      if (classification.failureReason === 'lease_busy') logger.info('student_360_source_queue_deferred', fields)
      else logger.error('student_360_source_queue_failed', fields)
      return { deferred, reason: classification.failureReason, passes: passes + 1, rebuilt }
    }
  }
  // Further changes remain due. Recovery will pick them up even when their
  // event deliveries already acknowledged while this worker owned the queue.
  return { pending: true, passes, rebuilt }
}

async function recoverStudent360Sources({ db, rebuild, logger = console, batchSize = 25, now = Date.now }) {
  const startedAt = now()
  const due = await db.collection(STUDENT360_SOURCE_QUEUE).where('dueAt', '<=', Timestamp.fromMillis(now()))
    .orderBy('dueAt').limit(Math.max(1, Math.min(50, batchSize))).get()
  const results = []
  for (let offset = 0; offset < due.docs.length; offset += 3) {
    const work = await Promise.allSettled(due.docs.slice(offset, offset + 3).map(snapshot =>
      processStudent360Source({ db, studentId: snapshot.id, rebuild, logger, now })))
    for (const result of work) {
      if (result.status === 'rejected') throw result.reason
      results.push(result.value)
    }
  }
  const result = { scanned: due.size, completed: results.filter(item => item.completed).length,
    deferred: results.filter(item => item.deferred).length, elapsedMs: now() - startedAt }
  logger.info('student_360_source_queue_recovered', result)
  return result
}

module.exports = { STUDENT360_SOURCE_QUEUE, STUDENT360_SOURCE_QUEUE_DOCUMENT, sourceQueueReference,
  sourceEventKey, enqueueStudent360Source, processStudent360Source, recoverStudent360Sources }
