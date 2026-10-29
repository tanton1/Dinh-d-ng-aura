'use strict'
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { test, after } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { enqueueStudent360Source, processStudent360Source, recoverStudent360Sources, sourceQueueReference } = require('./student-360-source-queue')
const { enqueueStudent360ProjectionFromEvent, buildStudent360Projection, vietnamDateKey } = require('./student-360')
const { createStudent360BackgroundFunction } = require('./student-360-background-functions')
const { coalesceProjectionRebuild } = require('./student-360-projection-writes')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, 'source-queue-' + randomUUID())
const clients = [], logger = { info() {}, error() {} }, studentId = 'student'
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })
const fixture = () => { const db = getFirestore(app, 'source-queue-' + randomUUID()); clients.push(db); return db }
const queue = db => sourceQueueReference(db, studentId)
const state = async db => (await queue(db).get()).data()
const source = async (db, id, value = { studentId }) => {
  const ref = db.doc(`sessions/${id}`), before = await ref.get()
  if (value === null) await ref.delete(); else await ref.set(value)
  return { id: randomUUID(), params: { documentId: id }, data: { before, after: await ref.get() } }
}
const enqueue = (db, event, options = {}) => enqueueStudent360Source({ db, event, studentId, scope: 'operations', ...options })
const run = (db, rebuild, options = {}) => processStudent360Source({ db, studentId, rebuild, logger, ...options })
const write = db => async ({ scope, lease }) => lease.runTransaction(async tx => tx.set(db.doc(`studentOperationalViews/${studentId}`), { scope, value: 'fresh' }))
const queuedWorker = db => createStudent360BackgroundFunction('processStudent360SourceQueue', {
  db, logger, databaseId: db.databaseId, onDocumentWritten: (_options, handler) => handler,
})
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve }); return { promise, release } }

test('concurrent source mirrors enqueue once; a burst of distinct changes needs one rebuild', async () => {
  const db = fixture(), event = await source(db, 'one')
  const duplicates = await Promise.all(Array.from({ length: 8 }, () => enqueue(db, event)))
  assert.equal(duplicates.filter(item => item.queued).length, 1)
  for (let i = 0; i < 12; i++) await enqueue(db, await source(db, 'burst-' + i))
  const requested = await state(db)
  assert.equal(requested.generation, 13)
  let builds = 0
  const result = await run(db, async input => { builds++; await write(db)(input) })
  assert.equal(result.completed, true)
  assert.equal(builds, 1)
  assert.equal((await state(db)).completedGeneration, 13)
  assert.equal((await state(db)).dueAt, undefined)
  assert.equal((await enqueue(db, event)).reason, 'covered_by_rebuild')
  assert.equal((await run(db, write(db))).reason, 'already_processed')
})

test('worker claims serialize concurrent deliveries and drain changes arriving during rebuilding', async () => {
  const db = fixture(), first = await source(db, 'one')
  await enqueue(db, first)
  const ready = gate(), release = gate(), scopes = []
  const pending = run(db, async input => {
    scopes.push(input.scope)
    if (scopes.length === 1) { ready.release(); await release.promise }
    await write(db)(input)
  })
  await ready.promise
  await enqueue(db, await source(db, 'two'), { scope: 'full' })
  assert.equal((await run(db, write(db))).reason, 'queue_busy')
  assert.equal((await state(db)).completedGeneration, undefined)
  release.release()
  assert.equal((await pending).completed, true)
  assert.deepEqual(scopes, ['operations', 'full'])
  const completed = await state(db)
  assert.equal(completed.completedGeneration, 2)
  assert.equal(completed.status, 'completed')
})

test('source and queue replays ignore status writes and never overwrite a newer generation', async () => {
  const db = fixture(), first = await source(db, 'one')
  await enqueue(db, first)
  const old = await queue(db).get()
  await enqueue(db, await source(db, 'two'))
  const event = { params: { studentId }, data: { before: { exists: false }, after: old } }
  assert.equal((await run(db, write(db), { event })).completed, true, 'old delivery may safely drain latest durable state')
  const completed = await queue(db).get()
  assert.equal(completed.data().completedGeneration, 2)
  const statusBefore = { exists: true, data: () => ({ generation: completed.data().generation }) }
  assert.equal((await run(db, write(db), { event: { params: { studentId }, data: { before: statusBefore, after: completed } } })).reason, 'status_update')
  assert.equal((await run(db, write(db), { event })).reason, 'already_processed')
})

