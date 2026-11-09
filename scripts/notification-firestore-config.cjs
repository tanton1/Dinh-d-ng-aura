'use strict'

// Applies the notification inbox retention from firestore.indexes.json: a TTL
// on users/{uid}/notifications.expiresAt (collection group `notifications`)
// with indexing disabled on that field. Items without expiresAt are never
// deleted; producers set it per notice kind. Reuses the CRM field helper.
const path = require('node:path')
const { accessToken, requestJson, assertTarget } = require('./firebase-firestore-index-deploy.cjs')
const { configure, ready, DATABASE } = require('./crm-firestore-config.cjs')

const CONFIRMATION = `${DATABASE}/notifications:configure-retention`

function notificationOverrides(indexes = require(path.join(__dirname, '..', 'firestore.indexes.json'))) {
  const overrides = (indexes.fieldOverrides || []).filter(item => item.collectionGroup === 'notifications')
  if (overrides.length !== 1 || overrides[0].fieldPath !== 'expiresAt' || overrides[0].ttl !== true) {
    throw new Error('Expected exactly one TTL override on notifications.expiresAt.')
  }
  if (!Array.isArray(overrides[0].indexes) || overrides[0].indexes.length) throw new Error('notifications.expiresAt must disable indexes.')
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
  const overrides = notificationOverrides()
  const changes = await configure(request, mode === 'apply', overrides)
  if (mode === 'status') { console.log(JSON.stringify({ mode, fields: changes }, null, 2)); return }
  for (let attempt = 0; attempt < 90; attempt++) {
    const state = await configure(request, false, overrides)
    if (ready(state)) { console.log(JSON.stringify({ notifications: true, ready: true, fields: state }, null, 2)); return }
    await new Promise(resolve => setTimeout(resolve, 10_000))
  }
  throw new Error('Notification TTL is not active yet. Inspect status before relying on it.')
}

module.exports = { notificationOverrides, CONFIRMATION }

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exit(1) })
}
