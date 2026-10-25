'use strict'
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { test, after } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { createEatCleanFunctions } = require('./eat-clean')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `admin-sections-${randomUUID()}`)
const databases = []
const fixture = () => { const db = getFirestore(app, `admin-sections-${randomUUID()}`); databases.push(db); return db }
after(async () => { await Promise.all(databases.map(db => db.terminate())); await deleteApp(app) })
async function seed(db, { config = true, catalog = true } = {}) {
  const batch = db.batch()
  batch.set(db.doc('users/admin'), { role: 'admin' })
  if (config) batch.set(db.doc('system/eat_clean_config'), { revision: 7, supportPhone: '0900' })
  if (catalog) {
    batch.set(db.doc('eatCleanMeals/one'), { name: 'Meal A', sortOrder: 2 })
    batch.set(db.doc('eatCleanMeals/two'), { name: 'Meal B', sortOrder: 1 })
    batch.set(db.doc('eatCleanInventory/day-one'), { serviceDate: '2026-10-25', capacity: 12, reserved: 3, sold: 2 })
  }
  for (let i = 1; i <= 3; i++) batch.set(db.doc(`eatCleanOrders/order-${i}`), {
    createdAt: Timestamp.fromMillis(i * 1000), serviceDate: i === 3 ? '2026-10-26' : '2026-10-25',
    status: i === 2 ? 'delivered' : 'preparing', total: i * 100,
  })
  batch.set(db.doc('eatCleanRefundJobs/order-1'), { orderId: 'order-1', status: 'pending' })
  batch.set(db.doc('eatCleanDeliveries/order-2'), { status: 'delivered' })
  await batch.commit()
}
function observe(db, { failCollection } = {}) {
  const reads = []
  function wrapQuery(source, name, operations = []) {
    return new Proxy(source, { get(target, property) {
      if (property === 'get') return async () => {
        if (failCollection === name) throw Object.assign(Error('Unavailable'), { code: 'unavailable' })
        const result = await target.get(); reads.push({ kind: 'query', name, operations, returned: result.size }); return result
      }
      if (['where', 'limit', 'select', 'orderBy'].includes(property)) return (...args) => wrapQuery(target[property](...args), name, [...operations, { method: property, args }])
      return typeof target[property] === 'function' ? target[property].bind(target) : target[property]
    } })
  }
  const wrapped = {
    collection: name => wrapQuery(db.collection(name), name),
    doc(name) { const reference = db.doc(name); return new Proxy(reference, { get(target, property) {
      if (property === 'get') return async () => { reads.push({ kind: 'doc', name }); return target.get() }
      return typeof target[property] === 'function' ? target[property].bind(target) : target[property]
    } }) },
    async getAll(...refs) {
      reads.push(...refs.map(ref => ({ kind: 'doc', name: ref.path })))
      return db.getAll(...refs.map(ref => db.doc(ref.path)))
    },
  }
  const api = createEatCleanFunctions({ db: wrapped, onCall: (_options, handler) => handler,
    requireTrustedAdmin: async request => {
      const profile = request.auth && (await wrapped.doc(`users/${request.auth.uid}`).get()).data()
      if (!profile || profile.disabled || !['admin', 'super_admin'].includes(profile.role) || profile.role !== request.auth.token?.role) throw Object.assign(Error('Denied'), { code: 'permission-denied' })
      return request.auth.uid
    },
    realtimeDb: { ref() { throw Error('Catalog reads must not access GPS') } }, logger: { info() {}, warn() {} },
  })
  return { reads, read: (data, auth = { uid: 'admin', token: { role: 'admin' } }) => api.listEatCleanAdminData({ auth, data }) }
}

