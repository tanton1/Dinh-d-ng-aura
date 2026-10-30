import { expect, test, type Page } from '@playwright/test'

const rows = (page: Page) => page.locator('.finance-management__receivables-list article')
const filters = (page: Page) => page.locator('.finance-management__debt-filters')
const metric = (page: Page, index = 0) => page.locator('.finance-management .aura-metric-carousel__slide strong').nth(index)
const pending = [{ id: 'first', date: '2026-10-20', amount: 100_000, status: 'pending' }, { id: 'second', date: '2026-10-30', amount: 300_000, status: 'pending' }]
const base = { branchId: 'a', packageName: 'Gói dinh dưỡng', totalPrice: 1_000_000, paidAmount: 200_000, discount: 0, status: 'active', installments: [], startDate: '2026-10-01', endDate: '2026-12-31', totalSessions: 12, usedSessions: 0 }
const fixtures = [
  { ...base, id: 'installments', studentId: 'installments', installments: pending },
  { ...base, id: 'frozen', studentId: 'frozen', installments: pending, status: 'frozen', frozenAt: '2026-10-15' },
  { ...base, id: 'frozen-paid', studentId: 'frozen-paid', status: 'frozen', paidAmount: 1_000_000 },
  { ...base, id: 'preservation', studentId: 'preservation', branchId: 'b', installments: pending, pausePeriods: [{ type: 'preservation', startDate: '2026-10-30', endDate: '2026-10-31' }] },
  { ...base, id: 'ordinary-off', studentId: 'ordinary-off', installments: pending, pausePeriods: [{ type: 'off', startDate: '2026-10-30', endDate: '2026-10-31' }] },
  { ...base, id: 'debt', studentId: 'debt', branchId: 'b', nextPaymentDate: '2026-10-30' },
  { ...base, id: 'cancelled', studentId: 'cancelled', status: 'cancelled' },
  { ...base, id: 'expired', studentId: 'expired', status: 'expired' },
  { ...base, id: 'historical-plan', studentId: 'historical-plan', installments: [{ ...pending[0], status: 'paid' }] },
  { ...base, id: 'overpaid', studentId: 'overpaid', paidAmount: 1_200_000, installments: pending },
]

async function seed(page: Page, contracts = fixtures) {
  await page.evaluate((contracts) => (window as any).financeState.replaceContracts(contracts,
    contracts.map(contract => ({ id: contract.studentId, name: `Học viên ${contract.id}`, phone: '0901234567' }))), contracts)
}
async function boot(page: Page) {
  await page.clock.install({ time: new Date('2026-10-30T12:00:00+07:00') })
  await page.goto('/tests/finance-history-ui/index.html?workspace=hub')
  await expect(page.locator('.business-performance')).toBeVisible()
  await seed(page)
}
async function select(page: Page, name: string) {
  await page.getByRole('tab', { name, exact: true }).click()
  await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel')).toHaveAccessibleName(name)
}
async function ids(page: Page) {
  return rows(page).evaluateAll(elements => elements.map(element => element.getAttribute('title')?.replace('Hợp đồng ', '')).sort())
}

