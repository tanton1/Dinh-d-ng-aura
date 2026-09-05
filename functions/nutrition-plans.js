const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')

const PLAN_STATUS = new Set(['draft', 'active'])
const MEAL_TYPES = new Set(['breakfast', 'lunch', 'snack', 'dinner'])
const PLAN_CACHE_MS = 10 * 60 * 1000
const MEAL_TIMES = {
  breakfast: '07:30',
  lunch: '12:00',
  snack: '15:30',
  dinner: '18:30',
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

function publicPlan(value) {
  if (!value || typeof value !== 'object') return null
  return {
    schemaVersion: 1,
    weekStart: value.weekStart,
    status: PLAN_STATUS.has(value.status) ? value.status : 'draft',
    revision: Number.isInteger(value.revision) ? value.revision : 0,
    source: value.source === 'assigned' ? 'assigned' : 'aura-catalog',
    sourceTitle: typeof value.sourceTitle === 'string' ? value.sourceTitle : '',
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
    const [draftSnapshot, assignmentSnapshot] = await Promise.all([
      draftReference.get(),
      db.doc(`mealPlanAssignments/${userId}`).get(),
    ])
    if (draftSnapshot.exists) return { plan: publicPlan(draftSnapshot.data()), assignedPlanAvailable: assignmentSnapshot.exists }
    if (!assignmentSnapshot.exists || assignmentSnapshot.data()?.status !== 'active') return { plan: null, assignedPlanAvailable: false }
    const planId = assignmentSnapshot.data()?.mealPlanId
    if (typeof planId !== 'string' || !planId) return { plan: null, assignedPlanAvailable: false }
    const assignedSnapshot = await db.doc(`mealPlans/${planId}`).get()
    if (!assignedSnapshot.exists || assignedSnapshot.data()?.status !== 'published') return { plan: null, assignedPlanAvailable: false }
    const catalog = await loadPlanCatalog(db)
    return { plan: assignedPlanToWeek(assignedSnapshot.data(), catalog.items, weekStart), assignedPlanAvailable: true }
  })

  const generateMyNutritionPlanDraft = onCall({ cpu: 'gcf_gen1', maxInstances: 2, timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
    const userId = await requireStudent(request)
    const weekStart = validateWeekStart(request.data?.weekStart)
    const expectedRevision = Math.max(0, Math.trunc(Number(request.data?.expectedRevision) || 0))
    const calorieGoal = boundedNumber(request.data?.calorieGoal, 'Mục tiêu năng lượng', 800, 5000)
    const proteinGoal = boundedNumber(request.data?.proteinGoal, 'Mục tiêu đạm', 20, 500)
    const mealsPerDay = Math.min(5, Math.max(3, Math.trunc(Number(request.data?.mealsPerDay) || 4)))
    const goal = ['lose-fat', 'gain-muscle', 'maintain'].includes(request.data?.goal) ? request.data.goal : 'maintain'
    const profile = {
      goal,
      allergies: boundedString(request.data?.allergies, 'Thông tin dị ứng', 600, false),
      dislikes: boundedString(request.data?.dislikes, 'Món không thích', 600, false),
    }
    const catalog = await loadPlanCatalog(db)
    if (catalog.items.length < 20) throw new HttpsError('failed-precondition', 'Thư viện món chưa đủ dữ liệu để tạo kế hoạch.')
    const days = generatePlanDays(catalog.items, { userId, weekStart, calorieGoal, proteinGoal, mealsPerDay, profile })
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
        sourceTitle: `Gợi ý từ ${catalog.items.length} món đủ dữ liệu`,
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
    })
    return { plan: publicPlan(saved) }
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
  createNutritionPlanFunctions,
  foldText,
  generatePlanDays,
  mealSlots,
  publicPlan,
  validateWeekStart,
}
