'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const { actionDocument, actionId, canViewAction, contractActionInputs, hasThreeConsecutiveNoShows, isVisibleToActor, redactedAction, scheduleDraftActionInputs, syncOperationalActionSource, upsertOperationalAction } = require('./action-center')

const functionsSource = readFileSync(join(__dirname, 'index.js'), 'utf8')
const nutritionMaintenanceSource = readFileSync(join(__dirname, 'nutrition-review-maintenance.js'), 'utf8')

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
  assert.match(functionsSource, /const operationalActionTrigger = \(document\) => onDocumentWritten\(\{[\s\S]*?cpu: 0\.25,[\s\S]*?concurrency: 1,[\s\S]*?maxInstances: 1,[\s\S]*?retry: true/)
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
  assert.match(functionsSource, /collection\('operationalActions'\)[\s\S]*?where\('status', '==', 'snoozed'\)[\s\S]*?where\('snoozedUntil', '<=', now\)[\s\S]*?limit\(200\)/)
  assert.match(functionsSource, /refreshMealReviewActions/)
  assert.match(nutritionMaintenanceSource, /collection\('mealReviews'\)[\s\S]*?where\('status', '==', 'pending'\)[\s\S]*?limit\(200\)/)
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

test('repeated action reconciliation skips writes and preserves the last meaningful update time', async () => {
  const input = {
    sourceType: 'student', sourceId: 's1', actionType: 'missing_schedule',
    title: 'Thiếu lịch', allowedRoles: ['trainer_pt'], assignedStaffIds: ['u1'],
  }
  const existing = { ...actionDocument(input), createdAt: 'created', updatedAt: 'meaningful-update' }
  let writes = 0
  const db = { doc: () => ({
    get: async () => ({ exists: true, data: () => existing }),
    set: async () => { writes += 1 },
  }) }
  const result = await upsertOperationalAction({ db, input })
  assert.equal(writes, 0)
  assert.equal(result.updatedAt, 'meaningful-update')
})

test('unchanged action refresh preserves claimed, snoozed and manually resolved lifecycle without writes', async () => {
  const input = {
    sourceType: 'student', sourceId: 's1', actionType: 'missing_schedule',
    title: 'Thiếu lịch', allowedRoles: ['trainer_pt'], assignedStaffIds: ['u1'],
  }
  const { Timestamp } = require('firebase-admin/firestore')
  for (const lifecycle of [
    { status: 'in_progress', assignedUid: 'staff-1', claimedAt: 'claimed' },
    { status: 'snoozed', snoozedUntil: Timestamp.fromMillis(Date.now() + 60_000) },
    { status: 'resolved', resolvedAt: 'resolved', resolvedBy: 'staff-1', resolution: 'Đã xử lý' },
  ]) {
    const existing = { ...actionDocument(input), createdAt: 'created', updatedAt: 'last-update', ...lifecycle }
    const db = { doc: () => ({
      get: async () => ({ exists: true, data: () => existing }),
      set: async () => { throw new Error('Unchanged action must not write') },
    }) }
    const result = await upsertOperationalAction({ db, input })
    for (const [field, value] of Object.entries(lifecycle)) assert.deepEqual(result[field], value)
  }
})

test('action reconciliation still writes changed assignments and severity', async () => {
  const input = {
    sourceType: 'student', sourceId: 's1', actionType: 'missing_schedule',
    title: 'Thiếu lịch', allowedRoles: ['trainer_pt'], assignedStaffIds: ['u1'],
  }
  const existing = { ...actionDocument(input), createdAt: 'created', updatedAt: 'last-update' }
  for (const change of [{ assignedStaffIds: ['u2'] }, { severity: 'critical' }]) {
    let written = null
    const db = { doc: () => ({
      get: async () => ({ exists: true, data: () => existing }),
      set: async (payload) => { written = payload },
    }) }
    await upsertOperationalAction({ db, input: { ...input, ...change }, logger: {} })
    for (const [field, value] of Object.entries(change)) assert.deepEqual(written[field], value)
  }
})

test('Firestore timestamp normalization does not turn an unchanged contract due date into a write', async () => {
  const { Timestamp } = require('firebase-admin/firestore')
  const dueAt = new Date('2026-11-01T00:00:00+07:00')
  const input = { sourceType: 'contract', sourceId: 'c1', actionType: 'renewal_due', dueAt }
  const existing = { ...actionDocument(input), dueAt: Timestamp.fromDate(dueAt), createdAt: 'created', updatedAt: 'last-update' }
  let writes = 0
  const db = { doc: () => ({
    get: async () => ({ exists: true, data: () => existing }),
    set: async () => { writes += 1 },
  }) }
  await upsertOperationalAction({ db, input, logger: {} })
  assert.equal(writes, 0)
  await upsertOperationalAction({ db, input: { ...input, dueAt: new Date(dueAt.getTime() + 86_400_000) }, logger: {} })
  assert.equal(writes, 1)
})

test('closed source skips assignment lookups but resolves its stale operational action', async () => {
  let written = null
  const db = {
    doc: () => { throw new Error('Closed source must not read assignment documents') },
    collection: (name) => {
      assert.equal(name, 'operationalActions')
      const query = {
        where: () => query, limit: () => query,
        get: async () => ({ docs: [{
          id: 'session_request:r1:review',
          data: () => ({ sourceType: 'session_request', actionType: 'review', status: 'open' }),
          ref: { set: async (payload) => { written = payload } },
        }] }),
      }
      return query
    },
  }
  const value = { studentId: 's1', userId: 'u1', status: 'approved' }
  const snapshot = { exists: true, ref: { parent: { id: 'sessionRequests' } }, data: () => value }
  const result = await syncOperationalActionSource({ db, event: { params: { requestId: 'r1' }, data: { before: snapshot, after: snapshot } } })
  assert.equal(result.actions, 0)
  assert.equal(written.status, 'resolved')
  assert.equal(written.resolution, 'source_no_longer_actionable')
})

test('active action still enriches canonical and legacy staff assignments', async () => {
  let written = null
  const contractQueries = []
  const value = { studentId: 's1', status: 'pending', trainerId: 'request-trainer' }
  const db = {
    doc: (path) => ({
      get: async () => path === 'students/s1'
        ? { exists: true, data: () => ({ branchId: 'b1', trainerId: 'student-trainer' }) }
        : { exists: false },
      set: async (payload) => { written = payload },
    }),
    collection: (name) => {
      const query = {
        where: (field) => { if (name === 'contracts') contractQueries.push(field); return query },
        limit: () => query,
        get: async () => ({ docs: name === 'contracts' ? [{ id: 'c1', data: () => ({ status: 'active', assignedSalesId: 'sales-1' }) }] : [] }),
      }
      return query
    },
  }
  const snapshot = { exists: true, ref: { parent: { id: 'sessionRequests' } }, data: () => value }
  await syncOperationalActionSource({ db, event: { params: { requestId: 'r1' }, data: { after: snapshot } }, logger: {} })
  assert.deepEqual(contractQueries, ['studentId', 'crmProfileId'])
  assert.equal(written.branchId, 'b1')
  assert.ok(written.assignedStaffIds.includes('request-trainer'))
  assert.ok(written.assignedStaffIds.includes('student-trainer'))
  assert.ok(written.assignedStaffIds.includes('sales-1'))
})
