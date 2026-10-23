import { expect, test, type Page } from '@playwright/test'
const path = 'users/account-a/workspaceChanges/operations'
const pageErrors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => { const errors: string[] = []; pageErrors.set(page, errors); page.on('pageerror', (error) => errors.push(error.message)) })
test.afterEach(({ page }) => { expect(pageErrors.get(page)).toEqual([]) })
const count = (page: Page) => page.evaluate(() => (window as any).workspaceCalls.length)
async function emit(page: Page, field: string, version: string, target = path, cached = false) {
  await page.evaluate(({ field, version, target, cached }) => (window as any).workspaceEmit(target, { [field]: version }, cached), { field, version, target, cached })
}
async function open(page: Page, screen: string, time = '2026-10-23T05:00:00Z') {
  await page.clock.install({ time: new Date(time) })
  await page.goto(`/tests/workspace-sync-ui/index.html?screen=${screen}`)
  await expect.poll(() => count(page)).toBe(1)
  await page.clock.runFor(250)
}

for (const screen of ['home', 'schedule', 'trainer']) {
  test(`${screen}: one hour idle has no requests; relevant changes coalesce once`, async ({ page }) => {
    await open(page, screen)
    await page.clock.fastForward(3_600_000)
    expect(await count(page)).toBe(1)
    const field = screen === 'trainer' ? 'trainerWorkspaceVersion' : 'studentScheduleVersion'
    await emit(page, field, '9999', path, true)
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await page.clock.runFor(500)
    expect(await count(page)).toBe(1)
    await emit(page, field, '0001'); await emit(page, field, '0002'); await emit(page, field, '0003')
    await page.clock.runFor(300)
    await expect.poll(() => count(page)).toBe(2)
    await emit(page, field, '0002'); await emit(page, field, '0003')
    await page.clock.fastForward(3_600_000)
    expect(await count(page)).toBe(2)
  })
}

test('a change during the initial read queues exactly one follow-up', async ({ page }) => {
  await page.addInitScript(() => { (window as any).workspaceDelay = 1000 })
  await open(page, 'schedule')
  await emit(page, 'studentScheduleVersion', '0001')
  await page.clock.runFor(1600)
  await expect.poll(() => count(page)).toBe(2)
  await page.clock.runFor(1500)
  expect(await count(page)).toBe(2)
})

test('hidden changes defer; account switch removes old listeners and ignored old account events', async ({ page }) => {
  await open(page, 'schedule')
  await page.evaluate(() => { (window as any).workspaceHidden = true })
  await emit(page, 'studentScheduleVersion', '0001')
  await page.clock.runFor(500)
  expect(await count(page)).toBe(1)
  await page.evaluate(() => { (window as any).workspaceHidden = false; document.dispatchEvent(new Event('visibilitychange')) })
  await page.clock.runFor(250)
  expect(await count(page)).toBe(2)
  await page.evaluate(() => (window as any).workspaceAccount('account-b'))
  await page.clock.runFor(250)
  await expect.poll(() => count(page)).toBe(3)
  const active = await page.evaluate(() => (window as any).workspaceActivePaths())
  expect(active).not.toContain(path)
  expect(active).toContain('users/account-b/workspaceChanges/operations')
  await emit(page, 'studentScheduleVersion', '0002')
  await page.clock.runFor(300)
  expect(await count(page)).toBe(3)
})

test('listener failures show retry and never create a polling loop', async ({ page }) => {
  await open(page, 'schedule')
  await page.evaluate((target) => (window as any).workspaceFail(target), path)
  await expect(page.getByText('Chưa cập nhật được lịch mới nhất.')).toBeVisible()
  await page.clock.fastForward(3_600_000)
  expect(await count(page)).toBe(1)
  await page.evaluate(() => { (window as any).signalFailures = [] })
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click()
  await page.clock.runFor(250)
  expect(await count(page)).toBe(2)
  await expect(page.getByText('Chưa cập nhật được lịch mới nhất.')).toHaveCount(0)
})

for (const screen of ['home', 'schedule', 'trainer']) test(`${screen}: Vietnam midnight refreshes exactly once`, async ({ page }) => {
  await open(page, screen, '2026-10-23T16:59:58Z')
  await page.clock.runFor(3000)
  await expect.poll(() => count(page)).toBe(2)
  const inputs = await page.evaluate(() => (window as any).workspaceCalls.map((call: any) => call.input))
  if (screen !== 'trainer') expect(inputs[0]).not.toEqual(inputs[1])
  await page.clock.runFor(3_600_000)
  expect(await count(page)).toBe(2)
})

test('older initial listener snapshot never reloads a newer response', async ({ page }) => {
  await page.addInitScript((target) => {
    Object.assign(window, { signalValues: { [target]: { studentScheduleVersion: '0002' } }, initialSignalValues: { [target]: { studentScheduleVersion: '0001' } } })
  }, path)
  await open(page, 'schedule')
  await page.clock.fastForward(3_600_000)
  expect(await count(page)).toBe(1)
  await expect(page.getByText('Chưa cập nhật được lịch mới nhất.')).toHaveCount(0)
})

