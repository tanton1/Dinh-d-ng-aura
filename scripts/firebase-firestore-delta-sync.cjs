const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const SOURCE = { projectId: 'gen-lang-client-0246058381', databaseId: 'aura-fitness-db' }
const BASELINE = { projectId: 'gen-lang-client-0815966909', databaseId: 'aura-migration-staging-20260819' }
const TARGET = {
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
}
const RETIRED_SOURCE_PROJECT = SOURCE.projectId
const PLAN_VERSION = 2
const MAX_WRITES_PER_COMMIT = 200
const APPLY_CONFIRMATION = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}:apply-source-delta`
const PRIVATE_DIRECTORY = path.resolve('.migration-private')
const STATE_PATH = path.join(PRIVATE_DIRECTORY, 'firestore-staging-state.json')
const REPORTS = {
  'dry-run': path.join(PRIVATE_DIRECTORY, 'firebase-firestore-delta-sync-dry-run.json'),
  apply: path.join(PRIVATE_DIRECTORY, 'firebase-firestore-delta-sync-apply.json'),
  verify: path.join(PRIVATE_DIRECTORY, 'firebase-firestore-delta-sync-verify.json'),
}
const COLLECTIONS = [
  'branches',
  'contracts',
  'dailyCheckins',
  'healthyDishes',
  'leaveRequests',
  'mealPlans',
  'packages',
  'payments',
  'schedules',
  'sessionRequests',
  'sessions',
  'settings',
  'staff',
  'students',
  'trainers',
  'users',
  'workoutLogs',
]
const TARGET_OWNED_FIELDS = {
  contracts: new Set([
    'activatedAt', 'activatedBy', 'attendedClasses', 'carriedOverSessions', 'carryOverPending',
    'carryOverProjectedFrom', 'carryOverProjectionUpdatedAt', 'carryOverProjectionVersion',
    'carryOverReconciledAt', 'carryOverReconciledFrom', 'carryOverReconciliationVersion',
    'carryOverRequested', 'carryOverTransferredAt', 'carryOverTransferredSessions',
    'chargedSessionIds', 'financeProjectionUpdatedAt', 'historyEvidenceSessions', 'packageSessions',
    'plannedCarryOverSessions', 'renewalContinuityReconciledAt', 'renewalSupersededBy',
    'renewedByContractId', 'revision', 'sourceContractId', 'updatedAt', 'usageReconciledAt',
    'usageReconciledFrom', 'usageReconciliationStatus', 'usageReconciliationVersion', 'usedSessions',
  ]),
  sessions: new Set([
    'attendanceEventId', 'attendanceStatus', 'autoConfirmedAt', 'billingEventId', 'billingIssueCode',
    'billingStatus', 'chargedAt', 'completedAt', 'confirmationSource', 'confirmedAt', 'confirmedBy',
    'contractId', 'contractLinkConfidence', 'contractLinkGapDays', 'contractLinkReason',
    'contractLinkVersion', 'contractLinkedAt', 'contractLinkedBy', 'recognitionReviewIssueCode',
    'recognitionReviewRequired', 'revenueRecognitionEntryId', 'revision', 'scheduleStatus',
    'serviceOrdinal', 'updatedAt', 'updatedBy',
  ]),
  students: new Set([
    'accountUid', 'availabilityRevision', 'availabilityUpdatedAt', 'availabilityUpdatedBy',
    'contactSyncVersion', 'contactSyncedAt', 'createdAt', 'scheduleNeedsReview', 'updatedAt',
  ]),
  trainers: new Set([
    'availableSlots', 'availabilityRevision', 'availabilityUpdatedAt', 'availabilityUpdatedBy',
    'baseSalary', 'commissionPerSession', 'commissionRate', 'createdAt', 'dailySessionLimit',
    'dailySessionTarget', 'employmentLevel', 'employmentType', 'payrollPolicyId', 'payrollProfile',
    'priority', 'schedulingPriority', 'slotCapacity', 'updatedAt', 'updatedBy',
  ]),
  staff: new Set([
    'availableSlots', 'baseSalary', 'bonusMonthly', 'branchIds', 'commissionPerSession',
    'commissionRate', 'createdAt', 'createdBy', 'dailySessionLimit', 'dailySessionTarget',
    'employmentLevel', 'employmentType', 'payrollPolicyId', 'payrollProfile', 'positions',
    'priority', 'schedulingPriority', 'slotCapacity', 'updatedAt', 'updatedBy',
  ]),
  users: new Set([
    'accessRole', 'authzVersion', 'branchId', 'contactSyncVersion', 'contactSyncedAt', 'crmProfileId',
    'displayName', 'email', 'employeeCode', 'identityLinkVersion', 'phone', 'phoneNumber', 'role',
    'uid', 'updatedAt',
  ]),
}
const CREATE_STRIPPED_FIELDS = {
  contracts: TARGET_OWNED_FIELDS.contracts,
  // A newly imported session must retain its source contract link. Runtime
  // billing fields remain target-owned and are still stripped on create.
  sessions: new Set([...TARGET_OWNED_FIELDS.sessions].filter((field) => field !== 'contractId')),
}
const PRIVILEGED_ROLES = new Set(['admin', 'super_admin'])

function parseArguments(argv) {
  const result = { mode: 'dry-run', deleteTargetOnly: false }
  for (const argument of argv) {
    if (argument.startsWith('--mode=')) result.mode = argument.slice('--mode='.length)
    else if (argument.startsWith('--project=')) result.projectId = argument.slice('--project='.length)
    else if (argument.startsWith('--database=')) result.databaseId = argument.slice('--database='.length)
    else if (argument.startsWith('--digest=')) result.digest = argument.slice('--digest='.length)
    else if (argument.startsWith('--confirm=')) result.confirmation = argument.slice('--confirm='.length)
    else if (argument.startsWith('--confirm-delete-target-only=')) result.confirmDeleteTargetOnly = argument.slice('--confirm-delete-target-only='.length)
    else if (argument === '--delete-target-only') result.deleteTargetOnly = true
    else if (argument === '--help') result.help = true
    else throw new Error(`Unknown argument: ${argument.split('=')[0]}`)
  }
  if (!['dry-run', 'apply', 'verify'].includes(result.mode)) throw new Error('Mode must be dry-run, apply, or verify.')
  return result
}

function usage() {
  return [
    'Firestore delta sync (source is always read-only)',
    'Dry run:',
    '  node scripts/firebase-firestore-delta-sync.cjs --mode=dry-run --delete-target-only',
    'Apply:',
    `  node scripts/firebase-firestore-delta-sync.cjs --mode=apply --project=${TARGET.projectId} --database=${TARGET.databaseId} --digest=<PLAN_DIGEST> --confirm=${APPLY_CONFIRMATION} --delete-target-only --confirm-delete-target-only=<EXACT_COUNT>`,
    'Verify:',
    '  node scripts/firebase-firestore-delta-sync.cjs --mode=verify --delete-target-only',
  ].join('\n')
}

function assertApplyGuards(arguments_) {
  if (TARGET.projectId === RETIRED_SOURCE_PROJECT) throw new Error('Target points to the retired source project.')
  if (arguments_.mode !== 'apply') return
  if (arguments_.projectId !== TARGET.projectId || arguments_.databaseId !== TARGET.databaseId) {
    throw new Error('Apply requires the exact target project and named database.')
  }
  if (!/^[a-f0-9]{64}$/.test(arguments_.digest || '')) throw new Error('Apply requires the latest dry-run plan digest.')
  if (arguments_.confirmation !== APPLY_CONFIRMATION) throw new Error('Apply confirmation does not match the target-only guard.')
  if (arguments_.deleteTargetOnly && !/^\d+$/.test(arguments_.confirmDeleteTargetOnly || '')) {
    throw new Error('Deleting target-only documents requires an exact numeric confirmation count.')
  }
}

function cliAuth() {
  const cliDirectory = path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'firebase-tools', 'lib')
  const auth = require(path.join(cliDirectory, 'auth.js'))
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI is not signed in.')
  return { auth, account }
}

async function accessToken() {
  const { auth, account } = cliAuth()
  const result = await auth.getAccessToken(account.tokens.refresh_token, [])
  if (!result?.access_token) throw new Error('Unable to obtain a Firebase CLI OAuth token.')
  return result.access_token
}

async function requestJson(token, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  let body = null
  if (text) {
    try { body = JSON.parse(text) } catch { body = { raw: text.slice(0, 1000) } }
  }
  if (!response.ok) throw new Error(`${response.status} ${url}: ${body?.error?.message || body?.raw || response.statusText}`)
  return body
}

function databaseBase(config) {
  return `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${encodeURIComponent(config.databaseId)}`
}

function databaseResource(config) {
  return `projects/${config.projectId}/databases/${config.databaseId}`
}

function documentResource(config, collection, id) {
  return `${databaseResource(config)}/documents/${collection}/${id}`
}

async function assertDatabase(token, config) {
  const metadata = await requestJson(token, databaseBase(config))
  if (metadata?.name !== databaseResource(config)) throw new Error(`Database metadata mismatch for ${config.projectId}.`)
  return metadata
}

function readState() {
  if (!fs.existsSync(STATE_PATH)) throw new Error('Migration state is missing. Create source and target backups first.')
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
}

function approvedSnapshotState() {
  const state = readState()
  if (!state.sourceExport?.done || state.sourceExport?.error || !state.sourceExport?.snapshotTime) {
    throw new Error('The read-only source snapshot is not complete.')
  }
  if (!state.targetBackup?.done || state.targetBackup?.error) throw new Error('The production target backup is not complete.')
  if (!String(state.sourceExport.outputUriPrefix || '').startsWith('gs://aura-migration-607039870489-20260819/source-pitr/')) {
    throw new Error('Unexpected source snapshot location.')
  }
  if (!String(state.targetBackup.outputUriPrefix || '').startsWith('gs://aura-migration-607039870489-20260819/target-backup/')) {
    throw new Error('Unexpected target backup location.')
  }
  return {
    sourceSnapshotTime: state.sourceExport.snapshotTime,
    sourceSnapshotUri: state.sourceExport.outputUriPrefix,
    targetBackupUri: state.targetBackup.outputUriPrefix,
  }
}

async function listDocuments(token, config, collection, readTime = '') {
  const documents = new Map()
  let pageToken = ''
  do {
    const query = new URLSearchParams({ pageSize: '1000' })
    if (readTime) query.set('readTime', readTime)
    if (pageToken) query.set('pageToken', pageToken)
    const body = await requestJson(token, `${databaseBase(config)}/documents/${encodeURIComponent(collection)}?${query}`)
    for (const document of body?.documents || []) {
      const id = String(document.name || '').split('/').pop()
      if (id) documents.set(id, document)
    }
    pageToken = body?.nextPageToken || ''
  } while (pageToken)
  return documents
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}

function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex')
}

function documentHash(document) {
  return sha256(document?.fields || {})
}

function valueAt(fields, name) {
  return Object.prototype.hasOwnProperty.call(fields || {}, name) ? canonical(fields[name]) : '__MISSING__'
}

function changedFields(left, right) {
  const names = new Set([...Object.keys(left || {}), ...Object.keys(right || {})])
  return [...names].filter((name) => valueAt(left, name) !== valueAt(right, name)).sort()
}

function sourceFieldsMatchTarget(sourceFields, targetFields, names = Object.keys(sourceFields || {})) {
  return names.every((name) => valueAt(sourceFields, name) === valueAt(targetFields, name))
}

function stringField(fields, name) {
  return typeof fields?.[name]?.stringValue === 'string' ? fields[name].stringValue : ''
}

function scalarField(fields, name) {
  const value = fields?.[name]
  if (!value || typeof value !== 'object') return ''
  for (const key of ['stringValue', 'integerValue', 'doubleValue', 'timestampValue', 'booleanValue']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) return String(value[key]).trim()
  }
  return ''
}

function normalizedText(value) {
  return String(value || '').trim().toLocaleLowerCase('vi-VN').replace(/\s+/g, ' ')
}

function normalizedPhone(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.startsWith('84') && digits.length >= 10) return `0${digits.slice(2)}`
  return digits
}

function semanticKeys(collection, fields) {
  const value = (name) => scalarField(fields, name)
  const compact = (parts) => parts.every(Boolean) ? parts.join('|') : ''
  const keys = []
  if (collection === 'students' || collection === 'staff') {
    const email = normalizedText(value('email'))
    const phone = normalizedPhone(value('phone') || value('phoneNumber'))
    if (email) keys.push(`email:${email}`)
    if (phone) keys.push(`phone:${phone}`)
  } else if (collection === 'users') {
    const employeeCode = normalizedText(value('employeeCode'))
    const uid = value('uid')
    const email = normalizedText(value('email'))
    const phone = normalizedPhone(value('phone') || value('phoneNumber'))
    if (employeeCode) keys.push(`employee:${employeeCode}`)
    if (uid) keys.push(`uid:${uid}`)
    if (email) keys.push(`email:${email}`)
    if (phone) keys.push(`phone:${phone}`)
  } else if (collection === 'contracts') {
    const signature = compact([value('studentId'), value('packageId'), value('startDate'), value('endDate')])
    if (signature) keys.push(`contract:${signature}`)
  } else if (collection === 'payments') {
    const signature = compact([value('studentId'), value('contractId'), value('date'), value('amount')])
    if (signature) keys.push(`payment:${signature}:${value('installmentId')}`)
  } else if (collection === 'sessions') {
    const signature = compact([value('studentId'), value('date'), value('hour'), value('trainerId')])
    if (signature) keys.push(`session:${signature}`)
  } else if (collection === 'dailyCheckins') {
    const signature = compact([value('studentId'), value('date')])
    if (signature) keys.push(`checkin:${signature}`)
  } else if (collection === 'packages') {
    const signature = compact([value('branchId'), normalizedText(value('name')), value('durationMonths'), value('totalSessions')])
    if (signature) keys.push(`package:${signature}`)
  }
  return keys
}

function targetSemanticIndex(collection, target, excludedIds = new Set()) {
  const index = new Map()
  for (const [id, document] of target) {
    if (excludedIds.has(id)) continue
    for (const key of semanticKeys(collection, document.fields || {})) {
      const ids = index.get(key) || new Set()
      ids.add(id)
      index.set(key, ids)
    }
  }
  return index
}

function appendSafeCreate(plan, collection, id, sourceDocument, semanticIndex) {
  const sourceFields = sourceDocument.fields || {}
  if (collection === 'users' && PRIVILEGED_ROLES.has(stringField(sourceFields, 'role'))) {
    addReason(plan, collection, id, 'privileged_new_user_requires_review', ['role'])
    return
  }
  if (collection === 'sessions' && !stringField(sourceFields, 'contractId')) {
    addReason(plan, collection, id, 'session_contract_link_required', ['contractId'])
    return
  }
  const duplicateKeys = semanticKeys(collection, sourceFields).filter((key) => {
    const ids = semanticIndex.get(key)
    return ids && [...ids].some((targetId) => targetId !== id)
  })
  if (duplicateKeys.length) {
    addReason(plan, collection, id, 'semantic_duplicate_conflict', duplicateKeys.map((key) => key.split(':')[0]))
    return
  }
  const stripped = Object.keys(sourceFields).filter((name) => CREATE_STRIPPED_FIELDS[collection]?.has(name))
  if (stripped.length) {
    plan.transforms.push({ collection, idHash: sha256(id), reason: 'canonical_create_field_stripped', fields: stripped.sort() })
    plan.summary.transformedCreates += 1
  }
  const createFields = {}
  for (const [name, value] of Object.entries(sourceFields)) {
    if (!CREATE_STRIPPED_FIELDS[collection]?.has(name)) createFields[name] = rewriteReferences(value)
  }
  plan.writes.push({
    operation: 'create',
    collection,
    id,
    sourceUpdateTime: sourceDocument.updateTime,
    fields: createFields,
    fieldPaths: Object.keys(createFields).sort(),
  })
  plan.summary.safeCreates += 1
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

function addReason(plan, collection, id, reason, fields = []) {
  plan.quarantine.push({ collection, idHash: sha256(id), reason, fields: [...fields].sort() })
}

function createSummary() {
  return {
    sourceDocuments: 0,
    baselineDocuments: 0,
    targetDocuments: 0,
    sourceCreated: 0,
    sourceUpdated: 0,
    sourceDeletedIgnored: 0,
    safeCreates: 0,
    safeUpdates: 0,
    transformedCreates: 0,
    alreadyApplied: 0,
    targetOnlyDocuments: 0,
    safeDeletes: 0,
    deferredDocuments: 0,
    quarantinedDocuments: 0,
  }
}

function deferredFields(collection, isNew, names) {
  if (isNew) return []
  const deferred = new Set()
  for (const name of names) {
    if (TARGET_OWNED_FIELDS[collection]?.has(name)) deferred.add(name)
    if (collection === 'schedules') deferred.add(name)
  }
  return [...deferred]
}

function planCollection(collection, source, baseline, target, options = {}) {
  const plan = { writes: [], deletes: [], transforms: [], quarantine: [], sourceDeletes: [], summary: createSummary() }
  const plannedTargetOnlyIds = options.deleteTargetOnly
    ? new Set([...target.keys()].filter((id) => !source.has(id)))
    : new Set()
  const semanticIndex = targetSemanticIndex(collection, target, plannedTargetOnlyIds)
  plan.summary.sourceDocuments = source.size
  plan.summary.baselineDocuments = baseline.size
  plan.summary.targetDocuments = target.size

  for (const [id, sourceDocument] of source) {
    const baselineDocument = baseline.get(id)
    const targetDocument = target.get(id)
    const sourceFields = sourceDocument.fields || {}

    if (!baselineDocument) {
      plan.summary.sourceCreated += 1
      if (targetDocument) {
        if (sourceFieldsMatchTarget(sourceFields, targetDocument.fields || {})) plan.summary.alreadyApplied += 1
        else addReason(plan, collection, id, 'new_id_conflict', changedFields(sourceFields, targetDocument.fields || {}))
        continue
      }
      appendSafeCreate(plan, collection, id, sourceDocument, semanticIndex)
      continue
    }

    if (!targetDocument) {
      appendSafeCreate(plan, collection, id, sourceDocument, semanticIndex)
      continue
    }

    const baselineFields = baselineDocument.fields || {}
    const sourceChanged = changedFields(sourceFields, baselineFields)
    if (!sourceChanged.length) continue
    plan.summary.sourceUpdated += 1
    const targetFields = targetDocument.fields || {}
    const needed = sourceChanged.filter((name) => valueAt(sourceFields, name) !== valueAt(targetFields, name))
    if (!needed.length) {
      plan.summary.alreadyApplied += 1
      continue
    }
    const targetChanged = new Set(changedFields(targetFields, baselineFields))
    const conflicting = needed.filter((name) => targetChanged.has(name) && valueAt(sourceFields, name) !== valueAt(targetFields, name))
    const deferred = new Set([...conflicting, ...deferredFields(collection, false, needed)])
    if (conflicting.length) addReason(plan, collection, id, 'overlapping_field_conflict', conflicting)
    const policyDeferred = [...deferred].filter((name) => !conflicting.includes(name))
    if (policyDeferred.length) addReason(plan, collection, id, 'canonical_field_deferred', policyDeferred)
    const applicable = needed.filter((name) => !deferred.has(name))
    if (!applicable.length) continue
    const updateFields = {}
    for (const name of applicable) {
      if (Object.prototype.hasOwnProperty.call(sourceFields, name)) updateFields[name] = rewriteReferences(sourceFields[name])
    }
    plan.writes.push({
      operation: 'update',
      collection,
      id,
      sourceUpdateTime: sourceDocument.updateTime,
      targetUpdateTime: targetDocument.updateTime,
      fields: updateFields,
      fieldPaths: applicable.sort(),
    })
    plan.summary.safeUpdates += 1
  }

  for (const id of baseline.keys()) {
    if (source.has(id)) continue
    plan.sourceDeletes.push({ collection, idHash: sha256(id), reason: 'source_delete_not_propagated' })
    plan.summary.sourceDeletedIgnored += 1
  }
  for (const [id, targetDocument] of target) {
    if (source.has(id)) continue
    plan.summary.targetOnlyDocuments += 1
    if (!options.deleteTargetOnly) continue
    plan.deletes.push({
      operation: 'delete',
      collection,
      id,
      targetUpdateTime: targetDocument.updateTime,
    })
    plan.summary.safeDeletes += 1
  }
  plan.summary.deferredDocuments = new Set(plan.quarantine.filter((item) => item.reason === 'canonical_field_deferred').map((item) => item.idHash)).size
  plan.summary.quarantinedDocuments = new Set(plan.quarantine.map((item) => item.idHash)).size
  return plan
}

async function buildPlan(token, snapshot, options = {}) {
  const metadata = await Promise.all([
    assertDatabase(token, SOURCE),
    assertDatabase(token, BASELINE),
    assertDatabase(token, TARGET),
  ])
  const plan = { writes: [], deletes: [], transforms: [], quarantine: [], sourceDeletes: [], collections: {}, metadata, deleteTargetOnly: Boolean(options.deleteTargetOnly) }
  for (const collection of COLLECTIONS) {
    const [source, baseline, target] = await Promise.all([
      listDocuments(token, SOURCE, collection, snapshot.sourceSnapshotTime),
      listDocuments(token, BASELINE, collection),
      listDocuments(token, TARGET, collection),
    ])
    const collectionPlan = planCollection(collection, source, baseline, target, options)
    plan.writes.push(...collectionPlan.writes)
    plan.deletes.push(...collectionPlan.deletes)
    plan.transforms.push(...collectionPlan.transforms)
    plan.quarantine.push(...collectionPlan.quarantine)
    plan.sourceDeletes.push(...collectionPlan.sourceDeletes)
    plan.collections[collection] = collectionPlan.summary
  }
  plan.writes.sort((left, right) => `${left.collection}/${left.id}`.localeCompare(`${right.collection}/${right.id}`))
  plan.deletes.sort((left, right) => `${left.collection}/${left.id}`.localeCompare(`${right.collection}/${right.id}`))
  plan.planDigest = sha256([
    ...plan.writes.map((item) => ({
    operation: item.operation,
    path: `${item.collection}/${item.id}`,
    sourceUpdateTime: item.sourceUpdateTime,
    targetUpdateTime: item.targetUpdateTime || null,
    fieldPaths: item.fieldPaths,
    fieldsHash: sha256(item.fields),
    })),
    ...plan.deletes.map((item) => ({
      operation: item.operation,
      path: `${item.collection}/${item.id}`,
      targetUpdateTime: item.targetUpdateTime,
    })),
  ])
  return plan
}

function aggregate(plan) {
  const values = Object.values(plan.collections)
  const sum = (key) => values.reduce((total, value) => total + Number(value[key] || 0), 0)
  const reasons = {}
  const fields = {}
  for (const item of plan.quarantine) {
    reasons[item.reason] = Number(reasons[item.reason] || 0) + 1
    for (const field of item.fields) fields[`${item.collection}.${field}`] = Number(fields[`${item.collection}.${field}`] || 0) + 1
  }
  return {
    sourceDocuments: sum('sourceDocuments'),
    baselineDocuments: sum('baselineDocuments'),
    targetDocumentsInLegacyScope: sum('targetDocuments'),
    sourceCreated: sum('sourceCreated'),
    sourceUpdated: sum('sourceUpdated'),
    sourceDeletedIgnored: sum('sourceDeletedIgnored'),
    safeCreates: sum('safeCreates'),
    safeUpdates: sum('safeUpdates'),
    transformedCreates: sum('transformedCreates'),
    alreadyApplied: sum('alreadyApplied'),
    pendingWrites: plan.writes.length,
    targetOnlyDocuments: sum('targetOnlyDocuments'),
    pendingDeletes: plan.deletes.length,
    pendingOperations: plan.writes.length + plan.deletes.length,
    quarantinedDocuments: new Set(plan.quarantine.map((item) => `${item.collection}:${item.idHash}`)).size,
    quarantineReasons: reasons,
    quarantineFields: fields,
  }
}

function sanitizedReport(mode, snapshot, plan, extra = {}) {
  return {
    planVersion: PLAN_VERSION,
    mode,
    source: SOURCE,
    baseline: BASELINE,
    target: TARGET,
    sourceReadOnly: true,
    deletePropagation: false,
    targetOnlyDeletionRequested: plan.deleteTargetOnly,
    snapshot,
    planDigest: plan.planDigest,
    summary: aggregate(plan),
    collections: plan.collections,
    quarantine: plan.quarantine,
    sourceDeletes: plan.sourceDeletes,
    transforms: plan.transforms,
    plannedDeletes: plan.deletes.map((item) => ({
      collection: item.collection,
      idHash: sha256(item.id),
      targetUpdateTime: item.targetUpdateTime,
    })),
    writesPerformed: false,
    generatedAt: new Date().toISOString(),
    ...extra,
  }
}

function writeReport(mode, report) {
  fs.mkdirSync(PRIVATE_DIRECTORY, { recursive: true })
  fs.writeFileSync(REPORTS[mode], `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  return REPORTS[mode]
}

