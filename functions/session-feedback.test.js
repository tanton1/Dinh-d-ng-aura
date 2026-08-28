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
} = require('./session-feedback')

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
