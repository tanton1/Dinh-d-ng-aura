'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { cleanupNutritionImages } = require('./nutrition-retention')

function fixture() {
  let state = {}, fail = false
  const removed = []
  const now = Date.parse('2026-10-24T00:00:00Z')
  const file = (name, purpose = 'food-analysis', fresh = false) => ({ name, metadata: { metadata: { purpose }, timeCreated: new Date(now - (fresh ? 1000 : 90_000_000)).toISOString() }, delete: async () => { if (fail) throw new Error('retry'); removed.push(name) } })
  const pages = {
    '': [Array.from({ length: 500 }, (_, i) => file(`nutrition-scans/first/${i}`, 'unknown')), { pageToken: 'second' }],
    second: [[file('nutrition-scans/old'), file('nutrition-scans/recent', 'food-analysis', true), file('users/u/meal-photos/keep')], { pageToken: 'third' }],
    third: [[file('nutrition-scans/last')], null],
  }
  const db = { doc: () => ({ get: async () => ({ data: () => state }), set: async value => { state = { ...state, ...value } } }) }
  const bucket = { getFiles: async options => pages[options.pageToken || ''] }
  return { db, bucket, now, removed, state: () => state, fail: value => { fail = value } }
}

test('cleanup moves past 500 retained objects and resumes the remaining pages', async () => {
  const f = fixture()
  const first = await cleanupNutritionImages({ ...f, maxPages: 1 })
  assert.equal(first.hasMore, true)
  assert.equal(f.state().pageToken, 'second')
  const second = await cleanupNutritionImages(f)
  assert.equal(second.hasMore, false)
  assert.deepEqual(f.removed, ['nutrition-scans/old', 'nutrition-scans/last'])
  assert.equal(f.state().pageToken, '')
})

test('failed object deletion does not advance past its page', async () => {
  const f = fixture()
  await cleanupNutritionImages({ ...f, maxPages: 1 })
  f.fail(true)
  await assert.rejects(cleanupNutritionImages(f), /retry/)
  assert.equal(f.state().pageToken, 'second')
  f.fail(false)
  await cleanupNutritionImages(f)
  assert.equal(f.state().pageToken, '')
})
