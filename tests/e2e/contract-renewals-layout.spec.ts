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
  test(`renewal focus carousel stays mobile-safe and filters the queue at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/#/admin-renewals')

    const carousel = page.getByLabel('Nhóm hợp đồng tái ký')
    await expect(carousel).toBeVisible()
    await expect(carousel.locator('.renewal-focus-card')).toHaveCount(4)
    expect(await carousel.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)

    const expired = carousel.getByRole('button', { name: /Hết hạn 1 tháng gần đây/i })
    await expired.click()
    await expect(expired).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.renewal-active-segment')).toContainText('Hết hạn 1 tháng gần đây')
    await expectNoPageOverflow(page)
  })
}

test('renewal focus cards form a four-column desktop overview', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/admin-renewals')
  const carousel = page.getByLabel('Nhóm hợp đồng tái ký')
  await expect(carousel).toBeVisible()
  const columns = await carousel.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)
  expect(columns).toBe(4)
  await expectNoPageOverflow(page)
})
