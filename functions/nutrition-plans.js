const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const {
  OPENROUTER_API_KEY,
  getOpenRouterApiKey,
  getOpenRouterModelCandidates,
  requestOpenRouterStructured,
} = require('./openrouter')

const PLAN_STATUS = new Set(['draft', 'active'])
const MEAL_TYPES = new Set(['breakfast', 'lunch', 'snack', 'dinner'])
const PLAN_CACHE_MS = 10 * 60 * 1000
const MEAL_TIMES = {
  breakfast: '07:30',
  lunch: '12:00',
  snack: '15:30',
  dinner: '18:30',
}

const geminiPlanSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    choices: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dayId: { type: 'string' },
          type: { type: 'string', enum: ['breakfast', 'lunch', 'snack', 'dinner'] },
          catalogId: { type: 'string' },
          servingMultiplier: { type: 'number' },
        },
        required: ['dayId', 'type', 'catalogId', 'servingMultiplier'],
      },
    },
  },
  required: ['choices'],
}

let catalogCache = { items: [], version: 'unavailable', expiresAt: 0 }
let catalogRequest = null

function foldText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function nutrientValue(value, keys) {
  const nutrients = Array.isArray(value) ? value : []
  for (const key of keys) {
    const entry = nutrients.find((candidate) => candidate && typeof candidate === 'object' && candidate.key === key)
    const number = finiteNumber(entry?.value)
    if (number !== null) return number
  }
  return null
}

function boundedNumber(value, label, minimum, maximum) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return Math.round(number * 10) / 10
}

function boundedString(value, label, maximum, required = true) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if ((required && !normalized) || normalized.length > maximum) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return normalized
}

