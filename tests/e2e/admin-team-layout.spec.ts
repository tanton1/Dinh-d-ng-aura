import { expect, test } from '@playwright/test'

for (const width of [360, 390, 430]) {
  test(`Đội ngũ Aura stays full-width and usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/#/admin-roles')

    await expect(page.getByRole('heading', { name: 'Đội ngũ Aura' })).toBeVisible()
    await expect(page.locator('.identity-carousel > button')).toHaveCount(4)
    await expect(page.getByRole('tab', { name: 'Thành viên' })).toHaveAttribute('aria-selected', 'true')

    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      heroWidth: document.querySelector('.identity-hero')?.getBoundingClientRect().width ?? 0,
      viewportWidth: document.documentElement.clientWidth,
    }))
    expect(layout.overflow).toBeLessThanOrEqual(1)
    expect(layout.heroWidth).toBeGreaterThanOrEqual(layout.viewportWidth - 2)

    await page.getByRole('tab', { name: 'Nhân viên' }).click()
    await expect(page.getByText('Nhân viên Aura', { exact: true })).toBeVisible()

    const createButton = page.getByRole('button', { name: 'Thêm nhân viên' })
    if (await createButton.isVisible()) {
      await createButton.click()
      const dialog = page.getByRole('dialog', { name: 'Thêm nhân viên' })
      await expect(dialog).toBeVisible()
      const geometry = await page.evaluate(() => {
        const modal = document.querySelector('.identity-modal')?.getBoundingClientRect()
        const dock = document.querySelector('.admin-mobile-nav')?.getBoundingClientRect()
        return { modalBottom: modal?.bottom ?? 0, dockTop: dock?.top ?? innerHeight }
      })
      expect(geometry.modalBottom).toBeLessThanOrEqual(geometry.dockTop + 1)
    }
  })
}

test('Đội ngũ Aura keeps four summary slides on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/#/admin-roles')
  await expect(page.locator('.identity-carousel > button')).toHaveCount(4)
  const columns = await page.locator('.identity-carousel > button').evaluateAll((items) => items.map((item) => item.getBoundingClientRect().width))
  expect(Math.min(...columns)).toBeGreaterThan(220)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)

  const deleteMember = page.locator('button[aria-label^="Xóa tài khoản "]').first()
  if (await deleteMember.isVisible()) {
    await deleteMember.click()
    const dialog = page.getByRole('dialog', { name: 'Xóa tài khoản thành viên' })
    await expect(dialog).toBeVisible()
    const confirmButton = dialog.getByRole('button', { name: 'Xóa tài khoản' })
    await expect(confirmButton).toBeDisabled()
    await dialog.getByLabel('Nhập XÓA để xác nhận').fill('XÓA')
    await expect(confirmButton).toBeEnabled()
  }
})
