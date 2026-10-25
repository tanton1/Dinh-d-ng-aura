import { expect, test } from '@playwright/test'

test('clean server week boots with zero callable reads; explicit reload still forces refresh and optimizer reconciles', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as any).__enableScheduleListener = true
    ;(window as any).__weeklyViewCompact = true
    ;(window as any).__initialWeeklySnapshot = 'server'
  })
  await page.goto('/tests/schedule-ui/index.html')
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
  await page.clock.install()
  await page.clock.runFor(1_000)
  expect(await page.evaluate(() => (window as any).__scheduleCalls || [])).toEqual([])
  await page.getByLabel('Mở thêm công cụ').click()
  await page.getByRole('button', { name: /Tải lại dữ liệu/ }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__scheduleCalls.filter((item: any) => item.operation === 'weekly-view').map((item: any) => item.input.forceRefresh))).toEqual([true])
  await page.getByRole('button', { name: 'Tối ưu tiếp', exact: true }).click()
  await page.clock.runFor(501)
  await expect.poll(() => page.evaluate(() => (window as any).__scheduleCalls.filter((item: any) => item.operation === 'load').length)).toBe(1)
})

for (const initial of ['missing', 'denied', 'dirty', 'incomplete', 'legacy', 'trainer-legacy', 'unverified', 'missing-verification', 'partial', 'malformed-exact']) {
  test(`server ${initial} view falls back immediately without waiting for the bootstrap timeout`, async ({ page }) => {
    await page.clock.install()
    await page.clock.pauseAt(new Date())
    await page.addInitScript((mode) => {
      ;(window as any).__enableScheduleListener = true
      ;(window as any).__weeklyViewCompact = true
      ;(window as any).__initialWeeklySnapshot = mode
      if (mode === 'dirty') (window as any).__weeklyViewOverride = { dirty: true, freshness: 'stale' }
      if (mode === 'incomplete') (window as any).__weeklyViewOverride = { students: undefined }
      if (mode === 'legacy') (window as any).__weeklyViewOverride = { schemaVersion: 1 }
      if (mode === 'trainer-legacy') (window as any).__weeklyViewOverride = { schemaVersion: 2 }
      if (mode === 'unverified') (window as any).__weeklyViewOverride = { verification: 'draft_only' }
      if (mode === 'missing-verification') (window as any).__weeklyViewOverride = { verification: undefined }
      if (mode === 'partial') (window as any).__weeklyViewOverride = { partial: true }
      if (mode === 'malformed-exact') (window as any).__weeklyViewOverride = { coverage: { verified: true, verification: 'exact' } }
    }, initial)
    await page.goto('/tests/schedule-ui/index.html')
    await expect.poll(() => page.evaluate(() => (window as any).__scheduleCalls?.filter((item: any) => item.operation === 'weekly-view').length || 0)).toBe(1)
    expect(await page.evaluate(() => (window as any).__scheduleCalls.filter((item: any) => item.operation === 'weekly-view').map((item: any) => item.input.forceRefresh))).toEqual([false])
  })
}

test('cached complete week paints provisionally and cannot suppress the bounded callable fallback', async ({ page }) => {
  await page.clock.install()
  await page.clock.pauseAt(new Date())
  await page.addInitScript(() => {
    ;(window as any).__enableScheduleListener = true
    ;(window as any).__weeklyViewCompact = true
    ;(window as any).__initialWeeklySnapshot = 'cache'
    ;(window as any).__holdWeeklyView = true
  })
  await page.goto('/tests/schedule-ui/index.html')
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Đang đồng bộ')
  expect(await page.evaluate(() => (window as any).__scheduleCalls || [])).toEqual([])
  await page.clock.runFor(501)
  await expect.poll(() => page.evaluate(() => (window as any).__scheduleCalls.filter((item: any) => item.operation === 'weekly-view').length)).toBe(1)
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Đang đồng bộ')
})

