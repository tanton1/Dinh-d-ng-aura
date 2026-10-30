'use strict'

// Uses the existing period snapshots only. An absent match is not proof that a
// posting is missing globally; the entry may belong to a different period.
function attendanceReconciliation(attendance, ledger) {
  const byId = new Map(), byEvidence = new Map(), bySession = new Map()
  const add = (map, key, row) => { if (key) map.set(key, [...(map.get(key) || []), row]) }
  for (const entry of ledger) {
    if (entry.type !== 'revenue_recognition' || entry.status !== 'posted'
      || !(entry.source === 'pt_gym' || (!entry.source && entry.contractId))) continue
    byId.set(entry.id, entry)
    add(byEvidence, entry.attendanceEventId, entry)
    add(bySession, entry.sessionId, entry)
  }
  const groups = new Map()
  for (const row of attendance) add(groups, row.chargeId || row.sessionId || `event:${row.id}`, row)
  const result = { schemaVersion: 1, evidenceCount: groups.size, matchedInPeriod: 0, pendingConfirmation: 0,
    automaticReview: 0, billingReview: 0, recognitionReview: 0, exempt: 0, unresolved: 0, conflicts: 0,
    missingBranch: 0, posted: 0, verifiedMissingPosting: null }
  for (const rows of groups.values()) {
    if (rows.some(row => !row.branchId || row.branchId === 'all')) result.missingBranch++
    const statuses = new Set(rows.map(row => [row.billingStatus || '', row.attendanceStatus || '', row.confirmationSource || ''].join('|')))
    let conflict = statuses.size > 1
    const candidates = new Map()
    for (const row of rows) {
      const direct = byId.get(row.revenueRecognitionEntryId)
      const entries = direct ? [direct] : [...(byEvidence.get(row.id) || []), ...(bySession.get(row.chargeId || row.sessionId) || [])]
      for (const entry of entries) {
        // A sourceSessionId alone refers to the original booking, not this charge.
        if (entry.sourceSessionId && !row.chargeId && entry.attendanceEventId !== row.id && entry.id !== row.revenueRecognitionEntryId) continue
        if ((row.contractId && entry.contractId && row.contractId !== entry.contractId)
          || (row.studentId && entry.studentId && row.studentId !== entry.studentId)) { conflict = true; continue }
        candidates.set(entry.id, entry)
      }
    }
    if (candidates.size > 1) conflict = true
    if (conflict) { result.conflicts++; continue }
    if (candidates.size === 1) result.matchedInPeriod++
    const row = rows[0]
    if (row.billingStatus === 'exempt' || (row.type === 'cancelled' && row.countsTowardContract === false)) result.exempt++
    else if (row.billingStatus === 'review_required') result.billingReview++
    else if (row.attendanceStatus === 'pending' || row.type === 'pending_confirmation') result.pendingConfirmation++
    else if (row.confirmationSource === 'auto_after_48h') result.automaticReview++
    else if (row.recognitionReviewRequired === true || row.revenueRecognitionState === 'review_required') result.recognitionReview++
    else if (candidates.size === 1) result.posted++
    else result.unresolved++
  }
  return result
}

module.exports = { attendanceReconciliation }
