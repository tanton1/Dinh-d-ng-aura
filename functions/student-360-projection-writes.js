const { randomUUID } = require('node:crypto')
const { isDeepStrictEqual } = require('node:util')
const { Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { projectionSourceChanged } = require('./projection-event-policy')

// Keep diagnostic classifications server-local. They must not change callable
// error details, database documents, retry behavior or log arbitrary messages.
const failureFields = new WeakMap()
const retryFailures = Object.freeze({
  lease_busy: ['lease_acquire', 'Student 360 projection rebuild is already running.'],
  lease_replaced_during_write: ['projection_write', 'Projection rebuild lease expired or changed; retry required.'],
  lease_expired_during_write: ['projection_write', 'Projection rebuild lease expired or changed; retry required.'],
  lease_replaced_before_completion: ['lease_complete', 'Projection rebuild lease changed; retry required.'],
  progress_authority_changed: ['progress_write', 'Student progress authority changed during refresh; retry required.'],
  operations_authority_changed: ['operations_write', 'Student operations authority changed during refresh; retry required.'],
  operations_day_changed: ['operations_write', 'Student operations day changed during refresh; retry required.'],
})

function student360RetryError(reason) {
  if (!Object.hasOwn(retryFailures, reason)) throw new Error('Unknown Student 360 retry classification.')
  const [phase, message] = retryFailures[reason]
  const error = new HttpsError('unavailable', message)
  failureFields.set(error, { failureReason: reason, failurePhase: phase })
  return error
}

function student360FailureFields(error) {
  return { ...(failureFields.get(error) || { failureReason: 'unclassified', failurePhase: 'unknown' }) }
}

function sourceChanged(event) {
  return projectionSourceChanged(event)
}

function atOrBefore(left, right) {
  if (!left || !right || !Number.isFinite(left.seconds) || !Number.isFinite(right.seconds)) return false
  return left.seconds < right.seconds || (left.seconds === right.seconds && left.nanoseconds <= right.nanoseconds)
}

/**
 * One rebuild covers all commits before its Firestore read-time watermark.
 * Busy deliveries throw so Eventarc retries them; they are never acknowledged
 * while another worker might fail. A later commit must get another rebuild.
 * Deletions have no after.updateTime and deliberately always rebuild.
 */
async function coalesceProjectionRebuild({ db, studentId, event, rebuild, now = Date.now, scope = 'full' }) {
  const watermarks = { full: 'coveredThrough', nutrition: 'nutritionCoveredThrough', progress: 'progressCoveredThrough', operations: 'operationsCoveredThrough' }
  if (!Object.hasOwn(watermarks, scope)) throw new HttpsError('invalid-argument', 'Unknown Student 360 projection scope.')
  const reference = db.doc(`systemJobs/student360Rebuild/subjects/${studentId}`)
  const token = randomUUID()
  const version = event?.data?.after?.exists ? event.data.after.updateTime : null
  const watermark = watermarks[scope]
  const acquired = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference)
    const state = snapshot.data() || {}
    if (atOrBefore(version, state.coveredThrough)
        || (scope !== 'full' && atOrBefore(version, state[watermark]))) return null
    if (state.leaseUntil?.toMillis() > now()) {
      throw student360RetryError('lease_busy')
    }
    transaction.set(reference, {
      token,
      leaseUntil: Timestamp.fromMillis(now() + 180_000),
    }, { merge: true })
    // Never substitute completion time here: a write during rebuilding may
    // not yet be present in one of the source queries.
    return { coveredThrough: snapshot.readTime || null, state,
      timelineBasis: state.token && state.timelineBasis?.completedToken === state.token ? state.timelineBasis : null,
    }
  })
  if (!acquired) return { rebuilt: false, reason: 'covered_by_rebuild' }
  const versionKey = value => value && Number.isFinite(value.seconds) && Number.isFinite(value.nanoseconds)
    ? `${value.seconds}:${value.nanoseconds}` : null
  const timelineCoverage = Object.fromEntries(['full', 'nutrition', 'progress'].map(domain => [domain, versionKey(acquired.state[watermarks[domain]])]))
  const nextTimelineCoverage = { ...timelineCoverage,
    ...(['full', 'nutrition', 'progress'].includes(scope) ? { [scope]: versionKey(acquired.coveredThrough) } : {}),
  }
  let nextTimelineBasis
  const lease = {
    // Rankings live on the already-read lease document, not on the client
    // overview. Older workers advance coverage without updating these ranks;
    // the next operations worker detects that mismatch and repairs fully.
    timelineBasis: acquired.timelineBasis,
    timelineCoverage,
    setTimelineRanks: ranks => { nextTimelineBasis = { version: 1, ranks, coverage: nextTimelineCoverage } },
    // The token read and every projection/timeline write share a transaction.
    // A takeover conflicts with this read, so a delayed worker cannot persist
    // old source data after its successor has acquired the lease.
    runTransaction: (work) => db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (snapshot.data()?.token !== token) throw student360RetryError('lease_replaced_during_write')
      if (!(snapshot.data()?.leaseUntil?.toMillis() > now())) throw student360RetryError('lease_expired_during_write')
      return work(transaction)
    }),
  }
  try {
    await rebuild(lease)
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (snapshot.data()?.token !== token) throw student360RetryError('lease_replaced_before_completion')
      const completedBasis = nextTimelineBasis || (scope === 'operations' ? acquired.timelineBasis : null)
      transaction.set(reference, {
        // A completed token is not a held lease: leaseUntil alone controls
        // acquisition. Older workers reset token on success/failure, so they
        // invalidate these ranks even when a failure advanced no watermark.
        token: completedBasis ? token : null, leaseUntil: null,
        // Partial refreshes cannot acknowledge contract/session/finance
        // commits which they never read. All scopes still share one lease.
        ...(acquired.coveredThrough ? { [watermark]: acquired.coveredThrough } : {}),
        ...(completedBasis ? { timelineBasis: { ...completedBasis, completedToken: token } } : {}),
      }, { merge: true })
    })
    return { rebuilt: true }
  } catch (error) {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (snapshot.data()?.token === token) transaction.set(reference, { token: null, leaseUntil: null }, { merge: true })
    }).catch(() => {})
    throw error
  }
}

/** Stable IDs avoid duplicate rows; equality checks also avoid duplicate writes. */
async function upsertChangedTimeline(db, events, lease = null) {
  let changed = 0
  for (let offset = 0; offset < events.length; offset += 100) {
    const chunk = events.slice(offset, offset + 100)
    changed += await (lease ? lease.runTransaction : db.runTransaction.bind(db))(async (transaction) => {
      const references = chunk.map((event) => db.doc(`studentTimelineEvents/${event.id}`))
      const snapshots = await transaction.getAll(...references)
      let writes = 0
      chunk.forEach((event, index) => {
        if (snapshots[index].exists && isDeepStrictEqual(snapshots[index].data(), event)) return
        transaction.set(references[index], event)
        writes += 1
      })
      return writes
    })
  }
  return { total: events.length, changed }
}

module.exports = { atOrBefore, sourceChanged, coalesceProjectionRebuild, upsertChangedTimeline, student360RetryError, student360FailureFields }
