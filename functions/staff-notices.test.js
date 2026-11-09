'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const {
  adminRecipientUids,
  feedbackReviewNotices,
  pauseRequestNotices,
  paymentClaimNotices,
  planTrainerDayBeforeReminders,
  sessionRequestNotices,
  trainerSchedulePublishedNotices,
  trainerSessionChangedNotices,
} = require('./staff-notices')

const indexSource = readFileSync(join(__dirname, 'index.js'), 'utf8')
const publishSource = readFileSync(join(__dirname, 'pt-schedule-publish.js'), 'utf8')
const feedbackSource = readFileSync(join(__dirname, 'session-feedback.js'), 'utf8')
const today = '2026-11-10'

test('admin recipients are active admins in scope, never the person who acted', () => {
  const assignments = [
    { id: 'admin-a', data: { accessRole: 'admin', branchIds: ['q7'] } },
    { id: 'admin-b', data: { accessRole: 'admin', branchIds: ['q1'] } },
    { id: 'admin-all', data: { accessRole: 'admin', branchIds: [] } },
    { id: 'owner', data: { accessRole: 'super_admin', branchIds: ['q1'] } },
    { id: 'staff-x', data: { accessRole: 'staff', branchIds: ['q7'] } },
    { id: 'admin-off', data: { accessRole: 'admin', status: 'inactive' } },
    { id: 'admin-disabled', data: { accessRole: 'admin', disabled: true } },
    { id: 'bad/id', data: { accessRole: 'admin' } },
  ]
  assert.deepEqual(adminRecipientUids(assignments, 'q7'), ['admin-a', 'admin-all', 'owner'])
  assert.deepEqual(adminRecipientUids(assignments, 'q7', ['admin-a']), ['admin-all', 'owner'])
  assert.deepEqual(adminRecipientUids(assignments, ''), ['admin-a', 'admin-b', 'admin-all', 'owner'])
})

test('a learner request goes to admins to approve and to the PT as a heads-up', () => {
  const request = { status: 'pending', type: 'reschedule', requestedBy: 'student', studentId: 's1', trainerId: 'trainer-1', sessionId: 'session-1', originalDate: '2026-11-12', originalHour: 18, newDate: '2026-11-13', newHour: 19 }
  const notices = sessionRequestNotices({ requestId: 'r1', request, studentName: 'An Nguyễn', trainerName: 'PT Minh', adminUids: ['admin-a'], today })
  assert.equal(notices.length, 2)
  assert.equal(notices[0].userId, 'admin-a')
  assert.equal(notices[0].title, 'Học viên xin đổi buổi')
  assert.equal(notices[0].message, 'An Nguyễn · T5 12/11 18:00 → T6 13/11 19:00 · PT Minh')
  assert.equal(notices[0].actionUrl, '#/admin-training-history?focus=requests')
  assert.equal(notices[0].kind, 'staff_request_pending')
  assert.equal(notices[0].dedupeKey, 'staff-request-r1')
  assert.equal(notices[1].userId, 'trainer-1')
  assert.equal(notices[1].title, 'An Nguyễn xin đổi buổi')
  assert.equal(notices[1].message, 'T5 12/11 18:00 → T6 13/11 19:00. Admin đang duyệt yêu cầu.')
  assert.equal(notices[1].kind, 'staff_request_fyi')

  const byTrainer = sessionRequestNotices({ requestId: 'r2', request: { ...request, requestedBy: 'trainer', type: 'cancel' }, studentName: 'An Nguyễn', trainerName: 'PT Minh', adminUids: ['admin-a'], today })
  assert.deepEqual(byTrainer.map((item) => [item.userId, item.title, item.message]), [['admin-a', 'PT Minh xin hủy buổi', 'An Nguyễn · T5 12/11 18:00']])
  const extra = sessionRequestNotices({ requestId: 'r3', request: { status: 'pending', type: 'additional', studentId: 's1', trainerId: 'trainer-1', newDate: '2026-11-14', newHour: 7, requiresManagerApproval: true }, studentName: 'An', trainerName: 'PT Minh', adminUids: ['admin-a'], today })
  assert.equal(extra[0].title, 'Học viên xin thêm buổi')
  assert.equal(extra[0].message, 'An · T7 14/11 07:00 · PT Minh')
  assert.equal(extra[0].priority, 'high')
  assert.deepEqual(sessionRequestNotices({ requestId: 'r4', request: { ...request, status: 'approved' }, adminUids: ['admin-a'], today }), [])
})

