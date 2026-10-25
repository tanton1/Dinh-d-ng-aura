'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getDatabase } = require('firebase-admin/database')
const { writeLiveLocation } = require('./delivery-location-policy')
const { __test: { distanceBetweenCoordinates: distance } } = require('./eat-clean')

if (!process.env.FIREBASE_DATABASE_EMULATOR_HOST) throw new Error('RTDB emulator is required')
const app = initializeApp({ projectId: 'demo-aura-fitness-rtdb', databaseURL: 'https://demo-aura-fitness-rtdb-default-rtdb.firebaseio.com' }, 'location-tests')
const database = getDatabase(app)
test.after(() => deleteApp(app))
const point = (now, patch = {}) => ({ orderId: 'order', shipperId: 'driver', customerId: 'customer', latitude: 16, longitude: 108, accuracyMeters: 5, capturedAt: now, updatedAt: now, expiresAt: now + 86400000, active: true, ...patch })
const write = (reference, payload, now) => writeLiveLocation({ reference, payload, acceptedAt: now - 100000, distance, now: () => now })

test('simultaneous writers commit one position per interval even when coordinates move', async () => {
  const reference = database.ref('locationTests/concurrent')
  await reference.remove()
  const now = Date.now()
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => write(reference, point(now, { latitude: 16 + index / 10000 }), now)))
  assert.equal(results.filter(result => !result.throttled).length, 1)
  assert.ok(results.filter(result => result.throttled).every(result => result.reason === 'interval'))
  const second = await write(reference, point(now + 15000, { latitude: 16.001 }), now + 15000)
  assert.equal(second.throttled, false)
})

test('replayed, inaccurate, old and outlier fixes do not write RTDB', async () => {
  const reference = database.ref('locationTests/quality')
  const now = Date.now()
  const initial = point(now)
  await reference.set(initial)
  for (const [patch, reason] of [[{ accuracyMeters: 500 }, 'accuracy'], [{ capturedAt: now - 31000 }, 'sample_age'], [{ capturedAt: now }, 'older_sample'], [{ latitude: 18 }, 'outlier']]) {
    const result = await write(reference, point(now + 20000, patch), now + 20000)
    assert.equal(result.throttled, true)
    assert.equal(result.reason, reason)
    assert.deepEqual((await reference.get()).val(), initial)
  }
})

test('inactive completion and reassignment beat a location writer that read the earlier delivery', async () => {
  const reference = database.ref('locationTests/closed')
  const now = Date.now()
  await reference.set(point(now, { active: false }))
  assert.equal((await write(reference, point(now + 20000), now + 20000)).reason, 'inactive')
  await reference.set(point(now, { shipperId: 'new-driver' }))
  assert.equal((await write(reference, point(now + 20000), now + 20000)).reason, 'assignment_changed')
  assert.equal((await reference.get()).val().shipperId, 'new-driver')
})

test('an old inactive assignment mirror may recover after an authoritative acceptance', async () => {
  const reference = database.ref('locationTests/accept')
  const now = Date.now()
  await reference.set({ shipperId: 'driver', active: false, updatedAt: now - 200000 })
  assert.equal((await write(reference, point(now), now)).throttled, false)
})

// Current callable and authorization coverage uses real Firestore transactions
// in delivery-location-store.integration.cjs. These retain legacy RTDB coverage.
