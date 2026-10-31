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
  { ...base, id: 'frozen-overpaid', studentId: 'frozen-overpaid', status: 'frozen', paidAmount: 1_200_000 },
  { ...base, id: 'preservation', studentId: 'preservation', branchId: 'b', installments: pending, pausePeriods: [{ type: 'preservation', startDate: '2026-10-30', endDate: '2026-10-31' }] },
  { ...base, id: 'preservation-paid', studentId: 'preservation-paid', paidAmount: 1_000_000, pausePeriods: [{ type: 'preservation', startDate: '2026-10-30', endDate: '2026-10-31' }] },
  { ...base, id: 'preservation-overpaid', studentId: 'preservation-overpaid', paidAmount: 1_200_000, pausePeriods: [{ type: 'preservation', startDate: '2026-10-30', endDate: '2026-10-31' }] },
  ...['cancelled', 'inactive', 'archived', 'draft'].map(status => ({ ...base, id: `stale-pause-${status}`, studentId: `stale-pause-${status}`, status, pausePeriods: [{ type: 'preservation', startDate: '2026-10-30', endDate: '2026-10-31' }] })),
  { ...base, id: 'ordinary-off', studentId: 'ordinary-off', installments: pending, pausePeriods: [{ type: 'off', startDate: '2026-10-30', endDate: '2026-10-31' }] },
  { ...base, id: 'debt', studentId: 'debt', branchId: 'b', nextPaymentDate: '2026-10-30' },
  { ...base, id: 'cancelled', studentId: 'cancelled', status: 'cancelled', installments: pending },
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
  await page.goto('/tests/finance-history-ui/index.html?workspace=hub&initialTab=overview')
  await expect(page.locator('.business-performance')).toBeVisible()
  await seed(page)
}
async function select(page: Page, name: string) {
  if (name === 'Bảo lưu') {
    await page.getByRole('tab', { name: 'Trả góp', exact: true }).click()
    await filters(page).getByRole('button', { name: 'Bảo lưu', exact: true }).click()
    await expect(filters(page).getByRole('button', { name: 'Bảo lưu', exact: true })).toHaveAttribute('aria-pressed', 'true')
    return
  }
  await page.getByRole('tab', { name, exact: true }).click()
  await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel')).toHaveAccessibleName(name)
  if (name === 'Trả góp') await filters(page).getByRole('button', { name: 'Đang nợ', exact: true }).click()
}
async function ids(page: Page) {
  return rows(page).evaluateAll(elements => elements.map(element => element.getAttribute('title')?.replace('Hợp đồng ', '')).sort())
}

