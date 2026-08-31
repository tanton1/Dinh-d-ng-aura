'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const {
  contractAdvanceAccountCode,
  normalizeLedgerListInput,
  receiptVoucherNumber,
  summarizeLedgerDocuments,
  updatedInstallments,
} = require('./finance-ledger')

const repositoryRoot = join(__dirname, '..')
const reportSource = readFileSync(join(repositoryRoot, 'src', 'components', 'admin', 'pt', 'AdminReportDashboard.tsx'), 'utf8')
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
  assert.match(financeSource, /function amountDueInRange/)
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
  assert.match(ledgerSource, /const cashAccountId = text\(request\.data\?\.cashAccountId, 'Tài khoản quỹ', 200\)/)
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
