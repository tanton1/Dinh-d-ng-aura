import assert from 'node:assert/strict'
import test from 'node:test'
import {
  friendlyReadOnlyCallableMessage,
  isRetryableReadOnlyCallableError,
  runReadOnlyWithRetry,
} from '../src/services/readOnlyCallableCore'

test('read-only callable retries bounded transient failures and returns the successful value', async () => {
  let invocations = 0
  const delays: number[] = []
  const result = await runReadOnlyWithRetry(async () => {
    invocations += 1
    if (invocations < 3) throw { code: 'functions/internal', message: 'internal' }
    return { ok: true }
  }, {
    random: () => 0.5,
    sleep: async (delay) => { delays.push(delay) },
  })

  assert.deepEqual(result, { ok: true })
  assert.equal(invocations, 3)
  assert.deepEqual(delays, [300, 600])
})

test('read-only callable never retries a business validation failure', async () => {
  let invocations = 0
  await assert.rejects(() => runReadOnlyWithRetry(async () => {
    invocations += 1
    throw { code: 'functions/failed-precondition', message: 'Hợp đồng chưa đủ điều kiện.' }
  }, { sleep: async () => undefined }), /Hợp đồng chưa đủ điều kiện/)
  assert.equal(invocations, 1)
})

test('read-only callable refreshes authentication once before retrying', async () => {
  let invocations = 0
  let refreshes = 0
  const result = await runReadOnlyWithRetry(async () => {
    invocations += 1
    if (invocations === 1) throw { code: 'functions/unauthenticated', message: 'unauthenticated' }
    return 'ready'
  }, { refreshAuth: async () => { refreshes += 1 }, sleep: async () => undefined })
  assert.equal(result, 'ready')
  assert.equal(refreshes, 1)
  assert.equal(invocations, 2)
})

test('raw internal and rate limit failures become actionable Vietnamese messages', () => {
  assert.equal(isRetryableReadOnlyCallableError({ message: 'Rate exceeded.' }), true)
  assert.doesNotMatch(friendlyReadOnlyCallableMessage({ code: 'functions/internal', message: 'internal' }), /^internal$/i)
  assert.match(friendlyReadOnlyCallableMessage({ code: 'functions/resource-exhausted', message: 'Rate exceeded.' }), /nhiều lượt truy cập/)
})
