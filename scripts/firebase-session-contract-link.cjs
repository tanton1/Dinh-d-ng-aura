'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

/**
 * Target-only migration that links legacy PT sessions to the one contract
 * covering the same learner and date. It never guesses across date gaps, does
 * not use the historical +60-day UI tolerance, and never edits legacy history
 * other than adding an approved contract link to an otherwise unchanged
 * session document.
 */

const PLAN_VERSION = 'session-contract-link-v1'
const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
})
const RETIRED_SOURCE_PROJECT_ID = 'gen-lang-client-0246058381'
const APPLY_CONFIRMATION = 'APPLY_SESSION_CONTRACT_LINK_V1'
const PRIVATE_DIR = path.resolve('.migration-private')
const REPORT_PATHS = Object.freeze({
  'dry-run': path.join(PRIVATE_DIR, 'firebase-session-contract-link-dry-run.json'),
  apply: path.join(PRIVATE_DIR, 'firebase-session-contract-link-apply.json'),
  verify: path.join(PRIVATE_DIR, 'firebase-session-contract-link-verify.json'),
})
const MAX_COMMIT_WRITES = 300
const HASH_SAMPLE_LIMIT = 100
const LINKABLE_CONTRACT_STATUSES = new Set(['active', 'expired', 'frozen'])

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
    'PT session contract link migration (defaults to read-only dry run)',
    '',
    'Dry run:',
    '  node scripts/firebase-session-contract-link.cjs',
    '',
    'Verify:',
    '  node scripts/firebase-session-contract-link.cjs --mode=verify',
    '',
    'Apply (all guards are required):',
    `  node scripts/firebase-session-contract-link.cjs --mode=apply --project=${TARGET.projectId} --database=${TARGET.databaseId} --digest=<DRY_RUN_DIGEST> --confirm=${APPLY_CONFIRMATION}`,
  ].join('\n')
}

function assertTarget(arguments_) {
  if (TARGET.projectId === RETIRED_SOURCE_PROJECT_ID) throw new Error('Target points to the retired source project.')
  if (arguments_.projectId && arguments_.projectId !== TARGET.projectId) throw new Error('Project override is not the approved target.')
  if (arguments_.databaseId && arguments_.databaseId !== TARGET.databaseId) throw new Error('Database override is not the approved named database.')
  if (arguments_.mode === 'apply') {
    if (arguments_.projectId !== TARGET.projectId || arguments_.databaseId !== TARGET.databaseId) {
      throw new Error('Apply requires explicit project and database guards.')
    }
    if (!/^[a-f0-9]{64}$/.test(arguments_.digest || '')) throw new Error('Apply requires the plan digest from the latest dry run.')
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
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
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

function decodeFirestoreValue(value = {}) {
  if ('nullValue' in value) return null
  if ('booleanValue' in value) return Boolean(value.booleanValue)
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('timestampValue' in value) return value.timestampValue
  if ('stringValue' in value) return value.stringValue
  if ('bytesValue' in value) return value.bytesValue
  if ('referenceValue' in value) return value.referenceValue
  if ('geoPointValue' in value) return value.geoPointValue
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map(decodeFirestoreValue)
  if ('mapValue' in value) return decodeFirestoreFields(value.mapValue?.fields || {})
  return undefined
}

function decodeFirestoreFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]))
}

function encodeFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (typeof value === 'string') return { stringValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestoreValue) } }
  if (value && typeof value === 'object') return { mapValue: { fields: encodeFirestoreFields(value) } }
  throw new Error('Unsupported Firestore value in migration plan.')
}

function encodeFirestoreFields(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeFirestoreValue(item)]))
}

async function readRootCollection(token, collectionId) {
  const rows = await requestJson(token, '/documents:runQuery', {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId, allDescendants: false }],
        orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      },
    }),
  })
  const prefix = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}/documents/${collectionId}/`
  return (Array.isArray(rows) ? rows : [rows])
    .filter((row) => row?.document?.name?.startsWith(prefix))
    .map((row) => ({
      id: row.document.name.slice(prefix.length),
      fields: decodeFirestoreFields(row.document.fields || {}),
      updateTime: row.document.updateTime,
      fingerprint: sha256(canonicalJson(row.document.fields || {})),
    }))
}

function safeId(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  return /^[A-Za-z0-9_-]+$/.test(result) ? result : ''
}

function dateKey(value) {
  const result = typeof value === 'string' ? value.trim().slice(0, 10) : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) return ''
  const parsed = new Date(`${result}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === result ? result : ''
}

function hashEntity(collection, id) {
  return sha256(`${PLAN_VERSION}:${collection}/${id}`)
}

