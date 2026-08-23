import { expect, test } from '@playwright/test'

test('demo dashboard loads without a fatal runtime error', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/#/home')
  await expect(page.locator('#root')).not.toBeEmpty()
  await expect(page.getByText('Aura đang gặp sự cố')).toHaveCount(0)
  expect(pageErrors).toEqual([])
})

test('student mobile dock keeps six Aura tabs ordered and full-width safe', async ({ page }) => {
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/#/home')

    const dock = page.getByRole('navigation', { name: 'Điều hướng học viên' })
    await expect(dock).toBeVisible()
    await expect(dock.getByRole('button')).toHaveCount(6)
    expect(await dock.getByRole('button').allTextContents()).toEqual([
      'Hôm nay',
      'Dinh dưỡng',
      'Lịch học viên',
      'Tiến độ',
      'Học',
      'Cá nhân',
    ])

    const box = await dock.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(5)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width - 5)

    const appearance = await dock.evaluate((element) => {
      const active = element.querySelector('button.active')
      return {
        radius: Number.parseFloat(getComputedStyle(element).borderRadius),
        background: active ? getComputedStyle(active, '::before').backgroundImage : '',
        color: active ? getComputedStyle(active).color : '',
      }
    })
    expect(appearance.radius).toBeGreaterThanOrEqual(24)
    expect(appearance.background).toContain('linear-gradient')
    expect(appearance.color).toBe('rgb(17, 13, 20)')

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  }
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

test('retired food, menu and workout links redirect to active workspaces', async ({ page }) => {
  const redirects = [
    ['/#/food-database', /#\/nutrition$/],
    ['/#/dish-collection', /#\/nutrition$/],
    ['/#/meal-plan', /#\/nutrition\?section=plan$/],
    ['/#/admin-workout-plans', /#\/admin-programs$/],
    ['/#/admin-meal-plans', /#\/admin-eat-clean$/],
  ] as const

  for (const [legacyPath, expectedUrl] of redirects) {
    await page.goto(legacyPath)
    await expect(page).toHaveURL(expectedUrl)
  }
})

test('nutrition exposes both the goal-based meal plan and full food catalog while learner navigation opens the linked schedule', async ({ page }) => {
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
  await page.goto('/#/meal-plan')
  await expect(page).toHaveURL(/#\/nutrition\?section=plan$/)
  await expect(page.getByRole('heading', { name: /^THỰC ĐƠN$/i })).toBeVisible()
  await expect(page.getByText(/^THEO MỨC NĂNG LƯỢNG$/i)).toBeVisible()
  await expect(page.getByRole('heading', { name: /^THEO MỤC TIÊU$/i })).toBeVisible()
  await expect(page.getByText(/kcal/).first()).toBeVisible()

  await page.getByRole('button', { name: 'Món ăn' }).click()
  await expect(page).toHaveURL(/#\/nutrition\?section=catalog$/)
  await expect(page.getByRole('heading', { name: /Món ăn & thực phẩm/i })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/home')
  await page.locator('.mobile-bottom-nav').getByRole('button', { name: 'Lịch học viên' }).click()
  await expect(page).toHaveURL(/#\/schedule$/)
  await expect(page.getByRole('heading', { name: /^Lịch tập luyện$/i })).toBeVisible()
  const studentScheduleTabs = page.getByRole('navigation', { name: 'Nội dung lịch học viên' })
  await expect(studentScheduleTabs).toBeVisible()
  await expect(studentScheduleTabs.getByRole('button', { name: 'Tuần này' })).toBeVisible()
  await expect(studentScheduleTabs.getByRole('button', { name: 'Tuần sau' })).toBeVisible()
  await expect(studentScheduleTabs.getByRole('button', { name: 'Yêu cầu' })).toBeVisible()
  await expect(studentScheduleTabs.getByRole('button', { name: 'Lịch sử' })).toBeVisible()
  await studentScheduleTabs.getByRole('button', { name: 'Lịch rảnh' }).click()
  await expect(page.getByRole('region', { name: 'Ma trận thời gian rảnh' })).toBeVisible()
  const scheduleLayout = await page.evaluate(() => {
    const schedulePage = document.querySelector<HTMLElement>('.student-schedule-page')!
    const matrix = document.querySelector<HTMLElement>('.student-schedule-matrix-scroll')!
    const content = document.querySelector<HTMLElement>('.page-content')!
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      matrixEdgeDelta: Math.abs(matrix.getBoundingClientRect().left - schedulePage.getBoundingClientRect().left),
      matrixRadius: getComputedStyle(matrix).borderRadius,
      contentBackground: getComputedStyle(content).backgroundImage,
    }
  })
  expect(scheduleLayout.overflow).toBeLessThanOrEqual(1)
  expect(scheduleLayout.matrixEdgeDelta).toBeLessThanOrEqual(1)
  expect(scheduleLayout.matrixRadius).toBe('0px')
  expect(scheduleLayout.contentBackground).toContain('linear-gradient')
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
  await expect(page.locator('.aura-today-flow').getByRole('heading', { name: /Hôm nay của/i })).toBeVisible()

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
