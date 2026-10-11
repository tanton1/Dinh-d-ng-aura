import assert from 'node:assert/strict'
import test from 'node:test'
import { canFailOverStudent360, readStudent360WithFailover, STUDENT360_READ_TIMEOUT_MS } from '../src/features/student-360/student360ReadPolicy'

test('Student 360 fails over only on explicit infrastructure errors', () => {
  for (const code of ['internal', 'unavailable', 'resource-exhausted', 'deadline-exceeded']) {
    assert.equal(canFailOverStudent360(new Error('friendly', { cause: { code: `functions/${code}` } })), true)
  }
  for (const code of ['not-found', 'permission-denied', 'unauthenticated', 'invalid-argument', 'failed-precondition', 'unknown']) {
    assert.equal(canFailOverStudent360({ code: `functions/${code}` }), false)
  }
  assert.equal(canFailOverStudent360(new Error('network problem')), false)
  assert.equal(STUDENT360_READ_TIMEOUT_MS, 12_000)
})

test('at most two total attempts, primary first, even if both regions fail', async () => {
  const calls: string[] = []
  const outage = { code: 'functions/unavailable' }
  await assert.rejects(readStudent360WithFailover(
    async () => { calls.push('primary'); throw outage },
    async () => { calls.push('overflow'); throw outage },
    async () => { calls.push('backoff') },
  ), (error) => error === outage)
  assert.deepEqual(calls, ['primary', 'backoff', 'overflow'])
})

test('successful primary and permission failures never call overflow', async () => {
  let overflowCalls = 0
  const overflow = async () => { overflowCalls++; return 2 }
  assert.equal(await readStudent360WithFailover(async () => 1, overflow), 1)
  const error = { code: 'functions/permission-denied' }
  await assert.rejects(readStudent360WithFailover(async () => { throw error }, overflow), (value) => value === error)
  assert.equal(overflowCalls, 0)
})
