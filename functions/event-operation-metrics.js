'use strict'

const { recordEventMetrics } = require('./operation-metrics')

// Observes the existing operation once. No retries, logging, snapshots or
// database calls are added; outside opt-in event contexts these are inert.
async function observeEventRead(kind, read) {
  recordEventMetrics(kind === 'query' ? { queryAttempts: 1 } : { documentReadAttempts: 1 })
  const snapshot = await read()
  recordEventMetrics(kind === 'query'
    ? { logicalQueries: 1, documentsReturned: snapshot.size }
    : { documentReads: 1, documentsReturned: snapshot.exists ? 1 : 0 })
  return snapshot
}

async function observeEventWrite(write) {
  recordEventMetrics({ writeAttempts: 1 })
  const result = await write()
  recordEventMetrics({ writesCompleted: 1 })
  return result
}

module.exports = { recordEventMetrics, observeEventRead, observeEventWrite }
