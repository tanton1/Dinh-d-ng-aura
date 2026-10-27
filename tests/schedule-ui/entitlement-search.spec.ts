import { expect, test } from '@playwright/test'

test('same-branch manual availability exception saves immediately, without loading another workspace', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-26T00:00:00+07:00'))
  await page.goto('/tests/schedule-ui/index.html')
  await page.locator('.schedule-cell[aria-label*="Thứ 3"]').first().focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Xếp ngay Ngọc', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Xếp ngay Ngọc', exact: true }).click()
  await expect(page.locator('.schedule-assigned-row').filter({ hasText: 'Ngọc' })).toBeVisible()
  await expect(page.locator('.schedule-manual-confirm')).toHaveCount(0)
  const calls = await page.evaluate(() => (window as any).__scheduleCalls)
  expect(calls.filter((call: any) => call.operation === 'command')).toHaveLength(1)
  expect(calls.find((call: any) => call.operation === 'command').input.payload.allowOutsideStudentAvailability).toBe(true)
  expect(calls.filter((call: any) => ['candidates', 'load'].includes(call.operation))).toHaveLength(0)
})

test('cross-branch placement still requires explicit confirmation and does not save on selection', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.clock.setFixedTime(new Date('2026-10-26T00:00:00+07:00'))
  await page.addInitScript(() => Object.assign(window, { __searchCandidates: [{
    studentId: 'external', name: 'Thảo My', phone: '0900003782', eligible: false,
    manualSelectable: true, adminManualSelectable: true, reasons: ['STUDENT_BRANCH_MISMATCH'],
    studentBranchWarning: true, studentHomeBranchId: 'c', contractId: 'contract-active', matchesStudentAvailability: true,
  }] }))
  await page.goto('/tests/schedule-ui/index.html')
  await page.locator('.schedule-cell').filter({ hasText: 'Lan' }).focus()
  await page.keyboard.press('Enter')
  await page.getByPlaceholder('Tên hoặc SĐT · tìm cả cơ sở khác').fill('thao my')
  await page.getByRole('button', { name: 'Chọn Thảo My', exact: true }).click()
  await expect(page.locator('.schedule-branch-confirm')).toContainText('CS2')
  expect(await page.evaluate(() => (window as any).__scheduleCalls.filter((call: any) => call.operation === 'command').length)).toBe(0)
  await expect(page.getByRole('button', { name: 'Xếp ngay Thảo My', exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('cross-branch-confirm-mobile.png'), fullPage: true })
  await page.getByRole('button', { name: 'Xác nhận xếp ca', exact: true }).click()
  await expect(page.locator('.schedule-assigned-row')).toHaveCount(2)
  expect(await page.evaluate(() => (window as any).__scheduleCalls.find((call: any) => call.operation === 'command').input.payload.confirmCrossBranchStudent)).toBe(true)
})

test('compact local picker hides old expiry and offers OFF only to admins outside the historical flow', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-25T00:00:00+07:00'))
  await page.goto('/tests/schedule-ui/index.html')
  const result = await page.evaluate(async () => {
    const { localSlotCandidates, candidateCanBeManuallyScheduled } = await import('/src/features/schedule/workspaceModel.ts')
    const base: any = { branchId: 'b', status: 'active', sessionsPerWeek: 3, availableSlots: ['T4-6'], availabilityStatus: 'submitted',
      eligibleForWeek: true, eligibilityReasons: [], eligibleContractIds: ['valid'], validScheduleDates: ['2026-10-28'], pausedScheduleDates: [] }
    const data: any = { weekId: '2026-10-26', branch: { id: 'b' }, schedule: {}, contracts: [], students: [
      { ...base, id: 'valid', name: 'Thảo My', contractEndDate: '2027-03-09' },
      { ...base, id: 'old', name: 'Thảo My', contractEndDate: '2026-06-30' },
      { ...base, id: 'off', name: 'Phương Thảo', validScheduleDates: ['2026-10-31'], pausedScheduleDates: ['2026-10-28'] },
    ] }
    return localSlotCandidates(data, 't', 'T4-6').map(row => [row.studentId, candidateCanBeManuallyScheduled(row, true), candidateCanBeManuallyScheduled(row, false), candidateCanBeManuallyScheduled(row, true, false)])
  })
  expect(result).toEqual(expect.arrayContaining([['valid', true, true, true], ['off', true, false, false]]))
  expect(result).toHaveLength(2)
})

test('Students tab matches unaccented names and searches the other branch only after typing', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    const student = { id: 'active-my', name: 'Thảo My', branchId: 'c', status: 'active', sessionsPerWeek: 3,
      availableSlots: [], availabilityStatus: 'submitted', eligibleForWeek: true, eligibilityReasons: [], maxWeeklySessions: 7 }
    Object.assign(window, {
      __searchCandidates: [{ studentId: 'active-my', name: 'Thảo My', phone: '0900003782', studentHomeBranchId: 'c', studentBranchWarning: true }],
      __weeklyViewByBranch: { c: { students: [student], schedule: {} } },
    })
  })
  await page.goto('/tests/schedule-ui/index.html')
  await page.getByRole('tab', { name: 'Học viên', exact: true }).click()
  expect(await page.evaluate(() => (window as any).__scheduleCalls.filter((call: any) => call.operation === 'candidates').length)).toBe(0)
  await page.getByPlaceholder('Tìm tên học viên').fill('thao my')
  const remote = page.getByRole('region', { name: 'Kết quả ở cơ sở khác' })
  await expect(remote).toContainText('Thảo My')
  await expect(remote).toContainText('3782')
  expect(await page.locator('.branch-schedule__student-tools > label').evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: testInfo.outputPath('student-cross-branch-search-mobile.png'), fullPage: true })
  await remote.getByRole('button', { name: 'Xem học viên' }).click()
  await expect(page.getByRole('combobox', { name: 'Chọn chi nhánh' })).toHaveValue('c')
  await expect(page.locator('#schedule-student-active-my')).toContainText('Thảo My')
})
