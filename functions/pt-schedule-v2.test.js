'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { MAX_DRAFT_DOCUMENT_ENTRIES, MAX_DRAFT_ENTRIES, candidateForSlot, compactPairedSlots, generateSchedule, manualSlotCandidate, resetDraftSchedule, resolveContract, safeSchedule, safeWeeklySessionTargets, slotUtilizationForSchedule, studentWeekEligibility, weeklyTargetForStudent } = require('./pt-schedule-v2')

const WEEK = '2026-08-24'
const BRANCH = 'branch-a'

function fixture() {
  return {
    weekId: WEEK,
    branch: { id: BRANCH, name: 'Aura A' },
    students: [{
      id: 'student-a',
      name: 'Lan',
      status: 'active',
      branchId: BRANCH,
      sessionsPerWeek: 1,
      availableSlots: ['T2-6', 'T4-6'],
      availabilityStatus: 'submitted',
    }],
    trainers: [{
      id: 'trainer-a',
      name: 'Mai',
      status: 'active',
      branchId: BRANCH,
      availabilityMode: 'configured',
      availableSlots: ['T2-6', 'T4-6'],
      slotCapacity: 2,
    }],
    contracts: [{
      id: 'contract-a',
      studentId: 'student-a',
      trainerId: 'trainer-a',
      trainerIds: [],
      branchId: BRANCH,
      status: 'active',
      startDate: '2026-08-24',
      endDate: '2026-12-31',
      pausePeriods: [],
      totalSessions: 36,
      usedSessions: 0,
    }],
    sessions: [],
    leaves: [],
    schedule: {},
    config: {
      workingDays: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7'],
      workingHours: Array.from({ length: 24 }, (_, hour) => hour),
      holidays: [],
    },
  }
}

test('auto scheduling never creates a draft on a configured holiday', () => {
  const data = fixture()
  data.students[0].availableSlots = ['T2-6']
  data.trainers[0].availableSlots = ['T2-6']
  data.config.holidays = [WEEK]
  const candidate = candidateForSlot(data, {
    student: data.students[0],
    trainer: data.trainers[0],
    slotId: 'T2-6',
    schedule: {},
  })
  assert.equal(candidate.eligible, false)
  assert.ok(candidate.reasons.includes('OUTSIDE_WORKING_CALENDAR'))
  assert.equal(Object.values(generateSchedule(data).schedule).flat().length, 0)
})

test('OFF markers use a separate document guard from publishable learner sessions', () => {
  const offSchedule = Object.fromEntries(Array.from({ length: 5 }, (_, dayIndex) => [
    `T${dayIndex + 2}-6`,
    Array.from({ length: 100 }, (_, index) => ({
      studentId: 'OFF',
      trainerId: `trainer-${dayIndex}-${index}`,
      branchId: BRANCH,
      type: 'off',
    })),
  ]))
  assert.equal(Object.values(safeSchedule(offSchedule)).flat().length, 500)
  assert.ok(MAX_DRAFT_DOCUMENT_ENTRIES > MAX_DRAFT_ENTRIES)

  const trainingSchedule = Object.fromEntries(Array.from({ length: 5 }, (_, dayIndex) => [
    `T${dayIndex + 2}-6`,
    Array.from({ length: dayIndex === 4 ? 41 : 100 }, (_, index) => ({
      studentId: `student-${dayIndex}-${index}`,
      trainerId: `trainer-${dayIndex}-${index}`,
      branchId: BRANCH,
      type: 'training',
    })),
  ]))
  assert.throws(() => safeSchedule(trainingSchedule), /Draft vượt giới hạn an toàn/)
})

test('active scheduled sessions reduce new quota without hiding sessions already held this week', () => {
  const contract = {
    ...fixture().contracts[0],
    totalSessions: 3,
    usedSessions: 1,
    remainingEntitlementSessions: 2,
    activeScheduledSessions: 2,
    activeScheduledThisWeek: 1,
    remainingSchedulableSessions: 0,
  }
  const eligibility = studentWeekEligibility([contract], 'student-a', BRANCH, WEEK, WEEK)
  assert.equal(eligibility.remainingEntitlementSessions, 2)
  assert.equal(eligibility.activeScheduledSessions, 2)
  assert.equal(eligibility.activeScheduledThisWeek, 1)
  assert.equal(eligibility.remainingSchedulableSessions, 0)
  assert.equal(eligibility.remainingSessions, 1)

  const data = fixture()
  data.contracts[0].totalSessions = 2
  data.sessions = [{
    id: 'held-elsewhere',
    studentId: 'student-a',
    trainerId: 'trainer-a',
    contractId: 'contract-a',
    branchId: BRANCH,
    date: '2026-08-31',
    status: 'scheduled',
    billingStatus: 'pending',
  }]
  const draft = {
    'T2-6': [{ studentId: 'student-a', trainerId: 'trainer-a', contractId: 'contract-a', branchId: BRANCH, type: 'training' }],
  }
  assert.deepEqual(resolveContract(data, 'student-a', 'trainer-a', '2026-08-26', draft).reasons, ['CONTRACT_SESSION_QUOTA_EXCEEDED'])
})

test('resolves exactly one active contract for the concrete session date', () => {
  const data = fixture()
  assert.equal(resolveContract(data, 'student-a', 'trainer-a', '2026-08-24').contract.id, 'contract-a')
  data.contracts[0].startDate = '2026-08-26'
  assert.deepEqual(resolveContract(data, 'student-a', 'trainer-a', '2026-08-24').reasons, ['ACTIVE_CONTRACT_NOT_FOUND'])
  assert.equal(resolveContract(data, 'student-a', 'trainer-a', '2026-08-26').contract.id, 'contract-a')
})

