'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const PLAN_VERSION = 'pt-schedule-v2-migration-v1'
const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
})
const CONFIRMATION = 'APPLY_PT_SCHEDULE_V2'
const PRIVATE_DIR = path.resolve('.migration-private')
const REPORT_PATH = (mode) => path.join(PRIVATE_DIR, `firebase-pt-schedule-v2-${mode}.json`)
const MAX_BATCH = 250

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

function argumentsFrom(argv) {
  const result = { mode: 'dry-run' }
  for (const argument of argv) {
    if (argument.startsWith('--mode=')) result.mode = argument.slice(7)
    else if (argument.startsWith('--project=')) result.projectId = argument.slice(10)
    else if (argument.startsWith('--database=')) result.databaseId = argument.slice(11)
    else if (argument.startsWith('--digest=')) result.digest = argument.slice(9)
    else if (argument.startsWith('--confirm=')) result.confirm = argument.slice(10)
    else if (argument === '--help' || argument === '-h') result.help = true
    else throw new Error(`Unknown argument: ${argument.split('=')[0]}`)
  }
  if (!['dry-run', 'apply', 'verify'].includes(result.mode)) throw new Error('Mode must be dry-run, apply, or verify.')
  return result
}

function assertTarget(args) {
  if (args.projectId && args.projectId !== TARGET.projectId) throw new Error('Project override is not the approved target.')
  if (args.databaseId && args.databaseId !== TARGET.databaseId) throw new Error('Database override is not the approved named database.')
  if (args.mode === 'apply') {
    if (args.projectId !== TARGET.projectId || args.databaseId !== TARGET.databaseId) throw new Error('Apply requires explicit target project and database.')
    if (!/^[a-f0-9]{64}$/.test(args.digest || '')) throw new Error('Apply requires the latest dry-run digest.')
    if (args.confirm !== CONFIRMATION) throw new Error('Apply confirmation is missing or incorrect.')
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

function baseUrl() {
  return `https://firestore.googleapis.com/v1/projects/${TARGET.projectId}/databases/${encodeURIComponent(TARGET.databaseId)}`
}

async function requestJson(token, endpoint, options = {}) {
  const response = await fetch(`${baseUrl()}${endpoint}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const raw = await response.text()
  if (!response.ok) throw new Error(`Firestore request failed (${response.status}) at ${endpoint.split('?')[0]}.`)
  return raw ? JSON.parse(raw) : null
}

async function assertLiveTarget(token) {
  const metadata = await requestJson(token, '')
  if (metadata?.name !== `projects/${TARGET.projectId}/databases/${TARGET.databaseId}`) throw new Error('Live database is not the approved target.')
}

function decode(value = {}) {
  if ('nullValue' in value) return null
  if ('booleanValue' in value) return Boolean(value.booleanValue)
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('timestampValue' in value) return value.timestampValue
  if ('stringValue' in value) return value.stringValue
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map(decode)
  if ('mapValue' in value) return decodeFields(value.mapValue?.fields || {})
  return undefined
}

function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decode(value)]))
}

function encode(value) {
  if (value === null || value === undefined) return { nullValue: null }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (typeof value === 'string') return { stringValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } }
  if (value && typeof value === 'object') return { mapValue: { fields: encodeFields(value) } }
  throw new Error('Unsupported Firestore value.')
}

function encodeFields(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]))
}

async function collection(token, collectionId) {
  const rows = await requestJson(token, '/documents:runQuery', {
    method: 'POST',
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId }], orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }] } }),
  })
  const prefix = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}/documents/${collectionId}/`
  return (Array.isArray(rows) ? rows : [rows]).filter((row) => row?.document?.name?.startsWith(prefix)).map((row) => ({
    id: row.document.name.slice(prefix.length),
    data: decodeFields(row.document.fields || {}),
    updateTime: row.document.updateTime,
  }))
}

function mondayInSaigon() {
  const shifted = new Date(Date.now() + 7 * 60 * 60 * 1000)
  const day = shifted.getUTCDay()
  const distance = day === 0 ? 6 : day - 1
  shifted.setUTCDate(shifted.getUTCDate() - distance)
  return shifted.toISOString().slice(0, 10)
}

function safeDocumentId(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  return /^[A-Za-z0-9_-]+$/.test(result) ? result : ''
}

function normalizeEntry(entry, branchId) {
  const trainerId = safeDocumentId(entry?.trainerId)
  const off = entry?.type === 'off' || entry?.studentId === 'OFF'
  const studentId = off ? 'OFF' : safeDocumentId(entry?.studentId)
  if (!trainerId || !studentId) return null
  return {
    studentId,
    trainerId,
    branchId,
    type: off ? 'off' : 'training',
    ...(entry?.isLocked === true ? { isLocked: true } : {}),
    ...(entry?.contractId ? { contractId: safeDocumentId(entry.contractId) } : {}),
    source: 'legacy_migration_v1',
  }
}

function buildPlan(state) {
  const trainerBranch = new Map(state.trainers.map((item) => [item.id, safeDocumentId(item.data.branchId)]))
  const studentBranch = new Map(state.students.map((item) => [item.id, safeDocumentId(item.data.branchId)]))
  const activeBranches = state.branches.filter((item) => item.data.status !== 'archived').map((item) => item.id)
  const existingDraftIds = new Set(state.drafts.map((item) => item.id))
  const writes = []
  const trainerModes = { configured: 0, unrestricted: 0, unconfigured: 0, alreadyExplicit: 0 }

  for (const trainer of state.trainers) {
    const current = trainer.data.availabilityMode
    if (current === 'configured' || current === 'unrestricted' || current === 'unconfigured') {
      trainerModes.alreadyExplicit += 1
      continue
    }
    const mode = Array.isArray(trainer.data.availableSlots) && trainer.data.availableSlots.length ? 'configured' : 'unconfigured'
    trainerModes[mode] += 1
    writes.push({ kind: 'trainer', id: trainer.id, updateTime: trainer.updateTime, mode })
  }

  const weekFloor = mondayInSaigon()
  let skippedExistingDrafts = 0
  let migratedDrafts = 0
  for (const legacy of state.schedules) {
    const match = /^schedule_(\d{4}-\d{2}-\d{2})$/.exec(legacy.id)
    if (!match || match[1] < weekFloor) continue
    const weekId = match[1]
    for (const branchId of activeBranches) {
      const id = `${branchId}_${weekId}`
      if (existingDraftIds.has(id)) {
        skippedExistingDrafts += 1
        continue
      }
      const schedule = {}
      for (const [slotId, entries] of Object.entries(legacy.data.schedule || {})) {
        if (!/^(T[2-7]|CN)-(?:[0-9]|1[0-9]|2[0-3])$/.test(slotId) || !Array.isArray(entries)) continue
        const scoped = entries.map((entry) => {
          const resolvedBranch = safeDocumentId(entry?.branchId) || studentBranch.get(entry?.studentId) || trainerBranch.get(entry?.trainerId)
          return resolvedBranch === branchId ? normalizeEntry(entry, branchId) : null
        }).filter(Boolean)
        if (scoped.length) schedule[slotId] = scoped
      }
      writes.push({
        kind: 'draft',
        id,
        data: {
          schemaVersion: 2,
          branchId,
          weekId,
          schedule,
          revision: Number(legacy.data.draftRevision || 0),
          status: legacy.data.publishStatusByBranch?.[branchId] || 'draft',
          publishedVersion: Number(legacy.data.publishedVersions?.[branchId] || 0),
          publishedRevision: Number(legacy.data.publishedRevisions?.[branchId] ?? -1),
          migratedFrom: `schedules/${legacy.id}`,
        },
      })
      migratedDrafts += 1
    }
  }

  const publicPlan = writes.map((item) => ({
    kind: item.kind,
    idHash: sha256(`${PLAN_VERSION}:${item.kind}:${item.id}`),
    preconditionHash: sha256(item.updateTime || 'must-not-exist'),
    mode: item.mode || null,
    dataHash: item.data ? sha256(canonicalJson(item.data)) : null,
  }))
  return {
    writes,
    digest: sha256(canonicalJson({ target: TARGET, planVersion: PLAN_VERSION, publicPlan })),
    summary: { trainerModes, migratedDrafts, skippedExistingDrafts, writes: writes.length, weekFloor },
  }
}

async function livePlan(token) {
  const [trainers, students, branches, schedules, drafts] = await Promise.all([
    collection(token, 'trainers'),
    collection(token, 'students'),
    collection(token, 'branches'),
    collection(token, 'schedules'),
    collection(token, 'ptScheduleDrafts'),
  ])
  const state = { trainers, students, branches, schedules, drafts }
  return { state, plan: buildPlan(state) }
}

function trainerWrite(item) {
  return {
    update: {
      name: `projects/${TARGET.projectId}/databases/${TARGET.databaseId}/documents/trainers/${item.id}`,
      fields: encodeFields({ availabilityMode: item.mode, availabilityRevision: 1, availabilityMigrationVersion: PLAN_VERSION }),
    },
    updateMask: { fieldPaths: ['availabilityMode', 'availabilityRevision', 'availabilityMigrationVersion'] },
    updateTransforms: [{ fieldPath: 'availabilityMigratedAt', setToServerValue: 'REQUEST_TIME' }],
    currentDocument: { updateTime: item.updateTime },
  }
}

function draftWrite(item) {
  return {
    update: {
      name: `projects/${TARGET.projectId}/databases/${TARGET.databaseId}/documents/ptScheduleDrafts/${item.id}`,
      fields: encodeFields(item.data),
    },
    updateTransforms: [
      { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
      { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
    ],
    currentDocument: { exists: false },
  }
}

async function applyWrites(token, writes) {
  let applied = 0
  for (let index = 0; index < writes.length; index += MAX_BATCH) {
    const batch = writes.slice(index, index + MAX_BATCH)
    await requestJson(token, '/documents:commit', {
      method: 'POST',
      body: JSON.stringify({ writes: batch.map((item) => item.kind === 'trainer' ? trainerWrite(item) : draftWrite(item)) }),
    })
    applied += batch.length
  }
  return applied
}

function report(mode, live, extra = {}) {
  return {
    generatedAt: new Date().toISOString(),
    mode,
    target: TARGET,
    planVersion: PLAN_VERSION,
    planDigest: live.plan.digest,
    inventory: Object.fromEntries(Object.entries(live.state).map(([key, values]) => [key, values.length])),
    summary: live.plan.summary,
    writesPerformed: mode === 'apply',
    sourceProjectAccessed: false,
    preservedCollections: ['sessions', 'contracts', 'payments', 'ledgerEntries'],
    piiPolicy: 'Reports contain aggregate counts and SHA-256 digests only.',
    ...extra,
  }
}

function saveReport(mode, value) {
  fs.mkdirSync(PRIVATE_DIR, { recursive: true })
  const destination = REPORT_PATH(mode)
  const temporary = `${destination}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, destination)
  return destination
}

async function main() {
  const args = argumentsFrom(process.argv.slice(2))
  if (args.help) {
    console.log(`Dry run: node scripts/firebase-pt-schedule-v2-migration.cjs\nApply: node scripts/firebase-pt-schedule-v2-migration.cjs --mode=apply --project=${TARGET.projectId} --database=${TARGET.databaseId} --digest=<DIGEST> --confirm=${CONFIRMATION}\nVerify: node scripts/firebase-pt-schedule-v2-migration.cjs --mode=verify`)
    return
  }
  assertTarget(args)
  const token = await accessToken()
  await assertLiveTarget(token)
  const before = await livePlan(token)
  if (args.mode === 'dry-run') {
    const destination = saveReport('dry-run', report('dry-run', before))
    console.log(JSON.stringify({ mode: 'dry-run', target: TARGET, digest: before.plan.digest, ...before.plan.summary, report: destination }, null, 2))
    return
  }
  if (args.mode === 'apply') {
    const saved = JSON.parse(fs.readFileSync(REPORT_PATH('dry-run'), 'utf8'))
    if (saved.planDigest !== args.digest || before.plan.digest !== args.digest) throw new Error('Live plan differs from the approved dry-run digest.')
    const applied = await applyWrites(token, before.plan.writes)
    const after = await livePlan(token)
    const verified = after.plan.writes.length === 0
    const destination = saveReport('apply', report('apply', after, { approvedDigest: args.digest, applied, verified }))
    console.log(JSON.stringify({ mode: 'apply', applied, verified, report: destination }, null, 2))
    if (!verified) process.exitCode = 2
    return
  }
  const verified = before.plan.writes.length === 0
  const destination = saveReport('verify', report('verify', before, { verified }))
  console.log(JSON.stringify({ mode: 'verify', verified, pendingWrites: before.plan.writes.length, report: destination }, null, 2))
  if (!verified) process.exitCode = 2
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'PT schedule migration failed.')
  process.exitCode = 1
})
