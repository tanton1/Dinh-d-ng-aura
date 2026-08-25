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
      await expect(workspace.locator('.aura-metric-carousel__slide')).toHaveCount(5)
      const debtSearch = workspace.getByLabel('Tìm công nợ')
      await expect(debtSearch).toBeVisible()
      expect((await debtSearch.boundingBox())?.width || 0).toBeGreaterThan(180)
      await expect(workspace.locator('.finance-management__debt-filters button')).toHaveCount(5)

      const dateTrigger = workspace.locator('.date-range-filter__trigger')
      if (width === 360) await expect(dateTrigger).toContainText('Tháng này')
      await dateTrigger.click()
      const dateMenu = page.getByRole('dialog', { name: 'Chọn khoảng thời gian' })
      await expect(dateMenu).toBeVisible()
      const menuLayout = await dateMenu.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return { top: bounds.top, right: bounds.right, bottom: bounds.bottom, left: bounds.left, position: style.position, zIndex: Number(style.zIndex) }
      })
      expect(menuLayout.position).toBe('fixed')
      expect(menuLayout.zIndex).toBeGreaterThan(1000)
      expect(menuLayout.top).toBeGreaterThanOrEqual(0)
      expect(menuLayout.left).toBeGreaterThanOrEqual(0)
      expect(menuLayout.right).toBeLessThanOrEqual(width)
      expect(menuLayout.bottom).toBeLessThanOrEqual(844)
      await dateMenu.getByRole('option', { name: 'Tháng trước' }).click()
      await expect(dateMenu).toBeHidden()
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

  test('keeps the canonical payroll workflow usable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/#/admin-payroll')

    const payroll = page.locator('.payroll-page')
    await expect(payroll).toBeVisible()
    await expect(payroll.locator(':scope > .aura-metric-carousel').first()).toBeVisible()
    await expect(payroll.locator('.aura-metric-carousel__slide')).toHaveCount(5)
    await expect(payroll.getByRole('tab', { name: 'Kỳ lương' })).toBeVisible()
    await expect(payroll.getByRole('textbox', { name: 'Kỳ lương', exact: true })).toBeVisible()
    await expect(payroll.getByLabel('Lọc trạng thái kỳ lương')).toBeVisible()
    await payroll.getByRole('tab', { name: 'Chính sách' }).click()
    await expect(payroll.getByText('Phiên bản mới')).toBeVisible()
    await expect(payroll.getByText('Đơn giá / buổi')).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