function firestoreWrite(item) {
  const name = documentResource(TARGET, item.collection, item.id)
  if (item.operation === 'create') {
    return { update: { name, fields: item.fields }, currentDocument: { exists: false } }
  }
  return {
    update: { name, fields: item.fields },
    updateMask: { fieldPaths: item.fieldPaths },
    currentDocument: { updateTime: item.targetUpdateTime },
  }
}

function firestoreDelete(item) {
  return {
    delete: documentResource(TARGET, item.collection, item.id),
    currentDocument: { updateTime: item.targetUpdateTime },
  }
}

async function commitPlan(token, plan) {
  let writesPerformed = 0
  let deletesPerformed = 0
  let batchesCommitted = 0
  const batches = []
  for (let index = 0; index < plan.writes.length; index += MAX_WRITES_PER_COMMIT) {
    batches.push({ kind: 'write', items: plan.writes.slice(index, index + MAX_WRITES_PER_COMMIT) })
  }
  for (let index = 0; index < plan.deletes.length; index += MAX_WRITES_PER_COMMIT) {
    batches.push({ kind: 'delete', items: plan.deletes.slice(index, index + MAX_WRITES_PER_COMMIT) })
  }
  try {
    for (const batch of batches) {
      await requestJson(token, `${databaseBase(TARGET)}/documents:commit`, {
        method: 'POST',
        body: JSON.stringify({ writes: batch.kind === 'write' ? batch.items.map(firestoreWrite) : batch.items.map(firestoreDelete) }),
      })
      if (batch.kind === 'write') writesPerformed += batch.items.length
      else deletesPerformed += batch.items.length
      batchesCommitted += 1
    }
  } catch (error) {
    error.migrationOutcome = { writesPerformed, deletesPerformed, batchesCommitted }
    throw error
  }
  return { writesPerformed, deletesPerformed, batchesCommitted }
}

