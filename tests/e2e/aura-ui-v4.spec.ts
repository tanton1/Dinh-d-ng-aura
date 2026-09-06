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
    await expect(dock.getByRole('button', { name: 'Thêm' })).toBeVisible()
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

  const todayPanel = page.locator('#nutrition-workspace-panel-today')
  const todayBox = await todayPanel.boundingBox()
  expect(todayBox).not.toBeNull()
  expect(todayBox!.x).toBeLessThanOrEqual(1)
  expect(todayBox!.x + todayBox!.width).toBeGreaterThanOrEqual(389)

  const sections = page.getByRole('navigation', { name: 'Điều hướng dinh dưỡng' })
  await expect(sections.getByRole('button')).toHaveCount(4, { timeout: 10_000 })
  expect(await sections.getByRole('button').allTextContents()).toEqual(['Hôm nay', 'Nhật ký', 'Kế hoạch', 'Khám phá'])
  await sections.getByRole('button', { name: 'Khám phá' }).click()
  await expect(page.getByRole('heading', { name: 'Tìm món và hiểu tiến độ' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Nhật ký cổ điển/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Thực đơn đã xác nhận/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Kế hoạch tuần/ })).toHaveCount(0)
  await page.getByRole('button', { name: /Thư viện món ăn/ }).click()
  await expect(page).toHaveURL(/#\/nutrition\?section=explore&view=catalog$/)
  await expect(page.getByRole('heading', { name: /Món ăn & thực phẩm/i })).toBeVisible()
  const catalogBox = await page.locator('.nutrition-route-page--catalog').boundingBox()
  expect(catalogBox).not.toBeNull()
  expect(catalogBox!.x).toBeLessThanOrEqual(1)
  expect(catalogBox!.x + catalogBox!.width).toBeGreaterThanOrEqual(389)
  await expectNoHorizontalOverflow(page)
})

test('nutrition plan restores the classic two-tab meal plan page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await enableAuraUiV4(page)
  await page.goto('/#/nutrition?section=plan')

  const plan = page.locator('.meal-plan-page-container')
  await expect(plan).toBeVisible()
  await expect(plan.getByRole('heading', { name: 'THỰC ĐƠN' })).toBeVisible()
  await expect(plan.getByRole('tab', { name: 'Thực đơn', exact: true })).toBeVisible()
  await expect(plan.getByRole('tab', { name: 'Kế hoạch 7 ngày', exact: true })).toBeVisible()
  await plan.getByRole('tab', { name: 'Kế hoạch 7 ngày', exact: true }).click()
  await expect(plan.getByRole('tab', { name: 'Kế hoạch 7 ngày', exact: true })).toHaveClass(/meal-plan-tab-btn--active/)
  await expectNoHorizontalOverflow(page)
})

test('nutrition diary is a touch-safe history workspace with day, week and month views', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await enableAuraUiV4(page)
  await page.goto('/#/nutrition?section=diary')

  const diary = page.locator('#nutrition-workspace-panel-diary')
  await expect(diary.getByRole('heading', { name: 'Tra cứu những gì bạn đã ghi' })).toBeVisible()
  await expect(page.locator('#nutrition-workspace-panel-today')).toHaveCount(0)
  await expect(diary.locator('.nutrition-diary-overview')).toBeVisible()
  await expect(diary.locator('.nutrition-diary-overview__stats > div')).toHaveCount(4)

  const quickBox = await diary.getByRole('complementary', { name: 'Thêm bản ghi' }).boundingBox()
  const timelineBox = await diary.locator('.nutrition-diary-timeline').boundingBox()
  expect(quickBox).not.toBeNull()
  expect(timelineBox).not.toBeNull()
  expect(quickBox!.y).toBeLessThan(timelineBox!.y)

  const views = diary.getByRole('tablist', { name: 'Chế độ xem nhật ký' })
  await expect(views.getByRole('tab')).toHaveCount(3)
  expect(await views.getByRole('tab').allTextContents()).toEqual(['Ngày', 'Tuần', 'Tháng'])

  await views.getByRole('tab', { name: 'Tuần' }).click()
  await expect(diary.locator('.nutrition-diary-period-list > button')).toHaveCount(7)
  await expect(views.getByRole('tab', { name: 'Tuần' })).toHaveAttribute('aria-selected', 'true')

  await views.getByRole('tab', { name: 'Tháng' }).click()
  expect(await diary.locator('.nutrition-diary-month__grid > button').count()).toBeGreaterThan(27)
  const periodToolbar = diary.getByRole('region', { name: 'Thời gian nhật ký' })
  await periodToolbar.getByRole('button', { name: 'Tháng trước' }).click()
  await diary.locator('.nutrition-diary-month__grid > button:not([disabled])').last().click()
  await expect(views.getByRole('tab', { name: 'Ngày' })).toHaveAttribute('aria-selected', 'true')
  await views.getByRole('tab', { name: 'Tháng' }).click()
  await expect(periodToolbar.getByRole('button', { name: 'Tháng sau' })).toBeEnabled()
  await periodToolbar.getByRole('button', { name: 'Tháng sau' }).click()
  await diary.locator('.nutrition-diary-month__grid > button.is-selected').click()
  await expect(views.getByRole('tab', { name: 'Ngày' })).toHaveAttribute('aria-selected', 'true')

  const shortButtons = await diary.getByRole('button').evaluateAll((buttons) => buttons
    .filter((button) => {
      const box = button.getBoundingClientRect()
      return getComputedStyle(button).display !== 'none' && box.width > 0 && box.height > 0
    })
    .filter((button) => button.getBoundingClientRect().height < 44)
    .map((button) => ({ label: button.textContent?.trim() || button.getAttribute('aria-label'), height: button.getBoundingClientRect().height })))
  expect(shortButtons).toEqual([])
  await expectNoHorizontalOverflow(page)
})

