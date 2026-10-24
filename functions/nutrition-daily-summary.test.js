'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { Timestamp } = require('firebase-admin/firestore')
const { SCHEMA_VERSION, rangeDates, summarizeDay, sourceTotals, dateKey, refreshBoundary, createNutritionSummaryFunctions, rebuildNutritionDay } = require('./nutrition-daily-summary')

test('calendar windows preserve leap days and reject invalid or unbounded ranges', () => {
  assert.deepEqual(rangeDates('2024-02-28', '2024-03-01'), ['2024-02-28', '2024-02-29', '2024-03-01'])
  assert.equal(rangeDates('2026-10-01', '2026-10-31').length, 31)
  assert.equal(dateKey('2026-02-29'), null)
  assert.throws(() => rangeDates('2026-10-01', '2026-11-01'), /31/)
  assert.throws(() => rangeDates('2026-02-30', '2026-03-01'))
})

test('summary matches diary semantics, excludes other days/deletions and does not manufacture invalid nutrients', () => {
  const result = summarizeDay('2026-10-24', {
    mealLogs: [
      { date: '2026-10-24', status: 'logged', calories: 251.5, protein: 10, carbs: 20, fat: 8, source: 'ai-scan' },
      { date: '2026-10-24', status: 'logged', calories: 300, protein: 20, reviewStatus: 'pending' },
      { date: '2026-10-24', status: 'planned', calories: 999 },
      { date: '2026-10-23', status: 'logged', calories: 999 },
      { date: '2026-10-24', status: 'logged', deleted: true, calories: 999 },
    ],
    waterLogs: [{ date: '2026-10-24', amountMl: 250 }, { date: '2026-10-24', amountMl: -1 }, { date: '2026-10-24', amountMl: '250' }, { date: '2026-10-24', amountMl: Infinity }],
    activityLogs: [{ date: '2026-10-24', durationMinutes: 30 }, { date: '2026-10-23', durationMinutes: 90 }],
  })
  assert.deepEqual(result, { date: '2026-10-24', mealCount: 2, calories: 551.5, protein: 30, carbs: 20, fat: 8, waterMl: 250, activityCount: 1, activityMinutes: 30, reviewCount: 2, mealOccasions: { breakfast: false, lunch: false, dinner: false, snackCount: 0 } })
})

test('progress keeps distinct main meals and snack times; duplicate dishes cannot manufacture complete days', () => {
  const date = '2026-10-24'
  const logged = (type, time, extra = {}) => ({ date, type, time, status: 'logged', ...extra })
  const result = summarizeDay(date, { mealLogs: [
    logged('lunch', '12:00'), logged('lunch', '12:00'), logged('dinner', '18:00'),
    logged('breakfast', '07:00', { status: 'planned' }), logged('breakfast', '07:00', { deleted: true }),
    logged('snack', '10:00'), logged('snack', '10:00'), logged('snack', '15:00'),
    logged('snack', '21:00', { status: 'deleted' }), logged('breakfast', '07:00', { date: '2026-10-23' }),
  ] })
  assert.deepEqual(result.mealOccasions, { breakfast: false, lunch: true, dinner: true, snackCount: 2 })
  const legacy = summarizeDay(date, { mealLogs: [logged('breakfast', '07:00', { status: undefined })] })
  assert.equal(legacy.mealOccasions.breakfast, true)
  assert.equal(legacy.mealCount, 0, 'legacy occasion support must not change diary nutrient totals')
})

test('meal type and time edits now invalidate daily progress while feedback-only edits still do not', () => {
  const meal = { date: '2026-10-24', status: 'logged', type: 'breakfast', time: '07:00' }
  assert.notDeepEqual(sourceTotals(meal, 'mealLogs'), sourceTotals({ ...meal, type: 'lunch' }, 'mealLogs'))
  assert.notDeepEqual(sourceTotals(meal, 'mealLogs'), sourceTotals({ ...meal, time: '08:00' }, 'mealLogs'))
  assert.notDeepEqual(sourceTotals({ ...meal, time: undefined }, 'mealLogs'), sourceTotals({ ...meal, time: null }, 'mealLogs'))
})

test('feedback-only edits do not require recomputing numeric day totals', () => {
  const meal = { date: '2026-10-24', status: 'logged', calories: 200, reviewStatus: 'approved', coachFeedback: 'a' }
  assert.deepEqual(sourceTotals(meal, 'mealLogs'), sourceTotals({ ...meal, coachFeedback: 'b', updatedAt: new Date() }, 'mealLogs'))
  assert.notDeepEqual(sourceTotals(meal, 'mealLogs'), sourceTotals({ ...meal, reviewStatus: 'rejected' }, 'mealLogs'))
})

