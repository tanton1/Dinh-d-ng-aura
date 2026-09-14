import { expect, test } from '@playwright/test'

for (const width of [320, 390, 1440]) {
  test(`schedule load reference is editable and explained at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 })
    await page.goto('/#/admin-schedule-settings')
    await expect(page.getByRole('heading', { name: 'Mốc cân tải mặc định' })).toBeVisible()
    const fullTime = page.getByRole('spinbutton', { name: 'Mốc cân tải PT chính thức', exact: true })
    await expect(fullTime).toHaveValue('8')
    await expect(page.getByText(/mốc riêng luôn được ưu tiên/)).toBeVisible()
    await fullTime.fill('6')
    await page.getByRole('button', { name: 'Lưu cấu hình', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Đã lưu cấu hình lịch')
    await expect(fullTime).toHaveValue('6')
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    if (width === 320) {
      await page.getByRole('heading', { name: 'Mốc cân tải mặc định' }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath('load-policy-mobile.png') })
    }
  })
}
