'use strict'

const { createHash } = require('node:crypto')
const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { sessionCountsTowardContract, summarizeContractUsage } = require('./contract-usage')
const { trustedAccessContext } = require('./identity-access')
const { withFunctionTelemetry } = require('./observability')

const MAX_SESSION_EVIDENCE = 5000
const MAX_CONTRACTS_PER_STUDENT = 100
const USAGE_VIEW_SCHEMA_VERSION = 1
const USAGE_VIEW_RECONCILIATION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const SESSION_USAGE_FIELDS = Object.freeze(['contractId', 'billingStatus', 'status', 'attendanceStatus'])
const CONTRACT_USAGE_FIELDS = Object.freeze(['studentId', 'crmProfileId', 'totalSessions', 'usedSessions'])

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
    .filter((key) => !['generatedAt', 'sourceFingerprint', 'projectionChanged'].includes(key))
    .sort()
    .reduce((result, key) => {
      result[key] = view[key] ?? null
      return result
    }, {})
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

function timestampMillis(value) {
  if (value?.toMillis) return value.toMillis()
  if (value?.toDate) return value.toDate().getTime()
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function contractUsageViewNeedsRebuild(contract = {}, storedView = null, nowMillis = Date.now(), maxAgeMillis = USAGE_VIEW_RECONCILIATION_MAX_AGE_MS) {
  if (!storedView || Number(storedView.schemaVersion || 0) !== USAGE_VIEW_SCHEMA_VERSION) return true
  if (Number(storedView.entitlementSessions || 0) !== Number(contract.totalSessions || 0)) return true
  if (Number(storedView.storedUsedSessions || 0) !== Number(contract.usedSessions || 0)) return true
  if (text(storedView.studentId) !== text(contract.studentId || contract.crmProfileId)) return true
  const generatedAtMillis = timestampMillis(storedView.generatedAt)
  return !generatedAtMillis || nowMillis - generatedAtMillis >= Math.max(60_000, maxAgeMillis)
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

function viewFromSummary(contractId, contract, summary, source = 'contract-usage-v2') {
  return {
    schemaVersion: USAGE_VIEW_SCHEMA_VERSION,
    contractId,
    studentId: text(contract.studentId || contract.crmProfileId, null),
    entitlementSessions: summary.totalSessions,
    historySessions: summary.historySessions,
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
    remainingSessions: nonNegative(view.remainingSessions),
    projectionDelta: Number.isFinite(Number(view.projectionDelta)) ? Number(view.projectionDelta) : 0,
    reconciliationStatus: text(view.reconciliationStatus, 'matched'),
    sourceVersion: text(view.sourceVersion, 'contract-usage-v2'),
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

async function readContractEvidence(db, contractId) {
  const snapshot = await db.collection('sessions')
    .where('contractId', '==', contractId)
    .limit(MAX_SESSION_EVIDENCE + 1)
    .get()
  return {
    sessions: snapshot.docs.slice(0, MAX_SESSION_EVIDENCE).map((item) => ({ id: item.id, ...item.data() })),
    truncated: snapshot.size > MAX_SESSION_EVIDENCE,
  }
}

async function buildContractUsageView({ db, contractId, contract = null, logger = console }) {
  const contractSnapshot = contract ? null : await db.doc(`contracts/${contractId}`).get()
  const value = contract || (contractSnapshot?.exists ? contractSnapshot.data() : null)
  if (!value) return null
  const evidence = await readContractEvidence(db, contractId)
  const summary = summarizeContractUsage(value, evidence.sessions)
  const view = {
    ...viewFromSummary(contractId, value, summary),
    evidenceSessions: evidence.sessions.length,
    evidenceTruncated: evidence.truncated,
    ...(evidence.truncated ? { reconciliationStatus: 'evidence_truncated' } : {}),
  }
  const reference = db.doc(`contractUsageViews/${contractId}`)
  const sourceFingerprint = usageViewFingerprint(view)
  const projectionChanged = await db.runTransaction(async (transaction) => {
    const stored = await transaction.get(reference)
    if (stored.exists && stored.data()?.sourceFingerprint === sourceFingerprint) return false
    transaction.set(reference, {
      ...view,
      sourceFingerprint,
      generatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return true
  })
  logger.info?.(projectionChanged ? 'contract_usage_view_rebuilt' : 'contract_usage_view_unchanged', {
    contractId,
    studentId: view.studentId,
    remainingSessions: view.remainingSessions,
    reconciliationStatus: view.reconciliationStatus,
    evidenceSessions: evidence.sessions.length,
    evidenceTruncated: evidence.truncated,
  })
  return { ...view, sourceFingerprint, projectionChanged }
}

async function getStoredOrFreshView(db, contractId) {
  const stored = await db.doc(`contractUsageViews/${contractId}`).get()
  if (stored.exists) return { id: stored.id, ...stored.data(), generatedAt: stored.data()?.generatedAt?.toDate?.()?.toISOString?.() || stored.data()?.generatedAt || null }
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
  if (event.params?.contractId && !after) {
    await db.doc(`contractUsageViews/${event.params.contractId}`).delete()
    logger.info?.('contract_usage_view_removed', { contractId: event.params.contractId })
    return { contractIds: [event.params.contractId], rebuilt: 0, removed: 1 }
  }
  const sourceFields = event.params?.sessionId ? SESSION_USAGE_FIELDS : CONTRACT_USAGE_FIELDS
  if (!usageSourceChanged(before, after, sourceFields)) {
    return { contractIds: [], rebuilt: 0, removed: 0, skippedUnchangedSource: 1 }
  }
  const contractIds = new Set(event.params?.sessionId ? affectedContractIds(before, after) : [])
  if (event.params?.contractId) contractIds.add(event.params.contractId)
  const results = []
  for (const contractId of contractIds) {
    const view = await buildContractUsageView({ db, contractId, logger })
    if (view) results.push(view)
  }
  return { contractIds: [...contractIds], rebuilt: results.length }
}

module.exports = {
  affectedContractIds,
  CONTRACT_USAGE_FIELDS,
  MAX_SESSION_EVIDENCE,
  SESSION_USAGE_FIELDS,
  USAGE_VIEW_RECONCILIATION_MAX_AGE_MS,
  viewFromSummary,
  usageSummaryFromView,
  usageSourceChanged,
  usageViewFingerprint,
  contractUsageViewNeedsRebuild,
  contractWithUsageView,
  overlayContractUsageViews,
  contractVisibleToActor,
  buildContractUsageView,
  createContractUsageViewFunctions,
  syncContractUsageView,
}
