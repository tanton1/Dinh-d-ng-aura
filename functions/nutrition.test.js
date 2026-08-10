const assert = require('node:assert/strict')
const test = require('node:test')

const {
  applyCatalogLookupToItem,
  createGeminiSchema,
  enrichAnalysisWithLookups,
  foodAnalysisSchema,
  isGeminiModelCompatibilityError,
  sanitizeProviderErrorMessage,
  scaleCatalogNutrition,
  sumNutritionItems,
  validateFoodAnalysis,
} = require('./nutrition')

function collectKeys(value, keys = []) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectKeys(entry, keys))
    return keys
  }
  if (!value || typeof value !== 'object') return keys
  Object.entries(value).forEach(([key, entry]) => {
    keys.push(key)
    collectKeys(entry, keys)
  })
  return keys
}

test('Gemini schema omits provider-complexity constraints enforced on the server', () => {
  const schema = createGeminiSchema(foodAnalysisSchema)
  const keys = collectKeys(schema)

  assert.equal(keys.includes('minLength'), false)
  assert.equal(keys.includes('maxLength'), false)
  assert.equal(keys.includes('maxItems'), false)
  assert.equal(schema.required.includes('items'), true)
  assert.equal(schema.properties.items.type, 'array')
})

test('server validation still enforces the item limit removed from the provider schema', () => {
  const item = {
    nameVi: 'Táo',
    nameEn: 'Apple',
    searchNameAscii: 'tao',
    estimatedGrams: 100,
    gramRange: { low: 80, high: 120 },
    cookingMethod: 'Tươi',
    nutrition: {
      calories: 52,
      proteinG: 0.3,
      carbsG: 14,
      fatG: 0.2,
      fiberG: 2.4,
      sugarG: 10,
      sodiumMg: 1,
    },
    confidence: 0.9,
    assumptions: [],
  }
  const analysis = {
    isFood: true,
    dishNameVi: 'Táo',
    dishNameEn: 'Apple',
    portionSummary: 'Một quả táo',
    confidence: 0.9,
    calorieRange: { low: 45, high: 60 },
    totals: item.nutrition,
    items: Array.from({ length: 13 }, () => ({ ...item })),
    questions: [],
    warnings: [],
  }

  assert.throws(() => validateFoodAnalysis(analysis), /items is invalid/)
})

test('400 fallback is limited to explicit model/config incompatibility', () => {
  assert.equal(
    isGeminiModelCompatibilityError(400, 'thinkingLevel is not supported by this model'),
    true,
  )
  assert.equal(isGeminiModelCompatibilityError(400, 'Request contains an invalid argument.'), false)
  assert.equal(isGeminiModelCompatibilityError(429, 'response schema is unsupported'), false)
})

test('provider errors are flattened, bounded, and redact API credentials', () => {
  const secret = `AIza${'x'.repeat(32)}`
  const bearerSecret = 'SUPERSECRET-BEARER-TOKEN'
  const sanitized = sanitizeProviderErrorMessage(`Bad request\napi_key=${secret}\tauthorization: Bearer ${bearerSecret} ${'z'.repeat(600)}`)

  assert.equal(sanitized.includes(secret), false)
  assert.equal(sanitized.includes(bearerSecret), false)
  assert.equal(/[\r\n\t]/.test(sanitized), false)
  assert.ok(sanitized.length <= 500)
})

function nutrition(overrides = {}) {
  return {
    calories: 100,
    proteinG: 10,
    carbsG: 20,
    fatG: 3,
    fiberG: 2,
    sugarG: 4,
    sodiumMg: 50,
    ...overrides,
  }
}

function analysisItem(overrides = {}) {
  return {
    nameVi: 'Cơm trắng',
    nameEn: 'White rice',
    searchNameAscii: 'com trang',
    estimatedGrams: 150,
    gramRange: { low: 120, high: 180 },
    cookingMethod: 'Chín',
    nutrition: nutrition(),
    confidence: 0.8,
    assumptions: [],
    ...overrides,
  }
}

function catalogMatch(overrides = {}) {
  return {
    catalogId: 'nin:food:rice',
    matchScore: 1,
    kind: 'food',
    code: '1001',
    nameVi: 'Gạo trắng',
    regionNameVi: null,
    energyKcal: 200,
    basis: { amount: 100, unit: 'g', qualifier: 'edible_raw_fresh', labelVi: '100 g' },
    source: { publisher: 'Viện Dinh dưỡng Quốc gia', pageUrl: 'https://example.test/rice' },
    nutritionPerBasis: nutrition({ calories: 200, proteinG: 8, carbsG: 40, fatG: 2, fiberG: null, sugarG: 0, sodiumMg: 10 }),
    detailedNutrientsPerBasis: [
      { key: 'calcium', nameVi: 'Canxi', nameEn: 'Calcium', value: 10, unit: 'mg', equivalents: [] },
      { key: 'transfat', nameVi: 'Transfat', nameEn: 'Transfat', value: null, unit: 'mg', equivalents: [] },
    ],
    ...overrides,
  }
}

