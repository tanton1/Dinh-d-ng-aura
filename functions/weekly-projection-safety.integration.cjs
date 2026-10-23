'use strict'

const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { FieldValue, getFirestore } = require('firebase-admin/firestore')
const {
  buildPtScheduleWeeklyView, rebuildPtScheduleWeeklyView,
  markPtScheduleWeeklyViewDirty, syncPtScheduleWeeklyViewSource,
} = require('./pt-schedule-weekly-view')

// Deliberately outside the ordinary unit-test glob. Integration writes must
// use a local emulator and never credentials/endpoints for the live project.
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const projectId = 'demo-aura-fitness'
assert.match(projectId, /^demo-/)
const app = initializeApp({ projectId }, `weekly-projection-safety-${randomUUID()}`)
const clients = []
const BRANCH = 'branch-a'
const WEEK = '2026-10-19'
const viewPath = (branch = BRANCH, week = WEEK) => `ptScheduleWeeklyViews/${branch}_${week}`
const leasePath = `systemJobs/ptScheduleWeeklyViewRebuild/views/${BRANCH}_${WEEK}`
const quiet = { info() {} }

after(async () => {
  await Promise.all(clients.map(db => db.terminate()))
  await deleteApp(app)
})

function fixture() {
  const db = getFirestore(app, `weekly-projection-${randomUUID()}`)
  clients.push(db)
  return db
}

function data(revision = 1) {
  return {
    branch: { id: BRANCH, name: 'Test branch' }, weekId: WEEK,
    partial: false, readMode: 'reconciled',
    draft: { revision, status: 'draft', publishedVersion: 0, publishedRevision: -1 },
    schedule: { 'T2-6': [{ studentId: 'student-a', trainerId: 'trainer-a', branchId: BRANCH, contractId: 'contract-a', type: 'training' }] },
    students: [{ id: 'student-a', name: 'Student fixture', branchId: BRANCH, phone: '0901', email: 'fixture@example.test', status: 'active', sessionsPerWeek: 2, eligibleForWeek: true, eligibleContractIds: ['contract-a'], availabilityStatus: 'submitted' }],
    trainers: [{ id: 'trainer-a', name: 'Trainer fixture', branchId: BRANCH }],
    contracts: [{ id: 'contract-a', studentId: 'student-a', branchId: BRANCH, totalSessions: 10, usedSessions: 1 }],
    sessions: [], weeklySessionCoverage: {}, config: {},
  }
}

async function seed(db) {
  const view = buildPtScheduleWeeklyView({ branchId: BRANCH, weekId: WEEK, data: data() })
  await db.doc(viewPath()).set({ ...view, dirtyGeneration: 0 })
  return view
}

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('real Firestore: twenty concurrent viewers allow only one active source fan-out', { timeout: 30000 }, async () => {
  const db = fixture()
  await seed(db)
  await markPtScheduleWeeklyViewDirty({ db, branchId: BRANCH, weekId: WEEK })
  const entered = deferred()
  const release = deferred()
  let sourceLoads = 0
  const branchData = async () => { sourceLoads += 1; entered.resolve(); await release.promise; return data(2) }
  const active = rebuildPtScheduleWeeklyView({ db, branchId: BRANCH, weekId: WEEK, branchData })
  await entered.promise
  const competing = await Promise.all(Array.from({ length: 19 }, () => rebuildPtScheduleWeeklyView({ db, branchId: BRANCH, weekId: WEEK, branchData })))
  assert.equal(sourceLoads, 1)
  assert.ok(competing.every(result => result.rebuilding === true && result.rebuildStatus === 'busy'))
  assert.ok(competing.every(result => Array.isArray(result.students) && result.schedule))
  release.resolve()
  const finished = await active
  assert.equal(finished.draft.revision, 2)
  assert.equal((await db.doc(viewPath()).get()).data().dirty, false)
  assert.equal((await db.doc(leasePath).get()).exists, false)
})

test('real Firestore: dirty events during a build are not acknowledged or overwritten', async () => {
  const db = fixture()
  const previous = await seed(db)
  const result = await rebuildPtScheduleWeeklyView({
    db, branchId: BRANCH, weekId: WEEK,
    branchData: async () => {
      await Promise.all(Array.from({ length: 3 }, () => markPtScheduleWeeklyViewDirty({ db, branchId: BRANCH, weekId: WEEK })))
      return data(2)
    },
  })
  const pending = (await db.doc(viewPath()).get()).data()
  assert.equal(result.rebuildStatus, 'superseded')
  assert.equal(pending.dirtyGeneration, 3)
  assert.equal(pending.dirty, true)
  assert.equal(pending.sourceRevision, previous.sourceRevision)
  assert.equal(pending.draft.revision, 1)
  assert.equal((await db.doc(leasePath).get()).exists, false)
  const fresh = await rebuildPtScheduleWeeklyView({ db, branchId: BRANCH, weekId: WEEK, branchData: async () => data(3) })
  assert.equal(fresh.dirtyGeneration, 3)
  assert.equal(fresh.dirty, false)
  assert.equal(fresh.draft.revision, 3)
})

