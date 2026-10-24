'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { Timestamp } = require('firebase-admin/firestore')
const { DEFAULT_POLICY, sourceDocumentId } = require('./loyalty-core')
const { nutritionLoyaltyChanged, reconcileNutritionReview, readAllNutritionRewardDocuments } = require('./loyalty')

const quiet = { info() {}, warn() {}, error() {} }
const approved = (date = '2026-10-24', overrides = {}) => ({ userId: 'student-1', status: 'approved', createdAt: `${date}T02:00:00Z`, meal: { mealDate: date, calories: 500, protein: 30, targetKcal: 1500, targetProtein: 90 }, ...overrides })
const sourcePath = key => `loyaltySourceBalances/${sourceDocumentId(key)}`

function fixture(seed = {}, policy = {}) {
  const documents = new Map(Object.entries({
    'students/student-1': { accountUid: 'student-1', branchId: 'a' },
    'loyaltySettings/current': { activePolicyVersion: 'test-policy', launchDate: '2026-01-01' },
    'loyaltyPolicyVersions/test-policy': { ...DEFAULT_POLICY, earnEnabled: true, nutritionEnabled: true, nutritionMonthlyCap: 10000, recurringBehaviorMonthlyCap: 100000, ...policy },
    ...seed,
  }))
  const reads = { documents: [], queries: [] }, writes = []
  let tail = Promise.resolve()
  const snapshot = path => ({ id: path.split('/').at(-1), path, exists: documents.has(path), data: () => documents.get(path) })
  const store = (path, value, options) => {
    documents.set(path, options?.merge ? { ...documents.get(path), ...value } : value)
    writes.push(path)
  }
  const doc = path => ({ path, id: path.split('/').at(-1), get: async () => { reads.documents.push(path); return snapshot(path) }, set: async (value, options) => store(path, value, options) })
  const query = (path, filters = [], limit = Infinity, after = '', fields = [], ordered = false) => ({
    where: (key, op, value) => query(path, [...filters, [key, op, value]], limit, after, fields, ordered),
    orderBy: field => { assert.ok(field?.isEqual?.(require('firebase-admin/firestore').FieldPath.documentId())); return query(path, filters, limit, after, fields, true) },
    limit: cap => query(path, filters, cap, after, fields, ordered),
    select: (...selected) => query(path, filters, limit, after, selected, ordered),
    startAfter: cursor => { assert.ok(ordered); return query(path, filters, limit, cursor.id, fields, ordered) },
    async get() {
      let docs = [...documents].filter(([key, value]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')
        && filters.every(([field, op, match]) => op === 'in' ? match.includes(value[field]) : value[field] === match))
        .map(([key]) => snapshot(key)).sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)))
        .filter(item => !after || Buffer.compare(Buffer.from(item.id), Buffer.from(after)) > 0).slice(0, limit)
      if (fields.length) docs = docs.map(item => {
        const projected = {}
        for (const field of fields) {
          const parts = field.split('.'), value = parts.reduce((parent, key) => parent?.[key], item.data())
          if (value === undefined) continue
          let parent = projected
          for (const key of parts.slice(0, -1)) parent = parent[key] ||= {}
          parent[parts.at(-1)] = value
        }
        return { ...item, data: () => projected }
      })
      reads.queries.push({ path, filters, limit, after, fields, size: docs.length })
      return { docs, size: docs.length, empty: !docs.length }
    },
  })
  const db = {
    doc, collection: query,
    runTransaction(callback) {
      const run = tail.then(async () => {
        const pending = []
        const value = await callback({
          get: async reference => { assert.equal(pending.length, 0); return reference.get() },
          set: (reference, data, options) => pending.push([reference.path, data, options]),
          create: (reference, data) => { assert.equal(documents.has(reference.path), false); pending.push([reference.path, data]) },
        })
        for (const args of pending) store(...args)
        return value
      })
      tail = run.catch(() => undefined)
      return run
    },
  }
  return { db, documents, reads, writes, reconcile: input => reconcileNutritionReview({ db, logger: quiet, reviewId: 'review-1', ...input }) }
}

