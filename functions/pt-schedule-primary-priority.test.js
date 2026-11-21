'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { compactPairedSlots, generateSchedule } = require('./pt-schedule-v2')

const WEEK = '2026-08-24'
const BRANCH = 'branch-a'
const MODES = ['optimize', 'continue', 'supplement']

function student(id = 'learner', overrides = {}) {
  return {
    id, name: id, status: 'active', branchId: BRANCH,
    sessionsPerWeek: 1, maxWeeklySessions: 7,
    availableSlots: ['T2-6'], availabilityStatus: 'submitted', eligibleForWeek: true,
    ...overrides,
  }
}

function trainer(id, overrides = {}) {
  return {
    id, name: id, status: 'active', branchId: BRANCH,
    availabilityMode: 'configured', availableSlots: ['T2-6'], slotCapacity: 2,
    employmentType: 'full_time', dailySessionTarget: 8, schedulingPriority: 100,
    ...overrides,
  }
}

function contract(studentId, trainerId = '', trainerIds = []) {
  return {
    id: `contract-${studentId}`, studentId, trainerId, trainerIds, branchId: BRANCH,
    status: 'active', startDate: WEEK, endDate: '2026-12-31', pausePeriods: [],
    totalSessions: 36, usedSessions: 0,
  }
}

function entry(studentId, trainerId, overrides = {}) {
  return {
    studentId, trainerId, contractId: `contract-${studentId}`, branchId: BRANCH,
    type: 'training', source: 'auto_v4', ...overrides,
  }
}

function fixture(generationMode = 'optimize') {
  return {
    weekId: WEEK, branch: { id: BRANCH, name: 'Aura A' }, generationMode,
    students: [student()],
    trainers: [trainer('primary'), trainer('secondary'), trainer('support')],
    contracts: [contract('learner', 'primary', ['secondary'])],
    sessions: [], leaves: [], schedule: {},
    config: { workingDays: ['T2', 'T3'], workingHours: [6, 7], holidays: [] },
  }
}

function learnerEntries(result, studentId = 'learner') {
  return Object.values(result.schedule).flat().filter((row) => row.studentId === studentId)
}

