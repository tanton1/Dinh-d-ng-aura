const { FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')

function text(value, label, maximum = 200) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result || result.length > maximum) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return result
}

function positiveAmount(value) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result <= 0 || result > 1000000000) throw new HttpsError('invalid-argument', 'Số tiền không hợp lệ.')
  return result
}

function effectiveTimestamp(value) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) throw new HttpsError('invalid-argument', 'Ngày hạch toán không hợp lệ.')
  return Timestamp.fromDate(date)
}

function referenceCode(prefix, reference) {
  return `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${reference.id.slice(0, 7).toUpperCase()}`
}

async function financeActor(request, db) {
  const actor = await trustedAccessContext(request, db)
  requireCapability(actor, 'finance.operations.manage')
  return actor
}

function createFinanceLedgerFunctions({ db, onCall }) {
  const listFinanceLedger = onCall(async (request) => {
    await financeActor(request, db)
    const limit = Math.min(500, Math.max(1, Number.isInteger(request.data?.limit) ? request.data.limit : 250))
    const snapshot = await db.collection('ledgerEntries').orderBy('effectiveAt', 'desc').limit(limit).get()
    return { entries: snapshot.docs.map((item) => {
      const data = item.data()
      return {
        id: item.id,
        type: data.type,
        contractId: data.contractId,
        studentId: data.studentId,
        branchId: data.branchId || '',
        amount: Number(data.amount || 0),
        effectiveAt: data.effectiveAt?.toDate?.().toISOString?.() || '',
        paymentMethod: data.paymentMethod || '',
        referenceCode: data.referenceCode || '',
        status: data.status || '',
      }
    }) }
  })

  const recordContractPayment = onCall(async (request) => {
    const actor = await financeActor(request, db)
    const contractId = text(request.data?.contractId, 'Mã hợp đồng')
    const amount = positiveAmount(request.data?.amount)
    const idempotencyKey = text(request.data?.idempotencyKey, 'Khóa chống trùng', 100)
    const effectiveAt = effectiveTimestamp(request.data?.effectiveAt)
    const paymentMethod = text(request.data?.paymentMethod, 'Phương thức thanh toán', 50)
    const contractReference = db.doc(`contracts/${contractId}`)
    const ledgerReference = db.collection('ledgerEntries').doc()
    return db.runTransaction(async (transaction) => {
      const [contract, duplicate] = await Promise.all([
        transaction.get(contractReference),
        transaction.get(db.collection('ledgerEntries').where('idempotencyKey', '==', idempotencyKey).limit(1)),
      ])
      if (!contract.exists) throw new HttpsError('not-found', 'Không tìm thấy hợp đồng.')
      if (!duplicate.empty) return { entryId: duplicate.docs[0].id, unchanged: true, referenceCode: duplicate.docs[0].data().referenceCode }
      const data = contract.data()
      const totalDue = Number(data.totalPrice || 0) - Number(data.discount || 0)
      const nextPaid = Number(data.paidAmount || 0) + amount
      if (nextPaid > totalDue) throw new HttpsError('failed-precondition', 'Khoản thu vượt số tiền hợp đồng còn lại.')
      const code = referenceCode('THU', ledgerReference)
      transaction.create(ledgerReference, { schemaVersion: 1, type: 'payment', contractId, studentId: data.studentId || '', branchId: data.branchId || '', amount, effectiveAt, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid, paymentMethod, referenceCode: code, idempotencyKey, status: 'posted', note: typeof request.data?.note === 'string' ? request.data.note.trim().slice(0, 500) : '' })
      transaction.update(contractReference, { paidAmount: nextPaid, financeProjectionUpdatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      return { entryId: ledgerReference.id, unchanged: false, referenceCode: code }
    })
  })

  const reverseContractPayment = onCall(async (request) => {
    const actor = await financeActor(request, db)
    const entryId = text(request.data?.entryId, 'Mã bút toán')
    const idempotencyKey = text(request.data?.idempotencyKey, 'Khóa chống trùng', 100)
    const reason = text(request.data?.reason, 'Lý do', 500)
    const originalReference = db.doc(`ledgerEntries/${entryId}`)
    const reversalReference = db.collection('ledgerEntries').doc()
    return db.runTransaction(async (transaction) => {
      const [original, duplicate] = await Promise.all([transaction.get(originalReference), transaction.get(db.collection('ledgerEntries').where('idempotencyKey', '==', idempotencyKey).limit(1))])
      if (!original.exists || original.data().type !== 'payment') throw new HttpsError('failed-precondition', 'Chỉ có thể hoàn tác khoản thu hợp lệ.')
      if (!duplicate.empty) return { entryId: duplicate.docs[0].id, unchanged: true }
      if (original.data().status === 'reversed') throw new HttpsError('already-exists', 'Khoản thu đã được hoàn tác.')
      const contractReference = db.doc(`contracts/${original.data().contractId}`)
      const contract = await transaction.get(contractReference)
      if (!contract.exists) throw new HttpsError('failed-precondition', 'Hợp đồng nguồn không còn tồn tại.')
      const amount = positiveAmount(original.data().amount)
      transaction.create(reversalReference, { ...original.data(), type: 'reversal', amount: -amount, reversedEntryId: entryId, referenceCode: referenceCode('DAO', reversalReference), idempotencyKey, reason, status: 'posted', createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid })
      transaction.update(originalReference, { status: 'reversed', reversedAt: FieldValue.serverTimestamp(), reversedBy: actor.uid, reversalEntryId: reversalReference.id })
      transaction.update(contractReference, { paidAmount: Math.max(0, Number(contract.data().paidAmount || 0) - amount), financeProjectionUpdatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      return { entryId: reversalReference.id, unchanged: false }
    })
  })

  const recordRefund = onCall(async (request) => {
    const actor = await financeActor(request, db)
    const contractId = text(request.data?.contractId, 'Mã hợp đồng')
    const amount = positiveAmount(request.data?.amount)
    const idempotencyKey = text(request.data?.idempotencyKey, 'Khóa chống trùng', 100)
    const reason = text(request.data?.reason, 'Lý do', 500)
    const effectiveAt = effectiveTimestamp(request.data?.effectiveAt)
    const reference = db.collection('ledgerEntries').doc()
    const contractReference = db.doc(`contracts/${contractId}`)
    return db.runTransaction(async (transaction) => {
      const [contract, duplicate] = await Promise.all([transaction.get(contractReference), transaction.get(db.collection('ledgerEntries').where('idempotencyKey', '==', idempotencyKey).limit(1))])
      if (!contract.exists) throw new HttpsError('not-found', 'Không tìm thấy hợp đồng.')
      if (!duplicate.empty) return { entryId: duplicate.docs[0].id, unchanged: true }
      if (amount > Number(contract.data().paidAmount || 0)) throw new HttpsError('failed-precondition', 'Khoản hoàn vượt tổng tiền đã thu.')
      transaction.create(reference, { schemaVersion: 1, type: 'refund', contractId, studentId: contract.data().studentId || '', branchId: contract.data().branchId || '', amount: -amount, effectiveAt, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid, paymentMethod: text(request.data?.paymentMethod || 'transfer', 'Phương thức hoàn'), referenceCode: referenceCode('HOAN', reference), idempotencyKey, reason, status: 'posted' })
      transaction.update(contractReference, { paidAmount: Number(contract.data().paidAmount || 0) - amount, financeProjectionUpdatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      return { entryId: reference.id, unchanged: false }
    })
  })

  const lockFinancePeriod = onCall(async (request) => {
    const actor = await financeActor(request, db)
    const periodId = text(request.data?.periodId, 'Kỳ tài chính', 20)
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodId)) throw new HttpsError('invalid-argument', 'Kỳ tài chính phải có dạng YYYY-MM.')
    const reference = db.doc(`financePeriods/${periodId}`)
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(reference)
      if (current.exists && current.data().status === 'locked') return
      transaction.set(reference, { schemaVersion: 1, periodId, status: 'locked', lockedAt: FieldValue.serverTimestamp(), lockedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    })
    return { periodId, status: 'locked' }
  })

  return { listFinanceLedger, recordContractPayment, reverseContractPayment, recordRefund, lockFinancePeriod }
}

module.exports = { createFinanceLedgerFunctions }
