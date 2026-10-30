import test from 'node:test'
import assert from 'node:assert/strict'
import { studentEligibilityForWeek } from '../src/domain/pt/studentEligibility'
import { isContractSchedulableOn } from '../src/utils/scheduler'
import type { Student, StudentContract } from '../src/types'
import { filterStudentDirectory, type StudentDirectoryFilters } from '../src/domain/pt/studentDirectoryFilters'

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

test('a future renewal is eligible on the concrete days it becomes effective', () => {
  const result = studentEligibilityForWeek(student, [{
    ...contract,
    status: 'future',
    startDate: '2026-08-29',
    endDate: '2026-11-29',
  }], '2026-08-24', '2026-08-27')
  assert.equal(result.eligible, true)
  assert.deepEqual(result.validDates, ['2026-08-29', '2026-08-30'])
})

test('automatic continuation keeps an exhausted learner eligible before the planned start, but fixed dates and preservation still block', () => {
  const exhausted = { ...contract, usedSessions: 36, renewedByContractId: 'renewal' }
  const renewal: StudentContract = {
    ...contract, id: 'renewal', status: 'future', sourceContractId: contract.id,
    handoverStatus: 'pending', activationMode: 'automatic', startDate: '2026-11-25', endDate: '2027-02-25',
    signedDate: '2026-08-24', packageSessions: 12, totalSessions: 17, plannedCarryOverSessions: 5, usedSessions: 0,
  }
  const automatic = studentEligibilityForWeek(student, [exhausted, renewal], '2026-08-24', '2026-08-24')
  assert.equal(automatic.eligible, true)
  assert.equal(automatic.remainingSessions, 12, 'projected carry-over is not spendable')
  assert.equal(studentEligibilityForWeek(student, [exhausted, { ...renewal, activationMode: 'fixed_date' }], '2026-08-24', '2026-08-24').eligible, false)
  assert.equal(studentEligibilityForWeek(student, [{ ...exhausted, status: 'frozen' }, renewal], '2026-08-24', '2026-08-24').eligible, false)
})

test('scheduler checks the concrete slot date and never activates a renewal early', () => {
  const renewal = { ...contract, status: 'future', startDate: '2026-08-27', endDate: '2026-11-27' }
  assert.equal(isContractSchedulableOn(renewal, '2026-08-26'), false)
  assert.equal(isContractSchedulableOn(renewal, '2026-08-27'), true)
  assert.equal(isContractSchedulableOn({ ...renewal, status: 'frozen' }, '2026-08-27'), false)
  assert.equal(isContractSchedulableOn({ ...renewal, pausePeriods: [{ type: 'preservation', startDate: '2026-08-27', endDate: '2026-08-28' }] }, '2026-08-27'), false)
})

const directoryNow = new Date('2026-10-30T12:00:00')
const directoryFilters: StudentDirectoryFilters = {
  search: '', branchId: 'all', trainerId: 'all', nutritionPTId: 'all', contractStatus: 'all', dateRange: null,
}
function directoryStudent(id: string, overrides: Partial<Student> = {}): Student {
  return { ...student, id, name: id, phone: '0900000000', joinDate: '2026-10-30', ...overrides }
}
function directoryContract(studentId: string, overrides: Partial<StudentContract> = {}): StudentContract {
  return { ...contract, id: `contract-${studentId}`, studentId, startDate: '2026-09-01', endDate: '2026-12-31', usedSessions: 0, ...overrides }
}
function directorySources(students: Student[], contracts: StudentContract[] = []) {
  const contractsByStudent = new Map(students.map((entry) => [entry.id, contracts.filter((item) => item.studentId === entry.id).sort((left, right) => right.startDate.localeCompare(left.startDate))]))
  return {
    students,
    contractsByStudent,
    eligibilityByStudent: new Map(students.map((entry) => [entry.id, studentEligibilityForWeek(entry, contractsByStudent.get(entry.id) || [], '2026-10-26', '2026-10-30')])),
  }
}

test('explicit status filters include inactive, cancelled, frozen and long-expired learners without training history', () => {
  const students = [directoryStudent('current'), directoryStudent('left', { status: 'inactive' }), directoryStudent('cancelled'), directoryStudent('frozen'), directoryStudent('expired'), directoryStudent('empty')]
  const sources = directorySources(students, [
    directoryContract('current'),
    directoryContract('cancelled', { status: 'cancelled', endDate: '2026-09-10' }),
    directoryContract('frozen', { status: 'frozen' }),
    directoryContract('expired', { status: 'expired', endDate: '2026-09-10' }),
  ])
  assert.deepEqual(filterStudentDirectory(sources, directoryFilters, directoryNow).map((entry) => entry.id), students.map((entry) => entry.id), 'all statuses includes the complete authorized roster')
  for (const [contractStatus, expected] of [['inactive', 'left'], ['cancelled', 'cancelled'], ['paused', 'frozen'], ['expired', 'expired'], ['active', 'current']] as const) {
    assert.deepEqual(filterStudentDirectory(sources, { ...directoryFilters, contractStatus }, directoryNow).map((entry) => entry.id), [expected])
  }
})

