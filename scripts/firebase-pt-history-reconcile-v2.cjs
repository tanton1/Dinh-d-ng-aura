'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { sessionCountsTowardContract } = require('../functions/contract-usage')

const PLAN_VERSION = 'pt-history-priority-v2'
const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
})
const RETIRED_SOURCE_PROJECT_ID = 'gen-lang-client-0246058381'
const CONFIRMATION = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}:reconcile-pt-history-v2`
const PRIVATE_DIR = path.resolve('.migration-private')
const REPORTS = Object.freeze({
  'dry-run': path.join(PRIVATE_DIR, 'firebase-pt-history-reconcile-v2-dry-run.json'),
  apply: path.join(PRIVATE_DIR, 'firebase-pt-history-reconcile-v2-apply.json'),
  verify: path.join(PRIVATE_DIR, 'firebase-pt-history-reconcile-v2-verify.json'),
  backup: path.join(PRIVATE_DIR, 'firebase-pt-history-reconcile-v2-backup.json'),
})
const STANDARD_HISTORICAL_STATUSES = new Set(['active', 'expired', 'frozen', 'future'])
const MAX_GAP_DAYS = 31
const MAX_COMMIT_WRITES = 490

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonical(value[key])
      return result
    }, {})
  }
  return value
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value))
}

function parseArguments(argv) {
  const result = { mode: 'dry-run' }
  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') result.help = true
    else if (argument.startsWith('--mode=')) result.mode = argument.slice('--mode='.length)
    else if (argument.startsWith('--project=')) result.projectId = argument.slice('--project='.length)
    else if (argument.startsWith('--database=')) result.databaseId = argument.slice('--database='.length)
    else if (argument.startsWith('--digest=')) result.digest = argument.slice('--digest='.length)
    else if (argument.startsWith('--confirm=')) result.confirmation = argument.slice('--confirm='.length)
    else throw new Error(`Unknown argument: ${argument.split('=')[0]}`)
  }
  if (!['dry-run', 'apply', 'verify'].includes(result.mode)) throw new Error('Mode must be dry-run, apply, or verify.')
  return result
}

function usage() {
  return [
    'PT history-priority reconciliation (target-only; dry-run by default)',
    '',
    'Dry run:',
    '  node scripts/firebase-pt-history-reconcile-v2.cjs',
    '',
    'Verify:',
    '  node scripts/firebase-pt-history-reconcile-v2.cjs --mode=verify',
    '',
    'Apply:',
    `  node scripts/firebase-pt-history-reconcile-v2.cjs --mode=apply --project=${TARGET.projectId} --database=${TARGET.databaseId} --digest=<DRY_RUN_DIGEST> --confirm=${CONFIRMATION}`,
  ].join('\n')
}

function assertTarget(arguments_) {
  if (TARGET.projectId === RETIRED_SOURCE_PROJECT_ID) throw new Error('Target points to the retired source project.')
  if (arguments_.projectId && arguments_.projectId !== TARGET.projectId) throw new Error('Unexpected target project.')
  if (arguments_.databaseId && arguments_.databaseId !== TARGET.databaseId) throw new Error('Unexpected target database.')
  if (arguments_.mode === 'apply') {
    if (arguments_.projectId !== TARGET.projectId || arguments_.databaseId !== TARGET.databaseId) throw new Error('Apply requires exact target guards.')
    if (!/^[a-f0-9]{64}$/.test(arguments_.digest || '')) throw new Error('Apply requires the latest dry-run digest.')
    if (arguments_.confirmation !== CONFIRMATION) throw new Error('Apply confirmation is missing or incorrect.')
  }
}

function firebaseCliAuth() {
  if (!process.env.APPDATA) throw new Error('APPDATA is unavailable.')
  const auth = require(path.join(process.env.APPDATA, 'npm', 'node_modules', 'firebase-tools', 'lib', 'auth.js'))
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI is not signed in.')
  return { auth, account }
}

async function accessToken() {
  const { auth, account } = firebaseCliAuth()
  const result = await auth.getAccessToken(account.tokens.refresh_token, [])
  if (!result?.access_token) throw new Error('Unable to obtain a Firebase access token.')
  return result.access_token
}

function databaseResource() {
  return `projects/${TARGET.projectId}/databases/${TARGET.databaseId}`
}

function databaseBase() {
  return `https://firestore.googleapis.com/v1/${databaseResource()}`
}

