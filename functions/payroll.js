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
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  return {
    // Payroll is a Vietnam business period, not a UTC calendar month.
    start: Timestamp.fromDate(new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00+07:00`)),
    end: Timestamp.fromDate(new Date(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+07:00`)),
  }
}

function iso(value) {
  return value?.toDate?.().toISOString?.() || ''
}

function createPayrollFunctions({ db, onCall }) {
  const listPayrollRuns = onCall(async (request) => {
    await payrollActor(request, db)
    const limit = Math.min(36, Math.max(1, Number.isInteger(request.data?.limit) ? request.data.limit : 18))
    const snapshot = await db.collection('payrollRuns').orderBy('createdAt', 'desc').limit(limit).get()
    return {
      runs: snapshot.docs.map((item) => {
        const data = item.data()
        return {
          id: item.id,
          periodId: data.periodId || '',
          policyVersion: Number(data.policyVersion || 1),
          status: data.status || 'draft',
          attendanceCount: Number(data.attendanceCount || 0),
          trainerCount: Number(data.trainerCount || 0),
          grossAmount: Number(data.grossAmount || 0),
          adjustmentAmount: Number(data.adjustmentAmount || 0),
          finalAmount: Number(data.finalAmount || data.grossAmount || 0),
          createdAt: iso(data.createdAt),
          updatedAt: iso(data.updatedAt),
        }
      }),
    }
  })

  const getPayrollRun = onCall(async (request) => {
    await payrollActor(request, db)
    const runId = typeof request.data?.runId === 'string' ? request.data.runId.trim() : ''
    if (!runId) throw new HttpsError('invalid-argument', 'Mã kỳ lương không hợp lệ.')
    const [run, items] = await Promise.all([
      db.doc(`payrollRuns/${runId}`).get(),
      db.collection('payrollRunItems').where('runId', '==', runId).limit(500).get(),
    ])
    if (!run.exists) throw new HttpsError('not-found', 'Không tìm thấy kỳ lương.')
    return {
      run: { id: run.id, ...run.data(), createdAt: iso(run.data().createdAt), updatedAt: iso(run.data().updatedAt) },
      items: items.docs.map((item) => ({ id: item.id, ...item.data(), createdAt: iso(item.data().createdAt) })),
    }
  })

  const createPayrollRun = onCall(async (request) => {
    const actor = await payrollActor(request, db)
    const periodId = period(request.data?.periodId)
    const { start, end } = periodBounds(periodId)
    // One deterministic document per business period prevents two admins from
    // creating duplicate payroll runs concurrently.
    const runReference = db.doc(`payrollRuns/${periodId}`)
    return db.runTransaction(async (transaction) => {
      const existing = await transaction.get(runReference)
      if (existing.exists) return { runId: existing.id, unchanged: true, status: existing.data().status }

      const [attendance, policies] = await Promise.all([
        transaction.get(db.collection('attendanceEvents').where('occurredAt', '>=', start).where('occurredAt', '<', end)),
        transaction.get(db.collection('payrollPolicies').where('effectiveFrom', '<=', start).orderBy('effectiveFrom', 'desc').limit(1)),
      ])
      const policySnapshot = policies.docs[0]
      if (!policySnapshot) throw new HttpsError('failed-precondition', 'Chưa có chính sách lương hiệu lực cho kỳ này.')
      const policy = policySnapshot.data()
      const ratePerSession = Number(policy.ratePerSession || 0)
      if (!Number.isSafeInteger(ratePerSession) || ratePerSession <= 0) {
        throw new HttpsError('failed-precondition', 'Đơn giá buổi tập trong chính sách lương không hợp lệ.')
      }
      const counts = new Map()
      attendance.docs.forEach((item) => {
        const trainerId = item.data().trainerId
        if (trainerId) counts.set(trainerId, Number(counts.get(trainerId) || 0) + 1)
      })
      if (counts.size > 450) throw new HttpsError('resource-exhausted', 'Kỳ lương có quá nhiều nhân sự để khóa trong một giao dịch.')
      const grossAmount = [...counts.values()].reduce((total, sessionCount) => total + Number(sessionCount) * ratePerSession, 0)
      transaction.create(runReference, { schemaVersion: 1, periodId, policyId: policySnapshot.id, policyVersion: Number(policy.version || 1), policySnapshot: { ratePerSession }, status: 'draft', attendanceCount: attendance.size, trainerCount: counts.size, grossAmount, adjustmentAmount: 0, finalAmount: grossAmount, timeZone: 'Asia/Ho_Chi_Minh', createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid, updatedAt: FieldValue.serverTimestamp() })
      for (const [trainerId, sessionCount] of counts) {
        const itemReference = db.doc(`payrollRunItems/${periodId}_${trainerId}`)
        transaction.create(itemReference, { schemaVersion: 1, runId: runReference.id, periodId, trainerId, sessionCount, ratePerSession, grossAmount: sessionCount * ratePerSession, adjustmentAmount: 0, finalAmount: sessionCount * ratePerSession, status: 'draft', createdAt: FieldValue.serverTimestamp() })
      }
      transaction.create(db.collection('payrollAuditLogs').doc(), { schemaVersion: 1, runId: runReference.id, action: 'payroll.created', actorUid: actor.uid, toStatus: 'draft', createdAt: FieldValue.serverTimestamp() })
      return { runId: runReference.id, unchanged: false, status: 'draft' }
    })
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
      transaction.create(db.collection('payrollAuditLogs').doc(), { schemaVersion: 1, runId, action: `payroll.${to}`, actorUid: actor.uid, fromStatus: from, toStatus: to, createdAt: FieldValue.serverTimestamp() })
    })
    return { runId, status: to }
  }

  const reviewPayrollRun = onCall((request) => transition(request, 'draft', 'reviewed'))
  const lockPayrollRun = onCall((request) => transition(request, 'reviewed', 'locked'))
  const markPayrollRunPaid = onCall((request) => transition(request, 'locked', 'paid', { paymentReference: typeof request.data?.paymentReference === 'string' ? request.data.paymentReference.trim().slice(0, 200) : '' }))

  return { listPayrollRuns, getPayrollRun, createPayrollRun, reviewPayrollRun, lockPayrollRun, markPayrollRunPaid }
}

module.exports = { createPayrollFunctions, periodBounds }
