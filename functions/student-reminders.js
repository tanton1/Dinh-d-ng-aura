'use strict'

// Learner notices for the notification center: PT session reminders, schedule
// changes, feedback invites, availability cutoff reminders and receipts, and
// package reminders. index.js and the callables load data and deliver; this
// module only decides who receives which text, so every rule is unit-testable.

const TIME_ZONE = 'Asia/Ho_Chi_Minh'
const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const DEFAULT_SESSION_REMINDER_TIME = '19:00'
const DEFAULT_SESSION_LEAD_HOURS = 2
// Availability reminders go out 72, 18 and 3 hours before the weekly cutoff.
const AVAILABILITY_LEAD_HOURS = Object.freeze([72, 18, 3])
// Mirrors FEEDBACK_WINDOW_HOURS in session-feedback.js.
const FEEDBACK_WINDOW_HOURS = 72
// Feedback invites are batched into a few daytime runs instead of every hour.
const FEEDBACK_INVITE_HOURS = Object.freeze([10, 14, 18, 21])
const DEFAULT_QUIET_HOURS = { start: '21:30', end: '07:00' }
const SCHEDULED_SESSION_STATUSES = new Set(['scheduled', 'rescheduled'])
const ACCOUNT_UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const WEEKDAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

function dateKey(value) {
  const text = typeof value === 'string' ? value.slice(0, 10) : ''
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function addDays(key, days) {
  return new Date(Date.parse(`${key}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

function vietnamDateKey(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value)
}

function weekdayIndex(key) {
  return new Date(`${key}T12:00:00Z`).getUTCDay()
}

function mondayOf(key) {
  const index = weekdayIndex(key)
  return addDays(key, index === 0 ? -6 : 1 - index)
}

/** Monday of the week after the one containing `key`. */
function nextWeekMonday(key) {
  return addDays(mondayOf(key), 7)
}

function formatDay(key) {
  const [, month, day] = key.split('-')
  return `${day}/${month}`
}

function formatWeekRange(weekId) {
  const end = addDays(weekId, 6)
  const [, startMonth, startDay] = weekId.split('-')
  const [, endMonth, endDay] = end.split('-')
  return startMonth === endMonth ? `${startDay}–${endDay}/${endMonth}` : `${startDay}/${startMonth}–${endDay}/${endMonth}`
}

function weekdayLabel(key) {
  return WEEKDAY_LABELS[weekdayIndex(key)]
}

function hourLabel(hour) {
  return `${String(hour).padStart(2, '0')}:00`
}

function formatClock(date, timeZone = TIME_ZONE) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}

function sessionStartMillis(key, hour) {
  return Date.parse(`${key}T${hourLabel(hour)}:00+07:00`)
}

/** Midnight (Vietnam) `days` after `key`; Firestore TTL deletes the inbox item after this. */
function expiryDate(key, days) {
  return new Date(`${addDays(key, days)}T00:00:00+07:00`)
}

function clockMinutes(value, fallback) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''))
  return match ? Number(match[1]) * 60 + Number(match[2]) : fallback
}

function zonedMinutes(date, timeZone = TIME_ZONE) {
  let parts
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  }
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]))
  return (values.hour % 24) * 60 + values.minute
}

/** True while the clock (minutes since midnight) is inside the hour that starts at `target` ("HH:mm"). */
function clockWindowContains(currentMinutes, target, windowMinutes = 60) {
  const start = clockMinutes(target, clockMinutes(DEFAULT_SESSION_REMINDER_TIME, 19 * 60))
  return currentMinutes >= start && currentMinutes < start + windowMinutes
}

/** True when `now` falls in the window that opens `leadHours` before the cutoff and lasts `windowMs`. */
function withinLeadWindow(now, cutoffAt, leadHours, windowMs = HOUR_MS) {
  const start = cutoffAt.getTime() - leadHours * HOUR_MS
  return now.getTime() >= start && now.getTime() < start + windowMs
}

function studentAccountUid(student) {
  const value = student?.accountUid
  return typeof value === 'string' && ACCOUNT_UID_PATTERN.test(value) ? value : ''
}

function studentReceivesReminders(student) {
  return Boolean(student) && student.status !== 'inactive' && student.accountStatus !== 'disabled'
}

function validHour(value) {
  return Number.isInteger(value) && value >= 0 && value <= 23
}

function rowData(item) {
  return item && typeof item === 'object' && item.data && typeof item.data === 'object' ? item.data : item
}

/**
 * Evening-before reminder: one inbox item per learner listing tomorrow's
 * scheduled PT sessions. The change hint uses the operations policy deadline.
 */
function planSessionReminders({ sessions = [], students = new Map(), trainers = new Map(), today, deadlineHours = 12 }) {
  const tomorrow = addDays(today, 1)
  const rowsByStudent = new Map()
  for (const item of sessions) {
    const session = rowData(item)
    if (!session || dateKey(session.date) !== tomorrow || !SCHEDULED_SESSION_STATUSES.has(session.status) || !validHour(session.hour)) continue
    const studentId = typeof session.studentId === 'string' ? session.studentId.trim() : ''
    if (!studentId) continue
    const trainerId = typeof session.trainerId === 'string' ? session.trainerId : ''
    const rows = rowsByStudent.get(studentId) || []
    rows.push({
      id: (item && item.id) || session.id || '',
      hour: session.hour,
      trainerName: trainers.get(trainerId)?.name || session.trainerName || 'PT Aura',
    })
    rowsByStudent.set(studentId, rows)
  }
  const tab = mondayOf(tomorrow) === mondayOf(today) ? 'this-week' : 'next-week'
  const deliveries = []
  for (const [studentId, rows] of rowsByStudent) {
    const student = students.get(studentId)
    const accountUid = studentAccountUid(student)
    if (!accountUid || !studentReceivesReminders(student)) continue
    rows.sort((left, right) => left.hour - right.hour)
    const first = rows[0]
    let changeHint
    if (rows.length === 1) {
      const deadline = new Date(sessionStartMillis(tomorrow, first.hour) - deadlineHours * HOUR_MS)
      const deadlineKey = vietnamDateKey(deadline)
      const dayLabel = deadlineKey === today ? 'hôm nay' : deadlineKey === tomorrow ? 'ngày mai' : formatDay(deadlineKey)
      changeHint = `Cần đổi hoặc hủy, hãy gửi yêu cầu trước ${formatClock(deadline)} ${dayLabel}.`
    } else {
      changeHint = `Cần đổi hoặc hủy, hãy gửi yêu cầu ít nhất ${deadlineHours} giờ trước buổi.`
    }
    const detail = rows.length === 1
      ? `${weekdayLabel(tomorrow)} ${formatDay(tomorrow)} · ${first.trainerName}`
      : rows.map((row) => `${hourLabel(row.hour)} ${row.trainerName}`).join(', ')
    deliveries.push({
      userId: accountUid,
      studentId,
      dateString: today,
      category: 'workout',
      type: 'REMINDER',
      kind: 'session_d1',
      priority: 'normal',
      dedupeKey: `session-d1-${tomorrow}-${studentId}`,
      actionUrl: `#/schedule?tab=${tab}`,
      ctaLabel: 'Mở lịch',
      entity: { date: tomorrow, sessionIds: rows.map((row) => row.id).filter(Boolean) },
      expiresAt: expiryDate(tomorrow, 7),
      title: rows.length === 1 ? `Mai bạn có buổi PT ${hourLabel(first.hour)}` : `Mai bạn có ${rows.length} buổi PT`,
      message: `${detail}. ${changeHint}`,
    })
  }
  return deliveries
}

