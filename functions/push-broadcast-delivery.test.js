'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createPushBroadcastDelivery, LEGACY_WINDOW_MS, LEASE_MS } = require('./push-broadcast-delivery')
const { pushDeliveryFixture } = require('./test-support/push-delivery-fixture')

const payload = { title: 'Title', message: 'Message', category: 'general', type: 'INFO', actionUrl: '/home', targetType: 'selected', requestedIds: ['student-a'], respectCategoryPreferences: true }
function fixture(overrides = {}) {
  const h = pushDeliveryFixture()
  let admissions = 0
  const admit = async () => { admissions++; return { eligibleUserIds: ['student-a'], filteredOutCount: 2, devices: [{ token: 'fake-token', reference: h.db.doc('users/student-a/devices/one') }] } }
  const service = createPushBroadcastDelivery({ ...h, publicPushActionUrl: value => `https://fixture.invalid${value}`, ...overrides })
  return { ...h, service, admissions: () => admissions, send: (input = {}) => service.dispatch({ actorId: 'admin-a', requestId: 'intent_12345', payload, admit, ...input }) }
}
const count = (h, kind) => h.effects.filter(effect => effect.kind === kind).length

test('same intent replay does not repeat inbox, transport, admission or reset read state', async () => {
  const h = fixture(); const first = await h.send()
  h.documents.get(`users/student-a/notifications/${first.logId}`).read = true
  const second = await h.send()
  assert.equal(second.logId, first.logId); assert.equal(second.replayed, true)
  assert.equal(second.complete, true); assert.equal(h.admissions(), 1)
  assert.equal(count(h, 'inbox'), 1); assert.equal(count(h, 'fcm'), 1)
  assert.equal(h.documents.get(`users/student-a/notifications/${first.logId}`).read, true)
  assert.equal(h.effects.find(e => e.kind === 'fcm').payload.data.notificationId, first.logId)
})
test('concurrent requests admit one fixed receipt and one external send', async () => {
  const h = fixture(); const results = await Promise.all([h.send(), h.send(), h.send()])
  assert.equal(new Set(results.map(result => result.logId)).size, 1)
  assert.equal(count(h, 'inbox'), 1); assert.equal(count(h, 'fcm'), 1)
  assert.equal((await h.send()).complete, true)
})
test('same request ID with changed content, preference or audience is rejected before delivery', async () => {
  const h = fixture(); await h.send()
  for (const change of [{ message: 'changed' }, { requestedIds: ['student-b'] }, { respectCategoryPreferences: false }, { targetType: 'all' }]) {
    await assert.rejects(h.send({ payload: { ...payload, ...change } }), error => error.code === 'failed-precondition')
  }
  assert.equal(count(h, 'fcm'), 1)
})
test('actor scope separates identical client IDs; malformed IDs never create a receipt', async () => {
  const h = fixture(); const a = await h.send(); const b = await h.send({ actorId: 'admin-b' })
  assert.notEqual(a.logId, b.logId)
  const before = h.documents.size
  for (const requestId of ['bad/id', '', 123]) await assert.rejects(h.send({ requestId }), error => error.code === 'invalid-argument')
  assert.equal(h.documents.size, before)
})
test('admission rejection leaves no receipt, inbox, log or transport side effect', async () => {
  const h = fixture()
  await assert.rejects(h.send({ admit: async () => { throw Error('bounded admission rejected') } }), /admission rejected/)
  assert.equal(h.documents.size, 0); assert.equal(h.effects.length, 0)
})
test('lost inbox transaction acknowledgement resumes without overwriting inbox or using a changed audience', async () => {
  const h = fixture(); let injected = false
  h.hooks.afterCommit = ({ writes }) => {
    if (!injected && writes.some(w => w.ref.path.includes('/notifications/'))) { injected = true; throw Error('lost inbox acknowledgement') }
  }
  await assert.rejects(h.send(), /lost inbox acknowledgement/)
  const result = await h.send({ admit: async () => { throw Error('must use frozen audience') } })
  assert.equal(result.complete, true); assert.equal(count(h, 'inbox'), 1); assert.equal(count(h, 'fcm'), 1)
})
test('interrupted before inbox commit resumes the same intent once', async () => {
  const h = fixture(); let injected = false
  h.hooks.beforeCommit = ({ writes }) => {
    if (!injected && writes.some(w => w.ref.path.includes('/notifications/'))) { injected = true; throw Error('database unavailable') }
  }
  await assert.rejects(h.send(), /database unavailable/)
  const result = await h.send(); assert.equal(result.complete, true)
  assert.equal(count(h, 'inbox'), 1); assert.equal(count(h, 'fcm'), 1)
})
test('ambiguous FCM response is visible, retained per recipient and never retried', async () => {
  const h = fixture(); h.hooks.send = () => { throw Error('response lost') }
  const first = await h.send(); const replay = await h.send()
  assert.equal(first.status, 'needs_review'); assert.equal(first.webPushUnknownCount, 1)
  assert.equal(replay.webPushUnknownCount, 1); assert.equal(count(h, 'fcm'), 1)
  assert.equal(h.documents.get(`pushBroadcastRequests/${first.logId}/recipients/student-a`).pushStatus, 'needs_review')
  assert.equal(h.documents.get(`system/push_broadcast_logs/logs/${first.logId}`).webPushUnknownCount, 1)
})
test('crash after FCM but before result commit marks unknown and never sends that chunk again', async () => {
  const h = fixture(); let injected = false
  h.hooks.beforeCommit = ({ writes }) => {
    if (!injected && writes.some(w => w.ref.path.includes('/deviceChunks/') && w.values.outcomes)) { injected = true; throw Error('outcome commit failed') }
  }
  await assert.rejects(h.send(), /outcome commit failed/)
  const result = await h.send(); assert.equal(result.webPushUnknownCount, 1); assert.equal(count(h, 'fcm'), 1)
})
test('lost successful FCM result commit acknowledgement preserves confirmed counts', async () => {
  const h = fixture(); let injected = false
  h.hooks.afterCommit = ({ writes }) => {
    if (!injected && writes.some(w => w.ref.path.includes('/deviceChunks/') && w.values.outcomes)) { injected = true; throw Error('result acknowledgement lost') }
  }
  await assert.rejects(h.send(), /acknowledgement lost/)
  const result = await h.send(); assert.equal(result.webPushSentCount, 1); assert.equal(result.webPushUnknownCount, 0)
  assert.equal(count(h, 'fcm'), 1)
})
test('expired owner is fenced after transport; replacement resolves sending as unknown', async () => {
  const h = fixture(); h.hooks.send = () => { h.advance(LEASE_MS + 1); return { responses: [{ success: true }] } }
  await assert.rejects(h.send(), error => error.code === 'aborted')
  const result = await h.send(); assert.equal(result.status, 'needs_review'); assert.equal(count(h, 'fcm'), 1)
})
test('budgeted continuation keeps fixed audience and device snapshots', async () => {
  const h = fixture({ budgetMs: 1 }); let admitted = false
  const admit = async () => { admitted = true; h.advance(2); return { eligibleUserIds: ['student-a'], filteredOutCount: 0, devices: [] } }
  const pending = await h.send({ admit }); assert.equal(admitted, true); assert.equal(pending.complete, false)
  const resumed = await h.send({ admit: async () => { throw Error('audience changed') } })
  assert.equal(resumed.complete, true); assert.equal(resumed.sentCount, 1)
})
test('legacy calls reuse completed intent for 24 hours and expose deduplication explicitly', async () => {
  const h = fixture(); const a = await h.send({ requestId: undefined }); const b = await h.send({ requestId: undefined })
  assert.equal(b.logId, a.logId); assert.equal(b.legacyDeduplicated, true); assert.equal(count(h, 'fcm'), 1)
  h.advance(LEGACY_WINDOW_MS + 1)
  const c = await h.send({ requestId: undefined }); assert.notEqual(c.logId, a.logId); assert.equal(c.legacyDeduplicated, false)
})
test('legacy unfinished intent never expires into a duplicate broadcast', async () => {
  const h = fixture({ budgetMs: 0 }); const a = await h.send({ requestId: undefined })
  h.advance(LEGACY_WINDOW_MS + 1)
  const b = await h.send({ requestId: undefined }); assert.equal(a.logId, b.logId); assert.equal(h.admissions(), 1)
})
test('FCM partial responses preserve sent, failed and unknown outcomes separately', async () => {
  const h = fixture(); h.hooks.send = () => ({ responses: [{ success: true }, { success: false }] })
  const result = await h.send({ admit: async () => ({ eligibleUserIds: ['student-a'], filteredOutCount: 0,
    devices: [0,1,2].map(i => ({ token: `token-${i}`, reference: h.db.doc(`users/student-a/devices/${i}`) })) }) })
  assert.deepEqual([result.webPushSentCount, result.webPushFailureCount, result.webPushUnknownCount], [1,1,1])
})
test('legacy unknown result never ages into an automatic duplicate', async () => {
  const h = fixture(); h.hooks.send = () => { throw Error('unknown acceptance') }
  const first = await h.send({ requestId: undefined }); h.advance(LEGACY_WINDOW_MS + 1)
  const replay = await h.send({ requestId: undefined })
  assert.equal(replay.logId, first.logId); assert.equal(replay.status, 'needs_review'); assert.equal(count(h, 'fcm'), 1)
})
test('invalid device cleanup preserves a newly registered token at the same path', async () => {
  for (const changed of [false, true]) {
    const h = fixture(); h.documents.set('users/student-a/devices/one', { token: 'fake-token' })
    h.hooks.send = () => {
      if (changed) h.documents.set('users/student-a/devices/one', { token: 'replacement-token' })
      return { responses: [{ success: false, error: { code: 'messaging/registration-token-not-registered' } }] }
    }
    const result = await h.send(); assert.equal(result.webPushFailureCount, 1)
    assert.equal(h.documents.has('users/student-a/devices/one'), changed)
  }
})
