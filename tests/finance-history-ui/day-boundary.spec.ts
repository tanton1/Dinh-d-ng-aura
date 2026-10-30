import { expect, test, type Page } from '@playwright/test'

const filters = (page: Page) => page.locator('.finance-management__debt-filters')
const metrics = (page: Page) => page.locator('.aura-metric-carousel__slide strong')
const reads = (page: Page) => page.evaluate(() => {
  const state = (window as any).financeState
  return { ledger: state.calls.length, cash: state.cashCalls.length, directoryRefresh: state.refreshes, reports: state.reportCalls.length }
})
async function boot(page: Page, at = '2026-10-31T23:59:00+07:00') {
  await page.clock.install({ time: new Date(at) })
  await page.goto('/tests/finance-history-ui/index.html')
  await expect(page.getByRole('heading', { name: 'Công nợ', exact: true })).toBeVisible()
  await page.evaluate(() => (window as any).financeState.updateContract('contract-a', { nextPaymentDate: '2026-10-31' }))
  await page.getByRole('button', { name: 'Làm mới trả góp', exact: true }).click()
  await expect(metrics(page).nth(2)).toHaveText('1.000.000đ')
}

test('midnight refreshes the date-scoped receivables once without reading ledger or cash accounts', async ({ page }) => {
  await boot(page)
  await expect(metrics(page).nth(1)).toHaveText('0đ')
  await expect(metrics(page).nth(2)).toHaveText('1.000.000đ')
  await expect(filters(page).getByRole('button', { name: 'Tuần này 1', exact: true })).toBeVisible()
  await filters(page).getByRole('button', { name: 'Quá hạn 0', exact: true }).click()
  await expect(page.locator('.finance-management__receivables-list article')).toHaveCount(0)
  const before = await reads(page)
  await page.clock.fastForward(61_000)
  await expect(metrics(page).nth(1)).toHaveText('1.000.000đ')
  await expect(metrics(page).nth(2)).toHaveText('0đ')
  await expect(filters(page).getByRole('button', { name: 'Tuần này 0', exact: true })).toBeVisible()
  await expect(page.locator('.finance-management__receivables-list article.is-overdue')).toHaveCount(1)
  expect(await reads(page)).toEqual({ ...before, reports: before.reports + 1 })
  expect(await page.evaluate(() => (window as any).financeState.reportCalls.at(-1).query)).toMatchObject({ today: '2026-11-01', filter: 'overdue', cursor: null, includeSummary: true })
})

test('resuming a suspended tab recomputes the calendar without a database change', async ({ page }) => {
  await boot(page)
  await expect(metrics(page).nth(1)).toHaveText('0đ')
  const before = await reads(page)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  // A suspended device may advance its clock without running overdue timers.
  await page.clock.setSystemTime(new Date('2026-11-02T10:00:00+07:00'))
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(metrics(page).nth(1)).toHaveText('1.000.000đ')
  await expect(metrics(page).nth(2)).toHaveText('0đ')
  expect(await reads(page)).toEqual({ ...before, reports: before.reports + 1 })
  expect(await page.evaluate(() => (window as any).financeState.reportCalls.at(-1).query.today)).toBe('2026-11-02')
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(await reads(page)).toEqual({ ...before, reports: before.reports + 1 })
})

test('successive midnights retain the payment draft and never reload its accounts', async ({ page }) => {
  await boot(page, '2026-10-30T23:59:00+07:00')
  await page.getByRole('button', { name: 'Thu tiền của Test learner A', exact: true }).click()
  const payment = page.getByRole('dialog', { name: 'Thu công nợ', exact: true })
  await expect(payment.getByRole('combobox', { name: 'Quỹ nhận/chi', exact: true })).toHaveValue('cash-a')
  await payment.getByRole('spinbutton').fill('250000')
  const before = await reads(page)
  await page.clock.fastForward(61_000)
  await expect(metrics(page).nth(1)).toHaveText('0đ')
  await page.clock.fastForward(86_400_000)
  await expect(metrics(page).nth(1)).toHaveText('1.000.000đ')
  await expect(payment.getByRole('spinbutton')).toHaveValue('250000')
  await expect(payment.getByRole('combobox', { name: 'Quỹ nhận/chi', exact: true })).toHaveValue('cash-a')
  expect(await reads(page)).toEqual({ ...before, reports: before.reports + 2 })
  expect(await page.evaluate(() => (window as any).financeState.payments)).toBe(0)
})

test('an open ledger keeps its selected date range and page chain over midnight', async ({ page }) => {
  await boot(page)
  await page.getByRole('button', { name: 'Mở lịch sử thu trả góp', exact: true }).click()
  const history = page.getByRole('dialog', { name: 'Sổ giao dịch', exact: true })
  await expect(history.getByText('admin-a-first-all-1', { exact: false })).toBeVisible()
  const before = await reads(page)
  const firstQuery = await page.evaluate(() => (window as any).financeState.calls[0].query)
  await page.clock.fastForward(61_000)
  await expect(metrics(page).nth(1)).toHaveText('1.000.000đ')
  expect(await reads(page)).toEqual({ ...before, reports: before.reports + 1 })
  await history.getByRole('button', { name: 'Tải thêm giao dịch', exact: true }).click()
  await expect(history.getByText('admin-a-second-all-2', { exact: false })).toBeVisible()
  const nextQuery = await page.evaluate(() => (window as any).financeState.calls[1].query)
  expect(nextQuery).toEqual({ ...firstQuery, cursor: 'next-1' })
})