test('cached-to-server metadata change cancels fallback; branch changes cancel timers and ignore the old scope', async ({ page }) => {
  await page.clock.install()
  await page.clock.pauseAt(new Date())
  await page.addInitScript(() => {
    ;(window as any).__enableScheduleListener = true
    ;(window as any).__weeklyViewCompact = true
    ;(window as any).__initialWeeklySnapshot = 'cache'
  })
  await page.goto('/tests/schedule-ui/index.html')
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
  await page.evaluate(async () => {
    const { weeklyViewFixture } = await import('/tests/schedule-ui/service.ts')
    const key = [...(window as any).__scheduleListeners.keys()].find((path: any) => path.startsWith('ptScheduleWeeklyViews/')) as string
    const [branchId, weekId] = key.split('/')[1].split('_')
    ;(window as any).__firstSnapshot = weeklyViewFixture({ branchId, weekId })
    ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', (window as any).__firstSnapshot)
    ;(window as any).__initialWeeklySnapshot = undefined
  })
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
  await page.clock.runFor(501)
  expect(await page.evaluate(() => (window as any).__scheduleCalls || [])).toEqual([])
  await page.getByRole('combobox', { name: 'Chọn chi nhánh' }).selectOption('c')
  await expect(page.locator('.schedule-cell')).toHaveCount(0)
  await page.evaluate(() => { (window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', (window as any).__firstSnapshot) })
  await expect(page.locator('.schedule-cell')).toHaveCount(0)
  await page.clock.runFor(501)
  await expect.poll(() => page.evaluate(() => (window as any).__scheduleCalls.filter((item: any) => item.operation === 'weekly-view').map((item: any) => item.input.branchId))).toEqual(['c'])
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
  await page.getByRole('combobox', { name: 'Chọn chi nhánh' }).selectOption('b')
  await page.evaluate(() => { (window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', (window as any).__firstSnapshot) })
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
  await page.clock.runFor(501)
  expect(await page.evaluate(() => (window as any).__scheduleCalls.filter((item: any) => item.operation === 'weekly-view').map((item: any) => item.input.branchId))).toEqual(['c'])
})

test('late API result from the old branch cannot poison the cache while another branch is visible', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as any).__enableScheduleListener = true
    ;(window as any).__weeklyViewCompact = true
    ;(window as any).__holdWeeklyView = true
  })
  await page.goto('/tests/schedule-ui/index.html')
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__releaseWeeklyView))).toBe(true)
  await page.evaluate(() => {
    ;(window as any).__holdWeeklyView = false
    ;(window as any).__initialWeeklySnapshot = 'server'
  })
  await page.getByRole('combobox', { name: 'Chọn chi nhánh' }).selectOption('c')
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
  await page.evaluate(() => { (window as any).__releaseWeeklyView() })
  await expect.poll(() => page.evaluate(() => (window as any).__weeklyViewResponses)).toBe(1)
  await page.getByRole('combobox', { name: 'Chọn chi nhánh' }).selectOption('b')
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
  const branches = await page.evaluate(async () => {
    const { readWorkspaceCache } = await import('/src/features/schedule/workspaceCache.ts')
    const input = (window as any).__scheduleCalls[0].input
    return ['b', 'c'].map(branchId => readWorkspaceCache(`test-admin|1|admin|b|${branchId}|${input.weekId}`)?.value.branch.id)
  })
  expect(branches).toEqual(['b', 'c'])
})

