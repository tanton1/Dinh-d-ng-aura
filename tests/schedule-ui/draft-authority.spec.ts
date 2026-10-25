import { expect, test } from '@playwright/test'

const assigned = { 'T3-6': [{ studentId: 'b', trainerId: 't', type: 'training', branchId: 'b', source: 'auto_v2' }] }

test('optimizer diagnostics load only with results and keep comparison and move details', async ({ page }) => {
  const diagnosticsRequests: string[] = []
  page.on('request', request => { if (request.url().includes('/ScheduleOptimizationResult.tsx')) diagnosticsRequests.push(request.url()) })
  await page.addInitScript(() => Object.assign(window, { __enableScheduleListener: true, __weeklyViewCompact: true, __initialWeeklySnapshot: 'server' }))
  await page.goto('/tests/schedule-ui/index.html')
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
  expect(diagnosticsRequests).toEqual([])
  await page.evaluate(async () => {
    const { weeklyViewFixture } = await import('/tests/schedule-ui/service.ts')
    const key = [...(window as any).__scheduleListeners.keys()].find((p: string) => p.startsWith('ptScheduleWeeklyViews/'))
    const [branchId, weekId] = key.split('/')[1].split('_')
    const view = weeklyViewFixture({ branchId, weekId })
    view.viewRevision = 2
    view.optimizationSummary = { comparison: { before: { sessions: 1, complete: 0, paired: 0 }, after: { sessions: 2, complete: 1, paired: 1 } },
      swapTrace: [{ studentId: 'a', fromSlotId: 'T2-6', toSlotId: 'T3-6', fromTrainerId: 't', toTrainerId: 't-secondary' }] }
    ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', view)
  })
  await expect(page.getByText('Trước → sau: 1 → 2 buổi · 0 → 1 học viên đủ lịch · 0 → 1 ca đôi.')).toBeVisible()
  await page.getByText('1 bước xếp/đổi chỗ gần nhất').click()
  const trace = page.locator('.branch-schedule__optimization-trace')
  await expect(trace).toContainText('Lan')
  await expect(trace).toContainText('Mai →')
  await expect(trace).toContainText('Vy')
  expect(diagnosticsRequests).toHaveLength(1)
  expect(await page.evaluate(() => (window as any).__scheduleCalls || [])).toEqual([])
})

test('optimizer result paints immediately and survives A-B-A with an older empty weekly projection', async ({ page }) => {
  await page.addInitScript((schedule) => {
    Object.assign(window, { __weeklyViewCompact: true, __holdFullWorkspace: true, __generatedSchedule: schedule,
      __weeklyViewByBranch: { b: { draft: { revision: 1 }, schedule: {} }, c: { draft: { revision: 1 }, schedule: {} } },
      __generatedUnassigned: [{ studentId: 'a', missingSessions: 1 }] })
  }, assigned)
  await page.goto('/tests/schedule-ui/index.html')
  await page.getByRole('button', { name: 'Xếp tối ưu', exact: true }).click()
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Ngọc' })).toHaveCount(1)
  await expect(page.getByLabel('Phiên bản lịch đang hiển thị')).toContainText('Draft r2')
  await expect(page.getByRole('tab', { name: 'Lịch PT', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.evaluate(() => { (window as any).__holdFullWorkspace = false; (window as any).__releaseFullWorkspace() })
  await expect(page.getByRole('button', { name: 'Xếp tối ưu', exact: true })).toBeEnabled()
  await page.getByRole('combobox', { name: 'Chọn chi nhánh' }).selectOption('c')
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Ngọc' })).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Chọn chi nhánh' }).selectOption('b')
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Ngọc' })).toHaveCount(1)
  await expect(page.getByLabel('Phiên bản lịch đang hiển thị')).toContainText('Draft r2')
  await expect(page.getByRole('tab', { name: 'Lịch PT', exact: true })).toHaveAttribute('aria-selected', 'true')
})

test('saved optimizer matrix remains cached even if reconciliation fails', async ({ page }) => {
  await page.addInitScript((schedule) => Object.assign(window, { __weeklyViewCompact: true, __failFullWorkspace: true,
    __generatedSchedule: schedule, __weeklyViewByBranch: { b: { draft: { revision: 1 }, schedule: {} }, c: { draft: { revision: 1 }, schedule: {} } } }), assigned)
  await page.goto('/tests/schedule-ui/index.html')
  await page.getByRole('button', { name: 'Xếp tối ưu', exact: true }).click()
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Ngọc' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Xếp tối ưu', exact: true })).toBeEnabled()
  await page.getByRole('combobox', { name: 'Chọn chi nhánh' }).selectOption('c')
  await page.getByRole('combobox', { name: 'Chọn chi nhánh' }).selectOption('b')
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Ngọc' })).toHaveCount(1)
})

