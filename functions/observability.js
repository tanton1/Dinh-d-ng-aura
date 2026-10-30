const { logger } = require('firebase-functions')
const { randomUUID, createHash } = require('node:crypto')
const { withOperationMetrics, measureResponseBytes, OPERATION_METRIC_FIELDS } = require('./operation-metrics')

function errorCode(error) {
  if (error && typeof error === 'object' && typeof error.code === 'string') {
    return error.code.replace(/^functions\//, '').slice(0, 80)
  }
  return 'internal'
}

function errorTaxonomy(code) {
  const normalized = String(code || '').replace(/^functions\//, '').toLowerCase()
  if (['unauthenticated'].includes(normalized)) return 'AUTH'
  if (['permission-denied'].includes(normalized)) return 'PERMISSION'
  if (['invalid-argument', 'out-of-range'].includes(normalized)) return 'VALIDATION'
  if (['failed-precondition'].includes(normalized)) return 'BUSINESS_RULE'
  if (['aborted', 'already-exists'].includes(normalized)) return 'CONFLICT'
  if (['deadline-exceeded'].includes(normalized)) return 'TIMEOUT'
  if (['unavailable', 'resource-exhausted'].includes(normalized)) return 'DEPENDENCY'
  return 'INTERNAL'
}

function retryableError(code) {
  return ['aborted', 'deadline-exceeded', 'unavailable', 'resource-exhausted', 'internal']
    .includes(String(code || '').replace(/^functions\//, '').toLowerCase())
}

function domainForOperation(operation) {
  const value = String(operation || '').toLowerCase()
  if (value.includes('student360')) return 'student360'
  if (value.includes('quote') || value.includes('sales') || value.includes('lead')) return 'sales'
  if (value.includes('package')) return 'contract'
  if (value.includes('contract') || value.includes('renewal')) return 'contract'
  if (value.includes('schedule') || value.includes('session')) return 'schedule'
  if (value.includes('nutrition') || value.includes('meal')) return 'nutrition'
  if (value.includes('finance') || value.includes('ledger') || value.includes('cashbook') || value.includes('voucher')) return 'finance'
  if (value.includes('payroll') || value.includes('performance')) return 'people'
  if (value.includes('student')) return 'people'
  if (value.includes('academy') || value.includes('course') || value.includes('enrollment')) return 'academy'
  if (value.includes('loyalty') || value.includes('reward') || value.includes('redemption')) return 'loyalty'
  if (value.includes('delivery') || value.includes('eatclean')) return 'delivery'
  if (value.includes('branch')) return 'identity'
  if (value.includes('identity') || value.includes('account') || value.includes('staff')) return 'identity'
  if (value.includes('action')) return 'action'
  return 'platform'
}

function requestSourceId(request) {
  const source = request?.data || {}
  const value = source.sourceId || source.actionId || source.contractId || source.studentId || source.sessionId || source.requestId
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(value) ? value : null
}

function correlationId(request) {
  const supplied = request?.data?.correlationId
    || request?.rawRequest?.headers?.['x-aura-correlation-id']
    || request?.rawRequest?.headers?.['x-request-id']
  return typeof supplied === 'string' && /^[A-Za-z0-9._:-]{8,100}$/.test(supplied)
    ? supplied
    : randomUUID()
}

function telemetrySampleRate(value = process.env.AURA_SUCCESS_METRIC_SAMPLE_RATE) {
  if (value === undefined || value === '') return 0.1
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.1
}

function shouldSampleMetric(id, sampleRate) {
  return createHash('sha256').update(id).digest().readUInt32BE(0) / 0x100000000 < sampleRate
}

function withFunctionTelemetry(functionName, handler, options = {}) {
  const metricLogger = options.logger || logger
  const isEvent = options.invocationType === 'event'
  return async (request) => withOperationMetrics(async metrics => {
    const startedAt = Date.now()
    const requestCorrelationId = isEvent ? randomUUID() : correlationId(request)
    if (!isEvent && request && typeof request === 'object') request.auraCorrelationId = requestCorrelationId
    let outcome = 'success'
    let failureCode = null
    let taxonomy = null
    let retryable = false
    const baseLog = {
      schemaVersion: 1,
      correlationId: requestCorrelationId,
      domain: domainForOperation(functionName),
      operation: functionName,
      actorUid: request?.auth?.uid || null,
      sourceId: requestSourceId(request),
    }

    try {
      const response = await handler(request)
      // Measure only sampled requests; do not serialize payloads twice on every
      // hot-path read. The serialized value is never written to the log.
      if (shouldSampleMetric(requestCorrelationId, telemetrySampleRate(options.successSampleRate))) {
        const bytes = measureResponseBytes(response)
        if (bytes !== undefined) metrics.responseBytes = bytes
      }
      return response
    } catch (error) {
      outcome = 'error'
      failureCode = errorCode(error)
      taxonomy = errorTaxonomy(failureCode)
      retryable = retryableError(failureCode)
      metricLogger.error('Aura function failure', {
        ...baseLog,
        functionName,
        outcome,
        failureCode,
        errorCode: taxonomy,
        retryable,
        ...(isEvent ? { invocationType: 'event' } : {}),
        authenticated: isEvent ? null : Boolean(request?.auth?.uid),
        appVerified: isEvent ? null : Boolean(request?.app?.appId),
      })
      throw error
    } finally {
      const sampleRate = outcome === 'error' ? 1 : telemetrySampleRate(options.successSampleRate)
      if (outcome === 'error' || shouldSampleMetric(requestCorrelationId, sampleRate)) metricLogger.info('Aura function metric', {
        schemaVersion: 2,
        correlationId: requestCorrelationId,
        domain: baseLog.domain,
        operation: functionName,
        release: process.env.K_REVISION || process.env.AURA_RELEASE || 'local',
        sampleRate,
        metrics,
        functionName,
        outcome,
        failureCode,
        errorCode: taxonomy,
        retryable,
        durationMs: Date.now() - startedAt,
        ...(isEvent ? { invocationType: 'event' } : {}),
        authenticated: isEvent ? null : Boolean(request?.auth?.uid),
        appVerified: isEvent ? null : Boolean(request?.app?.appId),
      })
    }
  }, { invocationType: isEvent ? 'event' : undefined })
}

// Opt-in for newly instrumented business operations. Keep the existing sampling
// and metrics context while excluding request identity and arbitrary error text.
// A logging failure must never turn a committed mutation into a retryable error.
function withPrivateFunctionTelemetry(functionName, handler, options = {}) {
  const sink = options.logger || logger
  const knownCodes = new Set(['ok', 'cancelled', 'unknown', 'invalid-argument', 'deadline-exceeded', 'not-found',
    'already-exists', 'permission-denied', 'resource-exhausted', 'failed-precondition', 'aborted', 'out-of-range',
    'unimplemented', 'internal', 'unavailable', 'data-loss', 'unauthenticated'])
  const fields = ['schemaVersion', 'domain', 'operation', 'release', 'sampleRate', 'functionName', 'outcome',
    'errorCode', 'retryable', 'durationMs', 'authenticated', 'appVerified', 'invocationType']
  const metricFields = OPERATION_METRIC_FIELDS
  const privateLogger = Object.fromEntries(['info', 'error'].map(level => [level, (message, value) => {
    const output = Object.fromEntries(fields.filter(field => value[field] !== undefined).map(field => [field, value[field]]))
    output.failureCode = value.failureCode === null ? null : knownCodes.has(value.failureCode) ? value.failureCode : 'internal'
    if (value.metrics) output.metrics = Object.fromEntries(metricFields.filter(field => typeof value.metrics[field] === 'number'
      && Number.isFinite(value.metrics[field]) && value.metrics[field] >= 0).map(field => [field, value.metrics[field]]))
    try {
      const pending = sink[level]?.(message, output)
      // Do not await transport logging or allow a rejected async sink to become
      // an unhandled rejection after a successful financial transaction.
      if (pending && typeof pending.then === 'function') Promise.resolve(pending).catch(() => {})
    } catch { /* Observability cannot change the business result. */ }
  }]))
  return withFunctionTelemetry(functionName, handler, { ...options, logger: privateLogger })
}

function withPrivateEventTelemetry(functionName, handler, options = {}) {
  return withPrivateFunctionTelemetry(functionName, handler, { ...options, invocationType: 'event' })
}

module.exports = { withFunctionTelemetry, withPrivateFunctionTelemetry, withPrivateEventTelemetry, correlationId, domainForOperation, errorTaxonomy, retryableError, telemetrySampleRate, shouldSampleMetric }
