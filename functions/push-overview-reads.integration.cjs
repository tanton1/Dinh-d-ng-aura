'use strict'

const assert = require('node:assert/strict')
const { test, after } = require('node:test')
const { randomUUID } = require('node:crypto')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { createPushOverviewReads, OVERVIEW_TTL_MS, OVERVIEW_BUILD_LEASE_MS, METRIC_FIELDS } = require('./push-overview-reads')
const { createSharedDashboardCache, CACHE_COLLECTION } = require('./operations-dashboard-cache')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const clients = [], apps = []
after(async () => { await Promise.all(clients.map(db => db.terminate())); await Promise.all(apps.map(app => deleteApp(app))) })
const request = (data = {}, uid = 'operator', role = 'admin') => ({ auth: { uid, token: { role } }, data })
const auth = {
  requireCaller: request => { if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'sign in'); return request.auth.uid },
  hasTrustedRole: (request, profile, roles) => profile?.disabled !== true && profile?.role === request.auth?.token?.role && roles.has(request.auth?.token?.role),
  privilegedAdminRoles: new Set(['admin', 'super_admin']),
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

async function fixture({ now = () => Date.now(), cacheOptions = {}, scanLimit } = {}) {
  const database = `push-overview-${randomUUID()}`
  const dbs = [0, 1].map(() => {
    const app = initializeApp({ projectId: 'demo-aura-fitness' }, randomUUID()); apps.push(app)
    const db = getFirestore(app, database); clients.push(db); return db
  })
  const logs = [], logger = Object.fromEntries(['info', 'warn', 'error'].map(level => [level, (message, value) => logs.push({ level, message, value })]))
  const caches = dbs.map(db => createSharedDashboardCache({ db, logger, now, ttlMs: OVERVIEW_TTL_MS, buildLeaseMs: OVERVIEW_BUILD_LEASE_MS, coalesceRefresh: true, ...cacheOptions }))
  const apis = dbs.map((db, i) => createPushOverviewReads({ db, ...auth, logger, now, sharedCache: caches[i], ...(scanLimit ? { scanLimit } : {}) }))
  await dbs[0].doc('users/operator').set({ role: 'admin', name: 'PRIVATE_OPERATOR' })
  return { dbs, apis, caches, logs }
}

