'use strict'

// Keep target selection dependency-free. Only Functions runtime configuration
// may select this path; CLI discovery must still see the complete manifest.
const REPORTING_READ_TARGETS = Object.freeze([
  'getAcademyAnalyticsSummary',
  'listAcademyEnrollmentsPage',
  'listFinanceReceivables',
  'listFinanceStudentLabels',
])
const REPORTING_READ_OPTIONS = Object.freeze({ memory: '512MiB', timeoutSeconds: 180, maxInstances: 2, concurrency: 4 })

function shouldUseReportingReadRuntime(environment = process.env) {
  return REPORTING_READ_TARGETS.includes(environment.FUNCTION_TARGET)
    && environment.FUNCTIONS_CONTROL_API !== 'true'
    && !String(environment.AURA_FIREBASE_DISCOVERY_SCOPE || '').trim()
    && !['aura-student360-discovery', 'aura-exercise-catalog-discovery'].includes(environment.NODE_ENV)
}

// Both discovery and targeted runtime use the same business factory and
// resource options. The caller supplies the existing asia-east1 wrapper.
function createReportingReadFunctions({ db, onCall, logger }) {
  const { createScopedReportingReadFunctions } = require('./scoped-reporting-reads')
  return createScopedReportingReadFunctions({
    db, logger,
    onCall: handler => onCall({ ...REPORTING_READ_OPTIONS }, handler),
  })
}

function loadReportingReadRuntime(environment = process.env) {
  if (!shouldUseReportingReadRuntime(environment)) throw new Error('Reporting runtime requires an explicitly allowlisted runtime target.')
  const startedAt = Date.now()
  const { initializeApp } = require('firebase-admin/app')
  const { getFirestore } = require('firebase-admin/firestore')
  const { onCall } = require('firebase-functions/v2/https')
  const { setGlobalOptions } = require('firebase-functions/v2/options')
  const { logger } = require('firebase-functions')
  const { callableAppCheckPolicy } = require('./callable-app-check-policy')
  const app = initializeApp()
  const databaseId = environment.FIRESTORE_DATABASE_ID || 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'
  const db = getFirestore(app, databaseId)
  const enforceAppCheck = environment.ENFORCE_APP_CHECK === 'true'
  setGlobalOptions({
    region: 'asia-southeast1', maxInstances: 3,
    labels: { 'aura-release': 'quota-safe-v1-20260830' },
  })
  const handlers = createReportingReadFunctions({
    db, logger,
    onCall: (options, handler) => onCall({
      region: 'asia-east1', invoker: 'public', ...options,
      enforceAppCheck: callableAppCheckPolicy(enforceAppCheck, options),
    }, handler),
  })
  logger.info('reporting_read_runtime_initialized', {
    target: environment.FUNCTION_TARGET, schemaVersion: 1, enforceAppCheck,
    initializationMs: Date.now() - startedAt, loadedModuleCount: Object.keys(require.cache).length,
  })
  return { [environment.FUNCTION_TARGET]: handlers[environment.FUNCTION_TARGET] }
}

module.exports = { REPORTING_READ_TARGETS, shouldUseReportingReadRuntime, createReportingReadFunctions, loadReportingReadRuntime }
