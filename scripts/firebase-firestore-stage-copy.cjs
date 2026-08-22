const fs = require('node:fs')
const path = require('node:path')

const SOURCE_PROJECT = 'gen-lang-client-0246058381'
const SOURCE_PROJECT_NUMBER = '618205147887'
const SOURCE_DATABASE = 'aura-fitness-db'
const TARGET_PROJECT = 'gen-lang-client-0815966909'
const TARGET_PROJECT_NUMBER = '607039870489'
const TARGET_DATABASE = 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'
const STAGING_DATABASE = 'aura-migration-staging-20260819'
const MIGRATION_BUCKET = 'aura-migration-607039870489-20260819'
const STATE_PATH = path.resolve('.migration-private/firestore-staging-state.json')

function cliAuth() {
  const cliLib = path.join(process.env.APPDATA, 'npm', 'node_modules', 'firebase-tools', 'lib')
  const auth = require(path.join(cliLib, 'auth.js'))
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI is not signed in.')
  return { auth, account }
}

async function token() {
  const { auth, account } = cliAuth()
  const result = await auth.getAccessToken(account.tokens.refresh_token, [])
  if (!result?.access_token) throw new Error('Unable to obtain OAuth access token.')
  return result.access_token
}

async function requestJson(accessToken, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const raw = await response.text()
  let body = null
  if (raw) {
    try { body = JSON.parse(raw) } catch { body = { raw: raw.slice(0, 1000) } }
  }
  if (!response.ok && !(options.allowStatuses || []).includes(response.status)) {
    throw new Error(`${response.status} ${url}: ${body?.error?.message || body?.raw || response.statusText}`)
  }
  return { status: response.status, body }
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) } catch { return {} }
}

function writeState(patch) {
  const next = { ...readState(), ...patch, updatedAt: new Date().toISOString() }
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  return next
}

function addBinding(policy, role, member) {
  const bindings = Array.isArray(policy.bindings) ? policy.bindings : []
  let binding = bindings.find((candidate) => candidate.role === role)
  if (!binding) {
    binding = { role, members: [] }
    bindings.push(binding)
  }
  if (!binding.members.includes(member)) binding.members.push(member)
  policy.bindings = bindings
  return policy
}

async function preflight(accessToken) {
  const results = {}
  for (const projectId of [SOURCE_PROJECT, TARGET_PROJECT]) {
    const billing = await requestJson(
      accessToken,
      `https://cloudbilling.googleapis.com/v1/projects/${projectId}/billingInfo`,
      { allowStatuses: [403, 404] },
    )
    results[projectId] = {
      billingStatus: billing.status,
      billingEnabled: billing.body?.billingEnabled ?? null,
      billingAccountAttached: Boolean(billing.body?.billingAccountName),
    }
  }
  const staging = await requestJson(
    accessToken,
    `https://firestore.googleapis.com/v1/projects/${TARGET_PROJECT}/databases/${STAGING_DATABASE}`,
  )
  results.staging = {
    name: staging.body.name,
    locationId: staging.body.locationId,
    edition: staging.body.edition || staging.body.databaseEdition,
    pitr: staging.body.pointInTimeRecoveryEnablement,
    deleteProtection: staging.body.deleteProtectionState,
  }
  console.log(JSON.stringify(results, null, 2))
}

async function setupBucket(accessToken) {
  const bucketUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(MIGRATION_BUCKET)}`
  let bucket = await requestJson(accessToken, bucketUrl, { allowStatuses: [404] })
  if (bucket.status === 404) {
    bucket = await requestJson(
      accessToken,
      `https://storage.googleapis.com/storage/v1/b?project=${TARGET_PROJECT}`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: MIGRATION_BUCKET,
          location: 'ASIA-SOUTHEAST1',
          storageClass: 'STANDARD',
          versioning: { enabled: true },
          iamConfiguration: { uniformBucketLevelAccess: { enabled: true } },
          labels: { purpose: 'aura-firebase-migration', source: 'gen-lang-client-0246058381' },
        }),
      },
    )
  }

  const iamUrl = `${bucketUrl}/iam`
  const iamResponse = await requestJson(accessToken, iamUrl)
  let policy = iamResponse.body || { bindings: [] }
  const sourceAgent = `serviceAccount:service-${SOURCE_PROJECT_NUMBER}@gcp-sa-firestore.iam.gserviceaccount.com`
  const targetAgent = `serviceAccount:service-${TARGET_PROJECT_NUMBER}@gcp-sa-firestore.iam.gserviceaccount.com`
  policy = addBinding(policy, 'roles/storage.legacyBucketReader', sourceAgent)
  policy = addBinding(policy, 'roles/storage.objectAdmin', sourceAgent)
  policy = addBinding(policy, 'roles/storage.legacyBucketReader', targetAgent)
  policy = addBinding(policy, 'roles/storage.objectViewer', targetAgent)
  await requestJson(accessToken, iamUrl, { method: 'PUT', body: JSON.stringify(policy) })

  writeState({
    migrationBucket: MIGRATION_BUCKET,
    bucketLocation: bucket.body.location,
    bucketReadyAt: new Date().toISOString(),
  })
  console.log(JSON.stringify({
    bucket: MIGRATION_BUCKET,
    location: bucket.body.location,
    versioningEnabled: Boolean(bucket.body.versioning?.enabled),
    uniformBucketLevelAccess: Boolean(bucket.body.iamConfiguration?.uniformBucketLevelAccess?.enabled),
    sourceWriteGranted: true,
    targetReadGranted: true,
  }, null, 2))
}

