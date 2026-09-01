const assert = require('node:assert/strict')
const test = require('node:test')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { HttpsError } = require('firebase-functions/v2/https')

const {
  buildHealthCoachPrompt,
  buildHealthCoachSystemPrompt,
  buildMedicalCautionResponse,
  capHealthCoachHistory,
  classifyHealthCoachSafety,
  createNutritionFunctions,
  healthCoachProviderCapacity,
  healthCoachPrimaryApiKey,
  healthCoachRateLimitMutation,
  healthCoachTurnFingerprint,
  normalizeHealthCoachClientTurnId,
  normalizeHealthCoachConversationId,
  parseHealthCoachImageAttachment,
  parseHealthCoachProviderResponse,
  resetHealthCoachProviderState,
  recordHealthCoachPrimaryProviderFailure,
  recordHealthCoachPrimaryProviderSuccess,
  runHealthCoachProviderRequest,
  summarizeHealthCoachContext,
  validHealthCoachContextCache,
} = require('./nutrition')

const nutritionSource = readFileSync(join(__dirname, 'nutrition.js'), 'utf8')
const functionsIndexSource = readFileSync(join(__dirname, 'index.js'), 'utf8')
const storageRulesSource = readFileSync(join(__dirname, '..', 'storage.rules'), 'utf8')

test('AI Health Coach context uses bounded server records and real nutrition totals', () => {
  const summary = summarizeHealthCoachContext({
    now: new Date('2026-08-31T04:00:00.000Z'),
    profile: {
      displayName: 'An',
      targetWeightDeltaKg: -5,
      healthConditions: ['Tiểu đường type 2'],
      nutritionProfile: {
        goal: 'lose-fat',
        age: 32,
        biologicalSex: 'female',
        heightCm: 165,
        weightKg: 72,
        activityLevel: 'moderate',
        targetCalories: 1800,
        protein: 120,
        allergies: 'Đậu phộng',
      },
    },
    meals: [
      { date: '2026-08-31', status: 'logged', title: 'Cơm gà', calories: 500, protein: 35 },
      { date: '2026-08-30', status: 'logged', title: 'Bún cá', calories: 450, proteinG: 25 },
      { date: '2026-08-25', status: 'logged', title: 'Salad', totals: { calories: 300, proteinG: 20 } },
      { date: '2026-08-24', status: 'logged', title: 'Quá cũ', calories: 999, protein: 99 },
      { date: '2026-08-31', status: 'planned', title: 'Chưa ăn', calories: 800, protein: 50 },
    ],
    weights: [
      { date: '2026-08-20', weightKg: 71 },
      { date: '2026-08-31', weightKg: 70 },
    ],
    activities: [
      { date: '2026-08-29', title: 'Tập sức mạnh', durationMinutes: 45 },
      { date: '2026-08-22', title: 'Quá cũ', durationMinutes: 45 },
    ],
    waters: [
      { date: '2026-08-31', amountMl: 700 },
      { date: '2026-08-30', amountMl: 1200 },
    ],
    bodyMeasurements: { waistCm: 78, bodyFatPercentage: 28 },
  })

  assert.deepEqual(summary.context, {
    goalLabel: 'Giảm mỡ bền vững',
    latestWeightKg: 70,
    targetWeightKg: 65,
    todayCalories: 500,
    calorieGoal: 1800,
    todayProteinG: 35,
    proteinGoalG: 120,
    loggedDays7: 3,
    workoutDays7: 1,
    updatedAt: '2026-08-31T04:00:00.000Z',
  })
  assert.equal(summary.promptContext.last7Days.mealsLogged, 3)
  assert.equal(summary.promptContext.last7Days.averageCaloriesPerLoggedDay, 417)
  assert.equal(summary.promptContext.weightTrendKg, -1)
  assert.equal(summary.promptContext.today.waterMl, 700)
  assert.equal(summary.promptContext.last7Days.waterLoggedDays, 2)
  assert.equal(summary.promptContext.recentMeals.some((meal) => meal.title === 'Quá cũ'), false)
  assert.match(summary.dataUsed.join(' | '), /3 bữa trong 3\/7 ngày/)
  assert.equal(summary.missingData.includes('Chưa có chỉ số vòng đo hoặc thành phần cơ thể'), false)
})

