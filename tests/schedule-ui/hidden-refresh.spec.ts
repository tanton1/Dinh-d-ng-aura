import { expect, test, type Page } from '@playwright/test'

const calls = (page: Page) => page.evaluate(() => ((window as any).__scheduleCalls || []).filter((row: any) => row.operation === 'weekly-view'))
const visibility = (page: Page, value: 'hidden' | 'visible') => page.evaluate(value => {
  ;(window as any).__scheduleVisibility = value
  document.dispatchEvent(new Event('visibilitychange'))
}, value)
const dirty = (page: Page, generations: number[]) => page.evaluate(generations => {
  for (const dirtyGeneration of generations) (window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', { dirty: true, dirtyGeneration })
}, generations)
const open = async (page: Page) => {
  await page.goto('/tests/schedule-ui/index.html')
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
  await page.clock.install()
  await page.clock.pauseAt(new Date())
  expect(await calls(page)).toEqual([])
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await page.addInitScript(() => {
    ;(window as any).__enableScheduleListener = true
    ;(window as any).__weeklyViewCompact = true
    ;(window as any).__initialWeeklySnapshot = 'server'
    ;(window as any).__scheduleVisibility = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window as any).__scheduleVisibility })
  })
})

test('hidden dirty events retain the highest generation and resume exactly once without forcing a rebuild', async ({ page }) => {
  await open(page)
  await visibility(page, 'hidden')
  await dirty(page, [2, 7, 3, 7, 4])
  await page.clock.runFor(60_000)
  expect(await calls(page)).toEqual([])
  await page.evaluate(() => { (window as any).__weeklyViewOverride = { dirtyGeneration: 7 } })
  await visibility(page, 'visible')
  await expect.poll(async () => (await calls(page)).length).toBe(1)
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
  await dirty(page, [4, 7])
  await visibility(page, 'hidden')
  await visibility(page, 'visible')
  await visibility(page, 'visible')
  await page.clock.runFor(20_000)
  expect((await calls(page)).map(row => row.input.forceRefresh)).toEqual([false])
})

test('a strictly older dirty marker cannot downgrade a clean newer generation or trigger a read', async ({ page }) => {
  await open(page)
  await visibility(page, 'hidden')
  await dirty(page, [7])
  await page.evaluate(() => { (window as any).__weeklyViewOverride = { dirtyGeneration: 7 } })
  await visibility(page, 'visible')
  await expect.poll(async () => (await calls(page)).length).toBe(1)
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
  await dirty(page, [4])
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
  await page.clock.runFor(10_000)
  expect((await calls(page)).length).toBe(1)
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
})

for (const cleanGeneration of [7, 6]) test(`first clean generation ${cleanGeneration} ${cleanGeneration === 7 ? 'satisfies' : 'retains'} hidden metadata invalidation 7 before bootstrap`, async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as any).__initialWeeklySnapshot = undefined
    ;(window as any).__scheduleVisibility = 'hidden'
  })
  await page.clock.install()
  await page.clock.pauseAt(new Date())
  await page.goto('/tests/schedule-ui/index.html')
  await expect.poll(() => page.evaluate(() => typeof (window as any).__emitScheduleSnapshot)).toBe('function')
  await dirty(page, [7])
  await expect(page.locator('.schedule-cell')).toHaveCount(0)
  expect(await calls(page)).toEqual([])
  await page.evaluate(async cleanGeneration => {
    const { weeklyViewFixture } = await import('/tests/schedule-ui/service.ts')
    const key = [...(window as any).__scheduleListeners.keys()].find((key: string) => key.startsWith('ptScheduleWeeklyViews/')) as string
    const [branchId, weekId] = key.split('/')[1].split('_')
    ;(window as any).__weeklyViewOverride = { dirtyGeneration: cleanGeneration }
    ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', weeklyViewFixture({ branchId, weekId }))
  }, cleanGeneration)
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
  await page.clock.runFor(1_000)
  expect(await calls(page)).toEqual([])
  await page.evaluate(() => { (window as any).__weeklyViewOverride = { dirtyGeneration: 7 } })
  await visibility(page, 'visible')
  await page.clock.runFor(10_000)
  expect((await calls(page)).map(row => row.input.forceRefresh)).toEqual(cleanGeneration === 7 ? [] : [false])
})