test('authorization changes clear the old user cache and cancel callbacks from the old listener', async ({ page }) => {
  await page.clock.install()
  await page.clock.pauseAt(new Date())
  await page.addInitScript(() => {
    ;(window as any).__enableScheduleListener = true
    ;(window as any).__weeklyViewCompact = true
    ;(window as any).__initialWeeklySnapshot = 'server'
  })
  await page.goto('/tests/schedule-ui/index.html')
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
  await page.evaluate(async () => {
    const { weeklyViewFixture } = await import('/tests/schedule-ui/service.ts')
    const [key, handlers] = [...(window as any).__scheduleListeners.entries()].find(([path]: any) => path.startsWith('ptScheduleWeeklyViews/')) as any
    const [branchId, weekId] = key.split('/')[1].split('_')
    ;(window as any).__oldListener = [...handlers][0]
    ;(window as any).__authSnapshot = weeklyViewFixture({ branchId, weekId })
    ;(window as any).__initialWeeklySnapshot = undefined
    ;(window as any).__setScheduleAccess({ uid: 'second-admin', authzVersion: 2 })
  })
  await expect(page.locator('.schedule-cell')).toHaveCount(0)
  await page.evaluate(() => {
    const raw = (window as any).__authSnapshot
    ;(window as any).__oldListener({ exists: () => true, data: () => raw, metadata: { fromCache: false } })
  })
  await expect(page.locator('.schedule-cell')).toHaveCount(0)
  await page.evaluate(() => { (window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', (window as any).__authSnapshot) })
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
  await page.clock.runFor(501)
  expect(await page.evaluate(() => (window as any).__scheduleCalls || [])).toEqual([])
})

test('lazy Publish confirmation retains server validation and cross-branch acknowledgement', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/SchedulePublishDialog.tsx')) requests.push(request.url()) })
  await page.addInitScript(() => { (window as any).__validationWarnings = ['STUDENT_BRANCH_MISMATCH'] })
  await page.goto('/tests/schedule-ui/index.html')
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
  expect(requests).toHaveLength(0)
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Publish v1?' })
  await expect(dialog).toBeVisible()
  expect(requests).toHaveLength(1)
  expect(await page.evaluate(() => (window as any).__scheduleCalls.filter((item: any) => ['validate', 'publish'].includes(item.operation)).map((item: any) => item.operation))).toEqual(['validate'])
  await expect(dialog.getByRole('button', { name: 'Publish v1', exact: true })).toBeDisabled()
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: 'Publish v1', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(await page.evaluate(() => (window as any).__scheduleCalls.filter((item: any) => ['validate', 'publish'].includes(item.operation)).map((item: any) => item.operation))).toEqual(['validate', 'publish'])
})

test('reset confirmation code loads only on demand and cannot reset before explicit confirmation', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/ScheduleResetDialog.tsx')) requests.push(request.url()) })
  await page.goto('/tests/schedule-ui/index.html')
  await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
  expect(requests).toHaveLength(0)
  await page.getByLabel('Mở thêm công cụ').click()
  await page.getByRole('button', { name: /Đặt lại draft/ }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Xếp lại từ đầu tuần này?' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Quay lại', exact: true })).toBeFocused()
  expect(requests).toHaveLength(1)
  expect(await page.evaluate(() => (window as any).__scheduleCalls.filter((item: any) => item.operation === 'command').length)).toBe(0)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  expect(await page.evaluate(() => (window as any).__scheduleCalls.filter((item: any) => item.operation === 'command').length)).toBe(0)
})

test('compact weekly views derive pair and single counts from the displayed matrix, not absent or outdated optimizer metrics', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as any).__enableScheduleListener = true
    ;(window as any).__weeklyViewCompact = true
    ;(window as any).__weeklyViewOverride = { schedule: {
      'T2-6': [{ studentId: 'a', trainerId: 't', type: 'training' }, { studentId: 'b', trainerId: 't', type: 'training' }],
      'T2-7': [{ studentId: 'c', trainerId: 't', type: 'training' }],
      'T3-6': [{ studentId: '', trainerId: 't', type: 'off' }],
    } }
  })
  await page.goto('/tests/schedule-ui/index.html')
  await expect(page.getByRole('button', { name: '1 đôi 1 ca còn lẻ', exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const { weeklyViewFixture } = await import('/tests/schedule-ui/service.ts')
    const call = (window as any).__scheduleCalls.find((item: any) => item.operation === 'weekly-view')
    const compact = weeklyViewFixture(call.input)
    ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', { ...compact, viewRevision: 2, schedule: {}, optimizationSummary: { slotUtilization: { pairedSlots: 99, singleSlots: 99 } } })
  })
  await expect(page.getByRole('button', { name: '0 đôi 0 ca còn lẻ', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: /Cảnh báo/ }).click()
  await expect(page.getByRole('button', { name: /Do hợp đồng/ })).toBeEnabled()
})

