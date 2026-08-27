'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
})
const CONFIRM = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}:reconcile-renewal-continuity`
const PRIVATE_DIR = path.resolve('.migration-private')
const REPORT_PATH = path.join(PRIVATE_DIR, 'renewal-continuity-reconcile.json')

function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex') }
function entityHash(value) { return crypto.createHash('sha256').update(`renewal-continuity:${value}`).digest('hex') }
function vietnamToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) }
function nextDay(value) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10) }

function argumentsFor(argv) {
  const result = { mode: 'dry-run' }
  for (const value of argv) {
    if (value.startsWith('--mode=')) result.mode = value.slice(7)
    else if (value.startsWith('--project=')) result.project = value.slice(10)
    else if (value.startsWith('--database=')) result.database = value.slice(11)
    else if (value.startsWith('--digest=')) result.digest = value.slice(9)
    else if (value.startsWith('--confirm=')) result.confirm = value.slice(10)
    else if (value === '--help' || value === '-h') result.help = true
    else throw new Error(`Unknown argument: ${value.split('=')[0]}`)
  }
  if (!['dry-run', 'apply', 'verify'].includes(result.mode)) throw new Error('Mode must be dry-run, apply, or verify.')
  return result
}

function assertTarget(args) {
  if (args.project && args.project !== TARGET.projectId) throw new Error('Unexpected target project.')
  if (args.database && args.database !== TARGET.databaseId) throw new Error('Unexpected target database.')
  if (args.mode === 'apply') {
    if (args.project !== TARGET.projectId || args.database !== TARGET.databaseId) throw new Error('Apply requires exact target guards.')
    if (!/^[a-f0-9]{64}$/.test(args.digest || '')) throw new Error('Apply requires the latest dry-run digest.')
    if (args.confirm !== CONFIRM) throw new Error('Apply confirmation is missing or incorrect.')
  }
}

function firebaseCliAuth() {
  const auth = require(path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'firebase-tools', 'lib', 'auth.js'))
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

function resource() { return `projects/${TARGET.projectId}/databases/${TARGET.databaseId}` }
function baseUrl() { return `https://firestore.googleapis.com/v1/${resource()}` }
async function request(token, endpoint, options = {}) {
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
  if ('stringValue' in value) return value.stringValue
  if ('timestampValue' in value) return value.timestampValue
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode)
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {})
  return undefined
}
function decodeFields(value = {}) { return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)])) }
function encode(value) {
  if (value === null || value === undefined) return { nullValue: null }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (typeof value === 'string') return value.includes('T') && !Number.isNaN(Date.parse(value)) ? { timestampValue: value } : { stringValue: value }
  throw new Error('Unsupported Firestore write value.')
}

async function collection(token, collectionId) {
  const result = []
  let pageToken = ''
  do {
    const query = new URLSearchParams({ pageSize: '1000' })
    if (pageToken) query.set('pageToken', pageToken)
    const body = await request(token, `/documents/${collectionId}?${query}`)
    for (const document of body.documents || []) result.push({
      id: document.name.slice(document.name.lastIndexOf('/') + 1),
      data: decodeFields(document.fields || {}),
      updateTime: document.updateTime,
    })
    pageToken = body.nextPageToken || ''
  } while (pageToken)
  return result
}

function buildPlan(contracts, packages, today) {
  const packageMap = new Map(packages.map((item) => [item.id, item.data]))
  const grouped = new Map()
  contracts.forEach((contract) => grouped.set(contract.data.studentId, [...(grouped.get(contract.data.studentId) || []), contract]))
  const planned = []
  const quarantined = []
  for (const [studentId, values] of grouped) {
    if (!studentId || values.length < 2) continue
    values.sort((left, right) => String(left.data.startDate || '').localeCompare(String(right.data.startDate || '')))
    for (let index = 1; index < values.length; index += 1) {
      const source = values[index - 1]
      const next = values[index]
      if (nextDay(String(source.data.endDate || '').slice(0, 10)) !== String(next.data.startDate || '').slice(0, 10)) continue
      if (!source.data.branchId || source.data.branchId !== next.data.branchId) continue
      if (source.data.renewedByContractId || next.data.sourceContractId) continue
      const remaining = Math.max(0, Number(source.data.totalSessions || 0) - Number(source.data.usedSessions || 0))
      const packageSessions = Number(packageMap.get(next.data.packageId)?.totalSessions || 0)
      const exactCarry = remaining > 0 && packageSessions > 0 && Number(next.data.totalSessions || 0) === packageSessions + remaining
      if (!exactCarry) {
        quarantined.push({ pairHash: entityHash(`${source.id}:${next.id}`), reason: 'ENTITLEMENT_NOT_EXACTLY_PROVABLE' })
        continue
      }
      const pending = source.data.status === 'expired'
        && String(source.data.endDate).slice(0, 10) >= today
        && String(next.data.startDate).slice(0, 10) > today
        && next.data.status === 'active'
      const historical = String(next.data.startDate).slice(0, 10) <= today && next.data.status === 'active'
      if (!pending && !historical) {
        quarantined.push({ pairHash: entityHash(`${source.id}:${next.id}`), reason: 'UNSUPPORTED_LIFECYCLE_STATE' })
        continue
      }
      planned.push({
        action: pending ? 'RESTORE_PENDING_HANDOVER' : 'BACKFILL_COMPLETED_HANDOVER',
        pairHash: entityHash(`${source.id}:${next.id}`), studentHash: entityHash(studentId),
        sourceId: source.id, sourceUpdateTime: source.updateTime, sourceRevision: Number(source.data.revision || 0),
        nextId: next.id, nextUpdateTime: next.updateTime, nextRevision: Number(next.data.revision || 0),
        remaining, packageSessions,
      })
    }
  }
  planned.sort((left, right) => left.pairHash.localeCompare(right.pairHash))
  const publicPlan = planned.map(({ sourceId, sourceUpdateTime, nextId, nextUpdateTime, ...value }) => value)
  return { planned, quarantined, planDigest: digest({ target: TARGET, today, publicPlan, quarantined }) }
}