test('weekly eligibility excludes expired, exhausted and fully paused contracts', () => {
  const contract = fixture().contracts[0]
  assert.equal(studentWeekEligibility([{ ...contract, endDate: '2026-08-23' }], 'student-a', BRANCH, WEEK, WEEK).eligible, false)
  assert.ok(studentWeekEligibility([{ ...contract, endDate: '2026-08-23' }], 'student-a', BRANCH, WEEK, WEEK).reasonCodes.includes('ACTIVE_CONTRACT_NOT_FOUND'))

  const exhausted = studentWeekEligibility([{ ...contract, usedSessions: 36 }], 'student-a', BRANCH, WEEK, WEEK)
  assert.equal(exhausted.eligible, false)
  assert.ok(exhausted.reasonCodes.includes('CONTRACT_SESSION_QUOTA_EXCEEDED'))

  const paused = studentWeekEligibility([{
    ...contract,
    pausePeriods: [{ startDate: '2026-08-24', endDate: '2026-08-30' }],
  }], 'student-a', BRANCH, WEEK, WEEK)
  assert.equal(paused.eligible, false)
  assert.ok(paused.reasonCodes.includes('CONTRACT_PAUSED'))
})

test('weekly eligibility keeps a contract usable on at least one unpaused day', () => {
  const contract = fixture().contracts[0]
  const result = studentWeekEligibility([{
    ...contract,
    pausePeriods: [{ startDate: '2026-08-24', endDate: '2026-08-25' }],
  }], 'student-a', BRANCH, WEEK, WEEK)
  assert.equal(result.eligible, true)
  assert.deepEqual(result.pausedDates, ['2026-08-24', '2026-08-25'])
  assert.ok(result.validDates.includes('2026-08-26'))
})

test('current week excludes contract days that already ended before today', () => {
  const contract = fixture().contracts[0]
  const result = studentWeekEligibility([{ ...contract, endDate: '2026-08-25' }], 'student-a', BRANCH, WEEK, '2026-08-27')
  assert.equal(result.eligible, false)
})

test('weekly target remains the profile demand while remaining dates are reported separately', () => {
  const result = weeklyTargetForStudent(6, null, {
    remainingSessions: 55,
    validDates: ['2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30'],
  })
  assert.equal(result.sessionsPerWeek, 6)
  assert.equal(result.maxWeeklySessions, 7)
  assert.equal(result.schedulableSessionsThisWeek, 4)
})

test('future renewal contract is usable only from its concrete start date', () => {
  const data = fixture()
  data.contracts[0].status = 'future'
  data.contracts[0].startDate = '2026-08-29'
  assert.deepEqual(resolveContract(data, 'student-a', 'trainer-a', '2026-08-28').reasons, ['ACTIVE_CONTRACT_NOT_FOUND'])
  assert.equal(resolveContract(data, 'student-a', 'trainer-a', '2026-08-29').contract.id, 'contract-a')
})

test('weekly targets are bounded, scoped and do not mutate the profile default', () => {
  assert.deepEqual(safeWeeklySessionTargets({ 'student-a': 2, stranger: 4, invalid: 9 }, new Set(['student-a'])), { 'student-a': 2 })
  const data = fixture()
  data.students[0].sessionsPerWeek = 2
  const generated = generateSchedule(data)
  assert.equal(Object.values(generated.schedule).flat().filter((entry) => entry.studentId === 'student-a').length, 2)
})

test('fails closed when active contracts overlap on the same date', () => {
  const data = fixture()
  data.contracts.push({ ...data.contracts[0], id: 'contract-b' })
  assert.deepEqual(resolveContract(data, 'student-a', 'trainer-a', '2026-08-24').reasons, ['AMBIGUOUS_ACTIVE_CONTRACT'])
})

test('blocks a trainer whose availability is not configured', () => {
  const data = fixture()
  data.trainers[0].availabilityMode = 'unconfigured'
  data.trainers[0].availableSlots = []
  const result = candidateForSlot(data, {
    student: data.students[0],
    trainer: data.trainers[0],
    slotId: 'T2-6',
    schedule: {},
  })
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.includes('TRAINER_AVAILABILITY_UNCONFIGURED'))
})

test('accepts a confirmed recurring learner availability for future weeks', () => {
  const data = fixture()
  data.students[0].availabilityStatus = 'recurring'
  const result = candidateForSlot(data, {
    student: data.students[0],
    trainer: data.trainers[0],
    slotId: 'T2-6',
    schedule: {},
  })
  assert.equal(result.eligible, true)
})

test('accepts availability inherited from the latest submitted prior week', () => {
  const data = fixture()
  data.students[0].availabilityStatus = 'inherited'
  const result = candidateForSlot(data, {
    student: data.students[0],
    trainer: data.trainers[0],
    slotId: 'T2-6',
    schedule: {},
  })
  assert.equal(result.eligible, true)
})

test('manual slot list prioritizes matching availability but keeps an outside learner selectable', () => {
  const data = fixture()
  data.trainers[0].availableSlots.push('T3-6')
  const matching = manualSlotCandidate(candidateForSlot(data, {
    student: data.students[0],
    trainer: data.trainers[0],
    slotId: 'T2-6',
    schedule: {},
  }))
  const outside = manualSlotCandidate(candidateForSlot(data, {
    student: data.students[0],
    trainer: data.trainers[0],
    slotId: 'T3-6',
    schedule: {},
  }))
  assert.equal(matching.eligible, true)
  assert.equal(matching.matchesStudentAvailability, true)
  assert.equal(matching.manualSelectable, true)
  assert.equal(outside.eligible, false)
  assert.equal(outside.matchesStudentAvailability, false)
  assert.equal(outside.manualSelectable, true)
  assert.equal(outside.availabilityReason, 'OUTSIDE_STUDENT_AVAILABILITY')
})

