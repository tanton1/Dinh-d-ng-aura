'use strict'

const { createHash } = require('node:crypto')
const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { canonicalUsageSessions, sessionCountsTowardContract, summarizeContractUsage } = require('./contract-usage')
const { trustedAccessContext } = require('./identity-access')
const { withFunctionTelemetry } = require('./observability')

const MAX_SESSION_EVIDENCE = 5000
const MAX_CONTRACTS_PER_STUDENT = 100
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

function id(value, label) {
  const result = text(value)
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(result)) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return result
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

function canReadUsage(actor) {
  if (['admin', 'super_admin'].includes(actor.accessRole)) return true
  return (actor.capabilities || []).some((capability) => [
    'pt.operations.manage',
    'pt.students.assigned.view',
    'coaching.clients.assigned.view',
    'branch.operations.view',
    'renewals.workspace.view',
  ].includes(capability))
}

function canRefreshUsage(actor) {
  return ['admin', 'super_admin'].includes(actor.accessRole)
}

function contractVisibleToActor(contract = {}, actor) {
  if (['admin', 'super_admin'].includes(actor.accessRole)) return true
  const branchIds = new Set(Array.isArray(actor.branchIds) ? actor.branchIds : [])
  if ((actor.capabilities || []).includes('branch.operations.view') && branchIds.has(text(contract.branchId))) return true
  const actorIds = new Set([actor.uid, actor.legacyStaffId].filter(Boolean))
  const assigned = [
    contract.trainerId,
    ...(Array.isArray(contract.trainerIds) ? contract.trainerIds : []),
    ...(Array.isArray(contract.nutritionPTIds) ? contract.nutritionPTIds : []),
    contract.assignedSalesId,
  ].filter(Boolean)
  return assigned.some((value) => actorIds.has(value))
}