test('real Firestore: legacy dirty writes without a generation are fenced by updateTime', async () => {
  const db = fixture()
  const previous = await seed(db)
  const before = await db.doc(viewPath()).get()
  const result = await rebuildPtScheduleWeeklyView({
    db, branchId: BRANCH, weekId: WEEK,
    branchData: async () => {
      await db.doc(viewPath()).set({ dirty: true, dirtyAt: FieldValue.serverTimestamp() }, { merge: true })
      return data(2)
    },
  })
  const snapshot = await db.doc(viewPath()).get()
  assert.equal(snapshot.updateTime.isEqual(before.updateTime), false)
  assert.equal(result.rebuildStatus, 'superseded')
  assert.equal(snapshot.data().dirtyGeneration, 0)
  assert.equal(snapshot.data().dirty, true)
  assert.equal(snapshot.data().sourceRevision, previous.sourceRevision)
  assert.equal((await db.doc(leasePath).get()).exists, false)
})

test('real Firestore: expired builders cannot overwrite or release a replacement lease', async () => {
  const db = fixture()
  await seed(db)
  let millis = Date.now()
  const firstEntered = deferred()
  const firstResume = deferred()
  const secondEntered = deferred()
  const secondResume = deferred()
  const first = rebuildPtScheduleWeeklyView({ db, branchId: BRANCH, weekId: WEEK, clock: () => millis, branchData: async () => { firstEntered.resolve(); await firstResume.promise; return data(2) } })
  await firstEntered.promise
  millis += 180001
  const replacement = rebuildPtScheduleWeeklyView({ db, branchId: BRANCH, weekId: WEEK, clock: () => millis, branchData: async () => { secondEntered.resolve(); await secondResume.promise; return data(3) } })
  await secondEntered.promise
  const token = (await db.doc(leasePath).get()).data().token
  firstResume.resolve()
  assert.equal((await first).rebuildStatus, 'superseded')
  assert.equal((await db.doc(leasePath).get()).data().token, token)
  secondResume.resolve()
  assert.equal((await replacement).draft.revision, 3)
  assert.equal((await db.doc(viewPath()).get()).data().draft.revision, 3)
  assert.equal((await db.doc(leasePath).get()).exists, false)
})

const sourceEvent = (before, after, params) => ({ params, data: { before: { exists: Boolean(before), data: () => before }, after: { exists: Boolean(after), data: () => after } } })

test('real Firestore: source queries cover both sides of a move and paginate beyond two hundred views', async () => {
  const db = fixture()
  const base = await seed(db)
  const batch = db.batch()
  for (let index = 0; index < 205; index += 1) {
    const branchId = `branch-${String(index).padStart(3, '0')}`
    batch.set(db.doc(viewPath(branchId)), { ...base, branchId, sourceStudentIds: ['student-a'], sourceTrainerIds: ['trainer-a'], sourceContractIds: ['contract-a'] })
  }
  batch.set(db.doc(viewPath('branch-next', '2026-10-26')), { ...base, branchId: 'branch-next', weekId: '2026-10-26' })
  await batch.commit()
  const move = await syncPtScheduleWeeklyViewSource({ db, source: 'session', logger: quiet, event: sourceEvent(
    { branchId: BRANCH, studentId: 'student-a', date: '2026-10-20' },
    { branchId: 'branch-next', studentId: 'student-a', date: '2026-10-27' }, { sessionId: 'session-a' },
  ) })
  assert.equal(move.marked, 207)
  const config = await syncPtScheduleWeeklyViewSource({ db, source: 'scheduleConfig', logger: quiet, event: sourceEvent({}, { target: 8 }, { documentId: 'scheduleConfig' }) })
  assert.equal(config.marked, 207)
  const views = await db.collection('ptScheduleWeeklyViews').get()
  assert.equal(views.size, 207)
  assert.ok(views.docs.every(snapshot => snapshot.data().dirty === true && snapshot.data().dirtyGeneration === 2))
  const contract = await syncPtScheduleWeeklyViewSource({ db, source: 'contract', logger: quiet, event: sourceEvent(
    undefined, { branchId: BRANCH, studentId: 'student-a', startDate: '2026-01-01', endDate: '2026-12-31' }, { contractId: 'contract-a' },
  ) })
  assert.equal(contract.marked, 207)
})
