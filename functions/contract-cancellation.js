'use strict'

const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { readCancellationSchedulePlan, applyCancellationSchedulePlan } = require('./session-operations')
const { contractSalesContribution } = require('./contract-financial-status')

function cancellationSalesSnapshot(contract, capturedAt) {
  const contribution = contractSalesContribution(contract)
  if (!contribution?.effectiveAt) return null
  const value = contribution.effectiveAt
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  // Preserve the source representation. Date-key strings and Firestore
  // timestamps have different reporting-day semantics; converting a timestamp
  // to an ISO string can move an evening sale into the previous Vietnam day.
  return { schemaVersion: 1, netAmount: contribution.amount, effectiveAt: value, capturedAt }
}

async function readContractCancellationPlan({ transaction, db, contractId, contract, cutoffDate }) {
  const [sessions, requests, leaveRequests] = await Promise.all([
    transaction.get(db.collection('sessions').where('contractId', '==', contractId).limit(501)),
    transaction.get(db.collection('sessionRequests').where('studentId', '==', contract.studentId).limit(201)),
    transaction.get(db.collection('leaveRequests').where('studentId', '==', contract.studentId).limit(201)),
  ])
  if (sessions.size > 500 || requests.size > 200 || leaveRequests.size > 200) throw new HttpsError('resource-exhausted', 'Lịch sử vượt giới hạn xử lý huỷ an toàn; cần rà soát trước.')
  const active = sessions.docs.filter(item => ['scheduled', 'rescheduled'].includes(item.data().status))
  if (active.some(item => !/^\d{4}-\d{2}-\d{2}/.test(item.data().date || ''))) throw new HttpsError('failed-precondition', 'Có lịch tập thiếu ngày cần rà soát trước khi huỷ.')
  const charged = value => value.billingStatus === 'charged' || Boolean(value.chargedAt || value.revenueRecognitionEntryId) || ['completed', 'attended', 'no_show'].includes(value.status)
  if (sessions.docs.some(item => String(item.data().date || '').slice(0, 10) > cutoffDate && charged(item.data()))) throw new HttpsError('failed-precondition', 'Có buổi đã tính sau ngày kết thúc; cần đối soát buổi và doanh thu trước khi huỷ.')
  const cancelledSessions = active.filter(item => String(item.data().date).slice(0, 10) >= cutoffDate && !charged(item.data()))
  const sessionIds = new Set(sessions.docs.map(item => item.id))
  const pendingRequests = requests.docs.filter(item => {
    const value = item.data()
    return value.status === 'pending' && (value.contractId === contractId || sessionIds.has(value.sessionId))
  })
  const pendingLeaves = leaveRequests.docs.filter(item => item.data().status === 'pending' && item.data().contractId === contractId)
  const schedulePlan = await readCancellationSchedulePlan({ transaction, db, sessions: cancelledSessions, fallbackBranchId: contract.branchId || '' })
  const writes = cancelledSessions.length + pendingRequests.length + pendingLeaves.length + schedulePlan.draftTargets.size + schedulePlan.legacyTargets.size
  if (writes > 400) throw new HttpsError('resource-exhausted', 'Quá nhiều lịch cần đóng trong một lần; cần rà soát trước khi huỷ.')
  return { cancelledSessions, pendingRequests, pendingLeaves, schedulePlan }
}

function applyContractCancellationPlan({ transaction, plan, actorUid, reason, contractId }) {
  const removedScheduleEntryCount = applyCancellationSchedulePlan({ transaction, plan: plan.schedulePlan, actorUid })
  for (const item of plan.cancelledSessions) transaction.update(item.ref, {
    status: 'student_cancelled', scheduleStatus: 'cancelled', billingStatus: 'exempt', attendanceStatus: null,
    cancellationReason: reason, cancellationSource: 'contract_cancellation', countsTowardContract: false,
    revision: Number(item.data().revision || 0) + 1, cancelledAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: actorUid,
  })
  for (const item of [...plan.pendingRequests, ...plan.pendingLeaves]) transaction.update(item.ref, {
    status: 'rejected', adminNote: 'Tự đóng do hợp đồng đã huỷ.', rejectionSource: 'contract_cancellation', rejectionSourceContractId: contractId,
    rejectedAt: FieldValue.serverTimestamp(), rejectedBy: actorUid, revision: Number(item.data().revision || 0) + 1,
  })
  return { cancelledSessionCount: plan.cancelledSessions.length, closedRequestCount: plan.pendingRequests.length + plan.pendingLeaves.length, removedScheduleEntryCount }
}

module.exports = { cancellationSalesSnapshot, readContractCancellationPlan, applyContractCancellationPlan }
