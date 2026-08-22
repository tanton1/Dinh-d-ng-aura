import { expect, test } from '@playwright/test'

for (const width of [360, 390, 430]) {
  test(`PT student form remains reachable and mobile-safe at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/#/admin-pt-students')
    const openButton = page.getByRole('button', { name: 'Thêm học viên' })
    await expect(openButton).toBeVisible()
    await openButton.click()

    const dialog = page.getByRole('dialog', { name: 'Thêm học viên mới' })
    await expect(dialog).toBeVisible()
    const saveButton = dialog.getByRole('button', { name: 'Lưu thông tin' })
    await saveButton.scrollIntoViewIfNeeded()
    await expect(saveButton).toBeVisible()

    const layout = await page.evaluate(() => {
      const modal = document.querySelector<HTMLElement>('.student-management__modal')
      const dialogElement = document.querySelector<HTMLElement>('.student-management__dialog')
      const action = document.querySelector<HTMLElement>('.student-management__form-actions')
      return {
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        modalWidth: modal?.scrollWidth ?? 0,
        dialogWidth: dialogElement?.getBoundingClientRect().width ?? 0,
        actionBottom: action?.getBoundingClientRect().bottom ?? 0,
        viewportHeight: window.innerHeight,
      }
    })
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1)
    expect(layout.modalWidth).toBeLessThanOrEqual(layout.viewportWidth + 1)
    expect(layout.dialogWidth).toBeLessThanOrEqual(layout.viewportWidth)
    expect(layout.actionBottom).toBeGreaterThan(0)
    expect(layout.actionBottom).toBeLessThanOrEqual(layout.viewportHeight)
  })
}

test('PT student roster uses a desktop table without leaking horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/admin-pt-students')

  const roster = page.locator('.student-roster')
  await expect(roster).toBeVisible()
  await expect(page.locator('.student-management__mobile-list')).toBeHidden()

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    rosterRight: document.querySelector<HTMLElement>('.student-roster')?.getBoundingClientRect().right ?? 0,
  }))
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1)
  expect(dimensions.rosterRight).toBeLessThanOrEqual(dimensions.viewport)
})
