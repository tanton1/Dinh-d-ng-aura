import { expect, test } from '@playwright/test'

test('profile update launches the canonical Aura onboarding', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/profile')

  await page.getByRole('button', { name: 'Cập nhật', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Chào mừng bạn đến/i })).toBeVisible()
  await expect(page.locator('.onboarding-container')).toHaveAttribute('data-onboarding-step', 'welcome')

  const setupButton = page.getByRole('button', { name: 'Thiết lập hồ sơ' })
  await expect(setupButton).toBeVisible()
  await setupButton.click()
  await expect(page.locator('.onboarding-container')).not.toHaveAttribute('data-onboarding-step', 'welcome')
})

test('profile accepts a mobile-friendly avatar upload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/profile')

  const avatarInput = page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]')
  await avatarInput.setInputFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  })

  await expect(page.getByText('Đã cập nhật ảnh đại diện.')).toBeVisible()
  await expect(page.getByRole('img', { name: 'Ảnh đại diện' })).toHaveAttribute('src', /^data:image\/png;base64,/)
  const profileContentBounds = await page.locator('.profile-page__content').boundingBox()
  expect(profileContentBounds?.x).toBeLessThanOrEqual(8)
  expect(profileContentBounds?.width).toBeGreaterThanOrEqual(382)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
