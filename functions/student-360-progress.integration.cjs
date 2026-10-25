'use strict'
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { buildStudent360Projection, syncStudent360ProjectionFromEvent, vietnamDateKey } = require('./student-360')
const { student360FailureFields } = require('./student-360-projection-writes')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, 'progress-domain-' + randomUUID())
const clients = [], logger = { info() {}, error() {} }
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })
const today = vietnamDateKey()
const day = offset => new Date(Date.parse(today + 'T12:00:00Z') + offset * 86400000).toISOString().slice(0, 10)
const collections = ['bodyMetrics', 'bodyMeasurements', 'weightLogs', 'progressCheckIns', 'progress_photos', 'progressPhotos']
const unchanged = ['identity', 'assignments', 'contract', 'schedule', 'attendance', 'training', 'nutrition', 'renewal', 'dataQuality', 'generatedAt', 'generatedAtMillis']
const progressFields = ['progress', 'health', 'alerts', 'nextActions']

async function fixture(large = false) {
  const db = getFirestore(app, 'progress-domain-' + randomUUID())
  clients.push(db)
  await Promise.all([
    db.doc('students/student').set({ accountUid: 'learner', name: 'Member', branchId: 'branch', sessionsPerWeek: 3 }),
    db.doc('users/learner').set({ name: 'Member', history: [{ id: 'baseline', date: day(-30), weightKg: 80 }] }),
    db.doc('contracts/contract').set({ studentId: 'student', status: 'active', startDate: '2026-01-01', endDate: '2099-01-01', totalSessions: 2000, branchId: 'branch', totalPrice: 1000000, paidAmount: 1000000 }),
  ])
  if (large) {
    const records = Array.from({ length: 1005 }, (_, index) => ({ id: 's-' + index, studentId: 'student', contractId: 'contract', branchId: 'branch', date: day(-index), hour: 8, status: 'completed', attendanceStatus: 'present' }))
    for (let offset = 0; offset < records.length; offset += 200) {
      const batch = db.batch()
      for (const row of records.slice(offset, offset + 200)) {
        batch.set(db.doc('sessions/' + row.id), row)
        batch.set(db.doc('attendanceEvents/' + row.id), { ...row, sessionId: row.id })
      }
      await batch.commit()
    }
  }
  const projection = await buildStudent360Projection({ db, studentId: 'student' })
  return { db, projection }
}
async function writeEvent(db, path, value) {
  const ref = db.doc(path), before = await ref.get()
  if (value === null) await ref.delete(); else await ref.set(value)
  return { params: { accountUid: 'learner', documentId: ref.id }, data: { before, after: await ref.get() } }
}
function observedDb(db, reads, afterRead = async () => {}) {
  const query = (source, path) => ({
    where: (...args) => query(source.where(...args), path), orderBy: (...args) => query(source.orderBy(...args), path),
    limit: (...args) => query(source.limit(...args), path), select: (...args) => query(source.select(...args), path),
    async get() { const result = await source.get(); reads.push({ path, size: result.size }); await afterRead(path); return result },
  })
  return new Proxy(db, { get(target, key) {
    if (key === 'collection') return path => query(target.collection(path), path)
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
}
const sync = (db, event) => syncStudent360ProjectionFromEvent({ db, event, logger })
const current = async db => (await db.doc('studentOperationalViews/student').get()).data()
async function assertParity(db) {
  const actual = await current(db), full = await buildStudent360Projection({ db, studentId: 'student', persist: false })
  for (const key of progressFields) assert.deepEqual(actual[key], full[key], key)
  return actual
}

test('warm progress refresh skips 1000-row schedule/attendance scans and collapses same-commit mirrors', async () => {
  const { db, projection } = await fixture(true)
  const paths = ['progressCheckIns/checkin-new', 'bodyMeasurements/checkin-new', 'bodyMeasurements/current', 'weightLogs/checkin-new', 'progressPhotos/checkin-new-front']
  const refs = paths.map(path => db.doc('users/learner/' + path))
  const before = await db.getAll(...refs), batch = db.batch()
  refs.forEach((ref, index) => batch.set(ref, { id: ref.id, checkInId: 'checkin-new', date: today, weightKg: 75, waistCm: 80, ...(index === 0 ? { photos: [{ storagePath: 'private/fixture', angle: 'front' }] } : {}), createdAt: FieldValue.serverTimestamp() }))
  await batch.commit()
  const after = await db.getAll(...refs)
  const events = refs.map((ref, index) => ({ params: { accountUid: 'learner', documentId: ref.id }, data: { before: before[index], after: after[index] } }))
  const reads = []
  const result = await sync(observedDb(db, reads), events[0])
  assert.equal(result.mode, 'progress')
  assert.ok(reads.every(row => row.path === 'students' || collections.some(name => row.path === 'users/learner/' + name)), JSON.stringify(reads))
  assert.equal(reads.filter(row => row.path.startsWith('users/learner/')).length, 6)
  const actual = await assertParity(db)
  assert.equal(actual.progress.latestWeightKg, 75)
  assert.equal(actual.progress.measurementCount, 2, 'baseline plus one mirrored check-in')
  for (const key of unchanged) assert.deepEqual(actual[key], projection[key], key)
  const finished = (await db.doc('studentOperationalViews/student').get()).updateTime
  for (const event of events.slice(1)) assert.equal((await sync(db, event)).skipped, true)
  assert.ok(finished.isEqual((await db.doc('studentOperationalViews/student').get()).updateTime))
  const timeline = await db.collection('studentTimelineEvents').where('studentId', '==', 'student').where('type', '==', 'progress').get()
  assert.equal(timeline.docs.filter(doc => doc.data().metadata?.checkInId === 'checkin-new').length, 1)
})

test('edits, backdating, deletion and a delayed delete recompute the current progress summary', async () => {
  const { db } = await fixture()
  const path = 'users/learner/weightLogs/entry'
  let deleted
  for (const value of [{ date: today, weightKg: 75 }, { date: day(-2), weightKg: 76 }, null]) {
    const event = await writeEvent(db, path, value)
    if (value === null) deleted = event
    assert.equal((await sync(db, event)).mode, 'progress')
    await assertParity(db)
  }
  assert.equal((await current(db)).progress.latestWeightKg, 80)
  await writeEvent(db, path, { date: today, weightKg: 74 })
  await sync(db, deleted)
  assert.equal((await assertParity(db)).progress.latestWeightKg, 74)
})

test('missing, stale, changed-account and incomplete bases retain the full repair path', async () => {
  for (const kind of ['missing', 'day', 'week', 'schema', 'health', 'account']) {
    const { db } = await fixture()
    const ref = db.doc('studentOperationalViews/student')
    if (kind === 'missing') await ref.delete()
    else await ref.update(kind === 'day' ? { 'nutritionRefreshBasis.day': day(-1) }
      : kind === 'week' ? { 'schedule.weekId': '2020-01-06' }
      : kind === 'schema' ? { schemaVersion: -1 }
      : kind === 'health' ? { 'health.components': [] } : { accountUid: 'previous-account' })
    const reads = [], event = await writeEvent(db, 'users/learner/bodyMetrics/m', { date: today, weightKg: 70 })
    assert.equal((await sync(observedDb(db, reads), event)).mode, 'full', kind)
    assert.ok(reads.some(row => row.path === 'sessions'), kind)
    assert.equal((await assertParity(db)).progress.latestWeightKg, 70)
  }
})

test('a progress lease blocks nutrition/full races and never covers a later source write', async () => {
  const { db } = await fixture()
  const path = 'users/learner/weightLogs/entry', event = await writeEvent(db, path, { date: today, weightKg: 75 })
  let signal, release, paused = false
  const ready = new Promise(resolve => { signal = resolve }), wait = new Promise(resolve => { release = resolve })
  const delayed = observedDb(db, [], async source => { if (source === 'users/learner/weightLogs' && !paused) { paused = true; signal(); await wait } })
  const running = sync(delayed, event)
  await ready
  const newer = await writeEvent(db, path, { date: today, weightKg: 73 })
  const nutrition = await writeEvent(db, 'users/learner/mealLogs/meal', { date: today, status: 'logged', calories: 500, protein: 20 })
  await assert.rejects(sync(db, nutrition), { code: 'unavailable' })
  await assert.rejects(buildStudent360Projection({ db, studentId: 'student' }), { code: 'unavailable' })
  release()
  await running
  assert.equal((await current(db)).progress.latestWeightKg, 75, 'the first source read cannot pretend to include the later edit')
  assert.equal((await sync(db, newer)).mode, 'progress')
  assert.equal((await sync(db, nutrition)).mode, 'nutrition')
  const actual = await assertParity(db)
  assert.equal(actual.progress.latestWeightKg, 73)
  assert.equal(actual.nutrition.averageCalories, 500)
})

test('profile changes during loading reject publication and retry from current authority', async () => {
  const { db, projection } = await fixture()
  const event = await writeEvent(db, 'users/learner/weightLogs/entry', { date: today, weightKg: 75 })
  let changed = false
  const delayed = observedDb(db, [], async source => {
    if (!changed && source === 'users/learner/weightLogs') {
      changed = true
      await db.doc('users/learner').update({ history: [{ id: 'new-baseline', date: day(-40), weightKg: 90 }] })
    }
  })
  await assert.rejects(sync(delayed, event), error => {
    assert.equal(error.code, 'unavailable')
    assert.deepEqual(student360FailureFields(error), { failureReason: 'progress_authority_changed', failurePhase: 'progress_write' })
    return true
  })
  assert.deepEqual((await current(db)).progress, projection.progress)
  const state = (await db.doc('systemJobs/student360Rebuild/subjects/student').get()).data()
  assert.equal(state.progressCoveredThrough, undefined)
  assert.equal(state.token, null)
  assert.equal((await sync(db, event)).mode, 'progress')
  assert.equal((await assertParity(db)).progress.weightChangeKg, -15)
})

test('an account reassignment during loading fences the old account and the student event repairs the new account', async () => {
  const { db, projection } = await fixture()
  await db.doc('users/replacement').set({ name: 'Replacement account' })
  await db.doc('users/replacement/weightLogs/replacement').set({ date: today, weightKg: 60 })
  const studentRef = db.doc('students/student'), beforeStudent = await studentRef.get()
  const event = await writeEvent(db, 'users/learner/weightLogs/entry', { date: today, weightKg: 75 })
  let changed = false
  const delayed = observedDb(db, [], async source => {
    if (!changed && source === 'users/learner/weightLogs') {
      changed = true
      await studentRef.update({ accountUid: 'replacement' })
    }
  })
  await assert.rejects(sync(delayed, event), error => {
    assert.equal(error.code, 'unavailable')
    assert.deepEqual(student360FailureFields(error), { failureReason: 'progress_authority_changed', failurePhase: 'progress_write' })
    return true
  })
  assert.deepEqual((await current(db)).progress, projection.progress)
  assert.equal((await sync(db, event)).reason, 'student_not_resolved', 'an old account event does not revive its former link')
  const studentEvent = { params: { studentId: 'student' }, data: { before: beforeStudent, after: await studentRef.get() } }
  assert.equal((await sync(db, studentEvent)).mode, 'full')
  const actual = await assertParity(db)
  assert.equal(actual.accountUid, 'replacement')
  assert.equal(actual.progress.latestWeightKg, 60)
})

test('legacy account assignments continue through the full resolver without guessing a UID', async () => {
  const { db } = await fixture()
  await db.doc('students/student').update({ accountUid: FieldValue.delete() })
  await db.doc('roleAssignments/learner').set({ accessRole: 'student', crmProfileId: 'student' })
  const event = await writeEvent(db, 'users/learner/weightLogs/entry', { date: today, weightKg: 75 })
  assert.equal((await sync(db, event)).mode, 'full')
  const actual = await assertParity(db)
  assert.equal(actual.accountUid, 'learner')
  assert.equal(actual.progress.latestWeightKg, 75)
})

test('photo-only updates retain overview updateTime and never query non-progress history', async () => {
  const { db } = await fixture()
  const before = await db.doc('studentOperationalViews/student').get()
  const reads = [], event = await writeEvent(db, 'users/learner/progressPhotos/photo', { date: today, createdAt: FieldValue.serverTimestamp(), storagePath: 'private/fixture' })
  assert.equal((await sync(observedDb(db, reads), event)).mode, 'progress')
  const after = await db.doc('studentOperationalViews/student').get()
  assert.ok(before.updateTime.isEqual(after.updateTime), 'no metadata-only overview write')
  const timeline = await db.collection('studentTimelineEvents').where('studentId', '==', 'student').where('type', '==', 'progress').get()
  assert.ok(timeline.docs.some(doc => doc.data().metadata?.progressPhotoId === 'photo'))
  assert.ok(!JSON.stringify(timeline.docs.map(doc => doc.data())).includes('private/fixture'))
  await assertParity(db)
})

test('each progress source remains newest-first and bounded to 300 source documents in total', async () => {
  const { db } = await fixture(), batch = db.batch()
  for (const name of collections) {
    const maximum = name.includes('Photo') || name.includes('photo') ? 30 : 60
    for (let index = 0; index < maximum + 1; index++) batch.set(db.doc('users/learner/' + name + '/entry-' + index), { date: day(-index), weightKg: 70 + index / 10 })
  }
  await batch.commit()
  const event = await writeEvent(db, 'users/learner/bodyMetrics/entry-0', { date: today, weightKg: 65 })
  const reads = []
  assert.equal((await sync(observedDb(db, reads), event)).mode, 'progress')
  assert.equal(reads.filter(row => row.path.startsWith('users/learner/')).reduce((sum,row) => sum + row.size, 0), 300)
  await assertParity(db)
})
