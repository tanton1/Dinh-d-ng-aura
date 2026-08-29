'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { contribution, contributionDeltas } = require('./operations-dashboard-aggregates')

test('ledger aggregate separates cash collection and recognised revenue', () => {
  const payment = contribution('ledger', {
    status: 'posted', type: 'payment', amount: 1_000_000,
    effectiveAt: '2026-08-29T10:00:00+07:00', branchId: 'branch-1',
  })
  const revenue = contribution('ledger', {
    status: 'posted', type: 'revenue_recognition', amount: 350_000,
    effectiveAt: '2026-08-29T11:00:00+07:00', branchId: 'branch-1',
  })
  assert.equal(payment.metrics.cashCollected, 1_000_000)
  assert.equal(payment.metrics.netCash, 1_000_000)
  assert.equal(payment.metrics.recognizedRevenue, 0)
  assert.equal(revenue.metrics.netCash, 0)
  assert.equal(revenue.metrics.recognizedRevenue, 350_000)
})

test('session aggregate tracks status, confirmations and no-shows', () => {
  const item = contribution('session', {
    status: 'no_show', date: '2026-08-29', branchId: 'branch-1',
  })
  assert.deepEqual(item.metrics, {
    sessions: 1,
    confirmedSessions: 1,
    noShowSessions: 1,
    sessionStatus__no_show: 1,
  })
})

test('moving a source document subtracts its old daily bucket and adds the new bucket', () => {
  const before = contribution('student', { joinDate: '2026-08-28', branchId: 'branch-1' })
  const after = contribution('student', { joinDate: '2026-08-29', branchId: 'branch-2' })
  assert.deepEqual(contributionDeltas(before, after), [
    { date: '2026-08-28', branchId: 'branch-1', metrics: { newStudents: -1 } },
    { date: '2026-08-29', branchId: 'branch-2', metrics: { newStudents: 1 } },
  ])
})

test('cancelled contracts are removed from contract sales aggregates', () => {
  const before = contribution('contract', {
    status: 'active', totalPrice: 10_000_000, discount: 1_000_000,
    signedAt: '2026-08-20T09:00:00+07:00', branchId: 'branch-1',
  })
  const after = contribution('contract', {
    status: 'cancelled', totalPrice: 10_000_000, discount: 1_000_000,
    signedAt: '2026-08-20T09:00:00+07:00', branchId: 'branch-1',
  })
  assert.equal(after, null)
  assert.deepEqual(contributionDeltas(before, after)[0].metrics, { contractSales: -9_000_000 })
})
