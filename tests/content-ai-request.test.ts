import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { runContentAiRequest, type ContentAiRequestOptions } from '../src/services/contentAiRequest'

const id = 'content_original_1'
const response = (requestId = id) => ({ action: 'course-quiz', data: { questions: ['original'] }, receipt: { schemaVersion: 1 as const, requestId, status: 'completed' as const } })
function fixture(overrides: Partial<ContentAiRequestOptions> = {}) {
  const records = new Map<string, string>()
  const options: ContentAiRequestOptions = { ownerUid: 'one', currentOwnerUid: () => 'one', storageKey: randomUUID(), defaultRequestId: id,
    storage: { getItem: key => records.get(key) ?? null, setItem: (key, value) => { records.set(key, value) } },
    now: () => 1_000_000, wait: async () => {}, ...overrides }
  return { options, records, run: (invoke: (input: Record<string, unknown>) => Promise<ReturnType<typeof response>>, extra: Partial<ContentAiRequestOptions> = {}) =>
    runContentAiRequest('course-quiz', { lessonTitle: 'Fixture' }, invoke, { ...options, ...extra }) }
}
const failure = (kind: string, code = 'functions/failed-precondition', extra: Record<string, unknown> = {}) => Object.assign(new Error(kind), { code, details: { kind, ...extra } })

test('completed content is recovered through status after reload and keeps its owner/request identity', async () => {
  const f = fixture(), inputs: Record<string, unknown>[] = []
  const invoke = async (input: Record<string, unknown>) => { inputs.push(input); return response() }
  const first = await f.run(invoke), replay = await f.run(invoke)
  assert.deepEqual(replay, first)
  assert.deepEqual(inputs.map(input => input.action), ['course-quiz', 'request-status'])
  assert.ok(inputs.every(input => input.requestId === id && input.expectedOwnerUid === 'one'))
  assert.equal(replay.generationId, id)
  assert.ok(!f.records.get(f.options.storageKey)?.includes('Fixture'))
})

test('a timeout after provider success causes only a status read, never a second generating call', async () => {
  const f = fixture(), actions: unknown[] = []
  const result = await f.run(async input => {
    actions.push(input.action)
    if (input.action === 'course-quiz') throw Object.assign(Error('Lost response'), { code: 'functions/deadline-exceeded' })
    return response()
  })
  assert.equal(result.generationId, id)
  assert.deepEqual(actions, ['course-quiz', 'request-status'])
})

test('server-confirmed pending work is checked with bounded status requests and no idle polling', async () => {
  const f = fixture(), actions: unknown[] = [], delays: number[] = []
  await f.run(async input => {
    actions.push(input.action)
    if (actions.length < 4) throw failure('content_ai_processing', 'functions/aborted', { maxPollAttempts: 12, retryAfterMs: 50000 })
    return response()
  }, { wait: async value => { delays.push(value) } })
  assert.deepEqual(actions, ['course-quiz', 'request-status', 'request-status', 'request-status'])
  assert.deepEqual(delays, [5000, 5000, 5000])
  const bounded = fixture(); let calls = 0
  await assert.rejects(bounded.run(async () => { calls++; throw failure('content_ai_processing', 'aborted', { maxPollAttempts: 2 }) }))
  assert.equal(calls, 3)
})

test('unknown outcomes and a failed status transport never repeat paid work', async () => {
  for (const kind of ['content_ai_outcome_unknown', 'content_ai_lease_lost']) {
    const f = fixture(), actions: unknown[] = []
    const invoke = async (input: Record<string, unknown>) => { actions.push(input.action); throw failure(kind) }
    await assert.rejects(f.run(invoke))
    await assert.rejects(f.run(invoke))
    assert.deepEqual(actions, ['course-quiz', 'request-status'])
  }
  const f = fixture(), actions: unknown[] = []
  await assert.rejects(f.run(async input => { actions.push(input.action); throw Object.assign(Error('Offline'), { code: 'unavailable' }) }))
  assert.deepEqual(actions, ['course-quiz', 'request-status'])
})

test('missing unstarted work requires another user action, then reuses the same ID', async () => {
  const f = fixture(), actions: unknown[] = []
  await assert.rejects(f.run(async input => {
    actions.push(input.action)
    if (input.action === 'course-quiz') throw Object.assign(Error('Offline'), { code: 'unavailable' })
    throw failure('content_ai_not_started', 'not-found', { requestId: id })
  }), /chưa bắt đầu/)
  assert.deepEqual(actions, ['course-quiz', 'request-status'])
  await f.run(async input => { assert.equal(input.requestId, id); actions.push(input.action); return response() })
  assert.deepEqual(actions, ['course-quiz', 'request-status', 'course-quiz'])
})

