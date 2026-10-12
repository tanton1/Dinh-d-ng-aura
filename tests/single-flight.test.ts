import assert from 'node:assert/strict'
import test from 'node:test'
import { runKeyedSingleFlight, runSingleFlight } from '../src/utils/singleFlight'

test('single flight collapses rapid duplicate saves into one pending request', async () => {
  let resolvePending!: () => void
  const pending = new Promise<void>((resolve) => { resolvePending = resolve })
  const reference: { current: Promise<number> | null } = { current: null }
  let calls = 0

  const first = runSingleFlight(reference, async () => {
    calls += 1
    await pending
    return 42
  })
  const second = runSingleFlight(reference, async () => {
    calls += 1
    return 99
  })

  assert.equal(first, second)
  assert.equal(calls, 0)
  await Promise.resolve()
  assert.equal(calls, 1)
  resolvePending()
  assert.deepEqual(await Promise.all([first, second]), [42, 42])
  assert.equal(reference.current, null)
})

test('single flight unlocks after a failed save so the user can retry', async () => {
  const reference: { current: Promise<void> | null } = { current: null }
  let calls = 0

  await assert.rejects(runSingleFlight(reference, async () => {
    calls += 1
    throw new Error('network')
  }))
  await runSingleFlight(reference, async () => { calls += 1 })

  assert.equal(calls, 2)
  assert.equal(reference.current, null)
})

test('keyed single flight collapses identical requests but keeps changed payloads independent', async () => {
  const registry = new Map<string, Promise<number>>()
  let calls = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })

  const first = runKeyedSingleFlight(registry, 'meal:one', async () => {
    calls += 1
    await gate
    return 7
  })
  const duplicate = runKeyedSingleFlight(registry, 'meal:one', async () => {
    calls += 1
    return 99
  })
  const changed = runKeyedSingleFlight(registry, 'meal:two', async () => {
    calls += 1
    return 11
  })

  assert.equal(first, duplicate)
  await Promise.resolve()
  assert.equal(calls, 2)
  assert.equal(await changed, 11)
  release()
  assert.deepEqual(await Promise.all([first, duplicate]), [7, 7])
  assert.equal(registry.size, 0)
})
