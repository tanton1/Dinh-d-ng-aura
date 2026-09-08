'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const PLAN_VERSION = 'source-session-delta-v2'
const SOURCE = Object.freeze({
  projectId: 'gen-lang-client-0246058381',
  databaseId: 'aura-fitness-db',
})
const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
})
const APPLY_CONFIRMATION = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}:apply-source-session-delta`
const PRIVATE_DIR = path.resolve('.migration-private')
const STATE_PATH = path.join(PRIVATE_DIR, 'firestore-staging-state.json')
const REPORTS = Object.freeze({
  'dry-run': path.join(PRIVATE_DIR, 'firebase-firestore-session-delta-dry-run.json'),
  apply: path.join(PRIVATE_DIR, 'firebase-firestore-session-delta-apply.json'),
  verify: path.join(PRIVATE_DIR, 'firebase-firestore-session-delta-verify.json'),
})
const MAX_ATOMIC_WRITES = 490
const STANDARD_CONTRACT_STATUSES = new Set(['active', 'expired', 'frozen', 'future'])
const ACTIVE_SESSION_STATUSES = new Set(['scheduled', 'rescheduled'])
const IMPORT_MARKERS = new Set([
  'migration:source-session-delta-v1',
  `migration:${PLAN_VERSION}`,
])
const TARGET_OWNED_SESSION_FIELDS = new Set([
  'attendanceEventId', 'attendanceStatus', 'autoConfirmedAt', 'billingEventId', 'billingIssueCode',
  'billingStatus', 'chargedAt', 'completedAt', 'confirmationSource', 'confirmedAt', 'confirmedBy',
  'contractId', 'contractLinkConfidence', 'contractLinkGapDays', 'contractLinkReason',
  'contractLinkVersion', 'contractLinkedAt', 'contractLinkedBy', 'recognitionReviewIssueCode',
  'recognitionReviewRequired', 'revenueRecognitionEntryId', 'revision', 'scheduleStatus',
  'serviceOrdinal', 'updatedAt', 'updatedBy',
])

function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex')
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
    'Read-only-source session delta migration (dry-run by default)',
    '',
    'Dry run:',
    '  node scripts/firebase-firestore-session-delta.cjs --mode=dry-run',
    '',
    'Apply (all guards are required):',
    `  node scripts/firebase-firestore-session-delta.cjs --mode=apply --project=${TARGET.projectId} --database=${TARGET.databaseId} --digest=<DRY_RUN_DIGEST> --confirm=${APPLY_CONFIRMATION}`,
    '',
    'Verify:',
    '  node scripts/firebase-firestore-session-delta.cjs --mode=verify',
  ].join('\n')
}

function assertApplyGuards(arguments_) {
  if (TARGET.projectId === SOURCE.projectId) throw new Error('Target points to the retired source project.')
  if (arguments_.mode !== 'apply') return
  if (arguments_.projectId !== TARGET.projectId || arguments_.databaseId !== TARGET.databaseId) {
    throw new Error('Apply requires the exact production target project and named database.')
  }
  if (!/^[a-f0-9]{64}$/.test(arguments_.digest || '')) throw new Error('Apply requires the latest dry-run digest.')
  if (arguments_.confirmation !== APPLY_CONFIRMATION) throw new Error('Apply confirmation does not match the target-only guard.')
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

function databaseResource(config) {
  return `projects/${config.projectId}/databases/${config.databaseId}`
}

function databaseBase(config) {
  return `https://firestore.googleapis.com/v1/${databaseResource(config)}`
}

