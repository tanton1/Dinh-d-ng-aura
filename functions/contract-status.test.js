'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  contractSchedulableOn,
  contractStatusProjection,
  effectiveContractStatus,
} = require('./contract-status')

const base = { status: 'active', startDate: '2026-09-01', endDate: '2026-09-30' }

test('contract dates are the canonical source for active, future and expired', () => {
  assert.equal(effectiveContractStatus(base, '2026-09-09'), 'active')
  assert.equal(effectiveContractStatus({ ...base, status: 'active', startDate: '2026-09-10' }, '2026-09-09'), 'future')
  assert.equal(effectiveContractStatus({ ...base, status: 'active', endDate: '2026-09-08' }, '2026-09-09'), 'expired')
  assert.equal(effectiveContractStatus({ ...base, status: 'expired' }, '2026-09-09'), 'active')
  assert.equal(effectiveContractStatus({ ...base, status: 'expired', renewalSupersededBy: 'renewal-1' }, '2026-09-09'), 'expired')
})

test('explicit workflow statuses are preserved and invalid dates never become active', () => {
  assert.equal(effectiveContractStatus({ ...base, status: 'cancelled' }, '2026-09-09'), 'cancelled')
  assert.equal(effectiveContractStatus({ ...base, status: 'frozen' }, '2026-10-09'), 'frozen')
  assert.equal(effectiveContractStatus({ ...base, endDate: '' }, '2026-09-09'), 'invalid')
  assert.equal(effectiveContractStatus({ ...base, startDate: '2026-10-01' }, '2026-09-09'), 'invalid')
})

test('scheduling uses the session date and approved pause periods', () => {
  assert.equal(contractSchedulableOn({ ...base, status: 'expired' }, '2026-09-09'), true)
  assert.equal(contractSchedulableOn({ ...base, status: 'active' }, '2026-10-01'), false)
  assert.equal(contractSchedulableOn({
    ...base,
    pausePeriods: [{ type: 'preservation', startDate: '2026-09-08', endDate: '2026-09-12' }],
  }, '2026-09-09'), false)
})

test('projection explicitly exposes stale stored status', () => {
  assert.deepEqual(contractStatusProjection({ ...base, endDate: '2026-09-08' }, '2026-09-09'), {
    storedStatus: 'active',
    effectiveStatus: 'expired',
    statusMismatch: true,
    validDates: true,
  })
})