test('feedback-only and unapproved changes produce zero Firestore reads and writes', async () => {
  const f = fixture(), before = approved()
  const after = { ...before, feedback: 'Thêm rau', aiFeedback: 'Bữa ăn tốt', reviewedAt: Timestamp.now(), revision: 9,
    meal: { ...before.meal, title: 'Tên hiển thị mới', imageUrl: 'private-photo', aiFeedback: 'Thêm rau' } }
  assert.equal(nutritionLoyaltyChanged(before, after), false)
  assert.equal((await f.reconcile({ beforeValue: before, afterValue: after })).skipped, 'unchanged_nutrition_reward')
  assert.equal((await f.reconcile({ afterValue: { ...after, status: 'pending' } })).skipped, 'unchanged_nutrition_reward')
  assert.equal((await f.reconcile({ beforeValue: { ...before, status: 'pending' }, afterValue: { ...after, status: 'rejected' } })).skipped, 'unchanged_nutrition_reward')
  assert.equal(f.reads.documents.length, 0)
  assert.equal(f.reads.queries.length, 0)
  assert.equal(f.writes.length, 0)
})

test('approval, revocation, deletion, meal date, target and nutrition changes invalidate rewards', () => {
  const before = approved()
  for (const after of [{}, { ...before, status: 'rejected' }, { ...before, meal: { ...before.meal, mealDate: '2026-11-01' } },
    { ...before, meal: { ...before.meal, calories: 700 } }, { ...before, targetProtein: 100 }, { ...before, userId: 'student-2' }]) {
    assert.equal(nutritionLoyaltyChanged(before, after), true)
  }
  assert.equal(nutritionLoyaltyChanged({ ...before, status: 'pending' }, before), true)
  // Changing the fallback date matters when a legacy review has no meal date.
  assert.equal(nutritionLoyaltyChanged({ ...before, meal: {}, createdAt: '2026-10-31' }, { ...before, meal: {}, createdAt: '2026-11-01' }), true)
})

test('approved history pagination reads beyond 1000 without duplicate or missing rows', async () => {
  const seed = {}
  for (let i = 0; i < 1005; i++) seed[`mealReviews/review-${String(i).padStart(5, '0')}`] = approved()
  for (let i = 0; i < 1100; i++) seed[`mealReviews/pending-${i}`] = approved('2026-10-24', { status: 'pending' })
  seed['mealReviews/other-account'] = approved('2026-10-24', { userId: 'student-2' })
  const f = fixture(seed)
  const result = await f.reconcile({ afterValue: approved() })
  assert.equal(result.approved, 1005)
  assert.equal(result.earnedThisMonth, 1010) // 1005 meals, complete day +2, protein +3.
  const pages = f.reads.queries.filter(item => item.path === 'mealReviews')
  assert.deepEqual(pages.map(item => item.size), [250, 250, 250, 250, 5])
  assert.equal(pages.reduce((sum, item) => sum + item.size, 0), 1005)
  assert.ok(pages.every(item => item.filters.some(([field, op, value]) => field === 'status' && op === '==' && value === 'approved')))
})

test('all relevant behavior balances count beyond 1000, including legacy dates; spend/referral balances are excluded', async () => {
  const seed = { 'mealReviews/review-1': approved() }
  for (let i = 0; i < 1001; i++) seed[`loyaltySourceBalances/attendance-${i}`] = {
    studentId: 'student-1', sourceType: 'attendance', state: 'available', targetPoints: 1,
    ...(i % 2 ? { monthId: '2026-10' } : { occurrenceDate: '2026-10-24' }),
  }
  for (let i = 0; i < 1500; i++) seed[`loyaltySourceBalances/spend-${i}`] = { studentId: 'student-1', sourceType: 'contract_spend', state: 'available', targetPoints: 99999, monthId: '2026-10' }
  const f = fixture(seed, { recurringBehaviorMonthlyCap: 1002 })
  const result = await f.reconcile({ afterValue: approved() })
  assert.equal(result.earnedThisMonth, 1)
  const pages = f.reads.queries.filter(item => item.path === 'loyaltySourceBalances')
  assert.equal(pages.reduce((sum, item) => sum + item.size, 0), 1001)
  assert.equal(pages.length, 5)
})

test('cursor pagination terminates on an exact page boundary and keeps Unicode document IDs', async () => {
  const f = fixture({ 'mealReviews/a': {}, 'mealReviews/b': {}, 'mealReviews/ảnh': {}, 'mealReviews/đẹp': {} })
  const result = await readAllNutritionRewardDocuments(f.db.collection('mealReviews'), ['status'], 2)
  assert.deepEqual(result.docs.map(item => item.id), ['a', 'b', 'đẹp', 'ảnh'])
  assert.deepEqual(f.reads.queries.map(item => item.size), [2, 2, 0])
})

