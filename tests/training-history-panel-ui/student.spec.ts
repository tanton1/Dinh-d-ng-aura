import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-31T12:00:00+07:00'))
})

test('student history separates renewed packages by their actual contract links, including overlapping dates', async ({ page }) => {
  await page.goto('/tests/training-history-panel-ui/student.html')
  const current = page.getByRole('region', { name: 'Hợp đồng hiện tại: PT Personal 24 buổi', exact: true })
  const previous = page.getByRole('region', { name: 'Hợp đồng cũ: PT Personal 24 buổi', exact: true })
  await expect(page.locator('.student-history-contract').first()).toHaveAttribute('aria-label', 'Hợp đồng hiện tại: PT Personal 24 buổi')
  await expect(current.getByText('PT buổi mới', { exact: true })).toBeVisible()
  await expect(current.getByText('01/09/2026 – 01/03/2027')).toBeVisible()
  await expect(previous.getByText('PT buổi cũ', { exact: true })).toBeVisible()
  await expect(previous.getByText('Vắng mặt · tính buổi')).toBeVisible()
  await expect(current.getByText('PT buổi cũ', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Chưa gắn hợp đồng', exact: true }).getByText('PT chưa liên kết')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Chưa rõ thời hạn: Hợp đồng missing', exact: true }).getByText('PT thiếu thông tin')).toBeVisible()
  await expect(page.locator('.student-history-notice')).toHaveCount(0)
  await expect(page.getByText(/Toàn bộ lịch sử từ khi bắt đầu tập|AURA · NHẬT KÝ|quota/)).toHaveCount(0)

  await expect(previous.getByText('1 buổi đã tải', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Tải thêm buổi tập' }).click()
  await expect(previous.locator('article')).toHaveCount(2)
  await expect(previous.getByText('2 buổi', { exact: true })).toBeVisible()
  await expect(current.locator('article')).toHaveCount(1)
  await expect(page.locator('.student-history-contract')).toHaveCount(4)
  await expect(page.getByRole('button', { name: 'Tải thêm buổi tập' })).toHaveCount(0)
})

for (const context of ['schedule', '360']) {
  test(`contract groups fit the ${context} history at 360px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 360, height: 900 })
    await page.goto(`/tests/training-history-panel-ui/student.html?context=${context}`)
    await expect(page.getByRole('heading', { name: 'Lịch sử buổi tập' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const rowsFit = await page.locator('.student-history-contract__sessions article').evaluateAll((rows) => rows.every((row) => {
      const bounds = row.getBoundingClientRect()
      return Array.from(row.children).every((child) => {
        const box = child.getBoundingClientRect()
        return box.left >= bounds.left && box.right <= bounds.right + 1
      })
    }))
    expect(rowsFit).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`${context}-mobile.png`), fullPage: true })
  })
}
