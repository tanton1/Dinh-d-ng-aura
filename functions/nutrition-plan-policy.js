const { HttpsError } = require('firebase-functions/v2/https')
const { nutritionQuality, calculateNutritionTargets, canonicalNutritionProfile } = require('./nutrition-core.mjs')
const fold = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim()

function planItemIssues(item, profile = {}) {
  const issues = nutritionQuality(item, { requireBasis: true })
  const allergens = fold(profile.allergies)
  if (allergens && !['khong', 'khong co', 'none'].includes(allergens)) {
    if (!item.allergensVerified) issues.push('Chưa xác minh dị ứng/thành phần của món')
    else {
      const requested = allergens.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)
      const aliases = { milk: 'sua', dairy: 'sua', egg: 'trung', eggs: 'trung', peanut: 'dau phong', peanuts: 'dau phong', soy: 'dau nanh', soybean: 'dau nanh', wheat: 'gluten', fish: 'ca', shrimp: 'tom', crab: 'cua', shellfish: 'hai san', sesame: 'me', nuts: 'hat', 'tree nuts': 'hat' }
      const tags = (item.allergens || []).map((tag) => aliases[fold(tag)] || fold(tag))
      if (requested.some((term) => tags.some((tag) => tag.includes(term) || term.includes(tag) || term === 'hai san' && ['ca', 'tom', 'cua', 'muc', 'hai san'].includes(tag) || tag === 'hai san' && ['ca', 'tom', 'cua', 'muc'].includes(term)))) issues.push('Món có thành phần dị ứng đã khai báo')
      const known = ['sua', 'trung', 'dau phong', 'dau nanh', 'gluten', 'hai san', 'ca', 'tom', 'cua', 'hat', 'me']
      if (requested.some((term) => !known.includes(term))) issues.push('Dị ứng cần được chuyên gia chuẩn hóa trước khi tự tạo thực đơn')
    }
  }
  const style = fold(profile.eatingStyle)
  const tag = { 'an chay': 'vegetarian', 'thuan chay': 'vegan', 'khong gluten': 'gluten-free', 'it tinh bot': 'low-carb' }[style]
  if (tag && !(item.dietaryTags || []).includes(tag)) issues.push('Món chưa xác minh phù hợp chế độ ăn')
  const dislikes = fold(profile.dislikes).split(/[,;\n]+/).filter(Boolean)
  if (dislikes.some((term) => fold(item.name).includes(term.trim()))) issues.push('Món thuộc danh sách không thích')
  return issues
}

async function serverPlanProfile(db, userId, transaction) {
  const read = (ref) => transaction ? transaction.get(ref) : ref.get()
  const user = await read(db.doc(`users/${userId}`))
  if (!user.exists) throw new HttpsError('failed-precondition', 'Chưa có hồ sơ dinh dưỡng đã lưu.')
  const canonical = canonicalNutritionProfile(user.data())
  const profile = Object.fromEntries(['goal', 'age', 'biologicalSex', 'heightCm', 'weightKg', 'activityLevel', 'trainingSessions', 'targetWeightKg', 'targetWeightDeltaKg', 'targetTimeframeMonths', 'targetTimeframeMode', 'targetSpeedPace', 'mealsPerDay', 'allergies', 'dislikes', 'eatingStyle', 'favoriteCuisine', 'budget', 'prepTime', 'healthConditions', 'medicalConditions', 'pregnant', 'breastfeeding'].filter((key) => canonical[key] !== undefined).map((key) => [key, canonical[key]]))
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const from = new Date(`${today}T12:00:00Z`); from.setUTCDate(from.getUTCDate() - 30)
  const weights = await read(db.collection(`users/${userId}/weightLogs`).where('date', '>=', from.toISOString().slice(0, 10)).where('date', '<=', today))
  const values = weights.docs.map((doc) => Number(doc.data()?.weightKg)).filter((n) => Number.isFinite(n) && n >= 20 && n <= 300)
  const effectiveWeight = values.length ? Math.round(values.reduce((sum, n) => sum + n, 0) / values.length * 10) / 10 : undefined
  const targets = calculateNutritionTargets(profile, effectiveWeight)
  if (!targets.configured) throw new HttpsError('failed-precondition', targets.issues.join(' '))
  return { profile, targets }
}

function validatePlanDays(days, input, requireWeek = true) {
  const issues = []
  const expected = Array.from({ length: 7 }, (_, i) => { const d = new Date(`${input.weekStart}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10) })
  if (requireWeek && (days.length !== 7 || new Set(days.map((d) => d.id)).size !== 7 || expected.some((id) => !days.some((d) => d.id === id)))) issues.push('Kế hoạch phải có đúng 7 ngày của tuần đã chọn.')
  const ids = new Set()
  for (const day of days) {
    const meals = Array.isArray(day.meals) ? day.meals : []
    if (meals.length !== input.mealsPerDay) issues.push(`${day.id}: cần ${input.mealsPerDay} bữa, hiện có ${meals.length}.`)
    const types = meals.map((meal) => meal.type)
    if (['breakfast', 'lunch', 'dinner'].some((type) => types.filter((t) => t === type).length !== 1) || types.filter((t) => t === 'snack').length !== input.mealsPerDay - 3) issues.push(`${day.id}: khung bữa chưa đúng.`)
    for (const meal of meals) {
      if (!meal.id || ids.has(meal.id)) issues.push(`${day.id}: mã bữa bị thiếu hoặc trùng.`)
      ids.add(meal.id)
      if (!(Number.isFinite(meal.servingMultiplier) && meal.servingMultiplier >= .1 && meal.servingMultiplier <= 5) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(meal.time) || meal.dayId !== day.id) issues.push(`${day.id} · ${meal.title}: ngày giờ/khẩu phần chưa hợp lệ.`)
      for (const reason of nutritionQuality(meal)) issues.push(`${day.id} · ${meal.title}: ${reason}.`)
    }
    for (const [key, target, tolerance, label] of [['calories', input.calorieGoal, .15, 'kcal'], ['protein', input.proteinGoal, .25, 'g đạm'], ['carbs', input.carbGoal, .3, 'g carb'], ['fat', input.fatGoal, .3, 'g béo']]) {
      if (!(target > 0)) { issues.push(`${day.id}: thiếu mục tiêu ${label}.`); continue }
      const total = meals.reduce((sum, meal) => sum + (Number(meal[key]) || 0), 0)
      if (Math.abs(total - target) > target * tolerance) issues.push(`${day.id}: ${Math.round(total)}/${Math.round(target)} ${label}, ngoài khoảng ±${Math.round(tolerance * 100)}%.`)
    }
  }
  return issues
}
module.exports = { planItemIssues, validatePlanDays, serverPlanProfile }
