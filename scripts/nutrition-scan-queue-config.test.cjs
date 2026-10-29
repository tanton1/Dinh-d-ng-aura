const assert = require('node:assert/strict')
const { test } = require('node:test')
const { configure, changesFor, DATABASE } = require('./nutrition-scan-queue-config.cjs')
test('retention deployment changes only the two queue fields and leaves active TTL untouched', async () => {
  const writes = []
  await configure(async (path, options) => {
    if (path === '/collectionGroups/__default__/fields/*') return { name: DATABASE + path, indexConfig: { indexes: [{ order: 'ASCENDING' }] } }
    assert.ok(path.startsWith('/collectionGroups/nutritionScanJobs/fields/'))
    if (options) { writes.push({ path, ...JSON.parse(options.body) }); return {} }
    return { name: DATABASE + path, indexConfig: { usesAncestorConfig: true, indexes: [] } }
  }, true)
  assert.equal(writes.length, 2)
  assert.equal(writes[0].path, '/collectionGroups/nutritionScanJobs/fields/*?updateMask=indexConfig')
  assert.equal(writes[0].ttlConfig, undefined)
  assert.deepEqual(writes[1].ttlConfig, {})
  assert.deepEqual(changesFor('*', { name: `${DATABASE}/collectionGroups/nutritionScanJobs/fields/*`, indexConfig: {} }).mask, [])
  assert.deepEqual(changesFor('expiresAt', { name: `${DATABASE}/collectionGroups/nutritionScanJobs/fields/expiresAt`, indexConfig: { usesAncestorConfig: false, indexes: [] }, ttlConfig: { state: 'ACTIVE' } }).mask, [])
  assert.throws(() => changesFor('other', { name: DATABASE }), /identity/)
  assert.throws(() => changesFor('*', { name: 'other/collectionGroups/nutritionScanJobs/fields/*' }), /identity/)
})

test('Enterprise empty default indexes satisfy readiness without repeated exemption writes', async () => {
  const defaultPath = '/collectionGroups/__default__/fields/*'
  const result = await configure(async (path, options) => {
    assert.equal(options, undefined, 'already empty effective indexes must not be patched')
    if (path === defaultPath) return { name: DATABASE + path, indexConfig: {} }
    return { name: DATABASE + path, indexConfig: { usesAncestorConfig: true, ancestorField: DATABASE + defaultPath }, ttlConfig: { state: 'ACTIVE' } }
  }, true)
  assert.ok(result.every(field => field.indexesDisabled && field.changes.length === 0))
})
