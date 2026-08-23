import { expect, test } from '@playwright/test'

test('nutrition setup launches the canonical Aura onboarding', async ({ page }) => {
  await page.goto('/#/nutrition?section=today')

  await expect(page.getByTestId('nutrition-setup-prompt')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Thiết lập mục tiêu dinh dưỡng' })).toBeVisible()
  await expect(page.getByText(/Bước 1 \/ 4/)).toHaveCount(0)

  await page.getByRole('button', { name: 'Thiết lập mục tiêu' }).click()
  await expect(page.getByRole('button', { name: 'Thiết lập hồ sơ' })).toBeVisible()
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
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
