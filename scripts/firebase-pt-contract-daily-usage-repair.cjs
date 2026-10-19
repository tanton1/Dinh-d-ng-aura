'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const {
  canonicalUsageSessions,
  sessionCountsTowardContract,
  sessionDateKey,
  safeCount,
  DAILY_USAGE_RECONCILIATION_SOURCE,
  DAILY_USAGE_RECONCILIATION_VERSION,
} = require('../functions/contract-usage')
const { effectiveContractStatus } = require('../functions/contract-status')

const PLAN_VERSION = DAILY_USAGE_RECONCILIATION_SOURCE
const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
})
const CONFIRMATION = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}:apply-daily-unique-usage`
const PRIVATE_DIR = path.resolve('.migration-private')
const REPORTS = Object.freeze({
  'dry-run': path.join(PRIVATE_DIR, 'firebase-pt-contract-daily-usage-repair-dry-run.json'),
  apply: path.join(PRIVATE_DIR, 'firebase-pt-contract-daily-usage-repair-apply.json'),
  verify: path.join(PRIVATE_DIR, 'firebase-pt-contract-daily-usage-repair-verify.json'),
})
const MAX_COMMIT_WRITES = 490

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonical(value[key])
    return result
  }, {})
  return value
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value))
}

function entityHash(collection, id) {
  return sha256(`${PLAN_VERSION}:${collection}/${id}`)
}

function databaseResource() {
  return `projects/${TARGET.projectId}/databases/${TARGET.databaseId}`
}

function databaseBase() {
  return `https://firestore.googleapis.com/v1/${databaseResource()}`
}

function saigonToday() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function parseArguments(argv) {
  const result = { mode: 'dry-run', asOf: saigonToday() }
  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') result.help = true
    else if (argument.startsWith('--mode=')) result.mode = argument.slice(7)
    else if (argument.startsWith('--project=')) result.projectId = argument.slice(10)
    else if (argument.startsWith('--database=')) result.databaseId = argument.slice(11)
    else if (argument.startsWith('--as-of=')) result.asOf = argument.slice(8)
    else if (argument.startsWith('--digest=')) result.digest = argument.slice(9)
    else if (argument.startsWith('--confirm=')) result.confirmation = argument.slice(10)
    else throw new Error(`Unknown argument: ${argument.split('=')[0]}`)
  }
  if (!['dry-run', 'apply', 'verify'].includes(result.mode)) throw new Error('Mode must be dry-run, apply, or verify.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result.asOf)) throw new Error('as-of must be YYYY-MM-DD.')
  return result
}

