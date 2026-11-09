'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const {
  availabilityMilestoneAt,
  availabilityReceivedNotification,
  availabilityReopenedNotification,
  clockWindowContains,
  contractPausedForWholeWeek,
  feedbackInviteCandidates,
  formatWeekRange,
  insideQuietHours,
  nextWeekMonday,
  oneDeliveryPerUserRounds,
  paymentClaimReceivedNotification,
  planAvailabilityReminders,
  planContractLifecycleReminders,
  planFeedbackInvites,
  planSchedulePublishedNotices,
  planSessionLeadReminders,
  planSessionReminders,
  pushEligible,
  schedulableStudentIds,
  sessionChangedNotification,
  withinLeadWindow,
} = require('./student-reminders')

const indexSource = readFileSync(join(__dirname, 'index.js'), 'utf8')
const ptOperationsSource = readFileSync(join(__dirname, 'pt-operations-v2.js'), 'utf8')
const sessionOperationsSource = readFileSync(join(__dirname, 'session-operations.js'), 'utf8')
const publishSource = readFileSync(join(__dirname, 'pt-schedule-publish.js'), 'utf8')
const scheduleV2Source = readFileSync(join(__dirname, 'pt-schedule-v2.js'), 'utf8')
const paymentsSource = readFileSync(join(__dirname, 'installment-payments.js'), 'utf8')
const feedbackSource = readFileSync(join(__dirname, 'session-feedback.js'), 'utf8')
const { FEEDBACK_WINDOW_HOURS } = require('./student-reminders')

function students(...rows) {
  return new Map(rows.map(([id, value]) => [id, { accountUid: `uid-${id}`, status: 'active', name: `Học viên ${id}`, ...value }]))
}

test('evening reminder groups tomorrow\'s sessions per learner and skips everyone else', () => {
  const sessions = [
    { id: 's1', data: { studentId: 'a', trainerId: 't1', date: '2026-11-11', hour: 18, status: 'scheduled' } },
    { id: 's2', data: { studentId: 'a', trainerId: 't2', date: '2026-11-11', hour: 7, status: 'rescheduled' } },
    { id: 's3', data: { studentId: 'b', trainerId: 't1', date: '2026-11-11', hour: 19, status: 'cancelled' } },
    { id: 's4', data: { studentId: 'c', trainerId: 't1', date: '2026-11-12', hour: 19, status: 'scheduled' } },
    { id: 's5', data: { studentId: 'd', trainerId: 't1', date: '2026-11-11', hour: 9, status: 'scheduled' } },
    { id: 's6', data: { studentId: 'e', trainerId: 't1', date: '2026-11-11', hour: 9, status: 'scheduled' } },
    { id: 's7', data: { studentId: 'f', trainerId: 't1', date: '2026-11-11', hour: 9, status: 'scheduled' } },
  ]
  const roster = students(['a', {}], ['b', {}], ['c', {}], ['d', { accountUid: '' }], ['e', { status: 'inactive' }], ['f', { accountStatus: 'disabled' }])
  const trainers = new Map([['t1', { name: 'PT Minh' }], ['t2', { name: 'PT Lan' }]])
  const plan = planSessionReminders({ sessions, students: roster, trainers, today: '2026-11-10', deadlineHours: 12 })
  assert.equal(plan.length, 1)
  const [delivery] = plan
  assert.equal(delivery.userId, 'uid-a')
  assert.equal(delivery.title, 'Mai bạn có 2 buổi PT')
  assert.equal(delivery.message, '07:00 PT Lan, 18:00 PT Minh. Cần đổi hoặc hủy, hãy gửi yêu cầu ít nhất 12 giờ trước buổi.')
  assert.equal(delivery.dedupeKey, 'session-d1-2026-11-11-a')
  assert.equal(delivery.category, 'workout')
  assert.equal(delivery.kind, 'session_d1')
  assert.equal(delivery.actionUrl, '#/schedule?tab=this-week')
  assert.deepEqual(delivery.entity, { date: '2026-11-11', sessionIds: ['s2', 's1'] })
  assert.equal(delivery.expiresAt.toISOString(), '2026-11-17T17:00:00.000Z')
})

