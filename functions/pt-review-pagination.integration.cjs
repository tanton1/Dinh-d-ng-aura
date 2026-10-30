'use strict'

const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { test, after } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { createSessionFeedbackFunctions } = require('./session-feedback')
const { createPerformanceScoreFunctions } = require('./performance-score')
const { loadOperationalSources, renewalMetrics } = require('./performance-automatic')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `pt-reviews-${randomUUID()}`)
const clients = []
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })
const adminRequest = data => ({ auth: { uid: 'admin', token: { role: 'admin' } }, data })
const onCall = (_options, handler) => handler
async function fixture(rows = {}) {
  const db = getFirestore(app, `pt-reviews-${randomUUID()}`); clients.push(db)
  const entries = Object.entries({ 'users/admin': { role: 'admin', name: 'Synthetic admin' }, ...rows })
  for (let offset = 0; offset < entries.length; offset += 400) {
    const batch = db.batch()
    for (const [path, value] of entries.slice(offset, offset + 400)) batch.set(db.doc(path), value)
    await batch.commit()
  }
  return db
}

test('real Firestore quality filters before caps, counts one scoped session, and continues descending dates/IDs', async () => {
  const feedback = (sessionId, extra = {}) => ({ sessionId, trainerId: 'pt_a', branchId: 'branch_a', studentId: `student_${sessionId}`, sessionDate: '2026-10-31', submittedAt: new Date('2026-11-01T08:00:00+07:00'), overallScore: 5, status: 'submitted', ...extra })
  const rows = Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`sessionFeedback/other_${index}`, feedback(`other_${index}`, { trainerId: 'pt_b' })]))
  const db = await fixture({ ...rows,
    'sessionFeedback/a': feedback('a'), 'sessionFeedback/b': feedback('b', { overallScore: 2, status: 'needs_review' }),
    'sessionFeedback/previous_month': feedback('old', { sessionDate: '2026-09-30', submittedAt: new Date('2026-10-01') }),
    'attendanceEvents/a': { sessionId: 'a', trainerId: 'pt_a', branchId: 'branch_a', scheduledAt: new Date('2026-10-31T09:00:00+07:00'), attendanceStatus: 'present' },
    'attendanceEvents/b': { sessionId: 'b', trainerId: 'pt_a', branchId: 'branch_a', scheduledAt: new Date('2026-10-31T10:00:00+07:00'), attendanceStatus: 'late' },
    'attendanceEvents/other': { sessionId: 'other', trainerId: 'pt_b', branchId: 'branch_b', scheduledAt: new Date('2026-10-31T10:00:00+07:00'), attendanceStatus: 'present' },
  })
  const api = createSessionFeedbackFunctions({ db, onCall })
  const input = { from: '2026-10-01', to: '2026-10-31', trainerId: 'pt_a', branchId: 'branch_a', pageSize: 1 }
  const first = await api.listTrainerFeedbackAdmin(adminRequest(input))
  assert.equal(first.summary.responseRate, 100)
  assert.equal(first.summary.eligibleAttendanceCount, 2)
  assert.deepEqual(first.rows.map(row => row.id), ['b'])
  const second = await api.listTrainerFeedbackAdmin(adminRequest({ ...input, cursor: first.nextCursor, includeSummary: false }))
  assert.deepEqual(second.rows.map(row => row.id), ['a'])
  assert.equal(second.hasMore, false)
  assert.equal(second.summaryIncluded, false)
  const review = await api.listTrainerFeedbackAdmin(adminRequest({ ...input, status: 'needs_review', score: 2 }))
  assert.equal(review.summary.total, 1)
  assert.equal(review.summary.responseRate, 100)
  await assert.rejects(api.listTrainerFeedbackAdmin(adminRequest({ ...input, trainerId: 'pt_b', cursor: first.nextCursor })), { code: 'invalid-argument' })
})

