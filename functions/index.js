const { initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { getDatabase } = require('firebase-admin/database')
const { FieldValue, getFirestore } = require('firebase-admin/firestore')
const { getMessaging } = require('firebase-admin/messaging')
const { getStorage } = require('firebase-admin/storage')
const { HttpsError, onCall: firebaseOnCall } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { setGlobalOptions } = require('firebase-functions/v2/options')
const { logger } = require('firebase-functions')
const { createHash } = require('node:crypto')
const { createGenerativeAiFunctions } = require('./generative-ai')
const { createNutritionFunctions } = require('./nutrition')
const { createEatCleanFunctions } = require('./eat-clean')
const { buildCompletedOnboardingDefaultsPatch } = require('./profile-defaults')
const { createIdentityAccessFunctions } = require('./identity-access')
const { createPtOperationsV2Functions } = require('./pt-operations-v2')
const { createSessionFeedbackFunctions } = require('./session-feedback')
const { createPtSchedulePublishFunctions } = require('./pt-schedule-publish')
const { createPtScheduleV2Functions } = require('./pt-schedule-v2')
const { createFinanceLedgerFunctions } = require('./finance-ledger')
const { autoConfirmOverduePtAttendance, chargeDuePtSessions, createSessionOperationFunctions, remindUnconfirmedPtAttendance } = require('./session-operations')
const { createPayrollFunctions, priceTeachingSlots, payrollPolicyProfiles, payrollProfile, policySupportsProfile } = require('./payroll')
const { createStaffPayrollFunctions } = require('./staff-payroll')
const { createOperationsDashboardFunctions } = require('./operations-dashboard')
const { pruneExpiredDashboardCache } = require('./operations-dashboard-cache')
const { rebuildOperationsDailyAggregates, syncDailyAggregateWrite } = require('./operations-dashboard-aggregates')
const { createCashbookFunctions } = require('./cashbook')
const { createBusinessReportingFunctions } = require('./business-reporting')
const { createExerciseCatalogFunctions } = require('./exercise-catalog')
const { createPtWorkoutTrackingFunctions } = require('./pt-workout-tracking')
const { createNutritionReviewFunctions } = require('./nutrition-reviews')
const { createContractRenewalFunctions } = require('./contract-renewals')
const { createLoyaltyFunctions, reconcileAttendance: reconcileLoyaltyAttendance, reconcileAttendanceMissions, reconcileContractSpend: reconcileLoyaltyContractSpend, reconcileMemberReferral, reconcileNutritionReview, reconcilePendingMemberReferrals, vestPendingSources } = require('./loyalty')
const { syncContractUsageProjection } = require('./contract-usage')
const { createStudent360Functions, reconcileStudent360ProjectionBatch, syncStudent360ProjectionFromEvent } = require('./student-360')

const app = initializeApp()
// Keep callable writes on the same named database used by the production web app.
// FIRESTORE_DATABASE_ID is optional for controlled environments; the fallback is
// the canonical Aura production database and is contract-tested against Firebase config.
const defaultFirestoreDatabaseId = 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'
const databaseId = process.env.FIRESTORE_DATABASE_ID || defaultFirestoreDatabaseId
const db = getFirestore(app, databaseId)
const auth = getAuth(app)
const messaging = getMessaging(app)
const storage = getStorage(app)
function configuredRealtimeDatabase() {
  let databaseUrl = process.env.FIREBASE_DATABASE_URL || ''
  if (!databaseUrl && process.env.FIREBASE_CONFIG) {
    try {
      databaseUrl = JSON.parse(process.env.FIREBASE_CONFIG).databaseURL || ''
    } catch {
      databaseUrl = ''
    }
  }
  return databaseUrl ? getDatabase(app, databaseUrl) : null
}
const realtimeDb = configuredRealtimeDatabase()

async function cleanupStaleAiCoachImages(now = Date.now()) {
  const [files] = await storage.bucket().getFiles({
    prefix: 'nutrition-scans/',
    maxResults: 500,
    autoPaginate: false,
  })
  const cutoff = now - 24 * 60 * 60 * 1000
  const staleFiles = files.filter((file) => {
    const purpose = file.metadata?.metadata?.purpose
    const createdAt = Date.parse(file.metadata?.timeCreated || file.metadata?.updated || '')
    return ['ai-coach-body', 'ai-coach-meal'].includes(purpose)
      && Number.isFinite(createdAt)
      && createdAt <= cutoff
  })
  let deletedImages = 0
  for (let offset = 0; offset < staleFiles.length; offset += 20) {
    const results = await Promise.allSettled(
      staleFiles.slice(offset, offset + 20).map((file) => file.delete({ ignoreNotFound: true })),
    )
    deletedImages += results.filter((result) => result.status === 'fulfilled').length
  }
  return { scannedImages: files.length, deletedImages }
}

exports.syncPtContractUsageProjection = onDocumentWritten({
  document: 'sessions/{sessionId}',
  database: databaseId,
  region: 'asia-southeast1',
  maxInstances: 3,
}, async (event) => syncContractUsageProjection({ db, event, logger }))

const operationsAggregateTriggerOptions = (document) => ({
  document,
  database: databaseId,
  region: 'asia-southeast1',
  maxInstances: 5,
  retry: true,
})
exports.syncOperationsLedgerDailyAggregate = onDocumentWritten(
  operationsAggregateTriggerOptions('ledgerEntries/{entryId}'),
  async (event) => syncDailyAggregateWrite({ db, source: 'ledger', event, logger }),
)
exports.syncOperationsSessionDailyAggregate = onDocumentWritten(
  operationsAggregateTriggerOptions('sessions/{sessionId}'),
  async (event) => syncDailyAggregateWrite({ db, source: 'session', event, logger }),
)
exports.syncOperationsAttendanceDailyAggregate = onDocumentWritten(
  operationsAggregateTriggerOptions('attendanceEvents/{eventId}'),
  async (event) => syncDailyAggregateWrite({ db, source: 'attendance', event, logger }),
)
exports.syncOperationsContractDailyAggregate = onDocumentWritten(
  operationsAggregateTriggerOptions('contracts/{contractId}'),
  async (event) => syncDailyAggregateWrite({ db, source: 'contract', event, logger }),
)
exports.syncOperationsStudentDailyAggregate = onDocumentWritten(
  operationsAggregateTriggerOptions('students/{studentId}'),
  async (event) => syncDailyAggregateWrite({ db, source: 'student', event, logger }),
)

exports.syncLoyaltyContractSpend = onDocumentWritten({
  document: 'ledgerEntries/{entryId}',
  database: databaseId,
  region: 'asia-southeast1',
  maxInstances: 3,
  retry: true,
}, async (event) => {
  const before = event.data?.before?.data?.() || {}
  const after = event.data?.after?.data?.() || {}
  const contractId = after.contractId || before.contractId || ''
  if (!contractId || !['payment', 'refund', 'reversal'].includes(after.type || before.type)) return null
  const spend = await reconcileLoyaltyContractSpend({ db, contractId, logger })
  const referral = await reconcileMemberReferral({ db, contractId, logger })
  return { spend, referral }
})

exports.syncLoyaltyAttendance = onDocumentWritten({
  document: 'attendanceEvents/{attendanceId}',
  database: databaseId,
  region: 'asia-southeast1',
  maxInstances: 3,
  retry: true,
}, async (event) => {
  const afterValue = event.data?.after?.data?.()
  const beforeValue = event.data?.before?.data?.() || {}
  const value = afterValue || { ...beforeValue, attendanceStatus: 'deleted', billingStatus: '' }
  const points = await reconcileLoyaltyAttendance({ db, attendanceId: event.params.attendanceId, value, logger })
  const missions = await reconcileAttendanceMissions({ db, attendanceId: event.params.attendanceId, value, logger })
  return { points, missions }
})

exports.syncLoyaltyNutritionReview = onDocumentWritten({
  document: 'mealReviews/{reviewId}',
  database: databaseId,
  region: 'asia-southeast1',
  maxInstances: 2,
  retry: true,
}, async (event) => reconcileNutritionReview({
  db,
  reviewId: event.params.reviewId,
  beforeValue: event.data?.before?.data?.() || {},
  afterValue: event.data?.after?.data?.() || {},
  logger,
}))

exports.vestPendingLoyaltySourcesScheduled = onSchedule({
  schedule: 'every 30 minutes',
  region: 'asia-southeast1',
  timeZone: 'Asia/Ho_Chi_Minh',
  retryCount: 1,
  cpu: 'gcf_gen1',
  maxInstances: 1,
  timeoutSeconds: 540,
}, async () => {
  const now = new Date()
  const referrals = await reconcilePendingMemberReferrals({ db, logger, now, limit: 100 })
  const sources = await vestPendingSources({ db, logger, now, limit: 300 })
  return { referrals, sources }
})

exports.cleanupEatCleanLiveLocations = onSchedule({
  schedule: 'every 60 minutes',
  region: 'asia-southeast1',
  timeZone: 'Asia/Ho_Chi_Minh',
  retryCount: 1,
  cpu: 'gcf_gen1',
  memory: '256MiB',
  maxInstances: 1,
}, async () => {
  let deletedLocations = 0
  if (!realtimeDb) {
    logger.warn('Eat Clean GPS cleanup skipped because Realtime Database is not configured.')
  } else {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    const snapshot = await realtimeDb.ref('eatCleanLiveLocations').orderByChild('updatedAt').endAt(cutoff).limitToFirst(500).get()
    const updates = {}
    snapshot.forEach((item) => { updates[item.key] = null })
    deletedLocations = Object.keys(updates).length
    if (deletedLocations) await realtimeDb.ref('eatCleanLiveLocations').update(updates)
  }
  const imageCleanup = await cleanupStaleAiCoachImages()
  logger.info('Stale private location and AI image cleanup completed', {
    deletedLocations,
    ...imageCleanup,
  })
})
const assignableRoles = new Set(['student', 'coach', 'editor', 'shipper', 'admin', 'super_admin'])
const privilegedAdminRoles = new Set(['admin', 'super_admin'])
const academyStaffRoles = new Set(['editor', 'admin', 'super_admin'])
const coachingStaffRoles = new Set(['coach', 'admin', 'super_admin'])
const coachOnlyRoles = new Set(['coach'])
const studentOnlyRoles = new Set(['student'])
const ptScheduleActorRoles = new Set(['student', 'coach', 'admin', 'super_admin'])
const quizAnswerLimit = 100
const quizMaxAttemptLimit = 20
const mediaUrlTtlMs = 5 * 60 * 1000
const enforceAppCheck = process.env.ENFORCE_APP_CHECK === 'true'
const enforceAiAppCheck = (
  process.env.ENFORCE_AI_APP_CHECK ?? process.env.ENFORCE_APP_CHECK ?? 'true'
) === 'true'
const publicAppUrl = process.env.PUBLIC_APP_URL || 'https://dinh-duong-aura.vercel.app'
const clientIncidentRateWindows = new Map()

const appCheckPolicyLog = {
  broadEnforced: enforceAppCheck,
  aiEnforced: enforceAiAppCheck,
  action: enforceAppCheck
    ? 'All callable requests without a valid App Check token are rejected.'
    : enforceAiAppCheck
      ? 'Paid AI callables require a valid App Check token; other callables remain in compatibility mode.'
      : 'Configure the web provider and ENFORCE_AI_APP_CHECK=true before the AI enforcement cutover.',
  schemaVersion: 2,
}
if (enforceAppCheck || enforceAiAppCheck) logger.info('Aura App Check policy', appCheckPolicyLog)
else logger.warn('Aura App Check policy', appCheckPolicyLog)

function onCall(optionsOrHandler, maybeHandler) {
  if (typeof optionsOrHandler === 'function') {
    // Callable endpoints must be reachable by the Firebase Web SDK. Identity,
    // App Check and capability checks still run inside each handler; this only
    // prevents Cloud Run IAM from rejecting the request before Firebase can
    // validate those credentials.
    return firebaseOnCall({ enforceAppCheck, invoker: 'public' }, optionsOrHandler)
  }
  return firebaseOnCall({ invoker: 'public', ...optionsOrHandler, enforceAppCheck }, maybeHandler)
}

function boundedIncidentValue(value, maximum) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function allowClientIncident(request) {
  const source = request.auth?.uid
    || request.app?.appId
    || createHash('sha256').update(String(request.rawRequest?.ip || 'unknown')).digest('hex').slice(0, 20)
  const now = Date.now()
  const previous = clientIncidentRateWindows.get(source)
  const sameWindow = previous && now - previous.startedAt < 5 * 60 * 1000
  const count = sameWindow ? previous.count + 1 : 1
  clientIncidentRateWindows.set(source, { startedAt: sameWindow ? previous.startedAt : now, count })
  if (clientIncidentRateWindows.size > 200) {
    for (const [key, window] of clientIncidentRateWindows) {
      if (now - window.startedAt > 5 * 60 * 1000) clientIncidentRateWindows.delete(key)
    }
  }
  return count <= 20
}

// This label is an auditable release marker and also ensures every Gen 2
// service receives the same packaged dependency graph when shared modules
// change outside its entrypoint declaration.
setGlobalOptions({
  region: 'asia-southeast1',
  maxInstances: 3,
  labels: { 'aura-release': 'quota-safe-v1-20260830' },
})

Object.assign(exports, createNutritionFunctions({ app, db }))
Object.assign(exports, createGenerativeAiFunctions({ db }))
Object.assign(exports, createEatCleanFunctions({ db, realtimeDb, onCall, requireTrustedAdmin, logger }))
const identityAccessFunctions = createIdentityAccessFunctions({ db, auth, onCall, logger })
Object.assign(exports, identityAccessFunctions)
exports.getMyAccessContext = identityAccessFunctions.getMyAccessContext
// The Firebase CLI can selectively deploy these public account endpoints only
// when it can discover them as static exports.  Keeping the factory assignment
// preserves existing exports while avoiding a quota-heavy full Functions deploy.
exports.provisionStudentAccount = identityAccessFunctions.provisionStudentAccount
exports.provisionStaffAccount = identityAccessFunctions.provisionStaffAccount
exports.createAccountInvite = identityAccessFunctions.createAccountInvite
exports.assignStaffPositions = identityAccessFunctions.assignStaffPositions
exports.suspendAccountAccess = identityAccessFunctions.suspendAccountAccess
exports.deleteUnusedStaffAccount = identityAccessFunctions.deleteUnusedStaffAccount
exports.deleteMemberAccount = identityAccessFunctions.deleteMemberAccount
exports.saveStaffOperationsProfile = identityAccessFunctions.saveStaffOperationsProfile
exports.applyDefaultTrainerSchedulingPolicy = identityAccessFunctions.applyDefaultTrainerSchedulingPolicy
const nutritionReviewFunctions = createNutritionReviewFunctions({ db, onCall })
Object.assign(exports, nutritionReviewFunctions)
exports.listNutritionMealReviews = nutritionReviewFunctions.listNutritionMealReviews
exports.assignNutritionCoach = nutritionReviewFunctions.assignNutritionCoach
exports.reviewNutritionMeal = nutritionReviewFunctions.reviewNutritionMeal
Object.assign(exports, createOperationsDashboardFunctions({ db, onCall, logger }))
exports.cleanupOperationsDashboardCache = onSchedule({
  schedule: 'every 6 hours',
  region: 'asia-southeast1',
  timeZone: 'Asia/Ho_Chi_Minh',
  retryCount: 1,
  maxInstances: 1,
}, async () => pruneExpiredDashboardCache({ db, logger }))
exports.rebuildOperationsDashboardAggregatesScheduled = onSchedule({
  schedule: '15 1 * * *',
  region: 'asia-southeast1',
  timeZone: 'Asia/Ho_Chi_Minh',
  retryCount: 1,
  maxInstances: 1,
  timeoutSeconds: 540,
  memory: '1GiB',
}, async () => rebuildOperationsDailyAggregates({ db, logger, days: 366 }))
Object.assign(exports, createCashbookFunctions({ db, onCall }))
const ptOperationsV2Functions = createPtOperationsV2Functions({ db, onCall, logger })
Object.assign(exports, ptOperationsV2Functions)

// Keep new callable entry points statically discoverable by the Firebase CLI.
// The rest of the PT operations factory remains assigned above for backwards
// compatibility with already deployed functions.
exports.listMyStudentPtSchedule = ptOperationsV2Functions.listMyStudentPtSchedule
exports.saveMyStudentAvailability = ptOperationsV2Functions.saveMyStudentAvailability
exports.getMyTrainerAvailability = ptOperationsV2Functions.getMyTrainerAvailability
exports.saveMyTrainerAvailability = ptOperationsV2Functions.saveMyTrainerAvailability
exports.getMyCoachWorkspaceScope = ptOperationsV2Functions.getMyCoachWorkspaceScope
exports.getMyTrainerWorkspace = ptOperationsV2Functions.getMyTrainerWorkspace
exports.listMyTrainerSchedule = ptOperationsV2Functions.listMyTrainerSchedule
exports.getMyTrainerStudentDetail = ptOperationsV2Functions.getMyTrainerStudentDetail
exports.recordMySessionAttendance = ptOperationsV2Functions.recordMySessionAttendance
exports.bulkConfirmMySessions = ptOperationsV2Functions.bulkConfirmMySessions
exports.getMySalesWorkspace = ptOperationsV2Functions.getMySalesWorkspace
const student360Functions = createStudent360Functions({ db, onCall, storage, logger })
Object.assign(exports, student360Functions)
exports.listStudent360Directory = student360Functions.listStudent360Directory
exports.getStudent360Overview = student360Functions.getStudent360Overview
exports.listStudent360Timeline = student360Functions.listStudent360Timeline
exports.createStudentCareActivity = student360Functions.createStudentCareActivity
exports.getStudent360ProgressPhotos = student360Functions.getStudent360ProgressPhotos
exports.refreshStudent360Projection = student360Functions.refreshStudent360Projection
exports.getStudent360ContractWorkspace = student360Functions.getStudent360ContractWorkspace
exports.mutateStudent360Contract = student360Functions.mutateStudent360Contract

const student360Trigger = (document) => onDocumentWritten({
  document,
  database: databaseId,
  region: 'asia-southeast1',
  cpu: 'gcf_gen1',
  maxInstances: 3,
  retry: true,
}, async (event) => syncStudent360ProjectionFromEvent({ db, event, logger }))

// Keep the overview projection fresh from canonical sources. The callable also
// repairs a missing/stale projection on demand, so a failed trigger never
// leaves the workspace permanently unavailable.
exports.syncStudent360Student = student360Trigger('students/{studentId}')
exports.syncStudent360Contract = student360Trigger('contracts/{documentId}')
exports.syncStudent360Session = student360Trigger('sessions/{documentId}')
exports.syncStudent360Attendance = student360Trigger('attendanceEvents/{documentId}')
exports.syncStudent360Availability = student360Trigger('ptAvailability/{availabilityId}')
exports.syncStudent360Workout = student360Trigger('workoutLogs/{documentId}')
exports.syncStudent360PtWorkout = student360Trigger('ptWorkoutLogs/{documentId}')
exports.syncStudent360MealReview = student360Trigger('mealReviews/{documentId}')
exports.syncStudent360LeaveRequest = student360Trigger('leaveRequests/{documentId}')
exports.syncStudent360SessionRequest = student360Trigger('sessionRequests/{documentId}')
exports.syncStudent360Renewal = student360Trigger('contractRenewalCases/{documentId}')
exports.syncStudent360Payment = student360Trigger('payments/{documentId}')
exports.syncStudent360DailyCheckin = student360Trigger('dailyCheckins/{documentId}')
exports.syncStudent360Profile = student360Trigger('users/{accountUid}')
exports.syncStudent360MealLog = student360Trigger('users/{accountUid}/mealLogs/{documentId}')
exports.syncStudent360BodyMetric = student360Trigger('users/{accountUid}/bodyMetrics/{documentId}')
exports.syncStudent360BodyMeasurement = student360Trigger('users/{accountUid}/bodyMeasurements/{documentId}')
exports.syncStudent360WeightLog = student360Trigger('users/{accountUid}/weightLogs/{documentId}')
exports.syncStudent360LegacyProgressPhoto = student360Trigger('users/{accountUid}/progress_photos/{documentId}')
exports.syncStudent360ProgressPhoto = student360Trigger('users/{accountUid}/progressPhotos/{documentId}')
exports.reconcileStudent360ProjectionsScheduled = onSchedule({
  schedule: 'every 60 minutes',
  timeZone: 'Asia/Ho_Chi_Minh',
  region: 'asia-southeast1',
  retryCount: 1,
  maxInstances: 1,
  timeoutSeconds: 540,
  memory: '1GiB',
}, async () => reconcileStudent360ProjectionBatch({ db, logger, batchSize: 25, staleAfterDays: 2 }))
const sessionFeedbackFunctions = createSessionFeedbackFunctions({ db, onCall })
Object.assign(exports, sessionFeedbackFunctions)
exports.getMyPendingSessionFeedback = sessionFeedbackFunctions.getMyPendingSessionFeedback
exports.submitSessionFeedback = sessionFeedbackFunctions.submitSessionFeedback
exports.listTrainerFeedbackAdmin = sessionFeedbackFunctions.listTrainerFeedbackAdmin
exports.reviewTrainerFeedback = sessionFeedbackFunctions.reviewTrainerFeedback
const loyaltyFunctions = createLoyaltyFunctions({ db, onCall, logger })
Object.assign(exports, loyaltyFunctions)
exports.getMyLoyaltyDashboard = loyaltyFunctions.getMyLoyaltyDashboard
exports.listMyLoyaltyHistory = loyaltyFunctions.listMyLoyaltyHistory
exports.listMyAvailableRewards = loyaltyFunctions.listMyAvailableRewards
exports.redeemMyReward = loyaltyFunctions.redeemMyReward
exports.cancelMyPendingRedemption = loyaltyFunctions.cancelMyPendingRedemption
exports.getMyReferralWorkspace = loyaltyFunctions.getMyReferralWorkspace
exports.createMyReferralCode = loyaltyFunctions.createMyReferralCode
exports.captureMemberContractReferral = loyaltyFunctions.captureMemberContractReferral
exports.applyForAmbassador = loyaltyFunctions.applyForAmbassador
exports.getLoyaltyAdminDashboard = loyaltyFunctions.getLoyaltyAdminDashboard
exports.listLoyaltyAccounts = loyaltyFunctions.listLoyaltyAccounts
exports.listLoyaltyRewardsAdmin = loyaltyFunctions.listLoyaltyRewardsAdmin
exports.listLoyaltyAmbassadors = loyaltyFunctions.listLoyaltyAmbassadors
exports.listLoyaltyReconciliationIssues = loyaltyFunctions.listLoyaltyReconciliationIssues
exports.listLoyaltyRedemptions = loyaltyFunctions.listLoyaltyRedemptions
exports.transitionLoyaltyRedemption = loyaltyFunctions.transitionLoyaltyRedemption
exports.fulfillLoyaltyRedemption = loyaltyFunctions.fulfillLoyaltyRedemption
exports.saveLoyaltyPolicy = loyaltyFunctions.saveLoyaltyPolicy
exports.saveLoyaltyReward = loyaltyFunctions.saveLoyaltyReward
exports.adjustLoyaltyBalance = loyaltyFunctions.adjustLoyaltyBalance
exports.reviewLoyaltyAdjustment = loyaltyFunctions.reviewLoyaltyAdjustment
exports.manageAmbassadorProfile = loyaltyFunctions.manageAmbassadorProfile
exports.approveAmbassadorPayout = loyaltyFunctions.approveAmbassadorPayout
exports.reconcileLoyaltyAccount = loyaltyFunctions.reconcileLoyaltyAccount
exports.runLoyaltyBackfill = loyaltyFunctions.runLoyaltyBackfill
exports.getStudentLoyaltySummary = loyaltyFunctions.getStudentLoyaltySummary
exports.giveSessionKudos = loyaltyFunctions.giveSessionKudos
const ptSchedulePublishFunctions = createPtSchedulePublishFunctions({ db, onCall })
Object.assign(exports, ptSchedulePublishFunctions)
// Static exports keep the two rollout endpoints selectable with --only.
exports.validatePtScheduleDraft = ptSchedulePublishFunctions.validatePtScheduleDraft
exports.publishPtSchedule = ptSchedulePublishFunctions.publishPtSchedule
exports.listPtScheduleVersions = ptSchedulePublishFunctions.listPtScheduleVersions
exports.restorePtScheduleVersionToDraft = ptSchedulePublishFunctions.restorePtScheduleVersionToDraft
exports.getMyBranchScheduleWorkspace = ptSchedulePublishFunctions.getMyBranchScheduleWorkspace
exports.saveMyBranchScheduleDraft = ptSchedulePublishFunctions.saveMyBranchScheduleDraft
// Schedule workspaces are management-only and burst infrequently. A bounded
// Gen-1 CPU profile avoids exhausting the regional Cloud Run CPU quota while
// still allowing the optimizer a longer deterministic execution window.
const ptScheduleOnCall = (optionsOrHandler, maybeHandler) => {
  const resourceOptions = { cpu: 'gcf_gen1', maxInstances: 2, concurrency: 1, timeoutSeconds: 120 }
  return typeof optionsOrHandler === 'function'
    ? onCall(resourceOptions, optionsOrHandler)
    : onCall({ ...resourceOptions, ...optionsOrHandler }, maybeHandler)
}
const ptScheduleV2Functions = createPtScheduleV2Functions({ db, onCall: ptScheduleOnCall })
Object.assign(exports, ptScheduleV2Functions)
exports.listPtScheduleBranches = ptScheduleV2Functions.listPtScheduleBranches
exports.getPtScheduleWorkspace = ptScheduleV2Functions.getPtScheduleWorkspace
exports.generatePtScheduleDraft = ptScheduleV2Functions.generatePtScheduleDraft
exports.getPtScheduleSlotCandidates = ptScheduleV2Functions.getPtScheduleSlotCandidates
exports.savePtStudentAvailability = ptScheduleV2Functions.savePtStudentAvailability
exports.applyPtScheduleDraftCommand = ptScheduleV2Functions.applyPtScheduleDraftCommand
// Regional overflow endpoint for optimizer-v4. Asia-southeast1 currently
// hosts the large legacy callable fleet and can reject a safe revision before
// startup when its regional CPU quota is saturated. Only generation is moved;
// it still uses the same canonical Firestore database and revision transaction.
const ptScheduleOverflowOnCall = (optionsOrHandler, maybeHandler) => {
  const resourceOptions = { region: 'asia-east1', cpu: 'gcf_gen1', maxInstances: 2, concurrency: 1, timeoutSeconds: 120 }
  return typeof optionsOrHandler === 'function'
    ? onCall(resourceOptions, optionsOrHandler)
    : onCall({ ...resourceOptions, ...optionsOrHandler }, maybeHandler)
}
const ptScheduleOverflowFunctions = createPtScheduleV2Functions({ db, onCall: ptScheduleOverflowOnCall })
exports.generatePtScheduleDraftV4 = ptScheduleOverflowFunctions.generatePtScheduleDraft
Object.assign(exports, createFinanceLedgerFunctions({ db, onCall, logger }))
const contractRenewalFunctions = createContractRenewalFunctions({ db, onCall, onSchedule, logger })
Object.assign(exports, contractRenewalFunctions)
exports.listContractRenewalCases = contractRenewalFunctions.listContractRenewalCases
exports.listContractRenewalPipeline = contractRenewalFunctions.listContractRenewalPipeline
exports.listRenewalMessageTemplates = contractRenewalFunctions.listRenewalMessageTemplates
exports.updateContractRenewalCase = contractRenewalFunctions.updateContractRenewalCase
exports.getContractRenewalCaseDetail = contractRenewalFunctions.getContractRenewalCaseDetail
exports.recordContractRenewalActivity = contractRenewalFunctions.recordContractRenewalActivity
exports.assignContractRenewalCase = contractRenewalFunctions.assignContractRenewalCase
exports.transferRenewalCases = contractRenewalFunctions.transferRenewalCases
exports.createRenewalQuote = contractRenewalFunctions.createRenewalQuote
exports.submitRenewalApproval = contractRenewalFunctions.submitRenewalApproval
exports.decideRenewalApproval = contractRenewalFunctions.decideRenewalApproval
exports.renewPtContract = contractRenewalFunctions.renewPtContract
exports.listRenewalCalendar = contractRenewalFunctions.listRenewalCalendar
exports.getRenewalAnalytics = contractRenewalFunctions.getRenewalAnalytics
exports.refreshContractRenewalQueue = contractRenewalFunctions.refreshContractRenewalQueue
exports.refreshContractRenewalQueueScheduled = contractRenewalFunctions.refreshContractRenewalQueueScheduled
const sessionOperationFunctions = createSessionOperationFunctions({ db, onCall, logger })
Object.assign(exports, sessionOperationFunctions)
exports.listPtOperationsRequests = sessionOperationFunctions.listPtOperationsRequests
exports.getMySessionChangeSuggestions = sessionOperationFunctions.getMySessionChangeSuggestions
exports.createMySessionRequest = sessionOperationFunctions.createMySessionRequest
exports.confirmSessionAttendance = sessionOperationFunctions.confirmSessionAttendance
exports.recordSessionAttendance = sessionOperationFunctions.recordSessionAttendance
exports.bulkRecordSessionAttendance = sessionOperationFunctions.bulkRecordSessionAttendance
exports.approveSessionRequest = sessionOperationFunctions.approveSessionRequest
exports.rejectSessionRequest = sessionOperationFunctions.rejectSessionRequest
exports.createMyContractPauseRequest = sessionOperationFunctions.createMyContractPauseRequest
exports.approveContractPauseRequest = sessionOperationFunctions.approveContractPauseRequest
exports.rejectContractPauseRequest = sessionOperationFunctions.rejectContractPauseRequest
exports.chargeDuePtSessionsScheduled = onSchedule({
  schedule: 'every 5 minutes',
  region: 'asia-southeast1',
  timeZone: 'Asia/Ho_Chi_Minh',
  retryCount: 1,
  maxInstances: 1,
  timeoutSeconds: 540,
}, async () => chargeDuePtSessions({ db, now: new Date(), logger }))
exports.autoConfirmOverduePtAttendanceScheduled = onSchedule({
  schedule: 'every 5 minutes',
  region: 'asia-southeast1',
  timeZone: 'Asia/Ho_Chi_Minh',
  retryCount: 1,
  maxInstances: 1,
  timeoutSeconds: 540,
}, async () => autoConfirmOverduePtAttendance({ db, now: new Date(), logger }))
exports.remindUnconfirmedPtAttendanceScheduled = onSchedule({
  schedule: '0 21 * * *',
  region: 'asia-southeast1',
  timeZone: 'Asia/Ho_Chi_Minh',
  retryCount: 1,
  maxInstances: 1,
}, async () => remindUnconfirmedPtAttendance({ db, now: new Date(), logger }))
Object.assign(exports, createPayrollFunctions({ db, onCall, logger }))
const staffPayrollFunctions = createStaffPayrollFunctions({ db, onCall, logger, priceTeachingSlots, payrollPolicyProfiles, payrollProfile, policySupportsProfile })
Object.assign(exports, staffPayrollFunctions)
exports.getMyStaffPayroll = staffPayrollFunctions.getMyStaffPayroll
exports.getStaffPayrollStatement = staffPayrollFunctions.getStaffPayrollStatement
exports.listStaffPayrollAttendance = staffPayrollFunctions.listStaffPayrollAttendance
exports.getStaffPayrollAttendanceDetail = staffPayrollFunctions.getStaffPayrollAttendanceDetail
exports.saveStaffAttendanceDay = staffPayrollFunctions.saveStaffAttendanceDay
exports.fillMissingStaffAttendanceDays = staffPayrollFunctions.fillMissingStaffAttendanceDays
exports.saveWorkCalendar = staffPayrollFunctions.saveWorkCalendar

// Blue-green payroll rollout. The original asia-southeast1 services remain
// untouched as an instant rollback path while the canonical payroll handlers
// run in the lower-pressure asia-east1 region against the same Firestore DB.
const payrollOverflowOnCall = (optionsOrHandler, maybeHandler) => {
  const regional = { region: 'asia-east1' }
  return typeof optionsOrHandler === 'function'
    ? onCall(regional, optionsOrHandler)
    : onCall({ ...optionsOrHandler, ...regional }, maybeHandler)
}
const payrollV2Functions = createPayrollFunctions({ db, onCall: payrollOverflowOnCall, logger })
exports.listPayrollPoliciesV2 = payrollV2Functions.listPayrollPolicies
exports.savePayrollPolicyV2 = payrollV2Functions.savePayrollPolicy
exports.managePayrollPolicyV2 = payrollV2Functions.managePayrollPolicy
exports.listPayrollRunsV2 = payrollV2Functions.listPayrollRuns
exports.getPayrollRunV2 = payrollV2Functions.getPayrollRun
exports.createPayrollRunV2 = payrollV2Functions.createPayrollRun
exports.deleteDraftPayrollRunV2 = payrollV2Functions.deleteDraftPayrollRun
exports.reviewPayrollRunV2 = payrollV2Functions.reviewPayrollRun
exports.lockPayrollRunV2 = payrollV2Functions.lockPayrollRun
exports.markPayrollRunPaidV2 = payrollV2Functions.markPayrollRunPaid
const staffPayrollV2Functions = createStaffPayrollFunctions({ db, onCall: payrollOverflowOnCall, logger, priceTeachingSlots, payrollPolicyProfiles, payrollProfile, policySupportsProfile })
exports.getMyStaffPayrollV2 = staffPayrollV2Functions.getMyStaffPayroll
exports.getStaffPayrollStatementV2 = staffPayrollV2Functions.getStaffPayrollStatement
exports.listStaffPayrollAttendanceV2 = staffPayrollV2Functions.listStaffPayrollAttendance
exports.getStaffPayrollAttendanceDetailV2 = staffPayrollV2Functions.getStaffPayrollAttendanceDetail
exports.saveStaffAttendanceDayV2 = staffPayrollV2Functions.saveStaffAttendanceDay
exports.fillMissingStaffAttendanceDaysV2 = staffPayrollV2Functions.fillMissingStaffAttendanceDays
exports.saveWorkCalendarV2 = staffPayrollV2Functions.saveWorkCalendar
exports.submitMyPayrollInquiryV2 = staffPayrollV2Functions.submitMyPayrollInquiry
exports.submitMyPayrollInquiry = staffPayrollFunctions.submitMyPayrollInquiry
const businessReportingFunctions = createBusinessReportingFunctions({ db, onCall })
Object.assign(exports, businessReportingFunctions)
// Static exports make the three endpoints selectable in a safe rollout.
exports.listBusinessPerformance = businessReportingFunctions.listBusinessPerformance
exports.listStudentTrainingHistory = businessReportingFunctions.listStudentTrainingHistory
exports.listTrainerTeachingHistory = businessReportingFunctions.listTrainerTeachingHistory
exports.getStudentContractUsage = businessReportingFunctions.getStudentContractUsage
const exerciseCatalogFunctions = createExerciseCatalogFunctions({ db, onCall })
Object.assign(exports, exerciseCatalogFunctions)
exports.listExerciseCatalog = exerciseCatalogFunctions.listExerciseCatalog
exports.getExerciseCatalogItem = exerciseCatalogFunctions.getExerciseCatalogItem
exports.searchExternalExerciseCatalog = exerciseCatalogFunctions.searchExternalExerciseCatalog
exports.getExternalExercisePreview = exerciseCatalogFunctions.getExternalExercisePreview
exports.getExerciseCatalogMedia = exerciseCatalogFunctions.getExerciseCatalogMedia
exports.saveExerciseCatalogDraft = exerciseCatalogFunctions.saveExerciseCatalogDraft
exports.publishExerciseCatalogItem = exerciseCatalogFunctions.publishExerciseCatalogItem
const ptWorkoutTrackingFunctions = createPtWorkoutTrackingFunctions({ db, onCall })
Object.assign(exports, ptWorkoutTrackingFunctions)
exports.getPtWorkoutWorkspace = ptWorkoutTrackingFunctions.getPtWorkoutWorkspace
exports.getPtStudentTrainingPlan = ptWorkoutTrackingFunctions.getPtStudentTrainingPlan
exports.savePtStudentTrainingPlan = ptWorkoutTrackingFunctions.savePtStudentTrainingPlan
exports.savePtSessionWorkoutLog = ptWorkoutTrackingFunctions.savePtSessionWorkoutLog
exports.listPtWorkoutHistory = ptWorkoutTrackingFunctions.listPtWorkoutHistory

// Backend invariant for onboarding profiles. This also protects members who
// finish onboarding from an older cached PWA bundle that submitted null for
// numeric controls whose defaults were visible but never touched.
exports.repairCompletedOnboardingDefaults = onDocumentWritten({
  document: 'users/{userId}',
  database: databaseId,
  maxInstances: 3,
}, async (event) => {
  const snapshot = event.data?.after
  if (!snapshot?.exists) return

  const patch = buildCompletedOnboardingDefaultsPatch(snapshot.data())
  if (!patch) return

  await snapshot.ref.set({
    ...patch,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  logger.info('Repaired completed onboarding defaults', {
    userId: event.params.userId,
    fields: Object.keys(patch),
  })
})

exports.updateUserRole = onCall(async (request) => {
  const actorUid = request.auth?.uid
  const tokenRole = request.auth?.token?.role
  const targetUid = request.data?.uid
  const nextRole = request.data?.role

  if (!actorUid || !['admin', 'super_admin'].includes(tokenRole)) {
    throw new HttpsError('permission-denied', 'Bạn không có quyền quản lý vai trò.')
  }
  if (typeof targetUid !== 'string' || !assignableRoles.has(nextRole)) {
    throw new HttpsError('invalid-argument', 'UID hoặc vai trò không hợp lệ.')
  }
  if (targetUid === actorUid) {
    throw new HttpsError('failed-precondition', 'Không thể tự thay đổi vai trò của chính mình.')
  }

  const actorProfile = await db.doc(`users/${actorUid}`).get()
  const actorRole = actorProfile.data()?.role
  if (actorRole !== tokenRole || !['admin', 'super_admin'].includes(actorRole)) {
    throw new HttpsError('permission-denied', 'Phiên đăng nhập không còn khớp với quyền hiện tại.')
  }

  const targetUser = await auth.getUser(targetUid)
  const previousRole = targetUser.customClaims?.role ?? 'student'
  const protectedAdminRoles = new Set(['admin', 'super_admin'])
  if (actorRole !== 'super_admin' && (protectedAdminRoles.has(previousRole) || protectedAdminRoles.has(nextRole))) {
    throw new HttpsError('permission-denied', 'Chỉ Super Administrator được cấp, hạ hoặc thay đổi quyền quản trị.')
  }

  const nextClaims = { ...(targetUser.customClaims ?? {}), role: nextRole }
  await auth.setCustomUserClaims(targetUid, nextClaims)

  try {
    await db.runTransaction(async (transaction) => {
      transaction.set(db.doc(`users/${targetUid}`), {
        role: nextRole,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
      transaction.set(db.collection('auditLogs').doc(), {
        action: 'user.role.updated',
        actorUid,
        targetUid,
        before: { role: previousRole },
        after: { role: nextRole },
        createdAt: FieldValue.serverTimestamp(),
      })
    })
  } catch (error) {
    await auth.setCustomUserClaims(targetUid, targetUser.customClaims ?? {})
    throw error
  }

  return { uid: targetUid, role: nextRole, tokenRefreshRequired: true }
})

const auraUiSurfaces = [
  'shell',
  'member-home',
  'member-schedule',
  'member-availability',
  'student-360',
  'admin-dashboard',
  'member-nutrition',
]
const auraUiSurfaceSet = new Set(auraUiSurfaces)
const auraUiAudienceSet = new Set(['off', 'admin', 'staff', 'all'])

function normalizeAuraUiSurfaces(value) {
  if (!isPlainObject(value)) throw new HttpsError('invalid-argument', 'Cấu hình rollout không hợp lệ.')
  const normalized = {}
  for (const surface of auraUiSurfaces) {
    if (!auraUiAudienceSet.has(value[surface])) {
      throw new HttpsError('invalid-argument', `Audience của ${surface} không hợp lệ.`)
    }
    normalized[surface] = value[surface]
  }
  if (Object.keys(value).some((surface) => !auraUiSurfaceSet.has(surface))) {
    throw new HttpsError('invalid-argument', 'Cấu hình chứa surface không được hỗ trợ.')
  }
  return normalized
}

async function requireTrustedSuperAdmin(request) {
  const actorUid = requireCaller(request)
  const actorProfile = await db.doc(`users/${actorUid}`).get()
  if (!actorProfile.exists || !hasTrustedRole(request, actorProfile.data(), new Set(['super_admin']))) {
    throw new HttpsError('permission-denied', 'Chỉ Super Administrator được thay đổi rollout giao diện.')
  }
  return actorUid
}

exports.updateAuraUiRollout = onCall({
  memory: '256MiB',
  cpu: 0.1666,
  maxInstances: 1,
  concurrency: 1,
}, async (request) => {
  const actorUid = await requireTrustedSuperAdmin(request)
  const action = request.data?.action
  const updatedAt = new Date().toISOString()
  if (action === 'config') {
    const surfaces = normalizeAuraUiSurfaces(request.data?.surfaces)
    const reference = db.doc('system/ui_public_config')
    await db.runTransaction(async (transaction) => {
      const previous = await transaction.get(reference)
      transaction.set(reference, { schemaVersion: 1, surfaces, updatedAt, updatedBy: actorUid })
      transaction.create(db.collection('auditLogs').doc(), {
        action: 'ui.rollout.config.updated',
        actorUid,
        targetId: 'system/ui_public_config',
        before: previous.exists ? previous.data() : null,
        after: { schemaVersion: 1, surfaces },
        createdAt: FieldValue.serverTimestamp(),
      })
    })
    return { schemaVersion: 1, surfaces, updatedAt, updatedBy: actorUid }
  }
  if (action === 'assignment') {
    const targetUid = requireDocumentId(request.data?.uid, 'UID')
    const requestedSurfaces = Array.isArray(request.data?.surfaces) ? request.data.surfaces : []
    const surfaces = [...new Set(requestedSurfaces)]
    if (surfaces.length > auraUiSurfaces.length || surfaces.some((surface) => !auraUiSurfaceSet.has(surface))) {
      throw new HttpsError('invalid-argument', 'Danh sách surface thử nghiệm không hợp lệ.')
    }
    const expiresAt = request.data?.expiresAt === null || request.data?.expiresAt === ''
      ? null
      : boundedPushString(request.data?.expiresAt, 'Ngày hết hạn', 40)
    if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) {
      throw new HttpsError('invalid-argument', 'Ngày hết hạn phải nằm trong tương lai.')
    }
    const reference = db.doc(`uiRolloutAssignments/${targetUid}`)
    const assignment = { surfaces, expiresAt, updatedAt, updatedBy: actorUid }
    await db.runTransaction(async (transaction) => {
      const previous = await transaction.get(reference)
      transaction.set(reference, assignment)
      transaction.create(db.collection('auditLogs').doc(), {
        action: 'ui.rollout.assignment.updated',
        actorUid,
        targetUid,
        before: previous.exists ? previous.data() : null,
        after: { surfaces, expiresAt },
        createdAt: FieldValue.serverTimestamp(),
      })
    })
    return assignment
  }
  throw new HttpsError('invalid-argument', 'Thao tác rollout không được hỗ trợ.')
})

function requireCaller(request) {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Bạn cần đăng nhập để tiếp tục.')
  return uid
}

function callerTokenRole(request) {
  const role = request.auth?.token?.role
  return assignableRoles.has(role) ? role : 'student'
}

function hasTrustedRole(request, profile, allowedRoles) {
  const tokenRole = callerTokenRole(request)
  return profile?.disabled !== true
    && profile?.role === tokenRole
    && allowedRoles.has(tokenRole)
}

function boundedPushString(value, label, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return value.trim()
}

function normalizedPushActionUrl(value) {
  const actionUrl = typeof value === 'string' && value.trim() ? value.trim() : '/home'
  if (!actionUrl.startsWith('/') || actionUrl.startsWith('//') || actionUrl.length > 300) {
    throw new HttpsError('invalid-argument', 'Đường dẫn thông báo không hợp lệ.')
  }
  return actionUrl
}

function publicPushActionUrl(actionUrl) {
  const hashPath = actionUrl.startsWith('/#/')
    ? actionUrl
    : actionUrl.startsWith('#/')
      ? `/${actionUrl}`
      : `/#${actionUrl.startsWith('/') ? actionUrl : `/${actionUrl}`}`
  return new URL(hashPath, publicAppUrl).toString()
}

function acceptsPushCategory(profile, category) {
  const settings = profile?.notificationSettings
  if (!settings || settings.enabled !== false) {
    if (!settings) return true
  } else {
    return false
  }
  if (category === 'workout') return settings.workoutReminders !== false
  if (category === 'nutrition') return settings.mealReminders !== false
  if (category === 'learning') return settings.learningUpdates !== false
  if (category === 'coach') return settings.coachMessages !== false
  return true
}

function isMemberProfile(profile) {
  const role = profile?.role
  return (role === undefined || role === null || role === '' || role === 'student')
    && profile?.disabled !== true
    && profile?.status !== 'disabled'
}

function pushTimestampToIso(value) {
  if (!value) return null
  const date = typeof value.toDate === 'function'
    ? value.toDate()
    : value instanceof Date
      ? value
      : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function pushMetric(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

const scheduledReminderDefaults = {
  enabled: true,
  automationEnabled: true,
  timezone: 'Asia/Ho_Chi_Minh',
  quietHoursStart: '21:30',
  quietHoursEnd: '07:00',
  maxDailyPerUser: 3,
  mealReminderTimes: {
    breakfast: '07:30',
    lunch: '12:00',
    dinner: '18:30',
  },
}

function normalizedReminderClock(value, fallback) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback
}

function normalizedReminderSettings(value) {
  const source = value && typeof value === 'object' ? value : {}
  const sourceTimes = source.mealReminderTimes && typeof source.mealReminderTimes === 'object'
    ? source.mealReminderTimes
    : {}
  return {
    ...scheduledReminderDefaults,
    enabled: source.enabled !== false,
    automationEnabled: source.automationEnabled !== false,
    timezone: typeof source.timezone === 'string' && source.timezone.trim()
      ? source.timezone.trim()
      : scheduledReminderDefaults.timezone,
    quietHoursStart: normalizedReminderClock(source.quietHoursStart, scheduledReminderDefaults.quietHoursStart),
    quietHoursEnd: normalizedReminderClock(source.quietHoursEnd, scheduledReminderDefaults.quietHoursEnd),
    maxDailyPerUser: Math.min(8, Math.max(1, Number.isFinite(source.maxDailyPerUser) ? Math.round(source.maxDailyPerUser) : scheduledReminderDefaults.maxDailyPerUser)),
    autoMealReminders: source.autoMealReminders !== false,
    mealReminderTimes: {
      breakfast: normalizedReminderClock(sourceTimes.breakfast, scheduledReminderDefaults.mealReminderTimes.breakfast),
      lunch: normalizedReminderClock(sourceTimes.lunch, scheduledReminderDefaults.mealReminderTimes.lunch),
      dinner: normalizedReminderClock(sourceTimes.dinner, scheduledReminderDefaults.mealReminderTimes.dinner),
    },
  }
}

function clockToMinutes(value) {
  const [hours, minutes] = String(value || '00:00').split(':').map(Number)
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0)
}

function isInsideQuietHours(currentMinutes, start, end) {
  const startMinutes = clockToMinutes(start)
  const endMinutes = clockToMinutes(end)
  if (startMinutes === endMinutes) return false
  return startMinutes < endMinutes
    ? currentMinutes >= startMinutes && currentMinutes < endMinutes
    : currentMinutes >= startMinutes || currentMinutes < endMinutes
}

function isReminderWindow(currentMinutes, target) {
  const targetMinutes = clockToMinutes(target)
  return currentMinutes >= targetMinutes && currentMinutes < targetMinutes + 15
}

function zonedClock(date, timeZone) {
  let parts
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    }).formatToParts(date)
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: scheduledReminderDefaults.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    }).formatToParts(date)
  }
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  const dateString = `${values.year}-${values.month}-${values.day}`
  const currentMinutes = Number(values.hour) * 60 + Number(values.minute)
  const weekday = String(values.weekday || '').toLowerCase().slice(0, 3)
  return { dateString, currentMinutes, weekday }
}

