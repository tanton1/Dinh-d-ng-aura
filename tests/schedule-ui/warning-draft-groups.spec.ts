import { expect, test } from '@playwright/test'

const seed = () => Object.assign(window, { __enableScheduleListener: true, __weeklyViewCompact: true,
  __initialWeeklySnapshot: 'server', __validationMode: 'stale' })

test('pending warnings follow every canonical draft, keep group filters and never reread the roster', async ({ page }) => {
  await page.addInitScript(seed)
  await page.goto('/tests/schedule-ui/index.html')
  await page.getByRole('tab', { name: /Cảnh báo/ }).click()
  await expect(page.locator('.schedule-warning-student')).toHaveCount(3)
  await expect(page.locator('.schedule-warning-retained')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Phiên bản cảnh báo' })).toContainText('Draft r1')
  await page.evaluate(() => {
    const entry = (studentId: string) => ({ studentId, trainerId: 't', type: 'training', branchId: 'b' })
    ;(window as any).__emitScheduleSnapshot('ptScheduleDrafts', { revision: 2, schedule: {
      'T2-6': [entry('a'), entry('c')], 'T3-6': [entry('a'), entry('c')], 'T4-6': [entry('b')],
    } })
  })
  await expect(page.getByRole('region', { name: 'Phiên bản cảnh báo' })).toContainText('Draft r2')
  await expect(page.locator('.schedule-warning-student')).toHaveCount(1)
  await expect(page.locator('.schedule-warning-student')).toContainText('Ngọc')
  await expect(page.locator('.schedule-warning-student')).toContainText('1/2 buổi')
  await expect(page.locator('.schedule-warning-stat.is-missing small')).toContainText('1 buổi tạm tính · draft r2')
  const groups = page.getByRole('region', { name: 'Lọc theo lý do' })
  for (const button of await groups.getByRole('button').all()) await expect(button).toBeEnabled()
  expect((await groups.locator('strong').allTextContents()).reduce((n, text) => n + Number(text), 0)).toBe(1)
  await page.evaluate(() => {
    const entry = (studentId: string) => ({ studentId, trainerId: 't', type: 'training', branchId: 'b' })
    ;(window as any).__emitScheduleSnapshot('ptScheduleDrafts', { revision: 3, schedule: {
      'T2-6': [entry('a'), entry('c')], 'T3-6': [entry('a'), entry('c')], 'T4-6': [entry('b')], 'T5-6': [entry('b')],
    } })
  })
  await expect(page.locator('.schedule-warning-student')).toHaveCount(0)
  await expect(page.locator('.schedule-warning-stat.is-missing small')).toContainText('0 buổi tạm tính · draft r3')
  await expect(page.getByText(/Chưa có học viên thiếu buổi trong nhóm này theo draft r3/)).toBeVisible()
  await page.evaluate(() => (window as any).__emitScheduleSnapshot('ptScheduleDrafts', { revision: 2, schedule: {} }))
  await expect(page.getByRole('region', { name: 'Phiên bản cảnh báo' })).toContainText('Draft r3')
  await expect(page.locator('.schedule-warning-student')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__scheduleCalls || [])).toEqual([])
})

test('missing and cause groups never include conflict rows', async ({ page }) => {
  await page.addInitScript(seed)
  await page.goto('/tests/schedule-ui/index.html')
  await expect(page.locator('.branch-schedule__sync')).toHaveText('Trực tiếp')
  await page.evaluate(() => (window as any).__emitScheduleSnapshot('ptScheduleDrafts', { revision: 2, schedule: {
    'T2-6': [{ studentId: 'a', trainerId: 't', type: 'training' }, { studentId: 'a', trainerId: 't-secondary', type: 'training' }],
  } }))
  await page.getByRole('tab', { name: /Cảnh báo/ }).click()
  await expect(page.locator('.schedule-warning-student')).not.toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Danh sách trùng và xung đột lịch' })).toHaveCount(0)
  await page.getByRole('tab', { name: /Trùng \/ xung đột/ }).click()
  await expect(page.getByRole('region', { name: 'Danh sách trùng và xung đột lịch' })).toBeVisible()
  await expect(page.locator('.schedule-warning-student')).toHaveCount(0)
  await page.getByRole('button', { name: /Do lịch khách/ }).click()
  await expect(page.getByRole('region', { name: 'Danh sách trùng và xung đột lịch' })).toHaveCount(0)
})