test('manual availability override never bypasses contract or trainer blockers', () => {
  const data = fixture()
  data.trainers[0].availableSlots.push('T3-6')
  data.contracts = []
  const result = manualSlotCandidate(candidateForSlot(data, {
    student: data.students[0],
    trainer: data.trainers[0],
    slotId: 'T3-6',
    schedule: {},
  }))
  assert.equal(result.manualSelectable, false)
  assert.ok(result.reasons.includes('ACTIVE_CONTRACT_NOT_FOUND'))
})

test('does not silently truncate entries when several trainers share one hour', () => {
  const entries = Array.from({ length: 8 }, (_, index) => ({
    studentId: `student-${index}`,
    trainerId: `trainer-${index}`,
    branchId: BRANCH,
    type: 'training',
  }))
  const schedule = safeSchedule({ 'T2-6': entries })
  assert.equal(schedule['T2-6'].length, 8)
})

test('safe schedule retains only an audited manual availability override', () => {
  const schedule = safeSchedule({
    'T2-6': [{
      studentId: 'student-a',
      trainerId: 'trainer-a',
      branchId: BRANCH,
      type: 'training',
      source: 'manual_v2',
      availabilityOverride: true,
      availabilityOverrideReason: 'OUTSIDE_STUDENT_AVAILABILITY',
      availabilityOverrideBy: 'admin-a',
      availabilityOverrideAt: '2026-08-28T10:00:00.000Z',
    }],
    'T3-6': [{
      studentId: 'student-a',
      trainerId: 'trainer-a',
      branchId: BRANCH,
      type: 'training',
      source: 'generated_v3',
      availabilityOverride: true,
      availabilityOverrideReason: 'OUTSIDE_STUDENT_AVAILABILITY',
    }],
  })
  assert.equal(schedule['T2-6'][0].availabilityOverride, true)
  assert.equal(schedule['T2-6'][0].availabilityOverrideBy, 'admin-a')
  assert.equal(schedule['T3-6'][0].availabilityOverride, undefined)
})

test('generator stops safely at the bounded draft capacity and reports it', () => {
  const data = fixture()
  const slotIds = ['T2-6', 'T3-6', 'T4-6', 'T5-6', 'T6-6']
  let remainingEntries = MAX_DRAFT_ENTRIES
  data.schedule = Object.fromEntries(slotIds.map((slotId, slotIndex) => {
    const slotEntryCount = Math.min(100, remainingEntries)
    remainingEntries -= slotEntryCount
    return [slotId, Array.from({ length: slotEntryCount }, (_, index) => ({
      studentId: `locked-${slotIndex}-${index}`,
      trainerId: `trainer-${index}`,
      branchId: BRANCH,
      type: 'training',
      isLocked: true,
    }))]
  }))
  const generated = generateSchedule(data)
  assert.equal(Object.values(generated.schedule).flat().length, MAX_DRAFT_ENTRIES)
  assert.equal(generated.warnings[0].code, 'DRAFT_CAPACITY_REACHED')
})

test('coverage pass gives every feasible learner one session before filling higher targets', () => {
  const data = fixture()
  data.trainers[0].slotCapacity = 1
  data.students = [
    { ...data.students[0], id: 'student-a', name: 'A', sessionsPerWeek: 2, availableSlots: ['T2-6', 'T4-6'] },
    { ...data.students[0], id: 'student-b', name: 'B', sessionsPerWeek: 1, availableSlots: ['T2-6', 'T4-6'] },
  ]
  data.contracts = data.students.map((student) => ({ ...fixture().contracts[0], id: `contract-${student.id}`, studentId: student.id }))
  const generated = generateSchedule(data)
  const counts = Object.values(generated.schedule).flat().reduce((result, entry) => ({ ...result, [entry.studentId]: (result[entry.studentId] || 0) + 1 }), {})
  assert.equal(counts['student-a'], 1)
  assert.equal(counts['student-b'], 1)
  assert.deepEqual(generated.optimizationSummary.studentCoverage, {
    eligibleStudents: 2,
    studentsWithAtLeastOne: 2,
    fullyScheduledStudents: 1,
    totalTargetSessions: 3,
    scheduledEntries: 2,
    missingSessions: 1,
  })
})

test('round matching gives a constrained learner their only slot without losing flexible learner coverage', () => {
  const data = fixture()
  data.trainers[0].slotCapacity = 1
  data.students = [
    { ...data.students[0], id: 'student-flexible', name: 'A flexible', availableSlots: ['T2-6', 'T4-6'] },
    { ...data.students[0], id: 'student-constrained', name: 'Z constrained', availableSlots: ['T2-6'] },
  ]
  data.contracts = data.students.map((student) => ({ ...fixture().contracts[0], id: `contract-${student.id}`, studentId: student.id }))
  const generated = generateSchedule(data)
  const byStudent = new Map(Object.entries(generated.schedule).flatMap(([slotId, entries]) => entries.map((entry) => [entry.studentId, slotId])))
  assert.equal(byStudent.get('student-constrained'), 'T2-6')
  assert.equal(byStudent.get('student-flexible'), 'T4-6')
  assert.equal(generated.optimizationSummary.studentCoverage.studentsWithAtLeastOne, 2)
})

