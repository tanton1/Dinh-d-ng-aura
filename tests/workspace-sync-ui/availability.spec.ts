import { expect, test, type Page } from '@playwright/test'

const path = 'users/account-a/workspaceChanges/operations'
const count = (page: Page) => page.evaluate(() => (window as any).workspaceCalls.length)
async function emit(page: Page, version: string, target = path) {
  await page.evaluate(({ target, version }) => (window as any).workspaceEmit(target, { studentScheduleVersion: version }), { target, version })
}
async function open(page: Page, time = '2026-10-23T05:00:00Z') {
  await page.addInitScript(() => { (window as any).availabilitySlots = ['T2-8', 'T3-8', 'T4-8', 'T5-8', 'T6-8'] })
  await page.clock.install({ time: new Date(time) })
  await page.goto('/tests/workspace-sync-ui/index.html?screen=availability')
  await page.clock.runFor(250)
  await expect(page.getByRole('button', { name: 'T2 8 giờ, đã chọn', exact: true })).toBeVisible()
  expect(await count(page)).toBe(1)
}

test('sequential edits for A then B retain A notification; other accounts do not reload A', async ({ page }) => {
  await open(page)
  await page.evaluate(() => { (window as any).availabilitySlots = ['T7-8'] })
  await emit(page, '0001')
  await emit(page, '0002', 'users/account-b/workspaceChanges/operations')
  await page.clock.runFor(300)
  expect(await count(page)).toBe(2)
  await expect(page.getByRole('button', { name: 'T7 8 giờ, đã chọn', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.clock.fastForward(1_800_000)
  expect(await count(page)).toBe(2)
})

test('draft holds all remote changes; discard reads the latest once', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'T7 8 giờ, chưa chọn', exact: true }).click()
  await page.evaluate(() => { (window as any).availabilitySlots = ['T7-8'] })
  await emit(page, '0001'); await emit(page, '0002')
  await page.clock.fastForward(1_800_000)
  expect(await count(page)).toBe(1)
  await expect(page.getByRole('button', { name: 'T2 8 giờ, đã chọn', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Bỏ thay đổi và tải lại', exact: true }).click()
  await page.clock.runFor(500)
  expect(await count(page)).toBe(2)
  await expect(page.getByRole('button', { name: 'T2 8 giờ, chưa chọn', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: 'Bỏ thay đổi và tải lại', exact: true })).toHaveCount(0)
})

test('draft started during a read survives; undo consumes the pending revision', async ({ page }) => {
  await open(page)
  await page.evaluate(() => { (window as any).workspaceDelay = 1000 })
  await emit(page, '0001'); await page.clock.runFor(250)
  expect(await count(page)).toBe(2)
  await page.getByRole('button', { name: 'T7 8 giờ, chưa chọn', exact: true }).click()
  await page.clock.runFor(1100)
  await expect(page.getByRole('button', { name: 'T7 8 giờ, đã chọn', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Chưa cập nhật được lịch rảnh mới nhất.')).toHaveCount(0)
  await page.getByRole('button', { name: 'T7 8 giờ, đã chọn', exact: true }).click()
  await page.clock.runFor(1400)
  expect(await count(page)).toBe(3)
  await page.clock.fastForward(1_800_000)
  expect(await count(page)).toBe(3)
})

test('save and its source marker reconcile once after the draft is committed', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'T7 8 giờ, chưa chọn', exact: true }).click()
  await page.getByRole('button', { name: 'Gửi lịch rảnh', exact: true }).click()
  await page.clock.runFor(500)
  expect(await count(page)).toBe(2)
  expect(await page.evaluate(() => (window as any).availabilityWrites.length)).toBe(1)
  await page.clock.fastForward(1_800_000)
  expect(await count(page)).toBe(2)
})

test('hidden/offline changes wait and consume the newest revision only on resume', async ({ page }) => {
  await open(page)
  await page.evaluate(() => {
    (window as any).workspaceOnline = false
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => (window as any).workspaceOnline })
    ;(window as any).workspaceHidden = true
  })
  await emit(page, '0001'); await emit(page, '0002')
  await page.clock.fastForward(1_800_000)
  expect(await count(page)).toBe(1)
  await page.evaluate(() => { (window as any).workspaceHidden = false; document.dispatchEvent(new Event('visibilitychange')) })
  await page.clock.runFor(300)
  expect(await count(page)).toBe(1)
  await page.evaluate(() => { (window as any).workspaceOnline = true; window.dispatchEvent(new Event('online')) })
  await page.clock.runFor(300)
  expect(await count(page)).toBe(2)
})

test('account change clears draft and ignores the previous save response', async ({ page }) => {
  await open(page)
  await page.evaluate(() => { (window as any).deferAvailabilitySave = true })
  await page.getByRole('button', { name: 'T7 8 giờ, chưa chọn', exact: true }).click()
  await page.getByRole('button', { name: 'Gửi lịch rảnh', exact: true }).click()
  await expect.poll(() => page.evaluate(() => typeof (window as any).finishAvailabilitySave)).toBe('function')
  await page.evaluate(() => (window as any).workspaceAccount('account-b'))
  await expect.poll(() => page.evaluate(() => (window as any).workspaceActivePaths())).toContain('users/account-b/workspaceChanges/operations')
  await page.clock.runFor(500)
  expect(await count(page)).toBe(2)
  await page.evaluate(() => (window as any).finishAvailabilitySave())
  await page.clock.runFor(500)
  await expect(page.getByRole('button', { name: 'T7 8 giờ, chưa chọn', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).workspaceActivePaths())).not.toContain(path)
})

test('Sunday midnight preserves the selected week and unsaved slots', async ({ page }) => {
  await open(page, '2026-10-25T16:59:58Z')
  const before = await page.locator('.student-availability-card header small').innerText()
  await page.getByRole('button', { name: 'T7 8 giờ, chưa chọn', exact: true }).click()
  await emit(page, '0001')
  await page.clock.runFor(3000)
  expect(await count(page)).toBe(1)
  expect(await page.locator('.student-availability-card header small').innerText()).toBe(before)
  await expect(page.getByRole('button', { name: 'T7 8 giờ, đã chọn', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Bỏ thay đổi và tải lại', exact: true })).toBeVisible()
})

test('revoked access clears previously loaded availability', async ({ page }) => {
  await open(page)
  await page.evaluate(() => { (window as any).workspaceAccessDenied = true })
  await emit(page, '0001'); await page.clock.runFor(300)
  await expect(page.getByRole('alert')).toContainText('Tài khoản đã bị thu hồi quyền.')
  await expect(page.getByRole('region', { name: 'Ma trận thời gian rảnh' })).toHaveCount(0)
  await page.clock.fastForward(1_800_000)
  expect(await count(page)).toBe(2)
})
