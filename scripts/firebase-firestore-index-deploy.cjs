'use strict'

const fs = require('node:fs')
const path = require('node:path')

const TARGET = Object.freeze({
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
})
const CONFIRMATION = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}:create-missing-indexes`
const INDEX_FILE = path.resolve('firestore.indexes.json')
const POLL_INTERVAL_MS = 10_000
const POLL_LIMIT = 120

function usage() {
  return [
    'Usage:',
    '  node scripts/firebase-firestore-index-deploy.cjs dry-run',
    '  node scripts/firebase-firestore-index-deploy.cjs dry-run --scope=finance-ledger-reads',
    '  node scripts/firebase-firestore-index-deploy.cjs dry-run --scope=ledger-date-range',
    '  node scripts/firebase-firestore-index-deploy.cjs dry-run --scope=student-progress-reads',
    '  node scripts/firebase-firestore-index-deploy.cjs dry-run --scope=users-role-reads',
    '  node scripts/firebase-firestore-index-deploy.cjs dry-run --scope=business-report-branch-reads',
    '  node scripts/firebase-firestore-index-deploy.cjs dry-run --scope=loyalty-account-reads',
    '  node scripts/firebase-firestore-index-deploy.cjs dry-run --scope=dashboard-reads',
    '  node scripts/firebase-firestore-index-deploy.cjs dry-run --scope=cpu-background',
    `  node scripts/firebase-firestore-index-deploy.cjs apply --confirm=${CONFIRMATION}`,
    `  node scripts/firebase-firestore-index-deploy.cjs apply --scope=dashboard-reads --confirm=${CONFIRMATION}`,
    '',
    'The apply mode is target-locked and create-only. It never deletes an index.',
  ].join('\n')
}

function parseArguments(argv) {
  const mode = argv[0] || 'dry-run'
  if (!['dry-run', 'apply'].includes(mode)) throw new Error(usage())
  const flags = Object.fromEntries(argv.slice(1).map((item) => {
    const separator = item.indexOf('=')
    if (!item.startsWith('--') || separator < 3) throw new Error(usage())
    return [item.slice(2, separator), item.slice(separator + 1)]
  }))
  if (Object.keys(flags).some((key) => !['confirm', 'scope'].includes(key))) throw new Error(usage())
  const scope = flags.scope || 'all'
  if (!['all', 'finance-ledger-reads', 'ledger-date-range', 'student-progress-reads', 'users-role-reads', 'business-report-branch-reads', 'loyalty-account-reads', 'dashboard-reads', 'cpu-background', 'graphify-fixes'].includes(scope)) throw new Error('Unknown index deployment scope.')
  if (mode === 'apply' && flags.confirm !== CONFIRMATION) throw new Error('Production confirmation is missing or incorrect.')
  return { mode, scope }
}

function firebaseCliAuth() {
  const appData = process.env.APPDATA
  if (!appData) throw new Error('APPDATA is unavailable.')
  const cliLib = path.join(appData, 'npm', 'node_modules', 'firebase-tools', 'lib')
  const auth = require(path.join(cliLib, 'auth.js'))
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI is not signed in.')
  return { auth, account }
}

async function accessToken() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_GHA_CREDS_PATH) {
    const { GoogleAuth } = require('google-auth-library')
    const client = await new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    }).getClient()
    const result = await client.getAccessToken()
    const token = typeof result === 'string' ? result : result?.token
    if (!token) throw new Error('Unable to obtain a Google workload-identity access token.')
    return token
  }
  const { auth, account } = firebaseCliAuth()
  const result = await auth.getAccessToken(account.tokens.refresh_token, [])
  if (!result?.access_token) throw new Error('Unable to obtain a Firebase access token.')
  return result.access_token
}

function databaseBase() {
  return `https://firestore.googleapis.com/v1/projects/${TARGET.projectId}/databases/${encodeURIComponent(TARGET.databaseId)}`
}

