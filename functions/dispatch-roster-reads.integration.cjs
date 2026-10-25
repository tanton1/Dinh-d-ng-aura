'use strict'
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { test, after } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { createEatCleanFunctions } = require('./eat-clean')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `dispatch-roster-${randomUUID()}`)
const databases = []
const fixture = () => { const db = getFirestore(app, `roster-${randomUUID()}`); databases.push(db); return db }
after(async () => { await Promise.all(databases.map(db => db.terminate())); await deleteApp(app) })
const request = { auth: { uid: 'admin', token: { role: 'admin' } }, data: {} }

function observe(db, authorize = async () => 'admin', { failAvailability = false } = {}) {
  const reads = []
  function query(source, collection, operations = []) {
    return new Proxy(source, { get(target, property) {
      if (property === 'get') return async () => {
        if (collection === 'eatCleanShippers' && failAvailability) throw Object.assign(Error('Unavailable'), { code: 'unavailable' })
        const snapshot = await target.get()
        reads.push({ collection, operations, ids: snapshot.docs.map(row => row.id), fields: snapshot.docs.map(row => Object.keys(row.data()).sort()) })
        return snapshot
      }
      if (['where', 'limit', 'select', 'orderBy', 'startAfter'].includes(property)) return (...args) => query(target[property](...args), collection, [...operations, { method: property, args }])
      return typeof target[property] === 'function' ? target[property].bind(target) : target[property]
    } })
  }
  const api = createEatCleanFunctions({
    db: { doc: name => db.doc(name), collection: name => query(db.collection(name), name), getAll: (...refs) => db.getAll(...refs) },
    onCall: (_options, handler) => handler, requireTrustedAdmin: authorize,
    logger: { warn() {}, info() {} },
  })
  return { read: data => api.listEatCleanDispatchData({ ...request, data: data || {} }), reads }
}

async function seed(db, records) {
  const batch = db.batch()
  for (const [path, data] of records) batch.set(db.doc(path), data)
  await batch.commit()
}

test('real Firestore: an enabled roster after 140 unrelated presence rows keeps its own availability', async () => {
  const db = fixture(), now = Timestamp.fromMillis(1792886400000)
  await seed(db, [
    ...Array.from({ length: 140 }, (_, i) => [`eatCleanShippers/a-${String(i).padStart(3, '0')}`, { available: false, unrelated: true }]),
    ['users/z-ready', { role: 'shipper', displayName: 'Ready', phoneNumber: '0900', photoURL: 'avatar', privateField: 'excluded' }],
    ['users/z-disabled', { role: 'shipper', disabled: true }],
    ['users/z-missing', { role: 'shipper', displayName: 'Missing' }],
    ['users/z-legacy', { role: 'shipper' }],
    ['eatCleanShippers/z-ready', { available: true, lastSeenAt: now, privateField: 'excluded' }],
    ['eatCleanShippers/z-disabled', { available: true }],
    ['eatCleanShippers/z-legacy', { legacyOnly: 'not requested' }],
  ])
  const observer = observe(db), result = await observer.read()
  assert.equal(result.shippers.length, 3)
  assert.equal(result.shippers.find(row => row.id === 'z-ready').available, true)
  assert.equal(result.shippers.find(row => row.id === 'z-ready').lastSeenAt, now.toDate().toISOString())
  assert.equal(result.shippers.find(row => row.id === 'z-missing').available, false)
  assert.equal(result.shippers.find(row => row.id === 'z-legacy').available, false)
  assert.ok(!result.shippers.some(row => row.id === 'z-disabled'))
  const availability = observer.reads.filter(row => row.collection === 'eatCleanShippers')
  assert.equal(availability.length, 1)
  assert.deepEqual(availability[0].ids, ['z-legacy', 'z-ready'])
  assert.deepEqual(availability[0].fields, [[], ['available', 'lastSeenAt']])
  assert.deepEqual(availability[0].operations[0].args[2].sort(), ['z-legacy', 'z-missing', 'z-ready'])
  const profiles = observer.reads.find(row => row.collection === 'users')
  assert.ok(profiles.fields.every(fields => !fields.includes('privateField') && !fields.includes('role')))
  assert.ok(!JSON.stringify(result).includes('excluded'))
})