test('a single session names the trainer and the exact change deadline', () => {
  const sessions = [{ id: 's1', data: { studentId: 'a', trainerId: 't1', date: '2026-11-11', hour: 18, status: 'scheduled' } }]
  const trainers = new Map([['t1', { name: 'PT Minh' }]])
  const plan = planSessionReminders({ sessions, students: students(['a', {}]), trainers, today: '2026-11-10', deadlineHours: 12 })
  assert.equal(plan[0].title, 'Mai bạn có buổi PT 18:00')
  assert.equal(plan[0].message, 'T4 11/11 · PT Minh. Cần đổi hoặc hủy, hãy gửi yêu cầu trước 06:00 ngày mai.')
  const early = planSessionReminders({ sessions: [{ id: 's1', data: { studentId: 'a', trainerId: 't1', date: '2026-11-11', hour: 7, status: 'scheduled' } }], students: students(['a', {}]), trainers, today: '2026-11-10', deadlineHours: 12 })
  assert.equal(early[0].message, 'T4 11/11 · PT Minh. Cần đổi hoặc hủy, hãy gửi yêu cầu trước 19:00 hôm nay.')
})

test('a Sunday run links tomorrow\'s Monday session to the next-week tab', () => {
  const sessions = [{ id: 's1', data: { studentId: 'a', trainerId: 't1', date: '2026-11-16', hour: 18, status: 'scheduled' } }]
  const plan = planSessionReminders({ sessions, students: students(['a', {}]), today: '2026-11-15' })
  assert.equal(plan[0].actionUrl, '#/schedule?tab=next-week')
  assert.equal(plan[0].message.startsWith('T2 16/11 · PT Aura.'), true)
})

test('only learners with a schedulable active contract are reminded about availability', () => {
  const contracts = [
    { id: 'c1', data: { studentId: 'a', status: 'active', endDate: '2027-01-01', totalSessions: 24, usedSessions: 10 } },
    { id: 'c2', data: { studentId: 'b', status: 'active', endDate: '2026-11-15', totalSessions: 24, usedSessions: 10 } },
    { id: 'c3', data: { studentId: 'c', status: 'active', endDate: '2027-01-01', totalSessions: 24, usedSessions: 24 } },
    { id: 'c4', data: { studentId: 'd', status: 'frozen', endDate: '2027-01-01', totalSessions: 24, usedSessions: 1 } },
    { id: 'c5', data: { studentId: 'e', status: 'active', endDate: '2027-01-01', remainingSessions: 3, pausePeriods: [{ type: 'off', startDate: '2026-11-16', endDate: '2026-11-22' }] } },
    { id: 'c6', data: { studentId: 'f', status: 'active', endDate: '2027-01-01', remainingSessions: 3, pausePeriods: [{ type: 'off', startDate: '2026-11-16', endDate: '2026-11-18' }] } },
    { id: 'c7', data: { studentId: 'g', status: 'active', startDate: '2026-12-01', endDate: '2027-01-01', remainingSessions: 3 } },
  ]
  assert.deepEqual([...schedulableStudentIds({ contracts, weekId: '2026-11-16' })].sort(), ['a', 'f'])
  assert.equal(contractPausedForWholeWeek(contracts[4].data, '2026-11-16'), true)
  assert.equal(contractPausedForWholeWeek(contracts[5].data, '2026-11-16'), false)
})

