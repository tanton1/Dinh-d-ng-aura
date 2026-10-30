'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { shouldSampleMetric } = require('./observability')
const { createPushOverviewReads, readOverviewSnapshot, isMemberProfile, pushMetric, pushTimestampToIso,
  USER_FIELDS, DEVICE_FIELDS, LOG_FIELDS, METRIC_FIELDS } = require('./push-overview-reads')

const NOW = Date.parse('2026-10-30T10:00:00Z')
const readTime = Timestamp.fromMillis(NOW + 10)
const request = (data = {}, role = 'admin', uid = 'operator') => ({ auth: { uid, token: { role } }, data })
const auth = {
  requireCaller: request => { if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'sign in'); return request.auth.uid },
  hasTrustedRole: (request, profile, roles) => profile?.disabled !== true && profile?.role === request.auth?.token?.role && roles.has(request.auth?.token?.role),
  privilegedAdminRoles: new Set(['admin', 'super_admin']),
}
const row = (path, data) => ({ id: path.split('/').at(-1), ref: { path }, data: () => data, exists: true })
const field = (object, key) => key.split('.').reduce((value, part) => value?.[part], object)
const millis = value => value instanceof Date ? value.getTime() : value?.toMillis?.() ?? value
function project(object, fields) {
  const result = {}
  for (const key of fields) {
    const value = field(object, key)
    if (value === undefined) continue
    const parts = key.split('.'); let target = result
    for (const part of parts.slice(0, -1)) target = target[part] ||= {}
    target[parts.at(-1)] = value
  }
  return result
}

function fixture({ users = [], devices = [], broadcasts = [], automations = [], scanLimit, sourceFailure, publish = true } = {}) {
  const reads = [], authReads = [], leases = [], published = [], released = [], acquired = [], logs = []
  const datasets = { users, devices, 'system/push_broadcast_logs/logs': broadcasts, 'system/push_automation_logs/logs': automations }
  let actor = { role: 'admin' }, cached = null
  function query(source, state = { order: [], filters: [], fields: [] }) {
    const next = update => query(source, { ...state, ...update })
    return {
      orderBy: (name, direction = 'asc') => next({ order: [...state.order, [typeof name === 'string' ? name : '__name__', direction]] }),
      where: (name, op, value) => next({ filters: [...state.filters, [name, op, value]] }),
      select: (...fields) => next({ fields }), limit: maximum => next({ maximum }), startAfter: after => next({ after }),
      async get() {
        if (sourceFailure) throw new Error('synthetic source failure')
        let documents = [...datasets[source]]
        for (const [key, op, value] of state.filters) { assert.equal(op, '>='); documents = documents.filter(document => millis(field(document.data(), key)) >= millis(value)) }
        documents.sort((left, right) => {
          for (const [key, direction] of state.order) {
            const a = key === '__name__' ? left.ref.path : millis(field(left.data(), key))
            const b = key === '__name__' ? right.ref.path : millis(field(right.data(), key))
            const difference = a < b ? -1 : a > b ? 1 : 0
            if (difference) return direction === 'desc' ? -difference : difference
          }
          return 0
        })
        if (state.after) documents = documents.slice(documents.findIndex(document => document.ref.path === state.after.ref.path) + 1)
        documents = documents.slice(0, state.maximum)
        reads.push({ source, ...state, count: documents.length })
        const docs = documents.map(document => row(document.ref.path, project(document.data(), state.fields)))
        return { docs, size: docs.length, empty: !docs.length, readTime }
      },
    }
  }
  const db = {
    collection: source => query(source), collectionGroup: source => query(source),
    doc: path => ({ async get() { authReads.push(path); return { exists: actor !== null, data: () => actor } } }),
    runTransaction: async (callback, options) => { assert.deepEqual(options, { readOnly: true }); return callback({ get: query => query.get() }) },
  }
  const sharedCache = {
    async acquire(key, force) { acquired.push({ key, force }); if (cached && !force) return { cached: { ...cached, cache: { hit: true, tier: 'shared' } } }; const lease = { token: `${leases.length}`, cacheKey: key }; leases.push(lease); return { lease } },
    async publish(key, value, lease, options) { published.push({ key, value, lease, options }); if (publish) cached = value; return publish },
    async release(key, lease) { released.push({ key, lease }) },
  }
  const logger = { info: (message, value) => logs.push({ message, value }), error: (message, value) => logs.push({ message, value }), warn: () => {} }
  const api = createPushOverviewReads({ db, ...auth, logger, sharedCache, now: () => NOW, ...(scanLimit ? { scanLimit } : {}) })
  return { api, db, reads, authReads, acquired, published, released, logs, setActor: value => { actor = value } }
}

