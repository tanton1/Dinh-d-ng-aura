'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { buildPlan, mergeContractPatches, assertSafe } = require('./firebase-pt-contract-history-exact.cjs')

function contract(id, studentId, fields = {}) {
  return { id, updateTime: `2026-08-28T00:00:0${id.length}.000000Z`, fingerprint: `contract-${id}`, fields: { studentId, status: 'active', totalSessions: 36, usedSessions: 0, ...fields } }
}
function session(id, studentId, contractId, fields = {}) {
  return { id, fields: { studentId, contractId, status: 'completed', ...fields } }
}

test('exact history projection can lower a stale legacy count without changing entitlement', () => {
  const plan = buildPlan([contract('a', 'student', { totalSessions: 36, usedSessions: 20 })], [
    session('one', 'student', 'a'), session('two', 'student', 'a'),
  ])
  assert.equal(plan.contractUsageUpdates.length, 1)
  assert.equal(plan.contractUsageUpdates[0].beforeUsed, 20)
  assert.equal(plan.contractUsageUpdates[0].afterUsed, 2)
  assert.equal(plan.contractUsageUpdates[0].totalSessions, 36)
  assert.doesNotThrow(() => assertSafe(plan))
})

test('exact projection keeps over-entitlement evidence visible', () => {
  const plan = buildPlan([contract('a', 'student', { totalSessions: 1, usedSessions: 0 })], [
    session('one', 'student', 'a'), session('two', 'student', 'a'),
  ])
  assert.equal(plan.contractUsageUpdates[0].afterUsed, 2)
  assert.equal(plan.contractUsageUpdates[0].status, 'over_entitlement')
})

test('renewal carry-over is recomputed from exact source history', () => {
  const contracts = [
    contract('source', 'student', { totalSessions: 12, usedSessions: 7, carryOverTransferredSessions: 5 }),
    contract('renewal', 'student', { totalSessions: 17, packageSessions: 12, usedSessions: 3, sourceContractId: 'source', carryOverRequested: true, carryOverPending: false, carriedOverSessions: 5 }),
  ]
  const sessions = [
    ...Array.from({ length: 10 }, (_, index) => session(`old-${index}`, 'student', 'source')),
    ...Array.from({ length: 3 }, (_, index) => session(`new-${index}`, 'student', 'renewal')),
  ]
  const plan = buildPlan(contracts, sessions)
  assert.equal(plan.renewalUpdates.length, 1)
  assert.equal(plan.renewalUpdates[0].correctedCarry, 2)
  assert.equal(plan.renewalUpdates[0].correctedTotal, 14)
  assert.equal(mergeContractPatches(plan).length, 2)
})

test('unlinked charged history blocks exact projection', () => {
  const plan = buildPlan([contract('a', 'student')], [session('one', 'student', '')])
  assert.equal(plan.unlinkedChargeable.length, 1)
  assert.throws(() => assertSafe(plan), /incomplete or invalid history evidence/)
})
