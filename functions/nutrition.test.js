const assert = require('node:assert/strict')
const test = require('node:test')

const {
  applyCatalogLookupToItem,
  buildFoodOpenRouterRequest,
  buildFoodAnalysisInstructions,
  enrichAnalysisWithLookups,
  extractOpenRouterNutritionText,
  foodAnalysisSchema,
  getOpenRouterFoodModelCandidates,
  openRouterUsageMetadata,
  sanitizeProviderErrorMessage,
  scaleCatalogNutrition,
  shouldTryNextFoodAnalysisModel,
  sumNutritionItems,
  validateFoodAnalysis,
  validateFoodAnalysisWithLocalRepair,
} = require('./nutrition')

test('OpenRouter model candidates use Gemini 3.7 Flash and remove duplicates', () => {
  const originalModel = process.env.OPENROUTER_VISION_MODEL
  const originalFallback = process.env.OPENROUTER_VISION_FALLBACK_MODEL
  try {
    delete process.env.OPENROUTER_VISION_MODEL
    delete process.env.OPENROUTER_VISION_FALLBACK_MODEL
    assert.deepEqual(getOpenRouterFoodModelCandidates(), [
      'google/gemini-3.7-flash',
      'google/gemini-3.6-flash',
    ])

    process.env.OPENROUTER_VISION_MODEL = 'google/gemini-3.7-flash'
    process.env.OPENROUTER_VISION_FALLBACK_MODEL = 'google/gemini-3.7-flash'
    assert.deepEqual(getOpenRouterFoodModelCandidates(), ['google/gemini-3.7-flash'])
  } finally {
    if (originalModel === undefined) delete process.env.OPENROUTER_VISION_MODEL
    else process.env.OPENROUTER_VISION_MODEL = originalModel
    if (originalFallback === undefined) delete process.env.OPENROUTER_VISION_FALLBACK_MODEL
    else process.env.OPENROUTER_VISION_FALLBACK_MODEL = originalFallback
  }
})

test('food analysis retries transient, incomplete, and invalid structured responses on the fallback model', () => {
  const base = { index: 0, modelCount: 2, providerMessage: null }

  assert.equal(shouldTryNextFoodAnalysisModel({ ...base, status: 0, stage: 'provider_error' }), true)
  assert.equal(shouldTryNextFoodAnalysisModel({ ...base, status: 500, stage: 'provider_error' }), true)
  assert.equal(shouldTryNextFoodAnalysisModel({ ...base, status: 200, stage: 'incomplete_response' }), true)
  assert.equal(shouldTryNextFoodAnalysisModel({ ...base, status: 200, stage: 'structured_output' }), true)
})

test('food analysis does not retry permanent provider errors or after the last model', () => {
  assert.equal(shouldTryNextFoodAnalysisModel({
    index: 0,
    modelCount: 2,
    status: 400,
    providerMessage: 'Invalid image data.',
    stage: 'provider_error',
  }), false)
  assert.equal(shouldTryNextFoodAnalysisModel({
    index: 1,
    modelCount: 2,
    status: 503,
    providerMessage: null,
    stage: 'provider_error',
  }), false)
})

test('food analysis prompt asks the model to answer every advisory field separately', () => {
  const instructions = buildFoodAnalysisInstructions()

  assert.match(instructions, /quantityAndCookingAnalysis: Describe only visible estimated quantities/)
  assert.match(instructions, /calorieOptimizationTip: Give one practical food\/portion change/)
  assert.match(instructions, /macroBalanceAssessment: State the exact returned grams for protein, carbohydrate, fat, and fiber/)
  assert.match(instructions, /coachFeedbackSuggestion: Write a separate 30-100 word internal draft/)
  assert.match(instructions, /Never concatenate headings, repeat the same sentence, or move content between fields/)
  assert.match(instructions, /student goal supplied only as untrusted metadata/)
  assert.match(instructions, /Never add filler, greetings, motivational slogans, body\/beauty claims/)
})

