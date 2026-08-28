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

  assert.equal(dashboard.schemaVersion, 6)
  assert.equal(dashboard.finance.cashCollected, 125_000_000)
  assert.equal(dashboard.clients.active, 280)
  assert.equal(dashboard.operations.completionRate, 72)
  assert.equal(dashboard.permissions.finance, true)
  assert.equal(dashboard.permissions.clients, true)
  assert.equal(dashboard.actionSummary.dueRenewals.available, false)
  assert.equal(dashboard.quality.completeness, 'partial')
  assert.deepEqual(dashboard.cache, { hit: false, ttlSeconds: 0 })
  assert.deepEqual(dashboard.analytics.revenue.points, [])
  assert.equal(dashboard.analytics.packages.totalActive, 0)
  assert.equal(dashboard.analytics.off.rate, 0)
})

test('dashboard bounds chart payloads and preserves signed canonical cash values', () => {
  const dashboard = normalizeOperationsDashboardData({
    schemaVersion: 5,
    finance: { cashCollected: 700000, refunds: 750000, recognizedRevenue: 420000, netCash: 999999999, frozenReceivables: 125000 },
    analytics: {
      revenue: { granularity: 'week', points: [{ key: '2026-08-24', label: '24/08', contractSales: '1000000', recognizedRevenue: 420000, grossCash: 700000, netCash: -50000 }] },
      packages: { totalActive: 2, preservedContracts: 1, items: [{ id: 'p1', name: 'PT 3 tháng', count: 2, percent: 100 }] },
      off: { activeContracts: 2, approvedContracts: 1, activeWithoutOff: 1, approvedRequests: 1, pendingRequests: 2, preservationRequests: 0, preservedContracts: 1, rate: 50 },
    },
  })
  assert.equal(dashboard.analytics.revenue.granularity, 'week')
  assert.equal(dashboard.analytics.revenue.points[0].netCash, -50000)
  assert.equal(dashboard.finance.netCash, -50000)
  assert.equal(dashboard.finance.recognizedRevenue, 420000)
  assert.equal(dashboard.finance.frozenReceivables, 125000)
  assert.equal(dashboard.analytics.revenue.points[0].recognizedRevenue, 420000)
  assert.equal(dashboard.analytics.packages.preservedContracts, 1)
  assert.equal(dashboard.analytics.packages.items[0].percent, 100)
  assert.equal(dashboard.analytics.off.rate, 50)
})

test('dashboard normalizes contract health and branch filters', () => {
  const dashboard = normalizeOperationsDashboardData({
    schemaVersion: 5,
    clients: { activeContracts: 160, preservedContracts: 11, exhaustedContracts: 14, expiringSoonContracts: 28 },
    filters: { branches: [{ id: 'b1', name: 'Cơ sở 1' }, { id: '', name: 'Không hợp lệ' }] },
  })
  assert.equal(dashboard.clients.activeContracts, 160)
  assert.equal(dashboard.clients.preservedContracts, 11)
  assert.equal(dashboard.clients.exhaustedContracts, 14)
  assert.equal(dashboard.clients.expiringSoonContracts, 28)
  assert.deepEqual(dashboard.filters.branches, [{ id: 'b1', name: 'Cơ sở 1' }])
})

test('dashboard rejects a rolling response that adds recognised revenue to net receipts', () => {
  const dashboard = normalizeOperationsDashboardData({
    schemaVersion: 3,
    finance: { cashCollected: 274_750_000, refunds: 0, reversals: 0, adjustments: 0, netCash: 493_910_415 },
    analytics: {
      revenue: { granularity: 'day', points: [{ key: '2026-08-27', label: '27/08', contractSales: 0, grossCash: 274_750_000, netCash: 493_910_415 }] },
    },
  })
  assert.equal(dashboard.finance.netCash, 274_750_000)
  assert.equal(dashboard.analytics.revenue.points[0].netCash, 274_750_000)
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

test('dashboard bounds and normalizes attendance and receivable tables', () => {
  const dashboard = normalizeOperationsDashboardData({
    schemaVersion: 6,
    today: {
      rows: [{ id: 's1', hour: 8, studentName: 'Lan', trainerName: 'PT Mai', attendanceStatus: 'late', billingStatus: 'charged' }],
    },
    receivables: {
      summary: { overdue: { count: 2, amount: 3_000_000 }, dueThisWeek: { count: 1, amount: 1_000_000 }, dueThisMonth: { count: 4, amount: 7_000_000 } },
      rows: [{ id: 'c1:i1', contractId: 'c1', studentName: 'Lan', dueDate: '2026-08-20', amount: 3_000_000, status: 'overdue' }],
    },
  })
  assert.equal(dashboard.today.rows[0].hour, 8)
  assert.equal(dashboard.today.rows[0].attendanceStatus, 'late')
  assert.equal(dashboard.receivables.summary.overdue.amount, 3_000_000)
  assert.equal(dashboard.receivables.rows[0].status, 'overdue')
})
