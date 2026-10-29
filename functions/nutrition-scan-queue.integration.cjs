'use strict'
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { test, after } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { createNutritionScanQueue } = require('./nutrition-scan-queue')
const { createNutritionProviderCapacity, PROVIDER_SLOTS } = require('./nutrition-provider-capacity')
const { createNutritionAiRequests, requestFingerprint, REQUEST_LEASE_MS } = require('./nutrition-ai-requests')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `scan-queue-${randomUUID()}`), databases = []
after(async () => { await Promise.all(databases.map(db => db.terminate())); await deleteApp(app) })
const fixture = () => { const db = getFirestore(app, `scan-queue-${randomUUID()}`); databases.push(db); return db }
const inputFor = uid => ({ scanId: 'scan_request_1', storagePath: `nutrition-scans/${uid}/scan_request_1/original.jpg`, mealType: 'lunch', notes: '', retainImage: false, studentGoal: '', studentCondition: '' })
const pathFor = uid => `users/${uid}/nutritionScanJobs/scan_request_1`
const queueFor = (db, processScan, options = {}) => createNutritionScanQueue({ db, parseInput: value => value, enqueueTask: async () => {}, processScan, ...options })

test('30 queued members drain through 8 workers while four other AI requests hold the shared provider slots', async () => {
  const db = fixture(), receipts = createNutritionAiRequests({ db }), capacity = createNutritionProviderCapacity({ db })
  const otherAi = []
  for (let i = 0; i < 4; i++) otherAi.push(await capacity.acquire())
  let active = 0, maximum = 0, paidCalls = 0
  const queue = queueFor(db, async ({ uid, input, guard }) => {
    const identity = { uid, operation: 'foodScan', requestId: input.scanId, fingerprint: requestFingerprint(input), scopeKey: 'same-image', guard,
      quota: { key: 'foodVision', windowLimit: 10, dayLimit: 10 } }
    const acquired = await receipts.claim(identity)
    if (acquired.response) return acquired.response
    return capacity.run(async () => {
      await receipts.startProvider(acquired)
      paidCalls++; active++; maximum = Math.max(maximum, active)
      // Mock inference only; never contact the paid provider from load tests.
      await new Promise(resolve => setTimeout(resolve, 25))
      active--
      const response = { scanId: input.scanId, result: `member:${uid}` }
      await receipts.complete(acquired, response)
      return response
    })
  })
  const uids = Array.from({ length: 30 }, (_, i) => `member-${i}`)
  await Promise.all(uids.map(uid => queue.submit({ uid, input: inputFor(uid) })))
  const remaining = [...uids]
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (remaining.length) {
      const uid = remaining.shift()
      await queue.run({ uid, scanId: 'scan_request_1' })
    }
  }))
  await Promise.all(uids.map(uid => queue.run({ uid, scanId: 'scan_request_1' })))
  assert.equal(paidCalls, 30)
  assert.ok(maximum > 1 && maximum <= 8)
  assert.ok(maximum + otherAi.length <= PROVIDER_SLOTS)
  for (const uid of uids) {
    assert.equal((await db.doc(pathFor(uid)).get()).data().status, 'completed')
    assert.equal((await db.doc(`users/${uid}/aiRateLimits/foodVision`).get()).data().dayCount, 1)
  }
  await Promise.all(otherAi.map(lease => capacity.release(lease)))
})

test('real transactions preserve ambiguous outcomes and heal saved responses after public job write loss', async () => {
  const db = fixture(); let time = Date.now(), calls = 0
  const receipts = createNutritionAiRequests({ db, now: () => time })
  const queue = queueFor(db, async () => { calls++ }, { now: () => time })
  for (const uid of ['crashed', 'saved']) {
    const input = inputFor(uid)
    await queue.submit({ uid, input })
    const claim = await receipts.claim({ uid, operation: 'foodScan', requestId: input.scanId, fingerprint: requestFingerprint(input) })
    await receipts.startProvider(claim)
    if (uid === 'saved') await receipts.complete(claim, { saved: true })
  }
  time += REQUEST_LEASE_MS + 1
  await queue.run({ uid: 'crashed', scanId: 'scan_request_1' })
  await queue.run({ uid: 'saved', scanId: 'scan_request_1' })
  assert.equal(calls, 0)
  assert.equal((await db.doc(pathFor('crashed')).get()).data().error.kind, 'nutrition_ai_outcome_unknown')
  assert.deepEqual((await db.doc(pathFor('saved')).get()).data().response, { saved: true })
})

test('Firestore deletion of a deferred provider marker permits a safe retry and keeps the paid quota at one', async () => {
  const db = fixture(), receipts = createNutritionAiRequests({ db })
  const identity = { uid: 'busy', operation: 'foodScan', requestId: 'scan_request_1', fingerprint: 'same', quota: { key: 'foodVision', windowLimit: 10, dayLimit: 10 } }
  const first = await receipts.claim(identity)
  await receipts.startProvider(first)
  await receipts.deferProvider(first)
  assert.equal((await first.reference.get()).data().providerStartedAt, undefined)
  const retry = await receipts.claim(identity)
  await receipts.startProvider(retry)
  await receipts.complete(retry, { done: true })
  assert.equal((await db.doc('users/busy/aiRateLimits/foodVision').get()).data().dayCount, 1)
})
