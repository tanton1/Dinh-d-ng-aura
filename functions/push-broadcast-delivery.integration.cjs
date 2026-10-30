'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { createPushBroadcastDelivery } = require('./push-broadcast-delivery')

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw new Error('This test requires the local Firestore emulator; production is forbidden.')
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `push-delivery-${process.pid}`)
const db = getFirestore(app, `push-delivery-${process.pid}`)
test.after(async () => { await db.terminate(); await deleteApp(app) })
const payload = { title: 'Fixture only', message: 'No real messages', category: 'general', type: 'INFO', actionUrl: '/home', targetType: 'all', requestedIds: [], respectCategoryPreferences: true }
function service(database = db, send) {
  return createPushBroadcastDelivery({ db: database, publicPushActionUrl: value => `https://fixture.invalid${value}`,
    messaging: { sendEachForMulticast: send } })
}
function input(actorId, count = 1) {
  const ids = Array.from({ length: count }, (_, i) => `${actorId}-student-${i}`)
  return { actorId, requestId: 'intent_12345', payload,
    admit: async () => ({ eligibleUserIds: ids, filteredOutCount: 0,
      devices: ids.map(uid => ({ token: `FAKE-${uid}`, reference: db.doc(`users/${uid}/devices/one`) })) }) }
}

test('real concurrent Firestore transactions preserve one receipt, inbox and FCM attempt', async () => {
  let sends = 0
  const worker = service(db, async request => { sends++; return { responses: request.tokens.map(() => ({ success: true })) } })
  const command = input('concurrent')
  const results = await Promise.all([worker.dispatch(command), worker.dispatch(command), worker.dispatch(command)])
  assert.equal(new Set(results.map(item => item.logId)).size, 1)
  const result = await worker.dispatch(command)
  assert.equal(result.complete, true); assert.equal(sends, 1)
  const inbox = await db.collection('users/concurrent-student-0/notifications').get()
  assert.equal(inbox.size, 1)
  assert.equal((await db.doc(`pushBroadcastRequests/${result.logId}/recipients/concurrent-student-0`).get()).data().pushStatus, 'accepted')
})
test('401 recipients fit bounded transactions and retain exact per-recipient counts', async () => {
  let sends = 0
  const worker = service(db, async request => { sends++; return { responses: request.tokens.map(() => ({ success: true })) } })
  const command = input('bounded', 401)
  let result = await worker.dispatch(command)
  for (let i = 0; !result.complete && i < 5; i++) result = await worker.dispatch(command)
  assert.equal(result.complete, true); assert.equal(result.sentCount, 401); assert.equal(result.webPushSentCount, 401)
  assert.equal(sends, 3)
  assert.equal((await db.collection(`pushBroadcastRequests/${result.logId}/recipients`).get()).size, 401)
})
test('lost real inbox commit acknowledgement resumes without recreating or resetting read inbox', async () => {
  let injected = false, sends = 0
  const wrapped = { doc: db.doc.bind(db), runTransaction: async handler => {
    let inboxWrite = false
    const result = await db.runTransaction(transaction => handler(new Proxy(transaction, { get(target, property) {
      if (property === 'create') return (reference, value) => { if (reference.path.includes('/notifications/')) inboxWrite = true; return target.create(reference, value) }
      return typeof target[property] === 'function' ? target[property].bind(target) : target[property]
    } })))
    if (!injected && inboxWrite) { injected = true; throw Error('lost committed response') }
    return result
  } }
  const worker = service(wrapped, async request => { sends++; return { responses: request.tokens.map(() => ({ success: true })) } })
  const command = input('lost-inbox')
  await assert.rejects(worker.dispatch(command), /lost committed response/)
  const inbox = await db.collection('users/lost-inbox-student-0/notifications').get()
  assert.equal(inbox.size, 1); await inbox.docs[0].ref.update({ read: true })
  const result = await worker.dispatch(command)
  assert.equal(result.complete, true); assert.equal(sends, 1)
  assert.equal((await inbox.docs[0].ref.get()).data().read, true)
})
test('unknown external acceptance is durable in real Firestore and not replayed', async () => {
  let sends = 0
  const worker = service(db, async () => { sends++; throw Error('mock transport acceptance unknown') })
  const command = input('unknown')
  const result = await worker.dispatch(command); const replay = await worker.dispatch(command)
  assert.equal(result.status, 'needs_review'); assert.equal(replay.webPushUnknownCount, 1); assert.equal(sends, 1)
  assert.equal((await db.doc(`system/push_broadcast_logs/logs/${result.logId}`).get()).data().status, 'needs_review')
})
