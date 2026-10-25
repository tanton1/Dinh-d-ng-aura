'use strict'
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { test, after } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { createGenerativeAiFunctions, contentRequestIdentity, buildTask } = require('./generative-ai')
const { REQUEST_LEASE_MS, createNutritionAiRequests } = require('./nutrition-ai-requests')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `content-ai-${randomUUID()}`), databases = []
after(async () => { await Promise.all(databases.map(db => db.terminate())); await deleteApp(app) })
async function fixture() {
  const db = getFirestore(app, `content-ai-${randomUUID()}`); databases.push(db)
  await db.doc('users/editor').set({ role: 'editor' })
  await db.doc('users/other').set({ role: 'editor' })
  return db
}
const payload = { lessonTitle: 'Synthetic', lessonSummary: 'Offline fixture only.' }
const request = (data = {}, uid = 'editor') => ({ auth: { uid, token: { role: 'editor' } },
  data: { action: 'course-quiz', payload, expectedOwnerUid: uid, ...data } })
const generated = () => ({ data: { questions: [{ question: 'Fixture?', options: ['A', 'B'], correctIndex: 0, explanation: 'Fixture' }] }, model: 'synthetic-model', requestId: 'gen-fixture', usage: { totalTokens: 5 } })
const api = (db, generate = async () => generated(), overrides = {}) => createGenerativeAiFunctions({ db,
  onCallImpl: (_options, handler) => handler, generate, apiKey: () => 'synthetic-key', ...overrides }).generateAuraContent
const running = error => error.code === 'aborted' && error.details?.kind === 'content_ai_processing'
const unknown = error => error.code === 'failed-precondition' && error.details?.kind === 'content_ai_outcome_unknown'
const status = data => request({ ...data, action: 'request-status', targetAction: 'course-quiz' })
const receipts = db => db.collection('users/editor/nutritionAiRequests').get()

test('two instances and a fresh client without an ID share one durable default generation and quota', async () => {
  const db = await fixture(); let calls = 0, release, started
  const gate = new Promise(resolve => { release = resolve }), providerStarted = new Promise(resolve => { started = resolve })
  const generate = async () => { calls++; started(); await gate; return generated() }
  const first = api(db, generate), second = api(db, generate)
  const pending = first(request()); await providerStarted
  const competing = await Promise.allSettled(Array.from({ length: 20 }, () => second(request())))
  assert.equal(competing.filter(row => row.status === 'rejected' && running(row.reason)).length, 20)
  release(); const result = await pending
  assert.deepEqual(await api(db, generate)(request()), result)
  assert.deepEqual(await second(status({ requestId: result.receipt.requestId })), result)
  assert.equal(calls, 1)
  assert.equal((await receipts(db)).size, 1)
  assert.equal((await db.doc('users/editor/aiRateLimits/contentGeneration').get()).data().dayCount, 1)
  assert.equal(result.receipt.schemaVersion, 1)
})

test('status lookup never creates a receipt, charges quota or calls a provider, even for an expired unstarted lease', async () => {
  const db = await fixture(); let calls = 0
  const read = api(db, async () => { calls++; return generated() })
  await assert.rejects(read(status({ requestId: 'content_missing_1' })), error => error.code === 'not-found' && error.details.kind === 'content_ai_not_started')
  assert.equal((await receipts(db)).size, 0)
  assert.equal((await db.doc('users/editor/aiRateLimits/contentGeneration').get()).exists, false)
  assert.equal(calls, 0)
  const now = Date.now(), identity = contentRequestIdentity('editor', 'course-quiz', buildTask('course-quiz', payload), 'content_unstarted_1')
  await createNutritionAiRequests({ db, now: () => now }).claim(identity)
  const before = (await receipts(db)).docs[0]
  await assert.rejects(api(db, async () => { calls++; return generated() }, { now: () => now + REQUEST_LEASE_MS + 1 })(status({ requestId: identity.requestId })), { code: 'not-found' })
  const after = (await receipts(db)).docs[0]
  assert.equal(after.updateTime.toMillis(), before.updateTime.toMillis())
  assert.equal((await db.doc('users/editor/aiRateLimits/contentGeneration').get()).exists, false)
  assert.equal(calls, 0)
})

test('ambiguous provider failure remains unknown across instances and an expired lease without another paid attempt', async () => {
  const db = await fixture(); let calls = 0, now = Date.now()
  const generate = async () => { calls++; throw new HttpsError('unavailable', 'Synthetic accepted request lost its response') }
  const first = api(db, generate, { now: () => now })
  await assert.rejects(first(request({ requestId: 'content_unknown_1' })), { code: 'unavailable' })
  now += REQUEST_LEASE_MS + 1
  const second = api(db, generate, { now: () => now })
  await assert.rejects(second(request({ requestId: 'content_unknown_1' })), unknown)
  await assert.rejects(second(status({ requestId: 'content_unknown_1' })), unknown)
  assert.equal(calls, 1)
  assert.equal((await db.doc('users/editor/aiRateLimits/contentGeneration').get()).data().dayCount, 1)
})

