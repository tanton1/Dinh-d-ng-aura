import { expect, test } from '@playwright/test'

const path = '/tests/nutrition-read-ui/index.html?mode=scan-queue#/nutrition?section=scan'
const photo = { name: 'fixture.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([255, 216, 255, 217]) }
test('queued scan resumes after reload, receives status changes and requires confirmation before saving', async ({ page }) => {
  await page.goto(path)
  await page.locator('input[type=file]').first().setInputFiles(photo)
  await expect(page.getByText('Ảnh đang chờ đến lượt...', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).scanQueueFixture.created)).toBe(1)
  await page.reload()
  await expect(page.getByText('Ảnh đang chờ đến lượt...', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).scanQueueFixture.created)).toBe(0)
  expect(await page.evaluate(() => (window as any).scanQueueFixture.resumed)).toBe(1)
  await page.evaluate(() => (window as any).scanQueueFixture.status('processing'))
  await expect(page.getByText('Aura Vision đang phân tích...', { exact: true })).toBeVisible()
  await page.evaluate(() => (window as any).scanQueueFixture.complete())
  await expect(page.getByTestId('nutrition-scan-result')).toBeVisible()
  await expect(page.getByText('Cơm kiểm thử hàng đợi', { exact: true }).first()).toBeVisible()
  expect(await page.evaluate(() => (window as any).scanQueueFixture.saved)).toBe(0)
})

test('changing owner aborts observation and discards the previous account result', async ({ page }) => {
  await page.goto(path)
  await page.locator('input[type=file]').first().setInputFiles(photo)
  await expect(page.getByText('Ảnh đang chờ đến lượt...', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Đổi tài khoản kiểm thử' }).click()
  expect(await page.evaluate(() => (window as any).scanQueueFixture.aborted)).toBe(1)
  await page.evaluate(() => (window as any).scanQueueFixture.complete())
  await expect(page.getByTestId('nutrition-scan-result')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).scanQueueFixture.resumed)).toBe(0)
})
