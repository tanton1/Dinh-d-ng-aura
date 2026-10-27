'use strict'

const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { applyAdminScheduleEdit } = require('./pt-schedule-admin-edit')
const { safeSchedule, scopedDraftData, draftExpiresAt } = require('./pt-schedule-v2')
const { chargeSessionTransaction } = require('./session-operations')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, 'off-confirmation-' + randomUUID())
const clients = [], WEEK = '2090-01-02', DATE = '2090-01-03', BRANCH = 'b'
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })

for (const fast of [false, true]) test('OFF booking, immutable confirmation date and concurrent billing use real atomic transactions, fast=' + fast, { timeout: 60000 }, async () => {
  const db = getFirestore(app, 'off-confirmation-' + randomUUID()); clients.push(db)
  const pausePeriods = [{ type: 'off', startDate: DATE, endDate: '2090-01-04' }]
  const rows = {
    'branches/b': { name: 'Aura', status: 'active' },
    'students/s': { name: 'Lan', status: 'active', branchId: BRANCH, sessionsPerWeek: 3 },
    'trainers/t': { name: 'Mai', status: 'active', branchId: BRANCH, slotCapacity: 2, availableSlots: ['T3-6', 'T4-6'], availabilityMode: 'configured' },
    'contracts/c': { studentId: 's', trainerId: 't', branchId: BRANCH, status: 'active', startDate: WEEK,
      endDate: '2090-12-31', totalSessions: 12, usedSessions: 0, pausePeriods },
    ['ptAvailability/s_' + WEEK]: { studentId: 's', weekId: WEEK, status: 'submitted', slots: ['T3-6', 'T4-6'] },
    ['trainerAvailability/t_' + WEEK]: { trainerId: 't', weekId: WEEK, status: 'submitted', slots: ['T3-6', 'T4-6'] },
    ['ptScheduleDrafts/b_' + WEEK]: { branchId: BRANCH, weekId: WEEK, status: 'published', revision: 1, schedule: {} },
    'settings/scheduleConfig': { workingDays: ['T2', 'T3', 'T4'], workingHours: [6], holidays: [] },
    'financePeriods/2090-01': { status: 'open' },
  }
  const batch = db.batch()
  for (const [path, value] of Object.entries(rows)) batch.set(db.doc(path), value)
  await batch.commit()
  const input = { db, actor: { uid: 'admin', accessRole: 'admin' }, branchId: BRANCH, week: WEEK,
    command: 'add_student', payload: { studentId: 's', trainerId: 't', slotId: 'T3-6', adminOverride: fast },
    reason: 'Admin xác nhận học viên tập ngày OFF', expectedRevision: 1,
    receipt: db.doc('ptScheduleAdminEditReceipts/add'), safeSchedule, scopedDraftData, draftExpiresAt }
  await assert.rejects(applyAdminScheduleEdit(input), error => error.details?.issueCode === 'CONTRACT_PAUSED')
  assert.equal((await db.collection('sessions').get()).size, 0)
  assert.equal((await input.receipt.get()).exists, false)
  const confirmed = { ...input, payload: { ...input.payload, confirmStudentOff: true } }
  const result = await applyAdminScheduleEdit(confirmed)
  assert.deepEqual(await applyAdminScheduleEdit(confirmed), result)
  const sessions = await db.collection('sessions').get()
  assert.equal(sessions.size, 1)
  const session = sessions.docs[0]
  assert.equal(session.data().studentOffConfirmedDate, DATE)
  assert.equal(session.data().adminOverrideBy, 'admin')

  await assert.rejects(applyAdminScheduleEdit({ ...input, command: 'move_student', expectedRevision: 2,
    receipt: db.doc('ptScheduleAdminEditReceipts/move'),
    payload: { studentId: 's', trainerId: 't', slotId: 'T4-6', fromSlotId: 'T3-6', fromTrainerId: 't',
      adminOverride: fast, ...(fast ? { sessionId: session.id } : {}) } }),
  error => error.details?.issueCode === 'CONTRACT_PAUSED')
  assert.equal((await session.ref.get()).data().date, DATE)
  assert.equal((await db.doc('ptScheduleDrafts/b_' + WEEK).get()).data().revision, 2)
  const charge = { db, sessionId: session.id, actorUid: 'trainer', now: new Date(DATE + 'T01:00:00Z') }
  const results = await Promise.all([chargeSessionTransaction(charge), chargeSessionTransaction(charge)])
  assert.equal(results.filter(value => value.unchanged === false).length, 1)
  const contract = (await db.doc('contracts/c').get()).data()
  assert.equal(contract.usedSessions, 1)
  assert.deepEqual(contract.pausePeriods, pausePeriods)
  assert.equal((await db.collection('sessionBillingEvents').get()).size, 1)
})
