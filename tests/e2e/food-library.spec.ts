import { expect, test } from '@playwright/test'

for (const v4 of [false, true]) {
  test(`lookup separates ingredients, bookmarks without diary writes and preserves its deep link (UI v4=${v4})`, async ({ page }) => {
    const errors: string[] = []
    const remoteWrites: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route(/firestore\.googleapis\.com|cloudfunctions\.net|\.run\.app\//, (route) => {
      remoteWrites.push(route.request().url())
      return route.abort()
    })
    await page.addInitScript((enabled) => localStorage.setItem('aura:ui-rollout:demo-config:v1', JSON.stringify({ schemaVersion: 1, surfaces: { shell: enabled ? 'all' : 'off', 'member-nutrition': enabled ? 'all' : 'off' } })), v4)
    await page.goto('/#/food-library')
    await expect(page.getByRole('heading', { name: 'Thực đơn', exact: true })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Điều hướng dinh dưỡng' })).toHaveCount(0)
    await expect(page.locator('.meal-plan-live-card')).toHaveCount(6)
    const mealsBefore = await page.evaluate(() => localStorage.getItem('aura:nutrition:meals:v2:demo-admin'))
    await expect(page.getByRole('tablist', { name: 'Nội dung thực đơn' }).getByRole('tab')).toHaveCount(3)
    await page.getByRole('tab', { name: 'Nguyên liệu', exact: true }).click()
    await expect(page.locator('.meal-plan-live-card')).toHaveCount(4)
    await page.getByRole('button', { name: 'Lưu Cơm trắng', exact: true }).click()
    await page.getByRole('button', { name: 'Xem món đã lưu', exact: true }).click()
    await expect(page.locator('.meal-plan-live-card')).toHaveCount(1)
    await expect(page.getByRole('button', { name: /Ghi nhật ký/ })).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('aura:nutrition:meals:v2:demo-admin'))).toBe(mealsBefore)
    await page.goto('/#/food-library?tab=ingredients&saved=1')
    await expect(page.locator('.meal-plan-live-card')).toHaveCount(1)
    await page.getByRole('button', { name: 'Xem chi tiết Cơm trắng', exact: true }).click()
    await expect(page).toHaveURL(/#\/food-library\?tab=ingredients&saved=1&foodId=demo-com-trang$/)
    await page.getByRole('button', { name: 'Quay lại thực đơn', exact: true }).click()
    await expect(page.locator('.meal-plan-live-card')).toHaveCount(1)
    await page.getByRole('button', { name: 'Xem chi tiết Cơm trắng', exact: true }).click()
    await page.reload()
    await expect(page.locator('#nutrition-food-title')).toHaveText('Cơm trắng')
    await expect(page.getByRole('button', { name: /Ghi nhật ký/ })).toHaveCount(0)
    await expect(page.getByText(/Trang nguồn không nêu rõ khẩu phần/)).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(remoteWrites).toEqual([])
    expect(errors).toEqual([])
  })
}
