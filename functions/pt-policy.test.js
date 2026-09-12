const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  addDateDays,
  assertSessionChangeDeadline,
  assertWeeklyOffDeadline,
  contractDurationMonths,
  inclusiveDateDays,
  normalizedPtOperationsPolicy,
  offRegistrationLimit,
  policyUsageDecision,
  sessionChangeDeadline,
  vietnamMonthKey,
  weeklyOffDeadline,
} = require('./pt-policy')

test('cancel and reschedule bootstrap deadline is exactly twenty-four hours before the session in Vietnam', () => {
  assert.equal(sessionChangeDeadline('2026-08-24', 18).toISOString(), '2026-08-23T11:00:00.000Z')
  assert.doesNotThrow(() => assertSessionChangeDeadline('2026-08-24', 18, new Date('2026-08-23T10:59:59.000Z')))
  assert.doesNotThrow(() => assertSessionChangeDeadline('2026-08-24', 18, new Date('2026-08-23T11:00:00.000Z')))
  assert.throws(() => assertSessionChangeDeadline('2026-08-24', 18, new Date('2026-08-23T11:00:00.001Z')), /24 giờ/)
})

test('monthly change/cancel policy supports one or two complimentary approvals', () => {
  assert.deepEqual(policyUsageDecision(0), { sequence: 1, complimentary: true, countsTowardContract: false, complimentaryLimit: 1 })
  assert.deepEqual(policyUsageDecision(1), { sequence: 2, complimentary: false, countsTowardContract: true, complimentaryLimit: 1 })
  assert.deepEqual(policyUsageDecision(1, 2), { sequence: 2, complimentary: true, countsTowardContract: false, complimentaryLimit: 2 })
  assert.deepEqual(policyUsageDecision(2, 2), { sequence: 3, complimentary: false, countsTowardContract: true, complimentaryLimit: 2 })
  assert.deepEqual(policyUsageDecision(0, 0), { sequence: 1, complimentary: false, countsTowardContract: true, complimentaryLimit: 0 })
  assert.equal(vietnamMonthKey(new Date('2026-08-31T18:30:00.000Z')), '2026-09')
})

test('OFF bootstrap cutoff is Sunday 09:00 Vietnam time before the requested week', () => {
  assert.equal(weeklyOffDeadline('2026-08-24').toISOString(), '2026-08-23T02:00:00.000Z')
  assert.doesNotThrow(() => assertWeeklyOffDeadline('2026-08-24', new Date('2026-08-23T01:59:59.000Z')))
  assert.throws(() => assertWeeklyOffDeadline('2026-08-24', new Date('2026-08-23T02:00:00.000Z')), /09:00 Chủ nhật/)
})

test('OFF allowances follow contract terms and calendar-day extension is cumulative', () => {
  assert.equal(offRegistrationLimit(3), 2)
  assert.equal(offRegistrationLimit(6), 3)
  assert.equal(offRegistrationLimit(12), 5)
  assert.equal(inclusiveDateDays('2026-08-24', '2026-09-06'), 14)
  assert.equal(addDateDays('2026-12-25', 14), '2027-01-08')
  assert.equal(contractDurationMonths({ startDate: '2026-01-31', endDate: '2026-04-30' }, { durationMonths: 3 }), 3)
})

test('Aura operations policy is bounded and customizes deadlines and OFF allowances', () => {
  const policy = normalizedPtOperationsPolicy({
    complimentaryChangeCancelPerMonth: 2,
    sessionChangeDeadlineHours: 24,
    offMaxDaysPerRequest: 10,
    offRegistrationCutoffHour: 9,
    offLimitsByDuration: { threeMonths: 2, sixMonths: 4, twelveMonths: 8 },
  })
  assert.equal(policy.complimentaryChangeCancelPerMonth, 2)
  assert.equal(sessionChangeDeadline('2026-08-24', 18, policy.sessionChangeDeadlineHours).toISOString(), '2026-08-23T11:00:00.000Z')
  assert.equal(weeklyOffDeadline('2026-08-24', policy.offRegistrationCutoffHour).toISOString(), '2026-08-23T02:00:00.000Z')
  assert.equal(offRegistrationLimit(6, policy), 4)
})

test('policy hash and versioned snapshot follow the active Firestore values', () => {
  const { ptOperationsPolicyHash, ptOperationsPolicySnapshot } = require('./pt-policy')
  const values = { sessionChangeDeadlineHours: 36, operationsPolicy: { values: { offRegistrationCutoffHour: 8 } } }
  const hash = ptOperationsPolicyHash(values)
  const snapshot = ptOperationsPolicySnapshot({
    ...values,
    operationsPolicy: { version: 'pt-operations-r9', effectiveFrom: '2026-09-09', hash, values: values.operationsPolicy.values },
  })
  assert.equal(snapshot.sessionChangeDeadlineHours, 36)
  assert.equal(snapshot.offRegistrationCutoffHour, 8)
  assert.equal(snapshot.policyVersion, 'pt-operations-r9')
  assert.equal(snapshot.policyHash, hash)
})
