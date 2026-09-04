const { createHash } = require('node:crypto')

const LOYALTY_SCHEMA_VERSION = 1
const LOYALTY_POLICY_VERSION = 'aura-club-v1'
const VND_PER_POINT = 10_000
const POINT_VALUE_VND = 100
const PAYMENT_HOLD_DAYS = 14

const DEFAULT_POLICY = Object.freeze({
  schemaVersion: LOYALTY_SCHEMA_VERSION,
  version: LOYALTY_POLICY_VERSION,
  status: 'active',
  vndPerPoint: VND_PER_POINT,
  pointValueVnd: POINT_VALUE_VND,
  paymentHoldDays: PAYMENT_HOLD_DAYS,
  referralHoldDays: 14,
  referralThresholdPercent: 30,
  referralRewardPoints: 1_000,
  referredWelcomePoints: 200,
  launchWelcomePoints: 200,
  nutritionMonthlyCap: 150,
  recurringBehaviorMonthlyCap: 250,
  largeAdjustmentThreshold: 500,
  ambassadorPayoutMinimumVnd: 100_000,
  tierThresholds: {
    member: 0,
    silver: 10_000_000,
    gold: 25_000_000,
    diamond: 50_000_000,
  },
  tierMultipliers: {
    member: 1,
    silver: 1.1,
    gold: 1.2,
    diamond: 1.5,
  },
  attendance: {
    completedPoints: 2,
    weeklyTargetPoints: 5,
    fourWeekStreakPoints: 30,
    twelveSessionsMonthlyPoints: 30,
    eightWeekStreakPoints: 100,
    twelveWeekStreakPoints: 200,
  },
  nutrition: {
    verifiedMealPoints: 1,
    completeDayPoints: 2,
    proteinTargetPoints: 3,
    calorieTargetPoints: 3,
    fiveDayCompliancePoints: 15,
    fourWeekStreakPoints: 50,
  },
  earnEnabled: false,
  redeemEnabled: false,
  referralEnabled: false,
  ambassadorEnabled: false,
  nutritionEnabled: false,
})

const DEFAULT_REWARDS = Object.freeze([
  { id: 'assessment', name: 'InBody / Assessment', pointsCost: 500, category: 'assessment', fulfillmentType: 'staff', validityDays: 60 },
  { id: 'voucher-50k', name: 'Voucher 50.000đ', pointsCost: 500, category: 'voucher', fulfillmentType: 'staff', validityDays: 60 },
  { id: 'extra-reschedule', name: 'Thêm một lần đổi lịch', pointsCost: 700, category: 'schedule', fulfillmentType: 'automatic', entitlementType: 'extra_reschedule', validityDays: 60 },
  { id: 'guest-pass', name: 'Guest Pass', pointsCost: 700, category: 'guest', fulfillmentType: 'staff', validityDays: 60 },
  { id: 'voucher-100k', name: 'Voucher 100.000đ', pointsCost: 1_000, category: 'voucher', fulfillmentType: 'staff', validityDays: 60 },
  { id: 'nutrition-consultation', name: 'Tư vấn dinh dưỡng', pointsCost: 1_000, category: 'nutrition', fulfillmentType: 'staff', validityDays: 60 },
  { id: 'aura-shaker', name: 'Aura Shaker', pointsCost: 1_200, category: 'physical', fulfillmentType: 'staff', validityDays: 90 },
  { id: 'bonus-pt-session', name: 'Một buổi PT bonus', pointsCost: 1_500, category: 'training', fulfillmentType: 'staff', validityDays: 60 },
  { id: 'aura-shirt', name: 'Áo Aura', pointsCost: 1_800, category: 'physical', fulfillmentType: 'staff', validityDays: 90 },
  { id: 'freeze-seven-days', name: 'Freeze thêm bảy ngày', pointsCost: 2_000, category: 'contract', fulfillmentType: 'staff', validityDays: 60 },
  { id: 'renewal-voucher-300k', name: 'Voucher gia hạn 300.000đ', pointsCost: 3_000, category: 'renewal', fulfillmentType: 'staff', validityDays: 90 },
])

const TIERS = Object.freeze(['member', 'silver', 'gold', 'diamond'])

