'use strict'

const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { loadBranchData, loadManualMutationData, generateSchedule, safeSchedule, scopedDraftData, draftExpiresAt } = require('./pt-schedule-v2')
const { createPtSchedulePublishFunctions } = require('./pt-schedule-publish')
const { applyAdminScheduleEdit } = require('./pt-schedule-admin-edit')
const { createSessionOperationFunctions } = require('./session-operations')
const { createPtOperationsV2Functions } = require('./pt-operations-v2')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `trainer-inheritance-${randomUUID()}`)
const clients = [], WEEK = '2090-01-02', PRIOR = '2089-12-26'
after(async () => { await Promise.all(clients.map((db) => db.terminate())); await deleteApp(app) })

async function fixture() {
  const db = getFirestore(app, `trainer-inheritance-${randomUUID()}`)
  clients.push(db)
  const rows = {
    'users/manager': { displayName: 'Manager', role: 'manager' },
    'roleAssignments/manager': { accessRole: 'staff', positions: ['branch_manager'], branchIds: ['b'], status: 'active', authzVersion: 1 },
    'branches/b': { name: 'Aura', status: 'active' },
    'students/s': { name: 'Lan', status: 'active', branchId: 'b', sessionsPerWeek: 2, isScheduleConfirmed: true, availableSlots: ['T2-6', 'T3-6', 'T4-6'] },
    'trainers/t': { name: 'Mai', status: 'active', branchId: 'b', slotCapacity: 2, availableSlots: ['T2-6'], availabilityMode: 'configured' },
    'contracts/c': { studentId: 's', trainerId: 't', branchId: 'b', status: 'active', startDate: WEEK, endDate: '2090-12-31', totalSessions: 24, usedSessions: 0 },
    [`ptAvailability/s_${WEEK}`]: { studentId: 's', weekId: WEEK, status: 'submitted', slots: ['T2-6', 'T3-6', 'T4-6'] },
    'trainerAvailability/t_2089-12-19': { trainerId: 't', weekId: '2089-12-19', status: 'submitted', slots: ['T2-6'], revision: 9 },
    [`trainerAvailability/t_${PRIOR}`]: { trainerId: 't', weekId: PRIOR, status: 'submitted', slots: ['T3-6', 'T4-6'], offDates: [PRIOR], revision: 2 },
    'trainerAvailability/t_2090-01-09': { trainerId: 't', weekId: '2090-01-09', status: 'submitted', slots: ['T5-6'], revision: 4 },
    [`ptScheduleDrafts/b_${WEEK}`]: { branchId: 'b', weekId: WEEK, status: 'draft', revision: 1, schedule: {} },
    'settings/scheduleConfig': { workingDays: ['T2', 'T3', 'T4', 'T5'], workingHours: [6], holidays: [] },
  }
  const batch = db.batch()
  for (const [path, value] of Object.entries(rows)) batch.set(db.doc(path), value)
  await batch.commit()
  return db
}

test('PT screen, both matrix readers, candidate reader and optimizer agree on nearest prior hours', async () => {
  const db = await fixture()
  const api = createPtOperationsV2Functions({ db, onCall: (...args) => args.at(-1), availabilityAccessResolver: async () => ({ uid: 't', accessRole: 'staff', capabilities: ['pt.availability.self.manage'], branchIds: ['b'] }) })
  const screen = await api.getMyTrainerAvailability({ data: { weekId: WEEK } })
  assert.deepEqual(screen.availableSlots, ['T3-6', 'T4-6'])
  assert.equal(screen.sourceWeekId, PRIOR)
  assert.equal(screen.availabilityRevision, 0)
  assert.deepEqual(screen.offDates, [])
  for (const initialPaint of [true, false]) {
    const data = await loadBranchData(db, 'b', WEEK, { forceRefresh: true, initialPaint })
    assert.deepEqual(data.trainers[0].availableSlots, screen.availableSlots)
    assert.equal(data.trainers[0].availabilitySource, 'inherited_weekly')
    assert.equal(data.trainers[0].availabilitySourceWeekId, PRIOR)
    if (!initialPaint) {
      const generated = generateSchedule({ ...data, weekId: WEEK }).schedule
      assert.deepEqual(Object.keys(generated).sort(), ['T3-6', 'T4-6'])
    }
  }
  const manual = await loadManualMutationData(db, 'b', WEEK, 't', 's')
  assert.deepEqual(manual.trainers[0].availableSlots, screen.availableSlots)
  const sessions = createSessionOperationFunctions({ db, onCall: (handler) => handler,
    authorizeStudent: async () => ({ uid: 's' }), now: () => new Date('2090-01-01T00:00:00Z') })
  const choices = await sessions.getMyAdditionalSessionSuggestions({ data: {} })
  assert.deepEqual(choices.suggestions.filter((choice) => choice.date < '2090-01-09').map((choice) => choice.date).sort(), ['2090-01-03', '2090-01-04'])
  const registered = await sessions.createMyAdditionalSessionRequest({ data: { candidateId: choices.suggestions[0].candidateId, reason: 'Đăng ký thêm buổi theo lịch tuần kế thừa.', idempotencyKey: 'inheritance-test' } })
  assert.equal(registered.status, 'pending')
  assert.equal((await db.doc(`trainerAvailability/t_${WEEK}`).get()).exists, false, 'reading fallback never registers a week')
})

