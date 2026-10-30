const test = require('node:test')
const assert = require('node:assert/strict')
const {
  periodRange,
  sessionMetrics,
  clientCareMetrics,
  nutritionMetrics,
  renewalMetrics,
  loadOperationalSources,
  businessMetrics,
} = require('./performance-automatic')
const { reviewFixture } = require('./test-support/review-query-fixture')

const range = { start: '2026-09-01', end: '2026-09-30', effectiveEnd: '2026-09-08' }

test('Performance reuses queried attendance but still reads substitute attendance for assigned sessions', async () => {
  const occurredAt = new Date('2026-09-04T09:00:00+07:00')
  const fixture = reviewFixture({ sessions: [
    { id: 'delivered', date: '2026-09-04', trainerId: 'pt', studentId: 'a', status: 'completed' },
    { id: 'substituted', date: '2026-09-04', trainerId: 'pt', studentId: 'b', status: 'completed' },
  ], attendanceEvents: [
    { id: 'delivered', sessionId: 'delivered', trainerId: 'pt', attendanceStatus: 'present', occurredAt },
    { id: 'substituted', sessionId: 'substituted', trainerId: 'other', attendanceStatus: 'present', occurredAt },
  ] })
  const source = await loadOperationalSources(fixture.db, { staffId: 'pt', ownerUid: 'pt' }, '2026-09')
  assert.equal(fixture.reads.includes('attendanceEvents/delivered'), false)
  assert.equal(fixture.reads.filter(path => path === 'attendanceEvents/substituted').length, 1)
  assert.equal(source.attendanceBySession.get('substituted').trainerId, 'other')
  assert.equal(sessionMetrics(source).attendance.actual, 50)
})

test('bounded renewal streams preserve due/closed metrics and exclude irrelevant history', async () => {
  const current = new Date('2026-09-05T09:00:00+07:00'), old = new Date('2025-09-05T09:00:00+07:00')
  const cases = [
    { id: 'due', contractSnapshot: { trainerId: 'pt', endDate: '2026-09-30' }, stage: 'contacting', expectedValue: 100 },
    { id: 'won', contractSnapshot: { trainerId: 'pt', endDate: '2026-08-31' }, stage: 'won', wonAt: current, updatedAt: current, expectedValue: 100, collectedValue: 60 },
    { id: 'lost', contractSnapshot: { trainerIds: ['pt'], endDate: '2026-10-30' }, stage: 'lost', updatedAt: current, lostReason: 'Chuyển nơi ở', expectedValue: 100 },
    { id: 'old', contractSnapshot: { trainerId: 'pt', endDate: '2025-09-30' }, stage: 'won', wonAt: old, updatedAt: old },
    { id: 'nutrition_only', contractSnapshot: { nutritionPTIds: ['pt'], endDate: '2026-09-30' }, stage: 'lost', updatedAt: current },
  ]
  const fixture = reviewFixture({ contractRenewalCases: cases })
  const source = await loadOperationalSources(fixture.db, { staffId: 'pt', ownerUid: 'pt' }, '2026-09')
  assert.deepEqual(source.renewalCases.map(row => row.id).sort(), ['due', 'lost', 'won'])
  const actual = renewalMetrics(source), prior = renewalMetrics({ ...source, renewalCases: cases })
  for (const metric of Object.keys(prior)) for (const field of ['actual', 'target', 'numerator', 'denominator', 'sampleSize']) assert.equal(actual[metric][field], prior[metric][field], `${metric}.${field}`)
  assert.ok(fixture.queries.filter(query => query.name === 'contractRenewalCases').every(query => query.predicates.some(predicate => predicate.operator === '>=')))
})

test('referral scoring reuses already loaded contracts without changing the cash threshold', async () => {
  const fixture = reviewFixture({ contracts: [{ id: 'missing', totalPrice: 100 }] })
  const result = await businessMetrics(fixture.db, { ids: ['pt'], range, ledgerEntries: [
    { id: 'one', contractId: 'known', referralStaffId: 'pt', status: 'posted', cashImpact: 30 },
    { id: 'two', contractId: 'missing', referralStaffId: 'pt', status: 'posted', cashImpact: 20 },
  ], contracts: [{ id: 'known', totalPrice: 100 }], salesLeads: [], contractApprovals: [], targets: {} })
  assert.equal(result.quality_new_referral.numerator, 1)
  assert.equal(result.quality_new_referral.denominator, 2)
  assert.deepEqual(fixture.reads, ['contracts/missing'])
})

