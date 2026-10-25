import { expect, test, type Page } from '@playwright/test'

async function openOffWeek(page: Page, mode: 'exact' | 'stale', conflict = false) {
  await page.clock.setFixedTime(new Date('2026-10-25T09:00:00Z'))
  await page.addInitScript(({ mode, conflict }) => {
    const student = { status: 'active', branchId: 'b', sessionsPerWeek: 3, defaultSessionsPerWeek: 3,
      weeklySessionTargetOverride: null, weeklySessionTargetOverridden: false, maxWeeklySessions: 7,
      schedulableSessionsThisWeek: 1, availableSlots: ['T2-6', 'T3-6', 'T4-6'], availabilityStatus: 'submitted',
      availabilityRevision: 1, eligibleForWeek: true, eligibilityReasons: [], eligibleContractIds: [],
      validScheduleDates: ['2026-11-01'], pausedScheduleDates: ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'],
      remainingSchedulableSessions: 20, contractStatus: 'valid' }
    Object.assign(window, { __enableScheduleListener: true, __weeklyViewCompact: true, __validationMode: mode,
      __weeklyCoverageOverride: { totalTargetSessions: 6, scheduledEntries: 0, missingSessions: 6, studentsWithAtLeastOne: 0, fullyScheduledStudents: 0,
        byStudent: Object.fromEntries(['a', 'b'].map(studentId => [studentId, { studentId, targetSessions: 3, scheduledSessions: 0, draftSessions: 0, missingSessions: 3, otherBranchSessions: 0 }])) },
      __workspaceOverride: { schedule: conflict ? { 'T2-6': [{ studentId: 'a', trainerId: 't', type: 'training', branchId: 'b' }] } : {},
        students: [{ ...student, id: 'a', name: 'Gia Hân' }, { ...student, id: 'b', name: 'Mai Tuyết Tuyết' }],
        unassignedEntries: ['a', 'b'].map(studentId => ({ studentId, missingSessions: 3, primaryReasonCode: 'CONTRACT_PAUSED', blockerCategory: 'contract', reasonCodes: ['CONTRACT_PAUSED'] })) } })
  }, { mode, conflict })
  await page.goto('/tests/schedule-ui/index.html')
  await page.getByRole('button', { name: 'Tuần sau', exact: true }).click()
  await page.getByRole('tab', { name: /Cảnh báo/ }).click()
  await expect(page.getByRole('region', { name: 'Phiên bản cảnh báo' })).toBeVisible()
}

for (const mode of ['exact', 'stale'] as const) {
  test(`approved OFF is informational, not missing sessions (${mode})`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: mode === 'exact' ? 1440 : 390, height: 1000 })
    await openOffWeek(page, mode)
    await expect(page.locator('.schedule-warning-student')).toHaveCount(0)
    await expect(page.locator('.schedule-warning-stat.is-missing .schedule-warning-stat__value')).toHaveText('0')
    const off = page.locator('.schedule-approved-off')
    await expect(off).toContainText('OFF / bảo lưu đã duyệt')
    await off.locator('summary').click()
    await expect(off.locator('li')).toHaveCount(2)
    await expect(off).toContainText('Gia Hân')
    await expect(off).toContainText('Mai Tuyết Tuyết')
    expect(await off.evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(mode === 'exact' ? 1440 : 390)
    await page.screenshot({ path: testInfo.outputPath(`approved-off-${mode}.png`), fullPage: true })
    const callsBefore = await page.evaluate(() => (window as any).__scheduleCalls.length)
    await page.evaluate(() => (window as any).__emitScheduleSnapshot('ptScheduleDrafts', { revision: 2, schedule: {} }))
    await expect(page.getByRole('region', { name: 'Phiên bản cảnh báo' })).toContainText('Draft r2')
    await expect(page.locator('.schedule-warning-student')).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).__scheduleCalls.length)).toBe(callsBefore)
    await page.getByRole('tab', { name: 'Học viên', exact: true }).click()
    await expect(page.locator('#schedule-student-a')).toContainText('3 buổi/tuần · giữ nguyên')
    await expect(page.locator('#schedule-student-a')).toContainText('OFF / bảo lưu đã duyệt')
    await page.getByRole('button', { name: 'Tuần sau', exact: true }).click()
    await page.getByRole('tab', { name: /Cảnh báo/ }).click()
    await expect(page.locator('.schedule-approved-off')).toHaveCount(0)
  })
}

