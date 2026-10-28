import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-28T05:00:00Z'))
  await page.route('**/*', (route) => route.request().url().startsWith('http://127.0.0.1:4191/') ? route.continue() : route.abort())
})

test('entry loads today only; day and week navigation keep requests and counters in sync', async ({ page }, info) => {
  await page.goto('/tests/nutrition-review-ui/index.html')
  await expect(page.locator('.nrw-review-card')).toHaveCount(2)
  expect(await page.evaluate(() => (window as any).reviewTest.reads[0])).toMatchObject({ startDate: '2026-10-28', endDate: '2026-10-28', cursor: null })
  expect(await page.evaluate(() => (window as any).reviewTest.summaryReads[0])).toMatchObject({ startDate: '2026-10-28', endDate: '2026-10-28' })
  await expect(page.getByText('Học viên hôm qua', { exact: true })).toHaveCount(0)
  await page.getByRole('tab', { name: 'Theo tuần' }).click()
  await expect(page.locator('.nrw-review-card')).toHaveCount(3)
  await expect(page.locator('.nrw-kpis article').first()).toContainText('3')
  expect(await page.evaluate(() => (window as any).reviewTest.reads.at(-1))).toMatchObject({ startDate: '2026-10-26', endDate: '2026-11-01', cursor: null })
  await page.getByRole('tab', { name: 'Theo ngày' }).click()
  await page.getByRole('button', { name: 'Ngày trước', exact: true }).click()
  await expect(page.locator('.nrw-review-card')).toHaveCount(1)
  await expect(page.locator('.nrw-review-card')).toContainText('Học viên hôm qua')
  await page.getByRole('button', { name: 'Hôm nay', exact: true }).click()
  await expect(page.locator('.nrw-review-card')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Ngày sau', exact: true })).toBeDisabled()
  await page.screenshot({ path: info.outputPath('review-today.png'), fullPage: true })
})

test('a late previous-date page and summary cannot replace the new date', async ({ page }) => {
  await page.goto('/tests/nutrition-review-ui/index.html')
  await expect(page.locator('.nrw-review-card')).toHaveCount(2)
  await page.evaluate(() => { const state = (window as any).reviewTest; state.holdRead = true; state.holdSummary = true })
  await page.getByRole('button', { name: 'Ngày trước', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).reviewTest.reads.length)).toBe(2)
  await page.evaluate(() => {
    const state = (window as any).reviewTest
    const oldRead = state.releaseRead, oldSummary = state.releaseSummary
    ;(window as any).releasePrevious = () => { oldRead(); oldSummary() }
    state.holdRead = false; state.holdSummary = false
  })
  await page.getByRole('button', { name: 'Hôm nay', exact: true }).click()
  await expect(page.locator('.nrw-review-card')).toHaveCount(2)
  await page.evaluate(() => (window as any).releasePrevious())
  await expect(page.locator('.nrw-kpis article').first()).toContainText('2')
  await expect(page.locator('.nrw-review-card')).toHaveCount(2)
  await expect(page.getByText('Học viên hôm qua', { exact: true })).toHaveCount(0)
})

