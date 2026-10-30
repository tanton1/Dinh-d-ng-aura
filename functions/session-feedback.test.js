const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const {
  feedbackEligibility,
  feedbackId,
  feedbackReviewStatus,
  feedbackSummary,
  normalizedFeedbackInput,
  createSessionFeedbackFunctions,
} = require('./session-feedback')
const { reviewFixture, adminRequest } = require('./test-support/review-query-fixture')

test('feedback is deterministic, bounded and only accepts approved tags', () => {
  assert.equal(feedbackId('session-1', 'student-1'), feedbackId('session-1', 'student-1'))
  assert.notEqual(feedbackId('session-1', 'student-1'), feedbackId('session-1', 'student-2'))
  const value = normalizedFeedbackInput({
    overallScore: 5,
    tags: ['motivating', 'clear_guidance', 'motivating'],
    comment: '  PT hướng dẫn rất rõ.  ',
    anonymousToTrainer: true,
    issueCategory: 'none',
  })
  assert.deepEqual(value.tags, ['motivating', 'clear_guidance'])
  assert.equal(value.comment, 'PT hướng dẫn rất rõ.')
  assert.equal(value.anonymousToTrainer, true)
  assert.throws(() => normalizedFeedbackInput({ overallScore: 6 }), /1 đến 5/)
  assert.throws(() => normalizedFeedbackInput({ overallScore: 4, tags: ['forged'] }), /không hợp lệ/)
})

test('only the learner attendance present or late can be rated within 72 hours', () => {
  const session = { studentId: 'student-1', trainerId: 'trainer-1', date: '2026-08-28', hour: 18, status: 'completed' }
  const eligible = feedbackEligibility({
    session,
    attendance: { attendanceStatus: 'late', trainerId: 'trainer-substitute' },
    studentId: 'student-1',
    sessionId: 'session-1',
    now: new Date('2026-08-28T20:00:00+07:00'),
  })
  assert.equal(eligible.trainerId, 'trainer-substitute')
  assert.equal(eligible.attendanceStatus, 'late')
  assert.throws(() => feedbackEligibility({
    session,
    attendance: { attendanceStatus: 'no_show' },
    studentId: 'student-1',
    sessionId: 'session-1',
    now: new Date('2026-08-28T20:00:00+07:00'),
  }), /đã tập/)
  assert.throws(() => feedbackEligibility({
    session,
    attendance: { attendanceStatus: 'present' },
    studentId: 'student-other',
    sessionId: 'session-1',
    now: new Date('2026-08-28T20:00:00+07:00'),
  }), /chính mình/)
  assert.throws(() => feedbackEligibility({
    session,
    attendance: { attendanceStatus: 'present' },
    studentId: 'student-1',
    sessionId: 'session-1',
    now: new Date('2026-09-02T20:00:00+07:00'),
  }), /Thời hạn/)
})

test('low score and safety feedback enter the admin review queue', () => {
  assert.equal(feedbackReviewStatus({ overallScore: 2, issueCategory: 'none' }), 'needs_review')
  assert.equal(feedbackReviewStatus({ overallScore: 5, issueCategory: 'safety' }), 'needs_review')
  assert.equal(feedbackReviewStatus({ overallScore: 4, issueCategory: 'service' }), 'submitted')
})

test('admin summary separates response rate, low scores and unresolved reviews', () => {
  const summary = feedbackSummary([
    { trainerId: 'trainer-a', overallScore: 5, status: 'submitted' },
    { trainerId: 'trainer-a', overallScore: 2, status: 'needs_review' },
    { trainerId: 'trainer-b', overallScore: 4, status: 'resolved' },
  ], 6)
  assert.equal(summary.total, 3)
  assert.equal(summary.averageScore, 3.7)
  assert.equal(summary.lowCount, 1)
  assert.equal(summary.needsReview, 1)
  assert.equal(summary.responseRate, 50)
  assert.equal(summary.byTrainer[0].trainerId, 'trainer-a')
  assert.equal(summary.byTrainer[0].averageScore, 3.5)
})

test('session feedback callables are statically exported and remain callable-only', () => {
  const indexSource = readFileSync(join(__dirname, 'index.js'), 'utf8')
  const rulesSource = readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8')
  for (const name of ['getMyPendingSessionFeedback', 'submitSessionFeedback', 'listTrainerFeedbackAdmin', 'reviewTrainerFeedback']) {
    assert.match(indexSource, new RegExp(`exports\\.${name} = sessionFeedbackFunctions\\.${name}`))
  }
  assert.match(rulesSource, /match \/sessionFeedback\/\{feedbackId\}/)
  assert.match(rulesSource, /match \/sessionFeedbackAuditLogs\/\{logId\}/)
})