test('read failure has no automatic retry loop and explicit retry recovers', async ({ page }) => {
  await open(page, 'schedule')
  await page.evaluate(() => { (window as any).workspaceReadFails = true })
  await emit(page, 'studentScheduleVersion', '0001')
  await page.clock.runFor(300)
  expect(await count(page)).toBe(2)
  await page.clock.fastForward(3_600_000)
  expect(await count(page)).toBe(2)
  await page.evaluate(() => { (window as any).workspaceReadFails = false })
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click()
  await page.clock.runFor(250)
  expect(await count(page)).toBe(3)
})

test('trainer refreshes on its authorized branch and policy signals', async ({ page }) => {
  await open(page, 'trainer')
  await emit(page, 'trainerWorkspaceVersion', '0001', 'workspaceBranchChanges/branch')
  await page.clock.runFor(300); expect(await count(page)).toBe(2)
  await emit(page, 'trainerWorkspaceVersion', '0001', 'workspaceChanges/policy')
  await page.clock.runFor(300); expect(await count(page)).toBe(3)
})

test('session starts disable student changes locally without another request', async ({ page }) => {
  await page.addInitScript(() => { (window as any).workspaceSessions = [{ id: 'session', date: '2026-10-23', hour: 13, status: 'scheduled', trainerId: 'trainer', trainerName: 'PT kiểm thử', branchId: 'branch', verifiedByStudent: false, scheduleEntryId: '', revision: 1, timeZone: 'Asia/Ho_Chi_Minh' }] })
  await open(page, 'schedule', '2026-10-23T05:59:58Z')
  await expect(page.getByRole('button', { name: 'Đổi / hủy buổi', exact: true })).toBeEnabled()
  await page.clock.runFor(3000)
  await expect(page.getByRole('button', { name: 'Buổi đã bắt đầu', exact: true })).toBeDisabled()
  expect(await count(page)).toBe(1)
})

test('initial read error recovers once after a new authoritative revision', async ({ page }) => {
  await page.addInitScript(() => { (window as any).workspaceReadFails = true })
  await open(page, 'schedule')
  await page.clock.runFor(500)
  expect(await count(page)).toBe(1)
  await page.evaluate(() => { (window as any).workspaceReadFails = false })
  await emit(page, 'studentScheduleVersion', '0001')
  await page.clock.runFor(300)
  await expect.poll(() => count(page)).toBe(2)
  await page.clock.fastForward(3_600_000)
  expect(await count(page)).toBe(2)
})

test('visible history refreshes with revisions; hidden history waits until opened', async ({ page }) => {
  await open(page, 'schedule')
  const historyCount = () => page.evaluate(() => (window as any).historyCalls?.length || 0)
  expect(await historyCount()).toBe(0)
  await page.getByRole('button', { name: 'Lịch sử', exact: true }).first().click()
  await expect.poll(historyCount).toBe(1)
  await emit(page, 'studentScheduleVersion', '0001')
  await page.clock.runFor(300)
  await expect.poll(historyCount).toBe(2)
  await page.clock.fastForward(3_600_000)
  expect(await historyCount()).toBe(2)
  await page.evaluate(() => (window as any).workspaceAccount('account-b'))
  await page.clock.runFor(300)
  await expect.poll(historyCount).toBe(3)
  expect(await page.evaluate(() => (window as any).historyCalls)).toEqual(['account-a', 'account-a', 'account-b'])
})

test('completed mutation cannot reload a previous trainer week after navigation', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { allowMutationFixture: true, workspaceSessions: [{ id: 'session', studentId: 'student', date: '2026-10-23', hour: 13, status: 'scheduled', attendanceStatus: 'pending', trainerId: 'trainer', branchId: 'branch', contractId: 'contract', revision: 1, timeZone: 'Asia/Ho_Chi_Minh' }] })
  })
  await open(page, 'trainer')
  await page.getByRole('button', { name: 'Báo nghỉ trước giờ', exact: true }).click()
  await page.getByRole('button', { name: 'Xác nhận báo nghỉ', exact: true }).click()
  await expect.poll(() => page.evaluate(() => typeof (window as any).finishWorkspaceMutation)).toBe('function')
  await page.getByRole('button', { name: 'Để sau', exact: true }).click()
  await page.getByRole('button', { name: 'Tuần sau', exact: true }).click()
  await page.clock.runFor(250)
  expect(await count(page)).toBe(2)
  await page.evaluate(() => (window as any).finishWorkspaceMutation())
  await page.clock.runFor(500)
  expect(await count(page)).toBe(2)
  await expect(page.getByLabel('Ngày lịch dạy')).toHaveValue('2026-10-26')
})