function roundedSnapshotTime() {
  const value = new Date(Date.now() - 5 * 60 * 1000)
  value.setUTCSeconds(0, 0)
  return value.toISOString()
}

async function beginExport(accessToken, kind) {
  const isSource = kind === 'source'
  const projectId = isSource ? SOURCE_PROJECT : TARGET_PROJECT
  const databaseId = isSource ? SOURCE_DATABASE : TARGET_DATABASE
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outputUriPrefix = `gs://${MIGRATION_BUCKET}/${isSource ? 'source-pitr' : 'target-backup'}/${timestamp}`
  const snapshotTime = isSource ? roundedSnapshotTime() : undefined
  const payload = { outputUriPrefix, ...(snapshotTime ? { snapshotTime } : {}) }
  const response = await requestJson(
    accessToken,
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}:exportDocuments`,
    { method: 'POST', body: JSON.stringify(payload) },
  )
  const key = isSource ? 'sourceExport' : 'targetBackup'
  writeState({
    [key]: {
      operationName: response.body.name,
      outputUriPrefix,
      snapshotTime: snapshotTime || null,
      startedAt: new Date().toISOString(),
    },
  })
  console.log(JSON.stringify({ key, operationName: response.body.name, outputUriPrefix, snapshotTime }, null, 2))
}

async function operationStatus(accessToken, key) {
  const operation = readState()[key]
  if (!operation?.operationName) throw new Error(`No operation stored for ${key}.`)
  const response = await requestJson(accessToken, `https://firestore.googleapis.com/v1/${operation.operationName}`)
  const body = response.body
  const patch = {
    ...operation,
    done: Boolean(body.done),
    error: body.error || null,
    metadata: body.metadata || null,
    response: body.response || null,
    checkedAt: new Date().toISOString(),
  }
  writeState({ [key]: patch })
  console.log(JSON.stringify({
    key,
    done: patch.done,
    error: patch.error,
    progressBytes: patch.metadata?.progressBytes || null,
    progressDocuments: patch.metadata?.progressDocuments || null,
    outputUriPrefix: patch.response?.outputUriPrefix || patch.outputUriPrefix,
  }, null, 2))
}

async function beginImport(accessToken, destination = 'staging') {
  const state = readState()
  if (!state.sourceExport?.done || state.sourceExport?.error) {
    throw new Error('Source export is not complete and successful.')
  }
  const isProduction = destination === 'production'
  if (isProduction) {
    const confirmation = process.argv.find((value) => value.startsWith('--confirm-production-target='))
    if (confirmation !== `--confirm-production-target=${TARGET_PROJECT}`) {
      throw new Error(`Production import requires --confirm-production-target=${TARGET_PROJECT}.`)
    }
    if (!state.targetBackup?.done || state.targetBackup?.error) {
      throw new Error('Target production backup is not complete and successful.')
    }
  }
  const inputUriPrefix = state.sourceExport.response?.outputUriPrefix || state.sourceExport.outputUriPrefix
  const databaseId = isProduction ? TARGET_DATABASE : STAGING_DATABASE
  const operationKey = isProduction ? 'productionImport' : 'stagingImport'
  const response = await requestJson(
    accessToken,
    `https://firestore.googleapis.com/v1/projects/${TARGET_PROJECT}/databases/${databaseId}:importDocuments`,
    { method: 'POST', body: JSON.stringify({ inputUriPrefix }) },
  )
  writeState({
    [operationKey]: {
      operationName: response.body.name,
      inputUriPrefix,
      destinationDatabase: databaseId,
      startedAt: new Date().toISOString(),
    },
  })
  console.log(JSON.stringify({ operationKey, operationName: response.body.name, inputUriPrefix, destinationDatabase: databaseId }, null, 2))
}

async function main() {
  const action = process.argv[2]
  const accessToken = await token()
  if (action === 'preflight') return preflight(accessToken)
  if (action === 'setup-bucket') return setupBucket(accessToken)
  if (action === 'export-source') return beginExport(accessToken, 'source')
  if (action === 'export-target-backup') return beginExport(accessToken, 'target')
  if (action === 'status-source') return operationStatus(accessToken, 'sourceExport')
  if (action === 'status-target-backup') return operationStatus(accessToken, 'targetBackup')
  if (action === 'import-staging') return beginImport(accessToken, 'staging')
  if (action === 'status-staging-import') return operationStatus(accessToken, 'stagingImport')
  if (action === 'import-production') return beginImport(accessToken, 'production')
  if (action === 'status-production-import') return operationStatus(accessToken, 'productionImport')
  throw new Error('Unknown action. Use preflight, setup-bucket, export-source, export-target-backup, status-source, status-target-backup, import-staging, status-staging-import, import-production, or status-production-import.')
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
