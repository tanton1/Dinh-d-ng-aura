'use strict'

// Scope-locked retention rollout. Only TTL configuration can be changed; this
// command never deletes documents, invokes functions, or modifies indexes.
const fs = require('node:fs')
const path = require('node:path')
const PROJECT = 'gen-lang-client-0815966909'
const DATABASE = 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'
const COLLECTION = 'systemOperationsDashboardCache'
const BASE = `projects/${PROJECT}/databases/${DATABASE}`
const FIELD = `${BASE}/collectionGroups/${COLLECTION}/fields/expiresAt`
const CONFIRM = `${BASE}/${COLLECTION}:enable-ttl`

function parseArgs(args) {
  const mode = args[0] || 'status'
  if (!['status', 'enable', 'verify'].includes(mode)) throw new Error('Use status, enable or verify.')
  const flags = Object.fromEntries(args.slice(1).map(value => {
    const match = /^--(confirm|journal)=(.+)$/.exec(value)
    if (!match) throw new Error('Unknown or incomplete argument.')
    return [match[1], match[2]]
  }))
  if (mode === 'enable' && flags.confirm !== CONFIRM) throw new Error('Exact cache-only TTL confirmation required.')
  if (mode !== 'status' && !flags.journal) throw new Error('An explicit rollout journal is required.')
  return { mode, ...flags }
}

function validateSample(sample) {
  const prefix = `${BASE}/documents/${COLLECTION}/`
  const cacheKey = typeof sample?.name === 'string' && sample.name.startsWith(prefix) ? sample.name.slice(prefix.length) : ''
  // stableDashboardCacheKey produces a lowercase SHA-256 hex digest. Accept
  // only that exact document-id shape: URL fragments/query syntax must never
  // swallow or replace the expiresAt-only field mask on verification reads.
  if (!/^[a-f0-9]{64}$/.test(cacheKey) || typeof sample?.expiresAt !== 'string' || !Number.isFinite(Date.parse(sample.expiresAt))) throw new Error('Sample is outside the cache collection or has an invalid expiry.')
  return sample
}

function verifyEvidence(field, journal, checks) {
  if (field.name !== FIELD || journal.field !== FIELD) throw new Error('TTL target mismatch.')
  const active = field.ttlConfig?.state === 'ACTIVE'
  const witnessedDeletion = checks.some(check => check.expiredAtObservation && check.missing)
  return { active, witnessedDeletion, retirementReady: active && witnessedDeletion, note: 'A missing previously expired cache document is evidence of deletion; correlate with Scheduler logs to exclude a concurrent cleanup run.' }
}

async function accessToken() {
  const auth = require(path.join(process.env.APPDATA, 'npm/node_modules/firebase-tools/lib/auth.js'))
  const account = auth.getProjectDefaultAccount(process.cwd()) || auth.getGlobalDefaultAccount()
  if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI sign-in required.')
  return (await auth.getAccessToken(account.tokens.refresh_token, [])).access_token
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const token = await accessToken()
  async function request(resource, options = {}, allowMissing = false) {
    const response = await fetch(`https://firestore.googleapis.com/v1/${resource}`, {
      ...options, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(45_000),
    })
    if (allowMissing && response.status === 404) return null
    if (!response.ok) throw new Error(`Firestore API ${response.status} at ${resource.split('?')[0]}`)
    return response.json()
  }
  const database = await request(BASE)
  if (database.name !== BASE) throw new Error('Database identity mismatch.')
  const field = await request(FIELD)
  if (field.name !== FIELD) throw new Error('Field identity mismatch.')
  const now = new Date().toISOString()
  if (args.mode === 'status') {
    console.log(JSON.stringify({ at: now, field: FIELD, ttlState: field.ttlConfig?.state || 'DISABLED' }, null, 2))
    return
  }
  const journalPath = path.resolve(args.journal)
  let journal
  if (fs.existsSync(journalPath)) {
    journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'))
    if (journal.field !== FIELD) throw new Error('Journal target mismatch.')
  } else if (args.mode === 'verify') throw new Error('Rollout journal does not exist.')
  else {
    // Project only expiration timestamps. Never read the cached business value.
    const samples = await request(`${BASE}/documents:runQuery`, { method: 'POST', body: JSON.stringify({ structuredQuery: {
      select: { fields: [{ fieldPath: 'expiresAt' }] }, from: [{ collectionId: COLLECTION }],
      where: { fieldFilter: { field: { fieldPath: 'expiresAt' }, op: 'LESS_THAN_OR_EQUAL', value: { timestampValue: now } } }, limit: 3,
    } }) })
    journal = { schemaVersion: 1, field: FIELD, observedAt: now, previousTtlConfig: field.ttlConfig || null, samples: samples.filter(row => row.document).map(row => validateSample({ name: row.document.name, expiresAt: row.document.fields?.expiresAt?.timestampValue })), events: [] }
    fs.mkdirSync(path.dirname(journalPath), { recursive: true })
    fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2))
  }
  const save = () => fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2))
  if (args.mode === 'enable') {
    if (field.ttlConfig?.state === 'ACTIVE' || field.ttlConfig?.state === 'CREATING') {
      journal.events.push({ at: now, action: 'already-enabled-or-creating', state: field.ttlConfig.state })
    } else {
      // Persist intent first. If the network outcome is uncertain, status/verify
      // must be checked before another mutation; never silently replay enable.
      if (journal.events.some(event => event.action === 'enable-requested')) throw new Error('Enable was already attempted; inspect live status before any retry.')
      journal.events.push({ at: now, action: 'enable-requested' }); save()
      const operation = await request(`${FIELD}?updateMask=ttlConfig`, { method: 'PATCH', body: JSON.stringify({ name: FIELD, ttlConfig: {} }) })
      journal.events.push({ at: new Date().toISOString(), action: 'enable-accepted', operation })
    }
    save()
    console.log(JSON.stringify({ at: now, journal: journalPath, samples: journal.samples.length, lastEvent: journal.events.at(-1), indexesModified: false }, null, 2))
    return
  }
  const checks = []
  for (const raw of journal.samples || []) {
    const sample = validateSample(raw)
    const document = await request(`${sample.name}?mask.fieldPaths=expiresAt`, {}, true)
    checks.push({ name: sample.name, expiredAtObservation: Date.parse(sample.expiresAt) <= Date.parse(journal.observedAt), missing: !document, currentExpiry: document?.fields?.expiresAt?.timestampValue || null })
  }
  const result = { at: now, ...verifyEvidence(field, journal, checks), ttlState: field.ttlConfig?.state || 'DISABLED', checks }
  journal.events.push({ action: 'verification', ...result }); save()
  console.log(JSON.stringify(result, null, 2))
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { parseArgs, validateSample, verifyEvidence, FIELD, BASE, COLLECTION, CONFIRM }