async function requestJson(token, config, endpoint, options = {}) {
  const response = await fetch(`${databaseBase(config)}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const raw = await response.text()
  let body = null
  if (raw) {
    try { body = JSON.parse(raw) } catch { body = { raw: raw.slice(0, 500) } }
  }
  if (!response.ok) throw new Error(`Firestore request failed (${response.status}) at ${endpoint.split('?')[0]}: ${body?.error?.message || body?.raw || response.statusText}`)
  return body
}

async function assertDatabase(token, config) {
  const metadata = await requestJson(token, config, '')
  if (metadata?.name !== databaseResource(config)) throw new Error(`Database metadata mismatch for ${config.projectId}.`)
  return metadata
}

function approvedSnapshotState() {
  if (!fs.existsSync(STATE_PATH)) throw new Error('Migration state is missing. Create source and target backups first.')
  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
  if (!state.sourceExport?.done || state.sourceExport?.error || !state.sourceExport?.snapshotTime) {
    throw new Error('The read-only source snapshot is not complete.')
  }
  if (!state.targetBackup?.done || state.targetBackup?.error) throw new Error('The production target backup is not complete.')
  if (!String(state.sourceExport.outputUriPrefix || '').startsWith('gs://aura-migration-607039870489-20260819/source-pitr/')) {
    throw new Error('Unexpected source snapshot location.')
  }
  if (!String(state.targetBackup.outputUriPrefix || '').startsWith('gs://aura-migration-607039870489-20260819/target-backup/')) {
    throw new Error('Unexpected target backup location.')
  }
  return {
    sourceSnapshotTime: state.sourceExport.snapshotTime,
    sourceSnapshotUri: state.sourceExport.outputUriPrefix,
    targetBackupUri: state.targetBackup.outputUriPrefix,
  }
}

async function readCollection(token, config, collectionId, readTime = '') {
  const structuredQuery = {
    from: [{ collectionId, allDescendants: false }],
    orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
  }
  const body = { structuredQuery }
  if (readTime) body.readTime = readTime
  const rows = await requestJson(token, config, '/documents:runQuery', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  const prefix = `${databaseResource(config)}/documents/${collectionId}/`
  return (Array.isArray(rows) ? rows : [rows]).filter((row) => row?.document?.name?.startsWith(prefix)).map((row) => ({
    id: row.document.name.slice(prefix.length),
    fields: row.document.fields || {},
    updateTime: row.document.updateTime,
    fingerprint: sha256(row.document.fields || {}),
  }))
}

function decodeValue(value = {}) {
  if ('nullValue' in value) return null
  if ('booleanValue' in value) return Boolean(value.booleanValue)
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('timestampValue' in value) return value.timestampValue
  if ('stringValue' in value) return value.stringValue
  if ('referenceValue' in value) return value.referenceValue
  if ('geoPointValue' in value) return value.geoPointValue
  if ('bytesValue' in value) return value.bytesValue
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

function dateKey(value) {
  const result = typeof value === 'string' ? value.trim().slice(0, 10) : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) return ''
  const parsed = new Date(`${result}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === result ? result : ''
}

function normalizedText(value) {
  return String(value || '').trim().toLocaleLowerCase('vi-VN').replace(/\s+/g, ' ')
}

function normalizedContract(document) {
  const fields = decodeFields(document.fields)
  const studentId = String(fields.studentId || '').trim()
  const startDate = dateKey(fields.startDate)
  const endDate = dateKey(fields.endDate)
  const status = normalizedText(fields.status)
  return studentId && startDate && endDate && startDate <= endDate
    ? { ...document, decoded: fields, studentId, startDate, endDate, status }
    : null
}

function sessionSemanticKey(fields) {
  const decoded = decodeFields(fields)
  const studentId = String(decoded.studentId || '').trim()
  const date = dateKey(decoded.date)
  const hour = normalizedText(decoded.hour || decoded.time || decoded.slot)
  const trainerId = String(decoded.trainerId || '').trim()
  return studentId && date && hour && trainerId ? `${studentId}|${date}|${hour}|${trainerId}` : ''
}

function chooseContract(sourceSession, contractsByStudent) {
  const fields = decodeFields(sourceSession.fields)
  const studentId = String(fields.studentId || '').trim()
  const sessionDate = dateKey(fields.date)
  if (!studentId || !sessionDate || !sourceSession.updateTime) return { quarantine: 'INVALID_SESSION' }
  const contracts = contractsByStudent.get(studentId) || []
  const standardCovering = contracts.filter((contract) => STANDARD_CONTRACT_STATUSES.has(contract.status)
    && contract.startDate <= sessionDate && contract.endDate >= sessionDate)
  if (standardCovering.length === 1) {
    return { contract: standardCovering[0], reason: 'exact_contract_window', confidence: 'exact' }
  }
  if (standardCovering.length > 1) {
    const ranked = [...standardCovering].sort((left, right) => right.startDate.localeCompare(left.startDate)
      || right.endDate.localeCompare(left.endDate) || left.id.localeCompare(right.id))
    if (ranked[0].startDate === ranked[1].startDate) return { quarantine: 'OVERLAP_SAME_START_DATE' }
    return { contract: ranked[0], reason: 'overlap_latest_contract_start', confidence: 'deterministic_policy' }
  }
  const cancelledCovering = contracts.filter((contract) => contract.status === 'cancelled'
    && contract.startDate <= sessionDate && contract.endDate >= sessionDate)
  if (cancelledCovering.length === 1) {
    return { contract: cancelledCovering[0], reason: 'historical_cancelled_contract', confidence: 'exact_history' }
  }
  if (cancelledCovering.length > 1) return { quarantine: 'MULTIPLE_CANCELLED_CONTRACTS' }
  return { quarantine: contracts.length ? 'NO_CONTRACT_COVERING_DATE' : 'NO_CONTRACT_EVIDENCE' }
}

function rewriteReferences(value) {
  if (Array.isArray(value)) return value.map(rewriteReferences)
  if (!value || typeof value !== 'object') return value
  const output = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === 'referenceValue' && typeof child === 'string') {
      output[key] = child.replace(
        `${databaseResource(SOURCE)}/documents/`,
        `${databaseResource(TARGET)}/documents/`,
      )
    } else output[key] = rewriteReferences(child)
  }
  return output
}