function safeInteger(value, fallback = 0) {
  const result = Number(value)
  return Number.isSafeInteger(result) ? result : fallback
}

function nonNegativeInteger(value, fallback = 0) {
  return Math.max(0, safeInteger(value, fallback))
}

function tierForCredit(value, thresholds = DEFAULT_POLICY.tierThresholds) {
  const credit = Math.max(0, Number(value) || 0)
  if (credit >= Number(thresholds.diamond || 0)) return 'diamond'
  if (credit >= Number(thresholds.gold || 0)) return 'gold'
  if (credit >= Number(thresholds.silver || 0)) return 'silver'
  return 'member'
}

function tierProgress(value, thresholds = DEFAULT_POLICY.tierThresholds) {
  const credit = Math.max(0, Number(value) || 0)
  const tier = tierForCredit(credit, thresholds)
  const index = TIERS.indexOf(tier)
  if (index === TIERS.length - 1) return { tier, nextTier: null, currentValue: credit, targetValue: credit, remainingValue: 0, percent: 100 }
  const nextTier = TIERS[index + 1]
  const lower = Number(thresholds[tier] || 0)
  const upper = Number(thresholds[nextTier] || lower)
  const percent = upper > lower ? Math.round(((credit - lower) / (upper - lower)) * 100) : 100
  return { tier, nextTier, currentValue: credit, targetValue: upper, remainingValue: Math.max(0, upper - credit), percent: Math.max(0, Math.min(100, percent)) }
}

function renewalBonusRate({ paymentDate, sourceContractEndDate, isRenewal }) {
  if (!isRenewal || !paymentDate || !sourceContractEndDate) return 0
  const paidAt = new Date(`${String(paymentDate).slice(0, 10)}T00:00:00.000Z`)
  const endsAt = new Date(`${String(sourceContractEndDate).slice(0, 10)}T00:00:00.000Z`)
  if (Number.isNaN(paidAt.getTime()) || Number.isNaN(endsAt.getTime())) return 0
  const differenceDays = Math.floor((paidAt.getTime() - endsAt.getTime()) / 86_400_000)
  if (differenceDays <= 0) return 0.15
  if (differenceDays <= 7) return 0.05
  return 0
}

function calculateSpendPoints({
  eligibleCashVnd,
  tier = 'member',
  renewalBonus = 0,
  policy = DEFAULT_POLICY,
}) {
  const cash = nonNegativeInteger(eligibleCashVnd)
  const basePoints = Math.floor(cash / nonNegativeInteger(policy.vndPerPoint, VND_PER_POINT))
  const multiplier = Number(policy.tierMultipliers?.[tier] || 1)
  const safeRenewalBonus = Math.max(0, Math.min(1, Number(renewalBonus) || 0))
  return Math.max(0, Math.floor(basePoints * (multiplier + safeRenewalBonus)))
}

function ambassadorRateForQualifiedCount(value) {
  const count = nonNegativeInteger(value)
  if (count >= 11) return 7
  if (count >= 6) return 5
  return count >= 1 ? 3 : 0
}

function qualifiesMemberReferral({ contractValueVnd, netCollectedVnd, holdElapsed, isNewCustomer, fraudStatus = 'clear', policy = DEFAULT_POLICY }) {
  const contractValue = nonNegativeInteger(contractValueVnd)
  const netCollected = nonNegativeInteger(netCollectedVnd)
  if (!isNewCustomer || fraudStatus !== 'clear' || !holdElapsed || contractValue <= 0) return false
  const thresholdPercent = Math.max(1, Math.min(100, nonNegativeInteger(policy.referralThresholdPercent, DEFAULT_POLICY.referralThresholdPercent)))
  return netCollected * 100 >= contractValue * thresholdPercent
}

function normalizeMemberReferralCode(value) {
  const code = String(value || '').trim().replace(/\s+/g, '').toUpperCase()
  return /^[A-Z0-9_-]{5,32}$/.test(code) ? code : ''
}