test('legacy/shared lease contention durably defers; bounded recovery completes without Eventarc retry', async () => {
  const db = fixture(), now = Date.now() + 10_000
  await enqueue(db, await source(db, 'one'))
  const leaseRef = db.doc(`systemJobs/student360Rebuild/subjects/${studentId}`)
  await leaseRef.set({ token: 'legacy-owner', leaseUntil: Timestamp.fromMillis(now + 180_000) })
  const deferred = await run(db, write(db), { now: () => now })
  assert.equal(deferred.deferred, true)
  assert.equal(deferred.reason, 'lease_busy')
  assert.equal((await state(db)).completedGeneration, undefined)
  assert.equal((await state(db)).dueAt.toMillis(), now + 5_000)
  assert.equal((await leaseRef.get()).data().token, 'legacy-owner')
  assert.equal((await recoverStudent360Sources({ db, rebuild: write(db), logger, now: () => now + 4_999 })).scanned, 0)
  await leaseRef.update({ leaseUntil: null })
  assert.equal((await recoverStudent360Sources({ db, rebuild: write(db), logger, now: () => now + 5_001 })).completed, 1)
  assert.equal((await state(db)).status, 'completed')
})

test('failure does not acknowledge work; a new full event retains backoff and remains durable', async () => {
  const db = fixture(), now = Date.now() + 10_000
  await enqueue(db, await source(db, 'one'))
  const result = await run(db, async () => {
    await enqueue(db, await source(db, 'two'), { scope: 'full' })
    throw Object.assign(new Error('private source payload'), { code: 'unavailable' })
  }, { now: () => now })
  assert.equal(result.deferred, true)
  const failed = await state(db)
  assert.equal(failed.generation, 2)
  assert.equal(failed.completedGeneration, undefined)
  assert.equal(failed.lastError, 'unavailable')
  assert.equal(failed.dueAt.toMillis(), now + 5_000)
  await enqueue(db, await source(db, 'three'), { now: () => now + 1 })
  assert.equal((await state(db)).dueAt.toMillis(), now + 5_000)
  assert.equal((await run(db, write(db), { now: () => now + 5_001 })).completed, true)
  assert.equal((await db.doc(`studentOperationalViews/${studentId}`).get()).data().scope, 'full')
  assert.equal((await state(db)).lastError, undefined)
})

test('expired worker recovery fences delayed projection writes and cannot acknowledge a successor', async () => {
  const db = fixture(), initialTime = Date.now() + 10_000
  await enqueue(db, await source(db, 'one'))
  const ready = gate(), release = gate()
  const old = run(db, async input => { ready.release(); await release.promise; await write(db)(input) }, { now: () => initialTime })
  await ready.promise
  await enqueue(db, await source(db, 'two'), { scope: 'full' })
  const recovered = await run(db, write(db), { now: () => initialTime + 241_000 })
  assert.equal(recovered.completed, true)
  const completed = await state(db)
  release.release()
  assert.equal((await old).reason, 'lease_replaced_during_write')
  assert.deepEqual(await state(db), completed)
  assert.equal((await db.doc(`studentOperationalViews/${studentId}`).get()).data().scope, 'full')
})

test('deletions cannot be covered by timestamps and are deduplicated only by the same event identity', async () => {
  const db = fixture()
  await source(db, 'deleted')
  const deletion = await source(db, 'deleted', null)
  await db.doc(`systemJobs/student360Rebuild/subjects/${studentId}`).set({ coveredThrough: Timestamp.fromMillis(Date.now() + 60_000) })
  assert.equal((await enqueue(db, deletion)).queued, true)
  assert.equal((await enqueue(db, deletion)).reason, 'duplicate_delivery')
  let builds = 0
  assert.equal((await run(db, async input => { builds++; await write(db)(input) })).completed, true)
  assert.equal(builds, 1)
  assert.equal((await enqueue(db, deletion)).reason, 'duplicate_delivery')
})

