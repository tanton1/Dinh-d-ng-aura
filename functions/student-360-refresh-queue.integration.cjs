'use strict'
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { test, after } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { enqueueStudent360Refresh, processStudent360Refresh, refreshQueueReference } = require('./student-360-refresh-queue')
const { buildStudent360Projection, createStudent360Functions } = require('./student-360')
const { student360FailureFields } = require('./student-360-projection-writes')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `queue-${randomUUID()}`)
const clients = []
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })
const logger = { info() {}, error() {} }
const studentId = 'student-1'
const weekId = '2026-10-19'
function fixture() {
  const db = getFirestore(app, `queue-${randomUUID()}`)
  clients.push(db)
  return { db, ref: refreshQueueReference(db, studentId) }
}
const enqueue = (db, options = {}) => enqueueStudent360Refresh({ db, studentId, weekId, ...options })
const event = (after, before = { exists: false }) => ({ params: { studentId }, data: { before, after } })
const run = (db, input, rebuild) => processStudent360Refresh({ db, event: input, rebuild, fallbackWeekId: () => weekId, logger })
const build = db => async ({ weekId: selectedWeek, lease }) => lease.runTransaction(async transaction => {
  transaction.set(db.doc(`studentOperationalViews/${studentId}`), { weekId: selectedWeek, healthy: true })
})

test('real Firestore: concurrent stale reads enqueue once, worker refreshes and replay/status writes do no work', async () => {
  const { db, ref } = fixture()
  const accepted = await Promise.all(Array.from({ length: 8 }, () => enqueue(db)))
  assert.equal(accepted.filter(Boolean).length, 1)
  const queued = await ref.get()
  let rebuilds = 0
  const rebuild = async input => { rebuilds++; await build(db)(input) }
  assert.equal((await run(db, event(queued), rebuild)).settled, true)
  assert.equal((await db.doc(`studentOperationalViews/${studentId}`).get()).data().weekId, weekId)
  const completed = await ref.get()
  assert.equal(completed.data().status, 'completed')
  assert.equal((await run(db, event(completed, queued), rebuild)).reason, 'status_update')
  assert.equal((await run(db, event(queued), rebuild)).reason, 'already_processed')
  assert.equal(await enqueue(db), false)
  assert.equal(rebuilds, 1)
})

test('real Firestore: an older delivery cannot complete a newer request or choose its week', async () => {
  const { db, ref } = fixture()
  await enqueue(db)
  const first = await ref.get()
  let release, started
  const gate = new Promise(resolve => { release = resolve })
  const ready = new Promise(resolve => { started = resolve })
  const pending = run(db, event(first), async input => { started(); await gate; await build(db)(input) })
  await ready
  await enqueue(db, { weekId: '2026-10-26' })
  const second = await ref.get()
  release()
  assert.equal((await pending).settled, false)
  assert.equal((await ref.get()).data().status, 'queued')
  assert.equal((await run(db, event(first), build(db))).reason, 'superseded')
  // The previous rebuild's source watermark can be newer than this queue
  // request. The explicitly requested week must still be built.
  await db.doc(`systemJobs/student360Rebuild/subjects/${studentId}`).set({ coveredThrough: Timestamp.fromMillis(Date.now() + 60_000) }, { merge: true })
  assert.equal((await run(db, event(second, first), build(db))).settled, true)
  assert.equal((await db.doc(`studentOperationalViews/${studentId}`).get()).data().weekId, '2026-10-26')
})

test('real Firestore: failed work retries without falsely acknowledging a stale projection', async () => {
  const { db, ref } = fixture()
  await enqueue(db)
  const queued = await ref.get()
  const failure = Object.assign(new Error('private payload'), { code: 'unavailable' }), errors = []
  await assert.rejects(processStudent360Refresh({ db, event: event(queued), rebuild: async () => { throw failure }, fallbackWeekId: () => weekId,
    logger: { info() {}, error: (...args) => errors.push(args) },
  }), error => error === failure)
  assert.deepEqual(errors, [['student_360_projection_queue_failed', {
    operation: 'refreshStudent360ProjectionFromQueue', code: 'unavailable', projectionScope: 'full', failureReason: 'unclassified', failurePhase: 'unknown',
  }]])
  const failed = await ref.get()
  assert.equal(failed.data().status, 'failed')
  assert.equal(failed.data().lastError, 'unavailable')
  assert.equal((await db.doc(`studentOperationalViews/${studentId}`).get()).exists, false)
  await run(db, event(queued), build(db))
  const completed = (await ref.get()).data()
  assert.equal(completed.status, 'completed')
  assert.equal(completed.lastError, undefined)
})

