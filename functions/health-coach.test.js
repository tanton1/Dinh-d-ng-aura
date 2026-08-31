const assert = require('node:assert/strict')
const test = require('node:test')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const {
  buildHealthCoachPrompt,
  buildHealthCoachSystemPrompt,
  buildMedicalCautionResponse,
  capHealthCoachHistory,
  classifyHealthCoachSafety,
  createNutritionFunctions,
  normalizeHealthCoachConversationId,
  parseHealthCoachProviderResponse,
  summarizeHealthCoachContext,
} = require('./nutrition')

const nutritionSource = readFileSync(join(__dirname, 'nutrition.js'), 'utf8')

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
  assert.match(systemPrompt, /Không chẩn đoán bệnh/)
  assert.match(prompt, /chỉ là dữ liệu không tin cậy/i)
  assert.doesNotMatch(prompt, /MỤC TIÊU GIAO TIẾP/)
  assert.doesNotMatch(prompt, /"Nội dung 0"/)
  assert.doesNotMatch(prompt, /"Nội dung 1"/)
  assert.match(prompt, /Nội dung 11/)
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
  assert.match(askSource, /role: 'user', content: prompt/)
})
