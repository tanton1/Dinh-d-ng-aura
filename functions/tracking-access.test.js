'use strict'
const assert = require('node:assert/strict')
const { test, before, after } = require('node:test')
const { createEatCleanFunctions } = require('./eat-clean')

const secret = 'tracking-access-fixture-not-a-production-secret'
let originalSecret
before(() => { originalSecret = process.env.DELIVERY_OTP_SECRET; process.env.DELIVERY_OTP_SECRET = secret })
after(() => {
  if (originalSecret === undefined) delete process.env.DELIVERY_OTP_SECRET
  else process.env.DELIVERY_OTP_SECRET = originalSecret
})

function fixture() {
  const records = new Map([
    ['users/owner', { role: 'student', disabled: false }],
    ['users/driver-a', { role: 'shipper' }],
    ['users/driver-b', { role: 'shipper' }],
    ['users/admin', { role: 'admin' }],
    ['users/super-admin', { role: 'super_admin' }],
    ['eatCleanOrders/order-a', { userId: 'owner', status: 'out_for_delivery', code: 'FIXTURE-A' }],
    ['eatCleanDeliveries/order-a', { shipperId: 'driver-a', status: 'picked_up', deliveryOtpHash: 'private-hash', otpFailedAttempts: 2 }],
  ])
  const reads = [], locationReads = [], warnings = []
  let unavailable = false, failedDocument = ''
  const db = { getAll: (...references) => Promise.all(references.map(reference => reference.get())), doc(path) {
    return { async get() {
      reads.push(path)
      if (path === failedDocument) throw Object.assign(Error('Read unavailable'), { code: 'unavailable' })
      const value = records.has(path) ? structuredClone(records.get(path)) : undefined
      return { id: path.split('/').at(-1), exists: value !== undefined, data: () => value }
    } }
  } }
  const realtimeDb = { ref(path) {
    return { async get() {
      locationReads.push(path)
      if (unavailable) throw Object.assign(Error('Location unavailable'), { code: 'database/unavailable' })
      return { exists: () => true, val: () => ({ shipperId: 'driver-a', latitude: 16, longitude: 108, updatedAt: Date.now() }) }
    } }
  } }
  const api = createEatCleanFunctions({
    db, realtimeDb, onCall: (_options, handler) => handler,
    requireTrustedAdmin: async () => { throw Error('Unexpected admin mutation') },
    logger: { info() {}, warn: (...args) => warnings.push(args) },
  })
  const request = (uid = 'owner', role = 'student', orderId = 'order-a') => ({ auth: { uid, token: { role } }, data: { orderId } })
  return {
    records, reads, locationReads, warnings, request,
    read: (value = request()) => api.getEatCleanOrderTracking(value),
    failLocation: () => { unavailable = true },
    failDocument: path => { failedDocument = path },
  }
}

for (const state of ['disabled', 'deleted']) {
  test(`${state} owner cannot read location or OTP with a previously accepted token`, async () => {
    const f = fixture(), request = f.request()
    assert.match((await f.read(request)).deliveryOtp, /^\d{4}$/)
    if (state === 'disabled') f.records.set('users/owner', { role: 'student', disabled: true })
    else f.records.delete('users/owner')
    // Even without the OTP secret, denial must precede OTP derivation.
    const saved = process.env.DELIVERY_OTP_SECRET
    process.env.DELIVERY_OTP_SECRET = ''
    try { await assert.rejects(f.read(request), error => error.code === 'permission-denied') }
    finally { process.env.DELIVERY_OTP_SECRET = saved }
    assert.equal(f.locationReads.length, 1)
    assert.equal(f.reads.filter(path => path === 'users/owner').length, 2)
  })
}

test('anonymous and invalid-order requests fail before database reads', async () => {
  const f = fixture()
  await assert.rejects(f.read({ data: { orderId: 'order-a' } }), error => error.code === 'unauthenticated')
  await assert.rejects(f.read(f.request('owner', 'student', 'nested/order')), error => error.code === 'invalid-argument')
  assert.deepEqual(f.reads, [])
  assert.deepEqual(f.locationReads, [])
})

test('active owner retains location and owner-only OTP with bounded authority, revision and point reads', async () => {
  const f = fixture(), result = await f.read()
  assert.equal(result.order.id, 'order-a')
  assert.equal(result.liveLocation.latitude, 16)
  assert.match(result.deliveryOtp, /^\d{4}$/)
  assert.equal(result.delivery.deliveryOtpHash, undefined)
  assert.equal(result.delivery.otpFailedAttempts, undefined)
  assert.deepEqual(f.reads.sort(), ['eatCleanDeliveries/order-a', 'eatCleanLiveLocationViews/order-a', 'eatCleanOrderChanges/order-a', 'eatCleanOrders/order-a', 'users/owner'])
  assert.deepEqual(result.workspaceSync, { schemaVersion: 1, accountId: 'owner', orderId: 'order-a', version: '0' })
  assert.deepEqual(f.locationReads, ['eatCleanLiveLocations/order-a'])
})

