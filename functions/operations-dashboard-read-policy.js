'use strict'

// Apply authorization scope before the limit. Filtering a capped global query
// both bills unrelated documents and can hide the actor's own rows.
function branchReadScope(scope) {
  // Older imported records may omit branchId. Firestore equality with null
  // does not include missing fields, so retain the bounded legacy fallback.
  if (scope.unrestricted || scope.branchId === 'none') return null
  return { field: 'branchId', ids: [...new Set(scope.branchIds)] }
}

async function readDashboardQuery(query, scope, maximum, fields = []) {
  const projected = fields.length ? query.select(...fields) : query
  if (!scope) return projected.limit(maximum).get()
  const ids = [...new Set(scope.ids)].filter(Boolean)
  if (!ids.length) return { docs: [], size: 0, empty: true }
  const documents = new Map()
  for (let offset = 0; offset < ids.length && documents.size < maximum; offset += 30) {
    const group = ids.slice(offset, offset + 30)
    // Scope chunks are disjoint for scalar branchId/trainerId fields. Spend
    // only the remaining global budget, including the caller's sentinel row,
    // instead of reading `maximum` documents from every authorized chunk.
    const snapshot = await projected.where(scope.field, group.length === 1 ? '==' : 'in', group.length === 1 ? group[0] : group).limit(maximum - documents.size).get()
    snapshot.docs.forEach((item) => documents.set(item.id, item))
  }
  const docs = [...documents.values()]
  return { docs, size: docs.length, empty: docs.length === 0 }
}

const DASHBOARD_FIELDS = {
  contracts: ['branchId', 'status', 'totalPrice', 'discount', 'paidAmount', 'installments', 'nextPaymentDate', 'studentId', 'studentName', 'studentPhone', 'packageId', 'packageName', 'startDate', 'endDate', 'totalSessions', 'usedSessions', 'carryOverTransferredSessions', 'pausePeriods', 'signedAt', 'createdAt', 'contractDate'],
  students: ['branchId', 'status', 'name', 'fullName', 'phone', 'joinDate', 'createdAt'],
  trainers: ['branchId', 'status', 'name', 'fullName'],
  staff: ['branchId', 'status'],
  sessions: ['branchId', 'date', 'status', 'studentId', 'trainerId', 'hour', 'attendanceStatus', 'billingStatus'],
  branches: ['name', 'branchName', 'status'],
}

module.exports = { branchReadScope, readDashboardQuery, DASHBOARD_FIELDS }
