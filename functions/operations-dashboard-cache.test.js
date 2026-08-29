'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { stableDashboardCacheKey } = require('./operations-dashboard-cache')

function cacheInput(actor) {
  return {
    actor,
    permissions: { finance: true, operations: true, clients: true, payroll: false },
    scope: { branchId: 'all', branchIds: [], unrestricted: true },
    startDate: '2026-08-01',
    endDate: '2026-08-29',
  }
}

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
