'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { HttpsError } = require('firebase-functions/v2/https')
const { Timestamp } = require('firebase-admin/firestore')
const { createNutritionScanQueue, SCAN_JOB_TIMEOUT_MS } = require('./nutrition-scan-queue')
const { createNutritionProviderCapacity, PROVIDER_SLOTS, PROVIDER_LEASE_MS } = require('./nutrition-provider-capacity')
const { createNutritionAiRequests, requestFingerprint, REQUEST_LEASE_MS } = require('./nutrition-ai-requests')

function fixtureDb() {
  const data = new Map()
  let tail = Promise.resolve()
  const doc = path => ({ path, get: async () => ({ exists: data.has(path), data: () => data.get(path) }) })
  return { data, doc, runTransaction(operation) {
    const result = tail.then(async () => {
      const writes = []
      const value = await operation({ get: ref => { assert.equal(writes.length, 0); return ref.get() }, set: (ref, values, options) => writes.push([ref, values, options]) })
      for (const [ref, values, options] of writes) {
        const updated = options?.merge ? { ...data.get(ref.path) } : {}
        for (const [key, value] of Object.entries(values)) {
          if (value?.constructor?.name === 'DeleteTransform') delete updated[key]
          else updated[key] = value
        }
        data.set(ref.path, updated)
      }
      return value
    })
    tail = result.catch(() => undefined)
    return result
  } }
}
const inputFor = (uid, id = 'scan_request_1') => ({ scanId: id, storagePath: `nutrition-scans/${uid}/${id}/original.jpg`, mealType: 'lunch', notes: '', retainImage: false, studentGoal: '', studentCondition: '' })
const jobPath = (uid, id = 'scan_request_1') => `users/${uid}/nutritionScanJobs/${id}`
const queueFor = (db, overrides = {}) => createNutritionScanQueue({ db, parseInput: value => value, processScan: async () => ({ analysis: 'done' }), enqueueTask: async () => {}, ...overrides })

test('30 users enqueue immediately; a duplicate ID neither writes a second job nor consumes another admission', async () => {
  const db = fixtureDb(), queue = queueFor(db)
  const accepted = await Promise.all(Array.from({ length: 30 }, (_, i) => queue.submit({ uid: `member-${i}`, input: inputFor(`member-${i}`) })))
  assert.equal(accepted.length, 30)
  await Promise.all(Array.from({ length: 30 }, () => queue.submit({ uid: 'member-0', input: inputFor('member-0') })))
  assert.equal(db.data.get('users/member-0/aiRateLimits/foodScanQueue').dayCount, 1)
  assert.equal([...db.data.keys()].filter(path => path.includes('/nutritionScanJobs/')).length, 30)
  await assert.rejects(queue.submit({ uid: 'member-0', input: { ...inputFor('member-0'), notes: 'changed' } }), { code: 'already-exists' })
})

test('the durable dispatcher recovers a partial enqueue and sends IDs only, never photos or health data', async () => {
  const db = fixtureDb(), tasks = new Map()
  let failOnce = true
  const queue = queueFor(db, { enqueueTask: async (payload, options) => {
    if (!payload.deadlineCheck && failOnce) { failOnce = false; throw new Error('network') }
    if (tasks.has(options.id)) throw { code: 'functions/task-already-exists' }
    tasks.set(options.id, { payload, options })
  } })
  await queue.submit({ uid: 'one', input: inputFor('one') })
  await assert.rejects(queue.dispatch('one', 'scan_request_1'))
  await queue.dispatch('one', 'scan_request_1')
  await queue.dispatch('one', 'scan_request_1')
  assert.equal(tasks.size, 2)
  for (const task of tasks.values()) assert.deepEqual(Object.keys(task.payload).sort(), ['deadlineCheck', 'scanId', 'uid'])
  assert.ok([...tasks.values()].some(task => task.options.scheduleTime instanceof Date))
})

