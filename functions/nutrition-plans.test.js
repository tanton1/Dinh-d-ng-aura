const assert = require('node:assert/strict')
const test = require('node:test')

const {
  catalogItemFromSnapshot,
  applyGeminiPlanChoices,
  buildGeminiPlanPrompt,
  createNutritionPlanFunctions,
  generatePlanDays,
  mealSlots,
  validateWeekStart,
} = require('./nutrition-plans')

const testProfile = { age: 30, biologicalSex: 'female', heightCm: 165, weightKg: 60, activityLevel: 'sedentary', goal: 'maintain', mealsPerDay: 3 }
const testDish = { kind: 'dish', nameVi: 'Cơm cân bằng', energyKcal: 528, macros: { proteinG: 32, carbohydrateG: 64, fatG: 16 }, basis: { amount: 300, unit: 'g' } }
function nutritionPlanFunctionsFor(seed) {
  const documents = new Map(Object.entries({ 'users/student-1': { nutritionProfile: testProfile }, 'nutritionCatalog/dish-test': testDish, ...seed }))
  const snapshot = (path) => ({ exists: documents.has(path), data: () => documents.get(path) })
  const reference = (path) => ({ path, get: async () => snapshot(path) })
  const collectionRef = (path, filters = []) => {
    const query = { path, filters, isQuery: true, where: (key, op, value) => collectionRef(path, [...filters, [key, op, value]]), select: () => query, get: async () => querySnapshot(query) }
    return query
  }
  const querySnapshot = (query) => {
    const docs = [...documents].filter(([path, value]) => path.startsWith(query.path + '/') && !path.slice(query.path.length + 1).includes('/') && query.filters.every(([key, op, match]) => op === '>=' ? value[key] >= match : value[key] <= match))
      .map(([path, value]) => ({ id: path.split('/').at(-1), data: () => value }))
    return { docs, size: docs.length }
  }
  const db = {
    doc: reference,
    collection: collectionRef,
    async runTransaction(handler) {
      const writes = []
      const result = await handler({
        get: async (ref) => ref.isQuery ? querySnapshot(ref) : snapshot(ref.path),
        set: (ref, value) => writes.push([ref.path, value]),
      })
      writes.forEach(([path, value]) => documents.set(path, value))
      return result
    },
  }
  return {
    ...createNutritionPlanFunctions({
      db,
      onCall: (...args) => args.at(-1),
      requireStudent: async () => 'student-1',
    }),
    read: (path) => documents.get(path),
  }
}

function completeDraft(overrides = {}) {
  return {
    schemaVersion: 1,
    weekStart: '2026-09-07',
    status: 'draft',
    revision: 1,
    source: 'aura-catalog',
    sourceTitle: 'Aura test',
    targets: { calories: 1584, protein: 96, carbs: 192, fat: 48, mealsPerDay: 3 },
    days: Array.from({ length: 7 }, (_, index) => {
      const date = new Date('2026-09-07T12:00:00.000Z')
      date.setUTCDate(date.getUTCDate() + index)
      const dayId = date.toISOString().slice(0, 10)
      return { dayId, id: dayId, meals: ['breakfast', 'lunch', 'dinner'].map((type, i) => ({ id: type === 'lunch' ? `${dayId}-meal` : `${dayId}-${type}`, catalogId: 'dish-test', dayId, type, time: ['07:30', '12:00', '18:30'][i], title: `Món ${index + 1}`, calories: 528, protein: 32, carbs: 64, fat: 16, servingMultiplier: 1 })) }
    }),
    ...overrides,
  }
}

test('legacy nutrition catalog records read macros from nutrient arrays', () => {
  const item = catalogItemFromSnapshot({
    id: 'nin:dish:test',
    data: () => ({
      kind: 'dish',
      nameVi: 'Cơm gà',
      nameAscii: 'com ga',
      energyKcal: 520,
      nutrients: [
        { key: 'protein', value: 34 },
        { key: 'carbohydrate', value: 62 },
        { key: 'fat', value: 15 },
      ],
      source: { publisher: 'Viện Dinh dưỡng Quốc gia' },
    }),
  })
  assert.equal(item.calories, 520)
  assert.equal(item.protein, 34)
  assert.equal(item.carbs, 62)
  assert.equal(item.fat, 15)
})

