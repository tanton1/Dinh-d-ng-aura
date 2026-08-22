const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

// Read-only post-merge verifier. This script never calls a Firestore write API.
const SOURCE = { projectId: 'gen-lang-client-0246058381', databaseId: 'aura-fitness-db' }
const TARGET = {
  projectId: 'gen-lang-client-0815966909',
  databaseId: 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7',
}
const PRIVATE_DIR = path.resolve('.migration-private')
const REPORT_PATH = path.join(PRIVATE_DIR, 'firestore-production-validation.json')

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

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
  if (!result?.access_token) throw new Error('Unable to obtain a Firebase access token.')
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
  if (!response.ok) {
    // Do not include the server response body: it could contain document metadata.
    throw new Error(`Firestore read failed with HTTP ${response.status}.`)
  }
  return raw ? JSON.parse(raw) : null
}

function databaseBase(config) {
  return `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.databaseId}`
}

async function collectionGroupDocuments(token, config, collectionId) {
  const rows = await requestJson(token, `${databaseBase(config)}/documents:runQuery`, {
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

function contentDigest(fields) {
  return sha256(JSON.stringify(canonical(fields)))
}

function pathDigest(documentPath) {
  return sha256(documentPath)
}

function latestInventory() {
  if (!fs.existsSync(PRIVATE_DIR)) throw new Error('Migration private directory not found.')
  const inventoryFile = fs.readdirSync(PRIVATE_DIR)
    .filter((name) => name.startsWith('inventory-') && name.endsWith('.json'))
    .map((name) => ({ name, time: fs.statSync(path.join(PRIVATE_DIR, name)).mtimeMs }))
    .sort((left, right) => right.time - left.time)[0]?.name
  if (!inventoryFile) throw new Error('Migration inventory report not found.')
  return {
    name: inventoryFile,
    data: JSON.parse(fs.readFileSync(path.join(PRIVATE_DIR, inventoryFile), 'utf8')),
  }
}

function compareDocuments(sourceDocuments, targetDocuments) {
  const source = new Map(sourceDocuments.map((document) => [document.path, contentDigest(document.fields)]))
  const target = new Map(targetDocuments.map((document) => [document.path, contentDigest(document.fields)]))
  const missingPaths = []
  const mismatchedPaths = []
  let exactMatches = 0

  for (const [documentPath, sourceDigest] of source) {
    const targetDigest = target.get(documentPath)
    if (!targetDigest) {
      missingPaths.push(documentPath)
    } else if (targetDigest !== sourceDigest) {
      mismatchedPaths.push(documentPath)
    } else {
      exactMatches += 1
    }
  }

  const extraPaths = []
  for (const documentPath of target.keys()) {
    if (!source.has(documentPath)) extraPaths.push(documentPath)
  }

  return {
    exactMatches,
    missingPathHashes: missingPaths.sort().map(pathDigest),
    mismatchedPathHashes: mismatchedPaths.sort().map(pathDigest),
    targetExtraPathHashes: extraPaths.sort().map(pathDigest),
  }
}

function writeSanitizedReport(report) {
  fs.mkdirSync(PRIVATE_DIR, { recursive: true })
  const temporaryPath = `${REPORT_PATH}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporaryPath, REPORT_PATH)
}

async function main() {
  const inventory = latestInventory()
  const expectedCounts = inventory.data?.source?.firestore?.collectionGroupCounts || {}
  const collectionGroups = Object.keys(expectedCounts)
    .filter((collectionId) => Number(expectedCounts[collectionId]) > 0)
    .sort()
  if (collectionGroups.length === 0) throw new Error('Source collection-group inventory is empty.')

  const token = await accessToken()
  const validations = {}
  const summary = {
    collectionGroupsChecked: collectionGroups.length,
    sourceDocuments: 0,
    targetDocumentsInCheckedGroups: 0,
    exactSourceDocuments: 0,
    missingSourceDocuments: 0,
    mismatchedSourceDocuments: 0,
    targetExtraDocuments: 0,
    sourceInventoryDriftGroups: 0,
    sourceFullyRepresentedInTarget: true,
  }

  // Keep reads sequential to avoid quota spikes against either production project.
  for (const collectionId of collectionGroups) {
    const sourceDocuments = await collectionGroupDocuments(token, SOURCE, collectionId)
    const targetDocuments = await collectionGroupDocuments(token, TARGET, collectionId)
    const comparison = compareDocuments(sourceDocuments, targetDocuments)
    const expectedSourceCount = Number(expectedCounts[collectionId])
    const sourceInventoryDrift = sourceDocuments.length !== expectedSourceCount

    validations[collectionId] = {
      expectedSourceCount,
      liveSourceCount: sourceDocuments.length,
      targetCount: targetDocuments.length,
      exactSourceDocumentCount: comparison.exactMatches,
      missingSourceDocumentCount: comparison.missingPathHashes.length,
      mismatchedSourceDocumentCount: comparison.mismatchedPathHashes.length,
      targetExtraDocumentCount: comparison.targetExtraPathHashes.length,
      sourceInventoryDrift,
      missingSourcePathHashes: comparison.missingPathHashes,
      mismatchedSourcePathHashes: comparison.mismatchedPathHashes,
      targetExtraPathHashes: comparison.targetExtraPathHashes,
    }

    summary.sourceDocuments += sourceDocuments.length
    summary.targetDocumentsInCheckedGroups += targetDocuments.length
    summary.exactSourceDocuments += comparison.exactMatches
    summary.missingSourceDocuments += comparison.missingPathHashes.length
    summary.mismatchedSourceDocuments += comparison.mismatchedPathHashes.length
    summary.targetExtraDocuments += comparison.targetExtraPathHashes.length
    if (sourceInventoryDrift) summary.sourceInventoryDriftGroups += 1
  }

  summary.sourceFullyRepresentedInTarget =
    summary.missingSourceDocuments === 0 && summary.mismatchedSourceDocuments === 0

  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'read-only',
    source: SOURCE,
    target: TARGET,
    inventoryFileHash: sha256(inventory.name),
    pathHashAlgorithm: 'sha256',
    collectionGroups: validations,
    summary,
  }
  writeSanitizedReport(report)

  // Console output is deliberately aggregate-only and contains no document paths or fields.
  console.log(JSON.stringify({ ...summary, reportPath: REPORT_PATH }, null, 2))
  if (!summary.sourceFullyRepresentedInTarget) process.exitCode = 2
}

main().catch((error) => {
  console.error(error?.message || 'Firestore production validation failed.')
  process.exitCode = 1
})