test('food vision sends image and strict JSON schema through OpenRouter', () => {
  const body = buildFoodOpenRouterRequest({
    model: 'google/gemini-3.7-flash',
    buffer: Buffer.from('image-bytes'),
    contentType: 'image/jpeg',
    prompt: 'Analyze this meal.',
    instructions: 'Return nutrition JSON.',
  })

  assert.equal(body.model, 'google/gemini-3.7-flash')
  assert.equal(body.messages[0].role, 'system')
  assert.equal(body.messages[1].content[0].type, 'text')
  assert.match(body.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/)
  assert.equal(body.max_tokens, 6144)
  assert.equal(buildFoodOpenRouterRequest({
    model: 'google/gemini-3.7-flash',
    buffer: Buffer.from('image-bytes'),
    contentType: 'image/jpeg',
    prompt: 'Analyze this meal.',
    instructions: 'Return nutrition JSON.',
    qualityTier: 'escalated',
  }).max_tokens, 6144)
  assert.equal(body.reasoning.effort, 'low')
  assert.equal(body.response_format.type, 'json_schema')
  assert.equal(body.response_format.json_schema.strict, true)
  assert.notEqual(body.response_format.json_schema.schema, foodAnalysisSchema)
  assert.equal(JSON.stringify(body.response_format.json_schema.schema).includes('minLength'), false)
  assert.equal(JSON.stringify(body.response_format.json_schema.schema).includes('maxLength'), false)
  assert.equal(JSON.stringify(body.response_format.json_schema.schema).includes('maxItems'), false)
  assert.equal(body.response_format.json_schema.schema.properties.totals.properties.calories.maximum, 10000)
  for (const field of [
    'quantityAndCookingAnalysis',
    'portionAndCalorieRationale',
    'goalAlignmentAssessment',
    'calorieOptimizationTip',
    'macroBalanceAssessment',
    'coachFeedbackSuggestion',
    'aiFeedback',
  ]) {
    assert.equal(Object.hasOwn(body.response_format.json_schema.schema.properties, field), true)
    assert.equal(body.response_format.json_schema.schema.required.includes(field), true)
  }
  assert.equal(body.provider.require_parameters, true)
  assert.equal(Object.hasOwn(body, 'temperature'), false)
})

test('food vision records provider token usage as bounded telemetry numbers', () => {
  assert.deepEqual(openRouterUsageMetadata({
    usage: {
      prompt_tokens: 1748,
      completion_tokens: 1709,
      total_tokens: 3457,
      completion_tokens_details: { reasoning_tokens: 125 },
      prompt_tokens_details: { cached_tokens: 20 },
    },
  }), {
    promptTokenCount: 1748,
    candidatesTokenCount: 1584,
    thoughtsTokenCount: 125,
    cachedContentTokenCount: 20,
    totalTokenCount: 3457,
    costUsd: null,
  })

  assert.equal(openRouterUsageMetadata({ usage: { cost: 0.004204625 } }).costUsd, 0.004204625)
  assert.equal(openRouterUsageMetadata({ usage: { cost: -1 } }).costUsd, null)
})

test('OpenRouter parser accepts completed text and rejects incomplete output', () => {
  assert.equal(extractOpenRouterNutritionText({
    choices: [{ finish_reason: 'stop', message: { content: '{"isFood":true}' } }],
  }), '{"isFood":true}')
  assert.throws(() => extractOpenRouterNutritionText({
    choices: [{ finish_reason: 'length', message: { content: '{}' } }],
  }), /chưa hoàn tất/)
})

test('invalid macro advice is repaired locally as a final response safety net', () => {
  const source = validFoodAnalysis()
  source.macroBalanceAssessment = 'Hàm lượng đạm tốt cho phục hồi cơ bắp.'

  const result = validateFoodAnalysisWithLocalRepair(source, { studentGoal: 'Giảm mỡ thâm hụt calo' })

  assert.deepEqual(result.repairedFields, ['macroBalanceAssessment'])
  assert.match(result.analysis.macroBalanceAssessment, /đạm/)
  assert.match(result.analysis.macroBalanceAssessment, /carb/)
  assert.match(result.analysis.macroBalanceAssessment, /chất béo/)
  assert.match(result.analysis.macroBalanceAssessment, /chất xơ/)
  assert.match(result.analysis.macroBalanceAssessment, /\d/)
})

test('food analysis validation preserves the new structured advisory fields', () => {
  const source = {
    isFood: true,
    dishNameVi: 'Cơm gà',
    dishNameEn: 'Chicken rice',
    portionSummary: 'Một phần cơm gà',
    confidence: 0.9,
    calorieRange: { low: 400, high: 500 },
    totals: nutrition({ calories: 450 }),
    quantityAndCookingAnalysis: 'Khoảng 150g cơm và 120g gà áp chảo.',
    portionAndCalorieRationale: 'Ước tính theo kích thước đĩa và độ dày miếng gà.',
    goalAlignmentAssessment: 'Bữa ăn 450 kcal với khoảng 38g đạm phù hợp mục tiêu giảm mỡ hiện tại.',
    calorieOptimizationTip: 'Giảm một nửa lượng sốt để hạ năng lượng từ chất béo.',
    macroBalanceAssessment: 'Khoảng 38g đạm và 48g carb khá tốt, nhưng 16g chất béo hơi cao và 4g chất xơ còn thấp.',
    coachFeedbackSuggestion: 'Bản nháp dành cho Coach kiểm tra trước khi gửi học viên.',
    aiFeedback: 'Bữa ăn có cấu trúc dinh dưỡng khá cân đối.',
    items: [analysisItem()],
    questions: [],
    warnings: [],
  }

  const result = validateFoodAnalysis(source)
  assert.equal(result.calorieOptimizationTip, source.calorieOptimizationTip)
  assert.equal(result.macroBalanceAssessment, source.macroBalanceAssessment)
  assert.notEqual(result.quantityAndCookingAnalysis, result.goalAlignmentAssessment)
})

