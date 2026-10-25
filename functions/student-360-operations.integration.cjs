'use strict'
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { buildStudent360Projection, syncStudent360ProjectionFromEvent, vietnamDateKey, redactProjection } = require('./student-360')
const { student360FailureFields } = require('./student-360-projection-writes')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, 'operations-domain-' + randomUUID())
const clients = [], logger = { info() {}, error() {} }
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })
const today = vietnamDateKey()
const day = offset => new Date(Date.parse(today + 'T12:00:00Z') + offset * 86400000).toISOString().slice(0, 10)
const fields = ['identity', 'assignments', 'contract', 'schedule', 'attendance', 'training', 'nutrition', 'progress', 'renewal', 'health', 'alerts', 'nextActions', 'dataQuality']
const operationalQueries = new Set(['contracts', 'sessions', 'attendanceEvents', 'leaveRequests', 'sessionRequests'])
const row = (patch = {}) => ({ studentId: 'student', contractId: 'contract', branchId: 'branch', date: today, hour: 8, status: 'scheduled', ...patch })
const sync = (db, event, enabled = true) => syncStudent360ProjectionFromEvent({ db, event, logger, operationsEnabled: enabled })
const current = async (db, id = 'student') => (await db.doc('studentOperationalViews/' + id).get()).data()
async function fixture(large = false) {
  const db = getFirestore(app, 'operations-domain-' + randomUUID()); clients.push(db)
  const initial = {
    'students/student': { accountUid: 'learner', name: 'Member', branchId: 'branch', sessionsPerWeek: 3 },
    'users/learner': { name: 'Member', history: [{ id: 'baseline', date: day(-30), weightKg: 80 }], goals: ['fitness'] },
    'branches/branch': { name: 'Branch' },
    'contracts/contract': { studentId: 'student', status: 'active', startDate: day(-100), endDate: day(100), totalSessions: 2000, branchId: 'branch', totalPrice: 1000000, paidAmount: 1000000 },
    'users/learner/mealLogs/meal': { date: today, status: 'logged', calories: 500, protein: 30, createdAt: FieldValue.serverTimestamp() },
    'users/learner/weightLogs/weight': { date: today, weightKg: 75 },
    'workoutLogs/workout': { studentId: 'student', date: day(-2), title: 'Workout', completedAt: day(-2) + 'T08:00:00Z' },
    'dailyCheckins/checkin': { studentId: 'student', date: day(-1), createdAt: day(-1) + 'T08:00:00Z' },
    'ptTrainingPrograms/student': { title: 'Program', revision: 1, trainingDays: [] },
  }
  await Promise.all(Object.entries(initial).map(([path, value]) => db.doc(path).set(value)))
  if (large) {
    const rows = []
    for (let i = 0; i < 1005; i++) {
      rows.push(['sessions/s-' + i, row({ date: day(-i), status: 'completed' })])
      rows.push(['attendanceEvents/s-' + i, row({ date: day(-i), sessionId: 's-' + i, attendanceStatus: 'present' })])
    }
    for (let i = 0; i < 151; i++) for (const collection of ['payments', 'ledgerEntries']) rows.push([collection + '/p-' + i, { studentId: 'student', amount: 100, effectiveAt: day(-i) }])
    for (let i = 0; i < 121; i++) for (const collection of ['workoutLogs', 'ptWorkoutLogs']) rows.push([collection + '/w-' + i, { studentId: 'student', date: day(-i), title: 'Workout' }])
    for (let offset = 0; offset < rows.length; offset += 300) {
      const batch = db.batch(); rows.slice(offset, offset + 300).forEach(([path, value]) => batch.set(db.doc(path), value)); await batch.commit()
    }
  }
  const projection = await buildStudent360Projection({ db, studentId: 'student' })
  return { db, projection }
}
async function event(db, path, value) {
  const ref = db.doc(path), before = await ref.get()
  if (value === null) await ref.delete(); else await ref.set(value)
  return { params: { documentId: ref.id, ...(path.startsWith('users/') ? { accountUid: 'learner' } : {}) }, data: { before, after: await ref.get() } }
}
function observedDb(db, reads, afterRead = async () => {}, counts = null) {
  const query = (source, path) => ({
    where: (...args) => query(source.where(...args), path), orderBy: (...args) => query(source.orderBy(...args), path),
    limit: (...args) => query(source.limit(...args), path), select: (...args) => query(source.select(...args), path),
    async get() { const result = await source.get(); reads.push({ path, size: result.size }); if (counts) counts.logicalDocumentReads += result.size; await afterRead(path); return result },
  })
  return new Proxy(db, { get(target, key) {
    if (key === 'collection') return path => query(target.collection(path), path)
    if (counts && key === 'doc') return path => new Proxy(target.doc(path), { get(ref, key) {
      if (key === 'get') return async () => { counts.logicalDocumentReads++; return ref.get() }
      const value = Reflect.get(ref, key, ref); return typeof value === 'function' ? value.bind(ref) : value
    } })
    if (counts && key === 'getAll') return async (...refs) => { counts.logicalDocumentReads += refs.length; return target.getAll(...refs) }
    if (counts && key === 'runTransaction') return work => target.runTransaction(transaction => work(new Proxy(transaction, { get(tx, key) {
      if (key === 'get') return async ref => { const result = await tx.get(ref); counts.logicalDocumentReads += result.size ?? 1; return result }
      if (key === 'getAll') return async (...refs) => { counts.logicalDocumentReads += refs.length; return tx.getAll(...refs) }
      if (['set', 'update', 'delete'].includes(key)) return (...args) => { counts.writesAttempted++; return tx[key](...args) }
      const value = Reflect.get(tx, key, tx); return typeof value === 'function' ? value.bind(tx) : value
    } })))
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value
  } })
}
async function parity(db, id = 'student') {
  const actual = await current(db, id), full = await buildStudent360Projection({ db, studentId: id, persist: false })
  for (const field of fields) assert.deepEqual(actual[field], full[field], field + ' for ' + id)
  return actual
}

