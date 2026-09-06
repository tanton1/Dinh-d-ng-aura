const test = require('node:test')
const assert = require('node:assert/strict')
const { calculateNutritionTargets, canonicalNutritionProfile, nutritionQuality } = require('./nutrition-core.mjs')
const { planItemIssues, validatePlanDays, serverPlanProfile } = require('./nutrition-plan-policy')
const profile = { age: 28, biologicalSex: 'female', heightCm: 162, weightKg: 80, goal: 'lose-fat', targetWeightDeltaKg: -10, targetTimeframeMonths: 3, activityLevel: 'moderate' }
test('target stays 70kg when recent weight drops from 80kg to 75kg', () => {
  const result = calculateNutritionTargets(profile, 75)
  assert.equal(result.targetWeightKg, 70)
  assert.equal(result.targetDelta, -5)
  assert.equal(calculateNutritionTargets(profile, 69).targetDelta, 0)
  const saved = canonicalNutritionProfile(profile)
  assert.equal(calculateNutritionTargets({ ...saved, weightKg: 75 }, 75).targetWeightKg, 70)
})
test('opposite goal, adolescents, unknown sex and clinical profiles are not auto prescribed', () => {
  for (const override of [{ targetWeightDeltaKg: 4 }, { age: 13 }, { biologicalSex: 'other' }, { healthConditions: ['Suy thận'] }, { pregnant: true }]) {
    const result = calculateNutritionTargets({ ...profile, ...override })
    assert.equal(result.configured, false)
    assert.ok(result.issues.length)
  }
})
test('activity aliases and explicit pace mode have deterministic behavior', () => {
  for (const activityLevel of ['sedentary', 'light', 'low', 'moderate', 'high']) assert.ok(calculateNutritionTargets({ ...profile, activityLevel }).tdee > 0)
  const slow = calculateNutritionTargets({ ...profile, targetTimeframeMode: 'pace', targetSpeedPace: 'slow' })
  const fast = calculateNutritionTargets({ ...profile, targetTimeframeMode: 'pace', targetSpeedPace: 'fast' })
  assert.ok(slow.timeframeMonths > fast.timeframeMonths)
  assert.equal(slow.targetCaloriesKcal, slow.proteinG * 4 + slow.carbsG * 4 + slow.fatG * 9)
})
const dish = { id: 'safe', name: 'Món đã xác minh', calories: 528, protein: 32, carbs: 64, fat: 16, basis: { amount: 300, unit: 'g' } }
test('bad macros and unknown serving basis are quarantined without changing source', () => {
  assert.ok(nutritionQuality({ ...dish, fat: 255 }).length)
  assert.ok(nutritionQuality({ ...dish, calories: null }).length)
  assert.ok(planItemIssues({ ...dish, basis: null }).length)
  assert.deepEqual(planItemIssues(dish), [])
})
test('allergy and diet checks fail closed even with a small catalog', () => {
  assert.ok(planItemIssues(dish, { allergies: 'Đậu phộng' }).length)
  assert.ok(planItemIssues({ ...dish, allergensVerified: true, allergens: ['tôm'] }, { allergies: 'hải sản' }).length)
  assert.ok(planItemIssues(dish, { eatingStyle: 'Thuần chay' }).length)
  assert.deepEqual(planItemIssues({ ...dish, dietaryTags: ['vegan'] }, { eatingStyle: 'Thuần chay' }), [])
})
test('weekly validation checks count, dates, macros and per-day totals', () => {
  const input = { weekStart: '2026-09-07', calorieGoal: 1584, proteinGoal: 96, carbGoal: 192, fatGoal: 48, mealsPerDay: 3 }
  const days = Array.from({ length: 7 }, (_, i) => { const id = `2026-09-${String(i + 7).padStart(2, '0')}`; return { id, meals: ['breakfast', 'lunch', 'dinner'].map((type) => ({ ...dish, id: `${id}-${type}`, dayId: id, title: dish.name, type, time: '12:00', servingMultiplier: 1 })) } })
  assert.deepEqual(validatePlanDays(days, input), [])
  days[1].meals.pop()
  assert.ok(validatePlanDays(days, input).some((s) => s.includes('2026-09-08')))
})
test('server computes its own target and does not leak account fields', async () => {
  const query = { where: () => query, get: async () => ({ docs: [] }) }
  const db = { doc: () => ({ get: async () => ({ exists: true, data: () => ({ role: 'super_admin', email: 'private', nutritionProfile: { ...profile, targetCalories: 800 } }) }) }), collection: () => query }
  const result = await serverPlanProfile(db, 'test')
  assert.equal(result.targets.targetCaloriesKcal, calculateNutritionTargets(profile).targetCaloriesKcal)
  assert.equal(result.profile.role, undefined)
  assert.equal(result.profile.email, undefined)
})