function requireContractScope(contract, actor) {
  if (!contractVisibleToActor(contract, actor)) throw new HttpsError('permission-denied', 'Hợp đồng nằm ngoài phạm vi được cấp.')
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

async function overlayContractUsageViews(db, contracts = [], maximum = 5000) {
  const bounded = contracts.slice(0, Math.max(0, maximum))
  if (!bounded.length) return bounded
  const views = new Map()
  for (let offset = 0; offset < bounded.length; offset += 100) {
    const snapshots = await db.getAll(...bounded.slice(offset, offset + 100).map((contract) => db.doc(`contractUsageViews/${contract.id}`)))
    snapshots.forEach((snapshot) => { if (snapshot.exists) views.set(snapshot.id, snapshot.data()) })
  }
  return bounded.map((contract) => contractWithUsageView(contract, views.get(contract.id)))
}

async function readContractEvidence(db, contractId, transaction = null) {
  const query = db.collection('sessions')
    .where('contractId', '==', contractId)
    .limit(MAX_SESSION_EVIDENCE + 1)
  const snapshot = transaction ? await transaction.get(query) : await query.get()
  const rawSessions = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
  const sessions = canonicalUsageSessions(rawSessions)
  return {
    sessions: sessions.slice(0, MAX_SESSION_EVIDENCE),
    rawSessions,
    truncated: snapshot.size > MAX_SESSION_EVIDENCE,
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

async function loadContractUsageViews(db, contractIds = []) {
  const ids = [...new Set((Array.isArray(contractIds) ? contractIds : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))]
  const views = new Map()
  for (let offset = 0; offset < ids.length; offset += 100) {
    const snapshots = await db.getAll(...ids.slice(offset, offset + 100).map((idValue) => db.doc(`contractUsageViews/${idValue}`)))
    snapshots.forEach((snapshot) => { if (snapshot.exists) views.set(snapshot.id, snapshot.data()) })
  }
  return views
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

async function buildContractUsageView({ db, contractId, logger = console, skipMatchingContractSource = false }) {
  const reference = db.doc(`contractUsageViews/${contractId}`)
  // Read the current contract, evidence and existing view together. An event
  // may be delivered late; its payload (or a caller's cached contract) must
  // never replace a newer projection.
  const result = await db.runTransaction(async (transaction) => {
    const contractSnapshot = await transaction.get(db.doc(`contracts/${contractId}`))
    const stored = await transaction.get(reference)
    if (!contractSnapshot.exists) {
      if (stored.exists) transaction.delete(reference)
      return null
    }
    const value = contractSnapshot.data() || {}
    const storedView = stored.exists ? stored.data() : null
    if (skipMatchingContractSource && usageViewMatchesContractSource(value, storedView)) {
      return { ...storedView, projectionChanged: false, skippedMatchingSource: true }
    }
    const evidence = await readContractEvidence(db, contractId, transaction)
    const view = contractUsageViewFromEvidence(contractId, value, evidence.rawSessions)
    const sourceFingerprint = usageViewFingerprint(view)
    const projectionChanged = storedView?.sourceFingerprint !== sourceFingerprint
    transaction.set(reference, {
      ...(projectionChanged ? { ...view, sourceFingerprint, generatedAt: FieldValue.serverTimestamp() } : {}),
      contractSourceFingerprint: contractUsageSourceFingerprint(value),
      reconciliationProjectionFingerprint: sourceFingerprint,
      // A successful unchanged reconciliation is still fresh. Do not bump
      // generatedAt/sourceFingerprint or wake business projections for it.
      reconciledAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return { ...view, sourceFingerprint, projectionChanged, ...(projectionChanged ? {} : { generatedAt: storedView.generatedAt }) }
  })
  if (!result) return null
  logger.info?.(result.projectionChanged ? 'contract_usage_view_rebuilt' : 'contract_usage_view_unchanged', {
    contractId,
    remainingSessions: result.remainingSessions,
    reconciliationStatus: result.reconciliationStatus,
    evidenceSessions: result.evidenceSessions,
    rawEvidenceSessions: result.rawEvidenceSessions,
    evidenceTruncated: result.evidenceTruncated,
    skippedMatchingSource: result.skippedMatchingSource === true,
  })
  return result
}

async function getStoredOrFreshView(db, contractId) {
  const stored = await db.doc(`contractUsageViews/${contractId}`).get()
  if (stored.exists && Number(stored.data()?.schemaVersion || 0) === USAGE_VIEW_SCHEMA_VERSION) {
    return { id: stored.id, ...stored.data(), generatedAt: stored.data()?.generatedAt?.toDate?.()?.toISOString?.() || stored.data()?.generatedAt || null }
  }
  return buildContractUsageView({ db, contractId })
}

async function getStudentContracts(db, studentId) {
  const [canonical, legacy] = await Promise.all([
    db.collection('contracts').where('studentId', '==', studentId).limit(MAX_CONTRACTS_PER_STUDENT).get(),
    db.collection('contracts').where('crmProfileId', '==', studentId).limit(MAX_CONTRACTS_PER_STUDENT).get(),
  ])
  return [...new Map(
    [...canonical.docs, ...legacy.docs].map((item) => [item.id, { id: item.id, ...item.data() }]),
  ).values()].slice(0, MAX_CONTRACTS_PER_STUDENT)
}

function requireUsageReader(actor) {
  if (!canReadUsage(actor)) throw new HttpsError('permission-denied', 'Bạn không có quyền xem đối soát quyền lợi buổi.')
}

function createContractUsageViewFunctions({ db, onCall, logger = console }) {
  const getContractUsage = onCall(withFunctionTelemetry('getContractUsage', async (request) => {
    const actor = await trustedAccessContext(request, db)
    requireUsageReader(actor)
    const contractId = id(request.data?.contractId, 'Mã hợp đồng')
    const contract = await db.doc(`contracts/${contractId}`).get()
    if (!contract.exists) throw new HttpsError('not-found', 'Không tìm thấy hợp đồng.')
    requireContractScope(contract.data(), actor)
    const view = await getStoredOrFreshView(db, contractId)
    if (!view) throw new HttpsError('not-found', 'Không tìm thấy hợp đồng.')
    return view
  }))

  const getStudentUsageSummary = onCall(withFunctionTelemetry('getStudentUsageSummary', async (request) => {
    const actor = await trustedAccessContext(request, db)
    requireUsageReader(actor)
    const studentId = id(request.data?.studentId, 'Mã học viên')
    const contracts = await getStudentContracts(db, studentId)
    const rows = []
    for (const contract of contracts.filter((item) => contractVisibleToActor(item, actor))) {
      const view = await getStoredOrFreshView(db, contract.id)
      if (view) rows.push(view)
    }
    return { schemaVersion: 1, studentId, rows, truncated: contracts.length >= MAX_CONTRACTS_PER_STUDENT }
  }))

  const refreshContractUsageView = onCall(withFunctionTelemetry('refreshContractUsageView', async (request) => {
    const actor = await trustedAccessContext(request, db)
    if (!canRefreshUsage(actor)) throw new HttpsError('permission-denied', 'Chỉ quản trị viên mới được làm mới đối soát quyền lợi.')
    const contractId = id(request.data?.contractId, 'Mã hợp đồng')
    const contract = await db.doc(`contracts/${contractId}`).get()
    if (!contract.exists) throw new HttpsError('not-found', 'Không tìm thấy hợp đồng.')
    requireContractScope(contract.data(), actor)
    const view = await buildContractUsageView({ db, contractId, logger })
    if (!view) throw new HttpsError('not-found', 'Không tìm thấy hợp đồng.')
    return view
  }))

  const reconcileContractUsage = onCall(withFunctionTelemetry('reconcileContractUsage', async (request) => {
    const actor = await trustedAccessContext(request, db)
    if (!canRefreshUsage(actor) && !(actor.capabilities || []).includes('branch.operations.view')) {
      throw new HttpsError('permission-denied', 'Bạn không có quyền đối soát quyền lợi.')
    }
    const contractId = id(request.data?.contractId, 'Mã hợp đồng')
    const contract = await db.doc(`contracts/${contractId}`).get()
    if (!contract.exists) throw new HttpsError('not-found', 'Không tìm thấy hợp đồng.')
    requireContractScope(contract.data(), actor)
    const view = await buildContractUsageView({ db, contractId, logger })
    if (!view) throw new HttpsError('not-found', 'Không tìm thấy hợp đồng.')
    await db.collection('contractUsageAuditLogs').add({
      schemaVersion: 2,
      action: 'contract_usage.view_reconciled',
      contractId,
      actorUid: actor.uid,
      reconciliationStatus: view.reconciliationStatus,
      createdAt: FieldValue.serverTimestamp(),
    })
    return view
  }))

  return { getContractUsage, getStudentUsageSummary, refreshContractUsageView, reconcileContractUsage }
}

async function syncContractUsageView({ db, event, logger = console }) {
  const after = event.data?.after?.exists ? event.data.after.data() : null
  const before = event.data?.before?.exists ? event.data.before.data() : null
  if (event.params?.sessionId) {
    // Both legacy session triggers share this atomic writer. Its compact
    // source receipt makes the second delivery a pair of document reads,
    // not another full session-history query.
    return require('./contract-usage').syncContractUsageProjection({ db, event, logger })
  }
  const sourceFields = event.params?.sessionId ? SESSION_USAGE_FIELDS : CONTRACT_USAGE_FIELDS
  if (!usageSourceChanged(before, after, sourceFields)) {
    return { contractIds: [], rebuilt: 0, removed: 0, skippedUnchangedSource: 1 }
  }
  const contractIds = new Set(event.params?.sessionId ? affectedContractIds(before, after) : [])
  if (event.params?.contractId) contractIds.add(event.params.contractId)
  const results = []
  for (const contractId of contractIds) {
    const view = await buildContractUsageView({ db, contractId, logger, skipMatchingContractSource: true })
    if (view) results.push(view)
  }
  return { contractIds: [...contractIds], rebuilt: results.length }
}

module.exports = {
  affectedContractIds,
  CONTRACT_USAGE_FIELDS,
  MAX_SESSION_EVIDENCE,
  SESSION_USAGE_FIELDS,
  USAGE_VIEW_SCHEMA_VERSION,
  USAGE_VIEW_SOURCE_VERSION,
  USAGE_VIEW_RECONCILIATION_MAX_AGE_MS,
  viewFromSummary,
  usageSummaryFromView,
  isCanonicalUsageView,
  canonicalUsageSummary,
  loadContractUsageViews,
  usageSourceChanged,
  usageViewFingerprint,
  contractUsageSourceFingerprint,
  usageViewMatchesContractSource,
  contractUsageViewFromEvidence,
  contractUsageViewNeedsRebuild,
  contractWithUsageView,
  overlayContractUsageViews,
  contractVisibleToActor,
  buildContractUsageView,
  createContractUsageViewFunctions,
  syncContractUsageView,
}
