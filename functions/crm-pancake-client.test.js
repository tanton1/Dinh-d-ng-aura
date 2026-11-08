'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { PancakeApiError, createPancakeClient } = require('./crm-pancake-client')

const TOKEN = 'secret-page-token-1234567890'

function fakeFetch(responses) {
  const calls = []
  const queue = [...responses]
  async function fetchImpl(url, options) {
    calls.push({ url: new URL(url), options })
    const next = queue.shift()
    if (next instanceof Error) throw next
    return { status: next.status ?? 200, ok: (next.status ?? 200) < 400, json: async () => next.body }
  }
  return { fetchImpl, calls }
}

function client(responses, pageId = '123') {
  const fake = fakeFetch(responses)
  return { fake, api: createPancakeClient({ pageId, pageAccessToken: TOKEN, fetchImpl: fake.fetchImpl, minimumInterval: 0, sleepImpl: async () => {} }) }
}

test('conversations are listed with the page token and second-based times', async () => {
  const { fake, api } = client([{ body: { success: true, conversations: [{ id: '123_1' }] } }])
  const rows = await api.listConversations({ since: 1_762_600_000_000, until: 1_762_603_600_999, lastConversationId: '123_0' })
  assert.deepEqual(rows, [{ id: '123_1' }])
  const { url } = fake.calls[0]
  assert.equal(url.origin + url.pathname, 'https://pages.fm/api/public_api/v2/pages/123/conversations')
  assert.equal(url.searchParams.get('page_access_token'), TOKEN)
  assert.equal(url.searchParams.get('since'), '1762600000')
  assert.equal(url.searchParams.get('until'), '1762603600')
  assert.equal(url.searchParams.get('type'), 'INBOX')
  assert.equal(url.searchParams.get('last_conversation_id'), '123_0')
})

test('messages, tags, users, tagging and assignment use the v1 page API', async () => {
  const { fake, api } = client([
    { body: { success: true, messages: [{ id: 'm1' }], customers: [{ id: 'pc', fb_id: '9' }] } },
    { body: { success: true, tags: [{ id: 5, text: 'AURA: Mới', color: '#f00' }, { text: 'no id' }] } },
    { body: { success: true, users: [{ id: 'u1', name: 'Minh' }] } },
    { body: { success: true } },
    { body: { success: true } },
  ])
  const page = await api.getMessages({ conversationId: '123_9', customerId: 'pc', currentCount: 25 })
  assert.deepEqual(page.customers, [{ id: 'pc', fb_id: '9' }])
  assert.equal(fake.calls[0].url.pathname, '/api/public_api/v1/pages/123/conversations/123_9/messages')
  assert.equal(fake.calls[0].url.searchParams.get('current_count'), '25')
  assert.deepEqual(await api.listTags(), [{ id: '5', text: 'AURA: Mới', color: '#f00' }])
  assert.deepEqual(await api.listUsers(), [{ id: 'u1', name: 'Minh', email: '' }])
  await api.setTag({ conversationId: '123_9', tagId: '5', action: 'add' })
  assert.equal(fake.calls[3].options.method, 'POST')
  assert.deepEqual(JSON.parse(fake.calls[3].options.body), { action: 'add', tag_id: '5' })
  await api.assign({ conversationId: '123_9', assigneeIds: ['u1'] })
  assert.deepEqual(JSON.parse(fake.calls[4].options.body), { assignee_ids: ['u1'] })
})

test('an invalid token asks for reconnection and never echoes the token', async () => {
  const { api } = client([{ body: { success: false, error_code: 102, message: 'Invalid access_token' } }])
  await assert.rejects(api.listTags(), (error) => {
    assert.ok(error instanceof PancakeApiError)
    assert.equal(error.reconnect, true)
    assert.equal(String(error.message).includes(TOKEN), false)
    return true
  })
})

test('rate limits and server errors are retried, other refusals are not', async () => {
  const retried = client([{ status: 429, body: {} }, { status: 502, body: {} }, { body: { success: true, tags: [] } }])
  assert.deepEqual(await retried.api.listTags(), [])
  assert.equal(retried.fake.calls.length, 3)
  const exhausted = client([{ status: 429, body: {} }, { status: 429, body: {} }, { status: 429, body: {} }])
  await assert.rejects(exhausted.api.listTags(), (error) => error.retryable === true && error.status === 429)
  const refused = client([{ body: { success: false, message: 'Conversation not found' } }])
  await assert.rejects(refused.api.getMessages({ conversationId: 'x' }), (error) => error.reconnect === false && /not found/.test(error.message))
  assert.equal(refused.fake.calls.length, 1)
  const network = client([new TypeError('socket hang up'), { body: { success: true, users: [] } }])
  assert.deepEqual(await network.api.listUsers(), [])
})

test('requests to one page are spaced to respect the per-page rate limit', async () => {
  const fake = fakeFetch(Array.from({ length: 3 }, () => ({ body: { success: true, tags: [] } })))
  const api = createPancakeClient({ pageId: 'spacing-page', pageAccessToken: TOKEN, fetchImpl: fake.fetchImpl, minimumInterval: 40 })
  const started = Date.now()
  await Promise.all([api.listTags(), api.listTags(), api.listTags()])
  assert.ok(Date.now() - started >= 75, `three requests took ${Date.now() - started}ms`)
})

test('a client cannot be created without a page and token', () => {
  assert.throws(() => createPancakeClient({ pageId: '', pageAccessToken: TOKEN, fetchImpl: () => {} }), PancakeApiError)
})