function validateWeekStart(value) {
  const weekStart = boundedString(value, 'Tuần thực đơn', 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    throw new HttpsError('invalid-argument', 'Tuần thực đơn không hợp lệ.')
  }
  const date = new Date(`${weekStart}T12:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== weekStart) {
    throw new HttpsError('invalid-argument', 'Tuần thực đơn không hợp lệ.')
  }
  if (date.getUTCDay() !== 1) {
    throw new HttpsError('invalid-argument', 'Tuần thực đơn phải bắt đầu từ thứ Hai.')
  }
  return weekStart
}

function addUtcDays(dateKey, amount) {
  const date = new Date(`${dateKey}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function catalogItemFromSnapshot(snapshot) {
  const value = snapshot.data() || {}
  const macros = value.macros || {}
  const source = value.source || {}
  const category = value.category && typeof value.category === 'object' ? value.category : null
  return {
    id: snapshot.id,
    kind: value.kind === 'dish' || value.kind === 'food' ? value.kind : null,
    name: typeof value.nameVi === 'string' ? value.nameVi.trim() : '',
    nameAscii: foldText(value.nameAscii || value.nameVi),
    category: typeof category?.nameVi === 'string' ? category.nameVi.trim() : '',
    calories: finiteNumber(value.energyKcal) ?? nutrientValue(value.nutrients, ['energy']),
    protein: finiteNumber(macros.proteinG) ?? nutrientValue(value.nutrients, ['protein']),
    carbs: finiteNumber(macros.carbohydrateG) ?? nutrientValue(value.nutrients, ['carbohydrate', 'carbohydrates']),
    fat: finiteNumber(macros.fatG) ?? nutrientValue(value.nutrients, ['fat', 'total-fat']),
    image: typeof value.imageUrl === 'string' ? value.imageUrl : '',
    source: typeof source.publisher === 'string' ? source.publisher : 'Thư viện dinh dưỡng Aura',
    generatedAt: typeof value.catalogGeneratedAt === 'string' ? value.catalogGeneratedAt : '',
  }
}

async function loadPlanCatalog(db) {
  if (catalogCache.expiresAt > Date.now() && catalogCache.items.length) return catalogCache
  if (catalogRequest) return catalogRequest
  catalogRequest = db.collection('nutritionCatalog')
    .select('kind', 'nameVi', 'nameAscii', 'category', 'energyKcal', 'macros', 'nutrients', 'imageUrl', 'source', 'catalogGeneratedAt')
    .get()
    .then((snapshot) => {
      let version = ''
      const items = snapshot.docs.map(catalogItemFromSnapshot).filter((item) => {
        if (item.kind !== 'dish' || !item.name) return false
        if (item.calories === null || item.protein === null || item.carbs === null || item.fat === null) return false
        return item.calories >= 40 && item.calories <= 1600 && item.protein >= 0 && item.carbs >= 0 && item.fat >= 0
      })
      snapshot.docs.forEach((document) => {
        const generatedAt = document.data()?.catalogGeneratedAt
        if (typeof generatedAt === 'string' && generatedAt > version) version = generatedAt
      })
      catalogCache = {
        items,
        version: version || `catalog-${snapshot.size}`,
        expiresAt: Date.now() + PLAN_CACHE_MS,
      }
      return catalogCache
    })
    .finally(() => { catalogRequest = null })
  return catalogRequest
}

function mealSlots(mealsPerDay) {
  if (mealsPerDay <= 3) return [
    { type: 'breakfast', ratio: 0.28 },
    { type: 'lunch', ratio: 0.38 },
    { type: 'dinner', ratio: 0.34 },
  ]
  if (mealsPerDay >= 5) return [
    { type: 'breakfast', ratio: 0.22 },
    { type: 'snack', ratio: 0.09, time: '10:00' },
    { type: 'lunch', ratio: 0.32 },
    { type: 'snack', ratio: 0.10, time: '15:30' },
    { type: 'dinner', ratio: 0.27 },
  ]
  return [
    { type: 'breakfast', ratio: 0.25 },
    { type: 'lunch', ratio: 0.35 },
    { type: 'snack', ratio: 0.10 },
    { type: 'dinner', ratio: 0.30 },
  ]
}

function preferredForMeal(item, type) {
  const text = `${item.nameAscii} ${foldText(item.category)}`
  if (type === 'breakfast') {
    return /\b(banh|chao|pho|bun|xoi|trung|yen mach|ngu coc|sua|mi|sup)\b/.test(text) || item.calories <= 520
  }
  if (type === 'snack') {
    return /\b(trai cay|sinh to|sua chua|sua|hat|salad|goi|che|nuoc ep|chuoi|tao|bo|du du|thanh long)\b/.test(text)
      || item.calories <= 280
  }
  return item.calories >= 220
}

function avoidTokens(profile) {
  return foldText(`${profile.allergies || ''} ${profile.dislikes || ''}`)
    .split(' ')
    .filter((token) => token.length >= 3)
}

function stableTieBreaker(seed) {
  let hash = 2166136261
  for (const character of seed) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967295
}

function roundedMacro(value, multiplier) {
  return Math.round(value * multiplier * 10) / 10
}

function toPlanMeal(item, { dayId, type, time, index, targetCalories, targetProtein, goal }) {
  const multiplier = Math.min(1.5, Math.max(0.5, targetCalories / Math.max(item.calories, 1)))
  const roundedMultiplier = Math.round(multiplier * 10) / 10
  const protein = roundedMacro(item.protein, roundedMultiplier)
  const rationale = goal === 'gain-muscle'
    ? protein >= targetProtein * 0.85 ? 'Ưu tiên đủ đạm cho phục hồi' : 'Khẩu phần cân bằng theo mục tiêu ngày'
    : goal === 'lose-fat'
      ? 'Khẩu phần vừa mục tiêu năng lượng'
      : 'Đa dạng món và dễ duy trì'
  return {
    id: `${dayId}-${type}-${index + 1}`,
    catalogId: item.id,
    dayId,
    type,
    time: time || MEAL_TIMES[type],
    title: item.name,
    description: `${roundedMultiplier} khẩu phần theo nguồn · ${item.source}`,
    calories: Math.round(item.calories * roundedMultiplier),
    protein,
    carbs: roundedMacro(item.carbs, roundedMultiplier),
    fat: roundedMacro(item.fat, roundedMultiplier),
    image: item.image,
    source: item.source,
    servingMultiplier: roundedMultiplier,
    rationale,
  }
}

function choosePlanItem(items, input) {
  const { type, targetCalories, targetProtein, goal, usedNames, usedCategories, avoid, seed } = input
  let pool = items.filter((item) => preferredForMeal(item, type))
  if (!pool.length) pool = items
  if (avoid.length) {
    const safe = pool.filter((item) => !avoid.some((token) => item.nameAscii.includes(token)))
    if (safe.length >= 12) pool = safe
  }
  const unused = pool.filter((item) => !usedNames.has(item.nameAscii))
  if (unused.length >= 8) pool = unused
  return pool
    .map((item) => {
      const multiplier = Math.min(1.5, Math.max(0.5, targetCalories / Math.max(item.calories, 1)))
      const calories = item.calories * multiplier
      const protein = item.protein * multiplier
      const fatRatio = calories > 0 ? (item.fat * multiplier * 9) / calories : 0
      let score = Math.abs(calories - targetCalories) / Math.max(targetCalories, 1) * 80
      score += Math.max(0, targetProtein - protein) / Math.max(targetProtein, 1) * (goal === 'gain-muscle' ? 45 : 24)
      if (goal === 'lose-fat' && fatRatio > 0.42) score += (fatRatio - 0.42) * 70
      if (usedCategories.get(foldText(item.category)) >= 3) score += 12
      score += stableTieBreaker(`${seed}:${item.id}`) * 8
      return { item, score }
    })
    .sort((left, right) => left.score - right.score)[0]?.item || null
}

function generatePlanDays(items, input) {
  const slots = mealSlots(input.mealsPerDay)
  const avoid = avoidTokens(input.profile)
  const usedNames = new Set()
  const usedCategories = new Map()
  return Array.from({ length: 7 }, (_, dayIndex) => {
    const dayId = addUtcDays(input.weekStart, dayIndex)
    const meals = slots.flatMap((slot, mealIndex) => {
      const targetCalories = input.calorieGoal * slot.ratio
      const targetProtein = input.proteinGoal * slot.ratio
      const item = choosePlanItem(items, {
        type: slot.type,
        targetCalories,
        targetProtein,
        goal: input.profile.goal,
        usedNames,
        usedCategories,
        avoid,
        seed: `${input.userId}:${dayId}:${slot.type}:${mealIndex}`,
      })
      if (!item) return []
      usedNames.add(item.nameAscii)
      const categoryKey = foldText(item.category)
      usedCategories.set(categoryKey, (usedCategories.get(categoryKey) || 0) + 1)
      return [toPlanMeal(item, {
        dayId,
        type: slot.type,
        time: slot.time,
        index: mealIndex,
        targetCalories,
        targetProtein,
        goal: input.profile.goal,
      })]
    })
    return { id: dayId, meals }
  })
}

function aiCandidateItems(items, days, input) {
  const baselineIds = new Set(days.flatMap((day) => day.meals.map((meal) => meal.catalogId)).filter(Boolean))
  const goalPool = items
    .filter((item) => !avoidTokens(input.profile).some((token) => item.nameAscii.includes(token)))
    .sort((left, right) => {
      const leftScore = Math.abs(left.calories - input.calorieGoal / Math.max(3, input.mealsPerDay)) - left.protein * 2
      const rightScore = Math.abs(right.calories - input.calorieGoal / Math.max(3, input.mealsPerDay)) - right.protein * 2
      return leftScore - rightScore
    })
  const ordered = [
    ...items.filter((item) => baselineIds.has(item.id)),
    ...goalPool,
  ]
  return [...new Map(ordered.map((item) => [item.id, item])).values()].slice(0, 140)
}

function buildGeminiPlanPrompt(items, days, input) {
  const candidates = aiCandidateItems(items, days, input).map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
  }))
  const baseline = days.map((day) => ({
    dayId: day.id,
    meals: day.meals.map((meal) => ({ type: meal.type, catalogId: meal.catalogId, calories: meal.calories, protein: meal.protein })),
  }))
  return `Bạn là chuyên gia dinh dưỡng của Aura. Hãy tối ưu kế hoạch 7 ngày cho đúng hồ sơ khách hàng, nhưng chỉ được chọn món trong danh sách catalog được cung cấp. Không bịa món, không bịa catalogId, không đưa hướng dẫn ngoài JSON.

Hồ sơ: ${JSON.stringify(input.profile)}
Mục tiêu ngày: ${input.calorieGoal} kcal, ${input.proteinGoal}g đạm, ${input.mealsPerDay} bữa/ngày.
Khung bữa bắt buộc: ${JSON.stringify(mealSlots(input.mealsPerDay).map((slot) => slot.type))}.
Kế hoạch nền do Aura tính: ${JSON.stringify(baseline)}
Danh sách món hợp lệ: ${JSON.stringify(candidates)}

Trả về JSON theo schema. Mỗi lựa chọn gồm dayId, type, catalogId và servingMultiplier từ 0.5 đến 1.5. Có thể trả về một phần choices; Aura sẽ giữ món nền cho phần còn thiếu. Ưu tiên đa dạng, đúng dị ứng/món không thích, hợp mục tiêu ${input.profile.goal}, và giữ tổng kcal/đạm mỗi ngày gần mục tiêu.`
}