test('food analysis validation rejects missing advisory answers', () => {
  const source = validFoodAnalysis()
  delete source.calorieOptimizationTip
  assert.throws(() => validateFoodAnalysis(source), /calorieOptimizationTip must be a non-empty string/)
})

test('food analysis validation rejects repetitive and unrelated Gemini tails', () => {
  const source = validFoodAnalysis()
  source.quantityAndCookingAnalysis += ' bạn nhé đàng hoàng bạn nhé đàng hoàng bạn nhé đàng hoàng bạn nhé đàng hoàng bạn nhé đàng hoàng bạn nhé đàng hoàng'
  assert.throws(() => validateFoodAnalysis(source), /repetitive or degenerate text/)

  const beautyTail = validFoodAnalysis()
  beautyTail.quantityAndCookingAnalysis += ' Nội dung này giúp làn da mịn màng, vóc dáng xinh xắn, trẻ trung, quyến rũ và tỏa sáng.'
  assert.throws(() => validateFoodAnalysis(beautyTail), /repetitive or degenerate text/)
})

test('food analysis validation rejects generic goal and macro placeholders without numeric meal evidence', () => {
  assert.throws(
    () => validateFoodAnalysis({
      ...validFoodAnalysis(),
      goalAlignmentAssessment: 'Bữa ăn phù hợp chỉ tiêu năng lượng và đạm trong ngày.',
    }),
    /goalAlignmentAssessment must compare numeric meal data/,
  )
  assert.throws(
    () => validateFoodAnalysis({
      ...validFoodAnalysis(),
      macroBalanceAssessment: 'Hàm lượng đạm rất tốt cho sự phục hồi cơ bắp.',
    }),
    /macroBalanceAssessment must assess numeric data/,
  )
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

test('provider errors are flattened, bounded, and redact API credentials', () => {
  const secret = `sk-or-v1-${'x'.repeat(32)}`
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

function validFoodAnalysis(overrides = {}) {
  return {
    isFood: true,
    dishNameVi: 'Cơm gà rau củ',
    dishNameEn: 'Chicken rice with vegetables',
    portionSummary: 'Một phần cơm gà kèm rau củ',
    confidence: 0.88,
    calorieRange: { low: 420, high: 500 },
    totals: nutrition({ calories: 460, proteinG: 38, carbsG: 48, fatG: 16, fiberG: 4 }),
    quantityAndCookingAnalysis: 'Khoảng 150g cơm chín, 120g ức gà áp chảo và 80g rau củ luộc.',
    portionAndCalorieRationale: 'Ước tính dựa trên kích thước đĩa, độ dày phần ức gà và lượng dầu khó quan sát khi áp chảo.',
    goalAlignmentAssessment: 'Bữa ăn khoảng 460 kcal và 38g đạm phù hợp mục tiêu giảm mỡ, nhưng chất xơ còn thấp.',
    calorieOptimizationTip: 'Giảm khoảng 5g dầu áp chảo hoặc bớt sốt để hạ năng lượng của khẩu phần.',
    macroBalanceAssessment: 'Khoảng 38g đạm và 48g carb khá tốt, nhưng 16g chất béo hơi cao và 4g chất xơ còn thấp.',
    coachFeedbackSuggestion: 'Bữa ăn có lượng đạm phù hợp; Coach nên xác nhận lượng dầu và khuyến khích học viên bổ sung thêm rau.',
    aiFeedback: 'Bữa ăn giàu đạm và có mức năng lượng vừa phải, nhưng cần tăng thêm chất xơ.',
    items: [analysisItem()],
    questions: [],
    warnings: [],
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
    quantityAndCookingAnalysis: 'Không áp dụng vì ảnh không chứa món ăn.',
    portionAndCalorieRationale: 'Không áp dụng vì ảnh không chứa món ăn.',
    goalAlignmentAssessment: 'Không áp dụng vì ảnh không chứa món ăn.',
    calorieOptimizationTip: 'Không áp dụng vì ảnh không chứa món ăn.',
    macroBalanceAssessment: 'Không áp dụng vì ảnh không chứa món ăn.',
    coachFeedbackSuggestion: 'Không áp dụng vì ảnh không chứa món ăn.',
    aiFeedback: 'Không áp dụng vì ảnh không chứa món ăn.',
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