test('legacy member/device/preferences formulas remain exact, including malformed flags and cross-parent userId joins', async () => {
  const users = [
    ['legacy', {}], ['null', { role: null }], ['empty', { role: '' }], ['student', { role: 'student', notificationSettings: { fcmEnabled: true } }],
    ['opted-out', { notificationSettings: { enabled: false, fcmEnabled: true } }], ['categories-off', { notificationSettings: { mealReminders: false, workoutReminders: false } }],
    ['malformed', { notificationSettings: 'invalid' }], ['staff', { role: 'admin' }], ['user-role', { role: 'user' }],
    ['disabled', { disabled: true }], ['status-disabled', { status: 'disabled' }],
  ].map(([id, value]) => row(`users/${id}`, { name: 'PRIVATE_NAME', email: 'private@example.test', ...value }))
  const devices = [
    row('users/legacy/devices/repeated', { userId: 'legacy', token: 'PRIVATE_TOKEN' }),
    row('imports/not-a-profile/devices/repeated', { userId: 'null', token: 'PRIVATE_TOKEN' }),
    row('users/opted-out/devices/a', { userId: 'opted-out', token: 'PRIVATE_TOKEN' }),
    row('users/categories-off/devices/a', { userId: 'categories-off', token: ' ' }),
    row('users/malformed/devices/a', { userId: 'malformed', token: 'PRIVATE_TOKEN', enabled: 'false' }),
    ...['', null, 5].map((token, i) => row(`users/empty/devices/a${i}`, { userId: 'empty', token })),
    row('users/disabled/devices/a', { userId: 'disabled', token: 'PRIVATE_TOKEN' }),
    row('users/legacy/devices/off', { userId: 'legacy', token: 'PRIVATE_TOKEN', enabled: false }),
    row('users/legacy/devices/no-userId', { token: 'PRIVATE_TOKEN' }),
  ]
  const recent = Timestamp.fromMillis(NOW - 1000), old = Timestamp.fromMillis(NOW - 2 * 86400_000)
  const f = fixture({ users, devices, broadcasts: [row('system/push_broadcast_logs/logs/recent', { createdAt: recent, webPushSentCount: 4.5, webPushFailureCount: 2, body: 'PRIVATE_BODY' }), row('system/push_broadcast_logs/logs/old', { createdAt: old, webPushSentCount: 99 })],
    automations: [row('system/push_automation_logs/logs/a', { createdAt: recent, webPushSentCount: '12', webPushFailureCount: -3 })] })
  const result = await f.api.getPushAdminOverview(request())
  assert.deepEqual(METRIC_FIELDS.map(key => result[key]), [7, 5, 5, 4.5, 2])
  assert.equal(result.latestBroadcastAt, new Date(NOW - 1000).toISOString())
  assert.equal(result.asOf, readTime.toDate().toISOString())
  assert.equal(result.windowStart, new Date(NOW - 86400_000).toISOString())
  assert.equal(result.complete, true)
  assert.ok(f.reads.every(read => read.maximum <= 500))
  assert.deepEqual(f.reads.filter(read => read.source === 'users')[0].fields, USER_FIELDS)
  assert.deepEqual(f.reads.filter(read => read.source === 'devices')[0].fields, DEVICE_FIELDS)
  assert.deepEqual(f.reads.find(read => read.filters.length).fields, LOG_FIELDS)
  assert.doesNotMatch(JSON.stringify([result, f.published.map(entry => entry.value), f.logs]), /PRIVATE_|private@example|userId|notificationSettings|token|actorUid|sourceId/)
  assert.equal(f.published[0].options.sourceReadTime, readTime)
  assert.equal(f.released.length, 0, 'successful publish already clears its lease without another cache read')
})