for (const mode of MODES) {
  for (const pairedTrainer of ['secondary', 'support']) {
    test(`${mode}: available primary PT outranks a paired ${pairedTrainer} class`, () => {
      const data = fixture(mode)
      const locked = entry('existing', pairedTrainer, { isLocked: true, source: 'manual_v2' })
      data.schedule = { 'T2-6': [locked] }
      data.trainers[0].schedulingPriority = 999
      data.trainers.find((row) => row.id === pairedTrainer).schedulingPriority = 1

      const result = generateSchedule(data)

      assert.deepEqual(learnerEntries(result).map((row) => row.trainerId), ['primary'])
      assert.deepEqual(result.schedule['T2-6'].find((row) => row.studentId === 'existing'), locked)
      assert.equal(result.optimizationSummary.studentCoverage.missingSessions, 0)
      assert.ok(!result.warnings.some((warning) => warning.studentId === 'learner'
        && warning.code === 'TRAINER_ASSIGNMENT_MISMATCH'))
    })
  }

  test(`${mode}: compaction keeps two learners with their different available primary PTs`, () => {
    const data = fixture(mode)
    data.students = [student('learner-a'), student('learner-b')]
    data.trainers = [trainer('primary-a'), trainer('primary-b')]
    data.contracts = [contract('learner-a', 'primary-a'), contract('learner-b', 'primary-b')]

    const result = generateSchedule(data)

    assert.deepEqual(learnerEntries(result, 'learner-a').map((row) => row.trainerId), ['primary-a'])
    assert.deepEqual(learnerEntries(result, 'learner-b').map((row) => row.trainerId), ['primary-b'])
    assert.equal(result.optimizationSummary.studentCoverage.missingSessions, 0)
    assert.equal(result.optimizationSummary.slotUtilization.teachingSlots, 2)
    assert.equal(result.optimizationSummary.slotUtilization.pairedSlots, 0)
  })

  test(`${mode}: a free secondary seat avoids displacing an earlier learner from their primary PT`, () => {
    const data = fixture(mode)
    data.students = [
      student('learner-a', { name: 'A' }),
      student('learner-b', { name: 'B' }),
    ]
    data.trainers = [trainer('primary', { slotCapacity: 1 }), trainer('secondary', { slotCapacity: 1 })]
    data.contracts = [
      contract('learner-a', 'primary'),
      contract('learner-b', 'primary', ['secondary']),
    ]

    const result = generateSchedule(data)

    assert.deepEqual(learnerEntries(result, 'learner-a').map((row) => row.trainerId), ['primary'])
    assert.deepEqual(learnerEntries(result, 'learner-b').map((row) => row.trainerId), ['secondary'])
    assert.equal(result.optimizationSummary.studentCoverage.missingSessions, 0)
    assert.ok(Object.values(result.schedule).flat().every((row) => !row.trainerAssignmentWarning))
    assert.ok(!result.warnings.some((warning) => warning.code === 'TRAINER_ASSIGNMENT_MISMATCH'))
  })

  test(`${mode}: primary preference still uses the secondary PT to fulfil the remaining weekly target`, () => {
    const data = fixture(mode)
    data.students[0].sessionsPerWeek = 2
    data.students[0].availableSlots = ['T2-6', 'T3-6']
    data.trainers[1].availableSlots = ['T3-6']
    data.trainers[2].availableSlots = ['T2-6', 'T3-6']

    const result = generateSchedule(data)

    assert.equal(result.schedule['T2-6'].find((row) => row.studentId === 'learner').trainerId, 'primary')
    assert.equal(result.schedule['T3-6'].find((row) => row.studentId === 'learner').trainerId, 'secondary')
    assert.equal(result.optimizationSummary.studentCoverage.missingSessions, 0)
    assert.ok(learnerEntries(result).every((row) => !row.trainerAssignmentWarning))
  })

  test(`${mode}: unavailable assigned PTs still allow a support PT with a visible warning`, () => {
    const data = fixture(mode)
    data.trainers[0].availableSlots = ['T3-6']
    data.trainers[1].availableSlots = ['T3-6']

    const result = generateSchedule(data)
    const [assigned] = learnerEntries(result)

    assert.equal(assigned.trainerId, 'support')
    assert.equal(assigned.trainerAssignmentWarning, true)
    assert.equal(result.optimizationSummary.studentCoverage.missingSessions, 0)
    assert.ok(result.warnings.some((warning) => warning.code === 'TRAINER_ASSIGNMENT_MISMATCH'
      && warning.studentId === 'learner' && warning.trainerId === 'support'))
  })

  test(`${mode}: unassigned learner still joins an existing class before an empty higher-ranked full-time PT`, () => {
    const data = fixture(mode)
    data.contracts = [contract('learner')]
    data.trainers = [
      trainer('paired', { employmentType: 'collaborator', schedulingPriority: 999 }),
      trainer('empty', { employmentType: 'full_time', schedulingPriority: 1 }),
    ]
    data.schedule = { 'T2-6': [entry('existing', 'paired', { isLocked: true })] }

    const result = generateSchedule(data)

    assert.deepEqual(learnerEntries(result).map((row) => row.trainerId), ['paired'])
    assert.equal(result.optimizationSummary.slotUtilization.pairedSlots, 1)
    assert.ok(!result.warnings.some((warning) => warning.code === 'TRAINER_ASSIGNMENT_MISMATCH'))
  })
}

test('optimization replaces an incumbent auto pair when both primary PTs can teach the same learners', () => {
  const data = fixture()
  data.students = [student('learner-a'), student('learner-b')]
  data.trainers = [trainer('primary-a'), trainer('primary-b')]
  data.contracts = [contract('learner-a', 'primary-a'), contract('learner-b', 'primary-b')]
  data.schedule = {
    'T2-6': [entry('learner-a', 'primary-a'), entry('learner-b', 'primary-a', { trainerAssignmentWarning: true })],
  }

  const result = generateSchedule(data)

  assert.deepEqual(learnerEntries(result, 'learner-a').map((row) => row.trainerId), ['primary-a'])
  assert.deepEqual(learnerEntries(result, 'learner-b').map((row) => row.trainerId), ['primary-b'])
  assert.equal(result.optimizationSummary.studentCoverage.missingSessions, 0)
})

