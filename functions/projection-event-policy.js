'use strict'

const { isDeepStrictEqual } = require('node:util')

// Verification and source-delivery receipts do not change displayed usage.
// In particular, sourceFingerprint remains meaningful: it identifies the
// business projection, unlike the private transaction/deduplication markers.
function projectionSourcePayload(value, collection) {
  if (collection !== 'contractUsageViews' || !value) return value
  const { generatedAt, reconciledAt, contractSourceFingerprint, lastSessionSourceFingerprint, reconciliationProjectionFingerprint, ...body } = value
  return body
}

/** Compare source data before any Firestore lookups or projection leases.
 * Only explicitly known usage verification metadata is ignored. All other
 * fields (including schema, business fingerprints and future fields) remain
 * significant, and creates/deletes always propagate.
 */
function projectionSourceChanged(event, fallbackCollection = '') {
  const before = event?.data?.before
  const after = event?.data?.after
  if (!before?.exists || !after?.exists) return true
  const collection = after.ref?.parent?.id || before.ref?.parent?.id || fallbackCollection
  return !isDeepStrictEqual(projectionSourcePayload(before.data(), collection), projectionSourcePayload(after.data(), collection))
}

module.exports = { projectionSourceChanged, projectionSourcePayload }
