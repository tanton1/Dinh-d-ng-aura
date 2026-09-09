'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
})
const RETIRED_SOURCE_PROJECT_ID = 'gen-lang-client-0246058381'
const APPLY_CONFIRMATION = 'APPLY_AURA_CONTRACT_ASSIGNEE_CLEANUP_V1'
const PRIVATE_DIRECTORY = path.resolve('.migration-private')
const REPORTS = Object.freeze({
  'dry-run': path.join(PRIVATE_DIRECTORY, 'firebase-contract-assignee-cleanup-dry-run.json'),
  apply: path.join(PRIVATE_DIRECTORY, 'firebase-contract-assignee-cleanup-apply.json'),
  verify: path.join(PRIVATE_DIRECTORY, 'firebase-contract-assignee-cleanup-verify.json'),
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
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const raw = await response.text()
  if (!response.ok) throw new Error(`Firestore request failed (${response.status}): ${raw.slice(0, 500)}`)
  return raw ? JSON.parse(raw) : {}
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
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } }
  if (typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item)])) } }
  return { stringValue: String(value) }
}

async function collectionDocuments(token, collectionId) {
  const result = []
  let pageToken = ''
  do {
    const params = new URLSearchParams({ pageSize: '500', showMissing: 'false' })
    if (pageToken) params.set('pageToken', pageToken)
    const body = await requestJson(token, `${databaseBase()}/documents/${collectionId}?${params}`)
    for (const document of body.documents || []) result.push({
      id: document.name.split('/').at(-1),
      name: document.name,
      updateTime: document.updateTime || '',
      ...decodeFields(document.fields || {}),
    })
    pageToken = body.nextPageToken || ''
  } while (pageToken)
  return result
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

function uniqueIds(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))]
}

function isCurrentContract(contract, today) {
  const status = String(contract.status || 'active').toLowerCase()
  return !['cancelled', 'inactive', 'archived', 'draft'].includes(status) && dateKey(contract.endDate) >= today
}

function invalidAssignee(trainer, contractBranchId) {
  if (!trainer) return { reason: 'not_found', name: 'PT/coach không còn hồ sơ', assigneeBranchId: null }
  if (contractBranchId && trainer.branchId && trainer.branchId !== contractBranchId) {
    return {
      reason: 'branch_mismatch',
      name: trainer.name || trainer.displayName || 'PT/coach khác chi nhánh',
      assigneeBranchId: trainer.branchId,
    }
  }
  return null
}

function planFor(contracts, trainers, students, today) {
  const trainersById = new Map(trainers.map((item) => [item.id, item]))
  const studentsById = new Map(students.map((item) => [item.id, item]))
  return contracts.filter((contract) => isCurrentContract(contract, today)).map((contract) => {
    const trainingIds = uniqueIds([contract.trainerId, ...(Array.isArray(contract.trainerIds) ? contract.trainerIds : [])])
    const nutritionIds = uniqueIds(Array.isArray(contract.nutritionPTIds) ? contract.nutritionPTIds : [])
    const allIds = uniqueIds([...trainingIds, ...nutritionIds])
    const removed = allIds.map((id) => {
      const issue = invalidAssignee(trainersById.get(id), contract.branchId)
      return issue ? { id, ...issue } : null
    }).filter(Boolean)
    if (!removed.length) return null
    const removedIds = new Set(removed.map((item) => item.id))
    const nextTrainerIds = trainingIds.filter((id) => !removedIds.has(id))
    const nextNutritionPTIds = nutritionIds.filter((id) => !removedIds.has(id))
    return {
      contractId: contract.id,
      contractName: contract.name,
      updateTime: contract.updateTime,
      revision: Math.max(0, Number(contract.revision || 0)),
      studentId: contract.studentId || '',
      studentName: studentsById.get(contract.studentId)?.name || studentsById.get(contract.studentId)?.displayName || 'Không tìm thấy học viên',
      branchId: contract.branchId || '',
      startDate: dateKey(contract.startDate),
      endDate: dateKey(contract.endDate),
      before: {
        trainerId: typeof contract.trainerId === 'string' && contract.trainerId ? contract.trainerId : null,
        trainerIds: uniqueIds(Array.isArray(contract.trainerIds) ? contract.trainerIds : []),
        nutritionPTIds: nutritionIds,
      },
      after: {
        trainerId: nextTrainerIds[0] || null,
        trainerIds: nextTrainerIds,
        nutritionPTIds: nextNutritionPTIds,
      },
      removed,
    }
  }).filter(Boolean).sort((left, right) => left.contractId.localeCompare(right.contractId))
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => ({ ...result, [key]: canonical(value[key]) }), {})
  return value
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

