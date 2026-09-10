'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  CONTRACT_USAGE_FIELDS,
  SESSION_USAGE_FIELDS,
  affectedContractIds,
  contractUsageViewNeedsRebuild,
  contractVisibleToActor,
  contractWithUsageView,
  usageSourceChanged,
  usageSummaryFromView,
  usageViewFingerprint,
  viewFromSummary,
} = require('./contract-usage-view')

test('contract usage view preserves canonical summary and legacy adjustment', () => {
  const view = viewFromSummary('contract-1', { studentId: 'student-1' }, {
    totalSessions: 36,
    attendedSessions: 12,
    noShowSessions: 1,
    chargedNoShowSessions: 1,
    exemptSessions: 2,
    pendingSessions: 3,
    legacyProjectionAdjustment: 4,
    remainingSessions: 19,
    usedSessions: 17,
    chargedSessions: 16,
    projectionDelta: 4,
    reconciliationStatus: 'legacy_projection',
  })
  assert.equal(view.contractId, 'contract-1')
  assert.equal(view.studentId, 'student-1')
  assert.equal(view.legacyProjectionAdjustment, 4)
  assert.equal(view.chargedNoShowSessions, 1)
  assert.equal(view.remainingSessions, 19)
  assert.equal(view.sourceVersion, 'contract-usage-v2')
})

test('contract usage view does not invent a student identity', () => {
  const view = viewFromSummary('contract-2', {}, {
    totalSessions: 0,
    attendedSessions: 0,
    noShowSessions: 0,
    chargedNoShowSessions: 0,
    exemptSessions: 0,
    pendingSessions: 0,
    legacyProjectionAdjustment: 0,
    remainingSessions: 0,
    usedSessions: 0,
    chargedSessions: 0,
    projectionDelta: 0,
    reconciliationStatus: 'matched',
  })
  assert.equal(view.studentId, null)
})

test('canonical usage view adapts to the legacy workspace shape without recomputing', () => {
  const usage = usageSummaryFromView({
    entitlementSessions: 24,
    historySessions: 11,
    storedUsedSessions: 9,
    chargedSessions: 8,
    attendedSessions: 7,
    noShowSessions: 1,
    chargedNoShowSessions: 1,
    exemptSessions: 1,
    pendingReconciliationSessions: 1,
    legacyProjectionAdjustment: 1,
    usedSessions: 9,
    remainingSessions: 15,
    projectionDelta: 1,
    reconciliationStatus: 'legacy_projection',
    sourceVersion: 'contract-usage-v2',
  })
  assert.equal(usage.totalSessions, 24)
  assert.equal(usage.usedSessions, 9)
  assert.equal(usage.remainingSessions, 15)
  assert.equal(usage.legacyProjectionAdjustment, 1)
  assert.equal(usage.chargedNoShowSessions, 1)
  assert.equal(usage.sourceVersion, 'contract-usage-v2')
})

test('canonical usage overlay preserves contract fields and replaces only usage facts', () => {
  const merged = contractWithUsageView({ id: 'c1', packageName: 'Aura PT', totalSessions: 20, usedSessions: 3 }, {
    entitlementSessions: 20,
    usedSessions: 7,
    remainingSessions: 13,
    legacyProjectionAdjustment: 2,
    reconciliationStatus: 'legacy_projection',
    sourceVersion: 'contract-usage-v2',
  })
  assert.equal(merged.packageName, 'Aura PT')
  assert.equal(merged.usedSessions, 7)
  assert.equal(merged.remainingSessions, 13)
  assert.equal(merged.contractUsageSourceVersion, 'contract-usage-v2')
})