test('all statuses and all time retain every authorized learner across pages, including unknown join dates', () => {
  const students = Array.from({ length: 137 }, (_, index) => directoryStudent(`all-${index + 1}`, { status: index % 2 ? 'inactive' : 'active' }))
  students[135].joinDate = undefined
  students[136].joinDate = 'invalid'
  const sources = directorySources(students)
  const filters = { ...directoryFilters, dateRange: { start: new Date(0), end: new Date(8640000000000000) } }
  const filtered = filterStudentDirectory(sources, filters, directoryNow)
  assert.deepEqual(filtered.map((entry) => entry.id), students.map((entry) => entry.id))
  const pages = Array.from({ length: Math.ceil(filtered.length / 30) }, (_, index) => filtered.slice(index * 30, (index + 1) * 30))
  assert.deepEqual(pages.map((page) => page.length), [30, 30, 30, 30, 17])
  assert.deepEqual(pages.at(-1)?.slice(-2).map((entry) => entry.id), ['all-136', 'all-137'])
})

test('date filtering examines the full roster before pagination, including more than 100 learners with no contracts', () => {
  const matching = Array.from({ length: 137 }, (_, index) => directoryStudent(`new-${index + 1}`))
  const sources = directorySources([...matching, directoryStudent('outside', { joinDate: '2026-10-29' }), directoryStudent('unknown', { joinDate: undefined })])
  const filtered = filterStudentDirectory(sources, { ...directoryFilters, dateRange: { start: new Date(2026, 9, 30), end: new Date(2026, 9, 30, 23, 59, 59, 999) } }, directoryNow)
  assert.deepEqual(filtered.map((entry) => entry.id), matching.map((entry) => entry.id))
  const pages = Array.from({ length: Math.ceil(filtered.length / 30) }, (_, index) => filtered.slice(index * 30, (index + 1) * 30))
  assert.deepEqual(pages.map((page) => page.length), [30, 30, 30, 30, 17])
  assert.equal(pages.at(-1)?.at(-1)?.id, 'new-137')
})

test('status, join-date, search and branch filters intersect without dropping matching historical profiles', () => {
  const sources = directorySources([
    directoryStudent('wanted', { name: 'Aura historical', status: 'inactive' }),
    directoryStudent('wrong-date', { name: 'Aura historical', status: 'inactive', joinDate: '2026-09-01' }),
    directoryStudent('wrong-branch', { name: 'Aura historical', status: 'inactive', branchId: 'cs2' }),
    directoryStudent('wrong-status', { name: 'Aura historical' }),
    directoryStudent('wrong-name', { status: 'inactive' }),
  ])
  const result = filterStudentDirectory(sources, {
    ...directoryFilters, search: '  AURA  ', branchId: 'cs1', contractStatus: 'inactive',
    dateRange: { start: new Date(2026, 9, 1), end: new Date(2026, 9, 31, 23, 59, 59, 999) },
  }, directoryNow)
  assert.deepEqual(result.map((entry) => entry.id), ['wanted'])
})

test('all-time status filtering retains students with missing or invalid join dates', () => {
  const sources = directorySources([
    directoryStudent('unknown', { status: 'inactive', joinDate: undefined }),
    directoryStudent('legacy', { status: 'inactive', joinDate: 'invalid' }),
  ])
  const result = filterStudentDirectory(sources, { ...directoryFilters, contractStatus: 'inactive', dateRange: { start: new Date(0), end: new Date(8640000000000000) } }, directoryNow)
  assert.deepEqual(result.map((entry) => entry.id), ['unknown', 'legacy'])
})

test('a calendar filter excludes impossible stored join dates instead of matching them lexically', () => {
  const sources = directorySources([directoryStudent('valid', { joinDate: '2026-02-28' }), directoryStudent('invalid', { joinDate: '2026-02-31' })])
  const result = filterStudentDirectory(sources, { ...directoryFilters, dateRange: { start: new Date(2026, 1, 1), end: new Date(2026, 2, 1, 23, 59, 59, 999) } }, directoryNow)
  assert.deepEqual(result.map((entry) => entry.id), ['valid'])
})

test('date-only join dates remain on the selected day in browser time zones west of UTC', () => {
  const previousTimezone = process.env.TZ
  try {
    process.env.TZ = 'America/Los_Angeles'
    const sources = directorySources([directoryStudent('selected-day'), directoryStudent('previous-day', { joinDate: '2026-10-29' }), directoryStudent('next-day', { joinDate: '2026-10-31' })])
    const result = filterStudentDirectory(sources, { ...directoryFilters, dateRange: { start: new Date(2026, 9, 30), end: new Date(2026, 9, 30, 23, 59, 59, 999) } }, directoryNow)
    assert.deepEqual(result.map((entry) => entry.id), ['selected-day'])
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ
    else process.env.TZ = previousTimezone
  }
})
