'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const {
  createFinanceLedgerFunctions,
  contractAdvanceAccountCode,
  normalizeLedgerListInput,
  receiptVoucherNumber,
  summarizeLedgerDocuments,
  updatedInstallments,
} = require('./finance-ledger')
const { Timestamp } = require('firebase-admin/firestore')

const repositoryRoot = join(__dirname, '..')
const reportSource = readFileSync(join(repositoryRoot, 'src', 'pages', 'admin', 'AdminDashboard.tsx'), 'utf8')
const financeSource = readFileSync(join(repositoryRoot, 'src', 'components', 'admin', 'pt', 'FinanceManagement.tsx'), 'utf8')
const ledgerSource = readFileSync(join(__dirname, 'finance-ledger.js'), 'utf8')

function summaryInput(overrides = {}) {
  return {
    branchId: 'all',
    types: new Set(),
    status: 'all',
    ...overrides,
  }
}

test('finance list input is bounded and rejects invalid ranges', () => {
  const normalized = normalizeLedgerListInput({
    pageSize: 1000,
    startAt: '2026-08-01T00:00:00.000Z',
    endAt: '2026-08-31T23:59:59.999Z',
    branchId: 'branch-a',
    types: ['payment', 'refund'],
  })
  assert.equal(normalized.pageSize, 100)
  assert.equal(normalized.branchId, 'branch-a')
  assert.deepEqual([...normalized.types], ['payment', 'refund'])
  assert.throws(() => normalizeLedgerListInput({ startAt: '2026-09-01', endAt: '2026-08-01' }), /Khoảng ngày tài chính/)
  assert.throws(() => normalizeLedgerListInput({ endAt: '+275760-09-13T00:00:00.000Z' }), /ngoài phạm vi/)
  assert.throws(() => normalizeLedgerListInput({ types: ['delete'] }), /Loại bút toán/)
})

test('canonical summary uses effective entries and a reversal offsets its original payment', () => {
  const effectiveAt = new Date('2026-08-20T02:00:00.000Z')
  const summary = summarizeLedgerDocuments([
    { type: 'payment', status: 'reversed', amount: 500_000, branchId: 'a', effectiveAt },
    { type: 'reversal', status: 'posted', amount: -500_000, branchId: 'a', effectiveAt },
    { type: 'payment', status: 'posted', amount: 300_000, branchId: 'a', effectiveAt },
    { type: 'refund', status: 'posted', amount: -50_000, branchId: 'a', effectiveAt },
    { type: 'payment', status: 'pending', amount: 999_000, branchId: 'a', effectiveAt },
  ], summaryInput({ branchId: 'a' }))

  assert.equal(summary.collectedAmount, 800_000)
  assert.equal(summary.reversedAmount, 500_000)
  assert.equal(summary.refundedAmount, 50_000)
  assert.equal(summary.cashIn, 800_000)
  assert.equal(summary.cashOut, 550_000)
  assert.equal(summary.cashNet, 250_000)
  assert.equal(summary.netRevenue, 250_000)
  assert.equal(summary.recognisedRevenue, 0)
  assert.equal(summary.transactionCount, 4)
  assert.deepEqual(summary.dailySeries, [{ date: '2026-08-20', total: 250_000 }])
})

test('revenue recognition never increases collected cash or cash net', () => {
  const effectiveAt = new Date('2026-08-20T02:00:00.000Z')
  const summary = summarizeLedgerDocuments([
    { type: 'payment', status: 'posted', amount: 1_000_000, cashImpact: 1_000_000, revenueImpact: 0, branchId: 'a', effectiveAt },
    { type: 'revenue_recognition', status: 'posted', amount: 200_000, cashImpact: 0, revenueImpact: 200_000, branchId: 'a', effectiveAt },
    { type: 'expense', status: 'posted', amount: -50_000, cashImpact: -50_000, expenseImpact: 50_000, branchId: 'a', effectiveAt },
  ], summaryInput({ branchId: 'a' }))

  assert.equal(summary.collectedAmount, 1_000_000)
  assert.equal(summary.cashIn, 1_000_000)
  assert.equal(summary.cashOut, 50_000)
  assert.equal(summary.cashNet, 950_000)
  assert.equal(summary.netRevenue, 950_000)
  assert.equal(summary.recognisedRevenue, 200_000)
  assert.equal(summary.operatingExpense, 50_000)
  assert.equal(summary.operatingResult, 150_000)
  assert.deepEqual(summary.dailySeries, [{ date: '2026-08-20', total: 950_000 }])
})