test('a hidden retry timer retains intent and the two-attempt budget across repeated resumes', async ({ page }) => {
  await open(page)
  await page.evaluate(() => { (window as any).__weeklyViewError = 'CALLABLE_UNAVAILABLE' })
  await dirty(page, [2])
  await expect.poll(async () => (await calls(page)).length).toBe(1)
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Mất kết nối')
  await visibility(page, 'hidden')
  await page.clock.runFor(10_000)
  expect((await calls(page)).length).toBe(1)
  await visibility(page, 'visible')
  await expect.poll(async () => (await calls(page)).length).toBe(2)
  await page.clock.runFor(1)
  await visibility(page, 'hidden')
  await page.clock.runFor(10_000)
  expect((await calls(page)).length).toBe(2)
  await visibility(page, 'visible')
  await expect.poll(async () => (await calls(page)).length).toBe(3)
  await visibility(page, 'hidden')
  await visibility(page, 'visible')
  await page.clock.runFor(60_000)
  expect((await calls(page)).length).toBe(3)
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
})

test('newer generations received while an in-flight read becomes hidden wait for one visible refresh', async ({ page }) => {
  await open(page)
  await page.evaluate(() => { (window as any).__holdWeeklyView = true })
  await dirty(page, [2])
  await expect.poll(async () => (await calls(page)).length).toBe(1)
  await visibility(page, 'hidden')
  await dirty(page, [5, 8, 3])
  await page.evaluate(() => {
    ;(window as any).__holdWeeklyView = false
    ;(window as any).__releaseWeeklyView()
  })
  await expect.poll(() => page.evaluate(() => (window as any).__weeklyViewResponses)).toBe(1)
  await page.clock.runFor(20_000)
  expect((await calls(page)).length).toBe(1)
  await page.evaluate(() => { (window as any).__weeklyViewOverride = { dirtyGeneration: 8 } })
  await visibility(page, 'visible')
  await expect.poll(async () => (await calls(page)).length).toBe(2)
  await dirty(page, [8])
  await page.clock.runFor(20_000)
  expect((await calls(page)).length).toBe(2)
})

test('an in-flight busy result received while hidden retains a retry without starting a timer read', async ({ page }) => {
  await open(page)
  await page.evaluate(() => {
    ;(window as any).__holdWeeklyView = true
    ;(window as any).__weeklyViewOverride = { dirty: true, dirtyGeneration: 2, freshness: 'stale', rebuilding: true }
  })
  await dirty(page, [2])
  await expect.poll(async () => (await calls(page)).length).toBe(1)
  await visibility(page, 'hidden')
  await page.evaluate(() => { (window as any).__holdWeeklyView = false; (window as any).__releaseWeeklyView() })
  await expect.poll(() => page.evaluate(() => (window as any).__weeklyViewResponses)).toBe(1)
  await page.clock.runFor(30_000)
  expect((await calls(page)).length).toBe(1)
  await visibility(page, 'visible')
  await expect.poll(async () => (await calls(page)).length).toBe(2)
  await page.clock.runFor(5_001)
  await expect.poll(async () => (await calls(page)).length).toBe(3)
  await page.clock.runFor(60_000)
  expect((await calls(page)).length).toBe(3)
})

test('clean server publication while hidden cancels the pending retry before resume', async ({ page }) => {
  await open(page)
  await page.evaluate(() => { (window as any).__weeklyViewOverride = { dirty: true, dirtyGeneration: 2, freshness: 'stale' } })
  await dirty(page, [2])
  await expect.poll(async () => (await calls(page)).length).toBe(1)
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Đang đồng bộ')
  await visibility(page, 'hidden')
  await page.evaluate(async () => {
    const { weeklyViewFixture } = await import('/tests/schedule-ui/service.ts')
    const input = (window as any).__scheduleCalls[0].input
    ;(window as any).__weeklyViewOverride = { dirtyGeneration: 2 }
    ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', weeklyViewFixture(input))
  })
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
  await visibility(page, 'visible')
  await page.clock.runFor(30_000)
  expect((await calls(page)).length).toBe(1)
})

for (const scope of ['branch', 'week', 'session', 'authorization']) {
  test(`hidden pending work is retired when the ${scope} scope changes`, async ({ page }) => {
    await open(page)
    await visibility(page, 'hidden')
    await dirty(page, [9])
    if (scope === 'branch') await page.getByRole('combobox', { name: 'Chọn chi nhánh' }).selectOption('c')
    else if (scope === 'week') await page.getByRole('button', { name: 'Tuần sau', exact: true }).click()
    else await page.evaluate(scope => (window as any).__setScheduleAccess(scope === 'session' ? { uid: 'other-admin' } : { authzVersion: 2 }), scope)
    await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
    await visibility(page, 'visible')
    await page.clock.runFor(20_000)
    expect(await calls(page)).toEqual([])
  })
}