test('availability reminder copy follows the fallback source and skips weeks already submitted', () => {
  const roster = students(['a', {}], ['b', {}], ['c', {}], ['d', {}], ['e', { accountUid: '' }])
  const availabilityByStudent = new Map([
    ['a', { source: 'weekly', slots: ['T2-18'] }],
    ['b', { source: 'inherited_weekly', sourceWeekId: '2026-11-02', slots: ['T2-18', 'T4-18', 'T6-18', 'T3-19', 'T5-19', 'T7-09'] }],
    ['c', { source: 'legacy_default', slots: ['T2-18', 'T4-18'] }],
    ['d', { source: 'none', slots: [] }],
    ['e', { source: 'none', slots: [] }],
  ])
  const cutoffAt = new Date('2026-11-15T12:00:00+07:00')
  const now = new Date('2026-11-14T18:05:00+07:00')
  const plan = planAvailabilityReminders({ students: roster, availabilityByStudent, schedulableIds: new Set(['a', 'b', 'c', 'd', 'e', 'z']), weekId: '2026-11-16', cutoffAt, now })
  assert.deepEqual(plan.map((item) => item.userId), ['uid-b', 'uid-c', 'uid-d'])
  assert.equal(plan[0].title, 'Còn 18 giờ để gửi lịch rảnh')
  assert.equal(plan[0].message, 'Tuần 16–22/11: chưa gửi thì Aura dùng lịch tuần 02/11 của bạn (6 khung). Chốt lúc 12:00 CN 15/11.')
  assert.equal(plan[0].priority, 'normal')
  assert.equal(plan[1].message, 'Tuần 16–22/11: Aura sẽ dùng lịch mặc định cũ trong hồ sơ (2 khung) nếu bạn không gửi. Chốt lúc 12:00 CN 15/11.')
  assert.equal(plan[2].message, 'Tuần 16–22/11: bạn chưa có lịch rảnh nào nên Aura sẽ không xếp được buổi. Chốt lúc 12:00 CN 15/11.')
  assert.equal(plan[2].priority, 'high')
  assert.equal(plan[0].dedupeKey, 'availability-2026-11-16-before-18h-b')
  assert.equal(plan[0].actionUrl, '#/student-availability?week=2026-11-16')
  assert.equal(plan[0].category, 'availability')
  assert.equal(plan[0].dateString, '2026-11-14')
  assert.equal(plan[0].expiresAt.toISOString(), '2026-11-29T17:00:00.000Z')
})

test('reminder windows open once per hour and the cutoff window is relative to policy', () => {
  const cutoffAt = new Date('2026-11-15T12:00:00+07:00')
  assert.equal(withinLeadWindow(new Date('2026-11-14T18:05:00+07:00'), cutoffAt, 18), true)
  assert.equal(withinLeadWindow(new Date('2026-11-14T17:59:00+07:00'), cutoffAt, 18), false)
  assert.equal(withinLeadWindow(new Date('2026-11-14T19:00:00+07:00'), cutoffAt, 18), false)
  assert.equal(clockWindowContains(19 * 60, '19:00'), true)
  assert.equal(clockWindowContains(19 * 60 + 59, '19:00'), true)
  assert.equal(clockWindowContains(20 * 60, '19:00'), false)
  assert.equal(clockWindowContains(19 * 60, 'nonsense'), true)
  assert.equal(nextWeekMonday('2026-11-09'), '2026-11-16')
  assert.equal(nextWeekMonday('2026-11-15'), '2026-11-16')
  assert.equal(nextWeekMonday('2026-11-16'), '2026-11-23')
  assert.equal(formatWeekRange('2026-11-30'), '30/11–06/12')
})

test('push follows the learner\'s preferences and quiet hours; the inbox never depends on them', () => {
  const session = { kind: 'session_d1', category: 'workout' }
  const availability = { kind: 'availability_remind', category: 'availability' }
  const evening = new Date('2026-11-10T19:05:00+07:00')
  const night = new Date('2026-11-10T22:00:00+07:00')
  assert.equal(pushEligible(undefined, session, evening), true)
  assert.equal(pushEligible({ notificationSettings: { enabled: false } }, session, evening), false)
  assert.equal(pushEligible({ notificationSettings: { sessionReminders: false } }, session, evening), false)
  assert.equal(pushEligible({ notificationSettings: { workoutReminders: false } }, session, evening), false)
  assert.equal(pushEligible({ notificationSettings: { availabilityReminders: false } }, availability, evening), false)
  assert.equal(pushEligible({ notificationSettings: { availabilityReminders: false } }, session, evening), true)
  assert.equal(pushEligible({ notificationSettings: {} }, session, night), false)
  assert.equal(pushEligible({ notificationSettings: { quietHoursEnabled: false } }, session, night), true)
  assert.equal(insideQuietHours({ quietHoursStart: '23:00', quietHoursEnd: '06:00' }, night), false)
  assert.equal(insideQuietHours({ quietHoursStart: '23:00', quietHoursEnd: '06:00', timezone: 'Not/AZone' }, new Date('2026-11-10T23:30:00+07:00')), true)
})

