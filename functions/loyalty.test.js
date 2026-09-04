const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const {
  DEFAULT_POLICY,
  ambassadorRateForQualifiedCount,
  applyAvailableEarning,
  calculateAmbassadorCommission,
  calculateSpendPoints,
  consumeAvailablePoints,
  defaultAccount,
  qualifiesMemberReferral,
  normalizeMemberReferralCode,
  referralCollectionSummary,
  redeemReservedPoints,
  releaseReservedPoints,
  renewalBonusRate,
  reverseAvailableEarning,
  sourceDocumentId,
  tierForCredit,
  tierProgress,
} = require('./loyalty-core')
const { attendanceEarnsPoints, consecutiveCompletedWeeks, nutritionDailySummaries, occursOnOrAfterLaunch } = require('./loyalty')

test('Aura Club spend points use real collected cash, current tier and additive renewal bonus', () => {
  assert.equal(calculateSpendPoints({ eligibleCashVnd: 6_000_000, tier: 'member' }), 600)
  assert.equal(calculateSpendPoints({ eligibleCashVnd: 6_000_000, tier: 'silver' }), 660)
  assert.equal(calculateSpendPoints({ eligibleCashVnd: 12_000_000, tier: 'gold', renewalBonus: 0.15 }), 1_619)
  assert.equal(calculateSpendPoints({ eligibleCashVnd: -2_000_000, tier: 'diamond' }), 0)
})

test('renewal bonus is 15 percent before expiry, 5 percent for seven days after and zero later', () => {
  assert.equal(renewalBonusRate({ paymentDate: '2026-09-01', sourceContractEndDate: '2026-09-03', isRenewal: true }), 0.15)
  assert.equal(renewalBonusRate({ paymentDate: '2026-09-10', sourceContractEndDate: '2026-09-03', isRenewal: true }), 0.05)
  assert.equal(renewalBonusRate({ paymentDate: '2026-09-11', sourceContractEndDate: '2026-09-03', isRenewal: true }), 0)
  assert.equal(renewalBonusRate({ paymentDate: '2026-09-01', sourceContractEndDate: '2026-09-03', isRenewal: false }), 0)
})

test('lifetime tier is based on net qualifying value and has clear progress', () => {
  assert.equal(tierForCredit(9_999_999), 'member')
  assert.equal(tierForCredit(10_000_000), 'silver')
  assert.equal(tierForCredit(25_000_000), 'gold')
  assert.equal(tierForCredit(50_000_000), 'diamond')
  assert.deepEqual(tierProgress(20_000_000), {
    tier: 'silver',
    nextTier: 'gold',
    currentValue: 20_000_000,
    targetValue: 25_000_000,
    remainingValue: 5_000_000,
    percent: 67,
  })
})

test('redemption reserves points atomically and cancellation or fulfillment settles the reservation', () => {
  const account = { ...defaultAccount({ studentId: 'student-1' }), availablePoints: 1_000, revision: 2 }
  const reserved = consumeAvailablePoints(account, 700)
  assert.equal(reserved.availablePoints, 300)
  assert.equal(reserved.reservedPoints, 700)
  const cancelled = releaseReservedPoints(reserved, 700)
  assert.equal(cancelled.availablePoints, 1_000)
  assert.equal(cancelled.reservedPoints, 0)
  const fulfilled = redeemReservedPoints(reserved, 700)
  assert.equal(fulfilled.availablePoints, 300)
  assert.equal(fulfilled.reservedPoints, 0)
  assert.equal(fulfilled.lifetimeRedeemedPoints, 700)
})

test('refund after spending creates point debt and new earnings settle debt first', () => {
  const account = { ...defaultAccount({ studentId: 'student-1' }), availablePoints: 100 }
  const reversed = reverseAvailableEarning(account, 250)
  assert.equal(reversed.account.availablePoints, 0)
  assert.equal(reversed.account.debtPoints, 150)
  assert.throws(() => consumeAvailablePoints(reversed.account, 1), /LOYALTY_DEBT_BLOCKS_REDEMPTION/)
  const earned = applyAvailableEarning(reversed.account, 200)
  assert.equal(earned.account.debtPoints, 0)
  assert.equal(earned.account.availablePoints, 50)
})

