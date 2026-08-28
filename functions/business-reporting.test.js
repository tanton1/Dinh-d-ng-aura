'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const {
  normaliseBusinessRange,
  normaliseHistoryInput,
  summaryFromLedger,
  teachingShiftSummary,
} = require('./business-reporting')

const source = readFileSync(join(__dirname, 'business-reporting.js'), 'utf8')

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
  assert.match(source, /trustedAccessContext/)
  assert.match(source, /assertHistoryAccess/)
  assert.match(source, /pt\.operations\.manage/)
  assert.match(source, /pt\.students\.assigned\.view/)
  assert.match(source, /where\(ownerField, '==', subjectId\)/)
  assert.match(source, /orderBy\('date', 'desc'\).*orderBy\(FieldPath\.documentId\(\), 'desc'\)/s)
  assert.match(source, /MAX_HISTORY_PAGE = 100/)
  assert.match(source, /MAX_ATTENDANCE_DOCUMENTS = 10000/)
  assert.match(source, /unrecognisedAttendanceEvents/)
  assert.match(source, /Aura không tự suy diễn số còn thiếu/)
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
