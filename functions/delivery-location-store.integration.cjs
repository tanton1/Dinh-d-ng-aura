'use strict'
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { test, after, before } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { COLLECTION, RETENTION_MS, writeFirestoreLocation: write, readFirestoreLocations: read } = require('./delivery-location-store')
const { syncDeliveryWorkspaceChange: signal } = require('./delivery-workspace-signals')
const { createEatCleanFunctions, __test: { distanceBetweenCoordinates: distance } } = require('./eat-clean')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness-rtdb' }, `location-store-${randomUUID()}`)
const databases = []
let originalSecret
before(() => { originalSecret = process.env.DELIVERY_OTP_SECRET; process.env.DELIVERY_OTP_SECRET = 'synthetic-location-test-secret-not-a-production-key' })
after(async () => {
  if (originalSecret === undefined) delete process.env.DELIVERY_OTP_SECRET
  else process.env.DELIVERY_OTP_SECRET = originalSecret
  await Promise.all(databases.map(db => db.terminate())); await deleteApp(app)
})
const position = (now, patch = {}) => ({ latitude: 16, longitude: 108, capturedAt: now, accuracyMeters: 5, ...patch })
const request = (uid = 'driver', role = 'shipper', data = {}) => ({ auth: { uid, token: { role } }, data: { orderId: 'order', ...position(Date.now()), ...data } })
async function fixture() {
  const db = getFirestore(app, `points-${randomUUID()}`); databases.push(db)
  const now = Date.now()
  const delivery = { shipperId: 'driver', userId: 'owner', status: 'accepted', assignedAt: Timestamp.fromMillis(now - 200000), acceptedAt: Timestamp.fromMillis(now - 100000), updatedAt: Timestamp.fromMillis(now), createdAt: Timestamp.fromMillis(now - 200000) }
  await Promise.all([
    db.doc('users/driver').set({ role: 'shipper', displayName: 'Driver' }),
    db.doc('users/other').set({ role: 'shipper', displayName: 'Other' }),
    db.doc('users/owner').set({ role: 'student' }),
    db.doc('users/admin').set({ role: 'admin' }),
    db.doc('eatCleanDeliveries/order').set(delivery),
    db.doc('eatCleanOrders/order').set({ userId: 'owner', status: 'preparing', code: 'FIXTURE', total: 100, items: [], customer: { name: 'Synthetic customer' } }),
  ])
  const rtdbCalls = []
  const realtimeDb = { ref(path) { rtdbCalls.push(path); return { set: async () => {} } } }
  const api = createEatCleanFunctions({ db, realtimeDb, onCall: (_options, handler) => handler, requireTrustedAdmin: async () => 'admin', logger: { warn() {}, info() {} } })
  return { db, now, delivery, api, rtdbCalls, reference: db.doc(`${COLLECTION}/order`), publish: (patch = {}, tick = now) => write({ db, request: request(), orderId: 'order', position: position(tick, patch), distance, now: () => tick }) }
}

test('eight concurrent fixes commit one point, without changing business documents, revisions or RTDB', async () => {
  const f = await fixture()
  const paths = ['users/driver', 'eatCleanDeliveries/order', 'eatCleanOrders/order']
  const before = await f.db.getAll(...paths.map(path => f.db.doc(path)))
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => f.publish({ latitude: 16 + i / 10000 })))
  assert.equal(results.filter(result => !result.throttled).length, 1)
  assert.ok(results.filter(result => result.throttled).every(result => result.reason === 'interval'))
  const after = await f.db.getAll(...paths.map(path => f.db.doc(path)))
  assert.ok(before.every((row, i) => row.updateTime.isEqual(after[i].updateTime)))
  assert.equal((await f.db.collection(COLLECTION).get()).size, 1)
  for (const collection of ['eatCleanOrderChanges', 'eatCleanDriverChanges', 'eatCleanWorkspaceChanges']) assert.equal((await f.db.collection(collection).get()).size, 0)
  assert.deepEqual(f.rtdbCalls, [])
})

