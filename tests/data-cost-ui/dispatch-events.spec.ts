import { expect, test, type Page } from '@playwright/test'

const calls = (page: Page) => page.evaluate(() => (window as any).costState.dispatchCalls)
const active = (page: Page) => page.evaluate(() => (window as any).costState.deliveryObservers.filter((item: any) => item.active).map((item: any) => item.path))
const job = { id: 'order-a', orderCode: 'ORDER-A', shipperId: 'driver', status: 'accepted', locationStream: { enabled: true, binding: 'a'.repeat(64) }, dropoff: { name: 'Private customer', addressLine: 'Private address', coordinate: { latitude: 16.01, longitude: 108.01 } } }
async function open(page: Page, patch: Record<string, unknown> = {}, at?: string) {
  await page.clock.install(at ? { time: new Date(at) } : {})
  await page.addInitScript(patch => { (window as any).costInitial = patch }, patch)
  await page.goto('/tests/data-cost-ui/index.html?view=dispatch')
}
const ready = (page: Page) => expect(page.getByText('Cập nhật khi có thay đổi', { exact: true })).toBeVisible()
async function emit(page: Page, path: string, value: unknown) {
  await page.evaluate(({ path, value }) => (window as any).costState.deliveryObservers.filter((item: any) => item.active && item.path === path).forEach((item: any) => item.next(value)), { path, value })
}
async function revisions(page: Page, sections: string[], n: number) {
  await page.evaluate(({ sections, n }) => sections.forEach(key => (window as any).emitDeliveryRevision(`eatCleanWorkspaceChanges/${key}`, n)), { sections, n })
  await page.clock.runFor(250)
}
async function visibility(page: Page, visible: boolean, online = true) {
  await page.evaluate(({ visible, online }) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: visible ? 'visible' : 'hidden' })
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: online })
    document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event(online ? 'online' : 'offline'))
  }, { visible, online })
}

test('idle dispatch and unchanged hidden/offline resume do one bootstrap with no periodic business calls', async ({ page }) => {
  await open(page); await ready(page)
  await page.clock.runFor(3600000)
  expect(await calls(page)).toEqual([['jobs', 'roster', 'config', 'signals']])
  await visibility(page, false); expect(await active(page)).toEqual([])
  await visibility(page, true, false); await page.clock.runFor(600000)
  expect(await active(page)).toEqual([])
  await visibility(page, true); await page.clock.runFor(1000)
  expect(await calls(page)).toHaveLength(1)
  expect(await active(page)).toContain('users/admin-a')
})

test('events hydrate only changed sections and coalesce a burst into a single combined request', async ({ page }) => {
  await open(page); await ready(page)
  await revisions(page, ['jobs'], 1)
  await expect.poll(() => calls(page)).toHaveLength(2)
  await revisions(page, ['roster'], 1)
  await expect.poll(() => calls(page)).toHaveLength(3)
  await revisions(page, ['config'], 1)
  await expect.poll(() => calls(page)).toHaveLength(4)
  await page.evaluate(() => { for (let n = 2; n <= 20; n++) ['jobs', 'roster'].forEach(key => (window as any).emitDeliveryRevision(`eatCleanWorkspaceChanges/${key}`, n)) })
  await page.clock.runFor(300)
  await expect.poll(() => calls(page)).toHaveLength(5)
  expect((await calls(page)).slice(1)).toEqual([['jobs'], ['roster'], ['config'], ['jobs', 'roster']])
  await revisions(page, ['jobs', 'roster'], 20); await revisions(page, ['jobs'], 19)
  expect(await calls(page)).toHaveLength(5)
})

test('GPS and daily counters update separately without loading any business section', async ({ page }) => {
  await open(page, { dispatchJobs: [job] }); await ready(page)
  await expect.poll(() => active(page)).toContain('eatCleanLiveLocationViews/order-a')
  for (let i = 0; i < 20; i++) await emit(page, 'eatCleanLiveLocationViews/order-a', { binding: 'a'.repeat(64), latitude: 16 + i / 10000, longitude: 108, updatedAt: await page.evaluate(() => Date.now()), expiresAt: await page.evaluate(() => Date.now() + 86400000) })
  await expect(page.locator('.eat-clean-dispatch-pin.driver')).toHaveCount(1)
  const day = await page.evaluate(() => new Date(Date.now() + 25200000).toISOString().slice(0, 10))
  await emit(page, `eatCleanOperationalSignals/${day}`, 7)
  await expect(page.locator('.eat-clean-operations-signals article').filter({ hasText: 'MAPS' }).locator('strong')).toHaveText('7')
  expect(await calls(page)).toHaveLength(1)
  await emit(page, 'eatCleanLiveLocationViews/order-a', null)
  await expect(page.locator('.eat-clean-dispatch-pin.driver')).toHaveCount(0)
  expect(await calls(page)).toHaveLength(1)
})

