'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { contractSalesContribution, contractSettlementBalance, collectibleContractDebt } = require('./contract-financial-status')
const { cancellationSalesSnapshot } = require('./contract-cancellation')
const { contribution } = require('./operations-dashboard-aggregates')
const { Timestamp } = require('firebase-admin/firestore')

test('cancellation preserves the original Vietnam sales bucket for timestamps and date-key strings', () => {
  for (const signedAt of [Timestamp.fromDate(new Date('2026-10-23T18:00:00Z')), '2026-10-24']) {
    const original = { status: 'active', totalPrice: 1200000, signedAt }
    const cancelled = { ...original, status: 'cancelled', salesCancellationSnapshot: cancellationSalesSnapshot(original, '2026-10-30T10:00:00Z') }
    assert.deepEqual(contribution('contract', cancelled), contribution('contract', original))
    assert.equal(contribution('contract', cancelled).date, '2026-10-24')
  }
})

test('new cancellation preserves signed sale snapshot without inventing a legacy baseline', () => {
  const value = { status: 'cancelled', totalPrice: 12000000, discount: 0, startDate: '2026-01-01' }
  assert.equal(contractSalesContribution(value), null)
  const salesCancellationSnapshot = { schemaVersion: 1, netAmount: 12000000, effectiveAt: '2026-01-01', capturedAt: '2026-02-01' }
  assert.deepEqual(contractSalesContribution({ ...value, salesCancellationSnapshot }), { amount: 12000000, effectiveAt: '2026-01-01' })
  assert.equal(contractSalesContribution({ ...value, salesCancellationSnapshot: { ...salesCancellationSnapshot, netAmount: -1 } }), null)
})

test('cancelled receivable follows verified approved target and canonical cash, never full package price', () => {
  const value = { status: 'cancelled', totalPrice: 12000000, paidAmount: 3000000 }
  assert.equal(collectibleContractDebt(value), 0)
  const summary = { schemaVersion: 1, status: 'approved', settlementAmount: 5000000, canonicalCash: 3000000 }
  assert.equal(collectibleContractDebt({ ...value, cancellationSettlement: summary }), 2000000)
  assert.equal(collectibleContractDebt({ ...value, cancellationSettlement: { ...summary, status: 'pending_approval' } }), 0)
  assert.equal(contractSettlementBalance({ ...value, cancellationSettlement: { ...summary, canonicalCash: 1000000 } }).verified, false)
  const refund = contractSettlementBalance({ ...value, paidAmount: 8000000, cancellationSettlement: { ...summary, canonicalCash: 8000000 } })
  assert.equal(refund.receivable, 0); assert.equal(refund.refundDue, 3000000)
})
