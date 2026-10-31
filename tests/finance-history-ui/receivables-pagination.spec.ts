import { expect, test, type Page } from '@playwright/test'

const rows = (page: Page) => page.locator('.finance-management__receivables-list article')
const calls = (page: Page) => page.evaluate(() => (window as any).financeState.reportCalls)
const asOf = '2026-10-31T05:00:00Z'
const summary = { complete: true, totals: { debt: 800_000, overdue: 0, thisMonth: 800_000 }, counts: { all: 1, owing: 1, settled: 0, overpaid: 0, overdue: 0, 'this-week': 1, 'this-month': 1 }, asOf, sourceDocuments: 801 }
const contract = (id: string) => ({ id, studentId: id, packageName: 'Gói trả góp', branchId: 'a', totalPrice: 1_000_000, paidAmount: 200_000, discount: 0, status: 'active', installments: [{ id: 'due', status: 'pending', date: '2026-10-31', amount: 800_000 }] })
function batch(ids: string[], nextCursor: string | null, report: any = null) {
  return { contracts: ids.map(contract), students: ids.map(id => ({ id, name: id })), summary: report, nextCursor, hasMore: Boolean(nextCursor), scanned: 200, asOf }
}
async function boot(page: Page, pages: any[]) {
  await page.goto('/tests/finance-history-ui/index.html?workspace=hub&initialTab=overview')
  await expect(page.locator('.business-performance')).toBeVisible()
  await page.evaluate(pages => { (window as any).financeState.receivablesPages = pages }, pages)
}
async function open(page: Page) { await page.getByRole('tab', { name: 'Trả góp', exact: true }).click() }

test('finds matches beyond sparse pages with one bounded foreground fill and one summary', async ({ page }) => {
  await boot(page, [batch([], '200', summary), batch([], '400'), batch(['late learner'], null)])
  await open(page)
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toContainText('late learner')
  expect((await calls(page)).map((call: any) => [call.query.cursor, call.query.includeSummary])).toEqual([[null, true], ['200', false], ['400', false]])
  await expect(page.getByText('Không có hợp đồng trả góp còn nợ.', { exact: true })).toHaveCount(0)
  await expect(page.locator('.finance-management .aura-metric-carousel__slide strong').first()).toHaveText('800.000đ')
  await page.clock.install()
  await page.clock.fastForward(65_000)
  expect(await calls(page)).toHaveLength(3)
  expect(await page.evaluate(() => (window as any).financeState.calls.length)).toBe(0)
})

test('stops at three source pages and keeps explicit continuation instead of a false empty result', async ({ page }) => {
  await boot(page, [batch([], '200', summary), batch([], '400'), batch([], '600'), batch(['beyond budget'], null)])
  await open(page)
  await expect(page.getByRole('button', { name: 'Tiếp tục tìm', exact: true })).toBeVisible()
  expect(await calls(page)).toHaveLength(3)
  await expect(page.getByText('Chưa tìm hết danh sách. Tiếp tục để tìm hồ sơ phù hợp.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Tiếp tục tìm', exact: true }).click()
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toContainText('beyond budget')
  expect((await calls(page)).at(-1).query).toMatchObject({ cursor: '600', includeSummary: false })
  await expect(page.getByRole('button', { name: 'Tiếp tục tìm', exact: true })).toHaveCount(0)
})

test('nonadvancing continuation fails visibly without removing loaded rows or looping', async ({ page }) => {
  await boot(page, [batch(Array.from({ length: 20 }, (_, i) => `learner ${i}`), 'next', summary), batch([], 'next')])
  await open(page)
  await expect(rows(page)).toHaveCount(20)
  await page.getByRole('button', { name: 'Tải thêm hồ sơ', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Hãy làm mới danh sách')
  await expect(rows(page)).toHaveCount(20)
  expect(await calls(page)).toHaveLength(2)
})

test('changing branch fences an in-flight sparse page before it can continue scanning', async ({ page }) => {
  await boot(page, [batch(['old branch'], 'old-next', summary), batch(['new branch'], null, summary)])
  await page.evaluate(() => { (window as any).financeState.receivablesDefer = true })
  await open(page)
  await expect.poll(async () => (await calls(page)).length).toBe(1)
  await page.getByLabel('Lọc chi nhánh công nợ').selectOption('b')
  await expect.poll(async () => (await calls(page)).length).toBe(2)
  await page.evaluate(() => (window as any).financeState.receivablesPending[0].resolve())
  await expect(rows(page)).toHaveCount(0)
  await page.evaluate(() => (window as any).financeState.receivablesPending[1].resolve())
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toContainText('new branch')
  expect(await calls(page)).toHaveLength(2)
  expect((await calls(page))[1].query).toMatchObject({ branchId: 'b', cursor: null, includeSummary: true })
})

test('changing authority clears old data and rejects its delayed continuation', async ({ page }) => {
  await boot(page, [batch(['old authority'], 'old-next', summary), batch(['new authority'], null, summary)])
  await page.evaluate(() => { (window as any).financeState.receivablesDefer = true })
  await open(page)
  await expect.poll(async () => (await calls(page)).length).toBe(1)
  await page.getByRole('button', { name: 'Change authority', exact: true }).click()
  // A new authority remounts the hub at this fixture's explicit initial tab.
  await expect(page.getByRole('tab', { name: 'Báo cáo kỳ', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(rows(page)).toHaveCount(0)
  await open(page)
  await expect.poll(async () => (await calls(page)).length).toBe(2)
  await page.evaluate(() => (window as any).financeState.receivablesPending[1].resolve())
  await expect(rows(page).first()).toContainText('new authority')
  await page.evaluate(() => (window as any).financeState.receivablesPending[0].resolve())
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).not.toContainText('old authority')
  expect(await calls(page)).toHaveLength(2)
})

test('incomplete summaries remain unknown while matching profiles stay usable', async ({ page }) => {
  await boot(page, [batch(['review learner'], null, { ...summary, complete: false, totals: null, counts: null, reason: 'limit' })])
  await open(page)
  await expect(rows(page)).toHaveCount(1)
  await expect(page.locator('.finance-management .aura-metric-carousel__slide strong').first()).toHaveText('—')
  await expect(page.getByRole('alert')).toContainText('Chưa đủ dữ liệu tính tổng')
  await expect(rows(page).getByRole('button', { name: 'Thu tiền của review learner', exact: true })).toBeVisible()
})