test('explicit negative expense impact from a reversal reduces operating expense', () => {
  const effectiveAt = new Date('2026-08-20T02:00:00.000Z')
  const summary = summarizeLedgerDocuments([
    { type: 'expense', status: 'posted', amount: -500_000, cashImpact: -500_000, expenseImpact: 500_000, branchId: 'a', effectiveAt },
    { type: 'reversal', status: 'posted', amount: 500_000, cashImpact: 500_000, expenseImpact: -500_000, branchId: 'a', effectiveAt },
  ], summaryInput({ branchId: 'a' }))
  assert.equal(summary.operatingExpense, 0)
  assert.equal(summary.operatingResult, 0)
})

test('contract advances use 3387 only after a multi-period service has started', () => {
  const contract = { startDate: '2026-08-01', endDate: '2026-12-31', usedSessions: 0 }
  assert.equal(contractAdvanceAccountCode(contract, new Date('2026-07-20T00:00:00Z')), '131')
  assert.equal(contractAdvanceAccountCode(contract, new Date('2026-08-20T00:00:00Z')), '3387')
  assert.equal(contractAdvanceAccountCode({ ...contract, accountingAdvanceAccountCode: '131' }, new Date('2026-09-20T00:00:00Z')), '131')
})

test('installment transition is atomic-ready and advances the next due date', () => {
  const contract = {
    installments: [
      { id: 'late', amount: 200_000, date: '2026-09-20', status: 'pending' },
      { id: 'first', amount: 100_000, date: '2026-08-20', status: 'pending' },
      { id: 'next', amount: 150_000, date: '2026-09-01', status: 'pending' },
    ],
  }
  const paid = updatedInstallments(contract, 'first', 'paid', 100_000)
  assert.equal(paid.installments.find((item) => item.id === 'first').status, 'paid')
  assert.equal(paid.nextPaymentDate, '2026-09-01')
  const refunded = updatedInstallments({ installments: paid.installments }, 'first', 'pending', 100_000)
  assert.equal(refunded.installments.find((item) => item.id === 'first').status, 'pending')
  assert.equal(refunded.nextPaymentDate, '2026-08-20')
  assert.throws(() => updatedInstallments(contract, 'first', 'paid', 99_000), /không khớp/)
})

test('admin reporting cannot fabricate or destructively synchronize legacy payments', () => {
  assert.doesNotMatch(reportSource, /auto-\$\{c\.id\}|tự động tạo - phần chênh lệch/i)
  assert.doesNotMatch(reportSource, /contract\?\.startDate\s*\?\s*new Date/)
  assert.doesNotMatch(reportSource, /addPayment|deletePayment|Đồng bộ Sổ quỹ/)
  assert.doesNotMatch(reportSource, /console\.(?:log|error|warn)/)
  assert.doesNotMatch(financeSource, /\[\.\.\.payments,\s*\.\.\.canonical\]/)
  assert.doesNotMatch(financeSource, /legacyReconciliation|showLegacyReconciliation/)
  assert.match(financeSource, /function contractDebt/)
  assert.match(financeSource, /function overdueAmount/)
  assert.match(financeSource, /listFinanceReceivables/)
  assert.doesNotMatch(financeSource, /filteredContracts\.reduce/, 'summary must not be computed from a cursor page')
  const { debtState } = require('./scoped-reporting-reads')
  const receivable = { totalPrice: 1000, paidAmount: 200, discount: 0, installments: [
    { date: '2026-10-10', amount: 100, status: 'pending' },
    { date: '2026-10-31', amount: 250, status: 'pending' },
    { date: '2026-11-02', amount: 500, status: 'pending' },
  ] }
  const state = debtState(receivable, '2026-10-30')
  assert.equal(state.debt, 800)
  assert.equal(state.overdue, 100)
  assert.equal(state.thisMonth, 350, 'month total includes all pending installments, not only the first')
  const frozen = debtState({ ...receivable, status: 'frozen' }, '2026-10-30')
  assert.equal(frozen.debt, 800)
  assert.equal(frozen.overdue, 0)
  assert.equal(frozen.thisMonth, 0)
  assert.doesNotMatch(financeSource, /ledgerSummary\.recognisedRevenue/)
  assert.match(financeSource, /eyebrow: 'Tổng nợ'/)
  assert.match(financeSource, /eyebrow: 'Quá hạn'/)
  assert.match(financeSource, /eyebrow: 'Nợ thu tháng này'/)
})