test('a booking on approved OFF remains a conflict even when the learner is excluded from missing sessions', async ({ page }) => {
  await openOffWeek(page, 'exact', true)
  await expect(page.locator('.schedule-warning-student')).toHaveCount(0)
  await page.getByRole('tab', { name: /Trùng \/ xung đột/ }).click()
  const conflicts = page.getByRole('region', { name: 'Danh sách trùng và xung đột lịch' })
  await expect(conflicts).toContainText('Gia Hân')
  await expect(conflicts).toContainText('CONTRACT_PAUSED')
})

for (const mode of ['exact', 'stale'] as const) test(`partial OFF keeps matrix cells but shows 1/3 valid sessions and two conflicts (${mode})`, async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-25T09:00:00Z'))
  await page.addInitScript(mode => {
    const student = { id: 'a', name: 'Phương Thảo', status: 'active', branchId: 'b', sessionsPerWeek: 3,
      defaultSessionsPerWeek: 3, maxWeeklySessions: 7, schedulableSessionsThisWeek: 1,
      availableSlots: ['T4-6', 'T5-6', 'T7-6'], availabilityStatus: 'submitted',
      eligibleForWeek: true, eligibilityReasons: [], eligibleContractIds: ['c-a'],
      validScheduleDates: ['2026-10-31'], pausedScheduleDates: ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'],
      remainingSchedulableSessions: 20, contractStatus: 'valid' }
    Object.assign(window, { __enableScheduleListener: true, __weeklyViewCompact: true, __validationMode: mode,
      __weeklyCoverageOverride: { totalTargetSessions: 3, scheduledEntries: 3, missingSessions: 0,
        byStudent: { a: { studentId: 'a', targetSessions: 3, scheduledSessions: 3, draftSessions: 3, missingSessions: 0, otherBranchSessions: 0 } } },
      __workspaceOverride: { students: [student], contracts: [], schedule: Object.fromEntries(['T4-6', 'T5-6', 'T7-6'].map(slot => [slot, [{ studentId: 'a', trainerId: 't', type: 'training', source: 'manual_v2', adminOverride: true, branchId: 'b' }]])) } })
  }, mode)
  await page.goto('/tests/schedule-ui/index.html')
  await page.getByRole('button', { name: 'Tuần sau', exact: true }).click()
  await expect(page.locator('.schedule-cell__student').filter({ hasText: 'Phương Thảo' })).toHaveCount(3)
  await page.getByRole('tab', { name: /Cảnh báo/ }).click()
  await expect(page.locator('.schedule-warning-student').filter({ hasText: 'Phương Thảo' })).toContainText('1/3')
  await page.getByRole('tab', { name: /Trùng \/ xung đột/ }).click()
  const conflicts = page.getByRole('region', { name: 'Danh sách trùng và xung đột lịch' })
  await expect(conflicts).toContainText('CONTRACT_PAUSED')
  expect(await conflicts.getByText('Phương Thảo', { exact: true }).count()).toBe(2)
})

test('OFF classification uses operating dates and never treats missing availability as approved leave', async ({ page }) => {
  await page.goto('/tests/schedule-ui/index.html')
  const results = await page.evaluate(async () => {
    const { approvedOffForWeek } = await import('/src/features/schedule/weeklyOff.ts')
    const workspace: any = { weekId: '2026-10-26', scheduleConfig: { workingDays: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7'], holidays: [] } }
    const student: any = { pausedScheduleDates: ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'], validScheduleDates: ['2026-11-01'] }
    return [approvedOffForWeek(student, workspace),
      approvedOffForWeek({ ...student, pausedScheduleDates: [] }, workspace),
      approvedOffForWeek({ ...student, pausedScheduleDates: ['2026-10-26'] }, workspace),
      approvedOffForWeek({ ...student, validScheduleDates: ['2026-10-27'] }, workspace),
      approvedOffForWeek(student, { ...workspace, scheduleConfig: { workingDays: [...workspace.scheduleConfig.workingDays, 'CN'], holidays: [] } }),
      approvedOffForWeek(student, { ...workspace, weekId: '2026-11-02' }),
      approvedOffForWeek(student, { ...workspace, scheduleConfig: { workingDays: [], holidays: [] } })]
  })
  expect(results).toEqual([true, false, false, false, false, false, false])
})
