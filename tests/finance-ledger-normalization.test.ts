import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeFinanceLedgerSummary } from '../src/utils/financeLedgerNormalization'

test('finance summary never exposes NaN when a rolling callable revision omits new fields', () => {
  const summary = normalizeFinanceLedgerSummary({
    collectedAmount: 1_000_000,
    refundedAmount: 100_000,
    reversedAmount: 50_000,
    recognisedRevenue: undefined,
    cashNet: undefined,
    dailySeries: [{ date: '2026-08-25', total: '850000' }],
  })

  assert.equal(summary.cashIn, 1_000_000)
  assert.equal(summary.cashOut, 150_000)
  assert.equal(summary.cashNet, 850_000)
  assert.equal(summary.recognisedRevenue, 0)
  assert.equal(summary.operatingResult, 0)
  assert.deepEqual(summary.dailySeries, [{ date: '2026-08-25', total: 850_000 }])
  Object.entries(summary).forEach(([key, value]) => {
    if (typeof value === 'number') assert.equal(Number.isFinite(value), true, key)
  })
})

test('finance summary normalises numeric strings and rejects invalid numeric values', () => {
  const summary = normalizeFinanceLedgerSummary({
    collectedAmount: '125000',
    cashIn: '125000',
    cashOut: '25000',
    cashNet: '100000',
    recognisedRevenue: '80000',
    operatingExpense: '20000',
    operatingResult: 'invalid',
    transactionCount: '4',
  })

  assert.equal(summary.cashNet, 100_000)
  assert.equal(summary.recognisedRevenue, 80_000)
  assert.equal(summary.operatingResult, 60_000)
  assert.equal(summary.transactionCount, 4)
})
