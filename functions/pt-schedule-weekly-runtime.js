'use strict'

// Keep this module dependency-free until the exact target has been selected.
// FUNCTION_TARGET is supplied by the Functions runtime, never by a request.
const WEEKLY_READ_TARGETS = Object.freeze(['getPtScheduleWeeklyView', 'getPtScheduleWeeklyViewRegional'])

function shouldUseWeeklyReadRuntime(environment = process.env) {
  return WEEKLY_READ_TARGETS.includes(environment.FUNCTION_TARGET)
    && environment.FUNCTIONS_CONTROL_API !== 'true'
    && !String(environment.AURA_FIREBASE_DISCOVERY_SCOPE || '').trim()
    && !['aura-student360-discovery', 'aura-exercise-catalog-discovery'].includes(environment.NODE_ENV)
}

function loadWeeklyReadRuntime(environment = process.env) {
  if (!shouldUseWeeklyReadRuntime(environment)) throw new Error('Weekly runtime requires an explicitly allowlisted runtime target.')
  const startedAt = Date.now()
  const { initializeApp } = require('firebase-admin/app')
  const { getFirestore } = require('firebase-admin/firestore')
  const { onCall } = require('firebase-functions/v2/https')
  const { setGlobalOptions } = require('firebase-functions/v2/options')
  const { logger } = require('firebase-functions')
  const { createPtScheduleWeeklyViewFunctions } = require('./pt-schedule-weekly-view')
  const { scheduleActor } = require('./pt-schedule-v2')

  // Parity-tested against index.js discovery: same database, App Check,
  // branch/capability authorization, handler and Cloud Run resource profile.
  const app = initializeApp()
  const db = getFirestore(app, environment.FIRESTORE_DATABASE_ID || 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7')
  const enforceAppCheck = environment.ENFORCE_APP_CHECK === 'true'
  setGlobalOptions({
    region: 'asia-southeast1',
    maxInstances: 3,
    labels: { 'aura-release': 'quota-safe-v1-20260830' },
  })
  const workspaceOnCall = (handler) => onCall({
    invoker: 'public',
    region: 'asia-east1',
    cpu: 'gcf_gen1',
    maxInstances: 2,
    concurrency: 1,
    timeoutSeconds: 120,
    enforceAppCheck,
  }, handler)
  const handlers = createPtScheduleWeeklyViewFunctions({
    db,
    onCall: workspaceOnCall,
    workspaceOnCall,
    actorForBranch: scheduleActor,
  })
  logger.info('weekly_read_runtime_initialized', {
    target: environment.FUNCTION_TARGET,
    schemaVersion: 1,
    enforceAppCheck,
    initializationMs: Date.now() - startedAt,
  })
  return { [environment.FUNCTION_TARGET]: handlers.getPtScheduleWeeklyView }
}

module.exports = { WEEKLY_READ_TARGETS, shouldUseWeeklyReadRuntime, loadWeeklyReadRuntime }