test('success followed by a lost client response is recovered by status without provider credentials or another quota charge', async () => {
  const db = await fixture(); let calls = 0
  const result = await api(db, async () => { calls++; return generated() })(request({ requestId: 'content_recover_1' }))
  const recovered = await api(db, async () => { throw Error('Must not call provider') }, { apiKey: () => '' })(status({ requestId: result.receipt.requestId }))
  assert.deepEqual(recovered, result)
  assert.equal(calls, 1)
  assert.equal((await db.doc('users/editor/aiRateLimits/contentGeneration').get()).data().dayCount, 1)
})

test('an explicit new draft is independent while reused IDs reject changed prompts and owners stay isolated', async () => {
  const db = await fixture(); let calls = 0
  const read = api(db, async () => { calls++; return generated() })
  const first = await read(request({ requestId: 'content_draft_1' }))
  const next = await read(request({ requestId: 'content_draft_2' }))
  assert.notEqual(first.receipt.requestId, next.receipt.requestId)
  await assert.rejects(read(request({ requestId: 'content_draft_1', payload: { ...payload, lessonTitle: 'Changed' } })), { code: 'already-exists' })
  await read(request({ requestId: 'content_draft_1' }, 'other'))
  await assert.rejects(read(request({ expectedOwnerUid: 'other' })), { code: 'permission-denied' })
  assert.equal(calls, 3)
  assert.equal((await db.doc('users/editor/aiRateLimits/contentGeneration').get()).data().dayCount, 2)
})

test('current role is checked for replay and again after a long generation; revocation never returns its result', async () => {
  const db = await fixture(); let release, started
  const gate = new Promise(resolve => { release = resolve }), providerStarted = new Promise(resolve => { started = resolve })
  const read = api(db, async () => { started(); await gate; return generated() })
  const pending = read(request({ requestId: 'content_revoke_1' })); await providerStarted
  await db.doc('users/editor').update({ role: 'student' }); release()
  await assert.rejects(pending, { code: 'permission-denied' })
  assert.equal((await receipts(db)).docs[0].data().status, 'completed')
  await assert.rejects(read(status({ requestId: 'content_revoke_1' })), { code: 'permission-denied' })
  await db.doc('users/editor').update({ role: 'editor' })
  assert.equal((await read(status({ requestId: 'content_revoke_1' }))).receipt.status, 'completed')
})

test('legacy numeric rate-limit windows remain enforced and replay does not consume a full quota again', async () => {
  const db = await fixture(), now = Date.now(); let calls = 0
  await db.doc('users/editor/aiRateLimits/contentGeneration').set({ windowStartedAt: now, dayStartedAt: now, windowCount: 29, dayCount: 149 })
  const read = api(db, async () => { calls++; return generated() }, { now: () => now })
  await read(request({ requestId: 'content_quota_1' }))
  await read(request({ requestId: 'content_quota_1' }))
  await assert.rejects(read(request({ requestId: 'content_quota_2' })), { code: 'resource-exhausted' })
  const value = (await db.doc('users/editor/aiRateLimits/contentGeneration').get()).data()
  assert.equal(value.windowCount, 30); assert.equal(value.dayCount, 150); assert.equal(calls, 1)
  assert.equal((await receipts(db)).size, 1)
})

test('a provider result arriving after its lease is fenced and cannot cause another generation', async () => {
  const db = await fixture(); let now = Date.now(), calls = 0
  const read = api(db, async () => { calls++; now += REQUEST_LEASE_MS + 1; return generated() }, { now: () => now })
  await assert.rejects(read(request({ requestId: 'content_late_1' })), error => error.details?.kind === 'content_ai_lease_lost')
  await assert.rejects(read(request({ requestId: 'content_late_1' })), unknown)
  assert.equal(calls, 1)
})

test('failure to persist a successful generation leaves the started receipt and never reruns the provider', async () => {
  const db = await fixture(); let now = Date.now(), calls = 0
  const wrapped = { doc: db.doc.bind(db), runTransaction: handler => db.runTransaction(transaction => handler(new Proxy(transaction, {
    get(target, key) {
      if (key === 'set') return (reference, data, options) => {
        if (data.status === 'completed') throw new HttpsError('unavailable', 'Synthetic completion write failure')
        return target.set(reference, data, options)
      }
      return typeof target[key] === 'function' ? target[key].bind(target) : target[key]
    },
  }))) }
  await assert.rejects(api(wrapped, async () => { calls++; return generated() }, { now: () => now })(request({ requestId: 'content_persist_1' })), { code: 'unavailable' })
  now += REQUEST_LEASE_MS + 1
  await assert.rejects(api(db, async () => { calls++; return generated() }, { now: () => now })(request({ requestId: 'content_persist_1' })), unknown)
  assert.equal(calls, 1)
  assert.ok((await receipts(db)).docs[0].data().providerStartedAt instanceof Timestamp)
})
