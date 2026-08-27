'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { candidateForSlot, generateSchedule, resolveContract } = require('./pt-schedule-v2')

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
  }
}

test('resolves exactly one active contract for the concrete session date', () => {
  const data = fixture()
  assert.equal(resolveContract(data, 'student-a', 'trainer-a', '2026-08-24').contract.id, 'contract-a')
  data.contracts[0].startDate = '2026-08-26'
  assert.deepEqual(resolveContract(data, 'student-a', 'trainer-a', '2026-08-24').reasons, ['ACTIVE_CONTRACT_NOT_FOUND'])
  assert.equal(resolveContract(data, 'student-a', 'trainer-a', '2026-08-26').contract.id, 'contract-a')
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

test('blocks leave, trainer assignment mismatch and paused contract', () => {
  const data = fixture()
  data.leaves.push({ status: 'approved', trainerId: 'trainer-a', startDate: WEEK, endDate: WEEK })
  let result = candidateForSlot(data, { student: data.students[0], trainer: data.trainers[0], slotId: 'T2-6', schedule: {} })
  assert.ok(result.reasons.includes('TRAINER_ON_LEAVE'))

  data.leaves = []
  data.contracts[0].trainerId = 'trainer-b'
  result = candidateForSlot(data, { student: data.students[0], trainer: data.trainers[0], slotId: 'T2-6', schedule: {} })
  assert.ok(result.reasons.includes('TRAINER_ASSIGNMENT_MISMATCH'))

  data.contracts[0].trainerId = 'trainer-a'
  data.contracts[0].pausePeriods = [{ startDate: WEEK, endDate: WEEK }]
  result = candidateForSlot(data, { student: data.students[0], trainer: data.trainers[0], slotId: 'T2-6', schedule: {} })
  assert.ok(result.reasons.includes('CONTRACT_PAUSED'))
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
