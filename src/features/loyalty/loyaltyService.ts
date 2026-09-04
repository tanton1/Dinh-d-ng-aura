import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { firestoreDb } from '../../lib/firebaseFirestore'
import { firebaseFunctions } from '../../lib/firebaseFunctions'
import type {
  LoyaltyAccount,
  LoyaltyAdminAccount,
  LoyaltyAdminAmbassador,
  LoyaltyAdminDashboard,
  LoyaltyAdminReward,
  LoyaltyDashboard,
  LoyaltyHistoryEntry,
  LoyaltyBackfillBatchResult,
  LoyaltyAdjustment,
  LoyaltyReward,
  LoyaltyReconciliationIssue,
  LoyaltyPolicyConfig,
  ReferralWorkspace,
} from './types'

function functionsInstance() {
  if (!firebaseFunctions) throw new Error('Dịch vụ Aura Club chưa sẵn sàng.')
  return firebaseFunctions
}

async function call<Input, Output>(name: string, input: Input): Promise<Output> {
  return (await httpsCallable<Input, Output>(functionsInstance(), name, { timeout: 30_000 })(input)).data
}

export function getMyLoyaltyDashboard() {
  return call<Record<string, never>, LoyaltyDashboard>('getMyLoyaltyDashboard', {})
}

export function listMyAvailableRewards() {
  return call<Record<string, never>, { rewards: LoyaltyReward[]; redeemEnabled: boolean }>('listMyAvailableRewards', {})
}

export function listMyLoyaltyHistory(offset = 0, pageSize = 30) {
  return call<{ offset: number; pageSize: number }, { entries: LoyaltyHistoryEntry[]; nextOffset: number | null }>('listMyLoyaltyHistory', { offset, pageSize })
}

export function redeemMyReward(input: { rewardId: string; branchId?: string; idempotencyKey: string }) {
  return call<typeof input, { redemptionId: string; status: 'pending' | 'fulfilled'; account: LoyaltyAccount }>('redeemMyReward', input)
}

export function cancelMyPendingRedemption(input: { redemptionId: string; idempotencyKey: string }) {
  return call<typeof input, { redemptionId: string; status: 'cancelled'; account: LoyaltyAccount }>('cancelMyPendingRedemption', input)
}

export function getMyReferralWorkspace() {
  return call<Record<string, never>, ReferralWorkspace>('getMyReferralWorkspace', {})
}

export function createMyReferralCode() {
  return call<Record<string, never>, { code: string; shareUrl: string }>('createMyReferralCode', {})
}

export function applyForAmbassador(note = '') {
  return call<{ note: string }, { status: 'pending' }>('applyForAmbassador', { note })
}

export function getLoyaltyAdminDashboard() {
  return call<Record<string, never>, LoyaltyAdminDashboard>('getLoyaltyAdminDashboard', {})
}

export function getStudentLoyaltySummary(studentId: string) {
  return call<{ studentId: string }, { studentId: string; studentName: string; account: LoyaltyAccount }>('getStudentLoyaltySummary', { studentId })
}

export function giveSessionKudos(input: { sessionId: string; studentId: string; message: string }) {
  return call<typeof input, { sessionId: string; studentId: string; xp: number; badge: string }>('giveSessionKudos', input)
}

export function listLoyaltyRedemptions(status = '') {
  return call<{ status: string }, { redemptions: Array<Record<string, unknown> & { id: string; status: string }> }>('listLoyaltyRedemptions', { status })
}

export function listLoyaltyAccounts(pageSize = 100) {
  return call<{ pageSize: number }, { accounts: LoyaltyAdminAccount[] }>('listLoyaltyAccounts', { pageSize })
}

export function listLoyaltyRewardsAdmin() {
  return call<Record<string, never>, { rewards: LoyaltyAdminReward[] }>('listLoyaltyRewardsAdmin', {})
}

export function saveLoyaltyReward(reward: LoyaltyAdminReward) {
  return call<{
    id: string
    expectedRevision: number
    name: string
    description: string
    pointsCost: number
    category: string
    fulfillmentType: 'automatic' | 'staff'
    entitlementType: string
    branchIds: string[]
    stock: number | null
    validityDays: number
    active: boolean
    featured: boolean
  }, { rewardId: string; revision: number }>('saveLoyaltyReward', {
    id: reward.id,
    expectedRevision: reward.revision,
    name: reward.name,
    description: reward.description,
    pointsCost: reward.pointsCost,
    category: reward.category,
    fulfillmentType: reward.fulfillmentType,
    entitlementType: reward.entitlementType || '',
    branchIds: reward.branchIds,
    stock: reward.stock,
    validityDays: reward.validityDays,
    active: reward.active,
    featured: reward.featured,
  })
}

export function listLoyaltyAmbassadors() {
  return call<Record<string, never>, { ambassadors: LoyaltyAdminAmbassador[] }>('listLoyaltyAmbassadors', {})
}

export function manageAmbassadorProfile(studentId: string, status: 'approved' | 'rejected' | 'suspended') {
  return call<{ studentId: string; status: string }, { studentId: string; status: string }>('manageAmbassadorProfile', { studentId, status })
}

export function approveAmbassadorPayout(studentId: string) {
  return call<{ studentId: string }, { payoutId: string; amountVnd: number; status: string }>('approveAmbassadorPayout', { studentId })
}

export function listLoyaltyReconciliationIssues(status = 'open') {
  return call<{ status: string }, { issues: LoyaltyReconciliationIssue[] }>('listLoyaltyReconciliationIssues', { status })
}

export function listLoyaltyAdjustments(status = 'pending_approval') {
  return call<{ status: string }, { adjustments: LoyaltyAdjustment[] }>('listLoyaltyAdjustments', { status })
}