test('the availability receipt is one refreshed inbox item per week', () => {
  const receipt = availabilityReceivedNotification({ accountUid: 'uid-a', studentId: 'a', weekId: '2026-11-16', slotCount: 6, requiredSessions: 3, revision: 2 })
  assert.equal(receipt.dedupeKey, 'availability-2026-11-16-received-a')
  assert.equal(receipt.title, 'Đã nhận lịch rảnh tuần 16–22/11')
  assert.equal(receipt.message, '6 khung · 3 buổi mỗi tuần. Aura xếp lịch sau giờ chốt và sẽ báo cho bạn.')
  assert.equal(receipt.category, 'availability')
  assert.equal(receipt.kind, 'availability_received')
  assert.deepEqual(receipt.entity, { weekId: '2026-11-16', revision: '2' })
})

test('availability milestones open 72, 18 and 3 hours before the cutoff and right after it', () => {
  const cutoffAt = new Date('2026-11-15T12:00:00+07:00')
  const at = (value) => availabilityMilestoneAt(new Date(value), cutoffAt)
  assert.deepEqual(at('2026-11-12T12:05:00+07:00'), { id: 'before_72h', leadHours: 72 })
  assert.deepEqual(at('2026-11-14T18:05:00+07:00'), { id: 'before_18h', leadHours: 18 })
  assert.deepEqual(at('2026-11-15T09:05:00+07:00'), { id: 'before_3h', leadHours: 3 })
  assert.deepEqual(at('2026-11-15T12:05:00+07:00'), { id: 'locked', leadHours: 0 })
  assert.equal(at('2026-11-15T13:05:00+07:00'), null)
  assert.equal(at('2026-11-13T12:05:00+07:00'), null)
})

test('the 72-hour reminder asks early; the cutoff notice reaches everyone but pushes only to learners without a week', () => {
  const roster = students(['a', {}], ['b', {}], ['c', {}], ['r', {}])
  const availabilityByStudent = new Map([
    ['a', { source: 'weekly', slots: ['T2-18', 'T4-18', 'T6-18', 'T3-18', 'T5-18'] }],
    ['b', { source: 'inherited_weekly', sourceWeekId: '2026-11-02', slots: ['T2-18'] }],
    ['c', { source: 'none', slots: [] }],
    ['r', { source: 'none', slots: [], reopenedUntil: '2026-11-23T00:00:00+07:00' }],
  ])
  const cutoffAt = new Date('2026-11-15T12:00:00+07:00')
  const early = planAvailabilityReminders({ students: roster, availabilityByStudent, schedulableIds: new Set(['a', 'b', 'c', 'r']), weekId: '2026-11-16', cutoffAt, now: new Date('2026-11-12T12:05:00+07:00'), milestone: { id: 'before_72h', leadHours: 72 } })
  assert.deepEqual(early.map((item) => item.studentId), ['b', 'c'])
  assert.equal(early[0].title, 'Tuần sau bạn rảnh khi nào?')
  assert.equal(early[0].message, 'Gửi lịch rảnh tuần 16–22/11 trước 12:00 CN 15/11. Chưa gửi thì Aura dùng lịch tuần 02/11 của bạn (1 khung).')
  assert.equal(early[1].message, 'Gửi lịch rảnh tuần 16–22/11 trước 12:00 CN 15/11 để Aura xếp được buổi cho bạn.')
  assert.equal(early[0].dedupeKey, 'availability-2026-11-16-before-72h-b')

  const locked = planAvailabilityReminders({ students: roster, availabilityByStudent, schedulableIds: new Set(['a', 'b', 'c', 'r']), weekId: '2026-11-16', cutoffAt, now: new Date('2026-11-15T12:05:00+07:00'), milestone: 'locked' })
  assert.deepEqual(locked.map((item) => item.studentId), ['a', 'b', 'c'])
  assert.equal(locked[0].title, 'Đã chốt lịch rảnh tuần 16–22/11')
  assert.equal(locked[0].message, 'Aura xếp lịch theo 5 khung bạn đã gửi và sẽ báo khi có lịch tập.')
  assert.equal(locked[0].push, false)
  assert.equal(locked[0].kind, 'availability_locked')
  assert.equal(locked[1].push, undefined)
  assert.equal(locked[2].priority, 'high')
  assert.equal(locked[2].dedupeKey, 'availability-2026-11-16-locked-c')
})