function referralCollectionSummary(entries = [], contractValueVnd = 0, policy = DEFAULT_POLICY) {
  const contractValue = nonNegativeInteger(contractValueVnd)
  const thresholdPercent = Math.max(1, Math.min(100, nonNegativeInteger(policy.referralThresholdPercent, DEFAULT_POLICY.referralThresholdPercent)))
  const thresholdVnd = Math.ceil(contractValue * thresholdPercent / 100)
  const payments = entries
    .filter((entry) => entry?.status === 'posted' && entry.type === 'payment' && Number(entry.cashImpact ?? entry.amount) > 0)
    .map((entry) => ({
      id: String(entry.id || ''),
      amountVnd: nonNegativeInteger(entry.cashImpact ?? entry.amount),
      effectiveAtMillis: Number(entry.effectiveAtMillis || 0),
    }))
    .sort((left, right) => left.effectiveAtMillis - right.effectiveAtMillis || left.id.localeCompare(right.id))
  const reversedIds = new Set(entries
    .filter((entry) => entry?.status === 'posted' && entry.type === 'reversal' && entry.reversedEntryId)
    .map((entry) => String(entry.reversedEntryId)))
  let runningCollectedVnd = 0
  let thresholdReachedAtMillis = 0
  for (const payment of payments) {
    if (reversedIds.has(payment.id)) continue
    runningCollectedVnd += payment.amountVnd
    if (!thresholdReachedAtMillis && thresholdVnd > 0 && runningCollectedVnd >= thresholdVnd) {
      thresholdReachedAtMillis = payment.effectiveAtMillis
    }
  }
  const refundedVnd = entries
    .filter((entry) => entry?.status === 'posted' && entry.type === 'refund')
    .reduce((total, entry) => total + Math.abs(Math.min(0, Number(entry.cashImpact ?? entry.amount) || 0)), 0)
  const netCollectedVnd = Math.max(0, runningCollectedVnd - refundedVnd)
  return {
    contractValueVnd: contractValue,
    thresholdVnd,
    netCollectedVnd,
    thresholdReachedAtMillis,
    thresholdReached: thresholdVnd > 0 && netCollectedVnd >= thresholdVnd,
  }
}

function calculateAmbassadorCommission(netCollectedVnd, qualifiedSequence) {
  const ratePercent = ambassadorRateForQualifiedCount(qualifiedSequence)
  return {
    ratePercent,
    amountVnd: Math.max(0, Math.floor(nonNegativeInteger(netCollectedVnd) * ratePercent / 100)),
  }
}

function sourceDocumentId(sourceKey) {
  return createHash('sha256').update(String(sourceKey || '')).digest('hex')
}

function defaultAccount({ studentId, accountUid = '' }) {
  return {
    schemaVersion: LOYALTY_SCHEMA_VERSION,
    studentId,
    accountUid,
    status: 'active',
    availablePoints: 0,
    pendingPoints: 0,
    reservedPoints: 0,
    debtPoints: 0,
    lifetimeEarnedPoints: 0,
    lifetimeRedeemedPoints: 0,
    tierQualifyingValue: 0,
    tier: 'member',
    revision: 0,
  }
}

function normalizeAccount(value = {}, fallback = {}) {
  const studentId = String(value.studentId || fallback.studentId || '').trim()
  const accountUid = String(value.accountUid || fallback.accountUid || '').trim()
  const tierQualifyingValue = nonNegativeInteger(value.tierQualifyingValue)
  return {
    ...defaultAccount({ studentId, accountUid }),
    ...value,
    studentId,
    accountUid,
    status: value.status === 'suspended' ? 'suspended' : 'active',
    availablePoints: nonNegativeInteger(value.availablePoints),
    pendingPoints: nonNegativeInteger(value.pendingPoints),
    reservedPoints: nonNegativeInteger(value.reservedPoints),
    debtPoints: nonNegativeInteger(value.debtPoints),
    lifetimeEarnedPoints: nonNegativeInteger(value.lifetimeEarnedPoints),
    lifetimeRedeemedPoints: nonNegativeInteger(value.lifetimeRedeemedPoints),
    tierQualifyingValue,
    tier: tierForCredit(tierQualifyingValue),
    revision: nonNegativeInteger(value.revision),
  }
}

