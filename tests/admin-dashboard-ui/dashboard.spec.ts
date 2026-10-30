import { expect, test, type Page } from '@playwright/test'

async function calls(page: Page, type: string) {
  return page.evaluate((kind) => (window as any).dashboardFixture.calls.filter((call: any) => call.type === kind), type)
}
async function hold(page: Page, key: string) {
  await page.evaluate((value) => (window as any).dashboardFixture.hold.push(value), key)
}
async function release(page: Page, id: number, reject = false) {
  await page.evaluate(({ id, reject }) => (window as any).dashboardFixture.release(id, reject), { id, reject })
}

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/admin-dashboard-ui/index.html')
  await expect(page.getByRole('button', { name: 'Làm mới tổng quan' })).toBeEnabled()
})

test('cancellation reconciliation warning survives normalization and respects quality permission', async ({ page }) => {
  await page.evaluate(() => { (window as any).dashboardFixture.quality = { cancelledSettlementReviewRequired: 2, cancelledSalesBaselineUnverified: 5 } })
  await page.getByRole('button', { name: 'Làm mới tổng quan' }).click()
  const warning = page.getByRole('note', { name: 'Đối soát hợp đồng đã hủy' })
  await expect(warning).toContainText('2 cần rà soát quyết toán; 5 chưa xác minh doanh số ký gốc')
  await expect(warning.getByRole('button', { name: 'Mở Học viên' })).toBeVisible()
  expect(await calls(page, 'dashboard')).toHaveLength(2)
  await page.evaluate(() => { (window as any).dashboardFixture.canViewQuality = false })
  await page.getByRole('button', { name: 'Làm mới tổng quan' }).click()
  await expect(warning).toHaveCount(0)
})

test('opening and scrolling dashboard uses one aggregate read; payroll reads require explicit choices', async ({ page }) => {
  const open = page.getByRole('button', { name: 'Xem thu nhập nhân sự' })
  await open.scrollIntoViewIfNeeded()
  await page.waitForTimeout(350)
  expect(await calls(page, 'dashboard')).toHaveLength(1)
  expect(await calls(page, 'roster')).toHaveLength(0)
  expect(await calls(page, 'statement')).toHaveLength(0)
  await open.click()
  await expect(page.getByText('Chọn nhân sự để xem thu nhập')).toBeVisible()
  expect(await calls(page, 'roster')).toHaveLength(1)
  expect(await calls(page, 'statement')).toHaveLength(0)
  await page.getByRole('tab', { name: /PT An/ }).click()
  await expect(page.getByRole('img', { name: /Biểu đồ thu nhập PT An/ })).toBeVisible()
  expect(await calls(page, 'statement')).toHaveLength(1)
  await page.getByRole('button', { name: 'Tháng này', exact: true }).click()
  await page.getByRole('option', { name: 'Hôm qua', exact: true }).click()
  await expect.poll(async () => (await calls(page, 'dashboard')).length).toBe(2)
  await expect(page.getByRole('img', { name: /Biểu đồ thu nhập PT An/ })).toBeVisible()
  expect(await calls(page, 'roster')).toHaveLength(1)
  expect(await calls(page, 'statement')).toHaveLength(1)
  await page.getByRole('button', { name: 'Làm mới tổng quan' }).click()
  await expect.poll(async () => (await calls(page, 'dashboard')).length).toBe(3)
  expect((await calls(page, 'dashboard'))[2].input.forceRefresh).toBe(true)
  expect(await calls(page, 'roster')).toHaveLength(1)
})

test('branch switches hide old totals immediately and ignore a late response or error', async ({ page }) => {
  await hold(page, 'dashboard:branch-a')
  await page.getByRole('combobox').selectOption('branch-a')
  await expect(page.getByText('111.111đ', { exact: true })).toHaveCount(0)
  await expect.poll(async () => (await calls(page, 'dashboard')).length).toBe(2)
  const stale = (await calls(page, 'dashboard'))[1].id
  await page.getByRole('combobox').selectOption('branch-b')
  await expect(page.getByText('333.333đ', { exact: true })).toBeVisible()
  await release(page, stale)
  await expect(page.getByText('333.333đ', { exact: true })).toBeVisible()
  await expect(page.getByText('222.222đ', { exact: true })).toHaveCount(0)

  await page.getByRole('combobox').selectOption('branch-a')
  await expect.poll(async () => (await calls(page, 'dashboard')).length).toBe(4)
  const staleError = (await calls(page, 'dashboard'))[3].id
  await page.getByRole('combobox').selectOption('branch-b')
  await expect(page.getByText('333.333đ', { exact: true })).toBeVisible()
  await release(page, staleError, true)
  await expect(page.getByText('Late response failed')).toHaveCount(0)
})

