const test = require('node:test')
const assert = require('node:assert/strict')
const {
  calculateReferralCommissions,
  normalizeReferralCode,
  referralCommissionRate,
} = require('./referral-commission')

test('referral code is normalized and commission rate accepts only zero or 2–10 percent', () => {
  assert.equal(normalizeReferralCode(' pt 001 '), 'PT001')
  assert.equal(referralCommissionRate(0), 0)
  assert.equal(referralCommissionRate(2), 2)
  assert.equal(referralCommissionRate(10), 10)
  assert.equal(referralCommissionRate(1), null)
  assert.equal(referralCommissionRate(11), null)
})

test('commission follows posted contract cash flow and a reversal removes the matching earning', () => {
  const result = calculateReferralCommissions({
    staffRecords: [{ id: 'staff-a', employeeCode: 'PT01', commissionRate: 5, status: 'active' }],
    contracts: [{ id: 'contract-a', referralCode: 'pt01' }],
    ledgerEntries: [
      { id: 'pay-1', type: 'payment', status: 'reversed', contractId: 'contract-a', cashImpact: 10_000_000 },
      { id: 'reverse-1', type: 'reversal', status: 'posted', contractId: 'contract-a', cashImpact: -10_000_000 },
      { id: 'pay-2', type: 'payment', status: 'posted', contractId: 'contract-a', cashImpact: 4_000_000 },
    ],
  })
  const evidence = result.byStaff.get('staff-a')
  assert.equal(evidence.cashCollectedAmount, 14_000_000)
  assert.equal(evidence.cashReversedAmount, 10_000_000)
  assert.equal(evidence.netCashAmount, 4_000_000)
  assert.equal(evidence.commissionAmount, 200_000)
  assert.equal(evidence.reversalAmount, 0)
  assert.equal(evidence.contractCount, 1)
})

test('commission is not inferred without a unique PT referral code and valid rate', () => {
  const common = {
    contracts: [{ id: 'contract-a', referralCode: 'DUPLICATE' }],
    ledgerEntries: [{ id: 'pay-1', type: 'payment', status: 'posted', contractId: 'contract-a', cashImpact: 1_000_000 }],
  }
  const ambiguous = calculateReferralCommissions({
    ...common,
    staffRecords: [
      { id: 'staff-a', employeeCode: 'DUPLICATE', commissionRate: 5 },
      { id: 'staff-b', employeeCode: 'DUPLICATE', commissionRate: 5 },
    ],
  })
  assert.equal(ambiguous.ambiguousCodeEntryCount, 1)
  assert.equal(ambiguous.byStaff.size, 0)

  const invalidRate = calculateReferralCommissions({
    ...common,
    staffRecords: [{ id: 'staff-a', employeeCode: 'DUPLICATE', commissionRate: 15 }],
  })
  assert.equal(invalidRate.invalidRateEntryCount, 1)
  assert.equal(invalidRate.byStaff.size, 0)
})