test('unassigned learners balance unique teaching slots by daily target', () => {
  const data = fixture()
  const slots = ['T2-6', 'T2-7', 'T2-8', 'T2-9']
  data.trainers = ['trainer-a', 'trainer-b'].map((id) => ({
    ...data.trainers[0], id, availableSlots: slots, slotCapacity: 1, dailySessionTarget: 8, dailySessionLimit: 10,
  }))
  data.students = Array.from({ length: 4 }, (_, index) => ({
    ...data.students[0], id: `student-${index}`, name: `Student ${index}`, availableSlots: slots,
  }))
  data.contracts = data.students.map((student) => ({
    ...fixture().contracts[0], id: `contract-${student.id}`, studentId: student.id, trainerId: '', trainerIds: [],
  }))
  const generated = generateSchedule(data)
  const mondayLoads = generated.optimizationSummary.trainerLoads.filter((load) => load.day === 'T2')
  assert.deepEqual(mondayLoads.map((load) => [load.trainerId, load.teachingSlots]), [['trainer-a', 2], ['trainer-b', 2]])
})

test('trainer rank breaks equal-load ties for a learner without assignment', () => {
  const data = fixture()
  data.contracts[0].trainerId = ''
  data.trainers = [
    { ...data.trainers[0], id: 'trainer-low', schedulingPriority: 9 },
    { ...data.trainers[0], id: 'trainer-high', schedulingPriority: 1 },
  ]
  const generated = generateSchedule(data)
  assert.equal(Object.values(generated.schedule).flat().find((entry) => entry.studentId === 'student-a').trainerId, 'trainer-high')
})

test('primary trainer remains ahead of secondary trainer regardless of rank', () => {
  const data = fixture()
  data.contracts[0].trainerId = 'trainer-primary'
  data.contracts[0].trainerIds = ['trainer-secondary']
  data.trainers = [
    { ...data.trainers[0], id: 'trainer-primary', schedulingPriority: 100 },
    { ...data.trainers[0], id: 'trainer-secondary', schedulingPriority: 1 },
  ]
  const generated = generateSchedule(data)
  assert.equal(Object.values(generated.schedule).flat().find((entry) => entry.studentId === 'student-a').trainerId, 'trainer-primary')
})

test('paired learners count as one teaching slot and daily target never blocks an extra class', () => {
  const data = fixture()
  data.trainers[0].dailySessionTarget = 1
  data.trainers[0].dailySessionLimit = 1
  data.trainers[0].availableSlots.push('T2-7')
  data.students.push({ ...data.students[0], id: 'student-b', name: 'B', availableSlots: ['T2-6', 'T2-7'] })
  data.contracts.push({ ...data.contracts[0], id: 'contract-b', studentId: 'student-b' })
  data.schedule = {
    'T2-6': [{ studentId: 'student-a', trainerId: 'trainer-a', contractId: 'contract-a', branchId: BRANCH, type: 'training', isLocked: true }],
  }
  const pairCandidate = candidateForSlot(data, { student: data.students[1], trainer: data.trainers[0], slotId: 'T2-6', schedule: data.schedule })
  const newSlotCandidate = candidateForSlot(data, { student: data.students[1], trainer: data.trainers[0], slotId: 'T2-7', schedule: data.schedule })
  assert.equal(pairCandidate.eligible, true)
  assert.equal(newSlotCandidate.eligible, true)
  const generated = generateSchedule(data)
  const mondayLoad = generated.optimizationSummary.trainerLoads.find((load) => load.trainerId === 'trainer-a' && load.day === 'T2')
  assert.equal(mondayLoad.teachingSlots, 1)
  assert.equal(mondayLoad.studentSessions, 2)
})

test('full-time trainer is filled before a higher-ranked collaborator', () => {
  const data = fixture()
  data.contracts[0].trainerId = ''
  data.trainers = [
    { ...data.trainers[0], id: 'trainer-full', employmentType: 'full_time', schedulingPriority: 999 },
    { ...data.trainers[0], id: 'trainer-ctv', employmentType: 'collaborator', schedulingPriority: 1 },
  ]
  const generated = generateSchedule(data)
  assert.equal(Object.values(generated.schedule).flat()[0].trainerId, 'trainer-full')
})

test('collaborator receives work after full-time trainer reaches the daily target', () => {
  const data = fixture()
  const targetSlots = Array.from({ length: 8 }, (_, index) => `T2-${index + 6}`)
  data.schedule = Object.fromEntries(targetSlots.map((slotId, index) => [slotId, [{
    studentId: `locked-${index}`,
    trainerId: 'trainer-full',
    branchId: BRANCH,
    type: 'training',
    isLocked: true,
  }]]))
  data.students[0].availableSlots = ['T2-14']
  data.contracts[0].trainerId = ''
  data.trainers = [
    { ...data.trainers[0], id: 'trainer-full', employmentType: 'full_time', dailySessionTarget: 8, availableSlots: [...targetSlots, 'T2-14'] },
    { ...data.trainers[0], id: 'trainer-ctv', employmentType: 'collaborator', schedulingPriority: 1, availableSlots: ['T2-14'] },
  ]
  const generated = generateSchedule(data)
  assert.equal(generated.schedule['T2-14'][0].trainerId, 'trainer-ctv')
})

test('pairing an existing class is preferred over opening another trainer slot', () => {
  const data = fixture()
  data.contracts[0].trainerId = ''
  data.schedule = {
    'T2-6': [{ studentId: 'student-b', trainerId: 'trainer-a', branchId: BRANCH, type: 'training', isLocked: true }],
  }
  data.trainers = [
    { ...data.trainers[0], id: 'trainer-a', employmentType: 'full_time', slotCapacity: 2 },
    { ...data.trainers[0], id: 'trainer-b', employmentType: 'full_time', slotCapacity: 2 },
  ]
  const generated = generateSchedule(data)
  const entry = generated.schedule['T2-6'].find((item) => item.studentId === 'student-a')
  assert.equal(entry.trainerId, 'trainer-a')
})

