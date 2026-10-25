import { expect, test } from '@playwright/test'

test('stale missing results never leak into conflicts or assert that all conflicts are cleared', async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, { __enableScheduleListener: true, __weeklyViewCompact: true,
    __initialWeeklySnapshot: 'server', __validationMode: 'stale' }))
  await page.goto('/tests/schedule-ui/index.html')
  await page.getByRole('tab', { name: /Cảnh báo/ }).click()
  await expect(page.getByRole('region', { name: 'Kết quả đối soát trước' })).toBeVisible()
  await expect(page.getByRole('tab', { name: /Thiếu buổi/ })).toContainText('3 cũ')
  await page.getByRole('tab', { name: /Trùng \/ xung đột/ }).click()
  await expect(page.getByRole('region', { name: 'Kết quả đối soát trước' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Danh sách trùng và xung đột lịch' })).toHaveCount(0)
  await expect(page.getByText('Chưa phát hiện xung đột trong dữ liệu đã tải. Chưa có kết quả đối soát đầy đủ.')).toBeVisible()
  expect(await page.evaluate(() => (window as any).__scheduleCalls || [])).toEqual([])
})

test('missing count and rows agree, excluding old profile warnings and already complete learners', async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, { __enableScheduleListener: true, __weeklyViewCompact: true,
    __initialWeeklySnapshot: 'server', __validationMode: 'stale' }))
  await page.goto('/tests/schedule-ui/index.html')
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
  await page.evaluate(async () => {
    const { weeklyViewFixture } = await import('/tests/schedule-ui/service.ts')
    const key = [...(window as any).__scheduleListeners.keys()].find((p: string) => p.startsWith('ptScheduleWeeklyViews/'))
    const [branchId, weekId] = key.split('/')[1].split('_')
    const raw = weeklyViewFixture({ branchId, weekId })
    raw.viewRevision = 2
    raw.validationSnapshot.coverage.byStudent.c.missingSessions = 0
    raw.validationSnapshot.coverage.byStudent['old-contract'] = { studentId: 'old-contract', targetSessions: 0, scheduledSessions: 0, draftSessions: 0, otherBranchSessions: 0, missingSessions: 0 }
    raw.validationSnapshot.warnings.push({ studentId: 'old-contract', code: 'PROFILE_DATA_INCOMPLETE' }, { studentId: 'c', code: 'STUDENT_UNSCHEDULED' })
    ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', raw)
  })
  await page.getByRole('tab', { name: /Cảnh báo/ }).click()
  const retained = page.getByRole('region', { name: 'Kết quả đối soát trước' })
  await expect(retained.locator('article')).toHaveCount(2)
  await expect(retained).not.toContainText('Hợp đồng cũ')
  await expect(retained).not.toContainText('Bình')
  await expect(page.locator('.schedule-warning-stat.is-missing .schedule-warning-stat__value')).toHaveText('2')
  await expect(page.getByRole('tab', { name: /Thiếu buổi/ })).toContainText('2 cũ')
})

for (const width of [390, 1440]) {
  test(`retained warning layout and heading remain readable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.addInitScript(() => Object.assign(window, { __enableScheduleListener: true, __weeklyViewCompact: true,
      __initialWeeklySnapshot: 'server', __validationMode: 'stale' }))
    await page.goto('/tests/schedule-ui/index.html')
    await page.addStyleTag({ content: 'body { font-family: Inter, ui-sans-serif, system-ui, sans-serif; }' })
    await page.evaluate(() => window.scrollTo(0, 400))
    await page.getByRole('tab', { name: /Cảnh báo/ }).click()
    const retained = page.getByRole('region', { name: 'Kết quả đối soát trước' })
    await expect(retained).toBeVisible()
    await expect(retained).not.toContainText('STUDENT_MISSING_SESSIONS')
    await retained.locator('summary').first().click()
    const geometry = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth, viewport: window.innerWidth,
      heading: document.querySelector('#schedule-panel-warnings > header')!.getBoundingClientRect().top,
      toolbar: document.querySelector('.branch-schedule__toolbar')!.getBoundingClientRect().bottom,
      cards: [...document.querySelectorAll('.schedule-warning-retained__student')].map(element => element.getBoundingClientRect().width),
    }))
    expect(geometry.width).toBeLessThanOrEqual(geometry.viewport + 1)
    expect(geometry.heading).toBeGreaterThanOrEqual(geometry.toolbar)
    expect(Math.min(...geometry.cards)).toBeGreaterThan(250)
    await page.screenshot({ path: testInfo.outputPath(`warnings-${width}.png`), fullPage: true })
  })
}
