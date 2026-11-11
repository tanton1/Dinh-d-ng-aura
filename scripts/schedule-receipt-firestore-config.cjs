'use strict'

// Applies the schedule receipt retention from firestore.indexes.json: a TTL on
// expiresAt of ptScheduleCommandReceipts and ptScheduleAdminEditReceipts, with
// indexing disabled on that field. Only this configuration is changed; the
// command deletes no document. Receipts written before the field existed have
// no expiresAt and are never deleted by the policy. Reuses the CRM field helper.
const path = require('node:path')
const { accessToken, requestJson, assertTarget } = require('./firebase-firestore-index-deploy.cjs')
const { configure, ready, DATABASE } = require('./crm-firestore-config.cjs')

const RECEIPT_COLLECTIONS = Object.freeze(['ptScheduleAdminEditReceipts', 'ptScheduleCommandReceipts'])
const CONFIRMATION = `${DATABASE}/schedule-receipts:configure-retention`

function scheduleReceiptOverrides(indexes = require(path.join(__dirname, '..', 'firestore.indexes.json'))) {
  const overrides = (indexes.fieldOverrides || []).filter(item => RECEIPT_COLLECTIONS.includes(item.collectionGroup))
  const found = overrides.map(item => item.collectionGroup).sort()
  if (found.length !== RECEIPT_COLLECTIONS.length || found.some((name, index) => name !== RECEIPT_COLLECTIONS[index])) {
    throw new Error('Expected exactly one override for each schedule receipt collection.')
  }
  for (const item of overrides) {
    if (item.fieldPath !== 'expiresAt' || item.ttl !== true) throw new Error(`${item.collectionGroup} must have a TTL on expiresAt only.`)
    if (!Array.isArray(item.indexes) || item.indexes.length) throw new Error(`${item.collectionGroup}.expiresAt must disable indexes.`)
  }
  return overrides
}

async function main() {
  const [mode = 'status', confirmation, ...extra] = process.argv.slice(2)
  if (!['status', 'apply'].includes(mode) || extra.length || mode === 'apply' && confirmation !== `--confirm=${CONFIRMATION}` || mode === 'status' && confirmation) {
    throw new Error(`Use status, or apply --confirm=${CONFIRMATION}`)
  }
  const token = await accessToken()
  await assertTarget(token)
  const request = (endpoint, options) => requestJson(token, endpoint, options)
  const overrides = scheduleReceiptOverrides()
  const changes = await configure(request, mode === 'apply', overrides)
  if (mode === 'status') { console.log(JSON.stringify({ mode, fields: changes }, null, 2)); return }
  for (let attempt = 0; attempt < 90; attempt++) {
    const state = await configure(request, false, overrides)
    if (ready(state)) { console.log(JSON.stringify({ scheduleReceipts: true, ready: true, fields: state }, null, 2)); return }
    await new Promise(resolve => setTimeout(resolve, 10_000))
  }
  throw new Error('Schedule receipt TTL is not active yet. Inspect status before relying on it.')
}

module.exports = { scheduleReceiptOverrides, RECEIPT_COLLECTIONS, CONFIRMATION }

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exit(1) })
}
