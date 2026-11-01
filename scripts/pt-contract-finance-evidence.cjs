'use strict'

// Plan only: infer missing historical debit ordinals only when the complete
// contract history, stored usage and every surviving ordinal agree. Never
// infer a new attendance confirmation or an extra learner debit.
const assert = require('node:assert/strict')
const { canonicalUsageSessions, sessionCountsTowardContract } = require('../functions/contract-usage-core')
const { recognitionForServiceOrdinal } = require('../functions/finance-recognition')

function contractFinanceEvidence({ contractId, contract, sessions, billings, attendance, ledger, reviews = [], returns = [] }) {
  assert(['active', 'future', 'frozen', 'expired'].includes(contract.status), 'Contract status needs separate review')
  assert(!contract.revenueAllocation && !contract.amendmentHistory?.length && !Number(contract.carriedOverSessions || 0)
    && !Number(contract.carryOverTransferredSessions || 0) && !contract.renewalSupersededBy && !contract.renewedByContractId
    && !contract.cancellationSettlement, 'Amended, cancelled or transferred contracts need a separate allocation review')
  assert(returns.length === 0, 'Returned services need a separate ordinal review')
  const used = canonicalUsageSessions(sessions).filter(sessionCountsTowardContract)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || Number(a.hour) - Number(b.hour) || a.id.localeCompare(b.id))
  assert(Number.isSafeInteger(contract.usedSessions) && used.length === contract.usedSessions, 'Stored usage does not prove canonical debits')
  assert(used.length > 0 && used.length <= contract.totalSessions && used.length <= 100, 'Contract repair bound exceeded')
  assert.equal(sessions.filter(sessionCountsTowardContract).length, used.length, 'Active duplicate debits require separate review')
  const usedIds = new Set(used.map(s => s.id))
  const revenue = ledger.filter(l => ['posted', 'reversed'].includes(l.status) && Number(l.revenueImpact ?? (l.type === 'revenue_recognition' ? l.amount : 0)))
  for (const l of revenue) assert(l.type === 'revenue_recognition' && l.status === 'posted' && usedIds.has(l.sessionId)
    && Number(l.revenueImpact ?? l.amount) > 0, 'Unlinked or reversed revenue requires separate review')
  const charges = used.map((session, index) => {
    assert(session.studentId === contract.studentId && session.contractId === contractId, 'Session identity mismatch')
    assert(/^\d{4}-\d{2}-\d{2}$/.test(session.date) && session.date >= contract.startDate && session.date <= contract.endDate, 'Session date outside contract')
    assert(Number.isInteger(session.hour) && session.hour >= 0 && session.hour <= 23 && session.trainerId, 'Session slot evidence missing')
    const receipts = billings.filter(b => (b.sessionId || b.id) === session.id)
    const evidence = attendance.filter(a => a.sessionId === session.id && (!a.chargeId || a.chargeId === session.id))
    const entries = revenue.filter(l => l.sessionId === session.id)
    assert(receipts.length <= 1 && evidence.length <= 1 && entries.length <= 1, 'Ambiguous source evidence')
    const billing = receipts[0], event = evidence[0], entry = entries[0], ordinal = index + 1
    if (billing) assert.equal(billing.billingStatus, 'charged', 'Returned or exempt charge requires separate review')
    if (!billing) assert(!session.billingStatus && ['completed', 'attended', 'no_show'].includes(session.status), 'Missing receipt is not a proven legacy debit')
    for (const row of [billing, event, entry].filter(Boolean)) {
      assert((!row.studentId || row.studentId === contract.studentId) && (!row.contractId || row.contractId === contractId), 'Linked evidence identity mismatch')
    }
    for (const row of [session, billing, event, entry].filter(Boolean)) if (row.serviceOrdinal != null) {
      assert.equal(row.serviceOrdinal, ordinal, 'Chronology conflicts with an existing service ordinal')
    }
    if (event) assert(!event.billingStatus || event.billingStatus === 'charged', 'Attendance billing lifecycle conflicts')
    const amount = recognitionForServiceOrdinal(contract, ordinal)
    assert(Number.isSafeInteger(amount) && amount > 0, 'Invalid historical unit price')
    if (entry) assert.equal(Number(entry.revenueImpact ?? entry.amount), amount, 'Existing revenue amount must be preserved')
    return { sessionId: session.id, ordinal, amount, createBilling: !billing, attendanceId: event?.id || session.id, createEvidence: !event,
      existingRevenueId: entry?.id || null, missingRevenue: !entry }
  })
  const duplicates = billings.filter(b => b.billingStatus === 'charged' && !usedIds.has(b.sessionId || b.id)).map(billing => {
    const sessionId = billing.sessionId || billing.id, session = sessions.find(s => s.id === sessionId)
    assert(session && session.status === 'cancelled' && session.billingStatus === 'exempt' && session.duplicateRepairVersion === 1,
      'Orphan charge is not a verified historical duplicate repair')
    const winners = used.filter(s => s.studentId === session.studentId && s.contractId === session.contractId
      && s.trainerId === session.trainerId && s.date === session.date && s.hour === session.hour)
    assert.equal(winners.length, 1, 'Canonical duplicate winner is ambiguous')
    assert.equal(billing.contractId, contractId); assert.equal(billing.studentId, contract.studentId)
    const events = attendance.filter(a => a.sessionId === sessionId)
    assert(events.length <= 1 && events.every(a => a.billingStatus === 'exempt'), 'Duplicate attendance is not exempt')
    return { sessionId, billingId: billing.id, canonicalSessionId: winners[0].id, attendanceId: events[0]?.id || null }
  })
  for (const r of reviews) if (!['resolved', 'closed', 'dismissed'].includes(r.status)) {
    assert(usedIds.has(r.sessionId || r.id) && r.issueCode === 'AUTO_CONFIRMATION_REQUIRES_REVIEW', 'Unrelated financial review remains open')
  }
  return { used: used.length, charges, duplicates, newBillingCount: charges.filter(c => c.createBilling).length,
    newEvidenceCount: charges.filter(c => c.createEvidence).length, missingRevenueCount: charges.filter(c => c.missingRevenue).length,
    additionalRevenue: charges.filter(c => c.missingRevenue).reduce((sum, c) => sum + c.amount, 0),
    expectedRevenue: charges.reduce((sum, c) => sum + c.amount, 0) }
}

module.exports = { contractFinanceEvidence }
