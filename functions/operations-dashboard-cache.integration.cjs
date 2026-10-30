'use strict'
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { test, after } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { createSharedDashboardCache, CACHE_COLLECTION, BUILD_LEASE_MS, BUILD_WAIT_DELAYS_MS } = require('./operations-dashboard-cache')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const clients = [], apps = []
after(async () => { await Promise.all(clients.map(db => db.terminate())); await Promise.all(apps.map(app => deleteApp(app))) })
function fixture(options = {}) {
  const database = `dashboard-cache-${randomUUID()}`
  const dbs = [0, 1].map(() => {
    const app = initializeApp({ projectId: 'demo-aura-fitness' }, randomUUID()); apps.push(app)
    const db = getFirestore(app, database); clients.push(db); return db
  })
  return { dbs, caches: dbs.map(db => createSharedDashboardCache({ db, logger: { warn() {} }, ...options })) }
}

test('reporting opt-in coalesces explicit refreshes across instances instead of replacing live leases', { timeout: 15000 }, async () => {
  let clock = 1000, waiting, resume
  const followerWaiting = new Promise(resolve => { waiting = resolve })
  const published = new Promise(resolve => { resume = resolve })
  const { dbs: [db], caches: [first, second] } = fixture({ coalesceRefresh: true, buildLeaseMs: 120_000, now: () => clock, pause: async () => { waiting(); await published } })
  await db.doc('sources/current').set({ total: 1 })
  const original = await first.acquire('report-refresh')
  const originalSource = await db.doc('sources/current').get()
  await first.publish('report-refresh', originalSource.data(), original.lease, { sourceReadTime: originalSource.readTime })
  await db.doc('sources/current').set({ total: 2 })
  clock = 2000
  let builds = 0
  const results = await Promise.all([first, second].map(async cache => {
    const claim = await cache.acquire('report-refresh', true)
    if (claim.cached) return claim.cached
    builds++
    await followerWaiting
    clock = 2001
    const source = await db.doc('sources/current').get()
    assert.equal(await cache.publish('report-refresh', source.data(), claim.lease, { sourceReadTime: source.readTime }), true)
    resume()
    return { total: 2 }
  }))
  assert.equal(builds, 1)
  assert.ok(results.every(value => value.total === 2))
  assert.equal(results.filter(value => value.cache?.hit).length, 1)
})

test('post-mutation refresh cannot accept a pre-mutation snapshot published later by another instance', { timeout: 15000 }, async () => {
  let waiting, resume
  const followerWaiting = new Promise(resolve => { waiting = resolve })
  const published = new Promise(resolve => { resume = resolve })
  // Deliberately freeze wall time: publication/lease clocks cannot establish
  // source freshness, even when all calls appear to happen in the same ms.
  const { dbs: [db, otherDb], caches: [first, second] } = fixture({ coalesceRefresh: true, now: () => 1000, pause: async () => { waiting(); await published } })
  await db.doc('sources/current').set({ total: 1 })
  const oldClaim = await first.acquire('payment-report')
  const oldSnapshot = await db.doc('sources/current').get()
  await otherDb.doc('sources/current').set({ total: 2 })
  const refresh = second.acquire('payment-report', true)
  await followerWaiting
  assert.equal(await first.publish('payment-report', oldSnapshot.data(), oldClaim.lease, { sourceReadTime: oldSnapshot.readTime }), true)
  resume()
  const refreshedClaim = await refresh
  assert.equal(refreshedClaim.cached, undefined, 'late publication must not disguise the old source snapshot as fresh')
  assert.ok(refreshedClaim.lease)
  const freshSnapshot = await otherDb.doc('sources/current').get()
  assert.equal(await second.publish('payment-report', freshSnapshot.data(), refreshedClaim.lease, { sourceReadTime: freshSnapshot.readTime }), true)
  assert.equal((await first.get('payment-report')).total, 2)
  const stored = (await db.doc(`${CACHE_COLLECTION}/payment-report`).get()).data()
  assert.equal(stored.valueSourceReadTime.isEqual(freshSnapshot.readTime), true)
})

