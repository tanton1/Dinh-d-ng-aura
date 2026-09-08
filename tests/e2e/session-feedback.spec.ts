import { expect, test } from '@playwright/test'

test('learner can rate the actual trainer after a completed session on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/schedule')

  const prompt = page.getByRole('region', { name: 'Đánh giá PT sau buổi tập' })
  await expect(prompt).toBeVisible()
  await expect(prompt.getByRole('heading', { name: /Buổi tập với PT Minh thế nào/ })).toBeVisible()
  await prompt.getByRole('radio', { name: '5 điểm - Rất hài lòng' }).click()
  await prompt.getByRole('button', { name: 'Hướng dẫn dễ hiểu' }).click()
  await prompt.getByRole('button', { name: 'Gửi đánh giá' }).click()
  await expect(page.getByText('Cảm ơn bạn! Phản hồi đã được ghi nhận.')).toBeVisible()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('admin quality page starts with metrics and exposes low-score review details', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/admin-trainer-quality')

  await expect(page.getByRole('region', { name: 'Tổng hợp chất lượng PT' })).toBeVisible()
  await expect(page.getByText('ĐIỂM TRUNG BÌNH')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Mức độ hài lòng' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Chất lượng PT' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Aura Performance Score' })).toHaveCount(0)
  const lowFeedback = page.locator('.trainer-quality-list .trainer-quality-row').filter({ hasText: 'PT Minh' }).first()
  await lowFeedback.click()
  await expect(page.getByText('Ghi chú xử lý')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nhận xử lý' })).toBeVisible()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('admin Performance is a standalone module outside quality and payroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/admin-performance')

  await expect(page).toHaveURL(/#\/admin-performance$/)
  await expect(page.getByTestId('performance-review-page')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Performance PT', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Duyệt Thương hiệu cá nhân và Aura Brand' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Phiếu 100 điểm' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Duyệt bằng chứng' }).click()
  await expect(page.getByRole('heading', { name: 'Duyệt bằng chứng Brand' })).toBeVisible()
  await page.getByRole('tab', { name: 'Hồ sơ PT' }).click()
  await expect(page.getByRole('heading', { name: 'Chất lượng hồ sơ PT' })).toBeVisible()
  await expect(page.getByTestId('staff-payroll-page')).toHaveCount(0)

  const performanceWidth = await page.getByTestId('performance-review-page').evaluate((element) => ({
    page: element.getBoundingClientRect().width,
    viewport: document.documentElement.clientWidth,
  }))
  expect(performanceWidth.viewport - performanceWidth.page).toBeLessThanOrEqual(1)

  await page.getByRole('button', { name: 'Mở menu' }).click()
  await expect(page.locator('#app-sidebar').getByRole('button', { name: 'Performance PT' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
})
