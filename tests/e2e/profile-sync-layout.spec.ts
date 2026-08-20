import { expect, test } from '@playwright/test'

for (const width of [360, 390, 430]) {
  test(`profile and nutrition remain within a ${width}px mobile viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.addInitScript(() => {
      window.localStorage.setItem('aura:nutrition-profile:demo-admin', JSON.stringify({
        goal: 'maintain', age: 30, biologicalSex: 'female', heightCm: 165, weightKg: 60,
        activityLevel: 'moderate', trainingSessions: 3, eatingStyle: 'Cân bằng', allergies: '',
      }))
    })
    await page.goto('/#/profile')
    await expect(page.getByRole('heading', { name: 'Hồ sơ cá nhân' })).toBeVisible()
    const profileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(profileOverflow).toBeLessThanOrEqual(1)

    await page.goto('/#/nutrition?section=today')
    await expect(page.getByTestId('nutrition-dashboard')).toBeVisible()
    const nutritionOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(nutritionOverflow).toBeLessThanOrEqual(1)
  })
}
