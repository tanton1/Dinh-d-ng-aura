'use strict'

const { syncDailyAggregateWrite } = require('./operations-dashboard-aggregates')

// Move compute, not the database or the Eventarc source. Firebase CLI resolves
// the Firestore trigger location from this named database's location (SG).
// Ledger has the largest measured CPU allocation; the other four use Jakarta.
// Deployment prerequisite: prove each old SG serving image already has the
// transactional v2 contribution baseline (1f3a847 or equivalent). This module
// does not authorize overlapping unknown writers or retire any old consumer.
const REGIONAL_AGGREGATE_TARGETS = Object.freeze([
  Object.freeze({ name: 'syncOpsLedgerDailyAggregateRegional', source: 'ledger', document: 'ledgerEntries/{entryId}', region: 'asia-east1' }),
  Object.freeze({ name: 'syncOpsAttendanceDailyAggregateRegional', source: 'attendance', document: 'attendanceEvents/{eventId}', region: 'asia-southeast2' }),
  Object.freeze({ name: 'syncOpsSessionDailyAggregateRegional', source: 'session', document: 'sessions/{sessionId}', region: 'asia-southeast2' }),
  Object.freeze({ name: 'syncOpsContractDailyAggregateRegional', source: 'contract', document: 'contracts/{contractId}', region: 'asia-southeast2' }),
  Object.freeze({ name: 'syncOpsStudentDailyAggregateRegional', source: 'student', document: 'students/{studentId}', region: 'asia-southeast2' }),
])

// Pin the existing SG writer profile. This wave changes placement only; it
// neither adds a warm floor nor changes throughput/retry/resource semantics.
const REGIONAL_AGGREGATE_OPTIONS = Object.freeze({
  cpu: 1,
  memory: '256MiB',
  minInstances: 0,
  maxInstances: 2,
  concurrency: 80,
  retry: true,
})

function createRegionalOperationsAggregateFunctions({ db, databaseId, onDocumentWritten, logger = console, synchronize = syncDailyAggregateWrite }) {
  if (!db || typeof databaseId !== 'string' || !databaseId.trim() || typeof onDocumentWritten !== 'function') {
    throw new Error('Regional aggregate writers require the existing named database and Firestore trigger factory.')
  }
  const register = ({ source, document, region }) => onDocumentWritten(
    { ...REGIONAL_AGGREGATE_OPTIONS, document, database: databaseId, region },
    async (event) => synchronize({ db, source, event, logger }),
  )
  // Keep named returns explicit for static deployment/lifecycle discovery.
  return {
    syncOpsLedgerDailyAggregateRegional: register(REGIONAL_AGGREGATE_TARGETS[0]),
    syncOpsAttendanceDailyAggregateRegional: register(REGIONAL_AGGREGATE_TARGETS[1]),
    syncOpsSessionDailyAggregateRegional: register(REGIONAL_AGGREGATE_TARGETS[2]),
    syncOpsContractDailyAggregateRegional: register(REGIONAL_AGGREGATE_TARGETS[3]),
    syncOpsStudentDailyAggregateRegional: register(REGIONAL_AGGREGATE_TARGETS[4]),
  }
}

module.exports = { createRegionalOperationsAggregateFunctions, REGIONAL_AGGREGATE_TARGETS, REGIONAL_AGGREGATE_OPTIONS }
