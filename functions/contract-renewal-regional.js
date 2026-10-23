'use strict'

const { createContractRenewalFunctions } = require('./contract-renewals')

const RENEWAL_CONFIRMATION_OPTIONS = Object.freeze({
  region: 'asia-east1',
  memory: '256MiB',
  cpu: 0.1666,
  minInstances: 0,
  maxInstances: 2,
  concurrency: 1,
  timeoutSeconds: 120,
  invoker: 'public',
})

function createContractRenewalRegionalFunctions({ db, onCall, logger, resolveActor }) {
  // Reuse the same authorized, idempotent transaction and Firestore database.
  // Do not pass onSchedule: renewal reconciliation must have only one scheduler.
  const functions = createContractRenewalFunctions({
    db, logger, resolveActor,
    onCall: (options, handler) => onCall({ ...options, ...RENEWAL_CONFIRMATION_OPTIONS }, handler),
  })
  return { renewPtContractRegional: functions.renewPtContract }
}

module.exports = { createContractRenewalRegionalFunctions, RENEWAL_CONFIRMATION_OPTIONS }
