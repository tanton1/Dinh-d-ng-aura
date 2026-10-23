import { expect, test } from '@playwright/test'

test('display snapshots retain last-known profile evidence but never claim it is reconciled', async ({ page }) => {
  await page.goto('/tests/schedule-ui/index.html')
  const result = await page.evaluate(async () => {
    const { workspaceFromWeeklyViewSnapshot } = await import('/src/features/schedule/workspaceModel.ts')
    const { getPtScheduleWeeklyView } = await import('/tests/schedule-ui/service.ts')
    const current = await getPtScheduleWeeklyView({ branchId: 'b', weekId: '2026-10-19' })
    current.weeklyViewSourceRevision = 'old-source'
    current.students[0] = { ...current.students[0], phone: '0900000001', email: 'old@example.test', eligibleContractIds: ['c-a'], remainingSchedulableSessions: 20 }
    const next = workspaceFromWeeklyViewSnapshot(current, {
      branchId: 'b', weekId: current.weekId, sourceRevision: 'new-source', viewRevision: 2,
      draft: { revision: 2, status: 'draft', publishedVersion: 0, publishedRevision: -1 },
      freshness: 'display', contracts: [], students: [{ ...current.students[0], name: 'Tên mới', phone: '0900000002', eligibleContractIds: [], remainingSchedulableSessions: 0 }],
    })
    return { readMode: next.readMode, partial: next.partial, reconciliationState: next.reconciliationState, draftRevision: next.draftRevision, contracts: next.contracts.length, student: next.students[0] }
  })
  expect(result).toMatchObject({ readMode: 'display', partial: true, reconciliationState: 'stale', draftRevision: 2, contracts: 5 })
  expect(result.student).toMatchObject({ name: 'Tên mới', phone: '0900000002', email: 'old@example.test', eligibleContractIds: ['c-a'], remainingSchedulableSessions: 20 })
})

test('verified snapshots can remove old evidence; source scope and newer local draft stay protected', async ({ page }) => {
  await page.goto('/tests/schedule-ui/index.html')
  const result = await page.evaluate(async () => {
    const { workspaceFromWeeklyViewSnapshot, workspaceRealtimeFingerprint } = await import('/src/features/schedule/workspaceModel.ts')
    const { getPtScheduleWeeklyView } = await import('/tests/schedule-ui/service.ts')
    const current = await getPtScheduleWeeklyView({ branchId: 'b', weekId: '2026-10-19' })
    const renamed = workspaceFromWeeklyViewSnapshot(current, { students: [{ ...current.students[0], name: 'Tên mới', phone: '0900000002' }], freshness: 'verified', contracts: [] })
    const oldDraft = workspaceFromWeeklyViewSnapshot(current, { branchId: 'b', weekId: current.weekId, draft: { revision: 0 }, freshness: 'verified', contracts: [] })
    const otherBranch = workspaceFromWeeklyViewSnapshot(current, { branchId: 'c', weekId: current.weekId, freshness: 'verified', contracts: [] })
    const otherWeek = workspaceFromWeeklyViewSnapshot(current, { branchId: 'b', weekId: '2026-10-26', freshness: 'verified', contracts: [] })
    return { contracts: renamed.contracts.length, state: renamed.reconciliationState, readMode: renamed.readMode, fingerprintChanged: workspaceRealtimeFingerprint(current) !== workspaceRealtimeFingerprint(renamed), oldDraft: oldDraft === current, otherBranch: otherBranch === current, otherWeek: otherWeek === current }
  })
  expect(result).toEqual({ contracts: 0, state: 'current', readMode: 'reconciled', fingerprintChanged: true, oldDraft: true, otherBranch: true, otherWeek: true })
})

test('same-revision contact updates reach the visible matrix', async ({ page }) => {
  await page.addInitScript(() => { (window as any).__enableScheduleListener = true })
  await page.goto('/tests/schedule-ui/index.html')
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
  await page.evaluate(async () => {
    const { getPtScheduleWeeklyView } = await import('/tests/schedule-ui/service.ts')
    const call = (window as any).__scheduleCalls.find((item: any) => item.operation === 'weekly-view')
    const payload = await getPtScheduleWeeklyView(call.input)
    payload.students[0].name = 'Lan đã cập nhật'
    payload.students[0].phone = '0900000099'
    // Legacy revision hashes omitted name/phone; also support them while all
    // clients/functions roll forward to the complete semantic source hash.
    ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', payload)
  })
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan đã cập nhật' })).toHaveCount(1)
})

