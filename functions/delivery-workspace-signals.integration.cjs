'use strict'
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { test, after } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { syncDeliveryWorkspaceChange: sync, readDeliveryWorkspaceState: read, createDeliveryWorkspaceTriggers } = require('./delivery-workspace-signals')
const { createEatCleanFunctions } = require('./eat-clean')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `delivery-events-${randomUUID()}`)
const databases = []
const fixture = () => { const db = getFirestore(app, `delivery-${randomUUID()}`); databases.push(db); return db }
after(async () => { await Promise.all(databases.map(db => db.terminate())); await deleteApp(app) })
const time = n => `2026-10-25T01:00:${String(n).padStart(2, '0')}.123456789Z`
function event(db, path, before, after, n = 1) {
  const snapshot = value => ({ exists: value !== null, data: () => value, updateTime: time(n), ref: db.doc(path) })
  return { time: time(n), data: { before: snapshot(before), after: snapshot(after) } }
}
const signal = (db, path, before, after, n) => sync({ db, event: event(db, path, before, after, n), source: path.split('/')[0] })

test('real Firestore: four concurrent replays publish each target once, with no business payload', async () => {
  const db = fixture(), delivery = { shipperId: 'driver-a', status: 'assigned', customer: { phone: 'private' }, deliveryOtpHash: 'secret' }
  const results = await Promise.all(Array.from({ length: 4 }, () => signal(db, 'eatCleanDeliveries/order-a', null, delivery, 1)))
  assert.equal(results.reduce((sum, row) => sum + row.changed, 0), 2)
  const first = await db.doc('eatCleanDriverChanges/driver-a').get()
  assert.deepEqual(Object.keys(first.data()).sort(), ['schemaVersion', 'updatedAt', 'version'])
  assert.equal((await signal(db, 'eatCleanDeliveries/order-a', null, delivery, 1)).changed, 0)
  assert.ok(first.updateTime.isEqual((await first.ref.get()).updateTime))
})

test('real Firestore: delayed A to B after B to C still invalidates removed A without regressing B or C', async () => {
  const db = fixture(), a = { shipperId: 'a' }, b = { shipperId: 'b' }, c = { shipperId: 'c' }
  await signal(db, 'eatCleanDeliveries/order-a', b, c, 3)
  const newer = await db.doc('eatCleanDriverChanges/b').get()
  assert.equal((await signal(db, 'eatCleanDeliveries/order-a', a, b, 2)).changed, 1)
  assert.ok((await db.doc('eatCleanDriverChanges/a').get()).exists)
  assert.ok(newer.updateTime.isEqual((await newer.ref.get()).updateTime))
  assert.equal((await db.doc('eatCleanDriverChanges/c').get()).data().version, newer.data().version)
})

test('real Firestore: delete/recreate and a late delete preserve newest work and still notify old owner', async () => {
  const db = fixture()
  await signal(db, 'eatCleanDeliveries/order-a', null, { shipperId: 'a' }, 1)
  await signal(db, 'eatCleanDeliveries/order-a', null, { shipperId: 'b' }, 4)
  const deletion = event(db, 'eatCleanDeliveries/order-a', { shipperId: 'a' }, null, 3)
  deletion.data.before.updateTime = time(1)
  await sync({ db, source: 'eatCleanDeliveries', event: deletion })
  const a = (await db.doc('eatCleanDriverChanges/a').get()).data().version
  assert.ok(a.endsWith('.123456789'))
  assert.ok(a > (await read({ db, actorId: 'never-assigned', role: 'shipper' })).userVersion)
  assert.ok((await read({ db, actorId: 'b', role: 'shipper' })).userVersion > a)
})

test('real Firestore: order edits cover legacy current and old/new explicit assignees, without inventory scans', async () => {
  const db = fixture()
  await db.doc('eatCleanDeliveries/order-a').set({ shipperId: 'c' })
  assert.equal((await signal(db, 'eatCleanOrders/order-a', { assignedShipperId: 'a', total: 10 }, { assignedShipperId: 'b', total: 20 }, 2)).targets, 4)
  for (const uid of ['a', 'b', 'c']) assert.ok((await db.doc(`eatCleanDriverChanges/${uid}`).get()).exists)
  await db.doc('eatCleanDeliveries/legacy').set({ shipperId: 'legacy-driver' })
  assert.equal((await signal(db, 'eatCleanOrders/legacy', { total: 10 }, { total: 0 }, 3)).targets, 2)
  assert.ok((await db.doc('eatCleanDriverChanges/legacy-driver').get()).exists)
})

