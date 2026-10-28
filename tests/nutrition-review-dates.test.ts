import assert from 'node:assert/strict'
import test from 'node:test'
import { reviewToday, reviewDateRange, shiftReviewDate } from '../src/features/nutrition-review/nutritionReviewDates'

test('review day follows Vietnam time across UTC midnight', () => {
  assert.equal(reviewToday(new Date('2026-10-27T16:59:59Z')), '2026-10-27')
  assert.equal(reviewToday(new Date('2026-10-27T17:00:00Z')), '2026-10-28')
})

test('week is Monday through Sunday across month and year boundaries', () => {
  assert.deepEqual(reviewDateRange('2027-01-01', 'week'), { startDate: '2026-12-28', endDate: '2027-01-03' })
  assert.deepEqual(reviewDateRange('2026-11-01', 'week'), { startDate: '2026-10-26', endDate: '2026-11-01' })
  assert.deepEqual(reviewDateRange('2026-11-01', 'day'), { startDate: '2026-11-01', endDate: '2026-11-01' })
  assert.equal(shiftReviewDate('2024-03-01', -1), '2024-02-29')
})
