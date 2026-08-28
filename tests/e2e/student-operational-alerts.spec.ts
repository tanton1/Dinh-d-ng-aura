import { expect, test } from '@playwright/test'

test('student sees prominent operational alerts with direct actions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/schedule')

  const attention = page.getByRole('region', { name: 'Thông tin bạn cần lưu ý' })
  await expect(attention).toBeVisible()
  await expect(attention.getByRole('heading', { name: '2 việc cần lưu ý' })).toBeVisible()
  await expect(attention.getByText('Kỳ thanh toán còn 5 ngày')).toBeVisible()
  await expect(attention.getByText('Mới có 3/5 khung giờ rảnh')).toBeVisible()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)

  await attention.getByRole('button', { name: /Bổ sung lịch rảnh/ }).click()
  await expect(page).toHaveURL(/#\/student-availability$/)
})

test('staff student list stays compact and contains no learner financial alerts', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/home')
  await page.getByRole('button', { name: /Tài khoản/ }).click()
  await page.getByRole('button', { name: 'Huấn luyện viên' }).click()
  await page.getByRole('navigation', { name: 'Điều hướng Staff' }).getByRole('button', { name: 'Học viên' }).click()

  await expect(page).toHaveURL(/#\/staff-students$/)
  await expect(page.locator('.opv2-student-metrics > div')).toHaveCount(4)
  await expect(page.getByRole('combobox', { name: 'Lọc theo phân công' }).locator('option[value="attention"]')).toHaveCount(0)
  await expect(page.getByText('Kỳ thanh toán đã quá hạn')).toHaveCount(0)
})
