import { expect, test } from '@playwright/test'

test('progress removes stale comparison photos after an empty local snapshot', async ({ page }) => {
  await page.addInitScript(() => {
    const photo = { id: 'cached-photo', date: '2026-09-01', angle: 'front', imageUrl: '/icons/aura-icon.svg', isPrivate: true, createdAt: '2026-09-01T00:00:00Z' }
    localStorage.setItem('aura:progress-photos:demo', JSON.stringify([photo]))
    localStorage.setItem('aura:cache:user_progress_photos:demo', JSON.stringify([photo]))
  })
  await page.goto('/#/progress')
  await page.getByRole('button', { name: 'Cơ thể', exact: true }).click()
  const gallery = page.locator('#progress-photos-section')
  await expect(gallery.getByAltText('Trước', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    localStorage.setItem('aura:progress-photos:demo', '[]')
    window.dispatchEvent(new Event('aura:progress-photos-updated'))
  })
  await expect(gallery.getByAltText('Trước', { exact: true })).toHaveCount(0)
  await expect(gallery.getByText('Chưa có ảnh cho góc Chính diện')).toBeVisible()
})
