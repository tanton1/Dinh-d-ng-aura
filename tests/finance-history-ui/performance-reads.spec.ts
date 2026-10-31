import { expect, test, type Page } from '@playwright/test'

function report(amount: number, truncated = false) {
  return {
    schemaVersion: 3, range: { startDate: '2026-10-01', endDate: '2026-10-30', timeZone: 'Asia/Ho_Chi_Minh' }, branchId: 'all', source: 'all',
    dailySeries: [],
    sourceRows: [{ source: 'payroll', cashIn: 0, cashOut: Math.abs(amount), cashNet: amount, recognisedRevenue: 0, operatingExpense: Math.abs(amount), operatingResult: amount, entryCount: 1 }],
    cashFlow: { cashIn: Math.max(0, amount), cashOut: Math.max(0, -amount), cashNet: amount },
    managementPnl: { recognisedRevenue: 0, operatingExpense: Math.max(0, -amount), operatingResult: amount },
    balanceMovement: { receivableMovement: 0, deferredRevenueMovement: 0 },
    dataQuality: { ledgerTruncated: truncated, missingSourceIntegrations: [], cancelledSalesBaselineUnverified: 0, contractSalesDatesMissing: 0 },
  }
}
const panel = (page: Page) => page.locator('.business-performance')
const cashMetric = (page: Page) => panel(page).locator('.finance-report-metrics article strong').first()
async function boot(page: Page) {
  await page.clock.install({ time: new Date('2026-10-30T12:00:00+07:00') })
  await page.goto('/tests/finance-history-ui/index.html?workspace=hub&initialTab=overview')
  await expect.poll(() => page.evaluate(() => (window as any).financeState?.performanceCalls.length || 0)).toBe(1)
  await expect(panel(page)).toHaveAttribute('aria-busy', 'false')
  await page.evaluate(() => { (window as any).financeState.performanceDefer = true })
}
async function pending(page: Page, count: number) {
  await expect.poll(() => page.evaluate(() => (window as any).financeState.performancePending.length)).toBe(count)
}
async function resolve(page: Page, index: number, amount: number, truncated = false) {
  await page.evaluate(({ index, result }) => (window as any).financeState.performancePending[index].resolve(result), { index, result: report(amount, truncated) })
}

test('keeps the latest branch, source and date report when earlier requests finish in reverse order', async ({ page }) => {
  await boot(page)
  await page.getByRole('button', { name: 'Làm mới báo cáo', exact: true }).click()
  await pending(page, 1)
  await page.getByLabel('Lọc chi nhánh', { exact: true }).selectOption('a')
  await pending(page, 2)
  await page.getByLabel('Lọc nguồn kinh doanh').selectOption('nutrition_coaching')
  await pending(page, 3)
  await page.getByRole('button', { name: '30 ngày', exact: true }).click()
  await pending(page, 4)
  expect(await page.evaluate(() => (window as any).financeState.performanceCalls.at(-1))).toEqual({ branchId: 'a', source: 'nutrition_coaching', startDate: '2026-10-01', endDate: '2026-10-30', includeReconciliationIndex: true })

  await resolve(page, 2, 333_000)
  await expect.poll(() => page.evaluate(() => (window as any).financeState.performanceSettled)).toBe(1)
  await expect(panel(page)).toHaveAttribute('aria-busy', 'true')
  await expect(cashMetric(page)).toHaveText('Đang tải…')
  await resolve(page, 3, 777_000, true)
  await expect(cashMetric(page)).toHaveText('Chưa đủ dữ liệu')
  await expect(panel(page).getByRole('alert')).toContainText('Số liệu chưa đầy đủ')
  await resolve(page, 1, 111_000)
  await page.evaluate(() => (window as any).financeState.performancePending[0].reject(new Error('Old branch error')))
  await expect.poll(() => page.evaluate(() => (window as any).financeState.performanceSettled)).toBe(4)
  await expect(cashMetric(page)).toHaveText('Chưa đủ dữ liệu')
  await expect(panel(page)).toHaveAttribute('aria-busy', 'false')
  await expect(panel(page).getByText('Old branch error', { exact: true })).toHaveCount(0)
  await expect(panel(page).getByRole('alert')).toContainText('Chọn khoảng ngày ngắn hơn')
})