function applyGeminiPlanChoices(days, items, choices, input) {
  if (!Array.isArray(choices)) return { days, assisted: false }
  const byId = new Map(items.map((item) => [item.id, item]))
  const validDays = new Set(days.map((day) => day.id))
  const seenSlots = new Set()
  const choiceBySlot = new Map()
  choices.slice(0, 40).forEach((choice) => {
    const dayId = typeof choice?.dayId === 'string' ? choice.dayId : ''
    const type = MEAL_TYPES.has(choice?.type) ? choice.type : ''
    const catalogId = typeof choice?.catalogId === 'string' ? choice.catalogId : ''
    const item = byId.get(catalogId)
    const multiplier = Number(choice?.servingMultiplier)
    const slotKey = `${dayId}|${type}`
    if (!validDays.has(dayId) || !type || !item || !Number.isFinite(multiplier) || multiplier < 0.5 || multiplier > 1.5 || seenSlots.has(slotKey)) return
    if (avoidTokens(input.profile).some((token) => item.nameAscii.includes(token))) return
    seenSlots.add(slotKey)
    choiceBySlot.set(slotKey, { item, multiplier: Math.round(multiplier * 10) / 10 })
  })
  if (!choiceBySlot.size) return { days, assisted: false }
  const slots = mealSlots(input.mealsPerDay)
  const nextDays = days.map((day) => {
    const nextMeals = day.meals.map((meal, index) => {
      const selected = choiceBySlot.get(`${day.id}|${meal.type}`)
      if (!selected) return meal
      const slot = slots.find((candidate) => candidate.type === meal.type) || slots[index] || { ratio: 1 / Math.max(1, input.mealsPerDay), type: meal.type }
      return {
        ...toPlanMeal(selected.item, {
          dayId: day.id,
          type: meal.type,
          time: meal.time,
          index,
          targetCalories: input.calorieGoal * slot.ratio,
          targetProtein: input.proteinGoal * slot.ratio,
          goal: input.profile.goal,
        }),
        id: meal.id,
        servingMultiplier: selected.multiplier,
        calories: Math.round(selected.item.calories * selected.multiplier),
        protein: roundedMacro(selected.item.protein, selected.multiplier),
        carbs: roundedMacro(selected.item.carbs, selected.multiplier),
        fat: roundedMacro(selected.item.fat, selected.multiplier),
        description: `${selected.multiplier} khẩu phần theo nguồn · ${selected.item.source}`,
      }
    })
    return { ...day, meals: nextMeals }
  })
  return { days: nextDays, assisted: true }
}