test('warm operations skip all unrelated histories, retain full freshness, and coalesce same-commit mirrors', async () => {
  const { db, projection } = await fixture(true)
  const control = (await fixture(true)).db
  const change = async db => {
    const refs = [db.doc('sessions/latest'), db.doc('attendanceEvents/latest')], before = await db.getAll(...refs), batch = db.batch()
    batch.set(refs[0], row({ status: 'completed' })); batch.set(refs[1], row({ sessionId: 'latest', attendanceStatus: 'present' })); await batch.commit()
    const after = await db.getAll(...refs)
    return refs.map((ref, i) => ({ params: { documentId: ref.id }, data: { before: before[i], after: after[i] } }))
  }
  const events = await change(db), fullEvents = await change(control)
  const reads = [], counts = { logicalDocumentReads: 0, writesAttempted: 0 }, result = await sync(observedDb(db, reads, undefined, counts), events[0])
  assert.equal(result.mode, 'operations')
  assert.equal(reads.length, 6, JSON.stringify(reads))
  assert.ok(reads.every(read => operationalQueries.has(read.path)), JSON.stringify(reads))
  assert.ok(reads.filter(read => ['sessions', 'attendanceEvents'].includes(read.path)).every(read => read.size === 1000))
  const actual = await parity(db)
  assert.equal(actual.generatedAt, projection.generatedAt)
  assert.equal(actual.generatedAtMillis, projection.generatedAtMillis)
  const updated = (await db.doc('studentOperationalViews/student').get()).updateTime
  assert.equal((await sync(db, events[1])).skipped, true)
  assert.equal((await sync(db, events[0])).skipped, true)
  assert.ok(updated.isEqual((await db.doc('studentOperationalViews/student').get()).updateTime))
  const fullReads = [], fullCounts = { logicalDocumentReads: 0, writesAttempted: 0 }
  await sync(observedDb(control, fullReads, undefined, fullCounts), fullEvents[0], false)
  assert.equal(fullReads.length, 20)
  assert.ok(counts.logicalDocumentReads < fullCounts.logicalDocumentReads, JSON.stringify({ counts, fullCounts }))
  assert.ok(counts.writesAttempted <= fullCounts.writesAttempted, JSON.stringify({ counts, fullCounts }))
  const trainingRows = async db => (await db.collection('studentTimelineEvents').where('type', '==', 'training').get()).docs.map(doc => doc.data()).sort((a, b) => a.id.localeCompare(b.id))
  assert.deepEqual(await trainingRows(db), await trainingRows(control), 'partial updates retain the mixed-domain timeline cap')
  console.log(JSON.stringify({ fixture: 'student360-operations-read-budget', operations: { queries: reads.length, ...counts }, full: { queries: fullReads.length, ...fullCounts }, billedUnits: 'not_measured' }))
  // Removing/backdating many recent sessions must admit exactly the same
  // older operational rows as a full rebuild, without scanning finance again.
  for (const target of [db, control]) {
    const batch = target.batch()
    for (let i = 0; i < 70; i++) batch.delete(target.doc('sessions/s-' + i))
    await batch.commit()
  }
  const backdated = row({ date: day(-500), status: 'cancelled' })
  await sync(db, await event(db, 'sessions/latest', backdated))
  await sync(control, await event(control, 'sessions/latest', backdated), false)
  assert.deepEqual(await trainingRows(db), await trainingRows(control), 'backdating/deletions preserve the global cap')
})

