const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')

async function payrollActor(request, db) {
  const actor = await trustedAccessContext(request, db)
  requireCapability(actor, 'payroll.operations.manage')
  return actor
}

function period(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(result)) throw new HttpsError('invalid-argument', 'Kỳ lương phải có dạng YYYY-MM.')
  return result
}

function periodBounds(periodId) {
  const [year, month] = periodId.split('-').map(Number)
  return {
    start: Timestamp.fromDate(new Date(Date.UTC(year, month - 1, 1))),
    end: Timestamp.fromDate(new Date(Date.UTC(year, month, 1))),
  }
}

function createPayrollFunctions({ db, onCall }) {
  const createPayrollRun = onCall(async (request) => {
    const actor = await payrollActor(request, db)
    const periodId = period(request.data?.periodId)
    const existing = await db.collection('payrollRuns').where('periodId', '==', periodId).limit(1).get()
    if (!existing.empty) return { runId: existing.docs[0].id, unchanged: true, status: existing.docs[0].data().status }
    const { start, end } = periodBounds(periodId)
    const [attendance, policies] = await Promise.all([
      db.collection('attendanceEvents').where('occurredAt', '>=', start).where('occurredAt', '<', end).get(),
      db.collection('payrollPolicies').where('effectiveFrom', '<=', start).orderBy('effectiveFrom', 'desc').limit(1).get(),
    ])
    const policy = policies.docs[0]?.data() || { version: 1, ratePerSession: 0 }
    const ratePerSession = Number(policy.ratePerSession || 0)
    const counts = new Map()
    attendance.docs.forEach((item) => {
      const trainerId = item.data().trainerId
      if (trainerId) counts.set(trainerId, Number(counts.get(trainerId) || 0) + 1)
    })
    const runReference = db.collection('payrollRuns').doc()
    const batch = db.batch()
    batch.create(runReference, { schemaVersion: 1, periodId, policyVersion: Number(policy.version || 1), status: 'draft', attendanceCount: attendance.size, trainerCount: counts.size, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid, updatedAt: FieldValue.serverTimestamp() })
    for (const [trainerId, sessionCount] of counts) {
      const itemReference = db.collection('payrollRunItems').doc()
      batch.create(itemReference, { schemaVersion: 1, runId: runReference.id, periodId, trainerId, sessionCount, ratePerSession, grossAmount: sessionCount * ratePerSession, adjustmentAmount: 0, finalAmount: sessionCount * ratePerSession, status: 'draft', createdAt: FieldValue.serverTimestamp() })
    }
    await batch.commit()
    return { runId: runReference.id, unchanged: false, status: 'draft' }
  })

  async function transition(request, from, to, fields = {}) {
    const actor = await payrollActor(request, db)
    const runId = typeof request.data?.runId === 'string' ? request.data.runId.trim() : ''
    if (!runId) throw new HttpsError('invalid-argument', 'Mã kỳ lương không hợp lệ.')
    const reference = db.doc(`payrollRuns/${runId}`)
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) throw new HttpsError('not-found', 'Không tìm thấy kỳ lương.')
      if (snapshot.data().status === to) return
      if (snapshot.data().status !== from) throw new HttpsError('failed-precondition', `Kỳ lương phải ở trạng thái ${from}.`)
      transaction.update(reference, { status: to, ...fields, [`${to}At`]: FieldValue.serverTimestamp(), [`${to}By`]: actor.uid, updatedAt: FieldValue.serverTimestamp() })
    })
    return { runId, status: to }
  }

  const reviewPayrollRun = onCall((request) => transition(request, 'draft', 'reviewed'))
  const lockPayrollRun = onCall((request) => transition(request, 'reviewed', 'locked'))
  const markPayrollRunPaid = onCall((request) => transition(request, 'locked', 'paid', { paymentReference: typeof request.data?.paymentReference === 'string' ? request.data.paymentReference.trim().slice(0, 200) : '' }))

  return { createPayrollRun, reviewPayrollRun, lockPayrollRun, markPayrollRunPaid }
}

module.exports = { createPayrollFunctions }