for (const width of [320, 390, 430, 1024]) {
  test(`real review component remains readable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/tests/nutrition-review-ui/index.html#/admin-nutrition-reviews?focus=overdue')
    await expect(page.locator('.nrw-review-card')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Chỉ bữa quá hạn' })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Viết nhận xét' }).click()
    await expect(page.getByRole('textbox', { name: 'Nhận xét dành riêng cho học viên', exact: true })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    const search = page.getByRole('textbox', { name: 'Tìm học viên hoặc món ăn' })
    await expect(search).toBeVisible()
    await page.screenshot({ path: info.outputPath('review-layout.png'), fullPage: true })
  })
}

test('overdue deep link, status filters and same-page route changes stay consistent', async ({ page }) => {
  await page.goto('/tests/nutrition-review-ui/index.html#/admin-nutrition-reviews?focus=overdue')
  await expect(page.locator('.nrw-review-card')).toHaveCount(1)
  await page.getByRole('button', { name: /^Đã duyệt/ }).click()
  await expect(page.getByRole('button', { name: 'Chỉ bữa quá hạn' })).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Chỉ bữa quá hạn' }).click()
  await expect(page.locator('.nrw-review-card')).toHaveCount(1)
  await page.evaluate(() => { location.hash = '#/admin-nutrition-reviews' })
  await expect(page.locator('.nrw-review-card')).toHaveCount(2)
})

test('same-tick approve clicks send once and refresh counters without cached summary', async ({ page }) => {
  await page.goto('/tests/nutrition-review-ui/index.html')
  await expect(page.locator('.nrw-review-card')).toHaveCount(2)
  await page.getByRole('button', { name: 'Viết nhận xét' }).click()
  await page.getByRole('textbox', { name: 'Nhận xét dành riêng cho học viên', exact: true }).fill('Đã kiểm tra khẩu phần và thành phần bữa ăn.')
  await page.evaluate(() => { (window as any).reviewTest.holdMutation = true })
  await page.getByRole('button', { name: 'Duyệt bữa ăn' }).evaluate((element: HTMLButtonElement) => { element.click(); element.click(); element.click() })
  await expect(page.getByRole('button', { name: 'Duyệt bữa ăn' })).toBeDisabled()
  expect(await page.evaluate(() => (window as any).reviewTest.writes.length)).toBe(1)
  await page.evaluate(() => (window as any).reviewTest.releaseMutation())
  await expect(page.locator('.nrw-review-card')).toHaveCount(1)
  expect(await page.evaluate(() => (window as any).reviewTest.reads.at(-1).forceRefresh)).toBe(true)
})

test('refresh failure retains data, blocks stale mutations, and retry recovers', async ({ page }) => {
  await page.goto('/tests/nutrition-review-ui/index.html')
  await expect(page.locator('.nrw-review-card')).toHaveCount(2)
  await page.evaluate(() => { (window as any).reviewTest.failNext = true; (window as any).reviewTest.holdRead = true })
  await page.getByRole('button', { name: 'Làm mới' }).evaluate((element: HTMLButtonElement) => { element.click(); element.click() })
  expect(await page.evaluate(() => (window as any).reviewTest.reads.length)).toBe(2)
  await expect(page.locator('.nrw-review-card')).toHaveCount(2)
  await page.evaluate(() => { (window as any).reviewTest.holdRead = false; (window as any).reviewTest.releaseRead() })
  await expect(page.getByRole('alert')).toContainText('Dịch vụ đang bận')
  await page.getByRole('button', { name: 'Viết nhận xét' }).click()
  await expect(page.getByRole('button', { name: 'Duyệt bữa ăn' })).toBeDisabled()
  await page.getByRole('button', { name: 'Tải lại', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Duyệt bữa ăn' })).toBeEnabled()
})

test('uncertain mutation requires a successful refresh before another write', async ({ page }) => {
  await page.goto('/tests/nutrition-review-ui/index.html')
  await expect(page.locator('.nrw-review-card')).toHaveCount(2)
  await page.getByRole('button', { name: 'Viết nhận xét' }).click()
  await page.getByRole('textbox', { name: 'Nhận xét dành riêng cho học viên', exact: true }).fill('Đã kiểm tra bữa ăn.')
  await page.evaluate(() => { (window as any).reviewTest.failMutation = true })
  await page.getByRole('button', { name: 'Duyệt bữa ăn' }).click()
  await expect(page.getByRole('alert')).toContainText('Chưa nhận được kết quả')
  await expect(page.getByRole('button', { name: 'Duyệt bữa ăn' })).toBeDisabled()
  await page.getByRole('button', { name: 'Tải lại', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Duyệt bữa ăn' })).toBeEnabled()
  expect(await page.evaluate(() => (window as any).reviewTest.writes.length)).toBe(1)
})

test('page filters do not reload summary and coach directory loads only on demand', async ({ page }) => {
  await page.goto('/tests/nutrition-review-ui/index.html')
  await expect(page.locator('.nrw-review-card')).toHaveCount(2)
  expect(await page.evaluate(() => (window as any).reviewTest.reads[0].section)).toBe('page')
  expect(await page.evaluate(() => (window as any).reviewTest.summaryReads.length)).toBe(1)
  expect(await page.evaluate(() => (window as any).reviewTest.directoryReads.length)).toBe(0)
  await page.getByRole('button', { name: /^Đã duyệt/ }).click()
  await expect(page.locator('.nrw-review-card')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).reviewTest.summaryReads.length)).toBe(1)
  await page.getByRole('combobox', { name: 'Lọc HLV chăm dinh dưỡng' }).focus()
  await expect.poll(() => page.evaluate(() => (window as any).reviewTest.directoryReads.length)).toBe(1)
  await page.getByRole('textbox', { name: 'Tìm học viên hoặc món ăn' }).focus()
  await page.getByRole('combobox', { name: 'Lọc HLV chăm dinh dưỡng' }).focus()
  expect(await page.evaluate(() => (window as any).reviewTest.directoryReads.length)).toBe(1)
})

test('summary failure leaves the page usable and retries only summary', async ({ page }) => {
  await page.goto('/tests/nutrition-review-ui/index.html')
  await expect(page.locator('.nrw-review-card')).toHaveCount(2)
  await page.evaluate(() => {
    (window as any).reviewTest.failSummary = true
    ;(window as any).reviewAuth.change('coach-1', 2)
  })
  await expect(page.getByRole('button', { name: 'Tải lại tổng quan' })).toBeVisible()
  await expect(page.locator('.nrw-review-card')).toHaveCount(2)
  const reads = await page.evaluate(() => (window as any).reviewTest.reads.length)
  await page.getByRole('button', { name: 'Tải lại tổng quan' }).click()
  await expect(page.getByRole('button', { name: 'Tải lại tổng quan' })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).reviewTest.reads.length)).toBe(reads)
})

test('same-account authority change discards the previous pending response', async ({ page }) => {
  await page.goto('/tests/nutrition-review-ui/index.html')
  await expect(page.locator('.nrw-review-card')).toHaveCount(2)
  await page.evaluate(() => { (window as any).reviewTest.holdRead = true; (window as any).reviewTest.readName = 'Dữ liệu quyền cũ' })
  await page.getByRole('button', { name: 'Làm mới' }).click()
  await page.evaluate(() => {
    const control = (window as any).reviewTest
    ;(window as any).releaseOldReview = control.releaseRead
    control.holdRead = false
    control.readName = 'Dữ liệu quyền mới'
    ;(window as any).reviewAuth.change('coach-1', 3)
  })
  await expect(page.locator('.nrw-review-card').first()).toContainText('Dữ liệu quyền mới')
  await page.evaluate(() => (window as any).releaseOldReview())
  await expect(page.locator('.nrw-review-card').first()).toContainText('Dữ liệu quyền mới')
  await expect(page.getByText('Dữ liệu quyền cũ')).toHaveCount(0)
})

test('mutation summary refresh supersedes a manual refresh that started before the write', async ({ page }) => {
  await page.goto('/tests/nutrition-review-ui/index.html')
  await expect(page.locator('.nrw-review-card')).toHaveCount(2)
  await page.evaluate(() => { (window as any).reviewTest.holdSummary = true })
  await page.getByRole('button', { name: 'Làm mới' }).click()
  await expect(page.getByRole('button', { name: 'Làm mới' })).toBeEnabled()
  await page.evaluate(() => {
    (window as any).releaseOldSummary = (window as any).reviewTest.releaseSummary
    ;(window as any).reviewTest.holdSummary = false
  })
  await page.getByRole('button', { name: 'Viết nhận xét' }).click()
  await page.getByRole('textbox', { name: 'Nhận xét dành riêng cho học viên', exact: true }).fill('Khẩu phần đã kiểm tra kỹ.')
  await page.getByRole('button', { name: 'Duyệt bữa ăn' }).click()
  await expect(page.locator('.nrw-kpis article').first().locator('strong')).toHaveText('1')
  await page.evaluate(() => (window as any).releaseOldSummary())
  await expect(page.locator('.nrw-kpis article').first().locator('strong')).toHaveText('1')
})
