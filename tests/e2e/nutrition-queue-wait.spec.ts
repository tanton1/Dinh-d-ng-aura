import { expect, test } from '@playwright/test'

test('food scan wait clock retains original request age without resubscribing or polling at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.clock.install()
  await page.goto('/tests/e2e/fixtures/nutrition-queue.html')
  await expect(page.getByTestId('nutrition-scan-elapsed')).toContainText('Đã gửi 2 phút')
  await expect(page.getByText('Ảnh đang chờ đến lượt...', { exact: true })).toBeVisible()
  await page.clock.fastForward(90_000)
  await expect(page.getByTestId('nutrition-scan-elapsed')).toContainText('Đã gửi 3 phút')
  await page.evaluate(() => (window as unknown as { scanProcessing: () => void }).scanProcessing())
  await expect(page.getByText('Aura Vision đang phân tích...', { exact: true })).toBeVisible()
  await expect(page.getByTestId('nutrition-scan-elapsed')).toContainText('Đã gửi 3 phút')
  expect(await page.evaluate(() => (window as unknown as { scanResumeCount: number }).scanResumeCount)).toBe(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.reload()
  await expect(page.getByTestId('nutrition-scan-elapsed')).toContainText('Đã gửi 3 phút')
  expect(await page.evaluate(() => (window as unknown as { scanResumeCount: number }).scanResumeCount)).toBe(1)
})
