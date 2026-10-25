import { expect, test } from '@playwright/test'

test('held first load and branch switch show unknown summary values, never zero counts', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as any).__weeklyViewCompact = true
    ;(window as any).__holdWeeklyView = true
  })
  await page.goto('/tests/schedule-ui/index.html')
  const summary = page.getByRole('region', { name: 'Tóm tắt lịch tuần' })
  const expectPending = async () => {
    await expect.poll(() => page.evaluate(() => Boolean((window as any).__releaseWeeklyView))).toBe(true)
    await expect(summary.locator('strong')).toHaveText(['—', '—', '—', '—'])
    await expect(summary).not.toContainText('0/0')
    await expect(page.locator('#schedule-tab-warnings b')).toHaveText('—')
    await expect(page.locator('.schedule-cell')).toHaveCount(0)
  }
  await expectPending()
  await page.evaluate(() => { (window as any).__holdWeeklyView = false; (window as any).__releaseWeeklyView() })
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
  await page.evaluate(() => { (window as any).__holdWeeklyView = true; delete (window as any).__releaseWeeklyView })
  await page.getByRole('combobox', { name: 'Chọn chi nhánh' }).selectOption('c')
  await expectPending()
  await page.evaluate(() => { (window as any).__holdWeeklyView = false; (window as any).__releaseWeeklyView() })
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
  await expect(summary.locator('strong').first()).not.toHaveText('—')
})

for (const mode of ['unknown', 'stale', 'exact']) {
  test(`clean ${mode} validation snapshot synchronizes the matrix with no callable fan-out`, async ({ page }) => {
    const panelRequests: string[] = []
    page.on('request', request => { if (request.url().includes('/WeeklyScheduleWarningsPanel.tsx')) panelRequests.push(request.url()) })
    await page.addInitScript((state) => {
      ;(window as any).__enableScheduleListener = true
      ;(window as any).__weeklyViewCompact = true
      ;(window as any).__initialWeeklySnapshot = 'server'
      ;(window as any).__validationMode = state
    }, mode)
    await page.goto('/tests/schedule-ui/index.html')
    await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
    await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
    await page.clock.install()
    await page.clock.runFor(1_000)
    expect(await page.evaluate(() => (window as any).__scheduleCalls || [])).toEqual([])
    expect(panelRequests).toHaveLength(0)
    await page.getByRole('tab', { name: /Cảnh báo/ }).click()
    expect(panelRequests).toHaveLength(1)
    if (mode === 'unknown') {
      await expect(page.locator('.schedule-warning-stat.is-missing .schedule-warning-stat__value')).toHaveText('—')
      await expect(page.getByText('Đang cập nhật mục tiêu tuần.')).toBeVisible()
    } else if (mode === 'stale') {
      await expect(page.locator('.schedule-warning-stat.is-missing .schedule-warning-stat__value')).toHaveText('3')
      const prior = page.locator('.schedule-warning-state')
      await expect(prior).toHaveAttribute('data-validation-draft-revision', '1')
      await expect(page.locator('.schedule-warning-student')).toHaveCount(3)
      await page.getByRole('button', { name: 'Mở lịch rảnh của Ngọc', exact: true }).click()
      const detail = page.locator('.schedule-warning-student').filter({ hasText: 'Ngọc' })
      await expect(detail).not.toContainText('0900000002')
      await expect(detail).not.toContainText('Gói 24')
      await expect(detail).toContainText('Lịch rảnh')
      await expect(page.getByRole('button', { name: /Do hợp đồng/ })).toBeEnabled()
    } else {
      await expect(page.getByRole('button', { name: /Do hợp đồng/ })).toBeEnabled()
      await expect(page.locator('.schedule-warning-state')).not.toHaveClass(/is-pending/)
    }
  })
}

for (const listenerFirst of [true, false]) {
  test(`clean draft-only acknowledgement cannot leave false syncing when ${listenerFirst ? 'listener' : 'API'} finishes first`, async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as any).__enableScheduleListener = true
      ;(window as any).__weeklyViewCompact = true
      ;(window as any).__holdWeeklyView = true
      ;(window as any).__validationMode = 'unknown'
    })
    await page.goto('/tests/schedule-ui/index.html')
    await expect.poll(() => page.evaluate(() => Boolean((window as any).__releaseWeeklyView))).toBe(true)
    const emit = () => page.evaluate(async () => {
      const { weeklyViewFixture } = await import('/tests/schedule-ui/service.ts')
      const input = (window as any).__scheduleCalls[0].input
      ;(window as any).__ack = weeklyViewFixture(input)
      ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', (window as any).__ack)
    })
    if (listenerFirst) await emit()
    await page.evaluate(() => { (window as any).__holdWeeklyView = false; (window as any).__releaseWeeklyView() })
    await expect.poll(() => page.evaluate(() => (window as any).__weeklyViewResponses)).toBe(1)
    if (!listenerFirst) await emit()
    await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
    await page.evaluate(() => {
      ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', (window as any).__ack, { fromCache: true })
      for (let i = 0; i < 4; i++) (window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', (window as any).__ack)
    })
    await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
    expect(await page.evaluate(() => (window as any).__scheduleCalls.filter((row: any) => row.operation === 'weekly-view').length)).toBe(1)
  })
}

