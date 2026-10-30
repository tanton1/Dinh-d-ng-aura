import { expect, test, type Page } from '@playwright/test'

async function active(page: Page, path = 'branches') {
  return page.evaluate(path => window.__legacy.listeners.findLastIndex(item => item.active && item.path === path), path)
}
async function count(page: Page) { return page.evaluate(() => window.__legacy.listeners.length) }
async function open(page: Page) {
  await page.goto('/tests/legacy-read-scope-ui/index.html')
  await expect.poll(() => page.evaluate(() => window.__legacy.listeners.filter(item => item.active).length)).toBe(1)
  await expect.poll(() => page.evaluate(() => window.__legacy.snapshot.sync.status)).toBe('loading')
  return active(page)
}
async function seed(page: Page, index: number, name = 'Old branch') {
  await page.evaluate(({ index, name }) => window.__legacy.emit(index, name), { index, name })
  await expect.poll(() => page.evaluate(() => window.__legacy.snapshot.branches)).toEqual([name])
  await expect.poll(() => page.evaluate(() => window.__legacy.snapshot.sync.status)).toBe('ready')
}
async function replacement(page: Page, old: number) {
  await expect.poll(() => page.evaluate(index => window.__legacy.listeners[index].active, old)).toBe(false)
  await expect.poll(() => active(page)).toBeGreaterThan(old)
  return active(page)
}
async function noOldData(page: Page, historyStart: number) {
  await expect.poll(() => page.evaluate(() => window.__legacy.snapshot.branches)).toEqual([])
  expect(await page.evaluate(start => window.__legacy.renders.slice(start).map(item => item.branches), historyStart)).not.toContainEqual(['Old branch'])
}
async function lateDelivery(page: Page, old: number) {
  await page.evaluate(index => { window.__legacy.emit(index, 'Late old branch'); window.__legacy.fail(index) }, old)
  await expect.poll(() => page.evaluate(() => window.__legacy.snapshot.branches)).not.toContain('Late old branch')
}
async function freeze(page: Page) {
  const time = new Date('2026-10-30T05:00:00Z')
  await page.clock.install({ time })
  await page.clock.pauseAt(time)
}

test('changing admin owner replaces same-route listeners and masks old data on every committed render', async ({ page }) => {
  const old = await open(page)
  await seed(page, old)
  const start = await page.evaluate(() => window.__legacy.renders.length)
  await page.evaluate(() => window.__legacy.owner('admin-b'))
  const next = await replacement(page, old)
  await noOldData(page, start)
  await lateDelivery(page, old)
  await seed(page, next, 'New branch')
})

test('a new Firebase owner object with the same UID starts a fresh data scope', async ({ page }) => {
  const old = await open(page)
  await seed(page, old)
  const start = await page.evaluate(() => window.__legacy.renders.length)
  await page.evaluate(() => window.__legacy.owner('admin-a', false))
  const next = await replacement(page, old)
  await noOldData(page, start)
  await lateDelivery(page, old)
  await seed(page, next, 'New session branch')
})

test('actual Firebase owner changing before AuthContext hydration blocks queued callbacks and stale refresh', async ({ page }) => {
  await freeze(page)
  const old = await open(page)
  await seed(page, old)
  const before = await count(page)
  const start = await page.evaluate(() => window.__legacy.renders.length)
  await page.evaluate(index => {
    window.__legacy.saveRefresh()
    window.__legacy.owner('admin-b', false)
    // Same JavaScript task, before React has rendered the new owner.
    window.__legacy.emit(index, 'Immediate stale branch')
    window.__legacy.fail(index)
    window.__legacy.savedRefresh()
  }, old)
  await expect.poll(() => page.evaluate(() => window.__legacy.listeners.filter(item => item.active).length)).toBe(0)
  await noOldData(page, start)
  await page.clock.runFor(20_000)
  expect(await count(page)).toBe(before)
  expect(await page.evaluate(start => window.__legacy.renders.slice(start).some(item => item.branches.includes('Immediate stale branch')), start)).toBe(false)
  expect(await page.evaluate(() => window.__legacy.snapshot.sync.status)).toBe('loading')
  await page.evaluate(() => window.__legacy.context('admin-b'))
  const next = await replacement(page, old)
  await seed(page, next, 'Hydrated branch')
})

