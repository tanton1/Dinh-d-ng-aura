import assert from 'node:assert/strict'
import test from 'node:test'
import { detailSlideIndex, durationLabel, mealImageShape } from '../src/features/nutrition-review/nutritionReviewDisplay'

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

test('meal review images choose a stable square or portrait frame from natural dimensions', () => {
  assert.equal(mealImageShape(1_080, 1_080), 'square')
  assert.equal(mealImageShape(1_600, 900), 'square')
  assert.equal(mealImageShape(1_000, 1_150), 'square')
  assert.equal(mealImageShape(900, 1_200), 'portrait')
  assert.equal(mealImageShape(1_080, 1_920), 'portrait')
  assert.equal(mealImageShape(0, 1_920), 'square')
})

test('swipe position resolves to the nearest bounded detail slide', () => {
  assert.equal(detailSlideIndex(0, 390), 0)
  assert.equal(detailSlideIndex(210, 390), 1)
  assert.equal(detailSlideIndex(390, 390), 1)
  assert.equal(detailSlideIndex(780, 390), 2)
  assert.equal(detailSlideIndex(2_000, 390), 2)
  assert.equal(detailSlideIndex(Number.NaN, 390), 0)
})
