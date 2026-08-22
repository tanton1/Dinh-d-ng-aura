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

function payrollEffectiveAt(periodId) {
  const { end } = periodBounds(periodId)
  // The payroll expense belongs to the last instant of its Vietnam business
  // period, rather than the later button-click time.
  return Timestamp.fromMillis(end.toMillis() - 1)
}

function payrollPaymentReference(value) {
  const result = typeof value === 'string' ? value.trim().slice(0, 200) : ''
  if (!result) throw new HttpsError('invalid-argument', 'Cần nhập mã chứng từ hoặc tham chiếu chi lương.')
  return result
}

function payrollCashAccountId(value) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(result)) {
    throw new HttpsError('invalid-argument', 'Tài khoản quỹ chi lương không hợp lệ.')
  }
  return result
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
  const lockPayrollRun = onCall(async (request) => {
    const actor = await payrollActor(request, db)
    const runId = typeof request.data?.runId === 'string' ? request.data.runId.trim() : ''
    if (!runId) throw new HttpsError('invalid-argument', 'Mã kỳ lương không hợp lệ.')
    const runReference = db.doc(`payrollRuns/${runId}`)
    const ledgerReference = db.doc(`ledgerEntries/payroll_${runId}`)
    await db.runTransaction(async (transaction) => {
      const [run, existingLedger] = await Promise.all([transaction.get(runReference), transaction.get(ledgerReference)])
      if (!run.exists) throw new HttpsError('not-found', 'Không tìm thấy kỳ lương.')
      if (run.data().status === 'locked') return
      if (run.data().status !== 'reviewed') throw new HttpsError('failed-precondition', 'Kỳ lương phải ở trạng thái reviewed.')
      const periodId = period(run.data().periodId)
      const finalAmount = Math.max(0, Number(run.data().finalAmount || run.data().grossAmount || 0))
      transaction.update(runReference, { status: 'locked', lockedAt: FieldValue.serverTimestamp(), lockedBy: actor.uid, ledgerEntryId: ledgerReference.id, updatedAt: FieldValue.serverTimestamp() })
      if (!existingLedger.exists) {
        transaction.create(ledgerReference, {
          schemaVersion: 2,
          type: 'payroll',
          eventClass: 'payroll_accrual',
          source: 'payroll',
          payrollRunId: runId,
          periodId,
          branchId: run.data().branchId || '',
          amount: -finalAmount,
          cashImpact: 0,
          revenueImpact: 0,
          expenseImpact: finalAmount,
          receivableImpact: 0,
          deferredRevenueImpact: 0,
          effectiveAt: payrollEffectiveAt(periodId),
          idempotencyKey: `payroll-accrual:${runId}`,
          status: 'posted',
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actor.uid,
        })
      }
      transaction.create(db.collection('payrollAuditLogs').doc(), { schemaVersion: 2, runId, action: 'payroll.locked', actorUid: actor.uid, fromStatus: 'reviewed', toStatus: 'locked', ledgerEntryId: ledgerReference.id, createdAt: FieldValue.serverTimestamp() })
    })
    return { runId, status: 'locked' }
  })
  const markPayrollRunPaid = onCall(async (request) => {
    const actor = await payrollActor(request, db)
    const runId = typeof request.data?.runId === 'string' ? request.data.runId.trim() : ''
    if (!runId) throw new HttpsError('invalid-argument', 'Mã kỳ lương không hợp lệ.')
    const paymentReference = payrollPaymentReference(request.data?.paymentReference)
    const cashAccountId = payrollCashAccountId(request.data?.cashAccountId)
    const runReference = db.doc(`payrollRuns/${runId}`)
    const accrualReference = db.doc(`ledgerEntries/payroll_${runId}`)
    const paymentLedgerReference = db.doc(`ledgerEntries/payroll_payment_${runId}`)
    const cashTransactionReference = db.doc(`cashTransactions/payroll_${runId}`)
    const accountReference = db.doc(`cashAccounts/${cashAccountId}`)

    return db.runTransaction(async (transaction) => {
      const [run, accrual, existingPayment, account] = await Promise.all([
        transaction.get(runReference),
        transaction.get(accrualReference),
        transaction.get(paymentLedgerReference),
        transaction.get(accountReference),
      ])
      if (!run.exists) throw new HttpsError('not-found', 'Không tìm thấy kỳ lương.')
      if (run.data().status === 'paid') {
        return { runId, status: 'paid', unchanged: true, paymentLedgerEntryId: run.data().paymentLedgerEntryId || paymentLedgerReference.id }
      }
      if (run.data().status !== 'locked') throw new HttpsError('failed-precondition', 'Kỳ lương phải được khóa trước khi ghi nhận chi trả.')
      if (!accrual.exists || accrual.data().status !== 'posted') {
        throw new HttpsError('failed-precondition', 'Không tìm thấy bút toán chi phí của kỳ lương đã khóa.')
      }
      if (!account.exists || account.data().status !== 'active') {
        throw new HttpsError('failed-precondition', 'Tài khoản quỹ chi lương không hoạt động.')
      }
      const finalAmount = Math.max(0, Number(run.data().finalAmount || run.data().grossAmount || 0))
      if (!Number.isSafeInteger(finalAmount) || finalAmount <= 0) {
        throw new HttpsError('failed-precondition', 'Kỳ lương không có số tiền hợp lệ để chi trả.')
      }
      if (Number(account.data().balance || 0) < finalAmount) {
        throw new HttpsError('failed-precondition', 'Số dư quỹ không đủ để chi trả kỳ lương này.')
      }
      const paidAt = Timestamp.now()
      if (!existingPayment.exists) {
        transaction.create(paymentLedgerReference, {
          schemaVersion: 2,
          type: 'payroll',
          eventClass: 'payroll_payment',
          source: 'payroll',
          payrollRunId: runId,
          periodId: run.data().periodId || '',
          branchId: run.data().branchId || account.data().branchId || '',
          cashAccountId,
          amount: -finalAmount,
          cashImpact: -finalAmount,
          revenueImpact: 0,
          expenseImpact: 0,
          receivableImpact: 0,
          deferredRevenueImpact: 0,
          effectiveAt: paidAt,
          paymentReference,
          idempotencyKey: `payroll-payment:${runId}`,
          status: 'posted',
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actor.uid,
        })
        transaction.create(cashTransactionReference, {
          schemaVersion: 2,
          accountId: cashAccountId,
          branchId: account.data().branchId || run.data().branchId || '',
          type: 'expense',
          category: 'payroll_payment',
          amount: -finalAmount,
          effectiveAt: paidAt,
          status: 'posted',
          referenceCode: `PAY-${runId.slice(-8).toUpperCase()}`,
          paymentReference,
          ledgerEntryId: paymentLedgerReference.id,
          idempotencyKey: `payroll-cash:${runId}`,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actor.uid,
        })
        transaction.update(accountReference, {
          balance: FieldValue.increment(-finalAmount),
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
      transaction.update(runReference, {
        status: 'paid',
        paidAt: FieldValue.serverTimestamp(),
        paidBy: actor.uid,
        paymentReference,
        cashAccountId,
        paymentLedgerEntryId: paymentLedgerReference.id,
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.create(db.collection('payrollAuditLogs').doc(), {
        schemaVersion: 2,
        runId,
        action: 'payroll.paid',
        actorUid: actor.uid,
        fromStatus: 'locked',
        toStatus: 'paid',
        cashAccountId,
        paymentLedgerEntryId: paymentLedgerReference.id,
        createdAt: FieldValue.serverTimestamp(),
      })
      return { runId, status: 'paid', unchanged: false, paymentLedgerEntryId: paymentLedgerReference.id }
    })
  })

  return { listPayrollRuns, getPayrollRun, createPayrollRun, reviewPayrollRun, lockPayrollRun, markPayrollRunPaid }
}

module.exports = { createPayrollFunctions, periodBounds }
