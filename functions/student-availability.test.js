'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  effectiveStudentAvailability,
  studentAvailabilityProfilePatch,
} = require('./student-availability')

const TARGET_WEEK = '2026-09-07'

test('exact submitted week always wins over inherited and legacy availability', () => {
  const result = effectiveStudentAvailability({
    targetWeek: TARGET_WEEK,
    exact: { weekId: TARGET_WEEK, status: 'submitted', revision: 2, slots: ['T2-6'] },
    inherited: { weekId: '2026-08-31', status: 'submitted', revision: 4, slots: ['T3-7'] },
    profile: { availableSlots: ['T4-8'], isScheduleConfirmed: true },
  })
  assert.equal(result.source, 'weekly')
  assert.deepEqual(result.slots, ['T2-6'])
  assert.equal(result.targetRevision, 2)
})

test('latest submitted week is inherited before the legacy default', () => {
  const result = effectiveStudentAvailability({
    targetWeek: TARGET_WEEK,
    inherited: { weekId: '2026-08-31', status: 'locked', revision: 3, slots: ['T3-7', 'T5-8'] },
    profile: { availableSlots: ['T4-8'], isScheduleConfirmed: true },
  })
  assert.equal(result.source, 'inherited_weekly')
  assert.equal(result.sourceWeekId, '2026-08-31')
  assert.equal(result.sourceRevision, 3)
  assert.equal(result.targetRevision, 0)
  assert.deepEqual(result.slots, ['T3-7', 'T5-8'])
})

test('a future submission is never inherited backwards', () => {
  const result = effectiveStudentAvailability({
    targetWeek: TARGET_WEEK,
    profile: {
      latestSubmittedAvailability: { weekId: '2026-09-14', status: 'submitted', revision: 1, slots: ['T2-6'] },
      legacyDefaultAvailability: { slots: ['T4-8'], confirmed: true },
    },
  })
  assert.equal(result.source, 'legacy_default')
  assert.deepEqual(result.slots, ['T4-8'])
})

test('unconfirmed legacy defaults remain visible but cannot schedule a learner', () => {
  const result = effectiveStudentAvailability({
    targetWeek: TARGET_WEEK,
    profile: { availableSlots: ['T4-8'], isScheduleConfirmed: false },
  })
  assert.equal(result.source, 'legacy_default')
  assert.equal(result.confirmed, false)
  assert.equal(result.status, 'draft')
})

test('submitting a weekly schedule preserves the old default and advances the latest projection', () => {
  const patch = studentAvailabilityProfilePatch({
    availableSlots: ['T4-8'],
    isScheduleConfirmed: true,
    sessionsPerWeek: 3,
  }, {
    weekId: '2026-08-31',
    status: 'submitted',
    revision: 1,
    slots: ['T2-6', 'T3-7'],
    requiredSessions: 3,
    minimumSlots: 5,
  })
  assert.deepEqual(patch.legacyDefaultAvailability.slots, ['T4-8'])
  assert.equal(patch.legacyDefaultAvailability.confirmed, true)
  assert.equal(patch.latestSubmittedAvailability.weekId, '2026-08-31')
  assert.deepEqual(patch.availableSlots, ['T2-6', 'T3-7'])
})

test('editing an older week never rolls the latest projection backwards', () => {
  const patch = studentAvailabilityProfilePatch({
    latestSubmittedAvailability: { weekId: '2026-09-14', status: 'submitted', revision: 1, slots: ['T2-6'] },
    availableSlots: ['T2-6'],
    isScheduleConfirmed: true,
  }, {
    weekId: TARGET_WEEK,
    status: 'submitted',
    revision: 2,
    slots: ['T3-7'],
  })
  assert.equal(patch.latestSubmittedAvailability, undefined)
  assert.equal(patch.availableSlots, undefined)
})
