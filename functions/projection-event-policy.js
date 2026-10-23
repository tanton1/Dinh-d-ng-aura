'use strict'

const { isDeepStrictEqual } = require('node:util')

/** Compare source data before any Firestore lookups or projection leases.
 * Only contractUsageViews.generatedAt is metadata for these consumers. Keep
 * every other field (including schema/fingerprints and unknown future fields)
 * significant, and always process creates/deletes.
 */
function projectionSourceChanged(event, fallbackCollection = '') {
  const before = event?.data?.before
  const after = event?.data?.after
  if (!before?.exists || !after?.exists) return true
  const collection = after.ref?.parent?.id || before.ref?.parent?.id || fallbackCollection
  const meaningful = (value) => {
    if (collection !== 'contractUsageViews' || !value) return value
    const { generatedAt, ...body } = value
    return body
  }
  return !isDeepStrictEqual(meaningful(before.data()), meaningful(after.data()))
}

module.exports = { projectionSourceChanged }