test('nutrition plans only accept Monday week keys', () => {
  assert.equal(validateWeekStart('2026-09-07'), '2026-09-07')
  assert.throws(() => validateWeekStart('2026-09-08'), /thứ Hai/)
  assert.throws(() => validateWeekStart('2026-02-30'), /không hợp lệ/)
})

test('meal distributions cover three, four and five meals without changing daily energy', () => {
  for (const count of [3, 4, 5]) {
    const slots = mealSlots(count)
    assert.equal(slots.length, count)
    assert.ok(Math.abs(slots.reduce((sum, slot) => sum + slot.ratio, 0) - 1) < 0.00001)
  }
})

test('catalog generator creates seven complete days and avoids duplicate dishes when possible', () => {
  const catalog = Array.from({ length: 60 }, (_, index) => ({
    id: `dish-${index}`,
    kind: 'dish',
    name: `Món nữ cân bằng ${index}`,
    nameAscii: `mon nu can bang ${index}`,
    category: index % 2 ? 'Món chính' : 'Bữa nhẹ',
    basis: { amount: 300, unit: 'g' },
    calories: (12 + index % 10) * 4 + (20 + index % 15) * 4 + (5 + index % 6) * 9,
    protein: 12 + (index % 10),
    carbs: 20 + (index % 15),
    fat: 5 + (index % 6),
    image: '',
    source: 'Aura test',
  }))
  const days = generatePlanDays(catalog, {
    userId: 'student-1',
    weekStart: '2026-09-07',
    calorieGoal: 1900,
    proteinGoal: 120,
    mealsPerDay: 4,
    profile: { goal: 'lose-fat', allergies: '', dislikes: '' },
  })
  assert.equal(days.length, 7)
  assert.deepEqual(days.map((day) => day.id), [
    '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10',
    '2026-09-11', '2026-09-12', '2026-09-13',
  ])
  assert.ok(days.every((day) => day.meals.length === 4))
  const titles = days.flatMap((day) => day.meals.map((meal) => meal.title))
  assert.equal(new Set(titles).size, titles.length)
})

test('Gemini accepts only known, nutritionally valid replacements and retains valid day totals', () => {
  const item = catalogItemFromSnapshot({ id: 'dish-test', data: () => testDish })
  const alternative = { ...item, id: 'dish-b', name: 'Cá hồi', calories: 500, protein: 30, carbs: 59, fat: 16 }
  const days = completeDraft().days.slice(0, 1)
  const input = { weekStart: '2026-09-07', calorieGoal: 1584, proteinGoal: 96, carbGoal: 192, fatGoal: 48, mealsPerDay: 3, profile: testProfile }
  const result = applyGeminiPlanChoices(days, [item, alternative], [
    { dayId: '2026-09-07', type: 'lunch', time: '12:00', catalogId: 'dish-b', servingMultiplier: 1.2 },
    { dayId: '2026-09-07', type: 'dinner', time: '18:30', catalogId: 'unknown', servingMultiplier: 1 },
  ], input)
  assert.equal(result.assisted, true)
  assert.equal(result.days[0].meals[1].id, days[0].meals[1].id)
  assert.equal(result.days[0].meals[1].catalogId, 'dish-b')
  assert.equal(result.days[0].meals[1].calories, 600)
  assert.equal(result.days[0].meals[2].catalogId, 'dish-test')
})

test('Gemini prompt carries profile constraints and catalog ids without treating them as instructions', () => {
  const prompt = buildGeminiPlanPrompt([
    { id: 'dish-a', name: 'Ức gà', nameAscii: 'uc ga', category: 'Món chính', calories: 400, protein: 35, carbs: 40, fat: 10 },
  ], [{ id: '2026-09-07', meals: [{ type: 'lunch', catalogId: 'dish-a', calories: 400, protein: 35 }] }], {
    calorieGoal: 1800,
    proteinGoal: 110,
    mealsPerDay: 3,
    profile: { goal: 'lose-fat', allergies: 'đậu phộng', dislikes: 'cần tây' },
  })
  assert.match(prompt, /đậu phộng/)
  assert.match(prompt, /dish-a/)
  assert.match(prompt, /không bịa catalogId/i)
})

