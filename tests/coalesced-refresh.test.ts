import assert from 'node:assert/strict'
import test from 'node:test'
import { runCoalescedRefresh, type CoalescedRefreshState } from '../src/utils/coalescedRefresh'

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

test('same-tick refresh signals before dispatch are covered by the first read', async () => {
  const slot: { current: CoalescedRefreshState | null } = { current: null }
  let calls = 0
  const refresh = async () => { calls += 1 }
  const result = runCoalescedRefresh(slot, 'week-a', refresh)
  for (let index = 0; index < 10; index += 1) assert.equal(runCoalescedRefresh(slot, 'week-a', refresh), result)
  await result
  assert.equal(calls, 1)
})

test('refresh signals during a read share one promise and queue one fresh read after it', async () => {
  const slot: { current: CoalescedRefreshState | null } = { current: null }
  const reads = [deferred(), deferred()]
  let calls = 0
  let active = 0
  let maximumActive = 0
  const refresh = async () => {
    active += 1
    maximumActive = Math.max(maximumActive, active)
    await reads[calls++].promise
    active -= 1
  }
  const first = runCoalescedRefresh(slot, 'week-a', refresh)
  await flush()
  assert.equal(calls, 1)
  for (let index = 0; index < 10; index += 1) assert.equal(runCoalescedRefresh(slot, 'week-a', refresh), first)
  reads[0].resolve(); await flush()
  assert.equal(calls, 2)
  assert.equal(maximumActive, 1)
  reads[1].resolve(); await first
  assert.equal(calls, 2)
  assert.equal(slot.current, null)
})

test('a source mutation during the follow-up requests a further read without overlap', async () => {
  const slot: { current: CoalescedRefreshState | null } = { current: null }
  const reads = [deferred(), deferred(), deferred()]
  let calls = 0
  const refresh = () => reads[calls++].promise
  const result = runCoalescedRefresh(slot, 'week-a', refresh)
  await flush()
  runCoalescedRefresh(slot, 'week-a', refresh)
  reads[0].resolve(); await flush()
  assert.equal(calls, 2)
  runCoalescedRefresh(slot, 'week-a', refresh)
  reads[1].resolve(); await flush()
  assert.equal(calls, 3)
  reads[2].resolve(); await result
})

test('scope replacement cancels old queued work and old completion does not release a new request', async () => {
  const slot: { current: CoalescedRefreshState | null } = { current: null }
  const oldRead = deferred()
  const newRead = deferred()
  let oldCalls = 0
  const oldRefresh = () => { oldCalls += 1; return oldRead.promise }
  const oldResult = runCoalescedRefresh(slot, 'week-a', oldRefresh)
  await flush()
  runCoalescedRefresh(slot, 'week-a', oldRefresh)
  const newResult = runCoalescedRefresh(slot, 'week-b', () => newRead.promise)
  await flush()
  oldRead.resolve(); await oldResult
  assert.equal(oldCalls, 1)
  assert.equal(slot.current?.key, 'week-b')
  newRead.resolve(); await newResult
  assert.equal(slot.current, null)
})

test('unmount cancels queued work and a failed read does not prevent a queued recovery', async () => {
  const slot: { current: CoalescedRefreshState | null } = { current: null }
  const pending = deferred()
  let calls = 0
  const refresh = async () => { calls += 1; if (calls === 1) await pending.promise }
  const result = runCoalescedRefresh(slot, 'week-a', refresh)
  await flush()
  runCoalescedRefresh(slot, 'week-a', refresh)
  pending.reject(new Error('temporary failure')); await result
  assert.equal(calls, 2)
  const disposed = deferred()
  const oldResult = runCoalescedRefresh(slot, 'week-a', () => { calls += 1; return disposed.promise })
  await flush()
  runCoalescedRefresh(slot, 'week-a', refresh)
  slot.current = null
  disposed.resolve(); await oldResult
  assert.equal(calls, 3)
  assert.equal(slot.current, null)
})

test('an unqueued failure rejects and releases the slot for a retry', async () => {
  const slot: { current: CoalescedRefreshState | null } = { current: null }
  await assert.rejects(runCoalescedRefresh(slot, 'week-a', async () => { throw new Error('unavailable') }), /unavailable/)
  assert.equal(slot.current, null)
  await runCoalescedRefresh(slot, 'week-a', async () => {})
  assert.equal(slot.current, null)
})

test('a refresh arriving as the completed read settles is never lost', async () => {
  const slot: { current: CoalescedRefreshState | null } = { current: null }
  let calls = 0
  let followUp: Promise<void> | undefined
  const refresh = async () => {
    calls += 1
    if (calls === 1) queueMicrotask(() => queueMicrotask(() => {
      followUp = runCoalescedRefresh(slot, 'week-a', refresh)
    }))
  }
  await runCoalescedRefresh(slot, 'week-a', refresh)
  await followUp
  assert.equal(calls, 2)
  assert.equal(slot.current, null)
})
