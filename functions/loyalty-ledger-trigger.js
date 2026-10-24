'use strict'

const { isDeepStrictEqual } = require('node:util')
const { reconcileContractSpend, reconcileMemberReferral } = require('./loyalty')

const FINANCIAL_ENTRY_TYPES = new Set(['payment', 'refund', 'reversal'])
// These two audit stamps are not inputs to either loyalty reconciler. Keep all
// other fields, including unknown future fields, in the comparison. In
// particular createdAt/effectiveAt affect payment order and hold periods.
const IGNORED_AUDIT_FIELDS = new Set(['updatedAt', 'updatedBy'])

function ledgerSnapshotValue(snapshot, side) {
  // Missing event evidence is not a confirmed create/delete or a safe no-op.
  // Never guess the previous contract when a snapshot is unavailable.
  if (!snapshot || typeof snapshot.exists !== 'boolean') {
    throw new Error(`Loyalty ledger trigger requires a complete ${side} snapshot.`)
  }
  if (!snapshot.exists) return null
  if (typeof snapshot.data !== 'function') {
    throw new Error(`Loyalty ledger trigger cannot read the ${side} snapshot.`)
  }
  const value = snapshot.data()
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Loyalty ledger trigger received invalid ${side} ledger evidence.`)
  }
  return value
}

function ledgerBusinessValue(value) {
  if (value === null) return null
  return Object.fromEntries(Object.entries(value).filter(([key]) => !IGNORED_AUDIT_FIELDS.has(key)))
}

function affectedLoyaltyContractIds(before, after) {
  const ids = new Set()
  for (const value of [before, after]) {
    if (!value || !FINANCIAL_ENTRY_TYPES.has(value.type) || !value.contractId) continue
    // Do not silently skip malformed financial links or normalize an ID to a
    // different document. Valid legacy string IDs retain their exact bytes.
    if (typeof value.contractId !== 'string') throw new Error('Loyalty ledger contractId must be a string.')
    ids.add(value.contractId)
  }
  return [...ids]
}

async function reconcileLoyaltyLedgerWrite({
  db,
  event,
  logger = console,
  reconcileSpend = reconcileContractSpend,
  reconcileReferral = reconcileMemberReferral,
}) {
  const before = ledgerSnapshotValue(event?.data?.before, 'before')
  const after = ledgerSnapshotValue(event?.data?.after, 'after')
  const contractIds = affectedLoyaltyContractIds(before, after)
  if (!contractIds.length || isDeepStrictEqual(ledgerBusinessValue(before), ledgerBusinessValue(after))) return null

  const results = []
  for (const contractId of contractIds) {
    // Preserve spend -> referral ordering and fresh reads inside each existing
    // reconciler. Do not share financial snapshots, parallelize contracts, or
    // introduce another regional writer without a common freshness fence.
    const spend = await reconcileSpend({ db, contractId, logger })
    const referral = await reconcileReferral({ db, contractId, logger })
    results.push({ contractId, spend, referral })
  }
  // Preserve the previous trigger result for its existing single-contract path.
  if (results.length === 1) return { spend: results[0].spend, referral: results[0].referral }
  return { contracts: results }
}

// Dispatching deletion/reassignment to the old contract is necessary, but does
// not repair existing financial-core gaps: reconcileContractSpend currently
// does not reverse a payment source that disappeared from its live query, and
// source targets lack a shared source-version fence. Those need a separate
// financial review, not an implicit change in this read-avoidance helper.
module.exports = { reconcileLoyaltyLedgerWrite, affectedLoyaltyContractIds }