test('labels net outflows correctly and removes the partial-data alert after a complete refresh', async ({ page }) => {
  await boot(page)
  await page.getByRole('button', { name: 'Làm mới báo cáo', exact: true }).click()
  await pending(page, 1)
  await resolve(page, 0, -250_000, true)
  await expect(panel(page).getByRole('alert')).toBeVisible()
  await expect(cashMetric(page)).toHaveText('Chưa đủ dữ liệu')
  await expect(panel(page).locator('.business-performance__source-details')).toHaveCount(0)
  await expect(panel(page).locator('.business-performance__bars')).toHaveCount(0)
  await expect(panel(page).locator('.finance-report-metrics article').nth(1)).toContainText('Dịch vụ đủ điều kiện và điều chỉnh đã ghi nhận')
  const help = panel(page).locator('.business-performance__toolbar .aura-help-popover')
  await help.locator('summary').click()
  await expect(help).toContainText('Buổi đã trừ ghi nhận doanh thu ngay')
  await expect(help).toContainText('buổi chuyển tiếp giữ đơn giá hợp đồng gốc')
  await help.locator('summary').click()
  await page.getByRole('button', { name: 'Làm mới báo cáo', exact: true }).click()
  await pending(page, 2)
  await expect(panel(page).getByRole('alert')).toHaveCount(1)
  await expect(cashMetric(page)).toHaveText('Chưa đủ dữ liệu')
  await resolve(page, 1, -250_000)
  await expect(cashMetric(page)).toHaveText('-250.000đ')
  await expect(panel(page).getByRole('alert')).toHaveCount(0)
  await panel(page).locator('.business-performance__source-details summary').click()
  await expect(panel(page).locator('.business-performance__table-head')).toContainText('Dòng tiền ròng')
  await expect(panel(page).locator('.business-performance__table-row [data-label="Dòng tiền ròng"]')).toHaveText('-250.000đ')
  await expect(panel(page).locator('[data-label="Thu tiền"]')).toHaveCount(0)
})

test('leaving the overview discards its in-flight report and reopening reads a fresh scope', async ({ page }) => {
  await boot(page)
  await page.getByRole('button', { name: 'Làm mới báo cáo', exact: true }).click()
  await pending(page, 1)
  await page.getByRole('tab', { name: 'Trả góp', exact: true }).click()
  await expect(panel(page)).toHaveCount(0)
  await resolve(page, 0, 900_000)
  await expect.poll(() => page.evaluate(() => (window as any).financeState.performanceSettled)).toBe(1)
  await page.getByRole('tab', { name: 'Báo cáo kỳ', exact: true }).click()
  await expect(panel(page)).toHaveAttribute('aria-busy', 'true')
  await expect(cashMetric(page)).toHaveText('Đang tải…')
  await expect.poll(() => page.evaluate(() => (window as any).financeState.performancePending.length)).toBeGreaterThan(1)
  const last = await page.evaluate(() => (window as any).financeState.performancePending.length - 1)
  await resolve(page, last, 600_000)
  await expect(cashMetric(page)).toHaveText('600.000đ')
  // StrictMode can create an additional discarded mount request.
  for (let index = 1; index < last; index++) await resolve(page, index, 800_000)
  await expect(cashMetric(page)).toHaveText('600.000đ')
})