test('OFF, preservation, transfers and low feedback reach admins with a link to act', () => {
  const pause = pauseRequestNotices({ requestId: 'p1', request: { status: 'pending', type: 'preservation', studentId: 's1', startDate: '2026-11-16', endDate: '2026-12-15', durationDays: 30, requiresExceptionApproval: true }, studentName: 'Chi Lê', adminUids: ['admin-a'], today })
  assert.equal(pause[0].title, 'Yêu cầu bảo lưu mới')
  assert.equal(pause[0].message, 'Chi Lê · 16/11–15/12 (30 ngày) · đăng ký trễ, cần duyệt ngoại lệ')
  assert.equal(pause[0].priority, 'high')
  assert.equal(pause[0].dedupeKey, 'staff-pause-p1')

  const claim = paymentClaimNotices({ claimId: 'ipc_0123456789abcdef0123456789abcdef', claim: { status: 'submitted', studentName: 'Dũng Phạm', amount: 4_000_000, sequence: 2, packageName: 'PT 24 buổi', revision: 3 }, adminUids: ['admin-a'], today })
  assert.equal(claim[0].title, 'Báo chuyển khoản mới')
  assert.equal(claim[0].message, 'Dũng Phạm · 4.000.000đ · kỳ 2 · PT 24 buổi')
  assert.equal(claim[0].category, 'payment')
  assert.equal(claim[0].dedupeKey, 'staff-claim-0123456789abcdef01234567-r3')
  assert.equal(claim[0].actionUrl, '#/admin-finance')
  assert.deepEqual(paymentClaimNotices({ claimId: 'x', claim: { status: 'confirmed' }, adminUids: ['admin-a'], today }), [])

  const feedback = feedbackReviewNotices({ feedbackId: 'f'.repeat(40), feedback: { status: 'needs_review', overallScore: 2, sessionDate: '2026-11-11', sessionHour: 18, issueCategory: 'conduct' }, trainerName: 'PT Minh', adminUids: ['admin-a'], today })
  assert.equal(feedback[0].title, 'Phản hồi cần xem · 2/5')
  assert.equal(feedback[0].message, 'PT Minh · buổi T4 11/11 18:00 · Thái độ')
  assert.equal(feedback[0].priority, 'high')
  assert.equal(feedback[0].actionUrl, '#/admin-trainer-quality')
})

test('PTs hear about their week after a publish and about admin edits to their classes', () => {
  const published = trainerSchedulePublishedNotices({ weekId: '2026-11-16', branchId: 'q7', today, notices: [
    { trainerId: 'trainer-1', hadSessions: false, sessions: [{ date: '2026-11-16', hour: 7 }, { date: '2026-11-16', hour: 18 }, { date: '2026-11-18', hour: 18 }] },
    { trainerId: 'trainer-2', hadSessions: true, sessions: [] },
    { trainerId: 'trainer-3', hadSessions: false, sessions: [] },
    { trainerId: 'trainer-4', status: 'inactive', hadSessions: false, sessions: [{ date: '2026-11-16', hour: 7 }] },
  ] })
  assert.deepEqual(published.map((item) => item.userId), ['trainer-1', 'trainer-2'])
  assert.equal(published[0].title, 'Lịch dạy tuần 16–22/11 đã phát hành')
  assert.equal(published[0].message, '3 ca · T2 (2), T4 (1).')
  assert.equal(published[0].dedupeKey, 'staff-schedule-week-2026-11-16-q7')
  assert.equal(published[1].title, 'Lịch dạy tuần 16–22/11 có thay đổi')
  assert.equal(published[1].message, 'Bạn không còn ca dạy nào ở chi nhánh này trong tuần.')

  const base = { sessionId: 's1', revision: 2, studentName: 'An', today }
  const moved = trainerSessionChangedNotices({ ...base, command: 'move_student', before: { date: '2026-11-12', hour: 18 }, after: { date: '2026-11-13', hour: 19 }, targetTrainerId: 'trainer-2', sourceTrainerId: 'trainer-1' })
  assert.deepEqual(moved.map((item) => [item.userId, item.title]), [
    ['trainer-2', 'Thêm ca T6 13/11 19:00 với An'],
    ['trainer-1', 'Ca T5 12/11 18:00 với An đã chuyển cho PT khác'],
  ])
  const sameTrainer = trainerSessionChangedNotices({ ...base, command: 'move_student', before: { date: '2026-11-12', hour: 18 }, after: { date: '2026-11-13', hour: 19 }, targetTrainerId: 'trainer-1', sourceTrainerId: 'trainer-1' })
  assert.deepEqual(sameTrainer.map((item) => [item.title, item.message]), [['Ca với An dời sang T6 13/11 19:00', 'Từ T5 12/11 18:00.']])
  const removed = trainerSessionChangedNotices({ ...base, command: 'remove_student', before: { date: '2026-11-12', hour: 18 }, targetTrainerId: 'trainer-1' })
  assert.equal(removed[0].title, 'Ca T5 12/11 18:00 với An đã hủy')
  assert.deepEqual(trainerSessionChangedNotices({ ...base, command: 'remove_student', before: { date: '2026-11-01', hour: 18 }, targetTrainerId: 'trainer-1' }), [])
})

