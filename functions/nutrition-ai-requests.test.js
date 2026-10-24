'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { createRequire } = require('node:module')
const vm = require('node:vm')
const { Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const {
  REQUEST_LEASE_MS, createNutritionAiRequests, createAiProviderBudget,
  requestFingerprint, nutritionAiRequestId, requireAiAppCheck,
} = require('./nutrition-ai-requests')

// Serialized transactions model the successful Firestore commit order. Failed
// callbacks commit no writes; a read after a write is rejected like Firestore.
function memoryDb(seed = {}) {
  const documents = new Map(Object.entries(seed)), reads = []
  let tail = Promise.resolve()
  const stored = value => value instanceof Date ? Timestamp.fromDate(value)
    : value?.constructor?.name === 'ServerTimestampTransform' ? Timestamp.now()
      : value instanceof Timestamp ? value : Array.isArray(value) ? value.map(stored)
        : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stored(v)])) : value
  const snapshot = path => ({ exists: documents.has(path), id: path.split('/').at(-1), data: () => documents.get(path) })
  const write = (path, value, options) => documents.set(path, stored(options?.merge ? { ...documents.get(path), ...value } : value))
  const doc = path => ({ path, get: async () => { reads.push(path); return snapshot(path) }, set: async (value, options) => write(path, value, options) })
  const query = (path, filters = [], cap = Infinity) => {
    const result = {
      path, isQuery: true,
      where: (key, op, value) => query(path, [...filters, [key, op, value]], cap),
      select: () => result, limit: value => query(path, filters, value),
      async get() {
        reads.push(path)
        const docs = [...documents].filter(([key, value]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')
          && filters.every(([field, op, match]) => op === '>=' ? value[field] >= match : op === '<=' ? value[field] <= match
            : op === 'array-contains' ? value[field]?.includes(match) : value[field] === match))
          .slice(0, cap).map(([key]) => snapshot(key))
        return { docs, size: docs.length, empty: !docs.length }
      },
    }
    return result
  }
  return {
    documents, reads, doc, collection: query,
    runTransaction(handler) {
      const run = tail.then(async () => {
        const writes = []
        const result = await handler({
          get: async ref => { assert.equal(writes.length, 0, 'transaction reads must precede writes'); return ref.get() },
          set: (ref, value, options) => writes.push([ref.path, value, options]),
        })
        for (const args of writes) write(...args)
        return result
      })
      tail = run.catch(() => undefined)
      return run
    },
  }
}

const identity = (overrides = {}) => ({ uid: 'student-1', operation: 'foodScan', requestId: 'scan_request_1',
  fingerprint: requestFingerprint({ photo: 'abc', notes: 'rice' }), scopeKey: 'same-image',
  quota: { key: 'foodVision', windowLimit: 10, dayLimit: 10 }, ...overrides })
const processing = error => error?.code === 'aborted' && error.details?.kind === 'nutrition_ai_processing' && error.details?.maxPollAttempts === 12
const unknown = error => error?.code === 'failed-precondition' && error.details?.kind === 'nutrition_ai_outcome_unknown' && error.details.retryable === false

test('500 concurrent duplicate requests across instances claim one lease and one quota', async () => {
  const db = memoryDb(), instances = [createNutritionAiRequests({ db }), createNutritionAiRequests({ db })]
  const results = await Promise.allSettled(Array.from({ length: 500 }, (_, i) => instances[i % 2].claim(identity())))
  const acquired = results.filter(result => result.status === 'fulfilled').map(result => result.value)
  assert.equal(acquired.length, 1)
  assert.ok(results.filter(result => result.status === 'rejected').every(result => processing(result.reason)))
  assert.equal(db.documents.get('users/student-1/aiRateLimits/foodVision').dayCount, 1)
  await instances[0].startProvider(acquired[0])
  await instances[0].complete(acquired[0], { analysis: { calories: 500 } })
  assert.deepEqual(await instances[1].replay(identity()), { analysis: { calories: 500 } })
  assert.deepEqual((await instances[1].claim(identity())).response, { analysis: { calories: 500 } })
  await assert.rejects(instances[1].claim(identity({ fingerprint: 'different' })), { code: 'already-exists' })
  assert.equal(db.documents.get('users/student-1/aiRateLimits/foodVision').dayCount, 1)
  assert.equal((await instances[1].claim(identity({ uid: 'student-2' }))).acquired, true)
})