for (const previousTrainer of ['secondary', 'support']) {
  for (const primarySlot of ['T2-6', 'T3-6']) {
    test(`continue: upgrades an existing ${previousTrainer} auto entry to primary at ${primarySlot} without losing coverage`, () => {
      const data = fixture('continue')
      data.students[0].availableSlots = ['T2-6', 'T3-6']
      data.trainers[0].availableSlots = [primarySlot]
      data.schedule = {
        'T2-6': [entry('learner', previousTrainer, previousTrainer === 'support' ? { trainerAssignmentWarning: true } : {})],
      }

      const result = generateSchedule(data)

      assert.deepEqual(learnerEntries(result).map((row) => row.trainerId), ['primary'])
      assert.ok(result.schedule[primarySlot].some((row) => row.studentId === 'learner'))
      assert.equal(result.optimizationSummary.studentCoverage.missingSessions, 0)
      assert.ok(learnerEntries(result).every((row) => !row.trainerAssignmentWarning))
      assert.ok(!result.warnings.some((warning) => warning.studentId === 'learner'
        && warning.code === 'TRAINER_ASSIGNMENT_MISMATCH'))
    })
  }
}

for (const protection of [{ source: 'manual_v2' }, { isLocked: true }]) {
  test(`supplement: preserves existing ${protection.source || 'locked'} support row and adds the missing session with primary`, () => {
    const data = fixture('supplement')
    data.students[0].sessionsPerWeek = 2
    data.students[0].availableSlots = ['T2-6', 'T3-6']
    data.trainers[0].availableSlots = ['T2-6', 'T3-6']
    const protectedEntry = entry('learner', 'support', { trainerAssignmentWarning: true, ...protection })
    data.schedule = { 'T2-6': [protectedEntry] }

    const result = generateSchedule(data)

    assert.deepEqual(result.schedule['T2-6'].find((row) => row.studentId === 'learner'), protectedEntry)
    assert.equal(result.schedule['T3-6'].find((row) => row.studentId === 'learner').trainerId, 'primary')
    assert.equal(result.optimizationSummary.studentCoverage.missingSessions, 0)
    assert.ok(result.warnings.some((warning) => warning.studentId === 'learner'
      && warning.trainerId === 'support' && warning.code === 'TRAINER_ASSIGNMENT_MISMATCH'))
  })
}

test('unassigned learner retains full-time employment preference before PT rank', () => {
  const data = fixture()
  data.contracts = [contract('learner')]
  data.trainers = [
    trainer('full-time', { employmentType: 'full_time', schedulingPriority: 999 }),
    trainer('collaborator', { employmentType: 'collaborator', schedulingPriority: 1 }),
  ]

  assert.deepEqual(learnerEntries(generateSchedule(data)).map((row) => row.trainerId), ['full-time'])
})

test('unassigned learner retains load balancing before PT rank when employment and adjacency tie', () => {
  const data = fixture()
  data.contracts = [contract('learner')]
  data.students[0].availableSlots = ['T2-9']
  data.config.workingHours = [6, 9]
  data.trainers = [
    trainer('busy', { availableSlots: ['T2-6', 'T2-9'], slotCapacity: 1, schedulingPriority: 1 }),
    trainer('empty', { availableSlots: ['T2-9'], slotCapacity: 1, schedulingPriority: 999 }),
  ]
  data.schedule = { 'T2-6': [entry('existing', 'busy', { isLocked: true })] }

  assert.deepEqual(learnerEntries(generateSchedule(data)).map((row) => row.trainerId), ['empty'])
})

for (const targetTrainer of ['secondary', 'support']) {
  test(`direct compaction does not move a primary assignment into a ${targetTrainer} pair`, () => {
    const data = fixture()
    data.students[0].availableSlots = ['T2-6', 'T3-6']
    data.trainers.forEach((row) => { row.availableSlots = ['T2-6', 'T3-6'] })
    const schedule = {
      'T2-6': [entry('learner', 'primary')],
      'T3-6': [entry('existing', targetTrainer, { isLocked: true })],
    }

    const result = compactPairedSlots(data, schedule)

    assert.equal(result.moves, 0)
    assert.deepEqual(result.schedule, schedule)
  })
}

