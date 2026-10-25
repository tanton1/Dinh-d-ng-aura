import { expect, test } from '@playwright/test'

const pageUrl = '/tests/schedule-ui/trainer-availability.html'
const current = '2026-10-19'
const next = '2026-10-26'

async function openAdmin(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Mở đội ngũ Aura', exact: true }).click()
  await page.getByRole('button', { name: /Hồ sơ/, exact: false }).click()
  await expect(page.getByRole('region', { name: 'Hồ sơ nhân viên', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tuần hiện tại', exact: true })).toHaveAttribute('aria-pressed', 'true')
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-21T04:00:00Z'))
  await page.goto(pageUrl)
})

test('Aura staff profile and PT share current/next week edits without changing recurring availability', async ({ page }) => {
  await openAdmin(page)
  const slot = () => page.getByRole('button', { name: /^Thứ 4 7 giờ/ })
  await slot().click()
  await expect(page.getByRole('button', { name: 'Lưu hồ sơ', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Lưu lịch rảnh', exact: true }).click()
  await expect(page.getByText('Đang dùng lịch đăng ký riêng của tuần này.')).toBeVisible()
  await page.getByRole('button', { name: 'Mở lịch PT', exact: true }).click()
  await expect(slot()).toHaveAttribute('aria-pressed', 'true')
  await expect(slot()).toBeEnabled()
  await page.getByRole('button', { name: 'Tuần sau', exact: true }).click()
  await expect(slot()).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: /^Thứ 6 18 giờ/ }).click()
  await page.getByRole('button', { name: 'Lưu lịch rảnh', exact: true }).click()
  await expect(page.getByText(/Đã lưu lịch tuần 26\/10/)).toBeVisible()
  await openAdmin(page)
  await expect(slot()).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Tuần sau', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Thứ 6 18 giờ/ })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Lịch lặp lại', exact: true }).click()
  await expect(slot()).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: /^Thứ 6 18 giờ/ })).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Lưu hồ sơ', exact: true }).click()
  const calls = await page.evaluate(() => (window as any).__trainerCalls)
  expect(calls.find((call: any) => call.operation === 'save-admin').input).toMatchObject({ trainerUid: 't', weekId: current, expectedRevision: 0 })
  expect(calls.find((call: any) => call.operation === 'save-pt').input.weekId).toBe(next)
  expect(calls.find((call: any) => call.operation === 'save-profile').input).not.toHaveProperty('availabilitySlots')
})

test('OFF follows actual weekday even with a sparse workweek and disables that day', async ({ page }) => {
  await page.evaluate(() => { (window as any).__trainerDays = ['T2', 'T4', 'T7'] })
  await page.getByRole('button', { name: 'Mở lịch PT', exact: true }).click()
  const off = page.getByRole('button', { name: 'OFF T4 2026-10-21', exact: true })
  await off.click()
  await expect(page.getByRole('button', { name: /^Thứ 4 7 giờ/ })).toBeDisabled()
  await page.getByRole('button', { name: 'Lưu lịch rảnh', exact: true }).click()
  await expect(page.getByText(/Đã lưu lịch tuần/)).toBeVisible()
  const calls = await page.evaluate(() => (window as any).__trainerCalls)
  expect(calls.find((call: any) => call.operation === 'save-pt').input.offDates).toEqual(['2026-10-21'])
})

test('failed save keeps edits and exposes reload; busy save prevents changing scope', async ({ page }) => {
  await openAdmin(page)
  await page.getByRole('button', { name: /^Thứ 4 7 giờ/ }).click()
  await page.evaluate(() => { (window as any).__holdTrainerSave = true; (window as any).__failTrainerSave = true })
  await page.getByRole('button', { name: 'Lưu lịch rảnh', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Tuần sau', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Lưu hồ sơ', exact: true })).toBeDisabled()
  await page.evaluate(() => (window as any).__releaseTrainerSave())
  await expect(page.getByRole('alert')).toContainText('đã thay đổi')
  await expect(page.getByRole('button', { name: /^Thứ 4 7 giờ/ })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Tải lại', exact: true }).click()
  await expect(page.getByRole('button', { name: /^Thứ 4 7 giờ/ })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: 'Tuần sau', exact: true })).toBeEnabled()
})

test('availability fits a mobile staff profile and renders all 78 selectable slots', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openAdmin(page)
  await expect(page.locator('.availability-matrix tbody button')).toHaveCount(78)
  await expect(page.getByRole('button', { name: 'Tuần sau', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^Thứ 7 20 giờ/ }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/trainer-availability-mobile.png', fullPage: true })
  await expect(page.getByRole('button', { name: /^Thứ 7 20 giờ/ })).toBeInViewport({ ratio: 1 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
})