test('weight-loss target is omitted without an explicit delta and timeframe', () => {
  const summary = summarizeHealthCoachContext({
    now: new Date('2026-08-31T04:00:00.000Z'),
    profile: {
      nutritionProfile: {
        goal: 'lose-fat',
        age: 30,
        biologicalSex: 'female',
        heightCm: 165,
        weightKg: 68,
        activityLevel: 'moderate',
      },
    },
  })

  assert.equal(Object.hasOwn(summary.context, 'calorieGoal'), false)
  assert.equal(Object.hasOwn(summary.context, 'targetWeightKg'), false)
  assert.ok(summary.context.proteinGoalG > 0)
  assert.match(summary.missingData.join(' | '), /mức thay đổi cân nặng và thời hạn mục tiêu/)
})

test('AI Health Coach reports missing data instead of inventing profile defaults', () => {
  const summary = summarizeHealthCoachContext({
    now: new Date('2026-08-31T04:00:00.000Z'),
    profile: {},
  })

  assert.equal(Object.hasOwn(summary.context, 'latestWeightKg'), false)
  assert.equal(Object.hasOwn(summary.context, 'targetWeightKg'), false)
  assert.equal(Object.hasOwn(summary.context, 'calorieGoal'), false)
  assert.equal(Object.hasOwn(summary.context, 'proteinGoalG'), false)
  assert.equal(Object.hasOwn(summary.context, 'todayCalories'), false)
  assert.equal(Object.hasOwn(summary.context, 'todayProteinG'), false)
  assert.equal(summary.context.loggedDays7, 0)
  assert.match(summary.missingData.join(' | '), /Mục tiêu cơ thể chưa được cập nhật/)
  assert.match(summary.missingData.join(' | '), /Chưa có cân nặng gần đây/)
})

test('conversation ids are actor-path safe and history is capped to ten messages', () => {
  assert.equal(normalizeHealthCoachConversationId(), 'default')
  assert.equal(normalizeHealthCoachConversationId('coach_2026-08-31'), 'coach_2026-08-31')
  assert.throws(
    () => normalizeHealthCoachConversationId('../another-user'),
    (error) => error?.code === 'invalid-argument',
  )

  const history = Array.from({ length: 14 }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 ? 'assistant' : 'user',
    text: `Tin ${index}`,
  }))
  const capped = capHealthCoachHistory(history)
  assert.equal(capped.length, 10)
  assert.equal(capped[0].id, 'm4')
  assert.equal(capped[9].id, 'm13')
  assert.equal(capped[0].sender, 'user')
  assert.equal(capped[1].sender, 'ai')
})

test('client turn receipts accept opaque ids and bind retries to the exact request', () => {
  assert.equal(normalizeHealthCoachClientTurnId(), null)
  assert.equal(normalizeHealthCoachClientTurnId('turn_12345678'), 'turn_12345678')
  assert.throws(
    () => normalizeHealthCoachClientTurnId('../turn'),
    (error) => error?.code === 'invalid-argument',
  )
  const base = {
    conversationId: 'default',
    message: 'Mình nên ăn gì?',
    attachment: null,
  }
  assert.equal(healthCoachTurnFingerprint(base), healthCoachTurnFingerprint({ ...base }))
  assert.notEqual(healthCoachTurnFingerprint(base), healthCoachTurnFingerprint({ ...base, message: 'Câu khác' }))
  const imageTurn = { ...base, attachment: { kind: 'meal', purpose: 'ai-coach-meal', storagePath: 'path-a' } }
  assert.equal(
    healthCoachTurnFingerprint(imageTurn),
    healthCoachTurnFingerprint({ ...imageTurn, attachment: { ...imageTurn.attachment, storagePath: 'path-b' } }),
  )
})

test('context cache accepts only current, complete and unexpired server summaries', () => {
  const summary = {
    context: {},
    promptContext: {},
    dataUsed: [],
    missingData: [],
    suggestedReplies: [],
  }
  assert.equal(validHealthCoachContextCache({ schemaVersion: 1, expiresAtMs: 2_000, summary }, 1_000), true)
  assert.equal(validHealthCoachContextCache({ schemaVersion: 1, expiresAtMs: 999, summary }, 1_000), false)
  assert.equal(validHealthCoachContextCache({ schemaVersion: 2, expiresAtMs: 2_000, summary }, 1_000), false)
  assert.equal(validHealthCoachContextCache({ schemaVersion: 1, expiresAtMs: 2_000, summary: {} }, 1_000), false)
})

