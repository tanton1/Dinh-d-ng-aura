import { expect, test } from '@playwright/test'

test('staff can switch to learner modules and return to the operations workspace', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/home')

  await page.getByRole('button', { name: /Tài khoản/ }).click()
  await page.getByRole('button', { name: 'PT Gym' }).click()
  await expect(page).toHaveURL(/#\/staff-dashboard$/)

  await page.getByRole('button', { name: /Tài khoản/ }).click()
  await page.getByRole('button', { name: 'Mở không gian cá nhân' }).click()
  await expect(page).toHaveURL(/#\/home$/)
  await expect(page.locator('.app-shell[data-workspace="personal"]')).toBeVisible()
  await expect(page.getByTestId('ai-coach-launcher')).toBeVisible()

  const dock = page.getByRole('navigation', { name: 'Điều hướng học viên' })
  await expect(dock).toBeVisible()
  await dock.getByRole('button', { name: 'Thêm' }).click()
  const more = page.getByRole('dialog')
  await expect(more.getByRole('button', { name: 'Lịch rảnh' })).toBeVisible()
  await expect(more.getByRole('button', { name: 'Aura Academy' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: /Tài khoản/ }).click()
  await page.locator('.user-dropdown-menu').getByRole('button', { name: 'Về công việc' }).click()
  await expect(page).toHaveURL(/#\/staff-dashboard$/)
  await expect(page.locator('.app-shell[data-workspace="staff"]')).toBeVisible()
})