function entityHash(collection, id) {
  return sha256(`${PLAN_VERSION}:${collection}/${id}`)
}

function publicClassification(collection, id, reason) {
  return { entityHash: entityHash(collection, id), reason }
}

function initialLifecycleFields(sourceFields) {
  const decoded = decodeFields(sourceFields)
  const status = normalizedText(decoded.status)
  if (!ACTIVE_SESSION_STATUSES.has(status)) return {}
  return {
    schemaVersion: 2,
    scheduleStatus: status,
    billingStatus: 'pending',
    attendanceStatus: 'pending',
    revision: 0,
    verifiedByStudent: false,
  }
}

function pendingLifecyclePatch(targetSession) {
  const decoded = decodeFields(targetSession.fields)
  if (!IMPORT_MARKERS.has(String(decoded.contractLinkedBy || ''))) return null
  const status = normalizedText(decoded.status)
  if (!ACTIVE_SESSION_STATUSES.has(status)) return null
  const desired = initialLifecycleFields(targetSession.fields)
  const patch = {}
  for (const [name, value] of Object.entries(desired)) {
    if (decoded[name] === undefined || decoded[name] === null || decoded[name] === '') patch[name] = value
  }
  if (!Object.keys(patch).length) return null
  return {
    sessionId: targetSession.id,
    targetUpdateTime: targetSession.updateTime,
    fields: encodeFields(patch),
    fieldPaths: Object.keys(patch).sort(),
    publicDigest: sha256({
      sessionHash: entityHash('sessions', targetSession.id),
      targetFingerprint: targetSession.fingerprint,
      patch,
    }),
  }
}

