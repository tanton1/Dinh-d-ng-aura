'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  expenseVoucherJournal,
  contractPaymentJournal,
  serviceRevenueJournal,
  payrollAccrualJournal,
  payrollPaymentJournal,
  manualReceiptJournal,
  reversedJournalLines,
  amountInVietnameseWords,
} = require('./accounting-core')

test('expense voucher posts net expense, deductible VAT and cash as a balanced journal', () => {
  const journal = expenseVoucherJournal({ purposeCode: 'utilities', amountBeforeTax: 1_000_000, vatAmount: 100_000, cashAccountType: 'bank' })
  assert.equal(journal.totalDebit, 1_100_000)
  assert.equal(journal.totalCredit, 1_100_000)
  assert.deepEqual(journal.lines.map((item) => [item.accountCode, item.debit, item.credit]), [
    ['6427', 1_000_000, 0],
    ['1331', 100_000, 0],
    ['1121', 0, 1_100_000],
  ])
  assert.equal(journal.expenseImpact, 1_000_000)
})

test('supplier payment settles payable without recording operating expense twice', () => {
  const journal = expenseVoucherJournal({ purposeCode: 'supplier_payment', amountBeforeTax: 3_000_000, cashAccountType: 'cash' })
  assert.equal(journal.expenseImpact, 0)
  assert.deepEqual(journal.lines.map((item) => item.accountCode), ['331', '1111'])
})

test('contract collection and completed PT service remain separate balanced journals', () => {
  const collection = contractPaymentJournal({ amount: 10_000_000, cashAccountType: 'bank', recognisedReceivable: 2_000_000, advanceAccountCode: '3387' })
  assert.deepEqual(collection.lines.map((item) => [item.accountCode, item.debit, item.credit]), [
    ['1121', 10_000_000, 0],
    ['131', 0, 2_000_000],
    ['3387', 0, 8_000_000],
  ])
  const revenue = serviceRevenueJournal({ amount: 500_000, paidAllocation: 500_000, advanceAccountCode: '3387' })
  assert.deepEqual(revenue.lines.map((item) => [item.accountCode, item.debit, item.credit]), [
    ['3387', 500_000, 0],
    ['5113', 0, 500_000],
  ])
})

test('reversal swaps every debit and credit without mutating the original', () => {
  const original = expenseVoucherJournal({ purposeCode: 'administration', amountBeforeTax: 400_000, cashAccountType: 'wallet' })
  const reversed = reversedJournalLines(original.lines)
  assert.equal(reversed[0].credit, 400_000)
  assert.equal(reversed[1].debit, 400_000)
  assert.equal(original.lines[0].debit, 400_000)
})

test('Vietnamese amount words are stored with the accounting voucher', () => {
  assert.equal(amountInVietnameseWords(1_105_000), 'Một triệu một trăm lẻ năm nghìn đồng')
  assert.equal(amountInVietnameseWords(0), 'Không đồng')
})

test('payroll accrual and payment settle account 334 without recording expense twice', () => {
  const accrual = payrollAccrualJournal({ amount: 12_000_000 })
  const payment = payrollPaymentJournal({ amount: 12_000_000, cashAccountType: 'bank' })
  assert.equal(accrual.lines.find((item) => item.accountCode === '6421').debit, 12_000_000)
  assert.equal(accrual.lines.find((item) => item.accountCode === '334').credit, 12_000_000)
  assert.equal(payment.lines.find((item) => item.accountCode === '334').debit, 12_000_000)
  assert.equal(payment.lines.find((item) => item.accountCode === '1121').credit, 12_000_000)
})

test('manual receipts distinguish cash inflow from revenue', () => {
  const capital = manualReceiptJournal({ purposeCode: 'owner_contribution', amount: 20_000_000, cashAccountType: 'bank' })
  assert.deepEqual(capital.lines.map((item) => [item.accountCode, item.debit, item.credit]), [
    ['1121', 20_000_000, 0],
    ['4111', 0, 20_000_000],
  ])
  assert.equal(capital.revenueImpact, 0)
  const otherIncome = manualReceiptJournal({ purposeCode: 'other_income', amount: 500_000, cashAccountType: 'cash' })
  assert.equal(otherIncome.lines.find((item) => item.accountCode === '711').credit, 500_000)
  assert.equal(otherIncome.revenueImpact, 500_000)
})
