'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

/**
 * Target-only, monotonic reconciliation for legacy contract usage.
 * It only raises `contracts.usedSessions` when distinct sessions explicitly
 * linked to that contract prove a larger charged/completed count. It never
 * lowers usage, guesses a contract, edits sessions, or touches the retired
 * source project.
 */

const PLAN_VERSION = 'pt-contract-usage-linked-session-v1'
const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
})
const RETIRED_SOURCE_PROJECT_ID = 'gen-lang-client-0246058381'
const APPLY_CONFIRMATION = 'APPLY_PT_CONTRACT_USAGE_RECONCILIATION_V1'
const PRIVATE_DIR = path.resolve('.migration-private')
const REPORTS = Object.freeze({
  'dry-run': path.join(PRIVATE_DIR, 'firebase-pt-contract-usage-dry-run.json'),
  apply: path.join(PRIVATE_DIR, 'firebase-pt-contract-usage-apply.json'),
  verify: path.join(PRIVATE_DIR, 'firebase-pt-contract-usage-verify.json'),
})
const MAX_ITEMS_PER_COMMIT = 150
const HASH_SAMPLE_LIMIT = 100
const EVIDENCE_STATUSES = new Set(['completed', 'attended', 'no_show'])

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
    'PT contract usage reconciliation (defaults to read-only dry run)',
    '',
    'Dry run:',
    '  node scripts/firebase-pt-contract-usage-reconcile.cjs',
    '',
    'Apply:',
    `  node scripts/firebase-pt-contract-usage-reconcile.cjs --mode=apply --project=${TARGET.projectId} --database=${TARGET.databaseId} --digest=<DRY_RUN_DIGEST> --confirm=${APPLY_CONFIRMATION}`,
    '',
    'Verify:',
    '  node scripts/firebase-pt-contract-usage-reconcile.cjs --mode=verify',
  ].join('\n')
}