function contractPausedForWholeWeek(contract, weekId) {
  const periods = Array.isArray(contract?.pausePeriods) ? contract.pausePeriods : []
  if (!periods.length) return false
  for (let offset = 0; offset < 7; offset += 1) {
    const day = addDays(weekId, offset)
    const covered = periods.some((period) => {
      const start = dateKey(period?.startDate)
      const end = dateKey(period?.endDate) || start
      return start && end && day >= start && day <= end
    })
    if (!covered) return false
  }
  return true
}

function contractRemainingSessions(contract) {
  const stored = Number(contract?.remainingSessions)
  if (Number.isFinite(stored)) return Math.max(0, stored)
  return Math.max(0, Number(contract?.totalSessions || 0) - Number(contract?.usedSessions || 0))
}

/** Learners who still need next week's slots: an active contract with quota that can be scheduled in that week. */
function schedulableStudentIds({ contracts = [], weekId }) {
  const weekEnd = addDays(weekId, 6)
  const result = new Set()
  for (const item of contracts) {
    const contract = rowData(item)
    if (!contract || String(contract.status || '').toLowerCase() !== 'active') continue
    const studentId = typeof contract.studentId === 'string' ? contract.studentId.trim() : ''
    if (!studentId) continue
    const startDate = dateKey(contract.startDate)
    const endDate = dateKey(contract.endDate)
    if (endDate && endDate < weekId) continue
    if (startDate && startDate > weekEnd) continue
    if (contractRemainingSessions(contract) <= 0) continue
    if (contractPausedForWholeWeek(contract, weekId)) continue
    result.add(studentId)
  }
  return result
}

