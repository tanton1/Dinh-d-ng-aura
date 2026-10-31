'use strict'

const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { ptRevenueRecognitionWrite, contractNetValue } = require('./finance-recognition')
const { recognitionEvidenceIssue, recognitionBalanceIssue } = require('./finance-recognition-evidence')
const { readContractRecognitionState } = require('./finance-recognition-balance')
const { resolveRevenueAllocation } = require('./pt-revenue-allocation')
const { ptFinanceBranch } = require('./pt-finance-branch')
const { serviceRevenueJournal } = require('./accounting-core')
const { zeroValueEvidenceKey } = require('./pt-zero-value-evidence')

function ptRevenueJournalWrite({ recognition, contract, sessionId, actorUid }) {
  const advanceAccountCode = ['131', '3387'].includes(contract?.accountingAdvanceAccountCode) ? contract.accountingAdvanceAccountCode : '131'
  const journal = serviceRevenueJournal({ amount: recognition.amount,
    paidAllocation: Math.max(0, -Number(recognition.deferredRevenueImpact || 0)), advanceAccountCode })
  return { schemaVersion: 1, documentType: 'pt_revenue_recognition', documentId: `pt_session_${sessionId}`,
    referenceCode: `DT-PT-${String(sessionId).slice(0, 20).toUpperCase()}`, branchId: recognition.branchId || '',
    effectiveAt: recognition.effectiveAt, lines: journal.lines, totalDebit: journal.totalDebit, totalCredit: journal.totalCredit,
    status: 'posted', createdAt: FieldValue.serverTimestamp(), createdBy: actorUid }
}

function entryMatchesCharge(value, sessionId, contractId) {
  return value.type === 'revenue_recognition' && value.status === 'posted' && value.sessionId === sessionId
    && (value.entitlementContractId || value.contractId) === contractId
}