test('projection uses all known targets and current cross-branch counts, without importing old candidate failures', async ({ page }) => {
  await page.goto('/tests/schedule-ui/index.html')
  const result = await page.evaluate(async () => {
    const { getPtScheduleWorkspace, weeklyViewFixture } = await import('/tests/schedule-ui/service.ts')
    const { workspaceFromWeeklyViewSnapshot, workspaceFromDraftSnapshot } = await import('/src/features/schedule/workspaceModel.ts')
    const { presentScheduleWarnings } = await import('/src/features/schedule/warningPresentation.ts')
    const input = { branchId: 'b', weekId: '2026-10-19' }
    Object.assign(window, { __weeklyViewCompact: true, __validationMode: 'stale' })
    const raw = weeklyViewFixture(input)
    raw.students = raw.students.map((s: any) => ({ ...s, contractStatus: 'active' }))
    raw.validationSnapshot.coverage.byStudent.c.missingSessions = 0
    raw.validationSnapshot.unassignedEntries = [{ studentId: 'a', primaryReasonCode: 'CONTRACT_PAUSED',
      blockerCategory: 'trainer_capacity', reasonCodes: ['CONTRACT_PAUSED', 'TRAINER_CAPACITY_EXCEEDED', 'TRAINER_ON_LEAVE'] }]
    const initial = workspaceFromWeeklyViewSnapshot(await getPtScheduleWorkspace(input), raw)
    const edited = workspaceFromDraftSnapshot(initial, { revision: 2, schedule: {}, unassignedEntries: [
      { studentId: 'c', primaryReasonCode: 'TRAINER_CAPACITY_EXCEEDED', blockerCategory: 'trainer_capacity' },
    ] })
    edited.weeklySessionCoverage = { a: { otherBranches: 2, entries: [] } } as any
    const before = presentScheduleWarnings(edited, [], true, {}).rows
    edited.students = edited.students.map(s => s.id === 'c' ? { ...s, sessionsPerWeek: 0, weeklySessionTargetOverridden: true } : s)
    const after = presentScheduleWarnings(edited, [], true, {}).rows
    const unknown = presentScheduleWarnings({ ...edited, validationSnapshot: null }, [], true, {})
    return { before: before.map(row => ({ id: row.id, missing: row.missingSessions, reasons: row.reasonCodes, cause: row.warningCause })),
      after: after.map(row => row.id), unknown: { hasTargets: unknown.hasTargets, count: unknown.rows.length },
      retainedCount: edited.validationSnapshot?.coverage.missingSessions }
  })
  expect(result.before.map(row => row.id).sort()).toEqual(['b', 'c'])
  expect(result.before.every(row => row.missing === 2 && !row.reasons.includes('CONTRACT_PAUSED') && !row.reasons.includes('TRAINER_CAPACITY_EXCEEDED'))).toBe(true)
  expect(result.before.every(row => row.cause !== 'capacity')).toBe(true)
  expect(result.after).toEqual(['b'])
  expect(result.unknown).toEqual({ hasTargets: false, count: 0 })
  expect(result.retainedCount).toBe(4)
})

