// Pure, versioned policy shared by the browser and Node 22 Functions.
export const NUTRITION_FORMULA_VERSION = 'aura-nutrition-v2'
export const ACTIVITY_MULTIPLIERS = Object.freeze({ sedentary: 1.2, light: 1.375, moderate: 1.55, high: 1.725 })
export function normalizeActivity(value) {
  return value === 'low' ? 'light' : Object.hasOwn(ACTIVITY_MULTIPLIERS, value) ? value : null
}
const number = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null
const round = (value) => Math.round(value * 10) / 10
const fold = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase()
export function canonicalNutritionProfile(user = {}) {
  const profile = { ...(user.nutritionProfile || user) }
  if (user.nutritionProfile) {
    for (const key of ['biologicalSex', 'activityLevel', 'targetWeightDeltaKg', 'targetTimeframeMonths', 'targetSpeedPace', 'pregnant', 'breastfeeding', 'medicalConditions']) {
      if (profile[key] === undefined && user[key] !== undefined) profile[key] = user[key]
    }
    if (user.goals?.[0]) profile.goal = user.goals[0]
  }
  for (const key of ['heightCm', 'weightKg', 'healthConditions']) {
    if (user[key] !== undefined && user[key] !== null) profile[key] = user[key]
  }
  profile.age = number(profile.age) ?? (number(user.birthYear) ? new Date().getFullYear() - Number(user.birthYear) : undefined)
  profile.goal = ({ fat_loss: 'lose-fat', muscle_gain: 'gain-muscle', maintenance: 'maintain', health: 'maintain' })[profile.goal || user.goals?.[0] || user.primaryGoal] || profile.goal || user.goals?.[0]
  profile.activityLevel = normalizeActivity(profile.activityLevel)
  // Convert legacy delta against the stored baseline, never today's weight trend.
  const baseline = number(user.nutritionProfile?.weightKg) ?? number(profile.weightKg)
  const delta = number(profile.targetWeightDeltaKg)
  const absolute = number(profile.targetWeightKg) ?? number(user.onboardingData?.targetWeightKg)
  profile.targetWeightKg = absolute ?? (delta !== null && baseline !== null ? round(baseline + delta) : undefined)
  return profile
}
export function calculateNutritionTargets(data = {}, effectiveWeight) {
  const weight = number(effectiveWeight) ?? number(data.weightKg)
  const height = number(data.heightCm), age = number(data.age)
  const goal = ({ fat_loss: 'lose-fat', muscle_gain: 'gain-muscle', maintenance: 'maintain', health: 'maintain' })[data.goal || data.primaryGoal] || data.goal || data.primaryGoal
  const activity = normalizeActivity(data.activityLevel)
  const issues = []
  if (weight === null || weight < 20 || weight > 300 || height === null || height < 80 || height > 250 || age === null || age < 18 || age > 100 || !['male', 'female'].includes(data.biologicalSex) || !['lose-fat', 'gain-muscle', 'maintain'].includes(goal) || !activity) issues.push('Cần hồ sơ người trưởng thành đầy đủ: tuổi, giới tính sinh học, chiều cao, cân nặng, mục tiêu và mức vận động.')
  const health = fold([...(Array.isArray(data.healthConditions) ? data.healthConditions : [data.healthConditions]), data.medicalConditions].filter(Boolean).join(' '))
  if (data.pregnant === true || data.breastfeeding === true || /mang thai|cho con bu|pregnan|breastfeed|benh than|suy than|kidney|renal|tieu duong|diabet|huyet ap|hypertension|roi loan an uong|eating disorder/.test(health)) issues.push('Hồ sơ có lưu ý sức khỏe. Cần chuyên gia duyệt mục tiêu trước khi tự tạo thực đơn.')
  const explicitDelta = number(data.targetWeightDeltaKg)
  const baseline = number(data.weightKg)
  const targetWeight = number(data.targetWeightKg) ?? (baseline !== null ? round(baseline + (explicitDelta ?? (goal === 'lose-fat' ? -4 : goal === 'gain-muscle' ? 3 : 0))) : null)
  const originalDelta = explicitDelta ?? (targetWeight !== null && baseline !== null ? targetWeight - baseline : 0)
  if (goal === 'lose-fat' && originalDelta > 0.05 || goal === 'gain-muscle' && originalDelta < -0.05) issues.push('Cân nặng đích không khớp mục tiêu giảm/tăng cân. Hãy chỉnh lại mục tiêu.')
  if (targetWeight !== null && (targetWeight < 20 || targetWeight > 300)) issues.push('Cân nặng đích không hợp lệ.')
  const pace = data.targetSpeedPace || ({ comfortable: 'slow', balanced: 'standard', fast: 'fast' })[data.pace]
  const delta = goal === 'maintain' ? 0 : goal === 'lose-fat' ? Math.min(0, (targetWeight ?? weight) - weight) : Math.max(0, (targetWeight ?? weight) - weight)
  let months = number(data.targetTimeframeMonths) ?? 3
  if (data.targetTimeframeMode === 'pace' || !number(data.targetTimeframeMonths) && pace) months = Math.max(1 / 4.33, Math.abs(delta) / ({ slow: .3, standard: .5, fast: .8 }[pace] || .5) / 4.33)
  if (!(months > 0 && months <= 36)) issues.push('Thời gian mục tiêu phải từ trên 0 đến 36 tháng.')
  const empty = { configured: false, formulaVersion: NUTRITION_FORMULA_VERSION, issues, bmr: 0, tdee: 0, targetCaloriesKcal: 0, proteinG: 0, carbsG: 0, fatG: 0, waterLiters: 0, stepsPerDay: 0, targetDelta: round(delta || 0), targetWeightKg: targetWeight, timeframeMonths: months, macroCaloriesKcal: 0, targetAdjustmentReason: null }
  if (issues.length) return empty
  const bmr = 10 * weight + 6.25 * height - 5 * age + (data.biologicalSex === 'male' ? 5 : -161)
  const tdee = bmr * ACTIVITY_MULTIPLIERS[activity]
  // Starting estimate only, not a promise of linear change or a medical floor.
  const adjustment = delta * 7700 / (months * 4.33 * 7)
  const boundedAdjustment = Math.min(tdee * .15, Math.max(-tdee * .25, adjustment))
  let calories = Math.min(4500, Math.max(1200, bmr * .95, tdee + boundedAdjustment))
  const proteinG = Math.round(weight * (goal === 'gain-muscle' ? 2.2 : goal === 'lose-fat' ? 2 : 1.6))
  const fatG = Math.max(45, Math.round(weight * .8))
  const minimum = proteinG * 4 + fatG * 9 + 80 * 4
  const reason = minimum > calories ? 'macro_minimums' : adjustment !== boundedAdjustment ? 'pace_limited' : null
  const carbsG = Math.max(80, Math.round((Math.max(calories, minimum) - proteinG * 4 - fatG * 9) / 4))
  calories = proteinG * 4 + carbsG * 4 + fatG * 9
  if (calories > 5000) return { ...empty, issues: ['Mục tiêu ngoài phạm vi tự động; cần chuyên gia kiểm tra.'] }
  return { ...empty, configured: true, issues: [], bmr: Math.round(bmr), tdee: Math.round(tdee), targetCaloriesKcal: calories, proteinG, carbsG, fatG, waterLiters: Math.min(4000, Math.max(1500, Math.round(weight * 35 / 100) * 100)) / 1000, stepsPerDay: activity === 'high' ? 10000 : activity === 'moderate' ? 8000 : 5000, macroCaloriesKcal: calories, targetAdjustmentReason: reason }
}
export function nutritionQuality(item, { requireBasis = false } = {}) {
  const reasons = []
  const values = ['calories', 'protein', 'carbs', 'fat'].map((key) => number(item[key]))
  if (values.some((v) => v === null || v < 0) || !(values[0] > 0)) reasons.push('Thiếu kcal hoặc macro hợp lệ')
  else if (Math.abs(values[1] * 4 + values[2] * 4 + values[3] * 9 - values[0]) / values[0] > .2) reasons.push('Kcal và macro lệch trên 20%; cần đối soát nguồn')
  const basis = item.basis
  if (requireBasis && (!(number(basis?.amount) > 0) || !['g', 'ml', 'serving', 'portion'].includes(basis?.unit) || basis?.qualifier === 'not_specified_by_source')) reasons.push('Chưa có khẩu phần chuẩn đã xác định')
  return reasons
}