test('legacy active owner without a disabled flag keeps identity-based access without a staff claim', async () => {
  const f = fixture()
  f.records.set('users/owner', { role: 'student' })
  const request = f.request(); request.auth.token = {}
  assert.equal((await f.read(request)).order.id, 'order-a')
})

for (const [uid, role] of [['admin', 'admin'], ['super-admin', 'super_admin'], ['driver-a', 'shipper']]) {
  test(`current ${role} can track an authorized order but cannot obtain the owner's OTP`, async () => {
    const f = fixture(), result = await f.read(f.request(uid, role))
    assert.equal(result.order.id, 'order-a')
    assert.equal(result.liveLocation.latitude, 16)
    assert.equal(result.deliveryOtp, null)
    assert.equal(result.delivery.deliveryOtpHash, undefined)
  })
}

test('unassigned shipper and unrelated customer are denied before location access', async () => {
  const f = fixture()
  f.records.set('users/other-customer', { role: 'student' })
  for (const [uid, role] of [['driver-b', 'shipper'], ['other-customer', 'student']]) {
    await assert.rejects(f.read(f.request(uid, role)), error => error.code === 'permission-denied')
  }
  assert.deepEqual(f.locationReads, [])
})

test('reassignment revokes the former shipper on the next request with the same token', async () => {
  const f = fixture(), a = f.request('driver-a', 'shipper'), b = f.request('driver-b', 'shipper')
  await f.read(a)
  f.records.set('eatCleanDeliveries/order-a', { shipperId: 'driver-b', status: 'assigned' })
  await assert.rejects(f.read(a), error => error.code === 'permission-denied')
  assert.equal((await f.read(b)).delivery.shipperId, 'driver-b')
  assert.equal(f.locationReads.length, 1) // A newly assigned job has no accepted GPS stream.
})

test('changing the current owner revokes the former customer without token refresh', async () => {
  const f = fixture(), request = f.request()
  await f.read(request)
  f.records.set('eatCleanOrders/order-a', { userId: 'new-owner', status: 'out_for_delivery' })
  await assert.rejects(f.read(request), error => error.code === 'permission-denied')
  assert.equal(f.locationReads.length, 1)
})

test('missing, disabled and role-mismatched staff profiles cannot rely on stale claims', async () => {
  for (const [uid, claim] of [['admin', 'admin'], ['super-admin', 'super_admin'], ['driver-a', 'shipper']]) {
    for (const profile of [undefined, { role: claim, disabled: true }, { role: 'student' }]) {
      const f = fixture()
      if (profile) f.records.set(`users/${uid}`, profile)
      else f.records.delete(`users/${uid}`)
      await assert.rejects(f.read(f.request(uid, claim)), error => error.code === 'permission-denied')
      assert.deepEqual(f.locationReads, [])
    }
  }
})

test('a current assigned shipper profile without its matching claim is denied', async () => {
  const f = fixture()
  await assert.rejects(f.read(f.request('driver-a', 'student')), error => error.code === 'permission-denied')
  assert.deepEqual(f.locationReads, [])
})

test('completed and cancelled deliveries read neither live location nor owner OTP', async () => {
  for (const status of ['delivered', 'cancelled']) {
    const f = fixture()
    f.records.set('eatCleanDeliveries/order-a', { shipperId: 'driver-a', status })
    const result = await f.read()
    assert.equal(result.liveLocation, null)
    assert.equal(result.deliveryOtp, null)
    assert.deepEqual(f.locationReads, [])
  }
})

test('an owner can track an order before its delivery is created', async () => {
  const f = fixture(); f.records.delete('eatCleanDeliveries/order-a')
  const result = await f.read()
  assert.equal(result.delivery, null)
  assert.equal(result.deliveryOtp, null)
  assert.deepEqual(f.locationReads, [])
})

test('location failure keeps the authorized timeline and explicit availability warning', async () => {
  const f = fixture(); f.failLocation()
  const result = await f.read()
  assert.equal(result.order.id, 'order-a')
  assert.equal(result.liveLocation, null)
  assert.equal(result.realtimeTracking.warning, 'realtime_temporarily_unavailable')
  assert.equal(f.warnings.length, 1)
})

test('revocation is checked before the missing-order response', async () => {
  const f = fixture(); f.records.delete('eatCleanOrders/order-a')
  await assert.rejects(f.read(), error => error.code === 'not-found')
  f.records.delete('users/owner')
  await assert.rejects(f.read(), error => error.code === 'permission-denied')
  assert.deepEqual(f.locationReads, [])
})

test('an unavailable authoritative profile fails the request without a location read', async () => {
  const f = fixture(); f.failDocument('users/owner')
  await assert.rejects(f.read(), error => error.code === 'unavailable')
  assert.deepEqual(f.locationReads, [])
})