test('legacy display requests migration once; same-version validation metadata is retained without repeated calls', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as any).__enableScheduleListener = true
    ;(window as any).__weeklyViewCompact = true
    ;(window as any).__initialWeeklySnapshot = 'server'
    ;(window as any).__weeklyViewOverride = { freshness: 'display', verification: 'draft_only' }
    ;(window as any).__holdWeeklyView = true
  })
  await page.goto('/tests/schedule-ui/index.html')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__releaseWeeklyView))).toBe(true)
  await page.evaluate(async () => {
    const { weeklyViewFixture } = await import('/tests/schedule-ui/service.ts')
    const input = (window as any).__scheduleCalls[0].input
    ;(window as any).__validationMode = 'stale'
    const ack = weeklyViewFixture(input)
    for (let i = 0; i < 4; i++) (window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', ack)
    ;(window as any).__holdWeeklyView = false
    ;(window as any).__releaseWeeklyView()
  })
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
  await page.getByRole('tab', { name: /Cảnh báo/ }).click()
  await expect(page.getByRole('region', { name: 'Phiên bản cảnh báo' })).toContainText('Draft r1')
  await expect(page.getByRole('button', { name: /Do hợp đồng/ })).toBeEnabled()
  expect(await page.evaluate(() => (window as any).__scheduleCalls.filter((row: any) => row.operation === 'weekly-view').length)).toBe(1)
})

test('actual pointer schema resolves independent hashes; dirty markers, malformed proof and draft edits never claim current validation', async ({ page }) => {
  await page.goto('/tests/schedule-ui/index.html')
  const result = await page.evaluate(async () => {
    const { weeklyViewFixture, getPtScheduleWorkspace } = await import('/tests/schedule-ui/service.ts')
    const { workspaceFromWeeklyViewSnapshot, workspaceFromDraftSnapshot, workspaceRealtimeFingerprint } = await import('/src/features/schedule/workspaceModel.ts')
    const { readValidationSnapshot, applyWeeklyValidation } = await import('/src/features/schedule/weeklyValidation.ts')
    const scope = { branchId: 'b', weekId: '2026-10-19' }
    ;(window as any).__weeklyViewCompact = true
    ;(window as any).__validationMode = 'exact'
    const raw = weeklyViewFixture(scope)
    const current = workspaceFromWeeklyViewSnapshot(await getPtScheduleWorkspace(scope), raw)
    const dirty = workspaceFromWeeklyViewSnapshot(current, { ...raw, dirty: true, dirtyGeneration: 2, validationDirty: true })
    const olderExact = workspaceFromWeeklyViewSnapshot(dirty, raw)
    const noGeneration = workspaceFromWeeklyViewSnapshot(dirty, { ...raw, dirtyGeneration: undefined })
    const edited = workspaceFromDraftSnapshot(current, { revision: current.draftRevision + 1, schedule: {} })
    const wrongBranch = readValidationSnapshot({ ...raw.validationSnapshot, branchId: 'c' }, 'b', scope.weekId, raw)
    const malformed = readValidationSnapshot({ ...current.validationSnapshot, dirtyGeneration: '1' }, 'b', scope.weekId)
    const displayPointer = readValidationSnapshot(raw.validationSnapshot, 'b', scope.weekId, { ...raw, verification: 'draft_only' })
    const incomplete = workspaceFromWeeklyViewSnapshot(current, { ...raw, validationSnapshot: { ...raw.validationSnapshot, draftRevision: 999 } })
    const legacy = { ...raw }
    delete legacy.validationSnapshot
    delete legacy.validationState
    delete legacy.validationDirty
    const invalidLegacy = applyWeeklyValidation(current, { ...legacy, coverage: { verified: true, verification: 'exact' } })
    return { hashesDiffer: raw.sourceRevision !== raw.validationSnapshot.sourceRevision, current: current.validationState, storage: current.validationSnapshot?.storage, missing: current.validationSnapshot?.coverage.missingSessions,
      dirty: dirty.validationState, olderExactRetained: olderExact === dirty && noGeneration === dirty, edited: edited.validationState, editedMode: edited.readMode, kept: edited.validationSnapshot?.coverage.missingSessions,
      rejected: [wrongBranch, malformed, displayPointer], invalidLegacy: invalidLegacy.validationState, incomplete: incomplete.validationState, fingerprintChanged: workspaceRealtimeFingerprint(current) !== workspaceRealtimeFingerprint(dirty) }
  })
  expect(result).toEqual({ hashesDiffer: true, current: 'current', storage: 'embedded', missing: 4, dirty: 'stale', olderExactRetained: true, edited: 'stale', editedMode: 'display', kept: 4, rejected: [null, null, null], invalidLegacy: 'unknown', incomplete: 'stale', fingerprintChanged: true })
})

