'use strict'

const { createHash } = require('node:crypto')
const { sessionCountsTowardContract, summarizeContractUsage } = require('./contract-usage-core')

const MAX_SESSION_EVIDENCE = 5000

const USAGE_VIEW_SCHEMA_VERSION = 3

const USAGE_VIEW_SOURCE_VERSION = 'contract-usage-v3-daily'

const USAGE_VIEW_RECONCILIATION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const SESSION_USAGE_FIELDS = Object.freeze([
  'contractId',
  'studentId',
  'date',
  'hour',
  'scheduleEntryId',
  'branchId',
  'billingStatus',
  'status',
  'attendanceStatus',
])

const CONTRACT_USAGE_FIELDS = Object.freeze([
  'studentId',
  'crmProfileId',
  'carryOverTransferredSessions',
  'totalSessions',
  'usedSessions',
  'usageReconciliationVersion',
  'usageReconciledFrom',
  'usageDeduplicationVersion',
  'usageDedupedSessions',
])

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function comparableSource(value, fields) {
  if (!value) return null
  return fields.reduce((result, field) => {
    const current = value[field]
    result[field] = typeof current === 'string' ? current.trim() : current ?? null
    return result
  }, {})
}

function usageSourceChanged(before, after, fields) {
  return JSON.stringify(comparableSource(before, fields)) !== JSON.stringify(comparableSource(after, fields))
}

