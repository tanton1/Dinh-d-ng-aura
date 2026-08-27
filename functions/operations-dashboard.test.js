'use strict'
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const { dashboardAnalytics, dashboardBranchScope, isEffectiveContract, isExhaustedContract, isExpiringContract, isPreservedContract, ledgerReceiptImpact, ledgerRevenueImpact, renewalCaseMatches, summarizeReceivables } = require('./operations-dashboard')
const source = readFileSync(join(__dirname, 'operations-dashboard.js'), 'utf8')
const dashboard = readFileSync(join(__dirname, '..', 'src', 'pages', 'admin', 'AdminDashboard.tsx'), 'utf8')

test('operations dashboard separates contract sales from canonical cash collection', () => {
  assert.match(source, /contractSales/)
  assert.match(source, /cashCollected/)
  assert.match(source, /collection\('ledgerEntries'\)/)
  assert.doesNotMatch(source, /collection\('payments'\)/)
  assert.match(dashboard, /Thực thu gộp/)
  assert.match(dashboard, /Thực thu ròng/)
  assert.match(dashboard, /Tổng công nợ/)
})

test('dashboard and attendance queries are bounded and capability protected', () => {
  assert.match(source, /requireCapability\(actor, 'dashboard\.view'\)/)
  assert.match(source, /requireCapability\(actor, 'payroll\.operations\.manage'\)/)
  assert.match(source, /MAX_SCANNED_DOCUMENTS/)
  assert.match(source, /collection\('attendanceEvents'\)/)
  assert.match(source, /\.count\(\)\.get\(\)/)
  assert.match(source, /DASHBOARD_CACHE_TTL_MS/)
  assert.match(source, /schemaVersion: 5/)
  assert.match(source, /actionSummary/)
  assert.match(source, /analytics/)
})

test('effective contracts require an active date window and remaining sessions', () => {
  assert.equal(isEffectiveContract({ status: 'active', startDate: '2026-08-01', endDate: '2026-09-30', totalSessions: 36, usedSessions: 12 }, '2026-08-27'), true)
  assert.equal(isEffectiveContract({ status: 'active', startDate: '2026-09-01', endDate: '2026-12-01', totalSessions: 36, usedSessions: 0 }, '2026-08-27'), false)
  assert.equal(isEffectiveContract({ status: 'active', startDate: '2026-01-01', endDate: '2026-08-20', totalSessions: 36, usedSessions: 12 }, '2026-08-27'), false)
  assert.equal(isEffectiveContract({ status: 'active', startDate: '2026-01-01', endDate: '2026-12-01', totalSessions: 36, usedSessions: 36 }, '2026-08-27'), false)
  assert.equal(isEffectiveContract({ status: 'cancelled', startDate: '2026-01-01', endDate: '2026-12-01', totalSessions: 36, usedSessions: 1 }, '2026-08-27'), false)
  assert.equal(isEffectiveContract({ status: 'frozen', startDate: '2026-01-01', endDate: '2026-12-01', totalSessions: 36, usedSessions: 1 }, '2026-08-27'), false)
  assert.equal(isPreservedContract({ status: 'frozen', startDate: '2026-01-01', endDate: '2026-12-01', totalSessions: 36, usedSessions: 1 }, '2026-08-27'), true)
  const preservation = { status: 'active', startDate: '2026-01-01', endDate: '2026-12-01', totalSessions: 36, usedSessions: 1, pausePeriods: [{ type: 'preservation', startDate: '2026-08-20', endDate: '2026-09-05' }] }
  assert.equal(isEffectiveContract(preservation, '2026-08-27'), false)
  assert.equal(isPreservedContract(preservation, '2026-08-27'), true)
  assert.equal(isExhaustedContract({ status: 'active', startDate: '2026-01-01', endDate: '2026-12-01', totalSessions: 36, usedSessions: 36 }, '2026-08-27'), true)
  assert.equal(isExpiringContract({ status: 'active', startDate: '2026-01-01', endDate: '2026-09-10', totalSessions: 36, usedSessions: 10 }, '2026-08-27'), true)
  assert.equal(isExpiringContract({ status: 'active', startDate: '2026-01-01', endDate: '2026-11-10', totalSessions: 36, usedSessions: 10 }, '2026-08-27'), false)
})

test('net receipts exclude recognised revenue and operating expenses', () => {
  assert.equal(ledgerReceiptImpact({ type: 'payment', amount: 1_000_000 }), 1_000_000)
  assert.equal(ledgerReceiptImpact({ type: 'payment', amount: 1_000_000, cashImpact: 900_000 }), 900_000)
  assert.equal(ledgerReceiptImpact({ type: 'revenue_recognition', amount: 7_000_000 }), 0)
  assert.equal(ledgerReceiptImpact({ type: 'expense', amount: -500_000, cashImpact: -500_000 }), 0)
  assert.equal(ledgerRevenueImpact({ type: 'revenue_recognition', amount: 7_000_000 }), 7_000_000)
  assert.equal(ledgerRevenueImpact({ type: 'payment', amount: 7_000_000, revenueImpact: 0 }), 0)
})

