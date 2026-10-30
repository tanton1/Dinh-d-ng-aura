'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { ledgerReceiptImpact } = require('./finance-receipt-impact')

test('net receipts exclude expense and payroll cash, including their reversals and corrections', () => {
  for (const row of [
    { type: 'expense', source: 'accounting', eventClass: 'expense_voucher', cashImpact: -500, expenseImpact: 500 },
    { type: 'reversal', source: 'accounting', eventClass: 'expense_voucher_reversal', cashImpact: 500, expenseImpact: -500 },
    { type: 'reversal', source: 'accounting', cashImpact: 500, expenseImpact: 0 },
    { type: 'reversal', eventClass: 'expense_voucher_reversal', cashImpact: 500, expenseImpact: 0 },
    { type: 'adjustment', cashImpact: 500, expenseImpact: -500 },
    { type: 'payroll', source: 'payroll', eventClass: 'payroll_accrual', cashImpact: 0, expenseImpact: 500 },
    { type: 'payroll', source: 'payroll', eventClass: 'payroll_payment', cashImpact: -500 },
    { type: 'reversal', source: 'payroll', cashImpact: 500 },
    { type: 'adjustment', eventClass: 'payroll_payment_reversal', cashImpact: 500 },
  ]) assert.equal(ledgerReceiptImpact(row), 0, JSON.stringify(row))
})

test('net receipts preserve legacy customer postings, canonical cash impacts and manual other receipts', () => {
  for (const [row, expected] of [
    [{ type: 'payment', amount: 500 }, 500],
    [{ type: 'refund', amount: -100 }, -100],
    [{ type: 'reversal', amount: -200 }, -200],
    [{ type: 'adjustment', amount: 50 }, 50],
    [{ type: 'adjustment', amount: -50 }, -50],
    [{ type: 'payment', source: 'pt_gym', eventClass: 'cash_collection', amount: 500, cashImpact: 400, expenseImpact: 0 }, 400],
    [{ type: 'payment', source: 'other', eventClass: 'manual_cash_receipt', cashImpact: 500 }, 500],
    [{ type: 'reversal', source: 'other', eventClass: 'manual_cash_receipt_reversal', cashImpact: -500 }, -500],
    [{ type: 'payment', amount: 500, cashImpact: 0 }, 0],
    [{ type: 'revenue_recognition', amount: 500, revenueImpact: 500 }, 0],
  ]) assert.equal(ledgerReceiptImpact(row), expected, JSON.stringify(row))
})
