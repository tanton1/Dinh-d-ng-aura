'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createPancakeWebhookHandler, MAX_BODY_BYTES } = require('./crm-pancake-webhook')
const { webhookSecretHash } = require('./crm-core')
const { createMemoryFirestore } = require('./test-support/crm-memory-firestore')

const SECRET = 'webhook-secret-abcdefghijklmnop'
const NOW = Date.UTC(2026, 10, 8, 6, 0)

function setup() {
  const db = createMemoryFirestore({
    'crmPancakePageSecrets/123': { webhookSecretHash: webhookSecretHash(SECRET) },
    'crmPancakePages/123': { enabled: true },
  })
  return { db, handler: createPancakeWebhookHandler({ db, nowMs: () => NOW, logger: { error() {}, warn() {} } }) }
}

function response() {
  const result = { statusCode: 0, body: null }
  result.status = (code) => { result.statusCode = code; return result }
  result.send = (body) => { result.body = body; return result }
  result.json = (body) => { result.body = body; return result }
  return result
}

function post(path, body) {
  const raw = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
  return { method: 'POST', path, rawBody: raw, body: typeof body === 'string' ? undefined : body }
}

test('verification probes answer 200 and other methods are refused', async () => {
  const { handler } = setup()
  const get = response()
  await handler({ method: 'GET', path: '/' }, get)
  assert.equal(get.statusCode, 200)
  const put = response()
  await handler({ method: 'PUT', path: '/123/x' }, put)
  assert.equal(put.statusCode, 405)
})

test('a wrong page or secret looks like a missing route and stores nothing', async () => {
  const { db, handler } = setup()
  for (const path of ['/123/wrong-secret', '/999/' + SECRET, '/../' + SECRET, '/123']) {
    const result = response()
    await handler(post(path, { event_type: 'messaging' }), result)
    assert.equal(result.statusCode, 404, path)
  }
  assert.deepEqual(db.paths('crmInboundEvents/'), [])
})

test('a valid event is stored once with a TTL and refreshes the page heartbeat', async () => {
  const { db, handler } = setup()
  const body = { event_type: 'messaging', page_id: '123', data: { conversation: { id: '123_9' }, message: { id: 'm_1' } } }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = response()
    await handler(post(`/123/${SECRET}`, body), result)
    assert.equal(result.statusCode, 200)
  }
  const [path] = db.paths('crmInboundEvents/')
  assert.equal(db.paths('crmInboundEvents/').length, 1, 'a Pancake retry is deduplicated')
  const event = db.data(path)
  assert.equal(event.status, 'pending')
  assert.equal(event.topic, 'messaging')
  assert.equal(event.conversationId, '123_9')
  assert.equal(JSON.parse(event.payloadJson).data.message.id, 'm_1')
  assert.equal(event.expiresAt._seconds * 1000, NOW + 30 * 86_400_000)
  assert.equal(db.data('crmPancakePages/123').webhookLastReceivedAt, NOW)
})

test('a batch body becomes one event per item and an oversized body keeps only ids', async () => {
  const { db, handler } = setup()
  const result = response()
  await handler(post(`/123/${SECRET}`, [
    { event_type: 'messaging', data: { conversation: { id: '123_1' } } },
    { event_type: 'messaging', data: { conversation: { id: '123_2' } } },
  ]), result)
  assert.equal(result.statusCode, 200)
  assert.equal(db.paths('crmInboundEvents/').length, 2)
  const huge = { event_type: 'messaging', data: { conversation: { id: '123_3' }, message: { id: 'm_9', message: 'x'.repeat(MAX_BODY_BYTES) } } }
  await handler(post(`/123/${SECRET}`, huge), response())
  const stored = db.paths('crmInboundEvents/').map((path) => db.data(path)).find((event) => event.conversationId === '123_3')
  assert.equal(stored.truncated, true)
  assert.ok(stored.payloadJson.length < 500)
  assert.equal(JSON.parse(stored.payloadJson).data.message_id, 'm_9')
})

test('a storage failure answers 503 so Pancake retries', async () => {
  const { db, handler } = setup()
  const original = db.doc
  db.doc = (path) => {
    const reference = original(path)
    if (path.startsWith('crmInboundEvents/')) reference.create = async () => { throw Object.assign(new Error('deadline'), { code: 4 }) }
    return reference
  }
  const result = response()
  await handler(post(`/123/${SECRET}`, { event_type: 'messaging' }), result)
  assert.equal(result.statusCode, 503)
})