function usage() {
  return `Dry run: node scripts/firebase-pt-contract-daily-usage-repair.cjs --as-of=YYYY-MM-DD\nApply: node scripts/firebase-pt-contract-daily-usage-repair.cjs --mode=apply --project=${TARGET.projectId} --database=${TARGET.databaseId} --as-of=YYYY-MM-DD --digest=<digest> --confirm=${CONFIRMATION}\nVerify: node scripts/firebase-pt-contract-daily-usage-repair.cjs --mode=verify --as-of=YYYY-MM-DD`
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
  const response = await fetch(`${databaseBase()}${endpoint}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const raw = await response.text()
  if (!response.ok) throw new Error(`Firestore request failed (${response.status}) at ${endpoint.split('?')[0]}.`)
  return raw ? JSON.parse(raw) : null
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
  throw new Error('Unsupported Firestore value.')
}

function encodeFields(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item)]))
}

async function assertLiveTarget(token) {
  const metadata = await requestJson(token, '')
  if (metadata?.name !== databaseResource()) throw new Error('Live database does not match the approved target.')
}

async function readCollection(token, collectionId) {
  const rows = await requestJson(token, '/documents:runQuery', {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId, allDescendants: false }],
        orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      },
    }),
  })
  const prefix = `${databaseResource()}/documents/${collectionId}/`
  return (Array.isArray(rows) ? rows : [rows])
    .filter((row) => row?.document?.name?.startsWith(prefix))
    .map((row) => ({
      id: row.document.name.slice(prefix.length),
      fields: decodeFields(row.document.fields || {}),
      updateTime: row.document.updateTime,
      fingerprint: sha256(canonicalJson(row.document.fields || {})),
    }))
}

function contractStudentId(contract = {}) {
  return String(contract.studentId || contract.crmProfileId || '').trim()
}

function chargeableRows(rows) {
  return rows.filter((row) => sessionCountsTowardContract(row.fields))
}

function duplicateDayStats(rows) {
  const groups = new Map()
  for (const row of chargeableRows(rows)) {
    const studentId = String(row.fields.studentId || '').trim()
    const date = sessionDateKey(row.fields)
    if (!studentId || !date) continue
    const key = `${studentId}|${date}`
    groups.set(key, [...(groups.get(key) || []), row.id])
  }
  const duplicateGroups = [...groups.values()].filter((ids) => ids.length > 1)
  return {
    duplicateGroups: duplicateGroups.length,
    duplicateRows: duplicateGroups.reduce((sum, ids) => sum + ids.length - 1, 0),
    duplicateStudentHashes: new Set(duplicateGroups.map((ids) => {
      const first = rows.find((row) => row.id === ids[0])
      return entityHash('students', first?.fields.studentId || '')
    })).size,
  }
}

function buildPlan(contracts, sessions, asOf = saigonToday()) {
  const contractsById = new Map(contracts.map((item) => [item.id, item]))
  const rowsByContract = new Map()
  const invalidLinks = []
  for (const session of sessions) {
    const contractId = String(session.fields.contractId || '').trim()
    if (!contractId) continue
    const contract = contractsById.get(contractId)
    if (!contract) continue
    const expectedStudentId = contractStudentId(contract.fields)
    const sessionStudentId = String(session.fields.studentId || '').trim()
    if (sessionCountsTowardContract(session.fields) && (!sessionStudentId || sessionStudentId !== expectedStudentId)) {
      invalidLinks.push({ sessionHash: entityHash('sessions', session.id), reason: sessionStudentId ? 'STUDENT_MISMATCH' : 'STUDENT_MISSING' })
      continue
    }
    rowsByContract.set(contractId, [...(rowsByContract.get(contractId) || []), session])
  }

  const contractUsageUpdates = []
  const activeContractIds = []
  const activeStudentHashes = new Set()
  for (const contract of contracts) {
    if (effectiveContractStatus(contract.fields, asOf) !== 'active') continue
    activeContractIds.push(contract.id)
    activeStudentHashes.add(entityHash('students', contractStudentId(contract.fields)))
    const rows = rowsByContract.get(contract.id) || []
    const canonicalRows = canonicalUsageSessions(rows.map((row) => ({ id: row.id, ...row.fields })))
    const canonicalChargedIds = canonicalRows
      .filter((row) => sessionCountsTowardContract(row))
      .map((row) => row.id)
      .filter(Boolean)
      .sort()
    const rawChargedIds = rows
      .filter((row) => sessionCountsTowardContract(row.fields))
      .map((row) => row.id)
      .sort()
    const beforeUsed = safeCount(contract.fields.usedSessions)
    const afterUsed = canonicalChargedIds.length
    const status = afterUsed > safeCount(contract.fields.totalSessions) ? 'over_entitlement' : 'matched'
    const existingIds = [...new Set((Array.isArray(contract.fields.chargedSessionIds) ? contract.fields.chargedSessionIds : [])
      .filter((value) => typeof value === 'string' && value))].sort()
    const duplicateHistorySessions = Math.max(0, rows.length - canonicalRows.length)
    const metadataCurrent = Number(contract.fields.usageReconciliationVersion || 0) >= DAILY_USAGE_RECONCILIATION_VERSION
      && contract.fields.usageReconciledFrom === PLAN_VERSION
      && contract.fields.usageReconciliationStatus === status
      && safeCount(contract.fields.historyEvidenceSessions) === afterUsed
      && Number(contract.fields.usageProjectionVersion || 0) >= DAILY_USAGE_RECONCILIATION_VERSION
      && Number(contract.fields.usageDeduplicationVersion || 0) === 1
      && safeCount(contract.fields.usageDedupedSessions) === duplicateHistorySessions
    const chargedIdsChanged = canonicalJson(existingIds) !== canonicalJson(canonicalChargedIds)
    const usageChanged = beforeUsed !== afterUsed
    const publicDigest = sha256(canonicalJson({
      contractHash: entityHash('contracts', contract.id),
      fingerprint: contract.fingerprint,
      beforeUsed,
      afterUsed,
      status,
      rawCharged: rawChargedIds.length,
      canonicalCharged: canonicalChargedIds.length,
      duplicateHistorySessions,
      canonicalIdsHash: sha256(canonicalJson(canonicalChargedIds)),
    }))
    if (usageChanged || chargedIdsChanged || !metadataCurrent) {
      contractUsageUpdates.push({
        contractId: contract.id,
        updateTime: contract.updateTime,
        beforeUsed,
        afterUsed,
        totalSessions: safeCount(contract.fields.totalSessions),
        rawHistorySessions: rows.length,
        rawChargedSessions: rawChargedIds.length,
        canonicalHistorySessions: canonicalRows.length,
        canonicalChargedSessionIds: canonicalChargedIds,
        duplicateHistorySessions,
        status,
        usageChanged,
        chargedIdsChanged,
        metadataChanged: !metadataCurrent,
        publicDigest,
      })
    }
  }
  activeContractIds.sort()
  contractUsageUpdates.sort((left, right) => left.contractId.localeCompare(right.contractId))
  const stats = duplicateDayStats(sessions.filter((row) => {
    const contractId = String(row.fields.contractId || '').trim()
    return activeContractIds.includes(contractId)
  }))
  const planDigest = sha256(canonicalJson({
    planVersion: PLAN_VERSION,
    target: TARGET,
    asOf,
    activeContractIds: activeContractIds.map((id) => entityHash('contracts', id)),
    contractUpdates: contractUsageUpdates.map((item) => item.publicDigest),
    invalidLinks,
  }))
  return {
    planDigest,
    asOf,
    activeContractIds,
    activeStudentHashes: [...activeStudentHashes].sort(),
    contractUsageUpdates,
    invalidLinks,
    stats,
  }
}

function mergeContractPatches(plan) {
  return plan.contractUsageUpdates.map((item) => ({
    id: item.contractId,
    updateTime: item.updateTime,
    fields: {
      usedSessions: item.afterUsed,
      chargedSessionIds: item.canonicalChargedSessionIds,
      usageProjectionVersion: DAILY_USAGE_RECONCILIATION_VERSION,
      usageReconciliationVersion: DAILY_USAGE_RECONCILIATION_VERSION,
      usageReconciledFrom: PLAN_VERSION,
      usageReconciliationStatus: item.status,
      historyEvidenceSessions: item.afterUsed,
      usageDeduplicationVersion: 1,
      usageDedupedSessions: item.duplicateHistorySessions,
    },
    timestamps: new Set(['usageReconciledAt', 'usageProjectionUpdatedAt', 'usageDedupedAt']),
  }))
}

function publicReport(mode, contracts, sessions, plan, extra = {}) {
  return {
    generatedAt: new Date().toISOString(),
    mode,
    target: TARGET,
    asOf: plan.asOf,
    planVersion: PLAN_VERSION,
    planDigest: plan.planDigest,
    writeScope: mode === 'apply' ? 'active contract daily unique usage projection + audit; sessions and attendance unchanged' : 'none',
    inventory: { contracts: contracts.length, sessions: sessions.length, activeContracts: plan.activeContractIds.length },
    activeStudents: plan.activeStudentHashes.length,
    contractUsage: {
      updates: plan.contractUsageUpdates.length,
      decreases: plan.contractUsageUpdates.filter((item) => item.afterUsed < item.beforeUsed).length,
      increases: plan.contractUsageUpdates.filter((item) => item.afterUsed > item.beforeUsed).length,
      totalDecrease: plan.contractUsageUpdates.reduce((sum, item) => sum + Math.max(0, item.beforeUsed - item.afterUsed), 0),
      totalIncrease: plan.contractUsageUpdates.reduce((sum, item) => sum + Math.max(0, item.afterUsed - item.beforeUsed), 0),
      duplicateHistoryRows: plan.contractUsageUpdates.reduce((sum, item) => sum + item.duplicateHistorySessions, 0),
      duplicateDayGroups: plan.stats.duplicateGroups,
      duplicateDayExcessRows: plan.stats.duplicateRows,
      duplicateDayStudents: plan.stats.duplicateStudentHashes,
      overEntitlement: plan.contractUsageUpdates.filter((item) => item.status === 'over_entitlement').length,
      updateReasons: {
        usage: plan.contractUsageUpdates.filter((item) => item.usageChanged).length,
        chargedSessionIds: plan.contractUsageUpdates.filter((item) => item.chargedIdsChanged).length,
        metadata: plan.contractUsageUpdates.filter((item) => item.metadataChanged).length,
      },
    },
    blockers: { invalidLinks: plan.invalidLinks },
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
    updateMask: { fieldPaths: Object.keys(item.fields) },
    currentDocument: { updateTime: item.updateTime },
    updateTransforms: [...item.timestamps].map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })),
  }
}

function auditWrite(plan) {
  const id = `pt_usage_daily_${plan.planDigest.slice(0, 36)}`
  return {
    update: {
      name: `${databaseResource()}/documents/contractUsageAuditLogs/${id}`,
      fields: encodeFields({
        schemaVersion: 3,
        action: 'contract_usage.daily_unique_reconciled',
        actorUid: `system:${PLAN_VERSION}`,
        planDigest: plan.planDigest,
        asOf: plan.asOf,
        updatedContracts: plan.contractUsageUpdates.length,
        duplicateDayGroups: plan.stats.duplicateGroups,
        duplicateDayExcessRows: plan.stats.duplicateRows,
      }),
    },
    currentDocument: { exists: false },
    updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
  }
}

function assertSafe(plan) {
  if (plan.invalidLinks.length) throw new Error('Apply blocked by invalid active-contract session links.')
  const writes = mergeContractPatches(plan).length + 1
  if (writes > MAX_COMMIT_WRITES) throw new Error(`Apply blocked: ${writes} writes exceed the atomic safety limit.`)
}

async function state(token, asOf) {
  const [contracts, sessions] = await Promise.all([
    readCollection(token, 'contracts'),
    readCollection(token, 'sessions'),
  ])
  return { contracts, sessions, plan: buildPlan(contracts, sessions, asOf) }
}

function loadDryRun(digest, asOf) {
  if (!fs.existsSync(REPORTS['dry-run'])) throw new Error('Dry-run report is missing.')
  const report = JSON.parse(fs.readFileSync(REPORTS['dry-run'], 'utf8'))
  if (report.mode !== 'dry-run' || report.planVersion !== PLAN_VERSION || report.planDigest !== digest || report.asOf !== asOf || canonicalJson(report.target) !== canonicalJson(TARGET)) {
    throw new Error('Dry-run report, digest or as-of is invalid.')
  }
  return report
}

async function dryRun(token, arguments_) {
  const current = await state(token, arguments_.asOf)
  const report = publicReport('dry-run', current.contracts, current.sessions, current.plan, { writesPerformed: false, applyConfirmation: CONFIRMATION })
  writeJson(REPORTS['dry-run'], report)
  console.log(JSON.stringify({
    mode: 'dry-run',
    asOf: arguments_.asOf,
    planDigest: current.plan.planDigest,
    activeContracts: current.plan.activeContractIds.length,
    contractUpdates: report.contractUsage.updates,
    decreases: report.contractUsage.decreases,
    totalDecrease: report.contractUsage.totalDecrease,
    duplicateDayGroups: report.contractUsage.duplicateDayGroups,
    duplicateDayExcessRows: report.contractUsage.duplicateDayExcessRows,
    invalidLinks: current.plan.invalidLinks.length,
    reportPath: REPORTS['dry-run'],
    writesPerformed: false,
  }, null, 2))
}

async function apply(token, arguments_) {
  loadDryRun(arguments_.digest, arguments_.asOf)
  const before = await state(token, arguments_.asOf)
  if (before.plan.planDigest !== arguments_.digest) throw new Error('Live plan changed after dry-run; apply aborted.')
  assertSafe(before.plan)
  const backupPath = path.join(PRIVATE_DIR, `firebase-pt-contract-daily-usage-repair-backup-${before.plan.planDigest}.json`)
  const contractMap = new Map(before.contracts.map((item) => [item.id, item]))
  writeJson(backupPath, {
    generatedAt: new Date().toISOString(),
    target: TARGET,
    asOf: arguments_.asOf,
    planVersion: PLAN_VERSION,
    planDigest: before.plan.planDigest,
    contracts: mergeContractPatches(before.plan).map((item) => ({ id: item.id, updateTime: item.updateTime, before: contractMap.get(item.id)?.fields || null })),
  })
  const writes = [...mergeContractPatches(before.plan).map(updateWrite), auditWrite(before.plan)]
  await requestJson(token, '/documents:commit', { method: 'POST', body: JSON.stringify({ writes }) })
  const after = await state(token, arguments_.asOf)
  const verified = after.plan.contractUsageUpdates.length === 0 && after.plan.invalidLinks.length === 0
  writeJson(REPORTS.apply, publicReport('apply', after.contracts, after.sessions, after.plan, {
    writesPerformed: true,
    committedWrites: writes.length,
    approvedDryRunDigest: arguments_.digest,
    backupPath,
    verified,
  }))
  console.log(JSON.stringify({ mode: 'apply', committedWrites: writes.length, verified, remainingContractUpdates: after.plan.contractUsageUpdates.length, invalidLinks: after.plan.invalidLinks.length, reportPath: REPORTS.apply, backupPath }, null, 2))
  if (!verified) process.exitCode = 2
}

async function verify(token, arguments_) {
  const current = await state(token, arguments_.asOf)
  const verified = current.plan.contractUsageUpdates.length === 0 && current.plan.invalidLinks.length === 0
  writeJson(REPORTS.verify, publicReport('verify', current.contracts, current.sessions, current.plan, { writesPerformed: false, verified }))
  console.log(JSON.stringify({ mode: 'verify', asOf: arguments_.asOf, verified, contractUpdates: current.plan.contractUsageUpdates.length, duplicateDayGroups: current.plan.stats.duplicateGroups, duplicateDayExcessRows: current.plan.stats.duplicateRows, invalidLinks: current.plan.invalidLinks.length, reportPath: REPORTS.verify }, null, 2))
  if (!verified) process.exitCode = 2
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2))
  if (arguments_.help) return console.log(usage())
  assertTarget(arguments_)
  const token = await accessToken()
  await assertLiveTarget(token)
  if (arguments_.mode === 'dry-run') await dryRun(token, arguments_)
  else if (arguments_.mode === 'apply') await apply(token, arguments_)
  else await verify(token, arguments_)
}

if (require.main === module) main().catch((error) => { console.error(error instanceof Error ? error.message : 'Daily unique PT usage repair failed.'); process.exitCode = 1 })

module.exports = { PLAN_VERSION, TARGET, buildPlan, mergeContractPatches, assertSafe, accessToken, readCollection, assertLiveTarget, requestJson, databaseResource, encodeFields, canonicalJson, entityHash }
