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

test('new package date fields stay fixed inside the phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 844 })
  await page.goto('/#/admin-pt-students')
  const studentCard = page.locator('.student-management__card').first()
  await expect(studentCard).toBeVisible()
  await studentCard.getByRole('button', { name: /Xem chi tiết/i }).click()
  await page.getByRole('button', { name: 'Đăng ký gói mới' }).click()

  const dialog = page.getByRole('dialog', { name: 'Đăng ký gói tập mới' })
  await expect(dialog).toBeVisible()
  await dialog.locator('select').first().selectOption('custom')
  const dates = dialog.locator('input[type="date"]')
  await expect(dates).toHaveCount(2)
  await dates.first().fill('2026-08-26')

  const layout = await page.evaluate(() => {
    const modal = document.querySelector<HTMLElement>('.student-package-modal')
    const sheet = document.querySelector<HTMLElement>('.student-package-modal__dialog')
    const dateInputs = [...document.querySelectorAll<HTMLInputElement>('.student-package-modal input[type="date"]')]
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

test('PT student detail groups important data into three slides and hides unlinked tabs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/admin-pt-students')
  const studentCard = page.locator('.student-management__card').first()
  await expect(studentCard).toBeVisible()
  await studentCard.getByRole('button', { name: /Xem chi tiết/i }).click()

  const detailCarousel = page.getByRole('region', { name: 'Tóm tắt hồ sơ và gói tập' })
  await expect(detailCarousel).toBeVisible()
  await expect(detailCarousel.locator('.student-detail__carousel-slide')).toHaveCount(3)
  const tabs = page.getByRole('tablist', { name: 'Nội dung hồ sơ học viên' })
  await expect(tabs).toBeVisible()
  await expect(tabs.getByRole('tab', { name: /Dinh dưỡng|Bữa ăn/i })).toHaveCount(0)
})

test('training history keeps reports compact and advanced filters collapsed on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/admin-pt-students')
  const studentCard = page.locator('.student-management__card').first()
  await expect(studentCard).toBeVisible()
  await studentCard.getByRole('button', { name: /Xem chi tiết/i }).click()
  await page.getByRole('tab', { name: 'Lịch sử' }).click()

  const history = page.locator('.training-history')
  await expect(history.getByRole('heading', { name: 'Lịch sử tập' })).toBeVisible()
  await expect(history.locator('.training-history__advanced')).toHaveCount(0)
  await history.getByRole('button', { name: 'Bộ lọc' }).click()
  await expect(history.locator('.training-history__advanced')).toBeVisible()

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    historyRight: document.querySelector<HTMLElement>('.training-history')?.getBoundingClientRect().right ?? 0,
  }))
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1)
  expect(dimensions.historyRight).toBeLessThanOrEqual(dimensions.viewport)
})
