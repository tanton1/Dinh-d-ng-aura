const assert = require('node:assert/strict')
const { test } = require('node:test')
const { configure, changesFor, crmOverrides, ready, DATABASE } = require('./crm-firestore-config.cjs')

const defaultPath = '/collectionGroups/__default__/fields/*'

test('CRM overrides come from firestore.indexes.json and only disable indexes', () => {
  const overrides = crmOverrides()
  assert.ok(overrides.some(item => item.collectionGroup === 'crmInboundEvents' && item.fieldPath === 'expiresAt' && item.ttl === true))
  assert.ok(overrides.some(item => item.collectionGroup === 'crmMessages' && item.fieldPath === 'text'))
  assert.ok(overrides.every(item => item.collectionGroup.startsWith('crm')))
  assert.throws(() => crmOverrides({ fieldOverrides: [{ collectionGroup: 'crmX', fieldPath: 'a', indexes: [{ order: 'ASCENDING' }] }] }), /disable/)
})

test('apply patches indexed fields, enables TTL once and leaves other collections alone', async () => {
  const writes = []
  const overrides = [
    { collectionGroup: 'crmInboundEvents', fieldPath: 'expiresAt', ttl: true, indexes: [] },
    { collectionGroup: 'crmMessages', fieldPath: 'text', indexes: [] },
  ]
  await configure(async (path, options) => {
    if (path === defaultPath) return { name: DATABASE + path, indexConfig: { indexes: [{ order: 'ASCENDING' }] } }
    assert.ok(path.startsWith('/collectionGroups/crm'))
    if (options) { writes.push({ path, ...JSON.parse(options.body) }); return {} }
    return { name: DATABASE + path, indexConfig: { usesAncestorConfig: true, ancestorField: DATABASE + defaultPath, indexes: [{ order: 'ASCENDING' }] } }
  }, true, overrides)
  assert.deepEqual(writes.map(write => write.path), [
    '/collectionGroups/crmInboundEvents/fields/expiresAt?updateMask=indexConfig,ttlConfig',
    '/collectionGroups/crmMessages/fields/text?updateMask=indexConfig',
  ])
  assert.deepEqual(writes[0].ttlConfig, {})
  assert.equal(writes[1].ttlConfig, undefined)
})

test('Enterprise empty defaults and active TTL need no writes and count as ready', async () => {
  const overrides = [{ collectionGroup: 'crmInboundEvents', fieldPath: 'expiresAt', ttl: true, indexes: [] }]
  const state = await configure(async (path, options) => {
    assert.equal(options, undefined)
    if (path === defaultPath) return { name: DATABASE + path, indexConfig: {} }
    return { name: DATABASE + path, indexConfig: { usesAncestorConfig: true, ancestorField: DATABASE + defaultPath }, ttlConfig: { state: 'ACTIVE' } }
  }, true, overrides)
  assert.ok(ready(state))
  assert.equal(ready([{ indexesDisabled: true, ttl: true, ttlState: 'CREATING' }]), false)
  assert.throws(() => changesFor(overrides[0], { name: 'other' }), /identity/)
})