test('finance mutations guard locked periods and keep installment state in the ledger transaction', () => {
  assert.match(ledgerSource, /assertFinancePeriodOpen\(transaction, db, effectiveAt\)/)
  assert.match(ledgerSource, /installmentId: installmentId \|\| null/)
  assert.match(ledgerSource, /transaction\.update\(contractReference, \{ paidAmount: nextPaid, \.\.\.\(installmentPatch \|\| \{\}\)/)
  assert.match(ledgerSource, /reversalEffectiveAt = Timestamp\.now\(\)/)
  assert.doesNotMatch(ledgerSource, /transaction\.delete\(/)
  assert.match(ledgerSource, /journalEntries\/\$\{ledgerReference\.id\}/)
  assert.match(ledgerSource, /contractPaymentJournal/)
  assert.match(ledgerSource, /accountingAdvanceAccountCode/)
})

test('selected cash accounts move balances in the same immutable ledger transaction', () => {
  assert.match(ledgerSource, /cashAccountId: text\(input\?\.cashAccountId, 'Tài khoản quỹ', 200\)/)
  assert.match(ledgerSource, /cashAccountForMovement\(transaction, db, cashAccountId, amount\)/)
  assert.match(ledgerSource, /createCashMovement\(transaction, db, ledgerReference, cashAccount, amount/)
  assert.match(ledgerSource, /FieldValue\.increment\(signedAmount\)/)
  assert.match(ledgerSource, /cashTransactions\/ledger_\$\{ledgerReference\.id\}/)
})

test('contract collections create an immutable linked receipt voucher and reversals create the opposite document', () => {
  assert.equal(receiptVoucherNumber({ id: 'abc123xyz' }, 'da-nang', new Date('2026-08-31T02:00:00.000Z')), 'PT-DANANG-20260831-ABC123')
  assert.equal(receiptVoucherNumber({ id: 'receipt_xyz987abc' }, 'aura', new Date('2026-08-31T02:00:00.000Z')), 'PT-AURA-20260831-XYZ987')
  assert.match(ledgerSource, /accountingDocuments\/receipt_\$\{ledgerReference\.id\}/)
  assert.match(ledgerSource, /documentType: 'receipt_voucher'/)
  assert.match(ledgerSource, /amountInWords: amountInVietnameseWords\(totalAmount\)/)
  assert.match(ledgerSource, /accountingDocumentId: receipt\.reference\.id/)
  assert.match(ledgerSource, /cashTransactionId/)
  assert.match(ledgerSource, /documentType: 'receipt_voucher_reversal'/)
  assert.match(ledgerSource, /status: 'reversed'/)
})

test('contract refund creates a next-period Renew commission reversal from original rate and split', () => {
  assert.match(ledgerSource, /type: 'renew_commission_reversal'/)
  assert.match(ledgerSource, /sourceEarningEventId: original\.id/)
  assert.match(ledgerSource, /amount \* originalRate \/ 100 \* attributionPercent \/ 100/)
  assert.match(ledgerSource, /nextFinancePeriodId/)
  assert.match(ledgerSource, /status: 'approved'/)
  assert.doesNotMatch(ledgerSource, /transaction\.update\([^)]*payrollRuns[^)]*commission/)
})

// Immutable query fake with real filtering/order/cursor/field-mask behavior.
// Read budgets below count returned ledger documents, not index-entry billing.
function ledgerReadFixture(values, { queryError, role = 'admin', disabled = false } = {}) {
  const calls = []
  const documents = values.map((value, index) => ({
    id: `row-${String(index).padStart(5, '0')}`,
    data: () => value,
  }))
  const comparable = (value) => typeof value?.toMillis === 'function' ? value.toMillis() : value
  const query = (state = { filters: [], orders: [], limit: Infinity, cursor: null, fields: null }) => ({
    orderBy(field, direction) { return query({ ...state, orders: [...state.orders, [String(field), direction]] }) },
    where(field, operator, value) {
      assert.equal(state.cursor, null, 'Firestore requires filters before cursor bounds')
      return query({ ...state, filters: [...state.filters, [field, operator, value]] })
    },
    startAfter(...cursor) { return query({ ...state, cursor }) },
    limit(limit) { return query({ ...state, limit }) },
    select(...fields) { return query({ ...state, fields }) },
    async get() {
      const call = { ...state, returned: 0 }
      calls.push(call)
      const error = queryError?.(state)
      if (error) throw error
      const field = (doc, key) => key === '__name__' ? doc.id : comparable(doc.data()[key])
      let selected = documents.filter((doc) => state.orders.every(([key]) => field(doc, key) !== undefined)
        && state.filters.every(([key, operator, expected]) => {
          const actual = field(doc, key)
          if (actual === undefined) return false
          if (operator === 'in') return expected.includes(actual)
          if (operator === '==') return actual === comparable(expected)
          if (operator === '>=') return actual >= comparable(expected)
          if (operator === '<=') return actual <= comparable(expected)
          throw new Error(`Unsupported test filter ${operator}`)
        }))
      const compare = (left, right) => {
        for (const [key, direction] of state.orders) {
          const delta = left(key) < right(key) ? -1 : left(key) > right(key) ? 1 : 0
          if (delta) return direction === 'desc' ? -delta : delta
        }
        return 0
      }
      selected.sort((left, right) => compare(key => field(left, key), key => field(right, key)))
      if (state.cursor) selected = selected.filter(doc => compare(key => field(doc, key), key => comparable(state.cursor[state.orders.findIndex(([name]) => name === key)])) > 0)
      selected = selected.slice(0, state.limit)
      call.returned = selected.length
      const docs = selected.map(doc => ({ ...doc, data: () => state.fields ? Object.fromEntries(state.fields.filter(key => Object.hasOwn(doc.data(), key)).map(key => [key, doc.data()[key]])) : doc.data() }))
      return { docs, empty: docs.length === 0, size: docs.length }
    },
  })
  const db = {
    collection(name) { assert.equal(name, 'ledgerEntries'); return query() },
    doc(path) {
      assert.ok(['users/actor', 'roleAssignments/actor'].includes(path))
      return { get: async () => ({ exists: path === 'users/actor', data: () => ({ role, disabled }) }) }
    },
  }
  const { listFinanceLedger } = createFinanceLedgerFunctions({ db, onCall: handler => handler })
  return { calls, run: data => listFinanceLedger({ auth: { uid: 'actor', token: { role } }, data }), listFinanceLedger }
}

const ledgerValue = (index, patch = {}) => ({
  type: 'payment', status: 'posted', branchId: 'a', amount: 100,
  effectiveAt: Timestamp.fromMillis(Date.parse('2026-10-22T10:00:00Z') - index * 1000),
  ...patch,
})

test('small branch result shares one complete first snapshot and eliminates unrelated reads', async () => {
  const values = Array.from({ length: 200 }, (_, i) => ledgerValue(i, { branchId: i < 20 ? 'a' : 'b' }))
  const f = ledgerReadFixture(values)
  const result = await f.run({ branchId: 'a' })
  assert.equal(result.entries.length, 20)
  assert.equal(result.hasMore, false)
  assert.deepEqual(result.summary, summarizeLedgerDocuments(values, summaryInput({ branchId: 'a' })))
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls.reduce((sum, call) => sum + call.returned, 0), 20, 'previous branch scan 200 + full summary 200 = 400 documents; now 20')
})

test('large branch summary is complete and uses one indexed predicate instead of the full ledger', async () => {
  const values = Array.from({ length: 10000 }, (_, i) => ledgerValue(i, { branchId: i < 1000 ? 'a' : 'b' }))
  const f = ledgerReadFixture(values)
  const result = await f.run({ branchId: 'a', pageSize: 50 })
  assert.equal(result.entries.length, 50)
  assert.equal(result.summary.transactionCount, 1000)
  assert.equal(result.summary.collectedAmount, 100000)
  assert.equal(result.hasMore, true)
  assert.equal(f.calls.reduce((sum, call) => sum + call.returned, 0), 1150, 'previous first page 150 + summary 10000 = 10150 documents; now 1150')
  assert.ok(f.calls.every(call => call.filters.some(([key, operator, value]) => key === 'branchId' && operator === '==' && value === 'a')))
  assert.equal(f.calls.find(call => call.fields).limit, Infinity, 'summary is never truncated to a scan/page cap')
})

test('exact-boundary first batch and later cursor pages never replace all-period summary', async () => {
  for (const count of [100, 170]) {
    const f = ledgerReadFixture(Array.from({ length: count }, (_, i) => ledgerValue(i)))
    const first = await f.run({ pageSize: 10 })
    assert.equal(f.calls.length, 2, 'a full 100-document batch is not proof of exhaustion')
    const second = await f.run({ pageSize: 10, cursor: first.nextCursor })
    assert.equal(second.summary.transactionCount, count)
    assert.deepEqual(second.summary, first.summary)
    assert.equal(new Set([...first.entries, ...second.entries].map(item => item.id)).size, 20)
    assert.equal(f.calls.at(-1).limit, Infinity)
  }
})

test('single-filter pushdown preserves every combination, legacy numeric coercion and Vietnam dates', async () => {
  const values = Array.from({ length: 210 }, (_, i) => ledgerValue(i, {
    branchId: ['a', 'b', '', null, false, 0, undefined][i % 7],
    type: ['payment', 'refund', 'reversal', 'adjustment', 'revenue_recognition', 'expense', 'payroll'][i % 7],
    status: ['posted', 'reversed', 'pending'][i % 3],
    amount: ['100', -60, 20.25, null, '', 'bad', 0][i % 7],
    cashImpact: [undefined, null, '12.5', -7, 0][i % 5],
    revenueImpact: i % 2 ? '10.5' : undefined,
    expenseImpact: i % 3 ? -2 : undefined,
    currency: i % 2 ? 'VND' : 'USD',
    effectiveAt: Timestamp.fromMillis(Date.parse('2026-10-22T17:00:00Z') - i * 1000),
  }))
  for (const branchId of ['all', 'a', 'none']) for (const status of ['all', 'posted', 'reversed', 'pending']) for (const types of [[], ['payment'], ['refund', 'refund', 'expense']]) {
    const f = ledgerReadFixture(values)
    const data = { branchId, status, types, pageSize: 100 }
    const result = await f.run(data)
    assert.deepEqual(result.summary, summarizeLedgerDocuments(values, normalizeLedgerListInput(data)), JSON.stringify(data))
    assert.ok(f.calls.every(call => call.filters.length <= 1), 'no accidental index explosion')
    assert.equal(result.canonicalOnly, true)
    assert.equal(result.source, 'ledgerEntries')
  }
})

test('pending-only summary uses zero extra ledger reads even when page is full', async () => {
  const f = ledgerReadFixture(Array.from({ length: 500 }, (_, i) => ledgerValue(i, { status: 'pending' })))
  const result = await f.run({ status: 'pending', pageSize: 10 })
  assert.equal(result.entries.length, 10)
  assert.deepEqual(result.summary, summarizeLedgerDocuments([], summaryInput()))
  assert.equal(f.calls.length, 1)
})

test('missing-index fallback retains exact totals and does not conceal other backend failures', async () => {
  const values = Array.from({ length: 200 }, (_, i) => ledgerValue(i, { branchId: i % 2 ? 'a' : 'b' }))
  const missingIndex = Object.assign(new Error('The query requires an index. You can create it here.'), { code: 9 })
  const f = ledgerReadFixture(values, { queryError: state => state.filters.some(([key]) => key === 'branchId') ? missingIndex : null })
  const result = await f.run({ branchId: 'a', pageSize: 10 })
  assert.equal(result.summary.transactionCount, 100)
  assert.ok(result.entries.every(item => item.branchId === 'a'))
  assert.ok(f.calls.some(call => call.filters.length === 0))
  for (const error of [Object.assign(new Error('Permission denied'), { code: 7 }), Object.assign(new Error('Quota exceeded'), { code: 8 }), Object.assign(new Error('Some other precondition'), { code: 9 }), Object.assign(new Error('The query requires an index'), { code: 14 })]) {
    const rejected = ledgerReadFixture(values, { queryError: () => error })
    await assert.rejects(rejected.run({ branchId: 'a' }), candidate => candidate === error)
    assert.equal(rejected.calls.length, 1)
  }
})

test('authorization and invalid input fail before any ledger read', async () => {
  const unauthorized = ledgerReadFixture([])
  await assert.rejects(unauthorized.listFinanceLedger({ data: {} }), error => error.code === 'unauthenticated')
  assert.equal(unauthorized.calls.length, 0)
  for (const options of [{ role: 'student' }, { disabled: true }]) {
    const denied = ledgerReadFixture([], options)
    await assert.rejects(denied.run({}), error => error.code === 'permission-denied')
    assert.equal(denied.calls.length, 0)
  }
  await assert.rejects(unauthorized.run({ types: ['invalid'] }), error => error.code === 'invalid-argument')
  assert.equal(unauthorized.calls.length, 0)
})