test('real Firestore Performance pages scope before caps and fetch selected checklist independently', async () => {
  const evidence = (extra = {}) => ({ periodId: '2026-10', staffId: 'pt_a', branchIds: ['branch_a'], type: 'personal_content', status: 'submitted', submittedAt: new Date(), ...extra })
  const rows = Object.fromEntries(Array.from({ length: 205 }, (_, index) => [`performanceEvidence/other_${index}`, evidence({ branchIds: ['branch_b'] })]))
  const db = await fixture({ ...rows,
    'users/manager': { role: 'manager', name: 'Synthetic manager', branchId: 'branch_a' },
    'performanceEvidence/a': evidence(), 'performanceEvidence/b': evidence({ type: 'aura_assignment', status: 'approved' }),
    'performanceEvidence/profile_202610_pt_a': evidence({ type: 'profile_checklist', status: 'approved', checklist: { bio: true } }),
    'roleAssignments/pt_account': { accessRole: 'staff', status: 'active', crmProfileId: 'pt_a', positions: ['trainer_pt'], branchIds: ['branch_a'] },
  })
  const api = createPerformanceScoreFunctions({ db, onCall, storage: null })
  const input = { periodId: '2026-10', branchId: 'branch_a', pageSize: 1, includeDirectory: false }
  const first = await api.listPerformanceReviewQueue(adminRequest(input))
  const second = await api.listPerformanceReviewQueue(adminRequest({ ...input, cursor: first.nextCursor }))
  assert.deepEqual([...first.rows, ...second.rows].map(row => row.id), ['a', 'b'])
  assert.equal(second.hasMore, false)
  assert.equal(first.profiles[0].checklist.bio, true)
  const profile = await api.listPerformanceReviewQueue(adminRequest({ ...input, profileStaffId: 'pt_a', includeQueue: false }))
  assert.equal(profile.profiles[0].staffId, 'pt_a')
  const manager = { auth: { uid: 'manager', token: { role: 'manager' } }, data: { periodId: '2026-10' } }
  assert.deepEqual((await api.listPerformanceReviewQueue(manager)).rows.map(row => row.id), ['a', 'b'])
  await assert.rejects(api.listPerformanceReviewQueue({ ...manager, data: { ...manager.data, branchId: 'branch_b' } }), { code: 'permission-denied' })
  await assert.rejects(api.listPerformanceReviewQueue({ ...manager, data: { ...manager.data, cursor: first.nextCursor } }), { code: 'invalid-argument' })
})

test('real Firestore renewal streams include due rows without closure timestamps and closed rows outside due month', async () => {
  const db = await fixture({
    'contractRenewalCases/due': { contractSnapshot: { trainerId: 'pt_a', endDate: '2026-09-30' }, stage: 'contacting', expectedValue: 100 },
    'contractRenewalCases/won': { contractSnapshot: { trainerId: 'pt_a', endDate: '2026-08-30' }, stage: 'won', wonAt: new Date('2026-09-02T12:00:00+07:00'), collectedValue: 50, expectedValue: 100 },
    'contractRenewalCases/lost': { contractSnapshot: { trainerIds: ['pt_a'], endDate: '2026-10-30' }, stage: 'lost', updatedAt: new Date('2026-09-03T12:00:00+07:00'), lostReason: 'Chuyển nơi ở', expectedValue: 100 },
    'contractRenewalCases/history': { contractSnapshot: { trainerId: 'pt_a', endDate: '2025-08-30' }, stage: 'won', wonAt: new Date('2025-09-02') },
  })
  const source = await loadOperationalSources(db, { staffId: 'pt_a', ownerUid: 'pt_a' }, '2026-09')
  assert.deepEqual(source.renewalCases.map(row => row.id).sort(), ['due', 'lost', 'won'])
  assert.deepEqual(source.warnings, [])
  const metrics = renewalMetrics(source)
  assert.equal(metrics.renew_rate.actual, 50)
  assert.equal(metrics.renewal_process.denominator, 3)
})
