'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { stableDashboardCacheKey, createSharedDashboardCache, CACHE_SCHEMA_VERSION } = require('./operations-dashboard-cache')

function cacheInput(actor) {
  return {
    actor,
    permissions: { finance: true, operations: true, clients: true, payroll: false },
    scope: { branchId: 'all', branchIds: [], unrestricted: true },
    startDate: '2026-08-01',
    endDate: '2026-08-29',
  }
}

test('expired cache is never returned while asynchronous Firestore TTL deletion is pending', async () => {
  const db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ schemaVersion: CACHE_SCHEMA_VERSION, valueExpiresAt: { toMillis: () => Date.now() - 60_000 }, expiresAt: { toMillis: () => Date.now() + 60_000 }, value: { total: 999 } }) }) }) }) }
  const cache = createSharedDashboardCache({ db })
  assert.equal(await cache.get('expired'), null)
})

test('unexpired cache remains usable and forced refresh bypasses the retained document', async () => {
  let reads = 0
  const db = { collection: () => ({ doc: () => ({ get: async () => { reads += 1; return { exists: true, data: () => ({ schemaVersion: CACHE_SCHEMA_VERSION, valueExpiresAt: { toMillis: () => Date.now() + 60_000 }, value: { total: 3 } }) } } }) }) }
  const cache = createSharedDashboardCache({ db })
  assert.equal((await cache.get('current')).total, 3)
  assert.equal(await cache.get('current', true), null)
  assert.equal(reads, 1)
})

test('admins with the same data scope share one dashboard cache key', () => {
  const first = stableDashboardCacheKey(cacheInput({ uid: 'admin-a', accessRole: 'admin', authzVersion: 1 }))
  const second = stableDashboardCacheKey(cacheInput({ uid: 'admin-b', accessRole: 'super_admin', authzVersion: 9 }))
  assert.equal(first, second)
})

test('staff dashboard cache keys remain actor scoped', () => {
  const first = stableDashboardCacheKey(cacheInput({ uid: 'staff-a', accessRole: 'staff', authzVersion: 1 }))
  const second = stableDashboardCacheKey(cacheInput({ uid: 'staff-b', accessRole: 'staff', authzVersion: 1 }))
  assert.notEqual(first, second)
})

test('scope and permissions are part of the dashboard cache key', () => {
  const base = cacheInput({ uid: 'admin-a', accessRole: 'admin', authzVersion: 1 })
  const scoped = {
    ...base,
    scope: { branchId: 'branch-1', branchIds: ['branch-1'], unrestricted: false },
  }
  const restricted = {
    ...base,
    permissions: { ...base.permissions, finance: false },
  }
  assert.notEqual(stableDashboardCacheKey(base), stableDashboardCacheKey(scoped))
  assert.notEqual(stableDashboardCacheKey(base), stableDashboardCacheKey(restricted))
})

test('cache keys separate exact report timestamps, calendar days and trainer identity', () => {
  const base = cacheInput({ uid: 'staff', accessRole: 'staff', authzVersion: 1, legacyStaffId: 'trainer-1' })
  const key = stableDashboardCacheKey({ ...base, startAt: '2026-08-01T00:00:00Z', endAt: '2026-08-29T01:00:00Z', today: '2026-08-29' })
  assert.notEqual(key, stableDashboardCacheKey({ ...base, startAt: '2026-08-01T00:00:00Z', endAt: '2026-08-29T06:00:00Z', today: '2026-08-29' }))
  assert.notEqual(key, stableDashboardCacheKey({ ...base, startAt: '2026-08-01T00:00:00Z', endAt: '2026-08-29T01:00:00Z', today: '2026-08-30' }))
  assert.notEqual(stableDashboardCacheKey(base), stableDashboardCacheKey({ ...base, actor: { ...base.actor, legacyStaffId: 'trainer-2' } }))
})

test('an old cache schema cannot serve a response calculated with the old query policy', async () => {
  const db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ schemaVersion: 1, expiresAt: { toMillis: () => Date.now() + 60_000 }, value: { total: 999 } }) }) }) }) }
  assert.equal(await createSharedDashboardCache({ db }).get('old'), null)
})
