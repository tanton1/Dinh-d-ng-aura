const { logger } = require('firebase-functions')
const { defineSecret } = require('firebase-functions/params')
const { HttpsError } = require('firebase-functions/v2/https')

const OPENROUTER_API_KEY = defineSecret('OPENROUTER_API_KEY', {
  description: 'OpenRouter API key used only by server-side Aura AI functions.',
})

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_OPENROUTER_MODEL = 'google/gemini-3.7-flash'
const DEFAULT_OPENROUTER_FALLBACK_MODEL = 'google/gemini-3.6-flash'
const OPENROUTER_TITLE = 'Aura Fitness'

function getOpenRouterApiKey() {
  try {
    const value = OPENROUTER_API_KEY.value().trim()
    return /^(?:disabled|demo|not-configured)$/i.test(value) ? '' : value
  } catch {
    return ''
  }
}

function getOpenRouterModelCandidates({ modelEnv, fallbackModelEnv } = {}) {
  const configuredModel = modelEnv?.trim()
    || process.env.OPENROUTER_MODEL?.trim()
  const configuredFallback = fallbackModelEnv?.trim()
    || process.env.OPENROUTER_FALLBACK_MODEL?.trim()
  return [...new Set([
    configuredModel || DEFAULT_OPENROUTER_MODEL,
    configuredFallback || DEFAULT_OPENROUTER_FALLBACK_MODEL,
  ])]
}

function sanitizeProviderMessage(value) {
  if (typeof value !== 'string') return null
  return value
    .replace(/(?:sk-or-v1-|AIza)[0-9A-Za-z_-]{16,}/g, '[redacted-api-key]')
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 500) || null
}

function createSchemaName(value) {
  const normalized = String(value || 'aura_response')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  return normalized || 'aura_response'
}

function createOpenRouterHeaders(apiKey) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-OpenRouter-Title': OPENROUTER_TITLE,
  }
  const publicAppUrl = process.env.PUBLIC_APP_URL?.trim()
  if (/^https?:\/\/[^\s]+$/i.test(publicAppUrl || '')) {
    headers['HTTP-Referer'] = publicAppUrl
  }
  return headers
}

function createStructuredRequestBody({ model, prompt, schema, schemaName, maxOutputTokens }) {
  return {
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxOutputTokens,
    reasoning: { effort: 'low', exclude: true },
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: createSchemaName(schemaName),
        strict: true,
        schema,
      },
    },
    provider: { require_parameters: true },
    usage: { include: true },
  }
}

function extractOpenRouterText(payload) {
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part?.type === 'text' && typeof part?.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim()
}

function normalizeOpenRouterUsage(usage) {
  const readTokenCount = (value) => Number.isFinite(Number(value))
    ? Math.max(0, Math.trunc(Number(value)))
    : 0
  return {
    promptTokens: readTokenCount(usage?.prompt_tokens),
    completionTokens: readTokenCount(usage?.completion_tokens),
    totalTokens: readTokenCount(usage?.total_tokens),
  }
}

function isOpenRouterFallbackError(status, providerMessage) {
  if ([404, 408, 409, 429, 500, 502, 503, 504].includes(status)) return true
  if (status !== 400) return false
  return /(?:model|provider|response[_ -]?format|json[_ -]?schema|structured output|reasoning|unsupported|not available|no endpoints)/i
    .test(providerMessage || '')
}

async function requestOpenRouterStructured({
  apiKey,
  prompt,
  schema,
  schemaName,
  maxOutputTokens,
  operation,
  modelCandidates,
  timeoutMs = 55000,
  fetchImpl = fetch,
}) {
  for (const [index, model] of modelCandidates.entries()) {
    let response
    try {
      response = await fetchImpl(OPENROUTER_ENDPOINT, {
        method: 'POST',
        headers: createOpenRouterHeaders(apiKey),
        body: JSON.stringify(createStructuredRequestBody({
          model,
          prompt,
          schema,
          schemaName,
          maxOutputTokens,
        })),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      logger.error('OpenRouter request failed.', {
        operation,
        model,
        reason: sanitizeProviderMessage(error instanceof Error ? error.message : 'unknown'),
      })
      if (index === 0 && modelCandidates.length > 1) continue
      throw new HttpsError('unavailable', 'Dịch vụ AI đang gián đoạn. Hãy thử lại sau.')
    }

    const payload = await response.json().catch(() => null)
    const requestId = typeof payload?.id === 'string'
      ? payload.id
      : response.headers.get('x-request-id')
    if (!response.ok) {
      const providerMessage = sanitizeProviderMessage(payload?.error?.message)
      logger.error('OpenRouter provider error.', {
        operation,
        model,
        requestId,
        status: response.status,
        providerType: payload?.error?.code ?? payload?.error?.type ?? null,
        providerMessage,
      })
      if (
        index === 0
        && modelCandidates.length > 1
        && isOpenRouterFallbackError(response.status, providerMessage)
      ) continue
      if (response.status === 429) {
        throw new HttpsError('resource-exhausted', 'Dịch vụ AI đang bận. Hãy thử lại sau ít phút.')
      }
      throw new HttpsError('unavailable', 'AI chưa thể tạo nội dung lúc này.')
    }

    const choice = payload?.choices?.[0]
    const finishReason = typeof choice?.finish_reason === 'string'
      ? choice.finish_reason.toLowerCase()
      : ''
    if (['content_filter', 'safety'].includes(finishReason)) {
      throw new HttpsError('failed-precondition', 'AI không thể xử lý nội dung này.')
    }
    if (choice?.error || payload?.error || (finishReason && finishReason !== 'stop')) {
      const providerMessage = sanitizeProviderMessage(choice?.error?.message || payload?.error?.message)
      logger.error('OpenRouter generation ended before a complete response.', {
        operation,
        model,
        requestId,
        finishReason: finishReason || null,
        providerMessage,
      })
      if (index === 0 && modelCandidates.length > 1) continue
      throw new HttpsError('unavailable', 'AI chưa hoàn tất kết quả. Hãy thử lại sau.')
    }

    const text = extractOpenRouterText(payload)
    if (!text) {
      if (index === 0 && modelCandidates.length > 1) continue
      throw new HttpsError('internal', 'AI trả về kết quả trống.')
    }
    try {
      const data = JSON.parse(text)
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('structured response is not an object')
      }
      return {
        data,
        model,
        requestId,
        usage: normalizeOpenRouterUsage(payload?.usage),
      }
    } catch (error) {
      logger.error('OpenRouter returned invalid structured output.', {
        operation,
        model,
        requestId,
        reason: sanitizeProviderMessage(error instanceof Error ? error.message : 'unknown'),
      })
      if (index === 0 && modelCandidates.length > 1) continue
      throw new HttpsError('internal', 'Kết quả AI không đúng định dạng an toàn.')
    }
  }
  throw new HttpsError('unavailable', 'AI chưa thể tạo nội dung lúc này.')
}

module.exports = {
  DEFAULT_OPENROUTER_FALLBACK_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  OPENROUTER_API_KEY,
  OPENROUTER_ENDPOINT,
  createOpenRouterHeaders,
  createStructuredRequestBody,
  extractOpenRouterText,
  getOpenRouterApiKey,
  getOpenRouterModelCandidates,
  isOpenRouterFallbackError,
  normalizeOpenRouterUsage,
  requestOpenRouterStructured,
  sanitizeProviderMessage,
}
