import { expect, test } from '@playwright/test'

for (const v4 of [false, true]) {
  test(`real application opens the cookbook from learning navigation and retains recipe deep links (UI v4=${v4})`, async ({ page }) => {
    const errors: string[] = []
    const sourceRequests: string[] = []
    const catalogRequests: string[] = []
    const remoteServices: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (request) => {
      if (request.url().includes('/cooking/sources/')) sourceRequests.push(request.url())
      if (/\/cookbook-[^/]+\.js/.test(request.url())) catalogRequests.push(request.url())
    })
    await page.route(/firestore\.googleapis\.com|cloudfunctions\.net|\.run\.app\//, (route) => {
      remoteServices.push(route.request().url())
      return route.abort()
    })
    await page.addInitScript((enabled) => {
      localStorage.setItem('aura:nutrition-profile:demo-admin', JSON.stringify({
        goal: 'maintain', age: 28, biologicalSex: 'female', heightCm: 162, weightKg: 58,
        activityLevel: 'moderate', trainingSessions: 4, eatingStyle: 'Không giới hạn',
        allergies: '', mealsPerDay: 3, dislikes: '', budget: 'medium', prepTime: 'medium',
        favoriteCuisine: 'Đa dạng', reminders: { water: false, breakfast: false, lunch: false, dinner: false },
      }))
      localStorage.setItem('aura:ui-rollout:demo-config:v1', JSON.stringify({
        schemaVersion: 1, surfaces: { shell: enabled ? 'all' : 'off', 'member-nutrition': enabled ? 'all' : 'off' },
      }))
    }, v4)
    await page.goto('/#/nutrition?section=explore')
    await expect(page.getByTestId('nutrition-dashboard')).toBeVisible()
    let entry = page.getByRole('button', { name: 'Vào Bếp cùng Aura', exact: true })
    const more = page.getByRole('button', { name: 'Thêm', exact: true })
    const menu = page.getByRole('button', { name: 'Mở menu', exact: true })
    if ((page.viewportSize()?.width ?? 1280) < 900) {
      if (await more.isVisible()) {
        await more.click()
        entry = page.locator('.aura-mobile-more__routes').getByRole('button', { name: 'Vào Bếp cùng Aura', exact: true })
      }
      else await menu.click()
    }
    await expect(entry).toBeVisible()
    await expect(page.locator('.nutrition-page')).toHaveClass(v4 ? /nutrition-page--v4/ : /^(?!.*nutrition-page--v4)/)
    expect(catalogRequests).toEqual([])
    await entry.click()
    await expect(page.getByRole('heading', { name: 'Vào Bếp cùng Aura', exact: true })).toBeVisible()
    await expect(page.locator('.cooking-recipe-card')).toHaveCount(12)
    expect(catalogRequests.length).toBeGreaterThan(0)
    await page.getByRole('searchbox', { name: 'Tìm tên món hoặc nguyên liệu' }).fill('yen mach ngam')
    await page.locator('#cooking-open-B08').click()
    await expect(page).toHaveURL(/#\/cooking\?recipe=B08$/)
    await page.reload()
    await expect(page.locator('.cooking-detail h1')).toContainText('Yến mạch ngâm')
    await expect(page.locator('.cooking-recipe-facts')).toContainText('Ngâm lạnh 6-12 giờ')
    await page.getByRole('link', { name: 'Vào bếp thôi' }).click()
    await expect(page.locator('.cooking-step-label')).toHaveText('Bước 1/4')
    await page.getByRole('button', { name: 'Bước tiếp' }).click()
    await expect(page.locator('.cooking-step-label')).toHaveText('Bước 2/4')
    await page.getByRole('link', { name: 'Về danh sách món' }).click()
    await page.locator('.cooking-back').click()
    await expect(page).toHaveURL(/#\/home$/)
    expect(sourceRequests).toEqual([])
    expect(remoteServices).toEqual([])
    expect(errors).toEqual([])
  })
}
