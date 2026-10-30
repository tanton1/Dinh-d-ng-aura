'use strict'

const defaultLogger = require('firebase-functions/logger')
const { withPrivateFunctionTelemetry } = require('./observability')
const { student360FailureFields } = require('./student-360-projection-writes')

const OPERATIONS = new Set(['getStudent360Overview', 'refreshStudent360Projection'])

function withStudent360CallableDiagnostics(operation, handler, { logger = defaultLogger, ...options } = {}) {
  if (!OPERATIONS.has(operation)) throw new Error('Unsupported Student 360 diagnostic operation.')
  return withPrivateFunctionTelemetry(operation, async request => {
    try {
      return await handler(request)
    } catch (error) {
      // WeakMap-backed classifications are bounded server-local enums. Never
      // include identity, error messages, details or request/response payloads.
      try {
        const pending = logger.warn?.('student_360_callable_failure', { operation, ...student360FailureFields(error) })
        if (pending && typeof pending.then === 'function') Promise.resolve(pending).catch(() => {})
      } catch { /* Diagnostics cannot replace the original business failure. */ }
      throw error
    }
  }, { ...options, logger })
}

module.exports = { withStudent360CallableDiagnostics }
