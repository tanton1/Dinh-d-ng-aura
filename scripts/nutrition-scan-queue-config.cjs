'use strict'

const { accessToken, requestJson, assertTarget } = require('./firebase-firestore-index-deploy.cjs')
const DATABASE = 'projects/gen-lang-client-0815966909/databases/ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'
const CONFIRMATION = `${DATABASE}/nutritionScanJobs:configure-retention`
const fields = Object.freeze(['*', 'expiresAt'])
const fieldPath = field => `/collectionGroups/nutritionScanJobs/fields/${field}`
const indexesDisabled = current => Boolean(current.indexConfig) && current.indexConfig.usesAncestorConfig !== true
  && current.indexConfig.reverting !== true && !(current.indexConfig.indexes?.length)

function changesFor(field, current) {
  if (!fields.includes(field) || current.name !== DATABASE + fieldPath(field)) throw new Error('Queue field identity mismatch.')
  const body = { name: current.name }, mask = []
  if (!indexesDisabled(current)) {
    body.indexConfig = { indexes: [] }; mask.push('indexConfig')
  }
  if (field === 'expiresAt' && !['ACTIVE', 'CREATING'].includes(current.ttlConfig?.state)) {
    body.ttlConfig = {}; mask.push('ttlConfig')
  }
  return { body, mask }
}

async function configure(request, apply = false) {
  const result = []
  for (const field of fields) {
    const current = await request(fieldPath(field))
    const { body, mask } = changesFor(field, current)
    if (apply && mask.length) {
      await request(`${fieldPath(field)}?updateMask=${mask.join(',')}`, { method: 'PATCH', body: JSON.stringify(body) })
    }
    result.push({ field, changes: mask, ttlState: current.ttlConfig?.state, indexesDisabled: indexesDisabled(current) })
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
