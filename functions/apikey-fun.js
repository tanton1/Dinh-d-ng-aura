const { defineSecret } = require('firebase-functions/params')

const APIKEY_FUN_API_KEY = defineSecret('APIKEY_FUN_API_KEY', {
  description: 'apikey.fun API key used only by the server-side food image scanner.',
})

const APIKEY_FUN_ENDPOINT = 'https://api.apikey.fun/v1/chat/completions'
const DEFAULT_APIKEY_FUN_VISION_MODEL = 'gemini-3.7-flash'
const DEFAULT_APIKEY_FUN_VISION_FALLBACK_MODEL = 'gemini-3.6-flash'

function getApiKeyFunApiKey() {
  try {
    const value = APIKEY_FUN_API_KEY.value().trim()
    return /^(?:disabled|demo|not-configured)$/i.test(value) ? '' : value
  } catch {
    return ''
  }
}

function getApiKeyFunModelCandidates({ modelEnv, fallbackModelEnv } = {}) {
  const configuredModel = modelEnv?.trim()
    || process.env.APIKEY_FUN_MODEL?.trim()
  const configuredFallback = fallbackModelEnv?.trim()
    || process.env.APIKEY_FUN_FALLBACK_MODEL?.trim()
  return [...new Set([
    configuredModel || DEFAULT_APIKEY_FUN_VISION_MODEL,
    configuredFallback || DEFAULT_APIKEY_FUN_VISION_FALLBACK_MODEL,
  ])]
}

function sanitizeApiKeyFunProviderMessage(value) {
  if (typeof value !== 'string') return null
  return value
    .replace(/\b(?:sk-[0-9A-Za-z_-]{16,}|AIza[0-9A-Za-z_-]{16,})\b/g, '[redacted-api-key]')
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 500) || null
}

function extractApiKeyFunProviderMessage(payload) {
  const directMessage = sanitizeApiKeyFunProviderMessage(
    payload?.error?.message || payload?.message,
  )
  const nestedMessage = sanitizeApiKeyFunProviderMessage(
    payload?.error?.details?.message
      || payload?.error?.metadata?.raw
      || payload?.detail,
  )
  return directMessage || nestedMessage
}

function createApiKeyFunHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

function extractApiKeyFunText(payload) {
  const content = payload?.choices?.[0]?.message?.content
  const removeJsonCodeFence = (value) => {
    const trimmed = value.trim()
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
    return fenced ? fenced[1].trim() : trimmed
  }
  if (typeof content === 'string') return removeJsonCodeFence(content)
  if (!Array.isArray(content)) return ''
  return removeJsonCodeFence(content
    .filter((part) => part?.type === 'text' && typeof part?.text === 'string')
    .map((part) => part.text)
    .join('\n')
  )
}

function normalizeApiKeyFunUsage(usage) {
  const readTokenCount = (value) => Number.isFinite(Number(value))
    ? Math.max(0, Math.trunc(Number(value)))
    : 0
  return {
    promptTokens: readTokenCount(usage?.prompt_tokens),
    completionTokens: readTokenCount(usage?.completion_tokens),
    totalTokens: readTokenCount(usage?.total_tokens),
  }
}

function isApiKeyFunFallbackError(status, providerMessage) {
  if ([404, 408, 409, 429, 500, 502, 503, 504].includes(status)) return true
  if (status !== 400) return false
  return /(?:model|response[_ -]?format|json[_ -]?schema|structured output|unsupported|not available|no endpoints)/i
    .test(providerMessage || '')
}

module.exports = {
  APIKEY_FUN_API_KEY,
  APIKEY_FUN_ENDPOINT,
  DEFAULT_APIKEY_FUN_VISION_FALLBACK_MODEL,
  DEFAULT_APIKEY_FUN_VISION_MODEL,
  createApiKeyFunHeaders,
  extractApiKeyFunProviderMessage,
  extractApiKeyFunText,
  getApiKeyFunApiKey,
  getApiKeyFunModelCandidates,
  isApiKeyFunFallbackError,
  normalizeApiKeyFunUsage,
  sanitizeApiKeyFunProviderMessage,
}