test('expired or completed receipts never become a new generation implicitly', async () => {
  const f = fixture(); await f.run(async () => response())
  const actions: unknown[] = []
  for (const elapsed of [0, 8 * 86400000]) await assert.rejects(f.run(async input => {
    actions.push(input.action); throw failure('content_ai_not_started', 'not-found', { requestId: id })
  }, { now: () => 1_000_000 + elapsed }), /không còn khả dụng/)
  assert.deepEqual(actions, ['request-status', 'request-status'])
  const pending = fixture()
  await assert.rejects(pending.run(async () => { throw failure('content_ai_outcome_unknown') }))
  for (let i = 0; i < 2; i++) await assert.rejects(pending.run(async input => {
    assert.equal(input.action, 'request-status'); throw failure('content_ai_not_started', 'not-found', { requestId: id })
  }, { now: () => 1_000_000 + 8 * 86400000 }), /hết thời gian lưu/)
  const fresh = await f.run(async input => {
    assert.equal(input.action, 'course-quiz'); assert.equal(input.requestId, 'content_new_draft_1'); return response('content_new_draft_1')
  }, { newDraft: true, nonce: () => 'new_draft_1', now: () => 1_000_000 + 8 * 86400000 })
  assert.equal(fresh.generationId, 'content_new_draft_1')
})

test('sign-out fences invocation, pending polls and late successful responses', async () => {
  let owner: string | undefined = 'one', calls = 0
  const f = fixture({ currentOwnerUid: () => owner })
  await assert.rejects(f.run(async () => { calls++; owner = undefined; return response() }), { code: 'cancelled' })
  assert.equal(calls, 1)
  await assert.rejects(f.run(async () => { calls++; return response() }), { code: 'cancelled' })
  assert.equal(calls, 1)
  owner = 'one'
  const pending = fixture({ currentOwnerUid: () => owner })
  await assert.rejects(pending.run(async () => { calls++; throw failure('content_ai_processing', 'aborted') }, { wait: async () => { owner = 'two' } }), { code: 'cancelled' })
  assert.equal(calls, 2)
})

test('malformed, old-server and mismatched receipts stop without automatic fallback', async () => {
  for (const value of [{ action: 'course-quiz', data: {} }, response('content_wrong_1'), { ...response(), data: [] }]) {
    const f = fixture(); let calls = 0
    await assert.rejects(f.run(async () => { calls++; return value as ReturnType<typeof response> }), { code: 'content-protocol-mismatch' })
    assert.equal(calls, 1)
  }
  const f = fixture(); let calls = 0
  await assert.rejects(f.run(async input => { calls++; throw Object.assign(Error('Old backend'), { code: input.action === 'request-status' ? 'invalid-argument' : 'unavailable' }) }))
  assert.equal(calls, 2)
})

test('a new draft requires durable ID storage before any provider-capable invocation', async () => {
  const f = fixture({ storage: { getItem: () => { throw Error('Storage blocked') }, setItem: () => { throw Error('Storage blocked') } } })
  let calls = 0
  await assert.rejects(f.run(async () => { calls++; return response() }, { newDraft: true, nonce: () => 'blocked_1' }), /lưu được mã/)
  assert.equal(calls, 0)
  await f.run(async input => { calls++; assert.equal(input.requestId, id); return response() })
  assert.equal(calls, 1)
})

test('corrupted saved state does not silently issue another paid request', async () => {
  for (const raw of ['', '{bad', 'null', '[]', '1', '"undefined"',
    JSON.stringify({ schemaVersion: 1, ownerUid: 'other', state: 'completed', createdAt: 1, requestId: id }),
    JSON.stringify({ schemaVersion: 1, ownerUid: 'one', state: 'completed', createdAt: 1 }),
    JSON.stringify({ schemaVersion: 1, ownerUid: 'one', state: 'completed', createdAt: 1, requestId: null })]) {
    const f = fixture(); f.records.set(f.options.storageKey, raw); let calls = 0
    await assert.rejects(f.run(async () => { calls++; return response() }))
    assert.equal(calls, 0)
    await f.run(async input => { calls++; return response(String(input.requestId)) }, { newDraft: true, nonce: () => 'recovered_1' })
    assert.equal(calls, 1)
  }
})