function buildPlan(sourceSessions, targetSessions, targetContracts, snapshot) {
  const targetSessionsById = new Map(targetSessions.map((item) => [item.id, item]))
  const normalizedContracts = targetContracts.map(normalizedContract).filter(Boolean)
  const contractsByStudent = new Map()
  for (const contract of normalizedContracts) {
    contractsByStudent.set(contract.studentId, [...(contractsByStudent.get(contract.studentId) || []), contract])
  }

  const targetSemanticKeys = new Set(targetSessions.map((item) => sessionSemanticKey(item.fields)).filter(Boolean))
  const missingSource = sourceSessions.filter((item) => !targetSessionsById.has(item.id))
  const missingBySemanticKey = new Map()
  for (const session of missingSource) {
    const key = sessionSemanticKey(session.fields)
    if (key) missingBySemanticKey.set(key, [...(missingBySemanticKey.get(key) || []), session])
  }

  const classifications = {
    exact: [],
    overlapLatest: [],
    historicalCancelled: [],
    semanticDuplicates: [],
    sourceDuplicates: [],
    quarantined: [],
    alreadyPresentById: [],
  }
  const creates = []
  const lifecyclePatches = targetSessions.map(pendingLifecyclePatch).filter(Boolean)
  let strippedRuntimeFieldCount = 0

  for (const sourceSession of sourceSessions) {
    if (targetSessionsById.has(sourceSession.id)) {
      classifications.alreadyPresentById.push(entityHash('sessions', sourceSession.id))
      continue
    }
    const semanticKey = sessionSemanticKey(sourceSession.fields)
    if (!semanticKey) {
      classifications.quarantined.push(publicClassification('sessions', sourceSession.id, 'INVALID_SEMANTIC_KEY'))
      continue
    }
    if (targetSemanticKeys.has(semanticKey)) {
      classifications.semanticDuplicates.push(publicClassification('sessions', sourceSession.id, 'TARGET_SEMANTIC_DUPLICATE'))
      continue
    }
    if ((missingBySemanticKey.get(semanticKey) || []).length > 1) {
      classifications.sourceDuplicates.push(publicClassification('sessions', sourceSession.id, 'SOURCE_SEMANTIC_DUPLICATE'))
      continue
    }
    const choice = chooseContract(sourceSession, contractsByStudent)
    if (!choice.contract) {
      classifications.quarantined.push(publicClassification('sessions', sourceSession.id, choice.quarantine))
      continue
    }

    const fields = {}
    const strippedFields = []
    for (const [name, value] of Object.entries(sourceSession.fields || {})) {
      if (TARGET_OWNED_SESSION_FIELDS.has(name)) {
        strippedFields.push(name)
        continue
      }
      fields[name] = rewriteReferences(value)
    }
    strippedRuntimeFieldCount += strippedFields.length
    Object.assign(fields, encodeFields({
      contractId: choice.contract.id,
      contractLinkVersion: 3,
      contractLinkReason: choice.reason,
      contractLinkConfidence: choice.confidence,
      contractLinkGapDays: 0,
      contractLinkedBy: `migration:${PLAN_VERSION}`,
      ...initialLifecycleFields(sourceSession.fields),
    }))
    const publicDigest = sha256({
      sessionHash: entityHash('sessions', sourceSession.id),
      contractHash: entityHash('contracts', choice.contract.id),
      reason: choice.reason,
      sourceFingerprint: sourceSession.fingerprint,
      fieldNames: Object.keys(fields).sort(),
    })
    creates.push({
      sessionId: sourceSession.id,
      contractId: choice.contract.id,
      sourceUpdateTime: sourceSession.updateTime,
      sourceFingerprint: sourceSession.fingerprint,
      reason: choice.reason,
      confidence: choice.confidence,
      fields,
      strippedFields: strippedFields.sort(),
      publicDigest,
    })
    const category = choice.reason === 'exact_contract_window' ? 'exact'
      : choice.reason === 'overlap_latest_contract_start' ? 'overlapLatest' : 'historicalCancelled'
    classifications[category].push(entityHash('sessions', sourceSession.id))
  }

  creates.sort((left, right) => left.sessionId.localeCompare(right.sessionId))
  lifecyclePatches.sort((left, right) => left.sessionId.localeCompare(right.sessionId))
  for (const value of Object.values(classifications)) {
    value.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)))
  }
  const planDigest = sha256({
    planVersion: PLAN_VERSION,
    snapshot,
    creates: creates.map((item) => item.publicDigest),
    lifecyclePatches: lifecyclePatches.map((item) => item.publicDigest),
    semanticDuplicates: classifications.semanticDuplicates,
    sourceDuplicates: classifications.sourceDuplicates,
    quarantined: classifications.quarantined,
  })
  return {
    planVersion: PLAN_VERSION,
    planDigest,
    creates,
    lifecyclePatches,
    classifications,
    summary: {
      sourceSessions: sourceSessions.length,
      targetSessions: targetSessions.length,
      targetContracts: targetContracts.length,
      normalizedTargetContracts: normalizedContracts.length,
      sourceMissingById: missingSource.length,
      safeCreates: creates.length,
      lifecyclePatches: lifecyclePatches.length,
      exactContractWindow: classifications.exact.length,
      overlapLatestContractStart: classifications.overlapLatest.length,
      historicalCancelledContract: classifications.historicalCancelled.length,
      targetSemanticDuplicates: classifications.semanticDuplicates.length,
      sourceSemanticDuplicates: classifications.sourceDuplicates.length,
      quarantined: classifications.quarantined.length,
      strippedRuntimeFieldCount,
      alreadyPresentById: classifications.alreadyPresentById.length,
      pendingOperations: creates.length + lifecyclePatches.length,
    },
  }
}