function cutoffLabelFor(cutoffAt) {
  const cutoffKey = vietnamDateKey(cutoffAt)
  return `${formatClock(cutoffAt)} ${weekdayLabel(cutoffKey)} ${formatDay(cutoffKey)}`
}

function availabilitySource(availability) {
  const source = availability?.source || 'none'
  if (source === 'inherited_weekly' && !availability.sourceWeekId) return 'none'
  return ['weekly', 'inherited_weekly', 'legacy_default'].includes(source) ? source : 'none'
}

function slotCountOf(availability) {
  return Array.isArray(availability?.slots) ? availability.slots.length : 0
}

function availabilityReminderCopy({ availability, weekId, cutoffAt, hoursLeft, leadHours = hoursLeft }) {
  const range = formatWeekRange(weekId)
  const cutoffLabel = cutoffLabelFor(cutoffAt)
  const source = availabilitySource(availability)
  const slotCount = slotCountOf(availability)
  if (leadHours >= 48) {
    const title = 'Tuần sau bạn rảnh khi nào?'
    if (source === 'inherited_weekly') return { title, priority: 'normal', message: `Gửi lịch rảnh tuần ${range} trước ${cutoffLabel}. Chưa gửi thì Aura dùng lịch tuần ${formatDay(availability.sourceWeekId)} của bạn (${slotCount} khung).` }
    if (source === 'legacy_default') return { title, priority: 'normal', message: `Gửi lịch rảnh tuần ${range} trước ${cutoffLabel}. Chưa gửi thì Aura dùng lịch mặc định cũ trong hồ sơ (${slotCount} khung).` }
    return { title, priority: 'high', message: `Gửi lịch rảnh tuần ${range} trước ${cutoffLabel} để Aura xếp được buổi cho bạn.` }
  }
  const title = `Còn ${hoursLeft} giờ để gửi lịch rảnh`
  if (source === 'inherited_weekly') {
    return { title, priority: 'normal', message: `Tuần ${range}: chưa gửi thì Aura dùng lịch tuần ${formatDay(availability.sourceWeekId)} của bạn (${slotCount} khung). Chốt lúc ${cutoffLabel}.` }
  }
  if (source === 'legacy_default') {
    return { title, priority: 'normal', message: `Tuần ${range}: Aura sẽ dùng lịch mặc định cũ trong hồ sơ (${slotCount} khung) nếu bạn không gửi. Chốt lúc ${cutoffLabel}.` }
  }
  return { title, priority: 'high', message: `Tuần ${range}: bạn chưa có lịch rảnh nào nên Aura sẽ không xếp được buổi. Chốt lúc ${cutoffLabel}.` }
}

function availabilityLockedCopy({ availability, weekId }) {
  const title = `Đã chốt lịch rảnh tuần ${formatWeekRange(weekId)}`
  const source = availabilitySource(availability)
  const slotCount = slotCountOf(availability)
  if (source === 'weekly') return { title, priority: 'normal', message: `Aura xếp lịch theo ${slotCount} khung bạn đã gửi và sẽ báo khi có lịch tập.` }
  if (source === 'inherited_weekly') return { title, priority: 'normal', message: `Bạn chưa gửi lịch mới nên Aura dùng lịch tuần ${formatDay(availability.sourceWeekId)} (${slotCount} khung).` }
  if (source === 'legacy_default') return { title, priority: 'normal', message: `Aura dùng lịch mặc định cũ trong hồ sơ (${slotCount} khung).` }
  return { title, priority: 'high', message: 'Bạn chưa có lịch rảnh nên Aura chưa xếp được buổi. Hãy nhắn PT hoặc Aura để được hỗ trợ.' }
}

/**
 * Which availability milestone, if any, is open at `now` for a week whose
 * cutoff is `cutoffAt`: one hour-long window per lead time, plus the hour
 * right after the cutoff for the "locked" notice.
 */
function availabilityMilestoneAt(now, cutoffAt, leads = AVAILABILITY_LEAD_HOURS, windowMs = HOUR_MS) {
  for (const leadHours of leads) {
    if (withinLeadWindow(now, cutoffAt, leadHours, windowMs)) return { id: `before_${leadHours}h`, leadHours }
  }
  if (now.getTime() >= cutoffAt.getTime() && now.getTime() < cutoffAt.getTime() + windowMs) return { id: 'locked', leadHours: 0 }
  return null
}

