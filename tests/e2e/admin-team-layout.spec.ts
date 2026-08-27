import { expect, test } from '@playwright/test'

for (const width of [360, 390, 430]) {
  test(`Đội ngũ Aura stays full-width and usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/#/admin-roles')

    await expect(page.getByRole('heading', { name: 'Đội ngũ Aura' })).toBeVisible()
    await expect(page.locator('.identity-carousel > button')).toHaveCount(4)
    await expect(page.getByRole('tab', { name: 'Thành viên' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: 'Thêm thành viên' })).toHaveCount(1)
    await expect(page.getByText('Chuyển học viên thành nhân viên ngay tại nút')).toHaveCount(0)

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
      const editorPage = page.getByRole('region', { name: 'Thêm nhân viên' })
      await expect(editorPage).toBeVisible()
      await expect(editorPage.getByRole('heading', { name: 'Thông tin đăng nhập' })).toBeVisible()
      await expect(editorPage.getByRole('heading', { name: 'Loại hợp tác' })).toBeVisible()
      await expect(editorPage.getByRole('heading', { name: 'Chức danh & phạm vi' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Đội ngũ Aura' })).toBeHidden()
      const geometry = await page.evaluate(() => {
        const editor = document.querySelector('.identity-modal')?.getBoundingClientRect()
        return { editorLeft: editor?.left ?? 0, editorRight: editor?.right ?? 0, viewportWidth: innerWidth, pageWidth: document.documentElement.scrollWidth }
      })
      expect(geometry.editorLeft).toBeGreaterThanOrEqual(-1)
      expect(geometry.editorRight).toBeLessThanOrEqual(geometry.viewportWidth + 1)
      expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1)
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
    const deletePage = page.getByRole('region', { name: 'Xóa tài khoản thành viên' })
    await expect(deletePage).toBeVisible()
    const confirmButton = deletePage.getByRole('button', { name: 'Xóa tài khoản' })
    await expect(confirmButton).toBeDisabled()
    await deletePage.getByLabel('Nhập XÓA để xác nhận').fill('XÓA')
    await expect(confirmButton).toBeEnabled()
  }
})