test('existing secondary PT pair is preferred over opening a new primary PT class', () => {
  const data = fixture()
  data.contracts[0].trainerId = 'trainer-primary'
  data.contracts[0].trainerIds = ['trainer-secondary']
  data.schedule = {
    'T2-6': [{ studentId: 'student-b', trainerId: 'trainer-secondary', branchId: BRANCH, type: 'training', isLocked: true }],
  }
  data.trainers = [
    { ...data.trainers[0], id: 'trainer-primary', schedulingPriority: 1 },
    { ...data.trainers[0], id: 'trainer-secondary', schedulingPriority: 100 },
  ]
  const generated = generateSchedule(data)
  const entry = generated.schedule['T2-6'].find((item) => item.studentId === 'student-a')
  assert.equal(entry.trainerId, 'trainer-secondary')
})

test('pairing remains ahead of PT load balancing after every learner receives coverage', () => {
  const data = fixture()
  data.contracts[0].trainerId = ''
  data.contracts[0].trainerIds = []
  data.schedule = {
    'T2-6': [{ studentId: 'student-existing', trainerId: 'trainer-busy', branchId: BRANCH, type: 'training', isLocked: true }],
    'T2-7': [{ studentId: 'locked-7', trainerId: 'trainer-busy', branchId: BRANCH, type: 'training', isLocked: true }],
    'T2-8': [{ studentId: 'locked-8', trainerId: 'trainer-busy', branchId: BRANCH, type: 'training', isLocked: true }],
  }
  data.students[0].availableSlots = ['T2-6', 'T2-9']
  data.trainers = [
    { ...data.trainers[0], id: 'trainer-busy', availableSlots: ['T2-6', 'T2-7', 'T2-8', 'T2-9'], slotCapacity: 2 },
    { ...data.trainers[0], id: 'trainer-empty', availableSlots: ['T2-6', 'T2-9'], slotCapacity: 2 },
  ]
  const generated = generateSchedule(data)
  const learnerEntry = generated.schedule['T2-6'].find((entry) => entry.studentId === 'student-a')
  assert.equal(learnerEntry.trainerId, 'trainer-busy')
  assert.equal(generated.optimizationSummary.studentCoverage.missingSessions, 0)
  assert.equal(generated.optimizationSummary.slotUtilization.pairedSlots, 1)
})

test('live round occupancy pairs learners before reopening their separate primary PT classes', () => {
  const data = fixture()
  data.trainers = [
    { ...data.trainers[0], id: 'trainer-a', slotCapacity: 2, availableSlots: ['T2-6'] },
    { ...data.trainers[0], id: 'trainer-b', slotCapacity: 2, availableSlots: ['T2-6'] },
  ]
  data.students = [
    { ...data.students[0], id: 'student-a', name: 'A', availableSlots: ['T2-6'] },
    { ...data.students[0], id: 'student-b', name: 'B', availableSlots: ['T2-6'] },
  ]
  data.contracts = [
    { ...fixture().contracts[0], id: 'contract-a', studentId: 'student-a', trainerId: 'trainer-a' },
    { ...fixture().contracts[0], id: 'contract-b', studentId: 'student-b', trainerId: 'trainer-b' },
  ]

  const generated = generateSchedule(data)
  assert.equal(generated.optimizationSummary.slotUtilization.teachingSlots, 1)
  assert.equal(generated.optimizationSummary.slotUtilization.pairedSlots, 1)
  assert.equal(generated.optimizationSummary.studentCoverage.missingSessions, 0)
  assert.ok(Object.values(generated.schedule).flat().some((entry) => entry.trainerAssignmentWarning === true))
})

test('deep optimization repeats coverage and pairing until the weekly target is fulfilled', () => {
  const data = fixture()
  data.trainers = [
    {
      ...data.trainers[0],
      id: 'trainer-narrow',
      name: 'PT ca hẹp',
      slotCapacity: 1,
      availableSlots: ['T3-6', 'T4-6'],
    },
    {
      ...data.trainers[0],
      id: 'trainer-pair',
      name: 'PT ca đôi',
      slotCapacity: 2,
      availableSlots: ['T2-6', 'T5-6'],
    },
  ]
  data.students = [
    {
      ...data.students[0],
      id: 'student-a-flexible',
      name: 'Z linh hoạt',
      sessionsPerWeek: 1,
      availableSlots: ['T4-6', 'T5-6'],
    },
    {
      ...data.students[0],
      id: 'student-b-pair',
      name: 'A ca đôi',
      sessionsPerWeek: 2,
      availableSlots: ['T2-6', 'T5-6'],
    },
    {
      ...data.students[0],
      id: 'student-c-needs-two',
      name: 'B cần hai buổi',
      sessionsPerWeek: 2,
      availableSlots: ['T3-6', 'T4-6'],
    },
  ]
  data.contracts = data.students.map((student) => ({
    ...fixture().contracts[0],
    id: `contract-${student.id}`,
    studentId: student.id,
    trainerId: student.id === 'student-b-pair' ? 'trainer-pair' : 'trainer-narrow',
    trainerIds: [],
  }))

  const generated = generateSchedule(data)
  const counts = Object.values(generated.schedule).flat().reduce((result, entry) => {
    result.set(entry.studentId, (result.get(entry.studentId) || 0) + 1)
    return result
  }, new Map())
  assert.equal(counts.get('student-a-flexible'), 1)
  assert.equal(counts.get('student-b-pair'), 2)
  assert.equal(counts.get('student-c-needs-two'), 2)
  assert.equal(generated.optimizationSummary.studentCoverage.missingSessions, 0)
  assert.equal(generated.optimizationSummary.slotUtilization.pairedSlots, 1)
  assert.ok(generated.optimizationSummary.optimizationPasses >= 2)
  assert.equal(generated.optimizationSummary.generatorVersion, 'optimizer-v7')
})

