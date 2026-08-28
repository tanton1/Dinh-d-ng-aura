import { expect, test } from '@playwright/test'

for (const width of [360, 390, 430]) {
  test(`student PT policy sheets stay usable above the mobile dock at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/#/schedule')
    await expect(page.getByRole('heading', { name: /^Lịch tập luyện$/i })).toBeVisible()

    await page.locator('.upcoming-item').first().click()
    await page.getByRole('button', { name: 'Đổi / hủy buổi' }).click()
    const sessionDialog = page.getByRole('dialog', { name: 'Đổi hoặc hủy buổi tập' })
    await expect(sessionDialog).toBeVisible()
    await expect(sessionDialog.getByText(/1 lượt đổi\/hủy không tính buổi/i)).toBeVisible()

    const sessionGeometry = await sessionDialog.locator('.student-policy-sheet').evaluate((element) => {
      const box = element.getBoundingClientRect()
      return {
        left: box.left,
        right: box.right,
        bottom: box.bottom,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
      }
    })
    expect(sessionGeometry.left).toBeGreaterThanOrEqual(0)
    expect(sessionGeometry.right).toBeLessThanOrEqual(sessionGeometry.viewportWidth + 1)
    expect(sessionGeometry.bottom).toBeLessThanOrEqual(sessionGeometry.viewportHeight + 1)
    expect(sessionGeometry.clientHeight).toBeLessThanOrEqual(sessionGeometry.viewportHeight)
    expect(sessionGeometry.scrollHeight).toBeGreaterThan(0)
    await sessionDialog.getByRole('button', { name: 'Đóng' }).last().click()

    await page.getByRole('button', { name: /Hợp đồng/ }).click()
    await page.getByRole('button', { name: 'Đăng ký OFF / Bảo lưu' }).click()
    const pauseDialog = page.getByRole('dialog', { name: 'Đăng ký OFF / Bảo lưu' })
    await expect(pauseDialog).toBeVisible()
    await expect(pauseDialog.getByText(/OFF tối đa 14 ngày\/lần/i)).toBeVisible()
    await expect(pauseDialog.getByText(/3 tháng có 1 lượt OFF/i)).toBeVisible()

    const pauseGeometry = await pauseDialog.locator('.student-policy-sheet').evaluate((element) => {
      const box = element.getBoundingClientRect()
      const action = element.querySelector('footer')?.getBoundingClientRect()
      return {
        left: box.left,
        right: box.right,
        bottom: box.bottom,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        actionBottom: action?.bottom ?? 0,
      }
    })
    expect(pauseGeometry.left).toBeGreaterThanOrEqual(0)
    expect(pauseGeometry.right).toBeLessThanOrEqual(pauseGeometry.viewportWidth + 1)
    expect(pauseGeometry.bottom).toBeLessThanOrEqual(pauseGeometry.viewportHeight + 1)
    expect(pauseGeometry.actionBottom).toBeGreaterThan(0)
    expect(pauseGeometry.actionBottom).toBeLessThanOrEqual(pauseGeometry.viewportHeight + 1)
  })
}