async function applyPlan(token, plan, planDigest) {
  let applied = 0
  for (let offset = 0; offset < plan.length; offset += 40) {
    const timestamp = new Date().toISOString()
    const writes = []
    for (const item of plan.slice(offset, offset + 40)) {
      const contractFields = {
        trainerId: encodeValue(item.after.trainerId),
        trainerIds: encodeValue(item.after.trainerIds),
        nutritionPTIds: encodeValue(item.after.nutritionPTIds),
        assigneeCleanupVersion: encodeValue('contract-assignee-cleanup-v1'),
        assigneeCleanupAt: { timestampValue: timestamp },
        assigneeCleanupBy: encodeValue('migration:contract-assignee-cleanup-v1'),
        updatedAt: { timestampValue: timestamp },
        revision: encodeValue(item.revision + 1),
      }
      writes.push({
        update: { name: item.contractName, fields: contractFields },
        updateMask: { fieldPaths: Object.keys(contractFields) },
        currentDocument: { updateTime: item.updateTime },
      })
      const auditFields = {
        schemaVersion: encodeValue(1),
        action: encodeValue('contract.assignees.cleaned'),
        contractId: encodeValue(item.contractId),
        studentId: encodeValue(item.studentId),
        before: encodeValue(item.before),
        after: encodeValue(item.after),
        removed: encodeValue(item.removed),
        planDigest: encodeValue(planDigest),
        createdBy: encodeValue('migration:contract-assignee-cleanup-v1'),
        createdAt: { timestampValue: timestamp },
      }
      writes.push({
        update: {
          name: `${databaseName()}/documents/contractAuditLogs/assignee-cleanup-${planDigest.slice(0, 12)}-${item.contractId}`,
          fields: auditFields,
        },
        currentDocument: { exists: false },
      })
    }
    await requestJson(token, `${databaseBase()}/documents:commit`, { method: 'POST', body: JSON.stringify({ writes }) })
    applied += Math.min(40, plan.length - offset)
  }
  return applied
}

function summarize(plan) {
  const removedLinks = plan.flatMap((item) => item.removed)
  return {
    contracts: plan.length,
    removedUniqueAssignees: new Set(removedLinks.map((item) => item.id)).size,
    removedLinks: removedLinks.length,
    byReason: removedLinks.reduce((result, item) => {
      result[item.reason] = (result[item.reason] || 0) + 1
      return result
    }, {}),
  }
}

async function main() {
  const input = parseArguments(process.argv.slice(2))
  assertTarget(input)
  const token = await accessToken()
  const metadata = await requestJson(token, databaseBase())
  if (metadata.name !== `projects/${TARGET.projectId}/databases/${TARGET.databaseId}`) throw new Error('Live database guard failed.')
  const today = todayInHoChiMinh()
  const [contracts, trainers, students] = await Promise.all([
    collectionDocuments(token, 'contracts'),
    collectionDocuments(token, 'trainers'),
    collectionDocuments(token, 'students'),
  ])
  const plan = planFor(contracts, trainers, students, today)
  const planDigest = digest({ target: TARGET, today, plan })
  if (input.mode === 'apply' && input.digest !== planDigest) throw new Error('Live cleanup plan changed after dry run; run dry-run again.')
  const applied = input.mode === 'apply' ? await applyPlan(token, plan, planDigest) : 0
  const summary = summarize(plan)
  const report = {
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    target: TARGET,
    today,
    contractsScanned: contracts.length,
    plannedWrites: plan.length,
    applied,
    ...summary,
    planDigest,
    plan,
  }
  fs.mkdirSync(PRIVATE_DIRECTORY, { recursive: true })
  fs.writeFileSync(REPORTS[input.mode], `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ report: REPORTS[input.mode], contractsScanned: contracts.length, plannedWrites: plan.length, applied, ...summary, planDigest }, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`)
  process.exitCode = 1
})

