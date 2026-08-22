const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const SOURCE = { projectId: 'gen-lang-client-0246058381', databaseId: 'aura-fitness-db' }
const STAGING = { projectId: 'gen-lang-client-0815966909', databaseId: 'aura-migration-staging-20260819' }
const TARGET = { projectId: 'gen-lang-client-0815966909', databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7' }
const REPORT_PATH = path.resolve('.migration-private/firestore-staging-validation.json')

function cliAuth() {
  const cliLib = path.join(process.env.APPDATA, 'npm', 'node_modules', 'firebase-tools', 'lib')
  const auth = require(path.join(cliLib, 'auth.js'))
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI is not signed in.')
  return { auth, account }
}

async function accessToken() {
  const { auth, account } = cliAuth()
  const result = await auth.getAccessToken(account.tokens.refresh_token, [])
  if (!result?.access_token) throw new Error('Unable to obtain access token.')
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
  const raw = await response.text()
  const body = raw ? JSON.parse(raw) : null
  if (!response.ok) throw new Error(`${response.status} ${url}: ${body?.error?.message || response.statusText}`)
  return body
}

function base(config) {
  return `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.databaseId}`
}

async function collectionGroupDocuments(token, config, collectionId) {
  const rows = await requestJson(token, `${base(config)}/documents:runQuery`, {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId, allDescendants: true }],
        orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      },
    }),
  })
  const prefix = `projects/${config.projectId}/databases/${config.databaseId}/documents/`
  return (Array.isArray(rows) ? rows : [rows])
    .filter((row) => row?.document?.name)
    .map((row) => ({
      path: row.document.name.startsWith(prefix) ? row.document.name.slice(prefix.length) : row.document.name,
      fields: row.document.fields || {},
    }))
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonical(value[key])
      return result
    }, {})
  }
  return value
}

function documentDigest(documents) {
  const value = documents
    .map((document) => ({ path: document.path, fields: canonical(document.fields) }))
    .sort((left, right) => left.path.localeCompare(right.path))
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function hashed(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function scanProjectBoundValues(value, pathParts, results) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanProjectBoundValues(entry, [...pathParts, String(index)], results))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, entry] of Object.entries(value)) {
    const nextPath = [...pathParts, key]
    if (typeof entry === 'string' && (
      entry.includes(SOURCE.projectId)
      || entry.includes('ai-studio-bucket-618205147887-us-west1')
      || entry.includes(SOURCE.databaseId)
    )) {
      results.push({ fieldPath: nextPath.join('.'), valueType: key })
    } else {
      scanProjectBoundValues(entry, nextPath, results)
    }
  }
}

async function main() {
  const token = await accessToken()
  const inventoryFile = fs.readdirSync(path.resolve('.migration-private'))
    .filter((name) => name.startsWith('inventory-') && name.endsWith('.json'))
    .map((name) => ({ name, time: fs.statSync(path.resolve('.migration-private', name)).mtimeMs }))
    .sort((left, right) => right.time - left.time)[0]?.name
  if (!inventoryFile) throw new Error('Inventory report not found.')
  const inventory = JSON.parse(fs.readFileSync(path.resolve('.migration-private', inventoryFile), 'utf8'))
  const sourceCounts = inventory.source.firestore.collectionGroupCounts || {}
  const collectionGroups = Object.keys(sourceCounts).filter((id) => Number(sourceCounts[id]) > 0).sort()
  const validations = {}
  let exactMatches = 0
  let totalConflicts = 0
  let sourceBoundValueCount = 0

  for (const collectionId of collectionGroups) {
    const [sourceDocs, stagingDocs, targetDocs] = await Promise.all([
      collectionGroupDocuments(token, SOURCE, collectionId),
      collectionGroupDocuments(token, STAGING, collectionId),
      collectionGroupDocuments(token, TARGET, collectionId),
    ])
    const sourcePaths = new Set(sourceDocs.map((document) => document.path))
    const targetPaths = new Set(targetDocs.map((document) => document.path))
    const collisions = [...sourcePaths].filter((documentPath) => targetPaths.has(documentPath))
    const projectBoundValues = []
    for (const document of stagingDocs) scanProjectBoundValues(document.fields, [], projectBoundValues)
    const sourceHash = documentDigest(sourceDocs)
    const stagingHash = documentDigest(stagingDocs)
    const exactMatch = sourceDocs.length === stagingDocs.length && sourceHash === stagingHash
    if (exactMatch) exactMatches += 1
    totalConflicts += collisions.length
    sourceBoundValueCount += projectBoundValues.length
    validations[collectionId] = {
      sourceCount: sourceDocs.length,
      stagingCount: stagingDocs.length,
      targetCount: targetDocs.length,
      sourceHash,
      stagingHash,
      exactMatch,
      productionCollisionCount: collisions.length,
      productionCollisionPathHashes: collisions.map(hashed),
      sourceBoundValueCount: projectBoundValues.length,
      sourceBoundValueFields: [...new Set(projectBoundValues.map((value) => value.fieldPath))].sort(),
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    source: SOURCE,
    staging: STAGING,
    target: TARGET,
    collectionGroups: validations,
    summary: {
      collectionGroupsChecked: collectionGroups.length,
      exactMatches,
      mismatches: collectionGroups.length - exactMatches,
      productionDocumentCollisions: totalConflicts,
      sourceBoundValuesInStaging: sourceBoundValueCount,
    },
  }
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  console.log(JSON.stringify({ ...report.summary, reportPath: REPORT_PATH }, null, 2))
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
