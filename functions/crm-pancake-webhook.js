'use strict'

// Pancake webhook receiver. It authenticates the page by the secret in the
// URL, stores the raw event and answers 200 at once. Business processing runs
// in a Firestore trigger so a slow or failing step never makes Pancake count
// errors and suspend the webhook.

const { inboundEventId, pageIdValid, webhookRefs, webhookSecretMatches } = require('./crm-core')
const { inboundEventExpiry } = require('./crm-sync')

const MAX_BODY_BYTES = 256 * 1024
const MAX_EVENTS_PER_REQUEST = 50
const SECRET_CACHE_MS = 60_000
const HEARTBEAT_INTERVAL_MS = 60_000

function createPancakeWebhookHandler({ db, nowMs = () => Date.now(), logger = console }) {
  const secretCache = new Map()
  const heartbeats = new Map()

  async function storedHash(pageId) {
    const cached = secretCache.get(pageId)
    if (cached && cached.expiresAt > nowMs()) return cached.hash
    const snapshot = await db.doc(`crmPancakePageSecrets/${pageId}`).get()
    const hash = snapshot.exists ? String(snapshot.data().webhookSecretHash || '') : ''
    secretCache.set(pageId, { hash, expiresAt: nowMs() + SECRET_CACHE_MS })
    if (secretCache.size > 200) secretCache.delete(secretCache.keys().next().value)
    return hash
  }

  function rawBody(request) {
    if (Buffer.isBuffer(request.rawBody)) return request.rawBody.toString('utf8')
    if (typeof request.body === 'string') return request.body
    return JSON.stringify(request.body ?? null)
  }

  function parsed(request, raw) {
    if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) return request.body
    try { return JSON.parse(raw) } catch { return null }
  }

  return async function pancakeWebhook(request, response) {
    if (request.method === 'GET' || request.method === 'HEAD') {
      response.status(200).send('ok')
      return
    }
    if (request.method !== 'POST') {
      response.status(405).send('Method not allowed')
      return
    }
    const [pageId, secret] = String(request.path || '').split('/').filter(Boolean)
    if (!pageIdValid(pageId) || !secret || secret.length > 200) {
      response.status(404).send('Not found')
      return
    }
    let hash
    try {
      hash = await storedHash(pageId)
    } catch (error) {
      logger.error?.('crm_webhook_secret_read_failed', { pageId, message: String(error?.message || error).slice(0, 200) })
      response.status(503).send('Unavailable')
      return
    }
    if (!webhookSecretMatches(secret, hash)) {
      response.status(404).send('Not found')
      return
    }
    const raw = rawBody(request)
    const payload = parsed(request, raw)
    const items = Array.isArray(payload) ? payload.slice(0, MAX_EVENTS_PER_REQUEST) : [payload]
    const now = nowMs()
    try {
      for (const item of items) {
        const itemRaw = items.length === 1 ? raw : JSON.stringify(item)
        const refs = webhookRefs(item)
        const oversized = Buffer.byteLength(itemRaw, 'utf8') > MAX_BODY_BYTES
        const reference = db.doc(`crmInboundEvents/${inboundEventId(pageId, itemRaw)}`)
        try {
          await reference.create({
            schemaVersion: 1,
            source: 'webhook',
            pageId,
            topic: refs.topic,
            conversationId: refs.conversationId,
            messageId: refs.messageId,
            // An oversized body keeps only its identifiers; the sync reads
            // the conversation from the API anyway.
            payloadJson: oversized ? JSON.stringify({ event_type: refs.topic, page_id: pageId, data: { conversation_id: refs.conversationId, message_id: refs.messageId } }) : itemRaw,
            truncated: oversized,
            receivedAt: now,
            status: 'pending',
            attempts: 0,
            expiresAt: inboundEventExpiry(now),
          })
        } catch (error) {
          // Pancake retried an event already stored.
          if (!(String(error?.code) === '6' || /already exists/i.test(String(error?.message)))) throw error
        }
      }
      if (now - (heartbeats.get(pageId) || 0) > HEARTBEAT_INTERVAL_MS) {
        heartbeats.set(pageId, now)
        await db.doc(`crmPancakePages/${pageId}`).set({ webhookLastReceivedAt: now, webhookSuspectedDown: false }, { merge: true })
      }
    } catch (error) {
      logger.error?.('crm_webhook_store_failed', { pageId, message: String(error?.message || error).slice(0, 200) })
      response.status(503).send('Unavailable')
      return
    }
    response.status(200).json({ ok: true })
  }
}

module.exports = { MAX_BODY_BYTES, createPancakeWebhookHandler }
