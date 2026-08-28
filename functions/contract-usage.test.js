'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const {
  sessionCountsTowardContract,
  summarizeSessionUsage,
  summarizeContractUsage,
  sessionUsageTransition,
} = require('./contract-usage')

test('canonical usage counts explicit charges and compatible legacy history exactly once', () => {
  const sessions = [
    { id: 'present', billingStatus: 'charged', attendanceStatus: 'present', status: 'scheduled' },
    { id: 'late', billingStatus: 'charged', attendanceStatus: 'late', status: 'scheduled' },
    { id: 'no-show', billingStatus: 'charged', attendanceStatus: 'no_show', status: 'no_show' },
    { id: 'legacy', status: 'completed' },
    { id: 'policy', billingStatus: 'charged', attendanceStatus: 'policy_charge', status: 'student_cancelled' },
    { id: 'exempt', billingStatus: 'exempt', status: 'completed' },
    { id: 'pending', billingStatus: 'pending', status: 'scheduled' },
    { id: 'review', billingStatus: 'review_required', attendanceStatus: 'present', status: 'completed' },
  ]
  const summary = summarizeSessionUsage(sessions)
  assert.equal(summary.chargedSessions, 5)
  assert.equal(summary.attendedSessions, 5)
  assert.equal(summary.presentSessions, 4)
  assert.equal(summary.lateSessions, 1)
  assert.equal(summary.noShowSessions, 1)
  assert.equal(summary.policyChargedSessions, 1)
  assert.equal(summary.exemptSessions, 1)
  assert.equal(summary.pendingSessions, 2)
  assert.equal(summary.legacyChargedSessions, 1)
  assert.equal(sessionCountsTowardContract({ billingStatus: 'exempt', status: 'completed' }), false)
  assert.equal(sessionCountsTowardContract({ billingStatus: 'review_required', attendanceStatus: 'present', status: 'completed' }), false)
})

test('contract summary exposes legacy projection delta without inventing attendance', () => {
  const summary = summarizeContractUsage({ totalSessions: 36, usedSessions: 20 }, [
    ...Array.from({ length: 17 }, (_, index) => ({ id: `charged-${index}`, billingStatus: 'charged', attendanceStatus: 'present' })),
    { id: 'exempt', billingStatus: 'exempt', status: 'student_cancelled' },
  ])
  assert.equal(summary.chargedSessions, 17)
  assert.equal(summary.legacyProjectionAdjustment, 3)
  assert.equal(summary.usedSessions, 20)
  assert.equal(summary.remainingSessions, 16)
  assert.equal(summary.reconciliationStatus, 'legacy_projection')
})

test('charged session waiting for trainer confirmation stays visible in its own bucket', () => {
  const summary = summarizeSessionUsage([
    { billingStatus: 'charged', attendanceStatus: 'pending', status: 'scheduled' },
    { billingStatus: 'charged', attendanceStatus: 'present', status: 'scheduled' },
  ])
  assert.equal(summary.chargedSessions, 2)
  assert.equal(summary.attendedSessions, 1)
  assert.equal(summary.chargedPendingAttendanceSessions, 1)
  assert.equal(
    summary.attendedSessions
      + summary.noShowSessions
      + summary.policyChargedSessions
      + summary.chargedPendingAttendanceSessions,
    summary.chargedSessions,
  )
})

test('linked session evidence immediately repairs a projection that is behind', () => {
  const summary = summarizeContractUsage({ totalSessions: 12, usedSessions: 1 }, [
    { billingStatus: 'charged', attendanceStatus: 'present' },
    { billingStatus: 'charged', attendanceStatus: 'no_show' },
  ])
  assert.equal(summary.usedSessions, 2)
  assert.equal(summary.remainingSessions, 10)
  assert.equal(summary.reconciliationStatus, 'projection_behind')
})

test('session usage transition only changes projection when charge membership changes', () => {
  assert.deepEqual(sessionUsageTransition(
    { contractId: 'contract-a', billingStatus: 'pending', status: 'scheduled' },
    { contractId: 'contract-a', billingStatus: 'charged', status: 'scheduled' },
  ), { removeContractIds: [], addContractIds: ['contract-a'] })
  assert.deepEqual(sessionUsageTransition(
    { contractId: 'contract-a', billingStatus: 'charged' },
    { contractId: 'contract-b', billingStatus: 'charged' },
  ), { removeContractIds: ['contract-a'], addContractIds: ['contract-b'] })
  assert.deepEqual(sessionUsageTransition(
    { contractId: 'contract-a', billingStatus: 'charged', attendanceStatus: 'pending' },
    { contractId: 'contract-a', billingStatus: 'charged', attendanceStatus: 'present' },
  ), { removeContractIds: [], addContractIds: [] })
  assert.deepEqual(sessionUsageTransition(
    { contractId: 'contract-a', billingStatus: 'charged' },
    { contractId: 'contract-a', billingStatus: 'exempt' },
  ), { removeContractIds: ['contract-a'], addContractIds: [] })
})

test('exact history projection contract remains the terminal projection source', () => {
  const source = require('node:fs').readFileSync(require.resolve('./contract-usage'), 'utf8')
  assert.match(source, /usageReconciliationVersion \|\| 0\) >= 4/)
  assert.match(source, /usageReconciledFrom === 'pt-contract-history-exact-v1'/)
  assert.match(source, /historyEvidenceSessions: afterUsed/)
  assert.match(source, /afterUsed > safeCount\(contract\.totalSessions\) \? 'over_entitlement' : 'matched'/)
})

test('student detail always exposes callable history and explains charged attendance pending', () => {
  const source = readFileSync(path.join(__dirname, '..', 'src', 'components', 'admin', 'pt', 'StudentDetail.tsx'), 'utf8')
  assert.match(source, /id: 'history'.+visible: true/)
  assert.match(source, /chargedPendingAttendanceSessions/)
  assert.match(source, />Chờ PT</)
})
