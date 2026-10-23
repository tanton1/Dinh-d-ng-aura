'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createProcessCache } = require('./process-cache')

test('invalidating a pending read prevents old completion from replacing post-mutation data', async () => {
  const cache = createProcessCache()
  let releaseOld
  const oldRead = cache.get('learner:a', () => new Promise((resolve) => { releaseOld = resolve }))
  await Promise.resolve()
  await cache.get('learner:b', async () => 'unaffected')
  cache.clear('learner:a')
  await cache.get('learner:a', async () => 'after mutation')
  releaseOld('before mutation')
  assert.equal((await oldRead).value, 'before mutation')
  assert.equal((await cache.get('learner:a', () => assert.fail('fresh cache lost'))).value, 'after mutation')
  assert.equal((await cache.get('learner:b', () => assert.fail('unrelated scope cleared'))).value, 'unaffected')
})

test('clearing all entries retires pending work without breaking request coalescing', async () => {
  const cache = createProcessCache()
  let finish
  const first = cache.get('a', () => new Promise((resolve) => { finish = resolve }))
  const joined = cache.get('a', () => assert.fail('duplicate read'))
  await Promise.resolve()
  cache.clear()
  finish('old')
  assert.equal((await first).value, 'old')
  assert.equal((await joined).coalesced, true)
  assert.equal(cache.entries.size, 0)
  assert.equal((await cache.get('a', async () => 'new')).value, 'new')
})
