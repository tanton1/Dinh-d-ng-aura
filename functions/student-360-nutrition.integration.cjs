'use strict'

const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore')
const { buildStudent360Projection, syncStudent360ProjectionFromEvent, vietnamDateKey } = require('./student-360')
const { student360FailureFields } = require('./student-360-projection-writes')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `student360-nutrition-${randomUUID()}`)
const clients = []
const logger = { info() {}, error() {} }
after(async () => { await Promise.all(clients.map((db) => db.terminate())); await deleteApp(app) })
const today = vietnamDateKey()
const meal = (calories = 400) => ({ id: 'meal', date: today, type: 'lunch', status: 'logged', calories, protein: 25, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })

async function fixture() {
  const db = getFirestore(app, `student360-${randomUUID()}`)
  clients.push(db)
  await Promise.all([
    db.doc('students/student').set({ accountUid: 'learner', name: 'Học viên', sessionsPerWeek: 3, branchId: 'branch', isScheduleConfirmed: true }),
    db.doc('users/learner').set({ displayName: 'Học viên', nutritionProfile: { targetCalories: 2000, protein: 100 } }),
    db.doc('contracts/contract').set({ studentId: 'student', status: 'active', startDate: '2026-01-01', endDate: '2099-01-01', totalSessions: 100, usedSessions: 0, nutritionPTIds: ['coach'], branchId: 'branch', totalPrice: 1000000, paidAmount: 1000000 }),
  ])
  const projection = await buildStudent360Projection({ db, studentId: 'student' })
  return { db, projection }
}

async function writeEvent(db, path, value) {
  const ref = db.doc(path)
  const before = await ref.get()
  if (value === null) await ref.delete(); else await ref.set(value)
  return { params: path.startsWith('users/') ? { accountUid: 'learner', documentId: ref.id } : { documentId: ref.id }, data: { before, after: await ref.get() } }
}

