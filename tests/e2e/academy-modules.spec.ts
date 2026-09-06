import { expect, test } from '@playwright/test'

for (const scenario of ['error-catalog', 'error-detail']) {
  test(`outage shows an actionable error and retry retains route: ${scenario}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 })
    await page.goto('/tests/e2e/fixtures/academy-modules.html?scenario=' + scenario)
    await expect(page.getByRole('heading', { name: 'Chưa tải được khóa học' })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('Đây là lỗi kết nối')
    await expect(page.getByText('internal', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Không tìm thấy khóa học' })).toHaveCount(0)
    const before = page.url()
    await page.getByRole('button', { name: 'Thử lại', exact: true }).click()
    await expect(page.getByRole('heading', { name: scenario === 'error-catalog' ? 'Làm chủ dinh dưỡng cùng AURA' : 'Khởi đầu đúng', exact: true })).toBeVisible()
    expect(page.url()).toBe(before)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
  })
}

// Real PDF.js rendering without private media credentials or production writes.
function fixturePdf(withOutline = false) {
  const objects = [`<< /Type /Catalog /Pages 2 0 R ${withOutline ? '/Outlines 7 0 R' : ''} >>`, '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>', ...[1, 2, 3].map(() => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << >> /Contents 6 0 R >>'), '<< /Length 0 >>\nstream\n\nendstream']
  if (withOutline) objects.push('<< /Type /Outlines /First 8 0 R /Last 8 0 R /Count 1 >>', '<< /Title (Reference section) /Parent 7 0 R /Dest [5 0 R /Fit] >>')
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${body}\nendobj\n` })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}

