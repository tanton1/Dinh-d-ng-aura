'use strict'

const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { createNutritionReviewFunctions } = require('./nutrition-reviews')

// These tests intentionally exercise transaction retries; never use live data.
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, 'nutrition-write-transaction-tests')
// Rules tests clear the default database before each case. Keep this suite's
// transaction races isolated when node --test runs integration files in parallel.
const db = getFirestore(app, `nutrition-writes-${randomUUID()}`)
const api = createNutritionReviewFunctions({ db, onCall: (_options, handler) => handler })
after(async () => { await db.terminate(); await deleteApp(app) })

async function fixture() {
  const key = randomUUID()
  const uid = `nutrition-${key}`
  const meal = { id: `meal-${key}`, date: '2026-01-01', type: 'lunch', status: 'logged', title: 'Original', calories: 400 }
  const auth = { uid }
  const created = await api.saveNutritionMealLog({ auth, data: { meal, expectedMealRevision: 0 } })
  assert.equal(created.mealRevision, 1)
  return { uid, meal, auth, ref: db.doc(`users/${uid}/mealLogs/${meal.id}`) }
}

test('simultaneous edits of one revision commit once and reject the losing payload', async () => {
  const { meal, auth, ref } = await fixture()
  const results = await Promise.allSettled(['First edit', 'Second edit'].map((title, index) => api.saveNutritionMealLog({
    auth, data: { meal: { ...meal, title }, expectedMealRevision: 1, idempotencyKey: `edit-attempt-${index}` },
  })))
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  const failed = results.find((result) => result.status === 'rejected')
  assert.equal(failed.reason.code, 'aborted')
  const stored = (await ref.get()).data()
  assert.equal(stored.mealRevision, 2)
  assert.ok(['First edit', 'Second edit'].includes(stored.title))
})

test('simultaneous retries replay one receipt without incrementing revisions', async () => {
  const { meal, auth, ref } = await fixture()
  const input = { auth, data: { meal: { ...meal, title: 'Idempotent edit' }, expectedMealRevision: 1, idempotencyKey: 'same-edit-attempt' } }
  const results = await Promise.all(Array.from({ length: 4 }, () => api.saveNutritionMealLog(input)))
  assert.equal(results.filter((result) => !result.unchanged).length, 1)
  assert.ok(results.every((result) => result.mealRevision === 2))
  assert.equal((await ref.get()).data().mealRevision, 2)
})

test('delete and stale edit cannot both commit; undo preserves monotonic revisions', async () => {
  const { meal, auth, ref } = await fixture()
  const results = await Promise.allSettled([
    api.deleteNutritionMealLog({ auth, data: { mealId: meal.id, expectedMealRevision: 1 } }),
    api.saveNutritionMealLog({ auth, data: { meal: { ...meal, title: 'Concurrent edit' }, expectedMealRevision: 1 } }),
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'aborted')
  const current = await ref.get()
  const revision = current.exists ? current.data().mealRevision : 1
  if (current.exists) await api.deleteNutritionMealLog({ auth, data: { mealId: meal.id, expectedMealRevision: revision } })
  const restored = await api.saveNutritionMealLog({ auth, data: { meal, expectedMealRevision: 0 } })
  assert.equal(restored.mealRevision, revision + 1)
  await assert.rejects(api.saveNutritionMealLog({ auth, data: { meal: { ...meal, title: 'Before deletion' }, expectedMealRevision: revision } }), { code: 'aborted' })
})

test('concurrent coach approval and learner edit never approve the replacement meal', async () => {
  const { uid, meal, auth, ref } = await fixture()
  const admin = `admin-${randomUUID()}`
  await db.doc(`users/${admin}`).set({ role: 'admin', disabled: false })
  const reviewRef = db.doc(`mealReviews/${meal.id}`)
  await reviewRef.set({ userId: uid, status: 'pending', revision: 0, mealRevision: 1, meal, createdAt: Timestamp.now() })
  const results = await Promise.allSettled([
    api.reviewNutritionMeal({ auth: { uid: admin, token: { role: 'admin' } }, data: { reviewId: meal.id, action: 'approve', feedback: 'Khẩu phần đã kiểm tra', expectedRevision: 0 } }),
    api.saveNutritionMealLog({ auth, data: { meal: { ...meal, title: 'New portion' }, expectedMealRevision: 1 } }),
  ])
  assert.equal(results[1].status, 'fulfilled')
  if (results[0].status === 'rejected') assert.equal(results[0].reason.code, 'aborted')
  const [storedMeal, storedReview] = await db.getAll(ref, reviewRef)
  assert.equal(storedMeal.data().mealRevision, 2)
  assert.equal(storedMeal.data().reviewStatus, 'rejected')
  assert.equal(storedReview.data().status, 'rejected')
  assert.equal(storedReview.data().invalidatedReason, 'meal_updated_after_submission')
})