// Read/prepare first. The caller commits these writes with the deduction or
// its existing evidence; this function never changes attendance or usage.
async function chargedRevenuePlan({ transaction, db, sessionId, session, attendance = {}, billing = {},
  contractId, contract, serviceOrdinal, actorUid, strict = false, knownState = null, pendingByContract = null }) {
  const entryId = session.revenueRecognitionEntryId || attendance.revenueRecognitionEntryId || `pt_session_${sessionId}`
  if (!/^[A-Za-z0-9_-]+$/.test(entryId)) throw new HttpsError('failed-precondition', 'Mã bút toán doanh thu không hợp lệ.')
  const reference = db.doc(`ledgerEntries/${entryId}`), journalReference = db.doc(`journalEntries/${entryId}`)
  const reviewReference = db.doc(`revenueRecognitionReviews/${sessionId}`)
  const periodId = String(session.date || '').slice(0, 7)
  const [existing, existingJournal, review, period] = await Promise.all([
    transaction.get(reference), transaction.get(journalReference), transaction.get(reviewReference),
    transaction.get(db.doc(`financePeriods/${periodId}`)),
  ])
  let value = existing.exists ? existing.data() : null
  if ((value && !entryMatchesCharge(value, sessionId, contractId)) || (!value && existingJournal.exists)) {
    throw new HttpsError('failed-precondition', 'Bút toán doanh thu không khớp bằng chứng trừ buổi.', { issueCode: 'SESSION_RECOGNITION_MISMATCH' })
  }
  const writes = []
  let issue = '', allocation = null, recognition = null, journal = null, zeroValueConfirmed = false
  const complete = Boolean(value && existingJournal.exists)
  const locked = period.exists && period.data().status === 'locked'
  if (!complete && locked && !session.zeroValueApproval?.evidenceKey) issue = 'FINANCE_PERIOD_LOCKED'
  if (!value && !issue) {
    // Financial owner is resolved separately; validate the consuming identity
    // and quota before applying the original selling price to a carried share.
    issue = recognitionEvidenceIssue({ sessionId, session: { ...session, contractId }, attendance, billing, contract, serviceOrdinal, validateValue: false })
    if (!issue && billing.billingStatus && billing.billingStatus !== 'charged') issue = 'RECOGNITION_BILLING_NOT_CHARGED'
    if (!issue) {
      try { allocation = await resolveRevenueAllocation({ transaction, db, contractId, contract, serviceOrdinal }) }
      catch (error) { if (!error.details?.issueCode) throw error; issue = error.details.issueCode }
    }
    if (allocation) {
      issue = recognitionEvidenceIssue({ sessionId, session: { ...session, contractId: allocation.contractId },
        contract: allocation.contract, serviceOrdinal: allocation.serviceOrdinal })
      if (issue === 'RECOGNITION_ZERO_VALUE_REQUIRES_REVIEW' && session.zeroValueApproval?.evidenceKey ===
        zeroValueEvidenceKey({ sessionId, contractId, serviceOrdinal, allocation })) {
        const state = await readContractRecognitionState(transaction, db, allocation.contractId)
        issue = recognitionBalanceIssue({ state, sessionId, serviceOrdinal: allocation.serviceOrdinal, amount: 0, netValue: 0 })
        zeroValueConfirmed = !issue
      }
      if (!issue && !zeroValueConfirmed) {
        const state = knownState && allocation.contractId === contractId ? knownState
          : await readContractRecognitionState(transaction, db, allocation.contractId)
        const pending = pendingByContract?.get(allocation.contractId)
        const combined = pending ? { recognizedRevenue: state.recognizedRevenue + pending.recognizedRevenue,
          revenueBySession: new Map(state.revenueBySession), revenueByOrdinal: new Map([...state.revenueByOrdinal].map(([key, rows]) => [key, new Map(rows)])) } : state
        if (pending) {
          for (const [key, amount] of pending.revenueBySession) combined.revenueBySession.set(key, (combined.revenueBySession.get(key) || 0) + amount)
          for (const [key, rows] of pending.revenueByOrdinal) {
            const combinedRows = combined.revenueByOrdinal.get(key) || new Map()
            for (const [id, amount] of rows) combinedRows.set(id, (combinedRows.get(id) || 0) + amount)
            combined.revenueByOrdinal.set(key, combinedRows)
          }
        }
        recognition = ptRevenueRecognitionWrite({ sessionId, session, contractId: allocation.contractId, contract: allocation.contract,
          attendanceEventId: attendance.id || sessionId, actorUid, serviceOrdinal: allocation.serviceOrdinal,
          recognisedRevenueBefore: combined.recognizedRevenue, evidenceStatus: attendance.attendanceStatus || session.attendanceStatus || 'pending',
          confirmationSource: attendance.confirmationSource || session.confirmationSource || 'session_charge' })
        if (recognition) {
          issue = recognitionBalanceIssue({ state: combined, sessionId, serviceOrdinal: allocation.serviceOrdinal,
            amount: recognition.revenueImpact, netValue: contractNetValue(allocation.contract) })
          if (!issue) recognition = { ...recognition, ...allocation.metadata, journalEntryId: journalReference.id }
        } else issue = 'RECOGNITION_AMOUNT_UNAVAILABLE'
        if (issue) recognition = null
      }
    }
  }
  if (!complete && locked && !zeroValueConfirmed) { issue = 'FINANCE_PERIOD_LOCKED'; recognition = null }
  value = recognition || value
  if (!issue && value && !existingJournal.exists) {
    let owner = allocation?.contract || contract
    if (!allocation && value.contractId !== contractId) {
      const ownerSnapshot = await transaction.get(db.doc(`contracts/${value.contractId}`))
      if (!ownerSnapshot.exists || ownerSnapshot.data().studentId !== session.studentId) issue = 'RECOGNITION_CONTRACT_MISSING_OR_MISMATCHED'
      else owner = ownerSnapshot.data()
    }
    if (!issue) journal = ptRevenueJournalWrite({ recognition: value, contract: owner, sessionId, actorUid })
  }
  if (strict && (issue || (!value && !zeroValueConfirmed))) throw new HttpsError('failed-precondition', 'Chưa thể tính buổi vì doanh thu chưa đủ điều kiện ghi nhận. Dữ liệu chưa thay đổi.', { issueCode: issue || 'RECOGNITION_AMOUNT_UNAVAILABLE' })
  if (recognition) writes.push({ type: 'create', reference, data: recognition })
  if (journal) writes.push({ type: 'create', reference: journalReference, data: journal })
  const patch = { branchId: ptFinanceBranch(session, contract) || ptFinanceBranch(attendance),
    revenueRecognitionState: issue ? 'review_required' : value ? 'posted' : zeroValueConfirmed ? 'zero_value_confirmed' : 'not_applicable',
    revenueRecognitionEntryId: value ? entryId : null,
    revenueRecognitionJournalId: journal || existingJournal.exists ? journalReference.id : null,
    recognitionReviewRequired: Boolean(issue), recognitionReviewIssueCode: issue || null,
    ...(value ? { revenueContractId: value.contractId, revenueServiceOrdinal: value.serviceOrdinal } : {}),
    ...(zeroValueConfirmed ? { zeroValueApproval: session.zeroValueApproval, revenueContractId: allocation.contractId, revenueServiceOrdinal: allocation.serviceOrdinal } : {}) }
  if (issue && (!review.exists || review.data().status !== 'open' || review.data().issueCode !== issue)) {
    writes.push({ type: review.exists ? 'update' : 'create', reference: reviewReference, data: {
      schemaVersion: 1, status: 'open', issueCode: issue, sessionId, attendanceEventId: attendance.id || sessionId, contractId,
      studentId: session.studentId || '', trainerId: session.trainerId || '', branchId: patch.branchId,
      serviceOrdinal: Number.isSafeInteger(serviceOrdinal) ? serviceOrdinal : null, financePeriodId: periodId,
      evidenceStatus: attendance.attendanceStatus || session.attendanceStatus || 'pending',
      updatedAt: FieldValue.serverTimestamp(), updatedBy: actorUid,
      ...(!review.exists ? { createdAt: FieldValue.serverTimestamp(), createdBy: actorUid } : {}),
    } })
  } else if (!issue && review.exists && review.data().status !== 'resolved') {
    writes.push({ type: 'update', reference: reviewReference, data: { status: 'resolved', resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy: actorUid, resolution: 'charged_session_reconciled' } })
  }
  return { writes, patch, recognition, journal, value, allocation, issue, zeroValueConfirmed, entryId: value ? entryId : null,
    journalId: patch.revenueRecognitionJournalId, createdRevenue: recognition?.revenueImpact || 0,
    createdServiceOrdinal: recognition?.serviceOrdinal, revenueContractId: value?.contractId || contractId }
}

function applyRevenuePlan(transaction, plan) {
  for (const write of plan.writes) transaction[write.type](write.reference, write.data)
}

module.exports = { ptRevenueJournalWrite, entryMatchesCharge, chargedRevenuePlan, applyRevenuePlan }
