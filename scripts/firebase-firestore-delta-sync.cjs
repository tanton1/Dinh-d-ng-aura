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
const PLAN_VERSION = 1
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
const PROJECTION_FIELDS = {
  contracts: new Set(['usedSessions', 'attendedClasses']),
}
const PRIVILEGED_ROLES = new Set(['admin', 'super_admin'])

function parseArguments(argv) {
  const result = { mode: 'dry-run' }
  for (const argument of argv) {
    if (argument.startsWith('--mode=')) result.mode = argument.slice('--mode='.length)
    else if (argument.startsWith('--project=')) result.projectId = argument.slice('--project='.length)
    else if (argument.startsWith('--database=')) result.databaseId = argument.slice('--database='.length)
    else if (argument.startsWith('--digest=')) result.digest = argument.slice('--digest='.length)
    else if (argument.startsWith('--confirm=')) result.confirmation = argument.slice('--confirm='.length)
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
    '  node scripts/firebase-firestore-delta-sync.cjs --mode=dry-run',
    'Apply:',
    `  node scripts/firebase-firestore-delta-sync.cjs --mode=apply --project=${TARGET.projectId} --database=${TARGET.databaseId} --digest=<PLAN_DIGEST> --confirm=${APPLY_CONFIRMATION}`,
    'Verify:',
    '  node scripts/firebase-firestore-delta-sync.cjs --mode=verify',
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
    alreadyApplied: 0,
    deferredDocuments: 0,
    quarantinedDocuments: 0,
  }
}

function deferredFields(collection, isNew, names) {
  if (isNew) return []
  const deferred = new Set()
  for (const name of names) {
    if (PROJECTION_FIELDS[collection]?.has(name)) deferred.add(name)
    if (collection === 'users' && name === 'role') deferred.add(name)
    if (collection === 'schedules') deferred.add(name)
  }
  return [...deferred]
}

function planCollection(collection, source, baseline, target) {
  const plan = { writes: [], quarantine: [], sourceDeletes: [], summary: createSummary() }
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
      if (collection === 'users' && PRIVILEGED_ROLES.has(stringField(sourceFields, 'role'))) {
        addReason(plan, collection, id, 'privileged_new_user_requires_review', ['role'])
        continue
      }
      plan.writes.push({
        operation: 'create',
        collection,
        id,
        sourceUpdateTime: sourceDocument.updateTime,
        fields: rewriteReferences(sourceFields),
        fieldPaths: Object.keys(sourceFields).sort(),
      })
      plan.summary.safeCreates += 1
      continue
    }

    const baselineFields = baselineDocument.fields || {}
    const sourceChanged = changedFields(sourceFields, baselineFields)
    if (!sourceChanged.length) continue
    plan.summary.sourceUpdated += 1
    if (!targetDocument) {
      addReason(plan, collection, id, 'target_document_missing', sourceChanged)
      continue
    }
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
  plan.summary.deferredDocuments = new Set(plan.quarantine.filter((item) => item.reason === 'canonical_field_deferred').map((item) => item.idHash)).size
  plan.summary.quarantinedDocuments = new Set(plan.quarantine.map((item) => item.idHash)).size
  return plan
}

async function buildPlan(token, snapshot) {
  const metadata = await Promise.all([
    assertDatabase(token, SOURCE),
    assertDatabase(token, BASELINE),
    assertDatabase(token, TARGET),
  ])
  const plan = { writes: [], quarantine: [], sourceDeletes: [], collections: {}, metadata }
  for (const collection of COLLECTIONS) {
    const [source, baseline, target] = await Promise.all([
      listDocuments(token, SOURCE, collection, snapshot.sourceSnapshotTime),
      listDocuments(token, BASELINE, collection),
      listDocuments(token, TARGET, collection),
    ])
    const collectionPlan = planCollection(collection, source, baseline, target)
    plan.writes.push(...collectionPlan.writes)
    plan.quarantine.push(...collectionPlan.quarantine)
    plan.sourceDeletes.push(...collectionPlan.sourceDeletes)
    plan.collections[collection] = collectionPlan.summary
  }
  plan.writes.sort((left, right) => `${left.collection}/${left.id}`.localeCompare(`${right.collection}/${right.id}`))
  plan.planDigest = sha256(plan.writes.map((item) => ({
    operation: item.operation,
    path: `${item.collection}/${item.id}`,
    sourceUpdateTime: item.sourceUpdateTime,
    targetUpdateTime: item.targetUpdateTime || null,
    fieldPaths: item.fieldPaths,
    fieldsHash: sha256(item.fields),
  })))
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
    alreadyApplied: sum('alreadyApplied'),
    pendingWrites: plan.writes.length,
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
    snapshot,
    planDigest: plan.planDigest,
    summary: aggregate(plan),
    collections: plan.collections,
    quarantine: plan.quarantine,
    sourceDeletes: plan.sourceDeletes,
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

async function commitPlan(token, plan) {
  let writesPerformed = 0
  let batchesCommitted = 0
  for (let index = 0; index < plan.writes.length; index += MAX_WRITES_PER_COMMIT) {
    const batch = plan.writes.slice(index, index + MAX_WRITES_PER_COMMIT)
    await requestJson(token, `${databaseBase(TARGET)}/documents:commit`, {
      method: 'POST',
      body: JSON.stringify({ writes: batch.map(firestoreWrite) }),
    })
    writesPerformed += batch.length
    batchesCommitted += 1
  }
  return { writesPerformed, batchesCommitted }
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
  const plan = await buildPlan(token, snapshot)

  if (arguments_.mode === 'dry-run') {
    const report = sanitizedReport('dry-run', snapshot, plan)
    const reportPath = writeReport('dry-run', report)
    console.log(JSON.stringify({ mode: 'dry-run', planDigest: plan.planDigest, ...report.summary, reportPath, writesPerformed: false }, null, 2))
    return
  }

  if (arguments_.mode === 'apply') {
    const approved = readDryRunReport()
    if (arguments_.digest !== approved.planDigest || plan.planDigest !== approved.planDigest) {
      throw new Error('Live plan differs from the approved dry-run digest. Run a fresh dry-run.')
    }
    if (canonical(snapshot) !== canonical(approved.snapshot)) throw new Error('Approved source snapshot or target backup changed.')
    let outcome = { writesPerformed: 0, batchesCommitted: 0 }
    try {
      outcome = await commitPlan(token, plan)
    } catch (error) {
      const failure = sanitizedReport('apply', snapshot, plan, {
        writesPerformed: outcome.writesPerformed > 0,
        committedWriteCount: outcome.writesPerformed,
        batchesCommitted: outcome.batchesCommitted,
        error: String(error?.message || error).slice(0, 1000),
      })
      writeReport('apply', failure)
      throw error
    }
    const report = sanitizedReport('apply', snapshot, plan, {
      writesPerformed: outcome.writesPerformed > 0,
      committedWriteCount: outcome.writesPerformed,
      batchesCommitted: outcome.batchesCommitted,
    })
    const reportPath = writeReport('apply', report)
    console.log(JSON.stringify({ mode: 'apply', planDigest: plan.planDigest, ...report.summary, ...outcome, reportPath }, null, 2))
    return
  }

  const report = sanitizedReport('verify', snapshot, plan)
  const reportPath = writeReport('verify', report)
  console.log(JSON.stringify({ mode: 'verify', planDigest: plan.planDigest, ...report.summary, reportPath, writesPerformed: false }, null, 2))
  if (plan.writes.length > 0) process.exitCode = 2
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
