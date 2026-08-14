import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fitNutritionImageDimensions,
  optimizeNutritionImageForUpload,
} from '../src/services/nutritionImageOptimizer'

test('keeps a small landscape image unchanged', () => {
  assert.deepEqual(fitNutritionImageDimensions(1024, 768), { width: 1024, height: 768 })
})

test('limits a landscape image to 1280 pixels without changing its ratio', () => {
  assert.deepEqual(fitNutritionImageDimensions(4032, 3024), { width: 1280, height: 960 })
})

test('limits a portrait image to 1280 pixels without changing its ratio', () => {
  assert.deepEqual(fitNutritionImageDimensions(3024, 4032), { width: 960, height: 1280 })
})

test('returns the original blob when browser image APIs are unavailable', async () => {
  const original = new Blob(['food-photo'], { type: 'image/jpeg' })
  const optimized = await optimizeNutritionImageForUpload(original)
  assert.equal(optimized, original)
})
