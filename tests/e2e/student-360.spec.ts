import { expect, test } from '@playwright/test'

for (const width of [360, 390, 430]) {
  test(`Student 360 remains full-screen and touch-safe at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/#/student-360?studentId=student-demo&source=staff-students')

    await expect(page.getByRole('heading', { name: 'Nguyễn Minh Anh' })).toBeVisible()
    const localNavigation = page.getByRole('navigation', { name: 'Nội dung Học viên 360 trên điện thoại' })
    await expect(localNavigation).toBeVisible()
    await expect(localNavigation.getByRole('button')).toHaveCount(5)
    await expect(page.locator('.mobile-bottom-nav')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    await localNavigation.getByRole('button', { name: 'Hợp đồng' }).click()
    await expect(page.getByRole('heading', { name: 'Hợp đồng và quyền lợi' })).toBeVisible()
    const dockBox = await localNavigation.boundingBox()
    const lastCardBox = await page.locator('.student360-contract-grid .student360-card').last().boundingBox()
    expect(dockBox).not.toBeNull()
    expect(lastCardBox).not.toBeNull()
    expect(lastCardBox!.x + lastCardBox!.width).toBeLessThanOrEqual(width)
  })
}

test('Student 360 lazily loads heavy tabs in demo without a runtime failure', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto('/#/student-360?studentId=student-demo&source=admin-pt-students')
  await page.getByRole('button', { name: 'Hoạt động', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Toàn bộ hoạt động' })).toBeVisible()
  await page.getByRole('button', { name: 'Huấn luyện', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Huấn luyện & tiến độ' })).toBeVisible()
  await page.getByRole('button', { name: 'Hợp đồng', exact: true }).first().click()
  await expect(page.getByText('Thao tác ngay tại Học viên 360')).toBeVisible()
  await page.getByRole('button', { name: /Chỉnh sửa/ }).click()
  await expect(page.getByRole('heading', { name: 'Chỉnh sửa hợp đồng' })).toBeVisible()
  await page.getByRole('button', { name: 'Hủy', exact: true }).click()
  expect(pageErrors).toEqual([])
})
