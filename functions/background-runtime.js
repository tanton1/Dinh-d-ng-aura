'use strict'

// Both registration modules stay dependency-free until a known target has
// been selected. FUNCTION_TARGET is runtime configuration, never user input.
const { SCHEDULED_BACKGROUND_TARGETS, createScheduledBackgroundFunction } = require('./scheduled-background-functions')
const { STUDENT360_BACKGROUND_TARGETS, createStudent360BackgroundFunction } = require('./student-360-background-functions')
const BACKGROUND_RUNTIME_TARGETS = Object.freeze([...SCHEDULED_BACKGROUND_TARGETS, ...STUDENT360_BACKGROUND_TARGETS])
const PRE_GLOBAL_OPTIONS_TARGETS = Object.freeze(['vestPendingLoyaltySourcesScheduled', 'advanceLoyaltyMembershipsScheduled'])

function shouldUseBackgroundRuntime(environment = process.env) {
  return BACKGROUND_RUNTIME_TARGETS.includes(environment.FUNCTION_TARGET)
    && environment.FUNCTIONS_CONTROL_API !== 'true'
    && !String(environment.AURA_FIREBASE_DISCOVERY_SCOPE || '').trim()
    && !['aura-student360-discovery', 'aura-exercise-catalog-discovery'].includes(environment.NODE_ENV)
}

function loadBackgroundRuntime(environment = process.env) {
  if (!shouldUseBackgroundRuntime(environment)) throw new Error('Background runtime requires an explicitly allowlisted runtime target.')
  const startedAt = Date.now()
  const target = environment.FUNCTION_TARGET
  const { initializeApp } = require('firebase-admin/app')
  const { getFirestore } = require('firebase-admin/firestore')
  const { onSchedule } = require('firebase-functions/v2/scheduler')
  const { onDocumentWritten } = require('firebase-functions/v2/firestore')
  const { setGlobalOptions } = require('firebase-functions/v2/options')
  const { logger } = require('firebase-functions')
  const app = initializeApp()
  const databaseId = environment.FIRESTORE_DATABASE_ID || 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'
  const db = getFirestore(app, databaseId)
  // These two legacy registrations precede setGlobalOptions in index.js.
  // Preserve that ordering so labels and endpoint options remain identical.
  if (!PRE_GLOBAL_OPTIONS_TARGETS.includes(target)) setGlobalOptions({
    region: 'asia-southeast1', maxInstances: 3,
    labels: { 'aura-release': 'quota-safe-v1-20260830' },
  })
  const dependencies = { db, databaseId, onSchedule, onDocumentWritten, logger }
  const handler = SCHEDULED_BACKGROUND_TARGETS.includes(target)
    ? createScheduledBackgroundFunction(target, dependencies)
    : createStudent360BackgroundFunction(target, dependencies)
  logger.info('background_runtime_initialized', {
    target, schemaVersion: 1, initializationMs: Date.now() - startedAt,
    loadedModuleCount: Object.keys(require.cache).length,
  })
  return { [target]: handler }
}

module.exports = { BACKGROUND_RUNTIME_TARGETS, shouldUseBackgroundRuntime, loadBackgroundRuntime }
