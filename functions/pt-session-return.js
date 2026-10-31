'use strict'

const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { chargedRevenuePlan, applyRevenuePlan } = require('./pt-charged-revenue')
const { reversedJournalLines } = require('./accounting-core')

// A return is an explicit admin operation, never a side effect of editing
// attendance. Keep the original financial documents and append their reversal.
async function returnChargedSession({ db, sessionId, expectedRevision, actorUid, reason, assertCancellationEvidenceChange }) {
  const fail = (issueCode, message) => { throw new HttpsError('failed-precondition', message, { issueCode }) }
  return db.runTransaction(async transaction => {
    const sessionRef = db.doc(`sessions/${sessionId}`), attendanceRef = db.doc(`attendanceEvents/${sessionId}`)
    const billingRef = db.doc(`sessionBillingEvents/${sessionId}`), receiptRef = db.doc(`sessionReturns/${sessionId}`)
    const [sessionSnap, attendanceSnap, billingSnap, receipt] = await Promise.all([sessionRef, attendanceRef, billingRef, receiptRef].map(ref => transaction.get(ref)))
    if (receipt.exists) return { unchanged: true, returned: true, revisions: { [sessionId]: receipt.data().revision }, invalidatedPayrollPeriods: [] }
    if (!sessionSnap.exists || !attendanceSnap.exists || !billingSnap.exists) fail('SESSION_RETURN_EVIDENCE_MISSING', 'Cần đủ chứng từ tính buổi trước khi hoàn.')
    const session = sessionSnap.data(), attendance = attendanceSnap.data(), billing = billingSnap.data()
    if (Number(session.revision || 0) !== expectedRevision) throw new HttpsError('aborted', 'Buổi vừa thay đổi. Hãy tải lại trước khi hoàn.')
    if (session.billingStatus !== 'charged' || billing.billingStatus !== 'charged') fail('SESSION_NOT_CHARGED', 'Buổi này chưa bị trừ hoặc đã được hoàn.')
    const periodId = String(session.date || '').slice(0, 7)
    const contractRef = db.doc(`contracts/${session.contractId}`), payrollRef = db.doc(`payrollRuns/${periodId}`)
    const [contractSnap, payroll] = await Promise.all([transaction.get(contractRef), transaction.get(payrollRef)])
    if (!contractSnap.exists) fail('SESSION_CONTRACT_NOT_FOUND', 'Không tìm thấy hợp đồng của buổi.')
    const contract = contractSnap.data()
    if (billing.sessionId !== sessionId || billing.contractId !== session.contractId || attendance.sessionId !== sessionId
      || attendance.contractId !== session.contractId || (billing.studentId && billing.studentId !== session.studentId)
      || (attendance.studentId && attendance.studentId !== session.studentId)) fail('SESSION_RETURN_EVIDENCE_MISMATCH', 'Chứng từ trừ buổi không khớp học viên hoặc hợp đồng.')
    if (contract.studentId !== session.studentId || Number(contract.usedSessions || 0) < 1) fail('SESSION_RETURN_USAGE_MISMATCH', 'Số buổi đã dùng cần được đối soát trước khi hoàn.')
    if (contract.renewalSupersededBy || Number(contract.carryOverTransferredSessions || 0) > 0) fail('SESSION_RETURN_HANDOVER_REVIEW', 'Hợp đồng đã chuyển giao; cần đối soát quyền lợi của hợp đồng nối tiếp trước khi hoàn.')
    if (payroll.exists && payroll.data().status !== 'draft') fail('PAYROLL_RUN_IMMUTABLE', 'Kỳ lương đã chốt; cần điều chỉnh tại kỳ mở.')
    assertCancellationEvidenceChange({ contract, sourceDate: session.date, changed: true })
    const ordinal = Number(billing.serviceOrdinal || session.serviceOrdinal || attendance.serviceOrdinal)
    const plan = await chargedRevenuePlan({ transaction, db, sessionId, session, attendance, billing,
      contractId: session.contractId, contract, serviceOrdinal: ordinal, actorUid, strict: true })
    // Complete postings may legitimately survive a lock, but a new reversal may not.
    const period = await transaction.get(db.doc(`financePeriods/${periodId}`))
    if (period.exists && period.data().status === 'locked') fail('FINANCE_PERIOD_LOCKED', 'Kỳ tài chính đã khóa; cần điều chỉnh tại kỳ mở.')
    const entry = plan.value || (plan.zeroValueConfirmed ? { contractId: plan.allocation.contractId, amount: 0, revenueImpact: 0 } : null)
    if (!entry) fail('SESSION_RETURN_RECONCILIATION_REQUIRED', 'Cần xác minh giá trị buổi trước khi hoàn.')
    const journal = plan.value ? plan.journal || (await transaction.get(db.doc(`journalEntries/${plan.journalId}`))).data() : null
    const reversalRef = db.doc(`ledgerEntries/pt_return_${sessionId}`), reversalJournalRef = db.doc(`journalEntries/pt_return_${sessionId}`)
    const collisions = await Promise.all([transaction.get(reversalRef), transaction.get(reversalJournalRef)])
    if (collisions.some(row => row.exists)) fail('SESSION_RETURN_RECONCILIATION_REQUIRED', 'Chứng từ hoàn buổi cần được đối soát.')
    const revision = expectedRevision + 1
    const audit = { returnReason: reason, returnedAt: FieldValue.serverTimestamp(), returnedBy: actorUid }
    const reversal = { ...entry, type: 'adjustment', eventClass: 'revenue_recognition_reversal',
      amount: -Number(entry.amount), revenueImpact: -Number(entry.revenueImpact), cashImpact: 0, expenseImpact: 0,
      receivableImpact: -Number(entry.receivableImpact || 0), deferredRevenueImpact: -Number(entry.deferredRevenueImpact || 0),
      reversedEntryId: plan.entryId, journalEntryId: reversalJournalRef.id, idempotencyKey: `pt-session-return:${sessionId}`,
      status: 'posted', ...audit, createdAt: FieldValue.serverTimestamp(), createdBy: actorUid }
    applyRevenuePlan(transaction, plan)
    if (plan.value) {
    transaction.create(reversalRef, reversal)
    transaction.create(reversalJournalRef, { ...journal, documentType: 'pt_revenue_recognition_reversal', documentId: reversalRef.id,
      lines: reversedJournalLines(journal.lines), reversedJournalEntryId: plan.journalId,
      ...audit, status: 'posted', createdAt: FieldValue.serverTimestamp(), createdBy: actorUid })
    transaction.update(db.doc(`ledgerEntries/${plan.entryId}`), { status: 'reversed', reversalEntryId: reversalRef.id,
      reversedAt: FieldValue.serverTimestamp(), reversedBy: actorUid })
    }
    transaction.update(billingRef, { billingStatus: 'returned', returnId: receiptRef.id, ...audit })
    const patch = { billingStatus: 'exempt', countsTowardContract: false, revenueRecognitionState: 'reversed',
      revenueRecognitionEntryId: plan.entryId, revenueReversalEntryId: plan.value ? reversalRef.id : null,
      recognitionReviewRequired: false, recognitionReviewIssueCode: null, ...audit, updatedAt: FieldValue.serverTimestamp() }
    transaction.update(attendanceRef, patch)
    transaction.update(sessionRef, { ...patch, status: 'cancelled', scheduleStatus: 'cancelled', revision, updatedBy: actorUid })
    transaction.update(contractRef, { usedSessions: Number(contract.usedSessions) - 1,
      chargedSessionIds: FieldValue.arrayRemove(sessionId), attendedClasses: FieldValue.arrayRemove(sessionId),
      revision: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() })
    if (payroll.exists) transaction.update(payrollRef, { requiresRebuild: true, sourceDataStale: true,
      sourceDataChangedBy: actorUid, sourceDataChangedAt: FieldValue.serverTimestamp(), sourceDataChangeReason: reason })
    transaction.create(receiptRef, { schemaVersion: 1, sessionId, contractId: session.contractId,
      revenueContractId: entry.contractId, originalEntryId: plan.entryId, reversalEntryId: plan.value ? reversalRef.id : null,
      returnedSessions: 1, revenueReversed: Number(entry.revenueImpact), beforeUsed: Number(contract.usedSessions),
      afterUsed: Number(contract.usedSessions) - 1, revision, ...audit })
    transaction.create(db.collection('sessionEvents').doc(), { schemaVersion: 2, type: 'charged_session_returned', sessionId,
      contractId: session.contractId, reason, reversalEntryId: plan.value ? reversalRef.id : null, createdBy: actorUid, createdAt: FieldValue.serverTimestamp() })
    return { unchanged: false, returned: true, revisions: { [sessionId]: revision }, invalidatedPayrollPeriods: payroll.exists ? [periodId] : [] }
  })
}

module.exports = { returnChargedSession }