async function requestJson(token, endpoint, options = {}) {
  const response = await fetch(`${databaseBase()}${endpoint}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const raw = await response.text()
  if (!response.ok) throw new Error(`Firestore request failed (${response.status}) at ${endpoint.split('?')[0]}.`)
  return raw ? JSON.parse(raw) : null
}

async function assertLiveTarget(token) {
  const metadata = await requestJson(token, '')
  if (metadata?.name !== databaseResource()) throw new Error('Live database does not match the approved target.')
}

function decodeValue(value = {}) {
  if ('nullValue' in value) return null
  if ('booleanValue' in value) return Boolean(value.booleanValue)
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('timestampValue' in value) return value.timestampValue
  if ('stringValue' in value) return value.stringValue
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map(decodeValue)
  if ('mapValue' in value) return decodeFields(value.mapValue?.fields || {})
  return undefined
}

function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]))
}

function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (typeof value === 'string') return { stringValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } }
  if (value && typeof value === 'object') return { mapValue: { fields: encodeFields(value) } }
  throw new Error('Unsupported Firestore value in migration plan.')
}

function encodeFields(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item)]))
}

async function readCollection(token, collectionId) {
  const rows = await requestJson(token, '/documents:runQuery', {
    method: 'POST',
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId, allDescendants: false }], orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }] } }),
  })
  const prefix = `${databaseResource()}/documents/${collectionId}/`
  return (Array.isArray(rows) ? rows : [rows]).filter((row) => row?.document?.name?.startsWith(prefix)).map((row) => ({
    id: row.document.name.slice(prefix.length),
    fields: decodeFields(row.document.fields || {}),
    updateTime: row.document.updateTime,
    fingerprint: sha256(canonicalJson(row.document.fields || {})),
  }))
}

function dateKey(value) {
  const result = typeof value === 'string' ? value.trim().slice(0, 10) : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) return ''
  const parsed = new Date(`${result}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === result ? result : ''
}

function dateDistance(left, right) {
  const leftTime = Date.parse(`${left}T00:00:00.000Z`)
  const rightTime = Date.parse(`${right}T00:00:00.000Z`)
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) ? Math.round(Math.abs(leftTime - rightTime) / 86400000) : null
}

function safeCount(value) {
  const result = Number(value)
  return Number.isFinite(result) ? Math.max(0, Math.floor(result)) : 0
}

