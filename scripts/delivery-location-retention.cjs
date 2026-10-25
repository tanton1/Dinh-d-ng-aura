'use strict'

const fs = require('node:fs')
const path = require('node:path')
const BASE = 'projects/gen-lang-client-0815966909/databases/ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'
const COLLECTION = 'eatCleanLiveLocationViews'
const FIELD = `${BASE}/collectionGroups/${COLLECTION}/fields/expiresAt`
const CONFIRM = `${BASE}/${COLLECTION}:enable-ttl-before-first-write`

function parseArgs(argv) {
  const mode = argv[0] || 'status'
  const flags = Object.fromEntries(argv.slice(1).map(value => {
    const match = /^--(confirm|journal)=(.+)$/.exec(value)
    if (!match) throw Error('Unknown argument')
    return [match[1], match[2]]
  }))
  if (!['status', 'enable', 'verify'].includes(mode)) throw Error('Use status, enable or verify')
  if (mode === 'enable' && (flags.confirm !== CONFIRM || !flags.journal)) throw Error('Exact location-only confirmation and journal required')
  return { mode, ...flags }
}

function assertTarget(database, field) {
  if (database.name !== BASE || database.type !== 'FIRESTORE_NATIVE' || field.name !== FIELD) throw Error('Database/field identity mismatch')
}

function assertEmpty(documents) {
  if (!documents || !Array.isArray(documents.documents || [])) throw Error('Invalid namespace observation')
  if (documents.documents?.length || documents.nextPageToken) throw Error('Location namespace is not empty; inspect ownership before enabling retention')
}

async function accessToken() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_GHA_CREDS_PATH) {
    const { GoogleAuth } = require('google-auth-library')
    const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient()
    const result = await client.getAccessToken()
    if (!(typeof result === 'string' ? result : result?.token)) throw Error('No deployment access token')
    return typeof result === 'string' ? result : result.token
  }
  const auth = require(path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib/auth.js'))
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw Error('Firebase CLI sign-in required')
  return (await auth.getAccessToken(account.tokens.refresh_token, [])).access_token
}

async function main() {
  const args = parseArgs(process.argv.slice(2)), token = await accessToken()
  const request = async (resource, options = {}) => {
    const response = await fetch(`https://firestore.googleapis.com/v1/${resource}`, {
      ...options, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(45000),
    })
    if (!response.ok) throw Error(`Firestore metadata API ${response.status}`)
    return response.json()
  }
  const [database, field] = await Promise.all([request(BASE), request(FIELD)])
  assertTarget(database, field)
  const observation = { observedAt: new Date().toISOString(), database: BASE, edition: database.databaseEdition,
    location: database.locationId, field: FIELD, ttlState: field.ttlConfig?.state || 'DISABLED',
    indexes: field.indexConfig?.indexes ?? null, documentWrites: 0, indexChanges: 0 }
  if (args.mode === 'verify') {
    if (observation.ttlState !== 'ACTIVE') throw Error('Location TTL is not ACTIVE; do not deploy the location writer')
  } else if (args.mode === 'enable') {
    const journal = path.resolve(args.journal)
    // A response timeout is not permission to repeat a mutation. Read status
    // after an uncertain outcome and inspect the durable intent first.
    if (fs.existsSync(journal)) throw Error('Retention intent already recorded; inspect status before retrying')
    if (observation.ttlState === 'DISABLED') {
      const documents = await request(`${BASE}/documents/${COLLECTION}?pageSize=1&mask.fieldPaths=schemaVersion`)
      assertEmpty(documents)
      fs.mkdirSync(path.dirname(journal), { recursive: true })
      const intent = { ...observation, namespaceEmpty: true, state: 'requested' }
      fs.writeFileSync(journal, JSON.stringify(intent, null, 2) + '\n')
      const operation = await request(`${FIELD}?updateMask=ttlConfig`, { method: 'PATCH', body: JSON.stringify({ name: FIELD, ttlConfig: {} }) })
      fs.writeFileSync(journal, JSON.stringify({ ...intent, state: 'accepted', operation: operation.name }, null, 2) + '\n')
      observation.operation = operation.name
    } else if (!['ACTIVE', 'CREATING'].includes(observation.ttlState)) throw Error('Unexpected TTL state')
  }
  console.log(JSON.stringify(observation, null, 2))
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { BASE, FIELD, CONFIRM, parseArgs, assertTarget, assertEmpty }