function normalizedReminderGoal(profile) {
  const raw = profile?.nutritionProfile?.goal || profile?.goals?.[0] || 'all'
  if (raw === 'fat_loss' || raw === 'lose-fat' || /giảm mỡ/i.test(String(raw))) return 'lose-fat'
  if (raw === 'muscle_gain' || raw === 'gain-muscle' || /tăng cơ/i.test(String(raw))) return 'gain-muscle'
  if (raw === 'maintain' || raw === 'maintenance' || /duy trì/i.test(String(raw))) return 'maintain'
  return 'all'
}

function selectScheduledTemplate(templates, profile, category, slot) {
  const goal = normalizedReminderGoal(profile)
  const categoryMatches = templates.filter((template) => template?.active !== false && template?.category === category)
  return categoryMatches.find((template) => template.targetGoal === goal && template.triggerLabel?.toLowerCase().includes(slot))
    || categoryMatches.find((template) => template.targetGoal === goal)
    || categoryMatches.find((template) => template.targetGoal === 'all')
    || categoryMatches[0]
}

async function hasMealLoggedForDate(userId, dateString) {
  try {
    const snapshot = await db.collection(`users/${userId}/mealLogs`)
      .where('date', '==', dateString)
      .limit(1)
      .get()
    return !snapshot.empty
  } catch (error) {
    logger.warn('Unable to check meal log before scheduled reminder', { userId, code: error?.code || 'unknown' })
    return false
  }
}

async function countScheduledNotificationsForDate(userId, dateString) {
  try {
    const snapshot = await db.collection(`users/${userId}/notifications`)
      .where('dateString', '==', dateString)
      .limit(20)
      .get()
    return snapshot.docs.filter((document) => document.data()?.dedupeKey?.startsWith('meal_')).length
  } catch (error) {
    logger.warn('Unable to count scheduled reminders before delivery', { userId, code: error?.code || 'unknown' })
    return 0
  }
}

async function createScheduledNotification(userId, payload) {
  const notificationReference = db.doc(`users/${userId}/notifications/${payload.dedupeKey}`)
  let created = false
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(notificationReference)
    if (snapshot.exists) return
    transaction.create(notificationReference, {
      id: notificationReference.id,
      userId,
      title: payload.title,
      message: payload.message,
      type: payload.type,
      category: payload.category,
      actionUrl: payload.actionUrl,
      dedupeKey: payload.dedupeKey,
      dateString: payload.dateString,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    })
    created = true
  })
  return created ? { ...payload, notificationId: notificationReference.id } : null
}

async function deliverScheduledPushes(deliveries) {
  if (!deliveries.length) return { sent: 0, failed: 0, removed: 0 }
  const userIds = [...new Set(deliveries.map((delivery) => delivery.userId))]
  const deliveryByUser = new Map(deliveries.map((delivery) => [delivery.userId, delivery]))
  const groups = new Map()
  const invalidDeviceReferences = []

  for (let offset = 0; offset < userIds.length; offset += 30) {
    const chunk = userIds.slice(offset, offset + 30)
    const snapshot = await db.collectionGroup('devices').where('userId', 'in', chunk).get()
    snapshot.docs.forEach((device) => {
      const data = device.data()
      if (data.enabled === false || typeof data.token !== 'string' || !data.token) return
      const delivery = deliveryByUser.get(data.userId)
      if (!delivery) return
      const groupKey = `${delivery.title}\n${delivery.message}\n${delivery.actionUrl}`
      const group = groups.get(groupKey) || { delivery, devices: [] }
      group.devices.push({ token: data.token, reference: device.ref })
      groups.set(groupKey, group)
    })
  }

  let sent = 0
  let failed = 0
  for (const group of groups.values()) {
    for (let offset = 0; offset < group.devices.length; offset += 500) {
      const deviceChunk = group.devices.slice(offset, offset + 500)
      try {
        const response = await messaging.sendEachForMulticast({
          tokens: deviceChunk.map(({ token }) => token),
          notification: { title: group.delivery.title, body: group.delivery.message },
          data: {
            actionUrl: group.delivery.actionUrl,
            type: group.delivery.type,
            category: group.delivery.category,
            notificationId: group.delivery.notificationId,
          },
          webpush: { fcmOptions: { link: publicPushActionUrl(group.delivery.actionUrl) } },
        })
        sent += response.successCount
        failed += response.failureCount
        response.responses.forEach((result, index) => {
          if (!result.success && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(result.error?.code)) {
            invalidDeviceReferences.push(deviceChunk[index].reference)
          }
        })
      } catch (error) {
        failed += deviceChunk.length
        logger.error('Scheduled FCM delivery failed', { code: error?.code || 'unknown' })
      }
    }
  }

  for (let offset = 0; offset < invalidDeviceReferences.length; offset += 400) {
    const batch = db.batch()
    invalidDeviceReferences.slice(offset, offset + 400).forEach((reference) => batch.delete(reference))
    await batch.commit()
  }
  return { sent, failed, removed: invalidDeviceReferences.length }
}

/**
 * Runs every fifteen minutes. The deterministic notification id makes this
 * trigger safe to retry and prevents duplicate reminders when two scheduler
 * invocations overlap. In-app records are created even when a user has no
 * registered device; FCM delivery is best-effort on top of that inbox.
 */
exports.dispatchScheduledReminders = onSchedule({
  schedule: 'every 15 minutes',
  timeZone: 'Asia/Ho_Chi_Minh',
  retryCount: 1,
  timeoutSeconds: 120,
  memory: '256MiB',
  maxInstances: 1,
}, async () => {
  const [settingsSnapshot, templatesSnapshot, usersSnapshot] = await Promise.all([
    db.doc('system/push_settings').get(),
    db.collection('system/push_templates/templates').get(),
    db.collection('users').limit(2000).get(),
  ])
  const settings = normalizedReminderSettings(settingsSnapshot.exists ? settingsSnapshot.data() : {})
  if (!settings.enabled || !settings.automationEnabled) {
    logger.info('Scheduled push skipped because the channel is disabled')
    return { skipped: true, reason: 'disabled' }
  }

  const templates = templatesSnapshot.docs.map((snapshot) => snapshot.data())
  const definitions = [
    ['breakfast', 'Bữa sáng', 'breakfast'],
    ['lunch', 'Bữa trưa', 'lunch'],
    ['dinner', 'Bữa tối', 'dinner'],
  ]
  const deliveries = []
  const userDocuments = usersSnapshot.docs.filter((snapshot) => snapshot.data()?.disabled !== true)

  for (let offset = 0; offset < userDocuments.length; offset += 20) {
    const batch = await Promise.all(userDocuments.slice(offset, offset + 20).map(async (snapshot) => {
      const userId = snapshot.id
      const profile = snapshot.data() || {}
      const preferences = profile.notificationSettings && typeof profile.notificationSettings === 'object'
        ? profile.notificationSettings
        : {}
      if (preferences.enabled === false || preferences.mealReminders === false) return []

      const timezone = preferences.timezone || settings.timezone
      const clock = zonedClock(new Date(), timezone)
      if (preferences.quietHoursEnabled !== false && isInsideQuietHours(clock.currentMinutes, preferences.quietHoursStart || settings.quietHoursStart, preferences.quietHoursEnd || settings.quietHoursEnd)) return []

      const reminderTimes = {
        ...settings.mealReminderTimes,
        ...(preferences.mealReminderTimes || {}),
        ...(profile.mealReminderTime ? { dinner: profile.mealReminderTime } : {}),
      }
      const maxDaily = Math.min(8, Math.max(1, Number.isFinite(preferences.maxDaily) ? Math.round(preferences.maxDaily) : settings.maxDailyPerUser))
      const candidates = []
      if (settings.autoMealReminders) {
        const dueDefinitions = definitions.filter(([slot]) => isReminderWindow(clock.currentMinutes, reminderTimes[slot]))
        if (dueDefinitions.length && await hasMealLoggedForDate(userId, clock.dateString)) return []
        const alreadyScheduled = dueDefinitions.length
          ? await countScheduledNotificationsForDate(userId, clock.dateString)
          : 0
        const remainingDailySlots = Math.max(0, maxDaily - alreadyScheduled)
        if (!remainingDailySlots) return []
        for (const [slot, label, templateSlot] of dueDefinitions) {
          const template = selectScheduledTemplate(templates, profile, 'nutrition', templateSlot)
          const fallback = {
            title: `Nhắc cập nhật ${label.toLowerCase()} 🥗`,
            message: `Bạn chưa ghi nhận ${label.toLowerCase()} hôm nay. Chụp ảnh bữa ăn để Aura giúp bạn theo dõi dinh dưỡng nhé.`,
            type: 'REMINDER',
            actionUrl: '/nutrition',
          }
          candidates.push({
            userId,
            dateString: clock.dateString,
            category: 'nutrition',
            dedupeKey: `meal_${clock.dateString}_${slot}`,
            title: template?.title || fallback.title,
            message: template?.message || fallback.message,
            type: template?.type || fallback.type,
            actionUrl: template?.actionUrl || fallback.actionUrl,
          })
        }
        return candidates.slice(0, remainingDailySlots)
      }
      return candidates.slice(0, maxDaily)
    }))
    batch.flat().forEach((candidate) => deliveries.push(candidate))
  }

  const createdDeliveries = []
  for (const delivery of deliveries) {
    const created = await createScheduledNotification(delivery.userId, delivery)
    if (created) createdDeliveries.push(created)
  }
  const deliveryResult = await deliverScheduledPushes(createdDeliveries)
  const runId = `scheduled_${Date.now()}`
  await db.doc(`system/push_automation_logs/logs/${runId}`).set({
    id: runId,
    evaluatedUsers: userDocuments.length,
    candidates: deliveries.length,
    createdNotifications: createdDeliveries.length,
    webPushSentCount: deliveryResult.sent,
    webPushFailureCount: deliveryResult.failed,
    removedInvalidDevices: deliveryResult.removed,
    createdAt: FieldValue.serverTimestamp(),
  })
  logger.info('Scheduled reminders completed', { runId, ...deliveryResult, createdNotifications: createdDeliveries.length })
  return { runId, createdNotifications: createdDeliveries.length, ...deliveryResult }
})

exports.registerFcmToken = onCall(async (request) => {
  const userId = requireCaller(request)
  const token = boundedPushString(request.data?.token, 'FCM token', 4096)
  if (token.length < 20) throw new HttpsError('invalid-argument', 'FCM token không hợp lệ.')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const deviceReference = db.doc(`users/${userId}/devices/${tokenHash}`)
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(deviceReference)
    transaction.set(deviceReference, {
      userId,
      token,
      platform: typeof request.data?.platform === 'string'
        ? request.data.platform.trim().slice(0, 40)
        : 'web',
      enabled: true,
      createdAt: snapshot.exists ? snapshot.data().createdAt : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  })
  return { registered: true, deviceId: tokenHash }
})

exports.unregisterFcmToken = onCall(async (request) => {
  const userId = requireCaller(request)
  const token = boundedPushString(request.data?.token, 'FCM token', 4096)
  const tokenHash = createHash('sha256').update(token).digest('hex')
  await db.doc(`users/${userId}/devices/${tokenHash}`).delete()
  return { unregistered: true }
})

/**
 * Returns only aggregate Push health metrics. Raw device documents and tokens
 * never leave the trusted backend. Both the Auth claim and Firestore role must
 * agree before an operator can read these figures.
 */
exports.getPushAdminOverview = onCall({ cpu: 'gcf_gen1', maxInstances: 2 }, async (request) => {
  const actorId = requireCaller(request)
  const actorSnapshot = await db.doc(`users/${actorId}`).get()
  if (!actorSnapshot.exists || !hasTrustedRole(request, actorSnapshot.data(), privilegedAdminRoles)) {
    throw new HttpsError('permission-denied', 'Báº¡n khÃ´ng cÃ³ quyá»n xem tráº¡ng thÃ¡i Push.')
  }

  const broadcastLogs = db.collection('system').doc('push_broadcast_logs').collection('logs')
  const automationLogs = db.collection('system').doc('push_automation_logs').collection('logs')
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const [
    usersSnapshot,
    devicesSnapshot,
    recentBroadcasts,
    recentAutomation,
    latestBroadcast,
    latestAutomation,
  ] = await Promise.all([
    db.collection('users').get(),
    db.collectionGroup('devices').get(),
    broadcastLogs.where('createdAt', '>=', cutoff).get(),
    automationLogs.where('createdAt', '>=', cutoff).get(),
    broadcastLogs.orderBy('createdAt', 'desc').limit(1).get(),
    automationLogs.orderBy('createdAt', 'desc').limit(1).get(),
  ])

  const activeProfiles = new Map()
  usersSnapshot.docs.forEach((snapshot) => {
    const profile = snapshot.data() || {}
    if (isMemberProfile(profile)) activeProfiles.set(snapshot.id, profile)
  })

  const activeDeviceUsers = new Set()
  let activeDevices = 0
  devicesSnapshot.docs.forEach((snapshot) => {
    const device = snapshot.data() || {}
    if (device.enabled === false
        || typeof device.token !== 'string'
        || !device.token
        || !activeProfiles.has(device.userId)) return
    activeDevices += 1
    activeDeviceUsers.add(device.userId)
  })

  const pushEnabledUsers = [...activeProfiles].reduce((count, [userId, profile]) => {
    const preferences = profile.notificationSettings && typeof profile.notificationSettings === 'object'
      ? profile.notificationSettings
      : {}
    const enabled = preferences.enabled !== false
      && (preferences.fcmEnabled === true || activeDeviceUsers.has(userId))
    return count + (enabled ? 1 : 0)
  }, 0)

  let webPushAccepted24h = 0
  let webPushFailures24h = 0
  for (const snapshot of [...recentBroadcasts.docs, ...recentAutomation.docs]) {
    const log = snapshot.data() || {}
    webPushAccepted24h += pushMetric(log.webPushSentCount)
    webPushFailures24h += pushMetric(log.webPushFailureCount)
  }

  const overview = {
    activeUsers: activeProfiles.size,
    pushEnabledUsers,
    activeDevices,
    webPushAccepted24h,
    webPushFailures24h,
    latestAutomationAt: latestAutomation.empty
      ? null
      : pushTimestampToIso(latestAutomation.docs[0].data()?.createdAt),
    latestBroadcastAt: latestBroadcast.empty
      ? null
      : pushTimestampToIso(latestBroadcast.docs[0].data()?.createdAt),
  }
  return overview
})