function normalizedMilestone(milestone) {
  if (milestone && typeof milestone === 'object') return milestone
  const match = /^before_(\d+)h$/.exec(String(milestone || ''))
  if (match) return { id: milestone, leadHours: Number(match[1]) }
  return milestone === 'locked' ? { id: 'locked', leadHours: 0 } : { id: 'before_18h', leadHours: 18 }
}

/**
 * Availability notices for one week. Before the cutoff only learners without a
 * submission of their own for that week are reminded; at the cutoff every
 * schedulable learner gets a summary, pushed only to those without one.
 * `availabilityByStudent` holds the effective availability for `weekId`.
 */
function planAvailabilityReminders({ students = new Map(), availabilityByStudent = new Map(), schedulableIds, weekId, cutoffAt, now, milestone = 'before_18h' }) {
  const stage = normalizedMilestone(milestone)
  const locked = stage.id === 'locked'
  const hoursLeft = Math.max(1, Math.round((cutoffAt.getTime() - now.getTime()) / HOUR_MS))
  const deliveries = []
  for (const studentId of schedulableIds) {
    const student = students.get(studentId)
    const accountUid = studentAccountUid(student)
    if (!accountUid || !studentReceivesReminders(student)) continue
    const availability = availabilityByStudent.get(studentId)
    // An admin reopened this week for the learner; neither a reminder nor a
    // "locked" notice is true for them.
    if (availability?.reopenedUntil) continue
    const source = availabilitySource(availability)
    if (!locked && source === 'weekly') continue
    const copy = locked
      ? availabilityLockedCopy({ availability, weekId })
      : availabilityReminderCopy({ availability, weekId, cutoffAt, hoursLeft, leadHours: stage.leadHours })
    deliveries.push({
      userId: accountUid,
      studentId,
      dateString: vietnamDateKey(now),
      category: 'availability',
      type: locked ? 'INFO' : 'REMINDER',
      kind: locked ? 'availability_locked' : 'availability_remind',
      dedupeKey: `availability-${weekId}-${String(stage.id).replace(/[^A-Za-z0-9]+/g, '-')}-${studentId}`,
      actionUrl: `#/student-availability?week=${weekId}`,
      ctaLabel: locked ? 'Xem lịch rảnh' : 'Gửi lịch rảnh',
      entity: { weekId, source },
      expiresAt: expiryDate(weekId, 14),
      ...(locked && source === 'weekly' ? { push: false } : {}),
      ...copy,
    })
  }
  return deliveries
}

/** Inbox receipt written right after a learner saves a week; one item per week, refreshed on resubmission. */
function availabilityReceivedNotification({ accountUid, studentId, weekId, slotCount, requiredSessions, revision }) {
  const range = formatWeekRange(weekId)
  return {
    userId: accountUid,
    title: `Đã nhận lịch rảnh tuần ${range}`,
    message: `${slotCount} khung · ${requiredSessions} buổi mỗi tuần. Aura xếp lịch sau giờ chốt và sẽ báo cho bạn.`,
    type: 'INFO',
    category: 'availability',
    kind: 'availability_received',
    priority: 'normal',
    dedupeKey: `availability-${weekId}-received-${studentId}`,
    actionUrl: `#/student-availability?week=${weekId}`,
    ctaLabel: 'Xem lịch rảnh',
    dateString: weekId,
    entity: { weekId, revision: String(revision ?? 0) },
    expiresAt: expiryDate(weekId, 14),
  }
}

/** Written when an admin reopens one learner's locked week. */
function availabilityReopenedNotification({ accountUid, studentId, weekId, reopenedUntil }) {
  const lastDay = vietnamDateKey(new Date(reopenedUntil.getTime() - 1))
  return {
    userId: accountUid,
    title: `Lịch rảnh tuần ${formatWeekRange(weekId)} đã mở lại`,
    message: `Bạn có thể sửa và gửi lại đến hết ${weekdayLabel(lastDay)} ${formatDay(lastDay)}.`,
    type: 'INFO',
    category: 'availability',
    kind: 'availability_reopened',
    priority: 'high',
    dedupeKey: `availability-${weekId}-reopened-${studentId}`,
    actionUrl: `#/student-availability?week=${weekId}`,
    ctaLabel: 'Gửi lịch rảnh',
    dateString: weekId,
    entity: { weekId },
    expiresAt: expiryDate(weekId, 14),
  }
}