async function requestJson(token, endpoint, options = {}) {
  const response = await fetch(`${databaseBase()}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const raw = await response.text()
  if (!response.ok) {
    let reason = ''
    try {
      const parsed = raw ? JSON.parse(raw) : null
      reason = typeof parsed?.error?.message === 'string' ? ` ${parsed.error.message}` : ''
    } catch {
      reason = ''
    }
    throw new Error(`Firestore Admin request failed (${response.status}) at ${endpoint.split('?')[0]}.${reason}`)
  }
  return raw ? JSON.parse(raw) : null
}

async function assertTarget(token) {
  const metadata = await requestJson(token, '')
  const expected = `projects/${TARGET.projectId}/databases/${TARGET.databaseId}`
  if (metadata?.name !== expected) throw new Error('Firestore metadata did not match the approved production target.')
}

function desiredIndexes() {
  const specification = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'))
  if (!Array.isArray(specification?.indexes)) throw new Error('firestore.indexes.json is invalid.')
  return specification.indexes.map((index) => ({
    collectionGroup: String(index.collectionGroup || ''),
    queryScope: String(index.queryScope || 'COLLECTION'),
    fields: (index.fields || []).map((field) => ({
      fieldPath: String(field.fieldPath || ''),
      ...(field.order ? { order: String(field.order) } : {}),
      ...(field.arrayConfig ? { arrayConfig: String(field.arrayConfig) } : {}),
    })),
  }))
}

function comparableFields(fields = []) {
  const result = fields.map((field) => ({
      fieldPath: field.fieldPath,
      ...(field.order ? { order: field.order } : {}),
      ...(field.arrayConfig ? { arrayConfig: field.arrayConfig } : {}),
    }))
  // Firestore appends __name__ with the last ordered field's direction. Do not
  // mistake an explicitly opposite cursor direction for a matching index.
  if (!result.some((field) => field.fieldPath === '__name__')) {
    const direction = [...result].reverse().find((field) => field.order)?.order || 'ASCENDING'
    result.push({ fieldPath: '__name__', order: direction })
  }
  return result
}

function selectIndexes(indexes, scope) {
  if (scope === 'all') return indexes
  if (scope === 'graphify-fixes') {
    const approved = JSON.parse(fs.readFileSync(path.resolve('ops/graphify-fixes-indexes-20261030.json'), 'utf8')).indexes
    if (!Array.isArray(approved) || !approved.length) throw new Error('Missing Graphify fixes index manifest.')
    return approved.map(index => {
      const matches = indexes.filter(candidate => signature(candidate) === signature(index))
      if (matches.length !== 1) throw new Error(`Graphify fixes index for ${index.collectionGroup} must appear exactly once.`)
      return matches[0]
    })
  }
  if (scope === 'cpu-background') {
    return [['subjects', 'dueAt'], ['staffOperationalSummaries', 'nextReconcileAt']].map(([collectionGroup, fieldPath]) => {
      const wanted = { collectionGroup, queryScope: 'COLLECTION', fields: [
        { fieldPath, order: 'ASCENDING' }, { fieldPath: '__name__', order: 'ASCENDING' },
      ] }
      // Enterprise requires an explicit document-key index for the queue cursor.
      const selected = indexes.filter(candidate => indexMatches(wanted, candidate))
      if (selected.length !== 1) throw new Error(`Scoped CPU background index for ${collectionGroup} must appear exactly once in the repository.`)
      return selected[0]
    })
  }
  if (scope === 'business-report-branch-reads') {
    return [['ledgerEntries', 'effectiveAt', 'DESCENDING'], ['cashTransactions', 'effectiveAt', 'DESCENDING'], ['attendanceEvents', 'occurredAt', 'ASCENDING']].map(([collectionGroup, fieldPath, order]) => {
      const wanted = { collectionGroup, queryScope: 'COLLECTION', fields: [
        { fieldPath: 'branchId', order: 'ASCENDING' }, { fieldPath, order },
      ] }
      const selected = indexes.filter(candidate => signature(candidate) === signature(wanted))
      if (selected.length !== 1) throw new Error(`Scoped business report index for ${collectionGroup} must appear exactly once in the repository.`)
      return selected[0]
    })
  }
  if (scope === 'users-role-reads') {
    const wanted = { collectionGroup: 'users', queryScope: 'COLLECTION', fields: [
      { fieldPath: 'role', order: 'ASCENDING' }, { fieldPath: '__name__', order: 'ASCENDING' },
    ] }
    const selected = indexes.filter(candidate => signature(candidate) === signature(wanted))
    if (selected.length !== 1) throw new Error('Scoped users role index must appear exactly once in the repository.')
    return selected
  }
  if (scope === 'student-progress-reads') {
    return ['bodyMetrics', 'bodyMeasurements', 'weightLogs', 'progressCheckIns', 'progress_photos', 'progressPhotos'].map(collectionGroup => {
      const wanted = { collectionGroup, queryScope: 'COLLECTION', fields: [
        { fieldPath: 'date', order: 'DESCENDING' }, { fieldPath: '__name__', order: 'DESCENDING' },
      ] }
      const selected = indexes.filter(candidate => signature(candidate) === signature(wanted))
      if (selected.length !== 1) throw new Error(`Scoped progress index for ${collectionGroup} must appear exactly once in the repository.`)
      return selected[0]
    })
  }
  if (scope === 'ledger-date-range') {
    const wanted = { collectionGroup: 'ledgerEntries', queryScope: 'COLLECTION', fields: [
      { fieldPath: 'effectiveAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ] }
    const selected = indexes.filter((candidate) => signature(candidate) === signature(wanted))
    if (selected.length !== 1) throw new Error('Scoped ledger date index must appear exactly once in the repository.')
    return selected
  }
  if (scope === 'dashboard-reads') {
    const wanted = [
      { collectionGroup: 'attendanceEvents', queryScope: 'COLLECTION', fields: [
        { fieldPath: 'branchId', order: 'ASCENDING' },
        { fieldPath: 'occurredAt', order: 'ASCENDING' },
      ] },
      { collectionGroup: 'sessionRequests', queryScope: 'COLLECTION', fields: [
        { fieldPath: 'trainerId', order: 'ASCENDING' },
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'requestedBy', order: 'ASCENDING' },
      ] },
    ]
    const selected = wanted.map((index) => indexes.filter((candidate) => signature(candidate) === signature(index)))
    if (selected.some((matches) => matches.length !== 1)) throw new Error('Scoped dashboard indexes must each appear exactly once in the repository.')
    return selected.map(([index]) => index)
  }
  if (scope === 'loyalty-account-reads') {
    const wanted = { collectionGroup: 'students', queryScope: 'COLLECTION', fields: [
      { fieldPath: 'branchId', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' },
    ] }
    const selected = indexes.filter((candidate) => signature(candidate) === signature(wanted))
    if (selected.length !== 1) throw new Error('Scoped loyalty index must appear exactly once in the repository.')
    return selected
  }
  if (scope !== 'finance-ledger-reads') throw new Error('Unknown index deployment scope.')
  const wanted = ['branchId', 'type', 'status'].map((fieldPath) => ({
    collectionGroup: 'ledgerEntries', queryScope: 'COLLECTION', fields: [
      { fieldPath, order: 'ASCENDING' },
      { fieldPath: 'effectiveAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  }))
  const selected = wanted.map((index) => indexes.filter((candidate) => signature(candidate) === signature(index)))
  if (selected.some((matches) => matches.length !== 1)) throw new Error('Scoped finance indexes must each appear exactly once in the repository.')
  return selected.map(([index]) => index)
}

function signature(index) {
  return JSON.stringify({
    collectionGroup: index.collectionGroup,
    queryScope: index.queryScope || 'COLLECTION',
    fields: comparableFields(index.fields),
  })
}

function indexMatches(desired, existing) {
  // This Enterprise database reports omitted document-key ordering literally.
  // Its cash account index needs a MinorSort for an explicit descending key.
  // An implicit live key therefore cannot satisfy a declared cursor direction.
  // Keep accepting already-built explicit indexes for unspecified desired keys.
  if (desired.fields?.some(field => field.fieldPath === '__name__')
    && !existing.fields?.some(field => field.fieldPath === '__name__')) return false
  return signature(desired) === signature(existing)
}

async function listIndexes(token) {
  const indexes = []
  let pageToken = ''
  do {
    const query = new URLSearchParams()
    if (pageToken) query.set('pageToken', pageToken)
    const response = await requestJson(token, `/collectionGroups/-/indexes?${query}`)
    indexes.push(...(response?.indexes || []).map((index) => ({
      ...index,
      collectionGroup: index.name?.split('/collectionGroups/')[1]?.split('/indexes/')[0] || '',
    })))
    pageToken = response?.nextPageToken || ''
  } while (pageToken)
  return indexes
}

async function createIndex(token, index) {
  return requestJson(token, `/collectionGroups/${encodeURIComponent(index.collectionGroup)}/indexes`, {
    method: 'POST',
    body: JSON.stringify({ queryScope: index.queryScope, fields: index.fields }),
  })
}

async function waitUntilReady(token, desired) {
  for (let attempt = 1; attempt <= POLL_LIMIT; attempt += 1) {
    const current = await listIndexes(token)
    const matches = desired.map(index => current.filter(existing => indexMatches(index, existing)))
    const missing = matches.filter(indexes => indexes.length === 0)
    const failed = matches.filter(indexes => indexes.length && !indexes.some(index => index.state === 'READY') && indexes.every(index => index.state === 'ERROR'))
    const pending = matches.filter(indexes => indexes.length && !indexes.some(index => index.state === 'READY'))
    if (failed.length) throw new Error(`${failed.length} Firestore index(es) entered ERROR state.`)
    if (!missing.length && !pending.length) return { attempts: attempt, ready: desired.length }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error('Firestore indexes did not become READY within 20 minutes.')
}

async function main() {
  const { mode, scope } = parseArguments(process.argv.slice(2))
  const token = await accessToken()
  await assertTarget(token)
  const desired = selectIndexes(desiredIndexes(), scope)
  const existing = await listIndexes(token)
  const missing = desired.filter(index => !existing.some(current => indexMatches(index, current)))
  if (mode === 'dry-run') {
    console.log(JSON.stringify({ mode, scope, target: TARGET, desired: desired.length, selected: desired, existing: existing.length, missing: missing.length, writesPerformed: false }, null, 2))
    return
  }
  for (const index of missing) await createIndex(token, index)
  const verification = await waitUntilReady(token, desired)
  console.log(JSON.stringify({ mode, scope, target: TARGET, created: missing.length, ...verification, deleted: 0 }, null, 2))
}

module.exports = { parseArguments, selectIndexes, signature, indexMatches, CONFIRMATION, accessToken, requestJson, assertTarget }

if (require.main === module) main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Firestore index deployment failed.')
  process.exitCode = 1
})
