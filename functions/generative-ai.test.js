const assert = require('node:assert/strict')
const test = require('node:test')

const { buildTask, getModelCandidates, requestStructuredContent } = require('./generative-ai')

test('content AI model candidates use stable defaults and remove duplicates', () => {
  const keys = [
    'OPENROUTER_MODEL',
    'OPENROUTER_FALLBACK_MODEL',
    'OPENROUTER_TEXT_MODEL',
    'OPENROUTER_TEXT_FALLBACK_MODEL',
  ]
  const originals = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  try {
    keys.forEach((key) => delete process.env[key])
    assert.deepEqual(getModelCandidates(), ['google/gemini-3.7-flash', 'google/gemini-3.6-flash'])
    process.env.OPENROUTER_TEXT_MODEL = 'google/gemini-3.7-flash'
    process.env.OPENROUTER_TEXT_FALLBACK_MODEL = 'google/gemini-3.7-flash'
    assert.deepEqual(getModelCandidates(), ['google/gemini-3.7-flash'])
  } finally {
    keys.forEach((key) => {
      if (originals[key] === undefined) delete process.env[key]
      else process.env[key] = originals[key]
    })
  }
})

test('content AI supports only server-defined actions and bounded payloads', () => {
  const task = buildTask('course-quiz', {
    lessonTitle: 'Protein basics',
    lessonSummary: 'A short lesson about protein.',
  })
  assert.equal(task.schema.required.includes('questions'), true)
  assert.match(task.prompt, /Protein basics/)
  assert.throws(() => buildTask('unknown', {}), /not supported/)
  assert.throws(
    () => buildTask('lesson-summary', {
      courseTitle: 'Course',
      lessonTitle: 'Lesson',
      lessonContent: 'x'.repeat(8001),
    }),
    /too long/,
  )
})

test('content AI action schemas require the client response roots', () => {
  const cases = [
    ['course-outline', { topic: 'A', audience: 'B', weeks: 4 }, 'modules'],
    ['course-memory', { lessonTitle: 'A', lessonSummary: 'B' }, 'flashcards'],
    ['lesson-summary', { courseTitle: 'A', lessonTitle: 'B', lessonContent: 'C' }, 'takeaways'],
    ['recipe', { prompt: 'A', goal: 'fat-loss', mealType: 'lunch' }, 'ingredients'],
    ['meal-plan', { goal: 'fat-loss', targetCalories: 1600, targetProtein: 120 }, 'sampleDays'],
  ]
  cases.forEach(([action, payload, root]) => {
    assert.equal(buildTask(action, payload).schema.required.includes(root), true)
  })
})

const contentTask = () => buildTask('course-quiz', { lessonTitle: 'Test', lessonSummary: 'Synthetic fixture only.' })
const providerResponse = (status, payload, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: name => headers[name.toLowerCase()] || null },
  json: async () => payload,
})
const successfulGeneration = () => providerResponse(200, {
  id: 'gen-synthetic', choices: [{ finish_reason: 'stop', message: { content: '{"questions":[]}' } }],
  usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 },
})

test('content AI returns the first successful generation and its usage without another POST', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (_url, options) => { calls.push(JSON.parse(options.body)); return successfulGeneration() })
  const result = await requestStructuredContent('synthetic-key', contentTask(), 'course-quiz')
  assert.equal(calls.length, 1)
  assert.deepEqual(result.data, { questions: [] })
  assert.equal(result.requestId, 'gen-synthetic')
  assert.deepEqual(result.usage, { promptTokens: 9, completionTokens: 3, totalTokens: 12 })
})

test('content AI never automatically repeats a timeout or network failure', async t => {
  for (const failure of [new DOMException('deadline', 'TimeoutError'), new TypeError('connection lost')]) {
    let calls = 0
    const mock = t.mock.method(globalThis, 'fetch', async () => { calls++; throw failure })
    await assert.rejects(requestStructuredContent('synthetic-key', contentTask(), 'course-quiz'), { code: 'unavailable' })
    assert.equal(calls, 1)
    mock.mock.restore()
  }
})