async function optimizePlanWithGemini(days, items, input) {
  const apiKey = getOpenRouterApiKey()
  if (!apiKey) return { days, assisted: false }
  const result = await requestOpenRouterStructured({
    apiKey,
    prompt: buildGeminiPlanPrompt(items, days, input),
    schema: geminiPlanSchema,
    schemaName: 'aura_nutrition_plan_choices',
    maxOutputTokens: 5000,
    operation: 'nutrition-plan-gemini',
    modelCandidates: getOpenRouterModelCandidates({
      modelEnv: process.env.OPENROUTER_TEXT_MODEL || 'google/gemini-3.7-flash',
      fallbackModelEnv: process.env.OPENROUTER_TEXT_FALLBACK_MODEL || 'google/gemini-3.6-flash',
    }),
    timeoutMs: 22000,
  })
  return applyGeminiPlanChoices(days, items, result.data?.choices, input)
}

function publicPlan(value) {
  if (!value || typeof value !== 'object') return null
  return {
    schemaVersion: 1,
    weekStart: value.weekStart,
    status: PLAN_STATUS.has(value.status) ? value.status : 'draft',
    revision: Number.isInteger(value.revision) ? value.revision : 0,
    source: value.source === 'assigned' ? 'assigned' : 'aura-catalog',
    sourceTitle: typeof value.sourceTitle === 'string' ? value.sourceTitle : '',
    planner: value.planner === 'gemini' ? 'gemini' : 'catalog',
    targets: value.targets && typeof value.targets === 'object' ? value.targets : {},
    days: Array.isArray(value.days) ? value.days.slice(0, 7).map((day) => ({
      id: typeof day?.id === 'string' ? day.id : '',
      meals: Array.isArray(day?.meals) ? day.meals.slice(0, 6).map((meal) => ({
        id: typeof meal?.id === 'string' ? meal.id : '',
        catalogId: typeof meal?.catalogId === 'string' ? meal.catalogId : '',
        dayId: typeof meal?.dayId === 'string' ? meal.dayId : '',
        type: MEAL_TYPES.has(meal?.type) ? meal.type : 'lunch',
        time: typeof meal?.time === 'string' ? meal.time : '12:00',
        title: typeof meal?.title === 'string' ? meal.title : '',
        description: typeof meal?.description === 'string' ? meal.description : '',
        calories: finiteNumber(meal?.calories) || 0,
        protein: finiteNumber(meal?.protein) || 0,
        carbs: finiteNumber(meal?.carbs) || 0,
        fat: finiteNumber(meal?.fat) || 0,
        image: typeof meal?.image === 'string' ? meal.image : '',
        source: typeof meal?.source === 'string' ? meal.source : '',
        servingMultiplier: finiteNumber(meal?.servingMultiplier) || 1,
        rationale: typeof meal?.rationale === 'string' ? meal.rationale : '',
      })) : [],
    })).filter((day) => day.id) : [],
    updatedAt: typeof value.updatedAt?.toDate === 'function' ? value.updatedAt.toDate().toISOString() : null,
  }
}

