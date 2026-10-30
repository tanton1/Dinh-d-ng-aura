'use strict'

const { HttpsError } = require('firebase-functions/v2/https')
const { FieldValue } = require('firebase-admin/firestore')

function reject(reason, message) {
  throw new HttpsError('failed-precondition', message, { reason })
}

function assertCancellationCashRequest({ contract, type, amount, installmentId, expectedSettlementRevision }) {
  const summary = contract.cancellationSettlement
  if (type === 'reversal') reject('contract-settlement-reversal-blocked', 'Hợp đồng đã hủy cần được đối soát riêng trước khi đảo phiếu thu. Không thể đảo trực tiếp phương án thanh lý.')
  if (!summary || summary.schemaVersion !== 1 || summary.status !== 'approved') {
    reject('contract-settlement-required', 'Hợp đồng đã hủy chỉ được thu hoặc hoàn theo phương án thanh lý đã duyệt.')
  }
  if (!Number.isSafeInteger(summary.revision) || summary.revision < 0 || summary.revision >= Number.MAX_SAFE_INTEGER
    || !Number.isSafeInteger(expectedSettlementRevision) || summary.revision !== expectedSettlementRevision) {
    reject('contract-settlement-revision-changed', 'Phương án thanh lý đã thay đổi. Hãy tải lại trước khi thu hoặc hoàn tiền.')
  }
  if (installmentId) reject('contract-settlement-installment', 'Thu hoặc hoàn thanh lý không gắn với kỳ trả góp cũ.')
  if (!['payment', 'refund'].includes(type) || !Number.isSafeInteger(amount) || amount <= 0) {
    reject('contract-settlement-invalid-cash', 'Giao dịch thanh lý không hợp lệ.')
  }
  return summary
}

function settlementCashPlan(input) {
  const { contract, caseData, evidence, type, amount } = input
  const summary = assertCancellationCashRequest(input)
  const fields = ['revision', 'settlementAmount', 'recognizedRevenueAfterAdjustments', 'writeOffAmount', 'serviceEvidenceHash', 'cutoffDate']
  if (!caseData || caseData.schemaVersion !== 1 || caseData.status !== 'approved' || fields.some(field => caseData[field] !== summary[field])) {
    reject('contract-settlement-inconsistent', 'Hồ sơ thanh lý chưa đồng bộ. Cần đối soát trước khi thu hoặc hoàn tiền.')
  }
  const settlementAmount = summary.settlementAmount
  const recognizedRevenue = summary.recognizedRevenueAfterAdjustments
  const writeOffAmount = summary.writeOffAmount
  if (![settlementAmount, recognizedRevenue, writeOffAmount].every(value => Number.isSafeInteger(value) && value >= 0)
    || recognizedRevenue - writeOffAmount !== settlementAmount || !summary.serviceEvidenceHash) {
    reject('contract-settlement-inconsistent', 'Số liệu phương án thanh lý không hợp lệ.')
  }
  const paidAmount = Number(contract.paidAmount || 0)
  if (!Number.isSafeInteger(paidAmount) || paidAmount < 0 || evidence.canonicalCash !== paidAmount) {
    reject('contract-settlement-cash-mismatch', 'Tiền đã thu chưa khớp sổ giao dịch. Cần đối soát trước khi thu hoặc hoàn thanh lý.')
  }
  if (evidence.blockers?.length || evidence.serviceEvidenceHash !== summary.serviceEvidenceHash
    || evidence.recognizedRevenue !== recognizedRevenue) {
    reject('contract-settlement-evidence-changed', 'Bằng chứng thanh lý đã thay đổi hoặc còn lỗi đối soát. Cần rà soát lại phương án đã duyệt.')
  }
  const maximum = type === 'payment' ? Math.max(0, settlementAmount - paidAmount) : Math.max(0, paidAmount - settlementAmount)
  if (amount > maximum) reject('contract-settlement-cash-limit', 'Số tiền vượt phần còn phải thu hoặc phải hoàn theo phương án thanh lý.')
  const nextPaidAmount = paidAmount + (type === 'payment' ? amount : -amount)
  const monetaryPatch = {
    revision: summary.revision + 1,
    canonicalCash: nextPaidAmount,
    paidProjection: nextPaidAmount,
    remainingReceivable: Math.max(0, settlementAmount - nextPaidAmount),
    refundDue: Math.max(0, nextPaidAmount - settlementAmount),
  }
  return { recognizedReceivableTarget: settlementAmount, summary: { ...summary, ...monetaryPatch }, casePatch: monetaryPatch }
}

async function readSettlementCashPlan(transaction, db, input) {
  if (input.contract.status !== 'cancelled') {
    if (['pending_approval', 'approved', 'settled'].includes(input.contract.cancellationSettlement?.status)) {
      reject('contract-settlement-inconsistent', 'Trạng thái hợp đồng và hồ sơ thanh lý chưa đồng bộ.')
    }
    return null
  }
  const summary = assertCancellationCashRequest(input)
  const reference = db.doc(`contractSettlements/${input.contractId}`)
  const snapshot = await transaction.get(reference)
  // Load this bounded reader only for cancelled-contract financial settlement.
  const { readSettlementEvidence } = require('./contract-settlement')
  const evidence = await readSettlementEvidence(transaction, db, input.contractId, input.contract, summary.cutoffDate)
  return { ...settlementCashPlan({ ...input, caseData: snapshot.exists ? snapshot.data() : null, evidence }), reference }
}

function writeSettlementCashProgress(transaction, plan, entryId, actorUid) {
  if (!plan) return {}
  const audit = { lastCashEntryId: entryId, updatedAt: FieldValue.serverTimestamp(), updatedBy: actorUid }
  transaction.update(plan.reference, { ...plan.casePatch, ...audit })
  return { cancellationSettlement: { ...plan.summary, ...audit } }
}

async function assertContractPaymentReversalAllowed(transaction, db, contractId, contract) {
  const summary = contract.cancellationSettlement
  if (contract.status !== 'cancelled' && !summary) return
  const snapshot = await transaction.get(db.doc(`contractSettlements/${contractId}`))
  const states = [...(summary ? [summary.status] : []), ...(snapshot.exists ? [snapshot.data().status] : [])]
  if (states.some(status => status !== 'review_required')) {
    reject('contract-settlement-reversal-blocked', 'Phương án thanh lý đã gửi duyệt hoặc đã duyệt. Hãy rút phương án về đối soát trước khi sửa phiếu thu; không thể đảo phương án đã chốt.')
  }
}

module.exports = { settlementCashPlan, readSettlementCashPlan, writeSettlementCashProgress, assertContractPaymentReversalAllowed }