test('referral requires a new customer, 30 percent net collection and elapsed hold', () => {
  assert.equal(qualifiesMemberReferral({ contractValueVnd: 10_000_000, netCollectedVnd: 3_000_000, holdElapsed: true, isNewCustomer: true }), true)
  assert.equal(qualifiesMemberReferral({ contractValueVnd: 10_000_000, netCollectedVnd: 2_999_999, holdElapsed: true, isNewCustomer: true }), false)
  assert.equal(qualifiesMemberReferral({ contractValueVnd: 10_000_000, netCollectedVnd: 4_000_000, holdElapsed: false, isNewCustomer: true }), false)
  assert.equal(qualifiesMemberReferral({ contractValueVnd: 10_000_000, netCollectedVnd: 4_000_000, holdElapsed: true, isNewCustomer: false }), false)
})

test('Ambassador rates progress 3, 5 and 7 percent without retroactive ambiguity', () => {
  assert.equal(ambassadorRateForQualifiedCount(0), 0)
  assert.equal(ambassadorRateForQualifiedCount(1), 3)
  assert.equal(ambassadorRateForQualifiedCount(5), 3)
  assert.equal(ambassadorRateForQualifiedCount(6), 5)
  assert.equal(ambassadorRateForQualifiedCount(10), 5)
  assert.equal(ambassadorRateForQualifiedCount(11), 7)
  assert.deepEqual(calculateAmbassadorCommission(10_000_000, 6), { ratePercent: 5, amountVnd: 500_000 })
})

test('member referral normalization is isolated from staff codes and net collection survives refunds', () => {
  assert.equal(normalizeMemberReferralCode(' aura-abc12 '), 'AURA-ABC12')
  assert.equal(normalizeMemberReferralCode('x'), '')
  const summary = referralCollectionSummary([
    { id: 'payment-1', type: 'payment', status: 'posted', cashImpact: 2_000_000, effectiveAtMillis: 100 },
    { id: 'payment-2', type: 'payment', status: 'posted', cashImpact: 2_000_000, effectiveAtMillis: 200 },
    { id: 'refund-1', type: 'refund', status: 'posted', cashImpact: -1_500_000, effectiveAtMillis: 300 },
  ], 10_000_000)
  assert.equal(summary.thresholdVnd, 3_000_000)
  assert.equal(summary.thresholdReachedAtMillis, 200)
  assert.equal(summary.netCollectedVnd, 2_500_000)
  assert.equal(summary.thresholdReached, false)
})

test('only manually reviewed charged attendance earns redeemable points', () => {
  assert.equal(attendanceEarnsPoints({ attendanceStatus: 'present', billingStatus: 'charged', confirmationSource: 'manual', recognitionReviewRequired: false }), true)
  assert.equal(attendanceEarnsPoints({ attendanceStatus: 'late', billingStatus: 'charged', confirmationSource: 'manual' }), true)
  assert.equal(attendanceEarnsPoints({ attendanceStatus: 'no_show', billingStatus: 'charged' }), false)
  assert.equal(attendanceEarnsPoints({ attendanceStatus: 'present', billingStatus: 'charged', confirmationSource: 'auto_after_48h', recognitionReviewRequired: true }), false)
})

test('attendance, missions and nutrition never earn before the locked launch date', () => {
  assert.equal(occursOnOrAfterLaunch('2026-09-03', '2026-09-04'), false)
  assert.equal(occursOnOrAfterLaunch('2026-09-04', '2026-09-04'), true)
  assert.equal(occursOnOrAfterLaunch('2026-09-05T22:00:00+07:00', '2026-09-04'), true)
  assert.equal(occursOnOrAfterLaunch('', '2026-09-04'), false)
  assert.equal(occursOnOrAfterLaunch('2026-09-04', ''), false)
})