test('backdated edits, cancellations, deletion and delayed deletion match the complete projection', async () => {
  const { db } = await fixture()
  let deleted
  for (const value of [row(), row({ date: day(-2), status: 'completed' }), row({ date: day(-2), status: 'cancelled' }), null]) {
    const change = await event(db, 'sessions/session', value)
    if (value === null) deleted = change
    assert.equal((await sync(db, change)).mode, 'operations')
    await parity(db)
  }
  await event(db, 'sessions/session', row({ date: day(1) }))
  await sync(db, deleted)
  assert.equal((await parity(db)).schedule.nextSession.date, day(1))
})

test('moving a session reconciles both learners and retry does not rebuild an already covered subject', async () => {
  const { db } = await fixture()
  await db.doc('students/second').set({ accountUid: 'second-account', name: 'Second', branchId: 'other', sessionsPerWeek: 2 })
  await db.doc('users/second-account').set({ name: 'Second' })
  await db.doc('contracts/second').set({ studentId: 'second', status: 'active', startDate: day(-10), endDate: day(100), totalSessions: 100, branchId: 'other' })
  await buildStudent360Projection({ db, studentId: 'second' })
  await sync(db, await event(db, 'sessions/moved', row()))
  const moved = await event(db, 'sessions/moved', row({ studentId: 'second', contractId: 'second', branchId: 'other' }))
  const result = await sync(db, moved)
  assert.deepEqual(result.studentIds, ['second', 'student'])
  assert.equal((await parity(db)).training.sessionCount, 0)
  assert.equal((await parity(db, 'second')).training.sessionCount, 1)
  assert.equal((await sync(db, moved)).skipped, true)
})

test('availability, leave requests, session requests and canonical quota retain full parity', async () => {
  const { db, projection } = await fixture()
  const { contractUsageViewFromEvidence } = require('./contract-usage-view')
  const contract = (await db.doc('contracts/contract').get()).data()
  for (const [path, value] of [
    ['ptAvailability/student_' + projection.schedule.weekId, { studentId: 'student', weekId: projection.schedule.weekId, slots: ['mon_8'], status: 'submitted' }],
    ['leaveRequests/leave', { studentId: 'student', startDate: today, endDate: day(2), status: 'approved' }],
    ['sessionRequests/request', { studentId: 'student', createdAt: new Date().toISOString(), status: 'pending' }],
    ['contractUsageViews/contract', contractUsageViewFromEvidence('contract', contract, [row({ id: 'charged', status: 'completed' })])],
  ]) {
    assert.equal((await sync(db, await event(db, path, value))).mode, 'operations', path)
    await parity(db)
  }
})

