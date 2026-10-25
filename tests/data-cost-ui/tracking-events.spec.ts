import { expect, test, type Page } from '@playwright/test'

const reads = (page: Page) => page.evaluate(() => (window as any).costState.reads.tracking)
const active = (page: Page) => page.evaluate(() => (window as any).costState.deliveryObservers.filter((item: any) => item.active).map((item: any) => item.path))
async function open(page: Page, patch: Record<string, unknown> = {}) {
  await page.clock.install()
  await page.addInitScript(patch => { (window as any).costInitial = { trackingSensitive: true, ...patch } }, patch)
  await page.goto('/tests/data-cost-ui/index.html?view=tracking')
}
async function revision(page: Page, n: number) {
  await page.evaluate(n => (window as any).emitDeliveryRevision('eatCleanOrderChanges/order-a', n), n)
  await page.clock.runFor(200)
}
async function visibility(page: Page, visible: boolean) {
  await page.evaluate(visible => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: visible ? 'visible' : 'hidden' }); document.dispatchEvent(new Event('visibilitychange')) }, visible)
}
async function gpsFailure(page: Page, code: string) {
  await page.evaluate(code => (window as any).costState.deliveryObservers.filter((item: any) => item.active && item.path === 'eatCleanLiveLocationViews/order-a').forEach((item: any) => item.error({ code })), code)
  await page.clock.runFor(200)
}

test('idle tracking makes no periodic calls for an hour and unchanged resume keeps the same business snapshot', async ({ page }) => {
  await open(page)
  await expect(page.getByLabel('Mã giao hàng 1234')).toBeVisible()
  expect(await active(page)).toEqual(expect.arrayContaining(['users/owner-a', 'eatCleanOrderChanges/order-a', 'eatCleanLiveLocationViews/order-a']))
  await page.clock.runFor(3600000)
  expect(await reads(page)).toBe(1)
  await visibility(page, false); expect(await active(page)).toEqual([])
  await visibility(page, true); await page.clock.runFor(1000)
  expect(await reads(page)).toBe(1)
  expect((await active(page)).length).toBe(3)
})

test('GPS updates refresh freshness and remove missing points without reloading the order', async ({ page }) => {
  await open(page)
  await expect(page.getByLabel('Mã giao hàng 1234')).toBeVisible()
  await page.clock.runFor(121000)
  await expect(page.locator('.eat-clean-gps-state')).toHaveClass(/is-stale/)
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) (window as any).costState.deliveryObservers.filter((item: any) => item.active && item.path === 'eatCleanLiveLocationViews/order-a').forEach((item: any) => item.next({ binding: 'a'.repeat(64), latitude: 16 + i / 10000, longitude: 108, updatedAt: Date.now(), expiresAt: Date.now() + 86400000 }))
  })
  await expect(page.locator('.eat-clean-gps-state')).not.toHaveClass(/is-stale/)
  expect(await reads(page)).toBe(1)
  await page.evaluate(() => (window as any).costState.deliveryObservers.filter((item: any) => item.active && item.path === 'eatCleanLiveLocationViews/order-a').forEach((item: any) => item.next(null)))
  await expect(page.getByText('Chưa có vị trí shipper', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Mã giao hàng 1234')).toBeVisible()
  expect(await reads(page)).toBe(1)
})

test('a burst of business events coalesces and replayed versions make no extra calls', async ({ page }) => {
  await open(page); await expect(page.getByLabel('Mã giao hàng 1234')).toBeVisible()
  await page.evaluate(() => { for (let n = 1; n <= 30; n++) (window as any).emitDeliveryRevision('eatCleanOrderChanges/order-a', n) })
  await page.clock.runFor(300)
  await expect.poll(() => reads(page)).toBe(2)
  await revision(page, 30); await revision(page, 29)
  expect(await reads(page)).toBe(2)
})

test('an event racing an in-flight response schedules one reconciliation instead of losing the newer revision', async ({ page }) => {
  await open(page); await expect(page.getByLabel('Mã giao hàng 1234')).toBeVisible()
  await page.evaluate(() => (window as any).costState.delayed = true)
  await revision(page, 1); expect(await reads(page)).toBe(2)
  await revision(page, 2); expect(await reads(page)).toBe(2)
  await page.evaluate(() => { (window as any).costState.delayed = false; (window as any).costState.pending.splice(0).forEach((done: () => void) => done()) })
  await page.clock.runFor(300)
  await expect.poll(() => reads(page)).toBe(3)
  await page.clock.runFor(60000); expect(await reads(page)).toBe(3)
})