test('different request IDs with the same content serialize; a late cache hit avoids a second quota', async () => {
  const db = memoryDb(), requests = createNutritionAiRequests({ db })
  const first = await requests.claim(identity())
  await assert.rejects(requests.claim(identity({ requestId: 'scan_request_2' })), processing)
  const cacheRef = db.doc('users/student-1/aiFoodScanCache/content')
  await cacheRef.set({ analysis: 'same result' })
  await requests.complete(first, { analysis: 'same result' })
  const next = await requests.claim(identity({ requestId: 'scan_request_2', readCache: async tx => (await tx.get(cacheRef)).data() }))
  assert.deepEqual(next.cache, { analysis: 'same result' })
  assert.equal(db.documents.get('users/student-1/aiRateLimits/foodVision').dayCount, 1)
})

test('expired pre-provider work can resume without a second quota and cannot overwrite a new owner', async () => {
  let now = 1_000_000
  const db = memoryDb(), requests = createNutritionAiRequests({ db, now: () => now })
  const old = await requests.claim(identity())
  now += REQUEST_LEASE_MS + 1
  const current = await requests.claim(identity())
  assert.notEqual(current.token, old.token)
  assert.equal(db.documents.get('users/student-1/aiRateLimits/foodVision').dayCount, 1)
  assert.equal(await requests.ownsLease(old), false)
  await assert.rejects(requests.complete(old, { old: true }), error => error.details?.kind === 'nutrition_ai_lease_lost')
  await requests.fail(old, new Error('stale worker'))
  assert.equal(await requests.ownsLease(current), true)
  await requests.complete(current, { fresh: true })
  assert.deepEqual(await requests.replay(identity()), { fresh: true })
})

test('a crash or failure after provider admission is ambiguous and never automatically reissues AI', async () => {
  for (const failed of [false, true]) {
    let now = 1_000_000
    const db = memoryDb(), requests = createNutritionAiRequests({ db, now: () => now })
    const acquired = await requests.claim(identity())
    await requests.startProvider(acquired)
    if (failed) await requests.fail(acquired, new HttpsError('unavailable', 'network timeout'))
    now += REQUEST_LEASE_MS + 1
    await assert.rejects(requests.replay(identity()), unknown)
    await assert.rejects(requests.claim(identity()), unknown)
    assert.equal(db.documents.get('users/student-1/aiRateLimits/foodVision').dayCount, 1)
  }
})

test('stale revision guard and quota rejection write no receipt or lock', async () => {
  const db = memoryDb(), requests = createNutritionAiRequests({ db })
  await assert.rejects(requests.claim(identity({ guard: async () => { throw new HttpsError('aborted', 'revision changed') } })), { code: 'aborted' })
  assert.equal(db.documents.size, 0)
  const now = Timestamp.now()
  await db.doc('users/student-1/aiRateLimits/foodVision').set({ windowStartedAt: now, dayStartedAt: now, windowCount: 10, dayCount: 10 })
  await assert.rejects(requests.claim(identity()), { code: 'resource-exhausted' })
  assert.equal(db.documents.size, 1)
})

test('provider budget is shared across models/providers and bounded by attempts and elapsed time', () => {
  let now = 100_000
  const budget = createAiProviderBudget({ totalMs: 22_000, maxAttempts: 3, perAttemptMs: 10_000, now: () => now })
  assert.equal(budget.nextTimeout(), 10_000)
  now += 10_000
  assert.equal(budget.nextTimeout(), 10_000)
  now += 10_000
  assert.equal(budget.nextTimeout(), 1500)
  assert.throws(() => budget.nextTimeout(), { code: 'deadline-exceeded' })
  const elapsed = createAiProviderBudget({ totalMs: 30_000, maxAttempts: 20, perAttemptMs: 10_000, now: () => now })
  now += 29_000
  assert.throws(() => elapsed.nextTimeout(), { code: 'deadline-exceeded' })
  assert.equal(elapsed.attempts, 0)
})