test('deep repair relocates an earlier flexible session to increase total weekly coverage', () => {
  const data = fixture()
  data.config.workingDays = ['T2', 'T3', 'T4', 'T5']
  data.config.workingHours = [6]
  data.trainers = [{
    ...data.trainers[0],
    id: 'trainer-only',
    slotCapacity: 1,
    availableSlots: ['T2-6', 'T3-6', 'T4-6', 'T5-6'],
  }]
  data.students = [
    { ...data.students[0], id: 'student-needs-three', name: 'A cần ba', sessionsPerWeek: 3, maxWeeklySessions: 3, availableSlots: ['T3-6', 'T4-6', 'T5-6'] },
    { ...data.students[0], id: 'student-can-move', name: 'B linh hoạt', sessionsPerWeek: 1, maxWeeklySessions: 1, availableSlots: ['T2-6', 'T3-6', 'T4-6'] },
    { ...data.students[0], id: 'student-third', name: 'C', sessionsPerWeek: 1, maxWeeklySessions: 1, availableSlots: ['T3-6', 'T4-6', 'T5-6'] },
  ]
  data.contracts = data.students.map((student) => ({
    ...fixture().contracts[0],
    id: `contract-${student.id}`,
    studentId: student.id,
    trainerId: 'trainer-only',
  }))

  const generated = generateSchedule(data)
  const counts = Object.values(generated.schedule).flat().reduce((result, entry) => {
    result.set(entry.studentId, (result.get(entry.studentId) || 0) + 1)
    return result
  }, new Map())

  assert.equal(generated.optimizationSummary.studentCoverage.scheduledEntries, 4)
  assert.equal(generated.optimizationSummary.repairAssignments, 1)
  assert.equal(generated.optimizationSummary.repairRelocations, 1)
  assert.equal(counts.get('student-needs-three'), 2)
  assert.equal(counts.get('student-can-move'), 1)
  assert.equal(generated.schedule['T2-6'][0].studentId, 'student-can-move')
})

test('deep repair never relocates a locked or manually protected session', () => {
  const data = fixture()
  data.config.workingDays = ['T2', 'T3', 'T4', 'T5']
  data.config.workingHours = [6]
  data.trainers = [{
    ...data.trainers[0],
    id: 'trainer-only',
    slotCapacity: 1,
    availableSlots: ['T2-6', 'T3-6', 'T4-6', 'T5-6'],
  }]
  data.students = [
    { ...data.students[0], id: 'student-needs-three', name: 'A cần ba', sessionsPerWeek: 3, maxWeeklySessions: 3, availableSlots: ['T3-6', 'T4-6', 'T5-6'] },
    { ...data.students[0], id: 'student-locked', name: 'B đã khóa', sessionsPerWeek: 1, maxWeeklySessions: 1, availableSlots: ['T2-6', 'T3-6', 'T4-6'] },
    { ...data.students[0], id: 'student-third', name: 'C', sessionsPerWeek: 1, maxWeeklySessions: 1, availableSlots: ['T3-6', 'T4-6', 'T5-6'] },
  ]
  data.contracts = data.students.map((student) => ({
    ...fixture().contracts[0],
    id: `contract-${student.id}`,
    studentId: student.id,
    trainerId: 'trainer-only',
  }))
  data.schedule = {
    'T4-6': [{
      studentId: 'student-locked',
      trainerId: 'trainer-only',
      contractId: 'contract-student-locked',
      branchId: BRANCH,
      type: 'training',
      source: 'manual_v2',
      isLocked: true,
    }],
  }

  const generated = generateSchedule(data)
  assert.equal(generated.schedule['T4-6'].length, 1)
  assert.equal(generated.schedule['T4-6'][0].studentId, 'student-locked')
  assert.equal(generated.schedule['T4-6'][0].isLocked, true)
})

test('pair compaction merges two compatible mutable single classes', () => {
  const data = fixture()
  data.students.push({ ...data.students[0], id: 'student-b', name: 'B' })
  data.contracts.push({ ...data.contracts[0], id: 'contract-b', studentId: 'student-b' })
  const result = compactPairedSlots(data, {
    'T2-6': [{ studentId: 'student-a', trainerId: 'trainer-a', contractId: 'contract-a', branchId: BRANCH, type: 'training', source: 'auto_v4' }],
    'T4-6': [{ studentId: 'student-b', trainerId: 'trainer-a', contractId: 'contract-b', branchId: BRANCH, type: 'training', source: 'auto_v4' }],
  })
  assert.equal(result.moves, 1)
  assert.equal(Object.values(result.schedule).filter((entries) => entries.length === 2).length, 1)
  assert.equal(Object.keys(result.schedule).length, 1)
})

test('pair compaction never moves a locked source entry', () => {
  const data = fixture()
  data.students.push({ ...data.students[0], id: 'student-b', name: 'B' })
  data.contracts.push({ ...data.contracts[0], id: 'contract-b', studentId: 'student-b' })
  const locked = { studentId: 'student-a', trainerId: 'trainer-a', contractId: 'contract-a', branchId: BRANCH, type: 'training', source: 'published_existing', isLocked: true }
  const result = compactPairedSlots(data, {
    'T2-6': [locked],
    'T4-6': [{ studentId: 'student-b', trainerId: 'trainer-a', contractId: 'contract-b', branchId: BRANCH, type: 'training', source: 'auto_v4' }],
  })
  assert.equal(result.schedule['T2-6'][0], locked)
  assert.equal(result.schedule['T2-6'].some((entry) => entry.studentId === 'student-a'), true)
})