function scheduleTabFor(dateValue, today) {
  const week = mondayOf(dateValue)
  if (week === mondayOf(today)) return 'this-week'
  if (week === nextWeekMonday(today)) return 'next-week'
  return ''
}

function scheduleLink(dateValue, today) {
  const tab = scheduleTabFor(dateValue, today)
  return tab ? `#/schedule?tab=${tab}` : '#/schedule'
}

function sessionLabel(dateValue, hour) {
  return `${weekdayLabel(dateValue)} ${formatDay(dateValue)} ${hourLabel(hour)}`
}

/**
 * Reminder `leadHours` before today's sessions that start at
 * `currentHour + leadHours`. One item per session.
 */
function planSessionLeadReminders({ sessions = [], students = new Map(), trainers = new Map(), today, currentHour, leadHours = DEFAULT_SESSION_LEAD_HOURS }) {
  const targetHour = currentHour + leadHours
  if (!Number.isInteger(targetHour) || targetHour > 23) return []
  const deliveries = []
  for (const item of sessions) {
    const session = rowData(item)
    if (!session || dateKey(session.date) !== today || session.hour !== targetHour || !SCHEDULED_SESSION_STATUSES.has(session.status)) continue
    const studentId = typeof session.studentId === 'string' ? session.studentId.trim() : ''
    const student = students.get(studentId)
    const accountUid = studentAccountUid(student)
    if (!accountUid || !studentReceivesReminders(student)) continue
    const sessionId = (item && item.id) || session.id || ''
    if (!sessionId) continue
    const trainerName = trainers.get(session.trainerId)?.name || session.trainerName || 'PT Aura'
    deliveries.push({
      userId: accountUid,
      studentId,
      dateString: today,
      category: 'workout',
      type: 'REMINDER',
      kind: 'session_h2',
      priority: 'normal',
      dedupeKey: `session-soon-${sessionId}`,
      actionUrl: '#/schedule?tab=this-week',
      ctaLabel: 'Mở lịch',
      entity: { sessionId, date: today },
      expiresAt: expiryDate(today, 2),
      title: `Còn ${leadHours} giờ đến buổi PT`,
      message: `${hourLabel(targetHour)} hôm nay · ${trainerName}.`,
    })
  }
  return deliveries
}

function feedbackEligibleSession(session, now, windowHours) {
  if (!session || !validHour(session.hour) || !dateKey(session.date)) return false
  const attendance = String(session.attendanceStatus || '')
  const attended = ['present', 'late'].includes(attendance) || (session.status === 'completed' && attendance !== 'no_show')
  if (!attended) return false
  const endsAt = sessionStartMillis(dateKey(session.date), session.hour) + HOUR_MS
  // Leave two hours before the feedback window closes so the invite is usable.
  return now.getTime() >= endsAt && now.getTime() < endsAt + (windowHours - 2) * HOUR_MS
}

/** Sessions that can still be reviewed; index.js then checks which already have feedback. */
function feedbackInviteCandidates({ sessions = [], now, windowHours = FEEDBACK_WINDOW_HOURS }) {
  return sessions.filter((item) => {
    const session = rowData(item)
    const studentId = typeof session?.studentId === 'string' ? session.studentId.trim() : ''
    return Boolean(studentId && ((item && item.id) || session.id) && feedbackEligibleSession(session, now, windowHours))
  })
}

function planFeedbackInvites({ sessions = [], students = new Map(), trainers = new Map(), submittedSessionIds = new Set(), now, windowHours = FEEDBACK_WINDOW_HOURS }) {
  const today = vietnamDateKey(now)
  const deliveries = []
  for (const item of feedbackInviteCandidates({ sessions, now, windowHours })) {
    const session = rowData(item)
    const sessionId = (item && item.id) || session.id
    if (submittedSessionIds.has(sessionId)) continue
    const studentId = session.studentId.trim()
    const student = students.get(studentId)
    const accountUid = studentAccountUid(student)
    if (!accountUid || !studentReceivesReminders(student)) continue
    const day = dateKey(session.date)
    const trainerName = trainers.get(session.trainerId)?.name || session.trainerName || 'PT Aura'
    const endsAt = sessionStartMillis(day, session.hour) + HOUR_MS
    deliveries.push({
      userId: accountUid,
      studentId,
      dateString: today,
      category: 'workout',
      type: 'INFO',
      kind: 'feedback_invite',
      priority: 'normal',
      dedupeKey: `feedback-${sessionId}`,
      actionUrl: '#/schedule?tab=this-week',
      ctaLabel: 'Đánh giá',
      entity: { sessionId, date: day },
      expiresAt: new Date(endsAt + windowHours * HOUR_MS),
      title: day === today ? 'Buổi tập hôm nay thế nào?' : `Đánh giá buổi tập ${weekdayLabel(day)} ${formatDay(day)}`,
      message: `${hourLabel(session.hour)} · ${trainerName}. Đánh giá ngắn giúp PT điều chỉnh buổi sau hợp với bạn hơn.`,
    })
  }
  return deliveries
}

