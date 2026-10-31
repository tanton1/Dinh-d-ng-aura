'use strict'

// A published PT slot can exist in both the legacy branch=all schedule and a
// newer branch-scoped schedule row.  Those rows share the scheduleEntryId and
// represent one learner appointment, even when the legacy row was later
// confirmed and the branch row was cancelled/exempt.  Read projections must
// choose one canonical row so a learner is not shown two appointments and a
// no-show is not hidden by its cancelled mirror.

const EVIDENCE_STATUSES = new Set(['completed', 'attended', 'no_show'])
const ACTIVE_STATUSES = new Set(['scheduled', 'rescheduled', 'completed', 'attended', 'no_show'])
const CANCELLATION_STATUSES = new Set(['cancelled', 'canceled', 'canceled_by_student', 'student_cancelled', 'trainer_cancelled'])

function normalized(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function sessionHour(session = {}, id = '') {
  const value = Number(session.hour)
  if (Number.isInteger(value) && value >= 0 && value <= 23) return value
  const match = String(id || '').match(/^T[2-8]-(\d{1,2})-/)
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : null
}

function sessionScheduleIdentity(session = {}, id = '') {
  const studentId = typeof session.studentId === 'string' ? session.studentId.trim() : ''
  const trainerId = typeof session.trainerId === 'string' ? session.trainerId.trim() : ''
  const contractId = typeof session.contractId === 'string' ? session.contractId.trim() : ''
  const scheduleEntryId = typeof session.scheduleEntryId === 'string' ? session.scheduleEntryId.trim() : ''
  const date = typeof session.date === 'string' ? session.date.trim().slice(0, 10) : ''
  const hour = sessionHour(session, id)
  // Without the published schedule entry we cannot prove that two same-day
  // rows are mirrors. Leave those rows visible rather than merging a valid
  // makeup or manually-created appointment by accident.
  if (!studentId || !trainerId || !contractId || !scheduleEntryId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || hour === null) return null
  return [studentId, trainerId, contractId, date, hour, scheduleEntryId].join('|')
}

function timestamp(value) {
  if (!value) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.toDate === 'function') return value.toDate().getTime()
  return 0
}

function sessionPriority(session = {}) {
  const status = normalized(session.status)
  const attendance = normalized(session.attendanceStatus || session.attendance)
  const billing = normalized(session.billingStatus)
  if (billing === 'charged' || EVIDENCE_STATUSES.has(status) || ['present', 'late', 'no_show'].includes(attendance)) return 3
  if (ACTIVE_STATUSES.has(status)) return 2
  if (CANCELLATION_STATUSES.has(status) || billing === 'exempt') return 0
  return 1
}

function preferredSession(left, right) {
  const leftPriority = sessionPriority(left)
  const rightPriority = sessionPriority(right)
  if (leftPriority !== rightPriority) return leftPriority > rightPriority ? left : right
  const leftRevision = Number(left.revision || 0)
  const rightRevision = Number(right.revision || 0)
  if (leftRevision !== rightRevision) return leftRevision > rightRevision ? left : right
  const leftUpdated = timestamp(left.updatedAt || left.confirmedAt || left.createdAt)
  const rightUpdated = timestamp(right.updatedAt || right.confirmedAt || right.createdAt)
  if (leftUpdated !== rightUpdated) return leftUpdated > rightUpdated ? left : right
  return String(left.id || '').localeCompare(String(right.id || '')) <= 0 ? left : right
}

function canonicalSessionRows(rows = [], prefer = preferredSession) {
  const grouped = new Map()
  const ungrouped = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const value = row && typeof row === 'object' ? row : {}
    const key = sessionScheduleIdentity(value, value.id)
    if (!key) {
      ungrouped.push(value)
      continue
    }
    const current = grouped.get(key)
    grouped.set(key, current ? prefer(current, value) : value)
  }
  return [...ungrouped, ...grouped.values()]
}

// The student calendar is a current schedule projection. Cancelled rows are
// retained in `sessions` for audit, contract reconciliation and reporting, but
// they must never be rendered as a bookable appointment. A replacement created
// after an Admin re-add carries the cancelled source id; hide that source from
// the student projection as an extra guard when both rows are in the query.
function studentVisibleSessionRows(rows = []) {
  const sourceIdsWithReplacement = new Set(
    (Array.isArray(rows) ? rows : [])
      .map((row) => typeof row?.reintroducedFromSessionId === 'string' ? row.reintroducedFromSessionId.trim() : '')
      .filter(Boolean),
  )
  return canonicalSessionRows(rows)
    .filter((row) => ACTIVE_STATUSES.has(normalized(row?.status)))
    .filter((row) => normalized(row?.scheduleStatus) !== 'cancelled')
    .filter((row) => !sourceIdsWithReplacement.has(String(row?.id || '')))
}

module.exports = {
  ACTIVE_STATUSES,
  CANCELLATION_STATUSES,
  EVIDENCE_STATUSES,
  canonicalSessionRows,
  studentVisibleSessionRows,
  sessionPriority,
  sessionScheduleIdentity,
}
