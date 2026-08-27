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

test('nutrition review photos use square thumbnails and bounded 9:16 detail frames', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/admin-nutrition-reviews')
  await expect(page.locator('.nrw-toolbar')).toBeVisible()

  await page.evaluate(() => {
    const fixture = document.createElement('div')
    fixture.id = 'nutrition-review-photo-fixture'
    fixture.style.width = '350px'
    fixture.innerHTML = [
      '<div class="nrw-card-image is-square"></div>',
      '<div class="nrw-main-photo is-square"></div>',
      '<div class="nrw-main-photo is-portrait"></div>',
      '<div class="nrw-main-photo is-square is-empty"></div>',
    ].join('')
    document.body.appendChild(fixture)
  })

  const fixture = page.locator('#nutrition-review-photo-fixture')
  const thumbnail = await fixture.locator('.nrw-card-image').boundingBox()
  const square = await fixture.locator('.nrw-main-photo.is-square:not(.is-empty)').boundingBox()
  const portrait = await fixture.locator('.nrw-main-photo.is-portrait').boundingBox()
  const empty = await fixture.locator('.nrw-main-photo.is-empty').boundingBox()
  expect(thumbnail).not.toBeNull()
  expect(square).not.toBeNull()
  expect(portrait).not.toBeNull()
  expect(empty).not.toBeNull()
  expect(Math.abs(thumbnail!.width - thumbnail!.height)).toBeLessThanOrEqual(1)
  expect(Math.abs(square!.width - square!.height)).toBeLessThanOrEqual(1)
  expect(Math.abs(portrait!.width / portrait!.height - 9 / 16)).toBeLessThan(0.01)
  expect(portrait!.height).toBeLessThanOrEqual(500)
  expect(empty!.height).toBe(112)
})
