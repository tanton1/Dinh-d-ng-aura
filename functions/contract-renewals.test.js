const test = require('node:test')
const assert = require('node:assert/strict')
const { addMonthsDateKey, normalizeInstallments, renewalRisk, latestContractsByStudent } = require('./contract-renewals')

test('renewal calendar uses real months and clamps month-end dates', () => {
  assert.equal(addMonthsDateKey('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonthsDateKey('2024-01-31', 1), '2024-02-29')
  assert.equal(addMonthsDateKey('2026-11-30', 3), '2027-02-28')
})

test('renewal risk prioritises exhausted, expired and near-expiry contracts', () => {
  assert.equal(renewalRisk({ endDate: '2026-09-30', totalSessions: 10, usedSessions: 10 }, '2026-08-24').category, 'exhausted')
  assert.equal(renewalRisk({ endDate: '2026-08-20', totalSessions: 10, usedSessions: 5 }, '2026-08-24').category, 'expired')
  assert.equal(renewalRisk({ endDate: '2026-08-30', totalSessions: 10, usedSessions: 5 }, '2026-08-24').category, 'critical')
  assert.equal(renewalRisk({ endDate: '2026-09-15', totalSessions: 10, usedSessions: 5 }, '2026-08-24').category, 'upcoming')
})

test('installment schedule must exactly match remaining contract balance', () => {
  const result = normalizeInstallments([
    { id: 'a', date: '2026-09-01', amount: 400_000 },
    { id: 'b', date: '2026-10-01', amount: 600_000 },
  ], 1_000_000, '2026-08-25', '2026-11-25')
  assert.equal(result.length, 2)
  assert.throws(() => normalizeInstallments([{ date: '2026-09-01', amount: 900_000 }], 1_000_000, '2026-08-25', '2026-11-25'), /không khớp/)
})

test('pipeline keeps only the latest non-cancelled contract per student', () => {
  const latest = latestContractsByStudent([
    { id: 'old', studentId: 's1', endDate: '2026-08-01', status: 'expired' },
    { id: 'new', studentId: 's1', endDate: '2026-12-01', status: 'active' },
    { id: 'cancelled', studentId: 's2', endDate: '2027-01-01', status: 'cancelled' },
  ])
  assert.equal(latest.get('s1').id, 'new')
  assert.equal(latest.has('s2'), false)
})
