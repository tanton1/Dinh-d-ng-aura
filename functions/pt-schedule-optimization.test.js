'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { candidateForSlot, generateSchedule } = require('./pt-schedule-v2')

const WEEK = '2026-08-24'
const BRANCH = 'branch-a'
const DAYS = ['T2', 'T3', 'T4']
const SLOTS = DAYS.map((day) => `${day}-6`)

function student(id, name, sessionsPerWeek, availableSlots = SLOTS) {
  return {
    id,
    name,
    status: 'active',
    branchId: BRANCH,
    sessionsPerWeek,
    maxWeeklySessions: sessionsPerWeek,
    availableSlots,
    availabilityStatus: 'submitted',
    validScheduleDates: DAYS.map((_, index) => `2026-08-${String(24 + index).padStart(2, '0')}`),
    eligibleForWeek: true,
  }
}

function contract(id, studentId, overrides = {}) {
  return {
    id,
    studentId,
    trainerId: 'trainer-a',
    trainerIds: [],
    branchId: BRANCH,
    status: 'active',
    startDate: WEEK,
    endDate: '2026-12-31',
    pausePeriods: [],
    totalSessions: 36,
    usedSessions: 0,
    ...overrides,
  }
}

function baseData(students, contracts, schedule = {}) {
  return {
    weekId: WEEK,
    branch: { id: BRANCH, name: 'Aura A' },
    students,
    trainers: [{
      id: 'trainer-a',
      name: 'Mai',
      status: 'active',
      branchId: BRANCH,
      availabilityMode: 'configured',
      availableSlots: SLOTS,
      slotCapacity: 1,
      employmentType: 'full_time',
    }],
    contracts,
    sessions: [],
    leaves: [],
    schedule,
    config: { workingDays: DAYS, workingHours: [6], holidays: [] },
  }
}

test('completion priority closes one weekly target when coverage and sessions tie', () => {
  const students = [
    student('student-a', 'A linh hoạt', 3),
    student('student-b', 'B cần đủ hai', 2),
  ]
  const data = baseData(students, students.map((item) => contract(`contract-${item.id}`, item.id)))
  const generated = generateSchedule(data)
  const counts = Object.values(generated.schedule).flat().reduce((result, entry) => {
    result.set(entry.studentId, (result.get(entry.studentId) || 0) + 1)
    return result
  }, new Map())
  const coverage = generated.optimizationSummary.studentCoverage

  // Three one-seat slots can cover both learners for three total sessions,
  // but A=2/B=1 leaves nobody complete. The lexicographic objective should
  // choose A=1/B=2 (or another equivalent split), not the partial tie.
  assert.equal(coverage.studentsWithAtLeastOne, 2)
  assert.equal(coverage.scheduledEntries, 3)
  assert.equal(coverage.fullyScheduledStudents, 1)
  assert.equal(counts.get('student-b'), 2)
})

test('manual, locked and published entries remain immutable during optimization', () => {
  const manual = {
    studentId: 'student-manual', trainerId: 'trainer-a', contractId: 'contract-manual',
    branchId: BRANCH, type: 'training', source: 'manual_v2',
    availabilityOverride: true, availabilityOverrideReason: 'OUTSIDE_STUDENT_AVAILABILITY',
  }
  const locked = {
    studentId: 'student-locked', trainerId: 'trainer-a', contractId: 'contract-locked',
    branchId: BRANCH, type: 'training', source: 'published_existing', isLocked: true,
  }
  const students = [
    student('student-manual', 'Manual', 1, ['T3-6']),
    student('student-locked', 'Locked', 1, ['T3-6']),
    student('student-open', 'Open', 1, ['T3-6']),
  ]
  const contracts = students.map((item) => contract(`contract-${item.id}`, item.id))
  const data = baseData(students, contracts, { 'T2-6': [manual], 'T3-6': [locked] })
  const generated = generateSchedule(data)

  assert.deepEqual(generated.schedule['T2-6'], [manual])
  assert.deepEqual(generated.schedule['T3-6'].find((entry) => entry.studentId === 'student-locked'), locked)
  assert.equal(generated.schedule['T3-6'].filter((entry) => entry.studentId === 'student-open').length, 0)
})

test('contract cache invalidates same-count schedule mutations and resolves renewal handover', () => {
  const learner = student('student-a', 'Lan', 2, ['T2-6', 'T3-6'])
  const source = contract('contract-source', learner.id, { totalSessions: 1 })
  const renewal = contract('contract-renewal', learner.id, {
    status: 'future',
    startDate: '2026-09-07',
    totalSessions: 4,
    packageSessions: 4,
    sourceContractId: source.id,
    earlyHandoverRequested: true,
  })
  const schedule = {
    // Keep one existing learner day so the candidate under test uses T3-6.
    'T2-6': [{ studentId: learner.id, trainerId: 'trainer-a', contractId: renewal.id, type: 'training' }],
  }
  const data = baseData([learner], [source, renewal], schedule)
  data.contractsByStudent = new Map([[learner.id, data.contracts]])
  const contractCache = new Map()
  const first = candidateForSlot(data, {
    student: learner,
    trainer: data.trainers[0],
    slotId: 'T3-6',
    schedule,
    contractCache,
  })
  assert.equal(first.contractId, source.id)

  // Replace only the contract reservation, preserving entry count and object
  // identity. A count-only cache key would incorrectly keep the source result
  // even though the source is now exhausted and the renewal must take over.
  schedule['T2-6'][0].contractId = source.id
  const second = candidateForSlot(data, {
    student: learner,
    trainer: data.trainers[0],
    slotId: 'T3-6',
    schedule,
    contractCache,
  })
  assert.equal(second.contractId, renewal.id)
})