test('unmount clears the visibility callback and queued retry without a late read', async ({ page }) => {
  await open(page)
  await page.evaluate(() => { (window as any).__weeklyViewError = 'CALLABLE_UNAVAILABLE' })
  await dirty(page, [2])
  await expect.poll(async () => (await calls(page)).length).toBe(1)
  await visibility(page, 'hidden')
  await page.evaluate(() => { (window as any).__unmountSchedule() })
  await visibility(page, 'visible')
  await page.clock.runFor(30_000)
  expect((await calls(page)).length).toBe(1)
  await expect(page.locator('.branch-schedule')).toHaveCount(0)
})

test('a retired in-flight request cannot enqueue a retry in the new session', async ({ page }) => {
  await open(page)
  await page.evaluate(() => { (window as any).__holdWeeklyView = true })
  await dirty(page, [2])
  await expect.poll(async () => (await calls(page)).length).toBe(1)
  await visibility(page, 'hidden')
  await dirty(page, [3])
  await page.evaluate(() => { (window as any).__setScheduleAccess({ uid: 'next-admin', authzVersion: 2 }) })
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
  await page.evaluate(() => {
    ;(window as any).__weeklyViewOverride = { dirty: true, dirtyGeneration: 3, freshness: 'stale' }
    ;(window as any).__holdWeeklyView = false
    ;(window as any).__releaseWeeklyView()
  })
  await expect.poll(() => page.evaluate(() => (window as any).__weeklyViewResponses)).toBe(1)
  await visibility(page, 'visible')
  await page.clock.runFor(30_000)
  expect((await calls(page)).length).toBe(1)
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
})

test('a terminal callable denial does not become retryable after hiding and resuming', async ({ page }) => {
  await open(page)
  await page.evaluate(() => { (window as any).__weeklyViewError = 'CALLABLE_PERMISSION_DENIED' })
  await dirty(page, [2])
  await expect.poll(async () => (await calls(page)).length).toBe(1)
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Mất kết nối')
  await visibility(page, 'hidden')
  await visibility(page, 'visible')
  await page.clock.runFor(30_000)
  expect((await calls(page)).length).toBe(1)
})

test('terminal control denial prevents deferred refresh on resume', async ({ page }) => {
  await open(page)
  await visibility(page, 'hidden')
  await dirty(page, [2])
  await page.evaluate(() => { (window as any).__failScheduleListener('ptScheduleWeeklyViewStates') })
  // Existing authorization recovery may perform its one bootstrap point read.
  await page.clock.runFor(1)
  const beforeResume = (await calls(page)).length
  await visibility(page, 'visible')
  await page.clock.runFor(20_000)
  expect((await calls(page)).length).toBe(beforeResume)
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Mất kết nối')
})

test('hidden visibility does not block manual reload or Publish confirmation', async ({ page }) => {
  await open(page)
  await visibility(page, 'hidden')
  await page.getByLabel('Mở thêm công cụ').click()
  await page.getByRole('button', { name: /Tải lại dữ liệu/ }).click()
  await expect.poll(async () => (await calls(page)).length).toBe(1)
  expect((await calls(page))[0].input.forceRefresh).toBe(true)
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Publish v1?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Publish v1', exact: true }).click()
  await page.clock.runFor(500)
  await expect(dialog).toBeHidden()
  const operations = await page.evaluate(() => (window as any).__scheduleCalls.map((row: any) => row.operation))
  expect(operations).toContain('validate')
  expect(operations).toContain('publish')
})

test('hidden visibility retains the explicit confirmation and writes for a manual draft command', async ({ page }) => {
  await open(page)
  await visibility(page, 'hidden')
  await page.getByLabel('Mở thêm công cụ').click()
  await page.getByRole('button', { name: /Đặt lại draft/ }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Xếp lại từ đầu tuần này?' })
  await expect(dialog).toBeVisible()
  expect(await page.evaluate(() => ((window as any).__scheduleCalls || []).filter((row: any) => row.operation === 'command'))).toEqual([])
  await dialog.getByRole('button', { name: 'Đặt lại draft', exact: true }).click()
  await page.clock.runFor(500)
  await expect(dialog).toBeHidden()
  const commands = await page.evaluate(() => (window as any).__scheduleCalls.filter((row: any) => row.operation === 'command'))
  expect(commands).toHaveLength(1)
  expect(commands[0].input).toMatchObject({ command: 'reset_draft', branchId: 'b', expectedDraftRevision: 1, payload: {} })
  await page.getByRole('tab', { name: 'Lịch PT', exact: true }).click()
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(0)
})