test('more than 3,000 profiles, repeated device IDs and tied log timestamps are fully paginated', async () => {
  const users = Array.from({ length: 3007 }, (_, i) => row(`users/u${String(i).padStart(5, '0')}`, { notificationSettings: { fcmEnabled: i % 2 === 0 } }))
  const devices = users.map(document => row(`${document.ref.path}/devices/same-id`, { userId: document.id, token: 'PRIVATE_TOKEN' }))
  const broadcasts = Array.from({ length: 1001 }, (_, i) => row(`system/push_broadcast_logs/logs/${String(i).padStart(5, '0')}`, { createdAt: Timestamp.fromMillis(NOW - 1000), webPushSentCount: 1 }))
  const f = fixture({ users, devices, broadcasts })
  const result = await f.api.getPushAdminOverview(request())
  assert.equal(result.activeUsers, 3007); assert.equal(result.pushEnabledUsers, 3007); assert.equal(result.activeDevices, 3007)
  assert.equal(result.webPushAccepted24h, 1001)
  assert.equal(f.reads.filter(read => read.source === 'users').length, 7)
  assert.equal(f.reads.filter(read => read.source === 'devices').length, 7)
  assert.ok(f.reads.filter(read => read.after).every(read => read.after.ref.path.includes('/')))
  assert.deepEqual(f.reads.find(read => read.filters.length).order, [['createdAt', 'asc'], ['__name__', 'asc']])
})

test('latest timestamps remain all-time even when there are no deliveries in the 24-hour window', async () => {
  const old = Timestamp.fromMillis(NOW - 2 * 86400_000)
  const f = fixture({ broadcasts: [row('system/push_broadcast_logs/logs/old', { createdAt: old, webPushSentCount: 99 })],
    automations: [row('system/push_automation_logs/logs/old', { createdAt: old, webPushFailureCount: 99 })] })
  const result = await f.api.getPushAdminOverview(request())
  assert.equal(result.complete, true)
  assert.equal(result.webPushAccepted24h, 0); assert.equal(result.webPushFailures24h, 0)
  assert.equal(result.latestBroadcastAt, old.toDate().toISOString())
  assert.equal(result.latestAutomationAt, old.toDate().toISOString())
})

test('each source scan cap returns only unknown totals, is cached, and never publishes a truncated count', async () => {
  for (const source of ['users', 'devices', 'broadcasts', 'automations']) {
    const values = Array.from({ length: 4 }, (_, i) => row(source === 'users' ? `users/u${i}` : source === 'devices' ? `users/u/devices/d${i}` : `system/${source}/logs/l${i}`, { userId: 'u', token: 'PRIVATE_TOKEN', createdAt: Timestamp.fromMillis(NOW), webPushSentCount: 5 }))
    const f = fixture({ users: [row('users/u', {})], [source]: values, scanLimit: 3 })
    const result = await f.api.getPushAdminOverview(request())
    assert.equal(result.complete, false); assert.equal(result.reason, 'scan-limit')
    for (const field of [...METRIC_FIELDS, 'latestAutomationAt', 'latestBroadcastAt']) assert.equal(result[field], null)
    assert.ok(f.reads.every(read => read.maximum <= 4))
    const count = f.reads.length
    assert.equal((await f.api.getPushAdminOverview(request())).complete, false)
    assert.equal(f.reads.length, count)
  }
})

test('authorization precedes cache on every request and warm shared cache cannot survive role/disable changes', async () => {
  const f = fixture()
  await assert.rejects(f.api.getPushAdminOverview({ data: {} }), { code: 'unauthenticated' })
  assert.equal(f.acquired.length, 0); assert.equal(f.authReads.length, 0)
  await f.api.getPushAdminOverview(request())
  const sourceReads = f.reads.length
  await f.api.getPushAdminOverview(request({}, 'admin', 'other-admin'))
  assert.equal(f.reads.length, sourceReads)
  const before = f.acquired.length
  for (const profile of [null, { role: 'student' }, { role: 'admin', disabled: true }, { role: 'super_admin' }]) {
    f.setActor(profile)
    await assert.rejects(f.api.getPushAdminOverview(request()), { code: 'permission-denied' })
  }
  assert.equal(f.acquired.length, before)
  assert.doesNotMatch(JSON.stringify(f.logs), /operator|actorUid|sourceId|correlationId/)
  f.setActor({ role: 'super_admin' })
  assert.equal((await f.api.getPushAdminOverview(request({}, 'super_admin'))).cache.hit, true)
  assert.ok(f.acquired.every(({ key }) => !key.includes('operator') && !key.includes('other-admin')))
})