test('30 requests across independent services cannot acquire more than 12 shared provider slots', async () => {
  const db = fixtureDb(), instances = Array.from({ length: 4 }, () => createNutritionProviderCapacity({ db }))
  const results = await Promise.allSettled(Array.from({ length: 30 }, (_, index) => instances[index % 4].acquire()))
  const leases = results.filter(row => row.status === 'fulfilled').map(row => row.value)
  assert.equal(leases.length, PROVIDER_SLOTS)
  assert.ok(results.filter(row => row.status === 'rejected').every(row => row.reason.details.kind === 'nutrition_provider_capacity'))
  await instances[0].release(leases[0])
  await instances[1].acquire()
  assert.equal([...db.data.values()].filter(value => value.leaseUntil > Date.now()).length, PROVIDER_SLOTS)
})

test('a crashed provider slot expires and a late release cannot free its replacement', async () => {
  let time = 1_000_000
  const db = fixtureDb(), capacity = createNutritionProviderCapacity({ db, now: () => time, random: () => 0 })
  const old = await capacity.acquire()
  time += PROVIDER_LEASE_MS + 1
  const replacement = await capacity.acquire()
  await capacity.release(old)
  assert.equal(db.data.get(replacement.reference.path).token, replacement.token)
})

test('worker replay heals a lost public completion without invoking the provider again', async () => {
  const db = fixtureDb(), receipts = createNutritionAiRequests({ db }), input = inputFor('one')
  let calls = 0
  const queue = queueFor(db, { processScan: async () => { calls++; throw new Error('must not call') } })
  await queue.submit({ uid: 'one', input })
  const claim = await receipts.claim({ uid: 'one', operation: 'foodScan', requestId: input.scanId, fingerprint: requestFingerprint(input) })
  await receipts.startProvider(claim)
  await receipts.complete(claim, { result: 'original' })
  await queue.run({ uid: 'one', scanId: input.scanId })
  await queue.run({ uid: 'one', scanId: input.scanId })
  assert.equal(calls, 0)
  assert.deepEqual(db.data.get(jobPath('one')).response, { result: 'original' })
  assert.equal(db.data.get(jobPath('one')).input, undefined)
})

test('ambiguous paid work becomes a stable failure, including task redelivery after a crash', async () => {
  let time = 1_000_000
  const db = fixtureDb(), now = () => time, receipts = createNutritionAiRequests({ db, now }), input = inputFor('one')
  let calls = 0
  const queue = queueFor(db, { now, processScan: async () => { calls++ } })
  await queue.submit({ uid: 'one', input })
  const claim = await receipts.claim({ uid: 'one', operation: 'foodScan', requestId: input.scanId, fingerprint: requestFingerprint(input) })
  await receipts.startProvider(claim)
  await assert.rejects(queue.run({ uid: 'one', scanId: input.scanId }), error => error.details.kind === 'nutrition_ai_processing')
  time += REQUEST_LEASE_MS + 1
  await queue.run({ uid: 'one', scanId: input.scanId })
  await queue.run({ uid: 'one', scanId: input.scanId })
  assert.equal(db.data.get(jobPath('one')).error.kind, 'nutrition_ai_outcome_unknown')
  assert.equal(calls, 0)
})

test('explicit first-attempt rejection can defer the receipt without charging the paid quota twice', async () => {
  const db = fixtureDb(), receipts = createNutritionAiRequests({ db })
  const identity = { uid: 'one', operation: 'foodScan', requestId: 'scan_request_1', fingerprint: 'same', scopeKey: 'photo', quota: { key: 'foodVision', windowLimit: 10, dayLimit: 10 } }
  const first = await receipts.claim(identity)
  await receipts.startProvider(first)
  await receipts.deferProvider(first)
  const second = await receipts.claim(identity)
  await receipts.startProvider(second)
  await receipts.complete(second, { done: true })
  assert.equal(db.data.get('users/one/aiRateLimits/foodVision').dayCount, 1)
})

