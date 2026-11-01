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
  test(`compact renewal groups stay visible and filter the queue at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/#/admin-renewals')

    const groups = page.getByLabel('Nhóm hợp đồng tái ký')
    await expect(groups).toBeVisible()
    await expect(groups.locator('.renewal-focus-card')).toHaveCount(4)
    const layout = await groups.evaluate((element) => ({
      columns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
      overflow: element.scrollWidth - element.clientWidth,
      height: element.getBoundingClientRect().height,
    }))
    expect(layout.columns).toBe(2)
    expect(layout.overflow).toBeLessThanOrEqual(1)
    expect(layout.height).toBeLessThanOrEqual(190)
    await expect(page.getByRole('heading', { name: 'Tái ký', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`renewal-${width}.png`), fullPage: true })

    const expired = groups.getByRole('button', { name: /Hết hạn · 30 ngày qua/i })
    await expired.click()
    await expect(expired).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.renewal-active-segment')).toContainText('Hết hạn · 30 ngày qua')
    await page.getByRole('button', { name: 'Xem tất cả', exact: true }).click()
    await expect(page.locator('.renewal-active-segment')).toHaveCount(0)
    const filters = page.getByRole('button', { name: 'Bộ lọc', exact: true })
    await expect(page.getByRole('combobox', { name: 'Cảnh báo', exact: true })).toBeHidden()
    await filters.click()
    await expect(filters).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('combobox', { name: 'Cảnh báo', exact: true })).toBeVisible()
    await expectNoPageOverflow(page)
  })
}

test('renewal focus cards form a four-column desktop overview', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/admin-renewals')
  const carousel = page.getByLabel('Nhóm hợp đồng tái ký')
  await expect(carousel).toBeVisible()
  const columns = await carousel.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)
  expect(columns).toBe(4)
  await expectNoPageOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('renewal-desktop.png'), fullPage: true })
})