test('signing out clears visible data and old callbacks cannot restart reads', async ({ page }) => {
  await freeze(page)
  const old = await open(page)
  await seed(page, old)
  await page.evaluate(() => window.__legacy.owner(null))
  await expect.poll(() => page.evaluate(() => window.__legacy.listeners.filter(item => item.active).length)).toBe(0)
  await expect.poll(() => page.evaluate(() => window.__legacy.snapshot.sync.status)).toBe('idle')
  const before = await count(page)
  await lateDelivery(page, old)
  await page.clock.runFor(20_000)
  expect(await count(page)).toBe(before)
  expect(await page.evaluate(() => window.__legacy.snapshot.branches)).toEqual([])
})

test('authzReady=false immediately masks data, closes reads and defers fresh listeners until ready', async ({ page }) => {
  const old = await open(page)
  await seed(page, old)
  const start = await page.evaluate(() => window.__legacy.renders.length)
  await page.evaluate(() => window.__legacy.ready(false))
  await expect.poll(() => page.evaluate(() => window.__legacy.listeners.filter(item => item.active).length)).toBe(0)
  await noOldData(page, start)
  expect(await page.evaluate(() => window.__legacy.snapshot.sync.status)).toBe('loading')
  await lateDelivery(page, old)
  await page.evaluate(() => window.__legacy.ready(true))
  const next = await replacement(page, old)
  expect(await page.evaluate(() => window.__legacy.snapshot.branches)).toEqual([])
  await seed(page, next, 'Reauthorized branch')
})

for (const [name, patch] of [
  ['authorization revision', { authzVersion: 2 }],
  ['branch scope', { branchIds: ['b'] }],
] as const) {
  test(`changing ${name} clears previous data and replaces listeners`, async ({ page }) => {
    const old = await open(page)
    await seed(page, old)
    const start = await page.evaluate(() => window.__legacy.renders.length)
    await page.evaluate(patch => window.__legacy.access(patch), patch)
    const next = await replacement(page, old)
    await noOldData(page, start)
    await lateDelivery(page, old)
    await seed(page, next, 'New scope branch')
  })
}

test('mismatched access-context UID cannot reuse admin session data', async ({ page }) => {
  const old = await open(page)
  await seed(page, old)
  await page.evaluate(() => window.__legacy.access({ uid: 'different-admin' }))
  await expect.poll(() => page.evaluate(() => window.__legacy.listeners.filter(item => item.active).length)).toBe(0)
  await expect.poll(() => page.evaluate(() => window.__legacy.snapshot.sync.status)).toBe('forbidden')
  expect(await page.evaluate(() => window.__legacy.snapshot.branches)).toEqual([])
  await lateDelivery(page, old)
})

test('equivalent profile snapshots and reordered access sets preserve current listeners and data', async ({ page }) => {
  const initial = await open(page)
  await page.evaluate(() => window.__legacy.access({ branchIds: ['a', 'b'], positions: ['coach', 'manager'], capabilities: ['system.manage', 'reports.read'] }))
  const current = await replacement(page, initial)
  await seed(page, current)
  const before = await count(page)
  for (let i = 0; i < 3; i += 1) {
    const rendered = await page.evaluate(() => window.__legacy.renders.length)
    await page.evaluate(() => { window.__legacy.rerender(); window.__legacy.forceProviderRender() })
    await expect.poll(() => page.evaluate(() => window.__legacy.renders.length)).toBeGreaterThan(rendered)
  }
  await page.evaluate(() => window.__legacy.access({ branchIds: ['b', 'a'], positions: ['manager', 'coach'], capabilities: ['reports.read', 'system.manage'] }))
  expect(await count(page)).toBe(before)
  expect(await active(page)).toBe(current)
  expect(await page.evaluate(() => window.__legacy.snapshot.branches)).toEqual(['Old branch'])
})

