import { expect, test } from '@playwright/test'

test('staff opens one compact workspace without admin or placeholder navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/home')

  await page.getByRole('button', { name: /Tài khoản/ }).click()
  await page.getByRole('button', { name: 'Huấn luyện viên' }).click()

  await expect(page).toHaveURL(/#\/trainer-portal$/)
  await expect(page.getByRole('heading', { name: 'Không gian làm việc' })).toBeVisible()

  const dock = page.getByRole('navigation', { name: 'Điều hướng Staff' })
  await expect(dock).toBeVisible()
  await expect(dock.getByRole('button')).toHaveCount(2)
  expect(await dock.getByRole('button').allTextContents()).toEqual(['Công việc', 'Cá nhân'])

  await page.getByRole('button', { name: 'Mở menu' }).click()
  const sidebar = page.locator('#app-sidebar')
  await expect(sidebar.getByRole('button', { name: /Công việc/ })).toBeVisible()
  await expect(sidebar.getByRole('button', { name: /Cá nhân/ })).toBeVisible()
  await expect(sidebar.getByText('Trợ giúp', { exact: true })).toHaveCount(0)
  await expect(sidebar.getByText('Cài đặt', { exact: true })).toHaveCount(0)
  await expect(sidebar.getByText('Mở trang quản trị', { exact: true })).toHaveCount(0)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
