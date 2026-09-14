import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clearDailyNutritionCache, readDailyNutritionCache, writeDailyNutritionCache } from '../src/features/nutrition/dailyNutritionSummaryCache'
import { createInitialMeals, loadPersistedMeals } from '../src/features/nutrition/localState'

test('daily nutrition cache isolates account and date while merging meal and water updates', () => {
  clearDailyNutritionCache()
  writeDailyNutritionCache('account-a', '2026-09-14', {
    meals: [{ id: 'meal-1', date: '2026-09-14', type: 'lunch', label: 'Trưa', time: '12:00', title: 'Cơm gà', description: '', calories: 500, protein: 35, carbs: 60, fat: 12, status: 'logged', tone: 'green' }],
  })
  writeDailyNutritionCache('account-a', '2026-09-14', {
    water: [{ id: 'water-1', date: '2026-09-14', time: '08:00', amountMl: 350 }],
  })
  const current = readDailyNutritionCache('account-a', '2026-09-14')
  assert.equal(current?.meals.length, 1)
  assert.equal(current?.water[0]?.amountMl, 350)
  assert.equal(readDailyNutritionCache('account-b', '2026-09-14'), null)
  assert.equal(readDailyNutritionCache('account-a', '2026-09-15'), null)
})

test('daily nutrition cache can clear one account without affecting another', () => {
  clearDailyNutritionCache()
  writeDailyNutritionCache('account-a', '2026-09-14', { meals: [] })
  writeDailyNutritionCache('account-b', '2026-09-14', { meals: [] })
  clearDailyNutritionCache('account-a')
  assert.equal(readDailyNutritionCache('account-a', '2026-09-14'), null)
  assert.ok(readDailyNutritionCache('account-b', '2026-09-14'))
})

test('first demo nutrition session keeps the initial meals until the user clears them', () => {
  const values = new Map<string, string>()
  ;(globalThis as typeof globalThis & { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  }
  const fallback = createInitialMeals()
  assert.equal(loadPersistedMeals('demo-meals', fallback).length, fallback.length)
  values.set('demo-meals', '[]')
  assert.deepEqual(loadPersistedMeals('demo-meals', fallback), [])
})