for (const sourceRoles of [['primary', 'primary'], ['primary', 'secondary'], ['secondary', 'primary']]) {
  test(`third-slot compaction preserves ${sourceRoles.join('/')} roles for learners with different primary PTs`, () => {
    const data = fixture()
    data.config.workingDays = ['T2', 'T3', 'T4']
    data.students = [
      student('learner-a', { availableSlots: ['T2-6', 'T4-6'] }),
      student('learner-b', { availableSlots: ['T3-6', 'T4-6'] }),
    ]
    data.trainers = ['primary-a', 'secondary-a', 'primary-b', 'secondary-b'].map((id) => trainer(id, {
      availableSlots: ['T2-6', 'T3-6', 'T4-6'],
    }))
    data.contracts = [
      contract('learner-a', 'primary-a', ['secondary-a']),
      contract('learner-b', 'primary-b', ['secondary-b']),
    ]
    // Neither learner can use the other's original time. A shared third slot
    // exists, but every possible pair would worsen at least one assignment.
    const schedule = {
      'T2-6': [entry('learner-a', `${sourceRoles[0]}-a`)],
      'T3-6': [entry('learner-b', `${sourceRoles[1]}-b`)],
    }

    const result = compactPairedSlots(data, schedule)

    assert.equal(result.moves, 0)
    assert.deepEqual(result.schedule, schedule)
  })
}

test('third-slot compaction still pairs two learners when their primary PT remains the same', () => {
  const data = fixture()
  data.config.workingDays = ['T2', 'T3', 'T4']
  data.students = [
    student('learner-a', { availableSlots: ['T2-6', 'T4-6'] }),
    student('learner-b', { availableSlots: ['T3-6', 'T4-6'] }),
  ]
  data.trainers = [trainer('primary', { availableSlots: ['T2-6', 'T3-6', 'T4-6'] })]
  data.contracts = [contract('learner-a', 'primary'), contract('learner-b', 'primary')]
  const schedule = {
    'T2-6': [entry('learner-a', 'primary')],
    'T3-6': [entry('learner-b', 'primary')],
  }

  const result = compactPairedSlots(data, schedule)

  assert.equal(result.moves, 2)
  assert.deepEqual(Object.keys(result.schedule), ['T4-6'])
  assert.deepEqual(result.schedule['T4-6'].map((row) => [row.studentId, row.trainerId]), [
    ['learner-a', 'primary'], ['learner-b', 'primary'],
  ])
})

test('compaction evaluates each renewal entry against its own contract primary PT', () => {
  const data = fixture()
  data.students[0].sessionsPerWeek = 2
  data.students[0].availableSlots = ['T2-6', 'T3-6']
  data.trainers = ['old-primary', 'new-primary'].map((id) => trainer(id, { availableSlots: ['T2-6', 'T3-6'] }))
  data.contracts = [
    { ...contract('learner', 'old-primary'), endDate: WEEK },
    {
      ...contract('learner', 'new-primary', ['old-primary']), id: 'renewal-learner',
      status: 'future', startDate: '2026-08-25', sourceContractId: 'contract-learner',
    },
  ]
  const schedule = {
    'T2-6': [entry('learner', 'old-primary')],
    'T3-6': [
      entry('learner', 'new-primary', { contractId: 'renewal-learner' }),
      entry('existing', 'old-primary', { isLocked: true }),
    ],
  }

  const result = compactPairedSlots(data, schedule)

  assert.equal(result.moves, 0)
  assert.deepEqual(result.schedule, schedule)
})

function assignmentWarnings(result) {
  return result.warnings.filter((warning) => warning.code === 'TRAINER_ASSIGNMENT_MISMATCH')
}

for (const mode of ['optimize', 'continue']) {
  test(`${mode}: a learner without PT chính/phụ gives up the only primary seat`, () => {
    const data = fixture(mode)
    data.students = [student('learner-free'), student('learner-a')]
    data.trainers = [trainer('primary', { slotCapacity: 1, schedulingPriority: 1 }), trainer('support', { slotCapacity: 1 })]
    // The unassigned learner is more urgent, so the first round seats it first.
    data.contracts = [{ ...contract('learner-free'), endDate: '2026-08-30' }, contract('learner-a', 'primary')]

    const result = generateSchedule(data)

    assert.deepEqual(learnerEntries(result, 'learner-a').map((row) => [row.trainerId, row.trainerAssignmentWarning === true]), [['primary', false]])
    assert.deepEqual(learnerEntries(result, 'learner-free').map((row) => row.trainerId), ['support'])
    assert.equal(result.optimizationSummary.studentCoverage.missingSessions, 0)
    assert.deepEqual(assignmentWarnings(result), [])
  })
}

