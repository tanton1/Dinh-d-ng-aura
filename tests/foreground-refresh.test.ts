import assert from 'node:assert/strict'
import test from 'node:test'
import { createForegroundRefresh } from '../src/utils/foregroundRefresh'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(yes => { resolve = yes })
  return { promise, resolve }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

test('hidden/offline ticks perform no work, and simultaneous resume/timer calls share one read', async () => {
  let available = false, calls = 0
  const gate = deferred()
  const controller = createForegroundRefresh(async () => { calls++; await gate.promise }, () => available)
  // Ten minutes of the most frequent 15-second poll.
  for (let index = 0; index < 40; index++) await controller.refresh()
  assert.equal(calls, 0)
  available = true
  const request = controller.refresh()
  await flush()
  for (let index = 0; index < 40; index++) assert.equal(controller.refresh(), request)
  assert.equal(calls, 1)
  gate.resolve(); await request
  assert.equal(calls, 1)
})

test('mutation during a read rejects its stale response and queues just one fresh read', async () => {
  const gate = deferred()
  let calls = 0, active = 0, maximumActive = 0
  const accepted: number[] = []
  const controller = createForegroundRefresh(async (_background, current) => {
    const call = ++calls
    maximumActive = Math.max(maximumActive, ++active)
    if (call === 1) await gate.promise
    if (current()) accepted.push(call)
    active--
  }, () => true)
  const request = controller.refresh()
  await flush()
  for (let index = 0; index < 30; index++) controller.refresh(true, true)
  gate.resolve(); await request
  assert.deepEqual(accepted, [2])
  assert.equal(maximumActive, 1)
  assert.equal(calls, 2)
})

test('a returned mutation patch invalidates pending reads without forcing a whole workspace reload', async () => {
  const gate = deferred()
  let applied = false, calls = 0
  const controller = createForegroundRefresh(async (_background, current) => { calls++; await gate.promise; applied = current() }, () => true)
  const request = controller.refresh()
  await flush()
  controller.invalidate()
  gate.resolve(); await request
  assert.equal(applied, false)
  assert.equal(calls, 1)
})

test('scope disposal blocks late responses and microtask bootstrap cancels the StrictMode probe', async () => {
  let calls = 0
  const probe = createForegroundRefresh(async () => { calls++ }, () => true)
  const first = probe.refresh(false)
  probe.dispose()
  await first
  assert.equal(calls, 0)
  const gate = deferred()
  let applied = false
  const controller = createForegroundRefresh(async (_background, current) => { calls++; await gate.promise; applied = current() }, () => true)
  const pending = controller.refresh()
  await flush()
  controller.dispose(); gate.resolve(); await pending
  assert.equal(applied, false)
  await controller.refresh()
  assert.equal(calls, 1)
})

test('going offline while a mutation refresh is queued defers the follow-up until resumed', async () => {
  let available = true, calls = 0
  const gate = deferred()
  const controller = createForegroundRefresh(async () => { calls++; if (calls === 1) await gate.promise }, () => available)
  const request = controller.refresh()
  await flush()
  controller.refresh(true, true)
  available = false
  gate.resolve(); await request
  assert.equal(calls, 1)
  available = true
  await controller.refresh()
  assert.equal(calls, 2)
})

test('mutation completion while offline still invalidates an earlier pending response', async () => {
  let available = true, applied = false
  const gate = deferred()
  const controller = createForegroundRefresh(async (_background, current) => { await gate.promise; applied = current() }, () => available)
  const request = controller.refresh()
  await flush()
  available = false
  controller.refresh(true, true)
  gate.resolve(); await request
  assert.equal(applied, false)
})