function qualityRows(id, extra = {}) {
  return { id, sessionId: id, trainerId: 'pt_a', studentId: `student_${id}`, branchId: 'branch_a',
    sessionDate: '2026-10-31', submittedAt: new Date('2026-11-01T08:00:00+07:00'),
    status: 'submitted', overallScore: 5, ...extra }
}
function attendance(id, extra = {}) {
  return { id, sessionId: id, trainerId: 'pt_a', branchId: 'branch_a', attendanceStatus: 'present', scheduledAt: new Date('2026-10-31T10:00:00+07:00'), ...extra }
}
const qualityInput = { from: '2026-10-01', to: '2026-10-31', trainerId: 'pt_a', branchId: 'branch_a' }
const qualityHandler = fixture => createSessionFeedbackFunctions({ db: fixture.db, onCall: (_options, handler) => handler }).listTrainerFeedbackAdmin

test('quality uses actual PT and branch attendance for session month, including feedback submitted next month', async () => {
  const fixture = reviewFixture({
    sessionFeedback: [qualityRows('s1'), qualityRows('s0', { sessionDate: '2026-09-30', submittedAt: new Date('2026-10-01') })],
    attendanceEvents: [attendance('s1'), attendance('s2', { trainerId: 'pt_b' }), attendance('s3', { branchId: 'branch_b' }), attendance('s4', { attendanceStatus: 'no_show' })],
  })
  const result = await qualityHandler(fixture)(adminRequest(qualityInput))
  assert.equal(result.summary.total, 1)
  assert.equal(result.summary.responseCount, 1)
  assert.equal(result.summary.eligibleAttendanceCount, 1)
  assert.equal(result.summary.responseRate, 100)
  assert.equal(result.periodBasis, 'session_date')
  assert.deepEqual(result.rows.map(row => row.id), ['s1'])
  for (const query of fixture.queries.filter(query => ['sessionFeedback', 'attendanceEvents'].includes(query.name))) {
    assert.ok(query.predicates.some(item => item.field === 'trainerId' && item.value === 'pt_a'))
    assert.ok(query.predicates.some(item => item.field === 'branchId' && item.value === 'branch_a'))
  }
})

test('quality filters before page limit and review status never changes the cohort response rate', async () => {
  const fixture = reviewFixture({
    sessionFeedback: [...Array.from({ length: 600 }, (_, i) => qualityRows(`other_${i}`, { trainerId: 'pt_b', status: 'resolved' })),
      qualityRows('s1', { status: 'needs_review', overallScore: 2 }), qualityRows('s2')],
    attendanceEvents: [attendance('s1'), attendance('s2')],
  })
  const result = await qualityHandler(fixture)(adminRequest({ ...qualityInput, status: 'needs_review', score: 2, pageSize: 1 }))
  assert.equal(result.summary.total, 1)
  assert.equal(result.summary.responseCount, 2)
  assert.equal(result.summary.responseRate, 100)
  assert.equal(result.hasMore, false)
  assert.deepEqual(result.rows.map(row => row.id), ['s1'])
})

test('quality deduplicates sessions and marks capped summaries incomplete instead of an official percentage', async () => {
  const fixture = reviewFixture({ sessionFeedback: [qualityRows('s1'), qualityRows('duplicate', { sessionId: 's1' })], attendanceEvents: [attendance('s1'), attendance('duplicate', { sessionId: 's1' })] })
  const result = await qualityHandler(fixture)(adminRequest(qualityInput))
  assert.equal(result.summary.total, 1)
  assert.equal(result.summary.eligibleAttendanceCount, 1)
  assert.equal(result.summary.responseRate, 100)
  fixture.collections.attendanceEvents = Array.from({ length: 5001 }, (_, i) => attendance(`attendance_${i}`))
  const partial = await qualityHandler(fixture)(adminRequest(qualityInput))
  assert.equal(partial.attendanceTruncated, true)
  assert.equal(partial.summary.responseComplete, false)
  assert.equal(partial.summary.responseRate, null)
  fixture.collections.sessionFeedback = Array.from({ length: 5001 }, (_, i) => qualityRows(`feedback_${i}`))
  const feedbackPartial = await qualityHandler(fixture)(adminRequest(qualityInput))
  assert.equal(feedbackPartial.truncated, true)
  assert.equal(feedbackPartial.summary.complete, false)
})

test('quality pagination reaches every matching row and binds cursors to filters and actor', async () => {
  const fixture = reviewFixture({ sessionFeedback: [qualityRows('s1'), qualityRows('s2'), qualityRows('s3')] })
  const call = qualityHandler(fixture)
  const first = await call(adminRequest({ ...qualityInput, pageSize: 2 }))
  const second = await call(adminRequest({ ...qualityInput, pageSize: 2, cursor: first.nextCursor }))
  assert.deepEqual([...first.rows, ...second.rows].map(row => row.id), ['s3', 's2', 's1'])
  assert.equal(second.hasMore, false)
  await assert.rejects(call(adminRequest({ ...qualityInput, trainerId: 'pt_b', cursor: first.nextCursor })), { code: 'invalid-argument' })
  await assert.rejects(call({ ...adminRequest({ ...qualityInput, cursor: first.nextCursor }), auth: { uid: 'audit_other', token: { role: 'admin' } } }), { code: 'invalid-argument' })
})
