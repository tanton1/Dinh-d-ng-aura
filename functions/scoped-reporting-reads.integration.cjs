'use strict'

const assert = require('node:assert/strict')
const { test, after } = require('node:test')
const { randomUUID, createHash } = require('node:crypto')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { createScopedReportingReadFunctions } = require('./scoped-reporting-reads')
const { createFinanceLedgerFunctions } = require('./finance-ledger')
const { createSharedDashboardCache, CACHE_COLLECTION } = require('./operations-dashboard-cache')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `reporting-${randomUUID()}`)
const clients = []
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })
const admin = { uid: 'admin', accessRole: 'admin', authzVersion: 1, capabilities: ['finance.operations.manage'] }
function fixture() {
  const db = getFirestore(app, `reporting-${randomUUID()}`); clients.push(db)
  const api = createScopedReportingReadFunctions({ db, onCall: handler => handler, authorize: async () => admin, logger: { warn() {} } })
  return { db, api }
}

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
async function categoryFixture() {
  const { db } = fixture(), batch = db.batch()
  const base = { studentId: 's', branchId: 'a', totalPrice: 1000, paidAmount: 200, status: 'active' }
  batch.set(db.doc('students/s'), { name: 'Synthetic learner' })
  batch.set(db.doc('contracts/plan'), { ...base, installments: [{ status: 'pending', date: '2026-10-30', amount: 800 }] })
  batch.set(db.doc('contracts/frozen'), { ...base, status: 'frozen', paidAmount: 800 })
  batch.set(db.doc('contracts/debt'), { ...base, paidAmount: 600 })
  await batch.commit()
  return db
}
function categoryApi(db, cache) {
  return createScopedReportingReadFunctions({ db, sharedCache: cache, onCall: handler => handler, authorize: async () => admin, logger: { warn() {} } })
}
const categoryInput = { branchId: 'a', today: '2026-10-30', pageSize: 20 }

for (const refresh of [false, true]) test(`different category callers share one ${refresh ? 'forced refresh' : 'cold'} snapshot and lease`, { timeout: 15000 }, async () => {
  const db = await categoryFixture(), followerWaiting = deferred(), published = deferred()
  const caches = [0, 1].map(() => createSharedDashboardCache({ db, coalesceRefresh: true, buildLeaseMs: 120000,
    pause: async () => { followerWaiting.resolve(); await published.promise } }))
  const apis = caches.map(cache => categoryApi(db, cache)), transact = db.runTransaction.bind(db)
  if (refresh) await apis[0].listFinanceReceivables({ data: { ...categoryInput, category: 'all' } })
  for (const cache of caches) {
    const publish = cache.publish
    cache.publish = async (...args) => { const result = await publish(...args); published.resolve(); return result }
  }
  let builds = 0
  db.runTransaction = (callback, options) => transact(async transaction => {
    if (options?.readOnly) { builds++; await followerWaiting.promise }
    return callback(transaction)
  }, options)
  const responses = await Promise.all(apis.map((api, index) => api.listFinanceReceivables({ data: {
    ...categoryInput, category: index ? 'frozen' : 'installments', refresh,
  } })))
  assert.equal(builds, 1)
  assert.deepEqual(responses.map(value => value.summary.totals.debt), [800, 200])
  assert.equal(responses.filter(value => value.summary.cache?.hit).length, 1)
  assert.equal(responses[0].summary.asOf, responses[1].summary.asOf)
  for (const response of responses) {
    assert.equal(response.summary.sourceDocuments, 3)
    assert.equal(response.summary.categorySummaries, undefined)
    assert.deepEqual(Object.keys(response.summary).sort(), ['asOf', ...(response.summary.cache ? ['cache'] : []), 'complete', 'counts', 'source', 'sourceDocuments', 'totals'].sort())
  }
  const debt = await apis[1].listFinanceReceivables({ data: { ...categoryInput, category: 'debt' } })
  assert.equal(debt.summary.totals.debt, 400)
  assert.equal(debt.summary.cache.hit, true)
  assert.equal(builds, 1)
})