test('same-scope manual retry retains current data but ignores the retired listener', async ({ page }) => {
  await freeze(page)
  const old = await open(page)
  await seed(page, old)
  await page.evaluate(() => window.__legacy.refresh())
  const next = await replacement(page, old)
  expect(await page.evaluate(() => window.__legacy.snapshot.branches)).toEqual(['Old branch'])
  expect(await page.evaluate(() => window.__legacy.snapshot.sync.status)).toBe('loading')
  const before = await count(page)
  await lateDelivery(page, old)
  await page.clock.runFor(2_000)
  expect(await count(page)).toBe(before)
  expect(await page.evaluate(() => window.__legacy.snapshot.branches)).toEqual(['Old branch'])
  await seed(page, next, 'Refreshed branch')
})

test('manual retry cancels an already-scheduled automatic retry', async ({ page }) => {
  await freeze(page)
  const old = await open(page)
  await seed(page, old)
  await page.evaluate(index => window.__legacy.fail(index), old)
  await expect.poll(() => page.evaluate(() => window.__legacy.snapshot.sync.status)).toBe('degraded')
  await page.evaluate(() => window.__legacy.refresh())
  const next = await replacement(page, old)
  const before = await count(page)
  await page.clock.runFor(2_000)
  expect(await count(page)).toBe(before)
  await seed(page, next, 'Manual branch')
})

test('route departure cancels scheduled retry and ignores late snapshots, errors and initial timeout', async ({ page }) => {
  await freeze(page)
  const old = await open(page)
  await seed(page, old)
  await page.evaluate(index => window.__legacy.fail(index), old)
  await expect.poll(() => page.evaluate(() => window.__legacy.snapshot.sync.status)).toBe('degraded')
  await page.evaluate(() => { window.__legacy.saveRefresh(); window.__legacy.route('admin-courses') })
  await expect.poll(() => page.evaluate(() => window.__legacy.listeners.filter(item => item.active).length)).toBe(0)
  await expect.poll(() => page.evaluate(() => window.__legacy.snapshot.sync.status)).toBe('idle')
  const before = await count(page)
  await lateDelivery(page, old)
  await page.evaluate(() => window.__legacy.savedRefresh())
  await page.clock.runFor(20_000)
  expect(await count(page)).toBe(before)
  expect(await page.evaluate(() => window.__legacy.snapshot.branches)).toEqual([])
  expect(await page.evaluate(() => window.__legacy.snapshot.sync.status)).toBe('idle')
})

test('changing to another legacy route clears old scope even after a manual retry', async ({ page }) => {
  const old = await open(page)
  await seed(page, old)
  await page.evaluate(() => window.__legacy.refresh())
  const retry = await replacement(page, old)
  expect(await page.evaluate(() => window.__legacy.snapshot.branches)).toEqual(['Old branch'])
  await page.evaluate(() => window.__legacy.route('admin-payroll'))
  const branch = await replacement(page, retry)
  await expect.poll(() => page.evaluate(() => window.__legacy.listeners.filter(item => item.active).map(item => item.path).sort())).toEqual(['branches', 'trainers'])
  expect(await page.evaluate(() => window.__legacy.snapshot.branches)).toEqual([])
  await lateDelivery(page, retry)
  await page.evaluate(index => window.__legacy.emit(index, 'Payroll branch'), branch)
  const trainer = await active(page, 'trainers')
  await page.evaluate(index => window.__legacy.emit(index, 'Payroll trainer'), trainer)
  await expect.poll(() => page.evaluate(() => window.__legacy.snapshot.sync.status)).toBe('ready')
  expect(await page.evaluate(() => window.__legacy.snapshot.branches)).toEqual(['Payroll branch'])
})

