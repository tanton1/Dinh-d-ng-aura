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
  canonicalUsageSessions,
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
  assert.equal(summary.chargedNoShowSessions, 1)
  assert.equal(summary.policyChargedSessions, 1)
  assert.equal(summary.exemptSessions, 1)
  assert.equal(summary.pendingSessions, 2)
  assert.equal(summary.legacyChargedSessions, 1)
  assert.equal(sessionCountsTowardContract({ billingStatus: 'exempt', status: 'completed' }), false)
  assert.equal(sessionCountsTowardContract({ billingStatus: 'review_required', attendanceStatus: 'present', status: 'completed' }), false)
})

test('charged no-show count excludes exempt no-shows', () => {
  const summary = summarizeSessionUsage([
    { status: 'no_show', attendanceStatus: 'no_show', billingStatus: 'charged' },
    { status: 'no_show', attendanceStatus: 'no_show', billingStatus: 'exempt' },
  ])
  assert.equal(summary.noShowSessions, 2)
  assert.equal(summary.chargedNoShowSessions, 1)
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

test('contract usage counts at most one chargeable session per student per calendar day', () => {
  const rows = [
    { id: 'morning', studentId: 'student-1', contractId: 'contract-1', date: '2026-10-14', hour: 8, billingStatus: 'charged', attendanceStatus: 'present', status: 'completed' },
    { id: 'evening', studentId: 'student-1', contractId: 'contract-1', date: '2026-10-14', hour: 18, billingStatus: 'charged', attendanceStatus: 'pending', status: 'scheduled' },
    { id: 'next-day', studentId: 'student-1', contractId: 'contract-1', date: '2026-10-15', hour: 8, billingStatus: 'charged', attendanceStatus: 'present', status: 'completed' },
    { id: 'other-student', studentId: 'student-2', contractId: 'contract-1', date: '2026-10-14', hour: 8, billingStatus: 'charged', attendanceStatus: 'present', status: 'completed' },
  ]
  const summary = summarizeContractUsage({ totalSessions: 20, usedSessions: 0 }, rows)
  assert.equal(summary.rawHistorySessions, 4)
  assert.equal(summary.historySessions, 3)
  assert.equal(summary.chargedSessions, 3)
  assert.equal(summary.duplicateHistorySessions, 1)
  assert.deepEqual(summary.canonicalChargedSessionIds.sort(), ['morning', 'next-day', 'other-student'])
})

test('daily dedupe keeps malformed date rows separate and collapses schedule mirrors first', () => {
  const rows = [
    { id: 'legacy-mirror', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', date: '2026-10-14', hour: 8, scheduleEntryId: 'entry-1', billingStatus: 'charged', status: 'scheduled' },
    { id: 'branch-mirror', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', date: '2026-10-14', hour: 8, scheduleEntryId: 'entry-1', billingStatus: 'charged', attendanceStatus: 'present', status: 'completed' },
    { id: 'bad-date-a', studentId: 'student-1', contractId: 'contract-1', date: 'unknown', billingStatus: 'charged' },
    { id: 'bad-date-b', studentId: 'student-1', contractId: 'contract-1', date: 'unknown', billingStatus: 'charged' },
  ]
  const canonical = canonicalUsageSessions(rows)
  assert.deepEqual(canonical.map((row) => row.id).sort(), ['bad-date-a', 'bad-date-b', 'branch-mirror'])
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

test('Student 360 exposes callable history and explains pending contract reconciliation', () => {
  const source = readFileSync(path.join(__dirname, '..', 'src', 'features', 'student-360', 'Student360ContractWorkspace.tsx'), 'utf8')
  const history = readFileSync(path.join(__dirname, '..', 'src', 'components', 'admin', 'pt', 'TrainingHistoryPanel.tsx'), 'utf8')
  assert.match(source, /getStudent360ContractWorkspace/)
  assert.match(source, /pendingReconciliationSessions/)
  assert.match(source, /chờ đối soát/)
  assert.match(history, /listStudentTrainingHistory/)
})