test('catalog nutrition scales deterministically from a compatible trusted gram basis and preserves nulls', () => {
  const scaled = scaleCatalogNutrition(catalogMatch(), 150, 'Tươi')

  assert.equal(scaled.factor, 1.5)
  assert.deepEqual(scaled.nutrition, {
    calories: 300,
    proteinG: 12,
    carbsG: 60,
    fatG: 3,
    fiberG: null,
    sugarG: 0,
    sodiumMg: 15,
  })
  assert.equal(scaled.catalogFieldCount, 6)
})

test('catalog enrichment uses compatible trusted fields, keeps AI values for source nulls, and records provenance', () => {
  const original = analysisItem({ cookingMethod: 'Tươi', nutrition: nutrition({ fiberG: 7 }) })
  const enriched = applyCatalogLookupToItem(original, {
    status: 'matched',
    match: catalogMatch(),
    candidates: [catalogMatch()],
  })

  assert.equal(enriched.nutrition.calories, 300)
  assert.equal(enriched.nutrition.fiberG, 7)
  assert.equal(enriched.aiEstimate.nutrition.calories, 100)
  assert.equal(enriched.nutritionEvidence.sourceType, 'catalog_scaled_with_ai_gaps')
  assert.equal(enriched.nutritionEvidence.fields.calories, 'catalog')
  assert.equal(enriched.nutritionEvidence.fields.fiberG, 'ai_estimate')
  assert.equal(enriched.detailedNutrients[0].value, 15)
  assert.equal(enriched.detailedNutrients[1].value, null)
})

test('raw or fresh catalog values never replace a cooked AI item without confirmation', () => {
  const original = analysisItem({ cookingMethod: 'Luộc chín', nutrition: nutrition({ calories: 135 }) })
  const enriched = applyCatalogLookupToItem(original, {
    status: 'matched',
    match: catalogMatch(),
    candidates: [catalogMatch()],
  })

  assert.deepEqual(enriched.nutrition, original.nutrition)
  assert.equal(enriched.nutritionEvidence.reason, 'catalog_basis_not_scalable')
  assert.deepEqual(enriched.nutritionEvidence.basisCompatibility, {
    compatible: false,
    status: 'needs_confirmation',
    reason: 'raw_fresh_catalog_vs_cooked_item',
  })
})

test('raw or fresh catalog values require confirmation when AI cooking state is unknown', () => {
  const original = analysisItem({ cookingMethod: 'Không xác định' })
  const enriched = applyCatalogLookupToItem(original, {
    status: 'matched',
    match: catalogMatch(),
    candidates: [catalogMatch()],
  })

  assert.deepEqual(enriched.nutrition, original.nutrition)
  assert.equal(enriched.nutritionEvidence.basisCompatibility.status, 'needs_confirmation')
  assert.equal(enriched.nutritionEvidence.basisCompatibility.reason, 'raw_fresh_catalog_item_state_unknown')
})

test('ambiguous matches and dishes without a trusted food gram basis preserve the AI estimate', () => {
  const original = analysisItem()
  const ambiguous = applyCatalogLookupToItem(original, {
    status: 'ambiguous',
    match: null,
    candidates: [catalogMatch(), catalogMatch({ catalogId: 'nin:food:rice-2', matchScore: 0.9 })],
  })
  const dish = applyCatalogLookupToItem(original, {
    status: 'matched',
    match: catalogMatch({
      catalogId: 'nin:dish:rice-meal',
      kind: 'dish',
      basis: { amount: null, unit: null, qualifier: 'not_specified_by_source', labelVi: null },
    }),
    candidates: [],
  })
  const lowScore = applyCatalogLookupToItem(original, {
    status: 'matched',
    match: catalogMatch({ matchScore: 0.65 }),
    candidates: [],
  })

  assert.deepEqual(ambiguous.nutrition, original.nutrition)
  assert.equal(ambiguous.nutritionEvidence.reason, 'ambiguous_catalog_match')
  assert.deepEqual(dish.nutrition, original.nutrition)
  assert.equal(dish.nutritionEvidence.reason, 'dish_basis_not_scalable')
  assert.deepEqual(lowScore.nutrition, original.nutrition)
  assert.equal(lowScore.nutritionEvidence.reason, 'catalog_match_below_trust_threshold')
})