test('the lead reminder targets sessions starting a few hours from now', () => {
  const sessions = [
    { id: 's1', data: { studentId: 'a', trainerId: 't1', date: '2026-11-10', hour: 18, status: 'scheduled' } },
    { id: 's2', data: { studentId: 'b', trainerId: 't1', date: '2026-11-10', hour: 19, status: 'scheduled' } },
    { id: 's3', data: { studentId: 'c', trainerId: 't1', date: '2026-11-10', hour: 18, status: 'cancelled' } },
    { id: 's4', data: { studentId: 'd', trainerId: 't1', date: '2026-11-11', hour: 18, status: 'scheduled' } },
  ]
  const plan = planSessionLeadReminders({ sessions, students: students(['a', {}], ['b', {}], ['c', {}], ['d', {}]), trainers: new Map([['t1', { name: 'PT Minh' }]]), today: '2026-11-10', currentHour: 16, leadHours: 2 })
  assert.equal(plan.length, 1)
  assert.equal(plan[0].title, 'Còn 2 giờ đến buổi PT')
  assert.equal(plan[0].message, '18:00 hôm nay · PT Minh.')
  assert.equal(plan[0].dedupeKey, 'session-soon-s1')
  assert.equal(plan[0].kind, 'session_h2')
  assert.deepEqual(planSessionLeadReminders({ sessions, students: students(['a', {}]), today: '2026-11-10', currentHour: 22, leadHours: 2 }), [])
})

test('feedback invites go to attended sessions still inside the review window and not yet reviewed', () => {
  const now = new Date('2026-11-10T21:00:00+07:00')
  const sessions = [
    { id: 'present', data: { studentId: 'a', trainerId: 't1', date: '2026-11-10', hour: 18, status: 'scheduled', attendanceStatus: 'present' } },
    { id: 'completed', data: { studentId: 'b', trainerId: 't1', date: '2026-11-09', hour: 7, status: 'completed', attendanceStatus: 'pending' } },
    { id: 'no-show', data: { studentId: 'c', trainerId: 't1', date: '2026-11-10', hour: 9, status: 'completed', attendanceStatus: 'no_show' } },
    { id: 'not-ended', data: { studentId: 'd', trainerId: 't1', date: '2026-11-10', hour: 21, status: 'scheduled', attendanceStatus: 'present' } },
    { id: 'too-old', data: { studentId: 'e', trainerId: 't1', date: '2026-11-07', hour: 18, status: 'completed', attendanceStatus: 'present' } },
    { id: 'reviewed', data: { studentId: 'f', trainerId: 't1', date: '2026-11-10', hour: 10, status: 'completed', attendanceStatus: 'present' } },
  ]
  assert.deepEqual(feedbackInviteCandidates({ sessions, now }).map((item) => item.id), ['present', 'completed', 'reviewed'])
  const roster = students(['a', {}], ['b', {}], ['c', {}], ['d', {}], ['e', {}], ['f', {}])
  const plan = planFeedbackInvites({ sessions, students: roster, trainers: new Map([['t1', { name: 'PT Minh' }]]), submittedSessionIds: new Set(['reviewed']), now })
  assert.deepEqual(plan.map((item) => item.dedupeKey), ['feedback-present', 'feedback-completed'])
  assert.equal(plan[0].title, 'Buổi tập hôm nay thế nào?')
  assert.equal(plan[1].title, 'Đánh giá buổi tập T2 09/11')
  assert.equal(plan[0].ctaLabel, 'Đánh giá')
  assert.equal(plan[0].expiresAt.toISOString(), '2026-11-13T12:00:00.000Z')
})

