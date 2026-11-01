'use strict'

// A failed calculation is an explicit review outcome, never evidence of zero
// revenue. Keep these checks shared by live confirmation and historical repair.
function recognitionEvidenceIssue({ sessionId, session = {}, attendance = {}, billing = {}, contract = {}, serviceOrdinal, validateValue = true }) {
  const contractId = session.contractId
  if (!contractId || (contract.studentId && contract.studentId !== session.studentId)
    || [attendance, billing].some(row => (row.contractId && row.contractId !== contractId)
      || (row.studentId && row.studentId !== session.studentId) || (row.sessionId && row.sessionId !== sessionId))) {
    return 'RECOGNITION_EVIDENCE_IDENTITY_MISMATCH'
  }
  const ordinals = [billing.serviceOrdinal, attendance.serviceOrdinal, session.serviceOrdinal]
    .filter(value => value !== undefined && value !== null && value !== '').map(Number)
  if (ordinals.some(value => !Number.isSafeInteger(value) || value < 1)
    || new Set(ordinals).size > 1 || !Number.isSafeInteger(serviceOrdinal) || serviceOrdinal < 1) {
    return 'RECOGNITION_SERVICE_ORDINAL_INVALID'
  }
  const quota = Number(contract.totalSessions || contract.sessions || 0)
  if (!Number.isSafeInteger(quota) || quota < 1) return 'RECOGNITION_CONTRACT_QUOTA_INVALID'
  if (serviceOrdinal > quota) return 'RECOGNITION_SERVICE_ORDINAL_EXCEEDED'
  if (!validateValue) return ''
  const price = Number(contract.totalPrice), discount = Number(contract.discount ?? 0)
  if (contract.totalPrice == null || !Number.isSafeInteger(price) || price < 0
    || !Number.isSafeInteger(discount) || discount < 0 || discount > price) return 'RECOGNITION_CONTRACT_VALUE_INVALID'
  if (price === discount || contract.recognitionUnitAmount === 0) return 'RECOGNITION_ZERO_VALUE_REQUIRES_REVIEW'
  return ''
}

function recognitionBalanceIssue({ state, sessionId, serviceOrdinal, amount, netValue }) {
  if ((state.revenueBySession.get(sessionId) || 0) > 0) return 'RECOGNITION_SESSION_ALREADY_RECOGNIZED'
  if ([...(state.revenueByOrdinal.get(serviceOrdinal) || [])].some(([otherId, value]) => otherId !== sessionId && value > 0)) {
    return 'RECOGNITION_SERVICE_ORDINAL_COLLISION'
  }
  if (!Number.isSafeInteger(state.recognizedRevenue) || state.recognizedRevenue < 0
    || state.recognizedRevenue + amount > netValue) return 'RECOGNITION_CONTRACT_VALUE_EXCEEDED'
  return ''
}

module.exports = { recognitionEvidenceIssue, recognitionBalanceIssue }
