import { expect, test } from '@playwright/test'

test('demo dashboard loads without a fatal runtime error', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/#/home')
  await expect(page.locator('#root')).not.toBeEmpty()
  await expect(page.getByText('Aura đang gặp sự cố')).toHaveCount(0)
  expect(pageErrors).toEqual([])
})

test('home route keeps deferred assets out of the initial request path', async ({ page }) => {
  await page.goto('/#/home')
  await expect(page.locator('#root')).not.toBeEmpty()

  const resourcePaths = await page.evaluate(() => performance
    .getEntriesByType('resource')
    .map((entry) => new URL(entry.name).pathname))

  expect(resourcePaths.some((path) => path.endsWith('/aura-onboarding.webp'))).toBe(true)
  expect(resourcePaths.some((path) => path.endsWith('/aura-onboarding.png'))).toBe(false)
  expect(resourcePaths.some((path) => path.includes('styles-admin-'))).toBe(false)
  expect(resourcePaths.some((path) => path.includes('vendor-firebase-messaging-'))).toBe(false)
})

test('admin meal plan route enforces auth or renders the workspace', async ({ page }) => {
  await page.goto('/#/admin-meal-plans')
  const signInHeading = page.getByRole('heading', { name: /Đăng nhập để tiếp tục hành trình/i })
  const mealPlanHeading = page.getByRole('heading', { name: /Quản lý Công thức & Kế hoạch Ăn 7 Ngày/i })
  await expect(signInHeading.or(mealPlanHeading)).toBeVisible()
  if (await signInHeading.isVisible()) {
    await expect(mealPlanHeading).toHaveCount(0)
    return
  }
  await expect(page.getByText(/Thư viện công thức/i)).toBeVisible()
  await expect(page.getByText(/Mẫu Meal Plan 7 ngày/i)).toBeVisible()
})