test('two automatic retries maximum per scope; a new owner gets a fresh retry budget', async ({ page }) => {
  await freeze(page)
  let current = await open(page)
  await seed(page, current)
  for (const delay of [600, 1200]) {
    const old = current
    await page.evaluate(index => window.__legacy.fail(index), old)
    await page.clock.runFor(delay)
    current = await replacement(page, old)
    expect(await page.evaluate(() => window.__legacy.snapshot.branches)).toEqual(['Old branch'])
  }
  await page.evaluate(index => window.__legacy.fail(index), current)
  await expect.poll(() => page.evaluate(() => window.__legacy.snapshot.sync.status)).toBe('error')
  const exhausted = await count(page)
  await page.clock.runFor(20_000)
  expect(await count(page)).toBe(exhausted)
  await page.evaluate(() => window.__legacy.owner('admin-b'))
  let next = await replacement(page, current)
  expect(await page.evaluate(() => window.__legacy.snapshot.branches)).toEqual([])
  for (const delay of [600, 1200]) {
    const old = next
    await page.evaluate(index => window.__legacy.fail(index), old)
    await page.clock.runFor(delay)
    next = await replacement(page, old)
  }
  await page.evaluate(index => window.__legacy.fail(index), next)
  const nextExhausted = await count(page)
  await page.clock.runFor(20_000)
  expect(await count(page)).toBe(nextExhausted)
})

test('owner change cancels pending retry without spending the new owner budget', async ({ page }) => {
  await freeze(page)
  const old = await open(page)
  await seed(page, old)
  await page.evaluate(index => window.__legacy.fail(index), old)
  await page.evaluate(() => window.__legacy.owner('admin-b'))
  const next = await replacement(page, old)
  const before = await count(page)
  await lateDelivery(page, old)
  await page.clock.runFor(2_000)
  expect(await count(page)).toBe(before)
  await page.evaluate(index => window.__legacy.fail(index), next)
  await page.clock.runFor(600)
  await replacement(page, next)
})

test('valid empty snapshot becomes ready, while no initial snapshot remains unknown and retries', async ({ page }) => {
  await freeze(page)
  const old = await open(page)
  expect(await page.evaluate(() => window.__legacy.snapshot.branches)).toEqual([])
  expect(await page.evaluate(() => window.__legacy.snapshot.sync.status)).toBe('loading')
  await page.evaluate(index => window.__legacy.empty(index), old)
  await expect.poll(() => page.evaluate(() => window.__legacy.snapshot.sync.status)).toBe('ready')
  await page.clock.runFor(20_000)
  expect(await active(page)).toBe(old)
  await page.evaluate(() => window.__legacy.refresh())
  const missing = await replacement(page, old)
  await page.clock.runFor(12_000)
  await expect.poll(() => page.evaluate(() => window.__legacy.snapshot.sync.status)).toBe('error')
  await page.clock.runFor(600)
  await replacement(page, missing)
})

test('permission-denied never auto retries and manual retry still works', async ({ page }) => {
  await freeze(page)
  const old = await open(page)
  await page.evaluate(index => window.__legacy.fail(index, 'permission-denied'), old)
  await expect.poll(() => page.evaluate(() => window.__legacy.snapshot.sync.status)).toBe('error')
  const before = await count(page)
  await page.clock.runFor(30_000)
  expect(await count(page)).toBe(before)
  await page.evaluate(() => window.__legacy.refresh())
  const next = await replacement(page, old)
  await seed(page, next, 'Recovered branch')
})

test('masked empty collections retain stable references without consumer effect loops', async ({ page }) => {
  const old = await open(page)
  await seed(page, old)
  await page.evaluate(() => window.__legacy.ready(false))
  await expect.poll(() => page.evaluate(() => window.__legacy.listeners.filter(item => item.active).length)).toBe(0)
  const baseline = await page.evaluate(() => ({ references: window.__legacy.snapshot.references, effects: window.__legacy.effectRuns }))
  for (let i = 0; i < 4; i += 1) {
    const rendered = await page.evaluate(() => window.__legacy.renders.length)
    await page.evaluate(() => { window.__legacy.rerender(); window.__legacy.forceProviderRender() })
    await expect.poll(() => page.evaluate(() => window.__legacy.renders.length)).toBeGreaterThan(rendered)
    expect(await page.evaluate(() => window.__legacy.snapshot.references)).toEqual(baseline.references)
  }
  expect(await page.evaluate(() => window.__legacy.effectRuns)).toBe(baseline.effects)
  expect(baseline.effects).toBeLessThan(15)
  expect(await page.evaluate(() => window.__legacy.snapshot.branches)).toEqual([])
})