test('simultaneous cold misses on independent instances build once; followers reuse the published result', { timeout: 15000 }, async () => {
  let waiting, resume
  const followerWaiting = new Promise(resolve => { waiting = resolve })
  const published = new Promise(resolve => { resume = resolve })
  const { caches: [first, second] } = fixture({ pause: async () => { waiting(); await published } })
  let builds = 0
  const results = await Promise.all([first, second].map(async cache => {
    const claim = await cache.acquire('same-scope')
    if (claim.cached) return claim.cached
    builds++
    await followerWaiting
    assert.equal(await cache.publish('same-scope', { total: 100, generatedAt: 'first' }, claim.lease), true)
    resume()
    return { total: 100, cache: { hit: false } }
  }))
  assert.equal(builds, 1)
  assert.ok(results.every(result => result.total === 100))
  assert.equal(results.filter(result => result.cache.tier === 'shared').length, 1)
  assert.equal((await second.acquire('same-scope')).cached.total, 100)
})

test('a newer forced refresh fences an older worker across instances and cleanup cannot clear the new lease', async () => {
  const { dbs: [db], caches: [first, second] } = fixture()
  const earlier = await first.acquire('force')
  const newer = await second.acquire('force', true)
  assert.notEqual(earlier.lease.token, newer.lease.token)
  await first.release('force', earlier.lease)
  assert.equal((await db.doc(`${CACHE_COLLECTION}/force`).get()).data().leaseToken, newer.lease.token)
  assert.equal(await second.publish('force', { total: 200 }, newer.lease), true)
  assert.equal(await first.publish('force', { total: 100 }, earlier.lease), false)
  assert.equal((await first.get('force')).total, 200)
})

test('an expired crashed builder can be replaced and can never publish after takeover', async () => {
  let time = Date.now()
  const { caches: [first, second] } = fixture({ now: () => time })
  const crashed = await first.acquire('crash')
  time += BUILD_LEASE_MS + 1
  assert.equal(await first.publish('crash', { total: 1 }, crashed.lease), false)
  const replacement = await second.acquire('crash')
  assert.notEqual(crashed.lease.token, replacement.lease.token)
  assert.equal(await second.publish('crash', { total: 2 }, replacement.lease), true)
  assert.equal(await first.publish('crash', { total: 1 }, crashed.lease), false)
  assert.equal((await first.get('crash')).total, 2)
})

test('retaining a live lease does not make an expired value fresh or expose an old cache schema', async () => {
  let time = Date.now()
  const { dbs: [db], caches: [first, second] } = fixture({ now: () => time, ttlMs: 1000 })
  const initial = await first.acquire('expiry')
  await first.publish('expiry', { total: 10 }, initial.lease)
  time += 1001
  const rebuilding = await second.acquire('expiry')
  assert.ok(rebuilding.lease)
  const stored = (await db.doc(`${CACHE_COLLECTION}/expiry`).get()).data()
  assert.ok(stored.expiresAt.toMillis() > time + BUILD_LEASE_MS)
  assert.ok(stored.valueExpiresAt.toMillis() < time)
  assert.equal(await first.get('expiry'), null)
  await db.doc(`${CACHE_COLLECTION}/legacy`).set({ schemaVersion: 2, value: { total: 999 }, expiresAt: Timestamp.fromMillis(time + 100000) })
  assert.equal(await first.get('legacy'), null)
})

test('busy followers wait at most eight seconds without starting duplicate builds; failed owners release for retry', async () => {
  const pauses = []
  const { dbs: [db], caches: [first, second] } = fixture({ pause: async ms => { pauses.push(ms) } })
  const leader = await first.acquire('busy')
  await assert.rejects(second.acquire('busy'), { code: 'unavailable' })
  assert.deepEqual(pauses, BUILD_WAIT_DELAYS_MS)
  assert.equal(pauses.reduce((sum, ms) => sum + ms, 0), 8000)
  assert.equal((await db.doc(`${CACHE_COLLECTION}/busy`).get()).data().leaseToken, leader.lease.token)
  await first.release('busy', leader.lease)
  const retried = await second.acquire('busy')
  assert.ok(retried.lease)
  assert.notEqual(retried.lease.token, leader.lease.token)
  await assert.rejects(second.publish('other-scope', { total: 999 }, retried.lease), /scope/)
  assert.equal((await db.doc(`${CACHE_COLLECTION}/other-scope`).get()).exists, false)
})
