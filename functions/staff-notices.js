'use strict'

// Notices for PTs and admins in the notification center. Like
// student-reminders.js this module only decides recipients and text; the
// triggers and jobs in index.js load data and deliver.

const {
  addDays,
  expiryDate,
  formatDay,
  formatVnd,
  formatWeekRange,
  hourLabel,
  sessionLabel,
  weekdayLabel,
} = require('./student-reminders')

const ACCOUNT_UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const ADMIN_ROLES = new Set(['admin', 'super_admin'])
const ADMIN_REQUESTS_URL = '#/admin-training-history?focus=requests'
const REQUEST_LABELS = { cancel: 'hủy buổi', reschedule: 'đổi buổi', makeup: 'bù buổi', additional: 'thêm buổi' }
// Mirrors ISSUE_CATEGORIES in session-feedback.js.
const ISSUE_LABELS = { service: 'Dịch vụ', lateness: 'Đến trễ', training_quality: 'Chất lượng buổi tập', safety: 'An toàn', conduct: 'Thái độ' }
const SCHEDULED_STATUSES = new Set(['scheduled', 'rescheduled'])

function validUid(value) {
  return typeof value === 'string' && ACCOUNT_UID_PATTERN.test(value)
}

function dateKey(value) {
  const text = typeof value === 'string' ? value.slice(0, 10) : ''
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function validHour(value) {
  return Number.isInteger(value) && value >= 0 && value <= 23
}

function slotLabel(date, hour) {
  return dateKey(date) && validHour(hour) ? sessionLabel(dateKey(date), hour) : ''
}

function rowData(item) {
  return item && typeof item === 'object' && item.data && typeof item.data === 'object' ? item.data : item
}

/**
 * Admin accounts that approve requests and transfers: active admin and super
 * admin role assignments. A branch-scoped admin only hears about its branches.
 */
function adminRecipientUids(assignments = [], branchId = '', excludeUids = []) {
  const excluded = new Set(excludeUids.filter(Boolean))
  const result = []
  for (const item of assignments) {
    const uid = (item && item.id) || ''
    const data = rowData(item) || {}
    if (!validUid(uid) || excluded.has(uid) || !ADMIN_ROLES.has(data.accessRole)) continue
    if (data.disabled === true || ['inactive', 'disabled', 'suspended'].includes(String(data.status || '').toLowerCase())) continue
    const branchIds = Array.isArray(data.branchIds) ? data.branchIds.filter((value) => typeof value === 'string' && value) : []
    if (data.accessRole !== 'super_admin' && branchId && branchIds.length && !branchIds.includes(branchId)) continue
    if (!result.includes(uid)) result.push(uid)
  }
  return result
}

function staffNotice(userId, fields, today) {
  return {
    userId,
    dateString: today,
    type: 'INFO',
    category: 'operations',
    priority: 'normal',
    expiresAt: expiryDate(today, 14),
    ...fields,
  }
}

/**
 * A new change, cancel, make-up or extra-session request. Admins approve it;
 * when a learner asked, their PT also gets a heads-up.
 */
function sessionRequestNotices({ requestId, request = {}, studentName = 'Học viên', trainerName = 'PT Aura', adminUids = [], today }) {
  if (!requestId || request.status !== 'pending') return []
  const label = REQUEST_LABELS[request.type] || 'đổi lịch'
  const from = slotLabel(request.originalDate, request.originalHour)
  const to = slotLabel(request.newDate, request.newHour)
  const when = request.type === 'additional' ? to : request.type === 'cancel' ? from : [from, to].filter(Boolean).join(' → ')
  const byTrainer = request.requestedBy === 'trainer'
  const deliveries = []
  for (const uid of adminUids) {
    deliveries.push(staffNotice(uid, {
      kind: 'staff_request_pending',
      priority: request.requiresManagerApproval || request.crossBranchWarning ? 'high' : 'normal',
      dedupeKey: `staff-request-${requestId}`,
      actionUrl: ADMIN_REQUESTS_URL,
      ctaLabel: 'Xem yêu cầu',
      entity: { requestId, studentId: request.studentId || '', sessionId: request.sessionId || '' },
      title: byTrainer ? `${trainerName} xin ${label}` : `Học viên xin ${label}`,
      message: [studentName, when, byTrainer ? '' : trainerName].filter(Boolean).join(' · '),
    }, today))
  }
  if (!byTrainer && validUid(request.trainerId) && !adminUids.includes(request.trainerId)) {
    deliveries.push(staffNotice(request.trainerId, {
      kind: 'staff_request_fyi',
      dedupeKey: `staff-request-${requestId}`,
      actionUrl: '#/staff-schedule',
      ctaLabel: 'Mở lịch dạy',
      entity: { requestId, sessionId: request.sessionId || '' },
      title: `${studentName} xin ${label}`,
      message: `${when || 'Buổi tập'}. Admin đang duyệt yêu cầu.`,
    }, today))
  }
  return deliveries
}

/** A learner's OFF or preservation request waiting for an admin. */
function pauseRequestNotices({ requestId, request = {}, studentName = 'Học viên', adminUids = [], today }) {
  if (!requestId || request.status !== 'pending') return []
  const label = request.type === 'preservation' ? 'bảo lưu' : 'OFF'
  const start = dateKey(request.startDate)
  const end = dateKey(request.endDate) || start
  const range = start ? `${formatDay(start)}–${formatDay(end)}` : ''
  const days = Number(request.durationDays) > 0 ? ` (${Number(request.durationDays)} ngày)` : ''
  const late = request.requiresExceptionApproval ? ' · đăng ký trễ, cần duyệt ngoại lệ' : ''
  return adminUids.map((uid) => staffNotice(uid, {
    kind: 'staff_pause_request',
    priority: request.requiresExceptionApproval ? 'high' : 'normal',
    dedupeKey: `staff-pause-${requestId}`,
    actionUrl: ADMIN_REQUESTS_URL,
    ctaLabel: 'Xem yêu cầu',
    entity: { requestId, studentId: request.studentId || '' },
    title: `Yêu cầu ${label} mới`,
    message: `${studentName}${range ? ` · ${range}${days}` : ''}${late}`,
  }, today))
}

/** A learner reported a transfer; finance confirms it. */
function paymentClaimNotices({ claimId, claim = {}, adminUids = [], today }) {
  if (!claimId || claim.status !== 'submitted') return []
  const sequence = Number(claim.sequence) > 0 ? ` · kỳ ${Number(claim.sequence)}` : ''
  return adminUids.map((uid) => staffNotice(uid, {
    type: 'PAYMENT',
    category: 'payment',
    kind: 'staff_claim_pending',
    dedupeKey: `staff-claim-${String(claimId).slice(4, 28)}-r${Number(claim.revision) || 0}`,
    actionUrl: '#/admin-finance',
    ctaLabel: 'Đối soát',
    entity: { claimId: String(claimId), contractId: claim.contractId || '' },
    expiresAt: expiryDate(today, 30),
    title: 'Báo chuyển khoản mới',
    message: `${claim.studentName || 'Học viên'} · ${formatVnd(claim.amount)}${sequence} · ${claim.packageName || 'Gói tập Aura'}`,
  }, today))
}

/** Low scores and safety or conduct issues need an admin's eyes. */
function feedbackReviewNotices({ feedbackId, feedback = {}, trainerName = 'PT Aura', adminUids = [], today }) {
  if (!feedbackId || feedback.status !== 'needs_review') return []
  const when = slotLabel(feedback.sessionDate, feedback.sessionHour)
  const issue = feedback.issueCategory && feedback.issueCategory !== 'none' ? ISSUE_LABELS[feedback.issueCategory] || 'Có vấn đề' : ''
  return adminUids.map((uid) => staffNotice(uid, {
    type: 'ALERT',
    kind: 'staff_feedback_review',
    priority: ['safety', 'conduct'].includes(feedback.issueCategory) ? 'high' : 'normal',
    dedupeKey: `staff-feedback-${String(feedbackId).slice(0, 40)}`,
    actionUrl: '#/admin-trainer-quality',
    ctaLabel: 'Xem phản hồi',
    entity: { feedbackId: String(feedbackId), sessionId: feedback.sessionId || '' },
    expiresAt: expiryDate(today, 30),
    title: `Phản hồi cần xem · ${Number(feedback.overallScore) || 0}/5`,
    message: [trainerName, when ? `buổi ${when}` : '', issue].filter(Boolean).join(' · '),
  }, today))
}

function dayCountsLabel(sessions) {
  const counts = new Map()
  for (const session of sessions) counts.set(session.date, (counts.get(session.date) || 0) + 1)
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([date, count]) => `${weekdayLabel(date)} (${count})`).join(', ')
}

