const assert = require('node:assert/strict')
const test = require('node:test')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const {
  createNutritionFunctions,
  foodAnalysisNeedsEscalation,
  foodAnalysisQualityScore,
  validateFoodAnalysis,
  validateFoodAnalysisWithLocalRepair,
} = require('./nutrition')
const {
  REGULAR_DAILY_FOOD_SCAN_LIMIT,
  STAFF_DAILY_FOOD_SCAN_LIMIT,
  dailyFoodScanLimitForRoles,
  trustedFoodScanRole,
} = require('./nutrition-scan-policy')
const {
  FOOD_SCAN_CACHE_VERSION,
  buildFoodScanCacheKey,
} = require('./nutrition-scan-cache')

const nutritionSource = readFileSync(join(__dirname, 'nutrition.js'), 'utf8')

function nutrition(overrides = {}) {
  return {
    calories: 460,
    proteinG: 38,
    carbsG: 48,
    fatG: 16,
    fiberG: 4,
    sugarG: 4,
    sodiumMg: 350,
    ...overrides,
  }
}

function compactFoodVisionResult() {
  return {
    isFood: true,
    dishNameVi: 'Cơm gà rau củ',
    dishNameEn: 'Chicken rice with vegetables',
    portionSummary: 'Một phần cơm gà kèm rau củ',
    confidence: 0.88,
    calorieRange: { low: 420, high: 500 },
    totals: nutrition(),
    items: [{
      nameVi: 'Cơm gà rau củ',
      nameEn: 'Chicken rice with vegetables',
      searchNameAscii: 'com ga rau cu',
      estimatedGrams: 350,
      gramRange: { low: 300, high: 400 },
      cookingMethod: 'Gà áp chảo, cơm chín và rau luộc',
      nutrition: nutrition(),
      confidence: 0.84,
      assumptions: ['Không nhìn rõ lượng dầu.'],
    }],
    questions: ['Bạn có dùng thêm sốt không?'],
    warnings: [],
  }
}

function fullFoodVisionResult() {
  return validateFoodAnalysisWithLocalRepair(compactFoodVisionResult(), {
    studentGoal: 'Giam mo',
  }).analysis
}

test('nutrition callable factory initializes with the configured App Check policy', () => {
  const functions = createNutritionFunctions({ app: {}, db: {} })
  assert.equal(typeof functions.analyzeFoodImage, 'function')
  assert.equal(typeof functions.generateMealReview, 'function')
  assert.equal(typeof functions.askAiCoach, 'function')
})

test('full provider advisory answers are preserved without local replacement', () => {
  const providerResult = fullFoodVisionResult()
  const result = validateFoodAnalysisWithLocalRepair(providerResult, {
    studentGoal: 'Giam mo',
  })

  assert.deepEqual(result.repairedFields, [])
  assert.equal(result.analysis.quantityAndCookingAnalysis, providerResult.quantityAndCookingAnalysis)
  assert.equal(result.analysis.portionAndCalorieRationale, providerResult.portionAndCalorieRationale)
  assert.equal(result.analysis.goalAlignmentAssessment, providerResult.goalAlignmentAssessment)
  assert.equal(result.analysis.calorieOptimizationTip, providerResult.calorieOptimizationTip)
  assert.equal(result.analysis.macroBalanceAssessment, providerResult.macroBalanceAssessment)
  assert.equal(result.analysis.coachFeedbackSuggestion, providerResult.coachFeedbackSuggestion)
  assert.equal(result.analysis.aiFeedback, providerResult.aiFeedback)
})

test('legacy incomplete provider facts retain a local repair fallback for response compatibility', () => {
  const compact = compactFoodVisionResult()
  const result = validateFoodAnalysisWithLocalRepair(compact, {
    studentGoal: 'Giảm mỡ',
  })

  assert.deepEqual(result.repairedFields, [
    'quantityAndCookingAnalysis',
    'portionAndCalorieRationale',
    'goalAlignmentAssessment',
    'calorieOptimizationTip',
    'macroBalanceAssessment',
    'coachFeedbackSuggestion',
    'aiFeedback',
  ])
  assert.doesNotThrow(() => validateFoodAnalysis(result.analysis))
  assert.match(result.analysis.goalAlignmentAssessment, /460/)
  assert.match(result.analysis.macroBalanceAssessment, /38/)
  assert.match(result.analysis.macroBalanceAssessment, /48/)
})

