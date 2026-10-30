import { expect, test } from '@playwright/test'

test('finance details use bounded reports without directory listeners or eager cash history', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.install({ time: new Date('2026-10-30T10:00:00+07:00') })
  await page.goto('/tests/history-route-isolation-ui/index.html?finance')
  const active = () => page.evaluate(() => [...(window as any).isolationCalls.active].sort())
  const calls = () => page.evaluate(() => (window as any).isolationCalls)
  await expect.poll(active).toEqual(['branches'])
  await page.getByRole('button', { name: 'Cashbook', exact: true }).click()
  expect((await calls()).reporting).toEqual([])
  await page.getByRole('button', { name: 'Ledger', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Hồ sơ Finance learner first', exact: true })).toBeVisible()
  expect(await active()).toEqual(['branches'])
  const initial = await calls()
  expect(initial.reporting.length).toBeGreaterThan(0)
  for (const call of initial.reporting) {
    expect(call).toMatchObject({ name: 'listFinanceReceivables', region: 'business-reporting', input: { pageSize: 20, branchId: 'all', cursor: null, includeSummary: true } })
  }
  expect(initial.ledger).toEqual([])
  expect(initial.cashAccounts).toBe(0)
  await page.getByRole('button', { name: 'Rerender finance 0', exact: true }).click()
  await page.clock.fastForward(6000)
  expect((await calls()).reporting).toHaveLength(initial.reporting.length)
  await page.getByRole('button', { name: 'Tải thêm hồ sơ', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Hồ sơ Finance learner next', exact: true })).toBeVisible()
  const paged = await calls()
  expect(paged.reporting).toHaveLength(initial.reporting.length + 1)
  expect(paged.reporting.at(-1)).toMatchObject({ input: { pageSize: 20, cursor: 'next-page', includeSummary: false } })
  expect(paged.ledger).toEqual([])
  await page.getByRole('button', { name: 'Mở lịch sử thu trả góp' }).click()
  await expect.poll(async () => (await calls()).ledger.length).toBe(1)
  expect((await calls()).ledger[0]).toMatchObject({ pageSize: 50, branchId: 'all', cursor: null, includeSummary: false })
  await page.getByRole('dialog', { name: 'Sổ giao dịch' }).getByRole('button', { name: 'Đóng', exact: true }).click()
  await page.getByRole('button', { name: 'Overview', exact: true }).click()
  await expect.poll(active).toEqual(['branches'])
  await page.getByRole('button', { name: 'Ledger', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Hồ sơ Finance learner first', exact: true })).toBeVisible()
  const reopened = await calls()
  expect(reopened.ledger).toHaveLength(1)
  expect(reopened.subscriptions.every((path: string) => path === 'branches')).toBe(true)
  expect(reopened.subscriptions).toHaveLength(initial.subscriptions.length)
  expect(errors).toEqual([])
})

test('only active trainer consumers subscribe; StrictMode and duplicate cleanup release safely', async ({ page }) => {
  await page.goto('/tests/history-route-isolation-ui/index.html')
  const calls = () => page.evaluate(() => (window as any).isolationCalls)
  await page.getByRole('button', { name: 'pauses', exact: true }).click()
  await page.getByRole('button', { name: 'student', exact: true }).click()
  expect((await calls()).subscriptions).toEqual([])
  await page.getByRole('button', { name: 'trainer', exact: true }).click()
  await expect(page.locator('output')).toHaveText('PT Test')
  expect((await calls()).active).toEqual(['trainers'])
  const count = (await calls()).subscriptions.length
  await page.getByRole('button', { name: 'Rerender 0' }).click()
  await page.getByRole('button', { name: 'Second consumer' }).click()
  expect((await calls()).subscriptions).toHaveLength(count)
  await page.getByRole('button', { name: 'requests', exact: true }).click()
  expect((await calls()).active).toEqual(['trainers'])
  await page.getByRole('button', { name: 'Second consumer' }).click()
  await expect.poll(async () => (await calls()).active).toEqual([])
  await page.getByRole('button', { name: 'trainer', exact: true }).click()
  await expect(page.locator('output')).toHaveText('PT Test')
  expect((await calls()).active).toEqual(['trainers'])
})

test('OFF loads availability alone and request tab gets names from its own payload', async ({ page }) => {
  const modules: string[] = []
  page.on('request', (request) => modules.push(request.url()))
  await page.goto('/tests/history-route-isolation-ui/index.html')
  await page.getByRole('button', { name: 'staff', exact: true }).click()
  await expect(page.getByText('OFF theo ngày', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).isolationCalls.workspace)).toEqual([])
  expect(modules.some((url) => url.includes('/TrainerPortalV2.tsx'))).toBe(false)
  await page.getByRole('button', { name: 'Yêu cầu Đổi và hủy' }).click()
  await expect(page.getByText(/2026-10-24.*Minh Nguyệt/)).toBeVisible()
  expect(await page.evaluate(() => (window as any).isolationCalls.workspace.every((section: string) => section === 'requests'))).toBe(true)
  const availabilityCalls = await page.evaluate(() => (window as any).isolationCalls.availability.length)
  await page.getByRole('button', { name: 'Lịch dạy Ma trận tuần' }).click()
  await expect.poll(() => page.evaluate(() => (window as any).isolationCalls.workspace.includes('schedule'))).toBe(true)
  expect(await page.evaluate(() => (window as any).isolationCalls.availability.length)).toBe(availabilityCalls)
})

test('switching OFF weeks ignores a slower response from the previous week', async ({ page }) => {
  await page.goto('/tests/history-route-isolation-ui/index.html')
  await page.getByRole('button', { name: 'staff', exact: true }).click()
  await expect(page.getByText('OFF theo ngày', { exact: true })).toBeVisible()
  await page.evaluate(() => { (window as any).deferAvailability = true })
  await page.getByRole('button', { name: 'Tuần kế tiếp', exact: true }).click()
  await expect(page.getByText('OFF theo ngày', { exact: true })).toBeHidden()
  await expect.poll(() => page.evaluate(() => Object.keys((window as any).pendingAvailability || {}).length)).toBe(1)
  await page.getByRole('button', { name: 'Tuần kế tiếp', exact: true }).click()
  await expect.poll(() => page.evaluate(() => Object.keys((window as any).pendingAvailability || {}).length)).toBe(2)
  await page.evaluate(() => {
    const pending = (window as any).pendingAvailability
    pending[Object.keys(pending).sort()[1]]('Current week')
  })
  await expect(page.getByRole('heading', { name: 'Current week' })).toBeVisible()
  await page.evaluate(() => {
    const pending = (window as any).pendingAvailability
    pending[Object.keys(pending).sort()[0]]('Stale week')
  })
  await expect(page.getByRole('heading', { name: 'Current week' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Stale week' })).toBeHidden()
})

test('teaching schedule loads addable learners only when its dialog opens, retaining cross-branch session learners', async ({ page }) => {
  await page.goto('/tests/history-route-isolation-ui/index.html')
  await page.evaluate(() => {
    const state = window as any
    state.deferRoster = true
    state.isolationSessions = [
      { id: 'source', studentId: 'source-student', studentName: 'Source learner', trainerId: 'trainer', date: '2026-10-24', hour: 18, status: 'scheduled', attendanceStatus: 'pending', contractId: 'source-contract', advanceAbsenceNotice: { status: 'reported', replacementLocked: false } },
      { id: 'cross-session', studentId: 'cross-student', studentName: 'Cross branch learner', studentBranchId: 'other-branch', trainerId: 'trainer', date: '2026-10-23', hour: 18, status: 'scheduled', contractEffective: true, contractSchedulable: true, contract: { id: 'cross-contract', status: 'active', startDate: '2026-01-01', endDate: '2027-01-01', totalSessions: 36, usedSessions: 0 } },
    ]
  })
  await page.getByRole('button', { name: 'staff', exact: true }).click()
  await page.getByRole('button', { name: 'Lịch dạy Ma trận tuần' }).click()
  await expect(page.getByRole('heading', { name: 'Source learner', exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).isolationCalls.roster)).toEqual([])
  await page.getByRole('button', { name: 'Thêm học viên vào ca', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Thêm học viên vào ca' })
  await expect(dialog.getByRole('status')).toHaveText('Đang tải học viên có thể thêm vào ca…')
  await expect(dialog.getByRole('combobox')).toBeDisabled()
  await page.evaluate(() => (window as any).finishRoster({ students: [{ id: 'branch-student', name: 'Branch learner', phone: '', email: '', branchId: 'branch', status: 'active', sessionsPerWeek: 3, assignmentRole: 'branch', contract: { id: 'branch-contract', status: 'active', totalSessions: 36, usedSessions: 0 } }], hasMore: false }))
  await expect(dialog.getByRole('combobox')).toBeEnabled()
  await expect(dialog.locator('option')).toHaveText(['Chọn học viên', 'Branch learner', 'Cross branch learner'])
  expect(await page.evaluate(() => (window as any).isolationCalls.roster)).toEqual([500])
  await dialog.getByRole('button', { name: 'Để sau' }).click()
  await page.getByRole('button', { name: 'Yêu cầu Đổi và hủy' }).click()
  expect(await page.evaluate(() => (window as any).isolationCalls.roster)).toEqual([500])
})

test('new UI keeps initial roster options when an older backend truncates the on-demand roster', async ({ page }) => {
  await page.goto('/tests/history-route-isolation-ui/index.html')
  await page.evaluate(() => {
    const state = window as any
    state.rosterHasMore = true
    state.legacyInitialRoster = [{ id: 'legacy-student', name: 'Legacy roster learner', phone: '', status: 'active', contract: { id: 'legacy-contract', status: 'active', totalSessions: 36, usedSessions: 0 } }]
    state.isolationSessions = [{ id: 'source', studentId: 'source-student', studentName: 'Source learner', trainerId: 'trainer', date: '2026-10-24', hour: 18, status: 'scheduled', attendanceStatus: 'pending', advanceAbsenceNotice: { status: 'reported', replacementLocked: false } }]
  })
  await page.getByRole('button', { name: 'staff', exact: true }).click()
  await page.getByRole('button', { name: 'Lịch dạy Ma trận tuần' }).click()
  await page.getByRole('button', { name: 'Thêm học viên vào ca', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Thêm học viên vào ca' })
  await expect(dialog.getByRole('combobox')).toBeEnabled()
  await expect(dialog.locator('option')).toHaveText(['Chọn học viên', 'Legacy roster learner'])
})