function publicCategory(ids) {
  const unique = [...new Set(ids)].sort()
  return { count: unique.length, hashedIdSamples: unique.slice(0, HASH_SAMPLE_LIMIT), sampleLimit: HASH_SAMPLE_LIMIT }
}

function buildPlan(sessions, contracts) {
  const contractsById = new Map(contracts.map((contract) => [contract.id, contract]))
  const contractsByStudent = new Map()
  const invalidContracts = []
  for (const contract of contracts) {
    const studentId = safeId(contract.fields.studentId)
    const startDate = dateKey(contract.fields.startDate)
    const endDate = dateKey(contract.fields.endDate)
    const status = String(contract.fields.status || '')
    if (!studentId || !startDate || !endDate || startDate > endDate || !LINKABLE_CONTRACT_STATUSES.has(status)) {
      invalidContracts.push(hashEntity('contracts', contract.id))
      continue
    }
    const current = contractsByStudent.get(studentId) || []
    current.push({ ...contract, studentId, startDate, endDate, status })
    contractsByStudent.set(studentId, current)
  }

  const categories = {
    alreadyLinked: [],
    pending: [],
    unmatched: [],
    ambiguous: [],
    invalidSession: [],
    invalidExistingLink: [],
  }
  const planned = []

  for (const session of sessions) {
    const sessionHash = hashEntity('sessions', session.id)
    const studentId = safeId(session.fields.studentId)
    const sessionDate = dateKey(session.fields.date)
    if (!studentId || !sessionDate || !session.updateTime) {
      categories.invalidSession.push(sessionHash)
      continue
    }
    const existingContractId = safeId(session.fields.contractId)
    if (existingContractId) {
      const contract = contractsById.get(existingContractId)
      const valid = contract
        && safeId(contract.fields.studentId) === studentId
        && dateKey(contract.fields.startDate) <= sessionDate
        && dateKey(contract.fields.endDate) >= sessionDate
        && LINKABLE_CONTRACT_STATUSES.has(String(contract.fields.status || ''))
      categories[valid ? 'alreadyLinked' : 'invalidExistingLink'].push(sessionHash)
      continue
    }

    const candidates = (contractsByStudent.get(studentId) || [])
      .filter((contract) => contract.startDate <= sessionDate && contract.endDate >= sessionDate)
    if (candidates.length === 0) {
      categories.unmatched.push(sessionHash)
      continue
    }
    if (candidates.length > 1) {
      categories.ambiguous.push(sessionHash)
      continue
    }
    const contract = candidates[0]
    categories.pending.push(sessionHash)
    planned.push({
      sessionId: session.id,
      contractId: contract.id,
      sessionFingerprint: session.fingerprint,
      updateTime: session.updateTime,
      publicDigest: sha256(canonicalJson({ sessionHash, contractHash: hashEntity('contracts', contract.id), fingerprint: session.fingerprint })),
    })
  }

  planned.sort((left, right) => left.sessionId.localeCompare(right.sessionId))
  const planDigest = sha256(canonicalJson({
    planVersion: PLAN_VERSION,
    target: TARGET,
    inventory: { sessions: sessions.length, contracts: contracts.length },
    planned: planned.map((item) => item.publicDigest),
    quarantined: {
      unmatched: categories.unmatched.sort(),
      ambiguous: categories.ambiguous.sort(),
      invalidSession: categories.invalidSession.sort(),
      invalidExistingLink: categories.invalidExistingLink.sort(),
    },
  }))
  return { planDigest, planned, categories, invalidContracts }
}

function report(mode, sessions, contracts, plan, extra = {}) {
  return {
    generatedAt: new Date().toISOString(),
    mode,
    readScope: 'target-only',
    writeScope: mode === 'apply' ? 'sessions contract-link fields only' : 'none',
    target: TARGET,
    retiredSourceProjectAccessed: false,
    planVersion: PLAN_VERSION,
    planDigest: plan.planDigest,
    inventory: { sessions: sessions.length, contracts: contracts.length },
    classifications: Object.fromEntries(Object.entries(plan.categories).map(([key, values]) => [key, publicCategory(values)])),
    invalidContracts: publicCategory(plan.invalidContracts),
    plannedWrites: plan.planned.length,
    piiPolicy: 'Document IDs are SHA-256 hashed in reports; names, email addresses and phone numbers are never emitted.',
    ...extra,
  }
}