for (const sameRevision of [false, true]) {
  test(`bootstrap paints compact listener data before the API and rejects late stale ${sameRevision ? 'same-revision generation' : 'older viewRevision'}`, async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as any).__enableScheduleListener = true
      ;(window as any).__weeklyViewCompact = true
      ;(window as any).__holdWeeklyView = true
    })
    await page.goto('/tests/schedule-ui/index.html')
    await expect.poll(() => page.evaluate(() => Boolean((window as any).__releaseWeeklyView && (window as any).__emitScheduleSnapshot))).toBe(true)
    await page.evaluate(async () => {
      const { weeklyViewFixture } = await import('/tests/schedule-ui/service.ts')
      const call = (window as any).__scheduleCalls.find((item: any) => item.operation === 'weekly-view')
      const compact = weeklyViewFixture(call.input)
      ;(window as any).__compactWeeklyFixture = compact
      // Wrong scope and metadata-only invalidation cannot paint a matrix.
      ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', { ...compact, branchId: 'other' })
      ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', { dirty: true, dirtyGeneration: 1 })
    })
    await expect(page.locator('.schedule-cell')).toHaveCount(0)
    await page.evaluate(() => { (window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', { ...(window as any).__compactWeeklyFixture, dirty: true, freshness: 'stale' }) })
    await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
    await expect(page.locator('.branch-schedule__loading')).toHaveCount(0)
    await expect(page.locator('.branch-schedule__sync')).toHaveText('Đang đồng bộ')
    await page.getByRole('tab', { name: /Cảnh báo/ }).click()
    await expect(page.getByRole('button', { name: /Do hợp đồng/ })).toBeDisabled()
    expect(await page.evaluate(() => (window as any).__scheduleCalls.map((item: any) => item.operation))).toEqual(['weekly-view'])
    await page.evaluate((same) => {
      const compact = (window as any).__compactWeeklyFixture
      ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', { ...compact, dirtyGeneration: 2, viewRevision: same ? 1 : 2, sourceRevision: same ? compact.sourceRevision : 'semantic-new', students: compact.students.map((student: any) => student.id === 'a' ? { ...student, name: 'Lan mới đồng bộ' } : student) })
    }, sameRevision)
    await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
    await expect(page.getByRole('button', { name: /Do hợp đồng/ })).toBeEnabled()
    await page.evaluate(() => {
      ;(window as any).__weeklyViewOverride = { rebuilding: true, rebuildStatus: 'busy', dirty: true, freshness: 'stale' }
      ;(window as any).__holdWeeklyView = false
      ;(window as any).__releaseWeeklyView()
    })
    await expect.poll(() => page.evaluate(() => (window as any).__weeklyViewResponses)).toBe(1)
    // The late response has completed, yet neither exact warnings nor the new
    // name may regress to the older pending response's display evidence.
    await expect(page.getByRole('combobox', { name: 'Chọn chi nhánh' })).toBeEnabled()
    await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
    await expect(page.getByRole('button', { name: /Do hợp đồng/ })).toBeEnabled()
    await page.getByRole('tab', { name: 'Lịch PT', exact: true }).click()
    await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan mới đồng bộ' })).toHaveCount(1)
    expect(await page.evaluate(() => (window as any).__scheduleCalls.map((item: any) => item.operation))).toEqual(['weekly-view'])
  })
}