function sessionListLabel(sessions) {
  const trainerNames = [...new Set(sessions.map((session) => session.trainerName || 'PT Aura'))]
  const slots = sessions.map((session) => trainerNames.length === 1
    ? `${weekdayLabel(session.date)} ${hourLabel(session.hour)}`
    : `${weekdayLabel(session.date)} ${hourLabel(session.hour)} (${session.trainerName || 'PT Aura'})`)
  return `${sessions.length} buổi: ${slots.join(', ')}${trainerNames.length === 1 ? ` · ${trainerNames[0]}` : ''}.`
}

/**
 * After a branch publishes a week: one item per learner whose sessions were
 * created, moved or cancelled. The id is per learner and week, so a later
 * publish replaces the earlier notice instead of stacking.
 */
function planSchedulePublishedNotices({ weekId, notices = [], today }) {
  if (addDays(weekId, 6) < today) return []
  const deliveries = []
  for (const notice of notices) {
    const accountUid = studentAccountUid(notice)
    if (!accountUid || !studentReceivesReminders(notice) || !notice.studentId) continue
    const sessions = (Array.isArray(notice.sessions) ? notice.sessions : [])
      .filter((session) => dateKey(session.date) && validHour(session.hour))
      .sort((left, right) => `${left.date}-${String(left.hour).padStart(2, '0')}`.localeCompare(`${right.date}-${String(right.hour).padStart(2, '0')}`))
    if (!notice.hadSessions && !sessions.length) continue
    const range = formatWeekRange(weekId)
    deliveries.push({
      userId: accountUid,
      studentId: notice.studentId,
      dateString: today,
      category: 'workout',
      type: 'INFO',
      kind: 'schedule_published',
      priority: notice.hadSessions ? 'high' : 'normal',
      dedupeKey: `schedule-week-${weekId}-${notice.studentId}`,
      actionUrl: scheduleLink(weekId, today),
      ctaLabel: 'Mở lịch',
      entity: { weekId, sessionIds: sessions.map((session) => session.id).filter(Boolean) },
      expiresAt: expiryDate(weekId, 14),
      title: notice.hadSessions ? `Lịch tập tuần ${range} có thay đổi` : `Lịch tập tuần ${range} đã sẵn sàng`,
      message: sessions.length ? sessionListLabel(sessions) : 'Tuần này không còn buổi nào được xếp. Liên hệ Aura nếu bạn cần thêm buổi.',
    })
  }
  return deliveries
}

/** An admin added, moved or cancelled one published session. Past-only corrections are not announced. */
function sessionChangedNotification({ accountUid, studentId, sessionId, revision, command, before = null, after = null, trainerName = 'PT Aura', today }) {
  if (!ACCOUNT_UID_PATTERN.test(String(accountUid || '')) || !sessionId) return null
  const beforeDate = dateKey(before?.date)
  const afterDate = dateKey(after?.date)
  const latest = [beforeDate, afterDate].filter(Boolean).sort().at(-1)
  if (!latest || latest < today) return null
  let title
  let message
  let focusDate = afterDate || beforeDate
  if (command === 'remove_student') {
    if (!beforeDate || !validHour(before.hour)) return null
    title = `Buổi PT ${sessionLabel(beforeDate, before.hour)} đã hủy`
    message = 'Aura đã hủy buổi này và không trừ vào gói tập của bạn.'
    focusDate = beforeDate
  } else if (command === 'move_student' && beforeDate && validHour(before?.hour) && afterDate && validHour(after?.hour)) {
    if (beforeDate === afterDate && before.hour === after.hour) return null
    title = `Buổi PT đã dời sang ${sessionLabel(afterDate, after.hour)}`
    message = `Từ ${sessionLabel(beforeDate, before.hour)} · ${trainerName}.`
  } else if (afterDate && validHour(after?.hour)) {
    title = `Aura đã thêm buổi PT ${sessionLabel(afterDate, after.hour)}`
    message = `Buổi đã có trong lịch tập của bạn · ${trainerName}.`
  } else {
    return null
  }
  return {
    userId: accountUid,
    studentId,
    dateString: today,
    category: 'workout',
    type: 'INFO',
    kind: 'session_changed',
    priority: command === 'remove_student' || command === 'move_student' ? 'high' : 'normal',
    dedupeKey: `session-changed-${sessionId}-r${Number(revision) || 0}`,
    actionUrl: scheduleLink(focusDate, today),
    ctaLabel: 'Mở lịch',
    entity: { sessionId, command },
    expiresAt: expiryDate(latest, 7),
    title,
    message,
  }
}

