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

      await page.getByRole('tab', { name: 'Trả góp', exact: true }).click()
      const workspace = page.locator('.finance-management')
      await expect(workspace).toBeVisible()
      await expect(workspace.locator('.finance-management__hero')).toHaveCount(0)
      await expect(workspace.locator(':scope > .aura-metric-carousel').first()).toBeVisible()
      await expect(workspace.locator('.aura-metric-carousel__slide')).toHaveCount(3)
      await expect(workspace.locator('.aura-metric-carousel__slide').nth(0)).toContainText('Tổng nợ')
      await expect(workspace.locator('.aura-metric-carousel__slide').nth(1)).toContainText('Quá hạn')
      await expect(workspace.locator('.aura-metric-carousel__slide').nth(2)).toContainText('Nợ thu tháng này')
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
    const sourceDetails = workspace.locator('.business-performance__source-details')
    await expect(sourceDetails).toBeVisible()
    await expect(workspace.locator('.business-performance__table-head')).toBeHidden()
    await sourceDetails.locator('summary').click()
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
    expect(await payroll.locator('.aura-metric-carousel__slide').count()).toBeGreaterThanOrEqual(1)
    await expect(payroll.locator('.aura-metric-carousel').first()).toHaveAttribute('aria-label', 'Lương tạm tính từng nhân viên')
    await expect(payroll.getByText('Lương cơ bản tạm tính')).toHaveCount(0)
    await expect(payroll.getByRole('tab', { name: 'Kỳ lương' })).toBeVisible()
    await payroll.getByRole('tab', { name: 'Ngày công' }).click()
    await expect(payroll.getByPlaceholder('Tên nhân viên')).toBeVisible()
    await expect(payroll.getByText('Chọn một nhân viên')).toHaveCount(0)
    const workdayLayout = payroll.locator('.staff-workdays__layout')
    expect(await workdayLayout.evaluate((element) => getComputedStyle(element).minHeight)).toBe('0px')
    await payroll.getByRole('tab', { name: 'Kỳ lương' }).click()
    await expect(payroll.getByRole('textbox', { name: 'Kỳ lương', exact: true })).toBeVisible()
    await expect(payroll.getByLabel('Lọc trạng thái kỳ lương')).toBeVisible()
    await payroll.getByRole('tab', { name: 'Chính sách' }).click()
    await expect(payroll.getByText('Chính sách đang có')).toBeVisible()
    await expect(payroll.getByText('Phiên bản mới')).toHaveCount(0)
    await payroll.getByRole('button', { name: 'Tạo chính sách' }).click()
    await expect(payroll.getByText('Phiên bản mới')).toBeVisible()
    await expect(payroll.getByText('Đơn giá ca 1–8')).toBeVisible()
    await expect(payroll.getByText('Từ ca thứ 9', { exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('starts the operations dashboard with Aura metrics on mobile and desktop', async ({ page }) => {
    for (const width of [360, 390, 430, 1440]) {
      await page.setViewportSize({ width, height: width < 680 ? 844 : 900 })
      await page.goto('/#/admin-dashboard')

      const dashboard = page.locator('.admin-dashboard')
      await expect(dashboard).toBeVisible()
      await expect(dashboard.locator(':scope > .aura-metric-carousel').first()).toBeVisible()
      await expect(dashboard.locator(':scope > .page-header')).toHaveCount(0)
      await expect(dashboard.locator('.admin-dashboard__syncbar')).toBeVisible()
      await expect(dashboard.getByText('Dịch vụ Tổng quan chưa phản hồi')).toHaveCount(0)
      await expect(dashboard.getByText('Thực thu ròng', { exact: true }).first()).toBeVisible()
      await expect(dashboard.getByText('Doanh thu thực hiện', { exact: true }).first()).toBeVisible()
      await expect(dashboard.getByText('160 hiệu lực · 11 bảo lưu')).toBeVisible()
      await expect(dashboard.getByLabel('Lọc theo chi nhánh')).toBeVisible()
      await expect(dashboard.locator('.aura-metric-carousel__slide')).toHaveCount(5)
      await expect(dashboard.locator('.aura-metric-carousel__slide').first()).not.toContainText('NaN')
      const dashboardRange = dashboard.locator('.date-range-filter__trigger')
      await expect(dashboardRange).toContainText('Tháng này')
      await dashboardRange.click()
      const dashboardRangeMenu = page.getByRole('dialog', { name: 'Chọn khoảng thời gian' })
      await expect(dashboardRangeMenu.getByRole('option', { name: 'Hôm nay', exact: true })).toBeVisible()
      await expect(dashboardRangeMenu.getByRole('option', { name: 'Tuần này', exact: true })).toBeVisible()
      await expect(dashboardRangeMenu.getByRole('option', { name: 'Tuần trước', exact: true })).toBeVisible()
      await expect(dashboardRangeMenu.getByRole('option', { name: 'Tháng trước', exact: true })).toBeVisible()
      await expect(dashboardRangeMenu.getByRole('option', { name: 'Tất cả', exact: true })).toHaveCount(0)
      await dashboardRangeMenu.getByRole('option', { name: 'Tháng này', exact: true }).click()
      await expect(dashboard.getByRole('heading', { name: 'Hôm nay cần làm' })).toBeVisible()
      await expect(dashboard.getByRole('heading', { name: 'Ca tập trong ngày' })).toBeVisible()
      await expect(dashboard.getByRole('heading', { name: 'Lịch cần thu' })).toBeVisible()
      const analytics = dashboard.locator('.admin-dashboard__analytics')
      await expect(analytics).toBeVisible()
      await expect(analytics.getByRole('heading', { name: 'Xu hướng & cơ cấu' })).toBeVisible()
      await expect(analytics.locator('.admin-dashboard__chart-card')).toHaveCount(3)
      await expect(analytics.locator('.admin-dashboard__revenue-chart')).toBeVisible()
      await expect(analytics.locator('.admin-dashboard__donut')).toHaveCount(2)
      await expect(analytics.locator('.admin-dashboard__source-counts')).toBeVisible()
      await expect(dashboard.getByRole('tab')).toHaveCount(3)
      await expect(dashboard.locator(':scope > .aura-metric-carousel .aura-metric-carousel__number').first()).toHaveText('01 / 05')
      await expect(dashboard.getByText('Một phần dữ liệu cần đối soát.')).toHaveCount(0)
      const dashboardLayout = await dashboard.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        const content = element.closest('.page-content')?.getBoundingClientRect()
        return { width: rect.width, contentWidth: content?.width ?? rect.width }
      })
      expect(dashboardLayout.contentWidth - dashboardLayout.width).toBeLessThanOrEqual(width < 680 ? 1 : 2)
      await expectNoHorizontalOverflow(page)
    }
  })
})