test('Retry-After is retained across early task retries; expired queued work never calls AI', async () => {
  let time = 1_000_000, calls = 0
  const db = fixtureDb(), queue = queueFor(db, { now: () => time, processScan: async () => {
    calls++; throw new HttpsError('resource-exhausted', 'busy', { kind: 'nutrition_provider_busy', retryAfterMs: 120_000 })
  } })
  await queue.submit({ uid: 'one', input: inputFor('one') })
  await assert.rejects(queue.run({ uid: 'one', scanId: 'scan_request_1' }))
  const retryAt = db.data.get(jobPath('one')).nextAttemptAt
  time += 30_000
  await assert.rejects(queue.run({ uid: 'one', scanId: 'scan_request_1' }))
  assert.equal(db.data.get(jobPath('one')).nextAttemptAt, retryAt)
  assert.equal(calls, 1)
  time += SCAN_JOB_TIMEOUT_MS
  await queue.run({ uid: 'one', scanId: 'scan_request_1', deadlineCheck: true })
  assert.equal(db.data.get(jobPath('one')).error.kind, 'nutrition_scan_expired')
  assert.equal(calls, 1)
})

test('queue manifest is regional, private, bounded and uses TTL without indexing result payloads', () => {
  const { initializeApp, deleteApp } = require('firebase-admin/app')
  const { createNutritionScanQueueFunctions } = require('./nutrition-scan-queue')
  const app = initializeApp({ projectId: 'demo-aura-queue' }, `queue-test-${Date.now()}`)
  try {
    const functions = createNutritionScanQueueFunctions({ app, db: fixtureDb(), databaseId: 'named-db', parseInput: value => value, processScan: async () => ({}) })
    const worker = functions.processNutritionScanQueue.__endpoint
    assert.equal(worker.taskQueueTrigger.rateLimits.maxConcurrentDispatches, 8)
    assert.ok(worker.taskQueueTrigger.invoker.every(value => value.endsWith('.gserviceaccount.com')))
    assert.equal(worker.taskQueueTrigger.invoker.includes('public'), false)
    assert.equal(functions.dispatchNutritionScan.__endpoint.eventTrigger.eventFilterPathPatterns.document, 'users/{uid}/nutritionScanJobs/{scanId}')
    assert.equal(functions.dispatchNutritionScan.__endpoint.eventTrigger.eventFilters.database, 'named-db')
    const overrides = require('../firestore.indexes.json').fieldOverrides.filter(row => row.collectionGroup === 'nutritionScanJobs')
    assert.ok(overrides.some(row => row.fieldPath === 'expiresAt' && row.ttl === true))
    assert.ok(overrides.some(row => row.fieldPath === '*' && row.indexes.length === 0))
  } finally { void deleteApp(app) }
})

test('queue admission binds owner and App Check; only signed role claims reach the worker', async () => {
  const { initializeApp, deleteApp } = require('firebase-admin/app')
  const { createNutritionScanQueueFunctions } = require('./nutrition-scan-queue')
  const { parseAnalyzeRequest } = require('./nutrition')
  const app = initializeApp({ projectId: 'demo-aura-queue' }, `queue-auth-${Date.now()}`)
  const db = fixtureDb()
  try {
    const functions = createNutritionScanQueueFunctions({ app, db, databaseId: 'named-db', parseInput: parseAnalyzeRequest, processScan: async () => ({}) })
    const handler = functions.enqueueNutritionScan.run
    const data = { ...inputFor('one'), expectedOwnerUid: 'one', requestId: 'scan_request_1', callerRole: 'super_admin' }
    await assert.rejects(handler({ data, app: { appId: 'test' } }), { code: 'unauthenticated' })
    await assert.rejects(handler({ data: { ...data, expectedOwnerUid: 'two' }, auth: { uid: 'one', token: {} }, app: { appId: 'test' } }), { code: 'permission-denied' })
    const { ENFORCE_AI_APP_CHECK } = require('./nutrition-ai-requests')
    if (ENFORCE_AI_APP_CHECK) await assert.rejects(handler({ data, auth: { uid: 'one', token: {} } }), { code: 'unauthenticated' })
    assert.equal(db.data.size, 0)
    await handler({ data, auth: { uid: 'one', token: { role: 'coach' } }, app: { appId: 'test' } })
    assert.equal(db.data.get(jobPath('one')).callerRole, 'coach')
    const size = db.data.size
    await handler({ data: { expectedOwnerUid: 'one', resumeScanId: 'scan_request_1' }, auth: { uid: 'one', token: {} }, app: { appId: 'test' } })
    assert.equal(db.data.size, size)
  } finally { await deleteApp(app) }
})
