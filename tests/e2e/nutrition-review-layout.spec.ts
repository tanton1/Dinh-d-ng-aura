import { expect, test, type Page } from '@playwright/test'

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }))
  expect(overflow.document).toBeLessThanOrEqual(1)
  expect(overflow.body).toBeLessThanOrEqual(1)
}

for (const width of [360, 390, 430]) {
  test(`nutrition review toolbar stays compact and mobile-safe at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/#/admin-nutrition-reviews')

    const search = page.getByPlaceholder('Tìm học viên hoặc món ăn')
    const refresh = page.getByRole('button', { name: 'Làm mới' })
    await expect(search).toBeVisible()
    await expect(refresh).toBeVisible()

    const searchBounds = await search.locator('..').boundingBox()
    const refreshBounds = await refresh.boundingBox()
    expect(searchBounds).not.toBeNull()
    expect(refreshBounds).not.toBeNull()
    expect(Math.abs(searchBounds!.y - refreshBounds!.y)).toBeLessThanOrEqual(2)
    expect(refreshBounds!.x).toBeGreaterThan(searchBounds!.x + searchBounds!.width)
    expect(refreshBounds!.height).toBeGreaterThanOrEqual(42)

    await expectNoPageOverflow(page)
  })
}