test('capacity pressure reserves seats for a completable learner cohort', () => {
  const slots = ['T2-6', 'T3-6']
  const students = Array.from({ length: 4 }, (_, index) => student(`student-${index}`, `Student ${index}`, 2, slots))
  const contracts = students.map((item) => contract(`contract-${item.id}`, item.id))
  const data = baseData(students, contracts)
  data.trainers[0].availableSlots = slots
  data.trainers[0].slotCapacity = 2
  data.config.workingDays = ['T2', 'T3']

  const generated = generateSchedule(data)
  const coverage = generated.optimizationSummary.studentCoverage

  // There are four seats across the two PT slots. Coverage-first would put
  // one seat on all four learners and complete nobody; capacity-aware mode
  // should reserve two seats per learner and complete the maximum cohort.
  assert.equal(coverage.scheduledEntries, 4)
  assert.equal(coverage.studentsWithAtLeastOne, 2)
  assert.equal(coverage.fullyScheduledStudents, 2)
})

test('capacity cohort repairs mutually conflicting slot edges before committing', () => {
  const slots = ['T2-6', 'T3-6', 'T4-6', 'T5-6', 'T6-6', 'T7-6']
  const dates = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29']
  const availability = [
    ['student-a', 'A', ['T2-6', 'T3-6']],
    ['student-b', 'B', ['T2-6', 'T3-6']],
    ['student-c', 'C', ['T4-6', 'T5-6']],
    ['student-d', 'D', ['T6-6', 'T7-6']],
  ]
  const students = availability.map(([id, name, availableSlots]) => ({
    ...student(id, name, 2, availableSlots),
    validScheduleDates: availableSlots.map((slotId) => dates[slots.indexOf(slotId)]),
  }))
  const contracts = students.map((item) => contract(`contract-${item.id}`, item.id))
  const data = baseData(students, contracts)
  data.trainers[0].availableSlots = slots
  data.trainers[0].slotCapacity = 1
  data.config.workingDays = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7']

  const generated = generateSchedule(data)
  const coverage = generated.optimizationSummary.studentCoverage

  // A/B compete for the same two seats while C and D have disjoint slots.
  // The optimistic six-seat budget must repair the initial A/B/C cohort to
  // retain three complete learners (C/D plus either A or B).
  assert.equal(coverage.scheduledEntries, 6)
  assert.equal(coverage.fullyScheduledStudents, 3)
  assert.equal(coverage.studentsWithAtLeastOne, 3)
})

test('capacity-aware score does not restore an older coverage-only draft', () => {
  const slots = ['T2-6', 'T3-6']
  const students = Array.from({ length: 4 }, (_, index) => student(`student-${index}`, `Student ${index}`, 2, slots))
  const contracts = students.map((item) => contract(`contract-${item.id}`, item.id))
  const data = baseData(students, contracts, {
    'T2-6': [0, 1].map((index) => ({ studentId: `student-${index}`, trainerId: 'trainer-a', contractId: `contract-student-${index}`, branchId: BRANCH, type: 'training', source: 'auto_v4' })),
    'T3-6': [2, 3].map((index) => ({ studentId: `student-${index}`, trainerId: 'trainer-a', contractId: `contract-student-${index}`, branchId: BRANCH, type: 'training', source: 'auto_v4' })),
  })
  data.trainers[0].availableSlots = slots
  data.trainers[0].slotCapacity = 2
  data.config.workingDays = ['T2', 'T3']

  const generated = generateSchedule(data)
  assert.equal(generated.optimizationSummary.comparison.before.covered, 4)
  assert.equal(generated.optimizationSummary.comparison.after.complete, 2)
  assert.equal(generated.optimizationSummary.studentCoverage.fullyScheduledStudents, 2)
})

test('coverage-first remains unchanged when every feasible learner fits one seat', () => {
  const slots = ['T2-6', 'T3-6']
  const students = Array.from({ length: 3 }, (_, index) => student(`student-${index}`, `Student ${index}`, 1, slots))
  const contracts = students.map((item) => contract(`contract-${item.id}`, item.id))
  const data = baseData(students, contracts)
  data.trainers[0].availableSlots = slots
  data.trainers[0].slotCapacity = 2
  data.config.workingDays = ['T2', 'T3']

  const generated = generateSchedule(data)
  const coverage = generated.optimizationSummary.studentCoverage
  assert.equal(coverage.studentsWithAtLeastOne, 3)
  assert.equal(coverage.fullyScheduledStudents, 3)
})
