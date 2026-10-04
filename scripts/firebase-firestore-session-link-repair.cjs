'use strict'

// Target-only repair for the first live-source sync. It never connects to the
// retired project and only fills a missing contract link on sessions carrying
// the migration marker. Existing attendance/billing fields are untouched.

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
})
const PLAN_VERSION = 'live-source-session-link-repair-v1'
const IMPORT_MARKER = 'migration:live-source-delta-v1'
const APPLY_CONFIRMATION = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}:repair-live-source-session-links`
const MAX_WRITES_PER_COMMIT = 450
const PRIVATE_DIR = path.resolve('.migration-private')
const REPORTS = {
  'dry-run': path.join(PRIVATE_DIR, 'firebase-firestore-session-link-repair-dry-run.json'),
  apply: path.join(PRIVATE_DIR, 'firebase-firestore-session-link-repair-apply.json'),
  verify: path.join(PRIVATE_DIR, 'firebase-firestore-session-link-repair-verify.json'),
}
const CONTRACT_STATUSES = new Set(['active', 'expired', 'frozen', 'future', 'completed', 'cancelled'])

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((out, key) => { out[key] = canonical(value[key]); return out }, {})
  return value
}
function canonicalJson(value) { return JSON.stringify(canonical(value)) }
function sha256(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex') }
function decode(value) {
  if (!value || typeof value !== 'object') return undefined
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
function decodeFields(fields = {}) { return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decode(value)])) }
function encode(value) {
  if (value === null || value === undefined) return { nullValue: null }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (typeof value === 'string') return { stringValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } }
  if (value && typeof value === 'object') return { mapValue: { fields: encodeFields(value) } }
  throw new Error('Unsupported Firestore value.')
}
function encodeFields(fields) { return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encode(value)])) }
function scalar(fields, key) { const value = decode(fields?.[key]); return value === undefined || value === null ? '' : String(value).trim() }
function normalized(value) { return String(value || '').trim().toLocaleLowerCase('vi-VN').replace(/\s+/g, ' ') }
function dateKey(value) {
  const text = String(value || '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return ''
  const parsed = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text ? text : ''
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
    'Repair missing contract links on imported target sessions (target-only)',
    '  node scripts/firebase-firestore-session-link-repair.cjs --mode=dry-run',
    `  node scripts/firebase-firestore-session-link-repair.cjs --mode=apply --project=${TARGET.projectId} --database=${TARGET.databaseId} --digest=<DRY_RUN_DIGEST> --confirm=${APPLY_CONFIRMATION}`,
    '  node scripts/firebase-firestore-session-link-repair.cjs --mode=verify',
  ].join('\n')
}
function assertGuards(args) {
  if (args.mode !== 'apply') return
  if (args.projectId !== TARGET.projectId || args.databaseId !== TARGET.databaseId) throw new Error('Apply requires the exact target database.')
  if (!/^[a-f0-9]{64}$/.test(args.digest || '')) throw new Error('Apply requires the latest dry-run digest.')
  if (args.confirmation !== APPLY_CONFIRMATION) throw new Error('Apply confirmation does not match the target-only guard.')
}
function auth() {
  const firebaseAuth = require(path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'firebase-tools', 'lib', 'auth.js'))
  const account = firebaseAuth.getProjectDefaultAccount(process.cwd()) || firebaseAuth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI is not signed in.')
  return firebaseAuth.getAccessToken(account.tokens.refresh_token, []).then(result => result.access_token)
}
function base() { return `https://firestore.googleapis.com/v1/projects/${TARGET.projectId}/databases/${TARGET.databaseId}` }
function resource(path_) { return `projects/${TARGET.projectId}/databases/${TARGET.databaseId}/documents/${path_}` }
async function request(token, endpoint, options = {}) {
  const response = await fetch(`${base()}${endpoint}`, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) } })
  const raw = await response.text()
  if (!response.ok) throw new Error(`Target Firestore request failed: HTTP ${response.status}: ${raw.slice(0, 1200)}`)
  return raw ? JSON.parse(raw) : null
}
async function readGroup(token, collectionId) {
  const rows = await request(token, '/documents:runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId, allDescendants: true }] } }) })
  // `resource('')` already ends at the collection root. Keeping the
  // `/documents/` segment here ensures paths are stored as `sessions/...`
  // instead of `documents/sessions/...` (which would make commit names
  // become `documents/documents/...`).
  const prefix = resource('')
  const output = new Map()
  for (const row of Array.isArray(rows) ? rows : [rows]) {
    if (!row.document?.name) continue
    const path_ = row.document.name.slice(prefix.length)
    output.set(path_, { path: path_, fields: row.document.fields || {}, updateTime: row.document.updateTime || null })
  }
  return output
}
function chooseContract(session, contractsByStudent) {
  const fields = decodeFields(session.fields)
  const studentId = String(fields.studentId || '').trim()
  const date = dateKey(fields.date)
  const candidates = (contractsByStudent.get(studentId) || []).filter(contract => CONTRACT_STATUSES.has(contract.status) && contract.startDate <= date && contract.endDate >= date)
  if (candidates.length === 1) return { contract: candidates[0], reason: 'exact_contract_window', confidence: 'exact' }
  if (candidates.length > 1) {
    candidates.sort((left, right) => right.startDate.localeCompare(left.startDate) || right.endDate.localeCompare(left.endDate) || left.id.localeCompare(right.id))
    if (candidates[0].startDate === candidates[1].startDate) return { quarantine: 'AMBIGUOUS_CONTRACT_WINDOW' }
    return { contract: candidates[0], reason: 'overlap_latest_contract_start', confidence: 'deterministic_policy' }
  }
  return { quarantine: (contractsByStudent.get(studentId) || []).length ? 'NO_CONTRACT_COVERING_DATE' : 'NO_CONTRACT_EVIDENCE' }
}
function linkFields(choice) {
  return encodeFields({ contractId: choice.contract.id, contractLinkVersion: 3, contractLinkReason: choice.reason, contractLinkConfidence: choice.confidence, contractLinkGapDays: 0, contractLinkedBy: IMPORT_MARKER })
}
function buildPlan(sessions, contracts) {
  const normalizedContracts = []
  for (const document of contracts.values()) {
    const fields = decodeFields(document.fields)
    const studentId = String(fields.studentId || '').trim()
    const startDate = dateKey(fields.startDate)
    const endDate = dateKey(fields.endDate)
    if (studentId && startDate && endDate && startDate <= endDate) normalizedContracts.push({ id: document.path.split('/').pop(), studentId, startDate, endDate, status: normalized(fields.status) })
  }
  const contractsByStudent = new Map()
  for (const contract of normalizedContracts) contractsByStudent.set(contract.studentId, [...(contractsByStudent.get(contract.studentId) || []), contract])
  const writes = []
  const quarantine = []
  for (const session of sessions.values()) {
    if (scalar(session.fields, 'contractLinkedBy') !== IMPORT_MARKER || scalar(session.fields, 'contractId')) continue
    if (scalar(session.fields, 'billingStatus') === 'charged') {
      quarantine.push({ pathHash: sha256(session.path), reason: 'charged_session_immutable' })
      continue
    }
    const choice = chooseContract(session, contractsByStudent)
    if (!choice.contract) { quarantine.push({ pathHash: sha256(session.path), reason: choice.quarantine }); continue }
    const fields = linkFields(choice)
    writes.push({ operation: 'update', path: session.path, pathHash: sha256(session.path), updateTime: session.updateTime, fields, fieldPaths: Object.keys(fields), fieldsHash: sha256(fields), contractHash: sha256(choice.contract.id) })
  }
  writes.sort((left, right) => left.path.localeCompare(right.path))
  quarantine.sort((left, right) => left.pathHash.localeCompare(right.pathHash))
  const plan = { planVersion: PLAN_VERSION, sourceReadOnly: true, writes, quarantine, target: TARGET }
  plan.planDigest = sha256(plan)
  return plan
}
function sanitize(mode, plan, extra = {}) {
  return { planVersion: PLAN_VERSION, mode, target: TARGET, sourceReadOnly: true, sourceMutationCount: 0, planDigest: plan.planDigest, pendingWrites: plan.writes.length, quarantineCount: plan.quarantine.length, quarantineReasons: plan.quarantine.reduce((out, item) => { out[item.reason] = (out[item.reason] || 0) + 1; return out }, {}), writes: plan.writes.map(({ operation, pathHash, updateTime, fieldPaths, fieldsHash, contractHash }) => ({ operation, pathHash, updateTime, fieldPaths, fieldsHash, contractHash })), quarantine: plan.quarantine, generatedAt: new Date().toISOString(), writesPerformed: false, ...extra }
}
function writeReport(mode, report) { fs.mkdirSync(PRIVATE_DIR, { recursive: true }); fs.writeFileSync(REPORTS[mode], `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); return REPORTS[mode] }
function firestoreWrite(item) { return { update: { name: resource(item.path), fields: item.fields }, updateMask: { fieldPaths: item.fieldPaths }, currentDocument: { updateTime: item.updateTime } } }
async function commit(token, plan) {
  let committed = 0
  for (let index = 0; index < plan.writes.length; index += MAX_WRITES_PER_COMMIT) {
    const batch = plan.writes.slice(index, index + MAX_WRITES_PER_COMMIT)
    await request(token, '/documents:commit', { method: 'POST', body: JSON.stringify({ writes: batch.map(firestoreWrite) }) })
    committed += batch.length
  }
  return committed
}
function readApproved() {
  if (!fs.existsSync(REPORTS['dry-run'])) throw new Error('Dry-run report is missing.')
  const report = JSON.parse(fs.readFileSync(REPORTS['dry-run'], 'utf8'))
  if (report.planVersion !== PLAN_VERSION || report.mode !== 'dry-run' || canonicalJson(report.target) !== canonicalJson(TARGET)) throw new Error('Approved repair report is incompatible.')
  return report
}
async function main() {
  const args = parseArguments(process.argv.slice(2))
  if (args.help) { console.log(usage()); return }
  assertGuards(args)
  const token = await auth()
  const [sessions, contracts] = await Promise.all([readGroup(token, 'sessions'), readGroup(token, 'contracts')])
  const plan = buildPlan(sessions, contracts)
  if (args.mode === 'dry-run') { const reportPath = writeReport('dry-run', sanitize('dry-run', plan)); console.log(JSON.stringify({ mode: 'dry-run', planDigest: plan.planDigest, pendingWrites: plan.writes.length, quarantineCount: plan.quarantine.length, reportPath }, null, 2)); return }
  if (args.mode === 'apply') {
    const approved = readApproved()
    if (approved.planDigest !== args.digest || approved.planDigest !== plan.planDigest) throw new Error('Live repair plan differs from approved dry-run.')
    const committed = await commit(token, plan)
    const reportPath = writeReport('apply', sanitize('apply', plan, { writesPerformed: committed > 0, committedWriteCount: committed, approvedDryRunDigest: args.digest }))
    console.log(JSON.stringify({ mode: 'apply', planDigest: plan.planDigest, committedWriteCount: committed, reportPath }, null, 2)); return
  }
  const reportPath = writeReport('verify', sanitize('verify', plan)); console.log(JSON.stringify({ mode: 'verify', planDigest: plan.planDigest, pendingWrites: plan.writes.length, quarantineCount: plan.quarantine.length, reportPath }, null, 2)); if (plan.writes.length) process.exitCode = 2
}

module.exports = { main, TARGET, PLAN_VERSION, parseArguments, buildPlan, chooseContract, linkFields, firestoreWrite }
if (require.main === module) main().catch(error => { console.error(error.message || 'Repair failed.'); process.exitCode = 1 })
