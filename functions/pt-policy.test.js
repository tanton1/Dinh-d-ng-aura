const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  addDateDays,
  assertSessionChangeDeadline,
  assertWeeklyOffDeadline,
  contractDurationMonths,
  inclusiveDateDays,
  offRegistrationLimit,
  policyUsageDecision,
  sessionChangeDeadline,
  vietnamMonthKey,
  weeklyOffDeadline,
} = require('./pt-policy')

test('cancel and reschedule deadline is exactly twelve hours before the session in Vietnam', () => {
  assert.equal(sessionChangeDeadline('2026-08-24', 18).toISOString(), '2026-08-23T23:00:00.000Z')
  assert.doesNotThrow(() => assertSessionChangeDeadline('2026-08-24', 18, new Date('2026-08-23T22:59:59.000Z')))
  assert.doesNotThrow(() => assertSessionChangeDeadline('2026-08-24', 18, new Date('2026-08-23T23:00:00.000Z')))
  assert.throws(() => assertSessionChangeDeadline('2026-08-24', 18, new Date('2026-08-23T23:00:00.001Z')), /12 giờ/)
})

test('monthly change/cancel policy combines both actions and charges from the second approved request', () => {
  assert.deepEqual(policyUsageDecision(0), { sequence: 1, complimentary: true, countsTowardContract: false })
  assert.deepEqual(policyUsageDecision(1), { sequence: 2, complimentary: false, countsTowardContract: true })
  assert.deepEqual(policyUsageDecision(4), { sequence: 5, complimentary: false, countsTowardContract: true })
  assert.equal(vietnamMonthKey(new Date('2026-08-31T18:30:00.000Z')), '2026-09')
})

test('OFF cutoff is Sunday 10:00 Vietnam time before the requested week', () => {
  assert.equal(weeklyOffDeadline('2026-08-24').toISOString(), '2026-08-23T03:00:00.000Z')
  assert.doesNotThrow(() => assertWeeklyOffDeadline('2026-08-24', new Date('2026-08-23T02:59:59.000Z')))
  assert.throws(() => assertWeeklyOffDeadline('2026-08-24', new Date('2026-08-23T03:00:00.000Z')), /10:00 Chủ nhật/)
})

test('OFF allowances follow contract terms and calendar-day extension is cumulative', () => {
  assert.equal(offRegistrationLimit(3), 1)
  assert.equal(offRegistrationLimit(6), 3)
  assert.equal(offRegistrationLimit(12), 6)
  assert.equal(inclusiveDateDays('2026-08-24', '2026-09-06'), 14)
  assert.equal(addDateDays('2026-12-25', 14), '2027-01-08')
  assert.equal(contractDurationMonths({ startDate: '2026-01-31', endDate: '2026-04-30' }, { durationMonths: 3 }), 3)
})
