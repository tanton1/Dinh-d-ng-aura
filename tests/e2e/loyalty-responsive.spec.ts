import { expect, test } from '@playwright/test'

for (const width of [360, 390, 430]) {
  test(`Aura Club keeps four clear mobile destinations at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/#/aura-club')

    await expect(page.getByRole('heading', { name: 'Dùng điểm cho điều bạn cần' })).toBeVisible()
    const navigation = page.getByRole('navigation', { name: 'Aura Club trên điện thoại' })
    await expect(navigation.getByRole('button')).toHaveCount(4)
    expect(await navigation.getByRole('button').allTextContents()).toEqual(['Đổi quà', 'Nhiệm vụ', 'Lịch sử', 'Thêm'])

    await navigation.getByRole('button', { name: 'Thêm' }).click()
    await expect(page.getByRole('menuitem', { name: /Hạng thành viên/ })).toBeVisible()
    await page.getByRole('menuitem', { name: /Giới thiệu bạn/ }).click()
    await expect(page.getByRole('heading', { name: 'Tập cùng nhau, nhận quyền lợi cùng nhau' })).toBeVisible()

    expect(await page.evaluate(() => ({
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
    }))).toEqual({ document: 0, body: 0 })
  })
}

test('Aura Club cancellation stays in context and uses an accessible confirmation', async ({ page }) => {
  await page.goto('/#/aura-club')
  await page.getByRole('button', { name: 'Hủy yêu cầu' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Hủy đổi quyền lợi?' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Điểm đang giữ sẽ được hoàn lại')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})
