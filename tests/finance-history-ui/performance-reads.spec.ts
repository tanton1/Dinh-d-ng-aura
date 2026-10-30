import { expect, test, type Page } from '@playwright/test'

function report(amount: number, truncated = false) {
  return {
    dailySeries: [],
    sourceRows: [{ source: 'payroll', cashIn: 0, cashOut: Math.abs(amount), cashNet: amount, recognisedRevenue: 0, operatingExpense: Math.abs(amount), operatingResult: amount, entryCount: 1 }],
    cashFlow: { cashIn: Math.max(0, amount), cashOut: Math.max(0, -amount), cashNet: amount },
    managementPnl: { recognisedRevenue: 0, operatingExpense: Math.max(0, -amount), operatingResult: amount },
    balanceMovement: { receivableMovement: 0, deferredRevenueMovement: 0 },
    dataQuality: { ledgerTruncated: truncated, missingSourceIntegrations: [] },
  }
}
const panel = (page: Page) => page.locator('.business-performance')
const cashMetric = (page: Page) => panel(page).locator('.aura-metric-carousel__slide strong').first()
async function boot(page: Page) {
  await page.clock.install({ time: new Date('2026-10-30T12:00:00+07:00') })
  await page.goto('/tests/finance-history-ui/index.html?workspace=hub')
  await expect.poll(() => page.evaluate(() => (window as any).financeState?.performanceCalls.length || 0)).toBeGreaterThanOrEqual(2)
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
  await page.getByRole('button', { name: '7 ngày', exact: true }).click()
  await pending(page, 4)
  expect(await page.evaluate(() => (window as any).financeState.performanceCalls.at(-1))).toEqual({ branchId: 'a', source: 'nutrition_coaching', startDate: '2026-10-24', endDate: '2026-10-30' })

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
  await expect(panel(page).locator('.aura-metric-carousel__slide').nth(1)).toContainText('Buổi xác nhận có tính phí; đơn đã giao')
  const help = panel(page).locator('.business-performance__toolbar .aura-help-popover')
  await help.locator('summary').click()
  await expect(help).toContainText('Buổi vắng được xác nhận có tính phí vẫn ghi nhận doanh thu')
  await expect(help).toContainText('Tự động xác nhận sau 48 giờ chưa đủ để ghi nhận')
  await help.locator('summary').click()
  await page.getByRole('button', { name: 'Làm mới báo cáo', exact: true }).click()
  await pending(page, 2)
  await expect(panel(page).getByRole('alert')).toHaveCount(0)
  await expect(cashMetric(page)).toHaveText('Đang tải…')
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
  await page.getByRole('tab', { name: 'Tổng quan', exact: true }).click()
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