function writeReport(filePath, value) {
  fs.mkdirSync(PRIVATE_DIR, { recursive: true })
  const temporary = `${filePath}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, filePath)
}

function loadApprovedDryRun(digest) {
  const filePath = REPORT_PATHS['dry-run']
  if (!fs.existsSync(filePath)) throw new Error('Dry-run report is missing.')
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (value?.mode !== 'dry-run' || value?.planVersion !== PLAN_VERSION) throw new Error('Dry-run report is incompatible.')
  if (canonicalJson(value?.target) !== canonicalJson(TARGET)) throw new Error('Dry-run report target is invalid.')
  if (value?.planDigest !== digest) throw new Error('Digest does not match the approved dry-run report.')
  return value
}

function updateWrite(item) {
  return {
    update: {
      name: `projects/${TARGET.projectId}/databases/${TARGET.databaseId}/documents/sessions/${item.sessionId}`,
      fields: encodeFirestoreFields({
        contractId: item.contractId,
        contractLinkVersion: 1,
        contractLinkedBy: `migration:${PLAN_VERSION}`,
      }),
    },
    updateMask: { fieldPaths: ['contractId', 'contractLinkVersion', 'contractLinkedBy'] },
    updateTransforms: [{ fieldPath: 'contractLinkedAt', setToServerValue: 'REQUEST_TIME' }],
    currentDocument: { updateTime: item.updateTime },
  }
}

async function applyPlan(token, planned) {
  let updated = 0
  for (let index = 0; index < planned.length; index += MAX_COMMIT_WRITES) {
    const batch = planned.slice(index, index + MAX_COMMIT_WRITES)
    await requestJson(token, '/documents:commit', {
      method: 'POST',
      body: JSON.stringify({ writes: batch.map(updateWrite) }),
    })
    updated += batch.length
  }
  return updated
}

async function livePlan(token) {
  const [sessions, contracts] = await Promise.all([
    readRootCollection(token, 'sessions'),
    readRootCollection(token, 'contracts'),
  ])
  return { sessions, contracts, plan: buildPlan(sessions, contracts) }
}

async function runDryRun(token) {
  const state = await livePlan(token)
  const output = report('dry-run', state.sessions, state.contracts, state.plan, {
    writesPerformed: false,
    applyConfirmation: APPLY_CONFIRMATION,
  })
  writeReport(REPORT_PATHS['dry-run'], output)
  console.log(JSON.stringify({
    mode: 'dry-run', target: TARGET, planDigest: state.plan.planDigest,
    sessions: state.sessions.length, contracts: state.contracts.length,
    plannedWrites: state.plan.planned.length,
    unmatched: state.plan.categories.unmatched.length,
    ambiguous: state.plan.categories.ambiguous.length,
    invalidExistingLink: state.plan.categories.invalidExistingLink.length,
    reportPath: REPORT_PATHS['dry-run'], writesPerformed: false,
  }, null, 2))
}

async function runApply(token, arguments_) {
  loadApprovedDryRun(arguments_.digest)
  const before = await livePlan(token)
  if (before.plan.planDigest !== arguments_.digest) throw new Error('Target data changed after dry run. Review a new report.')
  if (before.plan.categories.invalidExistingLink.length > 0) throw new Error('Apply blocked by invalid existing contract links.')
  const updated = await applyPlan(token, before.plan.planned)
  const after = await livePlan(token)
  const verified = after.plan.planned.length === 0 && after.plan.categories.invalidExistingLink.length === 0
  writeReport(REPORT_PATHS.apply, report('apply', after.sessions, after.contracts, after.plan, {
    approvedPlanDigest: arguments_.digest,
    updatedSessions: updated,
    verifiedAfterApply: verified,
  }))
  console.log(JSON.stringify({ mode: 'apply', updatedSessions: updated, verifiedAfterApply: verified, reportPath: REPORT_PATHS.apply }, null, 2))
  if (!verified) process.exitCode = 2
}

async function runVerify(token) {
  const state = await livePlan(token)
  const verified = state.plan.planned.length === 0 && state.plan.categories.invalidExistingLink.length === 0
  writeReport(REPORT_PATHS.verify, report('verify', state.sessions, state.contracts, state.plan, { verified }))
  console.log(JSON.stringify({
    mode: 'verify', verified, pending: state.plan.planned.length,
    unmatched: state.plan.categories.unmatched.length,
    ambiguous: state.plan.categories.ambiguous.length,
    reportPath: REPORT_PATHS.verify,
  }, null, 2))
  if (!verified) process.exitCode = 2
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2))
  if (arguments_.help) {
    console.log(usage())
    return
  }
  assertTarget(arguments_)
  const token = await accessToken()
  await assertLiveTarget(token)
  if (arguments_.mode === 'dry-run') await runDryRun(token)
  else if (arguments_.mode === 'apply') await runApply(token, arguments_)
  else await runVerify(token)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Session contract link migration failed.')
  process.exitCode = 1
})
