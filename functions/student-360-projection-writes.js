const { randomUUID } = require('node:crypto')
const { isDeepStrictEqual } = require('node:util')
const { Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')

function sourceChanged(event) {
  const before = event.data?.before
  const after = event.data?.after
  return !before?.exists || !after?.exists || !isDeepStrictEqual(before.data(), after.data())
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
async function coalesceProjectionRebuild({ db, studentId, event, rebuild, now = Date.now }) {
  const reference = db.doc(`systemJobs/student360Rebuild/subjects/${studentId}`)
  const token = randomUUID()
  const version = event.data?.after?.exists ? event.data.after.updateTime : null
  const acquired = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference)
    const state = snapshot.data() || {}
    if (atOrBefore(version, state.coveredThrough)) return null
    if (state.leaseUntil?.toMillis() > now()) {
      throw new HttpsError('unavailable', 'Student 360 projection rebuild is already running.')
    }
    transaction.set(reference, {
      token,
      leaseUntil: Timestamp.fromMillis(now() + 180_000),
    }, { merge: true })
    // Never substitute completion time here: a write during rebuilding may
    // not yet be present in one of the source queries.
    return { coveredThrough: snapshot.readTime || null }
  })
  if (!acquired) return { rebuilt: false, reason: 'covered_by_rebuild' }
  try {
    await rebuild()
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (snapshot.data()?.token !== token) throw new HttpsError('unavailable', 'Projection rebuild lease changed; retry required.')
      transaction.set(reference, {
        token: null, leaseUntil: null,
        ...(acquired.coveredThrough ? { coveredThrough: acquired.coveredThrough } : {}),
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
async function upsertChangedTimeline(db, events) {
  let changed = 0
  for (let offset = 0; offset < events.length; offset += 100) {
    const chunk = events.slice(offset, offset + 100)
    changed += await db.runTransaction(async (transaction) => {
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

module.exports = { atOrBefore, sourceChanged, coalesceProjectionRebuild, upsertChangedTimeline }