async function liveState(token, snapshot) {
  await Promise.all([assertDatabase(token, SOURCE), assertDatabase(token, TARGET)])
  const [sourceSessions, targetSessions, targetContracts] = await Promise.all([
    readCollection(token, SOURCE, 'sessions', snapshot.sourceSnapshotTime),
    readCollection(token, TARGET, 'sessions'),
    readCollection(token, TARGET, 'contracts'),
  ])
  return {
    sourceSessions,
    targetSessions,
    targetContracts,
    plan: buildPlan(sourceSessions, targetSessions, targetContracts, snapshot),
  }
}

function publicReport(mode, snapshot, plan, extra = {}) {
  const strippedFields = {}
  for (const item of plan.creates) {
    for (const field of item.strippedFields) strippedFields[field] = Number(strippedFields[field] || 0) + 1
  }
  return {
    planVersion: PLAN_VERSION,
    mode,
    source: SOURCE,
    target: TARGET,
    sourceReadOnly: true,
    deletePropagation: false,
    targetOnlyDeletion: false,
    snapshot,
    planDigest: plan.planDigest,
    summary: plan.summary,
    classifications: plan.classifications,
    transforms: {
      contractLinkVersion: 3,
      contractLinkPolicy: 'exact date coverage; deterministic latest-start overlap; no gap guessing',
      strippedTargetOwnedFields: strippedFields,
    },
    writesPerformed: false,
    generatedAt: new Date().toISOString(),
    ...extra,
  }
}