test('clearing an owner or moving to a missing learner still reconciles the former owner', async () => {
  for (const studentId of [null, 'missing-learner']) {
    const { db } = await fixture()
    await sync(db, await event(db, 'sessions/moved', row()))
    const result = await sync(db, await event(db, 'sessions/moved', row({ studentId })))
    assert.equal(result.skipped, false)
    assert.equal(result.mode, 'operations')
    assert.equal((await parity(db)).training.sessionCount, 0)
  }
})

test('an operations refresh does not cover an earlier pending workout event', async () => {
  const { db } = await fixture()
  const workout = await event(db, 'workoutLogs/new', { studentId: 'student', date: today, title: 'New workout', completedAt: new Date().toISOString() })
  assert.equal((await sync(db, await event(db, 'sessions/s', row()))).mode, 'operations')
  assert.equal((await sync(db, workout)).mode, 'full')
  assert.equal((await parity(db)).training.workoutLogCount, 2)
})

test('note-only changes do not rewrite the overview and current training program is still read', async () => {
  const { db } = await fixture()
  await sync(db, await event(db, 'sessions/s', row()))
  const before = (await db.doc('studentOperationalViews/student').get()).updateTime
  await sync(db, await event(db, 'sessions/s', row({ note: 'Administrative note' })))
  assert.ok(before.isEqual((await db.doc('studentOperationalViews/student').get()).updateTime))
  await db.doc('ptTrainingPrograms/student').update({ title: 'Revised program', revision: 2 })
  await sync(db, await event(db, 'sessions/s', row({ hour: 9 })))
  assert.equal((await parity(db)).training.program.revision, 2)
})

test('missing, old-day/week, incomplete, changed-authority and older-nutrition bases repair fully', async () => {
  for (const kind of ['missing', 'basis', 'day', 'week', 'student', 'profile', 'nutrition-version']) {
    const { db } = await fixture(), ref = db.doc('studentOperationalViews/student')
    if (kind === 'missing') await ref.delete()
    else if (kind === 'student') await db.doc('students/student').update({ sessionsPerWeek: 4 })
    else if (kind === 'profile') await db.doc('users/learner').update({ history: [{ date: day(-20), weightKg: 90 }] })
    else await ref.update(kind === 'basis' ? { 'nutritionRefreshBasis.operations': FieldValue.delete() }
      : kind === 'day' ? { 'nutritionRefreshBasis.operations.day': day(-1) }
        : kind === 'week' ? { 'schedule.weekId': '2020-01-06' } : { nutritionUpdatedAt: 'older-handler-updated-this' })
    const reads = [], change = await event(db, 'sessions/new', row())
    assert.equal((await sync(observedDb(db, reads), change)).mode, 'full', kind)
    assert.ok(reads.some(read => read.path === 'payments'), kind)
    await parity(db)
  }
})

test('profile changes during loading fence publication and leave the event retryable', async () => {
  const { db, projection } = await fixture(), change = await event(db, 'sessions/s', row())
  let changed = false
  const delayed = observedDb(db, [], async path => { if (path === 'sessions' && !changed) { changed = true; await db.doc('users/learner').update({ goals: ['new goal'] }) } })
  await assert.rejects(sync(delayed, change), error => {
    assert.deepEqual(student360FailureFields(error), { failureReason: 'operations_authority_changed', failurePhase: 'operations_write' }); return true
  })
  assert.deepEqual((await current(db)).schedule, projection.schedule)
  const state = (await db.doc('systemJobs/student360Rebuild/subjects/student').get()).data()
  assert.equal(state.operationsCoveredThrough, undefined); assert.equal(state.token, null)
  assert.equal((await sync(db, change)).mode, 'full')
  await parity(db)
})