for (const width of [320, 390, 1440]) {
  test(`PDF position, flashcard navigation and practice persist at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.route('https://aura-pdf-fixture.test/**', (route) => route.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'access-control-allow-origin': '*' }, body: fixturePdf() }))
    await page.goto('/tests/e2e/fixtures/academy-modules.html')
    const tabs = page.getByRole('tablist', { name: 'Loại nội dung' })
    await expect(tabs.getByRole('tab').first()).toContainText('Nội Dung')
    await expect(tabs.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('combobox', { name: 'Chọn trang PDF' }).selectOption('2')
    await page.getByRole('button', { name: 'Đánh dấu', exact: true }).click()
    expect(await page.getByRole('button', { name: 'Mục lục PDF', exact: true }).evaluate((button) => Number.parseFloat(getComputedStyle(button).fontSize))).toBeGreaterThanOrEqual(12)
    await page.screenshot({ path: testInfo.outputPath(`pdf-${width}.png`) })
    await tabs.getByRole('tab', { name: 'Học cùng Aura' }).click()
    await expect(page.getByRole('navigation', { name: 'Các bước học trong chương' }).getByRole('button')).toHaveCount(4)
    await expect(page.locator('.academy-learning-card')).toHaveCount(12)
    const nav = page.getByRole('navigation', { name: 'Các bước học trong chương' })
    await nav.getByRole('button', { name: /Ghi nhớ|Nhớ/ }).click()
    await page.getByRole('button', { name: 'Thẻ sau', exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'Chọn thẻ ghi nhớ' })).toHaveValue('1')
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
    await page.locator('.academy-flashcard-section').scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`flashcards-${width}.png`) })
    await expect(page.locator('.academy-mastery-strip')).toContainText('0%')
    await nav.getByRole('button', { name: /Thực hành|^Làm$/ }).click()
    const challenge = page.getByRole('region', { name: 'Thử nghiệm 7 ngày', exact: true })
    await challenge.getByRole('checkbox').first().check()
    await expect(challenge).toContainText('1/7')
    await expect(page.getByText('Đã lưu', { exact: true }).first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
    // Completing the core must not switch the learner back to PDF unexpectedly.
    await page.getByRole('button', { name: 'Hoàn thành', exact: true }).click()
    await expect(tabs.getByRole('tab', { name: 'Học cùng Aura' })).toHaveAttribute('aria-selected', 'true')
    await tabs.getByRole('tab').first().click()
    await expect(page.getByRole('combobox', { name: 'Chọn trang PDF' })).toHaveValue('2')
    await page.getByRole('button', { name: 'Toàn màn hình', exact: true }).click()
    await expect(page.locator('.lesson-pdf-reader')).toHaveClass(/is-fullscreen/)
    await page.keyboard.press('Escape')
    await expect(page.locator('.lesson-pdf-reader')).not.toHaveClass(/is-fullscreen/)
    await expect(page.getByRole('button', { name: 'Đã đánh dấu', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Mục lục PDF', exact: true }).click()
    await expect(page.getByText('Tệp này không có mục lục điện tử.', { exact: false })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
    await page.getByRole('navigation', { name: 'Chuyển bài học' }).getByRole('button').last().click()
    await expect(page.getByRole('combobox', { name: 'Chọn trang PDF' })).toHaveValue('1')
    await page.getByRole('navigation', { name: 'Chuyển bài học' }).getByRole('button').first().click()
    await expect(page.getByRole('combobox', { name: 'Chọn trang PDF' })).toHaveValue('2')
    await tabs.getByRole('tab', { name: 'Học cùng Aura' }).click()
    await nav.getByRole('button', { name: /Thực hành|^Làm$/ }).click()
    await expect(challenge.getByRole('checkbox').first()).toBeChecked()
  })
}

test('quiz paginates, requires all answers and links remediation to real cards', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/academy-modules.html')
  await page.getByRole('tab', { name: 'Học cùng Aura' }).click()
  await page.getByRole('navigation', { name: 'Các bước học trong chương' }).getByRole('button', { name: 'Kiểm tra', exact: true }).click()
  const quiz = page.getByRole('region', { name: 'Checkpoint Chương 1', exact: true })
  await expect(quiz.getByRole('group')).toHaveCount(1)
  await expect(quiz).toContainText('Ngân hàng 16 câu')
  await quiz.getByRole('button', { name: 'Nộp bài kiểm tra' }).click()
  await expect(quiz.getByRole('alert')).toContainText('Hãy chọn một đáp án')
  const navigator = quiz.getByRole('navigation', { name: 'Điều hướng câu hỏi' })
  for (let index = 0; index < 8; index++) {
    await navigator.getByRole('button').nth(index).click()
    await quiz.getByRole('radio').last().check()
  }
  await quiz.getByRole('button', { name: 'Nộp bài kiểm tra' }).click()
  await expect(quiz).toContainText('Chưa đạt lần này')
  await quiz.getByRole('button', { name: /^Ôn lại:/ }).first().click()
  await expect(page.locator('.academy-remediation-notice')).toBeVisible()
  await expect(page.locator('.academy-learning-card')).toHaveCount(1)
  await page.getByRole('button', { name: 'Xem tất cả thẻ' }).click()
  await expect(page.locator('.academy-learning-card')).toHaveCount(12)
  await page.getByRole('navigation', { name: 'Các bước học trong chương' }).getByRole('button', { name: 'Kiểm tra', exact: true }).click()
  await expect(quiz).toContainText('Chưa đạt lần này')
  await expect(quiz.getByRole('button', { name: 'Làm lại quiz' })).toBeVisible()
})

test('PDF electronic outline resolves a real destination without scanning pages', async ({ page }) => {
  await page.route('https://aura-pdf-fixture.test/**', (route) => route.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'access-control-allow-origin': '*' }, body: fixturePdf(true) }))
  await page.goto('/tests/e2e/fixtures/academy-modules.html')
  await page.getByRole('button', { name: 'Mục lục PDF', exact: true }).click()
  await page.getByRole('navigation', { name: 'Các mục trong PDF' }).getByRole('button', { name: 'Reference section' }).click()
  await expect(page.getByRole('combobox', { name: 'Chọn trang PDF' })).toHaveValue('3')
})
