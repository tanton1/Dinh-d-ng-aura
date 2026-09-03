import { expect, test } from '@playwright/test'

for (const width of [360, 390, 430]) {
  test(`staff payroll remains readable above the learner dock at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/#/home')
    await page.getByRole('button', { name: /Tài khoản/ }).click()
    await page.getByRole('button', { name: 'PT Gym' }).click()
    await page.getByRole('button', { name: 'Mở menu' }).click()
    await page.locator('#app-sidebar').getByRole('button', { name: /Lương của tôi/ }).click()

    await expect(page).toHaveURL(/#\/staff-payroll$/)
    await expect(page.getByTestId('staff-payroll-page')).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Điều hướng Staff' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Tổng quan bảng lương cá nhân' })).toBeVisible()

    const geometry = await page.getByTestId('staff-payroll-page').evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return {
        left: rect.left,
        right: rect.right,
        viewportWidth: window.innerWidth,
        pageWidth: document.documentElement.scrollWidth,
      }
    })
    expect(geometry.left).toBeGreaterThanOrEqual(-1)
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + 1)
    expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1)
  })
}

test('staff payroll uses the full operations workspace on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 })
  await page.goto('/#/home')
  await page.getByRole('button', { name: /Tài khoản/ }).click()
  await page.getByRole('button', { name: 'PT Gym' }).click()
  await page.locator('#app-sidebar').getByRole('button', { name: /Lương của tôi/ }).click()

  const payroll = page.getByTestId('staff-payroll-page')
  await expect(payroll).toBeVisible()
  const geometry = await payroll.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { width: rect.width, pageWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth }
  })
  expect(geometry.width).toBeGreaterThan(760)
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1)
})
