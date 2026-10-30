'use strict'

const { AsyncLocalStorage } = require('node:async_hooks')
const context = new AsyncLocalStorage()
const EVENT_COUNTERS = Object.freeze(['guardSkips', 'queryAttempts', 'documentReadAttempts', 'documentReads', 'writeAttempts', 'writesCompleted', 'writeNoops', 'transactionAttempts', 'transactionWriteAttempts', 'transactionWritesCommitted', 'staffRefreshes'])
const counters = new Set(['logicalQueries', 'documentsReturned', 'cacheHits', 'cacheMisses', ...EVENT_COUNTERS])
const gauges = new Set(['projectionAgeMs', 'queueWaitMs', 'processingMs', 'responseBytes'])
const OPERATION_METRIC_FIELDS = Object.freeze([...counters, ...gauges])
const eventContexts = new WeakSet()

// Unknown measurements are omitted. These are application observations, never
// billing units. No query text, document contents or identifiers are accepted.
function recordOperationMetrics(values) {
  const current = context.getStore()
  if (!current || !values || typeof values !== 'object') return
  for (const [name, value] of Object.entries(values)) {
    if (name === 'cacheHit' && typeof value === 'boolean') {
      const key = value ? 'cacheHits' : 'cacheMisses'
      current[key] = (current[key] || 0) + 1
    } else if ((counters.has(name) || gauges.has(name)) && typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      const bounded = Math.min(Math.round(value), Number.MAX_SAFE_INTEGER)
      current[name] = counters.has(name) ? Math.min((current[name] || 0) + bounded, Number.MAX_SAFE_INTEGER) : bounded
    }
  }
}

function withOperationMetrics(handler, options = {}) {
  const metrics = {}
  if (options.invocationType === 'event') {
    eventContexts.add(metrics)
    for (const key of ['logicalQueries', 'documentsReturned', ...EVENT_COUNTERS]) metrics[key] = 0
  }
  return context.run(metrics, () => handler(metrics))
}

function recordEventMetrics(values) {
  if (eventContexts.has(context.getStore())) recordOperationMetrics(values)
}

function measureResponseBytes(value) {
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' ? Buffer.byteLength(serialized, 'utf8') : undefined
  } catch { return undefined }
}

module.exports = { recordOperationMetrics, recordEventMetrics, withOperationMetrics, measureResponseBytes, OPERATION_METRIC_FIELDS }