function consumeAvailablePoints(accountValue, points) {
  const account = normalizeAccount(accountValue)
  const requested = nonNegativeInteger(points)
  if (account.status !== 'active') throw new Error('LOYALTY_ACCOUNT_SUSPENDED')
  if (account.debtPoints > 0) throw new Error('LOYALTY_DEBT_BLOCKS_REDEMPTION')
  if (!requested || account.availablePoints < requested) throw new Error('LOYALTY_INSUFFICIENT_POINTS')
  return {
    ...account,
    availablePoints: account.availablePoints - requested,
    reservedPoints: account.reservedPoints + requested,
    revision: account.revision + 1,
  }
}

function releaseReservedPoints(accountValue, points) {
  const account = normalizeAccount(accountValue)
  const requested = nonNegativeInteger(points)
  if (!requested || account.reservedPoints < requested) throw new Error('LOYALTY_INVALID_RESERVATION')
  return {
    ...account,
    availablePoints: account.availablePoints + requested,
    reservedPoints: account.reservedPoints - requested,
    revision: account.revision + 1,
  }
}

function redeemReservedPoints(accountValue, points) {
  const account = normalizeAccount(accountValue)
  const requested = nonNegativeInteger(points)
  if (!requested || account.reservedPoints < requested) throw new Error('LOYALTY_INVALID_RESERVATION')
  return {
    ...account,
    reservedPoints: account.reservedPoints - requested,
    lifetimeRedeemedPoints: account.lifetimeRedeemedPoints + requested,
    revision: account.revision + 1,
  }
}

function memberReferralRewardActivated({ wasActivated = false, programCanStart = false, qualifies = false }) {
  return wasActivated === true || (programCanStart === true && qualifies === true)
}

function redemptionTransitionEffects(nextStatus, points) {
  const settledPoints = nonNegativeInteger(points)
  if (nextStatus === 'fulfilled') {
    return {
      availableDelta: 0,
      reservedDelta: -settledPoints,
      restoreStock: false,
      settlement: 'redeem',
    }
  }
  if (nextStatus === 'rejected' || nextStatus === 'cancelled') {
    return {
      availableDelta: settledPoints,
      reservedDelta: -settledPoints,
      restoreStock: true,
      settlement: 'release',
    }
  }
  return {
    availableDelta: 0,
    reservedDelta: 0,
    restoreStock: false,
    settlement: 'none',
  }
}

function applyAvailableEarning(accountValue, points) {
  const account = normalizeAccount(accountValue)
  const earned = nonNegativeInteger(points)
  const debtPaid = Math.min(account.debtPoints, earned)
  return {
    account: {
      ...account,
      availablePoints: account.availablePoints + earned - debtPaid,
      debtPoints: account.debtPoints - debtPaid,
      lifetimeEarnedPoints: account.lifetimeEarnedPoints + earned,
      revision: account.revision + (earned > 0 ? 1 : 0),
    },
    availableDelta: earned - debtPaid,
    debtDelta: -debtPaid,
  }
}

function reverseAvailableEarning(accountValue, points) {
  const account = normalizeAccount(accountValue)
  const reversed = nonNegativeInteger(points)
  const availableTaken = Math.min(account.availablePoints, reversed)
  const debtAdded = reversed - availableTaken
  return {
    account: {
      ...account,
      availablePoints: account.availablePoints - availableTaken,
      debtPoints: account.debtPoints + debtAdded,
      revision: account.revision + (reversed > 0 ? 1 : 0),
    },
    availableDelta: -availableTaken,
    debtDelta: debtAdded,
  }
}

module.exports = {
  DEFAULT_POLICY,
  DEFAULT_REWARDS,
  LOYALTY_POLICY_VERSION,
  LOYALTY_SCHEMA_VERSION,
  PAYMENT_HOLD_DAYS,
  POINT_VALUE_VND,
  TIERS,
  VND_PER_POINT,
  ambassadorRateForQualifiedCount,
  applyAvailableEarning,
  calculateSpendPoints,
  calculateAmbassadorCommission,
  consumeAvailablePoints,
  defaultAccount,
  normalizeAccount,
  qualifiesMemberReferral,
  memberReferralRewardActivated,
  normalizeMemberReferralCode,
  referralCollectionSummary,
  redemptionTransitionEffects,
  redeemReservedPoints,
  releaseReservedPoints,
  renewalBonusRate,
  reverseAvailableEarning,
  sourceDocumentId,
  tierForCredit,
  tierProgress,
}
