'use strict'
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const source = readFileSync(join(__dirname, 'cashbook.js'), 'utf8')
const rules = readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8')

test('cashbook opening, expense and transfer are idempotent transactions', () => {
  assert.match(source, /initializeCashAccount/)
  assert.match(source, /recordCashExpense/)
  assert.match(source, /transferCash/)
  assert.match(source, /db\.runTransaction/g)
  assert.match(source, /current|duplicate/)
  assert.match(source, /FieldValue\.increment\(-expenseAmount\)/)
})

test('cashbook direct browser access remains fail closed', () => {
  assert.match(rules, /match \/cashAccounts\/\{accountId\}[\s\S]*?allow read, write: if false/)
  assert.match(rules, /match \/cashTransactions\/\{transactionId\}[\s\S]*?allow read, write: if false/)
})