test('request IDs, canonical fingerprints and handler AppCheck are validated before admission', () => {
  assert.equal(requestFingerprint({ b: 2, a: 1 }), requestFingerprint({ a: 1, b: 2 }))
  assert.notEqual(requestFingerprint({ a: ['a', 'b'] }), requestFingerprint({ a: ['b', 'a'] }))
  assert.equal(nutritionAiRequestId(undefined, 'legacy-key'), 'legacy-key')
  assert.throws(() => nutritionAiRequestId('bad/path', 'legacy'), { code: 'invalid-argument' })
  assert.throws(() => requireAiAppCheck({}, true), { code: 'unauthenticated' })
  assert.doesNotThrow(() => requireAiAppCheck({ app: { appId: 'test-app' } }, true))
})

test('global AppCheck cannot be weakened by the AI-specific flag, including handler defense', () => {
  const source = readFileSync(join(__dirname, 'nutrition-ai-requests.js'), 'utf8')
  for (const [globalFlag, aiFlag, expected] of [[undefined, undefined, true], ['false', undefined, false], ['true', 'false', true], ['false', 'true', true]]) {
    const module = { exports: {} }
    vm.runInNewContext(`(function(require, module) {${source}\n})`, { process: { env: { ENFORCE_APP_CHECK: globalFlag, ENFORCE_AI_APP_CHECK: aiFlag } }, Buffer })(require, module)
    assert.equal(module.exports.ENFORCE_AI_APP_CHECK, expected)
    if (expected) assert.throws(() => module.exports.requireAiAppCheck({}), { code: 'unauthenticated' })
  }
})

// Real handlers loaded in isolated module instances with only network/storage
// boundaries mocked. This exercises cold-instance deduplication, not one Map.
function loadModule(filename, { db, storage, fetch, primaryKey = '', fallbackKey = '' } = {}) {
  const path = join(__dirname, filename), localRequire = createRequire(path)
  const logger = { info() {}, warn() {}, error() {} }
  const module = { exports: {} }
  const requireMock = name => {
    if (name === 'firebase-admin/storage') return { getStorage: () => storage }
    if (name === 'firebase-functions') return { logger }
    if (name === './observability') return { withFunctionTelemetry: (_name, handler) => handler }
    if (name === './apikey-fun') return { ...localRequire(name), getApiKeyFunApiKey: () => primaryKey }
    if (name === './openrouter') return { ...localRequire(name), getOpenRouterApiKey: () => fallbackKey }
    return localRequire(name)
  }
  vm.runInNewContext(`(function(require, module, exports) {${readFileSync(path, 'utf8')}\n})`, {
    Buffer, Date, console: logger, process, AbortSignal, fetch, setTimeout, clearTimeout,
  }, { filename: path })(requireMock, module, module.exports)
  return module.exports
}
const callable = (data, uid = 'student-1') => ({ auth: { uid, token: { role: 'student' } }, app: { appId: 'test-app' }, data })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const jsonResponse = value => ({ ok: true, status: 200, headers: { get: () => 'provider-request-test' }, json: async () => ({ id: 'provider-request-test', choices: [{ finish_reason: 'stop', message: { content: typeof value === 'string' ? value : JSON.stringify(value) } }] }) })

test('meal-review handlers on two instances share one paid call and replay the saved result', async () => {
  const db = memoryDb(), entered = deferred(), release = deferred()
  let calls = 0
  const fetch = async () => { calls++; entered.resolve(); await release.promise; return jsonResponse('Bữa ăn cân bằng, thêm rau để tăng chất xơ.') }
  const create = () => loadModule('nutrition.js', { db, fetch, primaryKey: 'test-key' }).createNutritionFunctions({ db, onCall: (...args) => args.at(-1) })
  const first = create(), second = create(), data = { requestId: 'review_request_1', meal: { id: 'meal-1', title: 'Cơm', calories: 500, protein: 30 }, userProfile: { goals: ['maintain'] } }
  const pending = first.generateMealReview(callable(data))
  await entered.promise
  await assert.rejects(second.generateMealReview(callable(data)), processing)
  release.resolve()
  const response = await pending
  assert.equal(response.provider, 'apikey_fun')
  assert.equal(JSON.stringify(await second.generateMealReview(callable(data))), JSON.stringify(response))
  assert.equal(calls, 1)
  assert.equal(db.documents.get('users/student-1/aiRateLimits/mealReview').dayCount, 1)
})