test('rate limit mutation bounds both burst and daily AI usage before a receipt is written', () => {
  const now = 2_000_000
  const recent = { toMillis: () => now - 1_000 }
  const allowed = healthCoachRateLimitMutation({
    windowStartedAt: recent,
    dayStartedAt: recent,
    windowCount: 19,
    dayCount: 99,
  }, now)
  assert.equal(allowed.windowCount, 20)
  assert.equal(allowed.dayCount, 100)
  assert.throws(
    () => healthCoachRateLimitMutation({
      windowStartedAt: recent,
      dayStartedAt: recent,
      windowCount: 20,
      dayCount: 20,
    }, now),
    (error) => error?.code === 'resource-exhausted',
  )
  assert.throws(
    () => healthCoachRateLimitMutation({
      windowStartedAt: recent,
      dayStartedAt: recent,
      windowCount: 1,
      dayCount: 100,
    }, now),
    (error) => error?.code === 'resource-exhausted',
  )
})

test('per-instance provider admission rejects overflow without a global hot document', async () => {
  resetHealthCoachProviderState()
  const releases = []
  const hold = () => runHealthCoachProviderRequest(() => new Promise((resolve) => releases.push(resolve)))
  const active = [hold(), hold(), hold(), hold()]
  assert.deepEqual(healthCoachProviderCapacity(), {
    active: 4,
    available: 0,
    circuitOpen: false,
    retryAfterMs: 0,
    consecutiveFailures: 0,
    primaryCircuitOpen: false,
    primaryRetryAfterMs: 0,
  })
  await assert.rejects(
    () => runHealthCoachProviderRequest(async () => 'overflow'),
    (error) => error?.code === 'resource-exhausted',
  )
  releases.forEach((resolve) => resolve('ok'))
  await Promise.all(active)
  assert.equal(healthCoachProviderCapacity().active, 0)
})

test('provider circuit opens after consecutive transient failures and recovers after reset', async () => {
  resetHealthCoachProviderState()
  for (let index = 0; index < 3; index += 1) {
    await assert.rejects(
      () => runHealthCoachProviderRequest(async () => {
        throw new HttpsError('unavailable', 'provider unavailable')
      }),
    )
  }
  assert.equal(healthCoachProviderCapacity().circuitOpen, true)
  await assert.rejects(
    () => runHealthCoachProviderRequest(async () => 'blocked'),
    (error) => error?.code === 'unavailable',
  )
  resetHealthCoachProviderState()
  assert.equal(await runHealthCoachProviderRequest(async () => 'recovered'), 'recovered')
})

test('an older in-flight success cannot close a circuit opened by newer failures', async () => {
  resetHealthCoachProviderState()
  let releaseSuccess
  const staleSuccess = runHealthCoachProviderRequest(() => new Promise((resolve) => {
    releaseSuccess = resolve
  }))
  for (let index = 0; index < 3; index += 1) {
    await assert.rejects(() => runHealthCoachProviderRequest(async () => {
      throw new HttpsError('unavailable', 'newer provider failure')
    }))
  }
  assert.equal(healthCoachProviderCapacity().circuitOpen, true)
  releaseSuccess('late success')
  assert.equal(await staleSuccess, 'late success')
  assert.equal(healthCoachProviderCapacity().circuitOpen, true)
  resetHealthCoachProviderState()
})

test('primary provider circuit skips apikey.fun while preserving OpenRouter fallback capacity', () => {
  resetHealthCoachProviderState()
  const error = new HttpsError('unavailable', 'primary failed')
  recordHealthCoachPrimaryProviderFailure(error)
  recordHealthCoachPrimaryProviderFailure(error)
  recordHealthCoachPrimaryProviderFailure(error)
  assert.equal(healthCoachPrimaryApiKey('primary-key'), '')
  assert.equal(healthCoachProviderCapacity().primaryCircuitOpen, true)
  recordHealthCoachPrimaryProviderSuccess()
  assert.equal(healthCoachPrimaryApiKey('primary-key'), '')
  recordHealthCoachPrimaryProviderSuccess(Date.now() + 31_000)
  assert.equal(healthCoachPrimaryApiKey('primary-key'), 'primary-key')
})

