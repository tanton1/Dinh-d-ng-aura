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

for (const screen of ['home', 'schedule', 'trainer', 'availability']) {
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

for (const screen of ['home', 'schedule', 'trainer', 'availability']) test(`${screen}: Vietnam midnight refreshes exactly once`, async ({ page }) => {
  await open(page, screen, '2026-10-23T16:59:58Z')
  await page.clock.runFor(3000)
  await expect.poll(() => count(page)).toBe(2)
  const inputs = await page.evaluate(() => (window as any).workspaceCalls.map((call: any) => call.input))
  if (!['trainer', 'availability'].includes(screen)) expect(inputs[0]).not.toEqual(inputs[1])
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

async function attendanceFixture(page: Page, size = 1) {
  await page.addInitScript((count) => {
    Object.assign(window, { allowMutationFixture: true, workspaceSessions: Array.from({ length: count }, (_, index) => ({
      id: `session-${index}`, studentId: `student-${index}`, studentName: `Học viên ${index}`, date: '2026-10-23', hour: 10,
      status: 'scheduled', attendanceStatus: 'pending', trainerId: 'trainer', branchId: 'branch', contractId: 'contract', revision: 1, timeZone: 'Asia/Ho_Chi_Minh',
    })) })
  }, size)
  await open(page, 'trainer')
}
async function startSingleAttendance(page: Page) {
  await page.getByRole('button', { name: 'Có tập', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Có tập Đến đúng giờ' }).click()
}
const finishAttendance = (page: Page, index = 0, error?: string) => page.evaluate(({ index, error }) => (window as any).attendanceResolvers[index](error), { index, error })
const expectAttendanceReads = (page: Page, expected: number) => expect.poll(async () => {
  // WebKit may commit React's resumed state after the mutation microtask.
  // Advance its local debounce clock until that commit settles; the exact
  // count still rejects duplicate refreshes instead of allowing "at least".
  await page.clock.runFor(100)
  return count(page)
}).toBe(expected)

test('thirty attendance signals during one bulk confirmation wait and reconcile exactly once after its response', async ({ page }) => {
  await attendanceFixture(page, 30)
  await page.getByRole('button', { name: 'Xác nhận 30 học viên đều đã tập', exact: true }).click()
  await page.getByRole('button', { name: 'Xác nhận tất cả', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).attendanceWrites?.length)).toBe(1)
  for (let version = 1; version <= 30; version++) {
    await emit(page, 'trainerWorkspaceVersion', String(version).padStart(4, '0'))
    await page.clock.runFor(400)
  }
  expect(await count(page)).toBe(1)
  await finishAttendance(page)
  await expectAttendanceReads(page, 2)
  await expect(page.getByText('Đã xác nhận 30 học viên đều có tập.', { exact: true })).toBeVisible()
  await page.clock.runFor(60_000)
  expect(await count(page)).toBe(2)
})

test('a later source revision still refreshes after a single attendance response, without repeating the accepted signal', async ({ page }) => {
  await attendanceFixture(page)
  await startSingleAttendance(page)
  await finishAttendance(page)
  await expectAttendanceReads(page, 2)
  await emit(page, 'trainerWorkspaceVersion', '0001')
  await page.clock.runFor(600)
  expect(await count(page)).toBe(3)
  await emit(page, 'trainerWorkspaceVersion', '0001')
  await page.clock.runFor(600)
  expect(await count(page)).toBe(3)
})

test('partial bulk success retains failed rows and consumes accumulated signals in one reconciliation', async ({ page }) => {
  await attendanceFixture(page, 2)
  await page.evaluate(() => { (window as any).attendanceFailSession = 'session-1' })
  await page.getByRole('button', { name: 'Xác nhận 2 học viên đều đã tập', exact: true }).click()
  await page.getByRole('button', { name: 'Xác nhận tất cả', exact: true }).click()
  await emit(page, 'trainerWorkspaceVersion', '0001')
  await page.clock.runFor(500)
  expect(await count(page)).toBe(1)
  await finishAttendance(page)
  await expectAttendanceReads(page, 2)
  await expect(page.getByText('Đã xác nhận 1/2 buổi; 1 buổi cần tải lại để đối soát.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Có tập', exact: true })).toHaveCount(1)
  expect(await page.evaluate(() => (window as any).attendanceWrites.length)).toBe(1)
})

test('a completed attendance waits while hidden and reconciles once on resume', async ({ page }) => {
  await attendanceFixture(page)
  await startSingleAttendance(page)
  await page.evaluate(() => { (window as any).workspaceHidden = true; document.dispatchEvent(new Event('visibilitychange')) })
  await emit(page, 'trainerWorkspaceVersion', '0002')
  await finishAttendance(page)
  await page.clock.runFor(60_000)
  expect(await count(page)).toBe(1)
  await page.evaluate(() => { (window as any).workspaceHidden = false; document.dispatchEvent(new Event('visibilitychange')) })
  await expectAttendanceReads(page, 2)
})

test('a failed attendance without a new signal preserves the error and does not retry reads or writes', async ({ page }) => {
  await attendanceFixture(page)
  await startSingleAttendance(page)
  await finishAttendance(page, 0, 'Không thể xác nhận trong lần thử này.')
  await page.clock.runFor(60_000)
  expect(await count(page)).toBe(1)
  expect(await page.evaluate(() => (window as any).attendanceWrites.length)).toBe(1)
  await expect(page.getByRole('dialog').getByText('Không thể xác nhận trong lần thử này.', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Có tập Đến đúng giờ' })).toBeEnabled()
})

test('an old attendance response cannot refresh a new week or overwrite its notices', async ({ page }) => {
  await attendanceFixture(page)
  await startSingleAttendance(page)
  await page.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).click()
  await page.getByRole('button', { name: 'Tuần sau', exact: true }).click()
  await expectAttendanceReads(page, 2)
  await finishAttendance(page)
  await page.clock.runFor(600)
  expect(await count(page)).toBe(2)
  await expect(page.getByText('Đã ghi nhận hiện diện.', { exact: false })).toHaveCount(0)
})

test('an old account failure cannot clear a newer account attendance operation or show its error', async ({ page }) => {
  await attendanceFixture(page)
  await startSingleAttendance(page)
  await page.evaluate(() => (window as any).workspaceAccount('account-b'))
  await expectAttendanceReads(page, 2)
  await startSingleAttendance(page)
  await finishAttendance(page, 0, 'old-account-private-error')
  await page.clock.runFor(500)
  await expect(page.getByText('old-account-private-error')).toHaveCount(0)
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Có tập Đến đúng giờ' })).toBeDisabled()
  expect(await count(page)).toBe(2)
  await finishAttendance(page, 1)
  await expectAttendanceReads(page, 3)
  expect(await page.evaluate(() => (window as any).attendanceWrites.map((item: any) => item.uid))).toEqual(['account-a', 'account-b'])
})
