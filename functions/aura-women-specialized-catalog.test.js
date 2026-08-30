const assert = require('node:assert/strict')
const test = require('node:test')
const { ITEMS, RELEASE, validateItems } = require('../scripts/import-aura-women-specialized-catalog.cjs')

test('specialized women catalog adds twenty complete create-only exercise records', () => {
  assert.equal(RELEASE, 'aura-women-specialized-20-v2')
  assert.doesNotThrow(() => validateItems(ITEMS))
  assert.equal(ITEMS.length, 20)
  assert.equal(new Set(ITEMS.map((item) => item.id)).size, 20)
  assert.equal(ITEMS.every((item) => item.status === 'published'), true)
  assert.equal(ITEMS.every((item) => item.instructionsVi.length >= 4), true)
  assert.equal(ITEMS.every((item) => item.cuesVi.length >= 3 && item.commonMistakesVi.length >= 3), true)
})

test('specialized women catalog fills lower body, upper body and core muscle gaps', () => {
  const labels = ITEMS.flatMap((item) => [...item.targetMuscles, ...item.secondaryMuscles])
  for (const expected of ['Mông nhỡ', 'Đùi trong', 'Bắp chân', 'Cơ xô', 'Vai giữa', 'Tay sau', 'Tay trước', 'Ngực', 'Cơ bụng dưới']) {
    assert.equal(labels.includes(expected), true, `Missing muscle group: ${expected}`)
  }
  assert.equal(ITEMS.some((item) => item.environment.includes('home')), true)
  assert.equal(ITEMS.every((item) => item.media.startImageUrl && item.media.endImageUrl), true)
})
