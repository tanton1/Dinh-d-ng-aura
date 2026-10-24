'use strict'

const { createLoyaltyFunctions } = require('./loyalty')
const { createPtWorkoutTrackingFunctions } = require('./pt-workout-tracking')

// This project currently allows only three Cloud Run regions. Reuse Jakarta
// for bounded, IO-heavy reads; do not create a fourth region or duplicate any
// Firestore trigger, scheduler, redemption or workout mutation.
const REGIONAL_READ_OPTIONS = Object.freeze({
  region: 'asia-southeast2',
  memory: '256MiB',
  cpu: 0.1666,
  minInstances: 0,
  maxInstances: 2,
  concurrency: 1,
  timeoutSeconds: 60,
})

function createRegionalReadAliases({ db, onCall, logger }) {
  const boundedReadCall = (optionsOrHandler, maybeHandler) => onCall({
    ...(typeof optionsOrHandler === 'function' ? {} : optionsOrHandler),
    // Factories may set their legacy region. The alias profile must win.
    ...REGIONAL_READ_OPTIONS,
  }, typeof optionsOrHandler === 'function' ? optionsOrHandler : maybeHandler)
  const loyalty = createLoyaltyFunctions({ db, onCall: boundedReadCall, logger })
  const workout = createPtWorkoutTrackingFunctions({ db, onCall: boundedReadCall })
  return {
    getLoyaltyAdminDashboardRegional: loyalty.getLoyaltyAdminDashboard,
    getMyLoyaltyDashboardRegional: loyalty.getMyLoyaltyDashboard,
    listMyAvailableRewardsRegional: loyalty.listMyAvailableRewards,
    listMyLoyaltyHistoryRegional: loyalty.listMyLoyaltyHistory,
    getMyReferralWorkspaceRegional: loyalty.getMyReferralWorkspace,
    getStudentLoyaltySummaryRegional: loyalty.getStudentLoyaltySummary,
    getPtWorkoutWorkspaceRegional: workout.getPtWorkoutWorkspace,
    getPtStudentTrainingPlanRegional: workout.getPtStudentTrainingPlan,
    listPtWorkoutHistoryRegional: workout.listPtWorkoutHistory,
  }
}

module.exports = { createRegionalReadAliases, REGIONAL_READ_OPTIONS }