test('quality rejection and stationary throttling preserve the last accepted write and 24-hour expiry', async () => {
  const f = await fixture(); await f.publish()
  const first = await f.reference.get()
  assert.equal(first.data().expiresAt.toMillis(), f.now + RETENTION_MS)
  for (const [patch, tick, reason] of [
    [{ accuracyMeters: 500 }, f.now + 20000, 'accuracy'],
    [{ capturedAt: f.now - 31000 }, f.now + 20000, 'sample_age'],
    [{ capturedAt: f.now }, f.now + 20000, 'older_sample'],
    [{ latitude: 18 }, f.now + 20000, 'outlier'],
    [{}, f.now + 20000, 'stationary'],
  ]) {
    assert.equal((await f.publish(patch, tick)).reason, reason)
    assert.ok(first.updateTime.isEqual((await f.reference.get()).updateTime))
  }
  assert.equal((await f.publish({}, f.now + 60000)).throttled, false)
})

test('actual callable accepts old clients without capturedAt, keeps its public result and makes no RTDB write', async () => {
  const f = await fixture(), legacy = request(); delete legacy.data.capturedAt
  const result = await f.api.updateEatCleanShipperLocation(legacy)
  assert.equal(result.throttled, false)
  assert.equal(result.location.latitude, 16)
  assert.equal(typeof result.location.expiresAt, 'number')
  assert.equal(result.location.assignmentAt, undefined)
  assert.equal(result.location.customerId, undefined)
  assert.deepEqual(f.rtdbCalls, [])
  assert.ok((await f.reference.get()).exists)
})

test('actual callable denies anonymous, invalid, unassigned, disabled, deleted and stale-role actors before publishing', async () => {
  const f = await fixture()
  await assert.rejects(f.api.updateEatCleanShipperLocation({ data: {} }), error => error.code === 'unauthenticated')
  await assert.rejects(f.api.updateEatCleanShipperLocation(request('driver', 'shipper', { orderId: 'nested/id' })), error => error.code === 'invalid-argument')
  await assert.rejects(f.api.updateEatCleanShipperLocation(request('other')), error => error.code === 'permission-denied')
  for (const profile of [{ role: 'shipper', disabled: true }, { role: 'student' }, null]) {
    if (profile) await f.db.doc('users/driver').set(profile); else await f.db.doc('users/driver').delete()
    await assert.rejects(f.api.updateEatCleanShipperLocation(request()), error => error.code === 'permission-denied')
  }
  assert.equal((await f.reference.get()).exists, false)
  assert.deepEqual(f.rtdbCalls, [])
})

test('terminal and reassigned jobs stop writes with the same previously valid token', async () => {
  const f = await fixture(); await f.publish()
  const first = await f.reference.get()
  for (const status of ['assigned', 'delivered', 'cancelled']) {
    await f.db.doc('eatCleanDeliveries/order').update({ status })
    await assert.rejects(f.api.updateEatCleanShipperLocation(request()), error => error.code === 'failed-precondition')
  }
  await f.db.doc('eatCleanDeliveries/order').update({ status: 'accepted', shipperId: 'other' })
  await assert.rejects(f.api.updateEatCleanShipperLocation(request()), error => error.code === 'permission-denied')
  assert.ok(first.updateTime.isEqual((await f.reference.get()).updateTime))
})

test('request fields cannot forge the order, assignee, acceptance, expiry or internal fields', async () => {
  const f = await fixture()
  const result = await f.publish({ orderId: 'stolen', shipperId: 'other', assignmentAt: null, acceptanceAt: null, expiresAt: 1, active: false, private: 'never-store' })
  const stored = (await f.reference.get()).data()
  assert.equal(stored.orderId, 'order'); assert.equal(stored.shipperId, 'driver')
  assert.ok(stored.assignmentAt.isEqual(f.delivery.assignedAt))
  assert.ok(stored.acceptanceAt.isEqual(f.delivery.acceptedAt))
  assert.equal(stored.expiresAt.toMillis(), f.now + RETENTION_MS)
  assert.equal(stored.private, undefined); assert.equal(result.location.private, undefined)
})

test('actual reassignment and acceptance clear the former point atomically, including A→B→A', async () => {
  const f = await fixture(); await f.publish()
  for (const shipperId of ['other', 'driver']) {
    await f.api.assignEatCleanShipper(request('admin', 'admin', { shipperId }))
    assert.equal((await f.reference.get()).exists, false)
    // A legacy assignment mirror must also be removed at acceptance.
    await f.reference.set({ legacy: true })
    await f.api.acceptEatCleanDelivery(request(shipperId))
    assert.equal((await f.reference.get()).exists, false)
    const result = await f.api.updateEatCleanShipperLocation(request(shipperId))
    assert.equal(result.throttled, false)
    assert.equal(result.location.shipperId, shipperId)
  }
})

