'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const { actionId, canViewAction, contractActionInputs, hasThreeConsecutiveNoShows, isVisibleToActor, redactedAction, scheduleDraftActionInputs, upsertOperationalAction } = require('./action-center')

const functionsSource = readFileSync(join(__dirname, 'index.js'), 'utf8')

test('action ids are deterministic and source scoped', () => {
  assert.equal(actionId('contract', 'c1', 'renewal_due'), 'contract:c1:renewal_due')
})

test('contract actions expose operational reasons without financial amounts', () => {
  const rows = contractActionInputs('c1', {
    studentId: 's1', branchId: 'b1', status: 'active', endDate: '2026-09-20', totalSessions: 12, usedSessions: 12, totalPrice: 1000000, paidAmount: 0,
  }, new Date('2026-09-09T00:00:00Z'))
  assert.ok(rows.some((row) => row.actionType === 'sessions_exhausted'))
  assert.ok(rows.some((row) => row.actionType === 'renewal_due'))
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0], 'totalPrice'), false)
})

test('expired contracts produce a critical action without exposing debt amounts', () => {
  const rows = contractActionInputs('expired', { studentId: 's1', status: 'active', endDate: '2026-09-01', totalSessions: 10, usedSessions: 2 }, new Date('2026-09-09T00:00:00Z'))
  assert.equal(rows.find((row) => row.actionType === 'expired')?.severity, 'critical')
})

test('contract debt becomes actionable only when its due date is overdue', () => {
  const current = { studentId: 's1', status: 'active', endDate: '2026-12-01', totalSessions: 10, usedSessions: 2, totalPrice: 1_000_000, paidAmount: 0 }
  assert.equal(contractActionInputs('not-due', { ...current, nextPaymentDate: '2026-09-20' }, new Date('2026-09-09T00:00:00Z')).some((row) => row.actionType === 'payment_overdue'), false)
  assert.equal(contractActionInputs('past-due', { ...current, nextPaymentDate: '2026-09-08' }, new Date('2026-09-09T00:00:00Z')).some((row) => row.actionType === 'payment_overdue'), true)
})

test('three no-show alert ignores future and non-terminal schedule rows', () => {
  assert.equal(hasThreeConsecutiveNoShows([
    { id: 'future', date: '2026-09-12', status: 'scheduled' },
    { id: 'n3', date: '2026-09-08', attendanceStatus: 'no_show' },
    { id: 'n2', date: '2026-09-06', status: 'no_show' },
    { id: 'n1', date: '2026-09-04', status: 'absent' },
  ]), true)
  assert.equal(hasThreeConsecutiveNoShows([
    { id: 'n3', date: '2026-09-08', status: 'no_show' },
    { id: 'present', date: '2026-09-06', attendanceStatus: 'present' },
    { id: 'n2', date: '2026-09-04', status: 'no_show' },
    { id: 'n1', date: '2026-09-02', status: 'no_show' },
  ]), false)
})

test('contract usage mismatch becomes a data-quality action', () => {
  const rows = contractActionInputs('mismatch', {
    studentId: 's1', status: 'active', endDate: '2027-01-01', totalSessions: 10, usedSessions: 4,
    contractUsageReconciliationStatus: 'projection_behind',
  }, new Date('2026-09-09T00:00:00Z'))
  assert.equal(rows.find((row) => row.actionType === 'usage_mismatch')?.severity, 'warning')
})

test('schedule draft creates one deterministic action per unassigned learner and prioritizes business blockers', () => {
  const studentValues = new Map([['student-a', { branchId: 'b1', trainerId: 'trainer-a' }]])
  const rows = scheduleDraftActionInputs('b1_2026-09-07', {
    branchId: 'b1',
    unassignedEntries: [
      { studentId: 'student-a', missingSessions: 1, blockerCategory: 'optimizer', primaryReasonCode: 'OPTIMIZER_GAP' },
      { studentId: 'student-a', missingSessions: 1, blockerCategory: 'contract', primaryReasonCode: 'CONTRACT_SESSION_QUOTA_EXCEEDED' },
      { studentId: 'student-b', missingSessions: 1, blockerCategory: 'learner_availability', primaryReasonCode: 'AVAILABILITY_NOT_SUBMITTED' },
    ],
  }, studentValues)
  assert.equal(rows.length, 2)
  const contract = rows.find((row) => row.studentId === 'student-a')
  assert.equal(contract.actionType, scheduleDraftActionInputs('b1_2026-09-07', { unassignedEntries: [{ studentId: 'student-a' }] })[0].actionType)
  assert.equal(contract.severity, 'critical')
  assert.equal(contract.assignedStaffIds[0], 'trainer-a')
  assert.ok(contract.availableActions.includes('open_contract'))
  const availability = rows.find((row) => row.studentId === 'student-b')
  assert.equal(availability.title, 'Học viên chưa đủ lịch đăng ký')
  assert.equal(Object.prototype.hasOwnProperty.call(availability, 'studentName'), false)
})