test('continue: exchanges two retained auto entries that sit with each other\'s primary PT', () => {
  const data = fixture('continue')
  data.students = [student('learner-a'), student('learner-b')]
  data.trainers = [trainer('primary-a', { slotCapacity: 1 }), trainer('primary-b', { slotCapacity: 1 })]
  data.contracts = [contract('learner-a', 'primary-a'), contract('learner-b', 'primary-b')]
  data.schedule = { 'T2-6': [
    entry('learner-a', 'primary-b', { trainerAssignmentWarning: true }),
    entry('learner-b', 'primary-a', { trainerAssignmentWarning: true }),
  ] }

  const result = generateSchedule(data)

  assert.deepEqual(learnerEntries(result, 'learner-a').map((row) => row.trainerId), ['primary-a'])
  assert.deepEqual(learnerEntries(result, 'learner-b').map((row) => row.trainerId), ['primary-b'])
  assert.ok(Object.values(result.schedule).flat().every((row) => !row.trainerAssignmentWarning))
  assert.deepEqual(assignmentWarnings(result), [])
})

test('continue: a primary learner moves to their secondary PT so nobody needs a support PT', () => {
  const data = fixture('continue')
  data.students = [student('learner-a'), student('learner-b')]
  data.trainers = ['shared', 'secondary-a', 'support'].map((id) => trainer(id, { slotCapacity: 1 }))
  // learner-b's primary PT cannot teach this week; the shared PT is their PT phụ.
  data.contracts = [contract('learner-a', 'shared', ['secondary-a']), contract('learner-b', 'away', ['shared'])]
  data.schedule = { 'T2-6': [
    entry('learner-a', 'shared'),
    entry('learner-b', 'support', { trainerAssignmentWarning: true }),
  ] }

  const result = generateSchedule(data)

  assert.deepEqual(learnerEntries(result, 'learner-a').map((row) => row.trainerId), ['secondary-a'])
  assert.deepEqual(learnerEntries(result, 'learner-b').map((row) => row.trainerId), ['shared'])
  assert.equal(result.optimizationSummary.studentCoverage.missingSessions, 0)
  assert.deepEqual(assignmentWarnings(result), [])
})

test('continue: never trades one support placement for another', () => {
  const data = fixture('continue')
  data.students = [student('learner-a'), student('learner-b')]
  data.trainers = [trainer('primary', { slotCapacity: 1 }), trainer('support', { slotCapacity: 1 })]
  // Both learners belong to the same single-seat PT; one of them must use support.
  data.contracts = [contract('learner-a', 'primary'), contract('learner-b', 'primary')]
  const kept = entry('learner-a', 'primary')
  data.schedule = { 'T2-6': [kept, entry('learner-b', 'support', { trainerAssignmentWarning: true })] }

  const result = generateSchedule(data)

  assert.deepEqual(learnerEntries(result, 'learner-a').map((row) => row.trainerId), ['primary'])
  assert.deepEqual(learnerEntries(result, 'learner-b').map((row) => row.trainerId), ['support'])
  assert.deepEqual(assignmentWarnings(result).map((warning) => warning.studentId), ['learner-b'])
})

test('swap never relocates a locked or manual occupant of the primary seat', () => {
  for (const protection of [{ isLocked: true }, { source: 'manual_v2' }]) {
    const data = fixture('continue')
    data.students = [student('learner-free'), student('learner-a')]
    data.trainers = [trainer('primary', { slotCapacity: 1 }), trainer('support', { slotCapacity: 1 })]
    data.contracts = [contract('learner-free'), contract('learner-a', 'primary')]
    const occupant = entry('learner-free', 'primary', protection)
    data.schedule = { 'T2-6': [occupant, entry('learner-a', 'support', { trainerAssignmentWarning: true })] }

    const result = generateSchedule(data)

    assert.deepEqual(result.schedule['T2-6'].find((row) => row.studentId === 'learner-free'), occupant)
    assert.deepEqual(learnerEntries(result, 'learner-a').map((row) => row.trainerId), ['support'])
  }
})