test('each requested section reads only its data plus authorization and configuration', async () => {
  const db = fixture(); await seed(db)
  for (const section of ['config', 'meals', 'inventory', 'orders']) {
    const { reads, read } = observe(db), result = await read({ sections: [section] })
    assert.deepEqual(result.sections, [section]); assert.equal(result.seeded, true)
    assert.deepEqual(reads.slice(0, 2).map(row => row.name), ['users/admin', 'system/eat_clean_config'])
    const expectedQuery = section === 'config' ? [] : [{ meals: 'eatCleanMeals', inventory: 'eatCleanInventory', orders: 'eatCleanOrders' }[section]]
    assert.deepEqual(reads.filter(row => row.kind === 'query').map(row => row.name), expectedQuery)
    for (const field of ['config', 'meals', 'inventory', 'orders']) assert.equal(Object.hasOwn(result, field), field === section)
    assert.equal(Object.hasOwn(result, 'summary'), section === 'orders')
    assert.equal(reads.length, section === 'config' ? 2 : section === 'orders' ? 9 : 3)
    if (section === 'inventory') assert.equal(result.inventory[0].available, 7)
    if (section === 'meals') assert.deepEqual(result.meals.map(row => row.id), ['two', 'one'])
    if (section === 'orders') {
      assert.equal(result.summary.deliveredRevenue, 200); assert.equal(result.summary.pendingRefunds, 1)
      assert.equal(result.summary.missingDeliveryRecords, 2); assert.equal(result.summary.totalOrders, 3)
      assert.deepEqual(result.coverage.orders, { sourceLimit: 100, sourceRows: 3, returned: 3, limitReached: false, filtersAppliedAfterLimit: true })
    }
  }
})

test('section unions are canonical, do not duplicate queries and preserve the legacy full response', async () => {
  const db = fixture(); await seed(db)
  const { reads, read } = observe(db)
  const partial = await read({ sections: ['config', 'meals'] })
  assert.deepEqual(partial.sections, ['meals', 'config'])
  assert.deepEqual(reads.map(row => row.name), ['users/admin', 'system/eat_clean_config', 'eatCleanMeals'])
  const legacy = await observe(db).read({}), full = await observe(db).read({ sections: ['config', 'inventory', 'meals', 'orders'] })
  const { sections, coverage, ...body } = full
  assert.deepEqual(body, legacy)
  assert.ok(!Object.hasOwn(legacy, 'coverage')); assert.ok(!Object.hasOwn(legacy, 'sections'))
})

test('filtering still selects the same bounded order window and hydrates only matching orders', async () => {
  const db = fixture(); await seed(db)
  const { reads, read } = observe(db)
  const result = await read({ sections: ['orders'], limit: 2, serviceDate: '2026-10-25', status: 'delivered' })
  assert.deepEqual(result.orders.map(row => row.id), ['order-2'])
  assert.deepEqual(reads.filter(row => row.kind === 'doc').map(row => row.name), ['users/admin', 'system/eat_clean_config', 'eatCleanRefundJobs/order-2', 'eatCleanDeliveries/order-2'])
  assert.deepEqual(result.coverage.orders, { sourceLimit: 2, sourceRows: 2, returned: 1, limitReached: true, filtersAppliedAfterLimit: true })
  const legacy = await observe(db).read({ limit: 2, serviceDate: '2026-10-25', status: 'delivered' })
  assert.deepEqual(result.orders, legacy.orders); assert.deepEqual(result.summary, legacy.summary)
  const empty = observe(db), response = await empty.read({ sections: ['orders'], status: 'cancelled' })
  assert.equal(response.orders.length, 0); assert.equal(response.summary.totalOrders, 0)
  assert.equal(empty.reads.filter(row => row.name.startsWith('eatCleanRefundJobs/') || row.name.startsWith('eatCleanDeliveries/')).length, 0)
})

test('legacy catalog existence probes return at most one ID per missing source without exposing it', async () => {
  const db = fixture(); await seed(db, { config: false })
  const { reads, read } = observe(db), result = await read({ sections: ['config'] })
  assert.equal(result.seeded, true); assert.equal(result.config.revision, 0)
  for (const row of reads.filter(row => row.kind === 'query')) {
    assert.ok(row.returned <= 1); assert.deepEqual(row.operations, [{ method: 'select', args: [] }, { method: 'limit', args: [1] }])
  }
  assert.deepEqual(reads.filter(row => row.kind === 'query').map(row => row.name).sort(), ['eatCleanInventory', 'eatCleanMeals'])
  for (const key of ['meals', 'inventory', 'orders']) assert.ok(!Object.hasOwn(result, key))
})

