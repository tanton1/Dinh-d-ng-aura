import { expect, test, type Page } from '@playwright/test'

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }))
  expect(overflow.document).toBeLessThanOrEqual(1)
  expect(overflow.body).toBeLessThanOrEqual(1)
}

test.describe('Aura Finance Intelligence responsive workspace', () => {
  test('keeps the financial overview usable on a 390px phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/#/admin-finance')

    const workspace = page.locator('.business-performance')
    await expect(workspace).toBeVisible()
    await expect(workspace.locator('.business-performance__hero')).toHaveCount(0)
    await expect(workspace.locator(':scope > .aura-metric-carousel').first()).toBeVisible()
    await expect(workspace.locator('.aura-metric-carousel__slide')).toHaveCount(4)
    await expect(workspace.locator('.business-performance__toolbar input, .business-performance__toolbar select')).toHaveCount(4)

    const metrics = workspace.locator('.aura-metric-carousel__slide')
    const metricBounds = await metrics.evaluateAll((items) => items.map((item) => {
      const bounds = item.getBoundingClientRect()
      return { width: bounds.width, height: bounds.height }
    }))
    expect(metricBounds.every((item) => item.width > 0 && item.height >= 88)).toBe(true)

    await workspace.locator('.business-performance__quality').scrollIntoViewIfNeeded()
    await expectNoHorizontalOverflow(page)
  })

  test('keeps receivables searchable and touch-friendly at Aura mobile widths', async ({ page }) => {
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 })
      await page.goto('/#/admin-finance')

      await page.getByRole('tab', { name: 'Thu chi', exact: true }).click()
      const workspace = page.locator('.finance-management')
      await expect(workspace).toBeVisible()
      await expect(workspace.locator('.finance-management__hero')).toHaveCount(0)
      await expect(workspace.locator(':scope > .aura-metric-carousel').first()).toBeVisible()
      await expect(workspace.locator('.aura-metric-carousel__slide')).toHaveCount(4)
      const debtSearch = workspace.getByLabel('Tìm công nợ')
      await expect(debtSearch).toBeVisible()
      expect((await debtSearch.boundingBox())?.width || 0).toBeGreaterThan(180)
      await expect(workspace.locator('.finance-management__debt-filters button')).toHaveCount(5)
      await expectNoHorizontalOverflow(page)
    }
  })

  test('keeps desktop source reporting readable without a mobile-only layout', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/#/admin-finance')

    const workspace = page.locator('.business-performance')
    await expect(workspace).toBeVisible()
    await expect(workspace.locator('.business-performance__table-head')).toBeVisible()
    const grid = await workspace.locator('.business-performance__grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns)
    expect(grid.split(' ').length).toBeGreaterThanOrEqual(2)
    await expectNoHorizontalOverflow(page)
  })

  test('uses an in-page cash-account control before payroll can be marked paid', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/#/admin-payroll')

    const payroll = page.locator('.payroll-canonical')
    await expect(payroll).toBeVisible()
    await expect(payroll.getByLabel('Quỹ chi lương')).toBeVisible()
    await expect(payroll.getByLabel('Mã chứng từ chi lương')).toBeVisible()
    await expect(payroll.locator('.payroll-canonical__payout p')).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
