const assert = require('node:assert/strict')
const test = require('node:test')

const {
  OPENROUTER_ENDPOINT,
  createOpenRouterHeaders,
  createStructuredRequestBody,
  createGeminiCompatibleSchema,
  extractOpenRouterText,
  extractOpenRouterProviderMessage,
  getOpenRouterModelCandidates,
  isOpenRouterFallbackError,
  normalizeOpenRouterUsage,
  requestOpenRouterStructured,
  sanitizeProviderMessage,
} = require('./openrouter')

test('Gemini schema compatibility removes provider-rejected length and cardinality constraints', () => {
  const schema = createGeminiCompatibleSchema({
    type: 'object',
    additionalProperties: false,
    properties: {
      label: { type: 'string', minLength: 1, maxLength: 80 },
      score: { type: 'number', minimum: 0, maximum: 1 },
      tags: { type: 'array', maxItems: 3, items: { type: 'string', minLength: 1 } },
    },
    required: ['label', 'score', 'tags'],
  })

  assert.deepEqual(schema.properties.label, { type: 'string' })
  assert.deepEqual(schema.properties.score, { type: 'number', minimum: 0, maximum: 1 })
  assert.deepEqual(schema.properties.tags, { type: 'array', items: { type: 'string' } })
})

test('OpenRouter provider diagnostics prefer the safe upstream error over a generic gateway message', () => {
  const message = extractOpenRouterProviderMessage({
    error: {
      message: 'Provider returned error',
      metadata: {
        raw: '{"error":{"message":"Request contains an invalid argument."}}',
      },
    },
  })

  assert.match(message, /Request contains an invalid argument/)
})

test('OpenRouter uses Gemini 3.7 Flash with a 3.6 Flash fallback', () => {
  const keys = ['OPENROUTER_MODEL', 'OPENROUTER_FALLBACK_MODEL']
  const originals = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  try {
    keys.forEach((key) => delete process.env[key])
    assert.deepEqual(getOpenRouterModelCandidates(), [
      'google/gemini-3.7-flash',
      'google/gemini-3.6-flash',
    ])
    process.env.OPENROUTER_MODEL = 'google/gemini-3.7-flash'
    process.env.OPENROUTER_FALLBACK_MODEL = 'google/gemini-3.7-flash'
    assert.deepEqual(getOpenRouterModelCandidates(), ['google/gemini-3.7-flash'])
  } finally {
    keys.forEach((key) => {
      if (originals[key] === undefined) delete process.env[key]
      else process.env[key] = originals[key]
    })
  }
})

test('OpenRouter request enables strict structured output and required parameters', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: { answer: { type: 'string' } },
    required: ['answer'],
  }
  assert.deepEqual(createStructuredRequestBody({
    model: 'google/gemini-3.7-flash',
    prompt: 'Trả lời ngắn.',
    schema,
    schemaName: 'Aura Course Quiz',
    maxOutputTokens: 500,
  }), {
    model: 'google/gemini-3.7-flash',
    messages: [{ role: 'user', content: 'Trả lời ngắn.' }],
    max_tokens: 500,
    reasoning: { effort: 'low', exclude: true },
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'aura_course_quiz',
        strict: true,
        schema,
      },
    },
    provider: { require_parameters: true },
    usage: { include: true },
  })
})

test('OpenRouter headers keep the key server-side and use configured attribution URL', () => {
  const originalUrl = process.env.PUBLIC_APP_URL
  try {
    process.env.PUBLIC_APP_URL = 'https://dinh-duong-aura.vercel.app'
    assert.deepEqual(createOpenRouterHeaders('private-test-key'), {
      Authorization: 'Bearer private-test-key',
      'Content-Type': 'application/json',
      'X-OpenRouter-Title': 'Aura Fitness',
      'HTTP-Referer': 'https://dinh-duong-aura.vercel.app',
    })
  } finally {
    if (originalUrl === undefined) delete process.env.PUBLIC_APP_URL
    else process.env.PUBLIC_APP_URL = originalUrl
  }
})