function usageViewFingerprint(view = {}) {
  const canonical = Object.keys(view)
    .filter((key) => !['generatedAt', 'reconciledAt', 'contractSourceFingerprint', 'lastSessionSourceFingerprint', 'reconciliationProjectionFingerprint', 'sourceFingerprint', 'projectionChanged'].includes(key))
    .sort()
    .reduce((result, key) => {
      result[key] = view[key] ?? null
      return result
    }, {})
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

function contractUsageSourceFingerprint(contract = {}) {
  return createHash('sha256').update(JSON.stringify(comparableSource(contract, CONTRACT_USAGE_FIELDS))).digest('hex')
}

function timestampMillis(value) {
  if (value?.toMillis) return value.toMillis()
  if (value?.toDate) return value.toDate().getTime()
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function contractUsageViewNeedsRebuild(contract = {}, storedView = null, nowMillis = Date.now(), maxAgeMillis = USAGE_VIEW_RECONCILIATION_MAX_AGE_MS) {
  if (!storedView || Number(storedView.schemaVersion || 0) !== USAGE_VIEW_SCHEMA_VERSION) return true
  if (text(storedView.sourceVersion) !== USAGE_VIEW_SOURCE_VERSION) return true
  if (storedView.evidenceTruncated === true) return true
  if (Number(storedView.entitlementSessions || 0) !== Number(contract.totalSessions || 0)) return true
  if (Number(storedView.transferredSessions || 0) !== Number(contract.carryOverTransferredSessions || 0)) return true
  if (Number(storedView.storedUsedSessions || 0) !== Number(contract.usedSessions || 0)) return true
  if (text(storedView.studentId) !== text(contract.studentId || contract.crmProfileId)) return true
  if (storedView.contractSourceFingerprint && storedView.contractSourceFingerprint !== contractUsageSourceFingerprint(contract)) return true
  const generatedAtMillis = timestampMillis(storedView.reconciledAt || storedView.generatedAt)
  return !generatedAtMillis || nowMillis - generatedAtMillis >= Math.max(60_000, maxAgeMillis)
}

function usageViewMatchesContractSource(contract, storedView) {
  return isCanonicalUsageView(storedView)
    && storedView.contractSourceFingerprint === contractUsageSourceFingerprint(contract)
    // An older callable/worker may still merge a rebuilt business view without
    // knowing these receipt fields. Do not accept the preserved receipt unless
    // the exact output it acknowledged is still intact.
    && storedView.reconciliationProjectionFingerprint === storedView.sourceFingerprint
    && storedView.sourceFingerprint === usageViewFingerprint(storedView)
}

function affectedContractIds(before, after) {
  const ids = new Set()
  for (const value of [before, after]) {
    const contractId = text(value?.contractId)
    if (contractId && sessionCountsTowardContract(value)) ids.add(contractId)
  }
  return [...ids]
}

function viewFromSummary(contractId, contract, summary, source = USAGE_VIEW_SOURCE_VERSION) {
  return {
    schemaVersion: USAGE_VIEW_SCHEMA_VERSION,
    contractId,
    studentId: text(contract.studentId || contract.crmProfileId, null),
    entitlementSessions: summary.totalSessions,
    transferredSessions: Number(contract.carryOverTransferredSessions || 0),
    historySessions: summary.historySessions,
    rawHistorySessions: summary.rawHistorySessions ?? summary.historySessions,
    duplicateHistorySessions: summary.duplicateHistorySessions || 0,
    attendedSessions: summary.attendedSessions,
    presentSessions: summary.presentSessions,
    lateSessions: summary.lateSessions,
    noShowSessions: summary.noShowSessions,
    policyChargedSessions: summary.policyChargedSessions,
    chargedPendingAttendanceSessions: summary.chargedPendingAttendanceSessions,
    chargedNoShowSessions: summary.chargedNoShowSessions,
    exemptSessions: summary.exemptSessions,
    pendingReconciliationSessions: summary.pendingSessions,
    legacyProjectionAdjustment: summary.legacyProjectionAdjustment,
    storedUsedSessions: summary.storedUsedSessions,
    remainingSessions: summary.remainingSessions,
    usedSessions: summary.usedSessions,
    chargedSessions: summary.chargedSessions,
    usageDeduplicationVersion: 1,
    projectionDelta: summary.projectionDelta,
    reconciliationStatus: summary.reconciliationStatus,
    sourceVersion: source,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * Adapt the canonical projection to the legacy usage shape consumed by
 * existing Student 360 and contract UI code. The adapter is read-only: it
 * never recomputes from sessions and it preserves the explicit legacy delta.
 */
function usageSummaryFromView(view = {}, contract = {}) {
  const nonNegative = (value, fallback = 0) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback
  }
  return {
    historySessions: nonNegative(view.historySessions),
    totalSessions: nonNegative(view.entitlementSessions ?? view.totalSessions ?? contract.totalSessions),
    storedUsedSessions: nonNegative(view.storedUsedSessions ?? contract.usedSessions),
    chargedSessions: nonNegative(view.chargedSessions),
    attendedSessions: nonNegative(view.attendedSessions),
    presentSessions: nonNegative(view.presentSessions),
    lateSessions: nonNegative(view.lateSessions),
    noShowSessions: nonNegative(view.noShowSessions ?? view.chargedNoShowSessions),
    chargedNoShowSessions: nonNegative(view.chargedNoShowSessions),
    policyChargedSessions: nonNegative(view.policyChargedSessions),
    chargedPendingAttendanceSessions: nonNegative(view.chargedPendingAttendanceSessions),
    exemptSessions: nonNegative(view.exemptSessions),
    pendingSessions: nonNegative(view.pendingReconciliationSessions),
    legacyChargedSessions: 0,
    legacyProjectionAdjustment: nonNegative(view.legacyProjectionAdjustment),
    usedSessions: nonNegative(view.usedSessions),
    remainingSessions: Math.min(nonNegative(view.remainingSessions), Math.max(0, nonNegative(contract.totalSessions ?? view.entitlementSessions) - nonNegative(view.usedSessions) - nonNegative(contract.carryOverTransferredSessions))),
    projectionDelta: Number.isFinite(Number(view.projectionDelta)) ? Number(view.projectionDelta) : 0,
    reconciliationStatus: text(view.reconciliationStatus, 'matched'),
    sourceVersion: text(view.sourceVersion, USAGE_VIEW_SOURCE_VERSION),
    rawHistorySessions: nonNegative(view.rawHistorySessions ?? view.historySessions),
    duplicateHistorySessions: nonNegative(view.duplicateHistorySessions),
    usageDeduplicationVersion: nonNegative(view.usageDeduplicationVersion),
    generatedAt: view.generatedAt || null,
  }
}

function contractWithUsageView(contract = {}, view = null) {
  if (!view) return contract
  const usage = usageSummaryFromView(view, contract)
  return {
    ...contract,
    totalSessions: usage.totalSessions,
    usedSessions: usage.usedSessions,
    remainingSessions: usage.remainingSessions,
    legacyProjectionAdjustment: usage.legacyProjectionAdjustment,
    contractUsageReconciliationStatus: usage.reconciliationStatus,
    contractUsageSourceVersion: usage.sourceVersion,
  }
}

/**
 * All read surfaces use the same daily unique projection. Keep the validity
 * check next to the adapter so an old or truncated view cannot become a
 * second quota formula by accident.
 */
function isCanonicalUsageView(view = {}) {
  if (!view || typeof view !== 'object') return false
  return Number(view.schemaVersion || 0) === USAGE_VIEW_SCHEMA_VERSION
    && text(view.sourceVersion) === USAGE_VIEW_SOURCE_VERSION
    && Number.isFinite(Number(view.entitlementSessions))
    && Number.isFinite(Number(view.usedSessions))
    && Number.isFinite(Number(view.remainingSessions))
    && view.evidenceTruncated !== true
}

function canonicalUsageSummary(view, contract = {}) {
  return isCanonicalUsageView(view) ? usageSummaryFromView(view, contract) : null
}

function contractUsageViewFromEvidence(contractId, contract, rawSessions) {
  const summary = summarizeContractUsage(contract, rawSessions)
  const truncated = rawSessions.length > MAX_SESSION_EVIDENCE
  return {
    ...viewFromSummary(contractId, contract, summary),
    evidenceSessions: Math.min(summary.historySessions, MAX_SESSION_EVIDENCE),
    rawEvidenceSessions: rawSessions.length,
    evidenceTruncated: truncated,
    ...(truncated ? { reconciliationStatus: 'evidence_truncated' } : {}),
  }
}

module.exports = {
  MAX_SESSION_EVIDENCE,
  USAGE_VIEW_SCHEMA_VERSION,
  USAGE_VIEW_SOURCE_VERSION,
  USAGE_VIEW_RECONCILIATION_MAX_AGE_MS,
  SESSION_USAGE_FIELDS,
  CONTRACT_USAGE_FIELDS,
  text,
  usageSourceChanged,
  usageViewFingerprint,
  contractUsageSourceFingerprint,
  contractUsageViewNeedsRebuild,
  usageViewMatchesContractSource,
  affectedContractIds,
  viewFromSummary,
  usageSummaryFromView,
  contractWithUsageView,
  isCanonicalUsageView,
  canonicalUsageSummary,
  contractUsageViewFromEvidence,
}