test('legacy incomplete non-food results retain neutral local advisory fallback fields', () => {
  const zeroNutrition = nutrition({
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    fiberG: 0,
    sugarG: 0,
    sodiumMg: 0,
  })
  const compact = {
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
  const result = validateFoodAnalysisWithLocalRepair(compact)

  assert.deepEqual(result.repairedFields, [
    'quantityAndCookingAnalysis',
    'portionAndCalorieRationale',
    'goalAlignmentAssessment',
    'calorieOptimizationTip',
    'macroBalanceAssessment',
    'coachFeedbackSuggestion',
    'aiFeedback',
  ])
  assert.doesNotThrow(() => validateFoodAnalysis(result.analysis))
  assert.equal(result.analysis.totals.calories, 0)
  assert.equal(result.analysis.items.length, 0)
})

test('two-tier scan escalation is reserved for materially uncertain food results', () => {
  const confident = compactFoodVisionResult()
  assert.equal(foodAnalysisNeedsEscalation(confident), false)

  assert.equal(foodAnalysisNeedsEscalation({ ...confident, confidence: 0.61 }), true)
  assert.equal(foodAnalysisNeedsEscalation({ ...confident, items: [] }), true)
  assert.equal(foodAnalysisNeedsEscalation({
    ...confident,
    items: confident.items.map((item) => ({ ...item, confidence: 0.44 })),
  }), true)
  assert.equal(foodAnalysisNeedsEscalation({
    ...confident,
    confidence: 0.7,
    calorieRange: { low: 100, high: 500 },
  }), true)
  assert.equal(foodAnalysisNeedsEscalation({
    ...confident,
    confidence: 0.7,
    calorieRange: { low: 400, high: 500 },
  }), false)
  assert.equal(foodAnalysisNeedsEscalation({ ...confident, isFood: false, items: [] }), false)
  assert.equal(foodAnalysisNeedsEscalation(null), false)
})

test('two-tier candidate scoring prefers the more defensible valid estimate', () => {
  const confident = compactFoodVisionResult()
  const weak = {
    ...confident,
    confidence: 0.65,
    calorieRange: { low: 150, high: 700 },
    items: confident.items.map((item) => ({ ...item, confidence: 0.5 })),
  }

  assert.ok(foodAnalysisQualityScore(confident) > foodAnalysisQualityScore(weak))
  assert.equal(foodAnalysisQualityScore(null), Number.NEGATIVE_INFINITY)
})

test('locally repaired advisory fields force quality escalation to the fallback model', () => {
  assert.match(
    nutritionSource,
    /needsQualityEscalation\s*=\s*validated\.repairedFields\.length\s*>\s*0\s*\|\|\s*foodAnalysisNeedsEscalation\(validated\.analysis\)/,
  )
  assert.match(
    nutritionSource,
    /Food vision result needs quality escalation; requesting the fallback model\./,
  )
})

test('full advisory prompt receives the bounded student goal and condition context', () => {
  assert.match(
    nutritionSource,
    /studentGoal:\s*studentGoal\s*\|\|\s*'Chưa cập nhật'/,
  )
  assert.match(
    nutritionSource,
    /studentCondition:\s*studentCondition\s*\|\|\s*'Chưa cập nhật'/,
  )
  assert.match(
    nutritionSource,
    /validateFoodAnalysisWithLocalRepair\(parsedAnalysis,\s*\{ studentGoal, studentCondition \}\)/,
  )
})

test('daily food scan limits are 10 for members and 50 for trusted coach/admin accounts', () => {
  assert.equal(REGULAR_DAILY_FOOD_SCAN_LIMIT, 10)
  assert.equal(STAFF_DAILY_FOOD_SCAN_LIMIT, 50)

  for (const role of ['coach', 'admin', 'super_admin']) {
    assert.equal(dailyFoodScanLimitForRoles({ tokenRole: role, profileRole: role }), 50)
  }
  for (const role of ['student', 'editor']) {
    assert.equal(dailyFoodScanLimitForRoles({ tokenRole: role, profileRole: role }), 10)
  }
})

test('scan privileges fail closed for missing, stale, unknown, or mismatched roles', () => {
  assert.equal(trustedFoodScanRole({ tokenRole: 'coach', profileRole: 'student' }), 'student')
  assert.equal(dailyFoodScanLimitForRoles({ tokenRole: 'coach', profileRole: 'student' }), 10)
  assert.equal(dailyFoodScanLimitForRoles({ tokenRole: 'admin' }), 10)
  assert.equal(dailyFoodScanLimitForRoles({ profileRole: 'admin' }), 10)
  assert.equal(dailyFoodScanLimitForRoles({ tokenRole: 'owner', profileRole: 'owner' }), 10)
  assert.equal(dailyFoodScanLimitForRoles({
    tokenRole: 'student',
    profileRole: 'student',
    requestRole: 'admin',
  }), 10)
  assert.equal(dailyFoodScanLimitForRoles(), 10)
})

test('food scan cache identity is stable, opaque, and independent from retry scan IDs', () => {
  const input = {
    uid: 'member-1',
    imageBuffer: Buffer.from('same optimized image bytes'),
    contentType: 'image/webp',
    mealType: 'dinner',
    notes: '  Không   dùng sốt  ',
    studentGoal: 'Giảm mỡ',
    studentCondition: 'Học viên Aura',
  }
  const first = buildFoodScanCacheKey(input)
  const retry = buildFoodScanCacheKey({ ...input, scanId: 'a-new-scan-id' })

  assert.equal(first, retry)
  assert.match(first, /^[a-f0-9]{64}$/)
  assert.equal(first.includes('member-1'), false)
  assert.equal(first.includes('Không'), false)
})

test('food scan cache identity changes across owner, image, context, and analysis versions', () => {
  assert.equal(FOOD_SCAN_CACHE_VERSION, 'food-vision-full-advisory-v2')

  const base = {
    uid: 'member-1',
    imageBuffer: Buffer.from('image-a'),
    contentType: 'image/webp',
    mealType: 'lunch',
    notes: '',
    studentGoal: 'Giảm mỡ',
    studentCondition: '',
  }
  const key = buildFoodScanCacheKey(base)

  assert.notEqual(buildFoodScanCacheKey({ ...base, uid: 'member-2' }), key)
  assert.notEqual(buildFoodScanCacheKey({ ...base, imageBuffer: Buffer.from('image-b') }), key)
  assert.notEqual(buildFoodScanCacheKey({ ...base, mealType: 'dinner' }), key)
  assert.notEqual(buildFoodScanCacheKey({ ...base, notes: 'Không sốt' }), key)
  assert.notEqual(buildFoodScanCacheKey({ ...base, studentGoal: 'Tăng cơ' }), key)
  assert.notEqual(buildFoodScanCacheKey({ ...base, analysisVersion: `${FOOD_SCAN_CACHE_VERSION}-next` }), key)
})

test('cache lookup happens before paid quota and live inference, while cache writes remain best-effort', () => {
  const cacheLookup = nutritionSource.indexOf('const cachedResult = await readFoodVisionCache')
  const quotaLookup = nutritionSource.indexOf('const dailyLimit = await readFoodScanDailyLimit')
  const liveInference = nutritionSource.indexOf('const providerResult = await analyzeWithOpenRouter')
  const cacheWrite = nutritionSource.indexOf('await writeFoodVisionCache')

  assert.ok(cacheLookup > 0)
  assert.ok(cacheLookup < quotaLookup)
  assert.ok(quotaLookup < liveInference)
  assert.ok(liveInference < cacheWrite)
  assert.match(nutritionSource, /Food vision cache lookup failed; continuing with live analysis/)
  assert.match(nutritionSource, /Food vision cache write failed; returning the live result/)
  assert.match(nutritionSource, /scanId: input\.scanId,[\s\S]*status: 'completed',[\s\S]*provider: 'openrouter'/)
})