exports.dispatchPushBroadcast = onCall({
  cpu: 'gcf_gen1',
  maxInstances: 1,
  // The callable endpoint must stay reachable by the Firebase client SDK.
  // requireCaller + hasTrustedRole below still enforce administrator access.
  invoker: 'public',
}, async (request) => {
  const actorId = requireCaller(request)
  const actorSnapshot = await db.doc(`users/${actorId}`).get()
  const actor = actorSnapshot.data()
  if (!actorSnapshot.exists || !hasTrustedRole(request, actor, privilegedAdminRoles)) {
    throw new HttpsError('permission-denied', 'Bạn không có quyền gửi thông báo hệ thống.')
  }

  const title = boundedPushString(request.data?.title, 'Tiêu đề', 120)
  const message = boundedPushString(request.data?.message, 'Nội dung', 1000)
  const actionUrl = normalizedPushActionUrl(request.data?.actionUrl)
  const type = ['REMINDER', 'MOTIVATION', 'WORKOUT', 'ANNOUNCEMENT', 'PROMOTION', 'INFO', 'ALERT'].includes(request.data?.type)
    ? request.data.type
    : 'INFO'
  const category = ['workout', 'nutrition', 'learning', 'coach', 'general'].includes(request.data?.category)
    ? request.data.category
    : 'general'
  const targetType = request.data?.targetType === 'all' ? 'all' : 'selected'
  const requestedIds = Array.isArray(request.data?.targetUserIds)
    ? [...new Set(request.data.targetUserIds
      .filter((value) => typeof value === 'string' && value.trim() && !value.includes('/'))
      .map((value) => value.trim()))].slice(0, 1000)
    : []
  if (targetType !== 'all' && !requestedIds.length) {
    throw new HttpsError('invalid-argument', 'Cần chọn ít nhất một người nhận.')
  }

  // The only preference bypass allowed is an administrator testing their own
  // registered device. Broadcasts to members always respect opt-out settings.
  const isSelfDeviceTest = request.data?.respectCategoryPreferences === false
    && targetType === 'selected'
    && requestedIds.length === 1
    && requestedIds[0] === actorId

  const profileSnapshots = targetType === 'all'
    ? (await db.collection('users').limit(2000).get()).docs
    : await db.getAll(...requestedIds.map((userId) => db.doc(`users/${userId}`)))
  const existingProfiles = profileSnapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => ({ userId: snapshot.id, profile: snapshot.data() }))
  const audienceProfiles = targetType === 'all'
    ? existingProfiles.filter(({ profile }) => {
      const role = profile?.role
      return role === undefined || role === null || role === '' || role === 'student'
    })
    : existingProfiles
  const eligibleProfiles = audienceProfiles
    .filter(({ profile }) => profile.disabled !== true
      && profile.status !== 'disabled'
      && (isSelfDeviceTest || acceptsPushCategory(profile, category)))
  const eligibleUserIds = eligibleProfiles.map(({ userId }) => userId)
  const consideredProfileCount = targetType === 'all' ? audienceProfiles.length : profileSnapshots.length
  const filteredOutCount = consideredProfileCount - eligibleUserIds.length
  const logReference = db.collection('system').doc('push_broadcast_logs').collection('logs').doc()

  for (let offset = 0; offset < eligibleUserIds.length; offset += 400) {
    const batch = db.batch()
    for (const userId of eligibleUserIds.slice(offset, offset + 400)) {
      const notificationReference = db.collection(`users/${userId}/notifications`).doc()
      batch.set(notificationReference, {
        id: notificationReference.id,
        userId,
        title,
        message,
        type,
        category,
        actionUrl,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      })
    }
    await batch.commit()
  }

  const devices = []
  for (let offset = 0; offset < eligibleUserIds.length; offset += 30) {
    const userIdChunk = eligibleUserIds.slice(offset, offset + 30)
    if (!userIdChunk.length) continue
    const snapshot = await db.collectionGroup('devices')
      .where('userId', 'in', userIdChunk)
      .get()
    snapshot.docs.forEach((device) => {
      const data = device.data()
      const token = data.token
      if (data.enabled === false) return
      if (typeof token === 'string' && token) devices.push({ token, reference: device.ref })
    })
  }

  let webPushSentCount = 0
  let webPushFailureCount = 0
  const invalidDeviceReferences = []
  for (let offset = 0; offset < devices.length; offset += 500) {
    const deviceChunk = devices.slice(offset, offset + 500)
    let response
    try {
      response = await messaging.sendEachForMulticast({
        tokens: deviceChunk.map(({ token }) => token),
        notification: { title, body: message },
        data: { actionUrl, type, category, notificationId: `${logReference.id}` },
        webpush: { fcmOptions: { link: publicPushActionUrl(actionUrl) } },
      })
    } catch (error) {
      webPushFailureCount += deviceChunk.length
      console.error('FCM multicast request failed', { code: error?.code ?? 'unknown' })
      continue
    }
    webPushSentCount += response.successCount
    webPushFailureCount += response.failureCount
    response.responses.forEach((result, index) => {
      if (!result.success && [
        'messaging/registration-token-not-registered',
        'messaging/invalid-registration-token',
      ].includes(result.error?.code)) {
        invalidDeviceReferences.push(deviceChunk[index].reference)
      }
    })
  }
  for (let offset = 0; offset < invalidDeviceReferences.length; offset += 400) {
    const batch = db.batch()
    invalidDeviceReferences.slice(offset, offset + 400).forEach((reference) => batch.delete(reference))
    await batch.commit()
  }

  await logReference.set({
    id: logReference.id,
    title,
    message,
    type,
    category,
    targetType,
    targetValue: targetType,
    actionUrl,
    sentCount: eligibleUserIds.length,
    webPushSentCount,
    webPushFailureCount,
    filteredOutCount,
    sentBy: actorId,
    createdAt: FieldValue.serverTimestamp(),
  })
  return {
    sentCount: eligibleUserIds.length,
    webPushSentCount,
    webPushFailureCount,
    filteredOutCount,
    logId: logReference.id,
  }
})

function requireDocumentId(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.includes('/') || value.trim().length > 500) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return value.trim()
}

async function requireTrustedAdmin(request) {
  const actorId = requireCaller(request)
  const snapshot = await db.doc(`users/${actorId}`).get()
  if (!snapshot.exists || !hasTrustedRole(request, snapshot.data(), privilegedAdminRoles)) {
    throw new HttpsError('permission-denied', 'Bạn không có quyền quản trị nội dung dinh dưỡng.')
  }
  return actorId
}

async function requireTrustedAcademyStaff(request) {
  const actorId = requireCaller(request)
  const snapshot = await db.doc(`users/${actorId}`).get()
  if (!snapshot.exists || !hasTrustedRole(request, snapshot.data(), academyStaffRoles)) {
    throw new HttpsError('permission-denied', 'Bạn không có quyền quản trị Aura Academy.')
  }
  return actorId
}

function boundedNumber(value, label, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return Math.round(value * 10) / 10
}

function normalizeRecipeInput(value) {
  if (!isPlainObject(value)) throw new HttpsError('invalid-argument', 'Công thức không hợp lệ.')
  const image = boundedPushString(value.image, 'Ảnh công thức', 2000)
  if (!/^https?:\/\//i.test(image) && !image.startsWith('/')) {
    throw new HttpsError('invalid-argument', 'Ảnh công thức phải được tải lên Storage trước khi lưu.')
  }
  const ingredients = Array.isArray(value.ingredients) ? value.ingredients.slice(0, 50).map((item) => ({
    name: boundedPushString(item?.name, 'Tên nguyên liệu', 120),
    amount: boundedPushString(item?.amount, 'Định lượng', 80),
  })) : []
  const instructions = Array.isArray(value.instructions)
    ? value.instructions.slice(0, 30).map((item) => boundedPushString(item, 'Bước chế biến', 1000))
    : []
  return {
    id: requireDocumentId(value.id, 'Mã công thức'),
    name: boundedPushString(value.name, 'Tên công thức', 200),
    meal: ['breakfast', 'lunch', 'dinner', 'snack'].includes(value.meal) ? value.meal : 'lunch',
    goal: ['fat-loss', 'muscle-gain', 'maintenance'].includes(value.goal) ? value.goal : 'maintenance',
    diet: typeof value.diet === 'string' ? value.diet.trim().slice(0, 100) : '',
    kcal: boundedNumber(value.kcal, 'Năng lượng', 0, 5000),
    protein: boundedNumber(value.protein, 'Protein', 0, 500),
    carbs: boundedNumber(value.carbs, 'Carb', 0, 1000),
    fat: boundedNumber(value.fat, 'Chất béo', 0, 500),
    minutes: boundedNumber(value.minutes, 'Thời gian chế biến', 1, 1440),
    image,
    badge: typeof value.badge === 'string' ? value.badge.trim().slice(0, 80) : '',
    isPro: value.isPro === true,
    description: typeof value.description === 'string' ? value.description.trim().slice(0, 4000) : '',
    ingredients,
    instructions,
    status: ['draft', 'published', 'archived'].includes(value.status) ? value.status : 'published',
  }
}

function normalizeMealPlanInput(value) {
  if (!isPlainObject(value)) throw new HttpsError('invalid-argument', 'Khung thực đơn không hợp lệ.')
  const days = Array.isArray(value.days) ? value.days.slice(0, 14).map((day) => ({
    dayName: boundedPushString(day?.dayName, 'Tên ngày', 40),
    breakfast: boundedPushString(day?.breakfast, 'Bữa sáng', 300),
    lunch: boundedPushString(day?.lunch, 'Bữa trưa', 300),
    snack: boundedPushString(day?.snack, 'Bữa phụ', 300),
    dinner: boundedPushString(day?.dinner, 'Bữa tối', 300),
    totalKcal: boundedNumber(day?.totalKcal, 'Tổng năng lượng', 0, 10000),
    totalProtein: boundedNumber(day?.totalProtein, 'Tổng protein', 0, 1000),
  })) : []
  return {
    id: requireDocumentId(value.id, 'Mã khung thực đơn'),
    title: boundedPushString(value.title, 'Tên khung thực đơn', 200),
    goal: boundedPushString(value.goal, 'Mục tiêu', 300),
    proteinTarget: boundedNumber(value.proteinTarget, 'Mục tiêu protein', 0, 1000),
    calorieTarget: boundedNumber(value.calorieTarget, 'Mục tiêu năng lượng', 0, 10000),
    popularRecipe: typeof value.popularRecipe === 'string' ? value.popularRecipe.trim().slice(0, 200) : '',
    days,
    status: ['draft', 'published', 'archived'].includes(value.status) ? value.status : 'published',
  }
}

function serializeAdminContent(snapshot) {
  const data = snapshot.data()
  return {
    ...data,
    id: snapshot.id,
    createdAt: typeof data.createdAt?.toDate === 'function' ? data.createdAt.toDate().toISOString() : null,
    updatedAt: typeof data.updatedAt?.toDate === 'function' ? data.updatedAt.toDate().toISOString() : null,
  }
}

exports.listMealPlanAdminData = onCall({ cpu: 'gcf_gen1', maxInstances: 1 }, async (request) => {
  await requireTrustedAdmin(request)
  const [recipeSnapshot, planSnapshot, assignmentSnapshot] = await Promise.all([
    db.collection('recipes').limit(500).get(),
    db.collection('mealPlans').limit(100).get(),
    db.collection('mealPlanAssignments').limit(2000).get(),
  ])
  const assignmentsByPlan = new Map()
  assignmentSnapshot.docs.forEach((item) => {
    const mealPlanId = item.data().mealPlanId
    if (typeof mealPlanId === 'string') assignmentsByPlan.set(mealPlanId, (assignmentsByPlan.get(mealPlanId) ?? 0) + 1)
  })
  return {
    recipes: recipeSnapshot.docs.map(serializeAdminContent),
    mealPlans: planSnapshot.docs.map((item) => ({
      ...serializeAdminContent(item),
      assignedStudents: assignmentsByPlan.get(item.id) ?? 0,
    })),
  }
})

exports.saveMealPlanRecipe = onCall({ cpu: 'gcf_gen1', maxInstances: 1 }, async (request) => {
  const actorId = await requireTrustedAdmin(request)
  const recipe = normalizeRecipeInput(request.data?.recipe)
  const reference = db.doc(`recipes/${recipe.id}`)
  let revision = 1
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(reference)
    revision = existing.exists ? (Number(existing.data().revision) || 0) + 1 : 1
    transaction.set(reference, {
      ...recipe,
      revision,
      createdAt: existing.exists ? existing.data().createdAt : FieldValue.serverTimestamp(),
      createdBy: existing.exists ? existing.data().createdBy : actorId,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorId,
      logsCount: existing.exists ? Number(existing.data().logsCount) || 0 : 0,
      savedCount: existing.exists ? Number(existing.data().savedCount) || 0 : 0,
    })
    transaction.set(db.collection('auditLogs').doc(), {
      action: existing.exists ? 'recipe.updated' : 'recipe.created',
      actorUid: actorId,
      targetId: recipe.id,
      revision,
      createdAt: FieldValue.serverTimestamp(),
    })
  })
  return { recipe: { ...recipe, revision } }
})

exports.deleteMealPlanRecipe = onCall(async (request) => {
  const actorId = await requireTrustedAdmin(request)
  const recipeId = requireDocumentId(request.data?.recipeId, 'Mã công thức')
  const usedByPlan = await db.collection('mealPlans').where('recipeIds', 'array-contains', recipeId).limit(1).get()
  if (!usedByPlan.empty) throw new HttpsError('failed-precondition', 'Công thức đang được dùng trong khung thực đơn.')
  await db.runTransaction(async (transaction) => {
    transaction.delete(db.doc(`recipes/${recipeId}`))
    transaction.set(db.collection('auditLogs').doc(), {
      action: 'recipe.deleted',
      actorUid: actorId,
      targetId: recipeId,
      createdAt: FieldValue.serverTimestamp(),
    })
  })
  return { deleted: true, recipeId }
})

exports.saveMealPlan = onCall(async (request) => {
  const actorId = await requireTrustedAdmin(request)
  const mealPlan = normalizeMealPlanInput(request.data?.mealPlan)
  const reference = db.doc(`mealPlans/${mealPlan.id}`)
  let revision = 1
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(reference)
    revision = existing.exists ? (Number(existing.data().revision) || 0) + 1 : 1
    transaction.set(reference, {
      ...mealPlan,
      revision,
      createdAt: existing.exists ? existing.data().createdAt : FieldValue.serverTimestamp(),
      createdBy: existing.exists ? existing.data().createdBy : actorId,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorId,
    })
    transaction.set(db.collection('auditLogs').doc(), {
      action: existing.exists ? 'meal-plan.updated' : 'meal-plan.created',
      actorUid: actorId,
      targetId: mealPlan.id,
      revision,
      createdAt: FieldValue.serverTimestamp(),
    })
  })
  return { mealPlan: { ...mealPlan, revision } }
})

exports.assignMealPlan = onCall(async (request) => {
  const actorId = await requireTrustedAdmin(request)
  const userId = requireDocumentId(request.data?.userId, 'Mã học viên')
  const mealPlanId = requireDocumentId(request.data?.mealPlanId, 'Mã khung thực đơn')
  const [userSnapshot, planSnapshot] = await Promise.all([
    db.doc(`users/${userId}`).get(),
    db.doc(`mealPlans/${mealPlanId}`).get(),
  ])
  if (!userSnapshot.exists || userSnapshot.data().disabled === true || userSnapshot.data().role !== 'student') {
    throw new HttpsError('failed-precondition', 'Học viên không sẵn sàng để nhận thực đơn.')
  }
  if (!planSnapshot.exists || planSnapshot.data().status !== 'published') {
    throw new HttpsError('failed-precondition', 'Khung thực đơn chưa được xuất bản.')
  }
  await db.doc(`mealPlanAssignments/${userId}`).set({
    userId,
    mealPlanId,
    assignedBy: actorId,
    assignedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    status: 'active',
  })
  return { userId, mealPlanId, status: 'active' }
})

exports.getMyMealPlan = onCall(async (request) => {
  const userId = requireCaller(request)
  const profileSnapshot = await db.doc(`users/${userId}`).get()
  if (!profileSnapshot.exists || !hasTrustedRole(request, profileSnapshot.data(), studentOnlyRoles)) {
    throw new HttpsError('permission-denied', 'Tài khoản không thể truy cập thực đơn cá nhân.')
  }
  const assignmentSnapshot = await db.doc(`mealPlanAssignments/${userId}`).get()
  if (!assignmentSnapshot.exists || assignmentSnapshot.data().status !== 'active') return { mealPlan: null }
  const mealPlanId = assignmentSnapshot.data().mealPlanId
  const planSnapshot = await db.doc(`mealPlans/${mealPlanId}`).get()
  if (!planSnapshot.exists || planSnapshot.data().status !== 'published') return { mealPlan: null }
  return { mealPlan: serializeAdminContent(planSnapshot) }
})

const coursePublicationStatuses = new Set(['draft', 'review', 'approved', 'scheduled', 'published', 'archived'])
// There is no deployed Academy scheduler yet. Keep this fail-closed until a
// backend job that atomically promotes due courses is implemented and tested.
const academyCoursePublishingSchedulerAvailable = false
const courseLessonTypes = new Set(['Video', 'Bài đọc', 'Quiz'])
const courseResourceKinds = new Set(['slide', 'video', 'document'])
const courseCompletionModes = new Set(['manual', 'media-progress', 'quiz-pass'])

function courseString(value, label, maximum, required = true) {
  if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return value.trim()
}

function courseId(value, label) {
  const normalized = requireDocumentId(value, label)
  if (normalized.length > 200 || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new HttpsError('invalid-argument', `${label} chỉ được chứa chữ, số, dấu gạch ngang hoặc gạch dưới.`)
  }
  return normalized
}

function courseStringList(value, label, maximumItems, maximumLength) {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return value.map((item, index) => courseString(item, `${label} ${index + 1}`, maximumLength, false))
}

function normalizeCourseMemory(value) {
  if (!isPlainObject(value)) return undefined
  const objectList = (items, label, maximum, fields) => {
    if (!Array.isArray(items) || items.length > maximum) {
      throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
    }
    return items.map((item, index) => {
      if (!isPlainObject(item)) throw new HttpsError('invalid-argument', `${label} ${index + 1} không hợp lệ.`)
      return Object.fromEntries(fields.flatMap(([name, length, required = true]) => {
        const fieldValue = item[name]
        if (!required && (fieldValue === undefined || fieldValue === null || fieldValue === '')) return []
        return [[name, courseString(fieldValue, `${label} ${index + 1}`, length, required)]]
      }))
    })
  }
  return {
    ...(typeof value.recap === 'string' ? { recap: courseString(value.recap, 'Tóm tắt bài học', 5000, false) } : {}),
    takeaways: courseStringList(value.takeaways ?? [], 'Ý chính', 20, 1000),
    glossary: objectList(value.glossary ?? [], 'Thuật ngữ', 30, [
      ['id', 200], ['term', 300], ['definition', 2000],
    ]),
    recallPrompts: objectList(value.recallPrompts ?? [], 'Câu hỏi tự nhớ', 30, [
      ['id', 200], ['prompt', 1000], ['answer', 3000],
    ]),
    flashcards: objectList(value.flashcards ?? [], 'Flashcard', 50, [
      ['id', 200], ['front', 1000], ['back', 3000], ['hint', 1000, false],
    ]),
  }
}

function normalizeCourseAssetReference(value, courseIdentifier, lessonIdentifier, resourceKind) {
  if (!isPlainObject(value)) return undefined
  const assetId = courseId(value.assetId, 'Mã học liệu')
  const storagePath = courseString(value.storagePath, 'Đường dẫn học liệu', 1024)
  const expectedPrefix = `course-media/${courseIdentifier}/${lessonIdentifier}/`
  if (!storagePath.startsWith(expectedPrefix) || storagePath === expectedPrefix || storagePath.includes('..')) {
    throw new HttpsError('invalid-argument', 'Học liệu không thuộc khóa học và bài học đã chọn.')
  }
  if (value.status !== undefined && !['uploading', 'ready', 'failed'].includes(value.status)) {
    throw new HttpsError('invalid-argument', 'Trạng thái học liệu không hợp lệ.')
  }
  if (value.contentType !== undefined && !isSupportedCourseMediaType(value.contentType, resourceKind)) {
    throw new HttpsError('invalid-argument', 'Định dạng học liệu không phù hợp với loại tài nguyên.')
  }
  if (value.sizeBytes !== undefined
      && (!Number.isInteger(value.sizeBytes) || value.sizeBytes < 1 || value.sizeBytes > 500 * 1024 * 1024)) {
    throw new HttpsError('invalid-argument', 'Kích thước học liệu không hợp lệ.')
  }
  return {
    assetId,
    storagePath,
    ...(typeof value.fileName === 'string' ? { fileName: courseString(value.fileName, 'Tên tệp', 500, false) } : {}),
    ...(typeof value.contentType === 'string' ? { contentType: value.contentType } : {}),
    ...(Number.isInteger(value.sizeBytes) ? { sizeBytes: value.sizeBytes } : {}),
    ...(typeof value.status === 'string' ? { status: value.status } : {}),
  }
}