/**
 * After a branch publishes a week: one notice per PT whose classes changed,
 * replacing the earlier notice for that branch and week.
 */
function trainerSchedulePublishedNotices({ weekId, branchId = '', notices = [], today }) {
  if (addDays(weekId, 6) < today) return []
  const range = formatWeekRange(weekId)
  const deliveries = []
  for (const notice of notices) {
    if (!validUid(notice.trainerId) || String(notice.status || '').toLowerCase() === 'inactive') continue
    const sessions = (Array.isArray(notice.sessions) ? notice.sessions : []).filter((session) => dateKey(session.date) && validHour(session.hour))
    if (!notice.hadSessions && !sessions.length) continue
    deliveries.push(staffNotice(notice.trainerId, {
      kind: 'staff_schedule_published',
      priority: notice.hadSessions ? 'high' : 'normal',
      dedupeKey: `staff-schedule-week-${weekId}-${branchId || 'all'}`,
      actionUrl: '#/staff-schedule',
      ctaLabel: 'Mở lịch dạy',
      entity: { weekId, branchId },
      expiresAt: expiryDate(weekId, 14),
      title: notice.hadSessions ? `Lịch dạy tuần ${range} có thay đổi` : `Lịch dạy tuần ${range} đã phát hành`,
      message: sessions.length ? `${sessions.length} ca · ${dayCountsLabel(sessions)}.` : 'Bạn không còn ca dạy nào ở chi nhánh này trong tuần.',
    }, today))
  }
  return deliveries
}

