'use strict'

/**
 * One-time, source-read-only migration for the legacy student availability
 * profile into the target PT availability model.
 *
 * The retired project stores availability on students.availableSlots.  The
 * current project can preserve that snapshot as students.legacyDefaultAvailability
 * and continue to use it as the recurring fallback until the student submits a
 * weekly record.  We deliberately do not manufacture a weekly submission: the
 * old project has no weekId or submission timestamp to support that claim.
 * Existing target weekly records always win and are never overwritten.
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const SOURCE = Object.freeze({
  projectId: 'gen-lang-client-0246058381',
  databaseId: 'aura-fitness-db',
})
const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
})
const PLAN_VERSION = 'student-availability-legacy-v1'
const MAX_WRITES_PER_COMMIT = 450
const APPLY_CONFIRMATION = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}:apply-student-availability`
const PRIVATE_DIR = path.resolve('.migration-private')
const REPORTS = Object.freeze({
  'dry-run': path.join(PRIVATE_DIR, 'firebase-student-availability-migration-dry-run.json'),
  apply: path.join(PRIVATE_DIR, 'firebase-student-availability-migration-apply.json'),
  verify: path.join(PRIVATE_DIR, 'firebase-student-availability-migration-verify.json'),
})
const SLOT_PATTERN = /^(T[2-7]|CN)-(?:[0-9]|1[0-9]|2[0-3])$/

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function parseArguments(argv) {
  const result = { mode: 'dry-run' }
  for (const argument of argv) {
    if (argument.startsWith('--mode=')) result.mode = argument.slice('--mode='.length)
    else if (argument.startsWith('--project=')) result.projectId = argument.slice('--project='.length)
    else if (argument.startsWith('--database=')) result.databaseId = argument.slice('--database='.length)
    else if (argument.startsWith('--digest=')) result.digest = argument.slice('--digest='.length)
    else if (argument.startsWith('--confirm=')) result.confirmation = argument.slice('--confirm='.length)
    else if (argument === '--help' || argument === '-h') result.help = true
    else throw new Error(`Unknown argument: ${argument.split('=')[0]}`)
  }
  if (!['dry-run', 'apply', 'verify'].includes(result.mode)) throw new Error('Mode must be dry-run, apply, or verify.')
  return result
}

function assertTarget(args) {
  if (SOURCE.projectId === TARGET.projectId) throw new Error('Source and target projects must differ.')
  if (args.projectId && args.projectId !== TARGET.projectId) throw new Error('Project override is not the approved target.')
  if (args.databaseId && args.databaseId !== TARGET.databaseId) throw new Error('Database override is not the approved target database.')
  if (args.mode !== 'apply') return
  if (args.projectId !== TARGET.projectId || args.databaseId !== TARGET.databaseId) throw new Error('Apply requires explicit target project and database.')
  if (!/^[a-f0-9]{64}$/.test(args.digest || '')) throw new Error('Apply requires the latest dry-run digest.')
  if (args.confirmation !== APPLY_CONFIRMATION) throw new Error('Apply confirmation does not match the target guard.')
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

function databaseBase(config) {
  return `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${encodeURIComponent(config.databaseId)}`
}

function databaseResource(config) {
  return `projects/${config.projectId}/databases/${config.databaseId}`
}

async function requestJson(token, config, endpoint, options = {}) {
  const response = await fetch(`${databaseBase(config)}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const raw = await response.text()
  let body = null
  if (raw) {
    try { body = JSON.parse(raw) } catch { body = { raw: raw.slice(0, 800) } }
  }
  if (!response.ok) throw new Error(`Firestore request failed (${response.status}) at ${endpoint}: ${body?.error?.message || body?.raw || response.statusText}`)
  return body
}

function assertSourceReadOnly(config, endpoint, options = {}) {
  if (config.projectId !== SOURCE.projectId || config.databaseId !== SOURCE.databaseId) return
  const method = String(options.method || 'GET').toUpperCase()
  const readOnly = endpoint === '' || endpoint.startsWith('/documents:runQuery') || endpoint.startsWith('/documents:listCollectionIds')
  if (!readOnly || !['GET', 'POST'].includes(method) || /commit|batchWrite|delete|patch|write/i.test(endpoint)) {
    throw new Error(`Source read-only guard rejected ${method} ${endpoint}`)
  }
}

async function sourceRequest(token, endpoint, options = {}) {
  assertSourceReadOnly(SOURCE, endpoint, options)
  return requestJson(token, SOURCE, endpoint, options)
}

function decode(value = {}) {
  if ('nullValue' in value) return null
  if ('booleanValue' in value) return Boolean(value.booleanValue)
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('timestampValue' in value) return value.timestampValue
  if ('stringValue' in value) return value.stringValue
  if ('referenceValue' in value) return value.referenceValue
  if ('geoPointValue' in value) return value.geoPointValue
  if ('bytesValue' in value) return value.bytesValue
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode)
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {})
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

function encodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encode(value)]))
}

function documentFromRow(row, config, collection) {
  const prefix = `${databaseResource(config)}/documents/${collection}/`
  const name = row?.document?.name
  if (!name || !name.startsWith(prefix)) return null
  return {
    id: name.slice(prefix.length),
    fields: row.document.fields || {},
    data: decodeFields(row.document.fields || {}),
    updateTime: row.document.updateTime || null,
  }
}

async function readRootCollection(token, config, collection) {
  const rows = config.projectId === SOURCE.projectId && config.databaseId === SOURCE.databaseId
    ? await sourceRequest(token, '/documents:runQuery', {
      method: 'POST',
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }] } }),
    })
    : await requestJson(token, config, '/documents:runQuery', {
      method: 'POST',
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }] } }),
    })
  return (Array.isArray(rows) ? rows : [rows]).map((row) => documentFromRow(row, config, collection)).filter(Boolean)
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.startsWith('84') && digits.length >= 10 ? `0${digits.slice(2)}` : digits
}

function normalizeEmail(value) {
  return String(value || '').trim().toLocaleLowerCase('vi-VN')
}

function normalizeSlots(value) {
  return [...new Set(Array.isArray(value) ? value.filter((slot) => typeof slot === 'string' && SLOT_PATTERN.test(slot)) : [])].sort()
}

function rawSlots(value) {
  return Array.isArray(value) ? value.filter((slot) => typeof slot === 'string') : []
}

function sameSlots(left, right) {
  return JSON.stringify(normalizeSlots(left)) === JSON.stringify(normalizeSlots(right))
}

function resolveTarget(sourceStudent, targetById, targetByEmail, targetByPhone) {
  if (targetById.has(sourceStudent.id)) return { student: targetById.get(sourceStudent.id), strategy: 'id' }
  const emailMatches = targetByEmail.get(normalizeEmail(sourceStudent.data.email)) || []
  if (emailMatches.length === 1) return { student: emailMatches[0], strategy: 'email' }
  const phoneMatches = targetByPhone.get(normalizePhone(sourceStudent.data.phone)) || []
  if (phoneMatches.length === 1) return { student: phoneMatches[0], strategy: 'phone' }
  return { student: null, strategy: emailMatches.length || phoneMatches.length ? 'ambiguous' : 'missing' }
}

function buildPlan({ sourceStudents, targetStudents, targetAvailability }) {
  const targetById = new Map(targetStudents.map((item) => [item.id, item]))
  const targetByEmail = new Map()
  const targetByPhone = new Map()
  for (const student of targetStudents) {
    const email = normalizeEmail(student.data.email)
    const phone = normalizePhone(student.data.phone)
    if (email) targetByEmail.set(email, [...(targetByEmail.get(email) || []), student])
    if (phone) targetByPhone.set(phone, [...(targetByPhone.get(phone) || []), student])
  }
  const weeklyByStudent = new Set(targetAvailability.map((item) => String(item.data.studentId || '').trim()).filter(Boolean))
  const writes = []
  const quarantine = []
  const counters = {
    sourceStudents: sourceStudents.length,
    targetStudents: targetStudents.length,
    sourceWithSlots: 0,
    matchedById: 0,
    matchedByContact: 0,
    alreadyApplied: 0,
    skippedWeeklyPrecedence: 0,
    eligibleWrites: 0,
    quarantined: 0,
  }

  for (const sourceStudent of sourceStudents) {
    const sourceRawSlots = rawSlots(sourceStudent.data.availableSlots)
    if (!sourceRawSlots.length) continue
    counters.sourceWithSlots += 1
    if (sourceRawSlots.some((slot) => !SLOT_PATTERN.test(slot))) {
      quarantine.push({ sourceStudent, reason: 'invalid_slot_format', fields: ['availableSlots'] })
      continue
    }
    const resolved = resolveTarget(sourceStudent, targetById, targetByEmail, targetByPhone)
    if (!resolved.student) {
      quarantine.push({ sourceStudent, reason: resolved.strategy === 'ambiguous' ? 'ambiguous_target_identity' : 'missing_target_student', fields: ['studentId', 'email', 'phone'] })
      continue
    }
    if (resolved.strategy === 'id') counters.matchedById += 1
    else counters.matchedByContact += 1
    const targetStudent = resolved.student
    if (!sameSlots(sourceRawSlots, targetStudent.data.availableSlots)) {
      quarantine.push({ sourceStudent, targetStudent, reason: 'target_available_slots_conflict', fields: ['availableSlots'] })
      continue
    }
    const existingLegacy = targetStudent.data.legacyDefaultAvailability
    if (existingLegacy && typeof existingLegacy === 'object') {
      if (sameSlots(sourceRawSlots, existingLegacy.slots) && Boolean(sourceStudent.data.isScheduleConfirmed) === (existingLegacy.confirmed === true)) counters.alreadyApplied += 1
      else quarantine.push({ sourceStudent, targetStudent, reason: 'target_legacy_availability_conflict', fields: ['legacyDefaultAvailability'] })
      continue
    }
    const hasLatestProjection = targetStudent.data.latestSubmittedAvailability && typeof targetStudent.data.latestSubmittedAvailability === 'object'
    if (hasLatestProjection || weeklyByStudent.has(targetStudent.id)) {
      counters.skippedWeeklyPrecedence += 1
      continue
    }
    const requiredSessions = Math.max(1, Number(sourceStudent.data.sessionsPerWeek || targetStudent.data.sessionsPerWeek || 1))
    const legacyDefaultAvailability = {
      slots: normalizeSlots(sourceRawSlots),
      confirmed: sourceStudent.data.isScheduleConfirmed === true,
      minimumSlots: Math.max(5, Number(sourceStudent.data.minimumAvailabilitySlots || targetStudent.data.minimumAvailabilitySlots || 5)),
      requiredSessions,
      source: 'legacy_source_migration_v1',
    }
    writes.push({
      targetStudent,
      sourceStudent,
      legacyDefaultAvailability,
      reason: resolved.strategy === 'id' ? 'legacy_profile_snapshot' : 'legacy_profile_snapshot_identity_remap',
    })
  }
  counters.eligibleWrites = writes.length
  counters.quarantined = quarantine.length
  const publicWrites = writes.map((item) => ({
    pathHash: sha256(`students/${item.targetStudent.id}`),
    sourcePathHash: sha256(`students/${item.sourceStudent.id}`),
    targetUpdateTime: item.targetStudent.updateTime,
    fieldsHash: sha256(item.legacyDefaultAvailability),
    reason: item.reason,
  }))
  const publicQuarantine = quarantine.map((item) => ({
    sourcePathHash: sha256(`students/${item.sourceStudent.id}`),
    targetPathHash: item.targetStudent ? sha256(`students/${item.targetStudent.id}`) : null,
    reason: item.reason,
    fields: item.fields,
  }))
  const planDigest = sha256({ planVersion: PLAN_VERSION, source: SOURCE, target: TARGET, publicWrites, publicQuarantine })
  return { writes, quarantine, counters, planDigest, publicWrites, publicQuarantine }
}

function studentWrite(item) {
  return {
    update: {
      name: `${databaseResource(TARGET)}/documents/students/${item.targetStudent.id}`,
      fields: encodeFields({ legacyDefaultAvailability: item.legacyDefaultAvailability }),
    },
    updateMask: { fieldPaths: ['legacyDefaultAvailability'] },
    currentDocument: { updateTime: item.targetStudent.updateTime },
  }
}

async function applyWrites(token, writes) {
  let applied = 0
  for (let index = 0; index < writes.length; index += MAX_WRITES_PER_COMMIT) {
    const batch = writes.slice(index, index + MAX_WRITES_PER_COMMIT)
    await requestJson(token, TARGET, '/documents:commit', {
      method: 'POST',
      body: JSON.stringify({ writes: batch.map(studentWrite) }),
    })
    applied += batch.length
  }
  return applied
}

function saveReport(mode, report) {
  fs.mkdirSync(PRIVATE_DIR, { recursive: true })
  const destination = REPORTS[mode]
  const temporary = `${destination}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, destination)
  return destination
}

function publicReport(mode, plan, extra = {}) {
  return {
    planVersion: PLAN_VERSION,
    mode,
    source: SOURCE,
    target: TARGET,
    sourceReadOnly: true,
    sourceMutationCount: 0,
    targetDeleteCount: 0,
    materialization: 'students.legacyDefaultAvailability',
    planDigest: plan.planDigest,
    summary: plan.counters,
    writes: plan.publicWrites,
    quarantine: plan.publicQuarantine,
    generatedAt: new Date().toISOString(),
    writesPerformed: false,
    ...extra,
  }
}

async function livePlan(token) {
  const [sourceStudents, targetStudents, targetAvailability] = await Promise.all([
    readRootCollection(token, SOURCE, 'students'),
    readRootCollection(token, TARGET, 'students'),
    readRootCollection(token, TARGET, 'ptAvailability'),
  ])
  return buildPlan({ sourceStudents, targetStudents, targetAvailability })
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  if (args.help) {
    console.log([
      'Legacy student availability migration (source is always read-only).',
      'Dry run: node scripts/firebase-student-availability-migration.cjs --mode=dry-run',
      `Apply: node scripts/firebase-student-availability-migration.cjs --mode=apply --project=${TARGET.projectId} --database=${TARGET.databaseId} --digest=<DIGEST> --confirm=${APPLY_CONFIRMATION}`,
      'Verify: node scripts/firebase-student-availability-migration.cjs --mode=verify',
    ].join('\n'))
    return
  }
  assertTarget(args)
  const token = await accessToken()
  const sourceMetadata = await sourceRequest(token, '')
  const targetMetadata = await requestJson(token, TARGET, '')
  if (sourceMetadata?.name !== databaseResource(SOURCE)) throw new Error('Source database metadata mismatch.')
  if (targetMetadata?.name !== databaseResource(TARGET)) throw new Error('Target database metadata mismatch.')
  const plan = await livePlan(token)
  if (args.mode === 'dry-run') {
    const reportPath = saveReport('dry-run', publicReport('dry-run', plan))
    console.log(JSON.stringify({ mode: 'dry-run', planDigest: plan.planDigest, ...plan.counters, reportPath }, null, 2))
    return
  }
  if (args.mode === 'apply') {
    if (!fs.existsSync(REPORTS['dry-run'])) throw new Error('Latest dry-run report is missing.')
    const approved = JSON.parse(fs.readFileSync(REPORTS['dry-run'], 'utf8'))
    if (approved.planDigest !== args.digest || plan.planDigest !== args.digest) throw new Error('Live plan differs from the approved dry-run digest.')
    const applied = await applyWrites(token, plan.writes)
    const after = await livePlan(token)
    const verified = after.writes.length === 0 && after.quarantine.length === 0
    const reportPath = saveReport('apply', publicReport('apply', after, { approvedDigest: args.digest, applied, verified, writesPerformed: true }))
    console.log(JSON.stringify({ mode: 'apply', applied, verified, reportPath, ...after.counters }, null, 2))
    if (!verified) process.exitCode = 2
    return
  }
  const verified = plan.writes.length === 0 && plan.quarantine.length === 0
  const reportPath = saveReport('verify', publicReport('verify', plan, { verified }))
  console.log(JSON.stringify({ mode: 'verify', verified, reportPath, ...plan.counters }, null, 2))
  if (!verified) process.exitCode = 2
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Student availability migration failed.')
  process.exitCode = 1
})