function writeReport(mode, report) {
  fs.mkdirSync(PRIVATE_DIR, { recursive: true })
  fs.writeFileSync(REPORTS[mode], `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  return REPORTS[mode]
}

function readApprovedDryRun() {
  if (!fs.existsSync(REPORTS['dry-run'])) throw new Error('Dry-run report is missing.')
  const report = JSON.parse(fs.readFileSync(REPORTS['dry-run'], 'utf8'))
  if (report?.planVersion !== PLAN_VERSION || report?.mode !== 'dry-run') throw new Error('Dry-run report is incompatible.')
  if (canonicalJson(report.source) !== canonicalJson(SOURCE) || canonicalJson(report.target) !== canonicalJson(TARGET)) {
    throw new Error('Dry-run report project scope does not match the approved source and target.')
  }
  return report
}

function sessionCreateWrite(item) {
  return {
    update: {
      name: `${databaseResource(TARGET)}/documents/sessions/${item.sessionId}`,
      fields: item.fields,
    },
    currentDocument: { exists: false },
    updateTransforms: [{ fieldPath: 'contractLinkedAt', setToServerValue: 'REQUEST_TIME' }],
  }
}

function sessionLifecycleWrite(item) {
  return {
    update: {
      name: `${databaseResource(TARGET)}/documents/sessions/${item.sessionId}`,
      fields: item.fields,
    },
    updateMask: { fieldPaths: item.fieldPaths },
    currentDocument: { updateTime: item.targetUpdateTime },
  }
}

function auditWrite(plan) {
  const auditId = `source_session_delta_${plan.planDigest.slice(0, 40)}`
  return {
    update: {
      name: `${databaseResource(TARGET)}/documents/ptOperationsAuditLogs/${auditId}`,
      fields: encodeFields({
        schemaVersion: 1,
        action: 'source_session_delta.applied',
        actorUid: `system:${PLAN_VERSION}`,
        planDigest: plan.planDigest,
        createdSessions: plan.creates.length,
        lifecyclePatches: plan.lifecyclePatches.length,
        exactLinks: plan.summary.exactContractWindow,
        deterministicOverlapLinks: plan.summary.overlapLatestContractStart,
      }),
    },
    currentDocument: { exists: false },
    updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
  }
}

async function applyPlan(token, plan) {
  if (!plan.creates.length && !plan.lifecyclePatches.length) return { created: 0, patched: 0 }
  const writes = [
    ...plan.creates.map(sessionCreateWrite),
    ...plan.lifecyclePatches.map(sessionLifecycleWrite),
    auditWrite(plan),
  ]
  if (writes.length > MAX_ATOMIC_WRITES) throw new Error(`Apply blocked: ${writes.length} writes exceed the atomic safety limit.`)
  await requestJson(token, TARGET, '/documents:commit', {
    method: 'POST',
    body: JSON.stringify({ writes }),
  })
  return { created: plan.creates.length, patched: plan.lifecyclePatches.length }
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2))
  if (arguments_.help) { console.log(usage()); return }
  assertApplyGuards(arguments_)
  const snapshot = approvedSnapshotState()
  const token = await accessToken()
  const state = await liveState(token, snapshot)

  if (arguments_.mode === 'dry-run') {
    const report = publicReport('dry-run', snapshot, state.plan)
    const reportPath = writeReport('dry-run', report)
    console.log(JSON.stringify({ mode: 'dry-run', planDigest: state.plan.planDigest, ...state.plan.summary, reportPath, writesPerformed: false }, null, 2))
    return
  }

  if (arguments_.mode === 'apply') {
    const approved = readApprovedDryRun()
    if (arguments_.digest !== approved.planDigest || state.plan.planDigest !== approved.planDigest) {
      throw new Error('Live plan differs from the approved dry-run digest. Run a fresh dry-run.')
    }
    if (canonicalJson(snapshot) !== canonicalJson(approved.snapshot)) throw new Error('Approved source snapshot or target backup changed.')
    let outcome = { created: 0, patched: 0 }
    try {
      outcome = await applyPlan(token, state.plan)
    } catch (error) {
      writeReport('apply', publicReport('apply', snapshot, state.plan, {
        writesPerformed: false,
        committedCreates: 0,
        committedLifecyclePatches: 0,
        error: String(error?.message || error).slice(0, 1000),
      }))
      throw error
    }
    const after = await liveState(token, snapshot)
    const verified = after.plan.creates.length === 0 && after.plan.lifecyclePatches.length === 0
    const report = publicReport('apply', snapshot, after.plan, {
      approvedDryRunDigest: arguments_.digest,
      writesPerformed: outcome.created + outcome.patched > 0,
      committedCreates: outcome.created,
      committedLifecyclePatches: outcome.patched,
      verified,
    })
    const reportPath = writeReport('apply', report)
    console.log(JSON.stringify({ mode: 'apply', committedCreates: outcome.created, committedLifecyclePatches: outcome.patched, verified, remainingSafeCreates: after.plan.creates.length, remainingLifecyclePatches: after.plan.lifecyclePatches.length, ...after.plan.summary, reportPath }, null, 2))
    if (!verified) process.exitCode = 2
    return
  }

  const report = publicReport('verify', snapshot, state.plan, {
    verified: state.plan.creates.length === 0 && state.plan.lifecyclePatches.length === 0,
  })
  const reportPath = writeReport('verify', report)
  console.log(JSON.stringify({ mode: 'verify', verified: report.verified, ...state.plan.summary, reportPath, writesPerformed: false }, null, 2))
  if (!report.verified) process.exitCode = 2
}

main().catch((error) => {
  console.error(`Session delta migration failed: ${String(error?.message || error).slice(0, 1000)}`)
  process.exitCode = 1
})
