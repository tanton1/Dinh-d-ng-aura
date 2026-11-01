'use strict'

const { contractSalesContribution } = require('./contract-financial-status')

const SALES_INDEX_VERSION = 1
const SALES_INDEX_GATE = 'reportingIndexes/contract-sales-v1'
const SALES_INDEX_KEY = 'financeSalesIndex.key'
const SALES_EXCEPTION_KEYS = ['!missing_date', '!cancelled_unverified']
const SALES_CONTRACT_FIELDS = ['branchId', 'status', 'totalPrice', 'discount', 'signedAt', 'createdAt', 'contractDate', 'startDate', 'salesCancellationSnapshot', 'salesOriginalSnapshot', 'financeSalesIndex']
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
})

// Match the existing financial report's timestamp precedence and Vietnam day.
// Do not reinterpret activation dates, cancelled prices or missing dates.
function contractSalesDateKey(value) {
  const millis = typeof value?.toMillis === 'function' ? value.toMillis()
    : typeof value?.toDate === 'function' ? value.toDate().getTime() : new Date(value || 0).getTime()
  if (!millis || !Number.isFinite(millis)) return ''
  const parts = formatter.formatToParts(new Date(millis))
  const part = type => parts.find(item => item.type === type)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function contractSalesIndex(contract) {
  const sale = contractSalesContribution(contract)
  const key = sale ? contractSalesDateKey(sale.effectiveAt) || '!missing_date'
    : contract.status === 'cancelled' ? '!cancelled_unverified' : '!excluded'
  return { schemaVersion: SALES_INDEX_VERSION, key }
}
function contractSalesIndexPatch(contract) { return { financeSalesIndex: contractSalesIndex(contract) } }
function hasCurrentContractSalesIndex(contract) {
  const expected = contractSalesIndex(contract), actual = contract.financeSalesIndex
  return actual?.schemaVersion === expected.schemaVersion && actual.key === expected.key
}

// Piggyback on the existing contract subscription. Normal atomic writers and
// index-only deliveries cost zero reads here; old/manual writers are repaired.
// Read the latest document, never replay an older event's proposed key.
async function syncContractSalesIndex({ db, event }) {
  const after = event.data?.after
  if (!after?.exists || hasCurrentContractSalesIndex(after.data())) return { updated: 0 }
  if (!/^contracts\/[^/]+$/.test(after.ref?.path || '')) throw Error('INVALID_CONTRACT_SALES_INDEX_SOURCE')
  return db.runTransaction(async transaction => {
    const current = await transaction.get(after.ref)
    if (!current.exists || hasCurrentContractSalesIndex(current.data())) return { updated: 0 }
    transaction.update(current.ref, contractSalesIndexPatch(current.data()))
    return { updated: 1 }
  })
}

function scopedContracts(db, branchId) {
  const query = db.collection('contracts')
  return branchId === 'all' ? query : query.where('branchId', '==', branchId)
}
async function legacySalesRead(query, read, maximum, mode) {
  const snapshot = await read(query.select(...SALES_CONTRACT_FIELDS).limit(maximum + 1))
  return { docs: snapshot.docs.slice(0, maximum), scanned: snapshot.size, truncated: snapshot.size > maximum, mode }
}

async function readIndexedContractSales(transaction, base, input, maximum) {
  const read = reference => transaction.get(reference)
  const [total, indexed, exceptions] = await Promise.all([
    read(base.count()),
    read(base.where('financeSalesIndex.schemaVersion', '==', SALES_INDEX_VERSION).count()),
    read(base.where(SALES_INDEX_KEY, 'in', SALES_EXCEPTION_KEYS).select(...SALES_CONTRACT_FIELDS).limit(maximum + 1)),
  ])
  if (total.data().count !== indexed.data().count) return legacySalesRead(base, read, maximum, 'legacy_coverage')
  const remaining = maximum + 1 - exceptions.size
  const range = remaining > 0 ? await read(base.where(SALES_INDEX_KEY, '>=', input.startDate)
    .where(SALES_INDEX_KEY, '<=', input.endDate).orderBy(SALES_INDEX_KEY)
    .select(...SALES_CONTRACT_FIELDS).limit(remaining)) : { docs: [] }
  const docs = [...range.docs, ...exceptions.docs]
  if (docs.some(item => !hasCurrentContractSalesIndex(item.data()))) return legacySalesRead(base, read, maximum, 'legacy_stale')
  return { docs: docs.slice(0, maximum), scanned: docs.length, truncated: docs.length > maximum, mode: 'indexed',
    coverageContracts: total.data().count }
}

async function readContractSalesRange(db, input, maximum = 2000, { forceLegacy = false } = {}) {
  const base = scopedContracts(db, input.branchId)
  if (forceLegacy) return legacySalesRead(base, query => query.get(), maximum, 'legacy_audit')
  try {
    // Counts and range queries share a read-only snapshot. A legacy create
    // racing this read cannot slip between the completeness guard and range.
    return await db.runTransaction(async transaction => {
      const read = reference => transaction.get(reference)
      const gate = (await read(db.doc(SALES_INDEX_GATE))).data()
      if (gate?.schemaVersion !== SALES_INDEX_VERSION || gate.status !== 'ready' || gate.enabled !== true) {
        return legacySalesRead(base, read, maximum, 'legacy_gate')
      }
      return readIndexedContractSales(transaction, base, input, maximum)
    }, { readOnly: true })
  } catch (error) {
    // A rolling index deployment must retain the old correct report.
    if (![9, 'failed-precondition'].includes(error?.code)) throw error
    return legacySalesRead(base, query => query.get(), maximum, 'legacy_index')
  }
}

module.exports = { SALES_INDEX_VERSION, SALES_INDEX_GATE, SALES_INDEX_KEY, SALES_EXCEPTION_KEYS, SALES_CONTRACT_FIELDS,
  contractSalesDateKey, contractSalesIndex, contractSalesIndexPatch, hasCurrentContractSalesIndex,
  syncContractSalesIndex, readContractSalesRange, readIndexedContractSales }
