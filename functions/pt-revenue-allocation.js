'use strict'

const { HttpsError } = require('firebase-functions/v2/https')

function fail() {
  throw new HttpsError('failed-precondition', 'Cần đối soát giá trị buổi chuyển tiếp trước khi tính thêm buổi.', { issueCode: 'RECOGNITION_CARRY_VALUE_REQUIRES_REVIEW' })
}

// A segment retains the selling contract and its original integer rounding.
// Its position in this list is the entitlement ordinal in the consuming contract.
function revenueSegments(contractId, contract) {
  const count = Number(contract.totalSessions)
  if (!Number.isSafeInteger(count) || count < 1 || count > 5000) fail()
  if (!contract.revenueAllocation) {
    if (Number(contract.carriedOverSessions || 0) > 0) fail()
    return [{ contractId, startOrdinal: 1, count, totalSessions: count,
      totalPrice: contract.totalPrice ?? null, discount: contract.discount ?? 0 }]
  }
  const { version, segments } = contract.revenueAllocation
  if (version !== 1 || !Array.isArray(segments) || !segments.length || segments.length > 100) fail()
  const identities = new Set()
  let total = 0
  for (const row of segments) {
    if (!/^[A-Za-z0-9_-]+$/.test(row.contractId || '')
      || ![row.startOrdinal, row.count, row.totalSessions].every(v => Number.isSafeInteger(v) && v > 0)
      || row.startOrdinal + row.count - 1 > row.totalSessions
      || row.totalSessions > 5000) fail()
    for (let n = row.startOrdinal; n < row.startOrdinal + row.count; n++) {
      const key = `${row.contractId}:${n}`
      if (identities.has(key)) fail()
      identities.add(key)
    }
    total += row.count
  }
  if (total !== count) fail()
  return segments.map(row => ({ ...row }))
}

function allocationForOrdinal(contractId, contract, ordinal) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > Number(contract.totalSessions)) fail()
  let offset = 0
  for (const segment of revenueSegments(contractId, contract)) {
    if (ordinal <= offset + segment.count) return { ...segment, serviceOrdinal: segment.startOrdinal + ordinal - offset - 1 }
    offset += segment.count
  }
  fail()
}

function renewalRevenueAllocation({ sourceId, source, nextId, next, carriedOverSessions }) {
  const segments = []
  const used = Number(source?.usedSessions || 0)
  const carry = Number(carriedOverSessions || 0)
  if (!Number.isSafeInteger(carry) || carry < 0 || !Number.isSafeInteger(used) || used < 0) fail()
  if (carry) {
    if (!source || source.studentId !== next.studentId || Number(source.carryOverTransferredSessions || 0) > 0) fail()
    const occupied = new Set(source.revenueOccupiedOrdinals || Array.from({ length: used }, (_, i) => i + 1))
    // Legacy projections can include older sessions without canonical billing.
    // They still reserve their shares, and cannot silently become free credits.
    for (let n = 1; occupied.size < used && n <= Number(source.totalSessions); n++) occupied.add(n)
    for (let n = 1; n <= Number(source.totalSessions) && segments.reduce((s, row) => s + row.count, 0) < carry; n++) {
      if (occupied.has(n)) continue
      const allocation = allocationForOrdinal(sourceId, source, n)
      const previous = segments.at(-1)
      if (previous && previous.contractId === allocation.contractId
        && previous.startOrdinal + previous.count === allocation.serviceOrdinal) previous.count++
      else segments.push({ contractId: allocation.contractId, startOrdinal: allocation.serviceOrdinal, count: 1,
        totalSessions: allocation.totalSessions, totalPrice: allocation.totalPrice, discount: allocation.discount })
    }
    if (segments.reduce((sum, row) => sum + row.count, 0) !== carry) fail()
  }
  const ownCount = Number(next.packageSessions ?? (Number(next.totalSessions) - carry))
  if (!Number.isSafeInteger(ownCount) || ownCount < 1) fail()
  segments.push({ contractId: nextId, startOrdinal: 1, count: ownCount, totalSessions: ownCount,
    totalPrice: next.totalPrice ?? null, discount: next.discount ?? 0 })
  return { version: 1, segments }
}

async function resolveRevenueAllocation({ transaction, db, contractId, contract, serviceOrdinal }) {
  const allocation = allocationForOrdinal(contractId, contract, serviceOrdinal)
  const owner = allocation.contractId === contractId ? contract
    : (await transaction.get(db.doc(`contracts/${allocation.contractId}`))).data()
  if (!owner || owner.studentId !== contract.studentId) fail()
  // Price/quota edits cannot reprice credits that have already been allocated.
  const ownCount = Number(owner.totalSessions) - Number(owner.carriedOverSessions || 0)
  if (contract.revenueAllocation && (Number(owner.totalPrice) !== Number(allocation.totalPrice)
    || Number(owner.discount || 0) !== Number(allocation.discount || 0) || ownCount !== allocation.totalSessions)) fail()
  return { contractId: allocation.contractId, contract: { ...owner, totalSessions: allocation.totalSessions,
    totalPrice: allocation.totalPrice, discount: allocation.discount }, serviceOrdinal: allocation.serviceOrdinal,
    metadata: { entitlementContractId: contractId, entitlementOrdinal: serviceOrdinal,
      revenueAllocationVersion: 1, revenuePriceSnapshot: { totalPrice: allocation.totalPrice, discount: allocation.discount, totalSessions: allocation.totalSessions } } }
}

module.exports = { revenueSegments, allocationForOrdinal, renewalRevenueAllocation, resolveRevenueAllocation }