function entityHash(collection, id) {
  return sha256(`${PLAN_VERSION}:${collection}/${id}`)
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function intervalGap(sessionDate, contract) {
  if (contract.startDate <= sessionDate && contract.endDate >= sessionDate) return 0
  return sessionDate < contract.startDate ? dateDistance(sessionDate, contract.startDate) : dateDistance(contract.endDate, sessionDate)
}

function normalizedContract(contract) {
  const studentId = String(contract.fields.studentId || '').trim()
  const startDate = dateKey(contract.fields.startDate)
  const endDate = dateKey(contract.fields.endDate)
  const status = String(contract.fields.status || '').trim().toLowerCase()
  return studentId && startDate && endDate && startDate <= endDate
    ? { ...contract, studentId, startDate, endDate, status }
    : null
}

function approvedHistoricalOverride(session, contract) {
  return Number(session.fields.contractLinkVersion || 0) >= 2
    && String(session.fields.contractLinkedBy || '') === `migration:${PLAN_VERSION}`
    && String(contract?.fields?.studentId || '') === String(session.fields.studentId || '')
}

function chooseContract(session, contractsByStudent) {
  const studentId = String(session.fields.studentId || '').trim()
  const sessionDate = dateKey(session.fields.date)
  if (!studentId || !sessionDate || !session.updateTime) return { quarantine: 'INVALID_SESSION' }
  const contracts = contractsByStudent.get(studentId) || []
  const standardCovering = contracts.filter((contract) => STANDARD_HISTORICAL_STATUSES.has(contract.status)
    && contract.startDate <= sessionDate && contract.endDate >= sessionDate)
  if (standardCovering.length === 1) return { contract: standardCovering[0], reason: 'exact_contract_window', confidence: 'exact', gapDays: 0 }
  if (standardCovering.length > 1) {
    const ranked = [...standardCovering].sort((left, right) => right.startDate.localeCompare(left.startDate) || right.endDate.localeCompare(left.endDate) || left.id.localeCompare(right.id))
    if (ranked.length > 1 && ranked[0].startDate === ranked[1].startDate) return { quarantine: 'OVERLAP_SAME_START_DATE' }
    return { contract: ranked[0], reason: 'overlap_latest_contract_start', confidence: 'deterministic_policy', gapDays: 0 }
  }
  const cancelledCovering = contracts.filter((contract) => contract.status === 'cancelled'
    && contract.startDate <= sessionDate && contract.endDate >= sessionDate)
  if (cancelledCovering.length === 1) return { contract: cancelledCovering[0], reason: 'historical_cancelled_contract', confidence: 'exact_history', gapDays: 0 }
  if (cancelledCovering.length > 1) return { quarantine: 'MULTIPLE_CANCELLED_CONTRACTS' }
  const nearest = contracts
    .filter((contract) => STANDARD_HISTORICAL_STATUSES.has(contract.status))
    .map((contract) => ({ contract, gapDays: intervalGap(sessionDate, contract) }))
    .filter((item) => item.gapDays !== null)
    .sort((left, right) => left.gapDays - right.gapDays || right.contract.startDate.localeCompare(left.contract.startDate) || left.contract.id.localeCompare(right.contract.id))
  if (!nearest.length) return { quarantine: 'NO_CONTRACT_EVIDENCE' }
  if (nearest[0].gapDays > MAX_GAP_DAYS) return { quarantine: 'CONTRACT_DATE_GAP_TOO_LARGE' }
  if (nearest.length > 1 && nearest[0].gapDays === nearest[1].gapDays && nearest[0].contract.startDate === nearest[1].contract.startDate) return { quarantine: 'NEAREST_CONTRACT_TIE' }
  return { contract: nearest[0].contract, reason: 'nearest_contract_date_gap', confidence: 'history_priority', gapDays: nearest[0].gapDays }
}

function buildPlan(sessions, contracts) {
  const normalizedContracts = contracts.map(normalizedContract).filter(Boolean)
  const contractsById = new Map(normalizedContracts.map((contract) => [contract.id, contract]))
  const contractsByStudent = new Map()
  for (const contract of normalizedContracts) contractsByStudent.set(contract.studentId, [...(contractsByStudent.get(contract.studentId) || []), contract])
  const classifications = { alreadyLinked: [], exact: [], overlapLatest: [], nearestGap: [], historicalCancelled: [], quarantined: [], invalidExistingLink: [] }
  const sessionLinks = []
  const finalContractBySession = new Map()

  for (const session of sessions) {
    if (!sessionCountsTowardContract(session.fields)) continue
    const existingContractId = String(session.fields.contractId || '').trim()
    if (existingContractId) {
      const contract = contractsById.get(existingContractId)
      if (!contract || contract.studentId !== String(session.fields.studentId || '').trim()) {
        classifications.invalidExistingLink.push(entityHash('sessions', session.id))
        continue
      }
      finalContractBySession.set(session.id, contract.id)
      classifications.alreadyLinked.push(entityHash('sessions', session.id))
      continue
    }
    const choice = chooseContract(session, contractsByStudent)
    if (!choice.contract) {
      classifications.quarantined.push({ sessionHash: entityHash('sessions', session.id), reason: choice.quarantine })
      continue
    }
    finalContractBySession.set(session.id, choice.contract.id)
    const category = choice.reason === 'exact_contract_window' ? 'exact'
      : choice.reason === 'overlap_latest_contract_start' ? 'overlapLatest'
        : choice.reason === 'historical_cancelled_contract' ? 'historicalCancelled' : 'nearestGap'
    classifications[category].push(entityHash('sessions', session.id))
    sessionLinks.push({
      sessionId: session.id,
      contractId: choice.contract.id,
      reason: choice.reason,
      confidence: choice.confidence,
      gapDays: choice.gapDays,
      updateTime: session.updateTime,
      fingerprint: session.fingerprint,
      publicDigest: sha256(canonicalJson({ sessionHash: entityHash('sessions', session.id), contractHash: entityHash('contracts', choice.contract.id), reason: choice.reason, gapDays: choice.gapDays, fingerprint: session.fingerprint })),
    })
  }

  const evidenceByContract = new Map()
  for (const session of sessions) {
    if (!sessionCountsTowardContract(session.fields)) continue
    const contractId = finalContractBySession.get(session.id)
    if (!contractId) continue
    evidenceByContract.set(contractId, [...(evidenceByContract.get(contractId) || []), session.id])
  }

  const contractUpdates = []
  const projectedUsage = new Map()
  for (const contract of normalizedContracts) {
    const evidenceIds = [...new Set(evidenceByContract.get(contract.id) || [])].sort()
    const existingIds = [...new Set((Array.isArray(contract.fields.chargedSessionIds) ? contract.fields.chargedSessionIds : []).filter((value) => typeof value === 'string' && value))]
    const chargedSessionIds = [...new Set([...existingIds, ...evidenceIds])].sort()
    const beforeUsed = safeCount(contract.fields.usedSessions)
    const afterUsed = Math.max(beforeUsed, evidenceIds.length)
    projectedUsage.set(contract.id, afterUsed)
    const status = afterUsed > safeCount(contract.fields.totalSessions) ? 'over_entitlement'
      : afterUsed > evidenceIds.length ? 'legacy_projection_preserved' : 'matched'
    const exactHistoryTerminal = Number(contract.fields.usageReconciliationVersion || 0) >= 4
      && String(contract.fields.usageReconciledFrom || '') === 'pt-contract-history-exact-v1'
      && safeCount(contract.fields.usedSessions) === evidenceIds.length
      && safeCount(contract.fields.historyEvidenceSessions) === evidenceIds.length
    const metadataCurrent = exactHistoryTerminal || (Number(contract.fields.usageReconciliationVersion || 0) >= 3
      && String(contract.fields.usageReconciledFrom || '') === PLAN_VERSION
      && String(contract.fields.usageReconciliationStatus || '') === status
      && safeCount(contract.fields.historyEvidenceSessions) === evidenceIds.length)
    if (afterUsed !== beforeUsed || !arraysEqual(chargedSessionIds, [...existingIds].sort()) || !metadataCurrent) {
      contractUpdates.push({
        contractId: contract.id,
        beforeUsed,
        afterUsed,
        totalSessions: safeCount(contract.fields.totalSessions),
        evidenceSessions: evidenceIds.length,
        chargedSessionIds,
        status,
        usageChanged: afterUsed !== beforeUsed,
        chargedIdsChanged: !arraysEqual(chargedSessionIds, [...existingIds].sort()),
        metadataChanged: !metadataCurrent,
        metadataMismatch: {
          version: Number(contract.fields.usageReconciliationVersion || 0) < 3,
          source: String(contract.fields.usageReconciledFrom || '') !== PLAN_VERSION,
          status: String(contract.fields.usageReconciliationStatus || '') !== status,
          evidence: safeCount(contract.fields.historyEvidenceSessions) !== evidenceIds.length,
        },
        updateTime: contract.updateTime,
        fingerprint: contract.fingerprint,
        publicDigest: sha256(canonicalJson({ contractHash: entityHash('contracts', contract.id), beforeUsed, afterUsed, evidenceSessions: evidenceIds.length, status, fingerprint: contract.fingerprint })),
      })
    }
  }

  const completedHandoverCorrections = []
  const futureRenewalUpdates = []
  for (const renewal of normalizedContracts.filter((contract) => String(contract.fields.sourceContractId || ''))) {
    const source = contractsById.get(String(renewal.fields.sourceContractId || ''))
    if (!source) continue
    const projectedSourceUsed = projectedUsage.get(source.id) ?? safeCount(source.fields.usedSessions)
    const sourceChanged = projectedSourceUsed !== safeCount(source.fields.usedSessions)
    const pending = renewal.status === 'future' && renewal.fields.carryOverPending === true
    if (sourceChanged && !pending) {
      const correctedCarryOverSessions = Math.max(0, safeCount(source.fields.totalSessions) - projectedSourceUsed)
      const packageSessions = safeCount(renewal.fields.packageSessions)
      completedHandoverCorrections.push({
        sourceId: source.id,
        sourceUpdateTime: source.updateTime,
        renewalId: renewal.id,
        renewalUpdateTime: renewal.updateTime,
        sourceHash: entityHash('contracts', source.id),
        renewalHash: entityHash('contracts', renewal.id),
        sourceUsedBefore: safeCount(source.fields.usedSessions),
        sourceUsedAfter: projectedSourceUsed,
        sourceTotalSessions: safeCount(source.fields.totalSessions),
        carriedOverBefore: safeCount(renewal.fields.carriedOverSessions),
        correctedCarryOverSessions,
        renewalTotalBefore: safeCount(renewal.fields.totalSessions),
        correctedRenewalTotal: packageSessions + correctedCarryOverSessions,
        renewalUsedSessions: projectedUsage.get(renewal.id) ?? safeCount(renewal.fields.usedSessions),
      })
      continue
    }
    if (!pending || renewal.fields.carryOverRequested !== true) continue
    const remaining = Math.max(0, safeCount(source.fields.totalSessions) - projectedSourceUsed)
    const packageSessions = safeCount(renewal.fields.packageSessions)
    const totalSessions = packageSessions + remaining
    if (safeCount(renewal.fields.plannedCarryOverSessions) === remaining && safeCount(renewal.fields.totalSessions) === totalSessions) continue
    futureRenewalUpdates.push({
      contractId: renewal.id,
      plannedCarryOverSessions: remaining,
      totalSessions,
      updateTime: renewal.updateTime,
      fingerprint: renewal.fingerprint,
      publicDigest: sha256(canonicalJson({ renewalHash: entityHash('contracts', renewal.id), remaining, totalSessions, fingerprint: renewal.fingerprint })),
    })
  }

  sessionLinks.sort((left, right) => left.sessionId.localeCompare(right.sessionId))
  contractUpdates.sort((left, right) => left.contractId.localeCompare(right.contractId))
  futureRenewalUpdates.sort((left, right) => left.contractId.localeCompare(right.contractId))
  const planDigest = sha256(canonicalJson({
    planVersion: PLAN_VERSION,
    target: TARGET,
    inventory: { sessions: sessions.length, contracts: contracts.length },
    sessionLinks: sessionLinks.map((item) => item.publicDigest),
    contractUpdates: contractUpdates.map((item) => item.publicDigest),
    futureRenewalUpdates: futureRenewalUpdates.map((item) => item.publicDigest),
    quarantined: classifications.quarantined,
    invalidExistingLink: classifications.invalidExistingLink,
    completedHandoverCorrections: completedHandoverCorrections.map(({ sourceId, sourceUpdateTime, renewalId, renewalUpdateTime, ...item }) => item),
  }))
  return { planDigest, sessionLinks, contractUpdates, futureRenewalUpdates, completedHandoverCorrections, classifications }
}

function category(values) {
  return { count: values.length, hashedSamples: values.slice(0, 100), sampleLimit: 100 }
}

function publicReport(mode, sessions, contracts, plan, extra = {}) {
  return {
    generatedAt: new Date().toISOString(),
    mode,
    target: TARGET,
    planVersion: PLAN_VERSION,
    planDigest: plan.planDigest,
    readScope: 'target-only',
    writeScope: mode === 'apply' ? 'session contract links, monotonic contract usage projection, pending renewal projection, one audit record' : 'none',
    writesPerformed: mode === 'apply',
    inventory: { sessions: sessions.length, contracts: contracts.length },
    links: {
      planned: plan.sessionLinks.length,
      exact: category(plan.classifications.exact),
      overlapLatestContract: category(plan.classifications.overlapLatest),
      nearestDateGap: category(plan.classifications.nearestGap),
      historicalCancelled: category(plan.classifications.historicalCancelled),
      quarantined: plan.classifications.quarantined,
      invalidExistingLink: category(plan.classifications.invalidExistingLink),
    },
    usageProjection: {
      contractUpdates: plan.contractUpdates.length,
      totalMonotonicIncrease: plan.contractUpdates.reduce((sum, item) => sum + item.afterUsed - item.beforeUsed, 0),
      evidenceAheadContracts: plan.contractUpdates.filter((item) => item.afterUsed > item.beforeUsed).length,
      overEntitlementContracts: plan.contractUpdates.filter((item) => item.status === 'over_entitlement').length,
      legacyProjectionPreservedContracts: plan.contractUpdates.filter((item) => item.status === 'legacy_projection_preserved').length,
      decreasesPlanned: plan.contractUpdates.filter((item) => item.afterUsed < item.beforeUsed).length,
      updateReasons: {
        usage: plan.contractUpdates.filter((item) => item.usageChanged).length,
        chargedSessionIds: plan.contractUpdates.filter((item) => item.chargedIdsChanged).length,
        metadata: plan.contractUpdates.filter((item) => item.metadataChanged).length,
        metadataVersion: plan.contractUpdates.filter((item) => item.metadataMismatch.version).length,
        metadataSource: plan.contractUpdates.filter((item) => item.metadataMismatch.source).length,
        metadataStatus: plan.contractUpdates.filter((item) => item.metadataMismatch.status).length,
        metadataEvidence: plan.contractUpdates.filter((item) => item.metadataMismatch.evidence).length,
      },
    },
    renewals: {
      pendingProjectionUpdates: plan.futureRenewalUpdates.length,
      completedHandoverCorrections: plan.completedHandoverCorrections.map(({ sourceId, sourceUpdateTime, renewalId, renewalUpdateTime, ...item }) => item),
    },
    piiPolicy: 'Public reports contain only counts and SHA-256 hashes; no names, email addresses or phone numbers.',
    ...extra,
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(PRIVATE_DIR, { recursive: true })
  const temporary = `${filePath}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, filePath)
}

function loadApprovedDryRun(digest) {
  if (!fs.existsSync(REPORTS['dry-run'])) throw new Error('Dry-run report is missing.')
  const report = JSON.parse(fs.readFileSync(REPORTS['dry-run'], 'utf8'))
  if (report?.mode !== 'dry-run' || report?.planVersion !== PLAN_VERSION || canonicalJson(report.target) !== canonicalJson(TARGET)) throw new Error('Dry-run report is incompatible.')
  if (report.planDigest !== digest) throw new Error('Digest does not match the latest dry-run report.')
}

function updateWrite(collectionId, id, updateTime, fields, timestampFields = []) {
  return {
    update: { name: `${databaseResource()}/documents/${collectionId}/${id}`, fields: encodeFields(fields) },
    updateMask: { fieldPaths: Object.keys(fields) },
    ...(timestampFields.length ? { updateTransforms: timestampFields.map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) } : {}),
    currentDocument: { updateTime },
  }
}

function sessionWrite(item) {
  return updateWrite('sessions', item.sessionId, item.updateTime, {
    contractId: item.contractId,
    contractLinkVersion: 2,
    contractLinkReason: item.reason,
    contractLinkConfidence: item.confidence,
    contractLinkGapDays: item.gapDays,
    contractLinkedBy: `migration:${PLAN_VERSION}`,
  }, ['contractLinkedAt'])
}

function mergedContractWrites(plan) {
  const patches = new Map()
  const merge = (contractId, updateTime, fields, timestampFields = []) => {
    const current = patches.get(contractId) || { contractId, updateTime, fields: {}, timestampFields: new Set() }
    if (current.updateTime !== updateTime) throw new Error(`Conflicting preconditions for contract ${contractId}.`)
    Object.assign(current.fields, fields)
    timestampFields.forEach((field) => current.timestampFields.add(field))
    patches.set(contractId, current)
  }
  plan.contractUpdates.forEach((item) => merge(item.contractId, item.updateTime, {
    usedSessions: item.afterUsed,
    chargedSessionIds: item.chargedSessionIds,
    usageReconciliationVersion: 3,
    usageReconciledFrom: PLAN_VERSION,
    usageReconciliationStatus: item.status,
    historyEvidenceSessions: item.evidenceSessions,
  }, ['usageReconciledAt']))
  plan.futureRenewalUpdates.forEach((item) => merge(item.contractId, item.updateTime, {
    plannedCarryOverSessions: item.plannedCarryOverSessions,
    totalSessions: item.totalSessions,
    carryOverProjectionVersion: 2,
    carryOverProjectedFrom: PLAN_VERSION,
  }, ['carryOverProjectionUpdatedAt']))
  plan.completedHandoverCorrections.forEach((item) => {
    merge(item.sourceId, item.sourceUpdateTime, {
      carryOverTransferredSessions: item.correctedCarryOverSessions,
      carryOverReconciliationVersion: 2,
      carryOverReconciledFrom: PLAN_VERSION,
    }, ['carryOverReconciledAt'])
    merge(item.renewalId, item.renewalUpdateTime, {
      carriedOverSessions: item.correctedCarryOverSessions,
      plannedCarryOverSessions: item.correctedCarryOverSessions,
      totalSessions: item.correctedRenewalTotal,
      carryOverReconciliationVersion: 2,
      carryOverReconciledFrom: PLAN_VERSION,
    }, ['carryOverReconciledAt'])
  })
  return [...patches.values()].sort((left, right) => left.contractId.localeCompare(right.contractId))
    .map((item) => updateWrite('contracts', item.contractId, item.updateTime, item.fields, [...item.timestampFields]))
}

function auditWrite(plan) {
  const auditId = `pt_history_${plan.planDigest.slice(0, 40)}`
  return {
    update: {
      name: `${databaseResource()}/documents/ptOperationsAuditLogs/${auditId}`,
      fields: encodeFields({
        schemaVersion: 3,
        action: 'pt_history.reconciled',
        actorUid: `system:${PLAN_VERSION}`,
        planDigest: plan.planDigest,
        linkedSessions: plan.sessionLinks.length,
        updatedContracts: plan.contractUpdates.length,
        pendingRenewalUpdates: plan.futureRenewalUpdates.length,
      }),
    },
    currentDocument: { exists: false },
    updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
  }
}

function backupManifest(sessions, contracts, plan) {
  const sessionsById = new Map(sessions.map((item) => [item.id, item]))
  const contractsById = new Map(contracts.map((item) => [item.id, item]))
  return {
    generatedAt: new Date().toISOString(),
    target: TARGET,
    planVersion: PLAN_VERSION,
    planDigest: plan.planDigest,
    sessions: plan.sessionLinks.map((item) => {
      const source = sessionsById.get(item.sessionId)
      return { id: item.sessionId, updateTime: source.updateTime, before: { contractId: source.fields.contractId ?? null, contractLinkVersion: source.fields.contractLinkVersion ?? null, contractLinkReason: source.fields.contractLinkReason ?? null, contractLinkConfidence: source.fields.contractLinkConfidence ?? null, contractLinkGapDays: source.fields.contractLinkGapDays ?? null, contractLinkedBy: source.fields.contractLinkedBy ?? null, contractLinkedAt: source.fields.contractLinkedAt ?? null } }
    }),
    contracts: [...new Set([
      ...plan.contractUpdates.map((item) => item.contractId),
      ...plan.futureRenewalUpdates.map((item) => item.contractId),
      ...plan.completedHandoverCorrections.flatMap((item) => [item.sourceId, item.renewalId]),
    ])].map((id) => {
      const source = contractsById.get(id)
      return { id, updateTime: source.updateTime, before: source.fields }
    }),
  }
}

async function liveState(token) {
  const [sessions, contracts] = await Promise.all([readCollection(token, 'sessions'), readCollection(token, 'contracts')])
  return { sessions, contracts, plan: buildPlan(sessions, contracts) }
}

function assertPlanSafe(plan) {
  if (plan.classifications.quarantined.length) throw new Error(`Apply blocked: ${plan.classifications.quarantined.length} session(s) remain quarantined.`)
  if (plan.classifications.invalidExistingLink.length) throw new Error(`Apply blocked: ${plan.classifications.invalidExistingLink.length} invalid existing link(s).`)
  if (plan.completedHandoverCorrections.some((item) => item.correctedRenewalTotal < item.renewalUsedSessions)) throw new Error('Apply blocked: a corrected renewal entitlement would be below its used sessions.')
  if (plan.contractUpdates.some((item) => item.afterUsed < item.beforeUsed)) throw new Error('Apply blocked: a contract usage decrease was planned.')
  const writeCount = plan.sessionLinks.length + mergedContractWrites(plan).length + 1
  if (writeCount > MAX_COMMIT_WRITES) throw new Error(`Apply blocked: ${writeCount} writes exceed the single-commit safety limit.`)
}

async function applyPlan(token, plan) {
  const writes = [
    ...plan.sessionLinks.map(sessionWrite),
    ...mergedContractWrites(plan),
    auditWrite(plan),
  ]
  await requestJson(token, '/documents:commit', { method: 'POST', body: JSON.stringify({ writes }) })
  return writes.length
}

async function dryRun(token) {
  const state = await liveState(token)
  const output = publicReport('dry-run', state.sessions, state.contracts, state.plan, { writesPerformed: false, applyConfirmation: CONFIRMATION })
  writeJson(REPORTS['dry-run'], output)
  console.log(JSON.stringify({
    mode: 'dry-run', target: TARGET, planDigest: state.plan.planDigest,
    sessionLinks: state.plan.sessionLinks.length,
    exact: state.plan.classifications.exact.length,
    overlapLatest: state.plan.classifications.overlapLatest.length,
    nearestGap: state.plan.classifications.nearestGap.length,
    historicalCancelled: state.plan.classifications.historicalCancelled.length,
    quarantined: state.plan.classifications.quarantined.length,
    invalidExistingLink: state.plan.classifications.invalidExistingLink.length,
    contractUpdates: state.plan.contractUpdates.length,
    usageIncrease: output.usageProjection.totalMonotonicIncrease,
    overEntitlementContracts: output.usageProjection.overEntitlementContracts,
    pendingRenewalUpdates: state.plan.futureRenewalUpdates.length,
    completedHandoverCorrections: state.plan.completedHandoverCorrections.length,
    reportPath: REPORTS['dry-run'], writesPerformed: false,
  }, null, 2))
}

async function apply(token, arguments_) {
  loadApprovedDryRun(arguments_.digest)
  const before = await liveState(token)
  if (before.plan.planDigest !== arguments_.digest) throw new Error('Live target changed after dry-run; apply aborted.')
  assertPlanSafe(before.plan)
  writeJson(REPORTS.backup, backupManifest(before.sessions, before.contracts, before.plan))
  const writes = await applyPlan(token, before.plan)
  const after = await liveState(token)
  const verified = after.plan.sessionLinks.length === 0
    && after.plan.classifications.quarantined.length === 0
    && after.plan.classifications.invalidExistingLink.length === 0
    && after.plan.contractUpdates.length === 0
    && after.plan.futureRenewalUpdates.length === 0
    && after.plan.completedHandoverCorrections.length === 0
  const output = publicReport('apply', after.sessions, after.contracts, after.plan, {
    approvedDryRunDigest: arguments_.digest,
    writesPerformed: true,
    committedWrites: writes,
    verified,
    backupPath: REPORTS.backup,
  })
  writeJson(REPORTS.apply, output)
  console.log(JSON.stringify({ mode: 'apply', committedWrites: writes, verified, remainingSessionLinks: after.plan.sessionLinks.length, remainingContractUpdates: after.plan.contractUpdates.length, reportPath: REPORTS.apply, backupPath: REPORTS.backup }, null, 2))
  if (!verified) process.exitCode = 2
}

async function verify(token) {
  const state = await liveState(token)
  const verified = state.plan.sessionLinks.length === 0
    && state.plan.classifications.quarantined.length === 0
    && state.plan.classifications.invalidExistingLink.length === 0
    && state.plan.contractUpdates.length === 0
    && state.plan.futureRenewalUpdates.length === 0
    && state.plan.completedHandoverCorrections.length === 0
  const output = publicReport('verify', state.sessions, state.contracts, state.plan, { writesPerformed: false, verified })
  writeJson(REPORTS.verify, output)
  console.log(JSON.stringify({ mode: 'verify', verified, sessionLinks: state.plan.sessionLinks.length, quarantined: state.plan.classifications.quarantined.length, invalidExistingLink: state.plan.classifications.invalidExistingLink.length, contractUpdates: state.plan.contractUpdates.length, pendingRenewalUpdates: state.plan.futureRenewalUpdates.length, reportPath: REPORTS.verify }, null, 2))
  if (!verified) process.exitCode = 2
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2))
  if (arguments_.help) return console.log(usage())
  assertTarget(arguments_)
  const token = await accessToken()
  await assertLiveTarget(token)
  if (arguments_.mode === 'dry-run') await dryRun(token)
  else if (arguments_.mode === 'apply') await apply(token, arguments_)
  else await verify(token)
}

if (require.main === module) main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'PT history reconciliation failed.')
  process.exitCode = 1
})

module.exports = { PLAN_VERSION, TARGET, MAX_GAP_DAYS, chooseContract, buildPlan, assertPlanSafe }