test('settings detach live sources, preserve drafts on config changes, and reconcile jobs only on return', async ({ page }) => {
  await open(page, { dispatchJobs: [job] }); await ready(page)
  await page.getByRole('tab', { name: 'Phí giao & SLA' }).click()
  await expect.poll(() => active(page)).toEqual(['users/admin-a', 'eatCleanWorkspaceChanges/config'])
  await page.getByLabel('Tên bếp', { exact: true }).fill('Unsaved kitchen')
  await page.evaluate(() => (window as any).costState.dispatchConfig = { kitchenName: 'Server kitchen', revision: 8 })
  await revisions(page, ['config', 'jobs'], 1)
  await expect.poll(() => calls(page)).toHaveLength(2)
  expect((await calls(page))[1]).toEqual(['config'])
  await expect(page.getByLabel('Tên bếp', { exact: true })).toHaveValue('Unsaved kitchen')
  await page.clock.runFor(3600000); expect(await calls(page)).toHaveLength(2)
  await page.getByRole('tab', { name: 'Điều phối trực tiếp' }).click()
  await page.clock.runFor(300)
  await expect.poll(() => calls(page)).toHaveLength(3)
  expect((await calls(page))[2]).toEqual(['jobs'])
})

test('a response cannot acknowledge a newer event or an unloaded section while in flight', async ({ page }) => {
  await open(page); await ready(page)
  await page.evaluate(() => (window as any).costState.delayed = true)
  await revisions(page, ['jobs'], 1); await expect.poll(() => calls(page)).toHaveLength(2)
  await revisions(page, ['roster'], 1); await revisions(page, ['jobs'], 2)
  expect(await calls(page)).toHaveLength(2)
  await page.evaluate(() => { const state = (window as any).costState; state.delayed = false; state.pending.splice(0).forEach((done: () => void) => done()) })
  await page.clock.runFor(300)
  await expect.poll(() => calls(page)).toHaveLength(3)
  expect((await calls(page))[2]).toEqual(['jobs', 'roster'])
  await page.clock.runFor(60000); expect(await calls(page)).toHaveLength(3)
})

test('a daily-counter stream survives an older in-flight jobs response', async ({ page }) => {
  await open(page); await ready(page)
  await page.evaluate(() => (window as any).costState.delayed = true)
  // A job refresh keeps the counter attached; its result cannot replace it.
  await revisions(page, ['jobs'], 1)
  const day = await page.evaluate(() => new Date(Date.now() + 25200000).toISOString().slice(0, 10))
  await emit(page, `eatCleanOperationalSignals/${day}`, 12)
  await page.evaluate(() => { const state = (window as any).costState; state.delayed = false; state.pending.splice(0).forEach((done: () => void) => done()) })
  await page.clock.runFor(300)
  await expect(page.locator('.eat-clean-operations-signals article').filter({ hasText: 'MAPS' }).locator('strong')).toHaveText('12')
  expect(await calls(page)).toHaveLength(2)
})

test('Vietnam midnight switches only the daily-counter listener and does not refresh jobs or roster', async ({ page }) => {
  await open(page, {}, '2026-10-25T16:59:55Z'); await ready(page)
  const oldDay = await page.evaluate(() => new Date(Date.now() + 25200000).toISOString().slice(0, 10))
  await emit(page, `eatCleanOperationalSignals/${oldDay}`, 6)
  const until = await page.evaluate(() => { const day = new Date(Date.now() + 25200000).toISOString().slice(0, 10); return Date.parse(`${day}T00:00:00+07:00`) + 86400000 - Date.now() + 50 })
  await page.clock.runFor(until)
  const nextDay = await page.evaluate(() => new Date(Date.now() + 25200000).toISOString().slice(0, 10))
  expect(nextDay).not.toBe(oldDay)
  expect(await active(page)).toContain(`eatCleanOperationalSignals/${nextDay}`)
  expect(await active(page)).not.toContain(`eatCleanOperationalSignals/${oldDay}`)
  await expect(page.locator('.eat-clean-operations-signals article').filter({ hasText: 'MAPS' }).locator('strong')).toHaveText('0')
  expect(await calls(page)).toHaveLength(1)
})

