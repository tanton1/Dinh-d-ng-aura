import { expect, test } from '@playwright/test'

for (const width of [390, 1440]) {
  test(`compact warnings show only coverage, availability, booked sessions and managers at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.addInitScript(() => Object.assign(window, { __enableScheduleListener: true, __weeklyViewCompact: true,
      __initialWeeklySnapshot: 'server', __validationMode: 'stale' }))
    await page.goto('/tests/schedule-ui/index.html')
    await page.addStyleTag({ content: 'body { font-family: "Be Vietnam Pro", ui-sans-serif, system-ui, sans-serif; }' })
    await page.getByRole('tab', { name: /Cảnh báo/ }).click()
    const row = page.locator('.schedule-warning-student').filter({ hasText: 'Lan' })
    await expect(row).toHaveText('Lan1/2 buổi')
    const button = row.getByRole('button', { name: 'Mở lịch rảnh của Lan', exact: true })
    await button.focus()
    await page.keyboard.press('Enter')
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await expect(row.getByRole('heading', { name: 'Lịch rảnh', exact: true })).toBeVisible()
    await expect(row.locator('.schedule-warning-availability')).toContainText('Thứ 2')
    await expect(row.locator('.schedule-warning-availability')).toContainText('06:00')
    await expect(row.locator('.schedule-warning-schedule li')).toHaveCount(1)
    // Compact weekly payloads can carry the raw branch ID as branch.name.
    // The branch selector already has the human-readable label; reuse it.
    await expect(row.locator('.schedule-warning-schedule li span')).toHaveText('Mai · CS1')
    await expect(row.locator('.schedule-warning-managers')).toHaveText('PT quản lýMai, Vy')
    await expect(row.locator('.schedule-warning-profile, .schedule-warning-contract, .schedule-warning-action, .is-suggestion')).toHaveCount(0)
    await expect(row).not.toContainText('Gói 24')
    await expect(row).not.toContainText('Hướng xử lý')
    await expect(page.getByText(/Đã mở thông tin lịch của/)).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`simple-warning-${width}.png`), fullPage: true })
    await button.click()
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    await expect(row.locator('.schedule-warning-detail')).toHaveCount(0)
    await page.evaluate(() => (window as any).__emitScheduleSnapshot('ptScheduleDrafts', { revision: 2, schedule: {
      'T2-6': [{ studentId: 'a', trainerId: 't', type: 'training' }],
      'T3-6': [{ studentId: 'a', trainerId: 't', type: 'training' }],
    } }))
    await expect(page.getByRole('region', { name: 'Phiên bản cảnh báo' })).toContainText('Draft r2')
    await expect(row).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).__scheduleCalls || [])).toEqual([])
  })
}

test('expanded warning includes other-branch bookings and omits managers when none are assigned', async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, { __enableScheduleListener: true, __weeklyViewCompact: true,
    __initialWeeklySnapshot: 'server', __validationMode: 'stale' }))
  await page.goto('/tests/schedule-ui/index.html')
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
  await page.evaluate(async () => {
    const { weeklyViewFixture } = await import('/tests/schedule-ui/service.ts')
    const key = [...(window as any).__scheduleListeners.keys()].find((key: string) => key.startsWith('ptScheduleWeeklyViews/'))
    const [branchId, weekId] = key.split('/')[1].split('_')
    const raw = weeklyViewFixture({ branchId, weekId })
    raw.viewRevision = 2
    raw.students = raw.students.map((s: any) => s.id === 'b' ? { ...s, sessionsPerWeek: 3 } : s)
    raw.contracts = raw.contracts.map((c: any) => c.studentId === 'b' ? { ...c, trainerId: '', trainerIds: [] } : c)
    raw.weeklySessionCoverage.b = { otherBranches: 1, entries: [{ id: 'other-branch', branchId: 'c', date: weekId, hour: 7, trainerId: 'outside', trainerName: 'PT cơ sở 2' }] }
    ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', raw)
  })
  await page.getByRole('tab', { name: /Cảnh báo/ }).click()
  const row = page.locator('.schedule-warning-student').filter({ hasText: 'Ngọc' })
  await expect(row).toHaveText('Ngọc1/3 buổi')
  await row.getByRole('button').click()
  await expect(row.locator('.schedule-warning-schedule li')).toHaveCount(1)
  await expect(row.locator('.schedule-warning-schedule')).toContainText('PT cơ sở 2 · CS2')
  await expect(row.locator('.schedule-warning-managers')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__scheduleCalls || [])).toEqual([])
})