test('hidden revisions wait and reconcile once on resume, with no hidden location listeners', async ({ page }) => {
  await open(page); await expect(page.getByLabel('Mã giao hàng 1234')).toBeVisible()
  await visibility(page, false)
  await revision(page, 1); await revision(page, 2); await page.clock.runFor(600000)
  expect(await reads(page)).toBe(1); expect(await active(page)).toEqual([])
  await visibility(page, true); await page.clock.runFor(300)
  await expect.poll(() => reads(page)).toBe(2)
})

test('changing accounts fences a late denied response and callbacks from the previous location listener', async ({ page }) => {
  await open(page); await expect(page.getByLabel('Mã giao hàng 1234')).toBeVisible()
  await page.evaluate(() => Object.assign((window as any).costState, { delayed: true, trackingError: 'functions/permission-denied' }))
  await revision(page, 1)
  await page.evaluate(() => Object.assign((window as any).costState, { delayed: false, trackingError: '' }))
  await page.getByRole('button', { name: 'Change tracking account' }).click()
  await expect.poll(() => reads(page)).toBe(3)
  await expect(page.getByLabel('Mã giao hàng 1234')).toBeVisible()
  await page.evaluate(() => {
    const state = (window as any).costState
    state.pending.splice(0).forEach((done: () => void) => done())
    state.deliveryObservers.filter((item: any) => !item.active && item.path === 'eatCleanLiveLocationViews/order-a').forEach((item: any) => { item.next(null); item.error({ code: 'permission-denied' }) })
  })
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page.getByText('Theo dõi vị trí đang hoạt động', { exact: true })).toBeVisible()
  expect((await active(page)).filter((path: string) => path.startsWith('users/'))).toEqual(['users/owner-b'])
})

test('current-profile revocation clears private details and fences a successful in-flight order read', async ({ page }) => {
  await open(page); await expect(page.getByLabel('Mã giao hàng 1234')).toBeVisible()
  await page.evaluate(() => (window as any).costState.delayed = true)
  await revision(page, 1)
  await page.evaluate(() => (window as any).costState.deliveryObservers.filter((item: any) => item.active && item.path === 'users/owner-a').forEach((item: any) => item.next({ role: 'student', disabled: true })))
  await expect(page.getByRole('status')).toContainText('Không thể truy cập')
  await page.evaluate(() => (window as any).costState.pending.splice(0).forEach((done: () => void) => done()))
  await expect(page.getByLabel('Mã giao hàng 1234')).toBeHidden()
  await expect(page.locator('.eat-clean-tracking-map')).toHaveCount(0)
  await visibility(page, false); await visibility(page, true); await page.clock.runFor(600000)
  expect(await reads(page)).toBe(2); expect(await active(page)).toEqual([])
})