function assertTarget(arguments_) {
  if (TARGET.projectId === RETIRED_SOURCE_PROJECT_ID) throw new Error('Target points to the retired source project.')
  if (arguments_.projectId && arguments_.projectId !== TARGET.projectId) throw new Error('Project override is not the approved target.')
  if (arguments_.databaseId && arguments_.databaseId !== TARGET.databaseId) throw new Error('Database override is not the approved named database.')
  if (arguments_.mode === 'apply') {
    if (arguments_.projectId !== TARGET.projectId || arguments_.databaseId !== TARGET.databaseId) throw new Error('Apply requires the exact target project and database guards.')
    if (!/^[a-f0-9]{64}$/.test(arguments_.digest || '')) throw new Error('Apply requires the latest dry-run digest.')
    if (arguments_.confirmation !== APPLY_CONFIRMATION) throw new Error('Apply confirmation is missing or incorrect.')
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

function databaseBase() {
  return `https://firestore.googleapis.com/v1/projects/${TARGET.projectId}/databases/${encodeURIComponent(TARGET.databaseId)}`
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
  const expected = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}`
  if (metadata?.name !== expected) throw new Error('Firestore metadata does not match the approved target.')
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

async function readCollection(token, collectionId) {
  const rows = await requestJson(token, '/documents:runQuery', {
    method: 'POST',
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId, allDescendants: false }], orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }] } }),
  })
  const prefix = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}/documents/${collectionId}/`
  return (Array.isArray(rows) ? rows : [rows]).filter((row) => row?.document?.name?.startsWith(prefix)).map((row) => ({
    id: row.document.name.slice(prefix.length),
    fields: decodeFields(row.document.fields || {}),
    updateTime: row.document.updateTime,
  }))
}

function safeId(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  return /^[A-Za-z0-9_-]+$/.test(result) ? result : ''
}

function safeCount(value) {
  const number = Number(value || 0)
  return Number.isSafeInteger(number) && number >= 0 ? number : null
}

function entityHash(collection, id) {
  return sha256(`${PLAN_VERSION}:${collection}/${id}`)
}

function category(ids) {
  const values = [...new Set(ids)].sort()
  return { count: values.length, hashedIdSamples: values.slice(0, HASH_SAMPLE_LIMIT), sampleLimit: HASH_SAMPLE_LIMIT }
}

function buildPlan(contracts, sessions) {
  const sessionsByContract = new Map()
  const invalidSessionLinks = []
  for (const session of sessions) {
    const contractId = safeId(session.fields.contractId)
    const status = String(session.fields.status || '')
    const qualifies = EVIDENCE_STATUSES.has(status) || session.fields.billingStatus === 'charged'
    if (!qualifies || !contractId) continue
    const values = sessionsByContract.get(contractId) || []
    values.push(session)
    sessionsByContract.set(contractId, values)
  }

  const planned = []
  const upToDate = []
  const projectionAhead = []
  const quarantined = []
  const invalidContracts = []
  for (const contract of contracts) {
    const current = safeCount(contract.fields.usedSessions)
    const total = safeCount(contract.fields.totalSessions)
    const studentId = safeId(contract.fields.studentId)
    if (current === null || total === null || !studentId || !contract.updateTime) {
      invalidContracts.push(entityHash('contracts', contract.id))
      continue
    }
    const evidence = sessionsByContract.get(contract.id) || []
    const mismatched = evidence.filter((session) => safeId(session.fields.studentId) !== studentId)
    if (mismatched.length || current > total || evidence.length > total) {
      quarantined.push(entityHash('contracts', contract.id))
      invalidSessionLinks.push(...mismatched.map((session) => entityHash('sessions', session.id)))
      continue
    }
    if (evidence.length > current) {
      planned.push({
        contractId: contract.id,
        before: current,
        after: evidence.length,
        total,
        updateTime: contract.updateTime,
        publicDigest: sha256(canonicalJson({ contract: entityHash('contracts', contract.id), before: current, after: evidence.length, updateTime: contract.updateTime })),
      })
    } else if (evidence.length === current) upToDate.push(entityHash('contracts', contract.id))
    else projectionAhead.push(entityHash('contracts', contract.id))
  }
  planned.sort((left, right) => left.contractId.localeCompare(right.contractId))
  const planDigest = sha256(canonicalJson({
    version: PLAN_VERSION,
    target: TARGET,
    inventory: { contracts: contracts.length, sessions: sessions.length },
    planned: planned.map((item) => item.publicDigest),
    quarantined,
  }))
  return { planDigest, planned, upToDate, projectionAhead, quarantined, invalidContracts, invalidSessionLinks }
}

function sanitizedReport(mode, contracts, sessions, plan, extra = {}) {
  return {
    generatedAt: new Date().toISOString(),
    mode,
    target: TARGET,
    readScope: 'target-only',
    writeScope: mode === 'apply' ? 'contracts usedSessions monotonic increase + audit create' : 'none',
    retiredSourceProjectAccessed: false,
    planVersion: PLAN_VERSION,
    planDigest: plan.planDigest,
    inventory: { contracts: contracts.length, sessions: sessions.length },
    reconciliation: {
      pending: category(plan.planned.map((item) => entityHash('contracts', item.contractId))),
      upToDate: category(plan.upToDate),
      projectionAheadPreserved: category(plan.projectionAhead),
      quarantined: category(plan.quarantined),
      invalidContracts: category(plan.invalidContracts),
      invalidSessionLinks: category(plan.invalidSessionLinks),
      totalIncrease: plan.planned.reduce((sum, item) => sum + item.after - item.before, 0),
      decreasesPlanned: 0,
    },
    ...extra,
  }
}

function writeReport(filePath, value) {
  fs.mkdirSync(PRIVATE_DIR, { recursive: true })
  const temporary = `${filePath}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, filePath)
}

function loadDryRun(digest) {
  if (!fs.existsSync(REPORTS['dry-run'])) throw new Error('Dry-run report is missing.')
  const report = JSON.parse(fs.readFileSync(REPORTS['dry-run'], 'utf8'))
  if (report?.mode !== 'dry-run' || report?.planVersion !== PLAN_VERSION || canonicalJson(report.target) !== canonicalJson(TARGET)) throw new Error('Dry-run report is incompatible.')
  if (report.planDigest !== digest) throw new Error('Digest does not match the latest dry-run report.')
}

function contractWrite(item) {
  return {
    update: {
      name: `projects/${TARGET.projectId}/databases/${TARGET.databaseId}/documents/contracts/${item.contractId}`,
      fields: encodeFields({ usedSessions: item.after, usageReconciliationVersion: 1, usageReconciledFrom: 'linked_session_evidence_v1' }),
    },
    updateMask: { fieldPaths: ['usedSessions', 'usageReconciliationVersion', 'usageReconciledFrom'] },
    currentDocument: { updateTime: item.updateTime },
    updateTransforms: [{ fieldPath: 'usageReconciledAt', setToServerValue: 'REQUEST_TIME' }],
  }
}

function auditWrite(item) {
  const auditId = `usage_${sha256(`${item.contractId}:${item.after}:${PLAN_VERSION}`).slice(0, 40)}`
  return {
    update: {
      name: `projects/${TARGET.projectId}/databases/${TARGET.databaseId}/documents/ptOperationsAuditLogs/${auditId}`,
      fields: encodeFields({
        schemaVersion: 2,
        action: 'pt_contract.usage_reconciled',
        actorUid: `system:${PLAN_VERSION}`,
        contractId: item.contractId,
        beforeUsedSessions: item.before,
        afterUsedSessions: item.after,
        delta: item.after - item.before,
        evidence: 'explicit_linked_sessions',
      }),
    },
    currentDocument: { exists: false },
    updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
  }
}

async function applyPlan(token, planned) {
  let updated = 0
  for (let index = 0; index < planned.length; index += MAX_ITEMS_PER_COMMIT) {
    const batch = planned.slice(index, index + MAX_ITEMS_PER_COMMIT)
    await requestJson(token, '/documents:commit', { method: 'POST', body: JSON.stringify({ writes: batch.flatMap((item) => [contractWrite(item), auditWrite(item)]) }) })
    updated += batch.length
  }
  return updated
}

async function state(token) {
  const [contracts, sessions] = await Promise.all([readCollection(token, 'contracts'), readCollection(token, 'sessions')])
  return { contracts, sessions, plan: buildPlan(contracts, sessions) }
}

async function dryRun(token) {
  const current = await state(token)
  const report = sanitizedReport('dry-run', current.contracts, current.sessions, current.plan, { applyConfirmation: APPLY_CONFIRMATION })
  writeReport(REPORTS['dry-run'], report)
  console.log(JSON.stringify({ mode: 'dry-run', target: TARGET, planDigest: current.plan.planDigest, contracts: current.contracts.length, sessions: current.sessions.length, pending: current.plan.planned.length, totalIncrease: report.reconciliation.totalIncrease, quarantined: current.plan.quarantined.length, reportPath: REPORTS['dry-run'] }, null, 2))
}

async function apply(token, arguments_) {
  loadDryRun(arguments_.digest)
  const before = await state(token)
  if (before.plan.planDigest !== arguments_.digest) throw new Error('Target data changed after dry run. Review a new report.')
  const updated = await applyPlan(token, before.plan.planned)
  const after = await state(token)
  const verified = after.plan.planned.length === 0
  writeReport(REPORTS.apply, sanitizedReport('apply', after.contracts, after.sessions, after.plan, { approvedDryRunDigest: arguments_.digest, updatedContracts: updated, verified }))
  console.log(JSON.stringify({ mode: 'apply', updatedContracts: updated, verified, remaining: after.plan.planned.length, reportPath: REPORTS.apply }, null, 2))
  if (!verified) process.exitCode = 2
}

async function verify(token) {
  const current = await state(token)
  const verified = current.plan.planned.length === 0
  writeReport(REPORTS.verify, sanitizedReport('verify', current.contracts, current.sessions, current.plan, { verified }))
  console.log(JSON.stringify({ mode: 'verify', verified, remaining: current.plan.planned.length, quarantined: current.plan.quarantined.length, reportPath: REPORTS.verify }, null, 2))
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'PT contract usage reconciliation failed.')
  process.exitCode = 1
})