test('midnight clears yesterday counters locally even while automatic error recovery is paused', async ({ page }) => {
  await open(page, {}, '2026-10-25T16:59:55Z'); await ready(page)
  await emit(page, 'eatCleanOperationalSignals/2026-10-25', 9)
  await expect(page.locator('.eat-clean-operations-signals article').filter({ hasText: 'MAPS' }).locator('strong')).toHaveText('9')
  await page.evaluate(() => (window as any).costState.dispatchError = 'unavailable')
  await revisions(page, ['jobs'], 1)
  await expect(page.getByRole('alert')).toBeVisible()
  expect(await active(page)).toEqual([])
  await page.clock.runFor(10000)
  await expect(page.locator('.eat-clean-operations-signals article').filter({ hasText: 'MAPS' }).locator('strong')).toHaveText('0')
  expect(await calls(page)).toHaveLength(2)
})

test('GPS staleness, SLA and OTP unlock are local deadlines with no extra calls', async ({ page }) => {
  await open(page); await ready(page)
  await page.evaluate(job => {
    const state = (window as any).costState
    state.dispatchJobs = [{ ...job, promisedAt: new Date(Date.now() + 1000).toISOString(), otpLockedUntil: new Date(Date.now() + 2000).toISOString(), otpFailureCount: 2 }]
  }, job)
  await revisions(page, ['jobs'], 1)
  await expect.poll(() => active(page)).toContain('eatCleanLiveLocationViews/order-a')
  await emit(page, 'eatCleanLiveLocationViews/order-a', { binding: 'a'.repeat(64), latitude: 16, longitude: 108, updatedAt: await page.evaluate(() => Date.now()), expiresAt: await page.evaluate(() => Date.now() + 86400000) })
  await page.clock.runFor(3000)
  await expect(page.locator('.eat-clean-operations-signals article').filter({ hasText: 'SLA' }).locator('strong')).toHaveText('1')
  await expect(page.locator('.eat-clean-operations-signals article').filter({ hasText: 'OTP' })).toContainText('khóa 0')
  await page.clock.runFor(121000)
  await expect(page.locator('.eat-clean-dispatch-pin.driver')).toHaveCount(0)
  await expect(page.locator('.eat-clean-operations-signals article').filter({ hasText: 'GPS' }).locator('strong')).toHaveText('1')
  expect(await calls(page)).toHaveLength(2)
})

test('account revocation clears customer data and blocks stale responses and mutations', async ({ page }) => {
  await open(page, { dispatchJobs: [{ ...job, canAssign: true }] }); await ready(page)
  await page.getByRole('button', { name: 'Gán shipper', exact: true }).click()
  await page.evaluate(() => (window as any).costState.delayed = true)
  await revisions(page, ['jobs'], 1)
  await emit(page, 'users/admin-a', { role: 'admin', disabled: true })
  await expect(page.getByText('Private address')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await active(page)).toEqual([])
  await page.evaluate(() => { const state = (window as any).costState; state.delayed = false; state.pending.splice(0).forEach((done: () => void) => done()) })
  await page.clock.runFor(3600000)
  await expect(page.getByText('Private address')).toHaveCount(0)
  expect(await calls(page)).toHaveLength(2)
})

test('account switch ignores the previous pending response and detaches its listeners', async ({ page }) => {
  await open(page, { dispatchJobs: [{ ...job, canAssign: true }] }); await ready(page)
  await page.evaluate(() => (window as any).costState.delayed = true)
  await revisions(page, ['jobs'], 1)
  await page.getByRole('button', { name: 'Change dispatch account' }).click()
  await page.clock.runFor(200)
  await expect.poll(() => calls(page)).toHaveLength(3)
  await page.evaluate(() => { const state = (window as any).costState; state.delayed = false; state.pending.splice(0).reverse().forEach((done: () => void) => done()) })
  await ready(page)
  await expect(page.getByText('Private address')).toHaveCount(0)
  expect(await active(page)).toContain('users/admin-b')
  expect(await active(page)).not.toContain('users/admin-a')
})