/** The PT side of an admin edit to a published session. */
function trainerSessionChangedNotices({ sessionId, revision, command, before = null, after = null, targetTrainerId = '', sourceTrainerId = '', studentName = 'học viên', today }) {
  if (!sessionId) return []
  const beforeLabel = slotLabel(before?.date, before?.hour)
  const afterLabel = slotLabel(after?.date, after?.hour)
  const latest = [dateKey(before?.date), dateKey(after?.date)].filter(Boolean).sort().at(-1)
  if (!latest || latest < today) return []
  const base = {
    kind: 'staff_session_changed',
    priority: 'high',
    dedupeKey: `staff-session-changed-${sessionId}-r${Number(revision) || 0}`,
    actionUrl: '#/staff-schedule',
    ctaLabel: 'Mở lịch dạy',
    entity: { sessionId, command },
    expiresAt: expiryDate(latest, 7),
  }
  const deliveries = []
  if (command === 'remove_student') {
    if (validUid(targetTrainerId) && beforeLabel) deliveries.push(staffNotice(targetTrainerId, { ...base, title: `Ca ${beforeLabel} với ${studentName} đã hủy`, message: 'Admin đã hủy ca này.' }, today))
    return deliveries
  }
  if (command === 'move_student') {
    const moved = sourceTrainerId && sourceTrainerId !== targetTrainerId
    if (validUid(targetTrainerId) && afterLabel) {
      deliveries.push(staffNotice(targetTrainerId, {
        ...base,
        title: moved ? `Thêm ca ${afterLabel} với ${studentName}` : `Ca với ${studentName} dời sang ${afterLabel}`,
        message: moved ? 'Admin đã chuyển ca này cho bạn.' : `Từ ${beforeLabel || 'lịch cũ'}.`,
      }, today))
    }
    if (moved && validUid(sourceTrainerId) && beforeLabel) {
      deliveries.push(staffNotice(sourceTrainerId, { ...base, title: `Ca ${beforeLabel} với ${studentName} đã chuyển cho PT khác`, message: 'Ca này không còn trong lịch dạy của bạn.' }, today))
    }
    return deliveries
  }
  if (validUid(targetTrainerId) && afterLabel) {
    deliveries.push(staffNotice(targetTrainerId, { ...base, priority: 'normal', title: `Thêm ca ${afterLabel} với ${studentName}`, message: 'Ca đã có trong lịch dạy của bạn.' }, today))
  }
  return deliveries
}

/** Evening-before summary of tomorrow's classes for each PT. */
function planTrainerDayBeforeReminders({ sessions = [], trainers = new Map(), students = new Map(), today }) {
  const tomorrow = addDays(today, 1)
  const byTrainer = new Map()
  for (const item of sessions) {
    const session = rowData(item)
    if (!session || dateKey(session.date) !== tomorrow || !SCHEDULED_STATUSES.has(session.status) || !validHour(session.hour)) continue
    if (!validUid(session.trainerId)) continue
    const rows = byTrainer.get(session.trainerId) || []
    rows.push(session)
    byTrainer.set(session.trainerId, rows)
  }
  const deliveries = []
  for (const [trainerId, rows] of byTrainer) {
    const trainer = trainers.get(trainerId)
    if (trainer && String(trainer.status || '').toLowerCase() === 'inactive') continue
    rows.sort((left, right) => left.hour - right.hour)
    const learners = new Set(rows.map((row) => row.studentId).filter(Boolean))
    const first = rows[0]
    const last = rows[rows.length - 1]
    const single = rows.length === 1
    deliveries.push(staffNotice(trainerId, {
      type: 'REMINDER',
      kind: 'staff_teaching_d1',
      dedupeKey: `staff-teaching-d1-${tomorrow}`,
      actionUrl: '#/staff-schedule',
      ctaLabel: 'Mở lịch dạy',
      entity: { date: tomorrow },
      expiresAt: expiryDate(tomorrow, 3),
      title: single ? `Mai bạn có 1 ca dạy ${hourLabel(first.hour)}` : `Mai bạn có ${rows.length} ca dạy`,
      message: single
        ? `${students.get(first.studentId)?.name || 'Học viên'} · ${weekdayLabel(tomorrow)} ${formatDay(tomorrow)}.`
        : `${hourLabel(first.hour)}–${hourLabel(Math.min(23, last.hour + 1))} · ${learners.size} học viên.`,
    }, today))
  }
  return deliveries
}

module.exports = {
  adminRecipientUids,
  feedbackReviewNotices,
  pauseRequestNotices,
  paymentClaimNotices,
  planTrainerDayBeforeReminders,
  sessionRequestNotices,
  trainerSchedulePublishedNotices,
  trainerSessionChangedNotices,
}
