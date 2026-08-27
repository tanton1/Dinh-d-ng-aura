import assert from 'node:assert/strict'
import test from 'node:test'
import { durationLabel } from '../src/features/nutrition-review/nutritionReviewDisplay'

test('nutrition review wait time uses readable minute, hour and day labels', () => {
  assert.equal(durationLabel(0), '0 phút')
  assert.equal(durationLabel(59.9), '59 phút')
  assert.equal(durationLabel(60), '1 giờ')
  assert.equal(durationLabel(135), '2 giờ 15 phút')
  assert.equal(durationLabel(1_440), '1 ngày')
  assert.equal(durationLabel(32_677), '22 ngày 16 giờ')
})

test('nutrition review wait time safely normalizes invalid and negative values', () => {
  assert.equal(durationLabel(Number.NaN), '0 phút')
  assert.equal(durationLabel(-10), '0 phút')
})