test('root timestamp touches neither write the overview nor invalidate warm operations', async () => {
  const { db, projection } = await fixture()
  for (const path of ['students/student', 'users/learner']) {
    const data = (await db.doc(path).get()).data(), reads = [], counts = { logicalDocumentReads: 0, writesAttempted: 0 }
    const changed = await event(db, path, { ...data, updatedAt: FieldValue.serverTimestamp() })
    assert.equal((await sync(observedDb(db, reads, undefined, counts), changed)).reason, 'source_metadata_only')
    assert.deepEqual(counts, { logicalDocumentReads: 0, writesAttempted: 0 })
  }
  assert.equal((await current(db)).generatedAt, projection.generatedAt)
  assert.equal((await sync(db, await event(db, 'sessions/new', row()))).mode, 'operations')
  await parity(db)
})

test('timestamp-only authority writes during loading do not abort an otherwise current operations refresh', async () => {
  const { db } = await fixture(), change = await event(db, 'sessions/new', row())
  let touched = false
  const loading = observedDb(db, [], async path => {
    if (path === 'sessions' && !touched) {
      touched = true
      await db.doc('users/learner').update({ updatedAt: FieldValue.serverTimestamp() })
      await db.doc('students/student').update({ updatedAt: FieldValue.serverTimestamp() })
    }
  })
  assert.equal((await sync(loading, change)).mode, 'operations')
  await parity(db)
})

test('a later session and nutrition event survive an in-flight operations refresh', async () => {
  const { db } = await fixture(), first = await event(db, 'sessions/s', row())
  let enter, release, paused = false
  const entered = new Promise(resolve => { enter = resolve }), wait = new Promise(resolve => { release = resolve })
  const running = sync(observedDb(db, [], async path => { if (path === 'sessions' && !paused) { paused = true; enter(); await wait } }), first)
  await entered
  const later = await event(db, 'sessions/s', row({ hour: 10 }))
  const meal = await event(db, 'users/learner/mealLogs/meal', { date: today, status: 'logged', calories: 700, protein: 40, createdAt: FieldValue.serverTimestamp() })
  await assert.rejects(sync(db, later), { code: 'unavailable' })
  await assert.rejects(sync(db, meal), { code: 'unavailable' })
  await assert.rejects(buildStudent360Projection({ db, studentId: 'student' }), { code: 'unavailable' })
  release(); await running
  assert.equal((await current(db)).schedule.nextSession.hour, 8)
  assert.equal((await sync(db, meal)).mode, 'nutrition')
  assert.equal((await sync(db, later)).mode, 'operations')
  assert.equal((await parity(db)).schedule.nextSession.hour, 10)
})

test('rollback flag uses full refresh and contract payment changes retain canonical finance timeline coverage', async () => {
  const { db } = await fixture()
  const reads = []
  assert.equal((await sync(observedDb(db, reads), await event(db, 'sessions/s', row()), false)).mode, 'full')
  assert.ok(reads.some(read => read.path === 'ledgerEntries'))
  const contract = (await db.doc('contracts/contract').get()).data()
  await db.doc('ledgerEntries/payment').set({ studentId: 'student', contractId: 'contract', type: 'payment', amount: 100, effectiveAt: new Date().toISOString(), status: 'posted' })
  const change = await event(db, 'contracts/contract', { ...contract, paidAmount: 900000 })
  assert.equal((await sync(db, change)).mode, 'full')
  await parity(db)
  const finance = await db.collection('studentTimelineEvents').where('type', '==', 'finance').get()
  assert.ok(finance.docs.some(doc => doc.data().sourceCollection === 'ledgerEntries' && doc.data().metadata.amount === 100))
})