function assignedPlanToWeek(plan, catalogItems, weekStart) {
  if (!plan || !Array.isArray(plan.days)) return null
  const byName = new Map()
  catalogItems.forEach((item) => {
    if (!byName.has(item.nameAscii)) byName.set(item.nameAscii, item)
  })
  const fields = [
    { key: 'breakfast', type: 'breakfast' },
    { key: 'lunch', type: 'lunch' },
    { key: 'snack', type: 'snack' },
    { key: 'dinner', type: 'dinner' },
  ]
  const days = plan.days.slice(0, 7).map((day, dayIndex) => {
    const dayId = addUtcDays(weekStart, dayIndex)
    const availableNames = fields.filter(({ key }) => typeof day?.[key] === 'string' && day[key].trim())
    return {
      id: dayId,
      meals: availableNames.map(({ key, type }, mealIndex) => {
        const title = day[key].trim()
        const item = byName.get(foldText(title))
        const fallbackCalories = availableNames.length ? Number(day.totalKcal || 0) / availableNames.length : 0
        const fallbackProtein = availableNames.length ? Number(day.totalProtein || 0) / availableNames.length : 0
        return item ? toPlanMeal(item, {
          dayId,
          type,
          index: mealIndex,
          targetCalories: item.calories,
          targetProtein: item.protein,
          goal: 'maintenance',
        }) : {
          id: `${dayId}-${type}-${mealIndex + 1}`,
          catalogId: '',
          dayId,
          type,
          time: MEAL_TIMES[type],
          title,
          description: 'Món trong thực đơn được giao',
          calories: Math.round(fallbackCalories),
          protein: Math.round(fallbackProtein * 10) / 10,
          carbs: 0,
          fat: 0,
          image: '',
          source: 'Aura',
          servingMultiplier: 1,
          rationale: 'Theo kế hoạch của chuyên viên',
        }
      }),
    }
  })
  return publicPlan({
    weekStart,
    status: 'active',
    revision: Number(plan.revision) || 1,
    source: 'assigned',
    sourceTitle: typeof plan.title === 'string' ? plan.title : 'Thực đơn được giao',
    targets: { calories: Number(plan.calorieTarget) || 0, protein: Number(plan.proteinTarget) || 0 },
    days,
  })
}