test('coach prompt distinguishes facts, cautious inference, missing data, empathy and safety', () => {
  const history = Array.from({ length: 12 }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 ? 'assistant' : 'user',
    text: `Nội dung ${index}`,
  }))
  const prompt = buildHealthCoachPrompt({
    message: 'Mình nản vì cân chưa xuống',
    context: { goal: 'Giảm mỡ bền vững', missingData: ['Chưa có bữa sáng'] },
    history,
    safety: { level: 'standard', category: null },
  })
  const systemPrompt = buildHealthCoachSystemPrompt()

  assert.match(systemPrompt, /phản chiếu ngắn gọn cảm xúc/)
  assert.match(systemPrompt, /Chỉ coi JSON DỮ LIỆU ĐÃ XÁC NHẬN là sự kiện/i)
  assert.match(systemPrompt, /"có thể", "nhiều khả năng"/)
  assert.match(systemPrompt, /Không bịa số đo/)
  assert.match(systemPrompt, /tối đa 1-3 hành động nhỏ/i)
  assert.match(systemPrompt, /phỏng vấn tạo động lực/i)
  assert.match(systemPrompt, /muốn được nghe tiếp hay cùng tìm giải pháp/i)
  assert.match(systemPrompt, /mức sẵn sàng 0-10/i)
  assert.match(systemPrompt, /Bạn từng chia sẻ/i)
  assert.match(systemPrompt, /Không biến mọi cuộc trò chuyện thành bài phân tích số liệu/i)
  assert.match(systemPrompt, /Không chẩn đoán bệnh/)
  assert.match(systemPrompt, /Không chấm điểm cơ thể/i)
  assert.match(systemPrompt, /không.*phần trăm mỡ\/cân nặng chính xác/i)
  assert.match(prompt, /chỉ là dữ liệu không tin cậy/i)
  assert.doesNotMatch(prompt, /MỤC TIÊU GIAO TIẾP/)
  assert.doesNotMatch(prompt, /"Nội dung 0"/)
  assert.doesNotMatch(prompt, /"Nội dung 1"/)
  assert.match(prompt, /Nội dung 11/)
})

test('coach image attachments are actor-owned, typed and path bounded', () => {
  assert.deepEqual(parseHealthCoachImageAttachment({
    kind: 'body',
    storagePath: 'nutrition-scans/student-1/scan_12345678/original.webp',
  }, 'student-1'), {
    kind: 'body',
    storagePath: 'nutrition-scans/student-1/scan_12345678/original.webp',
    scanId: 'scan_12345678',
    purpose: 'ai-coach-body',
  })
  assert.equal(parseHealthCoachImageAttachment(undefined, 'student-1'), null)
  assert.throws(
    () => parseHealthCoachImageAttachment({ kind: 'meal', storagePath: 'nutrition-scans/student-2/scan_12345678/original.jpg' }, 'student-1'),
    (error) => error?.code === 'invalid-argument',
  )
  assert.throws(
    () => parseHealthCoachImageAttachment({ kind: 'medical', storagePath: 'nutrition-scans/student-1/scan_12345678/original.jpg' }, 'student-1'),
    (error) => error?.code === 'invalid-argument',
  )
})

test('Storage permits only the three private nutrition image purposes', () => {
  assert.match(storageRulesSource, /'food-analysis'/)
  assert.match(storageRulesSource, /'ai-coach-body'/)
  assert.match(storageRulesSource, /'ai-coach-meal'/)
  assert.match(storageRulesSource, /request\.resource\.metadata\.ownerUid == userId/)
  assert.match(storageRulesSource, /request\.resource\.metadata\.scanId == scanId/)
})

test('hourly cleanup removes abandoned AI Coach images without deleting retained food scans', () => {
  assert.match(functionsIndexSource, /prefix: 'nutrition-scans\/'/)
  assert.match(functionsIndexSource, /\['ai-coach-body', 'ai-coach-meal'\]\.includes\(purpose\)/)
  assert.match(functionsIndexSource, /now - 24 \* 60 \* 60 \* 1000/)
  assert.match(functionsIndexSource, /file\.delete\(\{ ignoreNotFound: true \}\)/)
  assert.match(functionsIndexSource, /cpu: 'gcf_gen1'[\s\S]*memory: '256MiB'[\s\S]*maxInstances: 1/)
})

