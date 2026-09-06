import test from 'node:test'
import assert from 'node:assert/strict'
import { periodEnergy, completeMealDates } from '../src/features/nutrition/progressNutrition'
import { resolveDailyNutritionTargets } from '../src/features/nutrition/dailyNutritionTargets'
import { scaleCatalogServing } from '../src/features/nutrition/servings'
const profile = { goal: 'maintain' as const, age: 30, biologicalSex: 'female' as const, heightCm: 165, weightKg: 60, activityLevel: 'sedentary' as const, trainingSessions: 3, eatingStyle: '', allergies: '' }
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