test('contract usage scope follows assignment or branch management instead of dashboard access', () => {
  const contract = { branchId: 'b1', trainerIds: ['trainer-crm'], nutritionPTIds: ['coach-auth'], assignedSalesId: 'sales-auth' }
  assert.equal(contractVisibleToActor(contract, { accessRole: 'staff', uid: 'trainer-auth', legacyStaffId: 'trainer-crm', branchIds: ['b1'], capabilities: ['pt.students.assigned.view'] }), true)
  assert.equal(contractVisibleToActor(contract, { accessRole: 'staff', uid: 'other', branchIds: ['b1'], capabilities: ['dashboard.view'] }), false)
  assert.equal(contractVisibleToActor(contract, { accessRole: 'staff', uid: 'manager', branchIds: ['b1'], capabilities: ['branch.operations.view'] }), true)
  assert.equal(contractVisibleToActor(contract, { accessRole: 'staff', uid: 'manager', branchIds: ['b2'], capabilities: ['branch.operations.view'] }), false)
})

test('usage view fingerprint ignores freshness metadata but detects business changes', () => {
  const baseline = { schemaVersion: 1, contractId: 'c1', remainingSessions: 7, generatedAt: '2026-09-10T00:00:00.000Z' }
  assert.equal(
    usageViewFingerprint(baseline),
    usageViewFingerprint({ ...baseline, generatedAt: '2026-09-11T00:00:00.000Z', projectionChanged: false }),
  )
  assert.notEqual(usageViewFingerprint(baseline), usageViewFingerprint({ ...baseline, remainingSessions: 6 }))
})

test('session updates rebuild usage only when usage fields change', () => {
  const before = { contractId: 'c1', status: 'scheduled', billingStatus: 'pending', attendanceStatus: 'pending', note: 'old' }
  assert.equal(usageSourceChanged(before, { ...before, note: 'new', revision: 2 }, SESSION_USAGE_FIELDS), false)
  assert.equal(usageSourceChanged(before, { ...before, attendanceStatus: 'present' }, SESSION_USAGE_FIELDS), true)
  assert.equal(usageSourceChanged(before, { ...before, contractId: 'c2' }, SESSION_USAGE_FIELDS), true)
})

test('pending session edits do not scan contract history until charge membership changes', () => {
  const pending = { contractId: 'c1', status: 'scheduled', billingStatus: 'pending', attendanceStatus: 'pending' }
  assert.deepEqual(affectedContractIds(null, pending), [])
  assert.deepEqual(affectedContractIds(pending, { ...pending, attendanceStatus: 'present' }), [])
  assert.deepEqual(affectedContractIds(pending, { ...pending, billingStatus: 'charged' }), ['c1'])
  assert.deepEqual(affectedContractIds({ ...pending, billingStatus: 'charged' }, { ...pending, contractId: 'c2', billingStatus: 'charged' }), ['c1', 'c2'])
})

test('contract updates rebuild usage only for canonical usage and identity facts', () => {
  const before = { studentId: 's1', totalSessions: 24, usedSessions: 7, status: 'active', note: 'old' }
  assert.equal(usageSourceChanged(before, { ...before, note: 'new' }, CONTRACT_USAGE_FIELDS), false)
  assert.equal(usageSourceChanged(before, { ...before, totalSessions: 36 }, CONTRACT_USAGE_FIELDS), true)
})

test('scheduled reconciliation skips a fresh matching projection', () => {
  const now = Date.parse('2026-09-10T12:00:00.000Z')
  const contract = { studentId: 's1', totalSessions: 24, usedSessions: 7 }
  const matching = {
    schemaVersion: 1,
    studentId: 's1',
    entitlementSessions: 24,
    storedUsedSessions: 7,
    generatedAt: '2026-09-10T11:00:00.000Z',
  }
  assert.equal(contractUsageViewNeedsRebuild(contract, matching, now), false)
  assert.equal(contractUsageViewNeedsRebuild(contract, { ...matching, storedUsedSessions: 6 }, now), true)
  assert.equal(contractUsageViewNeedsRebuild(contract, { ...matching, generatedAt: '2026-09-01T00:00:00.000Z' }, now), true)
})
