import { expect, test, type Page } from '@playwright/test'

async function open(page: Page, options: Record<string, unknown> = {}, observer: 'controlled' | 'native' | 'missing' = 'controlled') {
  await page.clock.install({ time: new Date('2026-10-24T09:00:00+07:00') })
  await page.addInitScript(({ options, observer }) => {
    ;(window as any).dashboardOptions = options
    if (observer === 'missing') { (window as any).IntersectionObserver = undefined; return }
    if (observer === 'native') return
    const watchers = new Set<any>()
    ;(window as any).IntersectionObserver = class {
      element: Element | null = null
      callback: any
      constructor(callback: any) { this.callback = callback }
      observe(element: Element) { this.element = element; watchers.add(this) }
      disconnect() { watchers.delete(this) }
    }
    ;(window as any).revealDashboard = (kind: string) => {
      for (const watcher of [...watchers]) if (watcher.element?.matches(`.staff-dashboard__${kind}`)) watcher.callback([{ isIntersecting: true, target: watcher.element }])
    }
  }, { options, observer })
  await page.goto('/tests/staff-dashboard-ui/index.html')
  await expect(page.getByTestId('staff-dashboard-page')).toBeVisible()
}
async function counts(page: Page) {
  return page.evaluate(() => {
    const counts = { workspace: 0, payroll: 0, performance: 0, sales: 0, actions: 0, summary: 0 }
    for (const call of (window as any).dashboardHarness.calls) counts[call.kind as keyof typeof counts]++
    return counts
  })
}
async function reveal(page: Page, kind: string) { await page.evaluate((kind) => (window as any).revealDashboard(kind), kind) }
const initial = { workspace: 1, payroll: 0, performance: 0, sales: 0, actions: 0, summary: 0 }

test('initial PT dashboard only reads today once, including StrictMode effect replay and dual PT/Sales role', async ({ page }) => {
  await open(page, { positions: ['trainer_pt', 'sales'] })
  await expect(page.getByText('pt-a Student', { exact: true })).toBeVisible()
  expect(await counts(page)).toEqual(initial)
  await page.getByRole('button', { name: 'Tải lại tổng quan Staff' }).click()
  await expect.poll(() => counts(page)).toEqual({ ...initial, workspace: 2 })
  await page.getByRole('group', { name: 'Lọc ca hôm nay' }).getByRole('button', { name: 'Chờ xác nhận', exact: false }).click()
  expect(await counts(page)).toEqual({ ...initial, workspace: 2 })
})

test('each monthly panel loads on first visibility and retry reads only the failed panel', async ({ page }) => {
  await open(page, { failFirst: ['payroll'] })
  await reveal(page, 'payroll')
  const payroll = page.getByRole('region', { name: 'Biểu đồ lương và tiền ca dạy trong tháng' })
  await expect(payroll.getByText('Retry payroll')).toBeVisible()
  expect(await counts(page)).toEqual({ ...initial, payroll: 1 })
  await payroll.getByRole('button', { name: 'Thử lại' }).click()
  await expect(payroll.getByText('123.000đ', { exact: true })).toBeVisible()
  expect(await counts(page)).toEqual({ ...initial, payroll: 2 })
  await reveal(page, 'performance')
  await expect(page.getByText('pt-a Strong')).toBeVisible()
  expect(await counts(page)).toEqual({ ...initial, payroll: 2, performance: 1 })
  await reveal(page, 'performance')
  expect(await counts(page)).toEqual({ ...initial, payroll: 2, performance: 1 })
})

test('slow monthly panels do not block today or refresh; repeated refresh coalesces their pending requests', async ({ page }) => {
  await open(page, { defer: ['payroll', 'performance'] })
  await reveal(page, 'payroll')
  await reveal(page, 'performance')
  await expect(page.getByText('pt-a Student', { exact: true })).toBeVisible()
  const refresh = page.getByRole('button', { name: 'Tải lại tổng quan Staff' })
  await expect(refresh).toBeEnabled()
  await refresh.click()
  await expect.poll(() => counts(page)).toEqual({ ...initial, workspace: 2, payroll: 1, performance: 1 })
  await page.evaluate(() => { (window as any).dashboardHarness.resolve('payroll'); (window as any).dashboardHarness.resolve('performance') })
  await expect(page.getByText('pt-a Strong')).toBeVisible()
  await refresh.click()
  await expect.poll(() => counts(page)).toEqual({ ...initial, workspace: 3, payroll: 2, performance: 2 })
})

test('day rollover reads only today; month rollover refreshes only already visible monthly panels', async ({ page }) => {
  await open(page)
  await reveal(page, 'payroll')
  await expect(page.getByText('123.000đ', { exact: true })).toBeVisible()
  await page.clock.setSystemTime(new Date('2026-10-25T00:01:00+07:00'))
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect.poll(() => counts(page)).toEqual({ ...initial, workspace: 2, payroll: 1 })
  await page.clock.setSystemTime(new Date('2026-11-01T00:01:00+07:00'))
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect.poll(() => counts(page)).toEqual({ ...initial, workspace: 3, payroll: 2 })
  expect(await page.evaluate(() => (window as any).dashboardHarness.calls.filter((call: any) => call.kind === 'payroll').map((call: any) => call.key))).toEqual(['2026-10', '2026-11'])
})