for (const first of [true, false]) {
  test(`canonical draft ${first ? 'before' : 'after'} weekly payload is immediately visible without a full read`, async ({ page }) => {
    await page.addInitScript(() => Object.assign(window, { __enableScheduleListener: true, __weeklyViewCompact: true,
      __holdWeeklyView: true, __weeklyViewOverride: { draft: { revision: 1 }, schedule: {} } }))
    await page.goto('/tests/schedule-ui/index.html')
    await expect.poll(() => page.evaluate(() => Boolean((window as any).__releaseWeeklyView))).toBe(true)
    const emitDraft = () => page.evaluate((schedule) => {
      const key = [...(window as any).__scheduleListeners.keys()].find((path: string) => path.startsWith('ptScheduleDrafts/'))
      const [branchId, weekId] = key.split('/')[1].split('_')
      ;(window as any).__emitScheduleSnapshot('ptScheduleDrafts', { branchId, weekId, revision: 3, status: 'draft', schedule })
    }, assigned)
    if (first) await emitDraft()
    await page.evaluate(() => { (window as any).__holdWeeklyView = false; (window as any).__releaseWeeklyView() })
    if (!first) { await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp'); await emitDraft() }
    await expect(page.locator('.schedule-cell').filter({ hasText: 'Ngọc' })).toHaveCount(1)
    await expect(page.getByLabel('Phiên bản lịch đang hiển thị')).toContainText('Draft r3')
    await page.evaluate(() => (window as any).__emitScheduleSnapshot('ptScheduleDrafts', { revision: 2, schedule: {} }))
    await expect(page.locator('.schedule-cell').filter({ hasText: 'Ngọc' })).toHaveCount(1)
    expect(await page.evaluate(() => (window as any).__scheduleCalls.filter((x: any) => x.operation === 'load'))).toEqual([])
    // An intentional newer reset is different from an older empty projection.
    await page.evaluate(() => (window as any).__emitScheduleSnapshot('ptScheduleDrafts', { revision: 4, schedule: {} }))
    await expect(page.locator('.schedule-cell').filter({ hasText: 'Ngọc' })).toHaveCount(0)
  })
}

for (const first of [true, false]) {
  test(`published draft ${first ? 'before' : 'after'} weekly payload cannot roll back to unpublished at the same draft revision`, async ({ page }) => {
    await page.addInitScript(() => Object.assign(window, { __enableScheduleListener: true, __weeklyViewCompact: true,
      __holdWeeklyView: true, __weeklyViewOverride: { draft: { revision: 3, status: 'draft', publishedVersion: 0 } } }))
    await page.goto('/tests/schedule-ui/index.html')
    await expect.poll(() => page.evaluate(() => Boolean((window as any).__releaseWeeklyView))).toBe(true)
    const publish = () => page.evaluate((schedule) => {
      ;(window as any).__emitScheduleSnapshot('ptScheduleDrafts', { revision: 3, status: 'published', publishedVersion: 1, schedule })
    }, assigned)
    if (first) await publish()
    await page.evaluate(() => { (window as any).__holdWeeklyView = false; (window as any).__releaseWeeklyView() })
    await expect(page.getByLabel('Phiên bản lịch đang hiển thị')).toContainText('r3')
    if (!first) await publish()
    await page.evaluate(async () => {
      const { weeklyViewFixture } = await import('/tests/schedule-ui/service.ts')
      const input = (window as any).__scheduleCalls.find((x: any) => x.operation === 'weekly-view').input
      ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', weeklyViewFixture(input))
    })
    await expect(page.getByLabel('Phiên bản lịch đang hiển thị')).toContainText('Lịch đã publish r3')
    await expect(page.getByLabel('Phiên bản lịch đang hiển thị')).toContainText('Bản công bố v1')
    await expect(page.locator('.schedule-cell').filter({ hasText: 'Ngọc' })).toHaveCount(1)
  })
}

test('a failed draft stream does not claim live after a weekly refresh', async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, { __enableScheduleListener: true, __weeklyViewCompact: true, __initialWeeklySnapshot: 'server' }))
  await page.goto('/tests/schedule-ui/index.html')
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
  await page.evaluate(() => (window as any).__failScheduleListener('ptScheduleDrafts'))
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Mất kết nối')
  await page.getByLabel('Mở thêm công cụ').click()
  await page.getByRole('button', { name: /Tải lại dữ liệu/ }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__weeklyViewResponses)).toBe(1)
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Mất kết nối')
})

test('branch cache rejects older same-revision profile/validation projections', async ({ page }) => {
  await page.goto('/tests/schedule-ui/index.html')
  const result = await page.evaluate(async () => {
    const { createWorkspaceCache } = await import('/src/features/schedule/workspaceCache.ts')
    const cache = createWorkspaceCache()
    const current: any = { draftRevision: 3, weeklyViewRevision: 8, weeklyViewDirtyGeneration: 10 }
    cache.write('test', current)
    return [cache.write('test', { ...current, weeklyViewRevision: 7 }) === current,
      cache.write('test', { ...current, weeklyViewDirtyGeneration: 9 }) === current,
      cache.write('test', { ...current, draftRevision: 4 }).draftRevision]
  })
  expect(result).toEqual([true, true, 4])
})
