'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const TARGET = Object.freeze({ projectId: 'gen-lang-client-0815966909', databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7' })
const RETIRED_SOURCE_PROJECT_ID = 'gen-lang-client-0246058381'
const APPLY_CONFIRMATION = 'APPLY_AURA_CONTRACT_STATUS_RECONCILIATION_V1'
const PRIVATE_DIRECTORY = path.resolve('.migration-private')
const REPORTS = Object.freeze({
  'dry-run': path.join(PRIVATE_DIRECTORY, 'firebase-contract-status-dry-run.json'),
  apply: path.join(PRIVATE_DIRECTORY, 'firebase-contract-status-apply.json'),
  verify: path.join(PRIVATE_DIRECTORY, 'firebase-contract-status-verify.json'),
})

function parseArguments(argv) {
  const result = { mode: 'dry-run' }
  for (const argument of argv) {
    if (argument.startsWith('--mode=')) result.mode = argument.slice(7)
    else if (argument.startsWith('--project=')) result.projectId = argument.slice(10)
    else if (argument.startsWith('--database=')) result.databaseId = argument.slice(11)
    else if (argument.startsWith('--digest=')) result.digest = argument.slice(9)
    else if (argument.startsWith('--confirm=')) result.confirmation = argument.slice(10)
    else throw new Error(`Unknown argument: ${argument.split('=')[0]}`)
  }
  if (!['dry-run', 'apply', 'verify'].includes(result.mode)) throw new Error('Mode must be dry-run, apply, or verify.')
  return result
}

function assertTarget(input) {
  if (TARGET.projectId === RETIRED_SOURCE_PROJECT_ID) throw new Error('Target points to the retired source project.')
  if (input.projectId && input.projectId !== TARGET.projectId) throw new Error('Project override does not match the protected target.')
  if (input.databaseId && input.databaseId !== TARGET.databaseId) throw new Error('Database override does not match the protected target.')
  if (input.mode === 'apply') {
    if (input.projectId !== TARGET.projectId || input.databaseId !== TARGET.databaseId) throw new Error('Apply requires exact target guards.')
    if (!/^[a-f0-9]{64}$/.test(input.digest || '')) throw new Error('Apply requires the latest dry-run digest.')
    if (input.confirmation !== APPLY_CONFIRMATION) throw new Error('Apply confirmation is missing or incorrect.')
  }
}

function firebaseCliAuth() {
  const cliDirectory = path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'firebase-tools', 'lib')
  const auth = require(path.join(cliDirectory, 'auth.js'))
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

function databaseBase() {
  return `https://firestore.googleapis.com/v1/projects/${TARGET.projectId}/databases/${encodeURIComponent(TARGET.databaseId)}`
}

function databaseName() {
  return `projects/${TARGET.projectId}/databases/${TARGET.databaseId}`
}

async function requestJson(token, url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) } })
  const raw = await response.text()
  if (!response.ok) throw new Error(`Firestore request failed (${response.status}): ${raw.slice(0, 500)}`)
  return raw ? JSON.parse(raw) : {}
}

function decodeValue(value = {}) {
  if ('integerValue' in value) return Number(value.integerValue)
  if ('stringValue' in value) return value.stringValue
  return undefined
}

function dateKey(value) {
  const match = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : ''
}

function todayInHoChiMinh() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

async function contracts(token) {
  const result = []
  let pageToken = ''
  do {
    const params = new URLSearchParams({ pageSize: '500', showMissing: 'false' })
    if (pageToken) params.set('pageToken', pageToken)
    const body = await requestJson(token, `${databaseBase()}/documents/contracts?${params}`)
    for (const document of body.documents || []) {
      const fields = Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, decodeValue(value)]))
      result.push({ id: document.name.split('/').at(-1), name: document.name, updateTime: document.updateTime, ...fields })
    }
    pageToken = body.nextPageToken || ''
  } while (pageToken)
  return result
}

function expectedStatus(contract, today) {
  const storedStatus = String(contract.status || 'active').toLowerCase()
  if (['cancelled', 'inactive', 'archived', 'draft', 'frozen'].includes(storedStatus)) return storedStatus
  if (storedStatus === 'expired' && (contract.renewalSupersededBy || contract.renewedByContractId)) return 'expired'
  const startDate = dateKey(contract.startDate)
  const endDate = dateKey(contract.endDate)
  if (!startDate || !endDate || startDate > endDate) return storedStatus
  if (today < startDate) return 'future'
  if (today > endDate) return 'expired'
  return 'active'
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => ({ ...result, [key]: canonical(value[key]) }), {})
  return value
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