function summaryFixture() {
  const documents = new Map(), reads = []
  let clock = Date.parse('2026-10-24T12:00:00Z'), afterQuery = null, transactionTail = Promise.resolve()
  const snapshot = path => ({ id: path.split('/').at(-1), exists: documents.has(path), data: () => documents.get(path), readTime: Timestamp.fromMillis(clock) })
  const reference = path => ({ path, get: async () => snapshot(path) })
  const db = {
    doc: reference,
    getAll: async (...refs) => refs.map(ref => snapshot(ref.path)),
    runTransaction(callback) {
      const pending = transactionTail.then(async () => {
        const writes = []
        const result = await callback({ get: async ref => { assert.equal(writes.length, 0); return snapshot(ref.path) }, set: (ref, data, options) => writes.push([ref.path, data, options]) })
        for (const [path, data, options] of writes) documents.set(path, options?.merge ? { ...documents.get(path), ...data } : data)
        return result
      })
      transactionTail = pending.catch(() => undefined)
      return pending
    },
    collection(path) {
      let date, limit = Infinity, after = '', selected = []
      const query = {
        where: (field, operator, value) => { assert.equal(field, 'date'); assert.equal(operator, '=='); date = value; return query },
        orderBy: () => query, select: (...fields) => { selected = fields; return query },
        limit: value => { limit = value; return query }, startAfter: doc => { after = doc.id; return query },
        async get() {
          const docs = [...documents].filter(([key, value]) => key.startsWith(`${path}/`) && value.date === date && key.split('/').at(-1) > after)
            .sort(([a], [b]) => a.localeCompare(b)).slice(0, limit).map(([key, value]) => ({ id: key.split('/').at(-1), data: () => Object.fromEntries(selected.filter(field => value[field] !== undefined).map(field => [field, value[field]])) }))
          reads.push({ date, path, count: docs.length, limit })
          afterQuery?.()
          return { docs, size: docs.length }
        },
      }
      return query
    },
  }
  const call = createNutritionSummaryFunctions({ db, onCall: (_options, handler) => handler, requireOwner: async () => 'one', now: () => clock }).getMyNutritionJournalSummary
  const add = (date, count) => { for (let i = 0; i < count; i++) documents.set(`users/one/waterLogs/${date}-${String(i).padStart(5, '0')}`, { date, amountMl: 100 }) }
  return { db, documents, reads, add, call: data => call({ data }), now: () => clock, advance: amount => { clock += amount }, onQuery: callback => { afterQuery = callback } }
}

test('refresh watermark rejects invalid/far-future tokens and accepts the exact server boundary', () => {
  const now = Date.parse('2026-10-24T12:00:00Z')
  assert.equal(refreshBoundary('2026-10-24T12:00:00.000Z', now).toMillis(), now)
  for (const value of ['invalid', 123, '2026-10-24T12:00:06.000Z']) assert.throws(() => refreshBoundary(value, now), { code: 'invalid-argument' })
})

test('ready day exceeding the day cap becomes partial; warm reads never return stale ready totals or rescan it', async () => {
  const f = summaryFixture(), date = '2026-10-24'
  f.add(date, 1)
  await rebuildNutritionDay({ db: f.db, uid: 'one', date, now: f.now })
  f.advance(1)
  f.add(date, 10001)
  const first = await f.call({ fromDate: date, toDate: date, forceRefresh: true })
  assert.equal(first.coverage, 'partial')
  assert.equal(first.sourceDocuments, 10001)
  assert.equal(first.items.length, 0)
  assert.equal(f.documents.get(`users/one/nutritionDailySummaries/${date}`).status, 'partial')
  const before = f.reads.length
  const warm = await f.call({ fromDate: date, toDate: date, refreshAfter: first.refreshAfter })
  assert.equal(warm.coverage, 'partial')
  assert.equal(warm.items.length, 0)
  assert.equal(warm.sourceDocuments, 0)
  assert.equal(f.reads.length, before)
  // A newer source event can repair the previously partial day.
  f.documents.delete(`users/one/waterLogs/${date}-10000`)
  f.advance(1)
  const repaired = await rebuildNutritionDay({ db: f.db, uid: 'one', date, sourceVersion: Timestamp.fromMillis(f.now()), now: f.now })
  assert.equal(repaired.summary.waterMl, 1000000)
})

test('20,000 document request budget persists finished days and the next poll resumes without rereading them', async () => {
  const f = summaryFixture()
  for (const date of ['2026-10-22', '2026-10-23', '2026-10-24']) f.add(date, 9000)
  const first = await f.call({ fromDate: '2026-10-22', toDate: '2026-10-24', forceRefresh: true })
  assert.equal(first.coverage, 'pending')
  assert.equal(first.sourceDocuments, 20000)
  assert.deepEqual(first.items.map(item => item.date), ['2026-10-22', '2026-10-23'])
  assert.equal(f.reads.reduce((sum, item) => sum + item.count, 0), 20000)
  assert.equal(f.documents.get('users/one/nutritionDailySummaries/2026-10-24').status, 'pending')
  const previousReads = f.reads.length
  const next = await f.call({ fromDate: '2026-10-22', toDate: '2026-10-24', refreshAfter: first.refreshAfter })
  assert.equal(next.coverage, 'ready')
  assert.equal(next.refreshAfter, first.refreshAfter)
  assert.equal(next.sourceDocuments, 9000)
  assert.equal(next.items.length, 3)
  assert.ok(f.reads.slice(previousReads).every(item => item.date === '2026-10-24'))
})

test('first-ever overflow persists a versioned partial summary instead of rescanning on every warm poll', async () => {
  const f = summaryFixture(), date = '2026-10-24'
  f.add(date, 10001)
  const first = await f.call({ fromDate: date, toDate: date })
  assert.equal(first.coverage, 'partial')
  assert.equal(f.documents.get(`users/one/nutritionDailySummaries/${date}`).schemaVersion, SCHEMA_VERSION)
  const warm = await f.call({ fromDate: date, toDate: date })
  assert.equal(warm.coverage, 'partial')
  assert.equal(warm.sourceDocuments, 0)
})

test('40-second cold-read deadline leaves pending status and resumes on the next request', async () => {
  const f = summaryFixture(), date = '2026-10-24'
  f.add(date, 1)
  f.onQuery(() => { f.advance(41000); f.onQuery(null) })
  const first = await f.call({ fromDate: date, toDate: date })
  assert.equal(first.coverage, 'pending')
  assert.equal(f.reads.length, 1)
  assert.equal(f.documents.get(`users/one/nutritionDailySummaries/${date}`).status, 'pending')
  const next = await f.call({ fromDate: date, toDate: date })
  assert.equal(next.coverage, 'ready')
  assert.equal(next.items[0].waterMl, 100)
})