test('real Firestore: classified lease contention still rejects the queue delivery and retry completes it', async () => {
  const { db, ref } = fixture()
  await enqueue(db)
  const queued = await ref.get(), errors = []
  const leaseRef = db.doc(`systemJobs/student360Rebuild/subjects/${studentId}`)
  await leaseRef.set({ token: 'existing-owner', leaseUntil: Timestamp.fromMillis(Date.now() + 180_000), coveredThrough: Timestamp.fromMillis(1000) })
  let builds = 0
  const rebuild = async input => { builds++; await build(db)(input) }
  await assert.rejects(processStudent360Refresh({ db, event: event(queued), rebuild, fallbackWeekId: () => weekId,
    logger: { info() {}, error: (...args) => errors.push(args) },
  }), error => {
    assert.equal(error.code, 'unavailable')
    assert.deepEqual(student360FailureFields(error), { failureReason: 'lease_busy', failurePhase: 'lease_acquire' })
    return true
  })
  assert.equal(builds, 0)
  assert.deepEqual(errors, [['student_360_projection_queue_failed', {
    operation: 'refreshStudent360ProjectionFromQueue', code: 'unavailable', projectionScope: 'full', failureReason: 'lease_busy', failurePhase: 'lease_acquire',
  }]])
  assert.equal((await leaseRef.get()).data().token, 'existing-owner')
  assert.equal((await leaseRef.get()).data().coveredThrough.toMillis(), 1000)
  const failed = (await ref.get()).data()
  assert.equal(failed.status, 'failed')
  assert.equal(failed.lastError, 'unavailable')
  assert.equal(failed.failureReason, undefined, 'diagnostics are not new database writes')
  assert.equal((await db.doc(`studentOperationalViews/${studentId}`).get()).exists, false)
  await leaseRef.update({ leaseUntil: Timestamp.fromMillis(0) })
  assert.equal((await run(db, event(queued), rebuild)).settled, true)
  assert.equal(builds, 1)
  assert.equal((await ref.get()).data().status, 'completed')
  assert.equal((await ref.get()).data().lastError, undefined)
})

test('real Firestore: delayed failure cannot fail a replacement request', async () => {
  const { db, ref } = fixture()
  await enqueue(db)
  const queued = await ref.get()
  await assert.rejects(run(db, event(queued), async () => {
    await enqueue(db, { weekId: '2026-10-26' })
    throw new Error('dependency unavailable')
  }), /dependency unavailable/)
  const replacement = (await ref.get()).data()
  assert.equal(replacement.status, 'queued')
  assert.equal(replacement.weekId, '2026-10-26')
  assert.equal(replacement.lastError, undefined)
})

test('authorized stale overview queues a refresh and the real worker replaces its projection', async () => {
  const { db, ref } = fixture()
  await db.doc(`students/${studentId}`).set({ name: 'Original member', status: 'active', branchId: 'branch' })
  await db.doc('users/queue-admin').set({ role: 'admin', status: 'active' })
  await db.doc('roleAssignments/queue-admin').set({ accessRole: 'admin', authzVersion: 1, status: 'active', branchIds: [], positions: [] })
  await buildStudent360Projection({ db, studentId, weekId })
  await db.doc(`studentOperationalViews/${studentId}`).update({ generatedAtMillis: Date.now() - 86_400_000 })
  await db.doc(`students/${studentId}`).update({ name: 'Updated member' })
  const api = createStudent360Functions({ db, onCall: (options, handler) => handler || options, logger })
  const read = () => api.getStudent360Overview({ auth: { uid: 'queue-admin', token: { accessRole: 'admin', authzVersion: 1 } }, data: { studentId, weekId } })
  const stale = await read()
  assert.equal(stale.cache.stale, true)
  assert.equal(stale.cache.refreshQueued, true)
  const queued = await ref.get()
  assert.equal(queued.exists, true)
  await run(db, event(queued), ({ studentId, weekId, lease }) => buildStudent360Projection({ db, studentId, weekId, lease }))
  const fresh = await read()
  assert.equal(fresh.cache.hit, true)
  assert.equal(fresh.cache.stale, false)
  assert.equal((await db.doc(`studentOperationalViews/${studentId}`).get()).data().identity.name, 'Updated member')
  assert.equal((await ref.get()).data().status, 'completed')
})
