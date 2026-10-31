'use strict'

const { createHash } = require('node:crypto')
const { canonicalSessionRows, sessionPriority } = require('./session-schedule-normalization')

const LEGACY_CHARGED_STATUSES = new Set(['completed', 'attended', 'no_show'])
const MAX_SESSION_EVIDENCE = 5000
const DAILY_USAGE_RECONCILIATION_VERSION = 5
const DAILY_USAGE_RECONCILIATION_SOURCE = 'pt-contract-daily-usage-v1'
const SESSION_USAGE_IDENTITY_FIELDS = Object.freeze([
  'contractId',
  'studentId',
  'date',
  'hour',
  'scheduleEntryId',
  'branchId',
  'billingStatus',
  'status',
  'attendanceStatus',
  'revision',
])

function safeCount(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0
}

function normalized(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function sessionCountsTowardContract(session = {}) {
  const billingStatus = normalized(session?.billingStatus)
  if (billingStatus === 'exempt') return false
  if (billingStatus === 'charged') return true
  // Legacy status fallback is valid only when no explicit billing lifecycle
  // exists. A completed attendance awaiting quota review must not consume a
  // paid entitlement or push the contract beyond its total sessions.
  if (billingStatus) return false
  return LEGACY_CHARGED_STATUSES.has(normalized(session?.status))
}

function sessionAttendanceKind(session = {}) {
  const attendanceStatus = normalized(session.attendanceStatus)
  const status = normalized(session.status)
  if (attendanceStatus === 'late') return 'late'
  if (attendanceStatus === 'present') return 'present'
  if (attendanceStatus === 'no_show') return 'no_show'
  if (attendanceStatus === 'policy_charge') return 'policy_charge'
  if (status === 'completed' || status === 'attended') return 'present'
  if (status === 'no_show') return 'no_show'
  return 'pending'
}

function sessionDateKey(session = {}) {
  const value = typeof session.date === 'string' ? session.date.trim().slice(0, 10) : ''
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''
}

function sessionStudentKey(session = {}) {
  return typeof session.studentId === 'string' ? session.studentId.trim() : ''
}

function usageEvidencePriority(session = {}) {
  const attendance = sessionAttendanceKind(session)
  const attendanceScore = {
    present: 4,
    late: 3,
    no_show: 2,
    policy_charge: 1,
    pending: 0,
  }[attendance] || 0
  return sessionPriority(session) * 10 + attendanceScore
}

function preferredUsageSession(left, right) {
  // Returning or exempting a duplicate keeps its attendance history. That
  // history must never displace the other valid charged session for the day.
  const leftCharged = sessionCountsTowardContract(left)
  const rightCharged = sessionCountsTowardContract(right)
  if (leftCharged !== rightCharged) return leftCharged ? left : right
  const leftPriority = usageEvidencePriority(left)
  const rightPriority = usageEvidencePriority(right)
  if (leftPriority !== rightPriority) return leftPriority > rightPriority ? left : right
  const leftRevision = Number(left?.revision || 0)
  const rightRevision = Number(right?.revision || 0)
  if (leftRevision !== rightRevision) return leftRevision > rightRevision ? left : right
  const timestamp = (value) => {
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
  const leftTimestamp = timestamp(left?.updatedAt || left?.confirmedAt || left?.createdAt)
  const rightTimestamp = timestamp(right?.updatedAt || right?.confirmedAt || right?.createdAt)
  if (leftTimestamp !== rightTimestamp) return leftTimestamp > rightTimestamp ? left : right
  return String(left?.id || '').localeCompare(String(right?.id || '')) <= 0 ? left : right
}

/**
 * Return one canonical charge/history row per learner per calendar day.
 *
 * Published branch mirrors are collapsed first by their schedule identity.
 * Remaining rows are then collapsed by student + YYYY-MM-DD. Rows without a
 * trustworthy student/date key are retained independently so a malformed
 * record cannot hide a valid appointment.
 */
function canonicalUsageSessions(sessions = []) {
  const scheduleRows = canonicalSessionRows(Array.isArray(sessions) ? sessions : [], preferredUsageSession)
  const grouped = new Map()
  const ungrouped = []
  for (const row of scheduleRows) {
    const studentId = sessionStudentKey(row)
    const date = sessionDateKey(row)
    if (!studentId || !date) {
      ungrouped.push(row)
      continue
    }
    const key = `${studentId}|${date}`
    const current = grouped.get(key)
    grouped.set(key, current ? preferredUsageSession(current, row) : row)
  }
  return [...ungrouped, ...grouped.values()].sort((left, right) => {
    const leftDate = sessionDateKey(left) || '9999-99-99'
    const rightDate = sessionDateKey(right) || '9999-99-99'
    return leftDate.localeCompare(rightDate)
      || sessionStudentKey(left).localeCompare(sessionStudentKey(right))
      || String(left?.id || '').localeCompare(String(right?.id || ''))
  })
}

function summarizeSessionUsage(sessions = []) {
  return sessions.reduce((summary, session) => {
    const charged = sessionCountsTowardContract(session)
    const attendance = sessionAttendanceKind(session)
    summary.historySessions += 1
    if (charged) summary.chargedSessions += 1
    if (attendance === 'present' || attendance === 'late') summary.attendedSessions += 1
    if (attendance === 'present') summary.presentSessions += 1
    if (attendance === 'late') summary.lateSessions += 1
    if (attendance === 'no_show') summary.noShowSessions += 1
    if (charged && attendance === 'no_show') summary.chargedNoShowSessions += 1
    if (attendance === 'policy_charge') summary.policyChargedSessions += 1
    if (charged && attendance === 'pending') summary.chargedPendingAttendanceSessions += 1
    if (normalized(session.billingStatus) === 'exempt') summary.exemptSessions += 1
    if (!charged && normalized(session.billingStatus) !== 'exempt') summary.pendingSessions += 1
    if (charged && !normalized(session.billingStatus) && LEGACY_CHARGED_STATUSES.has(normalized(session.status))) {
      summary.legacyChargedSessions += 1
    }
    return summary
  }, {
    historySessions: 0,
    chargedSessions: 0,
    attendedSessions: 0,
    presentSessions: 0,
    lateSessions: 0,
    noShowSessions: 0,
    chargedNoShowSessions: 0,
    policyChargedSessions: 0,
    chargedPendingAttendanceSessions: 0,
    exemptSessions: 0,
    pendingSessions: 0,
    legacyChargedSessions: 0,
  })
}

function summarizeContractUsage(contract = {}, sessions = []) {
  const rawSessions = Array.isArray(sessions) ? sessions : []
  const canonicalSessions = canonicalUsageSessions(rawSessions)
  const sessionUsage = summarizeSessionUsage(canonicalSessions)
  const totalSessions = safeCount(contract.totalSessions)
  const storedUsedSessions = safeCount(contract.usedSessions)
  // A migrated projection can be ahead of the session documents that still
  // have a missing contractId. Keep that audited delta explicit instead of
  // silently removing a paid entitlement or fabricating attendance records.
  const legacyProjectionAdjustment = Math.max(0, storedUsedSessions - sessionUsage.chargedSessions)
  const usedSessions = sessionUsage.chargedSessions + legacyProjectionAdjustment
  const projectionDelta = storedUsedSessions - sessionUsage.chargedSessions
  const reconciliationStatus = usedSessions > totalSessions
    ? 'over_entitlement'
    : projectionDelta > 0
      ? 'legacy_projection'
      : projectionDelta < 0
        ? 'projection_behind'
        : 'matched'
  return {
    ...sessionUsage,
    rawHistorySessions: rawSessions.length,
    duplicateHistorySessions: Math.max(0, rawSessions.length - canonicalSessions.length),
    canonicalSessionIds: canonicalSessions
      .map((session) => typeof session?.id === 'string' ? session.id : '')
      .filter(Boolean),
    canonicalChargedSessionIds: canonicalSessions
      .filter((session) => sessionCountsTowardContract(session))
      .map((session) => typeof session?.id === 'string' ? session.id : '')
      .filter(Boolean),
    totalSessions,
    storedUsedSessions,
    legacyProjectionAdjustment,
    usedSessions,
    remainingSessions: Math.max(0, totalSessions - usedSessions - safeCount(contract.carryOverTransferredSessions)),
    projectionDelta,
    reconciliationStatus,
  }
}

function comparableSessionSource(value) {
  if (!value) return null
  return SESSION_USAGE_IDENTITY_FIELDS.reduce((result, field) => {
    const current = value[field]
    result[field] = typeof current === 'string' ? current.trim() : current ?? null
    return result
  }, {})
}

function usageSourceChanged(before, after) {
  return JSON.stringify(comparableSessionSource(before)) !== JSON.stringify(comparableSessionSource(after))
}

function isDailyUsageProjection(contract = {}) {
  return Number(contract.usageReconciliationVersion || 0) >= DAILY_USAGE_RECONCILIATION_VERSION
    && contract.usageReconciledFrom === DAILY_USAGE_RECONCILIATION_SOURCE
}

function sessionUsageTransition(before = null, after = null) {
  const beforeContractId = before && sessionCountsTowardContract(before) && typeof before.contractId === 'string' ? before.contractId.trim() : ''
  const afterContractId = after && sessionCountsTowardContract(after) && typeof after.contractId === 'string' ? after.contractId.trim() : ''
  return {
    removeContractIds: beforeContractId && beforeContractId !== afterContractId ? [beforeContractId] : [],
    addContractIds: afterContractId && afterContractId !== beforeContractId ? [afterContractId] : [],
  }
}

function sessionUsageSourceFingerprint(event) {
  const version = (snapshot) => {
    if (!snapshot?.exists) return null
    const timestamp = snapshot.updateTime
    if (!timestamp) return null
    if (Number.isFinite(timestamp.seconds) && Number.isFinite(timestamp.nanoseconds)) {
      return `${timestamp.seconds}:${timestamp.nanoseconds}`
    }
    if (typeof timestamp.toDate === 'function') return timestamp.toDate().toISOString()
    return typeof timestamp === 'string' ? timestamp : null
  }
  const before = event.data?.before
  const after = event.data?.after
  const beforeVersion = version(before)
  const afterVersion = version(after)
  // Without source versions, identical business transitions at different
  // times cannot safely be treated as duplicates. Fall back to a full read.
  if ((before?.exists && !beforeVersion) || (after?.exists && !afterVersion)) return null
  if (!before?.exists && !after?.exists) return null
  return createHash('sha256').update(JSON.stringify({
    sessionId: event.params?.sessionId,
    beforeVersion,
    afterVersion,
    before: comparableSessionSource(before?.exists ? before.data() : null),
    after: comparableSessionSource(after?.exists ? after.data() : null),
  })).digest('hex')
}

module.exports = {
  LEGACY_CHARGED_STATUSES,
  MAX_SESSION_EVIDENCE,
  DAILY_USAGE_RECONCILIATION_VERSION,
  DAILY_USAGE_RECONCILIATION_SOURCE,
  safeCount,
  sessionCountsTowardContract,
  sessionAttendanceKind,
  sessionDateKey,
  canonicalUsageSessions,
  usageSourceChanged,
  isDailyUsageProjection,
  summarizeSessionUsage,
  summarizeContractUsage,
  sessionUsageTransition,
  sessionUsageSourceFingerprint,
}