function comparisonReport() {
  return {
    ...report(500_000),
    receipts: { gross: 1_200_000, refunds: 300_000, reversals: 0, adjustments: 0, net: 900_000 },
    sales: { grossContractSales: 2_000_000, contractSalesAdjustment: -200_000, netContractSales: 1_800_000, contractCount: 1, complete: true },
    cashFlow: { cashIn: 1_200_000, cashOut: 700_000, cashNet: 500_000 },
    managementPnl: { recognisedRevenue: 800_000, operatingExpense: 400_000, operatingResult: 400_000 },
    balanceMovement: { receivableMovement: -100_000, deferredRevenueMovement: 200_000 },
    sourceRows: [
      { source: 'pt_gym', cashIn: 1_200_000, cashOut: 300_000, cashNet: 900_000, recognisedRevenue: 800_000, operatingExpense: 0, operatingResult: 800_000, entryCount: 7 },
      { source: 'payroll', cashIn: 0, cashOut: 400_000, cashNet: -400_000, recognisedRevenue: 0, operatingExpense: 400_000, operatingResult: -400_000, entryCount: 1 },
    ],
    dailySeries: [
      { date: '2026-10-01', grossCash: 1_200_000, netCash: 1_200_000, cashNet: 1_100_000, recognisedRevenue: 900_000, operatingExpense: 100_000, operatingResult: 800_000, contractSales: 2_000_000, salesAdjustment: 0 },
      { date: '2026-10-30', grossCash: 0, netCash: -300_000, cashNet: -600_000, recognisedRevenue: -100_000, operatingExpense: 300_000, operatingResult: -400_000, contractSales: -200_000, salesAdjustment: -200_000 },
    ],
  }
}
async function showComparison(page: Page, result = comparisonReport()) {
  await boot(page)
  await page.getByRole('button', { name: 'Làm mới báo cáo', exact: true }).click()
  await pending(page, 1)
  await page.evaluate(result => (window as any).financeState.performancePending[0].resolve(result), result)
  await expect(panel(page)).toHaveAttribute('aria-busy', 'false')
  await panel(page).locator('.finance-report-analysis > summary').click()
}

