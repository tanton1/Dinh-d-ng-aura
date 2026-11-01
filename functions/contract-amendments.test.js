'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { amendmentProjection, revisedInstallments } = require('./contract-amendments')
const { allocationForOrdinal, allocationAmount, resolveRevenueAllocation, renewalRevenueAllocation } = require('./pt-revenue-allocation')
const { ptRevenueRecognitionWrite } = require('./finance-recognition')
const { contractSalesContribution } = require('./contract-financial-status')
const { cancellationSalesSnapshot } = require('./contract-cancellation')
const { SALES_CONTRACT_FIELDS } = require('./contract-sales-index')

function fixture({ total = 72, price = 18_000_000, used = 24, paid = 12_000_000 } = {}) {
  const contract = { studentId: 'student', branchId: 'branch', status: 'active', packageId: 'six', packageName: '6 tháng',
    totalSessions: total, usedSessions: used, totalPrice: price, discount: 0, paidAmount: paid, startDate: '2026-09-01', endDate: '2027-03-01', revision: 1 }
  const sessions = Array.from({ length: used }, (_, index) => ({ id: `s${index}`, studentId: 'student', contractId: 'contract',
    status: 'attended', billingStatus: 'charged', serviceOrdinal: index + 1, date: '2026-10-01' }))
  const ledger = sessions.map(row => ({ id: `pt_${row.id}`, type: 'revenue_recognition', status: 'posted', sessionId: row.id,
    serviceOrdinal: row.serviceOrdinal, revenueImpact: allocationAmount(allocationForOrdinal('contract', contract, row.serviceOrdinal)) }))
  ledger.push({ id: 'payment', type: 'payment', cashImpact: paid, status: 'posted' })
  return { contractId: 'contract', contract, sessions, ledger, billings: sessions, today: '2026-11-01',
    target: { packageId: 'three', packageName: '3 tháng', totalSessions: 36, totalPrice: 10_800_000, discount: 0, endDate: '2026-12-01' } }
}
const amounts = allocation => allocation.segments.flatMap(row => Array.from({ length: row.count }, (_, i) => allocationAmount({ ...row, serviceOrdinal: row.startOrdinal + i })))