test('separates installments, all preserved contracts, other debt and overpayments without duplicate totals', async ({ page }) => {
  await boot(page)
  expect(await page.evaluate(() => (window as any).financeState.directoryAcquisitions)).toBe(0)
  await page.getByRole('tab', { name: 'Tổng quan', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Trả góp', exact: true })).toBeFocused()
  await expect(rows(page)).toHaveCount(2)
  await expect.poll(() => ids(page)).toEqual(['installments', 'ordinary-off'])
  await expect(metric(page)).toHaveText('1.600.000đ')
  await expect(filters(page).getByRole('button', { name: 'Tuần này 2', exact: true })).toBeVisible()
  await expect(metric(page, 1)).toHaveText('200.000đ')
  expect(await page.evaluate(() => (window as any).financeState.directoryAcquisitions)).toBe(0)

  await select(page, 'Bảo lưu')
  await expect.poll(() => ids(page)).toEqual(['frozen', 'frozen-paid', 'preservation'])
  await expect(metric(page)).toHaveText('3 hợp đồng')
  await expect(metric(page, 1)).toHaveText('1.600.000đ')
  await expect(rows(page).filter({ hasText: 'HĐ frozen-paid' })).toContainText('Đã tất toán')
  await expect(rows(page).filter({ hasText: 'HĐ frozen-paid' }).getByRole('button')).toHaveCount(0)
  await expect(rows(page).filter({ hasText: 'HĐ frozen' }).first()).toContainText('Bảo lưu từ 15/10/2026')
  await expect(rows(page).locator('.is-overdue')).toHaveCount(0)
  await filters(page).getByRole('button', { name: 'Còn nợ 2', exact: true }).click()
  await expect(rows(page)).toHaveCount(2)
  await filters(page).getByRole('button', { name: 'Đã tất toán 1', exact: true }).click()
  await expect.poll(() => ids(page)).toEqual(['frozen-paid'])

  await select(page, 'Công nợ')
  await expect.poll(() => ids(page)).toEqual(['cancelled', 'debt', 'expired', 'historical-plan'])
  await expect(metric(page)).toHaveText('3.200.000đ')
  await expect(rows(page).filter({ hasText: 'HĐ cancelled' })).toContainText('Đã hủy')
  await expect(rows(page).filter({ hasText: 'HĐ expired' })).toContainText('Hết hạn')
  await expect(rows(page).filter({ hasText: 'HĐ historical-plan' })).toContainText('Chưa có hạn thu')
  await filters(page).getByRole('button', { name: 'Thanh toán dư 1', exact: true }).click()
  await expect.poll(() => ids(page)).toEqual(['overpaid'])
  await expect(rows(page)).toContainText('+200.000đ')
  await rows(page).getByRole('button', { name: 'Hoàn tiền của Học viên overpaid', exact: true }).click()
  const payment = page.getByRole('dialog', { name: 'Hoàn thanh toán dư', exact: true })
  await expect(payment.getByRole('spinbutton')).toHaveValue('-200000')
  await expect(payment.getByRole('button', { name: 'Ghi khoản hoàn tiền', exact: true })).toBeEnabled()
  await expect(payment.getByText('Chọn nhanh kỳ trả góp', { exact: true })).toHaveCount(0)
  await payment.getByRole('button', { name: 'Đóng', exact: true }).click()
  expect(await page.evaluate(() => ({ reads: (window as any).financeState.calls.length, acquisitions: (window as any).financeState.directoryAcquisitions }))).toEqual({ reads: 0, acquisitions: 0 })
  await select(page, 'Sổ quỹ')
  await expect(page.locator('.cashbook-panel')).toBeVisible()
  await select(page, 'Tổng quan')
  await expect(page.locator('.business-performance')).toBeVisible()
})

test('keeps branch/search scope between management tabs, clear empty states and lazy ledger history', async ({ page }) => {
  await boot(page)
  await select(page, 'Trả góp')
  await page.getByLabel('Lọc chi nhánh công nợ').selectOption('b')
  await expect(rows(page)).toHaveCount(0)
  await expect(page.getByText('Không có hợp đồng trả góp còn nợ.', { exact: true })).toBeVisible()
  await select(page, 'Bảo lưu')
  await expect(page.getByLabel('Lọc chi nhánh công nợ')).toHaveValue('b')
  await expect.poll(() => ids(page)).toEqual(['preservation'])
  await expect(metric(page)).toHaveText('1 hợp đồng')
  await expect(metric(page, 1)).toHaveText('800.000đ')
  await page.getByLabel('Tìm công nợ').fill('không tìm thấy')
  await page.clock.fastForward(350)
  await expect(page.getByText('Không tìm thấy hồ sơ phù hợp.', { exact: true })).toBeVisible()
  await expect(metric(page, 1)).toHaveText('800.000đ')
  await select(page, 'Công nợ')
  await expect(page.getByLabel('Tìm công nợ')).toHaveValue('không tìm thấy')
  await page.getByRole('button', { name: 'Xóa tìm kiếm', exact: true }).click()
  await page.clock.fastForward(350)
  await expect.poll(() => ids(page)).toEqual(['debt'])
  await page.getByRole('button', { name: 'Mở lịch sử giao dịch', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).financeState.calls.length)).toBe(1)
  expect(await page.evaluate(() => (window as any).financeState.calls[0].query)).toMatchObject({ branchId: 'b', includeSummary: false })
  await page.getByRole('dialog', { name: 'Sổ giao dịch', exact: true }).getByRole('button', { name: 'Đóng', exact: true }).click()
  await select(page, 'Bảo lưu')
  expect(await page.evaluate(() => (window as any).financeState.calls.length)).toBe(1)
})

test('keeps paging bounded and returns to a first page when the group changes', async ({ page }) => {
  await boot(page)
  await seed(page, Array.from({ length: 25 }, (_, index) => ({ ...base, id: `plan-${index}`, studentId: `plan-${index}`, installments: pending })))
  await select(page, 'Trả góp')
  await expect(rows(page)).toHaveCount(20)
  const before = await page.evaluate(() => (window as any).financeState.reportCalls.length)
  await page.getByRole('button', { name: 'Tải thêm hồ sơ', exact: true }).click()
  await expect(rows(page)).toHaveCount(25)
  await expect(page.getByRole('button', { name: 'Tải thêm hồ sơ', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).financeState.reportCalls.length)).toBe(before + 1)
  expect(await page.evaluate(() => (window as any).financeState.reportCalls.at(-1).query)).toMatchObject({ category: 'installments', cursor: '20', includeSummary: false })
  await select(page, 'Bảo lưu')
  await expect(page.getByText('Không có hợp đồng đang bảo lưu.', { exact: true })).toBeVisible()
  await select(page, 'Trả góp')
  await expect(rows(page)).toHaveCount(20)
  expect(await page.evaluate(() => (window as any).financeState.reportCalls.at(-1).query)).toMatchObject({ category: 'installments', cursor: null, includeSummary: true })
})

test('reclassifies inclusive preservation dates with one scoped report at midnight and no ledger read', async ({ page }) => {
  await boot(page)
  await select(page, 'Bảo lưu')
  await expect(rows(page)).toHaveCount(3)
  const before = await page.evaluate(() => (window as any).financeState.reportCalls.length)
  await page.clock.setSystemTime(new Date('2026-11-01T00:01:00+07:00'))
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')) })
  await expect(rows(page)).toHaveCount(2)
  expect(await page.evaluate(() => (window as any).financeState.reportCalls.length)).toBe(before + 1)
  expect(await page.evaluate(() => (window as any).financeState.reportCalls.at(-1).query)).toMatchObject({ category: 'frozen', today: '2026-11-01', cursor: null, includeSummary: true })
  await select(page, 'Trả góp')
  await expect.poll(() => ids(page)).toEqual(['installments', 'ordinary-off', 'preservation'])
  expect(await page.evaluate(() => (window as any).financeState.calls.length)).toBe(0)
})

for (const width of [360, 390, 430, 1440]) {
  test(`keeps all management tabs and contract actions usable without overflow at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await boot(page)
    for (const tab of ['Trả góp', 'Bảo lưu', 'Công nợ']) {
      await select(page, tab)
      await expect(page.getByRole('heading', { name: tab, exact: true })).toBeVisible()
      await expect(rows(page).first()).toBeVisible()
      for (const label of ['Tổng quan', 'Trả góp', 'Bảo lưu', 'Công nợ', 'Sổ quỹ']) await expect(page.getByRole('tab', { name: label, exact: true })).toBeInViewport()
      await expect(page.getByLabel('Tìm công nợ')).toBeVisible()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(1)
      const controls = await rows(page).getByRole('button').evaluateAll(items => items.map(item => ({ width: item.getBoundingClientRect().width, height: item.getBoundingClientRect().height })))
      expect(controls.every(control => control.width >= 50 && control.height >= 29)).toBe(true)
    }
    if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`finance-tabs-${width}.png`), fullPage: true })
  })
}
