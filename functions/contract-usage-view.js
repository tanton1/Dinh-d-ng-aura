'use strict'

const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { canonicalUsageSessions } = require('./contract-usage-core')
const { syncContractUsageProjection } = require('./contract-usage')
const {
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
} = require('./contract-usage-view-core')
const { trustedAccessContext } = require('./identity-access')
const { withFunctionTelemetry } = require('./observability')
const MAX_CONTRACTS_PER_STUDENT = 100

function id(value, label) {
  const result = text(value)
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(result)) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return result
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
    return syncContractUsageProjection({ db, event, logger })
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
