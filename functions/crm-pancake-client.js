'use strict'

// Thin client for the Pancake page API (pages.fm). Endpoint paths follow the
// public reference as summarised on 2026-11-08 and must be re-checked against
// the live account before production use. The page token travels only in the
// query string Pancake requires and is never logged or put in an error.

const API_V1 = 'https://pages.fm/api/public_api/v1'
const API_V2 = 'https://pages.fm/api/public_api/v2'
const MIN_INTERVAL_MS = 220 // Pancake allows 5 requests per second per page.
const TIMEOUT_MS = 12_000
const MAX_RETRIES = 2

class PancakeApiError extends Error {
  constructor(message, { status = 0, code = '', retryable = false, reconnect = false } = {}) {
    super(message)
    this.name = 'PancakeApiError'
    this.status = status
    this.code = String(code || '')
    this.retryable = retryable
    this.reconnect = reconnect
  }
}

const pageQueues = new Map()

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Requests for one page leave at least MIN_INTERVAL_MS apart in this process.
function throttle(pageId, minimumInterval) {
  const previous = pageQueues.get(pageId) || Promise.resolve(0)
  const next = previous.then(async (lastAt) => {
    const wait = lastAt + minimumInterval - Date.now()
    if (wait > 0) await sleep(wait)
    return Date.now()
  })
  pageQueues.set(pageId, next.catch(() => Date.now()))
  return next
}

function reconnectError(body) {
  const code = String(body?.error_code ?? body?.code ?? '')
  const message = String(body?.message || body?.error || '').toLowerCase()
  return code === '102' || code === '105' || message.includes('access_token') || message.includes('access token')
}

function createPancakeClient({ pageId, pageAccessToken, fetchImpl = globalThis.fetch, minimumInterval = MIN_INTERVAL_MS, sleepImpl = sleep }) {
  if (!pageId || !pageAccessToken) throw new PancakeApiError('Thiếu page hoặc token Pancake.', { reconnect: true })
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable')

  async function request(base, path, { method = 'GET', query = {}, body = null } = {}) {
    const url = new URL(`${base}/pages/${encodeURIComponent(pageId)}${path}`)
    url.searchParams.set('page_access_token', pageAccessToken)
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
    }
    for (let attempt = 0; ; attempt += 1) {
      await throttle(pageId, minimumInterval)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
      let response
      try {
        response = await fetchImpl(url.toString(), {
          method,
          headers: body ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        })
      } catch (cause) {
        clearTimeout(timer)
        if (attempt < MAX_RETRIES) { await sleepImpl(500 * (attempt + 1)); continue }
        throw new PancakeApiError(cause?.name === 'AbortError' ? 'Pancake phản hồi quá chậm.' : 'Không kết nối được Pancake.', { retryable: true })
      }
      clearTimeout(timer)
      if (response.status === 429 || response.status >= 500) {
        if (attempt < MAX_RETRIES) { await sleepImpl(1000 * (attempt + 1)); continue }
        throw new PancakeApiError(response.status === 429 ? 'Pancake đang giới hạn tốc độ.' : 'Pancake đang lỗi máy chủ.', { status: response.status, retryable: true })
      }
      let payload = null
      try { payload = await response.json() } catch { payload = null }
      if (response.status === 401 || response.status === 403 || (payload && payload.success === false && reconnectError(payload))) {
        throw new PancakeApiError('Token Pancake không còn hợp lệ. Hãy kết nối lại page.', { status: response.status, code: payload?.error_code, reconnect: true })
      }
      if (!response.ok || !payload || payload.success === false) {
        throw new PancakeApiError(String(payload?.message || 'Pancake từ chối yêu cầu.').slice(0, 200), { status: response.status, code: payload?.error_code })
      }
      return payload
    }
  }

  return {
    pageId,
    // Newest first, 60 per page; pass the last id to continue.
    async listConversations({ since, until, lastConversationId, type = 'INBOX', tags } = {}) {
      const payload = await request(API_V2, '/conversations', {
        query: {
          type,
          since: since ? Math.floor(since / 1000) : undefined,
          until: until ? Math.floor(until / 1000) : undefined,
          last_conversation_id: lastConversationId,
          tags,
        },
      })
      return Array.isArray(payload.conversations) ? payload.conversations : []
    },
    async getMessages({ conversationId, customerId, currentCount } = {}) {
      const payload = await request(API_V1, `/conversations/${encodeURIComponent(conversationId)}/messages`, {
        query: { customer_id: customerId, current_count: currentCount },
      })
      return {
        messages: Array.isArray(payload.messages) ? payload.messages : [],
        customers: Array.isArray(payload.customers) ? payload.customers : [],
        conversation: payload.conversation && typeof payload.conversation === 'object' ? payload.conversation : null,
      }
    },
    async listTags() {
      const payload = await request(API_V1, '/tags')
      const tags = Array.isArray(payload.tags) ? payload.tags : Array.isArray(payload.data) ? payload.data : []
      return tags.map((tag) => ({ id: String(tag?.id ?? ''), text: String(tag?.text || tag?.name || '').slice(0, 80), color: String(tag?.color || '').slice(0, 20) }))
        .filter((tag) => tag.id)
    },
    async listUsers() {
      const payload = await request(API_V1, '/users')
      const users = Array.isArray(payload.users) ? payload.users : Array.isArray(payload.data) ? payload.data : []
      return users.map((user) => ({ id: String(user?.id || user?.user_id || ''), name: String(user?.name || user?.fb_name || '').slice(0, 120), email: String(user?.email || '').slice(0, 160) }))
        .filter((user) => user.id)
    },
    async setTag({ conversationId, tagId, action }) {
      await request(API_V1, `/conversations/${encodeURIComponent(conversationId)}/tags`, { method: 'POST', body: { action, tag_id: tagId } })
    },
    async assign({ conversationId, assigneeIds }) {
      await request(API_V1, `/conversations/${encodeURIComponent(conversationId)}/assign`, { method: 'POST', body: { assignee_ids: assigneeIds } })
    },
  }
}

module.exports = { API_V1, API_V2, MIN_INTERVAL_MS, PancakeApiError, createPancakeClient }
