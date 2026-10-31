'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { allocationForOrdinal, renewalRevenueAllocation, resolveRevenueAllocation } = require('./pt-revenue-allocation')
const { recognitionForServiceOrdinal } = require('./finance-recognition')
const { runPtTransaction } = require('./pt-transaction')
const source = { studentId: 'student', totalSessions: 36, usedSessions: 33, totalPrice: 9600000, discount: 0, paidAmount: 9600000 }
const next = { studentId: 'student', totalSessions: 39, packageSessions: 36, carriedOverSessions: 3, totalPrice: 10800000, discount: 1200000 }
test('three carried shares preserve their original rounding and never dilute 36 purchased shares', () => {
  const contract = { ...next, revenueAllocation: renewalRevenueAllocation({ sourceId: 'source', source, nextId: 'next', next, carriedOverSessions: 3 }) }
  const amounts = Array.from({ length: 39 }, (_, n) => { const a = allocationForOrdinal('next', contract, n + 1)
    return recognitionForServiceOrdinal(a, a.serviceOrdinal) })
  assert.deepEqual(amounts.slice(0, 3), [266666, 266666, 266666])
  assert.equal(amounts[3], 266667); assert.equal(amounts.slice(3).reduce((s, n) => s + n, 0), 9600000)
  assert.equal(amounts.reduce((s, n) => s + n, 0), 10399998)
})
test('handover transfers actual free shares when historical ordinals have gaps', () => {
  const small = { ...source, totalSessions: 5, usedSessions: 3, revenueOccupiedOrdinals: [1, 3, 4] }
  const target = { ...next, totalSessions: 38, carriedOverSessions: 2 }
  target.revenueAllocation = renewalRevenueAllocation({ sourceId: 'source', source: small, nextId: 'next', next: target, carriedOverSessions: 2 })
  assert.equal(allocationForOrdinal('next', target, 1).serviceOrdinal, 2)
  assert.equal(allocationForOrdinal('next', target, 2).serviceOrdinal, 5)
  assert.equal(allocationForOrdinal('next', target, 3).serviceOrdinal, 1)
})
test('missing legacy carry allocation and duplicate source shares fail closed', () => {
  assert.throws(() => allocationForOrdinal('next', next, 1), error => error.details.issueCode === 'RECOGNITION_CARRY_VALUE_REQUIRES_REVIEW')
  const segment = { contractId: 'source', startOrdinal: 1, count: 1, totalSessions: 36, totalPrice: 9600000, discount: 0 }
  assert.throws(() => allocationForOrdinal('next', { ...next, totalSessions: 2, revenueAllocation: { version: 1, segments: [segment, segment] } }, 1))
})
test('a later price edit cannot silently reprice an allocated source share', async () => {
  const contract = { ...next, revenueAllocation: renewalRevenueAllocation({ sourceId: 'source', source, nextId: 'next', next, carriedOverSessions: 3 }) }
  const db = { doc: path => path }, transaction = { get: async () => ({ data: () => ({ ...source, totalPrice: 12000000 }) }) }
  await assert.rejects(resolveRevenueAllocation({ transaction, db, contractId: 'next', contract, serviceOrdinal: 1 }), error => error.details.issueCode === 'RECOGNITION_CARRY_VALUE_REQUIRES_REVIEW')
})
test('only a closed-transaction transport failure receives one bounded replay', async () => {
  let calls = 0
  const closed = Object.assign(Error('transport'), { code: 3, details: 'Transaction is invalid or closed.' })
  assert.equal(await runPtTransaction({ runTransaction: async fn => { if (++calls === 1) throw closed; return fn('fresh') } }, tx => tx), 'fresh')
  assert.equal(calls, 2)
  calls = 0
  await assert.rejects(runPtTransaction({ runTransaction: async () => { calls++; throw closed } }, () => {}))
  assert.equal(calls, 2)
  calls = 0
  await assert.rejects(runPtTransaction({ runTransaction: async () => { calls++; throw Object.assign(Error('business'), { code: 'failed-precondition' }) } }, () => {}), /business/)
  assert.equal(calls, 1)
})
