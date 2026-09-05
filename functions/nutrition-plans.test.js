const assert = require('node:assert/strict')
const test = require('node:test')

const {
  catalogItemFromSnapshot,
  generatePlanDays,
  mealSlots,
  validateWeekStart,
} = require('./nutrition-plans')

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