test('downgrade preserves all posted sessions, exposes refund and apportions only unused value', () => {
  const value = fixture(), before = structuredClone(value), result = amendmentProjection(value)
  assert.deepEqual(result.blockers, []); assert.deepEqual(value, before)
  assert.equal(result.recognized, 6_000_000); assert.equal(result.after.refundDue, 1_200_000)
  assert.equal(result.after.remainingSessions, 12)
  const values = amounts(result.allocation)
  assert.ok(values.slice(0, 24).every(value => value === 250000))
  assert.ok(values.slice(24).every(value => value === 400000))
  assert.equal(values.reduce((a, b) => a + b), 10_800_000)
})
test('upgrade, unchanged-price extra sessions and uneven money conserve every dong', () => {
  for (const [count, price] of [[72, 18_000_000], [48, 10_800_000], [49, 10_800_001]]) {
    const value = fixture({ total: 36, price: 10_800_000, used: 12, paid: 3_000_000 })
    value.target = { ...value.target, totalSessions: count, totalPrice: price, endDate: '2027-03-01' }
    const result = amendmentProjection(value)
    assert.deepEqual(result.blockers, [])
    const values = amounts(result.allocation)
    assert.ok(values.slice(0, 12).every(value => value === 300000))
    assert.equal(values.reduce((a, b) => a + b), price)
  }
})
test('limits, missing cash/revenue, stale usage, duplicate evidence and transferred rights block without allocations', () => {
  const scenarios = [v => { v.target.totalSessions = 20 }, v => { v.target.totalPrice = 5_000_000 },
    v => { v.ledger.pop() }, v => { v.ledger.shift() }, v => { v.contract.usedSessions++ },
    v => { v.ledger.push({ ...v.ledger[0], id: 'duplicate' }) }, v => { v.contract.carryOverTransferredSessions = 1 },
    v => { v.contract.renewedByContractId = 'next' }, v => { v.reviews = [{ status: 'open' }] },
    v => { v.target.endDate = '2026-10-01' }]
  for (const change of scenarios) { const value = fixture(); change(value); const result = amendmentProjection(value); assert.ok(result.blockers.length); assert.equal(result.allocation, null) }
})
test('returned service retains its historical value for safe reuse after amendment', () => {
  const value = fixture({ total: 4, price: 1000, used: 2, paid: 1000 })
  value.contract.usedSessions = 1; value.sessions = value.sessions.slice(1)
  value.billings = [{ ...value.billings[0], billingStatus: 'returned' }, value.billings[1]]
  value.ledger.push({ id: 'reverse', type: 'reversal', status: 'posted', revenueImpact: -250, reversedEntryId: 'pt_s0' })
  value.target = { ...value.target, totalSessions: 6, totalPrice: 1200 }
  const result = amendmentProjection(value)
  assert.deepEqual(result.blockers, []); assert.deepEqual(amounts(result.allocation), [250, 250, 175, 175, 175, 175])
})
test('second amendment preserves post-amendment recognition and renewal carries exact revised values', async () => {
  const input = fixture(), first = amendmentProjection(input)
  const contract = { ...input.contract, ...input.target, revenueAllocation: first.allocation }
  const allocation = await resolveRevenueAllocation({ transaction: {}, db: {}, contractId: 'contract', contract, serviceOrdinal: 25 })
  const recognition = ptRevenueRecognitionWrite({ sessionId: 'next', session: { studentId: 'student', date: '2026-11-01' }, contractId: 'contract',
    contract: allocation.contract, serviceOrdinal: 25, actorUid: 'admin', recognisedRevenueBefore: first.recognized })
  assert.equal(recognition.amount, 400000)
  assert.equal(allocation.contract.totalPrice, 10_800_000)
  const next = { studentId: 'student', totalSessions: 38, packageSessions: 36, carriedOverSessions: 2, totalPrice: 9000000, discount: 0 }
  next.revenueAllocation = renewalRevenueAllocation({ sourceId: 'contract', source: contract, nextId: 'renewal', next, carriedOverSessions: 2 })
  const carried = await resolveRevenueAllocation({ transaction: { get: async () => ({ data: () => contract }) }, db: { doc: value => value }, contractId: 'renewal', contract: next, serviceOrdinal: 1 })
  assert.equal(carried.contract.recognitionUnitAmount, 400000)
  contract.usedSessions++
  const session = { id: 'next', studentId: 'student', serviceOrdinal: 25, billingStatus: 'charged', date: '2026-11-01' }
  const second = amendmentProjection({ ...input, contract, sessions: [...input.sessions, session], billings: [...input.billings, session],
    ledger: [...input.ledger, { ...recognition, id: 'next' }], target: { ...input.target, totalSessions: 48, totalPrice: 14_000_000 } })
  assert.deepEqual(second.blockers, []); assert.equal(amounts(second.allocation)[24], 400000)
  assert.equal(amounts(second.allocation).reduce((a, b) => a + b), 14_000_000)
})
test('original sales bucket survives multiple amendments and cancellation', () => {
  const contract = { status: 'active', totalPrice: 10800000, discount: 0, startDate: '2026-11-01',
    salesOriginalSnapshot: { schemaVersion: 1, netAmount: 18000000, effectiveAt: '2026-09-01' } }
  assert.deepEqual(contractSalesContribution(contract), { amount: 18000000, effectiveAt: '2026-09-01' })
  const cancelled = { ...contract, status: 'cancelled', salesCancellationSnapshot: cancellationSalesSnapshot(contract, '2026-11-01') }
  assert.deepEqual(contractSalesContribution(cancelled), contractSalesContribution(contract))
  assert.ok(SALES_CONTRACT_FIELDS.includes('salesOriginalSnapshot'))
})

test('incoming carried credits stay separate while only the current package changes', () => {
  const value = fixture({ total: 4, price: 900, used: 2, paid: 900 })
  value.contract.carriedOverSessions = 1; value.contract.packageSessions = 3
  value.contract.revenueAllocation = { version: 1, segments: [
    { contractId: 'source', startOrdinal: 10, count: 1, totalSessions: 10, totalPrice: 1000, discount: 0 },
    { contractId: 'contract', startOrdinal: 1, count: 3, totalSessions: 3, totalPrice: 900, discount: 0 },
  ] }
  value.ledger = [{ id: 'own', type: 'revenue_recognition', status: 'posted', sessionId: 's1', serviceOrdinal: 1, revenueImpact: 300 },
    { id: 'paid', type: 'payment', status: 'posted', cashImpact: 900 }]
  value.target = { ...value.target, totalSessions: 6, totalPrice: 1500 }
  const result = amendmentProjection(value)
  assert.deepEqual(result.blockers, [])
  assert.deepEqual(amounts(result.allocation), [100, 300, 300, 300, 300, 300])
  assert.equal(result.allocation.segments[0].contractId, 'source')
})
test('installments preserve paid evidence, refund removes only pending, proportional division is exact', () => {
  const paid = { id: 'paid', amount: 12000000, status: 'paid', date: '2026-09-01', receiptId: 'receipt' }
  const rows = [paid, { id: 'a', status: 'pending', amount: 2000000, date: '2026-11-05' }, { id: 'b', status: 'pending', amount: 4000000, date: '2026-12-05' }]
  assert.deepEqual(revisedInstallments(rows, 0, '2026-11-01', 'amend'), [paid])
  const result = revisedInstallments(rows, 5000001, '2026-11-01', 'amend')
  assert.deepEqual(result[0], paid); assert.equal(result.slice(1).reduce((sum, row) => sum + row.amount, 0), 5000001)
})
