import { expect, test } from '@playwright/test'

for (const width of [320, 390, 768, 1440]) {
  test(`library cards and expanded portions fit ${width}px with usable compact actions`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/tests/cooking-ui/index.html#/food-library')
    const cards = page.locator('.food-library__card')
    await expect(cards).toHaveCount(7)
    const button = page.getByRole('button', { name: 'Ghi nhật ký: Phở bò', exact: true })
    const bounds = await button.boundingBox()
    expect(bounds!.height).toBeGreaterThanOrEqual(44)
    expect(bounds!.width).toBeLessThanOrEqual(145)
    await page.getByLabel('Chỉnh khẩu phần Phở bò', { exact: true }).click()
    await cards.first().getByRole('button', { name: '0,5×', exact: true }).click()
    await expect(cards.first()).toContainText('197')
    await expect(cards.first().locator('summary')).toContainText('250 g')
    await expect(page.getByRole('button', { name: 'Ghi nhật ký: Món chưa đủ dữ liệu dinh dưỡng' })).toBeDisabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'Lưu Phở bò', exact: true }).click()
    await page.getByRole('button', { name: 'Đã lưu', exact: true }).click()
    await expect(cards).toHaveCount(1)
    await page.getByRole('searchbox').fill('com trang')
    await expect(cards).toHaveCount(0)
    await page.getByRole('button', { name: 'Xem tất cả món', exact: true }).click()
    await expect(cards).toHaveCount(7)
    await page.getByRole('button', { name: 'Món ăn', exact: true }).click()
    await expect(cards).toHaveCount(3)
  })
}