test('real meal-review provider fallback stops after three total network attempts', async () => {
  const db = memoryDb()
  let calls = 0
  const fetch = async () => { calls++; return { ok: false, status: 503, headers: { get: () => null }, json: async () => ({ error: { message: 'temporarily unavailable' } }) } }
  const functions = loadModule('nutrition.js', { db, fetch, primaryKey: 'test-primary', fallbackKey: 'test-fallback' }).createNutritionFunctions({ db, onCall: (...args) => args.at(-1) })
  const request = callable({ requestId: 'review_request_2', meal: { title: 'Cơm' } })
  await assert.rejects(functions.generateMealReview(request), { code: 'deadline-exceeded' })
  assert.equal(calls, 3)
  await assert.rejects(functions.generateMealReview(request), unknown)
  assert.equal(calls, 3)
})

test('scan duplicates cannot delete the active image; receipt replay works after successful image deletion', async () => {
  const db = memoryDb(), entered = deferred(), release = deferred()
  let calls = 0, deletes = 0, downloads = 0
  const file = { getMetadata: async () => [{ size: 3, contentType: 'image/jpeg', metadata: { ownerUid: 'student-1', scanId: 'scan_test_123', purpose: 'food-analysis' } }],
    download: async () => { downloads++; return [Buffer.from([255, 216, 255])] }, delete: async () => {
      const receipt = [...db.documents].find(([path]) => path.includes('/nutritionAiRequests/'))?.[1]
      assert.equal(receipt?.status, 'completed', 'save the replay before deleting its input, even if cleanup crashes')
      assert.equal(receipt.response.imageRetained, true)
      deletes++
    } }
  const storage = { bucket: () => ({ file: () => file }) }
  const analysis = { isFood: false, dishNameVi: 'Không phải món ăn', dishNameEn: 'Not food', portionSummary: 'Không có khẩu phần', confidence: .95,
    calorieRange: { low: 0, high: 0 }, totals: { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sugarG: 0, sodiumMg: 0 },
    ...Object.fromEntries(['quantityAndCookingAnalysis', 'portionAndCalorieRationale', 'goalAlignmentAssessment', 'calorieOptimizationTip', 'macroBalanceAssessment', 'coachFeedbackSuggestion', 'aiFeedback'].map(key => [key, 'Không áp dụng vì ảnh không chứa món ăn.'])),
    items: [], questions: [], warnings: ['Ảnh không chứa món ăn.'] }
  const fetch = async () => { calls++; entered.resolve(); await release.promise; return jsonResponse(analysis) }
  const create = () => loadModule('nutrition.js', { db, storage, fetch, primaryKey: 'test-primary' }).createNutritionFunctions({ db, onCall: (...args) => args.at(-1) })
  const first = create(), second = create(), request = callable({ requestId: 'scan_request_3', storagePath: 'nutrition-scans/student-1/scan_test_123/original.jpg' })
  const pending = first.analyzeFoodImage(request)
  await entered.promise
  await assert.rejects(second.analyzeFoodImage(request), processing)
  assert.equal(deletes, 0)
  release.resolve()
  const result = await pending
  assert.equal(result.imageRetained, false)
  assert.equal(deletes, 1)
  assert.equal(JSON.stringify(await second.analyzeFoodImage(request)), JSON.stringify(result))
  assert.equal(calls, 1)
  assert.equal(downloads, 1)
  assert.equal(deletes, 1)
})

test('AI Coach failed duplicate claim leaves the original worker image untouched', async () => {
  const api = require('./nutrition')
  const attachment = { kind: 'meal', storagePath: 'nutrition-scans/student-1/scan_test_123/original.jpg' }
  const parsed = api.parseHealthCoachImageAttachment(attachment, 'student-1')
  const fingerprint = api.healthCoachTurnFingerprint({ conversationId: 'default', message: 'Phân tích món ăn này', attachment: parsed })
  const db = memoryDb({ 'users/student-1/aiCoachTurnReceipts/turn_test_123': { fingerprint, status: 'processing', claimedAtMs: Date.now() } })
  let deletes = 0
  const storage = { bucket: () => ({ file: () => ({ delete: async () => { deletes++ } }) }) }
  const functions = loadModule('nutrition.js', { db, storage }).createNutritionFunctions({ db, onCall: (...args) => args.at(-1) })
  await assert.rejects(functions.askAiCoach(callable({ clientTurnId: 'turn_test_123', conversationId: 'default', message: 'Phân tích món ăn này', attachment })), { code: 'aborted' })
  assert.equal(deletes, 0)
  assert.equal(db.documents.size, 1)
})