function normalizeMutationInput(value) {
  const action = value?.action === 'replace' ? 'replace' : value?.action === 'remove' ? 'remove' : 'add'
  const weekStart = validateWeekStart(value?.weekStart)
  const dayId = boundedString(value?.dayId, 'Ngày trong kế hoạch', 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayId) || dayId < weekStart || dayId > addUtcDays(weekStart, 6)) {
    throw new HttpsError('invalid-argument', 'Ngày không thuộc tuần thực đơn.')
  }
  const type = MEAL_TYPES.has(value?.type) ? value.type : 'lunch'
  const time = boundedString(value?.time, 'Giờ bữa ăn', 5)
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new HttpsError('invalid-argument', 'Giờ bữa ăn không hợp lệ.')
  return {
    action,
    weekStart,
    dayId,
    type,
    time,
    mealId: boundedString(value?.mealId, 'Mã bữa ăn', 120, action === 'replace' || action === 'remove'),
    catalogId: boundedString(value?.catalogId, 'Mã món ăn', 500, action !== 'remove'),
    servingMultiplier: action === 'remove' ? 1 : boundedNumber(value?.servingMultiplier ?? 1, 'Khẩu phần', 0.1, 5),
    expectedRevision: Math.max(0, Math.trunc(Number(value?.expectedRevision) || 0)),
  }
}