test('Aura training streak stops at the first incomplete week and counts paired sessions by attendance event', () => {
  assert.equal(consecutiveCompletedWeeks([
    { completed: 3, target: 3 },
    { completed: 4, target: 3 },
    { completed: 2, target: 3 },
    { completed: 5, target: 3 },
  ]), 2)
  assert.equal(consecutiveCompletedWeeks(Array.from({ length: 12 }, () => ({ completed: 3, target: 3 }))), 12)
  assert.equal(consecutiveCompletedWeeks([{ completed: 0, target: 0 }]), 0)
})

test('nutrition compliance requires three approved meals plus real calorie and protein targets', () => {
  const summaries = nutritionDailySummaries([
    { createdAt: '2026-09-04T01:00:00Z', meal: { calories: 500, protein: 30, targetKcal: 1_500, targetProtein: 90 } },
    { createdAt: '2026-09-04T05:00:00Z', meal: { calories: 500, protein: 30, targetKcal: 1_500, targetProtein: 90 } },
    { createdAt: '2026-09-04T11:00:00Z', meal: { calories: 500, protein: 30, targetKcal: 1_500, targetProtein: 90 } },
    { createdAt: '2026-09-05T01:00:00Z', meal: { calories: 1_500, protein: 90, targetKcal: 1_500, targetProtein: 90 } },
  ])
  assert.equal(summaries.length, 2)
  assert.equal(summaries[0].completeDay, true)
  assert.equal(summaries[0].calorieMet, true)
  assert.equal(summaries[0].proteinMet, true)
  assert.equal(summaries[0].planMet, true)
  assert.equal(summaries[1].planMet, false)
})

test('source keys are deterministic and policy defaults keep financial writes paused before launch', () => {
  assert.equal(sourceDocumentId('attendance:session-1'), sourceDocumentId('attendance:session-1'))
  assert.notEqual(sourceDocumentId('attendance:session-1'), sourceDocumentId('attendance:session-2'))
  assert.equal(DEFAULT_POLICY.earnEnabled, false)
  assert.equal(DEFAULT_POLICY.redeemEnabled, false)
  assert.equal(DEFAULT_POLICY.launchWelcomePoints, 200)
})

test('Aura Club endpoints and server-owned rules are statically wired', () => {
  const indexSource = readFileSync(join(__dirname, 'index.js'), 'utf8')
  const rulesSource = readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8')
  for (const name of [
    'getMyLoyaltyDashboard',
    'listMyLoyaltyHistory',
    'redeemMyReward',
    'getLoyaltyAdminDashboard',
    'listLoyaltyRewardsAdmin',
    'listLoyaltyAmbassadors',
    'listLoyaltyReconciliationIssues',
    'saveLoyaltyPolicy',
    'adjustLoyaltyBalance',
    'giveSessionKudos',
    'captureMemberContractReferral',
    'runLoyaltyBackfill',
  ]) {
    assert.match(indexSource, new RegExp(`exports\\.${name} = loyaltyFunctions\\.${name}`))
  }
  assert.match(indexSource, /exports\.syncLoyaltyNutritionReview = onDocumentWritten/)
  for (const collection of ['loyaltyAccounts', 'loyaltyLedgerEntries', 'loyaltySourceBalances', 'loyaltyRedemptions', 'memberReferrals', 'ambassadorProfiles', 'ambassadorCommissionSources', 'ambassadorQuarterCounters', 'loyaltyReconciliationIssues']) {
    assert.match(rulesSource, new RegExp(`match /${collection}/`))
  }
  assert.match(rulesSource, /match \/loyaltySummary\/\{docId\}/)
  assert.match(rulesSource, /allow create, update, delete: if false;/)
})