test('all paid handlers reject an account switch before reads, receipts, Storage, or provider access', async () => {
  const db = memoryDb()
  const functions = loadModule('nutrition.js', { db }).createNutritionFunctions({ db, onCall: (...args) => args.at(-1) })
  const request = callable({ expectedOwnerUid: 'previous-account' })
  for (const name of ['analyzeFoodImage', 'generateMealReview', 'askAiCoach']) {
    await assert.rejects(functions[name](request), { code: 'permission-denied' })
  }
  await assert.rejects(planFunctions(db).generateMyNutritionPlanDraft(request), { code: 'permission-denied' })
  assert.equal(db.documents.size, 0)
  assert.equal(db.reads.length, 0)
})

const planSeed = {
  'users/student-1': { nutritionProfile: { age: 30, biologicalSex: 'female', heightCm: 165, weightKg: 60, activityLevel: 'sedentary', goal: 'maintain', mealsPerDay: 3 } },
  'nutritionCatalog/dish-test': { kind: 'dish', nameVi: 'Cơm cân bằng', energyKcal: 528, macros: { proteinG: 32, carbohydrateG: 64, fatG: 16 }, basis: { amount: 300, unit: 'g' } },
}
const planFunctions = (db, fetch) => loadModule('nutrition-plans.js', { db, fetch, fallbackKey: 'test-fallback' }).createNutritionPlanFunctions({ db, onCall: (...args) => args.at(-1), requireStudent: async () => 'student-1' })

test('plan stale revision rejects before profile/catalog reads, quota, or paid provider', async () => {
  const db = memoryDb({ ...planSeed, 'users/student-1/nutritionPlanDrafts/2026-10-26': { revision: 3 } })
  let calls = 0
  const functions = planFunctions(db, async () => { calls++; throw new Error('must not call') })
  await assert.rejects(functions.generateMyNutritionPlanDraft(callable({ weekStart: '2026-10-26', expectedRevision: 2, requestId: 'plan_request_1' })), { code: 'aborted' })
  assert.equal(calls, 0)
  assert.ok(!db.reads.includes('users/student-1'))
  assert.ok(!db.reads.includes('nutritionCatalog'))
  assert.equal(db.documents.size, 3)
})

test('plan lease prevents two paid generations; plan and receipt commit atomically and replay without a new revision', async () => {
  const db = memoryDb(planSeed), entered = deferred(), release = deferred()
  let calls = 0
  const fetch = async () => { calls++; entered.resolve(); await release.promise; return jsonResponse({ choices: [] }) }
  const first = planFunctions(db, fetch), second = planFunctions(db, fetch)
  const request = callable({ weekStart: '2026-10-26', expectedRevision: 0, requestId: 'plan_request_2' })
  const pending = first.generateMyNutritionPlanDraft(request)
  await entered.promise
  await assert.rejects(second.generateMyNutritionPlanDraft(callable({ ...request.data, requestId: 'plan_request_3' })), processing)
  release.resolve()
  const result = await pending
  assert.equal(result.plan.revision, 1)
  assert.equal(JSON.stringify(await second.generateMyNutritionPlanDraft(request)), JSON.stringify(result))
  assert.equal(db.documents.get('users/student-1/nutritionPlanDrafts/2026-10-26').revision, 1)
  assert.equal(db.documents.get('users/student-1/aiRateLimits/nutritionPlan').dayCount, 1)
  assert.equal(calls, 1)
})

test('plan profile change during AI prevents committing a plan based on stale allergies or targets', async () => {
  const db = memoryDb(planSeed), entered = deferred(), release = deferred()
  const functions = planFunctions(db, async () => { entered.resolve(); await release.promise; return jsonResponse({ choices: [] }) })
  const request = callable({ weekStart: '2026-10-26', expectedRevision: 0, requestId: 'plan_request_4' })
  const pending = functions.generateMyNutritionPlanDraft(request)
  await entered.promise
  await db.doc('users/student-1').set({ nutritionProfile: { ...planSeed['users/student-1'].nutritionProfile, allergies: 'đậu phộng' } })
  release.resolve()
  await assert.rejects(pending, { code: 'aborted' })
  assert.equal(db.documents.has('users/student-1/nutritionPlanDrafts/2026-10-26'), false)
  await assert.rejects(functions.generateMyNutritionPlanDraft(request), unknown)
})