test('each PT gets one evening summary of tomorrow\'s classes', () => {
  const sessions = [
    { id: 'a', data: { trainerId: 'trainer-1', studentId: 's1', date: '2026-11-11', hour: 18, status: 'scheduled' } },
    { id: 'b', data: { trainerId: 'trainer-1', studentId: 's2', date: '2026-11-11', hour: 7, status: 'scheduled' } },
    { id: 'c', data: { trainerId: 'trainer-1', studentId: 's1', date: '2026-11-11', hour: 19, status: 'rescheduled' } },
    { id: 'd', data: { trainerId: 'trainer-2', studentId: 's3', date: '2026-11-11', hour: 9, status: 'scheduled' } },
    { id: 'e', data: { trainerId: 'trainer-3', studentId: 's3', date: '2026-11-11', hour: 9, status: 'cancelled' } },
    { id: 'f', data: { trainerId: 'trainer-4', studentId: 's3', date: '2026-11-11', hour: 9, status: 'scheduled' } },
  ]
  const trainers = new Map([['trainer-4', { status: 'inactive' }]])
  const students = new Map([['s3', { name: 'Chi Lê' }]])
  const plan = planTrainerDayBeforeReminders({ sessions, trainers, students, today })
  assert.deepEqual(plan.map((item) => [item.userId, item.title, item.message]), [
    ['trainer-1', 'Mai bạn có 3 ca dạy', '07:00–20:00 · 2 học viên.'],
    ['trainer-2', 'Mai bạn có 1 ca dạy 09:00', 'Chi Lê · T4 11/11.'],
  ])
  assert.equal(plan[0].dedupeKey, 'staff-teaching-d1-2026-11-11')
  assert.equal(plan[0].kind, 'staff_teaching_d1')
})

test('runtime wiring: staff triggers, publish payload and feedback categories stay in sync', () => {
  for (const name of ['notifyStaffOnSessionRequest', 'notifyStaffOnLeaveRequest', 'notifyStaffOnPaymentClaim', 'notifyStaffOnSessionFeedback']) {
    assert.match(indexSource, new RegExp(`exports\\.${name} = onDocument(Created|Written)\\(`), name)
  }
  assert.match(indexSource, /document: 'sessionRequests\/\{requestId\}'/)
  assert.match(indexSource, /document: 'leaveRequests\/\{requestId\}'/)
  assert.match(indexSource, /document: 'installmentPaymentClaims\/\{claimId\}'/)
  assert.match(indexSource, /document: 'sessionFeedback\/\{feedbackId\}'/)
  assert.match(indexSource, /staffNotices\.trainerSchedulePublishedNotices\(/)
  assert.match(indexSource, /staffNotices\.trainerSessionChangedNotices\(/)
  assert.match(indexSource, /staffNotices\.planTrainerDayBeforeReminders\(/)
  assert.match(publishSource, /const \{ studentNotices, trainerNotices, \.\.\.response \} = result/)
  const categories = /const ISSUE_CATEGORIES = new Set\(\[([^\]]+)\]\)/.exec(feedbackSource)[1].match(/'([a-z_]+)'/g).map((value) => value.slice(1, -1)).filter((value) => value !== 'none')
  const labels = /const ISSUE_LABELS = \{([^}]+)\}/.exec(readFileSync(join(__dirname, 'staff-notices.js'), 'utf8'))[1]
  for (const category of categories) assert.match(labels, new RegExp(`\\b${category}:`), category)
})
