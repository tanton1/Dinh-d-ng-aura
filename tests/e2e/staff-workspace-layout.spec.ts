import { expect, test } from '@playwright/test'

test('staff dock prioritizes work modules and schedule tools share one weekly workspace', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/home')

  await page.getByRole('button', { name: /Tài khoản/ }).click()
  await page.getByRole('button', { name: 'Huấn luyện viên' }).click()

  await expect(page).toHaveURL(/#\/home$/)

  const dock = page.getByRole('navigation', { name: 'Điều hướng Staff' })
  await expect(dock).toBeVisible()
  await expect(dock.getByRole('button')).toHaveCount(6)
  expect(await dock.getByRole('button').allTextContents()).toEqual([
    'Tổng quan',
    'Học viên',
    'Lịch',
    'Duyệt món',
    'Tái ký',
    'Lương',
  ])

  await dock.getByRole('button', { name: 'Tổng quan' }).click()
  await expect(page).toHaveURL(/#\/staff-dashboard$/)
  await expect(page.getByTestId('staff-dashboard-page')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Tổng quan công việc Staff' })).toBeVisible()

  await page.getByRole('button', { name: 'Mở menu' }).click()
  const sidebar = page.locator('#app-sidebar')
  await expect(sidebar.getByText('CÔNG VIỆC', { exact: true })).toBeVisible()
  for (const label of ['Tổng quan Staff', 'Học viên phụ trách', 'Lịch làm việc', 'Duyệt món', 'Báo giá', 'Tái ký', 'Lương của tôi']) {
    await expect(sidebar.getByRole('button', { name: new RegExp(label) })).toBeVisible()
  }
  await expect(sidebar.getByRole('button', { name: /Lịch rảnh/ })).toHaveCount(0)
  await expect(sidebar.getByRole('button', { name: /Yêu cầu lịch/ })).toHaveCount(0)

  await sidebar.getByRole('button', { name: /Lịch làm việc/ }).click()
  await expect(page).toHaveURL(/#\/staff-schedule$/)
  await expect(page.getByTestId('staff-schedule-workspace')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Các phần lịch làm việc' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Ma trận lịch dạy chi tiết cả tuần' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Lịch rảnh/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Yêu cầu/ })).toBeVisible()
  await expect(sidebar.getByText('Trợ giúp', { exact: true })).toHaveCount(0)
  await expect(sidebar.getByText('Cài đặt', { exact: true })).toHaveCount(0)
  await expect(sidebar.getByText('Mở trang quản trị', { exact: true })).toHaveCount(0)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