test('real Firestore: shipper/config edits are scoped, and delivery sort-key changes are significant', async () => {
  const db = fixture()
  assert.equal((await signal(db, 'eatCleanShippers/a', { available: false }, { available: true }, 1)).targets, 2)
  assert.equal((await signal(db, 'system/eat_clean_config', null, { revision: 1 }, 2)).targets, 1)
  const a = await read({ db, actorId: 'a', role: 'shipper' }), b = await read({ db, actorId: 'b', role: 'shipper' })
  assert.notEqual(a.userVersion, b.userVersion)
  assert.equal(a.policyVersion, b.policyVersion)
  assert.equal((await signal(db, 'eatCleanDeliveries/order-a', { shipperId: 'a', updatedAt: 1 }, { shipperId: 'a', updatedAt: 2 }, 3)).changed, 2)
})

test('metadata-only order/config writes do zero database work; unsupported paths/timestamps fail before publication', async () => {
  const db = fixture(), unused = { doc() { throw Error('unexpected database read') } }
  for (const path of ['eatCleanOrders/order-a', 'system/eat_clean_config']) {
    const e = event(db, path, { total: 10, updatedAt: 1 }, { total: 10, updatedAt: 2 })
    assert.equal((await sync({ db: unused, event: e, source: path.split('/')[0] })).changed, 0)
  }
  await assert.rejects(signal(db, 'system/unrelated', null, {}, 1), /INVALID_SOURCE/)
  const invalid = event(db, 'eatCleanDeliveries/order-a', null, {}, 1)
  invalid.time = ''; invalid.data.after.updateTime = ''
  await assert.rejects(sync({ db, source: 'eatCleanDeliveries', event: invalid }), /MISSING_COMMIT_TIME/)
})

test('real Firestore: actual authorized callable acknowledges markers before hydration, preserves paging and privacy', async () => {
  const db = fixture(), request = { auth: { uid: 'a', token: { role: 'shipper' } }, data: { limit: 1 } }
  await Promise.all([
    db.doc('users/a').set({ role: 'shipper' }), db.doc('users/admin').set({ role: 'admin' }),
    db.doc('eatCleanDeliveries/a1').set({ shipperId: 'a', status: 'assigned', updatedAt: Timestamp.now(), deliveryOtpHash: 'private' }),
    db.doc('eatCleanDeliveries/a2').set({ shipperId: 'a', status: 'accepted', updatedAt: Timestamp.now() }),
    db.doc('eatCleanDeliveries/b1').set({ shipperId: 'b', status: 'assigned', updatedAt: Timestamp.now() }),
    db.doc('eatCleanOrders/a1').set({ code: 'A1', total: 100, customer: { name: 'Customer' } }),
  ])
  let raced = false
  const wrapped = { doc: path => db.doc(path), collection: path => db.collection(path), async getAll(...refs) {
    const snapshots = await db.getAll(...refs)
    if (!raced && refs[0].path.startsWith('eatCleanDriverChanges/')) {
      raced = true
      await signal(db, 'eatCleanDeliveries/a1', { shipperId: 'a', status: 'assigned' }, { shipperId: 'a', status: 'accepted' }, 4)
    }
    return snapshots
  } }
  const api = createEatCleanFunctions({ db: wrapped, onCall: (_options, handler) => handler, requireTrustedAdmin: async () => 'admin', logger: { warn() {}, info() {} } })
  const result = await api.listMyShipperJobs(request)
  assert.equal(result.workspaceSync.accountId, 'a')
  assert.equal(result.workspaceSync.userVersion, '0')
  assert.ok((await read({ db, actorId: 'a', role: 'shipper' })).userVersion > result.workspaceSync.userVersion)
  assert.equal(result.deliveries.length, 1); assert.equal(result.driver.activeJobCount, 2)
  assert.equal(result.page.hasMore, true); assert.ok(result.page.nextCursor)
  assert.ok(!JSON.stringify(result).includes('private'))
  const admin = await api.listMyShipperJobs({ auth: { uid: 'admin', token: { role: 'admin' } }, data: {} })
  assert.equal(admin.workspaceSync.scope, 'dispatch'); assert.equal(admin.deliveries.length, 3)
  await db.doc('users/a').update({ disabled: true })
  await assert.rejects(api.listMyShipperJobs(request), error => error.code === 'permission-denied')
  await db.doc('users/a').update({ disabled: false, role: 'student' })
  await assert.rejects(api.listMyShipperJobs(request), error => error.code === 'permission-denied')
})

test('trigger factory covers the four canonical sources in the existing database/region without GPS subscriptions', () => {
  const registrations = []
  const result = createDeliveryWorkspaceTriggers({ db: {}, databaseId: 'named', onDocumentWritten: (options, handler) => { registrations.push(options); return handler } })
  assert.equal(Object.keys(result).length, 4)
  assert.deepEqual(registrations.map(row => row.document), ['eatCleanOrders/{orderId}', 'eatCleanDeliveries/{orderId}', 'eatCleanShippers/{shipperId}', 'system/eat_clean_config'])
  assert.ok(registrations.every(row => row.database === 'named' && row.region === 'asia-southeast1' && row.minInstances === 0 && row.retry))
})