function formatVnd(value) {
  return `${Math.round(Number(value) || 0).toLocaleString('vi-VN')}đ`
}

/** In-app receipt as soon as a learner reports a transfer; finance's decision arrives later. */
function paymentClaimReceivedNotification({ accountUid, claimId, revision, packageName, amount, sequence, now = new Date() }) {
  const today = vietnamDateKey(now)
  return {
    userId: accountUid,
    title: sequence ? `Đã nhận báo chuyển khoản kỳ ${sequence}` : 'Đã nhận báo chuyển khoản',
    message: `${packageName || 'Gói tập Aura'} · ${formatVnd(amount)}. Aura sẽ đối soát và báo lại ngay khi xác nhận.`,
    type: 'PAYMENT',
    category: 'payment',
    kind: 'claim_received',
    priority: 'normal',
    dedupeKey: `installment-claim-${String(claimId).slice(4, 28)}-r${Number(revision) || 0}-received`,
    actionUrl: '#/schedule?tab=contract',
    ctaLabel: 'Xem gói tập',
    dateString: today,
    entity: { claimId: String(claimId) },
    expiresAt: expiryDate(today, 90),
  }
}

function anyDateKey(value) {
  if (typeof value === 'string') return dateKey(value)
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? vietnamDateKey(value) : ''
  if (value && typeof value.toDate === 'function') {
    const date = value.toDate()
    return date instanceof Date && Number.isFinite(date.getTime()) ? vietnamDateKey(date) : ''
  }
  return ''
}

function preservedOn(contract, today) {
  return (Array.isArray(contract?.pausePeriods) ? contract.pausePeriods : []).some((period) => {
    if (String(period?.type || '').toLowerCase() !== 'preservation') return false
    const start = anyDateKey(period.startDate)
    const end = anyDateKey(period.endDate) || start
    return Boolean(start && end && start <= today && end >= today)
  })
}

function contractSessionCounts(contractId, contract, usageView) {
  const valid = usageView && (!usageView.contractId || usageView.contractId === contractId)
    && usageView.remainingSessions !== undefined && usageView.remainingSessions !== null
    && Number.isFinite(Number(usageView.remainingSessions)) && Number(usageView.remainingSessions) >= 0
    && usageView.evidenceTruncated !== true
  if (valid) {
    return {
      total: Math.max(0, Number(usageView.entitlementSessions ?? contract.totalSessions ?? 0)),
      remaining: Math.max(0, Number(usageView.remainingSessions)),
    }
  }
  const total = Math.max(0, Number(contract.totalSessions || 0))
  return { total, remaining: Math.max(0, total - Math.max(0, Number(contract.usedSessions || 0))) }
}

/**
 * Daily package notices for active contracts: few sessions left, no sessions
 * left, and 14 / 3 / 0 days before the end date. Learners who already have a
 * next package (`renewedStudentIds`) or are in preservation are skipped.
 */