test('embedded validation cannot claim current for a different draft or generation', async ({ page }) => {
  await page.goto('/tests/schedule-ui/index.html')
  const states = await page.evaluate(async () => {
    const { getPtScheduleWorkspace, weeklyViewFixture } = await import('/tests/schedule-ui/service.ts')
    const { workspaceFromWeeklyViewSnapshot } = await import('/src/features/schedule/workspaceModel.ts')
    const { applyWeeklyValidation } = await import('/src/features/schedule/weeklyValidation.ts')
    const input = { branchId: 'b', weekId: '2026-10-19' }
    Object.assign(window, { __weeklyViewCompact: true, __validationMode: 'exact' })
    const raw = weeklyViewFixture(input)
    const current = workspaceFromWeeklyViewSnapshot(await getPtScheduleWorkspace(input), raw)
    const embedded = { ...raw, validationSnapshot: current.validationSnapshot }
    return [applyWeeklyValidation({ ...current, draftRevision: 2 }, embedded, current).validationState,
      applyWeeklyValidation({ ...current, weeklyViewDirtyGeneration: 2 }, embedded, current).validationState,
      applyWeeklyValidation(current, { ...embedded, readMode: 'display' }, current).validationState,
      applyWeeklyValidation(current, embedded, current).validationState]
  })
  expect(states).toEqual(['stale', 'stale', 'stale', 'current'])
})

test('search limits never inherit a PT-capacity group from old blocker categories in either validation mode', async ({ page }) => {
  await page.goto('/tests/schedule-ui/index.html')
  const result = await page.evaluate(async () => {
    const { getPtScheduleWorkspace, weeklyViewFixture } = await import('/tests/schedule-ui/service.ts')
    const { workspaceFromWeeklyViewSnapshot } = await import('/src/features/schedule/workspaceModel.ts')
    const { presentScheduleWarnings } = await import('/src/features/schedule/warningPresentation.ts')
    const input = { branchId: 'b', weekId: '2026-10-26' }
    Object.assign(window, { __weeklyViewCompact: true, __validationMode: 'stale' })
    const raw = weeklyViewFixture(input)
    const workspace = workspaceFromWeeklyViewSnapshot(await getPtScheduleWorkspace(input), raw)
    const student = workspace.students.find(row => row.id === 'a')!
    Object.assign(student, { contractStatus: 'active', availabilityStatus: 'submitted', availableSlots: ['T2-6', 'T3-6', 'T4-6'] })
    workspace.unassignedEntries = [{ studentId: 'a', primaryReasonCode: 'SEARCH_LIMIT_REACHED',
      blockerCategory: 'trainer_capacity', reasonCodes: ['ALL_MATCHING_TRAINERS_FULL'] }] as any
    const profile = { student, missingSessions: 1, scheduledSessions: 1, scheduledEntries: [],
      crossBranchScheduledSessions: 0, primaryReasonCode: 'ALL_MATCHING_TRAINERS_FULL',
      reasonCodes: ['ALL_MATCHING_TRAINERS_FULL', 'SEARCH_LIMIT_REACHED'], warningCause: 'capacity' as const }
    const pending = presentScheduleWarnings(workspace, [], true, {}).rows.find(row => row.id === 'a')!
    const current = presentScheduleWarnings(workspace, [profile], false, {}).rows[0]
    const learner = presentScheduleWarnings(workspace, [{ ...profile, primaryReasonCode: 'STUDENT_AVAILABILITY_DAYS_INSUFFICIENT' }], false, {}).rows[0]
    workspace.unassignedEntries[0].primaryReasonCode = 'ALL_MATCHING_TRAINERS_FULL'
    const capacity = presentScheduleWarnings(workspace, [], true, {}).rows.find(row => row.id === 'a')!
    return { pending: [pending.primaryReasonCode, pending.warningCause], current: [current.primaryReasonCode, current.warningCause],
      learner: learner.warningCause, capacity: capacity.warningCause }
  })
  expect(result.pending).toEqual(['SEARCH_LIMIT_REACHED', 'system'])
  expect(result.current).toEqual(['SEARCH_LIMIT_REACHED', 'system'])
  expect(result.learner).toBe('learner')
  expect(result.capacity).toBe('capacity')
})
