import assert from 'node:assert/strict'
import test from 'node:test'
import type { NutritionProfileDraft } from '../src/features/nutrition/types'
import {
  recentAverageWeight,
  resolveDailyNutritionTargets,
} from '../src/features/nutrition/dailyNutritionTargets'
import { calculateNutritionTargets } from '../src/services/nutritionSyncService'

const profile: NutritionProfileDraft = {
  goal: 'lose-fat',
  age: 31,
  biologicalSex: 'male',
  heightCm: 173,
  weightKg: 84,
  targetWeightDeltaKg: -6,
  targetTimeframeMonths: 4,
  targetSpeedPace: 'standard',
  activityLevel: 'moderate',
  trainingSessions: 4,
  eatingStyle: 'Không giới hạn',
  allergies: '',
  mealsPerDay: 3,
}

test('daily targets use the same canonical calculation and ignore legacy calorie overrides', () => {
  const legacyProfile = { ...profile, targetCalories: 999, protein: 1 }
  const result = resolveDailyNutritionTargets(legacyProfile, 84)
  const canonical = calculateNutritionTargets(profile)

  assert.equal(result.calorieGoal, canonical.targetCaloriesKcal)
  assert.equal(result.proteinGoal, canonical.proteinG)
  assert.notEqual(result.calorieGoal, legacyProfile.targetCalories)
})

test('incomplete profile does not receive fabricated body defaults', () => {
  const result = calculateNutritionTargets({ goal: 'lose-fat', biologicalSex: 'female' })
  assert.equal(result.configured, false)
  assert.equal(result.targetCaloriesKcal, 0)
  assert.equal(result.proteinG, 0)
  assert.equal(resolveDailyNutritionTargets(null).configured, false)
})

test('calorie target always equals the energy represented by canonical macros', () => {
  const profiles = [
    { age: 37, biologicalSex: 'female' as const, heightCm: 160, weightKg: 80, targetWeightDeltaKg: -15, targetTimeframeMonths: 3, activityLevel: 'sedentary' as const, primaryGoal: 'fat_loss' as const },
    { age: 28, biologicalSex: 'female' as const, heightCm: 168, weightKg: 58, activityLevel: 'moderate' as const, primaryGoal: 'maintenance' as const },
    { age: 32, biologicalSex: 'male' as const, heightCm: 178, weightKg: 82, activityLevel: 'high' as const, primaryGoal: 'muscle_gain' as const },
  ]

  profiles.forEach((profile) => {
    const result = calculateNutritionTargets(profile)
    assert.equal(result.targetCaloriesKcal, result.proteinG * 4 + result.carbsG * 4 + result.fatG * 9)
    assert.equal(result.targetCaloriesKcal, result.macroCaloriesKcal)
  })
  assert.equal(calculateNutritionTargets(profiles[0]).targetAdjustmentReason, 'macro_minimums')
})

test('recent weight average includes only valid entries in the latest 30 days', () => {
  const result = recentAverageWeight([
    { date: '2026-08-01', weightKg: 84 },
    { date: '2026-08-20', weightKg: 82 },
    { date: '2026-07-01', weightKg: 95 },
    { date: '2026-08-29', weightKg: 70 },
    { date: 'invalid', weightKg: 60 },
  ], 86, new Date(2026, 7, 28))

  assert.equal(result, 83)
  assert.equal(recentAverageWeight([], 86, new Date(2026, 7, 28)), 86)
})
