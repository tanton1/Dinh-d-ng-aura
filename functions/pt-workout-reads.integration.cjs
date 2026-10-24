'use strict'

const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { createPtWorkoutTrackingFunctions } = require('./pt-workout-tracking')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `workout-reads-${randomUUID()}`)
const clients = []
after(async () => { await Promise.all(clients.map((db) => db.terminate())); await deleteApp(app) })

async function fixture() {
  const db = getFirestore(app, `workout-reads-${randomUUID()}`)
  clients.push(db)
  const batch = db.batch()
  for (const id of ['a', 'b']) batch.set(db.doc(`users/${id}`), { role: 'student' })
  batch.set(db.doc('ptTrainingPrograms/a'), { studentId: 'a', title: 'Plan A', revision: 1, trainingDays: [] })
  for (let i = 0; i < 67; i++) batch.set(db.doc(`ptWorkoutLogs/log-${String(i).padStart(3, '0')}`), {
    studentId: 'a', date: '2026-10-24', hour: 8, status: 'completed', revision: 1, sets: [], metrics: { totalVolumeKg: 100 },
  })
  batch.set(db.doc('ptWorkoutLogs/private-b'), { studentId: 'b', date: '2026-10-24', hour: 8 })
  await batch.commit()
  const reads = []
  const wrap = (target, size) => new Proxy(target, { get(object, key) {
    if (key === 'get') return async () => { const result = await object.get(); reads.push({ size, count: result.size }); return result }
    if (['where', 'orderBy', 'startAfter', 'limit'].includes(key)) return (...args) => wrap(object[key](...args), key === 'limit' ? args[0] : size)
    const value = object[key]; return typeof value === 'function' ? value.bind(object) : value
  } })
  const monitored = new Proxy(db, { get(object, key) {
    if (key === 'collection') return (name) => name === 'ptWorkoutLogs' ? wrap(object.collection(name)) : object.collection(name)
    const value = object[key]; return typeof value === 'function' ? value.bind(object) : value
  } })
  const calls = createPtWorkoutTrackingFunctions({ db: monitored, onCall: (_options, handler) => handler })
  const request = (data, uid = 'a', token = { role: 'student' }) => ({ auth: { uid, token }, data })
  const run = (data = {}, uid = 'a') => calls.listPtWorkoutHistory(request({ personal: true, pageSize: 25, ...data }, uid))
  return { db, reads, calls, request, run }
}

test('workout cursor reads bounded pages with stable ties, no repeated rows, and no all-history summary', async () => {
  const f = await fixture()
  const pages = [await f.run()]
  while (pages.at(-1).hasMore) pages.push(await f.run({ cursor: pages.at(-1).nextCursor }))
  assert.deepEqual(pages.map((page) => page.logs.length), [25, 25, 17])
  const ids = pages.flatMap((page) => page.logs.map((log) => log.id))
  assert.equal(new Set(ids).size, 67)
  assert.equal(ids.includes('private-b'), false)
  assert.deepEqual(f.reads, [{ size: 26, count: 26 }, { size: 26, count: 26 }, { size: 26, count: 17 }])
  assert.ok(pages.every((page) => !Object.hasOwn(page, 'analytics')))
  assert.equal(pages.at(-1).nextCursor, null)
  // Legacy staff tools still receive their bounded recent-history analytics.
  const old = await f.calls.listPtWorkoutHistory(f.request({ personal: true, limit: 60 }))
  assert.equal(old.logs.length, 60)
  assert.equal(old.analytics.totalVolumeKg, 6000)
})

test('history cursor is bound to account, resolved learner, and source version before any log query', async () => {
  const f = await fixture()
  const first = await f.run()
  for (const cursor of ['not-a-cursor', first.nextCursor]) {
    await assert.rejects(f.run({ cursor }, 'b'), (error) => error.code === 'invalid-argument')
  }
  await f.db.doc('users/a/workspaceChanges/operations').set({ studentWorkoutHistoryVersion: '001700000050.000000001' })
  await assert.rejects(f.run({ cursor: first.nextCursor }), (error) => error.details.issueCode === 'WORKOUT_HISTORY_CHANGED')
  assert.equal(f.reads.length, 1)
  const next = await f.run()
  assert.notEqual(first.syncState.version, next.syncState.version)
})

test('deleted cursor anchor still advances by ordered values and access revocation rejects reads', async () => {
  const f = await fixture()
  const first = await f.run()
  await f.db.doc(`ptWorkoutLogs/${first.logs.at(-1).id}`).delete()
  const second = await f.run({ cursor: first.nextCursor })
  assert.equal(second.logs.length, 25)
  assert.equal(second.logs.some((log) => first.logs.some((old) => old.id === log.id)), false)
  await f.db.doc('users/a').update({ disabled: true })
  await assert.rejects(f.run(), (error) => error.code === 'permission-denied')
  await assert.rejects(f.calls.getPtStudentTrainingPlan(f.request({ personal: true })), (error) => error.code === 'permission-denied')
  assert.equal(f.reads.length, 2)
})

test('personal staff learner uses the verified CRM identity while plan reads never query history', async () => {
  const f = await fixture()
  await f.db.doc('users/staff').set({ role: 'staff' })
  await f.db.doc('roleAssignments/staff').set({ accessRole: 'staff', crmProfileId: 'a', authzVersion: 1, status: 'active', staffRoles: [], branchIds: [] })
  await f.db.doc('students/a').set({ accountUid: 'staff' })
  const token = { accessRole: 'staff', authzVersion: 1, role: 'staff' }
  const plan = await f.calls.getPtStudentTrainingPlan(f.request({ personal: true }, 'staff', token))
  assert.equal(plan.studentId, 'a')
  assert.equal(plan.program.title, 'Plan A')
  assert.ok(plan.syncState.version)
  assert.equal(f.reads.length, 0)
  const history = await f.calls.listPtWorkoutHistory(f.request({ personal: true, pageSize: 25 }, 'staff', token))
  assert.equal(history.studentId, 'a')
  await assert.rejects(f.calls.listPtWorkoutHistory(f.request({ personal: true, studentId: 'b', pageSize: 25 }, 'staff', token)), (error) => error.code === 'permission-denied')
  assert.equal(f.reads.length, 1)
})
