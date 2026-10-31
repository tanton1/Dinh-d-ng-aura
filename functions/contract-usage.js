'use strict'

const { FieldValue } = require('firebase-admin/firestore')
const core = require('./contract-usage-core')
const {
  MAX_SESSION_EVIDENCE,
  DAILY_USAGE_RECONCILIATION_VERSION,
  DAILY_USAGE_RECONCILIATION_SOURCE,
  safeCount,
  sessionCountsTowardContract,
  usageSourceChanged,
  isDailyUsageProjection,
  summarizeContractUsage,
  sessionUsageTransition,
  sessionUsageSourceFingerprint,
} = core
const { contractUsageViewFromEvidence, contractUsageSourceFingerprint, usageViewFingerprint, usageViewMatchesContractSource } = require('./contract-usage-view-core')

async function syncContractUsageProjection({ db, event, logger = console }) {
  const sessionId = event.params?.sessionId
  if (!sessionId) return null
  const before = event.data?.before?.exists ? event.data.before.data() : null
  const after = event.data?.after?.exists ? event.data.after.data() : null
  const transition = sessionUsageTransition(before, after)
  const contractIds = new Set([...transition.removeContractIds, ...transition.addContractIds])
  if (usageSourceChanged(before, after) && (sessionCountsTowardContract(before) || sessionCountsTowardContract(after))) {
    for (const value of [before, after]) {
      const contractId = typeof value?.contractId === 'string' ? value.contractId.trim() : ''
      if (contractId) contractIds.add(contractId)
    }
  }
  const affectedContractIds = [...contractIds]
  if (!affectedContractIds.length) return null
  const sourceEventFingerprint = sessionUsageSourceFingerprint(event)
  return db.runTransaction(async (transaction) => {
    const references = affectedContractIds.map((contractId) => db.doc(`contracts/${contractId}`))
    const snapshots = []
    for (const reference of references) snapshots.push(await transaction.get(reference))
    const viewSnapshots = []
    for (const contractId of affectedContractIds) viewSnapshots.push(await transaction.get(db.doc(`contractUsageViews/${contractId}`)))
    const evidenceSnapshots = []
    const alreadyProjected = []
    for (const [index, snapshot] of snapshots.entries()) {
      const view = viewSnapshots[index].exists ? viewSnapshots[index].data() : null
      const duplicate = Boolean(snapshot.exists && sourceEventFingerprint
        && view?.lastSessionSourceFingerprint === sourceEventFingerprint
        && usageViewMatchesContractSource(snapshot.data(), view))
      alreadyProjected.push(duplicate)
      evidenceSnapshots.push(snapshot.exists && !duplicate
        ? await transaction.get(db.collection('sessions')
          .where('contractId', '==', snapshot.id)
          .limit(MAX_SESSION_EVIDENCE + 1))
        : null)
    }
    const changes = []
    for (const [index, snapshot] of snapshots.entries()) {
      if (!snapshot.exists) {
        logger.error('Contract usage projection skipped missing contract', { contractId: affectedContractIds[index], sessionId })
        continue
      }
      const contract = snapshot.data() || {}
      if (alreadyProjected[index]) continue
      const evidenceSnapshot = evidenceSnapshots[index]
      if (evidenceSnapshot.size > MAX_SESSION_EVIDENCE) {
        logger.error('Contract usage projection skipped truncated history', { contractId: snapshot.id, sessionId, evidenceSessions: evidenceSnapshot.size })
        continue
      }
      const rows = evidenceSnapshot.docs.map((item) => ({ ...item.data(), id: item.id }))
      const summary = summarizeContractUsage(contract, rows)
      const chargedSessionIds = [...new Set((Array.isArray(summary.canonicalChargedSessionIds) ? summary.canonicalChargedSessionIds : []).filter(Boolean))]
      const previousAttended = [...new Set((Array.isArray(contract.attendedClasses) ? contract.attendedClasses : []).filter((value) => typeof value === 'string' && value))]
      const canonicalIds = new Set(summary.canonicalSessionIds || [])
      const nextAttended = previousAttended.filter((value) => canonicalIds.has(value))
      const beforeUsed = safeCount(contract.usedSessions)
      const exactHistoryProjection = Number(contract.usageReconciliationVersion || 0) >= 4
        && contract.usageReconciledFrom === 'pt-contract-history-exact-v1'
      const afterUsed = exactHistoryProjection && !isDailyUsageProjection(contract)
        ? summary.usedSessions
        : summary.chargedSessions
      const afterStatus = afterUsed > safeCount(contract.totalSessions) ? 'over_entitlement' : 'matched'
      const previousCharged = [...new Set((Array.isArray(contract.chargedSessionIds) ? contract.chargedSessionIds : []).filter((value) => typeof value === 'string' && value))]
      const changed = afterUsed !== beforeUsed
        || JSON.stringify(previousCharged) !== JSON.stringify(chargedSessionIds)
        || JSON.stringify(previousAttended) !== JSON.stringify(nextAttended)
        || Number(contract.usageReconciliationVersion || 0) < DAILY_USAGE_RECONCILIATION_VERSION
        || contract.usageReconciledFrom !== DAILY_USAGE_RECONCILIATION_SOURCE
        || Number(contract.usageDedupedSessions || 0) !== summary.duplicateHistorySessions
      const contractPatch = {
        usedSessions: afterUsed,
        chargedSessionIds,
        ...(JSON.stringify(nextAttended) !== JSON.stringify(previousAttended) ? { attendedClasses: nextAttended } : {}),
        usageProjectionVersion: DAILY_USAGE_RECONCILIATION_VERSION,
        usageReconciliationVersion: DAILY_USAGE_RECONCILIATION_VERSION,
        usageReconciledFrom: DAILY_USAGE_RECONCILIATION_SOURCE,
        historyEvidenceSessions: afterUsed,
        usageDeduplicationVersion: 1,
        usageDedupedSessions: summary.duplicateHistorySessions,
        usageReconciliationStatus: afterStatus,
        ...(exactHistoryProjection ? {
          historyEvidenceSource: 'contractId-linked-session-query',
        } : {}),
        usageProjectionUpdatedAt: FieldValue.serverTimestamp(),
      }
      if (changed) transaction.update(snapshot.ref, contractPatch)
      const nextContract = changed ? { ...contract, ...contractPatch } : contract
      const view = contractUsageViewFromEvidence(snapshot.id, nextContract, rows)
      const sourceFingerprint = usageViewFingerprint(view)
      const storedView = viewSnapshots[index].exists ? viewSnapshots[index].data() : null
      const projectionChanged = storedView?.sourceFingerprint !== sourceFingerprint
      transaction.set(viewSnapshots[index].ref, {
        ...(projectionChanged ? { ...view, sourceFingerprint, generatedAt: FieldValue.serverTimestamp() } : {}),
        contractSourceFingerprint: contractUsageSourceFingerprint(nextContract),
        reconciliationProjectionFingerprint: sourceFingerprint,
        ...(sourceEventFingerprint ? { lastSessionSourceFingerprint: sourceEventFingerprint } : {}),
        reconciledAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      if (changed) changes.push({
        contractId: snapshot.id,
        beforeUsed,
        afterUsed,
        rawHistorySessions: summary.rawHistorySessions,
        canonicalHistorySessions: summary.historySessions,
        duplicateHistorySessions: summary.duplicateHistorySessions,
        action: summary.duplicateHistorySessions > 0 ? 'daily_deduped' : 'reconciled',
      })
    }
    if (changes.length) transaction.create(db.collection('contractUsageAuditLogs').doc(), {
      schemaVersion: 3,
      action: 'contract_usage.daily_unique_projection_synced',
      sessionId,
      changes,
      createdAt: FieldValue.serverTimestamp(),
    })
    return {
      sessionId,
      changes,
      evidenceQueries: evidenceSnapshots.filter(Boolean).length,
      skippedAlreadyProjected: alreadyProjected.filter(Boolean).length,
    }
  })
}

module.exports = { ...core, syncContractUsageProjection }