test('period range follows the Vietnam calendar month and stops current month at today', () => {
  const value = periodRange('2026-09', new Date('2026-09-08T04:00:00Z'))
  assert.equal(value.start, '2026-09-01')
  assert.equal(value.end, '2026-09-30')
  assert.equal(value.effectiveEnd, '2026-09-08')
  assert.equal(value.isCurrentPeriod, true)
  assert.equal(periodRange('2026-08', new Date('2026-09-08T04:00:00Z')).isCurrentPeriod, false)
})

test('session automation attributes delivery to actual attendance trainer and completed notes', () => {
  const sessions = [
    { id: 's1', studentId: 'a', trainerId: 'pt', date: '2026-09-01', status: 'completed' },
    { id: 's2', studentId: 'b', trainerId: 'pt', date: '2026-09-02', status: 'completed' },
    { id: 's3', studentId: 'c', trainerId: 'pt', date: '2026-09-03', status: 'student_cancelled' },
  ]
  const result = sessionMetrics({
    ids: ['pt'], range, sessions,
    attendanceBySession: new Map([
      ['s1', { trainerId: 'pt', attendanceStatus: 'present' }],
      ['s2', { trainerId: 'substitute', attendanceStatus: 'present' }],
    ]),
    workoutLogs: [{ id: 's1_a', sessionId: 's1', status: 'completed' }],
  })
  assert.equal(result.attendance.actual, 50)
  assert.equal(result.attendance.sampleSize, 2)
  assert.equal(result.training_notes.manualScore, 2)
})

test('a substitute trainer receives delivery credit without inheriting schedule responsibility', () => {
  const result = sessionMetrics({
    ids: ['substitute'], range,
    sessions: [{ id: 's1', studentId: 'a', trainerId: 'original', date: '2026-09-01', status: 'completed' }],
    attendanceBySession: new Map([['s1', { trainerId: 'substitute', attendanceStatus: 'present' }]]),
    workoutLogs: [{ id: 's1_a', sessionId: 's1', status: 'completed' }],
  })
  assert.equal(result.attendance.actual, 100)
  assert.equal(result.attendance.sampleSize, 1)
  assert.equal(result.schedule_management.sampleSize, 0)
  assert.equal(result.training_notes.manualScore, 2)
})

test('client care automation uses assigned students, weekly check-ins and recorded care', () => {
  const result = clientCareMetrics({
    ids: ['pt'],
    range,
    contracts: [
      { studentId: 'a', trainerId: 'pt', startDate: '2026-09-01', endDate: '2026-09-30', status: 'active' },
      { studentId: 'b', trainerId: 'pt', startDate: '2026-09-01', endDate: '2026-09-30', status: 'active' },
    ],
    trainerStudents: ['a', 'b'],
    dailyCheckins: [
      { studentId: 'a', date: '2026-09-01' },
      { studentId: 'a', date: '2026-09-08' },
      { studentId: 'b', date: '2026-09-02' },
    ],
    careActivities: [{ studentId: 'a' }],
    projections: [
      { id: 'a', alerts: [{ severity: 'red' }], attendance: { rate28Days: 90 }, training: { adherence28Days: 80 }, progress: { latestDate: '2026-09-04' } },
      { id: 'b', alerts: [], attendance: { rate28Days: 80 }, training: { adherence28Days: 70 }, progress: null },
    ],
  })
  assert.equal(result.weekly_checkin.numerator, 3)
  assert.equal(result.weekly_checkin.denominator, 4)
  assert.equal(result.at_risk_followup.numerator, 1)
  assert.equal(result.communication.manualScore, 1)
})

test('weekly check-in resolves Firebase account UID back to the contract student id', () => {
  const result = clientCareMetrics({
    ids: ['pt'], range,
    contracts: [{ studentId: 'crm-a', trainerId: 'pt', startDate: '2026-09-01', endDate: '2026-09-30', status: 'active' }],
    trainerStudents: ['crm-a'],
    dailyCheckins: [{ studentId: 'account-a', canonicalStudentId: 'crm-a', date: '2026-09-01' }],
    careActivities: [], projections: [],
  })
  assert.equal(result.weekly_checkin.numerator, 1)
  assert.equal(result.weekly_checkin.denominator, 2)
})

