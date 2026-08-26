import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOperationsDashboardData } from '../src/utils/operationsDashboardNormalization'

test('dashboard accepts the previous callable schema during a rolling deployment', () => {
  const dashboard = normalizeOperationsDashboardData({
    schemaVersion: 1,
    branchId: 'all',
    range: { startAt: '2026-08-01', endAt: '2026-08-26', timeZone: 'Asia/Ho_Chi_Minh' },
    finance: { cashCollected: 125_000_000, receivables: 18_000_000 },
    clients: { total: 296, active: 280, newInRange: 12, activeContracts: 250 },
    operations: {
      sessions: 100,
      attendanceEvents: 72,
      sessionStatus: { completed: 68, attended: 4 },
      activeTrainers: 9,
      activeStaff: 10,
      branches: 2,
    },
    quality: { completeness: 'complete', canonicalFinanceSource: 'ledgerEntries' },
    generatedAt: '2026-08-26T08:00:00.000Z',
  })

  assert.equal(dashboard.schemaVersion, 2)
  assert.equal(dashboard.finance.cashCollected, 125_000_000)
  assert.equal(dashboard.clients.active, 280)
  assert.equal(dashboard.operations.completionRate, 72)
  assert.equal(dashboard.permissions.finance, true)
  assert.equal(dashboard.permissions.clients, true)
  assert.equal(dashboard.actionSummary.dueRenewals.available, false)
  assert.equal(dashboard.quality.completeness, 'partial')
  assert.deepEqual(dashboard.cache, { hit: false, ttlSeconds: 0 })
})

test('dashboard normalizes malformed numeric fields instead of rendering NaN', () => {
  const dashboard = normalizeOperationsDashboardData({
    schemaVersion: 2,
    finance: { cashCollected: 'invalid', receivables: '250000' },
    clients: { active: '12' },
    operations: { sessions: '0', completionRate: 'invalid', sessionStatus: null },
    actionSummary: {
      overdueReceivables: { available: true, actionCount: '3', amount: '4500000' },
    },
  })

  assert.equal(dashboard.finance.cashCollected, 0)
  assert.equal(dashboard.finance.receivables, 250_000)
  assert.equal(dashboard.clients.active, 12)
  assert.equal(dashboard.operations.completionRate, 0)
  assert.equal(dashboard.actionSummary.overdueReceivables.actionCount, 3)
  assert.equal(dashboard.actionSummary.overdueReceivables.amount, 4_500_000)
})
