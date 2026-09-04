import { expect, test, type Page } from '@playwright/test'

const rolloutConfig = {
  schemaVersion: 1,
  surfaces: {
    shell: 'all',
    'member-home': 'all',
    'member-schedule': 'all',
    'member-availability': 'all',
    'student-360': 'all',
    'admin-dashboard': 'all',
    'member-nutrition': 'all',
  },
  updatedAt: '2026-09-04T00:00:00.000Z',
  updatedBy: 'e2e',
}

async function enableAuraUiV4(page: Page) {
  await page.addInitScript((config) => {
    window.localStorage.setItem('aura:ui-rollout:demo-config:v1', JSON.stringify(config))
    window.localStorage.setItem('aura:nutrition-profile:demo-admin', JSON.stringify({
      goal: 'maintain', age: 28, biologicalSex: 'female', heightCm: 162, weightKg: 58,
      activityLevel: 'moderate', trainingSessions: 4, eatingStyle: 'Không giới hạn',
      allergies: '', mealsPerDay: 3, dislikes: '', budget: 'medium', prepTime: 'medium',
      favoriteCuisine: 'Đa dạng', reminders: { water: false, breakfast: false, lunch: false, dinner: false },
    }))
  }, rolloutConfig)
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }))).toEqual({ document: 0, body: 0 })
}

for (const width of [320, 360, 390, 430]) {
  test(`member shell V4 keeps five touch-safe items at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await enableAuraUiV4(page)
    await page.goto('/#/home')

    const dock = page.getByRole('navigation', { name: 'Điều hướng học viên' })
    await expect(dock.getByRole('button')).toHaveCount(5)
    expect(await dock.getByRole('button').allTextContents()).toEqual(['Hôm nay', 'Lịch', 'Dinh dưỡng', 'Tập luyện', 'Thêm'])
    expect(await dock.getByRole('button').evaluateAll((buttons) => buttons.every((button) => Number.parseFloat(getComputedStyle(button).fontSize) >= 12))).toBe(true)
    expect((await dock.getByRole('button').evaluateAll((buttons) => buttons.every((button) => button.getBoundingClientRect().width >= 44 && button.getBoundingClientRect().height >= 44)))).toBe(true)

    await dock.getByRole('button', { name: 'Thêm' }).click()
    const sheet = page.getByRole('dialog', { name: 'Thêm trong Aura' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('button', { name: /Gói tập/ })).toBeVisible()
    expect(await sheet.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
  })
}

test('nutrition V4 uses four primary sections and compatible nested routes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await enableAuraUiV4(page)
  await page.goto('/#/nutrition')

  const sections = page.getByRole('navigation', { name: 'Điều hướng dinh dưỡng' })
  await expect(sections.getByRole('button')).toHaveCount(4, { timeout: 10_000 })
  expect(await sections.getByRole('button').allTextContents()).toEqual(['Hôm nay', 'Nhật ký', 'Kế hoạch', 'Khám phá'])
  await sections.getByRole('button', { name: 'Khám phá' }).click()
  await expect(page.getByRole('heading', { name: 'Tìm món và hiểu tiến độ' })).toBeVisible()
  await page.getByRole('button', { name: /Thư viện món ăn/ }).click()
  await expect(page).toHaveURL(/#\/nutrition\?section=explore&view=catalog$/)
  await expect(page.getByRole('heading', { name: /Món ăn & thực phẩm/i })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('schedule V4 keeps three tabs and opens the read-only package from More', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await enableAuraUiV4(page)
  await page.goto('/#/schedule')

  await expect(page.getByRole('heading', { name: 'Lịch của bạn' })).toBeVisible()
  const scheduleTabs = page.getByRole('navigation', { name: 'Nội dung lịch học viên' })
  await expect(scheduleTabs.getByRole('button')).toHaveCount(3)
  expect(await scheduleTabs.getByRole('button').allTextContents()).toEqual(['Lịch', 'Yêu cầu', 'Lịch sử'])

  await page.getByRole('navigation', { name: 'Điều hướng học viên' }).getByRole('button', { name: 'Thêm' }).click()
  await page.getByRole('dialog', { name: 'Thêm trong Aura' }).getByRole('button', { name: /Gói tập/ }).click()
  await expect(page).toHaveURL(/#\/schedule\?tab=contract$/)
  await expect(page.getByRole('heading', { name: 'Gói tập của bạn' })).toBeVisible()
  await page.getByRole('button', { name: 'Quay lại lịch' }).click()
  await expect(page.getByRole('heading', { name: 'Lịch của bạn' })).toBeVisible()
})

test('legacy next-week schedule deep link selects a date inside next week', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await enableAuraUiV4(page)
  await page.goto('/#/schedule?tab=next-week')

  await expect(page.getByRole('heading', { name: 'Lịch của bạn' })).toBeVisible()
  const selectedDay = page.locator('.week-strip button[aria-pressed="true"]')
  await expect(selectedDay).toHaveCount(1)
  await expect(selectedDay).toHaveAttribute('aria-label', /^T2 ngày /)
  await expect(page.getByRole('button', { name: 'Tuần sau' })).toBeDisabled()
})

test('Staff V4 uses a role workspace dock and keeps extra routes in More', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await enableAuraUiV4(page)
  await page.goto('/#/home')
  await page.getByRole('button', { name: /Tài khoản/ }).click()
  await page.getByRole('button', { name: 'PT Gym' }).click()

  const dock = page.getByRole('navigation', { name: 'Điều hướng Staff' })
  await expect(dock.getByRole('button')).toHaveCount(5)
  expect(await dock.getByRole('button').allTextContents()).toEqual(['Hôm nay', 'Học viên', 'Lịch', 'Giáo án', 'Thêm'])
  await dock.getByRole('button', { name: 'Thêm' }).click()
  const sheet = page.getByRole('dialog', { name: 'Không gian PT' })
  await expect(sheet.getByRole('button', { name: /Duyệt món/ })).toBeVisible()
  await expect(sheet.getByRole('button', { name: /Lương/ })).toBeVisible()
  await expect(sheet.getByRole('button', { name: /Tái ký/ })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

for (const width of [320, 360, 390, 430]) {
test(`Student 360 V4 stays immersive and defers timeline at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 })
  await enableAuraUiV4(page)
  await page.goto('/#/student-360?studentId=student-demo&source=staff-students')

  await expect(page.getByRole('heading', { name: 'Nguyễn Minh Anh' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Cần xử lý' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sức khỏe hành trình' })).toBeVisible()
  await expect(page.locator('.student360-timeline')).toHaveCount(0)
  await expect(page.locator('.mobile-bottom-nav')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Chỉ số nhanh' }).locator('.student360-metric')).toHaveCount(4)
  await expectNoHorizontalOverflow(page)
})
}

test('Admin Dashboard V4 shows all five KPI cards on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await enableAuraUiV4(page)
  await page.goto('/#/admin-dashboard')

  const carousel = page.getByRole('region', { name: 'Báo cáo nhanh theo kỳ' })
  await expect(carousel.locator('.aura-metric-carousel__slide')).toHaveCount(5)
  const layout = await carousel.locator('.aura-metric-carousel__viewport').evaluate((element) => ({
    columns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
    overflowX: getComputedStyle(element).overflowX,
  }))
  expect(layout.columns).toBe(5)
  expect(layout.overflowX).toBe('visible')
})
