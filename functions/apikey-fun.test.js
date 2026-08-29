const assert = require('node:assert/strict')
const test = require('node:test')

const {
  APIKEY_FUN_ENDPOINT,
  createApiKeyFunHeaders,
  extractApiKeyFunProviderMessage,
  extractApiKeyFunText,
  getApiKeyFunModelCandidates,
  isApiKeyFunFallbackError,
  normalizeApiKeyFunUsage,
  sanitizeApiKeyFunProviderMessage,
} = require('./apikey-fun')

test('apikey.fun uses the OpenAI-compatible chat completions endpoint', () => {
  assert.equal(APIKEY_FUN_ENDPOINT, 'https://api.apikey.fun/v1/chat/completions')
})

test('apikey.fun headers keep the key server-side and omit OpenRouter-only attribution', () => {
  const headers = createApiKeyFunHeaders('private-test-key')
  assert.deepEqual(headers, {
    Authorization: 'Bearer private-test-key',
    'Content-Type': 'application/json',
  })
  assert.equal(Object.hasOwn(headers, 'HTTP-Referer'), false)
  assert.equal(Object.hasOwn(headers, 'X-OpenRouter-Title'), false)
})

test('apikey.fun model candidates use multimodal primary and deduplicate overrides', () => {
  const keys = ['APIKEY_FUN_MODEL', 'APIKEY_FUN_FALLBACK_MODEL']
  const originals = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  try {
    keys.forEach((key) => delete process.env[key])
    assert.deepEqual(getApiKeyFunModelCandidates(), ['gemini-3.7-flash', 'gemini-3.6-flash'])
    process.env.APIKEY_FUN_MODEL = 'gemini-3.7-flash'
    process.env.APIKEY_FUN_FALLBACK_MODEL = 'gemini-3.7-flash'
    assert.deepEqual(getApiKeyFunModelCandidates(), ['gemini-3.7-flash'])
  } finally {
    keys.forEach((key) => {
      if (originals[key] === undefined) delete process.env[key]
      else process.env[key] = originals[key]
    })
  }
})

test('apikey.fun parser accepts OpenAI-compatible text, usage, and error payloads', () => {
  assert.equal(extractApiKeyFunText({
    choices: [{ message: { content: '{"answer":"ok"}' } }],
  }), '{"answer":"ok"}')
  assert.equal(extractApiKeyFunText({
    choices: [{ message: { content: '```json\n{"answer":"ok"}\n```' } }],
  }), '{"answer":"ok"}')
  assert.equal(extractApiKeyFunText({
    choices: [{ message: { content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] } }],
  }), 'one\ntwo')
  assert.deepEqual(normalizeApiKeyFunUsage({
    prompt_tokens: 12.9,
    completion_tokens: 5,
    total_tokens: 18,
  }), { promptTokens: 12, completionTokens: 5, totalTokens: 18 })
  assert.equal(extractApiKeyFunProviderMessage({
    error: { message: 'model not found' },
  }), 'model not found')
})

test('apikey.fun retries only transient or model compatibility failures', () => {
  assert.equal(isApiKeyFunFallbackError(503, 'temporarily unavailable'), true)
  assert.equal(isApiKeyFunFallbackError(404, 'model not found'), true)
  assert.equal(isApiKeyFunFallbackError(400, 'response_format json_schema is unsupported'), true)
  assert.equal(isApiKeyFunFallbackError(400, 'invalid image data'), false)
  assert.equal(isApiKeyFunFallbackError(401, 'invalid api key'), false)
})

test('apikey.fun diagnostics redact generic API keys and bearer credentials', () => {
  const syntheticKey = `sk-${'a'.repeat(32)}`
  const message = sanitizeApiKeyFunProviderMessage(`key=${syntheticKey} Bearer private-token`)
  assert.doesNotMatch(message, new RegExp(syntheticKey))
  assert.doesNotMatch(message, /private-token/)
  assert.match(message, /redacted/)
})