test('nutrition plan keeps the classic meal and seven-day tabs', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 })
  await enableAuraUiV4(page)
  await page.goto('/#/nutrition?section=plan')

  const plan = page.locator('.meal-plan-page-container')
  await expect(plan.getByRole('tab', { name: 'Thực đơn', exact: true })).toHaveClass(/meal-plan-tab-btn--active/)
  await expect(plan.getByRole('tab', { name: 'Kế hoạch 7 ngày', exact: true })).toBeVisible()
  await expect(plan.getByText('Ức gà áp chảo & rau củ')).toBeVisible()
  await plan.locator('.meal-plan-filter-trigger').click()
  await expect(plan.getByRole('combobox', { name: 'Nhóm món' })).toBeVisible()
  await plan.getByRole('button', { name: 'Ghi vào nhật ký' }).first().click()
  const mealEditor = page.getByRole('dialog', { name: 'Kiểm tra bữa ăn' })
  await expect(mealEditor).toBeVisible()
  await mealEditor.getByRole('button', { name: 'Đóng' }).click()
  await plan.getByRole('tab', { name: 'Kế hoạch 7 ngày', exact: true }).click()
  await expect(plan.getByRole('tab', { name: 'Kế hoạch 7 ngày', exact: true })).toHaveClass(/meal-plan-tab-btn--active/)
  await expect(plan.getByRole('tablist', { name: 'Chọn ngày trong kế hoạch' }).getByRole('tab')).toHaveCount(7)
  await expectNoHorizontalOverflow(page)
})

