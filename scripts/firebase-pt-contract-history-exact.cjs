'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { sessionCountsTowardContract } = require('../functions/contract-usage')

const PLAN_VERSION = 'pt-contract-history-exact-v1'
const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
})
const CONFIRMATION = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}:apply-history-exact-usage`
const PRIVATE_DIR = path.resolve('.migration-private')
const REPORTS = Object.freeze({
  'dry-run': path.join(PRIVATE_DIR, 'firebase-pt-contract-history-exact-dry-run.json'),
  apply: path.join(PRIVATE_DIR, 'firebase-pt-contract-history-exact-apply.json'),
  verify: path.join(PRIVATE_DIR, 'firebase-pt-contract-history-exact-verify.json'),
})
const MAX_COMMIT_WRITES = 490

function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex') }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => { result[key] = canonical(value[key]); return result }, {})
  return value
}
function canonicalJson(value) { return JSON.stringify(canonical(value)) }
function safeCount(value) { const number = Number(value); return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0 }
function entityHash(collection, id) { return sha256(`${PLAN_VERSION}:${collection}/${id}`) }
function databaseResource() { return `projects/${TARGET.projectId}/databases/${TARGET.databaseId}` }
function databaseBase() { return `https://firestore.googleapis.com/v1/${databaseResource()}` }

function parseArguments(argv) {
  const result = { mode: 'dry-run' }
  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') result.help = true
    else if (argument.startsWith('--mode=')) result.mode = argument.slice(7)
    else if (argument.startsWith('--project=')) result.projectId = argument.slice(10)
    else if (argument.startsWith('--database=')) result.databaseId = argument.slice(11)
    else if (argument.startsWith('--digest=')) result.digest = argument.slice(9)
    else if (argument.startsWith('--confirm=')) result.confirmation = argument.slice(10)
    else throw new Error(`Unknown argument: ${argument.split('=')[0]}`)
  }
  if (!['dry-run', 'apply', 'verify'].includes(result.mode)) throw new Error('Mode must be dry-run, apply, or verify.')
  return result
}

function usage() {
  return `Dry run: node scripts/firebase-pt-contract-history-exact.cjs\nApply: node scripts/firebase-pt-contract-history-exact.cjs --mode=apply --project=${TARGET.projectId} --database=${TARGET.databaseId} --digest=<digest> --confirm=${CONFIRMATION}\nVerify: node scripts/firebase-pt-contract-history-exact.cjs --mode=verify`
}

function assertTarget(arguments_) {
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
async function requestJson(token, endpoint, options = {}) {
  const response = await fetch(`${databaseBase()}${endpoint}`, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) } })
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
function decodeFields(fields = {}) { return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)])) }
function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (typeof value === 'string') return { stringValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } }
  if (value && typeof value === 'object') return { mapValue: { fields: encodeFields(value) } }
  throw new Error('Unsupported Firestore value.')
}
function encodeFields(value) { return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item)])) }

