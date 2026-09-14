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

for (const width of [360, 390, 430]) {
  test(`Aura Club admin is readable without horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/#/admin-loyalty')

    await expect(page.getByRole('heading', { name: 'Trung tâm Aura Club' })).toBeVisible()
    const metrics = page.getByRole('region', { name: 'Chỉ số Aura Club' })
    await expect(metrics.locator('.aura-metric-carousel__slide')).toHaveCount(4)
    await expect(metrics.getByRole('button', { name: /Xem thẻ 2:/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Yêu cầu cần xử lý/ })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Nghiệp vụ Aura Club' })).toBeVisible()

    await page.getByRole('button', { name: 'Sửa' }).first().click()
    const editor = page.getByRole('dialog', { name: 'Chỉnh quyền lợi' })
    await expect(editor).toBeVisible()
    await expect(editor.getByRole('button', { name: 'Lưu quyền lợi' })).toBeVisible()

    expect(await page.evaluate(() => ({
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
    }))).toEqual({ document: 0, body: 0 })
  })
}

test('Aura Club admin puts daily operations before advanced reconciliation', async ({ page }) => {
  await page.goto('/#/admin-loyalty')
  const queueComesFirst = await page.locator('.loyalty-admin').evaluate((element) => {
    const queue = element.querySelector('.loyalty-admin-queue')
    const reconciliation = element.querySelector('.loyalty-admin-reconcile')
    return Boolean(queue && reconciliation && (queue.compareDocumentPosition(reconciliation) & Node.DOCUMENT_POSITION_FOLLOWING))
  })
  expect(queueComesFirst).toBe(true)
  await expect(page.locator('details.loyalty-admin-reconcile')).not.toHaveAttribute('open', '')
})
