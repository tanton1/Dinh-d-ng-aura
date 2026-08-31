'use strict'
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const source = readFileSync(join(__dirname, 'cashbook.js'), 'utf8')
const rules = readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8')

test('cashbook opening and transfer are idempotent transactions while quick expense is fail closed', () => {
  assert.match(source, /initializeCashAccount/)
  assert.match(source, /recordCashExpense/)
  assert.match(source, /transferCash/)
  assert.match(source, /db\.runTransaction/g)
  assert.match(source, /current|duplicate/)
  assert.match(source, /Ghi chi nhanh đã ngừng sử dụng/)
})

test('cashbook direct browser access remains fail closed', () => {
  assert.match(rules, /match \/cashAccounts\/\{accountId\}[\s\S]*?allow read, write: if false/)
  assert.match(rules, /match \/cashTransactions\/\{transactionId\}[\s\S]*?allow read, write: if false/)
  assert.match(rules, /match \/accountingDocuments\/\{documentId\}[\s\S]*?allow read, write: if false/)
  assert.match(rules, /match \/journalEntries\/\{entryId\}[\s\S]*?allow read, write: if false/)
  assert.match(rules, /match \/revenueRecognitionReviews\/\{reviewId\}[\s\S]*?allow read, write: if false/)
})

test('expense vouchers have an immutable approval, posting and reversal workflow', () => {
  assert.match(source, /saveExpenseVoucherDraft/)
  assert.match(source, /approveAndPostExpenseVoucher/)
  assert.match(source, /reverseExpenseVoucher/)
  assert.match(source, /status !== 'pending_approval'/)
  assert.match(source, /accountingDocuments\//)
  assert.match(source, /journalEntries\//)
  assert.match(source, /ledgerEntries\/expense_voucher_/)
  assert.match(source, /cashTransactions\/expense_voucher_/)
  assert.match(source, /assertFinancePeriodOpen/)
  assert.match(source, /status: 'reversed'/)
})

test('receipt vouchers are read through a bounded callable and remain backend owned', () => {
  assert.match(source, /const listReceiptVouchers = onCall/)
  assert.match(source, /\['receipt_voucher', 'receipt_voucher_reversal'\]/)
  assert.match(source, /scanLimit = Math\.min\(500, pageSize \* 5\)/)
  assert.match(source, /serializeReceiptVoucher/)
  assert.match(source, /derived: true/)
  assert.match(rules, /match \/accountingDocuments\/\{documentId\}[\s\S]*?allow read, write: if false/)
})