async function readCollection(token, collectionId) {
  const rows = await requestJson(token, '/documents:runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId, allDescendants: false }], orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }] } }) })
  const prefix = `${databaseResource()}/documents/${collectionId}/`
  return (Array.isArray(rows) ? rows : [rows]).filter((row) => row?.document?.name?.startsWith(prefix)).map((row) => ({
    id: row.document.name.slice(prefix.length), fields: decodeFields(row.document.fields || {}), updateTime: row.document.updateTime,
    fingerprint: sha256(canonicalJson(row.document.fields || {})),
  }))
}

function buildPlan(contracts, sessions) {
  const contractsById = new Map(contracts.map((item) => [item.id, item]))
  const evidenceByContract = new Map()
  const invalidLinks = []
  const unlinkedChargeable = []
  for (const session of sessions) {
    if (!sessionCountsTowardContract(session.fields)) continue
    const contractId = String(session.fields.contractId || '').trim()
    if (!contractId) { unlinkedChargeable.push(entityHash('sessions', session.id)); continue }
    const contract = contractsById.get(contractId)
    if (!contract || String(contract.fields.studentId || '') !== String(session.fields.studentId || '')) { invalidLinks.push(entityHash('sessions', session.id)); continue }
    evidenceByContract.set(contractId, [...(evidenceByContract.get(contractId) || []), session.id])
  }
  const contractUsageUpdates = []
  const exactUsage = new Map()
  for (const contract of contracts) {
    const evidenceIds = [...new Set(evidenceByContract.get(contract.id) || [])].sort()
    const beforeUsed = safeCount(contract.fields.usedSessions)
    const afterUsed = evidenceIds.length
    exactUsage.set(contract.id, afterUsed)
    const status = afterUsed > safeCount(contract.fields.totalSessions) ? 'over_entitlement' : 'matched'
    const existingIds = [...new Set((Array.isArray(contract.fields.chargedSessionIds) ? contract.fields.chargedSessionIds : []).filter((value) => typeof value === 'string' && value))].sort()
    const metadataCurrent = Number(contract.fields.usageReconciliationVersion || 0) >= 4
      && contract.fields.usageReconciledFrom === PLAN_VERSION
      && contract.fields.usageReconciliationStatus === status
      && safeCount(contract.fields.historyEvidenceSessions) === evidenceIds.length
    if (beforeUsed !== afterUsed || canonicalJson(existingIds) !== canonicalJson(evidenceIds) || !metadataCurrent) {
      contractUsageUpdates.push({
        contractId: contract.id, updateTime: contract.updateTime, beforeUsed, afterUsed,
        totalSessions: safeCount(contract.fields.totalSessions), evidenceIds, status,
        usageChanged: beforeUsed !== afterUsed,
        chargedIdsChanged: canonicalJson(existingIds) !== canonicalJson(evidenceIds),
        metadataChanged: !metadataCurrent,
        metadataMismatch: {
          version: Number(contract.fields.usageReconciliationVersion || 0) < 4,
          source: contract.fields.usageReconciledFrom !== PLAN_VERSION,
          status: contract.fields.usageReconciliationStatus !== status,
          evidence: safeCount(contract.fields.historyEvidenceSessions) !== evidenceIds.length,
        },
        historyEvidenceBefore: safeCount(contract.fields.historyEvidenceSessions),
        publicDigest: sha256(canonicalJson({ contractHash: entityHash('contracts', contract.id), fingerprint: contract.fingerprint, beforeUsed, afterUsed, status, evidenceCount: evidenceIds.length })),
      })
    }
  }

  const renewalUpdates = []
  const renewalBlockers = []
  for (const renewal of contracts.filter((item) => String(item.fields.sourceContractId || ''))) {
    const source = contractsById.get(String(renewal.fields.sourceContractId || ''))
    if (!source) { renewalBlockers.push({ renewalHash: entityHash('contracts', renewal.id), reason: 'SOURCE_MISSING' }); continue }
    const carryRequested = renewal.fields.carryOverRequested === true || renewal.fields.carryOverPending === true || safeCount(renewal.fields.carriedOverSessions) > 0
    if (!carryRequested) continue
    const correctedCarry = Math.max(0, safeCount(source.fields.totalSessions) - (exactUsage.get(source.id) ?? safeCount(source.fields.usedSessions)))
    const packageSessions = safeCount(renewal.fields.packageSessions)
    if (!packageSessions) { renewalBlockers.push({ renewalHash: entityHash('contracts', renewal.id), reason: 'PACKAGE_SESSIONS_MISSING' }); continue }
    const pending = renewal.fields.carryOverPending === true && renewal.fields.status === 'future'
    const correctedTotal = packageSessions + correctedCarry
    const renewalUsed = exactUsage.get(renewal.id) ?? safeCount(renewal.fields.usedSessions)
    if (!pending && correctedTotal < renewalUsed) { renewalBlockers.push({ renewalHash: entityHash('contracts', renewal.id), reason: 'CORRECTED_TOTAL_BELOW_USED' }); continue }
    const sourceFields = pending ? {} : { carryOverTransferredSessions: correctedCarry }
    const renewalFields = pending
      ? { plannedCarryOverSessions: correctedCarry, totalSessions: correctedTotal }
      : { carriedOverSessions: correctedCarry, plannedCarryOverSessions: correctedCarry, totalSessions: correctedTotal }
    const sourceNeedsUpdate = Object.entries(sourceFields).some(([key, value]) => safeCount(source.fields[key]) !== value)
    const renewalNeedsUpdate = Object.entries(renewalFields).some(([key, value]) => safeCount(renewal.fields[key]) !== value)
    if (sourceNeedsUpdate || renewalNeedsUpdate) renewalUpdates.push({
      sourceId: source.id, sourceUpdateTime: source.updateTime, renewalId: renewal.id, renewalUpdateTime: renewal.updateTime,
      sourceFields, renewalFields, pending, correctedCarry, correctedTotal,
      publicDigest: sha256(canonicalJson({ sourceHash: entityHash('contracts', source.id), renewalHash: entityHash('contracts', renewal.id), sourceFingerprint: source.fingerprint, renewalFingerprint: renewal.fingerprint, pending, correctedCarry, correctedTotal })),
    })
  }
  contractUsageUpdates.sort((left, right) => left.contractId.localeCompare(right.contractId))
  renewalUpdates.sort((left, right) => left.renewalId.localeCompare(right.renewalId))
  const planDigest = sha256(canonicalJson({ planVersion: PLAN_VERSION, target: TARGET, contractUpdates: contractUsageUpdates.map((item) => item.publicDigest), renewalUpdates: renewalUpdates.map((item) => item.publicDigest), invalidLinks, unlinkedChargeable, renewalBlockers }))
  return { planDigest, contractUsageUpdates, renewalUpdates, invalidLinks, unlinkedChargeable, renewalBlockers }
}

function mergeContractPatches(plan) {
  const patches = new Map()
  const merge = (id, updateTime, fields, timestampFields = []) => {
    const current = patches.get(id) || { id, updateTime, fields: {}, timestamps: new Set() }
    if (current.updateTime !== updateTime) throw new Error(`Conflicting preconditions for ${id}.`)
    Object.assign(current.fields, fields)
    timestampFields.forEach((field) => current.timestamps.add(field))
    patches.set(id, current)
  }
  plan.contractUsageUpdates.forEach((item) => merge(item.contractId, item.updateTime, {
    usedSessions: item.afterUsed, chargedSessionIds: item.evidenceIds,
    usageReconciliationVersion: 4, usageReconciledFrom: PLAN_VERSION,
    usageReconciliationStatus: item.status, historyEvidenceSessions: item.evidenceIds.length,
  }, ['usageReconciledAt']))
  plan.renewalUpdates.forEach((item) => {
    if (Object.keys(item.sourceFields).length) merge(item.sourceId, item.sourceUpdateTime, { ...item.sourceFields, carryOverReconciliationVersion: 3, carryOverReconciledFrom: PLAN_VERSION }, ['carryOverReconciledAt'])
    merge(item.renewalId, item.renewalUpdateTime, { ...item.renewalFields, carryOverReconciliationVersion: 3, carryOverReconciledFrom: PLAN_VERSION }, ['carryOverReconciledAt'])
  })
  return [...patches.values()].sort((left, right) => left.id.localeCompare(right.id))
}

function publicReport(mode, contracts, sessions, plan, extra = {}) {
  return {
    generatedAt: new Date().toISOString(), mode, target: TARGET, planVersion: PLAN_VERSION, planDigest: plan.planDigest,
    writeScope: mode === 'apply' ? 'exact contract usage projection + renewal carry-over correction + audit' : 'none',
    inventory: { contracts: contracts.length, sessions: sessions.length },
    contractUsage: {
      updates: plan.contractUsageUpdates.length,
      decreases: plan.contractUsageUpdates.filter((item) => item.afterUsed < item.beforeUsed).length,
      increases: plan.contractUsageUpdates.filter((item) => item.afterUsed > item.beforeUsed).length,
      totalDecrease: plan.contractUsageUpdates.reduce((sum, item) => sum + Math.max(0, item.beforeUsed - item.afterUsed), 0),
      totalIncrease: plan.contractUsageUpdates.reduce((sum, item) => sum + Math.max(0, item.afterUsed - item.beforeUsed), 0),
      overEntitlement: plan.contractUsageUpdates.filter((item) => item.status === 'over_entitlement').length,
      updateReasons: {
        usage: plan.contractUsageUpdates.filter((item) => item.usageChanged).length,
        chargedSessionIds: plan.contractUsageUpdates.filter((item) => item.chargedIdsChanged).length,
        metadata: plan.contractUsageUpdates.filter((item) => item.metadataChanged).length,
        metadataVersion: plan.contractUsageUpdates.filter((item) => item.metadataMismatch.version).length,
        metadataSource: plan.contractUsageUpdates.filter((item) => item.metadataMismatch.source).length,
        metadataStatus: plan.contractUsageUpdates.filter((item) => item.metadataMismatch.status).length,
        metadataEvidence: plan.contractUsageUpdates.filter((item) => item.metadataMismatch.evidence).length,
      },
      evidenceMismatchCases: plan.contractUsageUpdates.filter((item) => item.metadataMismatch.evidence).map((item) => ({
        contractHash: entityHash('contracts', item.contractId),
        before: item.historyEvidenceBefore,
        after: item.evidenceIds.length,
      })),
    },
    renewalUpdates: plan.renewalUpdates.map((item) => ({ pending: item.pending, correctedCarry: item.correctedCarry, correctedTotal: item.correctedTotal, sourceHash: entityHash('contracts', item.sourceId), renewalHash: entityHash('contracts', item.renewalId) })),
    blockers: { unlinkedChargeable: plan.unlinkedChargeable, invalidLinks: plan.invalidLinks, renewal: plan.renewalBlockers },
    piiPolicy: 'Reports contain only counts and SHA-256 hashes.',
    ...extra,
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(PRIVATE_DIR, { recursive: true })
  const temporary = `${filePath}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, filePath)
}

function updateWrite(item) {
  return {
    update: { name: `${databaseResource()}/documents/contracts/${item.id}`, fields: encodeFields(item.fields) },
    updateMask: { fieldPaths: Object.keys(item.fields) }, currentDocument: { updateTime: item.updateTime },
    updateTransforms: [...item.timestamps].map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })),
  }
}
function auditWrite(plan) {
  const id = `pt_usage_exact_${plan.planDigest.slice(0, 36)}`
  return { update: { name: `${databaseResource()}/documents/ptOperationsAuditLogs/${id}`, fields: encodeFields({ schemaVersion: 4, action: 'pt_contract.usage_history_exact', actorUid: `system:${PLAN_VERSION}`, planDigest: plan.planDigest, updatedContracts: plan.contractUsageUpdates.length, renewalUpdates: plan.renewalUpdates.length }) }, currentDocument: { exists: false }, updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }] }
}

function assertSafe(plan) {
  if (plan.unlinkedChargeable.length || plan.invalidLinks.length || plan.renewalBlockers.length) throw new Error('Apply blocked by incomplete or invalid history evidence.')
  const writes = mergeContractPatches(plan).length + 1
  if (writes > MAX_COMMIT_WRITES) throw new Error(`Apply blocked: ${writes} writes exceed the atomic safety limit.`)
}

async function state(token) {
  const [contracts, sessions] = await Promise.all([readCollection(token, 'contracts'), readCollection(token, 'sessions')])
  return { contracts, sessions, plan: buildPlan(contracts, sessions) }
}

function loadDryRun(digest) {
  if (!fs.existsSync(REPORTS['dry-run'])) throw new Error('Dry-run report is missing.')
  const report = JSON.parse(fs.readFileSync(REPORTS['dry-run'], 'utf8'))
  if (report.mode !== 'dry-run' || report.planVersion !== PLAN_VERSION || report.planDigest !== digest || canonicalJson(report.target) !== canonicalJson(TARGET)) throw new Error('Dry-run report or digest is invalid.')
}

async function dryRun(token) {
  const current = await state(token)
  const report = publicReport('dry-run', current.contracts, current.sessions, current.plan, { writesPerformed: false, applyConfirmation: CONFIRMATION })
  writeJson(REPORTS['dry-run'], report)
  console.log(JSON.stringify({ mode: 'dry-run', planDigest: current.plan.planDigest, contractUpdates: report.contractUsage.updates, decreases: report.contractUsage.decreases, totalDecrease: report.contractUsage.totalDecrease, increases: report.contractUsage.increases, renewalUpdates: current.plan.renewalUpdates.length, unlinkedChargeable: current.plan.unlinkedChargeable.length, invalidLinks: current.plan.invalidLinks.length, renewalBlockers: current.plan.renewalBlockers.length, reportPath: REPORTS['dry-run'], writesPerformed: false }, null, 2))
}

async function apply(token, arguments_) {
  loadDryRun(arguments_.digest)
  const before = await state(token)
  if (before.plan.planDigest !== arguments_.digest) throw new Error('Live plan changed after dry-run; apply aborted.')
  assertSafe(before.plan)
  const backupPath = path.join(PRIVATE_DIR, `firebase-pt-contract-history-exact-backup-${before.plan.planDigest}.json`)
  const contractMap = new Map(before.contracts.map((item) => [item.id, item]))
  writeJson(backupPath, { generatedAt: new Date().toISOString(), target: TARGET, planVersion: PLAN_VERSION, planDigest: before.plan.planDigest, contracts: mergeContractPatches(before.plan).map((item) => ({ id: item.id, updateTime: item.updateTime, before: contractMap.get(item.id)?.fields || null })) })
  const writes = [...mergeContractPatches(before.plan).map(updateWrite), auditWrite(before.plan)]
  await requestJson(token, '/documents:commit', { method: 'POST', body: JSON.stringify({ writes }) })
  const after = await state(token)
  const verified = after.plan.contractUsageUpdates.length === 0 && after.plan.renewalUpdates.length === 0 && !after.plan.unlinkedChargeable.length && !after.plan.invalidLinks.length && !after.plan.renewalBlockers.length
  writeJson(REPORTS.apply, publicReport('apply', after.contracts, after.sessions, after.plan, { writesPerformed: true, committedWrites: writes.length, approvedDryRunDigest: arguments_.digest, backupPath, verified }))
  console.log(JSON.stringify({ mode: 'apply', committedWrites: writes.length, verified, remainingContractUpdates: after.plan.contractUsageUpdates.length, remainingRenewalUpdates: after.plan.renewalUpdates.length, reportPath: REPORTS.apply, backupPath }, null, 2))
  if (!verified) process.exitCode = 2
}

async function verify(token) {
  const current = await state(token)
  const verified = current.plan.contractUsageUpdates.length === 0 && current.plan.renewalUpdates.length === 0 && !current.plan.unlinkedChargeable.length && !current.plan.invalidLinks.length && !current.plan.renewalBlockers.length
  writeJson(REPORTS.verify, publicReport('verify', current.contracts, current.sessions, current.plan, { writesPerformed: false, verified }))
  console.log(JSON.stringify({ mode: 'verify', verified, contractUpdates: current.plan.contractUsageUpdates.length, renewalUpdates: current.plan.renewalUpdates.length, unlinkedChargeable: current.plan.unlinkedChargeable.length, invalidLinks: current.plan.invalidLinks.length, renewalBlockers: current.plan.renewalBlockers.length, reportPath: REPORTS.verify }, null, 2))
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

if (require.main === module) main().catch((error) => { console.error(error instanceof Error ? error.message : 'Exact PT history projection failed.'); process.exitCode = 1 })

module.exports = { PLAN_VERSION, TARGET, buildPlan, mergeContractPatches, assertSafe }
