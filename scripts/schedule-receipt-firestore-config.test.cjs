const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const { configure, ready, DATABASE } = require('./crm-firestore-config.cjs')
const { scheduleReceiptOverrides, RECEIPT_COLLECTIONS, CONFIRMATION } = require('./schedule-receipt-firestore-config.cjs')

const defaultPath = '/collectionGroups/__default__/fields/*'

test('schedule receipt retention covers exactly the two large receipt collections', () => {
  const overrides = scheduleReceiptOverrides()
  assert.deepEqual(overrides.map(item => item.collectionGroup).sort(), ['ptScheduleAdminEditReceipts', 'ptScheduleCommandReceipts'])
  assert.deepEqual([...RECEIPT_COLLECTIONS], ['ptScheduleAdminEditReceipts', 'ptScheduleCommandReceipts'])
  assert.ok(overrides.every(item => item.fieldPath === 'expiresAt' && item.ttl === true && item.indexes.length === 0))
  assert.ok(CONFIRMATION.endsWith('/schedule-receipts:configure-retention'))
  const command = { collectionGroup: 'ptScheduleCommandReceipts', fieldPath: 'expiresAt', ttl: true, indexes: [] }
  const adminEdit = { ...command, collectionGroup: 'ptScheduleAdminEditReceipts' }
  assert.equal(scheduleReceiptOverrides({ fieldOverrides: [command, adminEdit, { collectionGroup: 'notifications', fieldPath: 'expiresAt', ttl: true, indexes: [] }] }).length, 2)
  assert.throws(() => scheduleReceiptOverrides({ fieldOverrides: [command] }), /exactly one/)
  assert.throws(() => scheduleReceiptOverrides({ fieldOverrides: [command, command] }), /exactly one/)
  assert.throws(() => scheduleReceiptOverrides({ fieldOverrides: [command, { ...adminEdit, ttl: false }] }), /TTL on expiresAt/)
  assert.throws(() => scheduleReceiptOverrides({ fieldOverrides: [command, { ...adminEdit, fieldPath: 'createdAt' }] }), /TTL on expiresAt/)
  assert.throws(() => scheduleReceiptOverrides({ fieldOverrides: [command, { ...adminEdit, indexes: [{ order: 'ASCENDING' }] }] }), /disable indexes/)
})

test('apply enables the TTL on the two receipt fields and writes nothing else', async () => {
  const writes = []
  const state = await configure(async (endpoint, options) => {
    if (endpoint === defaultPath) return { name: DATABASE + endpoint, indexConfig: {} }
    assert.ok(RECEIPT_COLLECTIONS.some(name => endpoint.startsWith(`/collectionGroups/${name}/fields/expiresAt`)), endpoint)
    if (options) {
      assert.equal(options.method, 'PATCH')
      writes.push({ endpoint, ...JSON.parse(options.body) })
      return {}
    }
    return { name: DATABASE + endpoint, indexConfig: { usesAncestorConfig: true, ancestorField: DATABASE + defaultPath } }
  }, true, scheduleReceiptOverrides())
  assert.deepEqual(writes.map(write => write.endpoint).sort(), [
    '/collectionGroups/ptScheduleAdminEditReceipts/fields/expiresAt?updateMask=ttlConfig',
    '/collectionGroups/ptScheduleCommandReceipts/fields/expiresAt?updateMask=ttlConfig',
  ])
  for (const write of writes) assert.deepEqual(write.ttlConfig, {})
  // The policy only counts once Firestore reports it ACTIVE.
  assert.equal(ready(state), false)
  assert.equal(ready(state.map(field => ({ ...field, ttlState: 'ACTIVE' }))), true)
})

test('status mode never writes', async () => {
  const state = await configure(async (endpoint, options) => {
    assert.equal(options, undefined)
    if (endpoint === defaultPath) return { name: DATABASE + endpoint, indexConfig: {} }
    return { name: DATABASE + endpoint, indexConfig: { usesAncestorConfig: true, ancestorField: DATABASE + defaultPath } }
  }, false, scheduleReceiptOverrides())
  assert.deepEqual(state.map(field => field.changes), [['ttlConfig'], ['ttlConfig']])
})

test('the functions that write the receipts use the collections and the field the policy names', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'functions', file), 'utf8')
  assert.ok(read('pt-schedule-v2.js').includes('db.doc(`ptScheduleCommandReceipts/'))
  assert.ok(read('index.js').includes('db.doc(`ptScheduleAdminEditReceipts/'))
  const retention = read('command-receipt-retention.js')
  assert.ok(retention.includes('const COMMAND_RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000'))
  for (const file of ['pt-schedule-v2.js', 'pt-schedule-admin-edit.js']) assert.ok(read(file).includes('expiresAt: commandReceiptExpiresAt() })'), file)
})