test('transient errors pause automatic work and explicit refresh recovers without a timer loop', async ({ page }) => {
  await open(page); await ready(page)
  await page.evaluate(() => (window as any).costState.dispatchError = 'unavailable')
  await revisions(page, ['jobs'], 1)
  await expect(page.getByRole('alert')).toBeVisible()
  await page.clock.runFor(3600000)
  expect(await calls(page)).toHaveLength(2); expect(await active(page)).toEqual([])
  await page.evaluate(() => (window as any).costState.dispatchError = '')
  await page.getByRole('button', { name: 'Làm mới', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await calls(page)).toHaveLength(3)
})

test('GPS assignment mismatch reconciles jobs once and cannot loop on the unchanged binding', async ({ page }) => {
  await open(page, { dispatchJobs: [job] }); await ready(page)
  await emit(page, 'eatCleanLiveLocationViews/order-a', { binding: 'b'.repeat(64), latitude: 17, longitude: 108, updatedAt: await page.evaluate(() => Date.now()), expiresAt: await page.evaluate(() => Date.now() + 86400000) })
  await page.clock.runFor(300)
  await expect.poll(() => calls(page)).toHaveLength(2)
  expect((await calls(page))[1]).toEqual(['jobs'])
  await page.clock.runFor(3600000)
  expect(await calls(page)).toHaveLength(2)
  expect(await active(page)).not.toContain('eatCleanLiveLocationViews/order-a')
  await expect(page.locator('.eat-clean-dispatch-pin.driver')).toHaveCount(0)
})

test('terminal GPS revocation reconciles jobs and stale point callbacks cannot revive a finished trip', async ({ page }) => {
  await open(page, { dispatchJobs: [job] }); await ready(page)
  await expect.poll(() => active(page)).toContain('eatCleanLiveLocationViews/order-a')
  await page.evaluate(() => {
    const state = (window as any).costState
    state.dispatchJobs = []
    state.oldPoint = state.deliveryObservers.find((item: any) => item.active && item.path === 'eatCleanLiveLocationViews/order-a')
    state.oldPoint.error({ code: 'permission-denied' })
  })
  await page.clock.runFor(300)
  await expect.poll(() => calls(page)).toHaveLength(2)
  expect((await calls(page))[1]).toEqual(['jobs'])
  expect(await active(page)).not.toContain('eatCleanLiveLocationViews/order-a')
  await page.evaluate(() => (window as any).costState.oldPoint.next({ binding: 'a'.repeat(64), latitude: 17, longitude: 108, updatedAt: Date.now(), expiresAt: Date.now() + 86400000 }))
  await expect(page.locator('.eat-clean-dispatch-pin.driver')).toHaveCount(0)
  await page.clock.runFor(60000); expect(await calls(page)).toHaveLength(2)
})

test('assignment refreshes only jobs/roster; a late mutation cannot affect the next account', async ({ page }) => {
  await open(page, { dispatchJobs: [{ ...job, canAssign: true }] }); await ready(page)
  await page.getByRole('button', { name: 'Gán shipper', exact: true }).click()
  await page.getByRole('button', { name: 'Xác nhận gán', exact: true }).click()
  await page.clock.runFor(300)
  await expect.poll(() => calls(page)).toHaveLength(2)
  expect((await calls(page))[1]).toEqual(['jobs', 'roster'])
  await page.evaluate(job => { (window as any).costState.dispatchJobs = [{ ...job, canAssign: true }]; (window as any).costState.holdMutation = true }, job)
  await revisions(page, ['jobs'], 1)
  await page.getByRole('button', { name: 'Gán shipper', exact: true }).click()
  await page.getByRole('button', { name: 'Xác nhận gán', exact: true }).click()
  // This fixture control simulates an external auth change while the real
  // modal is open; it is not a product interaction through the backdrop.
  await page.getByRole('button', { name: 'Change dispatch account' }).evaluate((button: HTMLButtonElement) => button.click())
  await page.clock.runFor(200); await ready(page)
  const before = (await calls(page)).length
  await page.evaluate(() => (window as any).costState.mutationPending())
  await page.clock.runFor(300)
  expect(await calls(page)).toHaveLength(before)
  await expect(page.getByText(/Đã gán ORDER-A/)).toHaveCount(0)
})

test('an assignment during an in-flight read queues reconciliation without turning the discarded response into an error', async ({ page }) => {
  await open(page, { dispatchJobs: [{ ...job, canAssign: true }] }); await ready(page)
  await page.evaluate(() => (window as any).costState.delayed = true)
  await revisions(page, ['jobs'], 1)
  await expect.poll(() => calls(page)).toHaveLength(2)
  await page.getByRole('button', { name: 'Gán shipper', exact: true }).click()
  await page.getByRole('button', { name: 'Xác nhận gán', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await calls(page)).toHaveLength(2)
  await page.evaluate(() => { const state = (window as any).costState; state.delayed = false; state.pending.splice(0).forEach((done: () => void) => done()) })
  await page.clock.runFor(300)
  await expect.poll(() => calls(page)).toHaveLength(3)
  expect((await calls(page))[2]).toEqual(['jobs', 'roster'])
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Gán shipper', exact: true })).toHaveCount(0)
  await page.clock.runFor(60000); expect(await calls(page)).toHaveLength(3)
})

test('saving settings refreshes config only and keeps live sources detached', async ({ page }) => {
  await open(page); await ready(page)
  await page.getByRole('tab', { name: 'Phí giao & SLA' }).click()
  await page.getByLabel('Tên bếp', { exact: true }).fill('Updated kitchen')
  await page.getByRole('button', { name: 'Lưu phí giao & SLA', exact: true }).click()
  await page.clock.runFor(300)
  await expect.poll(() => calls(page)).toHaveLength(2)
  expect((await calls(page))[1]).toEqual(['config'])
  expect(await active(page)).toEqual(['users/admin-a', 'eatCleanWorkspaceChanges/config'])
  await expect(page.getByLabel('Tên bếp', { exact: true })).toHaveValue('Updated kitchen')
})

test('page-level indicators disclose scope while the active-job total stays whole-scope', async ({ page }) => {
  await open(page, { dispatchJobs: [job], dispatchTotal: 180, dispatchHasMore: true, dispatchRosterLimit: true }); await ready(page)
  await expect(page.getByRole('note')).toContainText('1/180 chuyến')
  await expect(page.getByRole('note')).toContainText('giới hạn 100 hồ sơ')
  await expect(page.locator('.eat-clean-dispatch-metrics article').filter({ hasText: 'Chuyến đang mở' }).locator('strong')).toHaveText('180')
  await expect(page.getByText('Không có đơn chờ gán trên trang này', { exact: true })).toBeVisible()
})

test('a successful authorized retry can adopt a new admin role without restoring the prior access latch', async ({ page }) => {
  await open(page); await ready(page)
  await page.evaluate(() => (window as any).costState.dispatchRole = 'super_admin')
  await emit(page, 'users/admin-a', { role: 'super_admin', disabled: false })
  await expect(page.getByRole('alert')).toBeVisible()
  expect(await active(page)).toEqual([])
  await page.getByRole('button', { name: 'Làm mới', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect.poll(() => active(page)).toContain('users/admin-a')
  await revisions(page, ['jobs'], 1)
  await expect.poll(() => calls(page)).toHaveLength(3)
})

test('after revocation, pending manual recovery cannot submit a configuration before authorization succeeds', async ({ page }) => {
  await open(page); await ready(page)
  await page.getByRole('tab', { name: 'Phí giao & SLA' }).click()
  await emit(page, 'users/admin-a', { role: 'admin', disabled: true })
  await page.evaluate(() => (window as any).costState.delayed = true)
  await page.getByRole('button', { name: 'Làm mới', exact: true }).click()
  await page.clock.runFor(200)
  await page.getByRole('button', { name: 'Lưu phí giao & SLA', exact: true }).click()
  expect(await page.evaluate(() => (window as any).costState.dispatchConfigMutations || 0)).toBe(0)
  await page.evaluate(() => { const state = (window as any).costState; state.delayed = false; state.pending.splice(0).forEach((done: () => void) => done()) })
  await expect(page.getByRole('alert')).toHaveCount(0)
})
