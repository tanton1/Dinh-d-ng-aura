import { expect, test, type Page } from '@playwright/test'

async function boot(page: Page) {
  await page.clock.install({ time: new Date('2026-10-30T12:00:00+07:00') })
  await page.goto('/tests/finance-history-ui/index.html?workspace=hub')
  await expect(page.locator('.finance-management')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).financeState.reportCalls.length)).toBe(1)
}
const reads = (page: Page) => page.evaluate(() => {
  const s = (window as any).financeState
  return { debts: s.reportCalls.length, reports: s.performanceCalls.length, cash: s.cashCalls.length, ledger: s.calls.length }
})

test('opens installments first and activates the seven-day report only on click or Enter, without idle reads', async ({ page }) => {
  await boot(page)
  await expect(page.getByRole('tablist', { name: 'Phân hệ tài chính' }).getByRole('tab')).toHaveText(['Trả góp', 'Sổ quỹ', 'Báo cáo kỳ'])
  await expect(page.getByRole('tab', { name: 'Trả góp', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.clock.fastForward(61_000)
  expect(await reads(page)).toEqual({ debts: 1, reports: 0, cash: 0, ledger: 0 })
  await expect(page.locator('.business-performance')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Trả góp', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Sổ quỹ', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Báo cáo kỳ', exact: true })).toBeFocused()
  expect(await reads(page)).toEqual({ debts: 1, reports: 0, cash: 0, ledger: 0 })
  await page.keyboard.press('Enter')
  await expect(page.locator('.business-performance')).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByRole('button', { name: '7 ngày', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => (window as any).financeState.performanceCalls)).toEqual([
    { startDate: '2026-10-24', endDate: '2026-10-30', source: 'all', includeReconciliationIndex: true },
  ])
  await page.clock.fastForward(61_000)
  expect(await reads(page)).toEqual({ debts: 1, reports: 1, cash: 0, ledger: 0 })
})

test('loads analytics code on expansion and applies a complete custom date range with one report read', async ({ page }) => {
  const analyticsRequests: string[] = []
  page.on('request', request => { if (request.url().includes('/finance-analytics/FinanceOverviewAnalytics.tsx')) analyticsRequests.push(request.url()) })
  await boot(page)
  await page.getByRole('tab', { name: 'Báo cáo kỳ', exact: true }).click()
  await expect(page.locator('.business-performance')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.finance-overview-analytics')).toHaveCount(0)
  expect(analyticsRequests).toHaveLength(0)
  await page.locator('.finance-report-analysis > summary').click()
  await expect(page.locator('.finance-overview-analytics')).toBeVisible()
  expect(analyticsRequests).toHaveLength(1)
  await page.locator('.finance-report-analysis > summary').click()
  await expect(page.locator('.finance-overview-analytics')).toHaveCount(0)
  expect((await reads(page)).reports).toBe(1)
  await page.locator('.business-performance__date-picker > summary').click()
  await page.getByLabel('Từ ngày', { exact: true }).fill('2026-10-10')
  await page.getByLabel('Đến ngày', { exact: true }).fill('2026-10-28')
  expect((await reads(page)).reports).toBe(1)
  await page.getByRole('button', { name: 'Áp dụng khoảng ngày' }).click()
  await expect.poll(() => page.evaluate(() => (window as any).financeState.performanceCalls.length)).toBe(2)
  expect(await page.evaluate(() => (window as any).financeState.performanceCalls.at(-1))).toMatchObject({ startDate: '2026-10-10', endDate: '2026-10-28' })
  await expect(page.locator('.business-performance__date-picker')).not.toHaveAttribute('open', '')
  await page.locator('.business-performance__date-picker > summary').click()
  await page.getByLabel('Từ ngày', { exact: true }).fill('2026-10-29')
  await expect(page.getByRole('button', { name: 'Áp dụng khoảng ngày' })).toBeDisabled()
  expect((await reads(page)).reports).toBe(2)
})

test('reopening reads fresh data and an account change discards an outstanding report', async ({ page }) => {
  await boot(page)
  await page.getByRole('tab', { name: 'Báo cáo kỳ', exact: true }).click()
  await expect(page.locator('.business-performance')).toHaveAttribute('aria-busy', 'false')
  await page.getByRole('tab', { name: 'Trả góp', exact: true }).click()
  await expect(page.locator('.business-performance')).toHaveCount(0)
  await page.evaluate(() => { (window as any).financeState.performanceDefer = true })
  await page.getByRole('tab', { name: 'Báo cáo kỳ', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).financeState.performancePending.length)).toBe(1)
  expect((await reads(page)).reports).toBe(2)
  await page.getByRole('button', { name: 'Change account', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Trả góp', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.business-performance')).toHaveCount(0)
  await page.evaluate(() => {
    const s = (window as any).financeState
    s.performancePending[0].resolve({ range: { startDate: '2026-10-24', endDate: '2026-10-30' }, branchId: 'all', source: 'all',
      sourceRows: [], dailySeries: [], cashFlow: { cashNet: 999999, cashIn: 999999, cashOut: 0 }, managementPnl: { recognisedRevenue: 0, operatingExpense: 0, operatingResult: 0 },
      balanceMovement: { receivableMovement: 0, deferredRevenueMovement: 0 }, dataQuality: { missingSourceIntegrations: [] } })
  })
  await expect.poll(() => page.evaluate(() => (window as any).financeState.performanceSettled)).toBe(1)
  await expect(page.locator('.business-performance')).toHaveCount(0)
  await expect(page.getByText('999.999đ', { exact: true })).toHaveCount(0)
})