function observeReadOnly(db, callback) {
  const transact = db.runTransaction.bind(db)
  db.runTransaction = (build, options) => transact(async transaction => {
    if (!options?.readOnly) return build(transaction)
    const proxy = new Proxy(transaction, {
      get(target, key) {
        if (key === 'get') return async query => {
          const snapshot = await target.get(query)
          await callback(snapshot)
          return snapshot
        }
        const value = target[key]
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    return build(proxy)
  }, options)
}

test('real snapshot counts >3,000 profiles, duplicate device IDs and tied log timestamps consistently across a concurrent mutation', { timeout: 120000 }, async () => {
  const { dbs: [db, writer], apis: [api], logs } = await fixture()
  const timestamp = Timestamp.fromMillis(Date.now() - 60_000)
  for (let offset = 0; offset < 3007; offset += 400) {
    const batch = db.batch()
    for (let i = offset; i < Math.min(3007, offset + 400); i++) batch.set(db.doc(`users/u${String(i).padStart(5, '0')}`), {
      notificationSettings: { fcmEnabled: true }, name: 'PRIVATE_NAME', email: 'private@example.test',
    })
    await batch.commit()
  }
  const initial = db.batch()
  initial.set(db.doc('users/u00000/devices/same-id'), { userId: 'u00000', token: 'PRIVATE_TOKEN', enabled: true })
  initial.set(db.doc('imports/elsewhere/devices/same-id'), { userId: 'u00001', token: 'PRIVATE_TOKEN', enabled: true })
  initial.set(db.doc('users/u00002/devices/same-id'), { userId: 'u00002', token: '', enabled: true })
  initial.set(db.doc('users/u00003/devices/same-id'), { userId: 'u00003', token: 'PRIVATE_TOKEN', enabled: false })
  await initial.commit()
  for (let offset = 0; offset < 1001; offset += 400) {
    const batch = db.batch()
    for (let i = offset; i < Math.min(1001, offset + 400); i++) batch.set(db.doc(`system/push_broadcast_logs/logs/l${String(i).padStart(5, '0')}`), {
      createdAt: timestamp, webPushSentCount: 1, webPushFailureCount: i === 0 ? 3 : 0, body: 'PRIVATE_MESSAGE',
    })
    await batch.commit()
  }
  let mutated = false, queryCount = 0, firstReadTime
  observeReadOnly(db, async snapshot => {
    queryCount++
    if (firstReadTime) assert.equal(snapshot.readTime.isEqual(firstReadTime), true, 'every source/page must share one read time')
    else firstReadTime = snapshot.readTime
    assert.ok(snapshot.size <= 500)
    if (!mutated) {
      mutated = true
      const batch = writer.batch()
      batch.update(writer.doc('users/u03006'), { disabled: true })
      batch.update(writer.doc('imports/elsewhere/devices/same-id'), { enabled: false })
      batch.set(writer.doc('system/push_broadcast_logs/logs/new'), { createdAt: Timestamp.now(), webPushSentCount: 9 })
      await batch.commit()
    }
  })
  const result = await api.getPushAdminOverview(request())
  assert.equal(mutated, true); assert.equal(result.complete, true)
  assert.equal(result.activeUsers, 3007); assert.equal(result.pushEnabledUsers, 3007)
  assert.equal(result.activeDevices, 2); assert.equal(result.webPushAccepted24h, 1001); assert.equal(result.webPushFailures24h, 3)
  assert.equal(result.latestBroadcastAt, timestamp.toDate().toISOString())
  assert.equal(result.latestAutomationAt, null)
  assert.equal(result.asOf, firstReadTime.toDate().toISOString())
  assert.equal(queryCount, 14, '7 user pages +1device +3log +1automation +2latest')
  const cache = await db.collection(CACHE_COLLECTION).get()
  assert.equal(cache.size, 1)
  assert.equal(cache.docs[0].data().valueSourceReadTime.isEqual(firstReadTime), true)
  assert.doesNotMatch(JSON.stringify([result, cache.docs[0].data(), logs]), /PRIVATE_|private@example|actorUid|sourceId|notificationSettings|userId/)
  const before = queryCount
  assert.equal((await api.getPushAdminOverview(request())).cache.hit, true)
  assert.equal(queryCount, before, 'cached open only rereads authority and shared cache')
})

test('independent instances reuse normal cache, force refresh observes writes and expiry rebuilds; role revocation cannot read a warm cache', async () => {
  let clock = Date.now()
  const { dbs: [db, other], apis: [first, second] } = await fixture({ now: () => clock })
  await db.doc('users/member').set({ notificationSettings: { fcmEnabled: true } })
  let builds = 0
  for (const source of [db, other]) {
    const transact = source.runTransaction.bind(source)
    source.runTransaction = (callback, options) => { if (options?.readOnly) builds++; return transact(callback, options) }
  }
  const original = await first.getPushAdminOverview(request())
  await db.doc('users/member').update({ disabled: true })
  const ordinary = await second.getPushAdminOverview(request())
  assert.equal(ordinary.cache.hit, true); assert.equal(ordinary.activeUsers, 1); assert.equal(ordinary.asOf, original.asOf)
  assert.equal(builds, 1)
  const refreshed = await second.getPushAdminOverview(request({ forceRefresh: true }))
  assert.equal(refreshed.activeUsers, 0); assert.equal(refreshed.cache.hit, false); assert.equal(builds, 2)
  assert.ok(Date.parse(refreshed.asOf) >= Date.parse(original.asOf))
  await db.doc('users/operator').update({ disabled: true })
  await assert.rejects(first.getPushAdminOverview(request()), { code: 'permission-denied' })
  await db.doc('users/operator').update({ disabled: false, role: 'super_admin' })
  await assert.rejects(first.getPushAdminOverview(request()), { code: 'permission-denied' })
  assert.equal((await first.getPushAdminOverview(request({}, 'operator', 'super_admin'))).cache.hit, true)
  assert.equal(builds, 2)
  await db.doc('users/member').update({ disabled: false })
  clock += OVERVIEW_TTL_MS + 1
  assert.equal((await first.getPushAdminOverview(request({}, 'operator', 'super_admin'))).activeUsers, 1)
  assert.equal(builds, 3)
})

test('simultaneous explicit refreshes coalesce across instances when the leader snapshot follows both refresh fences', { timeout: 20000 }, async () => {
  const waiting = deferred(), published = deferred(), leaderEntered = deferred()
  const { dbs: [db, other], apis: [first, second] } = await fixture({ cacheOptions: { pause: async () => { waiting.resolve(); await published.promise } } })
  await db.doc('users/member').set({})
  await first.getPushAdminOverview(request())
  await db.doc('users/member').update({ disabled: true })
  let builds = 0
  for (const source of [db, other]) {
    const transact = source.runTransaction.bind(source)
    source.runTransaction = (callback, options) => transact(async transaction => {
      if (options?.readOnly) { builds++; leaderEntered.resolve(); await waiting.promise }
      return callback(transaction)
    }, options)
  }
  const leader = first.getPushAdminOverview(request({ forceRefresh: true }))
  await leaderEntered.promise
  const follower = second.getPushAdminOverview(request({ forceRefresh: true }))
  const leadingResult = await leader
  published.resolve()
  const followingResult = await follower
  assert.equal(builds, 1)
  assert.equal(leadingResult.activeUsers, 0); assert.equal(followingResult.activeUsers, 0)
  assert.equal(followingResult.cache.hit, true)
  assert.equal(followingResult.asOf, leadingResult.asOf)
})

test('a forced refresh waiting on a pre-mutation snapshot cannot accept its late publication', { timeout: 20000 }, async () => {
  const firstSource = deferred(), resumeLeader = deferred(), followerWaiting = deferred(), published = deferred()
  const { dbs: [db, other], apis: [first, second] } = await fixture({ cacheOptions: { pause: async () => { followerWaiting.resolve(); await published.promise } } })
  await db.doc('users/member').set({ notificationSettings: { fcmEnabled: true } })
  let held = false, builds = 0
  observeReadOnly(db, async () => {
    if (!held) { held = true; firstSource.resolve(); await resumeLeader.promise }
  })
  for (const source of [db, other]) {
    const transact = source.runTransaction.bind(source)
    source.runTransaction = (callback, options) => { if (options?.readOnly) builds++; return transact(callback, options) }
  }
  const leader = first.getPushAdminOverview(request())
  await firstSource.promise
  await other.doc('users/member').update({ disabled: true })
  const follower = second.getPushAdminOverview(request({ forceRefresh: true }))
  await followerWaiting.promise
  resumeLeader.resolve()
  const old = await leader
  published.resolve()
  const fresh = await follower
  assert.equal(old.activeUsers, 1); assert.equal(fresh.activeUsers, 0)
  assert.equal(fresh.cache.hit, false, 'old source time cannot satisfy a later explicit refresh')
  assert.equal(builds, 2)
  assert.ok(Date.parse(fresh.asOf) >= Date.parse(old.asOf))
})

test('scan cap is cached as unknown without private partial totals, explicit recovery becomes complete, and expired leases reject publication', async () => {
  let clock = Date.now()
  const { dbs: [db], apis: [api] } = await fixture({ now: () => clock, scanLimit: 3 })
  for (const id of ['a', 'b', 'c']) await db.doc(`users/${id}`).set({ notificationSettings: { fcmEnabled: true } })
  const limited = await api.getPushAdminOverview(request())
  assert.equal(limited.complete, false); assert.equal(limited.reason, 'scan-limit')
  assert.ok(METRIC_FIELDS.every(key => limited[key] === null))
  assert.equal((await api.getPushAdminOverview(request())).cache.hit, true)
  await db.doc('users/c').delete()
  const complete = await api.getPushAdminOverview(request({ forceRefresh: true }))
  assert.equal(complete.complete, true); assert.equal(complete.activeUsers, 2)
  let expired = false
  observeReadOnly(db, async () => { if (!expired) { expired = true; clock += OVERVIEW_BUILD_LEASE_MS + 1 } })
  await assert.rejects(api.getPushAdminOverview(request({ forceRefresh: true })), { code: 'unavailable' })
  const cached = (await db.collection(CACHE_COLLECTION).get()).docs[0].data()
  assert.equal(cached.leaseToken, null)
  assert.equal(cached.value.asOf, complete.asOf, 'expired owner cannot overwrite its last valid cache value')
})