test('new primary is read once per displayed active ID, never falls back for stale or mismatched primary', async () => {
  const f = await fixture(); await f.publish()
  const deliveries = [{ ...f.delivery, id: 'order' }, { id: 'terminal', status: 'delivered' }, { id: 'queued', status: 'assigned' }]
  const fallback = { ref() { throw Error('unexpected legacy fallback') } }
  assert.equal((await read({ db: f.db, realtimeDb: fallback, deliveries })).size, 1)
  for (const patch of [{ shipperId: 'other' }, { assignmentAt: Timestamp.fromMillis(f.now) }, { acceptanceAt: Timestamp.fromMillis(f.now) }, { expiresAt: Timestamp.fromMillis(f.now - 1) }, { active: false }]) {
    const previous = (await f.reference.get()).data()
    await f.reference.set({ ...previous, ...patch })
    assert.equal((await read({ db: f.db, realtimeDb: fallback, deliveries })).size, 0)
    await f.reference.set(previous)
  }
  await assert.rejects(read({ db: f.db, deliveries: Array.from({ length: 201 }, (_, i) => ({ id: `id-${i}`, status: 'accepted' })) }), /SCOPE_INVALID/)
  await assert.rejects(read({ db: f.db, deliveries: [deliveries[0], deliveries[0]] }), /SCOPE_INVALID/)
})

test('legacy fallback is scoped, sanitized and rejects a previous acceptance of the same shipper', async () => {
  const f = await fixture(), calls = []
  let legacy = { ...position(f.now), updatedAt: f.now, shipperId: 'driver', active: true, private: 'excluded' }
  const realtimeDb = { ref(path) { calls.push(path); return { get: async () => ({ exists: () => true, val: () => legacy }) } } }
  const run = () => read({ db: f.db, realtimeDb, deliveries: [{ ...f.delivery, id: 'order' }] })
  assert.equal((await run()).get('order').latitude, 16)
  assert.equal((await run()).get('order').private, undefined)
  legacy.updatedAt = f.delivery.acceptedAt.toMillis() - 1
  assert.equal((await run()).size, 0)
  assert.ok(calls.every(path => path === 'eatCleanLiveLocations/order'))
  assert.equal((await read({ db: { getAll() { throw Error('no reads expected') } }, realtimeDb, deliveries: [] })).size, 0)
})

test('tracking acknowledges the pre-hydration order version and skips RTDB when a primary point exists', async () => {
  const f = await fixture(); await f.publish()
  let raced = false
  const db = { getAll: (...refs) => f.db.getAll(...refs), doc(path) {
    const ref = f.db.doc(path)
    return { async get() {
      const snapshot = await ref.get()
      if (!raced && path === 'eatCleanOrderChanges/order') {
        raced = true
        const after = await f.db.doc('eatCleanOrders/order').get()
        await signal({ db: f.db, source: 'eatCleanOrders', event: { time: new Date().toISOString(), data: { before: { exists: false, ref: after.ref }, after } } })
      }
      return snapshot
    }, ...Object.fromEntries(['path', 'id'].map(key => [key, ref[key]])) }
  } }
  // getAll requires real DocumentReferences; only the watermark is intercepted.
  const wrapper = { ...db, doc: path => path === 'eatCleanOrderChanges/order' ? db.doc(path) : f.db.doc(path) }
  const api = createEatCleanFunctions({ db: wrapper, realtimeDb: { ref() { throw Error('unexpected RTDB read') } }, onCall: (_options, handler) => handler, requireTrustedAdmin: async () => 'admin', logger: { warn() {}, info() {} } })
  const result = await api.getEatCleanOrderTracking(request('owner', 'student'))
  assert.equal(result.workspaceSync.version, '0')
  assert.notEqual((await f.db.doc('eatCleanOrderChanges/order').get()).data().version, '0')
  assert.equal(result.liveLocation.latitude, 16)
  assert.equal(result.realtimeTracking.synced, true)
  assert.equal(result.realtimeTracking.transport, 'firestore')
  assert.equal(result.locationStream.enabled, true)
  assert.match(result.locationStream.binding, /^[a-f0-9]{64}$/)
  assert.match(result.deliveryOtp, /^\d{4}$/)
})
