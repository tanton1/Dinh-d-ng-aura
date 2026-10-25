import { expect, test, type Page } from '@playwright/test'

const cashCount = (page: Page) => page.evaluate(() => (window as any).financeState.cashCalls.length)
const payment = (page: Page) => page.getByRole('dialog', { name: 'Thu công nợ', exact: true })
const funds = (page: Page) => payment(page).getByRole('combobox', { name: 'Quỹ nhận/chi', exact: true })
async function boot(page: Page) {
  await page.goto('/tests/finance-history-ui/index.html')
  await expect(page.getByRole('heading', { name: 'Công nợ', exact: true })).toBeVisible()
}
async function open(page: Page) { await page.getByRole('button', { name: 'Thu tiền của Test learner A', exact: true }).click() }

test('debt, history, filters, refresh and idle do not load payment cash accounts', async ({ page }) => {
  await boot(page)
  await page.getByRole('combobox', { name: 'Lọc chi nhánh công nợ', exact: true }).selectOption('b')
  await page.getByRole('button', { name: 'Làm mới trả góp', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).financeState.refreshes)).toBe(1)
  await page.getByRole('button', { name: 'Mở lịch sử thu trả góp', exact: true }).click()
  const history = page.getByRole('dialog', { name: 'Sổ giao dịch', exact: true })
  await expect(history.getByText('admin-a-first-b-1', { exact: false })).toBeVisible()
  await history.getByRole('button', { name: 'Đóng', exact: true }).click()
  await page.clock.install()
  await page.clock.fastForward(30 * 60_000)
  expect(await cashCount(page)).toBe(0)
  await expect(page.locator('.aura-metric-carousel__slide').first()).toContainText('500.000đ')
})

test('opening reads once and blocks payment until active cash accounts arrive', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => {
    const state = (window as any).financeState
    state.cashDefer = true
    state.cashAccounts.push({ id: 'cash-other', branchId: 'a', status: 'active', name: 'Other cash', balance: 0 },
      { id: 'cash-closed', branchId: 'a', status: 'closed', name: 'Closed cash', balance: 0 })
  })
  await open(page)
  await expect.poll(() => cashCount(page)).toBe(1)
  await expect(payment(page).getByRole('status').filter({ hasText: 'Đang tải danh sách quỹ' })).toBeVisible()
  await expect(funds(page)).toBeDisabled()
  await expect(payment(page).getByRole('button', { name: 'Ghi khoản thu', exact: true })).toBeDisabled()
  await expect(payment(page).getByText('Chưa có quỹ.', { exact: false })).toHaveCount(0)
  await page.evaluate(() => (window as any).financeState.resolveCash(0))
  await expect(funds(page)).toHaveValue('cash-a')
  await expect(funds(page)).toBeEnabled()
  await expect(funds(page).locator('option')).toHaveCount(3)
  await expect(funds(page).locator('option[value="cash-closed"]')).toHaveCount(0)
  await funds(page).selectOption('cash-other')
  await payment(page).getByRole('spinbutton').fill('200000')
  await expect(funds(page)).toHaveValue('cash-other')
  await expect(payment(page).getByRole('button', { name: 'Ghi khoản thu', exact: true })).toBeEnabled()
  expect(await cashCount(page)).toBe(1)
})

test('cash read errors require explicit retry and are not shown as an empty directory', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => { (window as any).financeState.cashFailure = 'unavailable' })
  await open(page)
  await expect(payment(page).getByRole('alert')).toContainText('Chưa tải được danh sách quỹ')
  await expect(payment(page).getByText('Chưa có quỹ.', { exact: false })).toHaveCount(0)
  await expect(payment(page).getByRole('button', { name: 'Ghi khoản thu', exact: true })).toBeDisabled()
  await page.clock.install()
  await page.clock.fastForward(60_000)
  expect(await cashCount(page)).toBe(1)
  await payment(page).getByRole('button', { name: 'Thử tải lại danh sách quỹ', exact: true }).click()
  await expect(funds(page)).toHaveValue('cash-a')
  await expect(payment(page).getByRole('alert')).toHaveCount(0)
  expect(await cashCount(page)).toBe(2)
})

test('reopening reads fresh funds and fences the closed dialog response', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => { (window as any).financeState.cashDefer = true })
  await open(page)
  await expect.poll(() => cashCount(page)).toBe(1)
  await payment(page).getByRole('button', { name: 'Đóng', exact: true }).click()
  await expect(payment(page)).toHaveCount(0)
  await page.evaluate(() => {
    (window as any).financeState.cashAccounts = [{ id: 'cash-new', branchId: 'a', status: 'active', name: 'New cash', balance: 0 }]
  })
  await open(page)
  await expect.poll(() => cashCount(page)).toBe(2)
  await page.evaluate(() => (window as any).financeState.resolveCash(1))
  await expect(funds(page)).toHaveValue('cash-new')
  await page.evaluate(() => (window as any).financeState.resolveCash(0))
  await expect.poll(() => page.evaluate(() => (window as any).financeState.cashSettled)).toBe(2)
  await expect(funds(page)).toHaveValue('cash-new')
  await expect(funds(page).locator('option[value="cash-a"]')).toHaveCount(0)
  expect(await cashCount(page)).toBe(2)
})

for (const change of ['account', 'authority']) test(`changing ${change} closes payment and ignores the prior cash read`, async ({ page }) => {
  await boot(page)
  await page.evaluate(() => { (window as any).financeState.cashDefer = true })
  await open(page)
  await expect.poll(() => cashCount(page)).toBe(1)
  await page.getByRole('button', { name: `Change ${change}`, exact: true }).evaluate((button: HTMLButtonElement) => button.click())
  await expect(payment(page)).toHaveCount(0)
  await page.evaluate(() => (window as any).financeState.resolveCash(0, 'permission-denied'))
  await expect.poll(() => page.evaluate(() => (window as any).financeState.cashSettled)).toBe(1)
  expect(await cashCount(page)).toBe(1)
  await open(page)
  await expect.poll(() => cashCount(page)).toBe(2)
  await page.evaluate(() => (window as any).financeState.resolveCash(1))
  await expect(funds(page)).toHaveValue('cash-a')
  await expect(payment(page).getByRole('alert')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).financeState.cashCalls[1].owner)).toBe(change === 'account' ? 'admin-b' : 'admin-a')
})

test('a successful empty cash response shows the setup guidance and cannot submit', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => { (window as any).financeState.cashAccounts = [] })
  await open(page)
  await expect(payment(page).getByText('Chưa có quỹ.', { exact: false })).toBeVisible()
  await expect(payment(page).getByRole('alert')).toHaveCount(0)
  await expect(payment(page).getByRole('status')).toHaveCount(0)
  await expect(payment(page).getByRole('button', { name: 'Ghi khoản thu', exact: true })).toBeDisabled()
  expect(await cashCount(page)).toBe(1)
})