test('dashboard analytics separates gross and net cash and calculates package and OFF ratios', () => {
  const analytics = dashboardAnalytics({
    start: new Date('2026-08-01T00:00:00+07:00'),
    end: new Date('2026-08-31T23:59:59+07:00'),
    referenceDate: '2026-08-27',
    ledgerValues: [
      { type: 'payment', amount: 1_000_000, effectiveAt: '2026-08-10T10:00:00+07:00' },
      { type: 'refund', amount: -200_000, effectiveAt: '2026-08-10T11:00:00+07:00' },
      { type: 'revenue_recognition', amount: 4_000_000, effectiveAt: '2026-08-10T12:00:00+07:00' },
      { type: 'expense', amount: -300_000, cashImpact: -300_000, effectiveAt: '2026-08-10T13:00:00+07:00' },
    ],
    contractValues: [
      { id: 'c1', status: 'active', startDate: '2026-08-01', endDate: '2026-11-01', totalSessions: 36, usedSessions: 5, packageId: 'p1', packageName: 'PT 3 tháng', totalPrice: 5_000_000, createdAt: '2026-08-02T09:00:00+07:00' },
      { id: 'c2', status: 'active', startDate: '2026-08-01', endDate: '2026-11-01', totalSessions: 36, usedSessions: 36, packageId: 'p1', packageName: 'PT 3 tháng', totalPrice: 5_000_000, createdAt: '2026-08-03T09:00:00+07:00' },
      { id: 'c3', status: 'frozen', startDate: '2026-08-01', endDate: '2026-11-01', totalSessions: 36, usedSessions: 10, packageId: 'p1', packageName: 'PT 3 tháng', totalPrice: 5_000_000, createdAt: '2026-08-03T09:00:00+07:00' },
    ],
    offValues: [{ contractId: 'c1', type: 'off', status: 'approved', startDate: '2026-08-20' }],
  })
  assert.equal(analytics.revenue.points.reduce((total, item) => total + item.grossCash, 0), 1_000_000)
  assert.equal(analytics.revenue.points.reduce((total, item) => total + item.netCash, 0), 800_000)
  assert.equal(analytics.revenue.points.reduce((total, item) => total + item.recognizedRevenue, 0), 4_000_000)
  assert.equal(analytics.packages.totalActive, 1)
  assert.equal(analytics.packages.preservedContracts, 1)
  assert.equal(analytics.packages.items[0].percent, 100)
  assert.equal(analytics.off.rate, 100)
  assert.equal(analytics.off.preservedContracts, 1)
})

test('receivable actions count overdue and due-today contracts without duplicating debt', () => {
  const summary = summarizeReceivables([
    { totalPrice: 1_000_000, paidAmount: 800_000, installments: [{ status: 'pending', date: '2026-08-25', amount: 200_000 }] },
    { totalPrice: 2_000_000, paidAmount: 1_700_000, installments: [{ status: 'pending', date: '2026-08-26', amount: 300_000 }] },
    { totalPrice: 500_000, paidAmount: 0, nextPaymentDate: '2026-09-01' },
    { totalPrice: 900_000, paidAmount: 0, nextPaymentDate: '2026-08-20', status: 'frozen' },
    { totalPrice: 2_000_000, paidAmount: 0, nextPaymentDate: '2026-08-20', status: 'cancelled' },
  ], '2026-08-26')
  assert.equal(summary.totalCount, 4)
  assert.equal(summary.actionCount, 2)
  assert.equal(summary.overdueCount, 1)
  assert.equal(summary.dueTodayCount, 1)
  assert.equal(summary.warningCount, 2)
  assert.equal(summary.amount, 500_000)
})

test('staff dashboard scope fails closed for branch data but keeps explicitly assigned renewal cases', () => {
  const actor = {
    uid: 'staff-1', legacyStaffId: 'trainer-1', accessRole: 'staff', branchIds: [],
    capabilities: ['dashboard.view', 'renewals.workspace.view', 'renewals.case.assigned_student.support'],
  }
  const scope = dashboardBranchScope(actor, 'all')
  assert.equal(scope.unrestricted, false)
  assert.deepEqual(scope.branchIds, [])
  assert.equal(renewalCaseMatches({ active: true, branchId: 'branch-1', contractSnapshot: { trainerIds: ['trainer-1'] } }, actor, scope), true)
  assert.equal(renewalCaseMatches({ active: true, branchId: 'branch-1', contractSnapshot: { trainerIds: ['trainer-2'] } }, actor, scope), false)
})

test('dashboard UI is one action-first page without legacy dashboard tabs', () => {
  assert.match(dashboard, /Hôm nay cần làm/)
  assert.match(dashboard, /Vận hành hiện tại/)
  assert.match(dashboard, /Đã tính buổi/)
  assert.match(dashboard, /Có tập/)
  assert.match(dashboard, /Đi trễ/)
  assert.match(dashboard, /Không đến/)
  assert.match(dashboard, /Chờ PT/)
  assert.match(dashboard, /Xem lịch sử tập/)
  assert.match(dashboard, /DOANH THU & DÒNG TIỀN/)
  assert.match(dashboard, /Doanh thu thực hiện/)
  assert.match(dashboard, /CƠ CẤU GÓI TẬP/)
  assert.match(dashboard, /TỶ LỆ OFF/)
  assert.match(dashboard, /Đang bảo lưu/)
  assert.match(dashboard, /không ở trong thời gian bảo lưu/)
  assert.match(dashboard, /allowAll=\{false\}/)
  assert.match(dashboard, /actions\.slice\(0, 4\)/)
  assert.match(dashboard, /item\.metric\.available \|\| data\.scope\.unrestricted/)
  assert.match(dashboard, /Các việc cần xử lý/)
  assert.match(dashboard, /Tổng quan không hiển thị trạng thái “ổn định” khi dữ liệu chưa tải thành công/)
  assert.doesNotMatch(dashboard, /activeTab/)
  assert.doesNotMatch(dashboard, /admin-operations-tabs/)
})
