import assert from 'node:assert/strict'
import test from 'node:test'
import { startVisiblePolling, VISIBLE_READ_POLL_INTERVAL_MS, type PollingEnvironment } from '../src/utils/visiblePolling'

function harness() {
  let available = true
  let resume: (() => void) | undefined
  const timers = new Map<number, () => void>()
  let id = 0
  const environment: PollingEnvironment = {
    canRefresh: () => available,
    setTimer: (callback, delay) => {
      assert.equal(delay, 30_000)
      timers.set(++id, callback)
      return id
    },
    clearTimer: (timer) => { timers.delete(timer as number) },
    onResume: (callback) => { resume = callback; return () => { resume = undefined } },
  }
  return {
    environment, timers,
    setAvailable: (next: boolean) => { available = next },
    resume: () => resume?.(),
    tick: () => {
      const pending = [...timers.values()]
      timers.clear()
      pending.forEach((callback) => callback())
    },
  }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve() }

test('first load, timer and tab resume never overlap a slow read; next interval starts after completion', async () => {
  const clock = harness()
  let calls = 0
  let finish!: () => void
  const stop = startVisiblePolling(async () => {
    calls += 1
    await new Promise<void>((resolve) => { finish = resolve })
  }, { immediate: true, environment: clock.environment })
  assert.equal(calls, 1)
  clock.resume(); clock.resume(); clock.tick()
  assert.equal(calls, 1)
  assert.equal(clock.timers.size, 0)
  finish(); await flush()
  assert.equal(clock.timers.size, 1)
  clock.tick()
  assert.equal(calls, 2)
  stop(); finish(); await flush()
  assert.equal(clock.timers.size, 0)
  clock.resume()
  assert.equal(calls, 2)
})

test('hidden/offline screens skip network reads and refresh immediately when usable again', async () => {
  const clock = harness()
  clock.setAvailable(false)
  let calls = 0
  const stop = startVisiblePolling(async () => { calls += 1 }, { immediate: true, environment: clock.environment })
  clock.tick(); clock.resume()
  assert.equal(calls, 0)
  assert.equal(clock.timers.size, 1)
  clock.setAvailable(true); clock.resume(); await flush()
  assert.equal(calls, 1)
  assert.equal(clock.timers.size, 1)
  stop()
  assert.equal(clock.timers.size, 0)
})

test('a failed read waits one full interval and a disposed screen never restarts', async () => {
  const clock = harness()
  let calls = 0
  const stop = startVisiblePolling(async () => { calls += 1; throw new Error('unavailable') }, { environment: clock.environment })
  assert.equal(calls, 0)
  clock.tick(); await flush()
  assert.equal(calls, 1)
  assert.equal(clock.timers.size, 1)
  stop(); clock.tick(); clock.resume(); await flush()
  assert.equal(calls, 1)
  assert.equal(VISIBLE_READ_POLL_INTERVAL_MS, 30_000)
})