test('pair compaction does not create a duplicate learner day', () => {
  const data = fixture()
  data.students.push({ ...data.students[0], id: 'student-b', name: 'B', availableSlots: ['T3-6'] })
  data.contracts.push({ ...data.contracts[0], id: 'contract-b', studentId: 'student-b' })
  data.students[0].availableSlots = ['T2-6', 'T3-6', 'T3-7']
  data.trainers[0].availableSlots = [...data.students[0].availableSlots]
  const result = compactPairedSlots(data, {
    'T2-6': [{ studentId: 'student-a', trainerId: 'trainer-a', contractId: 'contract-a', branchId: BRANCH, type: 'training', source: 'auto_v4' }],
    'T3-6': [{ studentId: 'student-b', trainerId: 'trainer-a', contractId: 'contract-b', branchId: BRANCH, type: 'training', source: 'published_existing', isLocked: true }],
    'T3-7': [{ studentId: 'student-a', trainerId: 'trainer-a', contractId: 'contract-a', branchId: BRANCH, type: 'training', source: 'published_existing', isLocked: true }],
  })
  assert.equal(result.schedule['T2-6'].some((entry) => entry.studentId === 'student-a'), true)
})

test('pair compaction does not introduce three consecutive training days', () => {
  const data = fixture()
  data.students.push({ ...data.students[0], id: 'student-b', name: 'B', availableSlots: ['T4-6'] })
  data.contracts.push({ ...data.contracts[0], id: 'contract-b', studentId: 'student-b' })
  data.students[0].availableSlots = ['T2-6', 'T3-6', 'T4-6', 'T5-6']
  data.trainers[0].availableSlots = [...data.students[0].availableSlots]
  const result = compactPairedSlots(data, {
    'T2-6': [{ studentId: 'student-a', trainerId: 'trainer-a', contractId: 'contract-a', branchId: BRANCH, type: 'training', source: 'published_existing', isLocked: true }],
    'T3-6': [{ studentId: 'student-a', trainerId: 'trainer-a', contractId: 'contract-a', branchId: BRANCH, type: 'training', source: 'published_existing', isLocked: true }],
    'T4-6': [{ studentId: 'student-b', trainerId: 'trainer-a', contractId: 'contract-b', branchId: BRANCH, type: 'training', source: 'published_existing', isLocked: true }],
    'T5-6': [{ studentId: 'student-a', trainerId: 'trainer-a', contractId: 'contract-a', branchId: BRANCH, type: 'training', source: 'auto_v4' }],
  })
  assert.equal(result.schedule['T5-6'].some((entry) => entry.studentId === 'student-a'), true)
})

test('pairing metrics count unique trainer and hour classes', () => {
  const data = fixture()
  data.trainers.push({ ...data.trainers[0], id: 'trainer-b' })
  const metrics = slotUtilizationForSchedule(data, {
    'T2-6': [
      { studentId: 'student-a', trainerId: 'trainer-a', type: 'training' },
      { studentId: 'student-b', trainerId: 'trainer-a', type: 'training' },
      { studentId: 'student-c', trainerId: 'trainer-b', type: 'training' },
    ],
    'T4-6': [{ studentId: 'student-d', trainerId: 'trainer-a', type: 'training' }],
  })
  assert.deepEqual(metrics, {
    teachingSlots: 3,
    studentSessions: 4,
    pairedSlots: 1,
    singleSlots: 2,
    fullSlots: 1,
    pairRatePercent: 33.3,
    seatUtilizationPercent: 66.7,
  })
})

test('optimizer avoids three consecutive learner training days when a spaced slot exists', () => {
  const data = fixture()
  data.students[0].sessionsPerWeek = 3
  data.students[0].maxWeeklySessions = 3
  data.students[0].availableSlots = ['T2-6', 'T3-6', 'T4-6', 'T5-6']
  data.trainers[0].availableSlots = [...data.students[0].availableSlots]
  const generated = generateSchedule(data)
  const days = Object.entries(generated.schedule)
    .filter(([, entries]) => entries.some((entry) => entry.studentId === 'student-a'))
    .map(([slotId]) => slotId.split('-')[0])
    .sort()
  assert.equal(days.length, 3)
  const dayIndex = new Set(days.map((day) => Number(day.slice(1))))
  assert.equal([...dayIndex].some((day) => dayIndex.has(day + 1) && dayIndex.has(day + 2)), false)
})

test('three consecutive days remain allowed when they are the only way to fulfil the learner target', () => {
  const data = fixture()
  data.students[0].sessionsPerWeek = 3
  data.students[0].maxWeeklySessions = 3
  data.students[0].availableSlots = ['T2-6', 'T3-6', 'T4-6']
  data.trainers[0].availableSlots = [...data.students[0].availableSlots]
  const generated = generateSchedule(data)
  assert.equal(Object.values(generated.schedule).flat().filter((entry) => entry.studentId === 'student-a').length, 3)
  assert.equal(generated.unassignedEntries.length, 0)
})

test('reset draft removes only mutable draft sessions and preserves OFF, locks and published sessions', () => {
  const data = fixture()
  const reset = resetDraftSchedule({ ...data, weekId: WEEK }, {
    'T2-6': [{ studentId: 'student-a', trainerId: 'trainer-a', contractId: 'contract-a', branchId: BRANCH, type: 'training', source: 'auto_v3' }],
    'T3-6': [{ studentId: 'locked', trainerId: 'trainer-a', contractId: 'contract-a', branchId: BRANCH, type: 'training', source: 'manual_v2', isLocked: true }],
    'T4-6': [{ studentId: 'OFF', trainerId: 'trainer-a', branchId: BRANCH, type: 'off', source: 'manual_v2', isLocked: true }],
    'T5-6': [{ studentId: 'published', trainerId: 'trainer-a', contractId: 'contract-a', branchId: BRANCH, type: 'training', source: 'published_existing' }],
  })
  assert.equal(reset['T2-6'], undefined)
  assert.equal(reset['T3-6'][0].studentId, 'locked')
  assert.equal(reset['T4-6'][0].type, 'off')
  assert.equal(reset['T5-6'][0].source, 'published_existing')
})

