import test from 'node:test'
import assert from 'node:assert/strict'
import { studentEligibilityForWeek } from '../src/domain/pt/studentEligibility'
import type { Student, StudentContract } from '../src/types'

const student = { id: 'student-a', status: 'active', branchId: 'cs1' } as Student
const contract = {
  id: 'contract-a', studentId: student.id, branchId: 'cs1', packageId: 'p1', packageName: 'Gói 3 tháng',
  status: 'active', startDate: '2026-08-24', endDate: '2026-11-24', totalSessions: 36, usedSessions: 2,
  totalPrice: 0, paidAmount: 0,
} as StudentContract

test('student active filter follows the same week, branch, quota and pause rules as scheduling', () => {
  assert.equal(studentEligibilityForWeek(student, [contract], '2026-08-24', '2026-08-24').eligible, true)
  assert.equal(studentEligibilityForWeek(student, [{ ...contract, branchId: 'cs2' }], '2026-08-24', '2026-08-24').eligible, false)
  assert.equal(studentEligibilityForWeek(student, [{ ...contract, endDate: '2026-08-23' }], '2026-08-24', '2026-08-24').eligible, false)
  assert.equal(studentEligibilityForWeek(student, [{ ...contract, usedSessions: 36 }], '2026-08-24', '2026-08-24').eligible, false)
  assert.equal(studentEligibilityForWeek(student, [{
    ...contract,
    pausePeriods: [{ requestId: 'leave-a', type: 'off', startDate: '2026-08-24', endDate: '2026-08-30', durationDays: 7 }],
  }], '2026-08-24', '2026-08-24').eligible, false)
})

test('current-week filter excludes a contract whose valid days are already in the past', () => {
  assert.equal(studentEligibilityForWeek(student, [{ ...contract, endDate: '2026-08-25' }], '2026-08-24', '2026-08-27').eligible, false)
})
