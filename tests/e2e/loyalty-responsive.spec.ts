import { expect, test } from '@playwright/test'

for (const width of [360, 390, 430]) {
  test(`Aura Club keeps four clear mobile destinations at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/#/aura-club')

    await expect(page.getByRole('heading', { name: 'Quà tặng Aura' })).toBeVisible()
    expect(Math.round((await page.locator('.loyalty-page').boundingBox())!.width)).toBe(width)
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

test('reward editor controls remain clickable above the desktop application header', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 720 })
  await page.goto('/#/admin-loyalty')
  await page.getByRole('navigation', { name: 'Vận hành Aura Club' }).getByRole('button', { name: 'Quà tặng', exact: true }).click()
  await page.getByRole('button', { name: 'Sửa', exact: true }).first().click()
  const editor = page.getByRole('dialog', { name: 'Sửa quà tặng' })
  const close = editor.getByRole('button', { name: 'Đóng chỉnh sửa quà' })
  await expect(close).toBeVisible()
  expect(await close.evaluate(button => {
    const bounds = button.getBoundingClientRect()
    return button.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2))
  })).toBe(true)
  const uploadIcon = await editor.locator('.club-upload-button > svg').boundingBox()
  const uploadLabel = await editor.locator('.club-upload-button > span').boundingBox()
  expect(uploadIcon!.x + uploadIcon!.width).toBeLessThan(uploadLabel!.x)
  await close.click()
  await expect(editor).toHaveCount(0)
})

test('Aura Club cancellation stays in context and uses an accessible confirmation', async ({ page }) => {
  await page.goto('/#/aura-club')
  await page.getByRole('button', { name: 'Hủy yêu cầu' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Hủy đổi quyền lợi?' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Điểm đang giữ sẽ được hoàn lại')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

for (const width of [360, 390, 430]) {
  test(`Aura Club admin is readable without horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/#/admin-loyalty')

    await expect(page.getByRole('heading', { name: 'Aura Club', exact: true })).toBeVisible()
    expect(Math.round((await page.locator('.club-workspace').boundingBox())!.width)).toBe(width)
    const metrics = page.getByRole('region', { name: 'Chỉ số Aura Club' })
    await expect(metrics.locator(':scope > div')).toHaveCount(4)
    await expect(metrics.getByText('Đang tập')).toBeVisible()
    const nav = page.getByRole('navigation', { name: 'Vận hành Aura Club' })
    await expect(nav).toBeVisible()
    await expect(nav.getByRole('button')).toHaveCount(5)
    await expect(page.locator('.mobile-bottom-nav')).toHaveCount(0)
    const box = await nav.boundingBox()
    expect(Math.round(box!.y + box!.height)).toBe(844)
    await nav.getByRole('button', { name: 'Quà tặng', exact: true }).click()
    await page.getByRole('button', { name: 'Sửa' }).first().click()
    const editor = page.getByRole('dialog', { name: 'Sửa quà tặng' })
    await expect(editor).toBeVisible()
    await expect(editor.getByRole('button', { name: 'Lưu quà tặng' })).toBeVisible()

    expect(await page.evaluate(() => ({
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
    }))).toEqual({ document: 0, body: 0 })
  })
}

test('Aura Club admin shows gift banners and removes reconciliation', async ({ page }) => {
  await page.goto('/#/admin-loyalty')
  await expect(page.locator('.club-reward-banner')).toHaveCount(2)
  await expect(page.getByText(/đối soát/i)).toHaveCount(0)
  await page.getByRole('navigation', { name: 'Vận hành Aura Club' }).getByRole('button', {name:'Thêm',exact:true}).click()
  await page.getByRole('dialog').getByRole('button', {name:'Cài đặt'}).click()
  await expect(page.getByRole('heading', {name:'Trạng thái chương trình'})).toBeVisible()
})

 test('learner and PT retain their original application docks', async ({page}) => {
  await page.setViewportSize({width:390,height:844})
  await page.goto('/#/aura-club')
  await expect(page.getByRole('navigation', {name:'Aura Club trên điện thoại'})).toBeVisible()
  await expect(page.getByRole('navigation', {name:'Điều hướng học viên'})).toBeVisible()
  await expect(page.getByRole('navigation', {name:'Vận hành Aura Club'})).toHaveCount(0)
  await page.getByRole('button', {name:/Tài khoản/}).click()
  await page.getByRole('button', {name:'PT Gym',exact:true}).click()
  await expect(page).toHaveURL(/#\/staff-dashboard$/)
  const staffDock = page.getByRole('navigation', {name:'Điều hướng Staff'})
  await expect(staffDock).toBeVisible()
  expect(await staffDock.getByRole('button').allTextContents()).toEqual(['Hôm nay','Học viên','Lịch','Giáo án','Thêm'])
  await expect(page.getByRole('navigation', {name:'Vận hành Aura Club'})).toHaveCount(0)
})