test('collaborator is never auto-scheduled outside explicitly registered availability', () => {
  const data = fixture()
  data.contracts[0].trainerId = ''
  data.trainers[0].employmentType = 'collaborator'
  data.trainers[0].availabilityMode = 'unrestricted'
  data.trainers[0].availableSlots = []
  const result = candidateForSlot(data, { student: data.students[0], trainer: data.trainers[0], slotId: 'T2-6', schedule: {} })
  assert.equal(result.eligible, false)
  assert.ok(result.reasons.includes('TRAINER_AVAILABILITY_UNCONFIGURED'))
})

test('published sessions are retained and counted once in coverage and PT daily load', () => {
  const data = fixture()
  data.sessions = [{
    id: 'published-a', status: 'scheduled', studentId: 'student-a', trainerId: 'trainer-a', contractId: 'contract-a', branchId: BRANCH, date: WEEK, hour: 6,
  }]
  const generated = generateSchedule(data)
  assert.equal(Object.values(generated.schedule).flat().filter((entry) => entry.studentId === 'student-a').length, 1)
  assert.equal(generated.optimizationSummary.studentCoverage.scheduledEntries, 1)
  assert.equal(generated.optimizationSummary.trainerLoads.find((load) => load.trainerId === 'trainer-a' && load.day === 'T2').teachingSlots, 1)
})

test('legacy published session falls back to the hour encoded in its id', () => {
  const data = fixture()
  data.sessions = [{
    id: 'session-6-student-a', status: 'scheduled', studentId: 'student-a', trainerId: 'trainer-a', contractId: 'contract-a', branchId: BRANCH, date: WEEK,
  }]
  const generated = generateSchedule(data)
  assert.equal(generated.schedule['T2-6'][0].source, 'published_existing')
  assert.equal(generated.optimizationSummary.trainerLoads.find((load) => load.trainerId === 'trainer-a' && load.day === 'T2').teachingSlots, 1)
})

test('blocks leave and paused contracts but treats an outside assigned PT as support warning', () => {
  const data = fixture()
  data.leaves.push({ status: 'approved', trainerId: 'trainer-a', startDate: WEEK, endDate: WEEK })
  let result = candidateForSlot(data, { student: data.students[0], trainer: data.trainers[0], slotId: 'T2-6', schedule: {} })
  assert.ok(result.reasons.includes('TRAINER_ON_LEAVE'))

  data.leaves = []
  data.contracts[0].trainerId = 'trainer-b'
  result = candidateForSlot(data, { student: data.students[0], trainer: data.trainers[0], slotId: 'T2-6', schedule: {} })
  assert.equal(result.eligible, true)
  assert.equal(result.trainerAssignmentWarning, true)
  assert.deepEqual(result.assignedTrainerIds, ['trainer-b'])

  data.contracts[0].trainerId = 'trainer-a'
  data.contracts[0].pausePeriods = [{ startDate: WEEK, endDate: WEEK }]
  result = candidateForSlot(data, { student: data.students[0], trainer: data.trainers[0], slotId: 'T2-6', schedule: {} })
  assert.ok(result.reasons.includes('CONTRACT_PAUSED'))
})

test('published support PT session stays linked and visibly warned', () => {
  const data = fixture()
  data.contracts[0].trainerId = 'trainer-primary'
  data.sessions = [{
    id: 'published-support', status: 'scheduled', studentId: 'student-a', trainerId: 'trainer-a', branchId: BRANCH, date: WEEK, hour: 6,
  }]
  const generated = generateSchedule(data)
  const entry = generated.schedule['T2-6'][0]
  assert.equal(entry.contractId, 'contract-a')
  assert.equal(entry.trainerAssignmentWarning, true)
  assert.equal(generated.optimizationSummary.studentCoverage.missingSessions, 0)
})

test('uses an available support PT in the same branch when assigned PTs cannot teach', () => {
  const data = fixture()
  data.contracts[0].trainerId = 'trainer-primary'
  data.contracts[0].trainerIds = ['trainer-secondary']
  const generated = generateSchedule(data)
  const entry = Object.values(generated.schedule).flat().find((item) => item.studentId === 'student-a')
  assert.equal(entry.trainerId, 'trainer-a')
  assert.equal(entry.trainerAssignmentWarning, true)
  assert.equal(generated.optimizationSummary.studentCoverage.missingSessions, 0)
  assert.ok(generated.warnings.some((warning) => warning.code === 'TRAINER_ASSIGNMENT_MISMATCH'
    && warning.studentId === 'student-a'
    && warning.trainerId === 'trainer-a'))
})

test('does not warn when learner has no primary or secondary trainer', () => {
  const data = fixture()
  data.contracts[0].trainerId = ''
  data.contracts[0].trainerIds = []
  const generated = generateSchedule(data)
  const entry = Object.values(generated.schedule).flat().find((item) => item.studentId === 'student-a')
  assert.equal(entry.trainerAssignmentWarning, undefined)
  assert.ok(!generated.warnings.some((warning) => warning.code === 'TRAINER_ASSIGNMENT_MISMATCH'))
})

test('deterministic generator preserves locked entries and binds contract ids', () => {
  const data = fixture()
  data.schedule = {
    'T4-6': [{ studentId: 'student-locked', trainerId: 'trainer-a', branchId: BRANCH, type: 'training', isLocked: true }],
  }
  const first = generateSchedule(data)
  const second = generateSchedule(data)
  assert.deepEqual(first, second)
  assert.equal(first.schedule['T4-6'][0].studentId, 'student-locked')
  const generated = Object.values(first.schedule).flat().find((entry) => entry.studentId === 'student-a')
  assert.equal(generated.contractId, 'contract-a')
})
