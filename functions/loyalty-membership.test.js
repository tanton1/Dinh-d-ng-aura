'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { deriveMembership: derive, monthAfter, membershipIsActive, membershipIsManaged, syncContractMembership } = require('./loyalty-membership')
const active = { status: 'active', startDate: '2026-10-01', endDate: '2026-10-31' }
const run = (overrides = {}) => derive({ student: { status: 'active' }, contracts: [active], startDate: '2026-10-24', today: '2026-10-24', ...overrides })

test('initial enrollment accepts only a live active contract, not old wallets, frozen/future/cancelled profiles', () => {
  assert.equal(run().state, 'active')
  for (const status of ['cancelled', 'canceled', 'frozen', 'draft', 'inactive', 'archived']) assert.equal(run({ contracts: [{ ...active, status }] }).managed, false, status)
  assert.equal(run({ student: { status: 'inactive' } }).managed, false)
  assert.equal(run({ contracts: [{ ...active, endDate: '2026-10-23' }] }).managed, false)
  assert.equal(run({ contracts: [{ ...active, startDate: '2026-11-01', endDate: '2026-12-01' }] }).active, false)
  assert.equal(run({ contracts: [{ ...active, sourceContractId: 'old', handoverStatus: 'pending' }] }).active, false)
  assert.equal(run({ contracts: [{ ...active, status: 'expired', renewedByContractId: 'new' }] }).active, false)
  assert.equal(run({ contracts: [{ ...active, endDate: '2026-02-31' }] }).managed, false)
})

test('one calendar month clamps month ends, accounts for leap year and excludes the cutoff day', () => {
  assert.equal(monthAfter('2026-01-31'), '2026-02-28')
  assert.equal(monthAfter('2028-01-31'), '2028-02-29')
  assert.equal(monthAfter('2026-12-31'), '2027-01-31')
  const previous = run()
  assert.equal(run({ previous, today: '2026-10-31' }).state, 'active')
  assert.equal(run({ previous, today: '2026-11-01' }).state, 'grace')
  assert.equal(run({ previous, today: '2026-11-29' }).managed, true)
  assert.equal(run({ previous, today: '2026-11-30' }).state, 'archived')
})

test('renewal reuses enrollment and the later valid end date; cancellation cannot prolong grace', () => {
  const previous = run({ today: '2027-01-01', previous: { enrolledOn: '2026-10-24' } })
  const next = run({ previous, today: '2027-01-01', contracts: [active, { ...active, startDate: '2027-01-01', endDate: '2027-03-31' }] })
  assert.equal(next.enrolledOn, '2026-10-24'); assert.equal(next.active, true)
  assert.equal(next.manageUntil, '2027-04-30')
  const cancelled = run({ previous, today: '2027-01-01', contracts: [active, { ...active, status: 'cancelled', endDate: '2028-01-01' }] })
  assert.equal(cancelled.managed, false)
})

test('future transitions are scheduled and wall-clock guards exclude expired flags before scheduler catches up', () => {
  assert.equal(run().nextCheckOn, '2026-11-01')
  const m = run()
  assert.equal(membershipIsActive({ loyaltyMembership: m }, '2026-11-01'), false)
  assert.equal(membershipIsManaged({ loyaltyMembership: m }, '2026-11-29'), true)
  assert.equal(membershipIsManaged({ loyaltyMembership: m }, '2026-11-30'), false)
  assert.equal(membershipIsManaged({ status: 'inactive', loyaltyMembership: m }, '2026-10-24'), false)
  assert.equal(run({ contracts: [{ ...active, startDate: '2027-01-01', endDate: '2027-03-31' }] }).nextCheckOn, '2027-01-01')
})

test('contract metadata writes do not query membership', async () => {
  const db = new Proxy({}, { get() { throw new Error('Unexpected read') } })
  const before = { ...active, studentId: 's', usedSessions: 2 }
  await syncContractMembership({ db, event: { data: { before: { data: () => before }, after: { data: () => ({ ...before, usedSessions: 3, updatedAt: 9 }) } } } })
})