function createNutritionPlanFunctions({ db, onCall, requireStudent }) {
  const getMyNutritionPlanWorkspace = onCall({ cpu: 'gcf_gen1', maxInstances: 3 }, async (request) => {
    const userId = await requireStudent(request)
    const weekStart = validateWeekStart(request.data?.weekStart)
    const draftReference = db.doc(`users/${userId}/nutritionPlanDrafts/${weekStart}`)
    const activeReference = db.doc(`users/${userId}/nutritionPlans/${weekStart}`)
    const [draftSnapshot, activeSnapshot, assignmentSnapshot] = await Promise.all([
      draftReference.get(),
      activeReference.get(),
      db.doc(`mealPlanAssignments/${userId}`).get(),
    ])
    const draftPlan = draftSnapshot.exists ? publicPlan(draftSnapshot.data()) : null
    let activePlan = activeSnapshot.exists ? publicPlan(activeSnapshot.data()) : null
    // Before nutritionPlans was introduced, confirmed plans lived only in
    // nutritionPlanDrafts. Keep those weeks readable without a migration.
    if (!activePlan && draftPlan?.status === 'active') activePlan = draftPlan

    const assignmentIsActive = assignmentSnapshot.exists && assignmentSnapshot.data()?.status === 'active'
    let assignedPlan = null
    if (assignmentIsActive && (!draftPlan || !activePlan)) {
      const planId = assignmentSnapshot.data()?.mealPlanId
      if (typeof planId === 'string' && planId) {
        const assignedSnapshot = await db.doc(`mealPlans/${planId}`).get()
        if (assignedSnapshot.exists && assignedSnapshot.data()?.status === 'published') {
          const catalog = await loadPlanCatalog(db)
          assignedPlan = assignedPlanToWeek(assignedSnapshot.data(), catalog.items, weekStart)
        }
      }
    }
    return {
      plan: draftPlan || assignedPlan,
      activePlan: activePlan || assignedPlan,
      assignedPlanAvailable: Boolean(assignedPlan || assignmentIsActive),
    }
  })

  const generateMyNutritionPlanDraft = onCall({ cpu: 'gcf_gen1', maxInstances: 2, timeoutSeconds: 120, memory: '512MiB', secrets: [OPENROUTER_API_KEY] }, async (request) => {
    const userId = await requireStudent(request)
    const weekStart = validateWeekStart(request.data?.weekStart)
    const expectedRevision = Math.max(0, Math.trunc(Number(request.data?.expectedRevision) || 0))
    const calorieGoal = boundedNumber(request.data?.calorieGoal, 'Mục tiêu năng lượng', 800, 5000)
    const proteinGoal = boundedNumber(request.data?.proteinGoal, 'Mục tiêu đạm', 20, 500)
    const mealsPerDay = Math.min(5, Math.max(3, Math.trunc(Number(request.data?.mealsPerDay) || 4)))
    const goal = ['lose-fat', 'gain-muscle', 'maintain'].includes(request.data?.goal) ? request.data.goal : 'maintain'
    const profileInput = request.data?.profile && typeof request.data.profile === 'object' ? request.data.profile : {}
    const profile = {
      goal,
      allergies: boundedString(request.data?.allergies, 'Thông tin dị ứng', 600, false),
      dislikes: boundedString(request.data?.dislikes, 'Món không thích', 600, false),
      eatingStyle: boundedString(profileInput.eatingStyle, 'Phong cách ăn', 120, false),
      favoriteCuisine: boundedString(profileInput.favoriteCuisine, 'Ẩm thực ưa thích', 120, false),
      budget: boundedString(profileInput.budget, 'Ngân sách', 40, false),
      prepTime: boundedString(profileInput.prepTime, 'Thời gian chuẩn bị', 40, false),
      biologicalSex: boundedString(profileInput.biologicalSex, 'Giới tính sinh học', 20, false),
      activityLevel: boundedString(profileInput.activityLevel, 'Mức độ vận động', 40, false),
      age: Number.isFinite(Number(profileInput.age)) ? Math.min(100, Math.max(13, Math.round(Number(profileInput.age)))) : null,
      trainingSessions: Number.isFinite(Number(profileInput.trainingSessions)) ? Math.min(14, Math.max(0, Math.round(Number(profileInput.trainingSessions)))) : null,
    }
    const catalog = await loadPlanCatalog(db)
    if (catalog.items.length < 20) throw new HttpsError('failed-precondition', 'Thư viện món chưa đủ dữ liệu để tạo kế hoạch.')
    const generationInput = { userId, weekStart, calorieGoal, proteinGoal, mealsPerDay, profile }
    let days = generatePlanDays(catalog.items, generationInput)
    let planner = 'catalog'
    if (request.data?.aiAssist !== false) {
      try {
        const optimized = await optimizePlanWithGemini(days, catalog.items, generationInput)
        if (optimized.assisted) {
          days = optimized.days
          planner = 'gemini'
        }
      } catch (error) {
        // The catalog planner remains the safe source of truth if Gemini is
        // unavailable, rate-limited or returns an unusable choice set.
        console.warn('Gemini nutrition plan assist unavailable:', error?.message || error)
      }
    }
    const reference = db.doc(`users/${userId}/nutritionPlanDrafts/${weekStart}`)
    let saved = null
    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(reference)
      const currentRevision = existing.exists ? Number(existing.data()?.revision) || 0 : 0
      if (currentRevision !== expectedRevision) {
        throw new HttpsError('aborted', 'Kế hoạch đã thay đổi ở nơi khác. Hãy tải lại rồi tạo lại.')
      }
      const revision = currentRevision + 1
      saved = {
        schemaVersion: 1,
        weekStart,
        status: 'draft',
        revision,
        source: 'aura-catalog',
        sourceTitle: planner === 'gemini'
          ? `Gemini hỗ trợ · ${catalog.items.length} món đủ dữ liệu`
          : `Gợi ý từ ${catalog.items.length} món đủ dữ liệu`,
        planner,
        targets: { calories: calorieGoal, protein: proteinGoal, mealsPerDay },
        profileSnapshot: profile,
        catalogVersion: catalog.version,
        days,
        createdAt: existing.exists ? existing.data()?.createdAt : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }
      transaction.set(reference, saved)
    })
    return { plan: publicPlan(saved) }
  })

  const mutateMyNutritionPlanMeal = onCall({ cpu: 'gcf_gen1', maxInstances: 3 }, async (request) => {
    const userId = await requireStudent(request)
    const input = normalizeMutationInput(request.data)
    const reference = db.doc(`users/${userId}/nutritionPlanDrafts/${input.weekStart}`)
    const catalogReference = input.catalogId ? db.doc(`nutritionCatalog/${input.catalogId}`) : null
    const catalogSnapshot = catalogReference ? await catalogReference.get() : null
    const item = catalogSnapshot?.exists ? catalogItemFromSnapshot(catalogSnapshot) : null
    if (input.action !== 'remove') {
      if (!item || !item.name || item.calories === null || item.protein === null || item.carbs === null || item.fat === null) {
        throw new HttpsError('failed-precondition', 'Món ăn chưa đủ kcal và macro để thêm vào kế hoạch.')
      }
    }
    let saved = null
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new HttpsError('failed-precondition', 'Hãy tạo bản nháp kế hoạch trước khi chỉnh món.')
      const current = snapshot.data() || {}
      const revision = Number(current.revision) || 0
      if (revision !== input.expectedRevision) throw new HttpsError('aborted', 'Kế hoạch đã thay đổi ở nơi khác. Hãy tải lại rồi thử lại.')
      const days = Array.isArray(current.days) ? current.days.map((day) => ({ ...day, meals: Array.isArray(day.meals) ? [...day.meals] : [] })) : []
      let day = days.find((candidate) => candidate.id === input.dayId)
      if (!day) {
        day = { id: input.dayId, meals: [] }
        days.push(day)
      }
      if (input.action === 'remove') {
        const before = day.meals.length
        day.meals = day.meals.filter((meal) => meal.id !== input.mealId)
        if (before === day.meals.length) throw new HttpsError('not-found', 'Không tìm thấy bữa cần xoá.')
      } else {
        const meal = toPlanMeal(item, {
          dayId: input.dayId,
          type: input.type,
          time: input.time,
          index: day.meals.length,
          targetCalories: item.calories * input.servingMultiplier,
          targetProtein: item.protein * input.servingMultiplier,
          goal: current.profileSnapshot?.goal || 'maintain',
        })
        meal.servingMultiplier = input.servingMultiplier
        meal.calories = Math.round(item.calories * input.servingMultiplier)
        meal.protein = roundedMacro(item.protein, input.servingMultiplier)
        meal.carbs = roundedMacro(item.carbs, input.servingMultiplier)
        meal.fat = roundedMacro(item.fat, input.servingMultiplier)
        meal.description = `${input.servingMultiplier} khẩu phần theo nguồn · ${item.source}`
        if (input.action === 'replace') {
          const index = day.meals.findIndex((candidate) => candidate.id === input.mealId)
          if (index < 0) throw new HttpsError('not-found', 'Không tìm thấy bữa cần đổi.')
          meal.id = input.mealId
          day.meals[index] = meal
        } else {
          if (day.meals.length >= 6) throw new HttpsError('failed-precondition', 'Một ngày chỉ hỗ trợ tối đa 6 bữa.')
          meal.id = `${input.dayId}-${input.type}-${Date.now().toString(36)}`
          day.meals.push(meal)
        }
      }
      day.meals.sort((left, right) => String(left.time).localeCompare(String(right.time)))
      days.sort((left, right) => String(left.id).localeCompare(String(right.id)))
      saved = {
        ...current,
        weekStart: input.weekStart,
        status: 'draft',
        revision: revision + 1,
        days,
        updatedAt: FieldValue.serverTimestamp(),
      }
      delete saved.confirmedAt
      transaction.set(reference, saved)
    })
    return { plan: publicPlan(saved) }
  })

  const confirmMyNutritionPlan = onCall({ cpu: 'gcf_gen1', maxInstances: 3 }, async (request) => {
    const userId = await requireStudent(request)
    const weekStart = validateWeekStart(request.data?.weekStart)
    const expectedRevision = Math.max(0, Math.trunc(Number(request.data?.expectedRevision) || 0))
    const reference = db.doc(`users/${userId}/nutritionPlanDrafts/${weekStart}`)
    const activeReference = db.doc(`users/${userId}/nutritionPlans/${weekStart}`)
    let saved = null
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Chưa có kế hoạch để xác nhận.')
      const current = snapshot.data() || {}
      const revision = Number(current.revision) || 0
      if (revision !== expectedRevision) throw new HttpsError('aborted', 'Kế hoạch đã thay đổi. Hãy tải lại trước khi xác nhận.')
      const expectedDays = new Set(Array.from({ length: 7 }, (_, index) => addUtcDays(weekStart, index)))
      const coveredDays = new Set(Array.isArray(current.days)
        ? current.days.filter((day) => expectedDays.has(day?.id) && Array.isArray(day?.meals) && day.meals.length > 0).map((day) => day.id)
        : [])
      if (coveredDays.size !== 7) throw new HttpsError('failed-precondition', 'Kế hoạch cần ít nhất một bữa cho mỗi ngày trước khi xác nhận.')
      saved = { ...current, status: 'active', revision: revision + 1, confirmedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }
      transaction.set(reference, saved)
      // The confirmed menu is a separate snapshot. Future draft edits must not
      // mutate the menu that the member is currently following.
      transaction.set(activeReference, saved)
    })
    const publicSaved = publicPlan(saved)
    return { plan: publicSaved, activePlan: publicSaved }
  })

  return {
    getMyNutritionPlanWorkspace,
    generateMyNutritionPlanDraft,
    mutateMyNutritionPlanMeal,
    confirmMyNutritionPlan,
  }
}

module.exports = {
  catalogItemFromSnapshot,
  applyGeminiPlanChoices,
  buildGeminiPlanPrompt,
  createNutritionPlanFunctions,
  foldText,
  generatePlanDays,
  mealSlots,
  publicPlan,
  validateWeekStart,
}
