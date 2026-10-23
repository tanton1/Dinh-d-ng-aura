import { expect, test } from '@playwright/test'

test('control join preserves legacy reads and never claims freshness between either publication order', async ({ page }) => {
  await page.goto('/tests/schedule-ui/index.html')
  const states = await page.evaluate(async () => {
    const { mergeWeeklyControl } = await import('/src/features/schedule/weeklyValidation.ts')
    const old = { sourceRevision: 'old', dirtyGeneration: 8, dirty: false, validationDirty: false, freshness: 'verified' }
    const prior = { ...old, controlSchemaVersion: 1, controlGeneration: 2 }
    const next = { ...prior, sourceRevision: 'next', dirtyGeneration: 9, controlGeneration: 3 }
    const clean = { sourceRevision: 'next', dirtyGeneration: 3, dirty: false, validationDirty: false }
    const previousState = { sourceRevision: 'old', dirtyGeneration: 2, dirty: false, validationDirty: false }
    return {
      legacy: mergeWeeklyControl(old, null, true),
      unknown: mergeWeeklyControl(old, null, false),
      missing: mergeWeeklyControl(prior, null, true),
      dirty: mergeWeeklyControl(prior, { ...previousState, dirtyGeneration: 3, dirty: true }, true),
      controlFirst: mergeWeeklyControl(prior, clean, true),
      payloadFirst: mergeWeeklyControl(next, previousState, true),
      joined: mergeWeeklyControl(next, clean, true),
    }
  })
  expect(states.legacy.dirty).toBe(false)
  expect(states.legacy.controlPending).toBe(false)
  for (const value of [states.unknown, states.missing, states.controlFirst, states.payloadFirst]) {
    expect(value.controlPending).toBe(true)
    expect(value.freshness).toBe('stale')
    expect(value.validationDirty).toBe(true)
    expect(value.dirty).toBe(false)
  }
  expect(states.dirty.dirty).toBe(true)
  expect(states.dirty.dirtyGeneration).toBe(9)
  expect(states.joined.controlPending).toBe(false)
  expect(states.joined.dirtyGeneration).toBe(9)
  expect(states.joined.validationDirty).toBe(false)
})

for (const first of ['control', 'payload']) {
  test(`state-only invalidation refreshes once; ${first}-first publication joins without another callable`, async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as any).__enableScheduleListener = true
      ;(window as any).__weeklyViewCompact = true
      ;(window as any).__initialWeeklySnapshot = 'server'
      ;(window as any).__validationMode = 'exact'
    })
    await page.goto('/tests/schedule-ui/index.html')
    await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
    await page.clock.install()
    await page.clock.pauseAt(new Date())
    await page.evaluate(async () => {
      const { weeklyViewFixture } = await import('/tests/schedule-ui/service.ts')
      const key = [...(window as any).__scheduleListeners.keys()].find((path: string) => path.startsWith('ptScheduleWeeklyViews/')) as string
      const [branchId, weekId] = key.split('/')[1].split('_')
      const raw = weeklyViewFixture({ branchId, weekId })
      ;(window as any).__controlFixture = { branchId, weekId, raw }
      ;(window as any).__holdWeeklyView = true
      ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViewStates', { schemaVersion: 1, branchId, weekId, dirty: true, validationDirty: true, dirtyGeneration: 1 })
    })
    await expect(page.locator('.branch-schedule__sync')).toHaveText('Đang đồng bộ')
    await expect.poll(() => page.evaluate(() => (window as any).__scheduleCalls.filter((row: any) => row.operation === 'weekly-view').length)).toBe(1)
    await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
    await page.evaluate((order) => {
      const { branchId, weekId, raw } = (window as any).__controlFixture
      const payload = { ...raw, sourceRevision: 'next-semantic', controlSchemaVersion: 1, controlGeneration: 1, dirtyGeneration: 2, viewRevision: 2 }
      const control = { schemaVersion: 1, branchId, weekId, sourceRevision: 'next-semantic', dirtyGeneration: 1, dirty: false, validationDirty: false }
      ;(window as any).__nextPayload = payload
      ;(window as any).__nextControl = control
      ;(window as any).__emitScheduleSnapshot(order === 'control' ? 'ptScheduleWeeklyViewStates' : 'ptScheduleWeeklyViews', order === 'control' ? control : payload)
    }, first)
    await page.clock.runFor(100)
    expect(await page.evaluate(() => (window as any).__scheduleCalls.filter((row: any) => row.operation === 'weekly-view').length)).toBe(1)
    await page.evaluate((order) => {
      ;(window as any).__emitScheduleSnapshot(order === 'control' ? 'ptScheduleWeeklyViews' : 'ptScheduleWeeklyViewStates', order === 'control' ? (window as any).__nextPayload : (window as any).__nextControl)
      ;(window as any).__releaseWeeklyView()
    }, first)
    await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
    await page.clock.runFor(10_000)
    expect(await page.evaluate(() => (window as any).__scheduleCalls.filter((row: any) => row.operation === 'weekly-view').length)).toBe(1)
  })
}