test('post-payment refresh in another category cannot join a late pre-payment category snapshot', { timeout: 15000 }, async () => {
  const db = await categoryFixture(), captured = deferred(), followerWaiting = deferred(), published = deferred()
  const caches = [0, 1].map(() => createSharedDashboardCache({ db, coalesceRefresh: true, buildLeaseMs: 120000,
    pause: async () => { followerWaiting.resolve(); await published.promise } }))
  const publish = caches[0].publish
  caches[0].publish = async (...args) => { const result = await publish(...args); published.resolve(); return result }
  const apis = caches.map(cache => categoryApi(db, cache)), transact = db.runTransaction.bind(db)
  let builds = 0, sourceReads = 0
  db.runTransaction = (callback, options) => transact(transaction => {
    if (!options?.readOnly) return callback(transaction)
    builds++
    return callback(new Proxy(transaction, { get(target, key) {
      if (key === 'get') return async query => {
        const result = await target.get(query)
        if (++sourceReads === 1) { captured.resolve(); await followerWaiting.promise }
        return result
      }
      const value = target[key]
      return typeof value === 'function' ? value.bind(target) : value
    } }))
  }, options)
  const older = apis[0].listFinanceReceivables({ data: { ...categoryInput, category: 'installments' } })
  await captured.promise
  const payment = db.batch()
  payment.update(db.doc('contracts/plan'), { paidAmount: 1000 })
  payment.update(db.doc('contracts/debt'), { paidAmount: 900 })
  await payment.commit()
  const fresh = apis[1].listFinanceReceivables({ data: { ...categoryInput, category: 'debt', refresh: true } })
  const [oldResult, freshResult] = await Promise.all([older, fresh])
  assert.equal(oldResult.summary.totals.debt, 800, 'old caller keeps its original source snapshot')
  assert.equal(freshResult.summary.totals.debt, 100, 'post-payment refresh must take a newer source snapshot')
  assert.equal(freshResult.summary.cache, undefined)
  assert.equal(builds, 2)
  for (const [category, expected] of [['all', 300], ['installments', 0], ['frozen', 200], ['debt', 100]]) {
    const result = await apis[0].listFinanceReceivables({ data: { ...categoryInput, category } })
    assert.equal(result.summary.totals.debt, expected)
    assert.equal(result.summary.cache.hit, true)
    assert.equal(result.summary.asOf, freshResult.summary.asOf)
  }
  assert.equal(builds, 2, 'one refreshed snapshot supplies every subsequent category')
})

