const { FieldValue, Timestamp } = require('firebase-admin/firestore')

// Revenue is intentionally recognised when a billable PT session is attended,
// not when cash is collected.  This keeps management P&L separate from the
// cashbook and lets an upfront contract payment remain deferred until service
// is delivered.
function safeMoney(value) {
  const amount = Number(value || 0)
  return Number.isSafeInteger(amount) && amount > 0 ? amount : 0
}

function contractNetValue(contract = {}) {
  return Math.max(0, safeMoney(contract.totalPrice) - Math.max(0, Number(contract.discount || 0)))
}

function contractSessionCount(contract = {}) {
  const count = Number(contract.totalSessions || contract.sessions || 0)
  return Number.isSafeInteger(count) && count > 0 ? count : 0
}

function recognitionThrough(contract, completedSessionCount) {
  const totalValue = contractNetValue(contract)
  const totalSessions = contractSessionCount(contract)
  const completed = Math.max(0, Math.min(totalSessions, Number(completedSessionCount || 0)))
  if (!totalValue || !totalSessions || !completed) return 0
  const unit = Math.floor(totalValue / totalSessions)
  const remainder = totalValue % totalSessions
  return (unit * completed) + Math.min(completed, remainder)
}

function recognitionForNextSession(contract) {
  const completed = Math.max(0, Number(contract?.usedSessions || 0))
  const before = recognitionThrough(contract, completed)
  const after = recognitionThrough(contract, completed + 1)
  return Math.max(0, after - before)
}

function attendanceEffectiveAt(session = {}) {
  const date = typeof session.date === 'string' ? session.date.trim().slice(0, 10) : ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const parsed = new Date(`${date}T12:00:00+07:00`)
    if (!Number.isNaN(parsed.getTime())) return Timestamp.fromDate(parsed)
  }
  return FieldValue.serverTimestamp()
}

function ptRevenueRecognitionWrite({ sessionId, session, contractId, contract, attendanceEventId, actorUid }) {
  const amount = recognitionForNextSession(contract)
  const totalSessions = contractSessionCount(contract)
  const completedBefore = Math.max(0, Number(contract?.usedSessions || 0))
  if (!amount || !totalSessions || completedBefore >= totalSessions) return null

  const recognisedBefore = recognitionThrough(contract, completedBefore)
  const paidBefore = Math.max(0, Number(contract?.paidAmount || 0))
  const deferredReleased = Math.min(amount, Math.max(0, paidBefore - recognisedBefore))

  return {
    schemaVersion: 2,
    type: 'revenue_recognition',
    eventClass: 'revenue_recognition',
    source: 'pt_gym',
    recognitionPolicy: 'billable_attendance_v1',
    contractId,
    studentId: session?.studentId || contract?.studentId || '',
    trainerId: session?.trainerId || '',
    branchId: session?.branchId || contract?.branchId || '',
    sessionId,
    attendanceEventId,
    amount,
    cashImpact: 0,
    revenueImpact: amount,
    expenseImpact: 0,
    receivableImpact: amount - deferredReleased,
    deferredRevenueImpact: -deferredReleased,
    serviceOrdinal: completedBefore + 1,
    serviceTotal: totalSessions,
    effectiveAt: attendanceEffectiveAt(session),
    status: 'posted',
    idempotencyKey: `pt-session-recognition:${sessionId}`,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: actorUid,
  }
}

// An Eat Clean order is recognised only when it is delivered.  Food value and
// delivery fee are separate sources so future food cost / shipper cost can be
// analysed without rewriting historical revenue rows.
function eatCleanRevenueRecognitionWrites({ orderId, order, actorUid }) {
  const pricing = order?.commercialSnapshot?.pricing || {}
  const subtotal = Math.max(0, Number(pricing.subtotal ?? order?.subtotal ?? 0))
  const mealDiscount = Math.max(0, Number(order?.discount || 0))
  const deliveryFee = Math.max(0, Number(pricing.deliveryFee ?? order?.deliveryFee ?? 0))
  const captured = []
  const shared = {
    schemaVersion: 2,
    type: 'revenue_recognition',
    eventClass: 'revenue_recognition',
    recognitionPolicy: 'order_delivered_v1',
    orderId,
    customerId: order?.userId || '',
    branchId: order?.branchId || '',
    cashImpact: 0,
    expenseImpact: 0,
    receivableImpact: 0,
    deferredRevenueImpact: 0,
    status: 'posted',
    effectiveAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    createdBy: actorUid,
  }
  const mealAmount = Math.max(0, subtotal - mealDiscount)
  if (mealAmount) captured.push({
    id: `eat_clean_${orderId}`,
    value: { ...shared, source: 'eat_clean', amount: mealAmount, revenueImpact: mealAmount, idempotencyKey: `eat-clean-delivered:${orderId}:meal` },
  })
  if (deliveryFee) captured.push({
    id: `delivery_fee_${orderId}`,
    value: { ...shared, source: 'delivery_fee', amount: deliveryFee, revenueImpact: deliveryFee, idempotencyKey: `eat-clean-delivered:${orderId}:delivery` },
  })
  return captured
}

module.exports = {
  contractNetValue,
  contractSessionCount,
  recognitionThrough,
  recognitionForNextSession,
  ptRevenueRecognitionWrite,
  eatCleanRevenueRecognitionWrites,
}