for (const fromCache of [false, true, undefined]) {
  test(`first clean snapshot is authoritative only with server metadata (fromCache=${fromCache})`, async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as any).__enableScheduleListener = true
      ;(window as any).__weeklyViewCompact = true
      ;(window as any).__holdWeeklyView = true
    })
    await page.goto('/tests/schedule-ui/index.html')
    await expect.poll(() => page.evaluate(() => Boolean((window as any).__releaseWeeklyView && (window as any).__emitScheduleSnapshot))).toBe(true)
    await page.evaluate(async (cache) => {
      const { weeklyViewFixture } = await import('/tests/schedule-ui/service.ts')
      const call = (window as any).__scheduleCalls.find((item: any) => item.operation === 'weekly-view')
      const compact = weeklyViewFixture(call.input)
      ;(window as any).__emitScheduleSnapshot('ptScheduleWeeklyViews', { ...compact, viewRevision: 2, dirtyGeneration: 2 }, cache === undefined ? undefined : { fromCache: cache })
    }, fromCache)
    await expect(page.locator('.schedule-cell').filter({ hasText: 'Lan' })).toHaveCount(1)
    await expect(page.locator('.branch-schedule__loading')).toHaveCount(0)
    const expectedState = fromCache === false ? 'Trực tiếp' : 'Đang đồng bộ'
    await expect(page.locator('.branch-schedule__sync')).toHaveText(expectedState)
    await page.evaluate(() => {
      ;(window as any).__weeklyViewOverride = { rebuilding: true, rebuildStatus: 'busy', dirty: true, freshness: 'stale' }
      ;(window as any).__holdWeeklyView = false
      ;(window as any).__releaseWeeklyView()
    })
    await expect.poll(() => page.evaluate(() => (window as any).__weeklyViewResponses)).toBe(1)
    await expect(page.locator('.branch-schedule__sync')).toHaveText(expectedState)
    await page.getByRole('tab', { name: /Cảnh báo/ }).click()
    if (fromCache === false) await expect(page.getByRole('button', { name: /Do hợp đồng/ })).toBeEnabled()
    else await expect(page.getByRole('button', { name: /Do hợp đồng/ })).toBeDisabled()
    expect(await page.evaluate(() => (window as any).__scheduleCalls.map((item: any) => item.operation))).toEqual(['weekly-view'])
  })
}

test('a genuinely newer dirty generation still marks same-semantic verified evidence stale', async ({ page }) => {
  await page.goto('/tests/schedule-ui/index.html')
  const result = await page.evaluate(async () => {
    const { workspaceFromWeeklyViewSnapshot } = await import('/src/features/schedule/workspaceModel.ts')
    const { weeklyViewFixture } = await import('/tests/schedule-ui/service.ts')
    const current = weeklyViewFixture({ branchId: 'b', weekId: '2026-10-19' })
    Object.assign(current, { weeklyViewRevision: 2, weeklyViewSourceRevision: 'same', weeklyViewFreshness: 'verified', weeklyViewDirtyGeneration: 2 })
    const pending = { draft: { revision: current.draftRevision }, viewRevision: 2, sourceRevision: 'same', rebuilding: true, dirty: true, freshness: 'stale' }
    const old = workspaceFromWeeklyViewSnapshot(current, { ...pending, dirtyGeneration: 1 })
    const next = workspaceFromWeeklyViewSnapshot(current, { ...pending, dirtyGeneration: 3 })
    return { oldRetained: old === current, next: { freshness: next.weeklyViewFreshness, readMode: next.readMode, generation: next.weeklyViewDirtyGeneration } }
  })
  expect(result).toEqual({ oldRetained: true, next: { freshness: 'stale', readMode: 'display', generation: 3 } })
})

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
      schemaVersion: 3, branchId: current.branch.id, weekId: current.weekId,
      sourceRevision: 'semantic-hash-v2', viewRevision: 2, dirtyGeneration: 1, dirty: false, freshness: 'verified', verification: 'exact',
      draft: { revision: current.draftRevision + 1, status: 'draft', publishedVersion: current.publishedVersion, publishedRevision: -1 },
      schedule: current.schedule, students: current.students.map((student: any) => student.id === 'a' ? { ...student, name: 'Lan compact mới', phone: '0900000010' } : student),
      trainers: current.trainers, contracts: current.contracts, warnings: [], scheduleConfig: current.scheduleConfig,
      coverage: current.coverage, summary: current.summary, unassignedEntries: [], weeklySessionCoverage: {},
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
    ;(window as any).__weeklyViewOverride = { rebuilding: false, dirty: false, dirtyGeneration: 2, freshness: 'verified', sourceRevision: 'updated-source', viewRevision: 2 }
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
    ;(window as any).__weeklyViewOverride = { rebuilding: false, dirty: false, dirtyGeneration: 2, freshness: 'verified', viewRevision: 2, sourceRevision: 'clean' }
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