test('OpenRouter parses text content and normalizes token usage', () => {
  assert.equal(extractOpenRouterText({
    choices: [{ message: { content: '{"answer":"ok"}' } }],
  }), '{"answer":"ok"}')
  assert.equal(extractOpenRouterText({
    choices: [{ message: { content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] } }],
  }), 'one\ntwo')
  assert.deepEqual(normalizeOpenRouterUsage({
    prompt_tokens: 123.9,
    completion_tokens: 45,
    total_tokens: 169,
  }), { promptTokens: 123, completionTokens: 45, totalTokens: 169 })
})

test('OpenRouter fallback is limited to transient and model compatibility errors', () => {
  assert.equal(isOpenRouterFallbackError(503, 'temporarily unavailable'), true)
  assert.equal(isOpenRouterFallbackError(404, 'model not found'), true)
  assert.equal(isOpenRouterFallbackError(400, 'response_format json_schema is unsupported'), true)
  assert.equal(isOpenRouterFallbackError(400, 'prompt is invalid'), false)
  assert.equal(isOpenRouterFallbackError(401, 'invalid api key'), false)
})

test('OpenRouter request falls back once and returns structured data with usage', async () => {
  const calls = []
  const responses = [
    {
      ok: false,
      status: 404,
      headers: { get: () => 'request-primary' },
      json: async () => ({ error: { message: 'model not found', code: 404 } }),
    },
    {
      ok: true,
      status: 200,
      headers: { get: () => 'request-fallback' },
      json: async () => ({
        id: 'generation-id',
        choices: [{ message: { content: '{"answer":"ok"}' } }],
        usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
      }),
    },
  ]
  const result = await requestOpenRouterStructured({
    apiKey: 'private-test-key',
    prompt: 'prompt',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { answer: { type: 'string' } },
      required: ['answer'],
    },
    schemaName: 'test',
    maxOutputTokens: 200,
    operation: 'test',
    modelCandidates: ['google/gemini-3.7-flash', 'google/gemini-3.6-flash'],
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) })
      return responses.shift()
    },
  })
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, OPENROUTER_ENDPOINT)
  assert.equal(calls[0].body.model, 'google/gemini-3.7-flash')
  assert.equal(calls[1].body.model, 'google/gemini-3.6-flash')
  assert.deepEqual(result, {
    data: { answer: 'ok' },
    model: 'google/gemini-3.6-flash',
    requestId: 'generation-id',
    usage: { promptTokens: 12, completionTokens: 5, totalTokens: 17 },
  })
})

test('OpenRouter retries malformed or incomplete structured output once', async () => {
  const responses = [
    {
      ok: true,
      status: 200,
      headers: { get: () => 'primary' },
      json: async () => ({
        choices: [{ finish_reason: 'stop', message: { content: '{invalid' } }],
      }),
    },
    {
      ok: true,
      status: 200,
      headers: { get: () => 'fallback' },
      json: async () => ({
        choices: [{ finish_reason: 'stop', message: { content: '{"answer":"recovered"}' } }],
      }),
    },
  ]
  const result = await requestOpenRouterStructured({
    apiKey: 'private-test-key',
    prompt: 'prompt',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { answer: { type: 'string' } },
      required: ['answer'],
    },
    schemaName: 'test',
    maxOutputTokens: 200,
    operation: 'test',
    modelCandidates: ['google/gemini-3.7-flash', 'google/gemini-3.6-flash'],
    fetchImpl: async () => responses.shift(),
  })
  assert.equal(result.data.answer, 'recovered')
  assert.equal(result.model, 'google/gemini-3.6-flash')
})

test('OpenRouter diagnostics redact API keys', () => {
  const message = sanitizeProviderMessage(
    'Bearer sk-or-v1-abcdefghijklmnopqrstuvwxyz123456 and AIzaABCDEFGHIJKLMNOPQRSTUV',
  )
  assert.doesNotMatch(message, /sk-or-v1|AIza/)
  assert.match(message, /redacted/)
})