function readDryRunReport() {
  if (!fs.existsSync(REPORTS['dry-run'])) throw new Error('Dry-run report is missing.')
  const report = JSON.parse(fs.readFileSync(REPORTS['dry-run'], 'utf8'))
  if (report?.planVersion !== PLAN_VERSION || report?.mode !== 'dry-run') throw new Error('Dry-run report version is incompatible.')
  if (canonical(report.source) !== canonical(SOURCE) || canonical(report.target) !== canonical(TARGET)) {
    throw new Error('Dry-run report project scope does not match the approved source and target.')
  }
  return report
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2))
  if (arguments_.help) { console.log(usage()); return }
  assertApplyGuards(arguments_)
  const snapshot = approvedSnapshotState()
  const token = await accessToken()
  const plan = await buildPlan(token, snapshot, { deleteTargetOnly: arguments_.deleteTargetOnly })

  if (arguments_.mode === 'dry-run') {
    const report = sanitizedReport('dry-run', snapshot, plan)
    const reportPath = writeReport('dry-run', report)
    console.log(JSON.stringify({ mode: 'dry-run', planDigest: plan.planDigest, ...report.summary, reportPath, writesPerformed: false }, null, 2))
    return
  }

  if (arguments_.mode === 'apply') {
    const approved = readDryRunReport()
    if (Boolean(approved.targetOnlyDeletionRequested) !== Boolean(arguments_.deleteTargetOnly)) {
      throw new Error('Apply target-only deletion policy differs from the approved dry-run.')
    }
    if (arguments_.deleteTargetOnly) {
      const expectedDeleteCount = Number(arguments_.confirmDeleteTargetOnly)
      if (expectedDeleteCount !== plan.deletes.length) {
        throw new Error(`Target-only delete confirmation must equal the live plan count (${plan.deletes.length}).`)
      }
    }
    if (arguments_.digest !== approved.planDigest || plan.planDigest !== approved.planDigest) {
      throw new Error('Live plan differs from the approved dry-run digest. Run a fresh dry-run.')
    }
    if (canonical(snapshot) !== canonical(approved.snapshot)) throw new Error('Approved source snapshot or target backup changed.')
    let outcome = { writesPerformed: 0, deletesPerformed: 0, batchesCommitted: 0 }
    try {
      outcome = await commitPlan(token, plan)
    } catch (error) {
      outcome = error?.migrationOutcome || outcome
      const failure = sanitizedReport('apply', snapshot, plan, {
        writesPerformed: outcome.writesPerformed > 0,
        committedWriteCount: outcome.writesPerformed,
        committedDeleteCount: outcome.deletesPerformed,
        batchesCommitted: outcome.batchesCommitted,
        error: String(error?.message || error).slice(0, 1000),
      })
      writeReport('apply', failure)
      throw error
    }
    const report = sanitizedReport('apply', snapshot, plan, {
      writesPerformed: outcome.writesPerformed > 0,
      committedWriteCount: outcome.writesPerformed,
      committedDeleteCount: outcome.deletesPerformed,
      batchesCommitted: outcome.batchesCommitted,
    })
    const reportPath = writeReport('apply', report)
    console.log(JSON.stringify({ mode: 'apply', planDigest: plan.planDigest, ...report.summary, ...outcome, reportPath }, null, 2))
    return
  }

  const report = sanitizedReport('verify', snapshot, plan)
  const reportPath = writeReport('verify', report)
  console.log(JSON.stringify({ mode: 'verify', planDigest: plan.planDigest, ...report.summary, reportPath, writesPerformed: false }, null, 2))
  if (plan.writes.length > 0 || plan.deletes.length > 0) process.exitCode = 2
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