function planFor(items, today) {
  return items.map((contract) => ({
    id: contract.id,
    name: contract.name,
    updateTime: contract.updateTime,
    studentId: contract.studentId || '',
    startDate: dateKey(contract.startDate),
    endDate: dateKey(contract.endDate),
    beforeStatus: String(contract.status || 'active').toLowerCase(),
    afterStatus: expectedStatus(contract, today),
    beforeRevision: Math.max(0, Number(contract.revision || 0)),
  })).filter((item) => item.beforeStatus !== item.afterStatus)
    .sort((left, right) => left.id.localeCompare(right.id))
}

function encodedFields(item, today, timestamp) {
  return {
    status: { stringValue: item.afterStatus },
    statusPreviousValue: { stringValue: item.beforeStatus },
    statusReconciliationDate: { stringValue: today },
    statusReconciledBy: { stringValue: 'migration:contract-status-v1' },
    statusReconciledAt: { timestampValue: timestamp },
    updatedAt: { timestampValue: timestamp },
    revision: { integerValue: String(item.beforeRevision + 1) },
  }
}

async function applyPlan(token, plan, today) {
  let applied = 0
  for (let offset = 0; offset < plan.length; offset += 100) {
    const timestamp = new Date().toISOString()
    const writes = []
    for (const item of plan.slice(offset, offset + 100)) {
      writes.push({
        update: { name: item.name, fields: encodedFields(item, today, timestamp) },
        updateMask: { fieldPaths: ['status', 'statusPreviousValue', 'statusReconciliationDate', 'statusReconciledBy', 'statusReconciledAt', 'updatedAt', 'revision'] },
        currentDocument: { updateTime: item.updateTime },
      })
      writes.push({
        update: {
          name: `${databaseName()}/documents/contractAuditLogs/status-${today}-${item.id}`,
          fields: {
            schemaVersion: { integerValue: '1' }, action: { stringValue: 'contract.status.reconciled' },
            contractId: { stringValue: item.id }, studentId: { stringValue: item.studentId },
            beforeStatus: { stringValue: item.beforeStatus }, afterStatus: { stringValue: item.afterStatus },
            referenceDate: { stringValue: today }, createdBy: { stringValue: 'migration:contract-status-v1' },
            createdAt: { timestampValue: timestamp },
          },
        },
        currentDocument: { exists: false },
      })
    }
    await requestJson(token, `${databaseBase()}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes }) })
    applied += Math.min(100, plan.length - offset)
  }
  return applied
}

async function main() {
  const input = parseArguments(process.argv.slice(2))
  assertTarget(input)
  const token = await accessToken()
  const metadata = await requestJson(token, databaseBase())
  if (metadata.name !== `projects/${TARGET.projectId}/databases/${TARGET.databaseId}`) throw new Error('Live database guard failed.')
  const today = todayInHoChiMinh()
  const documents = await contracts(token)
  const plan = planFor(documents, today)
  const planDigest = digest({ target: TARGET, today, plan })
  if (input.mode === 'apply' && input.digest !== planDigest) throw new Error('Live reconciliation plan changed after dry run; run dry-run again.')
  const applied = input.mode === 'apply' ? await applyPlan(token, plan, today) : 0
  const counts = plan.reduce((result, item) => {
    const key = `${item.beforeStatus}_to_${item.afterStatus}`
    result[key] = (result[key] || 0) + 1
    return result
  }, {})
  const report = { generatedAt: new Date().toISOString(), mode: input.mode, target: TARGET, today, contractsScanned: documents.length, plannedWrites: plan.length, applied, counts, planDigest, plan }
  fs.mkdirSync(PRIVATE_DIRECTORY, { recursive: true })
  fs.writeFileSync(REPORTS[input.mode], `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ report: REPORTS[input.mode], contractsScanned: documents.length, plannedWrites: plan.length, applied, counts, planDigest }, null, 2)}\n`)
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1 })