test('only boolean forceRefresh is accepted, normal opens reuse cache and explicit force starts fresh source reads', async () => {
  const f = fixture()
  await f.api.getPushAdminOverview(request())
  const count = f.reads.length
  await f.api.getPushAdminOverview(request({ forceRefresh: false }))
  assert.equal(f.reads.length, count)
  for (const forceRefresh of ['true', 1, null, [], {}]) await assert.rejects(f.api.getPushAdminOverview(request({ forceRefresh })), { code: 'invalid-argument' })
  await f.api.getPushAdminOverview(request({ forceRefresh: true }))
  assert.equal(f.reads.length, count * 2)
  assert.equal(f.acquired.at(-1).force, true)
})

test('failed source reads, source timestamp verification and superseded publication release ownership and never return stale success', async () => {
  const failed = fixture({ sourceFailure: true })
  await assert.rejects(failed.api.getPushAdminOverview(request()), /synthetic source failure/)
  assert.equal(failed.published.length, 0); assert.equal(failed.released.length, 1)
  const replaced = fixture({ publish: false })
  await assert.rejects(replaced.api.getPushAdminOverview(request()), { code: 'unavailable' })
  assert.equal(replaced.released.length, 1)
  const missingTime = fixture()
  missingTime.db.runTransaction = callback => callback({ get: async query => ({ ...await query.get(), readTime: null }) })
  await assert.rejects(missingTime.api.getPushAdminOverview(request()), { code: 'unavailable' })
  assert.equal(missingTime.published.length, 0); assert.equal(missingTime.released.length, 1)
  await assert.rejects(readOverviewSnapshot(fixture().db, { now: () => NOW, deadlineAt: Date.now() - 1 }), { code: 'unavailable' })
})

test('malformed legacy metrics stay zero, finite sum overflow is unknown, and malformed timestamps cannot produce an invalid date', async () => {
  for (const value of [null, undefined, '', '2', -1, NaN, Infinity, true, {}, []]) assert.equal(pushMetric(value), 0)
  assert.equal(pushMetric(0.25), 0.25)
  for (const value of [null, 'not-date', { toDate: () => 'invalid' }, { toDate() { throw Error('malformed') } }]) assert.equal(pushTimestampToIso(value), null)
  const f = fixture({ broadcasts: [0, 1].map(i => row(`system/push_broadcast_logs/logs/${i}`, { createdAt: Timestamp.fromMillis(NOW), webPushSentCount: Number.MAX_VALUE })) })
  const result = await f.api.getPushAdminOverview(request())
  assert.equal(result.complete, false); assert.equal(result.reason, 'invalid-metric')
  assert.ok(METRIC_FIELDS.every(key => result[key] === null))
  assert.equal(isMemberProfile({ role: 'user' }), false)
})

test('observations report actual auth/source queries and cache hits without equating them to billed reads', async () => {
  const f = fixture({ users: [row('users/member', {})] })
  const correlationId = Array.from({ length: 100 }, (_, i) => `push-unit-${i}`).find(id => shouldSampleMetric(id, .1))
  await f.api.getPushAdminOverview(request({ correlationId }))
  await f.api.getPushAdminOverview(request({ correlationId }))
  const [first, second] = f.logs.filter(log => log.message === 'Aura function metric').map(log => log.value.metrics)
  assert.equal(first.logicalQueries, 7); assert.equal(first.documentsReturned, 2); assert.equal(first.cacheMisses, 1)
  assert.equal(second.logicalQueries, 1); assert.equal(second.documentsReturned, 1); assert.equal(second.cacheHits, 1)
  assert.ok(Object.values(first).every(Number.isFinite))
})