export function reviewLoyaltyAdjustment(adjustmentId: string, decision: 'approve' | 'reject') {
  return call<{ adjustmentId: string; decision: string }, { adjustmentId: string; status: 'applied' | 'rejected'; account?: LoyaltyAccount }>('reviewLoyaltyAdjustment', { adjustmentId, decision })
}

export function reconcileLoyaltyAccount(studentId: string) {
  return call<{ studentId: string }, { studentId: string; mismatch: boolean; account: LoyaltyAccount }>('reconcileLoyaltyAccount', { studentId })
}

export function adjustLoyaltyBalance(input: { studentId: string; points: number; reason: string; idempotencyKey: string }) {
  return call<typeof input, { adjustmentId: string; status: 'applied' | 'pending_approval'; account?: LoyaltyAccount }>('adjustLoyaltyBalance', input)
}

export function transitionLoyaltyRedemption(redemptionId: string, status: 'approved' | 'fulfilled' | 'rejected' | 'cancelled') {
  return call<{ redemptionId: string; status: string }, { redemptionId: string; status: string }>('transitionLoyaltyRedemption', { redemptionId, status })
}

export function saveLoyaltyPolicy(expectedRevision: number, features: LoyaltyDashboard['features'], policy: LoyaltyPolicyConfig) {
  return call<{ expectedRevision: number; features: LoyaltyDashboard['features']; policy: LoyaltyPolicyConfig }, { policyVersion: string; revision: number }>('saveLoyaltyPolicy', { expectedRevision, features, policy })
}

export function runLoyaltyBackfill(input: { mode: 'dry_run' | 'apply'; cursor?: string; batchSize?: number; launchDate: string }) {
  return call<typeof input, LoyaltyBackfillBatchResult>('runLoyaltyBackfill', input)
}

export function subscribeToLoyaltySummary(
  userId: string,
  onValue: (value: LoyaltyAccount | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!firestoreDb) {
    onValue(null)
    return () => undefined
  }
  return onSnapshot(doc(firestoreDb, 'users', userId, 'loyaltySummary', 'current'), (snapshot) => {
    onValue(snapshot.exists() ? snapshot.data() as LoyaltyAccount : null)
  }, (error) => onError?.(error))
}

export function demoLoyaltyDashboard(): LoyaltyDashboard {
  return {
    schemaVersion: 1,
    account: {
      studentId: 'demo',
      status: 'active',
      availablePoints: 2_480,
      pendingPoints: 180,
      reservedPoints: 0,
      debtPoints: 0,
      lifetimeEarnedPoints: 3_180,
      lifetimeRedeemedPoints: 700,
      tierQualifyingValue: 38_000_000,
      tier: 'gold',
      tierProgress: { tier: 'gold', nextTier: 'diamond', currentValue: 38_000_000, targetValue: 50_000_000, remainingValue: 12_000_000, percent: 52 },
      revision: 1,
    },
    missions: [
      { id: 'weekly-training', title: 'Tập đủ lịch tuần', description: 'Hoàn thành các buổi đã lên lịch', progress: 2, target: 3, rewardPoints: 5, status: 'active' },
      { id: 'nutrition-five-days', title: 'Ăn đúng năm ngày', description: 'Duy trì dinh dưỡng theo mục tiêu', progress: 4, target: 5, rewardPoints: 15, status: 'active' },
    ],
    recognition: {
      totalKudos: 3,
      totalXp: 15,
      badges: ['great_session'],
      recent: [
        { id: 'kudos-demo-1', sessionId: 'session-demo-1', trainerId: 'pt-demo', message: 'Hôm nay bạn giữ kỹ thuật rất tốt!', xp: 5, badge: 'great_session', createdAt: new Date().toISOString() },
      ],
    },
    redemptions: [
      { id: 'demo-redemption', rewardId: 'guest-pass', rewardName: 'Guest Pass', pointsCost: 700, status: 'pending', branchId: 'CS1', fulfillmentType: 'staff', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    ambassador: null,
    features: { earn: true, redeem: true, referral: true, ambassador: true, nutrition: true },
  }
}

export const demoRewards: LoyaltyReward[] = [
  { id: 'assessment', name: 'InBody / Assessment', description: 'Kiểm tra chỉ số cơ thể và nhận tư vấn nhanh.', pointsCost: 500, category: 'assessment', fulfillmentType: 'staff', entitlementType: null, branchIds: [], stock: null, validityDays: 60, active: true, featured: true },
  { id: 'extra-reschedule', name: 'Thêm một lần đổi lịch', description: 'Thêm một quyền đổi lịch ngoài quota trong tháng.', pointsCost: 700, category: 'schedule', fulfillmentType: 'automatic', entitlementType: 'extra_reschedule', branchIds: [], stock: null, validityDays: 60, active: true, featured: true },
  { id: 'guest-pass', name: 'Guest Pass', description: 'Mời một người bạn trải nghiệm Aura.', pointsCost: 700, category: 'guest', fulfillmentType: 'staff', entitlementType: null, branchIds: [], stock: 20, validityDays: 60, active: true, featured: false },
  { id: 'bonus-pt-session', name: 'Một buổi PT bonus', description: 'Được sắp xếp theo công suất còn lại của chi nhánh.', pointsCost: 1_500, category: 'training', fulfillmentType: 'staff', entitlementType: null, branchIds: [], stock: null, validityDays: 60, active: true, featured: false },
  { id: 'renewal-voucher-300k', name: 'Voucher gia hạn 300.000đ', description: 'Áp dụng cho lần gia hạn hợp đồng tiếp theo.', pointsCost: 3_000, category: 'renewal', fulfillmentType: 'staff', entitlementType: null, branchIds: [], stock: null, validityDays: 90, active: true, featured: false },
]
