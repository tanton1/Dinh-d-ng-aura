import { test, expect, type Page } from '@playwright/test'

const fixture = '/tests/cooking-ui/index.html'
const open = (page: Page, hash = '#/cooking') => page.goto(`${fixture}${hash}`)
const cards = (page: Page) => page.locator('.cooking-recipe-card')
const search = (page: Page) => page.getByRole('searchbox', { name: 'Tìm tên món hoặc nguyên liệu' })

test('learning navigation, complete browse, search and return retain list context', async ({ page }) => {
  const pdfRequests: string[] = []
  const errors: string[] = []
  page.on('request', (request) => { if (request.url().includes('/cooking/sources/')) pdfRequests.push(request.url()) })
  page.on('pageerror', (error) => errors.push(error.message))
  await open(page, '#/nutrition?section=explore')
  await page.getByRole('button', { name: 'Vào Bếp cùng Aura', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Vào Bếp cùng Aura', exact: true })).toBeVisible()
  await expect(cards(page)).toHaveCount(12)
  for (let count = 24; count <= 60; count += 12) {
    await page.getByRole('button', { name: 'Xem thêm món' }).click()
    await expect(cards(page)).toHaveCount(count)
  }
  await expect(page.getByRole('button', { name: 'Xem thêm món' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Đậu & rau 8', exact: true }).click()
  await search(page).fill('dau hu ca chua')
  await expect(page.locator('#cooking-open-V01')).toBeVisible()
  await page.locator('#cooking-open-V01').click()
  await expect(page.locator('.cooking-detail h1')).toHaveText('Đậu hũ sốt cà chua và nấm')
  await expect(page.locator('.cooking-detail h1')).toBeFocused()
  await page.getByRole('link', { name: 'Về danh sách món' }).click()
  await expect(search(page)).toHaveValue('dau hu ca chua')
  await expect(page.getByRole('button', { name: 'Đậu & rau 8', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#cooking-open-V01')).toBeFocused()
  expect(pdfRequests).toEqual([])
  expect(errors).toEqual([])
})

test('saved recipes persist for the same member and never leak when the account changes', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Lưu món Bánh mì trứng, dưa leo và cà chua', exact: true }).click()
  await expect(page.locator('.cooking-announcement')).toContainText('Đã lưu món trên thiết bị này')
  await page.reload()
  await page.getByRole('button', { name: 'Đã lưu 1', exact: true }).click()
  await expect(cards(page)).toHaveCount(1)
  await page.evaluate(() => dispatchEvent(new CustomEvent('cooking-test:actor', { detail: 'member-b' })))
  await page.getByRole('button', { name: 'Đã lưu', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Giữ lại món bạn muốn nấu' })).toBeVisible()
  await page.evaluate(() => dispatchEvent(new CustomEvent('cooking-test:actor', { detail: 'member-a' })))
  await page.getByRole('button', { name: 'Đã lưu 1', exact: true }).click()
  await expect(cards(page)).toHaveCount(1)
  await page.getByRole('button', { name: 'Bỏ lưu Bánh mì trứng, dưa leo và cà chua', exact: true }).click()
  await expect(cards(page)).toHaveCount(0)
})

test('blocked storage keeps reading and saving within the current session usable', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError') } }) })
  await open(page)
  await page.getByRole('button', { name: 'Lưu món Bánh mì trứng, dưa leo và cà chua', exact: true }).click()
  await expect(page.locator('.cooking-announcement')).toContainText('chỉ được giữ trong phiên này')
  await page.getByRole('button', { name: 'Đã lưu 1', exact: true }).click()
  await expect(cards(page)).toHaveCount(1)
  await page.locator('#cooking-open-B01').click()
  await expect(page.getByRole('link', { name: 'Vào bếp thôi' })).toBeVisible()
})

test('cooking mode preserves ingredient checks and step position until completion', async ({ page }) => {
  await open(page, '#/cooking?recipe=B08')
  await expect(page.locator('.cooking-recipe-facts')).toContainText('Ngâm lạnh 6-12 giờ')
  await page.locator('.cooking-ingredients input').first().check()
  await page.getByRole('link', { name: 'Vào bếp thôi' }).click()
  await page.getByText('Nguyên liệu cho 2 phần ăn', { exact: true }).click()
  await expect(page.locator('.cooking-ingredients input').first()).toBeChecked()
  await expect(page.getByRole('button', { name: 'Bước trước' })).toBeDisabled()
  await page.getByRole('button', { name: 'Bước tiếp' }).click()
  await expect(page.locator('.cooking-step-label')).toHaveText('Bước 2/4')
  await page.getByRole('link', { name: 'Đóng chế độ nấu' }).click()
  await page.getByRole('link', { name: 'Vào bếp thôi' }).click()
  await expect(page.locator('.cooking-step-label')).toHaveText('Bước 2/4')
  await page.getByRole('button', { name: 'Bước tiếp' }).click()
  await page.getByRole('button', { name: 'Bước tiếp' }).click()
  await page.getByRole('button', { name: 'Hoàn thành', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Bữa ngon đã sẵn sàng.' })).toBeVisible()
  await page.getByRole('button', { name: 'Xem lại các bước' }).click()
  await expect(page.locator('.cooking-step-label')).toHaveText('Bước 1/4')
})

test('sauce details retain four portions, raw marinade caution and original kcal', async ({ page }) => {
  await open(page, '#/cooking?recipe=C09')
  await expect(page.locator('.cooking-portions')).toHaveText('Công thức cho 4 phần sử dụng')
  await expect(page.locator('.cooking-method')).toContainText('không dùng để chấm')
  await expect(page.locator('.cooking-recipe-facts')).toContainText('Cần nấu chín cùng món')
  await page.getByText('Chia phần & món ăn kèm', { exact: true }).click()
  await expect(page.getByText('Cân toàn bộ thành phẩm rồi chia bốn phần. Một phần không mặc định bằng 15 g hay 15 ml.')).toBeVisible()
  await open(page, '#/cooking?recipe=C05')
  await expect(page.locator('.cooking-energy')).toContainText('65')
  await page.getByText('Kcal được tính như thế nào?', { exact: true }).click()
  await expect(page.getByText('Cả mẻ: ≈ 270 kcal. Kcal cả mẻ và mỗi phần được làm tròn riêng.')).toBeVisible()
})

test('PDF is fetched only on demand; failure, retry, close and focus restore work', async ({ page }) => {
  let fail = true
  let requests = 0
  await page.route('**/cooking/sources/*.pdf', async (route) => {
    requests += 1
    if (fail) await route.fulfill({ status: 503, body: 'offline' })
    else await route.continue()
  })
  await open(page, '#/cooking?recipe=B01')
  const source = page.getByRole('button', { name: 'Đọc chương PDF' })
  await expect(source).toBeVisible()
  expect(requests).toBe(0)
  await source.click()
  await expect(page.getByRole('heading', { name: 'Chưa mở được tài liệu' })).toBeVisible()
  fail = false
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Mở PDF ở tab mới' })).toHaveAttribute('href', /blob:.*#page=3/)
  await expect(page.locator('.cooking-pdf iframe')).toHaveAttribute('src', /blob:.*#page=3/)
  await page.getByRole('button', { name: 'Đóng tài liệu' }).focus()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(source).toBeFocused()
  expect(requests).toBeGreaterThanOrEqual(2)
})

test('failed photo, empty search and invalid links all have a usable recovery', async ({ page }) => {
  let photoFails = true
  await page.route('**/cooking/images/B01*.webp*', (route) => photoFails ? route.abort() : route.continue())
  await open(page, '#/cooking?recipe=B01')
  await expect(page.getByText('Chưa tải được ảnh')).toBeVisible()
  photoFails = false
  await page.getByRole('button', { name: 'Tải lại ảnh' }).click()
  await expect(page.getByRole('img', { name: 'Ảnh minh họa Bánh mì trứng, dưa leo và cà chua' })).toBeVisible()
  await page.getByRole('link', { name: 'Về danh sách món' }).click()
  await search(page).fill('mon-khong-ton-tai-123')
  await expect(page.getByRole('heading', { name: 'Chưa tìm thấy món phù hợp' })).toBeVisible()
  await page.getByRole('button', { name: 'Khám phá tất cả món' }).click()
  await expect(cards(page)).toHaveCount(12)
  await open(page, '#/cooking?recipe=unknown')
  await expect(page.getByRole('heading', { name: 'Chưa tìm thấy công thức này' })).toBeVisible()
  await page.getByRole('link', { name: 'Về danh sách món' }).click()
  await expect(cards(page)).toHaveCount(12)
})

for (const width of [320, 390, 768, 1440]) {
  test(`list, detail and cooking mode fit ${width}px without overflow`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await open(page)
    await expect(page.getByRole('heading', { name: 'Vào Bếp cùng Aura', exact: true })).toBeVisible()
    await expect(page.locator('.cooking-hero img')).toBeVisible()
    expect(await page.locator('.cooking-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(width <= 700 ? 1 : width <= 1050 ? 2 : 3)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`list-${width}.png`) })
    await page.getByRole('link', { name: 'Xem cách làm' }).click()
    await expect(page.locator('.cooking-detail h1')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`detail-${width}.png`) })
    await page.getByRole('link', { name: 'Vào bếp thôi' }).click()
    await expect(page.getByRole('button', { name: 'Bước tiếp' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`cook-${width}.png`) })
  })
}

test('legacy shell provides the standalone cookbook in learning navigation', async ({ page }) => {
  await page.goto(`${fixture}?legacy=1#/nutrition?section=explore`)
  await page.getByRole('button', { name: 'Vào Bếp cùng Aura', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Vào Bếp cùng Aura', exact: true })).toBeVisible()
})

test('a failed catalog load can recover through a fresh page load', async ({ page }) => {
  let fail = true
  await page.route('**/src/features/cooking/data/cookbook.json*', (route) => fail ? route.fulfill({ status: 503, body: 'offline' }) : route.continue())
  await open(page, '#/cooking?recipe=B08')
  await expect(page.getByRole('heading', { name: 'Chưa mở được bếp Aura' })).toBeVisible()
  fail = false
  await page.getByRole('button', { name: 'Tải lại trang' }).click()
  await expect(page.locator('.cooking-detail h1')).toContainText('Yến mạch ngâm')
})

test('returning to a long list restores the viewport and keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)
  const recipe = page.locator('#cooking-open-B08')
  await recipe.scrollIntoViewIfNeeded()
  const before = await page.evaluate(() => window.scrollY)
  expect(before).toBeGreaterThan(1000)
  await recipe.click()
  await expect(page.locator('.cooking-detail h1')).toBeFocused()
  await page.getByRole('link', { name: 'Về danh sách món' }).click()
  await expect(recipe).toBeFocused()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(before)
})

test('a member can enter, advance and finish cooking using only the keyboard', async ({ page }) => {
  await open(page, '#/cooking?recipe=B01')
  await expect(page.locator('.cooking-detail h1')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Vào bếp thôi' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('.cooking-session h1')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Đóng chế độ nấu' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Bước tiếp' })).toBeFocused()
  for (let step = 2; step <= 4; step += 1) {
    await page.keyboard.press('Enter')
    await expect(page.locator('.cooking-step-label')).toHaveText(`Bước ${step}/4`)
  }
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Bữa ngon đã sẵn sàng.' })).toBeVisible()
})
