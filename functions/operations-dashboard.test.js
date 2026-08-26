'use strict'
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const { dashboardBranchScope, renewalCaseMatches, summarizeReceivables } = require('./operations-dashboard')
const source = readFileSync(join(__dirname, 'operations-dashboard.js'), 'utf8')
const dashboard = readFileSync(join(__dirname, '..', 'src', 'pages', 'admin', 'AdminDashboard.tsx'), 'utf8')

test('operations dashboard separates contract sales from canonical cash collection', () => {
  assert.match(source, /contractSales/)
  assert.match(source, /cashCollected/)
  assert.match(source, /collection\('ledgerEntries'\)/)
  assert.doesNotMatch(source, /collection\('payments'\)/)
  assert.match(dashboard, /Thực thu tháng/)
  assert.match(dashboard, /Tổng công nợ/)
})

test('dashboard and attendance queries are bounded and capability protected', () => {
  assert.match(source, /requireCapability\(actor, 'dashboard\.view'\)/)
  assert.match(source, /requireCapability\(actor, 'payroll\.operations\.manage'\)/)
  assert.match(source, /MAX_SCANNED_DOCUMENTS/)
  assert.match(source, /collection\('attendanceEvents'\)/)
  assert.match(source, /\.count\(\)\.get\(\)/)
  assert.match(source, /DASHBOARD_CACHE_TTL_MS/)
  assert.match(source, /schemaVersion: 2/)
  assert.match(source, /actionSummary/)
})

test('receivable actions count overdue and due-today contracts without duplicating debt', () => {
  const summary = summarizeReceivables([
    { totalPrice: 1_000_000, paidAmount: 800_000, installments: [{ status: 'pending', date: '2026-08-25', amount: 200_000 }] },
    { totalPrice: 2_000_000, paidAmount: 1_700_000, installments: [{ status: 'pending', date: '2026-08-26', amount: 300_000 }] },
    { totalPrice: 500_000, paidAmount: 0, nextPaymentDate: '2026-09-01' },
    { totalPrice: 900_000, paidAmount: 0, nextPaymentDate: '2026-08-20', status: 'frozen' },
  ], '2026-08-26')
  assert.equal(summary.totalCount, 3)
  assert.equal(summary.actionCount, 2)
  assert.equal(summary.overdueCount, 1)
  assert.equal(summary.dueTodayCount, 1)
  assert.equal(summary.warningCount, 1)
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
  assert.match(dashboard, /Các việc cần xử lý/)
  assert.doesNotMatch(dashboard, /activeTab/)
  assert.doesNotMatch(dashboard, /admin-operations-tabs/)
})
