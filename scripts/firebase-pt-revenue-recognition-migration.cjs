'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
})
const SOURCE_PROJECT = 'gen-lang-client-0246058381'
const CONFIRMATION = 'APPLY_PT_REVENUE_RECOGNITION_V1'
const MIGRATION_ACTOR = 'migration:pt-revenue-recognition-v1'
const MIGRATION_TIMESTAMP = '2026-08-24T00:00:00.000Z'
const REPORT_DIR = path.resolve('.migration-private')
const reportPath = (mode) => path.join(REPORT_DIR, `pt-revenue-recognition-${mode}.json`)

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function entityHash(value) {
  return digest(String(value || '')).slice(0, 20)
}

function parseArgs(argv) {
  const result = { mode: 'dry-run' }
  for (const argument of argv) {
    if (argument.startsWith('--mode=')) result.mode = argument.slice(7)
    else if (argument.startsWith('--project=')) result.project = argument.slice(10)
    else if (argument.startsWith('--database=')) result.database = argument.slice(11)
    else if (argument.startsWith('--digest=')) result.digest = argument.slice(9)
    else if (argument.startsWith('--confirm=')) result.confirm = argument.slice(10)
    else if (argument === '--help') result.help = true
    else throw new Error(`Unknown argument: ${argument.split('=')[0]}`)
  }
  return result
}

function assertTarget(args) {
  if (TARGET.projectId === SOURCE_PROJECT) throw new Error('Target must not be the source project.')
  if (!['dry-run', 'apply', 'verify'].includes(args.mode)) throw new Error('Mode must be dry-run, apply, or verify.')
  if (args.mode === 'apply' && (
    args.project !== TARGET.projectId
    || args.database !== TARGET.databaseId
    || args.confirm !== CONFIRMATION
    || !/^[a-f0-9]{64}$/.test(args.digest || '')
  )) throw new Error('Apply requires the exact target, dry-run digest, and confirmation.')
}

function firebaseCliAuth() {
  const cliLib = path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'firebase-tools', 'lib')
  const auth = require(path.join(cliLib, 'auth.js'))
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI is not signed in.')
  return { auth, account }
}

async function accessToken() {
  const { auth, account } = firebaseCliAuth()
  const result = await auth.getAccessToken(account.tokens.refresh_token, [])
  if (!result?.access_token) throw new Error('Unable to obtain Firebase access token.')
  return result.access_token
}

const databaseName = () => `projects/${TARGET.projectId}/databases/${TARGET.databaseId}`
const baseUrl = () => `https://firestore.googleapis.com/v1/projects/${TARGET.projectId}/databases/${encodeURIComponent(TARGET.databaseId)}`