test('compares receipts separately from cash movement, preserves the full period and displays signed adjustments', async ({ page }, testInfo) => {
  await showComparison(page)
  await expect(panel(page).getByRole('heading', { name: 'Báo cáo kỳ', exact: true })).toBeVisible()
  await expect(panel(page).getByLabel('Chi tiết thu')).toContainText('900.000đ')
  await expect(panel(page).getByLabel('Chi tiết thu')).toContainText('300.000đ')
  await expect(panel(page).getByRole('heading', { name: 'Đối soát dữ liệu', exact: true })).toBeVisible()
  await expect(panel(page).locator('.finance-review__other')).not.toHaveAttribute('open', '')
  await expect(panel(page).getByRole('button', { name: /Cần xử lý/ })).toBeDisabled()
  await panel(page).screenshot({ path: `.tools/finance-period-primary-${testInfo.project.name}.png` })
  const comparison = panel(page).locator('.finance-overview-analytics__comparison')
  await expect(comparison).not.toHaveAttribute('open', '')
  await comparison.locator(':scope > summary').click()
  await expect(comparison.locator('.finance-overview-analytics__totals')).toContainText('1.800.000đ')
  await expect(comparison.locator('.finance-overview-analytics__totals')).toContainText('900.000đ')
  await expect(panel(page).locator('.finance-overview-analytics__cash-equation')).toContainText('500.000đ')
  await expect(comparison.locator('.finance-chart__inspection')).toContainText('-300.000đ')
  await expect(comparison.locator('.finance-chart__inspection')).not.toContainText('-600.000đ')
  await expect(comparison.getByLabel('Xem số liệu').locator('option')).toHaveCount(30)
  await comparison.getByLabel('Xem số liệu').selectOption('2026-10-01')
  await expect(comparison.locator('.finance-chart__inspection')).toContainText('2.000.000đ')
  const zeroBars = comparison.locator('rect[data-series="grossCash"][data-value="0"]')
  expect(await zeroBars.count()).toBe(29)
  expect(await zeroBars.evaluateAll(bars => bars.every(bar => bar.getAttribute('height') === '0'))).toBe(true)
  await comparison.getByText('Xem bảng số liệu', { exact: true }).click()
  await expect(comparison.locator('tbody tr')).toHaveCount(30)
  await expect(comparison.locator('tbody tr').last()).toContainText('-300.000đ')
  await comparison.getByText('Xem bảng số liệu', { exact: true }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await comparison.screenshot({ path: `.tools/finance-overview-${testInfo.project.name}.png` })
  await panel(page).locator('.finance-overview-analytics__details').screenshot({ path: `.tools/finance-overview-breakdown-${testInfo.project.name}.png` })
  expect(await page.evaluate(() => ({ ledger: (window as any).financeState.calls.length, receivables: (window as any).financeState.reportCalls.length, cash: (window as any).financeState.cashCalls.length }))).toEqual({ ledger: 0, receivables: 0, cash: 0 })
})

test('legacy report fields and incomplete sales never substitute cash flow or fabricate a zero series', async ({ page }) => {
  const result: any = comparisonReport()
  delete result.receipts
  result.sales.complete = false
  result.dataQuality.cancelledSalesBaselineUnverified = 2
  await showComparison(page, result)
  const comparison = panel(page).locator('.finance-overview-analytics__comparison')
  await expect(comparison).not.toHaveAttribute('open', '')
  await comparison.locator(':scope > summary').click()
  await expect(comparison).toContainText('Chưa có dữ liệu phân loại')
  await expect(comparison).toContainText('Chưa thể kết luận doanh số PT')
  await expect(comparison.locator('path[data-series="netCash"]')).toHaveCount(0)
  await expect(comparison.locator('path[data-series="contractSales"]')).toHaveCount(0)
  await expect(comparison.locator('path[data-series="recognizedRevenue"]')).toHaveCount(1)
  await expect(comparison.locator('.finance-overview-analytics__totals')).not.toContainText('500.000đ')
})

test('source completeness flags invalidate only their dependent analytics', async ({ page }) => {
  const result: any = comparisonReport()
  result.dataQuality.attendanceTruncated = true
  result.dataQuality.cashTransactionsTruncated = true
  await showComparison(page, result)
  await expect(panel(page).locator('.finance-overview-analytics__comparison svg')).toHaveCount(1)
  const quality = panel(page).locator('.finance-review')
  await expect(quality.getByText(/Chưa kiểm tra đủ dữ liệu chấm công/)).toBeVisible()
  await expect(quality.getByText(/Chưa kiểm tra đủ liên kết sổ quỹ/)).toBeVisible()
  await expect(quality.getByRole('button', { name: /Cần xử lý/ })).toBeDisabled()
  await page.getByRole('button', { name: 'Làm mới báo cáo', exact: true }).click()
  await pending(page, 2)
  result.dataQuality.ledgerTruncated = true
  await page.evaluate(result => (window as any).financeState.performancePending[1].resolve(result), result)
  await expect(panel(page).locator('.finance-overview-analytics')).toHaveCount(0)
  await expect(cashMetric(page)).toHaveText('Chưa đủ dữ liệu')
})


test('omitted daily evidence never paints a zero trend while valid period totals remain visible', async ({ page }) => {
  const result = comparisonReport()
  result.dailySeries = []
  await showComparison(page, result)
  await expect(cashMetric(page)).toHaveText('500.000đ')
  await expect(panel(page).getByLabel('Chi tiết thu')).toContainText('900.000đ')
  const comparison = panel(page).locator('.finance-overview-analytics__comparison')
  await comparison.locator(':scope > summary').click()
  await expect(comparison).toContainText('Chưa đủ dữ liệu theo ngày')
  await expect(comparison.locator('svg')).toHaveCount(0)
  const operating = panel(page).locator('.finance-overview-analytics__operating')
  await operating.locator(':scope > summary').click()
  await expect(operating).toContainText('Chưa có đủ dữ liệu theo ngày')
  await expect(operating.locator('svg')).toHaveCount(0)
})


test('offsetting unlinked cash entries and pending sources remain visible outside the collapsed details', async ({ page }) => {
  const result: any = comparisonReport()
  result.dataQuality.unlinkedCashTransactionCount = 2
  result.dataQuality.unlinkedCashTransactions = 0
  result.dataQuality.missingSourceIntegrations = ['academy']
  await showComparison(page, result)
  const quality = panel(page).locator('.finance-review')
  await expect(quality.locator('.finance-review__other')).not.toHaveAttribute('open', '')
  await expect(quality.locator('.finance-review__hint').filter({ hasText: '2 giao dịch sổ quỹ chưa liên kết' })).toBeVisible()
  await quality.locator('.finance-review__other > summary').click()
  await expect(quality.locator('.finance-review__other')).toContainText('Aura Academy')
  await expect(quality.locator('.business-performance__review-status')).toHaveCount(0)
})