test('a publish notice lists the learner\'s week and replaces the earlier one', () => {
  const notices = [
    { studentId: 'a', accountUid: 'uid-a', hadSessions: false, sessions: [
      { id: 's2', date: '2026-11-18', hour: 18, trainerName: 'PT Minh' },
      { id: 's1', date: '2026-11-16', hour: 18, trainerName: 'PT Minh' },
    ] },
    { studentId: 'b', accountUid: 'uid-b', hadSessions: true, sessions: [
      { id: 's3', date: '2026-11-17', hour: 7, trainerName: 'PT Minh' },
      { id: 's4', date: '2026-11-19', hour: 19, trainerName: 'PT Lan' },
    ] },
    { studentId: 'c', accountUid: 'uid-c', hadSessions: true, sessions: [] },
    { studentId: 'd', accountUid: 'uid-d', hadSessions: false, sessions: [] },
    { studentId: 'e', accountUid: 'uid-e', status: 'inactive', hadSessions: false, sessions: [{ id: 's5', date: '2026-11-16', hour: 9 }] },
  ]
  const plan = planSchedulePublishedNotices({ weekId: '2026-11-16', notices, today: '2026-11-14' })
  assert.deepEqual(plan.map((item) => item.studentId), ['a', 'b', 'c'])
  assert.equal(plan[0].title, 'Lịch tập tuần 16–22/11 đã sẵn sàng')
  assert.equal(plan[0].message, '2 buổi: T2 18:00, T4 18:00 · PT Minh.')
  assert.equal(plan[0].actionUrl, '#/schedule?tab=next-week')
  assert.equal(plan[0].dedupeKey, 'schedule-week-2026-11-16-a')
  assert.equal(plan[1].title, 'Lịch tập tuần 16–22/11 có thay đổi')
  assert.equal(plan[1].message, '2 buổi: T3 07:00 (PT Minh), T5 19:00 (PT Lan).')
  assert.equal(plan[2].message, 'Tuần này không còn buổi nào được xếp. Liên hệ Aura nếu bạn cần thêm buổi.')
  assert.deepEqual(planSchedulePublishedNotices({ weekId: '2026-11-02', notices, today: '2026-11-14' }), [])
})

test('admin edits to a published session tell the learner what changed', () => {
  const base = { accountUid: 'uid-a', studentId: 'a', sessionId: 's1', revision: 3, trainerName: 'PT Minh', today: '2026-11-10' }
  const removed = sessionChangedNotification({ ...base, command: 'remove_student', before: { date: '2026-11-12', hour: 18 } })
  assert.equal(removed.title, 'Buổi PT T5 12/11 18:00 đã hủy')
  assert.equal(removed.priority, 'high')
  assert.equal(removed.dedupeKey, 'session-changed-s1-r3')
  const moved = sessionChangedNotification({ ...base, command: 'move_student', before: { date: '2026-11-12', hour: 18 }, after: { date: '2026-11-13', hour: 19 } })
  assert.equal(moved.title, 'Buổi PT đã dời sang T6 13/11 19:00')
  assert.equal(moved.message, 'Từ T5 12/11 18:00 · PT Minh.')
  assert.equal(moved.actionUrl, '#/schedule?tab=this-week')
  const added = sessionChangedNotification({ ...base, command: 'add_student', after: { date: '2026-11-17', hour: 7 } })
  assert.equal(added.title, 'Aura đã thêm buổi PT T3 17/11 07:00')
  assert.equal(added.actionUrl, '#/schedule?tab=next-week')
  assert.equal(sessionChangedNotification({ ...base, command: 'remove_student', before: { date: '2026-11-08', hour: 18 } }), null)
  assert.equal(sessionChangedNotification({ ...base, accountUid: '', command: 'add_student', after: { date: '2026-11-17', hour: 7 } }), null)
})

