'use strict'

/**
 * Incremental, target-only copy from the retired Aura Firestore project.
 *
 * Safety contract:
 * - SOURCE is read through a deliberately read-only request wrapper.  The
 *   wrapper accepts only database metadata reads and collection-group queries;
 *   a source commit/batchWrite/delete is rejected before a network request.
 * - SOURCE deletions are never propagated.
 * - TARGET writes are digest-gated, optimistic-concurrency checked and
 *   idempotent.  A changed target document is never silently overwritten.
 * - Reports contain hashes and field names, not profile names, phone numbers,
 *   email addresses or document contents.
 *
 * The previous production merge finished at the source PITR watermark
 * 2026-09-13T09:11:00Z.  A local state file advances that watermark only after
 * every target batch has committed successfully.  It is ignored by git.
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
const RETIRED_SOURCE_PROJECT = SOURCE.projectId
const PLAN_VERSION = 'live-source-delta-v1'
const DEFAULT_CHECKPOINT = '2026-09-13T09:11:00.000Z'
const MAX_WRITES_PER_COMMIT = 450
const APPLY_CONFIRMATION = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}:apply-live-source-delta`
const PRIVATE_DIR = path.resolve('.migration-private')
const STATE_PATH = path.join(PRIVATE_DIR, 'firebase-live-source-sync-state.json')
const REPORTS = Object.freeze({
  'dry-run': path.join(PRIVATE_DIR, 'firebase-live-source-sync-dry-run.json'),
  apply: path.join(PRIVATE_DIR, 'firebase-live-source-sync-apply.json'),
  verify: path.join(PRIVATE_DIR, 'firebase-live-source-sync-verify.json'),
})

// Root collections from the retired project plus collection groups used by the
// newer PT/schedule model.  Empty groups are harmless and make the next run
// pick up a newly introduced schedule subcollection without a code change.
const COLLECTION_GROUPS = Object.freeze([
  'branches',
  'contracts',
  'dailyCheckins',
  'healthyDishes',
  'leaveRequests',
  'mealPlans',
  'packages',
  'payments',
  'progress_photos',
  'schedules',
  'scheduleEvents',
  'sessionRequests',
  'sessions',
  'settings',
  'staff',
  'students',
  'trainers',
  'users',
  'workoutLogs',
])

const PRIVILEGED_ROLES = new Set(['admin', 'super_admin'])
const ACTIVE_SESSION_STATUSES = new Set(['scheduled', 'rescheduled'])
const CONTRACT_STATUSES = new Set(['active', 'expired', 'frozen', 'future', 'completed', 'cancelled'])

// These fields are produced by the target's canonical projections, billing,
// identity link and schedule command flows.  They are never imported from the
// old app, including when a source document is created for the first time.
const TARGET_OWNED_FIELDS = Object.freeze({
  contracts: new Set([
    'activatedAt', 'activatedBy', 'attendedClasses', 'carriedOverSessions', 'carryOverPending',
    'carryOverProjectedFrom', 'carryOverProjectionUpdatedAt', 'carryOverProjectionVersion',
    'carryOverReconciledAt', 'carryOverReconciledFrom', 'carryOverReconciliationVersion',
    'carryOverRequested', 'carryOverTransferredAt', 'carryOverTransferredSessions',
    'chargedSessionIds', 'financeProjectionUpdatedAt', 'historyEvidenceSessions', 'packageSessions',
    'plannedCarryOverSessions', 'renewalContinuityReconciledAt', 'renewalSupersededBy',
    'renewedByContractId', 'revision', 'sourceContractId', 'updatedAt', 'usageReconciledAt',
    'usageReconciledFrom', 'usageReconciliationStatus', 'usageReconciliationVersion', 'usedSessions',
    'usageProjectionUpdatedAt', 'usageProjectionVersion',
  ]),
  sessions: new Set([
    'attendanceEventId', 'attendanceStatus', 'autoConfirmedAt', 'billingEventId', 'billingIssueCode',
    'billingStatus', 'chargedAt', 'completedAt', 'confirmationSource', 'confirmedAt', 'confirmedBy',
    'contractId', 'contractLinkConfidence', 'contractLinkGapDays', 'contractLinkReason',
    'contractLinkVersion', 'contractLinkedAt', 'contractLinkedBy', 'recognitionReviewIssueCode',
    'recognitionReviewRequired', 'revenueRecognitionEntryId', 'revision', 'scheduleStatus',
    'serviceOrdinal', 'updatedAt', 'updatedBy', 'schemaVersion',
  ]),
  schedules: new Set(['draftRevision', 'updatedAt', 'updatedBy']),
  students: new Set([
    'accountUid', 'availabilityRevision', 'availabilityUpdatedAt', 'availabilityUpdatedBy',
    'contactSyncVersion', 'contactSyncedAt', 'createdAt', 'scheduleNeedsReview', 'updatedAt',
    'identityLinkStatus', 'identityLinkVersion', 'identityLinkedAt', 'identityLinkedBy',
    'identityLinkSource',
  ]),
  trainers: new Set([
    'availableSlots', 'availabilityRevision', 'availabilityUpdatedAt', 'availabilityUpdatedBy',
    'baseSalary', 'bonusMonthly', 'commissionPerSession', 'commissionRate', 'createdAt',
    'dailySessionLimit', 'dailySessionTarget', 'employmentLevel', 'employmentType', 'payrollPolicyId',
    'payrollProfile', 'schedulingPriority', 'slotCapacity', 'updatedAt', 'updatedBy',
    'availabilityMode', 'availabilityMigrationVersion', 'availabilityMigratedAt',
  ]),
  staff: new Set([
    'availableSlots', 'baseSalary', 'bonusMonthly', 'branchIds', 'commissionPerSession',
    'commissionRate', 'createdAt', 'createdBy', 'dailySessionLimit', 'dailySessionTarget',
    'employmentLevel', 'employmentType', 'payrollPolicyId', 'payrollProfile', 'positions',
    'schedulingPriority', 'slotCapacity', 'updatedAt', 'updatedBy',
  ]),
  users: new Set([
    'accessRole', 'authzVersion', 'branchId', 'contactSyncVersion', 'contactSyncedAt', 'crmProfileId',
    'displayName', 'email', 'employeeCode', 'identityLinkVersion', 'phone', 'phoneNumber', 'role',
    'uid', 'updatedAt', 'createdAt', 'disabled',
  ]),
})

// Explicit source-owned fields prevent a profile/nutrition import from
// replacing target role claims or a generated availability revision.  Generic
// collections remain copy-compatible and are filtered only by the ownership
// sets above.
const SOURCE_FIELDS = Object.freeze({
  schedules: new Set(['schedule', 'warnings', 'overriddenSessions']),
  sessions: new Set(['id', 'branchId', 'trainerId', 'hour', 'scheduleEntryId', 'status', 'studentId', 'date', 'verifiedByStudent']),
  students: new Set(['id', 'name', 'email', 'phone', 'dob', 'joinDate', 'branchId', 'sessionsPerWeek', 'availableSlots', 'isScheduleConfirmed', 'status', 'nutritionNote']),
  users: new Set([
    'name', 'current_mode', 'height', 'weight', 'age', 'goal', 'tdee', 'lifestyle', 'workouts_per_week',
    'eat_out_often', 'track_cycle', 'budget', 'target_macros', 'disliked_foods', 'eaten_meals',
    'history', 'healthConditions', 'goals', 'sleepHours', 'biologicalSex', 'activityLevel',
    'sleepQuality', 'nutritionProfile', 'dietType', 'stressLevel', 'membership', 'mealReminderTime',
    'employeeCode', 'branchId',
  ]),
  trainers: new Set(['id', 'name', 'email', 'phone', 'employeeCode', 'branchId', 'status', 'priority', 'role', 'commissionRate', 'commissionPerSession']),
  staff: new Set(['id', 'name', 'email', 'phone', 'branchId', 'status', 'role']),
})

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((output, key) => {
      output[key] = canonical(value[key])
      return output
    }, {})
  }
  return value
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value))
}

function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex')
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
    else if (argument.startsWith('--since=')) result.since = argument.slice('--since='.length)
    else throw new Error(`Unknown argument: ${argument.split('=')[0]}`)
  }
  if (!['dry-run', 'apply', 'verify'].includes(result.mode)) throw new Error('Mode must be dry-run, apply, or verify.')
  return result
}

function usage() {
  return [
    'Incremental Firestore source sync (source is structurally read-only)',
    '',
    'Dry run:',
    '  node scripts/firebase-firestore-live-source-sync.cjs --mode=dry-run',
    '',
    'Apply (digest and target-only confirmation are required):',
    `  node scripts/firebase-firestore-live-source-sync.cjs --mode=apply --project=${TARGET.projectId} --database=${TARGET.databaseId} --digest=<DRY_RUN_DIGEST> --confirm=${APPLY_CONFIRMATION}`,
    '',
    'Verify:',
    '  node scripts/firebase-firestore-live-source-sync.cjs --mode=verify',
    '',
    'Override the local checkpoint for a controlled backfill:',
    '  --since=2026-09-13T09:11:00.000Z',
  ].join('\n')
}

function assertDifferentProjects() {
  if (SOURCE.projectId === TARGET.projectId) throw new Error('Target points to the retired source project.')
  if (TARGET.projectId === RETIRED_SOURCE_PROJECT) throw new Error('Target points to the retired source project.')
  if (SOURCE.databaseId === TARGET.databaseId && SOURCE.projectId === TARGET.projectId) {
    throw new Error('Source and target database are identical.')
  }
}

function assertApplyGuards(arguments_) {
  assertDifferentProjects()
  if (arguments_.mode !== 'apply') return
  if (arguments_.projectId !== TARGET.projectId || arguments_.databaseId !== TARGET.databaseId) {
    throw new Error('Apply requires the exact production target project and named database.')
  }
  if (!/^[a-f0-9]{64}$/.test(arguments_.digest || '')) throw new Error('Apply requires the latest dry-run digest.')
  if (arguments_.confirmation !== APPLY_CONFIRMATION) throw new Error('Apply confirmation does not match the target-only guard.')
}

function firebaseCliAuth() {
  if (!process.env.APPDATA) throw new Error('APPDATA is unavailable.')
  const cliLib = path.join(process.env.APPDATA, 'npm', 'node_modules', 'firebase-tools', 'lib')
  const auth = require(path.join(cliLib, 'auth.js'))
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

function databaseResource(config) {
  return `projects/${config.projectId}/databases/${config.databaseId}`
}

function databaseBase(config) {
  return `https://firestore.googleapis.com/v1/${databaseResource(config)}`
}

function documentName(config, relativePath) {
  return `${databaseResource(config)}/documents/${relativePath}`
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
  if (!response.ok) {
    throw new Error(`Firestore request failed (${response.status}) at ${endpoint.split('?')[0]}: ${body?.error?.message || body?.raw || response.statusText}`)
  }
  return body
}

function assertReadOnlySourceRequest(config, endpoint, options = {}) {
  if (config.projectId !== SOURCE.projectId || config.databaseId !== SOURCE.databaseId) return
  const method = String(options.method || 'GET').toUpperCase()
  const readEndpoint = endpoint === ''
    || endpoint.startsWith('/documents:runQuery')
    || endpoint.startsWith('/documents:listCollectionIds')
  if (!readEndpoint || !['GET', 'POST'].includes(method)) {
    throw new Error(`Source read-only guard rejected ${method} ${endpoint}`)
  }
  if (/commit|batchWrite|delete|patch|write/i.test(endpoint)) {
    throw new Error(`Source read-only guard rejected mutating endpoint ${endpoint}`)
  }
}

async function sourceRequest(token, endpoint, options = {}) {
  assertReadOnlySourceRequest(SOURCE, endpoint, options)
  return requestJson(token, SOURCE, endpoint, options)
}

async function assertDatabase(token, config) {
  const metadata = config.projectId === SOURCE.projectId && config.databaseId === SOURCE.databaseId
    ? await sourceRequest(token, '')
    : await requestJson(token, config, '')
  if (metadata?.name !== databaseResource(config)) throw new Error(`Database metadata mismatch for ${config.projectId}/${config.databaseId}.`)
  return metadata
}

async function readCollectionGroup(token, config, collectionId) {
  const request = {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId, allDescendants: true }],
        orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      },
    }),
  }
  const rows = config.projectId === SOURCE.projectId && config.databaseId === SOURCE.databaseId
    ? await sourceRequest(token, '/documents:runQuery', request)
    : await requestJson(token, config, '/documents:runQuery', request)
  const prefix = `${databaseResource(config)}/documents/`
  const documents = new Map()
  for (const row of Array.isArray(rows) ? rows : [rows]) {
    const name = row?.document?.name
    if (!name || !name.startsWith(prefix)) continue
    const relativePath = name.slice(prefix.length)
    documents.set(relativePath, {
      path: relativePath,
      collectionId,
      fields: row.document.fields || {},
      updateTime: row.document.updateTime || null,
      fingerprint: sha256(row.document.fields || {}),
    })
  }
  return documents
}

function readState() {
  if (!fs.existsSync(STATE_PATH)) return null
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) } catch { return null }
}

function validIso(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function resolveCheckpoint(arguments_) {
  const state = readState()
  const candidate = arguments_.since || state?.lastSuccessfulSourceUpdateTime || DEFAULT_CHECKPOINT
  if (!validIso(candidate)) throw new Error(`Invalid checkpoint: ${candidate}`)
  return new Date(candidate).toISOString()
}

function updateTimeAfter(value, checkpoint) {
  return Boolean(value && Date.parse(value) > Date.parse(checkpoint))
}

function maxUpdateTime(documents, current) {
  let result = current
  for (const document of documents.values()) {
    if (document.updateTime && (!result || Date.parse(document.updateTime) > Date.parse(result))) result = document.updateTime
  }
  return result
}

function decodeValue(value) {
  if (!value || typeof value !== 'object') return undefined
  if ('nullValue' in value) return null
  if ('booleanValue' in value) return Boolean(value.booleanValue)
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('timestampValue' in value) return value.timestampValue
  if ('stringValue' in value) return value.stringValue
  if ('referenceValue' in value) return value.referenceValue
  if ('geoPointValue' in value) return value.geoPointValue
  if ('bytesValue' in value) return value.bytesValue
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue)
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {})
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
  throw new Error('Unsupported Firestore value in migration plan.')
}

function encodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encodeValue(value)]))
}

function rewriteReferences(value) {
  if (Array.isArray(value)) return value.map(rewriteReferences)
  if (!value || typeof value !== 'object') return value
  const output = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === 'referenceValue' && typeof child === 'string') {
      output[key] = child.replace(
        `${databaseResource(SOURCE)}/documents/`,
        `${databaseResource(TARGET)}/documents/`,
      )
    } else output[key] = rewriteReferences(child)
  }
  return output
}

function valueAt(fields, name) {
  return Object.prototype.hasOwnProperty.call(fields || {}, name) ? canonical(fields[name]) : '__MISSING__'
}

function changedFields(sourceFields, targetFields, names) {
  return names.filter((name) => JSON.stringify(valueAt(sourceFields, name)) !== JSON.stringify(valueAt(targetFields, name)))
}

function scalar(fields, name) {
  const value = decodeValue(fields?.[name])
  return value === null || value === undefined ? '' : String(value).trim()
}

function normalizedText(value) {
  return String(value || '').trim().toLocaleLowerCase('vi-VN').replace(/\s+/g, ' ')
}

function normalizedPhone(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.startsWith('84') && digits.length >= 10) return `0${digits.slice(2)}`
  return digits
}

function semanticKeys(collectionId, fields) {
  const value = (name) => scalar(fields, name)
  const keys = []
  if (collectionId === 'students' || collectionId === 'staff') {
    const email = normalizedText(value('email'))
    const phone = normalizedPhone(value('phone') || value('phoneNumber'))
    if (email) keys.push(`email:${email}`)
    if (phone) keys.push(`phone:${phone}`)
  } else if (collectionId === 'users') {
    const email = normalizedText(value('email'))
    const phone = normalizedPhone(value('phone') || value('phoneNumber'))
    const employeeCode = normalizedText(value('employeeCode'))
    if (email) keys.push(`email:${email}`)
    if (phone) keys.push(`phone:${phone}`)
    if (employeeCode) keys.push(`employee:${employeeCode}`)
  } else if (collectionId === 'sessions') {
    const studentId = value('studentId')
    const date = value('date').slice(0, 10)
    const hour = normalizedText(value('hour') || value('time') || value('slot'))
    const trainerId = value('trainerId')
    if (studentId && date && hour && trainerId) keys.push(`session:${studentId}|${date}|${hour}|${trainerId}`)
  }
  return keys
}

function normalizedDate(value) {
  const text = String(value || '').trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function normalizedContract(document) {
  const fields = decodeFields(document.fields || {})
  const studentId = String(fields.studentId || '').trim()
  const startDate = normalizedDate(fields.startDate)
  const endDate = normalizedDate(fields.endDate)
  const status = normalizedText(fields.status)
  if (!studentId || !startDate || !endDate || startDate > endDate) return null
  return { id: document.path.split('/').pop(), fields, studentId, startDate, endDate, status }
}

function chooseContract(session, contractsByStudent) {
  const fields = decodeFields(session.fields || {})
  const studentId = String(fields.studentId || '').trim()
  const sessionDate = normalizedDate(fields.date)
  if (!studentId || !sessionDate) return { quarantine: 'INVALID_SESSION_DATE_OR_STUDENT' }
  const contracts = contractsByStudent.get(studentId) || []
  const covering = contracts.filter((contract) => CONTRACT_STATUSES.has(contract.status)
    && contract.startDate <= sessionDate && contract.endDate >= sessionDate)
  if (covering.length === 1) return { contract: covering[0], reason: 'exact_contract_window', confidence: 'exact' }
  if (covering.length > 1) {
    const ranked = [...covering].sort((left, right) => right.startDate.localeCompare(left.startDate)
      || right.endDate.localeCompare(left.endDate) || left.id.localeCompare(right.id))
    if (ranked[0].startDate === ranked[1].startDate) return { quarantine: 'AMBIGUOUS_CONTRACT_WINDOW' }
    return { contract: ranked[0], reason: 'overlap_latest_contract_start', confidence: 'deterministic_policy' }
  }
  return { quarantine: contracts.length ? 'NO_CONTRACT_COVERING_DATE' : 'NO_CONTRACT_EVIDENCE' }
}

function sourceFieldNames(collectionId, fields, isCreate) {
  const explicit = SOURCE_FIELDS[collectionId]
  const targetOwned = TARGET_OWNED_FIELDS[collectionId] || new Set()
  const candidates = explicit ? [...explicit] : Object.keys(fields || {})
  return candidates.filter((name) => Object.prototype.hasOwnProperty.call(fields || {}, name)
    && (!targetOwned.has(name) || (collectionId === 'schedules' && explicit?.has(name)))
    && !(isCreate && collectionId === 'users' && ['role', 'employeeCode', 'branchId'].includes(name)))
}

function buildSessionFields(sourceDocument, choice) {
  const sourceFields = sourceDocument.fields || {}
  const fields = {}
  for (const name of sourceFieldNames('sessions', sourceFields, true)) fields[name] = rewriteReferences(sourceFields[name])
  Object.assign(fields, encodeFields({
    contractId: choice.contract.id,
    contractLinkVersion: 3,
    contractLinkReason: choice.reason,
    contractLinkConfidence: choice.confidence,
    contractLinkGapDays: 0,
    contractLinkedBy: `migration:${PLAN_VERSION}`,
    ...(ACTIVE_SESSION_STATUSES.has(normalizedText(scalar(sourceFields, 'status'))) ? {
      schemaVersion: 2,
      scheduleStatus: scalar(sourceFields, 'status'),
      billingStatus: 'pending',
      attendanceStatus: 'pending',
      revision: 0,
      verifiedByStudent: false,
    } : {}),
  }))
  return fields
}

function buildSemanticIndex(documents, collectionId, ignoredPath = '') {
  const index = new Map()
  for (const document of documents.values()) {
    if (document.path === ignoredPath) continue
    for (const key of semanticKeys(collectionId, document.fields || {})) {
      const set = index.get(key) || new Set()
      set.add(document.path)
      index.set(key, set)
    }
  }
  return index
}

function addQuarantine(plan, document, reason, fields = []) {
  plan.quarantine.push({
    collection: document.collectionId,
    // Kept only in the ignored local state/report planning object so a later
    // run can retry the same quarantined path.  Public reports expose only a
    // hash of this value.
    path: document.path,
    pathHash: sha256(document.path),
    sourceUpdateTime: document.updateTime,
    reason,
    fields: [...fields].sort(),
  })
}

function addWrite(plan, operation, document, fields, fieldPaths, reason = null, targetUpdateTime = null) {
  plan.writes.push({
    operation,
    collection: document.collectionId,
    path: document.path,
    pathHash: sha256(document.path),
    sourceUpdateTime: document.updateTime,
    targetUpdateTime,
    fields,
    fieldPaths: [...fieldPaths].sort(),
    reason,
  })
}

function emptySummary() {
  return {
    sourceDocuments: 0,
    targetDocuments: 0,
    eligibleSourceDocuments: 0,
    sourceCreated: 0,
    sourceUpdated: 0,
    safeCreates: 0,
    safeUpdates: 0,
    alreadyApplied: 0,
    quarantinedDocuments: 0,
    targetConflicts: 0,
    sourceDeletesIgnored: 0,
  }
}

function planDocument(plan, sourceDocument, targetDocument, since, sourceDocuments, targetDocuments, contractsByStudent, pendingReviewPaths) {
  const collectionId = sourceDocument.collectionId
  const eligible = updateTimeAfter(sourceDocument.updateTime, since) || pendingReviewPaths.has(sourceDocument.path)
  if (!eligible) return
  plan.summary[collectionId] ||= emptySummary()
  const summary = plan.summary[collectionId]
  summary.eligibleSourceDocuments += 1

  const sourceFields = sourceDocument.fields || {}
  if (collectionId === 'users' && !targetDocument && PRIVILEGED_ROLES.has(normalizedText(scalar(sourceFields, 'role')))) {
    addQuarantine(plan, sourceDocument, 'privileged_user_requires_explicit_review', ['role'])
    summary.quarantinedDocuments += 1
    return
  }

  if (!targetDocument && collectionId === 'sessions') {
    const semantic = semanticKeys(collectionId, sourceFields)
    const targetSemantic = buildSemanticIndex(targetDocuments, collectionId)
    if (!semantic.length) {
      addQuarantine(plan, sourceDocument, 'invalid_session_semantic_key')
      summary.quarantinedDocuments += 1
      return
    }
    if (semantic.some((key) => targetSemantic.get(key)?.size)) {
      addQuarantine(plan, sourceDocument, 'schedule_semantic_duplicate', ['studentId', 'date', 'hour', 'trainerId'])
      summary.quarantinedDocuments += 1
      return
    }
    const sameSource = [...sourceDocuments.values()].filter((candidate) => candidate.path !== sourceDocument.path
      && candidate.collectionId === 'sessions'
      && (updateTimeAfter(candidate.updateTime, since) || pendingReviewPaths.has(candidate.path))
      && semantic.some((key) => semanticKeys('sessions', candidate.fields || {}).includes(key)))
    if (sameSource.length) {
      addQuarantine(plan, sourceDocument, 'source_schedule_semantic_duplicate', ['studentId', 'date', 'hour', 'trainerId'])
      summary.quarantinedDocuments += 1
      return
    }
    const choice = chooseContract(sourceDocument, contractsByStudent)
    if (!choice.contract) {
      addQuarantine(plan, sourceDocument, choice.quarantine)
      summary.quarantinedDocuments += 1
      return
    }
    addWrite(plan, 'create', sourceDocument, buildSessionFields(sourceDocument, choice), Object.keys(buildSessionFields(sourceDocument, choice)), 'schedule_session_create')
    summary.safeCreates += 1
    summary.sourceCreated += 1
    return
  }

  const fieldNames = sourceFieldNames(collectionId, sourceFields, !targetDocument)
  if (!targetDocument) {
    const semantic = semanticKeys(collectionId, sourceFields)
    const targetSemantic = buildSemanticIndex(targetDocuments, collectionId)
    const duplicate = semantic.filter((key) => targetSemantic.get(key)?.size)
    if (duplicate.length) {
      addQuarantine(plan, sourceDocument, 'semantic_duplicate_conflict', duplicate.map((key) => key.split(':')[0]))
      summary.quarantinedDocuments += 1
      return
    }
    const fields = Object.fromEntries(fieldNames.map((name) => [name, rewriteReferences(sourceFields[name])]))
    addWrite(plan, 'create', sourceDocument, fields, Object.keys(fields), 'source_delta_create')
    summary.safeCreates += 1
    summary.sourceCreated += 1
    return
  }

  const changed = changedFields(sourceFields, targetDocument.fields || {}, fieldNames)
  if (!changed.length) {
    summary.alreadyApplied += 1
    return
  }
  summary.sourceUpdated += 1
  if (targetDocument.updateTime && sourceDocument.updateTime && Date.parse(targetDocument.updateTime) > Date.parse(sourceDocument.updateTime)) {
    addQuarantine(plan, sourceDocument, 'target_newer_than_source', changed)
    summary.quarantinedDocuments += 1
    summary.targetConflicts += 1
    return
  }
  const updates = {}
  for (const name of changed) {
    if (Object.prototype.hasOwnProperty.call(sourceFields, name)) updates[name] = rewriteReferences(sourceFields[name])
  }
  if (!Object.keys(updates).length) {
    summary.alreadyApplied += 1
    return
  }
  addWrite(plan, 'update', sourceDocument, updates, Object.keys(updates), 'source_delta_update', targetDocument.updateTime)
  summary.safeUpdates += 1
}

function aggregate(plan) {
  const summaries = Object.values(plan.summary)
  const sum = (name) => summaries.reduce((total, value) => total + Number(value[name] || 0), 0)
  const reasons = {}
  for (const item of plan.quarantine) reasons[item.reason] = Number(reasons[item.reason] || 0) + 1
  return {
    sourceDocuments: sum('sourceDocuments'),
    targetDocuments: sum('targetDocuments'),
    eligibleSourceDocuments: sum('eligibleSourceDocuments'),
    sourceCreated: sum('sourceCreated'),
    sourceUpdated: sum('sourceUpdated'),
    safeCreates: sum('safeCreates'),
    safeUpdates: sum('safeUpdates'),
    alreadyApplied: sum('alreadyApplied'),
    pendingWrites: plan.writes.length,
    quarantinedDocuments: plan.quarantine.length,
    targetConflicts: sum('targetConflicts'),
    sourceDeletesIgnored: sum('sourceDeletesIgnored'),
    quarantineReasons: reasons,
    sourceMutationCount: 0,
    targetDeleteCount: 0,
  }
}

function planDigest(plan) {
  return sha256({
    planVersion: PLAN_VERSION,
    source: SOURCE,
    target: TARGET,
    since: plan.since,
    watermark: plan.watermark,
    writes: plan.writes.map((item) => ({
      operation: item.operation,
      collection: item.collection,
      path: item.path,
      sourceUpdateTime: item.sourceUpdateTime,
      targetUpdateTime: item.targetUpdateTime,
      fieldPaths: item.fieldPaths,
      fieldsHash: sha256(item.fields),
    })),
    quarantine: plan.quarantine,
  })
}

function sanitizedReport(mode, plan, extra = {}) {
  return {
    planVersion: PLAN_VERSION,
    mode,
    source: SOURCE,
    target: TARGET,
    sourceReadOnly: true,
    sourceMutationCount: 0,
    deletePropagation: false,
    since: plan.since,
    watermark: plan.watermark,
    planDigest: plan.planDigest,
    summary: aggregate(plan),
    collections: plan.summary,
    writes: plan.writes.map((item) => ({
      operation: item.operation,
      collection: item.collection,
      pathHash: item.pathHash,
      sourceUpdateTime: item.sourceUpdateTime,
      targetUpdateTime: item.targetUpdateTime,
      fieldPaths: item.fieldPaths,
      fieldsHash: sha256(item.fields),
      reason: item.reason,
    })),
    quarantine: plan.quarantine.map((item) => ({
      collection: item.collection,
      pathHash: item.pathHash,
      sourceUpdateTime: item.sourceUpdateTime,
      reason: item.reason,
      fields: item.fields,
    })),
    generatedAt: new Date().toISOString(),
    writesPerformed: false,
    ...extra,
  }
}

function writeReport(mode, report) {
  fs.mkdirSync(PRIVATE_DIR, { recursive: true })
  fs.writeFileSync(REPORTS[mode], `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  return REPORTS[mode]
}

function quoteFieldPath(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `\`${String(name).replace(/`/g, '\\`')}\``
}

function firestoreWrite(item) {
  const name = documentName(TARGET, item.path)
  if (item.operation === 'create') {
    return { update: { name, fields: item.fields }, currentDocument: { exists: false } }
  }
  return {
    update: { name, fields: item.fields },
    updateMask: { fieldPaths: item.fieldPaths.map(quoteFieldPath) },
    currentDocument: { updateTime: item.targetUpdateTime },
  }
}

async function commitPlan(token, plan) {
  let committed = 0
  let batchesCommitted = 0
  for (let index = 0; index < plan.writes.length; index += MAX_WRITES_PER_COMMIT) {
    const batch = plan.writes.slice(index, index + MAX_WRITES_PER_COMMIT)
    await requestJson(token, TARGET, '/documents:commit', {
      method: 'POST',
      body: JSON.stringify({ writes: batch.map(firestoreWrite) }),
    })
    committed += batch.length
    batchesCommitted += 1
  }
  return { committed, batchesCommitted }
}

function readApprovedDryRun() {
  if (!fs.existsSync(REPORTS['dry-run'])) throw new Error('Dry-run report is missing.')
  const report = JSON.parse(fs.readFileSync(REPORTS['dry-run'], 'utf8'))
  if (report?.planVersion !== PLAN_VERSION || report?.mode !== 'dry-run') throw new Error('Dry-run report version is incompatible.')
  if (canonicalJson(report.source) !== canonicalJson(SOURCE) || canonicalJson(report.target) !== canonicalJson(TARGET)) {
    throw new Error('Dry-run project scope does not match the approved source and target.')
  }
  return report
}

function persistState(plan, outcome) {
  fs.mkdirSync(PRIVATE_DIR, { recursive: true })
  const previous = readState() || {}
  const pendingReviewPaths = plan.quarantine.map((item) => ({ collection: item.collection, path: item.path, reason: item.reason }))
  const next = {
    ...previous,
    source: SOURCE,
    target: TARGET,
    lastSuccessfulSourceUpdateTime: plan.watermark,
    lastPlanDigest: plan.planDigest,
    lastAppliedAt: new Date().toISOString(),
    committedWrites: outcome.committed,
    pendingReviewPaths,
  }
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
}

async function loadPlan(token, since) {
  await Promise.all([assertDatabase(token, SOURCE), assertDatabase(token, TARGET)])
  const snapshots = {}
  for (const collectionId of COLLECTION_GROUPS) {
    const [source, target] = await Promise.all([
      readCollectionGroup(token, SOURCE, collectionId),
      readCollectionGroup(token, TARGET, collectionId),
    ])
    snapshots[collectionId] = { source, target }
  }

  const plan = {
    since,
    watermark: since,
    writes: [],
    quarantine: [],
    summary: {},
    snapshots,
  }
  for (const [collectionId, value] of Object.entries(snapshots)) {
    plan.summary[collectionId] = emptySummary()
    plan.summary[collectionId].sourceDocuments = value.source.size
    plan.summary[collectionId].targetDocuments = value.target.size
    plan.watermark = maxUpdateTime(value.source, plan.watermark)
  }

  const pendingState = readState()?.pendingReviewPaths || []
  // Pending review paths are stored only in the ignored local state file.  A
  // quarantined record is retried on the next run even after the global
  // watermark advances; the public report still contains only a path hash.
  const pendingReviewPaths = new Set(pendingState.map((item) => item?.path).filter(Boolean))
  const targetContracts = snapshots.contracts.target
  const sourceContracts = snapshots.contracts.source
  const contractById = new Map([...targetContracts.values(), ...sourceContracts.values()].map((document) => [document.path, document]))
  const contractsByStudent = new Map()
  for (const document of contractById.values()) {
    const normalized = normalizedContract(document)
    if (!normalized) continue
    contractsByStudent.set(normalized.studentId, [...(contractsByStudent.get(normalized.studentId) || []), normalized])
  }

  for (const [collectionId, value] of Object.entries(snapshots)) {
    const sourceDocuments = value.source
    const targetDocuments = value.target
    for (const document of sourceDocuments.values()) {
      planDocument(plan, document, targetDocuments.get(document.path), since, sourceDocuments, targetDocuments, contractsByStudent, pendingReviewPaths)
    }
  }
  plan.writes.sort((left, right) => `${left.collection}/${left.path}`.localeCompare(`${right.collection}/${right.path}`))
  plan.quarantine.sort((left, right) => `${left.collection}/${left.pathHash}`.localeCompare(`${right.collection}/${right.pathHash}`))
  plan.planDigest = planDigest(plan)
  delete plan.snapshots
  return plan
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2))
  if (arguments_.help) { console.log(usage()); return }
  assertApplyGuards(arguments_)
  const since = resolveCheckpoint(arguments_)
  const token = await accessToken()
  const plan = await loadPlan(token, since)

  if (arguments_.mode === 'dry-run') {
    const reportPath = writeReport('dry-run', sanitizedReport('dry-run', plan))
    console.log(JSON.stringify({ mode: 'dry-run', planDigest: plan.planDigest, ...aggregate(plan), reportPath }, null, 2))
    return
  }

  if (arguments_.mode === 'apply') {
    const approved = readApprovedDryRun()
    if (approved.planDigest !== arguments_.digest || approved.planDigest !== plan.planDigest) {
      throw new Error('Live plan differs from the approved dry-run digest. Run a fresh dry-run.')
    }
    if (approved.since !== plan.since || approved.watermark !== plan.watermark) {
      throw new Error('Approved checkpoint or source watermark changed. Run a fresh dry-run.')
    }
    let outcome = { committed: 0, batchesCommitted: 0 }
    try {
      outcome = await commitPlan(token, plan)
      persistState(plan, outcome)
    } catch (error) {
      const failure = sanitizedReport('apply', plan, {
        writesPerformed: outcome.committed > 0,
        committedWriteCount: outcome.committed,
        batchesCommitted: outcome.batchesCommitted,
        error: String(error?.message || error).slice(0, 1000),
      })
      writeReport('apply', failure)
      throw error
    }
    const reportPath = writeReport('apply', sanitizedReport('apply', plan, {
      writesPerformed: outcome.committed > 0,
      committedWriteCount: outcome.committed,
      batchesCommitted: outcome.batchesCommitted,
      approvedDryRunDigest: arguments_.digest,
    }))
    console.log(JSON.stringify({ mode: 'apply', planDigest: plan.planDigest, ...aggregate(plan), ...outcome, reportPath }, null, 2))
    return
  }

  const report = sanitizedReport('verify', plan)
  const reportPath = writeReport('verify', report)
  console.log(JSON.stringify({ mode: 'verify', planDigest: plan.planDigest, ...aggregate(plan), reportPath }, null, 2))
  if (plan.writes.length > 0) process.exitCode = 2
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
