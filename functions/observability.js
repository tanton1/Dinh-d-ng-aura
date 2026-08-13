const { logger } = require('firebase-functions')

function errorCode(error) {
  if (error && typeof error === 'object' && typeof error.code === 'string') {
    return error.code.replace(/^functions\//, '').slice(0, 80)
  }
  return 'internal'
}

function withFunctionTelemetry(functionName, handler) {
  return async (request) => {
    const startedAt = Date.now()
    let outcome = 'success'
    let failureCode = null

    try {
      return await handler(request)
    } catch (error) {
      outcome = 'error'
      failureCode = errorCode(error)
      logger.error('Aura function failure', {
        functionName,
        outcome,
        failureCode,
        authenticated: Boolean(request?.auth?.uid),
        appVerified: Boolean(request?.app?.appId),
        schemaVersion: 1,
      })
      throw error
    } finally {
      logger.info('Aura function metric', {
        functionName,
        outcome,
        failureCode,
        durationMs: Date.now() - startedAt,
        authenticated: Boolean(request?.auth?.uid),
        appVerified: Boolean(request?.app?.appId),
        schemaVersion: 1,
      })
    }
  }
}

module.exports = { withFunctionTelemetry }