test('confirming a weekly plan saves a separate active menu snapshot', async () => {
  const api = nutritionPlanFunctionsFor({
    'users/student-1/nutritionPlanDrafts/2026-09-07': completeDraft(),
  })
  const result = await api.confirmMyNutritionPlan({ data: { weekStart: '2026-09-07', expectedRevision: 1 } })
  assert.equal(result.plan.status, 'active')
  assert.equal(result.activePlan.status, 'active')
  assert.equal(api.read('users/student-1/nutritionPlanDrafts/2026-09-07').revision, 2)
  assert.equal(api.read('users/student-1/nutritionPlans/2026-09-07').days.length, 7)

  await api.mutateMyNutritionPlanMeal({
    data: {
      action: 'remove',
      weekStart: '2026-09-07',
      dayId: '2026-09-07',
      mealId: '2026-09-07-meal',
      type: 'lunch',
      time: '12:00',
      expectedRevision: 2,
    },
  })
  assert.equal(api.read('users/student-1/nutritionPlanDrafts/2026-09-07').status, 'draft')
  assert.equal(api.read('users/student-1/nutritionPlanDrafts/2026-09-07').days[0].meals.length, 2)
  assert.equal(api.read('users/student-1/nutritionPlans/2026-09-07').status, 'active')
  assert.equal(api.read('users/student-1/nutritionPlans/2026-09-07').days[0].meals.length, 3)
})

test('legacy active drafts remain available as confirmed menus', async () => {
  const api = nutritionPlanFunctionsFor({
    'users/student-1/nutritionPlanDrafts/2026-09-07': completeDraft({ status: 'active' }),
  })
  const result = await api.getMyNutritionPlanWorkspace({ data: { weekStart: '2026-09-07' } })
  assert.equal(result.plan.status, 'active')
  assert.equal(result.activePlan.status, 'active')
  assert.equal(result.activePlan.weekStart, '2026-09-07')
})

test('invalid confirmation never overwrites active menu or advances draft revision', async () => {
  const invalid = completeDraft()
  invalid.days[2].meals.pop()
  const api = nutritionPlanFunctionsFor({
    'users/student-1/nutritionPlanDrafts/2026-09-07': invalid,
    'users/student-1/nutritionPlans/2026-09-07': completeDraft({ status: 'active', revision: 9 }),
  })
  await assert.rejects(api.confirmMyNutritionPlan({ data: { weekStart: '2026-09-07', expectedRevision: 1 } }), /2026-09-09/)
  assert.equal(api.read('users/student-1/nutritionPlans/2026-09-07').revision, 9)
  assert.equal(api.read('users/student-1/nutritionPlanDrafts/2026-09-07').revision, 1)
})

test('confirmation rechecks catalog changes and stale revisions', async () => {
  const api = nutritionPlanFunctionsFor({
    'users/student-1/nutritionPlanDrafts/2026-09-07': completeDraft(),
    'nutritionCatalog/dish-test': { ...testDish, basis: null },
  })
  await assert.rejects(api.confirmMyNutritionPlan({ data: { weekStart: '2026-09-07', expectedRevision: 0 } }), /đã thay đổi/)
  await assert.rejects(api.confirmMyNutritionPlan({ data: { weekStart: '2026-09-07', expectedRevision: 1 } }), /khẩu phần chuẩn/)
  assert.equal(api.read('users/student-1/nutritionPlans/2026-09-07'), undefined)
})

test('generation ignores client calorie/profile overrides and stores server targets', async () => {
  const api = nutritionPlanFunctionsFor({})
  const result = await api.generateMyNutritionPlanDraft({ data: {
    weekStart: '2026-09-07', expectedRevision: 0, aiAssist: false,
    calorieGoal: 800, proteinGoal: 25, mealsPerDay: 5, goal: 'lose-fat',
    profile: { age: 13, eatingStyle: 'untrusted' },
  } })
  assert.equal(result.plan.targets.calories, 1584)
  assert.equal(result.plan.targets.protein, 96)
  assert.equal(result.plan.targets.mealsPerDay, 3)
  assert.equal(result.plan.targets.formulaVersion, 'aura-nutrition-v2')
  assert.ok(result.plan.days.every((day) => day.meals.length === 3))
  assert.equal(api.read('users/student-1/nutritionPlanDrafts/2026-09-07').profileSnapshot.age, 30)
})