test('a reported transfer and a reopened week leave an inbox receipt', () => {
  const claim = paymentClaimReceivedNotification({ accountUid: 'uid-a', claimId: 'ipc_0123456789abcdef0123456789abcdef', revision: 2, packageName: 'PT 24 buổi', amount: 4_000_000, sequence: 2, now: new Date('2026-11-10T10:00:00+07:00') })
  assert.equal(claim.title, 'Đã nhận báo chuyển khoản kỳ 2')
  assert.equal(claim.message, 'PT 24 buổi · 4.000.000đ. Aura sẽ đối soát và báo lại ngay khi xác nhận.')
  assert.equal(claim.dedupeKey, 'installment-claim-0123456789abcdef01234567-r2-received')
  assert.equal(claim.category, 'payment')
  const reopened = availabilityReopenedNotification({ accountUid: 'uid-a', studentId: 'a', weekId: '2026-11-16', reopenedUntil: new Date('2026-11-23T00:00:00+07:00') })
  assert.equal(reopened.title, 'Lịch rảnh tuần 16–22/11 đã mở lại')
  assert.equal(reopened.message, 'Bạn có thể sửa và gửi lại đến hết CN 22/11.')
  assert.equal(reopened.dedupeKey, 'availability-2026-11-16-reopened-a')
})

test('package reminders: few or no sessions left and 14, 3, 0 days before the end, skipping renewed or preserved learners', () => {
  const contracts = [
    { id: 'low', data: { studentId: 'a', status: 'active', packageName: 'PT 24 buổi', endDate: '2027-01-30', totalSessions: 24, usedSessions: 10 } },
    { id: 'out', data: { studentId: 'b', status: 'active', packageName: 'PT 12 buổi', endDate: '2027-01-30', totalSessions: 12, usedSessions: 12 } },
    { id: 'ending', data: { studentId: 'c', status: 'active', packageName: 'PT 24 buổi', endDate: '2026-11-24', totalSessions: 24, usedSessions: 10 } },
    { id: 'today', data: { studentId: 'd', status: 'active', packageName: 'PT 24 buổi', endDate: '2026-11-10', totalSessions: 24, usedSessions: 10 } },
    { id: 'renewed', data: { studentId: 'e', status: 'active', endDate: '2026-11-13', totalSessions: 24, usedSessions: 23 } },
    { id: 'preserved', data: { studentId: 'f', status: 'active', endDate: '2026-11-13', totalSessions: 24, usedSessions: 23, pausePeriods: [{ type: 'preservation', startDate: '2026-11-01', endDate: '2026-11-30' }] } },
    { id: 'frozen', data: { studentId: 'g', status: 'frozen', endDate: '2026-11-13', totalSessions: 24, usedSessions: 23 } },
    { id: 'healthy', data: { studentId: 'h', status: 'active', endDate: '2027-01-30', totalSessions: 24, usedSessions: 2 } },
  ]
  const usageViews = new Map([['low', { contractId: 'low', entitlementSessions: 24, usedSessions: 22, remainingSessions: 2 }]])
  const roster = students(['a', {}], ['b', {}], ['c', {}], ['d', {}], ['e', {}], ['f', {}], ['g', {}], ['h', {}])
  const plan = planContractLifecycleReminders({ contracts, usageViews, students: roster, renewedStudentIds: new Set(['e']), today: '2026-11-10' })
  assert.deepEqual(plan.map((item) => item.dedupeKey), ['contract-sessions-low-low', 'contract-sessions-out-out', 'contract-ending-ending-d14', 'contract-ending-today-d0'])
  assert.equal(plan[0].title, 'Gói tập còn 2 buổi')
  assert.equal(plan[1].title, 'Gói tập đã dùng hết buổi')
  assert.equal(plan[2].title, 'Gói tập còn 14 ngày')
  assert.equal(plan[2].message, 'PT 24 buổi · hết hạn 24/11 · còn 14 buổi. Liên hệ Aura để gia hạn.')
  assert.equal(plan[3].title, 'Gói tập hết hạn hôm nay')
  assert.equal(plan[0].category, 'payment')
})