test('nutrition totals are recomputed from enriched items with stable rounding', () => {
  const totals = sumNutritionItems([
    { nutrition: nutrition({ calories: 100.04, proteinG: 2.24 }) },
    { nutrition: nutrition({ calories: 50.04, proteinG: 3.24 }) },
  ])

  assert.deepEqual(totals, {
    calories: 150.1,
    proteinG: 5.5,
    carbsG: 40,
    fatG: 6,
    fiberG: 4,
    sugarG: 8,
    sodiumMg: 100,
  })
})

test('analysis enrichment recomputes totals and surfaces ambiguous and unscalable evidence', () => {
  const first = analysisItem({ cookingMethod: 'Tươi' })
  const second = analysisItem({ nameVi: 'Món tổng hợp', estimatedGrams: 200, nutrition: nutrition({ calories: 220 }) })
  const source = {
    isFood: true,
    dishNameVi: 'Cơm và món tổng hợp',
    dishNameEn: 'Rice and mixed dish',
    portionSummary: 'Một phần',
    confidence: 0.7,
    calorieRange: { low: 250, high: 500 },
    totals: nutrition({ calories: 999 }),
    items: [first, second],
    questions: [],
    warnings: [],
  }
  const enriched = enrichAnalysisWithLookups(
    source,
    { status: 'ambiguous', match: null, candidates: [catalogMatch()] },
    [
      { status: 'matched', match: catalogMatch(), candidates: [catalogMatch()] },
      {
        status: 'matched',
        match: catalogMatch({
          catalogId: 'nin:dish:mixed',
          kind: 'dish',
          basis: { amount: null, unit: null, qualifier: 'not_specified_by_source', labelVi: null },
        }),
        candidates: [],
      },
    ],
  )

  assert.equal(enriched.totals.calories, 520)
  assert.equal(enriched.databaseEvidence.catalogCalculatedItemCount, 1)
  assert.equal(enriched.databaseEvidence.ambiguousCount, 1)
  assert.equal(enriched.databaseEvidence.unscalableDishCount, 1)
  assert.equal(enriched.calorieRange.high, 520)
  assert.ok(enriched.warnings.some((warning) => warning.includes('chưa rõ ràng')))
})

test('analysis enrichment marks cooking-state mismatches as needing confirmation', () => {
  const source = {
    isFood: true,
    dishNameVi: 'Thịt luộc',
    dishNameEn: 'Boiled meat',
    portionSummary: 'Một phần',
    confidence: 0.9,
    calorieRange: { low: 100, high: 180 },
    totals: nutrition({ calories: 135 }),
    items: [analysisItem({ cookingMethod: 'Luộc', nutrition: nutrition({ calories: 135 }) })],
    questions: [],
    warnings: [],
  }
  const enriched = enrichAnalysisWithLookups(
    source,
    { status: 'not_found', match: null, candidates: [] },
    [{ status: 'matched', match: catalogMatch(), candidates: [catalogMatch()] }],
  )

  assert.equal(enriched.databaseEvidence.status, 'needs_confirmation')
  assert.equal(enriched.databaseEvidence.cookingStateNeedsConfirmationCount, 1)
  assert.equal(enriched.databaseEvidence.catalogCalculatedItemCount, 0)
  assert.ok(enriched.warnings.some((warning) => warning.includes('dữ liệu sống/tươi')))
})

test('non-food analysis cannot carry food items, calorie ranges, or nutrition totals', () => {
  const zeroNutrition = nutrition({
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    fiberG: 0,
    sugarG: 0,
    sodiumMg: 0,
  })
  const nonFood = {
    isFood: false,
    dishNameVi: 'Không phải món ăn',
    dishNameEn: 'Not food',
    portionSummary: 'Không có khẩu phần',
    confidence: 0.95,
    calorieRange: { low: 0, high: 0 },
    totals: zeroNutrition,
    items: [],
    questions: [],
    warnings: ['Ảnh không chứa món ăn.'],
  }

  assert.doesNotThrow(() => validateFoodAnalysis(nonFood))
  assert.throws(
    () => validateFoodAnalysis({ ...nonFood, items: [analysisItem()] }),
    /Non-food analysis must contain no items and zero nutrition values/,
  )
  assert.throws(
    () => validateFoodAnalysis({ ...nonFood, totals: { ...zeroNutrition, calories: 10 } }),
    /Non-food analysis must contain no items and zero nutrition values/,
  )
  assert.throws(
    () => validateFoodAnalysis({ ...nonFood, calorieRange: { low: 0, high: 10 } }),
    /Non-food analysis must contain no items and zero nutrition values/,
  )
})