test('date-filtered empty inventory does not incorrectly declare a legacy catalog uninitialized', async () => {
  const db = fixture(); await seed(db, { config: false, catalog: false })
  await db.doc('eatCleanInventory/other-day').set({ serviceDate: '2026-10-20', capacity: 2 })
  const { reads, read } = observe(db), result = await read({ sections: ['inventory'], serviceDate: '2026-10-25' })
  assert.equal(result.seeded, true); assert.deepEqual(result.inventory, [])
  assert.equal(reads.filter(row => row.name === 'eatCleanInventory').length, 2)
  assert.ok(reads.some(row => row.name === 'eatCleanInventory' && row.operations[0]?.method === 'select'))
  const allInventory = observe(db), all = await allInventory.read({ sections: ['inventory'] })
  assert.equal(all.seeded, true); assert.equal(allInventory.reads.filter(row => row.kind === 'query').length, 1)
})

test('empty catalogs remain explicitly unseeded; orders alone do not imply catalog initialization', async () => {
  const db = fixture(); await seed(db, { config: false, catalog: false })
  const { reads, read } = observe(db), result = await read({ sections: ['meals', 'inventory'] })
  assert.equal(result.seeded, false); assert.deepEqual(result.meals, []); assert.deepEqual(result.inventory, [])
  assert.equal(reads.filter(row => row.kind === 'query').length, 2)
  assert.equal((await observe(db).read({ sections: ['orders'] })).seeded, false)
})

test('source caps remain bounded and are disclosed without pretending to prove another page exists', async () => {
  const db = fixture(); await seed(db)
  const writer = db.bulkWriter()
  for (let i = 0; i < 510; i++) {
    writer.set(db.doc(`eatCleanInventory/bulk-${i}`), { serviceDate: '2026-10-25', capacity: 10 })
    if (i < 210) writer.set(db.doc(`eatCleanMeals/bulk-${i}`), { name: `Meal ${i}`, sortOrder: i })
  }
  await writer.close()
  const { reads, read } = observe(db), result = await read({ sections: ['meals', 'inventory'] })
  assert.deepEqual(result.coverage, { meals: { limit: 200, returned: 200, limitReached: true }, inventory: { limit: 500, returned: 500, limitReached: true } })
  assert.equal(reads.filter(row => row.kind === 'query').reduce((n, row) => n + row.returned, 0), 700)
  assert.equal(reads.filter(row => row.name === 'eatCleanOrders').length, 0)
})

test('invalid sections and stale authority stop before business data; requested errors fail the request', async () => {
  const db = fixture(); await seed(db)
  for (const sections of [null, [], 'orders', ['orders', 'orders'], ['unknown'], [null], ['orders', 'meals', 'inventory', 'config', 'orders']]) {
    const { reads, read } = observe(db)
    await assert.rejects(read({ sections }), error => error.code === 'invalid-argument')
    assert.deepEqual(reads, [{ kind: 'doc', name: 'users/admin' }])
  }
  await assert.rejects(observe(db, { failCollection: 'eatCleanMeals' }).read({ sections: ['meals'] }), error => error.code === 'unavailable')
  // An unavailable unrequested source cannot break a scoped read.
  assert.equal((await observe(db, { failCollection: 'eatCleanMeals' }).read({ sections: ['config'] })).config.revision, 7)
  for (const profile of [{ role: 'admin', disabled: true }, { role: 'student' }, null]) {
    if (profile) await db.doc('users/admin').set(profile); else await db.doc('users/admin').delete()
    const { reads, read } = observe(db)
    await assert.rejects(read({ sections: ['orders'] }), error => error.code === 'permission-denied')
    assert.deepEqual(reads, [{ kind: 'doc', name: 'users/admin' }])
  }
})