test('push rounds carry one notice per learner and respect opt-outs', () => {
  const rounds = oneDeliveryPerUserRounds([{ userId: 'a', n: 1 }, { userId: 'b', n: 2 }, { userId: 'a', n: 3 }])
  assert.deepEqual(rounds.map((round) => round.map((item) => item.n)), [[1, 2], [3]])
  const evening = new Date('2026-11-10T19:05:00+07:00')
  assert.equal(pushEligible(undefined, { push: false, category: 'availability' }, evening), false)
  assert.equal(pushEligible({ notificationSettings: { paymentReminders: false } }, { kind: 'installment_due_soon', category: 'payment' }, evening), false)
  assert.equal(pushEligible({ notificationSettings: { paymentReminders: false } }, { kind: 'installment_overdue', category: 'payment' }, evening), true)
})

test('runtime wiring: schedulers exported, receipt hooked into the learner save, PT reminder renders in the bell', () => {
  assert.match(indexSource, /exports\.sendSessionRemindersScheduled = onSchedule\(/)
  assert.match(indexSource, /exports\.sendAvailabilityRemindersScheduled = onSchedule\(/)
  assert.match(indexSource, /schedule: '0 \* \* \* \*'/)
  assert.match(indexSource, /schedule: '5 \* \* \* \*'/)
  // Scheduled inbox items carry the fields the notification page renders.
  assert.match(indexSource, /payload\.kind \? \{ kind: payload\.kind \}/)
  assert.match(indexSource, /payload\.expiresAt instanceof Date/)
  assert.match(indexSource, /if \(category === 'availability'\) return settings\.availabilityReminders !== false/)
  assert.match(ptOperationsSource, /availabilityReceivedNotification\(\{ accountUid: actor\.uid, studentId: profile\.id, weekId/)
  assert.match(indexSource, /exports\.sendContractLifecycleRemindersScheduled = onSchedule\(\{\s+schedule: '30 8 \* \* \*'/)
  assert.match(indexSource, /onSchedulePublished: \(payload\) => deliverSchedulePublishedNotices\(payload\)/)
  assert.equal(indexSource.match(/onSchedulePublished: \(payload\) => deliverSchedulePublishedNotices\(payload\)/g).length, 2)
  assert.equal(indexSource.match(/pushStudentNotices: \(deliveries\) => pushStudentNotices\(deliveries\)/g).length, 2)
  assert.match(indexSource, /await notifyAdminScheduleEdit\(\{ command, payload, week, result \}\)/)
  assert.match(indexSource, /await deliverStudentReminderPushes\(created, new Date\(\)\)/)
  assert.match(publishSource, /await onSchedulePublished\(\{ branchId, weekId: week, version: result\.version, notices: studentNotices \}\)/)
  // The client never receives the learner notice payload from a publish.
  assert.match(publishSource, /const \{ studentNotices, \.\.\.response \} = result/)
  assert.match(scheduleV2Source, /availabilityReopenedNotification\(\{ accountUid, studentId, weekId: week/)
  assert.match(paymentsSource, /paymentClaimReceivedNotification\(\{ accountUid: actor\.uid, claimId, revision/)
  assert.match(feedbackSource, new RegExp(`const FEEDBACK_WINDOW_HOURS = ${FEEDBACK_WINDOW_HOURS}\\b`))
  // The PT attendance reminder used body/route, which the bell never showed.
  const attendance = sessionOperationsSource.slice(sessionOperationsSource.indexOf('notifications/pt-attendance-'), sessionOperationsSource.indexOf('notifications/pt-attendance-') + 900)
  assert.match(attendance, /message: `Bạn còn \$\{count\} buổi/)
  assert.match(attendance, /actionUrl: '#\/staff-schedule'/)
  assert.doesNotMatch(attendance, /\broute:/)
  assert.doesNotMatch(attendance, /\bbody:/)
})