function normalizeCourseDraftInput(value) {
  if (!isPlainObject(value)) throw new HttpsError('invalid-argument', 'Dữ liệu khóa học không hợp lệ.')
  const identifier = courseId(value.id, 'Mã khóa học')
  const requestedStatus = value.publicationStatus
  if (!coursePublicationStatuses.has(requestedStatus)) {
    throw new HttpsError('invalid-argument', 'Trạng thái xuất bản không hợp lệ.')
  }
  if (requestedStatus === 'scheduled' && !academyCoursePublishingSchedulerAvailable) {
    throw new HttpsError(
      'failed-precondition',
      'Tính năng lên lịch xuất bản chưa được kích hoạt. Hãy gửi duyệt hoặc xuất bản trực tiếp.',
    )
  }
  const settings = value.settings
  if (!isPlainObject(settings)
      || !['free', 'pro'].includes(settings.accessTier)
      || !['members', 'private'].includes(settings.visibility)
      || !['none', 'weekly'].includes(settings.dripSchedule)
      || !Number.isInteger(settings.completionPercent)
      || settings.completionPercent < 50
      || settings.completionPercent > 100
      || typeof settings.certificateEnabled !== 'boolean') {
    throw new HttpsError('invalid-argument', 'Thiết lập quyền truy cập hoặc hoàn thành khóa học không hợp lệ.')
  }

  const rawAnswerKeys = isPlainObject(value.quizAnswerKeys) ? value.quizAnswerKeys : {}
  const quizDefinitions = new Map()
  const answerCandidates = new Map()
  const lessonIds = new Set()
  const moduleIds = new Set()
  if (!Array.isArray(value.modules) || value.modules.length > 40) {
    throw new HttpsError('invalid-argument', 'Danh sách chương không hợp lệ hoặc vượt quá giới hạn.')
  }
  let lessonCount = 0
  const modules = value.modules.map((module, moduleIndex) => {
    if (!isPlainObject(module) || !Array.isArray(module.lessons) || module.lessons.length > 50) {
      throw new HttpsError('invalid-argument', `Chương ${moduleIndex + 1} không hợp lệ.`)
    }
    const moduleIdentifier = courseId(module.id, `Mã chương ${moduleIndex + 1}`)
    if (moduleIds.has(moduleIdentifier)) throw new HttpsError('invalid-argument', 'Mã chương bị trùng.')
    moduleIds.add(moduleIdentifier)
    const lessons = module.lessons.map((lesson, lessonIndex) => {
      lessonCount += 1
      if (lessonCount > 200 || !isPlainObject(lesson)) {
        throw new HttpsError('invalid-argument', 'Số bài học vượt quá giới hạn hoặc dữ liệu bài học không hợp lệ.')
      }
      const lessonIdentifier = courseId(lesson.id, `Mã bài học ${lessonIndex + 1}`)
      if (lessonIds.has(lessonIdentifier)) throw new HttpsError('invalid-argument', 'Mã bài học bị trùng trong khóa học.')
      lessonIds.add(lessonIdentifier)
      const lessonType = lesson.type === 'Buổi tập' ? 'Bài đọc' : lesson.type
      if (!courseLessonTypes.has(lessonType)) throw new HttpsError('invalid-argument', 'Loại bài học không hợp lệ.')

      const resources = lesson.resources === undefined ? [] : lesson.resources
      if (!Array.isArray(resources) || resources.length > 20) {
        throw new HttpsError('invalid-argument', 'Danh sách học liệu không hợp lệ.')
      }
      const resourceIds = new Set()
      const normalizedResources = resources.map((resource, resourceIndex) => {
        if (!isPlainObject(resource) || !courseResourceKinds.has(resource.kind)) {
          throw new HttpsError('invalid-argument', `Học liệu ${resourceIndex + 1} không hợp lệ.`)
        }
        const resourceIdentifier = courseId(resource.id, 'Mã học liệu')
        if (resourceIds.has(resourceIdentifier)) throw new HttpsError('invalid-argument', 'Mã học liệu bị trùng trong bài học.')
        resourceIds.add(resourceIdentifier)
        const assetRef = normalizeCourseAssetReference(resource.assetRef, identifier, lessonIdentifier, resource.kind)
        const resourceUrl = courseString(resource.url ?? '', 'Liên kết học liệu', 2000, false)
        if (resourceUrl && !/^https?:\/\//i.test(resourceUrl) && !resourceUrl.startsWith('/')) {
          throw new HttpsError('invalid-argument', 'Liên kết học liệu phải dùng HTTP, HTTPS hoặc đường dẫn nội bộ.')
        }
        return {
          id: resourceIdentifier,
          kind: resource.kind,
          title: courseString(resource.title, 'Tên học liệu', 300, false),
          url: resourceUrl,
          ...(typeof resource.note === 'string' ? { note: courseString(resource.note, 'Ghi chú học liệu', 3000, false) } : {}),
          ...(assetRef ? { assetRef } : {}),
          ...(resource.isPrimary === true ? { isPrimary: true } : {}),
        }
      })

      let quiz
      if (lesson.quiz !== undefined) {
        if (!isPlainObject(lesson.quiz)
            || !Array.isArray(lesson.quiz.questions)
            || lesson.quiz.questions.length > 100
            || !Number.isInteger(lesson.quiz.passPercent)
            || lesson.quiz.passPercent < 0
            || lesson.quiz.passPercent > 100
            || !['sequential', 'shuffle'].includes(lesson.quiz.questionOrder)) {
          throw new HttpsError('invalid-argument', 'Thiết lập quiz không hợp lệ.')
        }
        const questionIds = new Set()
        const lessonAnswerCandidates = {}
        const questions = lesson.quiz.questions.map((question, questionIndex) => {
          if (!isPlainObject(question) || !Array.isArray(question.options) || question.options.length > 10) {
            throw new HttpsError('invalid-argument', `Câu hỏi ${questionIndex + 1} không hợp lệ.`)
          }
          const questionIdentifier = courseId(question.id, 'Mã câu hỏi')
          if (questionIds.has(questionIdentifier)) throw new HttpsError('invalid-argument', 'Mã câu hỏi bị trùng trong quiz.')
          questionIds.add(questionIdentifier)
          const options = question.options.map((option) => courseString(option, 'Phương án trả lời', 1000, false))
          const lessonKeys = isPlainObject(rawAnswerKeys[lessonIdentifier]) ? rawAnswerKeys[lessonIdentifier] : {}
          const suppliedIndexes = Array.isArray(lessonKeys[questionIdentifier]) ? lessonKeys[questionIdentifier] : []
          const candidate = Number.isInteger(question.correctIndex) ? question.correctIndex : suppliedIndexes[0]
          if (Number.isInteger(candidate)) lessonAnswerCandidates[questionIdentifier] = candidate
          return {
            id: questionIdentifier,
            question: courseString(question.question, 'Câu hỏi', 2000, false),
            options,
            ...(typeof question.explanation === 'string'
              ? { explanation: courseString(question.explanation, 'Giải thích đáp án', 3000, false) }
              : {}),
          }
        })
        const publicSettings = isPlainObject(lesson.quiz.publicSettings) ? lesson.quiz.publicSettings : {}
        quiz = {
          id: courseId(lesson.quiz.id, 'Mã quiz'),
          passPercent: lesson.quiz.passPercent,
          questionOrder: lesson.quiz.questionOrder,
          publicSettings: {
            ...(Number.isInteger(publicSettings.maxAttempts)
              && publicSettings.maxAttempts >= 1 && publicSettings.maxAttempts <= quizMaxAttemptLimit
              ? { maxAttempts: publicSettings.maxAttempts }
              : {}),
            ...(Number.isInteger(publicSettings.timeLimitMinutes)
              && publicSettings.timeLimitMinutes >= 1 && publicSettings.timeLimitMinutes <= 600
              ? { timeLimitMinutes: publicSettings.timeLimitMinutes }
              : {}),
            ...(['never', 'after-submit', 'after-pass'].includes(publicSettings.revealMode)
              ? { revealMode: publicSettings.revealMode }
              : {}),
          },
          questions,
        }
        quizDefinitions.set(lessonIdentifier, quiz)
        answerCandidates.set(lessonIdentifier, lessonAnswerCandidates)
      }

      let completionPolicy
      if (lesson.completionPolicy !== undefined) {
        if (!isPlainObject(lesson.completionPolicy) || !courseCompletionModes.has(lesson.completionPolicy.mode)) {
          throw new HttpsError('invalid-argument', 'Điều kiện hoàn thành bài học không hợp lệ.')
        }
        completionPolicy = {
          mode: lesson.completionPolicy.mode,
          ...(Number.isInteger(lesson.completionPolicy.thresholdPercent)
            ? { thresholdPercent: lesson.completionPolicy.thresholdPercent }
            : {}),
          ...(typeof lesson.completionPolicy.quizId === 'string'
            ? { quizId: courseString(lesson.completionPolicy.quizId, 'Mã quiz hoàn thành', 200, false) }
            : {}),
        }
        if (completionPolicy.thresholdPercent !== undefined
            && (completionPolicy.thresholdPercent < 1 || completionPolicy.thresholdPercent > 100)) {
          throw new HttpsError('invalid-argument', 'Ngưỡng hoàn thành phải từ 1 đến 100%.')
        }
      }

      let primaryContent
      if (lesson.primaryContent !== undefined) {
        if (!isPlainObject(lesson.primaryContent) || !['resource', 'rich-text', 'workout'].includes(lesson.primaryContent.kind)) {
          throw new HttpsError('invalid-argument', 'Nội dung chính của bài học không hợp lệ.')
        }
        primaryContent = lesson.primaryContent.kind === 'workout'
          ? { kind: 'rich-text', body: courseString(lesson.summary ?? '', 'Nội dung bài học', 50_000, false) }
          : {
              kind: lesson.primaryContent.kind,
              ...(typeof lesson.primaryContent.resourceId === 'string'
                ? { resourceId: courseString(lesson.primaryContent.resourceId, 'Mã học liệu chính', 200, false) }
                : {}),
              ...(typeof lesson.primaryContent.body === 'string'
                ? { body: courseString(lesson.primaryContent.body, 'Nội dung bài học', 50_000, false) }
                : {}),
            }
      }

      const memory = normalizeCourseMemory(lesson.memory)
      return {
        id: lessonIdentifier,
        title: courseString(lesson.title, 'Tên bài học', 300, false),
        type: lessonType,
        duration: courseString(lesson.duration, 'Thời lượng bài học', 100, false),
        ...(lesson.preview === true ? { preview: true } : {}),
        ...(typeof lesson.summary === 'string' ? { summary: courseString(lesson.summary, 'Tóm tắt bài học', 10_000, false) } : {}),
        ...(normalizedResources.length ? { resources: normalizedResources } : {}),
        ...(Array.isArray(lesson.tags) ? { tags: courseStringList(lesson.tags, 'Nhãn bài học', 20, 100) } : {}),
        ...(typeof lesson.coachNotes === 'string' ? { coachNotes: courseString(lesson.coachNotes, 'Ghi chú giảng viên', 10_000, false) } : {}),
        ...(memory ? { memory } : {}),
        ...(quiz ? { quiz } : {}),
        ...(primaryContent ? { primaryContent } : {}),
        ...(completionPolicy ? { completionPolicy } : {}),
      }
    })
    return {
      id: moduleIdentifier,
      title: courseString(module.title, 'Tên chương', 300, false),
      order: Number.isInteger(module.order) ? module.order : moduleIndex + 1,
      ...(typeof module.description === 'string' ? { description: courseString(module.description, 'Mô tả chương', 3000, false) } : {}),
      lessons,
    }
  })

  const coverUrl = typeof value.coverUrl === 'string' ? value.coverUrl.trim() : ''
  if (coverUrl && (coverUrl.length > 2048 || (!/^https:\/\//i.test(coverUrl) && !coverUrl.startsWith('/')))) {
    throw new HttpsError('invalid-argument', 'Ảnh bìa khóa học không hợp lệ.')
  }
  const slug = courseString(value.slug, 'Đường dẫn khóa học', 200)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new HttpsError('invalid-argument', 'Đường dẫn khóa học chỉ dùng chữ thường, số và dấu gạch ngang.')
  }
  return {
    identifier,
    requestedStatus,
    lessonCount,
    quizDefinitions,
    answerCandidates,
    course: {
      schemaVersion: 2,
      title: courseString(value.title, 'Tên khóa học', 200),
      coverUrl: coverUrl || null,
      slug,
      description: courseString(value.description, 'Mô tả khóa học', 10_000, false),
      category: courseString(value.category, 'Danh mục khóa học', 200),
      level: courseString(value.level, 'Trình độ khóa học', 100),
      duration: courseString(value.duration, 'Thời lượng khóa học', 100),
      coach: courseString(value.coach, 'Giảng viên', 200),
      outcomes: courseStringList(value.outcomes, 'Kết quả học tập', 30, 1000),
      requirements: courseStringList(value.requirements, 'Yêu cầu đầu vào', 30, 1000),
      modules,
      settings: {
        accessTier: settings.accessTier,
        visibility: settings.visibility,
        completionPercent: settings.completionPercent,
        certificateEnabled: settings.certificateEnabled,
        dripSchedule: settings.dripSchedule,
      },
      lessons: lessonCount,
      accent: 'purple',
      icon: 'nutrition',
      status: requestedStatus,
    },
  }
}

function assertCourseContentSaveStatus(currentStatus, nextStatus, role, exists) {
  if (!['draft', 'review'].includes(nextStatus)) {
    throw new HttpsError(
      'failed-precondition',
      'Nội dung chỉ được chỉnh ở bản nháp hoặc bản đang chờ duyệt. Hãy dùng quy trình duyệt để đổi trạng thái.',
    )
  }
  if (exists && !['draft', 'review'].includes(currentStatus)) {
    throw new HttpsError(
      'failed-precondition',
      'Phiên bản đã duyệt, xuất bản hoặc lưu trữ là bất biến. Hãy khôi phục một revision thành bản nháp mới để chỉnh sửa.',
    )
  }
  if (role === 'editor' && !['draft', 'review'].includes(nextStatus)) {
    throw new HttpsError('permission-denied', 'Biên tập viên chỉ được lưu bản nháp hoặc gửi duyệt.')
  }
}

function assertCourseReadyToPublish(course, quizDocuments) {
  if (!course.description || !course.coach
      || !course.outcomes.length || course.outcomes.some((item) => !item)
      || !course.requirements.length || course.requirements.some((item) => !item)
      || !course.modules.length || course.lessons < 6) {
    throw new HttpsError('failed-precondition', 'Khóa học chưa đủ mô tả, mục tiêu, yêu cầu và tối thiểu 6 bài học để xuất bản.')
  }
  for (const module of course.modules) {
    if (!module.title || !module.lessons.length) {
      throw new HttpsError('failed-precondition', 'Mỗi chương phải có tên và ít nhất một bài học trước khi xuất bản.')
    }
    for (const lesson of module.lessons) {
      if (!lesson.title || !lesson.duration) {
        throw new HttpsError('failed-precondition', 'Mỗi bài học phải có tên và thời lượng trước khi xuất bản.')
      }
      const resources = lesson.resources ?? []
      const validResources = resources.filter((resource) => Boolean(
        resource.title
          && (resource.assetRef
            ? resource.assetRef.status === 'ready'
            : resource.url),
      ))
      if (validResources.length !== resources.length) {
        throw new HttpsError(
          'failed-precondition',
          `Bài “${lesson.title}” có học liệu thiếu tên, liên kết hoặc tệp đã tải lên hoàn tất.`,
        )
      }
      if (lesson.type === 'Video' && !validResources.some((resource) => resource.kind === 'video')) {
        throw new HttpsError('failed-precondition', `Bài video “${lesson.title}” chưa có video hợp lệ.`)
      }
      if (lesson.type === 'Bài đọc') {
        const hasReadableBody = Boolean(
          lesson.summary?.trim()
            || (lesson.primaryContent?.kind === 'rich-text' && lesson.primaryContent.body?.trim()),
        )
        if (!hasReadableBody && !validResources.length) {
          throw new HttpsError(
            'failed-precondition',
            `Bài đọc “${lesson.title}” cần có nội dung tóm tắt, nội dung bài viết hoặc ít nhất một học liệu hợp lệ.`,
          )
        }
      }
      if (lesson.type === 'Quiz') {
        const quizKey = quizDocuments.get(lesson.id)
        if (!lesson.quiz?.questions?.length || !quizKey
            || lesson.quiz.questions.some((question) => !question.question
              || question.options.length < 2
              || question.options.some((option) => !option)
              || !Number.isInteger(quizKey.answers[question.id])
              || quizKey.answers[question.id] < 0
              || quizKey.answers[question.id] >= question.options.length)) {
          throw new HttpsError('failed-precondition', `Quiz “${lesson.title}” chưa có đầy đủ câu hỏi và đáp án đúng.`)
        }
      }
      const primaryResource = lesson.primaryContent?.kind === 'resource'
        ? validResources.find((resource) => resource.id === lesson.primaryContent.resourceId)
        : null
      if (lesson.primaryContent?.kind === 'resource' && !primaryResource) {
        throw new HttpsError('failed-precondition', `Bài “${lesson.title}” chưa chọn đúng học liệu chính.`)
      }
      if (lesson.completionPolicy?.mode === 'media-progress'
          && (!primaryResource || primaryResource.kind !== 'video')) {
        throw new HttpsError('failed-precondition', `Bài “${lesson.title}” phải chọn video chính để theo dõi tiến độ.`)
      }
      if (lesson.type === 'Quiz' && lesson.completionPolicy?.mode !== 'quiz-pass') {
        throw new HttpsError('failed-precondition', `Bài “${lesson.title}” phải hoàn thành bằng kết quả quiz.`)
      }
      const requiresPrivateDelivery = course.settings.accessTier === 'pro' || course.settings.visibility === 'private'
      if (requiresPrivateDelivery && resources.some((resource) => resource.assetRef?.status !== 'ready')) {
        throw new HttpsError('failed-precondition', `Bài “${lesson.title}” phải tải học liệu lên Firebase trước khi xuất bản.`)
      }
    }
  }
}

async function requireTrustedAcademyStaffContext(request) {
  const actorId = requireCaller(request)
  const snapshot = await db.doc(`users/${actorId}`).get()
  if (!snapshot.exists || !hasTrustedRole(request, snapshot.data(), academyStaffRoles)) {
    throw new HttpsError('permission-denied', 'Bạn không có quyền quản trị Aura Academy.')
  }
  return { actorId, role: snapshot.data().role }
}

/** Atomically saves the course, private quiz keys, immutable revision and audit event. */
exports.saveCourseDraftAtomic = onCall({ cpu: 'gcf_gen1', maxInstances: 3 }, async (request) => {
  const actor = await requireTrustedAcademyStaffContext(request)
  const normalized = normalizeCourseDraftInput(request.data?.course)
  const expectedRevision = request.data?.expectedRevision
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new HttpsError('invalid-argument', 'Cần revision hiện tại để lưu khóa học an toàn.')
  }
  const courseReference = db.doc(`courses/${normalized.identifier}`)
  let savedRevision = 0
  await db.runTransaction(async (transaction) => {
    const courseSnapshot = await transaction.get(courseReference)
    const quizKeySnapshot = await transaction.get(courseReference.collection('quizKeys'))
    const existingCourse = courseSnapshot.data() ?? {}
    const currentRevision = courseSnapshot.exists ? Number(existingCourse.revision) || 0 : 0
    if (currentRevision !== expectedRevision) {
      throw new HttpsError(
        'aborted',
        'Khóa học đã được thay đổi ở một phiên khác. Hãy tải lại bản mới nhất trước khi lưu.',
        { expectedRevision, currentRevision },
      )
    }
    assertCourseContentSaveStatus(existingCourse.status ?? 'draft', normalized.requestedStatus, actor.role, courseSnapshot.exists)
    const existingKeys = new Map(quizKeySnapshot.docs.map((snapshot) => [snapshot.id, snapshot.data()]))
    const quizDocuments = new Map()
    for (const [lessonId, quiz] of normalized.quizDefinitions) {
      if (!quiz.questions.length) continue
      const existingAnswers = isPlainObject(existingKeys.get(lessonId)?.answers) ? existingKeys.get(lessonId).answers : {}
      const suppliedAnswers = normalized.answerCandidates.get(lessonId) ?? {}
      const answers = Object.fromEntries(quiz.questions.flatMap((question) => {
        const candidate = Number.isInteger(suppliedAnswers[question.id])
          ? suppliedAnswers[question.id]
          : existingAnswers[question.id]
        return Number.isInteger(candidate) && candidate >= 0 && candidate < question.options.length
          ? [[question.id, candidate]]
          : []
      }))
      const contentHash = buildQuizContentHash(quiz, answers)
      quizDocuments.set(lessonId, {
        quizId: quiz.id,
        passPercent: quiz.passPercent,
        answers,
        questionCount: quiz.questions.length,
        contentHash,
      })
    }
    if (normalized.requestedStatus === 'review') {
      assertCourseReadyToPublish(normalized.course, quizDocuments)
    }

    savedRevision = currentRevision + 1
    const nextCourse = {
      ...normalized.course,
      revision: savedRevision,
      createdAt: existingCourse.createdAt ?? FieldValue.serverTimestamp(),
      createdBy: existingCourse.createdBy ?? actor.actorId,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.actorId,
      revisionUpdatedAt: FieldValue.serverTimestamp(),
      revisionUpdatedBy: actor.actorId,
      ...(existingCourse.publishedAt ? { publishedAt: existingCourse.publishedAt } : {}),
    }
    const revisionId = `${normalized.identifier}_${String(savedRevision).padStart(6, '0')}`
    const revisionCourse = { ...normalized.course, revision: savedRevision }
    const revisionQuizKeys = Object.fromEntries(quizDocuments)
    const revisionPayload = JSON.stringify({ course: revisionCourse, quizKeys: revisionQuizKeys })
    if (Buffer.byteLength(revisionPayload, 'utf8') > 750 * 1024) {
      throw new HttpsError(
        'resource-exhausted',
        'Khóa học đã vượt giới hạn an toàn của một phiên bản. Hãy chia nhỏ nội dung hoặc học liệu trước khi lưu.',
      )
    }
    transaction.set(courseReference, nextCourse)
    for (const [lessonId, data] of quizDocuments) {
      const existingKey = existingKeys.get(lessonId) ?? {}
      transaction.set(courseReference.collection('quizKeys').doc(lessonId), {
        ...data,
        createdAt: existingKey.createdAt ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.actorId,
      })
    }
    for (const snapshot of quizKeySnapshot.docs) {
      if (!quizDocuments.has(snapshot.id)) transaction.delete(snapshot.ref)
    }
    transaction.create(db.doc(`courseRevisions/${revisionId}`), {
      courseId: normalized.identifier,
      revision: savedRevision,
      contentHash: createHash('sha256').update(revisionPayload).digest('hex'),
      course: revisionCourse,
      quizKeys: revisionQuizKeys,
      createdBy: actor.actorId,
      createdAt: FieldValue.serverTimestamp(),
    })
    transaction.set(db.collection('auditLogs').doc(), {
      action: !courseSnapshot.exists
        ? 'course.created'
        : existingCourse.status !== normalized.requestedStatus
          ? 'course.status.changed'
          : 'course.updated',
      actorUid: actor.actorId,
      targetId: normalized.identifier,
      previousStatus: courseSnapshot.exists ? existingCourse.status ?? 'draft' : null,
      status: normalized.requestedStatus,
      revision: savedRevision,
      createdAt: FieldValue.serverTimestamp(),
    })
  })
  return { courseId: normalized.identifier, revision: savedRevision, status: normalized.requestedStatus }
})

function immutableCourseRevisionSnapshot(value, status, revision) {
  const {
    createdAt: _createdAt,
    createdBy: _createdBy,
    updatedAt: _updatedAt,
    updatedBy: _updatedBy,
    revisionUpdatedAt: _revisionUpdatedAt,
    revisionUpdatedBy: _revisionUpdatedBy,
    approvedAt: _approvedAt,
    approvedBy: _approvedBy,
    firstPublishedAt: _firstPublishedAt,
    publishedAt: _publishedAt,
    publishedBy: _publishedBy,
    archivedAt: _archivedAt,
    archivedBy: _archivedBy,
    ...content
  } = value
  return { ...content, status, revision }
}

function immutableQuizRevisionSnapshot(snapshot) {
  const value = snapshot.data()
  return {
    quizId: typeof value.quizId === 'string' ? value.quizId : snapshot.id,
    passPercent: Number.isInteger(value.passPercent) ? value.passPercent : 0,
    answers: isPlainObject(value.answers) ? value.answers : {},
    questionCount: Number.isInteger(value.questionCount) ? value.questionCount : 0,
    contentHash: typeof value.contentHash === 'string' ? value.contentHash : '',
  }
}

/**
 * Moves a saved course through the server-owned publication workflow.
 * Content editing and publication are intentionally separate operations so an
 * editor cannot smuggle an approval status inside a content save.
 */
exports.transitionCoursePublicationStatus = onCall({ cpu: 'gcf_gen1', maxInstances: 3 }, async (request) => {
  const actor = await requireTrustedAcademyStaffContext(request)
  if (!privilegedAdminRoles.has(actor.role)) {
    throw new HttpsError('permission-denied', 'Chỉ Administrator được duyệt, xuất bản hoặc lưu trữ khóa học.')
  }
  const targetCourseId = courseId(request.data?.courseId, 'Mã khóa học')
  const expectedRevision = Number(request.data?.expectedRevision)
  const nextStatus = request.data?.nextStatus
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1 || !coursePublicationStatuses.has(nextStatus)) {
    throw new HttpsError('invalid-argument', 'Yêu cầu chuyển trạng thái khóa học không hợp lệ.')
  }
  if (nextStatus === 'scheduled' && !academyCoursePublishingSchedulerAvailable) {
    throw new HttpsError(
      'failed-precondition',
      'Lên lịch xuất bản đang khóa vì chưa có scheduler backend. Hãy xuất bản thủ công sau khi nội dung được duyệt.',
    )
  }

  const allowedTransitions = {
    review: new Set(['approved']),
    approved: new Set(academyCoursePublishingSchedulerAvailable ? ['scheduled', 'published'] : ['published']),
    scheduled: new Set(['published']),
    published: new Set(['archived']),
    archived: new Set(['published']),
  }
  const courseReference = db.doc(`courses/${targetCourseId}`)
  let nextRevision = 0
  await db.runTransaction(async (transaction) => {
    const [courseSnapshot, quizKeySnapshot] = await Promise.all([
      transaction.get(courseReference),
      transaction.get(courseReference.collection('quizKeys')),
    ])
    if (!courseSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy khóa học.')
    const current = courseSnapshot.data()
    const currentStatus = current.status ?? 'draft'
    const currentRevision = Number(current.revision) || 0
    if (currentRevision !== expectedRevision) {
      throw new HttpsError(
        'aborted',
        'Khóa học đã thay đổi ở một phiên khác. Hãy tải lại trước khi duyệt hoặc xuất bản.',
        { expectedRevision, currentRevision },
      )
    }
    if (!allowedTransitions[currentStatus]?.has(nextStatus)) {
      throw new HttpsError('failed-precondition', `Không thể chuyển khóa học từ ${currentStatus} sang ${nextStatus}.`)
    }

    const quizDocuments = new Map(quizKeySnapshot.docs.map((item) => [item.id, immutableQuizRevisionSnapshot(item)]))
    if (nextStatus === 'approved' || nextStatus === 'published' || nextStatus === 'scheduled') {
      assertCourseReadyToPublish(current, quizDocuments)
    }
    nextRevision = currentRevision + 1
    const revisionCourse = immutableCourseRevisionSnapshot(current, nextStatus, nextRevision)
    const revisionQuizKeys = Object.fromEntries(quizDocuments)
    const revisionPayload = JSON.stringify({ course: revisionCourse, quizKeys: revisionQuizKeys })
    if (Buffer.byteLength(revisionPayload, 'utf8') > 750 * 1024) {
      throw new HttpsError('resource-exhausted', 'Khóa học đã vượt giới hạn an toàn của một phiên bản.')
    }
    const lifecycleFields = nextStatus === 'approved'
      ? { approvedAt: FieldValue.serverTimestamp(), approvedBy: actor.actorId }
      : nextStatus === 'published'
        ? {
            firstPublishedAt: current.firstPublishedAt ?? current.publishedAt ?? FieldValue.serverTimestamp(),
            publishedAt: FieldValue.serverTimestamp(),
            publishedBy: actor.actorId,
            archivedAt: FieldValue.delete(),
            archivedBy: FieldValue.delete(),
          }
        : nextStatus === 'archived'
          ? { archivedAt: FieldValue.serverTimestamp(), archivedBy: actor.actorId }
          : {}

    transaction.update(courseReference, {
      status: nextStatus,
      revision: nextRevision,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.actorId,
      revisionUpdatedAt: FieldValue.serverTimestamp(),
      revisionUpdatedBy: actor.actorId,
      ...lifecycleFields,
    })
    transaction.create(db.doc(`courseRevisions/${targetCourseId}_${String(nextRevision).padStart(6, '0')}`), {
      courseId: targetCourseId,
      revision: nextRevision,
      transition: { from: currentStatus, to: nextStatus },
      contentHash: createHash('sha256').update(revisionPayload).digest('hex'),
      course: revisionCourse,
      quizKeys: revisionQuizKeys,
      createdBy: actor.actorId,
      createdAt: FieldValue.serverTimestamp(),
    })
    transaction.set(db.collection('auditLogs').doc(), {
      action: 'course.status.changed',
      actorUid: actor.actorId,
      targetId: targetCourseId,
      previousStatus: currentStatus,
      status: nextStatus,
      revision: nextRevision,
      createdAt: FieldValue.serverTimestamp(),
    })
  })
  return { courseId: targetCourseId, revision: nextRevision, status: nextStatus }
})

