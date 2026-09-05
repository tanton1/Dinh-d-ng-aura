import { expect, test } from '@playwright/test'

for (const width of [360, 390, 430]) {
  test(`PT student form remains reachable and mobile-safe at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/#/admin-pt-students')
    const overview = page.getByRole('region', { name: 'Tổng quan vận hành học viên' })
    await expect(overview).toBeVisible()
    await expect(overview.locator('.student-management__carousel-slide')).toHaveCount(3)
    const filterToggle = page.locator('.student-management__filter-toggle')
    await expect(filterToggle).toBeVisible()
    await filterToggle.click()
    await expect(page.locator('.student-management__filter-grid')).toHaveClass(/is-open/)
    const openButton = page.getByRole('button', { name: 'Thêm học viên' })
    await expect(openButton).toBeVisible()
    await openButton.click()

    const dialog = page.getByRole('dialog', { name: 'Thêm học viên mới' })
    await expect(dialog).toBeVisible()
    const birthDate = dialog.locator('input[type="date"]')
    await birthDate.fill('2000-12-31')
    const saveButton = dialog.getByRole('button', { name: 'Lưu thông tin' })
    await saveButton.scrollIntoViewIfNeeded()
    await expect(saveButton).toBeVisible()

    const layout = await page.evaluate(() => {
      const modal = document.querySelector<HTMLElement>('.student-management__modal')
      const dialogElement = document.querySelector<HTMLElement>('.student-management__dialog')
      const action = document.querySelector<HTMLElement>('.student-management__form-actions')
      return {
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        modalWidth: modal?.scrollWidth ?? 0,
        dialogWidth: dialogElement?.getBoundingClientRect().width ?? 0,
        actionBottom: action?.getBoundingClientRect().bottom ?? 0,
        dateClientWidth: document.querySelector<HTMLInputElement>('.student-management__form input[type="date"]')?.clientWidth ?? 0,
        dateScrollWidth: document.querySelector<HTMLInputElement>('.student-management__form input[type="date"]')?.scrollWidth ?? 0,
        dateRight: document.querySelector<HTMLInputElement>('.student-management__form input[type="date"]')?.getBoundingClientRect().right ?? 0,
        viewportHeight: window.innerHeight,
      }
    })
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1)
    expect(layout.modalWidth).toBeLessThanOrEqual(layout.viewportWidth + 1)
    expect(layout.dialogWidth).toBeLessThanOrEqual(layout.viewportWidth)
    expect(layout.dateClientWidth).toBeGreaterThan(0)
    expect(layout.dateScrollWidth).toBeLessThanOrEqual(layout.dateClientWidth + 1)
    expect(layout.dateRight).toBeLessThanOrEqual(layout.viewportWidth)
    expect(layout.actionBottom).toBeGreaterThan(0)
    expect(layout.actionBottom).toBeLessThanOrEqual(layout.viewportHeight)
  })
}

test('PT student roster uses a desktop table without leaking horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/admin-pt-students')

  const roster = page.locator('.student-roster')
  await expect(roster).toBeVisible()
  await expect(page.locator('.student-management__mobile-list')).toBeHidden()

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    rosterRight: document.querySelector<HTMLElement>('.student-roster')?.getBoundingClientRect().right ?? 0,
  }))
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1)
  expect(dimensions.rosterRight).toBeLessThanOrEqual(dimensions.viewport)
})

test('Student 360 contract date fields stay fixed inside the phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 844 })
  await page.goto('/#/admin-pt-students')
  const studentCard = page.locator('.student-management__card').first()
  await expect(studentCard).toBeVisible()
  await studentCard.getByRole('button', { name: /Mở Học viên 360/i }).click()
  await expect(page).toHaveURL(/#\/student-360\?studentId=.*source=admin-pt-students/)
  await page.locator('summary[aria-label="Mở menu nghiệp vụ"]').click()
  await page.getByRole('button', { name: /Đổi PT · bảo lưu · sửa hợp đồng/ }).click()
  await page.getByRole('button', { name: 'Tạo hợp đồng' }).click()

  const dialog = page.locator('.student360-contract-form')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Tạo hợp đồng mới' })).toBeVisible()
  const dates = dialog.locator('input[type="date"]')
  await expect(dates).toHaveCount(2)
  await dates.first().fill('2026-08-26')

  const layout = await page.evaluate(() => {
    const modal = document.querySelector<HTMLElement>('.student360-dialog-layer')
    const sheet = document.querySelector<HTMLElement>('.student360-contract-form')
    const dateInputs = [...document.querySelectorAll<HTMLInputElement>('.student360-contract-form input[type="date"]')]
    return {
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      modalWidth: modal?.scrollWidth ?? 0,
      sheetLeft: sheet?.getBoundingClientRect().left ?? -1,
      sheetRight: sheet?.getBoundingClientRect().right ?? 0,
      dates: dateInputs.map((input) => ({ clientWidth: input.clientWidth, scrollWidth: input.scrollWidth, left: input.getBoundingClientRect().left, right: input.getBoundingClientRect().right })),
    }
  })
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1)
  expect(layout.modalWidth).toBeLessThanOrEqual(layout.viewportWidth + 1)
  expect(layout.sheetLeft).toBeGreaterThanOrEqual(0)
  expect(layout.sheetRight).toBeLessThanOrEqual(layout.viewportWidth)
  for (const input of layout.dates) {
    expect(input.clientWidth).toBeGreaterThan(0)
    expect(input.scrollWidth).toBeLessThanOrEqual(input.clientWidth + 1)
    expect(input.left).toBeGreaterThanOrEqual(0)
    expect(input.right).toBeLessThanOrEqual(layout.viewportWidth)
  }
})

test('Student 360 replaces the legacy detail with four metrics and five focused tabs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/admin-pt-students')
  const studentCard = page.locator('.student-management__card').first()
  await expect(studentCard).toBeVisible()
  await studentCard.getByRole('button', { name: /Mở Học viên 360/i }).click()

  await expect(page).toHaveURL(/#\/student-360\?studentId=.*source=admin-pt-students/)
  await expect(page.getByRole('region', { name: 'Chỉ số nhanh' }).locator('.student360-metric')).toHaveCount(4)
  const tabs = page.getByRole('navigation', { name: 'Nội dung Học viên 360 trên điện thoại' })
  await expect(tabs).toBeVisible()
  await expect(tabs.getByRole('button')).toHaveCount(5)
  await expect(page.locator('.mobile-bottom-nav')).toHaveCount(0)
  await tabs.getByRole('button', { name: 'Hoạt động' }).click()
  await expect(page.getByRole('heading', { name: 'Toàn bộ hoạt động' })).toBeVisible()
})

test('Student 360 activity timeline keeps filters compact and remains mobile-safe', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/admin-pt-students')
  const studentCard = page.locator('.student-management__card').first()
  await expect(studentCard).toBeVisible()
  await studentCard.getByRole('button', { name: /Mở Học viên 360/i }).click()
  await page.getByRole('navigation', { name: 'Nội dung Học viên 360 trên điện thoại' }).getByRole('button', { name: 'Hoạt động' }).click()

  const activity = page.locator('.student360-section')
  await expect(activity.getByRole('heading', { name: 'Toàn bộ hoạt động' })).toBeVisible()
  const typeFilters = activity.locator('.student360-filter-chips').first()
  await expect(typeFilters.getByRole('button')).toHaveCount(9)
  await typeFilters.getByRole('button', { name: 'Buổi tập' }).click()
  await expect(activity.locator('.student360-timeline')).toBeVisible()

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    activityRight: document.querySelector<HTMLElement>('.student360-section')?.getBoundingClientRect().right ?? 0,
  }))
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1)
  expect(dimensions.activityRight).toBeLessThanOrEqual(dimensions.viewport)
})

test('training history exposes request archives as separate mobile-safe tabs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/admin-training-history')
  const tabs = page.getByRole('tablist', { name: 'Nhật ký và yêu cầu PT' })
  await expect(tabs).toBeVisible()
  await expect(tabs.getByRole('tab')).toHaveCount(4)
  await tabs.getByRole('tab', { name: 'Đổi / Hủy' }).click()
  await expect(page.getByRole('heading', { name: 'Đổi và hủy lịch' })).toBeVisible()
  await tabs.getByRole('tab', { name: 'OFF / Bảo lưu' }).click()
  await expect(page.getByRole('heading', { name: 'OFF và bảo lưu' })).toBeVisible()
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    requestRight: document.querySelector<HTMLElement>('.operations-requests')?.getBoundingClientRect().right ?? 0,
  }))
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1)
  expect(dimensions.requestRight).toBeLessThanOrEqual(dimensions.viewport)
})
