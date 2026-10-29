'use strict'

const { accessToken, requestJson, assertTarget } = require('./firebase-firestore-index-deploy.cjs')
const DATABASE = 'projects/gen-lang-client-0815966909/databases/ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'
const CONFIRMATION = `${DATABASE}/nutritionScanJobs:configure-retention`
const fields = Object.freeze(['*', 'expiresAt'])
const fieldPath = field => `/collectionGroups/nutritionScanJobs/fields/${field}`
const defaultFieldPath = '/collectionGroups/__default__/fields/*'
const indexesDisabled = (current, emptyAncestors = new Set()) => Boolean(current.indexConfig)
  && current.indexConfig.reverting !== true && !(current.indexConfig.indexes?.length)
  && (current.indexConfig.usesAncestorConfig !== true || emptyAncestors.has(current.indexConfig.ancestorField))

function changesFor(field, current, emptyAncestors) {
  if (!fields.includes(field) || current.name !== DATABASE + fieldPath(field)) throw new Error('Queue field identity mismatch.')
  const body = { name: current.name }, mask = []
  if (!indexesDisabled(current, emptyAncestors)) {
    body.indexConfig = { indexes: [] }; mask.push('indexConfig')
  }
  if (field === 'expiresAt' && !['ACTIVE', 'CREATING'].includes(current.ttlConfig?.state)) {
    body.ttlConfig = {}; mask.push('ttlConfig')
  }
  return { body, mask }
}

async function configure(request, apply = false) {
  // Enterprise Native databases may inherit an empty default configuration
  // even after an explicit empty exemption. Verify that ancestor rather than
  // requiring the Standard-edition usesAncestorConfig=false representation.
  const defaultField = await request(defaultFieldPath)
  if (defaultField.name !== DATABASE + defaultFieldPath) throw new Error('Default field identity mismatch.')
  const emptyAncestors = new Set(indexesDisabled(defaultField) ? [defaultField.name] : [])
  const result = []
  for (const field of fields) {
    const current = await request(fieldPath(field))
    const { body, mask } = changesFor(field, current, emptyAncestors)
    if (apply && mask.length) {
      await request(`${fieldPath(field)}?updateMask=${mask.join(',')}`, { method: 'PATCH', body: JSON.stringify(body) })
    }
    const disabled = indexesDisabled(current, emptyAncestors)
    if (disabled) emptyAncestors.add(current.name)
    result.push({ field, changes: mask, ttlState: current.ttlConfig?.state, indexesDisabled: disabled })
  }
  return result
}

async function main() {
  const [mode = 'status', confirmation, ...extra] = process.argv.slice(2)
  if (!['status', 'apply'].includes(mode) || extra.length || mode === 'apply' && confirmation !== `--confirm=${CONFIRMATION}` || mode === 'status' && confirmation) throw new Error('Use status, or apply with the exact queue retention confirmation.')
  const token = await accessToken()
  await assertTarget(token)
  const request = (endpoint, options) => requestJson(token, endpoint, options)
  const changes = await configure(request, mode === 'apply')
  if (mode === 'status') { console.log(JSON.stringify({ mode, fields: changes })); return }
  for (let attempt = 0; attempt < 90; attempt++) {
    const state = await configure(request)
    if (state.every(field => field.indexesDisabled) && state.find(field => field.field === 'expiresAt')?.ttlState === 'ACTIVE') {
      console.log(JSON.stringify({ collection: 'nutritionScanJobs', ready: true, fields: state })); return
    }
    await new Promise(resolve => setTimeout(resolve, 10_000))
  }
  throw new Error('Queue retention/index exemptions are not ready. Inspect status before releasing the frontend.')
}

module.exports = { configure, changesFor, DATABASE, CONFIRMATION }
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