async function firestoreRequest(token, endpoint, options = {}) {
  const response = await fetch(`${baseUrl()}${endpoint}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const raw = await response.text()
  if (!response.ok) throw new Error(`Firestore request failed (${response.status}) at ${endpoint.split('?')[0]}.`)
  return raw ? JSON.parse(raw) : null
}

function decode(value = {}) {
  if ('nullValue' in value) return null
  if ('booleanValue' in value) return Boolean(value.booleanValue)
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('timestampValue' in value) return value.timestampValue
  if ('stringValue' in value) return value.stringValue
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode)
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {})
  return undefined
}

function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decode(value)]))
}

function encode(value) {
  if (value === null || value === undefined) return { nullValue: null }
  if (value?.timestamp) return { timestampValue: value.timestamp }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } }
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } }
}

async function readCollection(token, collectionId) {
  const response = await firestoreRequest(token, '/documents:runQuery', {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      },
    }),
  })
  const prefix = `${databaseName()}/documents/${collectionId}/`
  return (response || [])
    .filter((row) => row.document?.name.startsWith(prefix))
    .map((row) => ({ id: row.document.name.slice(prefix.length), data: decodeFields(row.document.fields || {}) }))
}

function safeMoney(value) {
  const amount = Number(value || 0)
  return Number.isSafeInteger(amount) && amount > 0 ? amount : 0
}

function contractNetValue(contract) {
  return Math.max(0, safeMoney(contract.totalPrice) - Math.max(0, Number(contract.discount || 0)))
}

function contractSessionCount(contract) {
  const count = Number(contract.totalSessions || contract.sessions || 0)
  return Number.isSafeInteger(count) && count > 0 ? count : 0
}

function recognitionThrough(contract, completedSessionCount) {
  const totalValue = contractNetValue(contract)
  const totalSessions = contractSessionCount(contract)
  const completed = Math.max(0, Math.min(totalSessions, Number(completedSessionCount || 0)))
  if (!totalValue || !totalSessions || !completed) return 0
  const unit = Math.floor(totalValue / totalSessions)
  const remainder = totalValue % totalSessions
  return (unit * completed) + Math.min(completed, remainder)
}

function dateKey(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/)
  return match?.[1] || ''
}

function attendanceStatus(value) {
  return value.status || value.type || ''
}

function incrementReason(reasons, reason) {
  reasons[reason] = (reasons[reason] || 0) + 1
}

function expectedCriticalFields(value) {
  return {
    type: value.type,
    source: value.source,
    contractId: value.contractId,
    sessionId: value.sessionId,
    attendanceEventId: value.attendanceEventId,
    amount: value.amount,
    revenueImpact: value.revenueImpact,
    serviceOrdinal: value.serviceOrdinal,
    serviceTotal: value.serviceTotal,
    idempotencyKey: value.idempotencyKey,
  }
}

function createPlan({ attendance, sessions, contracts, ledger }) {
  const sessionById = new Map(sessions.map((item) => [item.id, item.data]))
  const contractById = new Map(contracts.map((item) => [item.id, item.data]))
  const ledgerById = new Map(ledger.map((item) => [item.id, item.data]))
  const recognitionBySession = new Map()
  for (const item of ledger) {
    if (item.data.type !== 'revenue_recognition' || item.data.source !== 'pt_gym' || !item.data.sessionId) continue
    if (!recognitionBySession.has(item.data.sessionId)) recognitionBySession.set(item.data.sessionId, [])
    recognitionBySession.get(item.data.sessionId).push(item)
  }

  const candidatesByContract = new Map()
  const quarantine = {}
  let ignoredNonAttendance = 0
  for (const item of attendance) {
    if (!['attended', 'completed'].includes(attendanceStatus(item.data))) {
      ignoredNonAttendance += 1
      continue
    }
    const sessionId = String(item.data.sessionId || '')
    const session = sessionById.get(sessionId)
    if (!sessionId || !session) { incrementReason(quarantine, 'missing_session'); continue }
    if (session.status !== 'completed') { incrementReason(quarantine, 'session_not_completed'); continue }
    const contractId = String(item.data.contractId || session.contractId || '')
    const contract = contractById.get(contractId)
    if (!contractId || !contract) { incrementReason(quarantine, 'missing_contract'); continue }
    const studentId = String(item.data.studentId || session.studentId || '')
    if (!studentId || studentId !== String(session.studentId || '') || studentId !== String(contract.studentId || '')) {
      incrementReason(quarantine, 'student_mismatch')
      continue
    }
    const effectiveAt = String(item.data.occurredAt || '')
    const effectiveDate = dateKey(effectiveAt)
    if (!effectiveDate) { incrementReason(quarantine, 'invalid_effective_at'); continue }
    const startDate = dateKey(contract.startDate)
    const endDate = dateKey(contract.endDate)
    if (!startDate || !endDate || effectiveDate < startDate || effectiveDate > endDate) {
      incrementReason(quarantine, 'outside_contract_term')
      continue
    }
    if (!contractNetValue(contract)) { incrementReason(quarantine, 'invalid_contract_value'); continue }
    if (!contractSessionCount(contract)) { incrementReason(quarantine, 'invalid_session_quota'); continue }
    if (!candidatesByContract.has(contractId)) candidatesByContract.set(contractId, [])
    candidatesByContract.get(contractId).push({ attendanceId: item.id, attendance: item.data, sessionId, session, contractId, contract, effectiveAt })
  }

  const writes = []
  const collisions = []
  let alreadyRecognised = 0
  let recognisedRevenue = 0
  let deferredReleased = 0
  let receivableCreated = 0
  let contractsRepresented = 0
  for (const [contractId, candidates] of candidatesByContract) {
    candidates.sort((left, right) => left.effectiveAt.localeCompare(right.effectiveAt) || left.sessionId.localeCompare(right.sessionId))
    const contract = candidates[0].contract
    const totalSessions = contractSessionCount(contract)
    const paidAmount = Math.max(0, Number(contract.paidAmount || 0))
    let represented = false
    for (let index = 0; index < candidates.length; index += 1) {
      const ordinal = index + 1
      const candidate = candidates[index]
      if (ordinal > totalSessions) { incrementReason(quarantine, 'attendance_over_contract_quota'); continue }
      const amount = recognitionThrough(contract, ordinal) - recognitionThrough(contract, ordinal - 1)
      if (!amount) { incrementReason(quarantine, 'zero_recognition_amount'); continue }
      const recognisedBefore = recognitionThrough(contract, ordinal - 1)
      const released = Math.min(amount, Math.max(0, paidAmount - recognisedBefore))
      const value = {
        schemaVersion: 2,
        type: 'revenue_recognition',
        eventClass: 'revenue_recognition',
        source: 'pt_gym',
        recognitionPolicy: 'billable_attendance_v1',
        contractId,
        studentId: candidate.session.studentId || contract.studentId || '',
        trainerId: candidate.session.trainerId || candidate.attendance.trainerId || '',
        branchId: candidate.session.branchId || contract.branchId || '',
        sessionId: candidate.sessionId,
        attendanceEventId: candidate.attendanceId,
        amount,
        cashImpact: 0,
        revenueImpact: amount,
        expenseImpact: 0,
        receivableImpact: amount - released,
        deferredRevenueImpact: -released,
        serviceOrdinal: ordinal,
        serviceTotal: totalSessions,
        effectiveAt: { timestamp: candidate.effectiveAt },
        status: 'posted',
        idempotencyKey: `pt-session-recognition:${candidate.sessionId}`,
        createdAt: { timestamp: MIGRATION_TIMESTAMP },
        createdBy: MIGRATION_ACTOR,
      }
      const id = `pt_session_${candidate.sessionId}`
      const sameSessionEntries = recognitionBySession.get(candidate.sessionId) || []
      const existing = ledgerById.get(id)
      if (existing) {
        if (digest(expectedCriticalFields(existing)) === digest(expectedCriticalFields(value))) alreadyRecognised += 1
        else collisions.push({ ledgerHash: entityHash(id), sessionHash: entityHash(candidate.sessionId), reason: 'deterministic_id_mismatch' })
        continue
      }
      if (sameSessionEntries.length) {
        collisions.push({ ledgerHash: entityHash(sameSessionEntries[0].id), sessionHash: entityHash(candidate.sessionId), reason: 'alternate_recognition_exists' })
        continue
      }
      writes.push({ id, data: value })
      recognisedRevenue += amount
      deferredReleased += released
      receivableCreated += amount - released
      represented = true
    }
    if (represented) contractsRepresented += 1
  }

  return {
    writes,
    collisions,
    quarantine,
    ignoredNonAttendance,
    alreadyRecognised,
    contractsRepresented,
    totals: { recognisedRevenue, deferredReleased, receivableCreated },
  }
}

async function commitWrites(token, writes) {
  for (let offset = 0; offset < writes.length; offset += 400) {
    const batch = writes.slice(offset, offset + 400).map((item) => ({
      update: {
        name: `${databaseName()}/documents/ledgerEntries/${item.id}`,
        fields: Object.fromEntries(Object.entries(item.data).map(([key, value]) => [key, encode(value)])),
      },
      currentDocument: { exists: false },
    }))
    await firestoreRequest(token, '/documents:commit', { method: 'POST', body: JSON.stringify({ writes: batch }) })
  }
}

function saveReport(mode, report) {
  fs.mkdirSync(REPORT_DIR, { recursive: true })
  const temporary = `${reportPath(mode)}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, reportPath(mode))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(`dry-run: node scripts/firebase-pt-revenue-recognition-migration.cjs\napply: node scripts/firebase-pt-revenue-recognition-migration.cjs --mode=apply --project=${TARGET.projectId} --database=${TARGET.databaseId} --digest=<DIGEST> --confirm=${CONFIRMATION}\nverify: node scripts/firebase-pt-revenue-recognition-migration.cjs --mode=verify`)
    return
  }
  assertTarget(args)
  const token = await accessToken()
  const metadata = await firestoreRequest(token, '')
  if (metadata.name !== databaseName()) throw new Error('Live target database mismatch.')
  const [attendance, sessions, contracts, ledger] = await Promise.all([
    readCollection(token, 'attendanceEvents'),
    readCollection(token, 'sessions'),
    readCollection(token, 'contracts'),
    readCollection(token, 'ledgerEntries'),
  ])
  const plan = createPlan({ attendance, sessions, contracts, ledger })
  const planDigest = digest(plan.writes.map((item) => ({ id: item.id, fingerprint: digest(item.data) })))
  const report = {
    schemaVersion: 1,
    mode: args.mode,
    target: TARGET,
    generatedAt: new Date().toISOString(),
    writesPerformed: false,
    inventory: { attendanceEvents: attendance.length, sessions: sessions.length, contracts: contracts.length, ledgerEntries: ledger.length },
    plan: {
      pendingWrites: plan.writes.length,
      alreadyRecognised: plan.alreadyRecognised,
      contractsRepresented: plan.contractsRepresented,
      ignoredNonAttendance: plan.ignoredNonAttendance,
      quarantine: plan.quarantine,
      collisions: plan.collisions,
      totals: plan.totals,
      planDigest,
    },
  }
  if (args.mode === 'apply') {
    const dryRun = JSON.parse(fs.readFileSync(reportPath('dry-run'), 'utf8'))
    if (dryRun.plan.planDigest !== args.digest || dryRun.plan.planDigest !== planDigest) throw new Error('Dry-run digest is stale.')
    if (plan.collisions.length) throw new Error('Recognition collisions must be resolved before apply.')
    await commitWrites(token, plan.writes)
    report.writesPerformed = true
  }
  if (args.mode === 'verify' && (plan.writes.length || plan.collisions.length)) process.exitCode = 2
  saveReport(args.mode, report)
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
