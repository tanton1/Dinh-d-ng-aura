import { expect, test } from '@playwright/test'

for (const width of [320, 390, 768, 1440]) {
  test(`existing menu has compact touch actions and three tabs at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/tests/cooking-ui/index.html#/food-library')
    const cards = page.locator('.meal-plan-live-card')
    await expect(cards).toHaveCount(7)
    expect(await page.getByRole('tablist', { name: 'Nội dung thực đơn' }).getByRole('tab').allTextContents()).toEqual(['Món ăn', 'Nguyên liệu', 'Kế hoạch 7 ngày'])
    const button = cards.first().getByRole('button', { name: /^Ghi nhật ký:/ })
    const bounds = await button.boundingBox()
    expect(bounds!.height).toBeGreaterThanOrEqual(44)
    expect(bounds!.width).toBeLessThanOrEqual(145)
    await expect(page.getByRole('button', { name: 'Ghi nhật ký: Món chưa đủ dữ liệu dinh dưỡng' })).toBeDisabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: 'Lưu Ức gà áp chảo & rau củ', exact: true }).click()
    await page.getByRole('button', { name: 'Xem món đã lưu', exact: true }).click()
    await expect(cards).toHaveCount(1)
    await page.getByRole('button', { name: 'Hiện tất cả món', exact: true }).click()
    await page.getByRole('tab', { name: 'Nguyên liệu', exact: true }).click()
    await expect(cards).toHaveCount(4)
    await page.getByRole('searchbox', { name: 'Tìm nguyên liệu' }).fill('com trang')
    await expect(cards).toHaveCount(1)
    await expect(cards.first()).toContainText('Cơm trắng')
    await page.getByRole('button', { name: 'Bộ lọc', exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'Nhóm món', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