test('shows only preserved outstanding debt and removes the debt tab without broadening installments', async ({ page }) => {
  await boot(page)
  await expect(page.getByRole('tablist', { name: 'Phân hệ tài chính' }).getByRole('tab')).toHaveCount(3)
  await expect(page.getByRole('tab', { name: 'Công nợ', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).financeState.directoryAcquisitions)).toBe(0)
  await page.getByRole('tab', { name: 'Báo cáo kỳ', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Trả góp', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(rows(page)).toHaveCount(2)
  await expect.poll(() => ids(page)).toEqual(['installments', 'ordinary-off'])
  await expect(metric(page)).toHaveText('1.600.000đ')
  await expect(filters(page).getByRole('button', { name: 'Tuần này', exact: true })).toBeVisible()
  await expect(metric(page, 1)).toHaveText('200.000đ')
  expect(await page.evaluate(() => (window as any).financeState.directoryAcquisitions)).toBe(0)

  await select(page, 'Bảo lưu')
  await expect.poll(() => ids(page)).toEqual(['frozen', 'preservation'])
  await expect(metric(page)).toHaveText('2 hợp đồng')
  await expect(metric(page, 1)).toHaveText('1.600.000đ')
  await expect(page.locator('.finance-management .aura-metric-carousel__slide')).toHaveCount(2)
  await expect(filters(page).getByRole('button')).toHaveCount(5)
  await expect(filters(page).getByRole('button', { name: 'Thanh toán dư', exact: true })).toHaveCount(0)
  for (const id of ['frozen-paid', 'frozen-overpaid', 'preservation-paid', 'preservation-overpaid', 'stale-pause-cancelled', 'stale-pause-inactive', 'stale-pause-archived', 'stale-pause-draft']) await expect(page.locator(`article[title="Hợp đồng ${id}"]`)).toHaveCount(0)
  await expect(page.locator('article[title="Hợp đồng frozen"]')).toContainText('Bảo lưu từ 15/10/2026')
  await expect(page.locator('.finance-management__receivables-list article.is-overdue')).toHaveCount(0)
  await select(page, 'Trả góp')
  await expect.poll(() => ids(page)).toEqual(['installments', 'ordinary-off'])
  expect(await page.evaluate(() => ({ reads: (window as any).financeState.calls.length, acquisitions: (window as any).financeState.directoryAcquisitions }))).toEqual({ reads: 0, acquisitions: 0 })
  await select(page, 'Sổ quỹ')
  await expect(page.locator('.cashbook-panel')).toBeVisible()
  await select(page, 'Báo cáo kỳ')
  await expect(page.locator('.business-performance')).toBeVisible()
})

test('opens legacy preserved links inside installments without a separate top-level tab', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-30T12:00:00+07:00') })
  await page.goto('/tests/finance-history-ui/index.html?workspace=hub&initialTab=frozen')
  await expect(page.getByRole('tab', { name: 'Trả góp', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: 'Bảo lưu', exact: true })).toHaveCount(0)
  await expect(filters(page).getByRole('button', { name: 'Bảo lưu', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(rows(page)).toHaveCount(1)
  expect(await page.evaluate(() => (window as any).financeState.reportCalls.at(-1).query)).toMatchObject({ category: 'frozen', cursor: null })
  await filters(page).getByRole('button', { name: 'Đang nợ', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Trả góp', exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).financeState.reportCalls.at(-1).query)).toMatchObject({ category: 'installments', cursor: null })
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
  await select(page, 'Trả góp')
  await expect(page.getByLabel('Tìm công nợ')).toHaveValue('không tìm thấy')
  await page.getByRole('button', { name: 'Xóa tìm kiếm', exact: true }).click()
  await page.clock.fastForward(350)
  await expect(page.getByText('Không có hợp đồng trả góp còn nợ.', { exact: true })).toBeVisible()
  await select(page, 'Bảo lưu')
  await expect.poll(() => ids(page)).toEqual(['preservation'])
  await page.getByRole('button', { name: 'Mở lịch sử giao dịch', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).financeState.calls.length)).toBe(1)
  expect(await page.evaluate(() => (window as any).financeState.calls[0].query)).toMatchObject({ branchId: 'b', includeSummary: false })
  await page.getByRole('dialog', { name: 'Sổ giao dịch', exact: true }).getByRole('button', { name: 'Đóng', exact: true }).click()
  await select(page, 'Trả góp')
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
  await expect(page.getByText('Không có hợp đồng bảo lưu còn nợ.', { exact: true })).toBeVisible()
  await select(page, 'Trả góp')
  await expect(rows(page)).toHaveCount(20)
  expect(await page.evaluate(() => (window as any).financeState.reportCalls.at(-1).query)).toMatchObject({ category: 'installments', cursor: null, includeSummary: true })
})

test('reclassifies inclusive preservation dates with one scoped report at midnight and no ledger read', async ({ page }) => {
  await boot(page)
  await select(page, 'Bảo lưu')
  await expect(rows(page)).toHaveCount(2)
  const before = await page.evaluate(() => (window as any).financeState.reportCalls.length)
  await page.clock.setSystemTime(new Date('2026-11-01T00:01:00+07:00'))
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')) })
  await expect(rows(page)).toHaveCount(1)
  expect(await page.evaluate(() => (window as any).financeState.reportCalls.length)).toBe(before + 1)
  expect(await page.evaluate(() => (window as any).financeState.reportCalls.at(-1).query)).toMatchObject({ category: 'frozen', today: '2026-11-01', cursor: null, includeSummary: true })
  await select(page, 'Trả góp')
  await expect.poll(() => ids(page)).toEqual(['installments', 'ordinary-off', 'preservation'])
  expect(await page.evaluate(() => (window as any).financeState.calls.length)).toBe(0)
})

test('refreshes preserved counts and empty state after balances become settled or overpaid', async ({ page }) => {
  await boot(page)
  await select(page, 'Bảo lưu')
  await expect.poll(() => ids(page)).toEqual(['frozen', 'preservation'])
  const before = await page.evaluate(() => (window as any).financeState.reportCalls.length)
  await page.evaluate(() => (window as any).financeState.updateContract('frozen', { paidAmount: 1_000_000 }))
  expect(await page.evaluate(() => (window as any).financeState.reportCalls.length)).toBe(before)
  await page.getByRole('button', { name: 'Làm mới bảo lưu', exact: true }).click()
  await expect.poll(() => ids(page)).toEqual(['preservation'])
  expect(await page.evaluate(() => (window as any).financeState.reportCalls.length)).toBe(before + 1)
  expect(await page.evaluate(() => (window as any).financeState.reportCalls.at(-1).query)).toMatchObject({ category: 'frozen', refresh: true, includeSummary: true, cursor: null })
  await expect(metric(page)).toHaveText('1 hợp đồng')
  await expect(metric(page, 1)).toHaveText('800.000đ')
  await page.evaluate(() => (window as any).financeState.updateContract('preservation', { paidAmount: 1_200_000 }))
  await page.getByRole('button', { name: 'Làm mới bảo lưu', exact: true }).click()
  await expect(rows(page)).toHaveCount(0)
  await expect(metric(page)).toHaveText('0 hợp đồng')
  await expect(metric(page, 1)).toHaveText('0đ')
  expect(await page.evaluate(() => (window as any).financeState.reportCalls.length)).toBe(before + 2)
  await expect(page.getByText('Không có hợp đồng bảo lưu còn nợ.', { exact: true })).toBeVisible()
  await select(page, 'Trả góp')
  await expect.poll(() => ids(page)).toEqual(['installments', 'ordinary-off'])
  expect(await page.evaluate(() => ({ payments: (window as any).financeState.payments, refunds: (window as any).financeState.refunds, ledger: (window as any).financeState.calls.length }))).toEqual({ payments: 0, refunds: 0, ledger: 0 })
})

for (const width of [360, 390, 430, 1440]) {
  test(`keeps all management tabs and contract actions usable without overflow at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await boot(page)
    for (const tab of ['Trả góp', 'Bảo lưu']) {
      await select(page, tab)
      await expect(page.getByRole('heading', { name: tab, exact: true })).toBeVisible()
      await expect(rows(page).first()).toBeVisible()
      for (const label of ['Báo cáo kỳ', 'Trả góp', 'Sổ quỹ']) await expect(page.getByRole('tab', { name: label, exact: true })).toBeInViewport()
      await expect(page.getByRole('tab', { name: 'Công nợ', exact: true })).toHaveCount(0)
      await expect(page.getByLabel('Tìm công nợ')).toBeVisible()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(1)
      const controls = await rows(page).getByRole('button').evaluateAll(items => items.map(item => ({ width: item.getBoundingClientRect().width, height: item.getBoundingClientRect().height })))
      expect(controls.every(control => control.width >= 50 && control.height >= 29)).toBe(true)
      if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`finance-${tab === 'Trả góp' ? 'installments' : 'preserved'}-${width}.png`), fullPage: true })
    }
  })
}