test('account switch drops old private values and ignores older in-flight responses', async ({ page }) => {
  await open(page, { defer: ['workspace', 'performance'] })
  await reveal(page, 'performance')
  await expect.poll(() => counts(page)).toEqual({ ...initial, performance: 1 })
  await page.evaluate(() => (window as any).dashboardHarness.update({ uid: 'pt-b' }))
  await expect.poll(() => counts(page)).toEqual({ ...initial, workspace: 2, performance: 1 })
  await reveal(page, 'performance')
  await expect.poll(() => counts(page)).toEqual({ ...initial, workspace: 2, performance: 2 })
  await page.evaluate(() => { (window as any).dashboardHarness.resolve('workspace', 'pt-b'); (window as any).dashboardHarness.resolve('performance', 'pt-b') })
  await expect(page.getByText('pt-b Student', { exact: true })).toBeVisible()
  await expect(page.getByText('pt-b Strong')).toBeVisible()
  await page.evaluate(() => { (window as any).dashboardHarness.resolve('workspace', 'pt-a'); (window as any).dashboardHarness.resolve('performance', 'pt-a') })
  await expect(page.getByText('pt-a Student', { exact: true })).toHaveCount(0)
  await expect(page.getByText('pt-a Strong')).toHaveCount(0)
  await expect(page.getByText('pt-b Strong')).toBeVisible()
})

test('branch and authority changes reset scope, remove revoked panels, and never read a suspended actor', async ({ page }) => {
  await open(page)
  await reveal(page, 'performance')
  await expect(page.getByText('pt-a Strong')).toBeVisible()
  await page.evaluate(() => (window as any).dashboardHarness.update({ branches: ['branch-b'], capabilities: [] }))
  await expect.poll(() => counts(page)).toEqual({ ...initial, workspace: 2, performance: 1 })
  await expect(page.getByText('pt-a Strong')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Xem thu nhập', exact: true })).toHaveCount(0)
  await page.evaluate(() => (window as any).dashboardHarness.update({ active: false }))
  await expect(page.getByText('pt-a Student', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Tải lại tổng quan Staff' }).click()
  expect(await counts(page)).toEqual({ ...initial, workspace: 2, performance: 1 })
})

test('missing IntersectionObserver still loads permitted monthly cards', async ({ page }) => {
  await open(page, {}, 'missing')
  await expect(page.getByText('pt-a Strong')).toBeVisible()
  expect(await counts(page)).toEqual({ ...initial, payroll: 1, performance: 1 })
})

test('manual panel action is usable without observer notification and performance retry remains isolated', async ({ page }) => {
  await open(page, { failFirst: ['performance'] })
  await page.getByRole('button', { name: 'Xem hiệu suất', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Tóm tắt Aura PT Performance Score' })
  await expect(panel.getByText('Retry performance')).toBeVisible()
  await panel.getByRole('button', { name: 'Thử lại' }).click()
  await expect(page.getByText('pt-a Strong')).toBeVisible()
  expect(await counts(page)).toEqual({ ...initial, performance: 2 })
})

test('late prior-month response cannot replace the new monthly payroll or leak its old chart', async ({ page }) => {
  await open(page, { defer: ['payroll'] })
  await reveal(page, 'payroll')
  await expect.poll(() => counts(page)).toEqual({ ...initial, payroll: 1 })
  await page.clock.setSystemTime(new Date('2026-11-01T00:01:00+07:00'))
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect.poll(() => counts(page)).toEqual({ ...initial, workspace: 2, payroll: 2 })
  await page.evaluate(() => (window as any).dashboardHarness.resolve('payroll', 'pt-a', '2026-11'))
  await expect(page.getByText('456.000đ', { exact: true })).toBeVisible()
  await page.evaluate(() => (window as any).dashboardHarness.resolve('payroll', 'pt-a', '2026-10'))
  await expect(page.getByText('123.000đ', { exact: true })).toHaveCount(0)
  await expect(page.getByText('456.000đ', { exact: true })).toBeVisible()
})

test('native viewport loading works on mobile and preserves bounded-result warning', async ({ page }) => {
  await open(page, { hasMore: true }, 'native')
  await expect(page.getByText('Dữ liệu vượt giới hạn xem nhanh')).toBeVisible()
  await page.getByRole('region', { name: 'Biểu đồ lương và tiền ca dạy trong tháng' }).scrollIntoViewIfNeeded()
  await expect(page.getByText('123.000đ', { exact: true })).toBeVisible()
  expect((await counts(page)).payroll).toBe(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('demo sends no private callable including the optional action center', async ({ page }) => {
  await open(page, { demo: true, actionCenter: true }, 'missing')
  await expect(page.getByText('Nguyễn Minh Anh · Trần Thu Hà', { exact: true })).toBeVisible()
  expect(await counts(page)).toEqual({ ...initial, workspace: 0 })
})
