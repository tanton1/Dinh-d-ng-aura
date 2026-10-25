import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkspaceSync, millisecondsUntilVietnamMidnight, vietnamDateKey, type WorkspaceSyncState } from '../src/utils/workspaceSync'

const state = (user = '0', policy = '0', branch = '0'): WorkspaceSyncState => ({ version: `${user}:${policy}:${branch}`, userVersion: user, policyVersion: policy, branchVersions: { branch } })
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve() }
function setup(refresh?: () => Promise<unknown>) {
  const timers = new Map<number, () => void>()
  let id = 0, calls = 0, available = true, error = false
  const engine = createWorkspaceSync({
    refresh: async () => { calls += 1; return refresh?.() },
    environment: { available: () => available, schedule: (fn) => { timers.set(++id, fn); return id }, cancel: (timer) => { timers.delete(timer as number) } },
    onError: (failed) => { error = failed },
  })
  const tick = async () => { const work = [...timers.values()]; timers.clear(); work.forEach((fn) => fn()); await flush() }
  return { engine, tick, timers, calls: () => calls, error: () => error, available: (value: boolean) => { available = value } }
}

test('unchanged or older snapshots, resume, and idle time never cause a read', async () => {
  const h = setup()
  h.engine.accept(state('0002'))
  h.engine.observe('user', '0001'); h.engine.observe('policy', '0')
  for (let minute = 0; minute < 60; minute += 1) { h.engine.resume(); await h.tick() }
  assert.equal(h.calls(), 0)
  assert.equal(h.error(), false)
})

test('bursts coalesce and a change during a read produces one trailing refresh', async () => {
  let finish!: () => void
  const h = setup(() => new Promise<void>((resolve) => { finish = resolve }))
  h.engine.accept(state())
  h.engine.observe('user', '0001'); h.engine.observe('user', '0002'); await h.tick()
  assert.equal(h.calls(), 1)
  h.engine.observe('user', '0003'); h.engine.observe('user', '0004')
  h.engine.accept(state('0002')); finish(); await flush(); await h.tick()
  assert.equal(h.calls(), 2)
  h.engine.accept(state('0004')); finish(); await flush(); await h.tick()
  assert.equal(h.calls(), 2)
})

test('hidden/offline changes wait until resume, while unchanged resumes do nothing', async () => {
  const h = setup(async () => { h.engine.accept(state('0001')) })
  h.engine.accept(state()); h.available(false); h.engine.observe('user', '0001')
  await h.tick(); assert.equal(h.calls(), 0)
  h.available(true); h.engine.resume(); await h.tick(); assert.equal(h.calls(), 1)
  h.engine.resume(); await h.tick(); assert.equal(h.calls(), 1)
})

test('failed or stale responses do not spin; explicit retry remains available', async () => {
  const h = setup(async () => { throw new Error('offline') })
  h.engine.accept(state()); h.engine.observe('user', '0001'); await h.tick()
  for (let i = 0; i < 20; i += 1) await h.tick()
  assert.equal(h.calls(), 1); assert.equal(h.error(), true)
  h.engine.retry(); await h.tick(); assert.equal(h.calls(), 2)
  h.engine.stop(); h.engine.observe('user', '0002'); h.engine.retry(); await h.tick(); assert.equal(h.calls(), 2)
})

test('Vietnam day boundary uses one local midnight alarm independent of browser timezone', () => {
  const before = Date.parse('2026-10-23T16:59:59.000Z')
  assert.equal(vietnamDateKey(before), '2026-10-23')
  assert.equal(millisecondsUntilVietnamMidnight(before), 1025)
  assert.equal(vietnamDateKey(before + 1000), '2026-10-24')
})

test('a newer revision recovers an initial read failure exactly once', async () => {
  let reject = true
  const h = setup(async () => { if (reject) throw new Error('offline'); h.engine.accept(state('0001')) })
  h.engine.observe('user', '0'); h.engine.retry(); await h.tick()
  assert.equal(h.calls(), 1)
  h.engine.observe('user', '0'); await h.tick(); assert.equal(h.calls(), 1)
  reject = false
  h.engine.observe('user', '0001'); await h.tick(); assert.equal(h.calls(), 2)
  assert.equal(h.error(), false)
  await h.tick(); assert.equal(h.calls(), 2)
})

test('draft begun during a read retains its revision and resumes once without another event', async () => {
  let finish!: () => void
  const h = setup(() => new Promise<void>(resolve => { finish = resolve }))
  h.engine.accept(state())
  h.engine.observe('user', '0001'); await h.tick()
  h.available(false)
  finish(); await flush(); await h.tick()
  assert.equal(h.calls(), 1)
  assert.equal(h.error(), false)
  h.available(true); h.engine.resume(); await h.tick()
  assert.equal(h.calls(), 2)
  h.engine.accept(state('0001')); finish(); await flush(); await h.tick()
  assert.equal(h.calls(), 2)
})
