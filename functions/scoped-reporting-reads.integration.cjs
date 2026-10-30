'use strict'

const assert = require('node:assert/strict')
const { test, after } = require('node:test')
const { randomUUID } = require('node:crypto')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { createScopedReportingReadFunctions } = require('./scoped-reporting-reads')
const { createFinanceLedgerFunctions } = require('./finance-ledger')

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

test('real Firestore category pages preserve settled frozen rows, branch totals and category cursor fences', async () => {
  const { db, api } = fixture(), batch = db.batch()
  const base = { studentId: 's', branchId: 'a', totalPrice: 1000, paidAmount: 200, status: 'active' }
  const pending = [{ status: 'pending', date: '2026-10-30', amount: 300 }]
  batch.set(db.doc('students/s'), { name: 'Synthetic learner' })
  for (const [id, patch] of [
    ['a-plan', { installments: pending }],
    ['b-frozen-paid', { status: 'frozen', paidAmount: 1000 }],
    ['c-preserved', { installments: pending, pausePeriods: [{ type: 'preservation', startDate: '2026-10-30', endDate: '2026-10-31' }] }],
    ['d-debt', {}], ['e-overpaid', { installments: pending, paidAmount: 1100 }],
    ['f-other-branch', { branchId: 'b', status: 'frozen' }],
  ]) batch.set(db.doc(`contracts/${id}`), { ...base, ...patch })
  await batch.commit()
  const input = { branchId: 'a', today: '2026-10-30', category: 'frozen', pageSize: 1 }
  const first = await api.listFinanceReceivables({ data: input })
  assert.equal(first.contracts[0].id, 'b-frozen-paid')
  assert.equal(first.summary.counts.all, 2)
  assert.equal(first.summary.counts.settled, 1)
  assert.equal(first.summary.totals.debt, 800)
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
