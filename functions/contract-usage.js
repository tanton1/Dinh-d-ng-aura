'use strict'

const { FieldValue } = require('firebase-admin/firestore')

const LEGACY_CHARGED_STATUSES = new Set(['completed', 'attended', 'no_show'])

function safeCount(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0
}

function normalized(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function sessionCountsTowardContract(session = {}) {
  const billingStatus = normalized(session.billingStatus)
  if (billingStatus === 'exempt') return false
  if (billingStatus === 'charged') return true
  return LEGACY_CHARGED_STATUSES.has(normalized(session.status))
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
    policyChargedSessions: 0,
    chargedPendingAttendanceSessions: 0,
    exemptSessions: 0,
    pendingSessions: 0,
    legacyChargedSessions: 0,
  })
}

function summarizeContractUsage(contract = {}, sessions = []) {
  const sessionUsage = summarizeSessionUsage(sessions)
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
    totalSessions,
    storedUsedSessions,
    legacyProjectionAdjustment,
    usedSessions,
    remainingSessions: Math.max(0, totalSessions - usedSessions),
    projectionDelta,
    reconciliationStatus,
  }
}

function sessionUsageTransition(before = null, after = null) {
  const beforeContractId = before && sessionCountsTowardContract(before) && typeof before.contractId === 'string' ? before.contractId.trim() : ''
  const afterContractId = after && sessionCountsTowardContract(after) && typeof after.contractId === 'string' ? after.contractId.trim() : ''
  return {
    removeContractIds: beforeContractId && beforeContractId !== afterContractId ? [beforeContractId] : [],
    addContractIds: afterContractId && afterContractId !== beforeContractId ? [afterContractId] : [],
  }
}

async function syncContractUsageProjection({ db, event, logger = console }) {
  const sessionId = event.params?.sessionId
  if (!sessionId) return null
  const before = event.data?.before?.exists ? event.data.before.data() : null
  const after = event.data?.after?.exists ? event.data.after.data() : null
  const transition = sessionUsageTransition(before, after)
  const contractIds = [...new Set([...transition.removeContractIds, ...transition.addContractIds])]
  if (!contractIds.length) return null
  return db.runTransaction(async (transaction) => {
    const references = contractIds.map((contractId) => db.doc(`contracts/${contractId}`))
    const snapshots = []
    for (const reference of references) snapshots.push(await transaction.get(reference))
    const changes = []
    snapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) {
        logger.error('Contract usage projection skipped missing contract', { contractId: contractIds[index], sessionId })
        return
      }
      const contract = snapshot.data() || {}
      const chargedSessionIds = [...new Set((Array.isArray(contract.chargedSessionIds) ? contract.chargedSessionIds : []).filter((value) => typeof value === 'string' && value))]
      const attendedClasses = [...new Set((Array.isArray(contract.attendedClasses) ? contract.attendedClasses : []).filter((value) => typeof value === 'string' && value))]
      const beforeUsed = safeCount(contract.usedSessions)
      let afterUsed = beforeUsed
      const remove = transition.removeContractIds.includes(snapshot.id)
      const add = transition.addContractIds.includes(snapshot.id)
      const alreadyCounted = chargedSessionIds.includes(sessionId) || attendedClasses.includes(sessionId)
      let nextCharged = chargedSessionIds
      let nextAttended = attendedClasses
      if (remove && alreadyCounted) {
        afterUsed = Math.max(0, afterUsed - 1)
        nextCharged = nextCharged.filter((value) => value !== sessionId)
        nextAttended = nextAttended.filter((value) => value !== sessionId)
      }
      if (add && !alreadyCounted) {
        afterUsed += 1
        nextCharged = [...nextCharged, sessionId]
      } else if (add && !nextCharged.includes(sessionId)) {
        nextCharged = [...nextCharged, sessionId]
      }
      if (afterUsed === beforeUsed && nextCharged.length === chargedSessionIds.length && nextAttended.length === attendedClasses.length) return
      const exactHistoryProjection = Number(contract.usageReconciliationVersion || 0) >= 4
        && contract.usageReconciledFrom === 'pt-contract-history-exact-v1'
      transaction.update(snapshot.ref, {
        usedSessions: afterUsed,
        chargedSessionIds: nextCharged,
        ...(nextAttended.length !== attendedClasses.length ? { attendedClasses: nextAttended } : {}),
        usageProjectionVersion: exactHistoryProjection ? 4 : 2,
        ...(exactHistoryProjection ? {
          historyEvidenceSessions: afterUsed,
          usageReconciliationStatus: afterUsed > safeCount(contract.totalSessions) ? 'over_entitlement' : 'matched',
        } : {}),
        usageProjectionUpdatedAt: FieldValue.serverTimestamp(),
      })
      changes.push({ contractId: snapshot.id, beforeUsed, afterUsed, action: remove ? 'removed' : 'added' })
    })
    if (changes.length) transaction.create(db.collection('contractUsageAuditLogs').doc(), {
      schemaVersion: 2,
      action: 'contract_usage.session_projection_synced',
      sessionId,
      changes,
      createdAt: FieldValue.serverTimestamp(),
    })
    return { sessionId, changes }
  })
}

module.exports = {
  LEGACY_CHARGED_STATUSES,
  safeCount,
  sessionCountsTowardContract,
  sessionAttendanceKind,
  summarizeSessionUsage,
  summarizeContractUsage,
  sessionUsageTransition,
  syncContractUsageProjection,
}
