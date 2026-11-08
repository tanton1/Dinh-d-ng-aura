'use strict'

// Applies the CRM single-field settings from firestore.indexes.json that the
// create-only composite index helper does not touch: the 30-day TTL on raw
// Pancake webhook events and the index exemptions on large text fields.
const path = require('node:path')
const { accessToken, requestJson, assertTarget } = require('./firebase-firestore-index-deploy.cjs')
const DATABASE = 'projects/gen-lang-client-0815966909/databases/ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'
const CONFIRMATION = `${DATABASE}/crm:configure-retention`
const defaultFieldPath = '/collectionGroups/__default__/fields/*'
const fieldPath = ({ collectionGroup, fieldPath: field }) => `/collectionGroups/${collectionGroup}/fields/${field}`

function crmOverrides(indexes = require(path.join(__dirname, '..', 'firestore.indexes.json'))) {
  const overrides = (indexes.fieldOverrides || []).filter(item => item.collectionGroup.startsWith('crm'))
  for (const item of overrides) {
    if (!Array.isArray(item.indexes) || item.indexes.length) throw new Error(`CRM override ${item.collectionGroup}.${item.fieldPath} must disable indexes.`)
  }
  if (!overrides.length) throw new Error('No CRM field overrides found.')
  return overrides
}

const indexesDisabled = (current, emptyAncestors = new Set()) => Boolean(current.indexConfig)
  && current.indexConfig.reverting !== true && !(current.indexConfig.indexes?.length)
  && (current.indexConfig.usesAncestorConfig !== true || emptyAncestors.has(current.indexConfig.ancestorField))

function changesFor(override, current, emptyAncestors) {
  if (current.name !== DATABASE + fieldPath(override)) throw new Error('CRM field identity mismatch.')
  const body = { name: current.name }, mask = []
  if (!indexesDisabled(current, emptyAncestors)) {
    body.indexConfig = { indexes: [] }; mask.push('indexConfig')
  }
  if (override.ttl === true && !['ACTIVE', 'CREATING'].includes(current.ttlConfig?.state)) {
    body.ttlConfig = {}; mask.push('ttlConfig')
  }
  return { body, mask }
}

async function configure(request, apply = false, overrides = crmOverrides()) {
  const defaultField = await request(defaultFieldPath)
  if (defaultField.name !== DATABASE + defaultFieldPath) throw new Error('Default field identity mismatch.')
  const emptyAncestors = new Set(indexesDisabled(defaultField) ? [defaultField.name] : [])
  const result = []
  for (const override of overrides) {
    const current = await request(fieldPath(override))
    const { body, mask } = changesFor(override, current, emptyAncestors)
    if (apply && mask.length) {
      await request(`${fieldPath(override)}?updateMask=${mask.join(',')}`, { method: 'PATCH', body: JSON.stringify(body) })
    }
    result.push({
      field: `${override.collectionGroup}.${override.fieldPath}`,
      ttl: override.ttl === true,
      changes: mask,
      ttlState: current.ttlConfig?.state,
      indexesDisabled: indexesDisabled(current, emptyAncestors),
    })
  }
  return result
}

const ready = state => state.every(field => field.indexesDisabled && (!field.ttl || field.ttlState === 'ACTIVE'))

async function main() {
  const [mode = 'status', confirmation, ...extra] = process.argv.slice(2)
  if (!['status', 'apply'].includes(mode) || extra.length || mode === 'apply' && confirmation !== `--confirm=${CONFIRMATION}` || mode === 'status' && confirmation) {
    throw new Error(`Use status, or apply --confirm=${CONFIRMATION}`)
  }
  const token = await accessToken()
  await assertTarget(token)
  const request = (endpoint, options) => requestJson(token, endpoint, options)
  const changes = await configure(request, mode === 'apply')
  if (mode === 'status') { console.log(JSON.stringify({ mode, fields: changes }, null, 2)); return }
  for (let attempt = 0; attempt < 90; attempt++) {
    const state = await configure(request)
    if (ready(state)) { console.log(JSON.stringify({ crm: true, ready: true, fields: state }, null, 2)); return }
    await new Promise(resolve => setTimeout(resolve, 10_000))
  }
  throw new Error('CRM retention/index exemptions are not ready. Inspect status before relying on them.')
}

module.exports = { configure, changesFor, crmOverrides, ready, DATABASE, CONFIRMATION }
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
