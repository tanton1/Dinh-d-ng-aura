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
  await expect(page.getByText(/Kế hoạch 7 Ngày mẫu/i)).toBeVisible()
})

test('Today Flow belongs to Home while nutrition guidance follows the three-slide carousel', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('aura:nutrition-profile:demo-admin', JSON.stringify({
      goal: 'maintain',
      age: 28,
      biologicalSex: 'female',
      heightCm: 162,
      weightKg: 58,
      activityLevel: 'moderate',
      trainingSessions: 4,
      eatingStyle: 'Không giới hạn',
      allergies: '',
      mealsPerDay: 3,
      dislikes: '',
      budget: 'medium',
      prepTime: 'medium',
      favoriteCuisine: 'Đa dạng',
      reminders: { water: false, breakfast: false, lunch: false, dinner: false },
    }))
  })
  await page.goto('/#/home')
  await expect(page.getByText('AURA TODAY FLOW', { exact: true })).toBeVisible()

  await page.goto('/#/nutrition?section=today')

  await expect(page.getByText('AURA TODAY FLOW', { exact: true })).toHaveCount(0)
  await expect(page.getByText('AURA DAILY PULSE', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: /Một ngày, bốn điểm chạm/i })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Việc nên làm tiếp theo' })).toBeVisible()

  const carousel = page.getByRole('region', { name: 'Năng lượng và dinh dưỡng hôm nay' })
  const nextAction = page.getByRole('region', { name: 'Việc nên làm tiếp theo' })
  const mealRhythm = page.getByRole('heading', { name: /Một ngày, bốn điểm chạm/i })
  const [carouselBox, nextActionBox, mealRhythmBox] = await Promise.all([
    carousel.boundingBox(),
    nextAction.boundingBox(),
    mealRhythm.boundingBox(),
  ])
  expect(carouselBox).not.toBeNull()
  expect(nextActionBox).not.toBeNull()
  expect(mealRhythmBox).not.toBeNull()
  expect(nextActionBox!.y).toBeGreaterThan(carouselBox!.y + carouselBox!.height)
  expect(mealRhythmBox!.y).toBeGreaterThan(nextActionBox!.y)

  const todayOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(todayOverflow).toBeLessThanOrEqual(1)

  await page.getByRole('button', { name: 'Nhật ký' }).click()
  await expect(page.getByText('TỔNG KẾT TRONG NGÀY')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cần kiểm tra' })).toBeVisible()
  await page.getByRole('button', { name: 'Cần kiểm tra' }).click()
  await expect(page.getByText('Không có dữ liệu trong bộ lọc này')).toBeVisible()

  const diaryOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(diaryOverflow).toBeLessThanOrEqual(1)
})