function planContractLifecycleReminders({ contracts = [], usageViews = new Map(), students = new Map(), renewedStudentIds = new Set(), today }) {
  const deliveries = []
  for (const item of contracts) {
    const contract = rowData(item)
    const contractId = (item && item.id) || contract?.id || ''
    if (!contract || !contractId || String(contract.status || '').toLowerCase() !== 'active') continue
    const studentId = typeof contract.studentId === 'string' ? contract.studentId.trim() : ''
    if (!studentId || renewedStudentIds.has(studentId)) continue
    const student = students.get(studentId)
    const accountUid = studentAccountUid(student)
    if (!accountUid || !studentReceivesReminders(student)) continue
    if (preservedOn(contract, today)) continue
    const endDate = anyDateKey(contract.endDate)
    if (!endDate || endDate < today) continue
    const daysLeft = Math.round((Date.parse(`${endDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / DAY_MS)
    const { total, remaining } = contractSessionCounts(contractId, contract, usageViews.get(contractId))
    const packageName = String(contract.packageName || 'Gói tập Aura').slice(0, 120)
    const base = {
      userId: accountUid,
      studentId,
      dateString: today,
      category: 'payment',
      type: 'INFO',
      actionUrl: '#/schedule?tab=contract',
      ctaLabel: 'Xem gói tập',
      entity: { contractId },
      expiresAt: expiryDate(today, 30),
    }
    if (total > 0 && remaining === 0) {
      deliveries.push({ ...base, kind: 'contract_sessions_out', priority: 'high', dedupeKey: `contract-sessions-out-${contractId}`,
        title: 'Gói tập đã dùng hết buổi', message: `${packageName}. Liên hệ Aura để gia hạn và giữ lịch tập với PT.` })
      continue
    }
    const lowThreshold = Math.max(3, Math.ceil(total * 0.1))
    if (total > 0 && remaining <= lowThreshold) {
      deliveries.push({ ...base, kind: 'contract_sessions_low', priority: 'normal', dedupeKey: `contract-sessions-low-${contractId}`,
        title: `Gói tập còn ${remaining} buổi`, message: `${packageName}. Trao đổi với PT hoặc Aura để gia hạn và giữ nhịp tập.` })
    }
    if ([14, 3, 0].includes(daysLeft)) {
      const left = remaining > 0 ? ` · còn ${remaining} buổi` : ''
      deliveries.push({ ...base, kind: 'contract_ending', priority: daysLeft <= 3 ? 'high' : 'normal', dedupeKey: `contract-ending-${contractId}-d${daysLeft}`,
        title: daysLeft === 0 ? 'Gói tập hết hạn hôm nay' : `Gói tập còn ${daysLeft} ngày`,
        message: `${packageName} · hết hạn ${formatDay(endDate)}${left}. Liên hệ Aura để gia hạn.` })
    }
  }
  return deliveries
}

/** Learner preference for the push copy of a delivery; the inbox item is written regardless. */
function pushPreferenceAllows(profile, delivery) {
  if (delivery?.push === false) return false
  const settings = profile?.notificationSettings
  if (!settings || typeof settings !== 'object') return true
  if (settings.enabled === false) return false
  if (delivery.kind === 'session_d1' || delivery.kind === 'session_h2') {
    return settings.sessionReminders !== false && settings.workoutReminders !== false
  }
  if (delivery.category === 'availability') return settings.availabilityReminders !== false
  if (delivery.kind === 'installment_due_soon') return settings.paymentReminders !== false
  return true
}

function insideQuietHours(settings, now, defaults = DEFAULT_QUIET_HOURS) {
  if (settings && settings.quietHoursEnabled === false) return false
  const start = clockMinutes(settings?.quietHoursStart, clockMinutes(defaults.start, 21 * 60 + 30))
  const end = clockMinutes(settings?.quietHoursEnd, clockMinutes(defaults.end, 7 * 60))
  if (start === end) return false
  const current = zonedMinutes(now, typeof settings?.timezone === 'string' && settings.timezone.trim() ? settings.timezone.trim() : TIME_ZONE)
  return start < end ? current >= start && current < end : current >= start || current < end
}

function pushEligible(profile, delivery, now = new Date()) {
  return pushPreferenceAllows(profile, delivery) && !insideQuietHours(profile?.notificationSettings, now)
}

/** Splits deliveries into rounds where each user appears once; the shared FCM helper keys devices by user. */
function oneDeliveryPerUserRounds(deliveries) {
  const rounds = []
  for (const delivery of deliveries) {
    const round = rounds.find((candidate) => !candidate.some((item) => item.userId === delivery.userId))
    if (round) round.push(delivery)
    else rounds.push([delivery])
  }
  return rounds
}

module.exports = {
  AVAILABILITY_LEAD_HOURS,
  DEFAULT_SESSION_LEAD_HOURS,
  DEFAULT_SESSION_REMINDER_TIME,
  FEEDBACK_INVITE_HOURS,
  FEEDBACK_WINDOW_HOURS,
  addDays,
  availabilityLockedCopy,
  availabilityMilestoneAt,
  availabilityReceivedNotification,
  availabilityReminderCopy,
  availabilityReopenedNotification,
  clockWindowContains,
  contractPausedForWholeWeek,
  feedbackInviteCandidates,
  formatWeekRange,
  insideQuietHours,
  mondayOf,
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
  pushPreferenceAllows,
  schedulableStudentIds,
  sessionChangedNotification,
  vietnamDateKey,
  withinLeadWindow,
}