test('moving an approved review reconciles both months and removes its old reward', async () => {
  const before = approved('2026-10-31'), after = approved('2026-11-01')
  const f = fixture({
    'mealReviews/review-1': after,
    'loyaltyAccounts/student-1': { studentId: 'student-1', accountUid: 'student-1', availablePoints: 5, lifetimeEarnedPoints: 5 },
    [sourcePath('nutrition_review:review-1')]: { studentId: 'student-1', sourceKey: 'nutrition_review:review-1', sourceId: 'review-1', sourceType: 'nutrition', state: 'available', targetPoints: 5, monthId: '2026-10', occurrenceDate: '2026-10-31' },
  })
  const result = await f.reconcile({ beforeValue: before, afterValue: after })
  assert.deepEqual(result.reconciledMonths, ['2026-10', '2026-11'])
  assert.equal(f.documents.get(sourcePath('nutrition_review:review-1')).monthId, '2026-11')
  assert.equal(f.documents.get('loyaltyAccounts/student-1').availablePoints, 1)
  assert.equal(f.documents.get('loyaltyMissionProgress/student-1_nutrition_month_2026-10').rewardPoints, 0)
})

test('the exact fourth week earns once across an eight-week chain; weeks five and eight do not earn again', async () => {
  const seed = {}
  for (let week = 0; week < 8; week++) for (let day = 0; day < 5; day++) for (let meal = 0; meal < 3; meal++) {
    const date = new Date(Date.parse('2026-08-31T12:00:00Z') + (week * 7 + day) * 86_400_000).toISOString().slice(0, 10)
    seed[`mealReviews/week-${week}-day-${day}-meal-${meal}`] = approved(date)
  }
  const f = fixture(seed)
  await f.reconcile({ reviewId: 'week-3-day-4-meal-2', afterValue: seed['mealReviews/week-3-day-4-meal-2'] })
  await f.reconcile({ reviewId: 'week-7-day-4-meal-2', afterValue: seed['mealReviews/week-7-day-4-meal-2'] })
  const awards = [...f.documents].filter(([path, value]) => path.startsWith('loyaltySourceBalances/') && value.rewardKind === 'four_week_streak' && value.state === 'available')
  assert.equal(awards.length, 1)
  assert.equal(awards[0][1].sourceId, '2026-09-21')
  assert.equal(awards[0][1].targetPoints, 50)
  assert.equal(f.documents.get('loyaltyMissionProgress/student-1_nutrition_streak_2026-10-19').progress, 8)
})

test('attendance cap reconciliation explicitly bypasses the feedback guard', async () => {
  const f = fixture({ 'mealReviews/review-1': approved() })
  const result = await f.reconcile({ afterValue: { userId: 'student-1', createdAt: '2026-10-24' }, force: true })
  assert.equal(result.approved, 1)
  assert.equal(result.earnedThisMonth, 1)
})

test('nutrition replay writes no mission or points, while progress-only changes still persist', async () => {
  const f = fixture({ 'mealReviews/review-1': approved() })
  await f.reconcile({ afterValue: approved() })
  const writesBefore = f.writes.length
  const accountBefore = f.documents.get('loyaltyAccounts/student-1')
  const mission = 'loyaltyMissionProgress/student-1_nutrition_month_2026-10'
  const missionBefore = f.documents.get(mission)
  await f.reconcile({ afterValue: approved() })
  assert.deepEqual(f.writes.slice(writesBefore).filter(path => path.startsWith('loyaltyMissionProgress/') || path.startsWith('loyaltyLedger/')), [])
  assert.deepEqual(f.documents.get('loyaltyAccounts/student-1'), accountBefore)
  assert.equal(f.documents.get(mission).revision, missionBefore.revision)
  f.documents.set('mealReviews/review-2', approved('2026-10-25'))
  await f.reconcile({ reviewId: 'review-2', afterValue: approved('2026-10-25') })
  assert.match(f.documents.get(mission).description, /^2 bữa/)
  assert.equal(f.documents.get(mission).revision, missionBefore.revision + 1)
})
