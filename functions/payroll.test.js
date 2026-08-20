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
