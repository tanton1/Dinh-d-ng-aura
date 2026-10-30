'use strict'

const STUDENT360_SOURCE_DOCUMENTS = Object.freeze({
  syncStudent360Student: 'students/{studentId}',
  syncStudent360Contract: 'contracts/{documentId}',
  syncStudent360ContractUsage: 'contractUsageViews/{documentId}',
  syncStudent360Session: 'sessions/{documentId}',
  syncStudent360Attendance: 'attendanceEvents/{documentId}',
  syncStudent360Availability: 'ptAvailability/{availabilityId}',
  syncStudent360Workout: 'workoutLogs/{documentId}',
  syncStudent360PtWorkout: 'ptWorkoutLogs/{documentId}',
  syncStudent360MealReview: 'mealReviews/{documentId}',
  syncStudent360LeaveRequest: 'leaveRequests/{documentId}',
  syncStudent360SessionRequest: 'sessionRequests/{documentId}',
  syncStudent360Renewal: 'contractRenewalCases/{documentId}',
  syncStudent360Payment: 'payments/{documentId}',
  syncStudent360DailyCheckin: 'dailyCheckins/{documentId}',
  syncStudent360Profile: 'users/{accountUid}',
  syncStudent360MealLog: 'users/{accountUid}/mealLogs/{documentId}',
  syncStudent360BodyMetric: 'users/{accountUid}/bodyMetrics/{documentId}',
  syncStudent360BodyMeasurement: 'users/{accountUid}/bodyMeasurements/{documentId}',
  syncStudent360WeightLog: 'users/{accountUid}/weightLogs/{documentId}',
  syncStudent360LegacyProgressPhoto: 'users/{accountUid}/progress_photos/{documentId}',
  syncStudent360ProgressPhoto: 'users/{accountUid}/progressPhotos/{documentId}',
  syncStudent360ProgressCheckIn: 'users/{accountUid}/progressCheckIns/{documentId}',
})
const STUDENT360_BACKGROUND_TARGETS = Object.freeze([
  ...Object.keys(STUDENT360_SOURCE_DOCUMENTS),
  'refreshStudent360ProjectionFromQueue',
  'reconcileStudent360ProjectionsScheduled',
  'processStudent360SourceQueue',
  'recoverStudent360SourceQueueScheduled',
])

function createStudent360SourceTrigger(document, { db, databaseId, onDocumentWritten, logger }) {
  if (!Object.values(STUDENT360_SOURCE_DOCUMENTS).includes(document)) throw new Error('Unknown Student 360 source document.')
  const { enqueueStudent360ProjectionFromEvent } = require('./student-360')
  const { syncWorkspaceChangesFromEvent } = require('./workspace-change-signals')
  return onDocumentWritten({
    document, database: databaseId, region: 'asia-southeast1',
    cpu: 'gcf_gen1', maxInstances: 3, retry: true,
  }, async event => {
    const [projection, changes] = await Promise.all([
      enqueueStudent360ProjectionFromEvent({ db, event, logger }),
      syncWorkspaceChangesFromEvent({ db, event, source: document.includes('/{accountUid}/') ? document.split('/')[2] : document.split('/')[0] }),
      document === 'users/{accountUid}'
        ? require('./delivery-workspace-signals').syncDeliveryWorkspaceChange({ db, event, source: 'users' })
        : Promise.resolve(null),
    ])
    if (changes.overflowCount) logger.warn('workspace_change_audience_overflow', { source: changes.source, count: changes.overflowCount })
    return projection
  })
}

function createStudent360BackgroundFunction(target, dependencies) {
  if (!STUDENT360_BACKGROUND_TARGETS.includes(target)) throw new Error('Unknown Student 360 background target.')
  const { db, databaseId, onDocumentWritten, onSchedule, logger } = dependencies
  if (Object.hasOwn(STUDENT360_SOURCE_DOCUMENTS, target)) return createStudent360SourceTrigger(STUDENT360_SOURCE_DOCUMENTS[target], dependencies)
  if (target === 'refreshStudent360ProjectionFromQueue') {
    const { buildStudent360Projection, mondayDateKey } = require('./student-360')
    const { STUDENT360_REFRESH_DOCUMENT, processStudent360Refresh } = require('./student-360-refresh-queue')
    return onDocumentWritten({
      document: STUDENT360_REFRESH_DOCUMENT, database: databaseId, region: 'asia-southeast1',
      cpu: 'gcf_gen1', maxInstances: 2, retry: true,
    }, event => processStudent360Refresh({
      db, event, logger, fallbackWeekId: mondayDateKey,
      rebuild: ({ studentId, weekId, lease }) => buildStudent360Projection({ db, studentId, weekId, persist: true, lease }),
    }))
  }
  if (target === 'reconcileStudent360ProjectionsScheduled') {
    const { reconcileStudent360ProjectionBatch } = require('./student-360')
    return onSchedule({
      schedule: 'every 60 minutes', timeZone: 'Asia/Ho_Chi_Minh', region: 'asia-southeast1',
      retryCount: 1, maxInstances: 1, timeoutSeconds: 540, memory: '1GiB',
    }, async () => reconcileStudent360ProjectionBatch({ db, logger, batchSize: 25, staleAfterDays: 2 }))
  }
  if (target === 'processStudent360SourceQueue') {
    const { STUDENT360_SOURCE_QUEUE_DOCUMENT, processStudent360Source } = require('./student-360-source-queue')
    const { withPrivateEventTelemetry } = require('./observability')
    return onDocumentWritten({
      document: STUDENT360_SOURCE_QUEUE_DOCUMENT, database: databaseId, region: 'asia-southeast1',
      cpu: 'gcf_gen1', maxInstances: 3, retry: true, timeoutSeconds: 540,
    }, withPrivateEventTelemetry(target, event => processStudent360Source({
      db, event, logger,
      rebuild: input => require('./student-360').rebuildStudent360Source({ db, ...input }),
    }), { logger }))
  }
  // Status-only queue events and empty recovery scans never need the projection
  // module. Load it only after a durable claim needs an actual rebuild.
  const { recoverStudent360Sources } = require('./student-360-source-queue')
  const { withPrivateEventTelemetry } = require('./observability')
  return onSchedule({
    schedule: 'every 5 minutes', timeZone: 'Asia/Ho_Chi_Minh', region: 'asia-southeast1',
    retryCount: 1, cpu: 'gcf_gen1', maxInstances: 1, timeoutSeconds: 540,
  }, withPrivateEventTelemetry(target, async () => recoverStudent360Sources({
    db, logger, batchSize: 25,
    rebuild: input => require('./student-360').rebuildStudent360Source({ db, ...input }),
  }), { logger }))
}

module.exports = {
  STUDENT360_SOURCE_DOCUMENTS,
  STUDENT360_BACKGROUND_TARGETS,
  createStudent360SourceTrigger,
  createStudent360BackgroundFunction,
}