test('action visibility is scoped by role and branch', () => {
  const action = { branchId: 'b1', allowedRoles: ['trainer_pt'], assignedUid: null }
  assert.equal(isVisibleToActor(action, { accessRole: 'staff', positions: ['trainer_pt'], branchIds: ['b1'], uid: 'u1' }), true)
  assert.equal(isVisibleToActor(action, { accessRole: 'staff', positions: ['trainer_pt'], branchIds: ['b2'], uid: 'u1' }), false)
})

test('learner actions require an explicit staff assignment outside Admin and branch management', () => {
  const action = { branchId: 'b1', allowedRoles: ['staff', 'trainer_pt'], assignedUid: null, assignedStaffIds: ['trainer-crm'] }
  assert.equal(canViewAction(action, { accessRole: 'staff', positions: ['trainer_pt'], branchIds: ['b1'], uid: 'trainer-auth', legacyStaffId: 'trainer-crm' }), true)
  assert.equal(canViewAction(action, { accessRole: 'staff', positions: ['trainer_pt'], branchIds: ['b1'], uid: 'other', legacyStaffId: 'other-crm' }), false)
  assert.equal(canViewAction(action, { accessRole: 'staff', positions: ['branch_manager'], branchIds: ['b1'], uid: 'manager' }), true)
  assert.equal(canViewAction({ ...action, branchId: null }, { accessRole: 'staff', positions: ['branch_manager'], branchIds: ['b1'], uid: 'manager' }), false)
})

test('Action Center and contract usage maintenance exports stay deployable and bounded', () => {
  assert.match(functionsSource, /const \{ FieldPath, FieldValue, Timestamp, getFirestore \}/)
  assert.match(functionsSource, /const operationalActionTrigger = \(document\) => onDocumentWritten\(\{[\s\S]*?cpu: 'gcf_gen1',[\s\S]*?maxInstances: 1,[\s\S]*?retry: true/)
  for (const exportName of [
    'syncContractOperationalActions',
    'syncContractUsageOperationalActions',
    'syncSessionRequestOperationalActions',
    'syncMealReviewOperationalActions',
    'syncSessionOperationalActions',
    'syncStudentOperationalActions',
    'syncStudent360OperationalActions',
    'syncScheduleDraftOperationalActions',
    'syncRenewalOperationalActions',
  ]) assert.match(functionsSource, new RegExp(`exports\\.${exportName} = operationalActionTrigger`))
  assert.match(functionsSource, /systemJobs\/contractUsageViewReconciliation/)
  assert.match(functionsSource, /collection\('contracts'\)\.orderBy\(FieldPath\.documentId\(\)\)\.limit\(25\)/)
  assert.match(functionsSource, /collection\('operationalActions'\)\.where\('status', '==', 'snoozed'\)\.limit\(200\)/)
})

test('redaction returns only safe operational fields', () => {
  const output = redactedAction({ actionId: 'contract:c1:payment_overdue', sourceType: 'contract', sourceId: 'c1', actionType: 'payment_overdue', branchId: 'b1', studentId: 's1', severity: 'warning', status: 'open', title: 'Công nợ', redactedSummary: 'Cần liên hệ', totalPrice: 1000000, allowedRoles: ['admin'] }, { accessRole: 'admin', positions: [], branchIds: [], uid: 'a1' })
  assert.equal(output.totalPrice, undefined)
  assert.equal(output.redactedSummary, 'Cần liên hệ')
})

test('source refresh preserves a manually resolved action lifecycle', async () => {
  let written = null
  const existing = {
    actionId: 'student:s1:missing_schedule', sourceType: 'student', sourceId: 's1', actionType: 'missing_schedule',
    status: 'resolved', resolution: 'Đã gọi học viên', resolvedBy: 'u1', resolvedAt: 'now', createdAt: 'before',
  }
  const db = {
    doc: () => ({
      get: async () => ({ exists: true, data: () => existing }),
      set: async (value) => { written = value },
    }),
  }
  await upsertOperationalAction({ db, input: {
    sourceType: 'student', sourceId: 's1', actionType: 'missing_schedule', status: 'open',
    title: 'Thiếu lịch', allowedRoles: ['trainer_pt'], assignedStaffIds: ['u1'],
  }, logger: { info: () => undefined } })
  assert.equal(written.status, 'resolved')
  assert.equal(written.resolution, 'Đã gọi học viên')
  assert.equal(written.resolvedBy, 'u1')
})

test('a resolved recurring action reopens only after its source closed and recurred', async () => {
  let written = null
  const existing = {
    actionId: 'student:s1:missing_schedule', sourceType: 'student', sourceId: 's1', actionType: 'missing_schedule',
    status: 'resolved', resolution: 'Đã xử lý', resolvedBy: 'u1', resolvedAt: 'before', sourceClosedAt: 'closed', createdAt: 'created',
  }
  const db = {
    doc: () => ({
      get: async () => ({ exists: true, data: () => existing }),
      set: async (value) => { written = value },
    }),
  }
  await upsertOperationalAction({ db, input: {
    sourceType: 'student', sourceId: 's1', actionType: 'missing_schedule', status: 'open',
    title: 'Thiếu lịch', allowedRoles: ['trainer_pt'], assignedStaffIds: ['u1'],
  }, logger: { info: () => undefined } })
  assert.equal(written.status, 'open')
  assert.equal(written.resolution, null)
  assert.equal(written.sourceClosedAt, null)
})