test('older partial writers invalidate timeline ranks without needing an overview mutation', async () => {
  const { Timestamp } = require('firebase-admin/firestore')
  for (const watermark of ['nutritionCoveredThrough', 'progressCoveredThrough', 'legacy-failed-worker']) {
    const { db } = await fixture()
    await db.doc('systemJobs/student360Rebuild/subjects/student').update(watermark === 'legacy-failed-worker'
      ? { token: null, leaseUntil: null } : { [watermark]: Timestamp.now() })
    assert.equal((await sync(db, await event(db, 'sessions/new', row()))).mode, 'full', watermark)
    assert.equal((await sync(db, await event(db, 'sessions/new', row({ hour: 9 })))).mode, 'operations', watermark)
    await parity(db)
  }
})

test('nutrition/progress partials keep timeline ranks valid and photo-only edits avoid overview writes', async () => {
  const { db } = await fixture()
  assert.equal((await sync(db, await event(db, 'users/learner/mealLogs/meal', { date: today, status: 'logged', calories: 600, createdAt: new Date().toISOString() }))).mode, 'nutrition')
  assert.equal((await sync(db, await event(db, 'sessions/new', row()))).mode, 'operations')
  const before = (await db.doc('studentOperationalViews/student').get()).updateTime
  const photo = await event(db, 'users/learner/progressPhotos/photo', { date: today, createdAt: new Date().toISOString(), images: [] })
  assert.equal((await sync(db, photo)).mode, 'progress')
  assert.ok(before.isEqual((await db.doc('studentOperationalViews/student').get()).updateTime))
  assert.equal((await sync(db, await event(db, 'sessions/new', row({ hour: 9 })))).mode, 'operations')
  await parity(db)
})

test('legacy account links retain complete resolution', async () => {
  const { db } = await fixture()
  await db.doc('students/student').update({ accountUid: FieldValue.delete() })
  await db.doc('roleAssignments/learner').set({ accessRole: 'student', crmProfileId: 'student' })
  assert.equal((await sync(db, await event(db, 'sessions/s', row()))).mode, 'full')
  assert.equal((await parity(db)).accountUid, 'learner')
})

test('internal operations metadata stays inside the basis removed by existing reader redaction', async () => {
  const { db } = await fixture()
  await sync(db, await event(db, 'sessions/s', row()))
  const stored = await current(db)
  assert.equal(stored.nutritionRefreshBasis.operations.version, 1)
  assert.equal(stored.operationsRefreshBasis, undefined)
  const result = redactProjection(stored, { canViewTraining: true, canViewNutrition: true, canViewProgress: true, canViewRenewal: true, canViewOperations: true, canViewFinancialAmounts: true })
  assert.equal(result.nutritionRefreshBasis, undefined)
  assert.equal(JSON.stringify(result).includes('authorityFingerprint'), false)
})

test('crossing Vietnam midnight during source loading cannot publish a mixed-day projection', async t => {
  const start = Date.parse(today + 'T23:59:00+07:00')
  t.mock.timers.enable({ apis: ['Date'], now: start })
  const { db, projection } = await fixture(), change = await event(db, 'sessions/midnight', row())
  let moved = false
  const crossing = observedDb(db, [], async path => { if (path === 'sessions' && !moved) { moved = true; t.mock.timers.setTime(start + 120000) } })
  await assert.rejects(sync(crossing, change), error => {
    assert.deepEqual(student360FailureFields(error), { failureReason: 'operations_day_changed', failurePhase: 'operations_write' }); return true
  })
  assert.deepEqual((await current(db)).schedule, projection.schedule)
  const state = (await db.doc('systemJobs/student360Rebuild/subjects/student').get()).data()
  assert.equal(state.operationsCoveredThrough, undefined)
  assert.equal((await sync(db, change)).mode, 'full')
  await parity(db)
})
