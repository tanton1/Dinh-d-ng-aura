import { expect, test } from '@playwright/test'

test('staff keeps the learner dock and opens work tools as separate sidebar pages', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/home')

  await page.getByRole('button', { name: /Tài khoản/ }).click()
  await page.getByRole('button', { name: 'Huấn luyện viên' }).click()

  await expect(page).toHaveURL(/#\/home$/)

  const dock = page.getByRole('navigation', { name: 'Điều hướng Staff' })
  await expect(dock).toBeVisible()
  await expect(dock.getByRole('button')).toHaveCount(6)
  expect(await dock.getByRole('button').allTextContents()).toEqual([
    'Hôm nay',
    'Dinh dưỡng',
    'Lịch học viên',
    'Tiến độ',
    'Học',
    'Cá nhân',
  ])

  await page.getByRole('button', { name: 'Mở menu' }).click()
  const sidebar = page.locator('#app-sidebar')
  await expect(sidebar.getByText('CÔNG VIỆC', { exact: true })).toBeVisible()
  for (const label of ['Học viên phụ trách', 'Lịch dạy', 'Yêu cầu lịch', 'Duyệt món', 'Báo giá', 'Tái ký']) {
    await expect(sidebar.getByRole('button', { name: new RegExp(label) })).toBeVisible()
  }

  await sidebar.getByRole('button', { name: /Học viên phụ trách/ }).click()
  await expect(page).toHaveURL(/#\/staff-students$/)
  await expect(page.getByRole('heading', { name: 'Học viên phụ trách' })).toBeVisible()
  await expect(sidebar.getByText('Trợ giúp', { exact: true })).toHaveCount(0)
  await expect(sidebar.getByText('Cài đặt', { exact: true })).toHaveCount(0)
  await expect(sidebar.getByText('Mở trang quản trị', { exact: true })).toHaveCount(0)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