test('Aura Academy shows one focused course on the responsive curriculum artwork', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await enableAuraUiV4(page)
  await page.goto('/#/courses')

  const hero = page.locator('.academy-single-course')
  const artwork = hero.locator('.academy-single-course__background')
  await expect(hero.getByRole('heading', { name: /Làm chủ dinh dưỡng cùng AURA/i })).toBeVisible()
  await expect(hero.getByRole('button', { name: /học/i })).toBeVisible()
  await expect(artwork).toBeVisible()
  expect(await artwork.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth >= 1200)).toBe(true)
  await expect(page.locator('.academy-catalog-intro, .catalog-filter-bar, .courses-grid-v2')).toHaveCount(0)
  await hero.getByRole('button', { name: /học/i }).click()
  await expect(page).toHaveURL(/#\/course-detail\?courseId=/)
  const studio = page.locator('.academy-learning-studio')
  await expect(studio.getByRole('heading', { name: 'Hiểu · Nhớ · Làm · Dùng' })).toBeVisible()
  await expect(studio.locator('.academy-learning-card')).toHaveCount(9)
  await expect(studio.locator('.academy-learning-studio__status')).toContainText(/Đang học|Cần ôn|Sẵn sàng thực hành|Đã nắm vững/)
  await studio.getByRole('navigation', { name: 'Các bước học trong chương' }).getByRole('button', { name: /Ghi nhớ|Nhớ/ }).click()
  await expect(studio.getByRole('heading', { name: 'Hôm nay cần ôn' })).toBeVisible()
  await studio.getByRole('navigation', { name: 'Các bước học trong chương' }).getByRole('button', { name: 'Làm' }).click()
  const sharing = studio.getByText('Chia sẻ bài thực hành với coach phụ trách').locator('..')
  await expect(sharing).toBeVisible()
  expect((await sharing.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)

  await page.getByRole('button', { name: 'Mục lục' }).click()
  const outline = page.getByRole('dialog', { name: 'Mục lục khóa học' })
  await outline.getByRole('button', { name: /CHƯƠNG 5 Tiêu hóa và hấp thu/i }).click()
  await studio.getByRole('navigation', { name: 'Các bước học trong chương' }).getByRole('button', { name: 'Làm' }).click()
  const portfolio = studio.getByRole('region', { name: 'Bản đồ nền tảng' })
  await expect(portfolio).toContainText('0/5 bài thực hành')
  await portfolio.getByRole('button', { name: /Mở portfolio để tổng hợp/ }).click()
  await expect(portfolio.getByText('RUBRIC CAPSTONE')).toBeVisible()
  await expect(portfolio.getByText('Chia sẻ portfolio với coach phụ trách')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('nutrition V4 lazy-loads quick add and hydration sheets without covering the mobile dock', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await enableAuraUiV4(page)
  await page.goto('/#/nutrition')

  await page.getByRole('button', { name: 'Thêm nhanh', exact: true }).last().click()
  const quickAdd = page.getByRole('dialog', { name: 'Bạn muốn ghi lại gì?' })
  await expect(quickAdd).toBeVisible()
  await expect.poll(() => quickAdd.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await quickAdd.getByRole('button', { name: /Ghi lượng nước/ }).click()

  const water = page.getByRole('dialog', { name: 'Ghi lượng nước uống' })
  await expect(water).toBeVisible()
  await expect(water.getByRole('button', { name: /Ghi \+250 ml nước/ })).toBeEnabled()
  const dock = page.getByRole('navigation', { name: 'Điều hướng học viên' })
  await expect(dock).toBeHidden()
  await expect.poll(async () => {
    const waterBox = await water.boundingBox()
    if (!waterBox) return Number.POSITIVE_INFINITY
    return waterBox.y + waterBox.height - 844
  }).toBeLessThanOrEqual(1)
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

test('availability V4 defaults to next week and keeps its submit action above the dock', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await enableAuraUiV4(page)
  await page.goto('/#/student-availability')

  await expect(page.getByRole('heading', { name: 'Thời gian có thể tập', exact: true })).toBeVisible()
  await expect(page.getByText('Tuần sau', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Ma trận thời gian rảnh' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tuần trước' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Tuần sau' })).toBeEnabled()

  const footer = page.locator('.student-availability-card > footer')
  const dock = page.getByRole('navigation', { name: 'Điều hướng học viên' })
  await footer.scrollIntoViewIfNeeded()
  await expect(footer).toBeVisible()
  const [footerBox, dockBox] = await Promise.all([footer.boundingBox(), dock.boundingBox()])
  expect(footerBox).not.toBeNull()
  expect(dockBox).not.toBeNull()
  expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(dockBox!.y - 8)
  await expectNoHorizontalOverflow(page)

  await page.locator('.student-schedule-matrix td button[aria-pressed="true"]').first().click()
  await page.getByRole('button', { name: 'Gửi lịch rảnh' }).click()
  await expect(page.getByRole('dialog', { name: 'Chỉ gửi 4 khung?' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
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

test('Admin Dashboard V4 keeps urgent work before attendance on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await enableAuraUiV4(page)
  await page.goto('/#/admin-dashboard')

  const tasks = page.getByRole('heading', { name: 'Hôm nay cần làm' }).locator('..').locator('..')
  const attendance = page.getByRole('heading', { name: 'Ca tập trong ngày' }).locator('..').locator('..')
  await expect(tasks).toBeVisible()
  await expect(attendance).toBeVisible()
  const [tasksBox, attendanceBox] = await Promise.all([tasks.boundingBox(), attendance.boundingBox()])
  expect(tasksBox).not.toBeNull()
  expect(attendanceBox).not.toBeNull()
  expect(tasksBox!.y).toBeLessThan(attendanceBox!.y)
  await expectNoHorizontalOverflow(page)
})
