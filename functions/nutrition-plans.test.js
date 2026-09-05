const assert = require('node:assert/strict')
const test = require('node:test')

const {
  catalogItemFromSnapshot,
  createNutritionPlanFunctions,
  generatePlanDays,
  mealSlots,
  validateWeekStart,
} = require('./nutrition-plans')

function nutritionPlanFunctionsFor(seed) {
  const documents = new Map(Object.entries(seed))
  const snapshot = (path) => ({ exists: documents.has(path), data: () => documents.get(path) })
  const reference = (path) => ({ path, get: async () => snapshot(path) })
  const db = {
    doc: reference,
    async runTransaction(handler) {
      const writes = []
      const result = await handler({
        get: async (ref) => snapshot(ref.path),
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
    targets: { calories: 1800, protein: 100, mealsPerDay: 3 },
    days: Array.from({ length: 7 }, (_, index) => {
      const date = new Date('2026-09-07T12:00:00.000Z')
      date.setUTCDate(date.getUTCDate() + index)
      const dayId = date.toISOString().slice(0, 10)
      return { dayId, id: dayId, meals: [{ id: `${dayId}-meal`, dayId, type: 'lunch', time: '12:00', title: `Món ${index + 1}`, calories: 400, protein: 25 }] }
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
    calories: 180 + (index % 12) * 20,
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
  assert.equal(api.read('users/student-1/nutritionPlanDrafts/2026-09-07').days[0].meals.length, 0)
  assert.equal(api.read('users/student-1/nutritionPlans/2026-09-07').status, 'active')
  assert.equal(api.read('users/student-1/nutritionPlans/2026-09-07').days[0].meals.length, 1)
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
