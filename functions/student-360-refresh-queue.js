'use strict'

const { FieldValue } = require('firebase-admin/firestore')
const { coalesceProjectionRebuild } = require('./student-360-projection-writes')

const STUDENT360_REFRESH_QUEUE = 'systemJobs/student360ProjectionRefreshQueue/requests'
const STUDENT360_REFRESH_DOCUMENT = `${STUDENT360_REFRESH_QUEUE}/{studentId}`

function refreshQueueReference(db, studentId) {
  if (typeof studentId !== 'string' || !studentId.trim() || studentId.includes('/')) {
    throw new Error('INVALID_STUDENT360_QUEUE_SUBJECT')
  }
  return db.doc(`${STUDENT360_REFRESH_QUEUE}/${studentId}`)
}

function millis(value) { return typeof value?.toMillis === 'function' ? value.toMillis() : 0 }
function sameTimestamp(left, right) {
  return !!left && !!right && Number.isFinite(left.seconds) && Number.isFinite(right.seconds)
    && left.seconds === right.seconds && left.nanoseconds === right.nanoseconds
}
function sameRequest(left, right) {
  return Number(left.generation || 0) === Number(right.generation || 0)
    && sameTimestamp(left.requestedAt, right.requestedAt)
}

async function enqueueStudent360Refresh({ db, studentId, weekId, reason = 'stale', now = Date.now }) {
  const reference = refreshQueueReference(db, studentId)
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference)
    const current = snapshot.data() || {}
    const sameWeek = current.weekId === weekId
    if (sameWeek && ['queued', 'processing'].includes(current.status)
      && millis(current.requestedAt) > now() - 10 * 60_000) return false
    if (sameWeek && ['completed', 'coalesced'].includes(current.status)
      && millis(current.processedAt) > now() - 15 * 60_000) return false
    transaction.set(reference, {
      studentId, weekId, reason,
      generation: Number(current.generation || 0) + 1,
      requestedAt: FieldValue.serverTimestamp(),
      status: 'queued',
      lastError: FieldValue.delete(),
    }, { merge: true })
    return true
  })
}

async function processStudent360Refresh({ db, event, rebuild, fallbackWeekId, logger = console }) {
  const after = event.data?.after
  if (!after?.exists) return { skipped: true, reason: 'queue_deleted' }
  const request = after.data() || {}
  const before = event.data?.before?.exists ? event.data.before.data() || {} : {}
  if (!request.requestedAt || sameRequest(before, request)) return { skipped: true, reason: 'status_update' }
  const studentId = String(event.params?.studentId || '').trim()
  const reference = refreshQueueReference(db, studentId)
  const current = (await reference.get()).data() || {}
  if (!sameRequest(current, request)) return { skipped: true, reason: 'superseded' }
  if (['completed', 'coalesced'].includes(current.status)) return { skipped: true, reason: 'already_processed' }
  const weekId = /^\d{4}-\d{2}-\d{2}$/.test(String(request.weekId || '')) ? request.weekId : fallbackWeekId()

  const settle = patch => db.runTransaction(async transaction => {
    const latest = (await transaction.get(reference)).data() || {}
    // An older delivery must never acknowledge or fail a newer queued request.
    if (!sameRequest(latest, request)) return false
    transaction.set(reference, { ...patch, processedAt: FieldValue.serverTimestamp() }, { merge: true })
    return true
  })
  try {
    // Reuse the shared lease/fencing, but not source-event coverage: a source
    // watermark cannot prove that this explicitly requested week was built.
    const result = await coalesceProjectionRebuild({
      db, studentId,
      rebuild: lease => rebuild({ studentId, weekId, lease }),
    })
    const settled = await settle({ status: 'completed', lastError: FieldValue.delete() })
    logger.info('student_360_projection_queue_processed', { operation: 'refreshStudent360ProjectionFromQueue', rebuilt: result.rebuilt, settled })
    return { ...result, settled }
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code.slice(0, 80) : 'unknown'
    await settle({ status: 'failed', lastError: code }).catch(() => {})
    logger.error('student_360_projection_queue_failed', { operation: 'refreshStudent360ProjectionFromQueue', code })
    throw error
  }
}

module.exports = { STUDENT360_REFRESH_QUEUE, STUDENT360_REFRESH_DOCUMENT, refreshQueueReference, enqueueStudent360Refresh, processStudent360Refresh }