function academyDiffValue(value) {
  if (value === undefined) return null
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 497)}...` : value
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  try {
    const serialized = JSON.stringify(value)
    return serialized.length > 500 ? `${serialized.slice(0, 497)}...` : serialized
  } catch {
    return '[Dữ liệu phức hợp]'
  }
}

function buildCourseRevisionDiff(fromCourse, toCourse) {
  const changes = []
  const addChange = (path, label, before, after) => {
    if (JSON.stringify(before) === JSON.stringify(after) || changes.length >= 200) return
    changes.push({ path, label, before: academyDiffValue(before), after: academyDiffValue(after) })
  }
  const scalarFields = [
    ['title', 'Tên khóa học'], ['slug', 'Đường dẫn'], ['description', 'Mô tả'],
    ['category', 'Danh mục'], ['level', 'Trình độ'], ['coach', 'Giảng viên'],
    ['duration', 'Thời lượng'], ['outcomes', 'Kết quả học tập'], ['requirements', 'Yêu cầu đầu vào'],
    ['coverUrl', 'Ảnh bìa'], ['status', 'Trạng thái'],
  ]
  for (const [field, label] of scalarFields) addChange(field, label, fromCourse[field], toCourse[field])
  for (const field of ['accessTier', 'visibility', 'completionPercent', 'certificateEnabled', 'dripSchedule']) {
    addChange(`settings.${field}`, `Thiết lập · ${field}`, fromCourse.settings?.[field], toCourse.settings?.[field])
  }

  const fromModules = new Map((Array.isArray(fromCourse.modules) ? fromCourse.modules : []).map((item) => [item.id, item]))
  const toModules = new Map((Array.isArray(toCourse.modules) ? toCourse.modules : []).map((item) => [item.id, item]))
  const moduleIds = new Set([...fromModules.keys(), ...toModules.keys()])
  for (const moduleId of moduleIds) {
    const beforeModule = fromModules.get(moduleId)
    const afterModule = toModules.get(moduleId)
    if (!beforeModule || !afterModule) {
      addChange(`modules.${moduleId}`, `Chương · ${beforeModule?.title ?? afterModule?.title ?? moduleId}`, beforeModule ? 'Có' : 'Không', afterModule ? 'Có' : 'Không')
      continue
    }
    addChange(`modules.${moduleId}.title`, `Tên chương · ${beforeModule.title || afterModule.title}`, beforeModule.title, afterModule.title)
    addChange(`modules.${moduleId}.order`, `Thứ tự chương · ${beforeModule.title || afterModule.title}`, beforeModule.order, afterModule.order)
    const beforeLessons = new Map((Array.isArray(beforeModule.lessons) ? beforeModule.lessons : []).map((item) => [item.id, item]))
    const afterLessons = new Map((Array.isArray(afterModule.lessons) ? afterModule.lessons : []).map((item) => [item.id, item]))
    for (const lessonId of new Set([...beforeLessons.keys(), ...afterLessons.keys()])) {
      const beforeLesson = beforeLessons.get(lessonId)
      const afterLesson = afterLessons.get(lessonId)
      const lessonLabel = beforeLesson?.title ?? afterLesson?.title ?? lessonId
      if (!beforeLesson || !afterLesson) {
        addChange(`modules.${moduleId}.lessons.${lessonId}`, `Bài học · ${lessonLabel}`, beforeLesson ? 'Có' : 'Không', afterLesson ? 'Có' : 'Không')
        continue
      }
      for (const field of ['title', 'type', 'duration', 'preview', 'summary', 'resources', 'tags', 'coachNotes', 'memory', 'quiz', 'primaryContent', 'completionPolicy']) {
        addChange(`modules.${moduleId}.lessons.${lessonId}.${field}`, `Bài “${lessonLabel}” · ${field}`, beforeLesson[field], afterLesson[field])
      }
    }
  }
  return {
    changes,
    summary: {
      changedFields: changes.length,
      truncated: changes.length >= 200,
      modulesBefore: fromModules.size,
      modulesAfter: toModules.size,
      lessonsBefore: [...fromModules.values()].reduce((sum, module) => sum + (module.lessons?.length ?? 0), 0),
      lessonsAfter: [...toModules.values()].reduce((sum, module) => sum + (module.lessons?.length ?? 0), 0),
    },
  }
}

/** Returns immutable revision metadata without exposing private quiz answers. */
exports.getCourseRevisionHistory = onCall(async (request) => {
  await requireTrustedAcademyStaffContext(request)
  const targetCourseId = courseId(request.data?.courseId, 'Mã khóa học')
  const snapshot = await db.collection('courseRevisions')
    .where('courseId', '==', targetCourseId)
    .orderBy('revision', 'desc')
    .limit(50)
    .get()
  return { revisions: snapshot.docs.map((item) => ({
    id: item.id,
    revision: Number(item.data().revision || 0),
    contentHash: item.data().contentHash || '',
    createdBy: item.data().createdBy || '',
    createdAt: item.data().createdAt?.toDate?.().toISOString?.() || '',
    status: item.data().course?.status || 'draft',
    title: item.data().course?.title || '',
    restoredFromRevision: Number.isInteger(item.data().restoredFromRevision)
      ? item.data().restoredFromRevision
      : null,
  })) }
})

/** Returns a bounded, answer-key-free field diff between two immutable revisions. */
exports.getCourseRevisionDiff = onCall(async (request) => {
  await requireTrustedAcademyStaffContext(request)
  const targetCourseId = courseId(request.data?.courseId, 'Mã khóa học')
  const fromRevision = Number(request.data?.fromRevision)
  const toRevision = Number(request.data?.toRevision)
  if (!Number.isInteger(fromRevision) || fromRevision < 1
      || !Number.isInteger(toRevision) || toRevision < 1
      || fromRevision === toRevision) {
    throw new HttpsError('invalid-argument', 'Cần chọn hai phiên bản khác nhau để so sánh.')
  }
  const revisionReference = (revision) => db.doc(
    `courseRevisions/${targetCourseId}_${String(revision).padStart(6, '0')}`,
  )
  const [fromSnapshot, toSnapshot] = await Promise.all([
    revisionReference(fromRevision).get(),
    revisionReference(toRevision).get(),
  ])
  if (!fromSnapshot.exists || !toSnapshot.exists
      || fromSnapshot.data().courseId !== targetCourseId
      || toSnapshot.data().courseId !== targetCourseId) {
    throw new HttpsError('not-found', 'Không tìm thấy một trong hai phiên bản cần so sánh.')
  }
  const fromCourse = fromSnapshot.data().course
  const toCourse = toSnapshot.data().course
  if (!isPlainObject(fromCourse) || !isPlainObject(toCourse)) {
    throw new HttpsError('failed-precondition', 'Dữ liệu phiên bản khóa học không hợp lệ.')
  }
  return {
    courseId: targetCourseId,
    fromRevision,
    toRevision,
    ...buildCourseRevisionDiff(fromCourse, toCourse),
  }
})

/** Restores an immutable revision as a new draft; published history is never edited. */
exports.restoreCourseRevisionToDraft = onCall(async (request) => {
  const actor = await requireTrustedAcademyStaffContext(request)
  if (actor.role === 'editor') throw new HttpsError('permission-denied', 'Biên tập viên không có quyền khôi phục phiên bản.')
  const targetCourseId = courseId(request.data?.courseId, 'Mã khóa học')
  const sourceRevision = Number(request.data?.revision)
  const expectedRevision = Number(request.data?.expectedRevision)
  if (!Number.isInteger(sourceRevision) || sourceRevision < 1 || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new HttpsError('invalid-argument', 'Phiên bản khôi phục không hợp lệ.')
  }
  const courseReference = db.doc(`courses/${targetCourseId}`)
  const revisionReference = db.doc(`courseRevisions/${targetCourseId}_${String(sourceRevision).padStart(6, '0')}`)
  let nextRevision = 0
  await db.runTransaction(async (transaction) => {
    const [current, source, currentQuizKeys] = await Promise.all([
      transaction.get(courseReference), transaction.get(revisionReference), transaction.get(courseReference.collection('quizKeys')),
    ])
    if (!current.exists || !source.exists) throw new HttpsError('not-found', 'Không tìm thấy khóa học hoặc phiên bản cần khôi phục.')
    const currentRevision = Number(current.data().revision || 0)
    if (currentRevision !== expectedRevision) throw new HttpsError('aborted', 'Khóa học đã thay đổi. Hãy tải lại trước khi khôi phục.')
    const sourceCourse = source.data().course
    const sourceQuizKeys = isPlainObject(source.data().quizKeys) ? source.data().quizKeys : {}
    if (!isPlainObject(sourceCourse) || source.data().courseId !== targetCourseId) {
      throw new HttpsError('failed-precondition', 'Nội dung phiên bản lưu trữ không hợp lệ.')
    }
    nextRevision = currentRevision + 1
    const draftCourse = { ...sourceCourse, status: 'draft', revision: nextRevision }
    transaction.set(courseReference, { ...draftCourse, createdAt: current.data().createdAt, createdBy: current.data().createdBy, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.actorId, revisionUpdatedAt: FieldValue.serverTimestamp(), revisionUpdatedBy: actor.actorId })
    for (const item of currentQuizKeys.docs) transaction.delete(item.ref)
    for (const [lessonId, quizKey] of Object.entries(sourceQuizKeys)) transaction.set(courseReference.collection('quizKeys').doc(lessonId), { ...quizKey, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.actorId })
    const payload = JSON.stringify({ course: draftCourse, quizKeys: sourceQuizKeys })
    transaction.create(db.doc(`courseRevisions/${targetCourseId}_${String(nextRevision).padStart(6, '0')}`), { courseId: targetCourseId, revision: nextRevision, restoredFromRevision: sourceRevision, contentHash: createHash('sha256').update(payload).digest('hex'), course: draftCourse, quizKeys: sourceQuizKeys, createdBy: actor.actorId, createdAt: FieldValue.serverTimestamp() })
    transaction.set(db.collection('auditLogs').doc(), { action: 'course.revision.restored', actorUid: actor.actorId, targetId: targetCourseId, fromRevision: sourceRevision, revision: nextRevision, createdAt: FieldValue.serverTimestamp() })
  })
  return { courseId: targetCourseId, revision: nextRevision, status: 'draft', restoredFromRevision: sourceRevision }
})

exports.recordCourseRevision = onCall(async (request) => {
  await requireTrustedAcademyStaff(request)
  throw new HttpsError(
    'failed-precondition',
    'Luồng revision cũ đã ngừng hoạt động. Hãy cập nhật ứng dụng và lưu qua saveCourseDraftAtomic.',
  )
})

const productEventNames = new Set([
  'page_view',
  'course_opened',
  'course_enrolled',
  'lesson_completed',
  'nutrition_scan_started',
  'nutrition_scan_completed',
  'workout_completed',
  'eat_clean_order_created',
  'eat_clean_consumption_confirmed',
  'admin_dashboard_loaded',
])

const clientIssueAreas = new Set(['auth', 'gemini', 'openrouter', 'apikey_fun', 'firestore', 'push', 'ui'])
const clientIssueProviders = new Set(['google', 'phone', 'email', 'password', 'gemini', 'openrouter', 'apikey_fun'])

exports.reportClientIssue = onCall({
  // Error reporting must stay available even when the project is close to its
  // Cloud Run regional CPU quota.
  memory: '256MiB',
  cpu: 0.1666,
  maxInstances: 1,
  concurrency: 1,
}, async (request) => {
  if (!allowClientIncident(request)) {
    throw new HttpsError('resource-exhausted', 'Quá nhiều báo cáo trong thời gian ngắn.')
  }
  const area = boundedIncidentValue(request.data?.area, 24)
  const code = boundedIncidentValue(request.data?.code, 80)
  const phase = boundedIncidentValue(request.data?.phase, 80)
  const route = boundedIncidentValue(request.data?.route, 160)
  const host = boundedIncidentValue(request.data?.host, 120)
  const provider = boundedIncidentValue(request.data?.provider, 20)
  const incidentId = boundedIncidentValue(request.data?.incidentId, 80)
  const release = boundedIncidentValue(request.data?.release, 80)
  if (!clientIssueAreas.has(area) || !/^[a-zA-Z0-9_./:-]{1,80}$/.test(code) || !phase) {
    throw new HttpsError('invalid-argument', 'Báo cáo sự cố không hợp lệ.')
  }
  if (provider && !clientIssueProviders.has(provider)) {
    throw new HttpsError('invalid-argument', 'Nhà cung cấp xác thực không hợp lệ.')
  }

  logger.error('Aura client incident', {
    area,
    code,
    phase,
    route,
    host: /^[a-zA-Z0-9.-]{1,120}$/.test(host) ? host : 'unknown',
    provider: provider || null,
    incidentId: incidentId || null,
    release: release || 'web',
    retryable: request.data?.retryable === true,
    authenticated: Boolean(request.auth?.uid),
    userId: request.auth?.uid || null,
    appVerified: Boolean(request.app?.appId),
    schemaVersion: 1,
  })
  return { accepted: true }
})

exports.trackProductEvent = onCall(async (request) => {
  const userId = requireCaller(request)
  const name = request.data?.name
  if (!productEventNames.has(name)) throw new HttpsError('invalid-argument', 'Sự kiện không hợp lệ.')
  const properties = isPlainObject(request.data?.properties)
    ? Object.fromEntries(Object.entries(request.data.properties).slice(0, 20).flatMap(([key, value]) => {
      if (!/^[a-zA-Z0-9_]{1,40}$/.test(key)) return []
      if (typeof value === 'string') return [[key, value.slice(0, 200)]]
      if (typeof value === 'number' && Number.isFinite(value)) return [[key, value]]
      if (typeof value === 'boolean') return [[key, value]]
      return []
    }))
    : {}
  const rateReference = db.doc(`productEventRateLimits/${userId}`)
  const eventReference = db.collection('productEvents').doc()
  await db.runTransaction(async (transaction) => {
    const rateSnapshot = await transaction.get(rateReference)
    const now = Date.now()
    const previousWindow = Number(rateSnapshot.data()?.windowStartedAtMs) || 0
    const sameWindow = now - previousWindow < 60_000
    const count = sameWindow ? (Number(rateSnapshot.data()?.count) || 0) + 1 : 1
    if (count > 120) throw new HttpsError('resource-exhausted', 'Quá nhiều sự kiện trong một phút.')
    transaction.set(rateReference, {
      windowStartedAtMs: sameWindow ? previousWindow : now,
      count,
      updatedAt: FieldValue.serverTimestamp(),
    })
    transaction.create(eventReference, {
      userId,
      name,
      properties,
      occurredAt: FieldValue.serverTimestamp(),
      schemaVersion: 1,
    })
  })
  return { accepted: true }
})

function hasCourseEntitlement(course, profile, isStaff) {
  if (isStaff) return true
  const accessTier = course.settings?.accessTier ?? 'pro'
  return accessTier === 'free' || ['pro', 'coach'].includes(profile.membership)
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasValidCourseAccessSettings(course) {
  return ['members', 'private'].includes(course.settings?.visibility)
    && ['free', 'pro'].includes(course.settings?.accessTier)
    && ['none', 'weekly'].includes(course.settings?.dripSchedule)
    && Number.isInteger(course.settings?.completionPercent)
    && course.settings.completionPercent >= 50
    && course.settings.completionPercent <= 100
}

function findCourseLesson(course, lessonId) {
  const modules = Array.isArray(course.modules) ? course.modules : []
  let selectedLesson = null
  let selectedModuleIndex = -1
  let matches = 0

  modules.forEach((module, moduleIndex) => {
    if (!Array.isArray(module?.lessons)) return
    module.lessons.forEach((lesson) => {
      if (lesson?.id === lessonId) {
        matches += 1
        selectedLesson = lesson
        selectedModuleIndex = moduleIndex
      }
    })
  })

  if (matches > 1) {
    throw new HttpsError('failed-precondition', 'Khóa học có mã bài học bị trùng. Quản trị viên cần sửa nội dung.')
  }
  if (!selectedLesson) {
    throw new HttpsError('not-found', 'Bài học không tồn tại trong khóa học này.')
  }
  return { lesson: selectedLesson, moduleIndex: selectedModuleIndex }
}

function assertDripAccess(course, enrollment, moduleIndex, isStaff) {
  if (isStaff || course.settings?.dripSchedule !== 'weekly' || moduleIndex <= 0) return
  const enrolledAtMillis = typeof enrollment?.enrolledAt?.toMillis === 'function'
    ? enrollment.enrolledAt.toMillis()
    : Number.NaN
  if (!Number.isFinite(enrolledAtMillis)) {
    throw new HttpsError('failed-precondition', 'Ngày ghi danh chưa hợp lệ để tính lịch mở bài.')
  }
  const availableAtMillis = enrolledAtMillis + moduleIndex * 7 * 24 * 60 * 60 * 1000
  if (Date.now() < availableAtMillis) {
    throw new HttpsError('failed-precondition', 'Bài học này chưa đến lịch mở theo lộ trình tuần.')
  }
}

async function requireCourseLessonAccess({ request, userId, courseId, lessonId, allowPreview }) {
  const userReference = db.doc(`users/${userId}`)
  const courseReference = db.doc(`courses/${courseId}`)
  const enrollmentReference = db.doc(`enrollments/${userId}_${courseId}`)
  const [userSnapshot, courseSnapshot, enrollmentSnapshot] = await Promise.all([
    userReference.get(),
    courseReference.get(),
    enrollmentReference.get(),
  ])

  if (!userSnapshot.exists) {
    throw new HttpsError('failed-precondition', 'Hồ sơ người dùng chưa sẵn sàng.')
  }
  if (!courseSnapshot.exists || courseSnapshot.data().status !== 'published') {
    throw new HttpsError('not-found', 'Khóa học chưa được xuất bản hoặc không tồn tại.')
  }

  const profile = userSnapshot.data()
  const course = courseSnapshot.data()
  const enrollment = enrollmentSnapshot.data()
  const isStaff = hasTrustedRole(request, profile, academyStaffRoles)
  const selected = findCourseLesson(course, lessonId)
  if (!isStaff && course.schemaVersion !== 2) {
    throw new HttpsError('failed-precondition', 'Khóa học cần được quản trị viên nâng cấp lên dữ liệu V2.')
  }
  const isPreview = allowPreview === true
    && selected.lesson.preview === true
    && course.settings?.visibility === 'members'

  if (profile.disabled === true) {
    throw new HttpsError('permission-denied', 'Tài khoản này đang bị tạm khóa.')
  }
  if (!hasValidCourseAccessSettings(course)) {
    throw new HttpsError('failed-precondition', 'Thiết lập quyền truy cập của khóa học không hợp lệ.')
  }

  if (!isStaff && !isPreview) {
    if (!enrollmentSnapshot.exists || !['active', 'completed'].includes(enrollment?.status)) {
      throw new HttpsError('failed-precondition', 'Bạn cần ghi danh trước khi truy cập nội dung này.')
    }
    if (enrollment.userId !== userId || enrollment.courseId !== courseId) {
      throw new HttpsError('failed-precondition', 'Dữ liệu ghi danh không nhất quán.')
    }
    if (!hasCourseEntitlement(course, profile, false)) {
      throw new HttpsError('permission-denied', 'Gói thành viên hiện tại không có quyền truy cập khóa học.')
    }
    assertDripAccess(course, enrollment, selected.moduleIndex, false)
  }

  return {
    course,
    courseReference,
    lesson: selected.lesson,
    moduleIndex: selected.moduleIndex,
    isPreview,
    isStaff,
  }
}

function normalizeQuizQuestions(lesson) {
  const quiz = lesson?.quiz
  if (lesson?.type !== 'Quiz' || !isPlainObject(quiz) || !Array.isArray(quiz.questions)) {
    throw new HttpsError('failed-precondition', 'Bài học này chưa có quiz hợp lệ.')
  }
  if (!quiz.questions.length || quiz.questions.length > quizAnswerLimit) {
    throw new HttpsError('failed-precondition', `Quiz phải có từ 1 đến ${quizAnswerLimit} câu hỏi.`)
  }

  const seenIds = new Set()
  const questions = quiz.questions.map((question) => {
    const id = typeof question?.id === 'string' ? question.id.trim() : ''
    const prompt = typeof question?.question === 'string' ? question.question : ''
    if (!id || id.length > 200 || seenIds.has(id)) {
      throw new HttpsError('failed-precondition', 'Quiz có mã câu hỏi trống, quá dài hoặc bị trùng.')
    }
    if (!prompt.trim() || prompt.length > 4000) {
      throw new HttpsError('failed-precondition', `Câu hỏi ${id} có nội dung không hợp lệ.`)
    }
    if (!Array.isArray(question.options)
        || question.options.length < 2
        || question.options.length > 10
        || question.options.some((option) => typeof option !== 'string' || !option.trim() || option.length > 1000)) {
      throw new HttpsError('failed-precondition', `Câu hỏi ${id} có danh sách lựa chọn không hợp lệ.`)
    }
    seenIds.add(id)
    return { id, question: prompt, options: question.options }
  })

  const passPercent = Number(quiz.passPercent)
  if (!Number.isInteger(passPercent) || passPercent < 0 || passPercent > 100) {
    throw new HttpsError('failed-precondition', 'Điểm đạt của quiz không hợp lệ.')
  }
  const rawMaxAttempts = quiz.publicSettings?.maxAttempts
  if (rawMaxAttempts !== undefined
      && (!Number.isInteger(rawMaxAttempts) || rawMaxAttempts < 0 || rawMaxAttempts > quizMaxAttemptLimit)) {
    throw new HttpsError('failed-precondition', `Số lượt làm quiz phải là số nguyên từ 0 đến ${quizMaxAttemptLimit}.`)
  }

  return {
    id: typeof quiz.id === 'string' && quiz.id.trim() ? quiz.id.trim() : lesson.id,
    passPercent,
    maxAttempts: rawMaxAttempts && rawMaxAttempts > 0 ? rawMaxAttempts : null,
    questions,
    legacyQuestions: quiz.questions,
  }
}

function buildQuizContentHash(quiz, answers) {
  const canonicalQuiz = {
    quizId: quiz.id,
    passPercent: quiz.passPercent,
    questions: quiz.questions.map((question) => ({
      id: question.id,
      question: question.question,
      options: question.options,
      correctIndex: answers[question.id],
    })),
  }
  return createHash('sha256').update(JSON.stringify(canonicalQuiz)).digest('hex')
}

function courseLessonScopedId(courseId, lessonId) {
  return createHash('sha256').update(`${courseId}\u0000${lessonId}`).digest('hex')
}

function normalizeSubmittedAnswers(value, questions) {
  if (!Array.isArray(value) || value.length !== questions.length || value.length > quizAnswerLimit) {
    throw new HttpsError('invalid-argument', 'Hãy gửi đúng một câu trả lời cho mỗi câu hỏi.')
  }
  const questionsById = new Map(questions.map((question) => [question.id, question]))
  const seenIds = new Set()
  const answers = value.map((answer) => {
    if (!isPlainObject(answer)) {
      throw new HttpsError('invalid-argument', 'Dữ liệu câu trả lời không hợp lệ.')
    }
    if (Object.keys(answer).some((key) => !['questionId', 'optionIndex'].includes(key))) {
      throw new HttpsError('invalid-argument', 'Câu trả lời chứa trường dữ liệu không được hỗ trợ.')
    }
    const questionId = typeof answer.questionId === 'string' ? answer.questionId.trim() : ''
    const optionIndex = answer.optionIndex
    const question = questionsById.get(questionId)
    if (!question || seenIds.has(questionId) || !Number.isInteger(optionIndex)
        || optionIndex < 0 || optionIndex >= question.options.length) {
      throw new HttpsError('invalid-argument', 'Mã câu hỏi hoặc lựa chọn trả lời không hợp lệ.')
    }
    seenIds.add(questionId)
    return { questionId, optionIndex }
  })
  return answers
}

function normalizeQuizAnswerKey(keyData, quiz) {
  let answers = null
  if (isPlainObject(keyData?.answers)) {
    answers = keyData.answers
  } else if (Array.isArray(keyData?.questions)) {
    answers = Object.fromEntries(keyData.questions.map((question) => [question?.id, question?.correctIndex]))
  }

  if (!answers) {
    throw new HttpsError('failed-precondition', 'Kho đáp án của quiz chưa hợp lệ.')
  }
  const questionIds = new Set(quiz.questions.map((question) => question.id))
  if (Object.keys(answers).length !== questionIds.size) {
    throw new HttpsError('failed-precondition', 'Kho đáp án không khớp số câu hỏi của quiz.')
  }
  for (const question of quiz.questions) {
    const correctIndex = answers[question.id]
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= question.options.length) {
      throw new HttpsError('failed-precondition', `Đáp án của câu hỏi ${question.id} không hợp lệ.`)
    }
  }
  if (typeof keyData.contentHash === 'string' && !/^[a-f0-9]{64}$/i.test(keyData.contentHash)) {
    throw new HttpsError('failed-precondition', 'Mã phiên bản kho đáp án không hợp lệ.')
  }
  if (typeof keyData.quizId === 'string' && keyData.quizId !== quiz.id) {
    throw new HttpsError('failed-precondition', 'Mã quiz không khớp với kho đáp án.')
  }
  if (Number.isInteger(keyData.questionCount) && keyData.questionCount !== quiz.questions.length) {
    throw new HttpsError('failed-precondition', 'Số câu hỏi không khớp với kho đáp án.')
  }
  if (Number.isInteger(keyData.passPercent) && keyData.passPercent !== quiz.passPercent) {
    throw new HttpsError('failed-precondition', 'Điểm đạt không khớp với kho đáp án.')
  }
  return answers
}

function legacyQuizAnswerKey(quiz) {
  const answers = {}
  quiz.legacyQuestions.forEach((question, index) => {
    const correctIndex = question?.correctIndex
    if (!Number.isInteger(correctIndex)
        || correctIndex < 0
        || correctIndex >= quiz.questions[index].options.length) {
      throw new HttpsError('failed-precondition', 'Quiz chưa có kho đáp án phía máy chủ.')
    }
    answers[quiz.questions[index].id] = correctIndex
  })
  return answers
}

function requireCourseMediaPath(value, courseId, lessonId) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024) {
    throw new HttpsError('invalid-argument', 'Đường dẫn media không hợp lệ.')
  }
  const path = value.trim()
  const expectedPrefix = `course-media/${courseId}/${lessonId}/`
  if (!path.startsWith(expectedPrefix)
      || path === expectedPrefix
      || path.includes('..')
      || path.includes('\\')
      || path.includes('//')
      || path.includes('?')
      || path.includes('#')
      || /[\u0000-\u001f\u007f]/.test(path)) {
    throw new HttpsError('invalid-argument', 'Media không thuộc bài học đã chọn.')
  }
  return path
}

function isSupportedCourseMediaType(contentType, resourceKind) {
  if (typeof contentType !== 'string') return false
  if (resourceKind === 'video') return /^video\/[A-Za-z0-9.+-]+$/.test(contentType)
  if (resourceKind === 'slide') {
    return contentType === 'application/pdf'
      || contentType === 'application/vnd.ms-powerpoint'
      || contentType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  }
  if (resourceKind === 'document') {
    return contentType === 'application/pdf'
      || contentType === 'application/msword'
      || contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      || contentType === 'text/plain'
  }
  return false
}

function findLessonMediaReference(lesson, path) {
  const resources = Array.isArray(lesson?.resources) ? lesson.resources : []
  return resources.find((resource) => {
    const assetRef = resource?.assetRef
    return isPlainObject(assetRef)
      && assetRef.storagePath === path
      && assetRef.status === 'ready'
      && typeof assetRef.assetId === 'string'
      && assetRef.assetId.trim().length > 0
  }) ?? null
}

function academyModulesForLearner(modules, mode, maxFullModuleIndex = Number.POSITIVE_INFINITY) {
  if (!Array.isArray(modules)) return []
  return modules.flatMap((module, moduleIndex) => {
    if (!isPlainObject(module) || !Array.isArray(module.lessons)) return []
    const lessons = module.lessons
      .map((lesson) => {
        if (!isPlainObject(lesson)) return lesson
        const canReadLesson = (mode === 'preview' && lesson.preview === true)
          || (mode === 'full' && moduleIndex <= maxFullModuleIndex)
        if (!canReadLesson) {
          return {
            id: lesson.id,
            title: lesson.title,
            type: lesson.type,
            duration: lesson.duration,
            preview: lesson.preview === true,
          }
        }
        const { coachNotes: _instructorNotes, workoutRef: _legacyWorkout, ...safeLesson } = lesson
        if (isPlainObject(safeLesson.quiz) && Array.isArray(safeLesson.quiz.questions)) {
          safeLesson.quiz = {
            ...safeLesson.quiz,
            questions: safeLesson.quiz.questions.map((question) => {
              if (!isPlainObject(question)) return question
              // Answer explanations can reveal the correct choice even when
              // revealMode is "never" or the learner has not submitted yet.
              const { correctIndex: _answerKey, explanation: _answerExplanation, ...safeQuestion } = question
              return safeQuestion
            }),
          }
        }
        return safeLesson
      })
    return lessons.length ? [{ id: module.id, title: module.title, description: module.description ?? '', lessons }] : []
  })
}

/** Returns catalog metadata and only the Academy content the caller may consume. */
exports.listAcademyCourses = onCall(async (request) => {
  const userId = requireCaller(request)
  const [profileSnapshot, courseSnapshot, enrollmentSnapshot] = await Promise.all([
    db.doc(`users/${userId}`).get(),
    db.collection('courses').where('status', '==', 'published').get(),
    db.collection('enrollments').where('userId', '==', userId).get(),
  ])
  const profile = profileSnapshot.exists
    ? profileSnapshot.data()
    : { role: 'student', disabled: false, membership: 'free' }
  if (profile.disabled === true) {
    throw new HttpsError('permission-denied', 'Tài khoản không sẵn sàng để truy cập Aura Academy.')
  }
  const isStaff = hasTrustedRole(request, profile, academyStaffRoles)
  const enrollmentByCourseId = new Map(enrollmentSnapshot.docs.flatMap((item) => {
    const enrollment = item.data()
    return typeof enrollment.courseId === 'string' && enrollment.userId === userId
      ? [[enrollment.courseId, enrollment]]
      : []
  }))
  const courses = courseSnapshot.docs.filter((item) => item.data().schemaVersion === 2).flatMap((item) => {
    const course = item.data()
    const enrollment = enrollmentByCourseId.get(item.id)
    const hasEnrollment = enrollment?.status === 'active' || enrollment?.status === 'completed'
    if (!isStaff && course.settings?.visibility === 'private' && !hasEnrollment) return []
    const hasMembershipAccess = hasCourseEntitlement(course, profile, isStaff)
    const hasFullAccess = isStaff || (hasEnrollment && hasMembershipAccess)
    const contentMode = hasFullAccess
      ? 'full'
      : course.settings?.visibility === 'members'
        ? 'preview'
        : 'locked'
    const enrolledAtMillis = typeof enrollment?.enrolledAt?.toMillis === 'function'
      ? enrollment.enrolledAt.toMillis()
      : Number.NaN
    const maxFullModuleIndex = !isStaff && hasFullAccess && course.settings?.dripSchedule === 'weekly'
      ? Number.isFinite(enrolledAtMillis)
        ? Math.max(0, Math.floor((Date.now() - enrolledAtMillis) / (7 * 24 * 60 * 60 * 1000)))
        : 0
      : Number.POSITIVE_INFINITY
    return [{
      id: item.id,
      schemaVersion: 2,
      title: typeof course.title === 'string' ? course.title : 'Khóa học Aura Academy',
      coverUrl: typeof course.coverUrl === 'string' ? course.coverUrl : null,
      slug: typeof course.slug === 'string' ? course.slug : item.id,
      description: typeof course.description === 'string' ? course.description : '',
      category: typeof course.category === 'string' ? course.category : 'Dinh dưỡng chuyên sâu',
      level: typeof course.level === 'string' ? course.level : 'Mọi cấp độ',
      duration: typeof course.duration === 'string' ? course.duration : 'Tự học',
      coach: typeof course.coach === 'string' ? course.coach : 'Aura Academy',
      outcomes: Array.isArray(course.outcomes) ? course.outcomes : [],
      requirements: Array.isArray(course.requirements) ? course.requirements : [],
      settings: course.settings,
      lessons: Number.isInteger(course.lessons) ? course.lessons : 0,
      accent: typeof course.accent === 'string' ? course.accent : 'purple',
      icon: typeof course.icon === 'string' ? course.icon : 'nutrition',
      status: 'published',
      modules: academyModulesForLearner(course.modules, contentMode, maxFullModuleIndex),
      contentAccess: contentMode,
      updatedAt: course.updatedAt ?? null,
    }]
  })
  return { courses }
})

/** Assigns or cancels an Academy enrollment without coupling it to PT CRM. */
exports.manageAcademyEnrollment = onCall(async (request) => {
  const actorId = requireCaller(request)
  const actorSnapshot = await db.doc(`users/${actorId}`).get()
  if (!actorSnapshot.exists
      || actorSnapshot.data().disabled === true
      || !hasTrustedRole(request, actorSnapshot.data(), privilegedAdminRoles)) {
    throw new HttpsError('permission-denied', 'Bạn không có quyền quản lý ghi danh Aura Academy.')
  }
  const courseId = requireDocumentId(request.data?.courseId, 'Mã khóa học')
  const action = request.data?.action
  if (!['assign', 'cancel'].includes(action)) {
    throw new HttpsError('invalid-argument', 'Thao tác ghi danh không hợp lệ.')
  }
  const email = typeof request.data?.email === 'string' ? request.data.email.trim().toLowerCase() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'Email học viên không hợp lệ.')
  }
  let authUser
  try {
    authUser = await auth.getUserByEmail(email)
  } catch (error) {
    if (error?.code === 'auth/user-not-found') throw new HttpsError('not-found', 'Không tìm thấy tài khoản học viên.')
    throw error
  }
  const userId = authUser.uid
  const [profileSnapshot, courseSnapshot] = await Promise.all([
    db.doc(`users/${userId}`).get(),
    db.doc(`courses/${courseId}`).get(),
  ])
  const profile = assertActiveStudentAccount(authUser, profileSnapshot)
  if (!courseSnapshot.exists
      || courseSnapshot.data().schemaVersion !== 2
      || courseSnapshot.data().status !== 'published') {
    throw new HttpsError('failed-precondition', 'Chỉ có thể gán khóa học V2 đã xuất bản.')
  }
  const course = courseSnapshot.data()
  if (action === 'assign' && !hasCourseEntitlement(course, profile, false)) {
    throw new HttpsError('failed-precondition', 'Gói thành viên của học viên chưa đủ quyền cho khóa học này.')
  }
  const enrollmentReference = db.doc(`enrollments/${userId}_${courseId}`)
  await db.runTransaction(async (transaction) => {
    const existingSnapshot = await transaction.get(enrollmentReference)
    const existing = existingSnapshot.data() ?? {}
    transaction.set(enrollmentReference, {
      userId,
      courseId,
      status: action === 'assign' ? 'active' : 'cancelled',
      enrolledAt: existing.enrolledAt ?? FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorId,
    }, { merge: true })
  })
  return { userId, courseId, status: action === 'assign' ? 'active' : 'cancelled' }
})

exports.enrollInCourse = onCall(async (request) => {
  const userId = requireCaller(request)
  const courseId = requireDocumentId(request.data?.courseId, 'Mã khóa học')
  const enrollmentId = `${userId}_${courseId}`
  const userReference = db.doc(`users/${userId}`)
  const courseReference = db.doc(`courses/${courseId}`)
  const enrollmentReference = db.doc(`enrollments/${enrollmentId}`)

  const enrollmentStatus = await db.runTransaction(async (transaction) => {
    const [userSnapshot, courseSnapshot, enrollmentSnapshot] = await Promise.all([
      transaction.get(userReference),
      transaction.get(courseReference),
      transaction.get(enrollmentReference),
    ])
    if (!userSnapshot.exists) throw new HttpsError('failed-precondition', 'Hồ sơ người dùng chưa sẵn sàng.')
    if (!courseSnapshot.exists || courseSnapshot.data().status !== 'published') {
      throw new HttpsError('not-found', 'Khóa học chưa được xuất bản hoặc không tồn tại.')
    }

    const profile = userSnapshot.data()
    const course = courseSnapshot.data()
    const isStaff = hasTrustedRole(request, profile, academyStaffRoles)
    const existingEnrollment = enrollmentSnapshot.data()
    if (!isStaff && course.schemaVersion !== 2) {
      throw new HttpsError('failed-precondition', 'Khóa học cần được quản trị viên nâng cấp lên dữ liệu V2.')
    }
    if (profile.disabled === true) throw new HttpsError('permission-denied', 'Tài khoản này đang bị tạm khóa.')
    if (!['members', 'private'].includes(course.settings?.visibility)
        || !['free', 'pro'].includes(course.settings?.accessTier)
        || !['none', 'weekly'].includes(course.settings?.dripSchedule)
        || !Number.isInteger(course.settings?.completionPercent)
        || course.settings.completionPercent < 50
        || course.settings.completionPercent > 100) {
      throw new HttpsError('failed-precondition', 'Thiết lập quyền truy cập của khóa học không hợp lệ.')
    }
    if (existingEnrollment
        && (existingEnrollment.userId !== userId || existingEnrollment.courseId !== courseId)) {
      throw new HttpsError('failed-precondition', 'Dữ liệu ghi danh không nhất quán.')
    }
    if (existingEnrollment && !['active', 'completed', 'cancelled'].includes(existingEnrollment.status)) {
      throw new HttpsError('failed-precondition', 'Dữ liệu ghi danh không hợp lệ.')
    }
    if (course.settings.visibility === 'private'
        && !isStaff
        && (!existingEnrollment || existingEnrollment.status === 'cancelled')) {
      throw new HttpsError('permission-denied', 'Khóa học riêng tư cần được Aura chỉ định cho bạn.')
    }
    if (!hasCourseEntitlement(course, profile, isStaff)) {
      throw new HttpsError('permission-denied', 'Khóa học này yêu cầu gói Aura Pro.')
    }
    if (existingEnrollment?.status === 'active' || existingEnrollment?.status === 'completed') {
      return existingEnrollment.status
    }

    transaction.set(enrollmentReference, {
      userId,
      courseId,
      status: 'active',
      enrolledAt: existingEnrollment?.enrolledAt ?? FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return 'active'
  })

  return { enrollmentId, status: enrollmentStatus }
})

exports.completeCourseLesson = onCall(async (request) => {
  const userId = requireCaller(request)
  const courseId = requireDocumentId(request.data?.courseId, 'Mã khóa học')
  const lessonId = requireDocumentId(request.data?.lessonId, 'Mã bài học')
  const userReference = db.doc(`users/${userId}`)
  const courseReference = db.doc(`courses/${courseId}`)
  const enrollmentReference = db.doc(`enrollments/${userId}_${courseId}`)
  const progressReference = db.doc(`users/${userId}/progress/${courseId}`)

  return db.runTransaction(async (transaction) => {
    const [userSnapshot, courseSnapshot, enrollmentSnapshot, progressSnapshot] = await Promise.all([
      transaction.get(userReference),
      transaction.get(courseReference),
      transaction.get(enrollmentReference),
      transaction.get(progressReference),
    ])
    if (!userSnapshot.exists) throw new HttpsError('failed-precondition', 'Hồ sơ người dùng chưa sẵn sàng.')
    if (!courseSnapshot.exists || courseSnapshot.data().status !== 'published') {
      throw new HttpsError('not-found', 'Khóa học chưa được xuất bản hoặc không tồn tại.')
    }

    const profile = userSnapshot.data()
    const course = courseSnapshot.data()
    const enrollment = enrollmentSnapshot.data()
    const isStaff = hasTrustedRole(request, profile, academyStaffRoles)
    if (!isStaff && course.schemaVersion !== 2) {
      throw new HttpsError('failed-precondition', 'Khóa học cần được quản trị viên nâng cấp lên dữ liệu V2.')
    }
    if (profile.disabled === true) throw new HttpsError('permission-denied', 'Tài khoản này đang bị tạm khóa.')
    if (!['members', 'private'].includes(course.settings?.visibility)
        || !['free', 'pro'].includes(course.settings?.accessTier)
        || !['none', 'weekly'].includes(course.settings?.dripSchedule)
        || !Number.isInteger(course.settings?.completionPercent)
        || course.settings.completionPercent < 50
        || course.settings.completionPercent > 100) {
      throw new HttpsError('failed-precondition', 'Thiết lập quyền truy cập của khóa học không hợp lệ.')
    }
    if (!enrollmentSnapshot.exists || !['active', 'completed'].includes(enrollment.status)) {
      throw new HttpsError('failed-precondition', 'Bạn cần ghi danh trước khi lưu tiến độ.')
    }
    if (enrollment.userId !== userId || enrollment.courseId !== courseId) {
      throw new HttpsError('failed-precondition', 'Dữ liệu ghi danh không nhất quán.')
    }
    if (!hasCourseEntitlement(course, profile, isStaff)) {
      throw new HttpsError('permission-denied', 'Gói thành viên hiện tại không còn quyền truy cập khóa học.')
    }

    const modules = Array.isArray(course.modules) ? course.modules : []
    const lessonIds = modules.length
      ? modules.flatMap((module) => Array.isArray(module?.lessons)
        ? module.lessons.map((lesson) => lesson?.id).filter((id) => typeof id === 'string')
        : [])
      : []
    if (new Set(lessonIds).size !== lessonIds.length) {
      throw new HttpsError('failed-precondition', 'Khóa học có mã bài học bị trùng. Quản trị viên cần sửa nội dung.')
    }
    if (!lessonIds.length || !lessonIds.includes(lessonId)) {
      throw new HttpsError('invalid-argument', 'Bài học không thuộc khóa học này.')
    }
    const selectedModuleIndex = modules.findIndex((module) => Array.isArray(module?.lessons)
      && module.lessons.some((lesson) => lesson?.id === lessonId))
    const selectedLesson = modules[selectedModuleIndex]?.lessons?.find((lesson) => lesson?.id === lessonId)
    if (!isStaff && course.settings.dripSchedule === 'weekly' && selectedModuleIndex > 0) {
      const enrolledAtMillis = typeof enrollment.enrolledAt?.toMillis === 'function'
        ? enrollment.enrolledAt.toMillis()
        : Number.NaN
      if (!Number.isFinite(enrolledAtMillis)) {
        throw new HttpsError('failed-precondition', 'Ngày ghi danh chưa hợp lệ để tính lịch mở bài.')
      }
      const availableAtMillis = enrolledAtMillis + selectedModuleIndex * 7 * 24 * 60 * 60 * 1000
      if (Date.now() < availableAtMillis) {
        throw new HttpsError('failed-precondition', 'Bài học này chưa đến lịch mở theo lộ trình tuần.')
      }
    }

    const completionMode = selectedLesson?.completionPolicy?.mode
      ?? (selectedLesson?.type === 'Quiz'
        ? 'quiz-pass'
        : selectedLesson?.type === 'Buổi tập'
          ? 'workout-complete'
          : 'manual')
    if (!isStaff && completionMode === 'quiz-pass') {
      const quiz = normalizeQuizQuestions(selectedLesson)
      const keyReference = courseReference.collection('quizKeys').doc(lessonId)
      const proofReference = db.doc(`users/${userId}/courseLessonProofs/${courseLessonScopedId(courseId, lessonId)}`)
      const [keySnapshot, proofSnapshot] = await Promise.all([
        transaction.get(keyReference),
        transaction.get(proofReference),
      ])
      const answerKey = keySnapshot.exists
        ? normalizeQuizAnswerKey(keySnapshot.data(), quiz)
        : legacyQuizAnswerKey(quiz)
      const contentHash = buildQuizContentHash(quiz, answerKey)
      const proof = proofSnapshot.data()
      if (!proofSnapshot.exists
          || proof?.kind !== 'quiz-pass'
          || proof?.courseId !== courseId
          || proof?.lessonId !== lessonId
          || proof?.quizId !== quiz.id
          || proof?.contentHash !== contentHash) {
        throw new HttpsError('failed-precondition', 'Bạn cần đạt quiz trước khi hoàn thành bài học.')
      }
    } else if (!isStaff && completionMode === 'workout-complete') {
      const workoutLogId = requireDocumentId(request.data?.workoutLogId, 'Mã nhật ký buổi tập')
      const workoutLogSnapshot = await transaction.get(db.doc(`users/${userId}/workoutLogs/${workoutLogId}`))
      const workoutLog = workoutLogSnapshot.data()
      const workoutRef = selectedLesson?.workoutRef
      if (!workoutLogSnapshot.exists
          || !isPlainObject(workoutRef)
          || workoutLog?.verificationVersion !== 2
          || workoutLog?.verifiedCourseId !== courseId
          || workoutLog?.verifiedLessonId !== lessonId
          || workoutLog?.programId !== workoutRef.programId
          || workoutLog?.sessionId !== workoutRef.sessionId
          || workoutLog?.versionId !== workoutRef.versionId
          || !Array.isArray(workoutLog?.sets)
          || workoutLog.sets.length < 1) {
        throw new HttpsError('failed-precondition', 'Bạn cần lưu kết quả buổi tập đã xác minh trước khi hoàn thành bài học.')
      }
    }

    const existingProgress = progressSnapshot.data() ?? {}
    const rawCompletedIds = existingProgress.completedLessonIds ?? []
    if (!Array.isArray(rawCompletedIds) || rawCompletedIds.some((id) => typeof id !== 'string')) {
      throw new HttpsError('failed-precondition', 'Dữ liệu tiến độ hiện tại không hợp lệ.')
    }
    const currentCompletedIds = rawCompletedIds.filter((id) => lessonIds.includes(id))
    const progressWasReconciled = currentCompletedIds.length !== rawCompletedIds.length
    const completedLessonIds = [...new Set([...currentCompletedIds, lessonId])]
    const percent = Math.min(100, Math.round((completedLessonIds.length / lessonIds.length) * 100))
    const completionThreshold = course.settings.completionPercent
    const courseCompleted = completedLessonIds.length * 100 >= completionThreshold * lessonIds.length
    const progressWrite = {
      courseId,
      completedLessonIds,
      percent,
      completionThreshold,
      lastLessonId: lessonId,
      updatedAt: FieldValue.serverTimestamp(),
    }
    if (courseCompleted) {
      progressWrite.completedAt = existingProgress.completedAt ?? FieldValue.serverTimestamp()
    } else if (existingProgress.completedAt) {
      progressWrite.completedAt = FieldValue.delete()
    }
    if (progressWasReconciled) progressWrite.reconciledAt = FieldValue.serverTimestamp()

    transaction.set(progressReference, progressWrite, { merge: true })
    if (courseCompleted && enrollment.status !== 'completed') {
      transaction.update(enrollmentReference, {
        status: 'completed',
        updatedAt: FieldValue.serverTimestamp(),
      })
    } else if (!courseCompleted && enrollment.status === 'completed') {
      transaction.update(enrollmentReference, {
        status: 'active',
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    return { userId, courseId, completedLessonIds, percent, lastLessonId: lessonId }
  })
})

/**
 * Grades a course quiz without accepting or returning an answer key.
 *
 * Preferred V2 answer-key document:
 * courses/{courseId}/quizKeys/{lessonId}
 * {
 *   quizId: string,
 *   answers: { [questionId]: optionIndex },
 *   contentHash?: sha256(question ids + options)
 * }
 *
 * During the V1 -> V2 migration only, the callable falls back to the current
 * nested lesson.quiz.questions[].correctIndex values when no key document
 * exists. Once a key document exists, malformed key data fails closed.
 */
exports.gradeCourseQuiz = onCall(async (request) => {
  const userId = requireCaller(request)
  const courseId = requireDocumentId(request.data?.courseId, 'Mã khóa học')
  const lessonId = requireDocumentId(request.data?.lessonId, 'Mã bài học')
  const access = await requireCourseLessonAccess({
    request,
    userId,
    courseId,
    lessonId,
    allowPreview: false,
  })
  const quiz = normalizeQuizQuestions(access.lesson)
  const answers = normalizeSubmittedAnswers(request.data?.answers, quiz.questions)
  const keySnapshot = await access.courseReference.collection('quizKeys').doc(lessonId).get()
  const answerKey = keySnapshot.exists
    ? normalizeQuizAnswerKey(keySnapshot.data(), quiz)
    : legacyQuizAnswerKey(quiz)
  const contentHash = buildQuizContentHash(quiz, answerKey)

  const correctAnswers = answers.reduce(
    (total, answer) => total + (answerKey[answer.questionId] === answer.optionIndex ? 1 : 0),
    0,
  )
  const totalQuestions = quiz.questions.length
  const scorePercent = Math.round((correctAnswers / totalQuestions) * 100)
  const passed = scorePercent >= quiz.passPercent
  const attemptReference = db.collection(`users/${userId}/quizAttempts`).doc()
  const scopedLessonId = courseLessonScopedId(courseId, lessonId)
  const counterReference = db.doc(`users/${userId}/quizAttemptCounters/${scopedLessonId}`)
  const proofReference = db.doc(`users/${userId}/courseLessonProofs/${scopedLessonId}`)
  const attemptData = {
    courseId,
    lessonId,
    quizId: quiz.id,
    answers,
    correctAnswers,
    totalQuestions,
    scorePercent,
    passPercent: quiz.passPercent,
    passed,
    feedbackCode: passed ? 'passed' : 'retry',
    contentHash,
    gradingVersion: 2,
    createdAt: FieldValue.serverTimestamp(),
  }
  let attemptsRemaining = null

  await db.runTransaction(async (transaction) => {
    if (!access.isStaff && quiz.maxAttempts) {
      const counterSnapshot = await transaction.get(counterReference)
      const counter = counterSnapshot.data() ?? {}
      const sameQuizVersion = counter.quizId === quiz.id && counter.contentHash === contentHash
      const previousCount = sameQuizVersion ? counter.count : 0
      if (!Number.isInteger(previousCount) || previousCount < 0) {
        throw new HttpsError('failed-precondition', 'Bộ đếm lượt làm quiz không hợp lệ.')
      }
      if (previousCount >= quiz.maxAttempts) {
        throw new HttpsError('resource-exhausted', 'Bạn đã sử dụng hết số lượt làm quiz.')
      }
      const nextCount = previousCount + 1
      attemptsRemaining = quiz.maxAttempts - nextCount
      transaction.set(counterReference, {
        courseId,
        lessonId,
        quizId: quiz.id,
        contentHash,
        count: nextCount,
        lastAttemptId: attemptReference.id,
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    transaction.set(attemptReference, attemptData)
    if (passed && !access.isStaff) {
      transaction.set(proofReference, {
        courseId,
        lessonId,
        kind: 'quiz-pass',
        quizId: quiz.id,
        contentHash,
        attemptId: attemptReference.id,
        verifiedAt: FieldValue.serverTimestamp(),
      })
    }
  })

  return {
    attemptId: attemptReference.id,
    courseId,
    lessonId,
    quizId: quiz.id,
    scorePercent,
    correctAnswers,
    totalQuestions,
    passed,
    attemptsRemaining,
    feedback: passed
      ? 'Bạn đã đạt yêu cầu của bài kiểm tra.'
      : 'Bạn chưa đạt điểm yêu cầu. Hãy xem lại bài học và thử lại.',
  }
})

/**
 * Returns a short-lived V4 signed URL after checking lesson-level access.
 * Learners never receive broad Storage read permission; every file must be
 * bound to the same course and lesson in both its path and custom metadata.
 */
exports.getCourseMediaUrl = onCall(async (request) => {
  const userId = requireCaller(request)
  const courseId = requireDocumentId(request.data?.courseId, 'Mã khóa học')
  const lessonId = requireDocumentId(request.data?.lessonId, 'Mã bài học')
  const path = requireCourseMediaPath(request.data?.path, courseId, lessonId)
  const access = await requireCourseLessonAccess({
    request,
    userId,
    courseId,
    lessonId,
    allowPreview: true,
  })
  const lessonResource = findLessonMediaReference(access.lesson, path)
  if (!access.isStaff && !lessonResource) {
    throw new HttpsError('permission-denied', 'Media chưa được gắn với bài học này.')
  }

  const file = storage.bucket().file(path)
  let fileMetadata
  try {
    ;[fileMetadata] = await file.getMetadata()
  } catch (error) {
    if (error?.code === 404 || error?.code === '404') {
      throw new HttpsError('not-found', 'Tệp media không tồn tại.')
    }
    console.error('Unable to read course media metadata', { courseId, lessonId, path, error })
    throw new HttpsError('internal', 'Không thể xác minh tệp media lúc này.')
  }

  const customMetadata = isPlainObject(fileMetadata.metadata) ? fileMetadata.metadata : {}
  const mediaId = typeof customMetadata.assetId === 'string'
    ? customMetadata.assetId
    : customMetadata.mediaId
  const size = Number(fileMetadata.size)
  if (customMetadata.courseId !== courseId
      || customMetadata.lessonId !== lessonId
      || typeof mediaId !== 'string'
      || !mediaId.trim()
      || !['slide', 'video', 'document'].includes(customMetadata.resourceKind)
      || (!access.isStaff && mediaId !== lessonResource.assetRef.assetId)
      || (!access.isStaff && customMetadata.resourceKind !== lessonResource.kind)
      || !isSupportedCourseMediaType(fileMetadata.contentType, customMetadata.resourceKind)
      || !Number.isSafeInteger(size)
      || size <= 0
      || size > (customMetadata.resourceKind === 'video' ? 500 : 50) * 1024 * 1024) {
    throw new HttpsError('failed-precondition', 'Metadata của tệp media không hợp lệ.')
  }

  const expiresAt = Date.now() + mediaUrlTtlMs
  const safeFileName = (path.split('/').pop() || `aura-${customMetadata.resourceKind}`)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180) || `aura-${customMetadata.resourceKind}`
  const signedUrlOptions = {
    version: 'v4',
    action: 'read',
    expires: expiresAt,
    responseType: fileMetadata.contentType,
    responseDisposition: 'inline',
  }
  let url
  let downloadUrl
  try {
    ;[url] = await file.getSignedUrl(signedUrlOptions)
  } catch (error) {
    console.error('Unable to sign course media URL', { courseId, lessonId, path, error })
    throw new HttpsError('internal', 'Không thể tạo liên kết media lúc này.')
  }
  if (customMetadata.resourceKind === 'document') {
    try {
      ;[downloadUrl] = await file.getSignedUrl({
        ...signedUrlOptions,
        responseDisposition: undefined,
        promptSaveAs: safeFileName,
      })
    } catch (error) {
      // Opening the document remains available even if the optional
      // attachment URL cannot be generated during a transient Storage error.
      console.warn('Unable to sign course media download URL', { courseId, lessonId, path, error })
    }
  }

  return {
    url,
    path,
    expiresAt: new Date(expiresAt).toISOString(),
    contentType: fileMetadata.contentType,
    size,
    ...(downloadUrl ? { downloadUrl, fileName: safeFileName } : {}),
  }
})

function findProgramSession(versionData, sessionId) {
  const matches = []
  const weeks = isPlainObject(versionData?.weeksByWeek) ? versionData.weeksByWeek : {}
  Object.entries(weeks).forEach(([weekKey, week]) => {
    const sessions = isPlainObject(week?.sessionsByDay) ? week.sessionsByDay : {}
    Object.values(sessions).forEach((session) => {
      if (session?.id === sessionId) matches.push({ weekNumber: Number(weekKey), session })
    })
  })
  if (!Object.keys(weeks).length) {
    const sessions = isPlainObject(versionData?.sessionsByDay) ? versionData.sessionsByDay : {}
    Object.values(sessions).forEach((session) => {
      if (session?.id === sessionId) matches.push({ weekNumber: 1, session })
    })
  }
  if (matches.length !== 1) {
    throw new HttpsError(
      matches.length ? 'failed-precondition' : 'not-found',
      matches.length ? 'Session bị trùng trong phiên bản giáo án.' : 'Không tìm thấy session trong phiên bản giáo án.',
    )
  }
  return matches[0]
}

function orderedProgramSessions(versionData) {
  const ordered = []
  const weeks = isPlainObject(versionData?.weeksByWeek) ? versionData.weeksByWeek : {}
  const orderedWeeks = Object.entries(weeks).sort(([left], [right]) => Number(left) - Number(right))
  for (const [weekKey, week] of orderedWeeks) {
    const sessions = isPlainObject(week?.sessionsByDay) ? week.sessionsByDay : {}
    Object.entries(sessions)
      .sort(([left], [right]) => Number(left) - Number(right))
      .forEach(([dayKey, session]) => {
        if (typeof session?.id === 'string' && session.id.trim()) {
          ordered.push({ weekNumber: Number(weekKey), dayNumber: Number(dayKey), session })
        }
      })
  }
  if (!ordered.length) {
    const sessions = isPlainObject(versionData?.sessionsByDay) ? versionData.sessionsByDay : {}
    Object.entries(sessions)
      .sort(([left], [right]) => Number(left) - Number(right))
      .forEach(([dayKey, session]) => {
        if (typeof session?.id === 'string' && session.id.trim()) {
          ordered.push({ weekNumber: 1, dayNumber: Number(dayKey), session })
        }
      })
  }
  if (!ordered.length) throw new HttpsError('failed-precondition', 'Giáo án PT chưa có buổi tập hợp lệ.')
  const ids = ordered.map((item) => item.session.id.trim())
  if (new Set(ids).size !== ids.length) throw new HttpsError('failed-precondition', 'Giáo án PT có mã buổi tập bị trùng.')
  return ordered
}

function workoutSessionForLearner(session) {
  if (!isPlainObject(session)) throw new HttpsError('failed-precondition', 'Dữ liệu session không hợp lệ.')
  const safeSession = { ...session }
  if (isPlainObject(safeSession.quiz) && Array.isArray(safeSession.quiz.questions)) {
    safeSession.quiz = {
      ...safeSession.quiz,
      questions: safeSession.quiz.questions.map((question) => {
        if (!isPlainObject(question)) return question
        const { correctIndex: _answerKey, ...publicQuestion } = question
        return publicQuestion
      }),
    }
  }
  return safeSession
}

async function loadPublishedProgramSession({ programId, versionId, sessionId }) {
  const programReference = db.doc(`programs/${programId}`)
  const versionReference = programReference.collection('versions').doc(versionId)
  const [programSnapshot, versionSnapshot] = await Promise.all([
    programReference.get(),
    versionReference.get(),
  ])
  if (!programSnapshot.exists || programSnapshot.data().status !== 'published') {
    throw new HttpsError('failed-precondition', 'Giáo án chưa được xuất bản.')
  }
  if (!versionSnapshot.exists) throw new HttpsError('not-found', 'Phiên bản giáo án không tồn tại.')
  const versionData = versionSnapshot.data()
  if (versionData.programId !== programId || versionData.versionId !== versionId || versionData.schemaVersion !== 2) {
    throw new HttpsError('failed-precondition', 'Metadata phiên bản giáo án không hợp lệ.')
  }
  return { versionData, selected: findProgramSession(versionData, sessionId) }
}

function normalizeCourseWorkoutLog(value, workoutRef, session) {
  if (!isPlainObject(value)) throw new HttpsError('invalid-argument', 'Nhật ký buổi tập không hợp lệ.')
  const clientLogId = requireDocumentId(value.clientLogId, 'Mã nhật ký')
  if (value.programId !== workoutRef.programId
      || value.sessionId !== workoutRef.sessionId
      || value.versionId !== workoutRef.versionId) {
    throw new HttpsError('invalid-argument', 'Định danh nhật ký không khớp với giáo án.')
  }
  if (!Number.isInteger(value.durationSeconds) || value.durationSeconds < 0 || value.durationSeconds > 24 * 60 * 60) {
    throw new HttpsError('invalid-argument', 'Thời lượng buổi tập không hợp lệ.')
  }
  if (!Number.isInteger(value.perceivedExertion) || value.perceivedExertion < 1 || value.perceivedExertion > 4) {
    throw new HttpsError('invalid-argument', 'Mức cảm nhận buổi tập không hợp lệ.')
  }
  const exercises = Array.isArray(session?.exercises) ? session.exercises : []
  if (!exercises.length || exercises.length > 200) {
    throw new HttpsError('failed-precondition', 'Session chưa có danh sách bài tập hợp lệ.')
  }
  const expectedExercises = new Map()
  let expectedSetCount = 0
  exercises.forEach((exercise) => {
    if (typeof exercise?.id !== 'string'
        || typeof exercise?.name !== 'string'
        || !Number.isInteger(exercise?.sets)
        || exercise.sets < 1
        || exercise.sets > 100
        || expectedExercises.has(exercise.id)) {
      throw new HttpsError('failed-precondition', 'Session có cấu hình bài tập không hợp lệ.')
    }
    expectedExercises.set(exercise.id, exercise)
    expectedSetCount += exercise.sets
  })
  if (!Array.isArray(value.sets) || value.sets.length !== expectedSetCount || value.sets.length > 1000) {
    throw new HttpsError('invalid-argument', 'Bạn cần hoàn thành đủ số hiệp của session.')
  }
  const seenSets = new Set()
  const sets = value.sets.map((set) => {
    if (!isPlainObject(set)) throw new HttpsError('invalid-argument', 'Dữ liệu hiệp tập không hợp lệ.')
    const exercise = expectedExercises.get(set.exerciseId)
    const setNumber = set.setNumber
    if (!exercise
        || !Number.isInteger(setNumber)
        || setNumber < 1
        || setNumber > exercise.sets
        || typeof set.weightKg !== 'number'
        || !Number.isFinite(set.weightKg)
        || set.weightKg < 0
        || set.weightKg > 2000
        || !Number.isInteger(set.reps)
        || set.reps < 1
        || set.reps > 1000) {
      throw new HttpsError('invalid-argument', 'Một hiệp tập có thông số không hợp lệ.')
    }
    const setKey = `${exercise.id}:${setNumber}`
    if (seenSets.has(setKey)) throw new HttpsError('invalid-argument', 'Nhật ký có hiệp tập bị trùng.')
    seenSets.add(setKey)
    return {
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      setNumber,
      weightKg: set.weightKg,
      reps: set.reps,
    }
  })
  const totalLoadKg = sets.reduce((total, set) => total + set.weightKg * set.reps, 0)
  return {
    clientLogId,
    programId: workoutRef.programId,
    sessionId: workoutRef.sessionId,
    versionId: workoutRef.versionId,
    title: typeof session.dayLabel === 'string' && session.dayLabel.trim() ? session.dayLabel.trim() : 'Buổi tập Aura',
    durationSeconds: value.durationSeconds,
    completedSets: sets.length,
    totalLoadKg,
    perceivedExertion: value.perceivedExertion,
    sets,
  }
}

function normalizePtWorkoutLog(value, workoutRef, session) {
  const log = normalizeCourseWorkoutLog(value, workoutRef, session)
  if (!Number.isInteger(value.readiness) || value.readiness < 1 || value.readiness > 5) {
    throw new HttpsError('invalid-argument', 'Mức sẵn sàng phải từ 1 đến 5.')
  }
  if (!Number.isInteger(value.sleepQuality) || value.sleepQuality < 1 || value.sleepQuality > 5) {
    throw new HttpsError('invalid-argument', 'Chất lượng giấc ngủ phải từ 1 đến 5.')
  }
  if (value.painNote !== undefined && (typeof value.painNote !== 'string' || value.painNote.length > 1000)) {
    throw new HttpsError('invalid-argument', 'Ghi chú đau hoặc khó chịu không hợp lệ.')
  }
  return {
    ...log,
    readiness: value.readiness,
    sleepQuality: value.sleepQuality,
    painNote: typeof value.painNote === 'string' ? value.painNote.trim() : '',
  }
}

/** Saves a verified course workout log that can be used as completion proof. */
exports.saveCourseWorkoutLog = onCall(async (request) => {
  const userId = requireCaller(request)
  const courseId = requireDocumentId(request.data?.courseId, 'Mã khóa học')
  const lessonId = requireDocumentId(request.data?.lessonId, 'Mã bài học')
  const access = await requireCourseLessonAccess({ request, userId, courseId, lessonId, allowPreview: false })
  const workoutRef = access.lesson?.workoutRef
  if (access.lesson?.type !== 'Buổi tập' || !isPlainObject(workoutRef)) {
    throw new HttpsError('failed-precondition', 'Bài học chưa liên kết giáo án hợp lệ.')
  }
  const programId = requireDocumentId(workoutRef.programId, 'Mã giáo án')
  const sessionId = requireDocumentId(workoutRef.sessionId, 'Mã session')
  const versionId = requireDocumentId(workoutRef.versionId, 'Mã phiên bản')
  const { selected } = await loadPublishedProgramSession({ programId, versionId, sessionId })
  const log = normalizeCourseWorkoutLog(request.data?.log, workoutRef, selected.session)
  const logReference = db.doc(`users/${userId}/workoutLogs/${log.clientLogId}`)

  await db.runTransaction(async (transaction) => {
    const existingSnapshot = await transaction.get(logReference)
    if (existingSnapshot.exists) {
      const existing = existingSnapshot.data()
      if (existing.verificationVersion === 2
          && existing.verifiedCourseId === courseId
          && existing.verifiedLessonId === lessonId
          && existing.programId === programId
          && existing.sessionId === sessionId
          && existing.versionId === versionId) return
      throw new HttpsError('already-exists', 'Mã nhật ký đã được dùng cho một buổi tập khác.')
    }
    transaction.create(logReference, {
      ...log,
      verifiedCourseId: courseId,
      verifiedLessonId: lessonId,
      verificationVersion: 2,
      completedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    })
  })
  return { userId, logId: log.clientLogId }
})

/** Resolves the exact immutable workout session after course entitlement checks. */
exports.getCourseWorkoutSession = onCall(async (request) => {
  const userId = requireCaller(request)
  const courseId = requireDocumentId(request.data?.courseId, 'Mã khóa học')
  const lessonId = requireDocumentId(request.data?.lessonId, 'Mã bài học')
  const programId = requireDocumentId(request.data?.programId, 'Mã giáo án')
  const sessionId = requireDocumentId(request.data?.sessionId, 'Mã session')
  const versionId = requireDocumentId(request.data?.versionId, 'Mã phiên bản')
  const access = await requireCourseLessonAccess({
    request,
    userId,
    courseId,
    lessonId,
    allowPreview: false,
  })
  const workoutRef = access.lesson?.workoutRef
  if (access.lesson?.type !== 'Buổi tập'
      || !isPlainObject(workoutRef)
      || workoutRef.programId !== programId
      || workoutRef.sessionId !== sessionId
      || workoutRef.versionId !== versionId) {
    throw new HttpsError('permission-denied', 'Liên kết giáo án không khớp với bài học.')
  }

  const { versionData, selected } = await loadPublishedProgramSession({ programId, versionId, sessionId })
  return {
    programId,
    versionId,
    sessionId,
    weekNumber: selected.weekNumber,
    programTitle: typeof versionData.title === 'string' ? versionData.title : 'Giáo án Aura',
    session: workoutSessionForLearner(selected.session),
  }
})

async function requirePtStaffActor(request) {
  const actorId = requireCaller(request)
  const actorSnapshot = await db.doc(`users/${actorId}`).get()
  const actor = actorSnapshot.data()
  if (!actorSnapshot.exists
      || actor?.disabled === true
      || !hasTrustedRole(request, actor, coachingStaffRoles)) {
    throw new HttpsError('permission-denied', 'Bạn không có quyền quản lý PT Coaching.')
  }
  return {
    actorId,
    actor,
    isAdmin: privilegedAdminRoles.has(actor.role),
  }
}

function ptBoundedString(value, label, maximum, { required = false } = {}) {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  const normalized = value.trim()
  if ((required && !normalized) || normalized.length > maximum) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return normalized
}

function ptNullableNumber(value, label, minimum, maximum, integer = false) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'number'
      || !Number.isFinite(value)
      || value < minimum
      || value > maximum
      || (integer && !Number.isInteger(value))) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return value
}

function ptDateString(value) {
  const normalized = ptBoundedString(value ?? '', 'Ngày check-in kế tiếp', 10)
  if (!normalized) return ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new HttpsError('invalid-argument', 'Ngày check-in kế tiếp không hợp lệ.')
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new HttpsError('invalid-argument', 'Ngày check-in kế tiếp không hợp lệ.')
  }
  return normalized
}

function normalizePtClientProfileInput(value) {
  if (!isPlainObject(value)) {
    throw new HttpsError('invalid-argument', 'Hồ sơ coaching không hợp lệ.')
  }
  const clientId = requireDocumentId(value.clientId, 'Mã khách hàng')
  const coachId = typeof value.coachId === 'string' && value.coachId.trim()
    ? requireDocumentId(value.coachId, 'Mã PT')
    : ''
  const coachingStatus = value.coachingStatus
  if (!['active', 'onboarding', 'paused', 'completed'].includes(coachingStatus)) {
    throw new HttpsError('invalid-argument', 'Trạng thái coaching không hợp lệ.')
  }
  const currentProgramId = typeof value.currentProgramId === 'string' && value.currentProgramId.trim()
    ? requireDocumentId(value.currentProgramId, 'Mã giáo án PT')
    : ''
  const currentVersionId = typeof value.currentVersionId === 'string' && value.currentVersionId.trim()
    ? requireDocumentId(value.currentVersionId, 'Mã phiên bản PT')
    : ''
  if (Boolean(currentProgramId) !== Boolean(currentVersionId)) {
    throw new HttpsError('invalid-argument', 'Giáo án và phiên bản PT phải được chọn cùng nhau.')
  }
  if (['active', 'paused'].includes(coachingStatus) && (!currentProgramId || !currentVersionId)) {
    throw new HttpsError('failed-precondition', 'Khách hàng active/paused cần một phiên bản giáo án PT.')
  }
  return {
    clientId,
    coachId,
    goal: ptBoundedString(value.goal ?? '', 'Mục tiêu coaching', 300),
    coachingStatus,
    currentProgramName: ptBoundedString(value.currentProgramName ?? '', 'Tên giáo án PT', 200),
    currentProgramId,
    currentVersionId,
    readiness: ptNullableNumber(value.readiness, 'Readiness', 1, 5, true),
    sleepHours: ptNullableNumber(value.sleepHours, 'Số giờ ngủ', 0, 24),
    soreness: ptNullableNumber(value.soreness, 'Mức đau mỏi', 1, 5, true),
    bodyWeightKg: ptNullableNumber(value.bodyWeightKg, 'Cân nặng', 20, 500),
    nextCheckInDate: ptDateString(value.nextCheckInDate),
    coachNotes: ptBoundedString(value.coachNotes ?? '', 'Ghi chú PT', 4000),
  }
}

function isAllowedPtStatusTransition(previousStatus, nextStatus) {
  const transitions = {
    onboarding: new Set(['onboarding', 'active', 'paused']),
    active: new Set(['active', 'paused', 'completed']),
    paused: new Set(['active', 'paused', 'completed']),
    completed: new Set(['completed', 'onboarding']),
  }
  return transitions[previousStatus]?.has(nextStatus) === true
}

function ptAssignmentId(clientId, programId) {
  const id = `pt_${clientId}_${programId}`
  if (id.length > 1500) throw new HttpsError('invalid-argument', 'Mã phân công PT quá dài.')
  return id
}

function ptLegacyAssignmentCycleId(clientId, programId, versionId) {
  const digest = createHash('sha256')
    .update(`${clientId}\u0000${programId}\u0000${versionId}`)
    .digest('hex')
    .slice(0, 40)
  return `legacy_${digest}`
}

function optionalPtDocumentId(value, label) {
  if (value === undefined || value === null || value === '') return ''
  return requireDocumentId(value, label)
}

function assertPtAssignmentCycleIdentity(snapshot, { cycleId, clientId, coachId, programId, versionId }) {
  if (!snapshot?.exists) return null
  const cycle = snapshot.data()
  if (cycle.schemaVersion !== 2
      || cycle.domain !== 'pt-coaching'
      || cycle.cycleId !== cycleId
      || cycle.clientId !== clientId
      || cycle.coachId !== coachId
      || cycle.programId !== programId
      || cycle.versionId !== versionId
      || !['active', 'paused', 'completed', 'replaced', 'cancelled'].includes(cycle.status)) {
    throw new HttpsError('failed-precondition', 'Chu kỳ phân công PT không nhất quán với hồ sơ coaching.')
  }
  return cycle
}

function ptCycleTimestampOr(value, fallback) {
  return value && typeof value.toDate === 'function' ? value : fallback
}

function createPtAssignmentCycleWrite({
  cycleId,
  clientId,
  coachId,
  programId,
  versionId,
  programTitle,
  status,
  actorId,
  source = 'native',
  legacyAssignmentId = '',
  historyCompleteness = 'complete',
  startedAt = FieldValue.serverTimestamp(),
  progressStartedAt = FieldValue.serverTimestamp(),
}) {
  return {
    schemaVersion: 2,
    domain: 'pt-coaching',
    cycleId,
    clientId,
    coachId,
    programId,
    versionId,
    programTitleSnapshot: programTitle,
    status,
    endReason: '',
    startedAt,
    progressStartedAt,
    endedAt: null,
    source,
    legacyAssignmentId,
    historyCompleteness,
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
}

async function loadPtAssignmentCycleForRelationship(clientId, relationship) {
  const coachId = requireDocumentId(relationship.coachId, 'Mã PT')
  const programId = requireDocumentId(relationship.currentProgramId, 'Mã giáo án PT')
  const versionId = requireDocumentId(relationship.currentVersionId, 'Mã phiên bản PT')
  const pointer = optionalPtDocumentId(relationship.activeAssignmentCycleId, 'Mã chu kỳ PT hiện tại')
  const cycleId = pointer || ptLegacyAssignmentCycleId(clientId, programId, versionId)
  const cycleReference = db.doc(`programAssignmentCycles/${cycleId}`)
  const legacyAssignmentId = ptAssignmentId(clientId, programId)
  const legacyReference = db.doc(`programAssignments/${legacyAssignmentId}`)
  const [cycleSnapshot, legacySnapshot] = await Promise.all([
    cycleReference.get(),
    legacyReference.get(),
  ])
  const persistedCycle = assertPtAssignmentCycleIdentity(cycleSnapshot, {
    cycleId,
    clientId,
    coachId,
    programId,
    versionId,
  })
  if (pointer && !persistedCycle) {
    throw new HttpsError('failed-precondition', 'Chu kỳ PT hiện tại không tồn tại.')
  }
  if (persistedCycle) {
    if (persistedCycle.status !== relationship.coachingStatus
        || !['active', 'paused'].includes(persistedCycle.status)) {
      throw new HttpsError('failed-precondition', 'Trạng thái chu kỳ PT không khớp hồ sơ coaching.')
    }
    return { cycleId, cycle: persistedCycle, cycleReference, persisted: true }
  }

  assertPtAssignmentIdentity(legacySnapshot, { clientId, coachId, programId })
  const legacy = legacySnapshot.data() ?? {}
  const legacyStartedAt = ptCycleTimestampOr(legacy.startDate, relationship.createdAt ?? null)
  return {
    cycleId,
    cycleReference,
    persisted: false,
    cycle: {
      schemaVersion: 2,
      domain: 'pt-coaching',
      cycleId,
      clientId,
      coachId,
      programId,
      versionId,
      programTitleSnapshot: typeof relationship.currentProgramName === 'string'
        ? relationship.currentProgramName
        : '',
      status: relationship.coachingStatus,
      source: 'legacy-backfill',
      legacyAssignmentId,
      historyCompleteness: 'legacy-collapsed',
      startedAt: legacyStartedAt,
      progressStartedAt: legacyStartedAt,
    },
  }
}

function ptTimestampMillis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  if (value instanceof Date) return value.getTime()
  return null
}

async function loadPtCycleWorkoutLogs(userId, assignment) {
  const logCollection = db.collection(`users/${userId}/coachingWorkoutLogs`)
  const queries = [logCollection.where('assignmentCycleId', '==', assignment.cycleId).get()]
  const legacyAssignmentId = typeof assignment.cycle.legacyAssignmentId === 'string'
    ? assignment.cycle.legacyAssignmentId
    : ''
  if (legacyAssignmentId) queries.push(logCollection.where('assignmentId', '==', legacyAssignmentId).get())
  const snapshots = await Promise.all(queries)
  return [...new Map(snapshots.flatMap((snapshot) => snapshot.docs).map((item) => [item.id, item])).values()]
}

function ptWorkoutLogBelongsToCycle(log, assignment) {
  const cutoff = ptTimestampMillis(assignment.cycle.progressStartedAt)
  const completedAt = ptTimestampMillis(log.completedAt)
  if (cutoff !== null && completedAt !== null && completedAt < cutoff) return false
  if (log.verificationVersion === 2) {
    return log.assignmentCycleId === assignment.cycleId
      && log.clientId === assignment.cycle.clientId
      && log.programId === assignment.cycle.programId
      && log.versionId === assignment.cycle.versionId
  }
  return log.verificationVersion === 1
    && assignment.cycle.legacyAssignmentId
    && log.assignmentId === assignment.cycle.legacyAssignmentId
    && log.programId === assignment.cycle.programId
    && log.versionId === assignment.cycle.versionId
}

function timestampIso(value) {
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  return null
}

function serializedPtProfile(data, fallbackTimestamp = new Date().toISOString()) {
  const coachingStatus = ['active', 'onboarding', 'paused', 'completed'].includes(data.coachingStatus)
    ? data.coachingStatus
    : 'onboarding'
  return {
    clientId: typeof data.clientId === 'string' ? data.clientId : '',
    coachId: typeof data.coachId === 'string' ? data.coachId : '',
    goal: typeof data.goal === 'string' ? data.goal : '',
    coachingStatus,
    currentProgramName: typeof data.currentProgramName === 'string' ? data.currentProgramName : '',
    currentProgramId: typeof data.currentProgramId === 'string' ? data.currentProgramId : '',
    currentVersionId: typeof data.currentVersionId === 'string' ? data.currentVersionId : '',
    activeAssignmentCycleId: typeof data.activeAssignmentCycleId === 'string'
      ? data.activeAssignmentCycleId
      : '',
    lastAssignmentCycleId: typeof data.lastAssignmentCycleId === 'string'
      ? data.lastAssignmentCycleId
      : '',
    readiness: typeof data.readiness === 'number' && Number.isFinite(data.readiness) ? data.readiness : null,
    sleepHours: typeof data.sleepHours === 'number' && Number.isFinite(data.sleepHours) ? data.sleepHours : null,
    soreness: typeof data.soreness === 'number' && Number.isFinite(data.soreness) ? data.soreness : null,
    bodyWeightKg: typeof data.bodyWeightKg === 'number' && Number.isFinite(data.bodyWeightKg)
      ? data.bodyWeightKg
      : null,
    lastCheckInAt: timestampIso(data.lastCheckInAt) ?? fallbackTimestamp,
    nextCheckInDate: typeof data.nextCheckInDate === 'string' ? data.nextCheckInDate : '',
    coachNotes: typeof data.coachNotes === 'string' ? data.coachNotes : '',
  }
}

function assertActiveStudentAccount(authUser, profileSnapshot) {
  const profile = profileSnapshot.data()
  if (!profileSnapshot.exists
      || authUser.disabled === true
      || profile?.disabled === true
      || profile?.status === 'disabled'
      || profile?.role !== 'student'
      || (authUser.customClaims?.role ?? 'student') !== 'student'
      || (typeof profile.uid === 'string' && profile.uid !== authUser.uid)) {
    throw new HttpsError('failed-precondition', 'Tài khoản đích phải là học viên đang hoạt động.')
  }
  return profile
}

function assertPublishedPtProgram(program, version, { programId, versionId, coachId }) {
  if (!program
      || !version
      || program.domain !== 'pt-coaching'
      || program.schemaVersion !== 2
      || program.status !== 'published'
      || program.coachId !== coachId
      || typeof program.title !== 'string'
      || !program.title.trim()
      || typeof program.currentVersionId !== 'string'
      || !program.currentVersionId.trim()
      || version.domain !== 'pt-coaching'
      || version.schemaVersion !== 2
      || version.status !== 'published'
      || version.programId !== programId
      || version.versionId !== versionId
      || version.coachId !== coachId) {
    throw new HttpsError('failed-precondition', 'Giáo án PT hoặc phiên bản chưa xuất bản và nhất quán.')
  }
}

function assertPtAssignmentIdentity(snapshot, { clientId, coachId, programId }) {
  if (!snapshot?.exists) return
  const assignment = snapshot.data()
  if (assignment.clientId !== clientId
      || assignment.coachId !== coachId
      || assignment.programId !== programId) {
    throw new HttpsError('failed-precondition', 'Phân công PT hiện tại không nhất quán với hồ sơ coaching.')
  }
}

/** Creates the first coach-client relationship without exposing Auth directory search. */
exports.onboardPtClientByEmail = onCall(async (request) => {
  const { actorId } = await requirePtStaffActor(request)
  const email = ptBoundedString(request.data?.email ?? '', 'Email học viên', 320, { required: true }).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'Email học viên không hợp lệ.')
  }

  let authUser
  try {
    authUser = await auth.getUserByEmail(email)
  } catch (error) {
    if (error?.code === 'auth/user-not-found') {
      throw new HttpsError('not-found', 'Không tìm thấy tài khoản học viên với email này.')
    }
    throw error
  }

  const clientId = authUser.uid
  const userReference = db.doc(`users/${clientId}`)
  const relationshipReference = db.doc(`coachClients/${clientId}`)
  const responseTimestamp = new Date().toISOString()
  const result = await db.runTransaction(async (transaction) => {
    const [userSnapshot, relationshipSnapshot] = await Promise.all([
      transaction.get(userReference),
      transaction.get(relationshipReference),
    ])
    const user = assertActiveStudentAccount(authUser, userSnapshot)

    if (relationshipSnapshot.exists) {
      const relationship = relationshipSnapshot.data()
      if (relationship.clientId !== clientId || typeof relationship.coachId !== 'string') {
        throw new HttpsError('failed-precondition', 'Quan hệ coaching hiện tại không hợp lệ.')
      }
      if (relationship.coachId !== actorId) {
        throw new HttpsError('already-exists', 'Học viên đã thuộc quyền quản lý của một PT khác.')
      }
      return {
        created: false,
        profile: serializedPtProfile(relationship, responseTimestamp),
        user,
      }
    }

    const relationship = {
      clientId,
      coachId: actorId,
      goal: '',
      coachingStatus: 'onboarding',
      currentProgramName: '',
      currentProgramId: '',
      currentVersionId: '',
      activeAssignmentCycleId: '',
      lastAssignmentCycleId: '',
      readiness: null,
      sleepHours: null,
      soreness: null,
      bodyWeightKg: null,
      lastCheckInAt: FieldValue.serverTimestamp(),
      nextCheckInDate: '',
      coachNotes: '',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }
    transaction.set(relationshipReference, relationship)
    return {
      created: true,
      profile: serializedPtProfile({
        ...relationship,
        lastCheckInAt: new Date(responseTimestamp),
      }, responseTimestamp),
      user,
    }
  })

  return {
    created: result.created,
    profile: result.profile,
    user: {
      uid: clientId,
      email: typeof authUser.email === 'string' ? authUser.email : email,
      displayName: typeof result.user.displayName === 'string' && result.user.displayName.trim()
        ? result.user.displayName.trim()
        : typeof authUser.displayName === 'string' && authUser.displayName.trim()
          ? authUser.displayName.trim()
          : email.split('@')[0],
    },
  }
})

/** Returns only published PT root metadata within the caller's ownership scope. */
exports.listPublishedPtPrograms = onCall(async (request) => {
  const { actorId, isAdmin } = await requirePtStaffActor(request)
  const programQuery = isAdmin
    ? db.collection('coachingPrograms').limit(300)
    : db.collection('coachingPrograms').where('coachId', '==', actorId).limit(300)
  const snapshot = await programQuery.get()
  const candidates = snapshot.docs
    .flatMap((item) => {
      const program = item.data()
      if (program.domain !== 'pt-coaching'
          || program.schemaVersion !== 2
          || program.status !== 'published'
          || typeof program.title !== 'string'
          || !program.title.trim()
          || typeof program.currentVersionId !== 'string'
          || !program.currentVersionId.trim()
          || typeof program.coachId !== 'string'
          || !program.coachId.trim()
          || (!isAdmin && program.coachId !== actorId)) {
        return []
      }
      return [{
        id: item.id,
        title: program.title.trim(),
        currentVersionId: program.currentVersionId.trim(),
        coachId: program.coachId.trim(),
      }]
    })
  const versionSnapshots = candidates.length
    ? await db.getAll(...candidates.map((program) => db.doc(`coachingPrograms/${program.id}/versions/${program.currentVersionId}`)))
    : []
  const programs = candidates
    .filter((program, index) => {
      const version = versionSnapshots[index]?.data()
      return versionSnapshots[index]?.exists
        && version?.programId === program.id
        && version?.versionId === program.currentVersionId
        && version?.coachId === program.coachId
        && version?.domain === 'pt-coaching'
        && version?.status === 'published'
    })
    .sort((left, right) => left.title.localeCompare(right.title, 'vi'))
  return { programs }
})

/** Lists bounded PT root metadata for management screens, including drafts. */
exports.listManagedPtPrograms = onCall(async (request) => {
  const { actorId, isAdmin } = await requirePtStaffActor(request)
  const requestedLimit = request.data?.limit
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(300, Math.max(1, requestedLimit))
    : 200
  const programQuery = isAdmin
    ? db.collection('coachingPrograms').limit(limit)
    : db.collection('coachingPrograms').where('coachId', '==', actorId).limit(limit)
  const snapshot = await programQuery.get()
  const programs = snapshot.docs
    .flatMap((item) => {
      const program = item.data()
      if (program.domain !== 'pt-coaching'
          || program.schemaVersion !== 2
          || typeof program.title !== 'string'
          || !program.title.trim()
          || typeof program.status !== 'string'
          || !program.status.trim()
          || !['draft', 'review', 'published'].includes(program.status)
          || typeof program.coachId !== 'string'
          || !program.coachId.trim()
          || (!isAdmin && program.coachId !== actorId)) {
        return []
      }
      return [{
        id: item.id,
        title: program.title.trim().slice(0, 200),
        description: typeof program.description === 'string'
          ? program.description.trim().slice(0, 2_000)
          : '',
        status: program.status.trim().slice(0, 40),
        coachId: program.coachId.trim(),
        currentVersionId: typeof program.currentVersionId === 'string'
          ? program.currentVersionId.trim()
          : '',
        durationWeeks: Number.isInteger(program.durationWeeks) ? program.durationWeeks : null,
        daysPerWeek: Number.isInteger(program.daysPerWeek) ? program.daysPerWeek : null,
        updatedAt: timestampIso(program.updatedAt),
      }]
    })
    .sort((left, right) => {
      const updatedOrder = (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '')
      return updatedOrder || left.title.localeCompare(right.title, 'vi')
    })
  return { programs, limit }
})

/**
 * Saves a coaching profile and synchronizes its deterministic assignment in a
 * single transaction. Program payloads remain immutable and are only pinned by
 * program/version id after server-side publication and ownership checks.
 */
exports.savePtClientCoachingProfile = onCall(async (request) => {
  const { actorId, isAdmin } = await requirePtStaffActor(request)
  const input = normalizePtClientProfileInput(request.data?.profile)
  let authUser
  try {
    authUser = await auth.getUser(input.clientId)
  } catch (error) {
    if (error?.code === 'auth/user-not-found') {
      throw new HttpsError('not-found', 'Không tìm thấy tài khoản học viên.')
    }
    throw error
  }

  const clientReference = db.doc(`coachClients/${input.clientId}`)
  const userReference = db.doc(`users/${input.clientId}`)
  // Keep the generated id stable if Firestore retries the transaction callback.
  const candidateCycleReference = db.collection('programAssignmentCycles').doc()
  const responseTimestamp = new Date().toISOString()
  return db.runTransaction(async (transaction) => {
    const [userSnapshot, relationshipSnapshot] = await Promise.all([
      transaction.get(userReference),
      transaction.get(clientReference),
    ])
    assertActiveStudentAccount(authUser, userSnapshot)

    const previous = relationshipSnapshot.exists ? relationshipSnapshot.data() : null
    let ownerId
    if (previous) {
      if (previous.clientId !== input.clientId
          || typeof previous.coachId !== 'string'
          || !previous.coachId.trim()) {
        throw new HttpsError('failed-precondition', 'Quan hệ coaching hiện tại không hợp lệ.')
      }
      ownerId = requireDocumentId(previous.coachId, 'Mã PT')
      const adminCanTransfer = isAdmin
        && input.coachId
        && input.coachId !== ownerId
        && ((previous.coachingStatus === 'onboarding'
             && !previous.currentProgramId
             && !previous.currentVersionId)
            || (previous.coachingStatus === 'completed' && input.coachingStatus === 'onboarding'))
      if (adminCanTransfer) ownerId = requireDocumentId(input.coachId, 'Mã PT mới')
      else if (input.coachId && input.coachId !== ownerId) {
        throw new HttpsError('permission-denied', 'Chỉ Administrator được chuyển PT khi onboarding hoặc bắt đầu chu kỳ mới.')
      }
      if (!isAdmin && ownerId !== actorId) {
        throw new HttpsError('permission-denied', 'Khách hàng không thuộc quyền quản lý của bạn.')
      }
      if (!isAllowedPtStatusTransition(previous.coachingStatus, input.coachingStatus)) {
        throw new HttpsError('failed-precondition', 'Chuyển trạng thái coaching không hợp lệ.')
      }
    } else {
      if (!['onboarding', 'active'].includes(input.coachingStatus)) {
        throw new HttpsError('failed-precondition', 'Hồ sơ mới chỉ có thể bắt đầu ở trạng thái onboarding hoặc active.')
      }
      if (!isAdmin && input.coachId && input.coachId !== actorId) {
        throw new HttpsError('permission-denied', 'PT không thể tạo hồ sơ thuộc quyền quản lý của người khác.')
      }
      ownerId = isAdmin && input.coachId ? input.coachId : actorId
    }

    const ownerReference = db.doc(`users/${ownerId}`)
    const ownerSnapshot = ownerId === input.clientId
      ? userSnapshot
      : await transaction.get(ownerReference)
    const owner = ownerSnapshot.data()
    if (!ownerSnapshot.exists
        || owner?.disabled === true
        || owner?.status === 'disabled'
        || !coachingStaffRoles.has(owner?.role)) {
      throw new HttpsError('failed-precondition', 'PT phụ trách không phải tài khoản coaching đang hoạt động.')
    }

    let previousProgramId = ''
    let previousVersionId = ''
    if (previous) {
      previousProgramId = typeof previous.currentProgramId === 'string' && previous.currentProgramId.trim()
        ? requireDocumentId(previous.currentProgramId, 'Mã giáo án PT hiện tại')
        : ''
      previousVersionId = typeof previous.currentVersionId === 'string' && previous.currentVersionId.trim()
        ? requireDocumentId(previous.currentVersionId, 'Mã phiên bản PT hiện tại')
        : ''
      if (Boolean(previousProgramId) !== Boolean(previousVersionId)) {
        throw new HttpsError('failed-precondition', 'Hồ sơ coaching hiện tại có liên kết giáo án không hoàn chỉnh.')
      }
    }

    let currentProgramId = input.currentProgramId
    let currentVersionId = input.currentVersionId
    let currentProgramName = ''
    if (input.coachingStatus === 'completed') {
      if (!previous || !previousProgramId || !previousVersionId) {
        throw new HttpsError('failed-precondition', 'Chỉ có thể hoàn tất một phân công PT đang tồn tại.')
      }
      if ((currentProgramId && currentProgramId !== previousProgramId)
          || (currentVersionId && currentVersionId !== previousVersionId)) {
        throw new HttpsError('failed-precondition', 'Không thể đổi giáo án trong lúc hoàn tất coaching.')
      }
      currentProgramId = previousProgramId
      currentVersionId = previousVersionId
      currentProgramName = typeof previous.currentProgramName === 'string'
        ? previous.currentProgramName.trim().slice(0, 200)
        : ''
    }

    let programSnapshot = null
    let versionSnapshot = null
    const mustValidatePublishedProgram = ['active', 'paused'].includes(input.coachingStatus)
      || (input.coachingStatus === 'onboarding' && Boolean(currentProgramId))
    if (mustValidatePublishedProgram) {
      const programReference = db.doc(`coachingPrograms/${currentProgramId}`)
      const versionReference = programReference.collection('versions').doc(currentVersionId)
      ;[programSnapshot, versionSnapshot] = await Promise.all([
        transaction.get(programReference),
        transaction.get(versionReference),
      ])
      assertPublishedPtProgram(programSnapshot.data(), versionSnapshot.data(), {
        programId: currentProgramId,
        versionId: currentVersionId,
        coachId: ownerId,
      })
      currentProgramName = programSnapshot.data().title.trim().slice(0, 200)
    }

    const previousHadAssignment = Boolean(previous
      && ['active', 'paused'].includes(previous.coachingStatus)
      && previousProgramId
      && previousVersionId)
    const writesCurrentAssignment = ['active', 'paused'].includes(input.coachingStatus)
    const assignmentChanged = Boolean(previousHadAssignment
      && (previousProgramId !== currentProgramId || previousVersionId !== currentVersionId))
    const closesPreviousAssignment = Boolean(previousHadAssignment
      && (input.coachingStatus === 'completed' || !writesCurrentAssignment || assignmentChanged))
    const previousAssignmentReference = closesPreviousAssignment
      ? db.doc(`programAssignments/${ptAssignmentId(input.clientId, previousProgramId)}`)
      : null
    const currentAssignmentReference = writesCurrentAssignment
      ? db.doc(`programAssignments/${ptAssignmentId(input.clientId, currentProgramId)}`)
      : null
    const assignmentReferences = [...new Map(
      [previousAssignmentReference, currentAssignmentReference]
        .filter(Boolean)
        .map((reference) => [reference.path, reference]),
    ).values()]
    const assignmentSnapshots = new Map()
    for (const reference of assignmentReferences) {
      assignmentSnapshots.set(reference.path, await transaction.get(reference))
    }

    const previousPointer = previousHadAssignment
      ? optionalPtDocumentId(previous?.activeAssignmentCycleId, 'Mã chu kỳ PT hiện tại')
      : ''
    const previousCycleId = previousHadAssignment
      ? previousPointer || ptLegacyAssignmentCycleId(input.clientId, previousProgramId, previousVersionId)
      : ''
    const previousCycleReference = previousCycleId
      ? db.doc(`programAssignmentCycles/${previousCycleId}`)
      : null
    const previousCycleSnapshot = previousCycleReference
      ? await transaction.get(previousCycleReference)
      : null
    const previousCycle = previousCycleReference
      ? assertPtAssignmentCycleIdentity(previousCycleSnapshot, {
        cycleId: previousCycleId,
        clientId: input.clientId,
        coachId: ownerId,
        programId: previousProgramId,
        versionId: previousVersionId,
      })
      : null
    if (previousPointer && !previousCycleSnapshot?.exists) {
      throw new HttpsError('failed-precondition', 'Hồ sơ coaching trỏ tới chu kỳ PT không tồn tại.')
    }
    if (previousPointer && previousCycle && !['active', 'paused'].includes(previousCycle.status)) {
      throw new HttpsError('failed-precondition', 'Hồ sơ coaching trỏ tới chu kỳ PT đã kết thúc.')
    }

    // A stable legacy id may already represent an older completed run. Never
    // resurrect it, otherwise its workout logs would leak into the new run.
    const endedLegacyFallback = Boolean(!previousPointer
      && previousCycle
      && !['active', 'paused'].includes(previousCycle.status))
    const keepsPreviousCycle = Boolean(previousHadAssignment
      && writesCurrentAssignment
      && !assignmentChanged
      && !endedLegacyFallback)
    const currentCycleId = writesCurrentAssignment
      ? keepsPreviousCycle ? previousCycleId : candidateCycleReference.id
      : ''
    let lastAssignmentCycleId = optionalPtDocumentId(
      previous?.lastAssignmentCycleId,
      'Mã chu kỳ PT gần nhất',
    )

    if (previousCycleReference && !endedLegacyFallback) {
      const previousLegacyReference = db.doc(`programAssignments/${ptAssignmentId(input.clientId, previousProgramId)}`)
      const legacySnapshot = assignmentSnapshots.get(previousLegacyReference.path)
        ?? await transaction.get(previousLegacyReference)
      const legacy = legacySnapshot?.data() ?? {}
      const cycleStatus = closesPreviousAssignment
        ? input.coachingStatus === 'completed' ? 'completed' : 'replaced'
        : input.coachingStatus
      const endReason = closesPreviousAssignment
        ? input.coachingStatus === 'completed'
          ? 'completed'
          : previousProgramId !== currentProgramId
            ? 'program-changed'
            : 'version-changed'
        : ''
      if (previousCycle) {
        transaction.set(previousCycleReference, {
          status: cycleStatus,
          endReason,
          endedAt: closesPreviousAssignment ? FieldValue.serverTimestamp() : null,
          updatedBy: actorId,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      } else {
        const legacyStartedAt = ptCycleTimestampOr(legacy.startDate, previous?.createdAt ?? FieldValue.serverTimestamp())
        transaction.create(previousCycleReference, {
          ...createPtAssignmentCycleWrite({
            cycleId: previousCycleId,
            clientId: input.clientId,
            coachId: ownerId,
            programId: previousProgramId,
            versionId: previousVersionId,
            programTitle: typeof previous?.currentProgramName === 'string'
              ? previous.currentProgramName.trim().slice(0, 200)
              : '',
            status: cycleStatus,
            actorId,
            source: 'legacy-backfill',
            legacyAssignmentId: ptAssignmentId(input.clientId, previousProgramId),
            historyCompleteness: 'legacy-collapsed',
            startedAt: legacyStartedAt,
            progressStartedAt: legacyStartedAt,
          }),
          endReason,
          endedAt: closesPreviousAssignment ? FieldValue.serverTimestamp() : null,
        })
      }
      if (closesPreviousAssignment) lastAssignmentCycleId = previousCycleId
    } else if (endedLegacyFallback) {
      lastAssignmentCycleId = previousCycleId
    }

    if (writesCurrentAssignment && !keepsPreviousCycle) {
      transaction.create(candidateCycleReference, createPtAssignmentCycleWrite({
        cycleId: candidateCycleReference.id,
        clientId: input.clientId,
        coachId: ownerId,
        programId: currentProgramId,
        versionId: currentVersionId,
        programTitle: currentProgramName,
        status: input.coachingStatus,
        actorId,
      }))
    }

    if (previousAssignmentReference) {
      const assignmentSnapshot = assignmentSnapshots.get(previousAssignmentReference.path)
      const assignment = assignmentSnapshot?.data() ?? {}
      assertPtAssignmentIdentity(assignmentSnapshot, {
        clientId: input.clientId,
        coachId: ownerId,
        programId: previousProgramId,
      })
      transaction.set(previousAssignmentReference, {
        clientId: input.clientId,
        coachId: ownerId,
        programId: previousProgramId,
        versionId: previousVersionId,
        status: 'completed',
        ...(!assignmentSnapshot.exists || !assignment.startDate
          ? { startDate: FieldValue.serverTimestamp() }
          : {}),
        ...(!assignmentSnapshot.exists || !assignment.createdAt
          ? { createdAt: FieldValue.serverTimestamp() }
          : {}),
        endDate: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }

    if (currentAssignmentReference) {
      const assignmentSnapshot = assignmentSnapshots.get(currentAssignmentReference.path)
      const assignment = assignmentSnapshot?.data() ?? {}
      assertPtAssignmentIdentity(assignmentSnapshot, {
        clientId: input.clientId,
        coachId: ownerId,
        programId: currentProgramId,
      })
      transaction.set(currentAssignmentReference, {
        clientId: input.clientId,
        coachId: ownerId,
        programId: currentProgramId,
        versionId: currentVersionId,
        status: input.coachingStatus,
        ...(!assignmentSnapshot.exists || !assignment.startDate
          ? { startDate: FieldValue.serverTimestamp() }
          : {}),
        ...(!assignmentSnapshot.exists || !assignment.createdAt
          ? { createdAt: FieldValue.serverTimestamp() }
          : {}),
        endDate: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }

    const checkInChanged = !previous
      || previous.readiness !== input.readiness
      || previous.sleepHours !== input.sleepHours
      || previous.soreness !== input.soreness
      || previous.bodyWeightKg !== input.bodyWeightKg
    const lastCheckInAt = checkInChanged || !previous?.lastCheckInAt
      ? FieldValue.serverTimestamp()
      : previous.lastCheckInAt
    const savedProfile = {
      ...input,
      coachId: ownerId,
      currentProgramId,
      currentVersionId,
      currentProgramName,
      activeAssignmentCycleId: currentCycleId,
      lastAssignmentCycleId,
      lastCheckInAt,
      updatedAt: FieldValue.serverTimestamp(),
      ...(!relationshipSnapshot.exists ? { createdAt: FieldValue.serverTimestamp() } : {}),
    }
    transaction.set(clientReference, savedProfile, { merge: true })

    return {
      created: !relationshipSnapshot.exists,
      profile: serializedPtProfile({
        ...savedProfile,
        lastCheckInAt: checkInChanged ? new Date(responseTimestamp) : previous?.lastCheckInAt,
      }, responseTimestamp),
      assignmentId: currentProgramId ? ptAssignmentId(input.clientId, currentProgramId) : null,
      assignmentCycleId: currentCycleId || null,
    }
  })
})

/**
 * Resolves a PT Coaching session without accepting an Academy course/lesson.
 * New PT data lives under coachingPrograms and requires an active coach-client
 * relationship pinned to the requested program/version. The legacy
 * course-linked callable above remains available during migration.
 */
exports.getPtWorkoutSession = onCall(async (request) => {
  const userId = requireCaller(request)
  const programId = requireDocumentId(request.data?.programId, 'Mã giáo án PT')
  const versionId = requireDocumentId(request.data?.versionId, 'Mã phiên bản')
  const sessionId = requireDocumentId(request.data?.sessionId, 'Mã buổi tập')
  const userReference = db.doc(`users/${userId}`)
  const programReference = db.doc(`coachingPrograms/${programId}`)
  const versionReference = programReference.collection('versions').doc(versionId)
  const relationshipReference = db.doc(`coachClients/${userId}`)
  const [userSnapshot, programSnapshot, versionSnapshot, relationshipSnapshot] = await Promise.all([
    userReference.get(),
    programReference.get(),
    versionReference.get(),
    relationshipReference.get(),
  ])

  if (!userSnapshot.exists || userSnapshot.data().disabled === true) {
    throw new HttpsError('permission-denied', 'Tài khoản không sẵn sàng để truy cập PT Coaching.')
  }
  if (!programSnapshot.exists) throw new HttpsError('not-found', 'Giáo án PT không tồn tại.')
  if (!versionSnapshot.exists) throw new HttpsError('not-found', 'Phiên bản giáo án PT không tồn tại.')

  const profile = userSnapshot.data()
  const program = programSnapshot.data()
  const version = versionSnapshot.data()
  const isAdminActor = hasTrustedRole(request, profile, privilegedAdminRoles)
  const isOwnerCoach = hasTrustedRole(request, profile, coachOnlyRoles)
    && program.coachId === userId
  const canPreview = isAdminActor || isOwnerCoach

  if (program.domain !== 'pt-coaching'
      || program.schemaVersion !== 2
      || typeof program.coachId !== 'string'
      || !program.coachId) {
    throw new HttpsError('failed-precondition', 'Giáo án chưa thuộc mô hình dữ liệu PT Coaching độc lập.')
  }
  if (version.programId !== programId
      || version.versionId !== versionId
      || version.schemaVersion !== 2
      || version.domain !== 'pt-coaching'
      || version.coachId !== program.coachId) {
    throw new HttpsError('failed-precondition', 'Metadata phiên bản PT không hợp lệ.')
  }

  if (!canPreview) {
    if (program.status !== 'published' || version.status !== 'published') {
      throw new HttpsError('failed-precondition', 'Giáo án PT chưa được xuất bản.')
    }
    const relationship = relationshipSnapshot.data()
    if (!relationshipSnapshot.exists
        || relationship.clientId !== userId
        || relationship.coachId !== program.coachId
        || relationship.coachingStatus !== 'active') {
      throw new HttpsError('permission-denied', 'Quan hệ coaching chưa hoạt động cho giáo án này.')
    }

    if (relationship.currentProgramId !== programId || relationship.currentVersionId !== versionId) {
      throw new HttpsError('permission-denied', 'Giáo án không khớp với phân công hiện tại của khách hàng PT.')
    }
    const assignment = await loadPtAssignmentCycleForRelationship(userId, relationship)
    if (assignment.cycle.status !== 'active'
        || assignment.cycle.programId !== programId
        || assignment.cycle.versionId !== versionId) {
      throw new HttpsError('permission-denied', 'Buổi tập không thuộc chu kỳ PT đang hoạt động.')
    }
  }

  const selected = findProgramSession(version, sessionId)
  return {
    programId,
    versionId,
    sessionId,
    weekNumber: selected.weekNumber,
    programTitle: typeof version.title === 'string' && version.title.trim()
      ? version.title.trim()
      : typeof program.title === 'string' && program.title.trim()
        ? program.title.trim()
        : 'Giáo án PT Aura',
    session: workoutSessionForLearner(selected.session),
  }
})

/** Resolves the client's pinned PT program and its requested/next session. */
exports.getPtAssignedWorkout = onCall(async (request) => {
  const userId = requireCaller(request)
  const [userSnapshot, relationshipSnapshot] = await Promise.all([
    db.doc(`users/${userId}`).get(),
    db.doc(`coachClients/${userId}`).get(),
  ])
  const relationship = relationshipSnapshot.data()
  if (!userSnapshot.exists || userSnapshot.data().disabled === true) {
    throw new HttpsError('permission-denied', 'Tài khoản không sẵn sàng để truy cập PT Coaching.')
  }
  if (!relationshipSnapshot.exists
      || relationship.clientId !== userId
      || relationship.coachingStatus !== 'active') {
    throw new HttpsError('permission-denied', 'Bạn chưa có phân công PT đang hoạt động.')
  }

  const programId = requireDocumentId(relationship.currentProgramId, 'Mã giáo án PT')
  const versionId = requireDocumentId(relationship.currentVersionId, 'Mã phiên bản')
  const programReference = db.doc(`coachingPrograms/${programId}`)
  const [programSnapshot, versionSnapshot, assignment] = await Promise.all([
    programReference.get(),
    programReference.collection('versions').doc(versionId).get(),
    loadPtAssignmentCycleForRelationship(userId, relationship),
  ])
  if (!programSnapshot.exists || !versionSnapshot.exists) {
    throw new HttpsError('not-found', 'Giáo án PT đã phân công không còn tồn tại.')
  }
  const program = programSnapshot.data()
  const version = versionSnapshot.data()
  if (program.domain !== 'pt-coaching'
      || program.schemaVersion !== 2
      || program.status !== 'published'
      || program.coachId !== relationship.coachId
      || version.domain !== 'pt-coaching'
      || version.schemaVersion !== 2
      || version.status !== 'published'
      || version.programId !== programId
      || version.versionId !== versionId
      || version.coachId !== relationship.coachId) {
    throw new HttpsError('failed-precondition', 'Phân công PT không khớp một phiên bản đã xuất bản.')
  }
  if (assignment.cycle.status !== 'active') {
    throw new HttpsError('permission-denied', 'Chu kỳ PT hiện tại chưa hoạt động.')
  }

  const requestedSessionId = request.data?.sessionId === undefined || request.data?.sessionId === null
    ? null
    : requireDocumentId(request.data.sessionId, 'Mã buổi tập')
  const orderedSessions = orderedProgramSessions(version)
  const workoutLogDocs = await loadPtCycleWorkoutLogs(userId, assignment)
  const completedSessionIds = new Set(workoutLogDocs.flatMap((item) => {
    const log = item.data()
    return ptWorkoutLogBelongsToCycle(log, assignment)
      && typeof log.sessionId === 'string'
      && Number.isInteger(log.completedSets)
      && log.completedSets > 0
      ? [log.sessionId]
      : []
  }))
  const nextSession = orderedSessions.find((item) => !completedSessionIds.has(item.session.id))
  const programTitle = typeof version.title === 'string' && version.title.trim()
    ? version.title.trim()
    : typeof program.title === 'string' && program.title.trim()
      ? program.title.trim()
      : 'Giáo án PT Aura'
  if (!requestedSessionId && !nextSession) {
    return {
      programId,
      versionId,
      programTitle,
      assignmentCycleId: assignment.cycleId,
      resolution: 'program-completed',
      completedSessionCount: completedSessionIds.size,
      totalSessions: orderedSessions.length,
      programCompleted: true,
    }
  }
  const sessionId = requestedSessionId ?? nextSession.session.id.trim()
  const selected = findProgramSession(version, sessionId)
  return {
    programId,
    versionId,
    sessionId,
    weekNumber: selected.weekNumber,
    programTitle,
    assignmentCycleId: assignment.cycleId,
    resolution: requestedSessionId
      ? 'requested-session'
      : 'next-incomplete-session',
    completedSessionCount: completedSessionIds.size,
    totalSessions: orderedSessions.length,
    programCompleted: !nextSession,
    session: workoutSessionForLearner(selected.session),
  }
})

/** Saves one immutable PT log after resolving the assigned immutable session. */
exports.savePtWorkoutLog = onCall(async (request) => {
  const userId = requireCaller(request)
  const value = request.data?.log
  if (!isPlainObject(value)) throw new HttpsError('invalid-argument', 'Nhật ký buổi tập không hợp lệ.')
  const programId = requireDocumentId(value.programId, 'Mã giáo án PT')
  const versionId = requireDocumentId(value.versionId, 'Mã phiên bản')
  const sessionId = requireDocumentId(value.sessionId, 'Mã buổi tập')
  const logId = requireDocumentId(value.clientLogId, 'Mã nhật ký')
  const userReference = db.doc(`users/${userId}`)
  const relationshipReference = db.doc(`coachClients/${userId}`)
  const programReference = db.doc(`coachingPrograms/${programId}`)
  const versionReference = programReference.collection('versions').doc(versionId)
  const logReference = db.doc(`users/${userId}/coachingWorkoutLogs/${logId}`)
  const duplicate = await db.runTransaction(async (transaction) => {
    const userSnapshot = await transaction.get(userReference)
    const relationshipSnapshot = await transaction.get(relationshipReference)
    const programSnapshot = await transaction.get(programReference)
    const versionSnapshot = await transaction.get(versionReference)
    const existingSnapshot = await transaction.get(logReference)
    if (!userSnapshot.exists || userSnapshot.data().disabled === true) {
      throw new HttpsError('permission-denied', 'Tài khoản không sẵn sàng để lưu nhật ký PT.')
    }
    const relationship = relationshipSnapshot.data()
    if (!relationshipSnapshot.exists
        || relationship.clientId !== userId
        || relationship.coachingStatus !== 'active'
        || relationship.currentProgramId !== programId
        || relationship.currentVersionId !== versionId) {
      throw new HttpsError('permission-denied', 'Buổi tập không thuộc phân công PT đang hoạt động.')
    }
    if (!programSnapshot.exists || !versionSnapshot.exists) {
      throw new HttpsError('not-found', 'Giáo án PT đã phân công không còn tồn tại.')
    }
    const program = programSnapshot.data()
    const version = versionSnapshot.data()
    if (program.domain !== 'pt-coaching'
        || program.schemaVersion !== 2
        || program.status !== 'published'
        || program.coachId !== relationship.coachId
        || version.domain !== 'pt-coaching'
        || version.schemaVersion !== 2
        || version.status !== 'published'
        || version.programId !== programId
        || version.versionId !== versionId
        || version.coachId !== relationship.coachId) {
      throw new HttpsError('failed-precondition', 'Phân công PT không khớp một phiên bản đã xuất bản.')
    }

    const cyclePointer = optionalPtDocumentId(relationship.activeAssignmentCycleId, 'Mã chu kỳ PT hiện tại')
    const assignmentCycleId = cyclePointer || ptLegacyAssignmentCycleId(userId, programId, versionId)
    const cycleReference = db.doc(`programAssignmentCycles/${assignmentCycleId}`)
    const legacyAssignmentId = ptAssignmentId(userId, programId)
    const legacyAssignmentReference = db.doc(`programAssignments/${legacyAssignmentId}`)
    const cycleSnapshot = await transaction.get(cycleReference)
    const legacyAssignmentSnapshot = await transaction.get(legacyAssignmentReference)
    const cycle = assertPtAssignmentCycleIdentity(cycleSnapshot, {
      cycleId: assignmentCycleId,
      clientId: userId,
      coachId: relationship.coachId,
      programId,
      versionId,
    })
    if (cyclePointer && !cycle) {
      throw new HttpsError('failed-precondition', 'Chu kỳ PT hiện tại không tồn tại.')
    }
    if (cycle && cycle.status !== 'active') {
      throw new HttpsError('permission-denied', 'Chu kỳ PT hiện tại chưa hoạt động.')
    }
    if (!cycle) {
      assertPtAssignmentIdentity(legacyAssignmentSnapshot, {
        clientId: userId,
        coachId: relationship.coachId,
        programId,
      })
    }

    const selected = findProgramSession(version, sessionId)
    const log = normalizePtWorkoutLog(value, { programId, versionId, sessionId }, selected.session)
    const verifiedLog = {
      ...log,
      clientId: userId,
      assignmentId: legacyAssignmentId,
      assignmentCycleId,
      verificationVersion: 2,
      completedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }
    if (existingSnapshot.exists) {
      const existing = existingSnapshot.data()
      if (existing.clientId === userId
          && existing.programId === programId
          && existing.versionId === versionId
          && existing.sessionId === sessionId
          && ((existing.verificationVersion === 2 && existing.assignmentCycleId === assignmentCycleId)
              || (existing.verificationVersion === 1
                  && !cyclePointer
                  && existing.assignmentId === legacyAssignmentId))) {
        return true
      }
      throw new HttpsError('already-exists', 'Mã nhật ký đã được dùng cho một buổi tập khác.')
    }
    if (!cycle) {
      const legacy = legacyAssignmentSnapshot.data() ?? {}
      const legacyStartedAt = ptCycleTimestampOr(legacy.startDate, relationship.createdAt ?? FieldValue.serverTimestamp())
      transaction.create(cycleReference, createPtAssignmentCycleWrite({
        cycleId: assignmentCycleId,
        clientId: userId,
        coachId: relationship.coachId,
        programId,
        versionId,
        programTitle: typeof relationship.currentProgramName === 'string' && relationship.currentProgramName.trim()
          ? relationship.currentProgramName.trim().slice(0, 200)
          : typeof program.title === 'string' ? program.title.trim().slice(0, 200) : 'Giáo án PT Aura',
        status: 'active',
        actorId: relationship.coachId,
        source: 'legacy-backfill',
        legacyAssignmentId,
        historyCompleteness: 'legacy-collapsed',
        startedAt: legacyStartedAt,
        progressStartedAt: legacyStartedAt,
      }))
      transaction.set(relationshipReference, {
        activeAssignmentCycleId: assignmentCycleId,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }
    transaction.create(logReference, verifiedLog)
    return false
  })
  return { userId, logId, duplicate }
})

/** Lists only PT-domain client data for a coach/admin, never Academy progress. */
exports.listPtClients = onCall(async (request) => {
  const actorId = requireCaller(request)
  const actorSnapshot = await db.doc(`users/${actorId}`).get()
  const actor = actorSnapshot.data()
  if (!actorSnapshot.exists || actor?.disabled === true) {
    throw new HttpsError('permission-denied', 'Tài khoản không sẵn sàng để quản lý khách hàng PT.')
  }
  const isAdminActor = hasTrustedRole(request, actor, privilegedAdminRoles)
  const isCoachActor = hasTrustedRole(request, actor, coachOnlyRoles)
  if (!isAdminActor && !isCoachActor) {
    throw new HttpsError('permission-denied', 'Bạn không có quyền xem danh sách khách hàng PT.')
  }

  const requestedLimit = request.data?.limit
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(200, Math.max(1, requestedLimit))
    : 100
  const relationshipQuery = isAdminActor
    ? db.collection('coachClients').limit(limit)
    : db.collection('coachClients').where('coachId', '==', actorId).limit(limit)
  const relationshipSnapshot = await relationshipQuery.get()
  const relationships = relationshipSnapshot.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => item.clientId === item.id)
  const userSnapshots = relationships.length
    ? await db.getAll(...relationships.map((item) => db.doc(`users/${item.id}`)))
    : []
  const usersById = new Map(userSnapshots.map((item) => [item.id, item.data()]))

  return {
    clients: relationships.map((relationship) => {
      const user = usersById.get(relationship.clientId) ?? {}
      return {
        clientId: relationship.clientId,
        coachId: relationship.coachId,
        displayName: typeof user.displayName === 'string' ? user.displayName : 'Khách hàng Aura',
        email: typeof user.email === 'string' ? user.email : '',
        membership: ['free', 'pro', 'coach'].includes(user.membership) ? user.membership : 'free',
        accountStatus: user.disabled === true ? 'disabled' : 'active',
        coachingStatus: relationship.coachingStatus,
        goal: typeof relationship.goal === 'string' ? relationship.goal : '',
        currentProgramName: typeof relationship.currentProgramName === 'string'
          ? relationship.currentProgramName
          : '',
        currentProgramId: typeof relationship.currentProgramId === 'string'
          ? relationship.currentProgramId
          : '',
        currentVersionId: typeof relationship.currentVersionId === 'string'
          ? relationship.currentVersionId
          : '',
        activeAssignmentCycleId: typeof relationship.activeAssignmentCycleId === 'string'
          ? relationship.activeAssignmentCycleId
          : '',
        lastAssignmentCycleId: typeof relationship.lastAssignmentCycleId === 'string'
          ? relationship.lastAssignmentCycleId
          : '',
        readiness: typeof relationship.readiness === 'number' ? relationship.readiness : null,
        lastCheckInAt: typeof relationship.lastCheckInAt?.toDate === 'function'
          ? relationship.lastCheckInAt.toDate().toISOString()
          : null,
      }
    }),
  }
})

const ptScheduleEventTypes = new Set(['workout', 'checkin', 'recovery'])
const ptScheduleEventStatuses = new Set(['planned', 'done', 'skipped', 'cancelled'])

function normalizePtScheduleDate(value, label) {
  const normalized = ptBoundedString(value ?? '', label, 10, { required: true })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  }
  return normalized
}

function normalizePtScheduleTime(value) {
  const normalized = ptBoundedString(value ?? '', 'Giờ lịch PT', 5, { required: true })
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(normalized)) {
    throw new HttpsError('invalid-argument', 'Giờ lịch PT không hợp lệ.')
  }
  return normalized
}

function normalizePtScheduleWorkoutReference(value, eventType) {
  if (value === undefined || value === null) return null
  if (eventType !== 'workout' || !isPlainObject(value)) {
    throw new HttpsError('invalid-argument', 'Chỉ lịch tập mới được liên kết một session PT.')
  }
  return {
    programId: requireDocumentId(value.programId, 'Mã giáo án PT của lịch'),
    versionId: requireDocumentId(value.versionId, 'Mã phiên bản PT của lịch'),
    sessionId: requireDocumentId(value.sessionId, 'Mã session PT của lịch'),
  }
}

function normalizePtScheduleEventInput(value) {
  if (!isPlainObject(value)) throw new HttpsError('invalid-argument', 'Nội dung lịch PT không hợp lệ.')
  const type = value.type
  if (!ptScheduleEventTypes.has(type)) throw new HttpsError('invalid-argument', 'Loại lịch PT không hợp lệ.')
  const date = normalizePtScheduleDate(value.date, 'Ngày lịch PT')
  const time = normalizePtScheduleTime(value.time)
  if (!Number.isInteger(value.durationMinutes) || value.durationMinutes < 5 || value.durationMinutes > 240) {
    throw new HttpsError('invalid-argument', 'Thời lượng lịch PT phải từ 5 đến 240 phút.')
  }
  return {
    type,
    title: ptBoundedString(value.title ?? '', 'Tên lịch PT', 160, { required: true }),
    note: ptBoundedString(value.note ?? '', 'Ghi chú lịch PT', 4_000),
    date,
    time,
    durationMinutes: value.durationMinutes,
    workoutRef: normalizePtScheduleWorkoutReference(value.workoutRef, type),
  }
}

function normalizeExpectedPtScheduleUpdatedAt(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 40) {
    throw new HttpsError('invalid-argument', 'Phiên bản lịch PT không hợp lệ.')
  }
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) {
    throw new HttpsError('invalid-argument', 'Phiên bản lịch PT không hợp lệ.')
  }
  return parsed.toISOString()
}

function assertPtScheduleExpectedVersion(snapshot, expectedUpdatedAt) {
  if (!expectedUpdatedAt) return
  if (!snapshot.exists || timestampIso(snapshot.data().updatedAt) !== expectedUpdatedAt) {
    throw new HttpsError('aborted', 'Lịch PT đã được cập nhật ở thiết bị khác. Hãy tải lại trước khi lưu.')
  }
}

function ptScheduleStartsAt(date, time) {
  const parsed = new Date(`${date}T${time}:00+07:00`)
  if (!Number.isFinite(parsed.getTime())) throw new HttpsError('invalid-argument', 'Thời điểm lịch PT không hợp lệ.')
  return parsed
}

function serializedPtScheduleEvent(id, data) {
  const workoutRef = isPlainObject(data.workoutRef)
    && typeof data.workoutRef.programId === 'string'
    && typeof data.workoutRef.versionId === 'string'
    && typeof data.workoutRef.sessionId === 'string'
    ? {
      programId: data.workoutRef.programId,
      versionId: data.workoutRef.versionId,
      sessionId: data.workoutRef.sessionId,
    }
    : null
  return {
    id,
    clientId: typeof data.clientId === 'string' ? data.clientId : '',
    coachId: typeof data.coachId === 'string' ? data.coachId : '',
    type: ptScheduleEventTypes.has(data.type) ? data.type : 'checkin',
    status: ptScheduleEventStatuses.has(data.status) ? data.status : 'planned',
    title: typeof data.title === 'string' ? data.title : '',
    note: typeof data.note === 'string' ? data.note : '',
    date: typeof data.date === 'string' ? data.date : '',
    time: typeof data.time === 'string' ? data.time : '',
    durationMinutes: Number.isInteger(data.durationMinutes) ? data.durationMinutes : 45,
    ...(workoutRef ? { workoutRef } : {}),
    assignmentCycleId: typeof data.assignmentCycleId === 'string' ? data.assignmentCycleId : '',
    timeZone: 'Asia/Ho_Chi_Minh',
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : '',
    createdAt: timestampIso(data.createdAt),
    updatedAt: timestampIso(data.updatedAt),
    completedAt: timestampIso(data.completedAt),
    cancelledAt: timestampIso(data.cancelledAt),
    cancellationReason: typeof data.cancellationReason === 'string' && data.cancellationReason
      ? data.cancellationReason
      : null,
  }
}

async function requirePtScheduleActor(request) {
  const actorId = requireCaller(request)
  const actorSnapshot = await db.doc(`users/${actorId}`).get()
  const actor = actorSnapshot.data()
  if (!actorSnapshot.exists
      || actor?.disabled === true
      || actor?.status === 'disabled'
      || !hasTrustedRole(request, actor, ptScheduleActorRoles)) {
    throw new HttpsError('permission-denied', 'Tài khoản không có quyền truy cập lịch PT.')
  }
  return {
    actorId,
    role: actor.role,
    isAdmin: privilegedAdminRoles.has(actor.role),
    isCoach: actor.role === 'coach',
    isStudent: actor.role === 'student',
  }
}

function assertPtScheduleRelationshipAccess(actor, clientId, relationship, operation) {
  if (relationship.clientId !== clientId || typeof relationship.coachId !== 'string' || !relationship.coachId) {
    throw new HttpsError('failed-precondition', 'Quan hệ coaching của lịch PT không hợp lệ.')
  }
  if (actor.isStudent) {
    if (clientId !== actor.actorId || operation === 'save') {
      throw new HttpsError('permission-denied', 'Học viên chỉ được xem lịch của mình và cập nhật trạng thái được phép.')
    }
    return
  }
  if (!actor.isAdmin && (!actor.isCoach || relationship.coachId !== actor.actorId)) {
    throw new HttpsError('permission-denied', 'Khách hàng không thuộc quyền quản lý PT của bạn.')
  }
}

/** Lists a bounded PT schedule range for the client, current coach or admin. */
exports.listPtScheduleEvents = onCall(async (request) => {
  const actor = await requirePtScheduleActor(request)
  const clientId = request.data?.clientId
    ? requireDocumentId(request.data.clientId, 'Mã khách hàng')
    : actor.actorId
  const fromDate = normalizePtScheduleDate(request.data?.fromDate, 'Ngày bắt đầu')
  const toDate = normalizePtScheduleDate(request.data?.toDate, 'Ngày kết thúc')
  const fromTime = new Date(`${fromDate}T00:00:00.000Z`).getTime()
  const toTime = new Date(`${toDate}T00:00:00.000Z`).getTime()
  if (toTime < fromTime || toTime - fromTime > 366 * 86_400_000) {
    throw new HttpsError('invalid-argument', 'Khoảng lịch PT phải hợp lệ và không quá 366 ngày.')
  }

  const relationshipReference = db.doc(`coachClients/${clientId}`)
  const relationshipSnapshot = await relationshipReference.get()
  if (!relationshipSnapshot.exists) {
    if (actor.isStudent && clientId === actor.actorId) return { events: [] }
    throw new HttpsError('not-found', 'Không tìm thấy quan hệ coaching của khách hàng.')
  }
  assertPtScheduleRelationshipAccess(actor, clientId, relationshipSnapshot.data(), 'list')
  const eventsSnapshot = await relationshipReference.collection('scheduleEvents')
    .where('date', '>=', fromDate)
    .where('date', '<=', toDate)
    .limit(500)
    .get()
  const events = eventsSnapshot.docs
    .map((item) => serializedPtScheduleEvent(item.id, item.data()))
    .sort((left, right) => `${left.date}${left.time}${left.id}`.localeCompare(`${right.date}${right.time}${right.id}`))
  return { events }
})

/** Creates or edits a schedule event. Only the owning coach or admin may mutate content. */
exports.savePtScheduleEvent = onCall(async (request) => {
  const actor = await requirePtScheduleActor(request)
  if (actor.isStudent) throw new HttpsError('permission-denied', 'Học viên không được tạo hoặc sửa nội dung lịch PT.')
  const clientId = requireDocumentId(request.data?.clientId, 'Mã khách hàng')
  const eventId = requireDocumentId(request.data?.eventId, 'Mã lịch PT')
  const expectedUpdatedAt = normalizeExpectedPtScheduleUpdatedAt(request.data?.expectedUpdatedAt)
  const input = normalizePtScheduleEventInput(request.data?.event)
  const relationshipReference = db.doc(`coachClients/${clientId}`)
  const eventReference = relationshipReference.collection('scheduleEvents').doc(eventId)

  await db.runTransaction(async (transaction) => {
    const relationshipSnapshot = await transaction.get(relationshipReference)
    const eventSnapshot = await transaction.get(eventReference)
    if (!relationshipSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy quan hệ coaching của khách hàng.')
    const relationship = relationshipSnapshot.data()
    assertPtScheduleRelationshipAccess(actor, clientId, relationship, 'save')
    if (!['active', 'onboarding'].includes(relationship.coachingStatus)) {
      throw new HttpsError('failed-precondition', 'Khách hàng tạm dừng hoặc đã hoàn thành chỉ có thể hủy lịch cũ.')
    }
    assertPtScheduleExpectedVersion(eventSnapshot, expectedUpdatedAt)
    if (!eventSnapshot.exists && expectedUpdatedAt) {
      throw new HttpsError('aborted', 'Lịch PT không còn tồn tại. Hãy tải lại danh sách.')
    }
    const existing = eventSnapshot.data() ?? null
    if (existing && (existing.clientId !== clientId || existing.status !== 'planned')) {
      throw new HttpsError('failed-precondition', 'Chỉ lịch đang ở trạng thái planned mới được sửa nội dung.')
    }
    if (existing && !expectedUpdatedAt) {
      throw new HttpsError('failed-precondition', 'Cần phiên bản updatedAt hiện tại để sửa lịch PT an toàn.')
    }

    let assignmentCycleId = ''
    if (input.workoutRef) {
      if (relationship.coachingStatus !== 'active'
          || relationship.currentProgramId !== input.workoutRef.programId
          || relationship.currentVersionId !== input.workoutRef.versionId) {
        throw new HttpsError('failed-precondition', 'Session của lịch không thuộc phân công PT đang hoạt động.')
      }
      const cycleId = optionalPtDocumentId(relationship.activeAssignmentCycleId, 'Mã chu kỳ PT hiện tại')
      if (!cycleId) throw new HttpsError('failed-precondition', 'Phân công PT cần được nâng cấp chu kỳ trước khi gắn session vào lịch.')
      const programReference = db.doc(`coachingPrograms/${input.workoutRef.programId}`)
      const versionReference = programReference.collection('versions').doc(input.workoutRef.versionId)
      const cycleReference = db.doc(`programAssignmentCycles/${cycleId}`)
      const programSnapshot = await transaction.get(programReference)
      const versionSnapshot = await transaction.get(versionReference)
      const cycleSnapshot = await transaction.get(cycleReference)
      assertPublishedPtProgram(programSnapshot.data(), versionSnapshot.data(), {
        programId: input.workoutRef.programId,
        versionId: input.workoutRef.versionId,
        coachId: relationship.coachId,
      })
      const cycle = assertPtAssignmentCycleIdentity(cycleSnapshot, {
        cycleId,
        clientId,
        coachId: relationship.coachId,
        programId: input.workoutRef.programId,
        versionId: input.workoutRef.versionId,
      })
      if (!cycle || cycle.status !== 'active') {
        throw new HttpsError('failed-precondition', 'Chu kỳ PT của session chưa hoạt động.')
      }
      findProgramSession(versionSnapshot.data(), input.workoutRef.sessionId)
      assignmentCycleId = cycleId
    }

    const eventWrite = {
      schemaVersion: 1,
      clientId,
      coachId: relationship.coachId,
      type: input.type,
      status: existing?.status ?? 'planned',
      title: input.title,
      note: input.note,
      date: input.date,
      time: input.time,
      timeZone: 'Asia/Ho_Chi_Minh',
      startsAt: ptScheduleStartsAt(input.date, input.time),
      durationMinutes: input.durationMinutes,
      assignmentCycleId,
      updatedBy: actor.actorId,
      updatedAt: FieldValue.serverTimestamp(),
      ...(input.workoutRef ? { workoutRef: input.workoutRef } : {}),
    }
    if (eventSnapshot.exists) {
      if (!input.workoutRef && existing?.workoutRef) eventWrite.workoutRef = FieldValue.delete()
      transaction.set(eventReference, eventWrite, { merge: true })
    } else {
      transaction.create(eventReference, {
        ...eventWrite,
        createdBy: actor.actorId,
        createdAt: FieldValue.serverTimestamp(),
        completedAt: null,
        cancelledAt: null,
        cancellationReason: '',
      })
    }
  })

  const savedSnapshot = await eventReference.get()
  return { event: serializedPtScheduleEvent(savedSnapshot.id, savedSnapshot.data()) }
})

/** Updates schedule state without deleting its audit/history record. */
exports.setPtScheduleEventStatus = onCall(async (request) => {
  const actor = await requirePtScheduleActor(request)
  const clientId = requireDocumentId(request.data?.clientId, 'Mã khách hàng')
  const eventId = requireDocumentId(request.data?.eventId, 'Mã lịch PT')
  const status = request.data?.status
  if (!['done', 'skipped', 'cancelled'].includes(status)) {
    throw new HttpsError('invalid-argument', 'Trạng thái lịch PT không hợp lệ.')
  }
  const expectedUpdatedAt = normalizeExpectedPtScheduleUpdatedAt(request.data?.expectedUpdatedAt)
  if (!expectedUpdatedAt) {
    throw new HttpsError('failed-precondition', 'Cần phiên bản updatedAt hiện tại để đổi trạng thái lịch PT an toàn.')
  }
  const cancellationReason = status === 'cancelled'
    ? ptBoundedString(request.data?.cancellationReason ?? '', 'Lý do hủy lịch', 500)
    : ''
  const relationshipReference = db.doc(`coachClients/${clientId}`)
  const eventReference = relationshipReference.collection('scheduleEvents').doc(eventId)

  await db.runTransaction(async (transaction) => {
    const relationshipSnapshot = await transaction.get(relationshipReference)
    const eventSnapshot = await transaction.get(eventReference)
    if (!relationshipSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy quan hệ coaching của khách hàng.')
    if (!eventSnapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy lịch PT.')
    const relationship = relationshipSnapshot.data()
    const existing = eventSnapshot.data()
    assertPtScheduleRelationshipAccess(actor, clientId, relationship, 'status')
    if (existing.clientId !== clientId || !ptScheduleEventStatuses.has(existing.status)) {
      throw new HttpsError('failed-precondition', 'Lịch PT hiện tại không hợp lệ.')
    }
    assertPtScheduleExpectedVersion(eventSnapshot, expectedUpdatedAt)
    if (existing.status === 'cancelled') {
      if (status === 'cancelled') return
      throw new HttpsError('failed-precondition', 'Lịch đã hủy không thể mở lại.')
    }
    if (actor.isStudent) {
      if (!['active', 'onboarding'].includes(relationship.coachingStatus)
          || existing.status !== 'planned'
          || !['done', 'skipped'].includes(status)) {
        throw new HttpsError('permission-denied', 'Học viên chỉ được chuyển lịch đang lên kế hoạch sang hoàn thành hoặc bỏ qua.')
      }
    } else if (['paused', 'completed'].includes(relationship.coachingStatus) && status !== 'cancelled') {
      throw new HttpsError('failed-precondition', 'Khách hàng tạm dừng hoặc đã hoàn thành chỉ có thể hủy lịch cũ.')
    }
    if (existing.status === status) return

    const statusWrite = {
      coachId: relationship.coachId,
      status,
      updatedBy: actor.actorId,
      updatedAt: FieldValue.serverTimestamp(),
      completedAt: status === 'done' ? FieldValue.serverTimestamp() : null,
      cancelledAt: status === 'cancelled' ? FieldValue.serverTimestamp() : null,
      cancellationReason: status === 'cancelled' ? cancellationReason : '',
    }
    transaction.set(eventReference, statusWrite, { merge: true })
  })

  const savedSnapshot = await eventReference.get()
  return { event: serializedPtScheduleEvent(savedSnapshot.id, savedSnapshot.data()) }
})
