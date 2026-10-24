import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runNutritionAiRequest } from '../src/services/nutritionAiRequest'

test('pending AI receipt is polled with bounded attempts and succeeds without replacing the request', async () => {
  let calls = 0
  const delays: number[] = []
  const result = await runNutritionAiRequest(async () => {
    if (++calls < 3) throw { details: { kind: 'nutrition_ai_processing', retryAfterMs: 50000 } }
    return 'original-result'
  }, { expectedOwnerUid: 'one', currentOwnerUid: () => 'one', wait: async delay => { delays.push(delay) } })
  assert.equal(result, 'original-result')
  assert.deepEqual(delays, [5000, 5000])
})

test('unknown outcomes and network errors never automatically execute another paid attempt', async () => {
  for (const error of [{ details: { kind: 'nutrition_ai_outcome_unknown' } }, { code: 'unavailable' }, { code: 'deadline-exceeded' }]) {
    let calls = 0
    await assert.rejects(runNutritionAiRequest(async () => { calls++; throw error }, { expectedOwnerUid: 'one', currentOwnerUid: () => 'one', wait: async () => assert.fail('must not retry') }))
    assert.equal(calls, 1)
  }
})

test('polling stops on account changes and server attempt cap', async () => {
  let owner = 'one', calls = 0
  const processing = { details: { kind: 'nutrition_ai_processing', maxPollAttempts: 2 } }
  await assert.rejects(runNutritionAiRequest(async () => { calls++; throw processing }, {
    expectedOwnerUid: 'one', currentOwnerUid: () => owner, wait: async () => { owner = 'two' },
  }), /đăng nhập/)
  assert.equal(calls, 1)
  calls = 0
  await assert.rejects(runNutritionAiRequest(async () => { calls++; throw processing }, { expectedOwnerUid: 'one', currentOwnerUid: () => 'one', wait: async () => {} }))
  assert.equal(calls, 3)
})

test('a successful late AI response is rejected after its owner signs out', async () => {
  let owner: string | undefined = 'one'
  await assert.rejects(runNutritionAiRequest(async () => {
    owner = undefined
    return 'private-old-owner-result'
  }, { expectedOwnerUid: 'one', currentOwnerUid: () => owner }), /đăng nhập/)
})
