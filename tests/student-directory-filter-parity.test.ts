import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { studentEligibilityForWeek } from '../src/domain/pt/studentEligibility'
import { filterStudentDirectory, type StudentDirectoryFilters } from '../src/domain/pt/studentDirectoryFilters'
import type { Student, StudentContract } from '../src/types'

const require = createRequire(import.meta.url)
const { directoryWeekEligibility, directoryMatches } = require('../functions/student-directory-admin.js')
const student = { id: 'a', name: 'Student A', phone: '0900123456', status: 'active', branchId: 'a', joinDate: '2026-10-24' } as Student
const base = { id: 'c', studentId: 'a', branchId: 'a', status: 'active', startDate: '2026-10-01', endDate: '2026-12-31', totalSessions: 24, usedSessions: 0, trainerId: 'pt', nutritionPTIds: ['coach'] } as StudentContract
const week = '2026-10-26', today = '2026-10-30'
const cases: StudentContract[][] = [[], [base], [{ ...base, status: 'frozen' }], [{ ...base, status: 'cancelled' }], [{ ...base, branchId: 'b' }], [{ ...base, startDate: '2026-11-05' }], [{ ...base, usedSessions: 24 }], [{ ...base, endDate: '2026-10-01', status: 'expired' }],
  [{ ...base, pausePeriods: [{ requestId: 'off', type: 'off', startDate: '2026-10-26', endDate: '2026-11-01', durationDays: 7 }] }],
  [{ ...base, usedSessions: 24 }, { ...base, id: 'renewal', status: 'future', sourceContractId: 'c', handoverStatus: 'pending', packageSessions: 36, totalSessions: 36, startDate: '2027-01-01', endDate: '2027-03-31' }],
  [{ ...base, usedSessions: 24 }, { ...base, id: 'renewal', status: 'future', sourceContractId: 'c', activationMode: 'fixed_date', packageSessions: 36, totalSessions: 36, startDate: '2027-01-01', endDate: '2027-03-31' }],
]

test('canonical admin directory weekly eligibility remains in parity with the legacy frontend contract-chain rules', () => {
  for (const contracts of cases) for (const profile of [student, { ...student, status: 'inactive' as const }]) {
    const expected = studentEligibilityForWeek(profile, contracts, week, today)
    const actual = directoryWeekEligibility(profile, contracts, week, today)
    assert.deepEqual(actual, expected)
  }
})

test('canonical admin directory status, PT, nutrition, join-date predicates match frontend filters', () => {
  for (const contracts of cases) for (const status of ['all', 'active', 'paused', 'cancelled', 'inactive', 'expired', 'expiring_week', 'expiring_month'] as const) {
    for (const trainerId of ['all', 'pt', 'none']) {
      const eligibility = studentEligibilityForWeek(student, contracts, week, today)
      const filters: StudentDirectoryFilters = { search: '', branchId: 'all', trainerId, nutritionPTId: 'all', contractStatus: status, dateRange: { start: new Date('2026-10-01T12:00:00'), end: new Date('2026-10-31T12:00:00') } }
      const expected = filterStudentDirectory({ students: [student], contractsByStudent: new Map([['a', contracts]]), eligibilityByStudent: new Map([['a', eligibility]]) }, filters, new Date('2026-10-30T12:00:00+07:00')).length > 0
      const actual = directoryMatches(student, contracts, directoryWeekEligibility(student, contracts, week, today), null, { query: '', branchId: '', trainerId: trainerId === 'all' ? '' : trainerId, nutritionPTId: '', attention: '', contractStatus: status, joinedFrom: '2026-10-01', joinedTo: '2026-10-31', referenceDate: today, weekId: week })
      assert.equal(actual, expected, `${status}/${trainerId}/${JSON.stringify(contracts)}`)
    }
  }
})
