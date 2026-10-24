'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { contributionFor, allowedScopes, branchScope, syncLoyaltyDashboardEvent, createLoyaltyDashboardProjectionFunctions } = require('./loyalty-dashboard-projection')
const { attendanceRewardChanged, REWARD_FIELDS } = require('./loyalty-attendance-read-policy')
const membership = { managed: true, active: true, state: 'active', activeUntil: '2099-12-31', manageUntil: '2100-01-31', enrolledOn: '2026-10-24' }
const snapshot = value => ({ exists: value !== null, data: () => value })
const event = (before, after) => ({ params: { documentId: 's' }, data: { before: snapshot(before), after: snapshot(after) } })
const noReads = new Proxy({}, { get() { throw new Error('Unexpected database read') } })

test('summary scopes preserve current-student AND stored redemption branch authorization', () => {
  const row = contributionFor('loyaltyRedemptions', 'r', { studentId: 's', branchId: 'b', status: 'pending' }, { branchId: 'a', loyaltyMembership: membership })
  assert.equal(row.metrics.pendingRedemptions, 1)
  assert.equal(allowedScopes({ accessRole: 'staff', branchIds: ['a'] }).includes(row.scopes[1]), false)
  assert.equal(allowedScopes({ accessRole: 'staff', branchIds: ['a', 'b'] }).includes(row.scopes[1]), true)
  assert.equal(row.scopes[1], branchScope(['b', 'a']))
  assert.deepEqual(contributionFor('loyaltyAccounts', 's', { availablePoints: 5 }, null).scopes, [])
  assert.throws(() => allowedScopes({ accessRole: 'pt', branchIds: ['a'] }), { code: 'permission-denied' })
})

test('all twenty authorized branches are included; duplicate branches do not duplicate totals', () => {
  const branches = Array.from({ length: 20 }, (_, i) => `b${i}`)
  const scopes = allowedScopes({ accessRole: 'staff', branchIds: [...branches, 'b1'] })
  assert.equal(scopes.length, 210)
  assert.ok(scopes.includes(branchScope(['b19'])))
  assert.throws(() => allowedScopes({ accessRole: 'staff', branchIds: [...branches, 'b20'] }))
})

test('tier normalization uses qualifying cash rather than an obsolete persisted tier', () => {
  const row = contributionFor('loyaltyAccounts', 's', { availablePoints: -1, tier: 'member', tierQualifyingValue: 25_000_000 }, { branchId: 'a', loyaltyMembership: membership })
  assert.equal(row.metrics.tier_gold, 1)
  assert.equal(row.metrics.availablePoints, 0)
})

test('student details, wallet revision and referral audit writes trigger zero projection reads', async () => {
  for (const [collection, before, after] of [
    ['students', { branchId: 'a', name: 'Old' }, { branchId: 'a', name: 'New' }],
    ['loyaltyAccounts', { availablePoints: 10, revision: 1 }, { availablePoints: 10, revision: 2 }],
    ['memberReferrals', { referrerStudentId: 's', status: 'qualified' }, { referrerStudentId: 's', status: 'qualified', updatedAt: 9 }],
  ]) assert.deepEqual(await syncLoyaltyDashboardEvent({ db: noReads, collection, event: event(before, after) }), { changed: false })
})

test('attendance metadata edits cost zero reconciliation reads while every reward input still runs', () => {
  const base = Object.fromEntries(REWARD_FIELDS.map(field => [field, 'original']))
  assert.equal(attendanceRewardChanged(event(base, { ...base, updatedAt: 2, note: 'PT feedback' })), false)
  for (const field of REWARD_FIELDS) assert.equal(attendanceRewardChanged(event(base, { ...base, [field]: 'changed' })), true, field)
  assert.equal(attendanceRewardChanged(event(base, null)), true)
  assert.equal(attendanceRewardChanged(event(null, base)), true)
  assert.throws(() => attendanceRewardChanged({}))
})

test('projection workers register only five sources in Jakarta, with retry and no minimum instances', () => {
  const functions = createLoyaltyDashboardProjectionFunctions({ db: noReads, databaseId: 'named-db', onDocumentWritten: (options, handler) => ({ options, handler }) })
  assert.equal(Object.keys(functions).length, 5)
  for (const fn of Object.values(functions)) {
    assert.equal(fn.options.region, 'asia-southeast2')
    assert.equal(fn.options.database, 'named-db')
    assert.equal(fn.options.retry, true)
    assert.equal(fn.options.minInstances, 0)
    assert.equal(fn.options.cpu, 0.1666)
    assert.ok(!fn.options.document.startsWith('{'))
  }
})