test('all category rollups retain one read-only snapshot when a later source page changes', async () => {
  const { db, api } = fixture()
  for (let offset = 0; offset < 501; offset += 250) {
    const batch = db.batch()
    for (let i = offset; i < Math.min(501, offset + 250); i++) batch.set(db.doc(`contracts/c${String(i).padStart(3, '0')}`), {
      studentId: 's', branchId: 'a', totalPrice: 100, paidAmount: 20, status: i === 500 ? 'frozen' : 'active',
    })
    await batch.commit()
  }
  const transact = db.runTransaction.bind(db)
  let mutated = false, sourcePages = 0
  db.runTransaction = (callback, options) => transact(transaction => callback(options?.readOnly ? new Proxy(transaction, {
    get(target, key) {
      if (key === 'get') return async query => {
        const result = await target.get(query); sourcePages++
        if (!mutated) { mutated = true; await db.doc('contracts/c500').update({ paidAmount: 100 }) }
        return result
      }
      const value = target[key]
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) : transaction), options)
  const all = await api.listFinanceReceivables({ data: categoryInput })
  const frozen = await api.listFinanceReceivables({ data: { ...categoryInput, category: 'frozen' } })
  assert.equal(mutated, true)
  assert.equal(sourcePages, 2)
  assert.equal(all.summary.totals.debt, 501 * 80)
  assert.equal(frozen.summary.totals.debt, 80, 'cached other category shares the original snapshot, even though its page is now settled')
  assert.equal(frozen.summary.cache.hit, true)
  assert.equal(frozen.summary.asOf, all.summary.asOf)
  const refreshed = await api.listFinanceReceivables({ data: { ...categoryInput, category: 'frozen', refresh: true } })
  assert.equal(refreshed.summary.totals.debt, 0)
  assert.equal(sourcePages, 4)
})

test('v5 category cache ignores legacy payloads and propagates unknown then recovered zero totals across tabs', async () => {
  const db = await categoryFixture(), api = categoryApi(db)
  const oldKey = `receivables-v4-${createHash('sha256').update(JSON.stringify(['a', categoryInput.today, 'frozen'])).digest('hex')}`
  const oldCache = createSharedDashboardCache({ db }), oldClaim = await oldCache.acquire(oldKey)
  await oldCache.publish(oldKey, { complete: true, totals: { debt: 999 }, source: 'legacy-fixture' }, oldClaim.lease)
  const first = await api.listFinanceReceivables({ data: { ...categoryInput, category: 'frozen' } })
  assert.equal(first.summary.totals.debt, 200)
  const cacheRows = await db.collection(CACHE_COLLECTION).get()
  assert.equal(cacheRows.size, 2)
  assert.equal(cacheRows.docs.filter(doc => doc.id.startsWith('receivables-v5-')).length, 1)
  assert.equal((await oldCache.get(oldKey)).totals.debt, 999, 'migration does not mutate an old revision cache')
  await db.doc('contracts/plan').update({ paidAmount: null })
  const unknown = await api.listFinanceReceivables({ data: { ...categoryInput, category: 'frozen', refresh: true } })
  assert.equal(unknown.summary.complete, false)
  assert.equal(unknown.summary.reason, 'invalid-amount')
  for (const category of ['all', 'installments', 'debt']) {
    const result = await api.listFinanceReceivables({ data: { ...categoryInput, category } })
    assert.equal(result.summary.cache.hit, true)
    assert.equal(result.summary.complete, false)
    assert.equal(result.summary.totals, null)
    assert.equal(result.summary.counts, null)
  }
  await db.doc('contracts/plan').update({ paidAmount: 1000 })
  await api.listFinanceReceivables({ data: { ...categoryInput, category: 'debt', refresh: true } })
  const zero = await api.listFinanceReceivables({ data: { ...categoryInput, category: 'installments' } })
  assert.equal(zero.summary.cache.hit, true)
  assert.equal(zero.summary.complete, true)
  assert.deepEqual(zero.summary.totals, { debt: 0, overdue: 0, thisMonth: 0 })
  assert.ok(Object.values(zero.summary.counts).every(value => value === 0))
})

test('real Firestore collection-group pagination counts more than 5,000 learners and cached opens do no source scans', { timeout: 120000 }, async () => {
  const { db, api } = fixture()
  for (let offset = 0; offset < 5501; offset += 250) {
    const batch = db.batch()
    for (let i = offset; i < Math.min(5501, offset + 250); i++) {
      const userId = `u${String(i).padStart(5, '0')}`
      batch.set(db.doc(`enrollments/${userId}_course`), { userId, courseId: 'course', status: 'active' })
      batch.set(db.doc(`users/${userId}/progress/course`), { courseId: 'course', percent: 50 })
    }
    await batch.commit()
  }
  const transact = db.runTransaction.bind(db)
  let changedDuringScan = false
  db.runTransaction = (callback, options) => transact(transaction => callback(options?.readOnly ? new Proxy(transaction, {
    get(target, key) {
      if (key === 'get') return async query => {
        const result = await target.get(query)
        if (!changedDuringScan && Array.isArray(result.docs)) {
          changedDuringScan = true
          // This enrollment lies on a later page. A non-transactional scan
          // would combine two instants and report only 5,500 active learners.
          await db.doc('enrollments/u05500_course').update({ status: 'cancelled' })
        }
        return result
      }
      const value = target[key]
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) : transaction), options)
  const first = await api.getAcademyAnalyticsSummary({ data: {} })
  assert.equal(changedDuringScan, true)
  assert.equal(first.complete, true)
  assert.equal(first.sourceDocuments, 11002)
  assert.equal(first.courses[0].learners, 5501)
  assert.equal(first.courses[0].averageCompletion, 50)
  const originalCollection = db.collection.bind(db)
  db.collection = path => { assert.notEqual(path, 'enrollments', 'cached open must not scan enrollments'); return originalCollection(path) }
  db.collectionGroup = () => { throw new Error('cached open must not scan progress') }
  const second = await api.getAcademyAnalyticsSummary({ data: {} })
  assert.equal(second.cache.hit, true)
  assert.equal(second.asOf, first.asOf)
  assert.deepEqual(second.courses, first.courses)
})

test('real Firestore finance pages join bounded labels, retain branch scope and reject malformed dates', async () => {
  const { db, api } = fixture()
  const batch = db.batch()
  batch.set(db.doc('students/student'), { name: 'A', phone: '0900', email: 'a@example.test', health: 'private' })
  for (let i = 0; i < 55; i++) batch.set(db.doc(`contracts/c${String(i).padStart(3, '0')}`), {
    studentId: 'student', branchId: i < 52 ? 'a' : 'b', totalPrice: 100, paidAmount: 20, nextPaymentDate: '2026-10-20',
  })
  await batch.commit()
  const input = { branchId: 'a', today: '2026-10-30', pageSize: 50 }
  const first = await api.listFinanceReceivables({ data: input })
  assert.equal(first.contracts.length, 50)
  assert.equal(first.summary.totals.debt, 52 * 80)
  assert.equal(first.students.length, 1)
  assert.equal(first.students[0].health, undefined)
  const second = await api.listFinanceReceivables({ data: { ...input, cursor: first.nextCursor, includeSummary: false } })
  assert.equal(second.contracts.length, 2); assert.equal(second.hasMore, false)
  assert.equal(new Set([...first.contracts, ...second.contracts].map(row => row.id)).size, 52)
  await assert.rejects(api.listFinanceReceivables({ data: { ...input, today: '2026-02-30' } }), { code: 'invalid-argument' })
})

test('real Firestore preserved debt pages exclude settled rows and retain branch totals and category cursor fences', async () => {
  const { db, api } = fixture(), batch = db.batch()
  const base = { studentId: 's', branchId: 'a', totalPrice: 1000, paidAmount: 200, status: 'active' }
  const pending = [{ status: 'pending', date: '2026-10-30', amount: 300 }]
  batch.set(db.doc('students/s'), { name: 'Synthetic learner' })
  for (const [id, patch] of [
    ['a-plan', { installments: pending }],
    ['b-frozen-owing', { status: 'frozen' }],
    ['b-frozen-paid', { status: 'frozen', paidAmount: 1000 }],
    ['c-preserved', { installments: pending, pausePeriods: [{ type: 'preservation', startDate: '2026-10-30', endDate: '2026-10-31' }] }],
    ['d-debt', {}], ['e-overpaid', { installments: pending, paidAmount: 1100 }],
    ['f-other-branch', { branchId: 'b', status: 'frozen' }],
  ]) batch.set(db.doc(`contracts/${id}`), { ...base, ...patch })
  await batch.commit()
  const input = { branchId: 'a', today: '2026-10-30', category: 'frozen', pageSize: 1 }
  const first = await api.listFinanceReceivables({ data: input })
  assert.equal(first.contracts[0].id, 'b-frozen-owing')
  assert.equal(first.summary.counts.all, 2)
  assert.equal(first.summary.counts.settled, 0)
  assert.equal(first.summary.counts.overpaid, 0)
  assert.equal(first.summary.totals.debt, 1600)
  assert.equal(first.summary.totals.overdue, 0)
  const second = await api.listFinanceReceivables({ data: { ...input, cursor: first.nextCursor, includeSummary: false } })
  assert.equal(second.contracts[0].id, 'c-preserved')
  await assert.rejects(api.listFinanceReceivables({ data: { ...input, category: 'debt', cursor: first.nextCursor } }), { code: 'invalid-argument' })
  const debt = await api.listFinanceReceivables({ data: { ...input, category: 'debt', filter: 'overpaid', search: 'missing' } })
  assert.equal(debt.contracts.length, 0)
  assert.equal(debt.summary.totals.debt, 800, 'search/filter never narrow category totals')
  assert.equal(debt.summary.counts.overpaid, 1)
  const plan = await api.listFinanceReceivables({ data: { ...input, category: 'installments' } })
  assert.equal(plan.contracts[0].id, 'a-plan')
  assert.equal(plan.summary.totals.debt, 800)
  assert.equal(plan.summary.counts['this-week'], 1)
})

test('real Firestore refreshed preservation debt follows settled, overpaid, reopened and cancelled transitions', async () => {
  const { db, api } = fixture()
  await db.doc('contracts/c').set({ studentId: 's', branchId: 'a', totalPrice: 1000, paidAmount: 200, status: 'active',
    installments: [{ status: 'pending', date: '2026-10-20', amount: 800 }],
    pausePeriods: [{ type: 'preservation', startDate: '2026-10-01', endDate: '2026-10-31' }] })
  const input = { branchId: 'a', today: '2026-10-30', category: 'frozen', refresh: true }
  const assertPreservedDebt = async expected => {
    const page = await api.listFinanceReceivables({ data: input })
    assert.equal(page.summary.complete, true)
    assert.equal(page.contracts.length, expected > 0 ? 1 : 0)
    assert.equal(page.summary.counts.all, expected > 0 ? 1 : 0)
    assert.equal(page.summary.counts.owing, expected > 0 ? 1 : 0)
    assert.equal(page.summary.counts.settled, 0)
    assert.equal(page.summary.counts.overpaid, 0)
    assert.deepEqual(page.summary.totals, { debt: expected, overdue: 0, thisMonth: 0 })
  }
  await assertPreservedDebt(800)
  await db.doc('contracts/c').update({ paidAmount: 1000 })
  await assertPreservedDebt(0)
  await db.doc('contracts/c').update({ paidAmount: 1100 })
  await assertPreservedDebt(0)
  await db.doc('contracts/c').update({ paidAmount: 500 })
  await assertPreservedDebt(500)
  await db.doc('contracts/c').update({ status: 'cancelled' })
  await assertPreservedDebt(0)
  const cancelled = await api.listFinanceReceivables({ data: { ...input, category: 'installments' } })
  assert.deepEqual(cancelled.contracts, [])
  assert.equal(cancelled.summary.totals.overdue, 0)
  for (const status of ['review_required', 'pending_approval', 'approved', 'settled']) {
    await db.doc('contracts/c').update({ cancellationSettlement: { schemaVersion: 1, status, settlementAmount: 700, canonicalCash: 500 } })
    const settlement = await api.listFinanceReceivables({ data: { ...input, category: 'all' } })
    assert.deepEqual(settlement.contracts, [], 'approved settlement receivables belong in the student profile')
    assert.equal(settlement.summary.complete, true)
    assert.equal(settlement.summary.counts.all, 0)
    assert.equal(settlement.summary.totals.debt, 0)
  }
  await db.doc('contracts/c').update({ status: 'active', pausePeriods: [] })
  await assertPreservedDebt(0)
  const reopened = await api.listFinanceReceivables({ data: { ...input, category: 'installments' } })
  assert.equal(reopened.summary.counts.all, 1)
  assert.equal(reopened.summary.totals.debt, 500)
})

test('real Firestore receivables follow atomic cash changes independently of posted recognition corrections', async () => {
  const { db, api } = fixture(), batch = db.batch()
  batch.set(db.doc('users/admin'), { role: 'admin' })
  batch.set(db.doc('students/s'), { name: 'Synthetic learner' })
  batch.set(db.doc('contracts/c'), { studentId: 's', branchId: 'a', totalPrice: 1_000_000, discount: 0, paidAmount: 400_000,
    totalSessions: 10, usedSessions: 9, status: 'active' })
  batch.set(db.doc('cashAccounts/a'), { type: 'bank', branchId: 'a', status: 'active', balance: 1_000_000 })
  for (const [id, type, status, revenueImpact] of [
    ['original', 'revenue_recognition', 'reversed', 100_000],
    ['correction', 'adjustment', 'posted', -100_000],
    ['replacement', 'revenue_recognition', 'posted', 100_000],
  ]) batch.set(db.doc(`ledgerEntries/${id}`), { contractId: 'c', type, status, revenueImpact, amount: revenueImpact, cashImpact: 0 })
  await batch.commit()
  const finance = createFinanceLedgerFunctions({ db, onCall: handler => handler })
  const request = data => ({ auth: { uid: 'admin', token: { role: 'admin' } }, data })
  const input = { branchId: 'a', today: '2026-10-30', category: 'debt' }
  const read = () => api.listFinanceReceivables({ data: { ...input, refresh: true } })
  assert.equal((await read()).summary.totals.debt, 600_000)
  const payment = await finance.recordContractPayment(request({ contractId: 'c', amount: 100_000, paymentMethod: 'transfer',
    cashAccountId: 'a', effectiveAt: '2026-10-30T05:00:00Z', idempotencyKey: randomUUID() }))
  const paymentRow = (await db.doc(`ledgerEntries/${payment.entryId}`).get()).data()
  assert.ok(paymentRow.receivableImpact === 0, 'posted recognition is 100k even though nine entitlements are consumed')
  assert.equal(paymentRow.deferredRevenueImpact, 100_000)
  assert.equal((await read()).summary.totals.debt, 500_000)
  await finance.recordRefund(request({ contractId: 'c', amount: 50_000, paymentMethod: 'transfer', cashAccountId: 'a',
    effectiveAt: '2026-10-30T05:01:00Z', reason: 'Synthetic refund', idempotencyKey: randomUUID() }))
  assert.equal((await read()).summary.totals.debt, 550_000)
  const reversal = request({ entryId: payment.entryId, reason: 'Synthetic reversal', idempotencyKey: randomUUID() })
  await finance.reverseContractPayment(reversal)
  assert.equal((await read()).summary.totals.debt, 650_000)
  await finance.reverseContractPayment(reversal)
  assert.equal((await read()).summary.totals.debt, 650_000, 'replay cannot change the cash projection a second time')
})
