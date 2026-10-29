'use strict'

// Registration is shared by discovery and the target-specific runtime. Keep
// business handlers in their owning modules so fixes cannot diverge between
// deployment discovery and the worker actually serving requests.
const SCHEDULED_BACKGROUND_TARGETS = Object.freeze([
  'chargeDuePtSessionsScheduled',
  'autoConfirmOverduePtAttendanceScheduled',
  'vestPendingLoyaltySourcesScheduled',
  'advanceLoyaltyMembershipsScheduled',
  'reconcileStaffManagedClientSummariesScheduled',
])

function createScheduledBackgroundFunction(target, { db, databaseId, onSchedule, onDocumentWritten, logger }) {
  if (!SCHEDULED_BACKGROUND_TARGETS.includes(target)) throw new Error('Unknown scheduled background target.')
  if (target === 'advanceLoyaltyMembershipsScheduled') {
    return require('./loyalty-membership').createLoyaltyMembershipFunctions({ db, databaseId, onSchedule, onDocumentWritten })[target]
  }
  if (target === 'vestPendingLoyaltySourcesScheduled') {
    const { reconcilePendingMemberReferrals, vestPendingSources } = require('./loyalty')
    return onSchedule({
      schedule: 'every 30 minutes', region: 'asia-southeast1', timeZone: 'Asia/Ho_Chi_Minh',
      retryCount: 1, cpu: 'gcf_gen1', maxInstances: 1, timeoutSeconds: 540,
    }, async () => {
      const now = new Date()
      const referrals = await reconcilePendingMemberReferrals({ db, logger, now, limit: 100 })
      const sources = await vestPendingSources({ db, logger, now, limit: 300 })
      return { referrals, sources }
    })
  }
  if (target === 'reconcileStaffManagedClientSummariesScheduled') {
    const { reconcileStaffManagedClientSummaries } = require('./staff-managed-summary')
    return onSchedule({
      schedule: '17 * * * *', timeZone: 'Asia/Ho_Chi_Minh', region: 'asia-southeast1',
      cpu: 'gcf_gen1', maxInstances: 1, retryCount: 1, timeoutSeconds: 540,
    }, async () => reconcileStaffManagedClientSummaries({ db, logger }))
  }
  const { chargeDuePtSessions, autoConfirmOverduePtAttendance } = require('./session-operations')
  const handler = target === 'chargeDuePtSessionsScheduled' ? chargeDuePtSessions : autoConfirmOverduePtAttendance
  return onSchedule({
    schedule: 'every 30 minutes', region: 'asia-southeast1', timeZone: 'Asia/Ho_Chi_Minh',
    retryCount: 1, cpu: 'gcf_gen1', concurrency: 1, maxInstances: 1, timeoutSeconds: 540,
  }, async () => handler({ db, now: new Date(), logger, limit: 500, includeRecent: true, includeCatchUp: false, pendingOnly: true }))
}

module.exports = { SCHEDULED_BACKGROUND_TARGETS, createScheduledBackgroundFunction }
