import { test, expect, type Page } from '@playwright/test'

async function openWorkspace(page: Page, published = false) {
  await page.clock.setFixedTime(new Date('2026-10-26T00:00:00+07:00'))
  await page.addInitScript((published) => {
    const student = { status: 'active', branchId: 'b', sessionsPerWeek: 3, defaultSessionsPerWeek: 3,
      maxWeeklySessions: 7, schedulableSessionsThisWeek: 3, availableSlots: ['T2-6', 'T3-6', 'T4-6'],
      availabilityStatus: 'submitted', eligibleForWeek: true, eligibilityReasons: [],
      validScheduleDates: ['2026-10-26', '2026-10-29', '2026-10-30', '2026-10-31'],
      pausedScheduleDates: ['2026-10-27', '2026-10-28'], remainingSchedulableSessions: 20 }
    Object.assign(window, { __workspaceOverride: {
      students: [{ ...student, id: 'a', name: 'Lan' }, { ...student, id: 'b', name: 'Ngọc' }],
      draftStatus: published ? 'published' : 'draft', publishedVersion: published ? 1 : 0,
      schedule: { 'T2-6': [{ studentId: 'a', trainerId: 't', contractId: 'c-a', type: 'training', branchId: 'b',
        source: published ? 'published_existing' : 'manual_v2', ...(published ? { isLocked: true } : {}) }] },
    } })
  }, published)
  await page.goto('/tests/schedule-ui/index.html')
}

async function writes(page: Page) {
  return page.evaluate(() => (window as any).__scheduleCalls.filter((c: any) => ['command', 'admin-command'].includes(c.operation)))
}

for (const published of [false, true]) test(`OFF add requires explicit confirmation, supports cancel, and saves once (published=${published})`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: published ? 390 : 1440, height: 900 })
  await openWorkspace(page, published)
  await page.locator('.schedule-cell[aria-label*="Thứ 3"]').first().focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Xếp ngay Ngọc', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Chọn Ngọc', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('đã được duyệt nghỉ')
  expect(await writes(page)).toHaveLength(0)
  await page.locator('.schedule-manual-confirm').getByRole('button', { name: 'Hủy', exact: true }).click()
  expect(await writes(page)).toHaveLength(0)
  await expect(page.getByRole('button', { name: 'Xác nhận xếp vào ngày OFF' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Chọn Ngọc', exact: true }).click()
  await page.screenshot({ path: testInfo.outputPath('off-confirmation.png'), fullPage: true })
  await page.getByRole('button', { name: 'Xác nhận xếp vào ngày OFF', exact: true }).click()
  await expect(page.locator('.schedule-assigned-row').filter({ hasText: 'Ngọc' })).toBeVisible()
  const calls = await writes(page)
  expect(calls).toHaveLength(1)
  expect(calls[0].operation).toBe(published ? 'admin-command' : 'command')
  expect(calls[0].input.payload).toMatchObject({ studentId: 'b', slotId: 'T3-6', adminOverride: true, confirmStudentOff: true })
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: 'Học viên', exact: true }).click()
  await expect(page.locator('#schedule-student-b')).toContainText('OFF · Admin đã xác nhận xếp lịch')
})

for (const published of [false, true]) test(`moving onto OFF requires confirmation and failed writes retain the old booking (published=${published})`, async ({ page }) => {
  await openWorkspace(page, published)
  await page.locator('.schedule-cell').filter({ hasText: 'Lan' }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Chuyển ca của Lan', exact: true }).click()
  await page.getByRole('combobox', { name: 'Ca đích', exact: true }).selectOption('T3-6')
  await expect(page.getByRole('alert')).toContainText('OFF / bảo lưu')
  expect(await writes(page)).toHaveLength(0)
  await page.evaluate(() => { (window as any).__failScheduleCommand = true })
  await page.getByRole('button', { name: 'Xác nhận chuyển vào ngày OFF', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'ca cũ được giữ' })).toBeVisible()
  await expect(page.locator('.schedule-assigned-row').filter({ hasText: 'Lan' })).toBeVisible()
  await page.evaluate(() => { (window as any).__failScheduleCommand = false })
  await page.getByRole('button', { name: 'Xác nhận chuyển vào ngày OFF', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Ca đích', exact: true })).toHaveCount(0)
  const calls = await writes(page)
  expect(calls).toHaveLength(2)
  expect(calls.every((c: any) => c.input.payload.confirmStudentOff === true)).toBe(true)
})

test('staff cannot select or confirm an OFF candidate', async ({ page }) => {
  await openWorkspace(page)
  await page.evaluate(() => (window as any).__setScheduleAccess({ uid: 'staff-a', accessRole: 'staff', positions: ['branch_manager'], authzVersion: 2 }))
  await page.locator('.schedule-cell[aria-label*="Thứ 3"]').first().focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Chọn Ngọc', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Xác nhận xếp vào ngày OFF' })).toHaveCount(0)
  expect(await writes(page)).toHaveLength(0)
})