test('real compact schema2 listener reads nested draft revision and leaves stale mode after rebuilding', async ({ page }) => {
  await page.addInitScript(() => { (window as any).__enableScheduleListener = true })
  await page.goto('/tests/schedule-ui/index.html')
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
  await page.evaluate(async () => {
    const { getPtScheduleWeeklyView } = await import('/tests/schedule-ui/service.ts')
    const call = (window as any).__scheduleCalls.find((item: any) => item.operation === 'weekly-view')
    const current = await getPtScheduleWeeklyView(call.input)
    ;(window as any).__compactWeeklyFixture = {
      schemaVersion: 2, branchId: current.branch.id, weekId: current.weekId,
      sourceRevision: 'semantic-hash-v2', viewRevision: 2, dirty: false, freshness: 'verified',
      draft: { revision: current.draftRevision + 1, status: 'draft', publishedVersion: current.publishedVersion, publishedRevision: -1 },
      schedule: current.schedule, students: current.students.map((student: any) => student.id === 'a' ? { ...student, name: 'Lan compact mới', phone: '0900000010' } : student),
      trainers: current.trainers, contracts: current.contracts, warnings: [], scheduleConfig: current.scheduleConfig,
    }
    ;(window as any).__weeklyViewOverride = { rebuilding: true, rebuildStatus: 'busy', dirty: true, freshness: 'stale' }
    ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', { dirty: true, dirtyGeneration: 1 })
  })
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Đang đồng bộ')
  await page.evaluate(() => { (window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', (window as any).__compactWeeklyFixture) })
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan compact mới' })).toHaveCount(1)
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
  await page.getByRole('tab', { name: /Cảnh báo/ }).click()
  await expect(page.getByRole('button', { name: /Do hợp đồng/ })).toBeEnabled()
})

test('dirty generations coalesce non-forced refreshes and a busy rebuild keeps the matrix visible', async ({ page }) => {
  await page.addInitScript(() => { (window as any).__enableScheduleListener = true })
  await page.goto('/tests/schedule-ui/index.html')
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
  await page.evaluate(() => {
    ;(window as any).__weeklyViewDelayMs = 120
    ;(window as any).__weeklyViewOverride = { rebuilding: true, rebuildStatus: 'busy', dirty: true, freshness: 'stale' }
    for (let index = 0; index < 8; index++) (window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', { dirty: true, dirtyGeneration: 1, rebuildLeaseToken: `lease-${index}` })
    ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', { dirty: true, dirtyGeneration: 2 })
  })
  await expect.poll(() => page.evaluate(() => (window as any).__scheduleCalls.filter((item: any) => item.operation === 'weekly-view').length)).toBe(3)
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Đang đồng bộ')
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
  await page.evaluate(() => {
    for (let index = 0; index < 8; index++) (window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', { dirty: true, dirtyGeneration: 2, rebuildLeaseToken: `again-${index}` })
  })
  expect(await page.evaluate(() => (window as any).__scheduleCalls.filter((item: any) => item.operation === 'weekly-view').length)).toBe(3)
  expect(await page.evaluate(() => (window as any).__scheduleCalls.filter((item: any) => item.operation === 'weekly-view').map((item: any) => item.input.forceRefresh))).toEqual([false, false, false])
  expect(await page.evaluate(() => (window as any).__scheduleCalls.filter((item: any) => item.operation === 'load').length)).toBe(0)
  await page.evaluate(async () => {
    ;(window as any).__weeklyViewDelayMs = 0
    ;(window as any).__weeklyViewOverride = { rebuilding: false, dirty: false, freshness: 'verified', sourceRevision: 'updated-source', viewRevision: 2 }
    const { getPtScheduleWeeklyView } = await import('/tests/schedule-ui/service.ts')
    const call = (window as any).__scheduleCalls.find((item: any) => item.operation === 'weekly-view')
    const payload = await getPtScheduleWeeklyView(call.input)
    ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', payload)
  })
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
})

test('a dirty listener cannot cancel the full reconciliation explicitly requested by the optimizer', async ({ page }) => {
  await page.addInitScript(() => { (window as any).__enableScheduleListener = true; (window as any).__workspaceDelayMs = 500 })
  await page.goto('/tests/schedule-ui/index.html')
  await page.getByRole('button', { name: 'Tối ưu tiếp', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__scheduleCalls.filter((item: any) => item.operation === 'load').length)).toBe(1)
  await page.evaluate(() => { (window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', { dirty: true, dirtyGeneration: 1 }) })
  await expect(page.getByRole('combobox', { name: 'Chọn chi nhánh' })).toBeEnabled()
  expect(await page.evaluate(() => (window as any).__scheduleCalls.filter((item: any) => item.operation === 'weekly-view').length)).toBe(1)
  await page.getByRole('tab', { name: /Cảnh báo/ }).click()
  await expect(page.getByRole('button', { name: /Do hợp đồng/ })).toBeEnabled()
})

test('pending weekly refreshes retry with bounded backoff and stop after a clean snapshot', async ({ page }) => {
  await page.addInitScript(() => { (window as any).__enableScheduleListener = true })
  await page.goto('/tests/schedule-ui/index.html')
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
  await page.clock.install()
  await page.evaluate(() => {
    ;(window as any).__weeklyViewOverride = { rebuilding: true, rebuildStatus: 'superseded', dirty: true, freshness: 'stale' }
    ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', { dirty: true, dirtyGeneration: 1 })
  })
  const calls = () => page.evaluate(() => (window as any).__scheduleCalls.filter((item: any) => item.operation === 'weekly-view').length)
  await expect.poll(calls).toBe(2)
  await page.clock.runFor(2_001)
  await expect.poll(calls).toBe(3)
  await page.clock.runFor(5_001)
  await expect.poll(calls).toBe(4)
  await page.clock.runFor(30_000)
  expect(await calls()).toBe(4)
  await page.evaluate(() => { (window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', { dirty: true, dirtyGeneration: 2 }) })
  await expect.poll(calls).toBe(5)
  await page.evaluate(async () => {
    ;(window as any).__weeklyViewOverride = { rebuilding: false, dirty: false, freshness: 'verified', viewRevision: 2, sourceRevision: 'clean' }
    const { getPtScheduleWeeklyView } = await import('/tests/schedule-ui/service.ts')
    const call = (window as any).__scheduleCalls.find((item: any) => item.operation === 'weekly-view')
    ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', await getPtScheduleWeeklyView(call.input))
  })
  await page.clock.runFor(10_000)
  expect(await calls()).toBe(6)
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
})

test('history tools load only on demand and retain explicit restore confirmation', async ({ page }) => {
  const historyRequests: string[] = []
  page.on('request', request => { if (request.url().includes('/ScheduleHistoryPanel.tsx')) historyRequests.push(request.url()) })
  await page.goto('/tests/schedule-ui/index.html')
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
  expect(historyRequests).toHaveLength(0)
  await page.evaluate(() => { (window as any).__scheduleVersions = [{ version: 1, entryCount: 2, sourceDraftRevision: 1, publishedAt: '2026-10-19T00:00:00Z' }] })
  await page.getByLabel('Mở thêm công cụ').click()
  await page.getByRole('button', { name: /Lịch sử & khôi phục/ }).click()
  await expect(page.getByRole('heading', { name: 'Lịch sử đã publish' })).toBeVisible()
  expect(historyRequests).toHaveLength(1)
  await page.getByRole('button', { name: 'Tạo draft', exact: true }).click()
  const confirmation = page.getByRole('alertdialog', { name: 'Tạo draft từ v1?' })
  await expect(confirmation).toBeVisible()
  expect(await page.evaluate(() => (window as any).__scheduleCalls.filter((item: any) => item.operation === 'restore').length)).toBe(0)
  await confirmation.getByRole('button', { name: 'Tạo draft mới', exact: true }).click()
  await expect(confirmation).toBeHidden()
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
  expect(await page.evaluate(() => (window as any).__scheduleCalls.filter((item: any) => item.operation === 'restore').map((item: any) => ({ version: item.input.version, expectedDraftRevision: item.input.expectedDraftRevision })))).toEqual([{ version: 1, expectedDraftRevision: 1 }])
})
