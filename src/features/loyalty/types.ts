export type LoyaltyTier = 'member' | 'silver' | 'gold' | 'diamond'

export interface LoyaltyTierProgress {
  tier: LoyaltyTier
  nextTier: LoyaltyTier | null
  currentValue: number
  targetValue: number
  remainingValue: number
  percent: number
}

export interface LoyaltyAccount {
  studentId: string
  status: 'active' | 'suspended'
  availablePoints: number
  pendingPoints: number
  reservedPoints: number
  debtPoints: number
  lifetimeEarnedPoints: number
  lifetimeRedeemedPoints: number
  tierQualifyingValue: number
  tier: LoyaltyTier
  tierProgress: LoyaltyTierProgress
  revision: number
  updatedAt?: string
}

export interface LoyaltyMissionProgress {
  id: string
  title?: string
  description?: string
  progress?: number
  target?: number
  rewardPoints?: number
  status?: 'active' | 'completed' | 'claimed' | 'expired'
  updatedAt?: string
}

export interface LoyaltyRecognitionItem {
  id: string
  sessionId: string
  trainerId: string
  message: string
  xp: number
  badge: string
  createdAt: string
}

export interface LoyaltyRecognition {
  totalKudos: number
  totalXp: number
  badges: string[]
  recent: LoyaltyRecognitionItem[]
}

export interface LoyaltyAmbassadorSummary {
  status: 'pending' | 'approved' | 'rejected' | 'suspended'
  quarterId: string
  qualifiedReferrals: number
  pendingCommissionVnd: number
  availableCommissionVnd: number
  paidCommissionVnd: number
}

export interface LoyaltyDashboard {
  schemaVersion: number
  account: LoyaltyAccount
  missions: LoyaltyMissionProgress[]
  recognition: LoyaltyRecognition
  redemptions: LoyaltyMemberRedemption[]
  ambassador: LoyaltyAmbassadorSummary | null
  features: {
    earn: boolean
    redeem: boolean
    referral: boolean
    ambassador: boolean
    nutrition: boolean
  }
}

export interface LoyaltyPolicyConfig {
  vndPerPoint: number
  pointValueVnd: number
  paymentHoldDays: number
  referralHoldDays: number
  referralThresholdPercent: number
  referralRewardPoints: number
  referredWelcomePoints: number
  recurringBehaviorMonthlyCap: number
  nutritionMonthlyCap: number
  largeAdjustmentThreshold: number
  ambassadorPayoutMinimumVnd: number
}

export interface LoyaltyMemberRedemption {
  id: string
  rewardId: string
  rewardName: string
  pointsCost: number
  status: 'pending' | 'approved' | 'fulfilled' | 'rejected' | 'cancelled'
  branchId: string
  fulfillmentType: 'automatic' | 'staff'
  createdAt: string
  updatedAt: string
}

export interface LoyaltyReward {
  id: string
  name: string
  description: string
  pointsCost: number
  category: string
  fulfillmentType: 'automatic' | 'staff'
  entitlementType: string | null
  branchIds: string[]
  stock: number | null
  validityDays: number
  active: boolean
  featured: boolean
}

export interface LoyaltyHistoryEntry {
  id: string
  kind: 'earn' | 'vest' | 'reserve' | 'redeem' | 'release' | 'reverse' | 'adjust'
  sourceType: string
  description: string
  pendingDelta: number
  availableDelta: number
  reservedDelta: number
  debtDelta: number
  sourceBranchId: string
  createdAt: string
  availableAt: string
}

export interface MemberReferralItem {
  id: string
  status: string
  referredName: string
  netCollectedVnd: number
  createdAt: string
  qualifiedAt: string
  holdUntil?: string
  rewardMode?: 'points' | 'ambassador'
}

export interface ReferralWorkspace {
  code: string | null
  referrals: MemberReferralItem[]
  ambassador: (LoyaltyAmbassadorSummary & { id: string; createdAt?: string }) | null
}

export interface LoyaltyAdminDashboard {
  schemaVersion: number
  policyRevision: number
  launchDate: string
  generatedAt: string
  scope: 'all' | string[]
  metrics: {
    memberCount: number
    availablePoints: number
    pendingPoints: number
    reservedPoints: number
    debtPoints: number
    lifetimeRedeemedPoints: number
    pendingRedemptions: number
    fulfilledRedemptions: number
    qualifiedReferrals: number
    approvedAmbassadors: number
    outstandingNominalValueVnd: number
  }
  tiers: Array<{ tier: LoyaltyTier; count: number }>
  features: LoyaltyDashboard['features']
  policy: LoyaltyPolicyConfig
}

export interface LoyaltyBackfillSummary {
  scannedContracts: number
  eligibleTierCreditVnd: number
  activeLaunchStudents: number
  missingStudentId: number
  missingStudentProfile: number
  missingAccountUid: number
  missingBranchId: number
  reconciledContracts: number
  launchBonusesStaged: number
  failures: number
}

export interface LoyaltyBackfillBatchResult {
  mode: 'dry_run' | 'apply'
  launchDate: string
  cursor: string | null
  nextCursor: string | null
  hasMore: boolean
  activeLaunchStudentIds: string[]
  summary: LoyaltyBackfillSummary
}

export interface LoyaltyAdminAccount extends LoyaltyAccount {
  studentName: string
  branchId: string
}

export interface LoyaltyAdminReward extends LoyaltyReward {
  revision: number
  persisted: boolean
}

export interface LoyaltyAdminAmbassador {
  id: string
  studentId: string
  studentName: string
  branchId: string
  status: 'pending' | 'approved' | 'rejected' | 'suspended'
  note: string
  quarterId: string
  qualifiedReferrals: number
  pendingCommissionVnd: number
  availableCommissionVnd: number
  paidCommissionVnd: number
  debtCommissionVnd: number
  revision: number
  createdAt: string
  updatedAt: string
}

export interface LoyaltyReconciliationIssue {
  id: string
  type: string
  status: string
  studentId: string
  studentName: string
  contractId: string
  branchId: string
  errorCode: string
  updatedAt: string
}

export interface LoyaltyAdjustment {
  id: string
  studentId: string
  studentName: string
  branchId: string
  points: number
  reason: string
  status: 'pending_approval' | 'applied' | 'rejected'
  requestedBy: string
  createdAt: string
  reviewedAt: string
}

export type AuraClubTab = 'rewards' | 'missions' | 'levels' | 'referral' | 'history'
