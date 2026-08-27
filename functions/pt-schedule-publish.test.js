'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { desiredEntries, branchScheduleSnapshot, mergeRestoredBranchSchedule, normalizedDraftSchedule } = require('./pt-schedule-publish')

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

test('rejects entries outside submitted weekly availability', () => {
  const fixture = baseFixture()
  fixture.availability.set('student-a', { studentId: 'student-a', status: 'submitted', slots: ['T3-6'] })
  const result = desiredEntries(fixture)
  assert.ok(result.errors.includes('OUTSIDE_STUDENT_AVAILABILITY'))
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
      { studentId: 'student-a', trainerId: 'trainer-a', type: 'training', isLocked: true },
      { studentId: 'OFF', trainerId: 'trainer-a', type: 'off' },
    ],
  }, BRANCH_ID, students, trainers)
  assert.equal(snapshot['T2-6'].length, 2)
  assert.equal(snapshot['T2-6'][0].branchId, BRANCH_ID)
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