test('coach image prompt discloses ephemeral visual context without promoting it to a verified measurement', () => {
  const bodyPrompt = buildHealthCoachPrompt({
    message: 'Mình nên cải thiện gì?',
    context: { goal: 'Giảm mỡ bền vững' },
    safety: { level: 'standard', category: null },
    imageKind: 'body',
  })
  const noImagePrompt = buildHealthCoachPrompt({
    message: 'Nhắc lại ảnh trước',
    context: {},
    safety: { level: 'standard', category: null },
  })
  assert.match(bodyPrompt, /ẢNH VÓC DÁNG/)
  assert.match(bodyPrompt, /sẽ bị xóa sau khi xử lý/)
  assert.match(noImagePrompt, /ảnh đó không còn khả dụng/i)
})

test('server safety classifier escalates self-harm, emergencies, eating disorders and medical conditions', () => {
  assert.deepEqual(classifyHealthCoachSafety('Mình không muốn sống nữa'), { level: 'urgent', category: 'self_harm' })
  assert.deepEqual(classifyHealthCoachSafety('Tôi đang đau ngực và khó thở'), { level: 'urgent', category: 'medical_emergency' })
  assert.deepEqual(classifyHealthCoachSafety('Mình thường ăn rồi nôn để bù lại'), { level: 'caution', category: 'eating_disorder' })
  assert.deepEqual(classifyHealthCoachSafety('Tôi bị tiểu đường, có nên đổi thuốc?'), { level: 'caution', category: 'medical_condition' })
  assert.deepEqual(classifyHealthCoachSafety('Hôm nay mình ăn hơi nhiều'), { level: 'standard', category: null })
})

test('medical caution fallback never suggests generic eating changes or medication changes', () => {
  const response = buildMedicalCautionResponse()
  assert.match(response, /không thể khuyên đổi thuốc/i)
  assert.match(response, /giữ nguyên chỉ định/i)
  assert.match(response, /bác sĩ|dinh dưỡng lâm sàng/i)
  assert.doesNotMatch(response, /uống một cốc nước|nguồn đạm/i)
})

test('provider output is normalized into the frontend structured contract', () => {
  const parsed = parseHealthCoachProviderResponse(`\`\`\`json
{"message":"Mình hiểu hôm nay bạn hơi nản.\\n\\nHãy bắt đầu bằng một bữa cân bằng.","dataUsed":["Nhật ký hôm nay"],"missingData":["Giấc ngủ"],"suggestedReplies":["Gợi ý bữa tối"],"safetyLevel":"standard"}
\`\`\``)
  assert.match(parsed.message, /hơi nản/)
  assert.match(parsed.message, /\n\n/)
  assert.deepEqual(parsed.dataUsed, ['Nhật ký hôm nay'])
  assert.deepEqual(parsed.suggestedReplies, ['Gợi ý bữa tối'])
  assert.equal(parsed.safetyLevel, 'standard')

  const malformed = parseHealthCoachProviderResponse('{"message":', { message: 'Phản hồi an toàn', safetyLevel: 'caution' })
  assert.equal(malformed.message, 'Phản hồi an toàn')
  assert.equal(malformed.safetyLevel, 'caution')
})

test('callables include overview and ask; ask ignores client profile and reads actor-owned context', () => {
  assert.match(nutritionSource, /ENFORCE_AI_APP_CHECK[\s\S]*ENFORCE_APP_CHECK \?\? 'true'/)
  const functions = createNutritionFunctions({ app: {}, db: {} })
  assert.equal(typeof functions.getAiCoachOverview, 'function')
  assert.equal(typeof functions.askAiCoach, 'function')

  const askStart = nutritionSource.indexOf('const askAiCoach = onCall')
  const askEnd = nutritionSource.indexOf('return { analyzeFoodImage', askStart)
  const askSource = nutritionSource.slice(askStart, askEnd)
  assert.ok(askStart > 0 && askEnd > askStart)
  assert.doesNotMatch(askSource, /userProfile/)
  assert.match(nutritionSource, /db\.doc\(`users\/\$\{uid\}`\)\.get\(\)/)
  assert.match(nutritionSource, /users\/\$\{uid\}\/mealLogs/)
  assert.match(nutritionSource, /users\/\$\{uid\}\/weightLogs/)
  assert.match(nutritionSource, /users\/\$\{uid\}\/bodyMeasurements\/current/)
  assert.match(nutritionSource, /users\/\$\{uid\}\/activityLogs/)
  assert.match(nutritionSource, /users\/\$\{uid\}\/waterLogs/)
  assert.match(nutritionSource, /users\/\$\{uid\}\/aiCoachConversations\/\$\{conversationId\}/)
  assert.match(askSource, /generateNutritionTextWithFallback/)
  assert.match(askSource, /role: 'system', content: buildHealthCoachSystemPrompt\(\)/)
  assert.match(askSource, /role: 'user', content: userContent/)
  assert.match(askSource, /type: 'image_url'/)
  assert.match(askSource, /imageFile\.delete\(\{ ignoreNotFound: true \}\)/)
})