test('all seven roster sources reject queued callbacks after moving to a route with no legacy reads', async ({ page }) => {
  await freeze(page)
  const initial = await open(page)
  await page.evaluate(() => window.__legacy.route('admin-pt-students'))
  await replacement(page, initial)
  await expect.poll(() => page.evaluate(() => window.__legacy.listeners.filter(item => item.active).length)).toBe(7)
  const old = await page.evaluate(() => window.__legacy.listeners.flatMap((item, index) => item.active ? [index] : []))
  await page.evaluate(indices => indices.forEach(index => window.__legacy.emit(index, `Old ${window.__legacy.listeners[index].path}`)), old)
  await expect.poll(() => page.evaluate(() => window.__legacy.snapshot.sync.status)).toBe('ready')
  expect(await page.evaluate(() => window.__legacy.snapshot.rows.length)).toBe(7)
  await page.evaluate(() => window.__legacy.route('admin-courses'))
  await expect.poll(() => page.evaluate(() => window.__legacy.listeners.filter(item => item.active).length)).toBe(0)
  await expect.poll(() => page.evaluate(() => window.__legacy.snapshot.rows)).toEqual([])
  const before = await count(page)
  await page.evaluate(indices => indices.forEach(index => {
    window.__legacy.emit(index, `Late ${window.__legacy.listeners[index].path}`)
    window.__legacy.fail(index)
  }), old)
  await page.clock.runFor(20_000)
  expect(await count(page)).toBe(before)
  expect(await page.evaluate(() => window.__legacy.snapshot.rows)).toEqual([])
  expect(await page.evaluate(() => window.__legacy.snapshot.sync.status)).toBe('idle')
})

test('document snapshots and multi-source retry timers are scoped to the current owner', async ({ page }) => {
  await freeze(page)
  const initial = await open(page)
  await page.evaluate(() => window.__legacy.route('admin-hr'))
  const branch = await replacement(page, initial)
  const config = await active(page, 'settings/scheduleConfig')
  expect(config).toBeGreaterThan(initial)
  await page.evaluate(({ branch, config }) => {
    window.__legacy.emit(branch, 'Old branch')
    window.__legacy.config(config, 7)
  }, { branch, config })
  await expect.poll(() => page.evaluate(() => window.__legacy.snapshot.sync.status)).toBe('ready')
  expect(await page.evaluate(() => window.__legacy.snapshot.configRevision)).toBe(7)
  // Multiple failing sources schedule only one reconnect for this scope.
  const beforeRetry = await count(page)
  await page.evaluate(({ branch, config }) => {
    window.__legacy.fail(branch)
    window.__legacy.fail(config)
  }, { branch, config })
  await page.clock.runFor(600)
  const retryBranch = await replacement(page, branch)
  expect(await count(page)).toBe(beforeRetry + 2)
  expect(await page.evaluate(() => window.__legacy.snapshot.configRevision)).toBe(7)
  await page.evaluate(() => window.__legacy.owner('admin-b'))
  const nextBranch = await replacement(page, retryBranch)
  const nextConfig = await active(page, 'settings/scheduleConfig')
  await expect.poll(() => page.evaluate(() => window.__legacy.snapshot.configRevision)).toBeNull()
  const beforeLate = await count(page)
  await page.evaluate(({ branch, config }) => {
    window.__legacy.emit(branch, 'Late branch')
    window.__legacy.config(config, 99)
    window.__legacy.fail(config)
  }, { branch, config })
  await page.clock.runFor(2_000)
  expect(await count(page)).toBe(beforeLate)
  expect(await page.evaluate(() => window.__legacy.snapshot.configRevision)).toBeNull()
  await page.evaluate(({ branch, config }) => {
    window.__legacy.emit(branch, 'New owner branch')
    window.__legacy.config(config, 8)
  }, { branch: nextBranch, config: nextConfig })
  await expect.poll(() => page.evaluate(() => window.__legacy.snapshot.sync.status)).toBe('ready')
  expect(await page.evaluate(() => window.__legacy.snapshot.configRevision)).toBe(8)
})
