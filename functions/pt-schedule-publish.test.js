'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { desiredEntries, branchScheduleSnapshot, mergeRestoredBranchSchedule, normalizedDraftSchedule, trainerProfileForWeek } = require('./pt-schedule-publish')

const WEEK = '2026-08-24'
const SCHEDULE_ID = `schedule_${WEEK}`
const BRANCH_ID = 'branch-a'

function baseFixture() {
  return {
    scheduleId: SCHEDULE_ID,
    week: WEEK,
    branchId: BRANCH_ID,
    schedule: {
      'T2-6': [{ studentId: 'student-a', trainerId: 'trainer-a', type: 'training' }],
    },
    trainers: new Map([
      ['trainer-a', { status: 'active', branchId: BRANCH_ID, availabilityMode: 'configured', availableSlots: ['T2-6', 'T2-7'] }],
    ]),
    students: new Map([
      ['student-a', { status: 'active', branchId: BRANCH_ID }],
    ]),
    contracts: [{
      id: 'contract-a',
      studentId: 'student-a',
      branchId: BRANCH_ID,
      trainerId: 'trainer-a',
      status: 'active',
      startDate: '2026-08-01',
      endDate: '2026-12-31',
      usedSessions: 0,
      totalSessions: 36,
    }],
    availability: new Map([
      ['student-a', { studentId: 'student-a', status: 'submitted', slots: ['T2-6', 'T2-7'] }],
    ]),
    config: { workingDays: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'], workingHours: [6, 7] },
  }
}

test('publish resolves the same exact PT weekly availability as auto scheduling', () => {
  const recurring = { availableSlots: ['T2-6'], availabilityMode: 'configured', availabilityRevision: 5 }
  const weekly = { trainerId: 'trainer-a', weekId: WEEK, status: 'submitted', slots: ['T3-7'], revision: 1 }
  const resolved = trainerProfileForWeek(recurring, weekly, WEEK)
  assert.deepEqual(resolved.availableSlots, ['T3-7'])
  assert.equal(resolved.availabilityRevision, 1)
  assert.equal(resolved.availabilitySource, 'weekly')
  assert.equal(trainerProfileForWeek(recurring, { ...weekly, status: 'draft' }, WEEK), recurring)
})

test('validates a legacy branch-less entry and binds it to the exact contract', () => {
  const result = desiredEntries(baseFixture())
  assert.deepEqual(result.errors, [])
  assert.equal(result.desired.size, 1)
  const [session] = result.desired.values()
  assert.equal(session.contractId, 'contract-a')
  assert.equal(session.branchId, BRANCH_ID)
  assert.equal(session.date, WEEK)
  assert.equal(session.hour, 6)
})

test('publish accepts a ninth teaching slot because the daily PT target is not a hard cap', () => {
  const fixture = baseFixture()
  const slots = Array.from({ length: 9 }, (_, index) => `T2-${index + 6}`)
  fixture.config.workingHours = slots.map((slotId) => Number(slotId.split('-')[1]))
  fixture.trainers.set('trainer-a', {
    ...fixture.trainers.get('trainer-a'),
    dailySessionTarget: 8,
    slotCapacity: 2,
    availableSlots: slots,
  })
  fixture.students = new Map()
  fixture.contracts = []
  fixture.availability = new Map()
  fixture.schedule = {}
  slots.forEach((slotId, index) => {
    const studentId = `student-${index}`
    fixture.students.set(studentId, { status: 'active', branchId: BRANCH_ID, sessionsPerWeek: 1 })
    fixture.contracts.push({
      id: `contract-${index}`,
      studentId,
      branchId: BRANCH_ID,
      trainerId: 'trainer-a',
      status: 'active',
      startDate: '2026-08-01',
      endDate: '2026-12-31',
      usedSessions: 0,
      totalSessions: 36,
    })
    fixture.availability.set(studentId, { studentId, status: 'submitted', slots: [slotId] })
    fixture.schedule[slotId] = [{ studentId, trainerId: 'trainer-a', type: 'training' }]
  })

  const result = desiredEntries(fixture)
  assert.equal(result.desired.size, 9)
  assert.deepEqual(result.errors, [])
  assert.ok(!result.warnings.includes('TRAINER_OVER_BALANCE_TARGET'))
})

test('publishes a same-branch support PT as a warning instead of rejecting the learner', () => {
  const fixture = baseFixture()
  fixture.trainers.set('trainer-support', {
    status: 'active',
    branchId: BRANCH_ID,
    availabilityMode: 'configured',
    availableSlots: ['T2-6'],
  })
  fixture.schedule['T2-6'] = [{
    studentId: 'student-a',
    trainerId: 'trainer-support',
    contractId: 'contract-a',
    branchId: BRANCH_ID,
    type: 'training',
    trainerAssignmentWarning: true,
  }]
  const result = desiredEntries(fixture)
  assert.deepEqual(result.errors, [])
  assert.ok(result.warnings.includes('TRAINER_ASSIGNMENT_MISMATCH'))
  const [session] = result.desired.values()
  assert.equal(session.trainerId, 'trainer-support')
  assert.equal(session.contractId, 'contract-a')
  assert.equal(session.trainerAssignmentWarning, true)
})

test('does not warn for any same-branch PT when contract has no assigned trainer', () => {
  const fixture = baseFixture()
  fixture.contracts[0].trainerId = ''
  fixture.contracts[0].trainerIds = []
  const result = desiredEntries(fixture)
  assert.deepEqual(result.errors, [])
  assert.ok(!result.warnings.includes('TRAINER_ASSIGNMENT_MISMATCH'))
  assert.equal(result.desired.values().next().value.trainerAssignmentWarning, undefined)
})

test('publishes an explicitly confirmed cross-branch learner with the physical training branch', () => {
  const fixture = baseFixture()
  fixture.students.set('student-a', { status: 'active', branchId: 'branch-home' })
  fixture.contracts[0].branchId = 'branch-home'
  fixture.schedule['T2-6'][0] = {
    ...fixture.schedule['T2-6'][0],
    branchId: BRANCH_ID,
    contractId: 'contract-a',
    source: 'manual_v2',
    studentBranchWarning: true,
    studentHomeBranchId: 'branch-home',
  }
  const result = desiredEntries(fixture)
  assert.deepEqual(result.errors, [])
  assert.ok(result.warnings.includes('STUDENT_BRANCH_MISMATCH'))
  const session = result.desired.values().next().value
  assert.equal(session.branchId, BRANCH_ID)
  assert.equal(session.studentBranchWarning, true)
  assert.equal(session.studentHomeBranchId, 'branch-home')
})

test('does not accept a cross-branch contract without the manual confirmation metadata', () => {
  const fixture = baseFixture()
  fixture.students.set('student-a', { status: 'active', branchId: 'branch-home' })
  fixture.contracts[0].branchId = 'branch-home'
  fixture.schedule['T2-6'][0].branchId = BRANCH_ID
  const result = desiredEntries(fixture)
  assert.ok(result.errors.includes('ACTIVE_CONTRACT_NOT_FOUND'))
})

test('keeps the primary PT assigned when secondary trainer ids are stored separately', () => {
  const fixture = baseFixture()
  fixture.contracts[0].trainerIds = ['trainer-secondary']
  const result = desiredEntries(fixture)
  assert.deepEqual(result.errors, [])
  assert.ok(!result.warnings.includes('TRAINER_ASSIGNMENT_MISMATCH'))
})

test('rejects more than one PT session for the same learner on one day', () => {
  const fixture = baseFixture()
  fixture.schedule['T2-7'] = [{ studentId: 'student-a', trainerId: 'trainer-a', type: 'training' }]
  const result = desiredEntries(fixture)
  assert.ok(result.errors.includes('STUDENT_MULTIPLE_SESSIONS_PER_DAY'))
})

test('uses a configurable PT slot capacity and defaults to two learners', () => {
  const fixture = baseFixture()
  for (const suffix of ['b', 'c']) {
    fixture.students.set(`student-${suffix}`, { status: 'active', branchId: BRANCH_ID })
    fixture.contracts.push({
      ...fixture.contracts[0],
      id: `contract-${suffix}`,
      studentId: `student-${suffix}`,
    })
    fixture.availability.set(`student-${suffix}`, {
      studentId: `student-${suffix}`,
      status: 'submitted',
      slots: ['T2-6'],
    })
    fixture.schedule['T2-6'].push({ studentId: `student-${suffix}`, trainerId: 'trainer-a', type: 'training' })
  }
  const defaultResult = desiredEntries(fixture)
  assert.ok(defaultResult.errors.includes('TRAINER_CAPACITY_EXCEEDED'))

  fixture.trainers.set('trainer-a', { status: 'active', branchId: BRANCH_ID, availabilityMode: 'configured', availableSlots: ['T2-6', 'T2-7'], slotCapacity: 3 })
  const configuredResult = desiredEntries(fixture)
  assert.ok(!configuredResult.errors.includes('TRAINER_CAPACITY_EXCEEDED'))
})

test('publish enforces the total branch capacity across different trainers', () => {
  const fixture = baseFixture()
  fixture.config.branchCapacityBySlot = { [BRANCH_ID]: { 'T2-6': 1 } }
  fixture.trainers.set('trainer-b', {
    status: 'active', branchId: BRANCH_ID, availabilityMode: 'configured', availableSlots: ['T2-6'], slotCapacity: 2,
  })
  fixture.students.set('student-b', { status: 'active', branchId: BRANCH_ID })
  fixture.contracts.push({ ...fixture.contracts[0], id: 'contract-b', studentId: 'student-b', trainerId: 'trainer-b' })
  fixture.availability.set('student-b', { studentId: 'student-b', status: 'submitted', slots: ['T2-6'] })
  fixture.schedule['T2-6'].push({ studentId: 'student-b', trainerId: 'trainer-b', type: 'training' })
  assert.ok(desiredEntries(fixture).errors.includes('BRANCH_CAPACITY_REACHED'))
})

test('publish rejects a draft that exceeds a learner weekly target', () => {
  const fixture = baseFixture()
  fixture.students.get('student-a').sessionsPerWeek = 1
  fixture.schedule['T3-6'] = [{ studentId: 'student-a', trainerId: 'trainer-a', type: 'training' }]
  fixture.trainers.get('trainer-a').availableSlots.push('T3-6')
  fixture.availability.get('student-a').slots.push('T3-6')
  assert.ok(desiredEntries(fixture).errors.includes('STUDENT_WEEKLY_TARGET_REACHED'))
})

test('publishes a paired session without treating the PT load target as a ceiling', () => {
  const fixture = baseFixture()
  fixture.trainers.set('trainer-a', {
    status: 'active',
    branchId: BRANCH_ID,
    availabilityMode: 'configured',
    availableSlots: ['T2-6'],
    slotCapacity: 2,
    dailySessionTarget: 1,
  })
  fixture.students.set('student-b', { status: 'active', branchId: BRANCH_ID })
  fixture.contracts.push({ ...fixture.contracts[0], id: 'contract-b', studentId: 'student-b' })
  fixture.availability.set('student-b', { studentId: 'student-b', status: 'submitted', slots: ['T2-6'] })
  fixture.schedule['T2-6'].push({ studentId: 'student-b', trainerId: 'trainer-a', type: 'training' })

  const result = desiredEntries(fixture)
  assert.deepEqual(result.errors, [])
})

test('daily workload target does not block publishing additional valid slots', () => {
  const fixture = baseFixture()
  fixture.trainers.set('trainer-a', {
    status: 'active',
    branchId: BRANCH_ID,
    availabilityMode: 'configured',
    availableSlots: ['T2-6', 'T2-7'],
    dailySessionTarget: 1,
  })
  fixture.students.set('student-b', { status: 'active', branchId: BRANCH_ID })
  fixture.contracts.push({ ...fixture.contracts[0], id: 'contract-b', studentId: 'student-b' })
  fixture.availability.set('student-b', { studentId: 'student-b', status: 'submitted', slots: ['T2-7'] })
  fixture.schedule['T2-7'] = [{ studentId: 'student-b', trainerId: 'trainer-a', type: 'training' }]

  const result = desiredEntries(fixture)
  assert.deepEqual(result.errors, [])
})

test('collaborator publish requires an explicitly registered slot', () => {
  const fixture = baseFixture()
  fixture.trainers.set('trainer-a', {
    status: 'active',
    branchId: BRANCH_ID,
    employmentType: 'collaborator',
    availabilityMode: 'unrestricted',
    availableSlots: [],
  })
  assert.ok(desiredEntries(fixture).errors.includes('TRAINER_AVAILABILITY_UNCONFIGURED'))
  fixture.trainers.get('trainer-a').availableSlots = ['T2-6']
  assert.ok(!desiredEntries(fixture).errors.includes('TRAINER_AVAILABILITY_UNCONFIGURED'))
})

test('accepts a future renewal only on or after its concrete start date', () => {
  const fixture = baseFixture()
  fixture.contracts[0].status = 'future'
  fixture.contracts[0].startDate = WEEK
  const result = desiredEntries(fixture)
  assert.deepEqual(result.errors, [])
  assert.equal([...result.desired.values()][0].contractId, 'contract-a')
})

test('rejects entries outside submitted weekly availability', () => {
  const fixture = baseFixture()
  fixture.availability.set('student-a', { studentId: 'student-a', status: 'submitted', slots: ['T3-6'] })
  const result = desiredEntries(fixture)
  assert.ok(result.errors.includes('OUTSIDE_STUDENT_AVAILABILITY'))
})

test('accepts an explicitly audited manual placement outside learner availability as a warning', () => {
  const fixture = baseFixture()
  fixture.availability.set('student-a', { studentId: 'student-a', status: 'submitted', slots: ['T3-6'] })
  fixture.schedule['T2-6'][0] = {
    studentId: 'student-a',
    trainerId: 'trainer-a',
    branchId: BRANCH_ID,
    type: 'training',
    source: 'manual_v2',
    availabilityOverride: true,
    availabilityOverrideReason: 'OUTSIDE_STUDENT_AVAILABILITY',
    availabilityOverrideBy: 'admin-a',
    availabilityOverrideAt: '2026-08-28T10:00:00.000Z',
  }
  const result = desiredEntries(fixture)
  assert.ok(!result.errors.includes('OUTSIDE_STUDENT_AVAILABILITY'))
  assert.ok(result.warnings.includes('MANUAL_STUDENT_AVAILABILITY_OVERRIDE'))
  const session = [...result.desired.values()][0]
  assert.equal(session.availabilityOverride, true)
  assert.equal(session.availabilityOverrideBy, 'admin-a')

  fixture.availability.clear()
  const afterAvailabilityChanged = desiredEntries(fixture)
  assert.ok(!afterAvailabilityChanged.errors.includes('AVAILABILITY_NOT_SUBMITTED'))
  assert.ok(afterAvailabilityChanged.warnings.includes('MANUAL_STUDENT_AVAILABILITY_OVERRIDE'))
})

test('accepts confirmed recurring availability when no weekly document exists', () => {
  const fixture = baseFixture()
  fixture.availability.clear()
  fixture.students.set('student-a', {
    status: 'active',
    branchId: BRANCH_ID,
    availableSlots: ['T2-6'],
    isScheduleConfirmed: true,
  })
  const result = desiredEntries(fixture)
  assert.deepEqual(result.errors, [])
  assert.ok(result.warnings.includes('LEGACY_AVAILABILITY_FALLBACK'))
})

test('accepts the latest submitted prior week before the legacy default', () => {
  const fixture = baseFixture()
  fixture.availability.clear()
  fixture.students.set('student-a', {
    status: 'active',
    branchId: BRANCH_ID,
    availableSlots: ['T3-6'],
    isScheduleConfirmed: true,
  })
  fixture.inheritedAvailability = new Map([[
    'student-a',
    { weekId: '2026-08-17', status: 'locked', revision: 3, slots: ['T2-6'] },
  ]])
  const result = desiredEntries(fixture)
  assert.deepEqual(result.errors, [])
  assert.ok(result.warnings.includes('INHERITED_AVAILABILITY_FALLBACK'))
  assert.ok(!result.warnings.includes('LEGACY_AVAILABILITY_FALLBACK'))
})

test('rejects unconfirmed legacy availability when no weekly document exists', () => {
  const fixture = baseFixture()
  fixture.availability.clear()
  fixture.students.set('student-a', {
    status: 'active',
    branchId: BRANCH_ID,
    availableSlots: ['T2-6'],
    isScheduleConfirmed: false,
  })
  const result = desiredEntries(fixture)
  assert.ok(result.errors.includes('AVAILABILITY_NOT_SUBMITTED'))
})

test('normalizer retains more than five entries shared by different trainers', () => {
  const schedule = normalizedDraftSchedule({
    'T2-6': Array.from({ length: 8 }, (_, index) => ({ studentId: `student-${index}`, trainerId: `trainer-${index}` })),
  }, BRANCH_ID)
  assert.equal(schedule['T2-6'].length, 8)
})

test('rejects a learner placed into a PT OFF slot', () => {
  const fixture = baseFixture()
  fixture.schedule['T2-6'].push({
    studentId: 'OFF',
    trainerId: 'trainer-a',
    branchId: BRANCH_ID,
    type: 'off',
  })
  const result = desiredEntries(fixture)
  assert.ok(result.errors.includes('TRAINER_OFF_CONFLICT'))
})

test('ignores entries that canonically belong to another branch', () => {
  const fixture = baseFixture()
  fixture.students.set('student-a', { status: 'active', branchId: 'branch-b' })
  fixture.trainers.set('trainer-a', { status: 'active', branchId: 'branch-b' })
  fixture.contracts[0].branchId = 'branch-b'
  const result = desiredEntries(fixture)
  assert.deepEqual(result.errors, [])
  assert.equal(result.desired.size, 0)
})

test('captures OFF and training entries in an immutable branch draft snapshot', () => {
  const students = new Map([['student-a', { branchId: BRANCH_ID }]])
  const trainers = new Map([['trainer-a', { branchId: BRANCH_ID }]])
  const snapshot = branchScheduleSnapshot({
    'T2-6': [
      { studentId: 'student-a', trainerId: 'trainer-a', type: 'training', isLocked: true, source: 'manual_v2', availabilityOverride: true, availabilityOverrideReason: 'OUTSIDE_STUDENT_AVAILABILITY', availabilityOverrideBy: 'admin-a', availabilityOverrideAt: '2026-08-28T10:00:00.000Z' },
      { studentId: 'OFF', trainerId: 'trainer-a', type: 'off' },
    ],
  }, BRANCH_ID, students, trainers)
  assert.equal(snapshot['T2-6'].length, 2)
  assert.equal(snapshot['T2-6'][0].branchId, BRANCH_ID)
  assert.equal(snapshot['T2-6'][0].availabilityOverride, true)
  assert.equal(snapshot['T2-6'][1].type, 'off')
})

test('restoring one branch preserves every entry belonging to another branch', () => {
  const students = new Map([
    ['student-a', { branchId: BRANCH_ID }],
    ['student-b', { branchId: 'branch-b' }],
  ])
  const trainers = new Map([
    ['trainer-a', { branchId: BRANCH_ID }],
    ['trainer-b', { branchId: 'branch-b' }],
  ])
  const restored = mergeRestoredBranchSchedule({
    'T2-6': [
      { studentId: 'student-a', trainerId: 'trainer-a', branchId: BRANCH_ID },
      { studentId: 'student-b', trainerId: 'trainer-b', branchId: 'branch-b' },
    ],
  }, {
    'T3-7': [{ studentId: 'student-a', trainerId: 'trainer-a', branchId: BRANCH_ID, type: 'training' }],
  }, BRANCH_ID, students, trainers)
  assert.deepEqual(restored['T2-6'], [{ studentId: 'student-b', trainerId: 'trainer-b', branchId: 'branch-b' }])
  assert.equal(restored['T3-7'][0].studentId, 'student-a')
})

test('branch draft input is bounded, canonical and cannot persist the all filter', () => {
  const result = normalizedDraftSchedule({
    'T2-6': [{ studentId: 'student-a', trainerId: 'trainer-a', branchId: 'all', isLocked: true }],
    'T3-7': [{ studentId: 'OFF', trainerId: 'trainer-a', type: 'off' }],
  }, BRANCH_ID)
  assert.equal(result['T2-6'][0].branchId, BRANCH_ID)
  assert.equal(result['T2-6'][0].type, 'training')
  assert.equal(result['T3-7'][0].studentId, 'OFF')
  assert.equal(result['T3-7'][0].branchId, BRANCH_ID)
})

test('OFF metadata does not consume the 440 learner-session publish budget', () => {
  const schedule = Object.fromEntries(Array.from({ length: 5 }, (_, dayIndex) => [
    `T${dayIndex + 2}-6`,
    Array.from({ length: 100 }, (_, index) => ({
      studentId: 'OFF',
      trainerId: `trainer-${dayIndex}-${index}`,
      type: 'off',
    })),
  ]))
  assert.equal(Object.values(normalizedDraftSchedule(schedule, BRANCH_ID)).flat().length, 500)
})

test('raw draft input cannot forge an availability override while trusted restore retains it', () => {
  const input = {
    'T2-6': [{
      studentId: 'student-a',
      trainerId: 'trainer-a',
      source: 'manual_v2',
      availabilityOverride: true,
      availabilityOverrideReason: 'OUTSIDE_STUDENT_AVAILABILITY',
      availabilityOverrideBy: 'admin-a',
      availabilityOverrideAt: '2026-08-28T10:00:00.000Z',
    }],
  }
  assert.equal(normalizedDraftSchedule(input, BRANCH_ID)['T2-6'][0].availabilityOverride, undefined)
  assert.equal(normalizedDraftSchedule(input, BRANCH_ID, true)['T2-6'][0].availabilityOverride, true)
})