function updateWrite(collectionId, id, updateTime, fields) {
  return {
    update: {
      name: `${resource()}/documents/${collectionId}/${id}`,
      fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encode(value)])),
    },
    updateMask: { fieldPaths: Object.keys(fields) },
    currentDocument: { updateTime },
  }
}

async function applyPlan(token, plan) {
  const now = new Date().toISOString()
  for (const item of plan.planned) {
    const pending = item.action === 'RESTORE_PENDING_HANDOVER'
    const writes = [
      updateWrite('contracts', item.sourceId, item.sourceUpdateTime, {
        status: pending ? 'active' : 'expired',
        renewedByContractId: item.nextId,
        ...(pending ? {} : { renewalSupersededBy: item.nextId, carryOverTransferredSessions: item.remaining }),
        renewalContinuityReconciledAt: now,
        revision: item.sourceRevision + 1,
        updatedAt: now,
      }),
      updateWrite('contracts', item.nextId, item.nextUpdateTime, {
        status: pending ? 'future' : 'active',
        sourceContractId: item.sourceId,
        packageSessions: item.packageSessions,
        plannedCarryOverSessions: item.remaining,
        carriedOverSessions: pending ? 0 : item.remaining,
        carryOverRequested: true,
        carryOverPending: pending,
        renewalContinuityReconciledAt: now,
        revision: item.nextRevision + 1,
        updatedAt: now,
      }),
    ]
    await request(token, '/documents:commit', { method: 'POST', body: JSON.stringify({ writes }) })
  }
}

function publicReport(mode, today, plan, writesPerformed) {
  return {
    mode, target: TARGET, today, readsOnly: !writesPerformed, writesPerformed,
    planDigest: plan.planDigest, plannedPairs: plan.planned.length,
    pendingHandovers: plan.planned.filter((item) => item.action === 'RESTORE_PENDING_HANDOVER').length,
    historicalBackfills: plan.planned.filter((item) => item.action === 'BACKFILL_COMPLETED_HANDOVER').length,
    quarantined: plan.quarantined,
    planned: plan.planned.map((item) => ({ action: item.action, pairHash: item.pairHash, studentHash: item.studentHash, remaining: item.remaining, packageSessions: item.packageSessions })),
    generatedAt: new Date().toISOString(),
  }
}

function writeReport(report) {
  fs.mkdirSync(PRIVATE_DIR, { recursive: true })
  const temporary = `${REPORT_PATH}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, REPORT_PATH)
}

async function main() {
  const args = argumentsFor(process.argv.slice(2))
  if (args.help) {
    console.log(`Dry run: node scripts/firebase-renewal-continuity-reconcile.cjs\nApply: node scripts/firebase-renewal-continuity-reconcile.cjs --mode=apply --project=${TARGET.projectId} --database=${TARGET.databaseId} --digest=<digest> --confirm=${CONFIRM}\nVerify: node scripts/firebase-renewal-continuity-reconcile.cjs --mode=verify`)
    return
  }
  assertTarget(args)
  const token = await accessToken()
  const metadata = await request(token, '')
  if (metadata?.name !== resource()) throw new Error('Live database does not match the approved target.')
  const today = vietnamToday()
  const [contracts, packages] = await Promise.all([collection(token, 'contracts'), collection(token, 'packages')])
  const plan = buildPlan(contracts, packages, today)
  if (args.mode === 'apply') {
    if (args.digest !== plan.planDigest) throw new Error('Live plan changed after dry-run; apply aborted.')
    await applyPlan(token, plan)
    const report = publicReport(args.mode, today, plan, true)
    writeReport(report)
    console.log(JSON.stringify(report, null, 2))
    return
  }
  const report = publicReport(args.mode, today, plan, false)
  writeReport(report)
  console.log(JSON.stringify(report, null, 2))
  if (args.mode === 'verify' && plan.planned.length) process.exitCode = 2
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Renewal continuity reconciliation failed.')
  process.exitCode = 1
})
