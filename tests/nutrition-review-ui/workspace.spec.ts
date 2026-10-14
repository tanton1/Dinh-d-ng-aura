import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => route.request().url().startsWith('http://127.0.0.1:4191/') ? route.continue() : route.abort())
})

for (const width of [320, 390, 430, 1024]) {
  test(`real review component remains readable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/tests/nutrition-review-ui/index.html#/admin-nutrition-reviews?focus=overdue')
    await expect(page.locator('.nrw-review-card')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Chỉ bữa quá hạn' })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Viết nhận xét' }).click()
    await expect(page.getByRole('textbox', { name: 'Nhận xét dành riêng cho học viên', exact: true })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    const search = page.getByRole('textbox', { name: 'Tìm học viên hoặc món ăn' })
    await expect(search).toBeVisible()
    await page.screenshot({ path: info.outputPath('review-layout.png'), fullPage: true })
  })
}

test('overdue deep link, status filters and same-page route changes stay consistent', async ({ page }) => {
  await page.goto('/tests/nutrition-review-ui/index.html#/admin-nutrition-reviews?focus=overdue')
  await expect(page.locator('.nrw-review-card')).toHaveCount(1)
  await page.getByRole('button', { name: /^Đã duyệt/ }).click()
  await expect(page.getByRole('button', { name: 'Chỉ bữa quá hạn' })).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Chỉ bữa quá hạn' }).click()
  await expect(page.locator('.nrw-review-card')).toHaveCount(1)
  await page.evaluate(() => { location.hash = '#/admin-nutrition-reviews' })
  await expect(page.locator('.nrw-review-card')).toHaveCount(2)
})

test('same-tick approve clicks send once and refresh counters without cached summary', async ({ page }) => {
  await page.goto('/tests/nutrition-review-ui/index.html')
  await expect(page.locator('.nrw-review-card')).toHaveCount(2)
  await page.getByRole('button', { name: 'Viết nhận xét' }).click()
  await page.getByRole('textbox', { name: 'Nhận xét dành riêng cho học viên', exact: true }).fill('Đã kiểm tra khẩu phần và thành phần bữa ăn.')
  await page.evaluate(() => { (window as any).reviewTest.holdMutation = true })
  await page.getByRole('button', { name: 'Duyệt bữa ăn' }).evaluate((element: HTMLButtonElement) => { element.click(); element.click(); element.click() })
  await expect(page.getByRole('button', { name: 'Duyệt bữa ăn' })).toBeDisabled()
  expect(await page.evaluate(() => (window as any).reviewTest.writes.length)).toBe(1)
  await page.evaluate(() => (window as any).reviewTest.releaseMutation())
  await expect(page.locator('.nrw-review-card')).toHaveCount(1)
  expect(await page.evaluate(() => (window as any).reviewTest.reads.at(-1).forceRefresh)).toBe(true)
})

test('refresh failure retains data, blocks stale mutations, and retry recovers', async ({ page }) => {
  await page.goto('/tests/nutrition-review-ui/index.html')
  await expect(page.locator('.nrw-review-card')).toHaveCount(2)
  await page.evaluate(() => { (window as any).reviewTest.failNext = true; (window as any).reviewTest.holdRead = true })
  await page.getByRole('button', { name: 'Làm mới' }).evaluate((element: HTMLButtonElement) => { element.click(); element.click() })
  expect(await page.evaluate(() => (window as any).reviewTest.reads.length)).toBe(2)
  await expect(page.locator('.nrw-review-card')).toHaveCount(2)
  await page.evaluate(() => { (window as any).reviewTest.holdRead = false; (window as any).reviewTest.releaseRead() })
  await expect(page.getByRole('alert')).toContainText('Dịch vụ đang bận')
  await page.getByRole('button', { name: 'Viết nhận xét' }).click()
  await expect(page.getByRole('button', { name: 'Duyệt bữa ăn' })).toBeDisabled()
  await page.getByRole('button', { name: 'Tải lại', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Duyệt bữa ăn' })).toBeEnabled()
})

test('uncertain mutation requires a successful refresh before another write', async ({ page }) => {
  await page.goto('/tests/nutrition-review-ui/index.html')
  await expect(page.locator('.nrw-review-card')).toHaveCount(2)
  await page.getByRole('button', { name: 'Viết nhận xét' }).click()
  await page.getByRole('textbox', { name: 'Nhận xét dành riêng cho học viên', exact: true }).fill('Đã kiểm tra bữa ăn.')
  await page.evaluate(() => { (window as any).reviewTest.failMutation = true })
  await page.getByRole('button', { name: 'Duyệt bữa ăn' }).click()
  await expect(page.getByRole('alert')).toContainText('Chưa nhận được kết quả')
  await expect(page.getByRole('button', { name: 'Duyệt bữa ăn' })).toBeDisabled()
  await page.getByRole('button', { name: 'Tải lại', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Duyệt bữa ăn' })).toBeEnabled()
  expect(await page.evaluate(() => (window as any).reviewTest.writes.length)).toBe(1)
})