test('payroll ignores old staff statements and resets to unopened when branch changes', async ({ page }) => {
  await page.getByRole('button', { name: 'Xem thu nhập nhân sự' }).click()
  await hold(page, 'statement:staff-a')
  await page.getByRole('tab', { name: /PT An/ }).click()
  await expect.poll(async () => (await calls(page, 'statement')).length).toBe(1)
  const stale = (await calls(page, 'statement'))[0].id
  await page.getByRole('tab', { name: /PT Bình/ }).click()
  await expect(page.getByRole('img', { name: /Biểu đồ thu nhập PT Bình/ })).toBeVisible()
  await release(page, stale)
  await expect(page.getByRole('img', { name: /Biểu đồ thu nhập PT Bình.*5.000.000/ })).toBeVisible()
  await page.getByRole('combobox').selectOption('branch-b')
  await expect(page.getByRole('button', { name: 'Xem thu nhập nhân sự' })).toBeVisible()
  expect(await calls(page, 'roster')).toHaveLength(1)
  expect(await calls(page, 'statement')).toHaveLength(2)
})

test('account and permission changes discard pending dashboard and payroll data', async ({ page }) => {
  await page.getByRole('button', { name: 'Xem thu nhập nhân sự' }).click()
  await hold(page, 'statement:staff-a')
  await page.getByRole('tab', { name: /PT An/ }).click()
  await expect.poll(async () => (await calls(page, 'statement')).length).toBe(1)
  const stale = (await calls(page, 'statement'))[0].id
  await hold(page, 'dashboard:all')
  await page.getByRole('button', { name: 'Làm mới tổng quan' }).click()
  await expect.poll(async () => (await calls(page, 'dashboard')).length).toBe(2)
  const staleDashboard = (await calls(page, 'dashboard'))[1].id
  await page.evaluate(() => { const fixture = (window as any).dashboardFixture; fixture.hold = []; fixture.changeAuth('admin-b') })
  await expect(page.getByText('444.444đ', { exact: true })).toBeVisible()
  await release(page, stale)
  await release(page, staleDashboard)
  await expect(page.getByText('111.111đ', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Xem thu nhập nhân sự' })).toBeVisible()
  expect(await calls(page, 'roster')).toHaveLength(1)
  await page.evaluate(() => (window as any).dashboardFixture.changeAuth('admin-b', 2))
  await expect.poll(async () => (await calls(page, 'dashboard')).length).toBe(4)
  expect(await calls(page, 'roster')).toHaveLength(1)
})

test('an auth context for another UID or an inactive account cannot issue dashboard reads', async ({ page }) => {
  await hold(page, 'dashboard:all')
  await page.getByRole('button', { name: 'Làm mới tổng quan' }).click()
  await expect.poll(async () => (await calls(page, 'dashboard')).length).toBe(2)
  const old = (await calls(page, 'dashboard'))[1].id
  await page.evaluate(() => (window as any).dashboardFixture.changeAuthority({ userUid: 'admin-b' }))
  await expect(page.getByRole('status')).toHaveText('Đang kiểm tra quyền xem tổng quan…')
  await release(page, old)
  await expect(page.getByText('111.111đ', { exact: true })).toHaveCount(0)
  expect(await calls(page, 'dashboard')).toHaveLength(2)
  await page.evaluate(() => { const fixture = (window as any).dashboardFixture; fixture.hold = []; fixture.changeAuthority({ accessUid: 'admin-b' }) })
  await expect(page.getByText('444.444đ', { exact: true })).toBeVisible()
  for (const status of ['suspended', 'invited']) {
    const before = (await calls(page, 'dashboard')).length
    await page.evaluate((status) => (window as any).dashboardFixture.changeAuthority({ status }), status)
    await expect(page.getByRole('status')).toHaveText('Đang kiểm tra quyền xem tổng quan…')
    expect(await calls(page, 'dashboard')).toHaveLength(before)
    await page.evaluate(() => (window as any).dashboardFixture.changeAuthority({ status: 'active' }))
    await expect.poll(async () => (await calls(page, 'dashboard')).length).toBe(before + 1)
  }
})

test('branch and capability changes at the same authorization version retire prior dashboard and payroll state', async ({ page }) => {
  await page.getByRole('button', { name: 'Xem thu nhập nhân sự' }).click()
  await hold(page, 'statement:staff-a')
  await page.getByRole('tab', { name: /PT An/ }).click()
  await expect.poll(async () => (await calls(page, 'statement')).length).toBe(1)
  const oldStatement = (await calls(page, 'statement'))[0].id
  await hold(page, 'dashboard:all')
  await page.evaluate(() => (window as any).dashboardFixture.changeAuthority({ branchIds: ['branch-b'] }))
  await expect(page.getByText('111.111đ', { exact: true })).toHaveCount(0)
  await expect.poll(async () => (await calls(page, 'dashboard')).length).toBe(2)
  await release(page, (await calls(page, 'dashboard'))[1].id)
  await release(page, oldStatement)
  await expect(page.getByRole('button', { name: 'Xem thu nhập nhân sự' })).toBeVisible()
  await expect(page.getByRole('img', { name: /Biểu đồ thu nhập PT An/ })).toHaveCount(0)
  expect(await calls(page, 'roster')).toHaveLength(1)
  await page.evaluate(() => { const fixture = (window as any).dashboardFixture; fixture.hold = []; fixture.changeAuthority({ capabilities: ['dashboard.view'] }) })
  await expect.poll(async () => (await calls(page, 'dashboard')).length).toBe(3)
  await expect(page.getByRole('button', { name: 'Xem thu nhập nhân sự' })).toHaveCount(0)
  expect(await calls(page, 'roster')).toHaveLength(1)
  expect(await calls(page, 'statement')).toHaveLength(1)
})
