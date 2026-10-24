/** Only explicitly reviewed, idempotent reads may cross regional boundaries. */
export const regionalReadAliases = {
  getLoyaltyAdminDashboard: 'getLoyaltyAdminDashboardRegional',
  getMyLoyaltyDashboard: 'getMyLoyaltyDashboardRegional',
  listMyAvailableRewards: 'listMyAvailableRewardsRegional',
  listMyLoyaltyHistory: 'listMyLoyaltyHistoryRegional',
  getMyReferralWorkspace: 'getMyReferralWorkspaceRegional',
  getStudentLoyaltySummary: 'getStudentLoyaltySummaryRegional',
  getPtWorkoutWorkspace: 'getPtWorkoutWorkspaceRegional',
  getPtStudentTrainingPlan: 'getPtStudentTrainingPlanRegional',
  listPtWorkoutHistory: 'listPtWorkoutHistoryRegional',
} as const

export type RegionalReadName = keyof typeof regionalReadAliases

export function isRegionalReadName(name: string): name is RegionalReadName {
  return Object.prototype.hasOwnProperty.call(regionalReadAliases, name)
}
