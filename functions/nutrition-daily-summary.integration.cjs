'use strict'
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { rebuildNutritionDay, syncNutritionDailySummary, createNutritionSummaryFunctions } = require('./nutrition-daily-summary')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `nutrition-summary-${randomUUID()}`)
const clients = []
function fixture() { const db = getFirestore(app, `nutrition-${randomUUID()}`); clients.push(db); return db }
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })
const date = '2026-10-24'
const logger = { info() {} }
const makeEvent = (before, after) => ({ params: { accountUid: 'one' }, data: { before, after } })
async function mealEvent(db, value) {
  const ref = db.doc('users/one/mealLogs/meal')
  const before = await ref.get()
  if (value === null) await ref.delete(); else await ref.set(value)
  return makeEvent(before, await ref.get())
}

test('real Firestore: paginated backfill includes 1,001 records and warm reads do not touch source logs', { timeout: 60000 }, async () => {
  const db = fixture()
  for (let offset = 0; offset < 1001; offset += 400) {
    const batch = db.batch()
    for (let i = offset; i < Math.min(offset + 400, 1001); i++) batch.set(db.doc(`users/one/waterLogs/w${String(i).padStart(5, '0')}`), { date, amountMl: 100 })
    await batch.commit()
  }
  const reads = []
  const first = await rebuildNutritionDay({ db, uid: 'one', date, onRead: (kind, count) => reads.push({ kind, count }) })
  assert.equal(first.summary.waterMl, 100100)
  assert.equal(first.sourceDocuments, 1001)
  assert.equal(reads.filter(x => x.kind === 'waterLogs').length, 5)
  const warm = await rebuildNutritionDay({ db, uid: 'one', date, onRead: () => assert.fail('warm day must not scan source logs') })
  assert.equal(warm.rebuilt, false)
  assert.equal(warm.summary.waterMl, 100100)
  const call = createNutritionSummaryFunctions({ db, onCall: (_options, handler) => handler, requireOwner: async () => 'one' }).getMyNutritionJournalSummary
  const calendar = await call({ data: { fromDate: date, toDate: date } })
  assert.equal(calendar.coverage, 'ready')
  assert.equal(calendar.sourceDocuments, 0)
})

test('real Firestore: move/delete/reordered duplicate source events keep both days correct', { timeout: 60000 }, async () => {
  const db = fixture()
  const created = await mealEvent(db, { date, status: 'logged', calories: 200, protein: 10 })
  await syncNutritionDailySummary({ db, event: created, collection: 'mealLogs', logger })
  const moved = await mealEvent(db, { date: '2026-10-23', status: 'logged', calories: 300, protein: 20 })
  await syncNutritionDailySummary({ db, event: moved, collection: 'mealLogs', logger })
  await syncNutritionDailySummary({ db, event: created, collection: 'mealLogs', logger })
  assert.equal((await db.doc(`users/one/nutritionDailySummaries/${date}`).get()).data().calories, 0)
  assert.equal((await db.doc('users/one/nutritionDailySummaries/2026-10-23').get()).data().calories, 300)
  const deleted = await mealEvent(db, null)
  await syncNutritionDailySummary({ db, event: deleted, collection: 'mealLogs', logger })
  await syncNutritionDailySummary({ db, event: moved, collection: 'mealLogs', logger })
  assert.equal((await db.doc('users/one/nutritionDailySummaries/2026-10-23').get()).data().calories, 0)
})

test('real Firestore: a write during rebuild is not falsely covered; busy delivery retries', { timeout: 60000 }, async () => {
  const db = fixture()
  await mealEvent(db, { date, status: 'logged', calories: 200 })
  let release, entered
  const wait = new Promise(resolve => { release = resolve })
  const ready = new Promise(resolve => { entered = resolve })
  const building = rebuildNutritionDay({ db, uid: 'one', date, afterRead: async () => { entered(); await wait } })
  await ready
  const changed = await mealEvent(db, { date, status: 'logged', calories: 400 })
  await assert.rejects(syncNutritionDailySummary({ db, event: changed, collection: 'mealLogs', logger }), error => error.code === 'unavailable')
  release()
  await building
  await syncNutritionDailySummary({ db, event: changed, collection: 'mealLogs', logger })
  assert.equal((await db.doc(`users/one/nutritionDailySummaries/${date}`).get()).data().calories, 400)
})

test('real Firestore: fencing prevents an expired worker overwriting a newer rebuild', { timeout: 60000 }, async () => {
  const db = fixture()
  await mealEvent(db, { date, status: 'logged', calories: 200 })
  let release, entered
  const wait = new Promise(resolve => { release = resolve })
  const ready = new Promise(resolve => { entered = resolve })
  const clock = Date.now()
  const old = rebuildNutritionDay({ db, uid: 'one', date, now: () => clock, afterRead: async () => { entered(); await wait } })
  await ready
  await mealEvent(db, { date, status: 'logged', calories: 500 })
  await rebuildNutritionDay({ db, uid: 'one', date, force: true, now: () => clock + 100000 })
  release()
  await assert.rejects(old, error => error.code === 'unavailable')
  assert.equal((await db.doc(`users/one/nutritionDailySummaries/${date}`).get()).data().calories, 500)
})

test('real Firestore: force refresh preserves its watermark across a busy stale worker and polling reuses fresh days', { timeout: 60000 }, async () => {
  const db = fixture()
  await mealEvent(db, { date, status: 'logged', calories: 200 })
  await rebuildNutritionDay({ db, uid: 'one', date })
  let release, entered
  const wait = new Promise(resolve => { release = resolve })
  const ready = new Promise(resolve => { entered = resolve })
  const old = rebuildNutritionDay({ db, uid: 'one', date, force: true, afterRead: async () => { entered(); await wait } })
  await ready
  assert.equal((await db.doc(`users/one/nutritionDailySummaries/${date}`).get()).data().status, 'rebuilding')
  await mealEvent(db, { date, status: 'logged', calories: 500 })
  const call = createNutritionSummaryFunctions({ db, onCall: (_options, handler) => handler, requireOwner: async () => 'one' }).getMyNutritionJournalSummary
  const pending = await call({ data: { fromDate: date, toDate: date, forceRefresh: true } })
  assert.equal(pending.coverage, 'pending')
  assert.equal(typeof pending.refreshAfter, 'string')
  release()
  await old
  assert.equal((await db.doc(`users/one/nutritionDailySummaries/${date}`).get()).data().calories, 200)
  const refreshed = await call({ data: { fromDate: date, toDate: date, refreshAfter: pending.refreshAfter } })
  assert.equal(refreshed.coverage, 'ready')
  assert.equal(refreshed.items[0].calories, 500)
  assert.equal(refreshed.refreshAfter, pending.refreshAfter)
  const warm = await call({ data: { fromDate: date, toDate: date, refreshAfter: pending.refreshAfter } })
  assert.equal(warm.coverage, 'ready')
  assert.equal(warm.sourceDocuments, 0)
})