test('GPS access revocation reconciles completion once and stops the location stream', async ({ page }) => {
  await open(page); await expect(page.getByLabel('Mã giao hàng 1234')).toBeVisible()
  await page.evaluate(() => (window as any).costState.terminal = true)
  await gpsFailure(page, 'permission-denied')
  await expect.poll(() => reads(page)).toBe(2)
  await expect(page.getByLabel('Mã giao hàng 1234')).toBeHidden()
  expect(await active(page)).not.toContain('eatCleanLiveLocationViews/order-a')
  await expect(page.getByText('Chưa có vị trí shipper', { exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toHaveCount(0)
  await revision(page, 2); await page.clock.runFor(600000)
  expect(await reads(page)).toBe(2)
})

test('a repeatedly denied GPS binding cannot loop; manual recovery attaches a fresh assignment', async ({ page }) => {
  await open(page); await expect(page.getByLabel('Mã giao hàng 1234')).toBeVisible()
  await gpsFailure(page, 'permission-denied')
  await expect.poll(() => reads(page)).toBe(2)
  await expect(page.getByRole('status')).toContainText('Chưa thể cập nhật')
  expect(await active(page)).not.toContain('eatCleanLiveLocationViews/order-a')
  await page.clock.runFor(600000)
  expect(await reads(page)).toBe(2)
  await page.evaluate(() => (window as any).costState.trackingBinding = 'b')
  await page.getByRole('button', { name: 'Làm mới vị trí' }).click()
  await expect.poll(() => reads(page)).toBe(3)
  await expect(page.getByRole('status')).toHaveCount(0)
  expect(await active(page)).toContain('eatCleanLiveLocationViews/order-a')
})

test('a transient GPS listener failure pauses all automatic recovery until explicit refresh', async ({ page }) => {
  await open(page); await expect(page.getByLabel('Mã giao hàng 1234')).toBeVisible()
  await gpsFailure(page, 'unavailable')
  expect(await active(page)).toEqual([]); expect(await reads(page)).toBe(1)
  await revision(page, 1); await visibility(page, false); await visibility(page, true); await page.clock.runFor(600000)
  expect(await reads(page)).toBe(1)
  await page.getByRole('button', { name: 'Làm mới vị trí' }).click()
  await expect.poll(() => reads(page)).toBe(2)
  await expect(page.getByRole('status')).toHaveCount(0)
})

test('a new assignment point arriving before its business event never uses the old shipper identity', async ({ page }) => {
  await open(page); await expect(page.getByLabel('Mã giao hàng 1234')).toBeVisible()
  await page.evaluate(() => {
    const state = (window as any).costState
    state.delayed = true; state.trackingBinding = 'b'
    state.deliveryObservers.filter((item: any) => item.active && item.path === 'eatCleanLiveLocationViews/order-a').forEach((item: any) => item.next({ binding: 'b'.repeat(64), latitude: 17, longitude: 108, updatedAt: Date.now(), expiresAt: Date.now() + 86400000 }))
  })
  await page.clock.runFor(200)
  await expect(page.getByText('Chưa có vị trí shipper', { exact: true })).toBeVisible()
  expect(await reads(page)).toBe(2)
  await page.evaluate(() => { const state = (window as any).costState; state.delayed = false; state.pending.splice(0).forEach((done: () => void) => done()) })
  await expect(page.getByText('Theo dõi vị trí đang hoạt động', { exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toHaveCount(0)
  expect(await reads(page)).toBe(2)
})

test('a delayed business response cannot replace a newer streamed GPS fix with its old position', async ({ page }) => {
  await open(page); await expect(page.getByLabel('Mã giao hàng 1234')).toBeVisible()
  await page.evaluate(() => (window as any).costState.delayed = true)
  await revision(page, 1)
  await page.clock.runFor(121000)
  await expect(page.locator('.eat-clean-gps-state')).toHaveClass(/is-stale/)
  await page.evaluate(() => {
    const state = (window as any).costState
    state.deliveryObservers.filter((item: any) => item.active && item.path === 'eatCleanLiveLocationViews/order-a').forEach((item: any) => item.next({ binding: 'a'.repeat(64), latitude: 16.01, longitude: 108, updatedAt: Date.now(), expiresAt: Date.now() + 86400000 }))
    state.delayed = false; state.pending.splice(0).forEach((done: () => void) => done())
  })
  await expect(page.locator('.eat-clean-gps-state')).not.toHaveClass(/is-stale/)
  await page.clock.runFor(300)
  expect(await reads(page)).toBe(2)
})

test('location expiry removes coordinates locally while offline, without relying on TTL deletion', async ({ page }) => {
  await open(page, { trackingExpiresAt: Date.now() + 20000 })
  await expect(page.getByText('Theo dõi vị trí đang hoạt động', { exact: true })).toBeVisible()
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }); window.dispatchEvent(new Event('offline')) })
  expect(await active(page)).toEqual([])
  await page.clock.runFor(25000)
  await expect(page.getByText('Chưa có vị trí shipper', { exact: true })).toBeVisible()
  expect(await reads(page)).toBe(1)
})

test('missing backend event capability produces one explicit error instead of restoring polling', async ({ page }) => {
  await open(page, { omitTrackingSync: true })
  await expect(page.getByRole('status')).toContainText('Chưa thể cập nhật')
  await page.clock.runFor(600000)
  expect(await reads(page)).toBe(1); expect(await active(page)).toEqual([])
  await expect(page.locator('.eat-clean-tracking-map')).toHaveCount(0)
})

test('an authoritative unassigned response cannot revive the old shipper from the parent order', async ({ page }) => {
  await open(page, { trackingFallback: true })
  await expect(page.getByLabel('Mã giao hàng 1234')).toBeVisible()
  await page.evaluate(() => (window as any).costState.trackingUnassigned = true)
  await revision(page, 1)
  await expect(page.getByText('Đang chờ shipper nhận đơn', { exact: true })).toBeVisible()
  await expect(page.getByText('Fallback driver', { exact: true })).toBeHidden()
  await expect(page.getByLabel('Mã giao hàng 1234')).toBeHidden()
  await expect(page.getByText('Chưa có vị trí shipper', { exact: true })).toBeVisible()
  expect(await reads(page)).toBe(2)
})
