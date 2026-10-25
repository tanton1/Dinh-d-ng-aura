import test from 'node:test'
import assert from 'node:assert/strict'
import { periodEnergy, completeMealDates } from '../src/features/nutrition/progressNutrition'
import { resolveDailyNutritionTargets } from '../src/features/nutrition/dailyNutritionTargets'
import { scaleCatalogServing } from '../src/features/nutrition/servings'
import { completeProgressSummary, progressAdherence, progressDateKeys, progressSummaryRanges } from '../src/features/nutrition/progressDailySummary'
import { createRequire } from 'node:module'
const { summarizeDay } = createRequire(import.meta.url)('../functions/nutrition-daily-summary.js')
const profile = { goal: 'maintain' as const, age: 30, biologicalSex: 'female' as const, heightCm: 165, weightKg: 60, activityLevel: 'sedentary' as const, trainingSessions: 3, eatingStyle: '', allergies: '' }

test('90-day report preserves complete meal occasions beyond the old 1000-log cap', () => {
  const dates = progressDateKeys('2026-07-27', '2026-10-24')
  const meals = dates.flatMap(date => Array.from({ length: 20 }, (_, index) => ({ date, status: 'logged' as const,
    type: (['breakfast', 'lunch', 'dinner', 'snack'] as const)[index % 4], time: index % 8 < 4 ? '10:00' : '15:00' })))
  assert.equal(meals.length, 1800)
  const summaries = dates.map(date => ({ ...summarizeDay(date, { mealLogs: meals }), revision: 1, updatedAt: null }))
  assert.equal(completeProgressSummary(summaries, dates[0], dates.at(-1)!), true)
  assert.equal(progressAdherence(summaries, 90, 5, 3, 2000).mealDays, completeMealDates(meals, 5).size)
  assert.equal(progressAdherence(summaries, 90, 5, 3, 2000).mealDays, 90)
  assert.equal(completeMealDates(meals.slice(-1000), 5).size, 50, 'the old truncated source misses forty complete days')
})

test('progress ranges are bounded, gap-free and include leap days exactly once', () => {
  assert.deepEqual(progressSummaryRanges('2026-07-27', '2026-10-24'), [
    { fromDate: '2026-07-27', toDate: '2026-08-26' }, { fromDate: '2026-08-27', toDate: '2026-09-26' }, { fromDate: '2026-09-27', toDate: '2026-10-24' },
  ])
  assert.deepEqual(progressDateKeys('2024-02-28', '2024-03-01'), ['2024-02-28', '2024-02-29', '2024-03-01'])
  for (const [from, to] of [['2026-07-26', '2026-10-24'], ['2026-02-30', '2026-03-01'], ['2026-99-99', '2026-10-24']]) assert.throws(() => progressDateKeys(from, to))
})

test('unknown coverage, duplicate dates and malformed totals cannot be presented as a complete report', () => {
  const day = { ...summarizeDay('2026-10-24', {}), revision: 1, updatedAt: null }
  assert.equal(completeProgressSummary([day], day.date, day.date), true)
  for (const items of [[], [day, day], [{ ...day, mealOccasions: undefined }], [{ ...day, waterMl: -1 }], [{ ...day, activityCount: NaN }], [{ ...day, mealOccasions: { ...day.mealOccasions, snackCount: -1 } }]]) {
    assert.equal(completeProgressSummary(items, day.date, day.date), false)
  }
})
test('partial days are unknown, not inferred calorie deficits', () => {
  const day = '2026-09-06'
  const meals = [{ date: day, type: 'breakfast' as const, calories: 400 }]
  assert.equal(completeMealDates(meals).size, 0)
  assert.equal(periodEnergy(meals, [day], resolveDailyNutritionTargets(profile)).activeDays, 0)
})
test('energy uses TDEE once and historical snapshots when available', () => {
  const date = '2026-09-06'
  const snapshot = { formulaVersion: 'v2', calories: 1800, protein: 100, carbs: 230, fat: 53, tdee: 2000, waterMl: 2000, capturedAt: date }
  const meals = (['breakfast', 'lunch', 'dinner'] as const).map((type) => ({ date, type, calories: 600, targetSnapshot: snapshot }))
  const result = periodEnergy(meals, [date], resolveDailyNutritionTargets(profile))
  assert.equal(result.intake, 1800)
  assert.equal(result.basal, 2000)
  assert.equal(result.workout + result.dailyActivity + result.thermicEffect, 0)
})
test('plan to diary scales one source serving exactly once without inventing missing nutrients', () => {
  const food = { id: 'dish', name: 'Món', servingGrams: 200, calories: 400, protein: 30, carbs: 40, fat: 13, fiber: null, sodium: 400 }
  const result = scaleCatalogServing(food, 1.5)
  assert.equal(result.calories, 600)
  assert.equal(result.protein, 45)
  assert.equal(result.servingGrams, 300)
  assert.equal(result.sodium, 600)
  assert.equal(result.fiber, null)
  assert.equal(food.calories, 400)
  assert.throws(() => scaleCatalogServing(food, Number.NaN))
})
