'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const {
  normaliseBusinessRange,
  normaliseHistoryInput,
  canonicalHistoryRows,
  canonicalStudentHistoryRows,
  summaryFromLedger,
  teachingShiftSummary,
} = require('./business-reporting')

const source = readFileSync(join(__dirname, 'business-reporting.js'), 'utf8')
const indexSource = readFileSync(join(__dirname, 'index.js'), 'utf8')

test('business reporting keeps legacy handlers and exposes bounded asia-east1 overflow aliases', () => {
  const endpointNames = [
    'listBusinessPerformance',
    'listStudentTrainingHistory',
    'listTrainerTeachingHistory',
    'getStudentContractUsage',
  ]
  for (const name of endpointNames) {
    assert.match(indexSource, new RegExp(`exports\\.${name} = businessReportingFunctions\\.${name}`))
    assert.match(indexSource, new RegExp(`exports\\.${name}Regional = businessReportingOverflowFunctions\\.${name}`))
  }
  const overflowBlock = indexSource.match(
    /const businessReportingOverflowOnCall =[\s\S]*?const businessReportingOverflowFunctions =/,
  )?.[0] || ''
  assert.match(overflowBlock, /region: 'asia-east1'/)
  assert.match(overflowBlock, /cpu: 'gcf_gen1'/)
  assert.match(overflowBlock, /concurrency: 1/)
  assert.match(overflowBlock, /maxInstances: 2/)
  assert.match(overflowBlock, /timeoutSeconds: 120/)
})

test('business P&L separates cash collection from recognised revenue', () => {
  const input = normaliseBusinessRange({ startDate: '2026-08-01', endDate: '2026-08-31' })
  const summary = summaryFromLedger([
    { type: 'payment', source: 'pt_gym', status: 'posted', amount: 1_000_000, cashImpact: 1_000_000, revenueImpact: 0, effectiveAt: new Date('2026-08-10T05:00:00Z') },
    { type: 'revenue_recognition', source: 'pt_gym', status: 'posted', amount: 200_000, cashImpact: 0, revenueImpact: 200_000, expenseImpact: 0, effectiveAt: new Date('2026-08-10T05:00:00Z') },
    { type: 'expense', source: 'other', status: 'posted', amount: -50_000, cashImpact: -50_000, expenseImpact: 50_000, effectiveAt: new Date('2026-08-11T05:00:00Z') },
  ], input)
  assert.equal(summary.cashIn, 1_000_000)
  assert.equal(summary.cashOut, 50_000)
  assert.equal(summary.cashNet, 950_000)
  assert.equal(summary.recognisedRevenue, 200_000)
  assert.equal(summary.operatingExpense, 50_000)
  assert.equal(summary.operatingResult, 150_000)
})

test('business report and training history retain bounded filters and actor-scoped access', () => {
  assert.throws(() => normaliseBusinessRange({ startDate: '2026-01-01', endDate: '2027-01-10' }), /tối đa/)
  assert.throws(() => normaliseHistoryInput({ startDate: '2025-01-01', endDate: '2026-08-20' }), /tối đa/)
  const allTime = normaliseHistoryInput({ allTime: true, startDate: '1900-01-01', endDate: '2026-08-20', pageSize: 100 })
  assert.equal(allTime.allTime, true)
  assert.equal(allTime.pageSize, 100)
  assert.match(source, /trustedAccessContext/)
  assert.match(source, /assertHistoryAccess/)
  assert.match(source, /pt\.operations\.manage/)
  assert.match(source, /pt\.students\.assigned\.view/)
  assert.match(source, /trainer_scheduled_student/)
  assert.match(source, /where\('trainerId', '==', actorId\)/)
  assert.match(source, /where\(ownerField, '==', subjectId\)/)
  assert.match(source, /canonicalHistoryRows\(scannedPageDocuments\)/)
  assert.match(source, /canonicalHistoryRows\(summarySnapshot\.docs/)
  assert.match(source, /orderBy\('date', 'desc'\).*orderBy\(FieldPath\.documentId\(\), 'desc'\)/s)
  assert.match(source, /MAX_HISTORY_PAGE = 100/)
  assert.match(source, /MAX_ATTENDANCE_DOCUMENTS = 10000/)
  assert.match(source, /getStudentContractUsage/)
  assert.match(source, /summarizeSessionUsage\(summaryRecords\)/)
  assert.match(source, /billingStatus: typeof item\.billingStatus/)
  assert.match(source, /filters: \{ startDate: input\.allTime \? ''/)
  assert.match(source, /formulaVersion: 'contract-usage-v2'/)
  assert.match(source, /unrecognisedAttendanceEvents/)
  assert.match(source, /Aura không tự suy diễn số còn thiếu/)
})

test('student history collapses an exempt cancellation mirror into its charged no-show', () => {
  const rows = canonicalHistoryRows([
    {
      id: 'cancelled-mirror',
      studentId: 'student-1',
      trainerId: 'trainer-1',
      contractId: 'contract-1',
      scheduleEntryId: 'schedule-week-T6-20-student-1',
      date: '2026-10-16',
      hour: 20,
      status: 'cancelled',
      billingStatus: 'exempt',
    },
    {
      id: 'attendance-no-show',
      studentId: 'student-1',
      trainerId: 'trainer-1',
      contractId: 'contract-1',
      scheduleEntryId: 'schedule-week-T6-20-student-1',
      date: '2026-10-16',
      hour: 20,
      status: 'no_show',
      billingStatus: 'charged',
      attendanceStatus: 'no_show',
    },
  ])
  assert.deepEqual(rows.map((item) => item.id), ['attendance-no-show'])
})

test('student history uses the same one-session-per-day canonical usage rule as contract quota', () => {
  const rows = [
    { id: 'morning-mirror', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', scheduleEntryId: 'entry-1', date: '2026-10-16', hour: 17, status: 'completed', billingStatus: 'charged', attendanceStatus: 'present' },
    { id: 'evening', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', scheduleEntryId: 'entry-2', date: '2026-10-16', hour: 18, status: 'completed', billingStatus: 'charged', attendanceStatus: 'present' },
    { id: 'next-day', studentId: 'student-1', trainerId: 'trainer-1', contractId: 'contract-1', scheduleEntryId: 'entry-3', date: '2026-10-17', hour: 17, status: 'completed', billingStatus: 'charged', attendanceStatus: 'present' },
  ]
  const canonical = canonicalStudentHistoryRows(rows)
  assert.equal(canonical.length, 2)
  assert.deepEqual(canonical.map((item) => item.date).sort(), ['2026-10-16', '2026-10-17'])
})

test('trainer teaching history counts a paired class as one teaching shift', () => {
  const summary = teachingShiftSummary([
    { id: 'session-a', trainerId: 'trainer-1', studentId: 'student-a', branchId: 'branch-1', date: '2026-08-28', hour: 18 },
    { id: 'session-b', trainerId: 'trainer-1', studentId: 'student-b', branchId: 'branch-1', date: '2026-08-28', hour: 18 },
    { id: 'session-c', trainerId: 'trainer-1', studentId: 'student-c', branchId: 'branch-1', date: '2026-08-28', hour: 19 },
    { id: 'session-d', trainerId: 'trainer-1', studentId: 'student-d', branchId: 'branch-2', date: '2026-08-28', hour: 18 },
  ])
  assert.deepEqual(summary, {
    totalShifts: 2,
    pairedShifts: 1,
    learnerBookings: 4,
    maxLearnersPerShift: 3,
  })
})
