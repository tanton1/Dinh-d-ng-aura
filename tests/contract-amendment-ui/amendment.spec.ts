import { test, expect, type Page } from '@playwright/test'
async function open(page: Page, scenario = '') {
  await page.goto(`/tests/contract-amendment-ui/index.html?scenario=${scenario}`)
  await page.getByRole('button', { name: 'Điều chỉnh gói tập', exact: true }).click()
  await page.getByRole('combobox', { name: 'Gói tập', exact: true }).selectOption('three')
  await page.getByLabel('Lý do điều chỉnh').fill('Học viên chuyển sang gói 3 tháng')
}
const state = (page: Page) => page.evaluate(() => (window as unknown as { amendmentTest: { previews: number; commands: Array<{ snapshotHash: string; expectedRevision: number; cancelAffectedBookings: boolean }> } }).amendmentTest)
test('one screen previews on demand, never polls and confirms once on mobile and desktop', async ({ page }) => {
  await open(page)
  await expect(page.getByLabel('Tổng số buổi')).toHaveValue('36')
  expect((await state(page)).previews).toBe(0)
  await page.getByRole('button', { name: 'Xem thay đổi' }).click()
  await expect(page.getByLabel('So sánh trước và sau')).toContainText('12 buổi')
  await expect(page.getByLabel('So sánh trước và sau')).toContainText('1.200.000đ')
  await page.waitForTimeout(5500)
  expect((await state(page)).previews).toBe(1)
  const box = await page.getByRole('dialog').boundingBox()
  expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  const heading = await page.getByRole('heading', { name: 'Điều chỉnh gói tập' }).boundingBox()
  expect(heading!.y).toBeGreaterThan(box!.y)
  await page.getByRole('dialog').screenshot({ path: test.info().outputPath('amendment.png') })
  await page.getByRole('button', { name: 'Xác nhận điều chỉnh' }).click()
  await expect(page.getByRole('status')).toHaveText('Đã điều chỉnh gói tập')
  expect((await state(page)).commands).toHaveLength(1)
})
test('changing terms invalidates preview and affected bookings require acknowledgement', async ({ page }) => {
  await open(page, 'bookings')
  await page.getByRole('button', { name: 'Xem thay đổi' }).click()
  await expect(page.getByRole('button', { name: 'Xác nhận điều chỉnh' })).toBeDisabled()
  await page.getByLabel('Hủy các lịch này khi xác nhận điều chỉnh').check()
  await page.getByLabel('Tổng số buổi').fill('40')
  await expect(page.getByRole('button', { name: 'Xem thay đổi' })).toBeVisible()
  await page.getByRole('button', { name: 'Xem thay đổi' }).click()
  await expect(page.getByLabel('Hủy các lịch này khi xác nhận điều chỉnh')).not.toBeChecked()
  await page.getByLabel('Hủy các lịch này khi xác nhận điều chỉnh').check()
  await page.getByRole('button', { name: 'Xác nhận điều chỉnh' }).click()
  expect((await state(page)).commands[0].cancelAffectedBookings).toBe(true)
})
test('stale evidence requires a fresh preview; unknown outcome replays identical command', async ({ page }) => {
  for (const scenario of ['stale', 'retry']) {
    await open(page, scenario)
    await page.getByRole('button', { name: 'Xem thay đổi' }).click()
    await page.getByRole('button', { name: 'Xác nhận điều chỉnh' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    if (scenario === 'stale') { await page.getByRole('button', { name: 'Xem thay đổi' }).click(); await page.getByRole('button', { name: 'Xác nhận điều chỉnh' }).click() }
    else { await expect(page.getByLabel('Tổng số buổi')).toBeDisabled(); await page.getByRole('button', { name: 'Kiểm tra lại yêu cầu' }).click() }
    const result = await state(page)
    expect(result.commands).toHaveLength(2)
    if (scenario === 'retry') expect(result.commands[1]).toEqual(result.commands[0])
    else expect(result.commands[1].snapshotHash).not.toBe(result.commands[0].snapshotHash)
  }
})
test('unreconciled records show a clear reason and cannot confirm', async ({ page }) => {
  await open(page, 'blocked'); await page.getByRole('button', { name: 'Xem thay đổi' }).click()
  await expect(page.getByRole('alert')).toContainText('chưa khớp doanh thu')
  await expect(page.getByRole('button', { name: 'Xác nhận điều chỉnh' })).toBeDisabled()
  expect((await state(page)).commands).toHaveLength(0)
})