test('historical periods never reuse the current Student 360 projection', () => {
  const result = clientCareMetrics({
    ids: ['pt'], range,
    contracts: [{ studentId: 'a', trainerId: 'pt', startDate: '2026-09-01', endDate: '2026-09-30', status: 'active' }],
    trainerStudents: ['a'], dailyCheckins: [], careActivities: [],
    projections: [{ id: 'a', alerts: [{ severity: 'red' }], attendance: { rate28Days: 100 }, training: { adherence28Days: 100 } }],
    projectionMetricsEnabled: false,
  })
  assert.equal(result.client_progress.provenance.completeness, 'partial')
  assert.equal(result.at_risk_followup.denominator, null)
  assert.match(result.progress_review.provenance.warnings[0], /kỳ quá khứ/i)
})

test('nutrition automation measures completion, SLA and compliance only from assigned clients', () => {
  const result = nutritionMetrics({
    ids: ['coach'], range, nutritionStudents: ['a'], accountByStudent: new Map([['a', 'uid-a']]), reviewSlaMinutes: 240,
    dailyCheckins: [{ studentId: 'a', date: '2026-09-02', compliance: 80 }],
    mealReviews: [
      { id: 'm1', userId: 'uid-a', status: 'approved', reviewedBy: 'coach', createdAt: '2026-09-02T01:00:00Z', reviewedAt: '2026-09-02T02:00:00Z' },
      { id: 'm2', userId: 'uid-a', status: 'pending', createdAt: '2026-09-03T01:00:00Z' },
      { id: 'm3', userId: 'other', status: 'approved', createdAt: '2026-09-03T01:00:00Z', updatedAt: '2026-09-03T02:00:00Z' },
    ],
  })
  assert.equal(result.nutrition_review_completion.numerator, 1)
  assert.equal(result.nutrition_review_completion.denominator, 2)
  assert.equal(result.feedback_sla.numerator, 1)
  assert.equal(result.compliance_management.manualScore, 2.4)
})

test('nutrition automation accepts both CRM id and linked account UID', () => {
  const result = nutritionMetrics({
    ids: ['coach'], range, nutritionStudents: ['crm-a'], accountByStudent: new Map([['crm-a', 'uid-a']]), reviewSlaMinutes: 240,
    dailyCheckins: [{ studentId: 'uid-a', canonicalStudentId: 'crm-a', date: '2026-09-02', compliance: 100 }],
    mealReviews: [{ id: 'm1', userId: 'crm-a', status: 'approved', reviewedBy: 'coach', createdAt: '2026-09-02T01:00:00Z', reviewedAt: '2026-09-02T02:00:00Z' }],
  })
  assert.equal(result.nutrition_review_completion.numerator, 1)
  assert.equal(result.compliance_management.manualScore, 3)
})

test('renewal automation counts only assigned cases concluded in the period', () => {
  const result = renewalMetrics({
    ids: ['pt'], range,
    renewalCases: [
      { id: 'won', stage: 'won', wonAt: '2026-09-02', updatedAt: '2026-09-02', expectedValue: 10, collectedValue: 9, contractSnapshot: { trainerId: 'pt', endDate: '2026-09-15' } },
      { id: 'lost', stage: 'lost', updatedAt: '2026-09-03', lostReason: 'Không còn nhu cầu', expectedValue: 10, contractSnapshot: { trainerId: 'pt', endDate: '2026-09-20' } },
      { id: 'other', stage: 'won', wonAt: '2026-09-02', contractSnapshot: { trainerId: 'other', endDate: '2026-09-20' } },
    ],
    renewalActivities: [{ caseId: 'won', createdAt: '2026-09-01' }],
  })
  assert.equal(result.renew_rate.actual, 50)
  assert.equal(result.renewal_process.denominator, 2)
  assert.equal(result.churn_documentation.numerator, 1)
  assert.equal(result.renew_cash_vs_forecast.actual, 9)
  assert.equal(result.renew_cash_vs_forecast.target, 20)
})
