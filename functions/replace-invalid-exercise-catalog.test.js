const assert = require('node:assert/strict')
const test = require('node:test')
const { ITEMS, RELEASE, canonicalItems, invalidLegacyDocuments, replacementPlan } = require('../scripts/replace-invalid-exercise-catalog.cjs')

test('replacement catalog contains thirty complete female-focused exercises', () => {
  const items = canonicalItems()
  assert.equal(RELEASE, 'aura-women-30-v2')
  assert.equal(items.length, 30)
  assert.equal(new Set(items.map((item) => item.id)).size, 30)
  assert.equal(items.every((item) => item.status === 'published'), true)
  assert.equal(items.every((item) => item.targetMuscles.length >= 1 && item.secondaryMuscles.length >= 2), true)
  assert.equal(items.every((item) => item.instructionsVi.length >= 4), true)
  assert.equal(items.every((item) => item.cuesVi.length >= 3 && item.commonMistakesVi.length >= 3), true)
  assert.equal(items.every((item) => /^[a-f0-9]{64}$/.test(item.contentDigest)), true)
})

test('destructive plan only targets exactly 120 fedb review documents', () => {
  const legacy = Array.from({ length: 120 }, (_, index) => ({
    id: `fedb_old-${String(index).padStart(3, '0')}`,
    updateTime: `2026-08-29T00:00:${String(index % 60).padStart(2, '0')}Z`,
    data: { status: 'review' },
  }))
  const protectedDocuments = [
    { id: 'fedb_published', updateTime: '2026-08-29T00:02:00Z', data: { status: 'published' } },
    { id: 'aura_women_existing', updateTime: '2026-08-29T00:03:00Z', data: { status: 'review' } },
  ]
  assert.equal(invalidLegacyDocuments([...legacy, ...protectedDocuments]).length, 120)
  const plan = replacementPlan([...legacy, ...protectedDocuments], canonicalItems())
  assert.equal(plan.legacy.length, 120)
  assert.equal(plan.create.length, 30)
  assert.match(plan.digest, /^[a-f0-9]{64}$/)
})

test('destructive plan refuses partial or expanded legacy sets', () => {
  const documents = Array.from({ length: 119 }, (_, index) => ({ id: `fedb_old-${index}`, updateTime: String(index), data: { status: 'review' } }))
  assert.throws(() => replacementPlan(documents, canonicalItems()), /expected exactly 120/)
  documents.push({ id: 'fedb_old-119', updateTime: '119', data: { status: 'review' } })
  documents.push({ id: 'fedb_unexpected', updateTime: '120', data: { status: 'review' } })
  assert.throws(() => replacementPlan(documents, canonicalItems()), /expected exactly 120/)
})