test('real Firestore: the existing 100-profile page uses four bounded ID batches without hydrating off-page shippers', async () => {
  const db = fixture()
  await seed(db, Array.from({ length: 105 }, (_, i) => {
    const id = `driver-${String(i).padStart(3, '0')}`
    return [[`users/${id}`, { role: 'shipper', displayName: id }], [`eatCleanShippers/${id}`, { available: i % 2 === 0 }]]
  }).flat())
  const observer = observe(db), result = await observer.read()
  assert.equal(result.shippers.length, 100)
  const reads = observer.reads.filter(row => row.collection === 'eatCleanShippers')
  assert.equal(reads.length, 4)
  assert.deepEqual(reads.map(row => row.ids.length).sort((a, b) => a - b), [10, 30, 30, 30])
  assert.deepEqual(reads.flatMap(row => row.ids).sort(), result.shippers.map(row => row.id).sort())
  assert.equal(result.shippers.filter(row => row.available).length, 50)
  assert.ok(reads.every(row => row.operations.find(op => op.method === 'where').args[2].length <= 30))
})

test('real Firestore: empty or entirely disabled roster reads no availability documents', async () => {
  const db = fixture(), observer = observe(db)
  await db.doc('eatCleanShippers/unrelated').set({ available: true })
  assert.deepEqual((await observer.read()).shippers, [])
  await db.doc('users/disabled').set({ role: 'shipper', disabled: true })
  assert.deepEqual((await observer.read()).shippers, [])
  assert.equal(observer.reads.filter(row => row.collection === 'eatCleanShippers').length, 0)
})

test('real Firestore: availability edits, removal and disabled profiles are revalidated on the next authorized read', async () => {
  const db = fixture()
  await seed(db, [['users/a', { role: 'shipper', displayName: 'A' }], ['eatCleanShippers/a', { available: true }]])
  const observer = observe(db)
  assert.equal((await observer.read()).shippers[0].available, true)
  await db.doc('eatCleanShippers/a').update({ available: false })
  assert.equal((await observer.read()).shippers[0].available, false)
  await db.doc('eatCleanShippers/a').delete()
  assert.equal((await observer.read()).shippers[0].available, false)
  await db.doc('users/a').update({ disabled: true })
  assert.deepEqual((await observer.read()).shippers, [])
})

test('real Firestore: delivery paging and whole-scope job counts remain independent of the roster hydration', async () => {
  const db = fixture(), now = Timestamp.now()
  await seed(db, [
    ['users/a', { role: 'shipper', displayName: 'A' }], ['eatCleanShippers/a', { available: true }],
    ...Array.from({ length: 3 }, (_, i) => [`eatCleanDeliveries/job-${i}`, { shipperId: 'a', status: 'assigned', updatedAt: now }]),
    ['eatCleanDeliveries/finished', { shipperId: 'a', status: 'delivered', updatedAt: now }],
    ...Array.from({ length: 3 }, (_, i) => [`eatCleanOrders/job-${i}`, { code: `ORDER-${i}`, total: 1000, items: [{ quantity: 2 }] }]),
  ])
  const observer = observe(db), first = await observer.read({ limit: 1 })
  assert.equal(first.deliveries.length, 1)
  assert.equal(first.summary.totalActive, 3)
  assert.equal(first.shippers[0].activeJobCount, 3)
  assert.equal(first.deliveries[0].itemCount, 2)
  assert.equal(first.page.hasMore, true)
  const next = await observer.read({ limit: 1, cursor: first.page.nextCursor })
  assert.equal(next.summary.totalActive, 3)
  assert.notEqual(next.deliveries[0].id, first.deliveries[0].id)
})

test('authorization failure stops dispatch hydration before any collection read', async () => {
  const observer = observe(fixture(), async () => { throw Object.assign(Error('Access denied'), { code: 'permission-denied' }) })
  await assert.rejects(observer.read(), error => error.code === 'permission-denied')
  assert.deepEqual(observer.reads, [])
})

test('real Firestore fixture: an unavailable presence query fails instead of reporting the roster as unavailable', async () => {
  const db = fixture()
  await seed(db, [['users/a', { role: 'shipper' }], ['eatCleanShippers/a', { available: true }]])
  const observer = observe(db, undefined, { failAvailability: true })
  await assert.rejects(observer.read(), error => error.code === 'unavailable')
})
