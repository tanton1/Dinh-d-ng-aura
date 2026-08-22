const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { periodBounds } = require('./payroll')

test('payroll period uses Asia/Ho_Chi_Minh calendar boundaries', () => {
  const bounds = periodBounds('2026-08')

  assert.equal(bounds.start.toDate().toISOString(), '2026-07-31T17:00:00.000Z')
  assert.equal(bounds.end.toDate().toISOString(), '2026-08-31T17:00:00.000Z')
})

test('payroll December period rolls over to the next year', () => {
  const bounds = periodBounds('2026-12')

  assert.equal(bounds.start.toDate().toISOString(), '2026-11-30T17:00:00.000Z')
  assert.equal(bounds.end.toDate().toISOString(), '2026-12-31T17:00:00.000Z')
})

test('payroll creation is one deterministic transaction per period', () => {
  const source = fs.readFileSync(path.join(__dirname, 'payroll.js'), 'utf8')
  const createBlock = source.match(/const createPayrollRun[\s\S]*?\n  async function transition/)?.[0] || ''

  assert.match(createBlock, /db\.doc\(`payrollRuns\/\$\{periodId\}`\)/)
  assert.match(createBlock, /db\.runTransaction/)
  assert.match(createBlock, /transaction\.create\(runReference/)
  assert.match(createBlock, /payrollRunItems\/\$\{periodId\}_\$\{trainerId\}/)
  assert.doesNotMatch(createBlock, /db\.collection\('payrollRuns'\)\.doc\(\)/)
})

test('locking a payroll run records an immutable management expense', () => {
  const source = fs.readFileSync(path.join(__dirname, 'payroll.js'), 'utf8')
  const lockBlock = source.match(/const lockPayrollRun[\s\S]*?\n  const markPayrollRunPaid/)?.[0] || ''
  assert.match(lockBlock, /ledgerEntries\/payroll_\$\{runId\}/)
  assert.match(lockBlock, /type: 'payroll'/)
  assert.match(lockBlock, /eventClass: 'payroll_accrual'/)
  assert.match(lockBlock, /expenseImpact: finalAmount/)
  assert.match(lockBlock, /cashImpact: 0/)
  assert.match(lockBlock, /db\.runTransaction/)
})

test('payroll payout creates the cash-book and ledger entries atomically', () => {
  const source = fs.readFileSync(path.join(__dirname, 'payroll.js'), 'utf8')
  const payoutStart = source.indexOf('const markPayrollRunPaid = onCall')
  const payoutEnd = source.indexOf('return { listPayrollRuns', payoutStart)
  const payoutBlock = payoutStart >= 0 && payoutEnd > payoutStart
    ? source.slice(payoutStart, payoutEnd)
    : ''

  assert.match(payoutBlock, /ledgerEntries\/payroll_payment_\$\{runId\}/)
  assert.match(payoutBlock, /cashTransactions\/payroll_\$\{runId\}/)
  assert.match(payoutBlock, /cashAccounts\/\$\{cashAccountId\}/)
  assert.match(payoutBlock, /eventClass: 'payroll_payment'/)
  assert.match(payoutBlock, /cashImpact: -finalAmount/)
  assert.match(payoutBlock, /expenseImpact: 0/)
  assert.match(payoutBlock, /FieldValue\.increment\(-finalAmount\)/)
  assert.match(payoutBlock, /status !== 'locked'/)
  assert.match(payoutBlock, /db\.runTransaction/)
})