test('invalidation immediately marks prior validation stale; new matrix does not rewrite prior missing counts', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as any).__enableScheduleListener = true
    ;(window as any).__weeklyViewCompact = true
    ;(window as any).__initialWeeklySnapshot = 'server'
    ;(window as any).__validationMode = 'exact'
  })
  await page.goto('/tests/schedule-ui/index.html')
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
  await page.evaluate(() => {
    ;(window as any).__holdWeeklyView = true
    ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', { dirty: true, dirtyGeneration: 2 })
  })
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__releaseWeeklyView))).toBe(true)
  await page.getByRole('tab', { name: /Cảnh báo/ }).click()
  await expect(page.getByRole('button', { name: /Do hợp đồng/ })).toBeEnabled()
  await expect(page.locator('.schedule-warning-state')).toHaveAttribute('data-validation-draft-revision', '1')
  await page.evaluate(async () => {
    const { weeklyViewFixture } = await import('/tests/schedule-ui/service.ts')
    ;(window as any).__validationMode = 'stale'
    const raw = weeklyViewFixture((window as any).__scheduleCalls[0].input)
    ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', { ...raw, viewRevision: 2, dirtyGeneration: 2, schedule: {} })
    ;(window as any).__holdWeeklyView = false
    ;(window as any).__releaseWeeklyView()
  })
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
  await expect(page.locator('.schedule-warning-state')).toHaveAttribute('data-validation-draft-revision', '1')
  await expect(page.locator('.schedule-warning-state')).toHaveAttribute('data-missing-sessions', '6')
  await page.getByRole('tab', { name: 'Lịch PT', exact: true }).click()
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__scheduleCalls.filter((row: any) => row.operation === 'load').length)).toBe(0)
})

for (const legacy of [false, true]) {
  test(`${legacy ? 'legacy (API generation absent)' : 'pointer'} exact evidence survives dirty listener and late older exact API until the new generation arrives`, async ({ page }) => {
    await page.addInitScript((legacy) => {
      ;(window as any).__enableScheduleListener = true
      ;(window as any).__weeklyViewCompact = true
      ;(window as any).__initialWeeklySnapshot = 'server'
      ;(window as any).__validationMode = 'exact'
      ;(window as any).__legacyValidation = legacy
      ;(window as any).__omitWeeklyResponseGeneration = legacy
    }, legacy)
    await page.goto('/tests/schedule-ui/index.html')
    await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
    expect(await page.evaluate(() => (window as any).__scheduleCalls || [])).toEqual([])
    await page.evaluate(() => {
      ;(window as any).__holdWeeklyView = true
      ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', { dirty: true, dirtyGeneration: 2 })
    })
    await expect.poll(() => page.evaluate(() => Boolean((window as any).__releaseWeeklyView))).toBe(true)
    await page.getByRole('tab', { name: /Cảnh báo/ }).click()
    const prior = page.locator('.schedule-warning-state')
    await expect(prior).toHaveAttribute('data-validation-draft-revision', '1')
    await expect(page.locator('.schedule-warning-student').filter({ hasText: 'Lan' })).toContainText('1/2 buổi')
    await page.evaluate(() => { (window as any).__holdWeeklyView = false; (window as any).__releaseWeeklyView() })
    await expect.poll(() => page.evaluate(() => (window as any).__weeklyViewResponses)).toBe(1)
    await expect(page.locator('.branch-schedule__sync')).toHaveText('Đang đồng bộ')
    await expect(prior).toHaveAttribute('data-validation-draft-revision', '1')
    await expect(page.getByRole('button', { name: /Do hợp đồng/ })).toBeEnabled()
    await page.evaluate(async () => {
      const { weeklyViewFixture } = await import('/tests/schedule-ui/service.ts')
      ;(window as any).__legacyValidation = false
      const raw = weeklyViewFixture((window as any).__scheduleCalls[0].input)
      raw.dirtyGeneration = 2
      raw.validationSnapshot.dirtyGeneration = 2
      ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', raw)
    })
    await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
    await expect(prior).not.toHaveClass(/is-pending/)
    await expect(page.getByRole('button', { name: /Do hợp đồng/ })).toBeEnabled()
  })
}