test('operations coverage cannot swallow a full-domain source event', async () => {
  const db = fixture(), event = await source(db, 'one')
  await coalesceProjectionRebuild({ db, studentId, scope: 'operations', rebuild: async () => {} })
  assert.equal((await enqueue(db, event)).reason, 'covered_by_rebuild')
  assert.equal((await enqueue(db, event, { scope: 'full' })).queued, true)
  const scopes = []
  await run(db, async input => scopes.push(input.scope))
  assert.deepEqual(scopes, ['full'])
})

test('bounded worker passes leave durable due work for scheduler instead of losing fast arrivals', async () => {
  const db = fixture()
  await enqueue(db, await source(db, 'one'))
  let builds = 0
  const result = await run(db, async input => {
    builds++
    await write(db)(input)
    await enqueue(db, await source(db, `during-${builds}`))
  })
  assert.equal(result.pending, true)
  assert.equal(builds, 3)
  assert.equal((await state(db)).completedGeneration, 3)
  assert.equal((await state(db)).generation, 4)
  const recovered = await recoverStudent360Sources({ db, rebuild: write(db), logger })
  assert.equal(recovered.completed, 1)
  assert.equal((await state(db)).completedGeneration, 4)
})

test('lost queue event and crashed claim recover using the due index; empty scans stay bounded', async () => {
  const db = fixture(), now = Date.now()
  const empty = await recoverStudent360Sources({ db, rebuild: write(db), logger })
  assert.equal(empty.scanned, 0)
  await enqueue(db, await source(db, 'one'))
  await queue(db).set({ token: 'crashed', status: 'processing', leaseUntil: Timestamp.fromMillis(now - 1), dueAt: Timestamp.fromMillis(now - 1) }, { merge: true })
  assert.equal((await recoverStudent360Sources({ db, rebuild: write(db), logger })).completed, 1)
  assert.equal((await state(db)).status, 'completed')
})

test('source wrapper queues both owners for reassignment and builds canonical student state', async () => {
  const db = fixture()
  await db.doc('students/student').set({ name: 'First', status: 'active' })
  await db.doc('students/other').set({ name: 'Second', status: 'active' })
  const ref = db.doc('contracts/contract')
  await ref.set({ studentId, status: 'active' })
  const before = await ref.get()
  await ref.set({ studentId: 'other', status: 'active' })
  const event = { id: randomUUID(), params: { documentId: 'contract' }, data: { before, after: await ref.get() } }
  const result = await enqueueStudent360ProjectionFromEvent({ db, event, logger })
  assert.deepEqual(result.studentIds, ['other', 'student'])
  assert.equal(result.scope, 'full')
  for (const id of result.studentIds) {
    const queued = await sourceQueueReference(db, id).get()
    assert.equal((await queuedWorker(db)({ params: { studentId: id }, data: { before: { exists: false }, after: queued } })).completed, true)
    const actual = (await db.doc(`studentOperationalViews/${id}`).get()).data()
    const expected = await buildStudent360Projection({ db, studentId: id, persist: false })
    for (const key of ['identity', 'contract', 'health', 'schedule', 'attendance']) assert.deepEqual(actual[key], expected[key], key)
  }
})

test('source adapter handles deleted students and retains specialized nutrition event repairs', async () => {
  const db = fixture(), ref = db.doc('students/student')
  await ref.set({ name: 'Deleted' })
  const before = await ref.get(); await ref.delete()
  await enqueueStudent360ProjectionFromEvent({ db, logger, event: { id: randomUUID(), params: { studentId }, data: { before, after: await ref.get() } } })
  const queued = await queue(db).get()
  assert.equal((await queuedWorker(db)({ params: { studentId }, data: { before: { exists: false }, after: queued } })).completed, true)
  await ref.set({ accountUid: 'learner', name: 'Restored' })
  await db.doc('users/learner').set({ name: 'Restored' })
  const meal = db.doc('users/learner/mealLogs/meal')
  await meal.set({ date: vietnamDateKey(), calories: 500, protein: 30 })
  const result = await enqueueStudent360ProjectionFromEvent({ db, logger, event: { params: { accountUid: 'learner', documentId: 'meal' }, data: { before: { exists: false }, after: await meal.get() } } })
  assert.equal(result.studentId, studentId)
  assert.equal(result.mode, 'full')
  assert.equal((await state(db)).generation, 1, 'nutrition remains on its event-specific repair path')
})