function observedDb(db, paths, afterRead = async () => {}) {
  const query = (source, path) => ({
    where: (...args) => query(source.where(...args), path), orderBy: (...args) => query(source.orderBy(...args), path),
    limit: (...args) => query(source.limit(...args), path), select: (...args) => query(source.select(...args), path),
    async get() { paths.push(path); const result = await source.get(); await afterRead(path); return result },
  })
  return new Proxy(db, { get(target, key) {
    if (key === 'collection') return (path) => query(target.collection(path), path)
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
}

test('warm nutrition refresh avoids unrelated scans and matches a full health recomputation', async () => {
  const { db, projection: before } = await fixture()
  const event = await writeEvent(db, 'users/learner/mealLogs/meal', meal())
  const reads = []
  const result = await syncStudent360ProjectionFromEvent({ db: observedDb(db, reads), event, logger })
  assert.equal(result.mode, 'nutrition')
  assert.ok(reads.every((path) => ['students', 'users/learner/mealLogs', 'mealReviews'].includes(path)), reads.join(','))
  const after = (await db.doc('studentOperationalViews/student').get()).data()
  for (const field of ['identity', 'assignments', 'contract', 'schedule', 'attendance', 'training', 'progress', 'renewal', 'dataQuality', 'generatedAt', 'generatedAtMillis']) {
    assert.deepEqual(after[field], before[field], `${field} must be unchanged`)
  }
  assert.equal(after.nutrition.loggedDays, 1)
  assert.ok(!after.alerts.some((item) => item.id === 'nutrition-stale'))
  const canonical = await buildStudent360Projection({ db, studentId: 'student', persist: false })
  for (const field of ['nutrition', 'health', 'alerts', 'nextActions']) assert.deepEqual(after[field], canonical[field], field)
  const timeline = await db.collection('studentTimelineEvents').where('studentId', '==', 'student').where('type', '==', 'nutrition').get()
  assert.equal(timeline.size, 1)
  assert.equal(timeline.docs[0].data().metadata.calories, 400)
})

test('meal deletion removes its timeline and a delayed delete cannot erase a restored meal', async () => {
  const { db } = await fixture()
  await syncStudent360ProjectionFromEvent({ db, event: await writeEvent(db, 'users/learner/mealLogs/meal', meal()), logger })
  const deleted = await writeEvent(db, 'users/learner/mealLogs/meal', null)
  await syncStudent360ProjectionFromEvent({ db, event: deleted, logger })
  let projection = (await db.doc('studentOperationalViews/student').get()).data()
  assert.equal(projection.nutrition.loggedDays, 0)
  assert.ok(projection.alerts.some((item) => item.id === 'nutrition-stale'))
  let timeline = await db.collection('studentTimelineEvents').where('studentId', '==', 'student').where('type', '==', 'nutrition').get()
  assert.equal(timeline.size, 0)
  await writeEvent(db, 'users/learner/mealLogs/meal', meal(700))
  await syncStudent360ProjectionFromEvent({ db, event: deleted, logger })
  projection = (await db.doc('studentOperationalViews/student').get()).data()
  assert.equal(projection.nutrition.averageCalories, 700)
  timeline = await db.collection('studentTimelineEvents').where('studentId', '==', 'student').where('type', '==', 'nutrition').get()
  assert.equal(timeline.size, 1)
  assert.equal(timeline.docs[0].data().metadata.calories, 700)
})

test('nutrition coverage does not suppress preceding operations or full attendance reconciliation', async () => {
  for (const operationsEnabled of [false, true]) {
    const { db } = await fixture()
    const attendance = await writeEvent(db, 'attendanceEvents/attendance', { studentId: 'student', sessionId: 'session', date: today, attendanceStatus: 'present', updatedAt: FieldValue.serverTimestamp() })
    const nutrition = await writeEvent(db, 'users/learner/mealLogs/meal', meal())
    const before = (await db.doc('systemJobs/student360Rebuild/subjects/student').get()).data().coveredThrough
    await syncStudent360ProjectionFromEvent({ db, event: nutrition, logger })
    const state = (await db.doc('systemJobs/student360Rebuild/subjects/student').get()).data()
    assert.ok(state.coveredThrough.isEqual(before))
    assert.ok(state.nutritionCoveredThrough.toMillis() >= attendance.data.after.updateTime.toMillis())
    const refreshed = await syncStudent360ProjectionFromEvent({ db, event: attendance, logger, operationsEnabled })
    assert.equal(refreshed.skipped, false)
    assert.equal(refreshed.mode, operationsEnabled ? 'operations' : 'full')
    assert.equal((await db.doc('studentOperationalViews/student').get()).data().attendance.attended, 1)
  }
})

test('callable full rebuild and nutrition refresh share an exclusive lease; retry covers a newer meal', async () => {
  const { db } = await fixture()
  let started
  const ready = new Promise((resolve) => { started = resolve })
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const wrapped = observedDb(db, [], async (path) => { if (path === 'sessions') { started(); await gate } })
  const full = buildStudent360Projection({ db: wrapped, studentId: 'student' })
  await ready
  const event = await writeEvent(db, 'users/learner/mealLogs/meal', meal())
  try {
    const errors = []
    await assert.rejects(syncStudent360ProjectionFromEvent({ db, event, logger: { info() {}, error: (...args) => errors.push(args) } }), error => {
      assert.equal(error.code, 'unavailable')
      assert.deepEqual(student360FailureFields(error), { failureReason: 'lease_busy', failurePhase: 'lease_acquire' })
      return true
    })
    assert.equal(errors.length, 1)
    assert.equal(errors[0][1].projectionScope, 'nutrition')
    assert.equal(errors[0][1].failureReason, 'lease_busy')
  } finally { release() }
  await full
  const retry = await syncStudent360ProjectionFromEvent({ db, event, logger })
  assert.equal(retry.skipped, false)
  assert.equal((await db.doc('studentOperationalViews/student').get()).data().nutrition.loggedDays, 1)
})

test('missing or old projection schema falls back to the full rebuild', async () => {
  const { db, projection: initial } = await fixture()
  for (const missing of [false, true]) {
    if (missing) await db.doc('studentOperationalViews/student').delete()
    else await db.doc('studentOperationalViews/student').update({ schemaVersion: 3 })
    const event = await writeEvent(db, 'users/learner/mealLogs/meal', meal(missing ? 700 : 500))
    const reads = []
    const result = await syncStudent360ProjectionFromEvent({ db: observedDb(db, reads), event, logger })
    assert.equal(result.mode, 'full')
    assert.ok(reads.includes('sessions') && reads.includes('ledgerEntries'))
    const projection = (await db.doc('studentOperationalViews/student').get()).data()
    assert.equal(projection.schemaVersion, 4)
    assert.equal(projection.schedule.weekId, initial.schedule.weekId)
  }
})

for (const mode of ['full', 'nutrition']) test(`expired ${mode} worker cannot overwrite a newer projection or timeline`, async () => {
  const { db } = await fixture()
  const event = await writeEvent(db, 'users/learner/mealLogs/meal', meal(400))
  let started
  const ready = new Promise((resolve) => { started = resolve })
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const wrapped = observedDb(db, [], async (path) => {
    if (path === 'users/learner/mealLogs') { started(); await gate }
  })
  const old = (mode === 'full'
    ? buildStudent360Projection({ db: wrapped, studentId: 'student' })
    : syncStudent360ProjectionFromEvent({ db: wrapped, event, logger }))
  // Attach the rejection handler before releasing the blocked worker.
  const rejected = assert.rejects(old, error => {
    assert.equal(error.code, 'unavailable')
    assert.deepEqual(student360FailureFields(error), { failureReason: 'lease_replaced_during_write', failurePhase: 'projection_write' })
    return true
  })
  await ready
  try {
    await db.doc('systemJobs/student360Rebuild/subjects/student').update({ leaseUntil: Timestamp.fromMillis(1) })
    await writeEvent(db, 'users/learner/mealLogs/meal', meal(700))
    await db.doc('students/student').update({ name: 'Thông tin mới' })
    const newest = await buildStudent360Projection({ db, studentId: 'student' })
    const newestTimeline = await db.collection('studentTimelineEvents').where('studentId', '==', 'student').get()
    release()
    await rejected
    assert.deepEqual((await db.doc('studentOperationalViews/student').get()).data(), newest)
    const actualTimeline = await db.collection('studentTimelineEvents').where('studentId', '==', 'student').get()
    assert.deepEqual(actualTimeline.docs.map((item) => item.data()), newestTimeline.docs.map((item) => item.data()))
    assert.equal(newest.nutrition.averageCalories, 700)
  } finally { release() }
})