test('publish rechecks inherited hours inside its transaction and an explicit empty target week overrides them', async () => {
  const db = await fixture()
  const draft = db.doc(`ptScheduleDrafts/b_${WEEK}`)
  await draft.update({ schedule: { 'T3-6': [{ studentId: 's', trainerId: 't', contractId: 'c', branchId: 'b', type: 'training', source: 'manual_v2' }] } })
  const api = createPtSchedulePublishFunctions({ db, onCall: (handler) => handler })
  const request = { auth: { uid: 'manager', token: { accessRole: 'staff', authzVersion: 1 } }, data: { weekId: WEEK, branchId: 'b', expectedDraftRevision: 1 } }
  const valid = await api.validatePtScheduleDraft(request)
  assert.equal(valid.validateOnly, true)
  assert.equal(valid.diff.create, 1)
  await db.doc(`trainerAvailability/t_${PRIOR}`).update({ slots: ['T4-6'], revision: 3 })
  await assert.rejects(api.validatePtScheduleDraft(request), (error) => error.details?.errors?.includes('OUTSIDE_TRAINER_AVAILABILITY'))
  await db.doc(`trainerAvailability/t_${WEEK}`).set({ trainerId: 't', weekId: WEEK, status: 'submitted', slots: [], offDates: [WEEK], revision: 1 })
  await assert.rejects(api.validatePtScheduleDraft(request), (error) => error.details?.issueCode === 'SCHEDULE_VALIDATION_FAILED')
  assert.equal((await db.collection('sessions').get()).size, 0)
  await db.doc(`trainerAvailability/t_${WEEK}`).update({ slots: ['T3-6'], offDates: [], revision: 2 })
  const published = await api.publishPtSchedule(request)
  assert.equal(published.diff.create, 1)
  assert.equal((await db.collection('sessions').get()).size, 1)
})

test('manual admin edit uses inherited hours and warns when choosing an old recurring-only hour', async () => {
  const db = await fixture()
  await db.doc(`ptScheduleDrafts/b_${WEEK}`).update({ status: 'published' })
  const input = { db, actor: { uid: 'admin', accessRole: 'admin' }, branchId: 'b', week: WEEK,
    command: 'add_student', payload: { studentId: 's', trainerId: 't', slotId: 'T3-6' }, reason: 'Test availability inheritance', expectedRevision: 1,
    receipt: db.doc('ptScheduleAdminEditReceipts/add'), safeSchedule, scopedDraftData, draftExpiresAt }
  const result = await applyAdminScheduleEdit(input)
  assert.ok(!result.warnings.includes('OUTSIDE_TRAINER_AVAILABILITY'))
  const outside = await applyAdminScheduleEdit({ ...input, expectedRevision: 2, receipt: db.doc('ptScheduleAdminEditReceipts/outside'), payload: { ...input.payload, slotId: 'T2-6' } })
  assert.ok(outside.warnings.includes('OUTSIDE_TRAINER_AVAILABILITY'))
})

test('session approval observes changed prior-week availability before creating a new session', async () => {
  const db = await fixture()
  await db.doc('sessionRequests/add').set({ status: 'pending', type: 'additional', requestedBy: 'trainer', revision: 0,
    studentId: 's', contractId: 'c', trainerId: 't', newTrainerId: 't', newBranchId: 'b', newDate: '2090-01-03', newHour: 6 })
  const api = createSessionOperationFunctions({ db, onCall: (handler) => handler, authorizeAdmin: async () => ({ uid: 'admin', accessRole: 'admin' }), now: () => new Date('2090-01-01T00:00:00Z') })
  await db.doc(`trainerAvailability/t_${PRIOR}`).update({ slots: ['T4-6'], revision: 3 })
  await assert.rejects(api.approveSessionRequest({ data: { requestId: 'add', expectedSessionRevision: 0 } }), (error) => error.code === 'failed-precondition' && error.message.includes('lịch rảnh PT'))
  assert.equal((await db.doc('sessionRequests/add').get()).data().status, 'pending')
  assert.equal((await db.collection('sessions').get()).size, 0)
  await db.doc(`trainerAvailability/t_${PRIOR}`).update({ slots: ['T3-6'], revision: 4 })
  const result = await api.approveSessionRequest({ data: { requestId: 'add', expectedSessionRevision: 0 } })
  assert.equal(result.status, 'approved')
  assert.equal((await db.collection('sessions').get()).size, 1)
})
