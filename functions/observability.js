const { logger } = require('firebase-functions')
const { randomUUID } = require('node:crypto')

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

function withFunctionTelemetry(functionName, handler) {
  return async (request) => {
    const startedAt = Date.now()
    const requestCorrelationId = correlationId(request)
    if (request && typeof request === 'object') request.auraCorrelationId = requestCorrelationId
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
      return await handler(request)
    } catch (error) {
      outcome = 'error'
      failureCode = errorCode(error)
      taxonomy = errorTaxonomy(failureCode)
      retryable = retryableError(failureCode)
      logger.error('Aura function failure', {
        ...baseLog,
        functionName,
        outcome,
        failureCode,
        errorCode: taxonomy,
        retryable,
        authenticated: Boolean(request?.auth?.uid),
        appVerified: Boolean(request?.app?.appId),
      })
      throw error
    } finally {
      logger.info('Aura function metric', {
        ...baseLog,
        functionName,
        outcome,
        failureCode,
        errorCode: taxonomy,
        retryable,
        durationMs: Date.now() - startedAt,
        authenticated: Boolean(request?.auth?.uid),
        appVerified: Boolean(request?.app?.appId),
      })
    }
  }
}

module.exports = { withFunctionTelemetry, correlationId, domainForOperation, errorTaxonomy, retryableError }