test('content AI never repeats transient, budget, moderation or unclassified rejection responses', async t => {
  for (const status of [400, 401, 402, 403, 404, 408, 409, 429, 500, 502, 503, 504]) {
    let calls = 0
    const mock = t.mock.method(globalThis, 'fetch', async () => {
      calls++; return providerResponse(status, { error: { code: status, message: 'Request failed' } })
    })
    await assert.rejects(requestStructuredContent('synthetic-key', contentTask(), 'course-quiz'))
    assert.equal(calls, 1, `HTTP ${status}`)
    mock.mock.restore()
  }
})

test('content AI keeps one fallback for explicit model or format rejection', async t => {
  for (const [status, message] of [
    [404, 'model not found'], [404, 'No endpoints found for this model'],
    [400, 'response_format is not supported'], [400, 'Unsupported JSON schema'],
  ]) {
    const models = []
    const mock = t.mock.method(globalThis, 'fetch', async (_url, options) => {
      models.push(JSON.parse(options.body).model)
      return models.length === 1 ? providerResponse(status, { error: { code: status, message } }, { 'x-request-id': 'correlation-only' }) : successfulGeneration()
    })
    const result = await requestStructuredContent('synthetic-key', contentTask(), 'course-quiz')
    assert.equal(models.length, 2, message)
    assert.notEqual(models[0], models[1])
    assert.equal(result.model, models[1])
    mock.mock.restore()
  }
})

test('even a model rejection cannot fallback if the response contains evidence of generation', async t => {
  for (const { extra = {}, headers = {} } of [
    { extra: { id: 'gen-first' } }, { extra: { request_id: 'gen-first' } },
    { extra: { generation_id: 'gen-first' } },
    { extra: { error: { message: 'model not found', metadata: { request_id: 'gen-first' } } } },
    { extra: { error: { message: 'model not found', metadata: { generation_id: 'gen-first' } } } },
    { extra: { error: { message: 'model not found', code: 500 } } },
    { extra: { usage: { total_tokens: 5 } } }, { extra: { usage: { total_tokens: 0 } } },
    { extra: { choices: [] } }, { headers: { 'x-generation-id': 'gen-first' } },
    { headers: { 'x-request-id': 'gen-first' } },
  ]) {
    let calls = 0
    const mock = t.mock.method(globalThis, 'fetch', async () => {
      calls++; return providerResponse(404, { error: { message: 'model not found' }, ...extra }, headers)
    })
    await assert.rejects(requestStructuredContent('synthetic-key', contentTask(), 'course-quiz'))
    assert.equal(calls, 1)
    mock.mock.restore()
  }
})

test('content AI never repeats incomplete, empty, malformed or safety-blocked generations', async t => {
  for (const payload of [
    null, {}, { choices: [] }, { error: { message: 'inference failed' } },
    ...['length', 'error', 'content_filter', 'safety'].map(finish_reason => ({ choices: [{ finish_reason, message: { content: '{"questions":[]}' } }] })),
    ...['', '{invalid', 'null', '[]', '4'].map(content => ({ choices: [{ finish_reason: 'stop', message: { content } }] })),
    { choices: [{ error: { message: 'inference failed' }, message: { content: '{"questions":[]}' } }] },
  ]) {
    let calls = 0
    const mock = t.mock.method(globalThis, 'fetch', async () => { calls++; return providerResponse(200, payload) })
    await assert.rejects(requestStructuredContent('synthetic-key', contentTask(), 'course-quiz'))
    assert.equal(calls, 1)
    mock.mock.restore()
  }
})

test('content AI does not repeat when reading the response body fails after request acceptance', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++; return { ...providerResponse(200, null), json: async () => { throw new Error('stream interrupted') } }
  })
  await assert.rejects(requestStructuredContent('synthetic-key', contentTask(), 'course-quiz'))
  assert.equal(calls, 1)
})

test('content AI cannot keep retrying when the fallback is rejected too', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return providerResponse(404, { error: { message: 'model not found' } }) })
  await assert.rejects(requestStructuredContent('synthetic-key', contentTask(), 'course-quiz'))
  assert.equal(calls, 2)
})