test('Health Coach P0 bounds source scans, caches context and makes client turns idempotent', () => {
  assert.match(nutritionSource, /where\('date', '<=', today\)[\s\S]*orderBy\('date', 'desc'\)/)
  assert.match(nutritionSource, /users\/\$\{uid\}\/aiCoachCache\/context/)
  assert.match(nutritionSource, /HEALTH_COACH_CONTEXT_CACHE_TTL_MS = 60 \* 1000/)
  assert.match(nutritionSource, /expiresAt: new Date\(now\.getTime\(\) \+ HEALTH_COACH_CONTEXT_CACHE_TTL_MS\)/)
  assert.match(nutritionSource, /healthCoachContextLoads\.get\(uid\)/)
  assert.match(nutritionSource, /if \(complete\) \{[\s\S]*cacheReference\.set/)
  assert.match(nutritionSource, /if \(!complete\) \{[\s\S]*Dữ liệu sức khỏe chưa đồng bộ đầy đủ/)
  assert.match(nutritionSource, /users\/\$\{uid\}\/aiCoachTurnReceipts\/\$\{clientTurnId\}/)
  assert.match(nutritionSource, /rateLimitSnapshot = await transaction\.get\(rateLimitReference\)[\s\S]*transaction\.set\(rateLimitReference[\s\S]*transaction\.set\(reference/)
  assert.doesNotMatch(nutritionSource, /consumeHealthCoachRateLimit/)
  assert.match(nutritionSource, /HEALTH_COACH_TURN_RECEIPT_TTL_MS = 24 \* 60 \* 60 \* 1000/)
  assert.match(nutritionSource, /expiresAt: new Date\(now \+ HEALTH_COACH_TURN_RECEIPT_TTL_MS\)/)
  assert.match(nutritionSource, /current\.status === 'completed'/)
  assert.match(nutritionSource, /current\.status === 'processing'/)
  assert.match(nutritionSource, /turnClaim\.reference,[\s\S]*response,[\s\S]*\)/)
  assert.match(nutritionSource, /transaction\.set\(receiptReference,[\s\S]*status: 'completed'/)
  assert.match(nutritionSource, /await failHealthCoachTurn\(turnClaim\.reference, error\)/)
  assert.match(nutritionSource, /turnClaim\.status === 'completed'[\s\S]*imageFile\.delete\(\{ ignoreNotFound: true \}\)/)
})

test('Health Coach provider calls have a bounded total budget and local circuit admission', () => {
  assert.match(nutritionSource, /HEALTH_COACH_PROVIDER_BUDGET_MS = 45 \* 1000/)
  assert.match(nutritionSource, /HEALTH_COACH_PROVIDER_ATTEMPT_TIMEOUT_MS = 12 \* 1000/)
  assert.match(nutritionSource, /HEALTH_COACH_PROVIDER_MAX_ACTIVE_PER_INSTANCE = 4/)
  assert.match(nutritionSource, /Math\.min\(perAttemptTimeoutMs, remainingMs - 500\)/)
  assert.match(nutritionSource, /runHealthCoachProviderRequest\(\(\) => generateNutritionTextWithFallback/)
  assert.match(nutritionSource, /deadlineAt: Date\.now\(\) \+ HEALTH_COACH_PROVIDER_BUDGET_MS/)
  assert.match(nutritionSource, /consecutiveFailures >= HEALTH_COACH_PROVIDER_CIRCUIT_FAILURES/)
  assert.match(nutritionSource, /apiKeyFunApiKey: healthCoachPrimaryApiKey\(apiKeyFunApiKey\)/)
  assert.match(nutritionSource, /minInstances: 1,[\s\S]*maxInstances: 3,[\s\S]*concurrency: 12/)
  assert.doesNotMatch(nutritionSource, /globalHealthCoachRateLimit|aiCoachGlobalCircuit/)
})