test('terminal control failure stays offline across dirty completion, manual reload and payload callbacks', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as any).__enableScheduleListener = true
    ;(window as any).__weeklyViewCompact = true
    ;(window as any).__initialWeeklySnapshot = 'server'
    ;(window as any).__validationMode = 'exact'
  })
  await page.goto('/tests/schedule-ui/index.html')
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
  await page.clock.install()
  await page.clock.pauseAt(new Date())
  await page.evaluate(async () => {
    const { weeklyViewFixture } = await import('/tests/schedule-ui/service.ts')
    const key = [...(window as any).__scheduleListeners.keys()].find((path: string) => path.startsWith('ptScheduleWeeklyViews/')) as string
    const [branchId, weekId] = key.split('/')[1].split('_')
    ;(window as any).__terminalPayload = { ...weeklyViewFixture({ branchId, weekId }), sourceRevision: 'recovered', controlSchemaVersion: 1, controlGeneration: 1, dirtyGeneration: 2, viewRevision: 2 }
    ;(window as any).__terminalControl = { schemaVersion: 1, branchId, weekId, sourceRevision: 'recovered', dirtyGeneration: 1, dirty: false, validationDirty: false }
    ;(window as any).__holdWeeklyView = true
    ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViewStates', { schemaVersion: 1, branchId, weekId, dirty: true, validationDirty: true, dirtyGeneration: 1 })
  })
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__releaseWeeklyView))).toBe(true)
  await page.evaluate(() => { (window as any).__failScheduleListener('ptScheduleWeeklyViewStates') })
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Mất kết nối')
  await page.evaluate(() => { (window as any).__releaseWeeklyView() })
  await expect.poll(() => page.evaluate(() => (window as any).__weeklyViewResponses)).toBe(1)
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Mất kết nối')
  await page.evaluate(() => { (window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', (window as any).__terminalPayload) })
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Mất kết nối')
  await page.getByLabel('Mở thêm công cụ').click()
  await page.getByRole('button', { name: /Tải lại dữ liệu/ }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__scheduleCalls.filter((row: any) => row.operation === 'weekly-view').length)).toBe(2)
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Mất kết nối')
  await page.evaluate(() => { (window as any).__releaseWeeklyView() })
  await expect.poll(() => page.evaluate(() => (window as any).__weeklyViewResponses)).toBe(2)
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Mất kết nối')
  await page.evaluate(() => {
    ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViewStates', (window as any).__terminalControl, { fromCache: true })
  })
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Mất kết nối')
  await page.clock.runFor(10_000)
  expect(await page.evaluate(() => (window as any).__scheduleCalls.filter((row: any) => row.operation === 'weekly-view').length)).toBe(2)
  await page.evaluate(() => {
    ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViewStates', (window as any).__terminalControl)
  })
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
})

test('unknown control cannot suppress bootstrap or label a cached exact matrix live', async ({ page }) => {
  await page.clock.install()
  await page.clock.pauseAt(new Date())
  await page.addInitScript(() => {
    ;(window as any).__enableScheduleListener = true
    ;(window as any).__weeklyViewCompact = true
    ;(window as any).__initialWeeklySnapshot = 'server'
    ;(window as any).__holdWeeklyControl = true
    ;(window as any).__holdWeeklyView = true
    ;(window as any).__validationMode = 'exact'
  })
  await page.goto('/tests/schedule-ui/index.html')
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Đang đồng bộ')
  await page.clock.runFor(501)
  await expect.poll(() => page.evaluate(() => (window as any).__scheduleCalls.filter((row: any) => row.operation === 'weekly-view').length)).toBe(1)
  await page.evaluate(() => { (window as any).__releaseWeeklyView() })
  await expect.poll(() => page.evaluate(() => (window as any).__weeklyViewResponses)).toBe(1)
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Đang đồng bộ')
  await page.evaluate(() => { (window as any).__emitScheduleSnapshot('ptScheduleWeeklyViewStates', null) })
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
})

for (const first of ['control', 'payload']) {
  test(`clean atomic publication delivered ${first} first makes zero callable requests`, async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as any).__enableScheduleListener = true
      ;(window as any).__weeklyViewCompact = true
      ;(window as any).__initialWeeklySnapshot = 'server'
      ;(window as any).__validationMode = 'exact'
    })
    await page.goto('/tests/schedule-ui/index.html')
    await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
    await page.clock.install()
    await page.clock.pauseAt(new Date())
    await page.evaluate(async (order) => {
      const { weeklyViewFixture } = await import('/tests/schedule-ui/service.ts')
      const key = [...(window as any).__scheduleListeners.keys()].find((path: string) => path.startsWith('ptScheduleWeeklyViews/')) as string
      const [branchId, weekId] = key.split('/')[1].split('_')
      ;(window as any).__nextPayload = { ...weeklyViewFixture({ branchId, weekId }), sourceRevision: 'next', controlSchemaVersion: 1, controlGeneration: 1, dirtyGeneration: 2, viewRevision: 2 }
      ;(window as any).__nextControl = { schemaVersion: 1, branchId, weekId, sourceRevision: 'next', dirtyGeneration: 1, dirty: false, validationDirty: false }
      ;(window as any).__emitScheduleSnapshot(order === 'control' ? 'ptScheduleWeeklyViewStates' : 'ptScheduleWeeklyViews', order === 'control' ? (window as any).__nextControl : (window as any).__nextPayload)
    }, first)
    await expect(page.locator('.branch-schedule__sync')).not.toHaveText('Trực tiếp')
    await page.clock.runFor(100)
    expect(await page.evaluate(() => (window as any).__scheduleCalls || [])).toEqual([])
    await page.evaluate((order) => {
      ;(window as any).__emitScheduleSnapshot(order === 'control' ? 'ptScheduleWeeklyViews' : 'ptScheduleWeeklyViewStates', order === 'control' ? (window as any).__nextPayload : (window as any).__nextControl)
    }, first)
    await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
    await page.clock.runFor(2_000)
    expect(await page.evaluate(() => (window as any).__scheduleCalls || [])).toEqual([])
  })
}
