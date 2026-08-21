const { FieldPath, FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')

const ledgerTypes = new Set(['payment', 'refund', 'adjustment', 'reversal'])
const ledgerStatuses = new Set(['pending', 'posted', 'reversed'])
const maximumLedgerScan = 5000

function text(value, label, maximum = 200) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result || result.length > maximum) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return result
}

function optionalText(value, label, maximum = 200) {
  if (value === undefined || value === null || value === '') return ''
  return text(value, label, maximum)
}

function positiveAmount(value) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result <= 0 || result > 1000000000) throw new HttpsError('invalid-argument', 'Số tiền không hợp lệ.')
  return result
}

function effectiveTimestamp(value) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) throw new HttpsError('invalid-argument', 'Ngày hạch toán không hợp lệ.')
  const year = date.getUTCFullYear()
  if (year < 1 || year > 9999) throw new HttpsError('invalid-argument', 'Ngày hạch toán nằm ngoài phạm vi hỗ trợ.')
  return Timestamp.fromDate(date)
}

function timestampMillis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  const result = new Date(value).getTime()
  return Number.isFinite(result) ? result : 0
}

function timestampIso(value) {
  const millis = timestampMillis(value)
  return millis ? new Date(millis).toISOString() : ''
}

function referenceCode(prefix, reference) {
  return `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${reference.id.slice(0, 7).toUpperCase()}`
}

async function cashAccountForMovement(transaction, db, cashAccountId, signedAmount) {
  if (!cashAccountId) return null
  const reference = db.doc(`cashAccounts/${cashAccountId}`)
  const snapshot = await transaction.get(reference)
  if (!snapshot.exists || snapshot.data().status !== 'active') throw new HttpsError('failed-precondition', 'Tài khoản quỹ không hoạt động.')
  if (signedAmount < 0 && Number(snapshot.data().balance || 0) < Math.abs(signedAmount)) throw new HttpsError('failed-precondition', 'Số dư quỹ không đủ để hoàn/đảo khoản tiền này.')
  return { reference, data: snapshot.data() }
}

function createCashMovement(transaction, db, ledgerReference, account, signedAmount, effectiveAt, actorUid, category) {
  if (!account) return
  const movementReference = db.doc(`cashTransactions/ledger_${ledgerReference.id}`)
  transaction.update(account.reference, { balance: FieldValue.increment(signedAmount), updatedAt: FieldValue.serverTimestamp() })
  transaction.create(movementReference, { schemaVersion: 1, accountId: account.reference.id, branchId: account.data.branchId || '', type: signedAmount >= 0 ? 'income' : 'expense', category, amount: signedAmount, effectiveAt, status: 'posted', referenceCode: `LED-${ledgerReference.id.slice(0, 8).toUpperCase()}`, ledgerEntryId: ledgerReference.id, createdAt: FieldValue.serverTimestamp(), createdBy: actorUid })
}

function vietnamDateKey(value) {
  const date = new Date(timestampMillis(value))
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type) => parts.find((item) => item.type === type)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function financePeriodId(value) {
  return vietnamDateKey(value).slice(0, 7)
}

function encodeCursor(document) {
  return Buffer.from(JSON.stringify({
    id: document.id,
    effectiveAtMillis: timestampMillis(document.data().effectiveAt),
  }), 'utf8').toString('base64url')
}

function decodeCursor(value) {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'))
    if (!parsed?.id || !Number.isSafeInteger(parsed.effectiveAtMillis) || parsed.effectiveAtMillis <= 0) throw new Error('invalid')
    return parsed
  } catch {
    throw new HttpsError('invalid-argument', 'Con trỏ sổ tài chính không hợp lệ.')
  }
}

function normalizeLedgerListInput(data = {}) {
  const requestedPageSize = Number.isInteger(data.pageSize)
    ? data.pageSize
    : Number.isInteger(data.limit)
      ? data.limit
      : 50
  const pageSize = Math.min(100, Math.max(1, requestedPageSize))
  const startAt = data.startAt ? effectiveTimestamp(data.startAt) : null
  const endAt = data.endAt ? effectiveTimestamp(data.endAt) : null
  if (startAt && endAt && startAt.toMillis() > endAt.toMillis()) {
    throw new HttpsError('invalid-argument', 'Khoảng ngày tài chính không hợp lệ.')
  }
  const branchId = optionalText(data.branchId, 'Chi nhánh', 100) || 'all'
  const requestedTypes = Array.isArray(data.types) ? data.types : []
  const types = requestedTypes.length
    ? requestedTypes.map((value) => text(value, 'Loại bút toán', 30))
    : []
  if (types.some((value) => !ledgerTypes.has(value))) throw new HttpsError('invalid-argument', 'Loại bút toán không hợp lệ.')
  const status = optionalText(data.status, 'Trạng thái bút toán', 30) || 'all'
  if (status !== 'all' && !ledgerStatuses.has(status)) throw new HttpsError('invalid-argument', 'Trạng thái bút toán không hợp lệ.')
  return {
    pageSize,
    startAt,
    endAt,
    branchId,
    types: new Set(types),
    status,
    cursor: decodeCursor(data.cursor),
  }
}

function ledgerMatches(data, input) {
  if (input.branchId === 'none' && data.branchId) return false
  if (input.branchId !== 'all' && input.branchId !== 'none' && data.branchId !== input.branchId) return false
  if (input.types.size && !input.types.has(data.type)) return false
  if (input.status !== 'all' && data.status !== input.status) return false
  return true
}

function serializeLedgerDocument(item) {
  const data = item.data()
  return {
    id: item.id,
    type: data.type,
    contractId: data.contractId || '',
    studentId: data.studentId || '',
    branchId: data.branchId || '',
    installmentId: data.installmentId || '',
    amount: Number(data.amount || 0),
    effectiveAt: timestampIso(data.effectiveAt),
    paymentMethod: data.paymentMethod || '',
    referenceCode: data.referenceCode || '',
    status: data.status || '',
    reversedEntryId: data.reversedEntryId || '',
    note: typeof data.note === 'string' ? data.note.slice(0, 500) : '',
    reason: typeof data.reason === 'string' ? data.reason.slice(0, 500) : '',
  }
}

function summarizeLedgerDocuments(documents, input) {
  const summary = {
    collectedAmount: 0,
    refundedAmount: 0,
    reversedAmount: 0,
    adjustmentAmount: 0,
    netRevenue: 0,
    transactionCount: 0,
    dailySeries: [],
  }
  const dailyTotals = new Map()
  for (const item of documents) {
    const data = typeof item.data === 'function' ? item.data() : item
    if (!ledgerMatches(data, input)) continue
    if (!['posted', 'reversed'].includes(data.status)) continue
    const amount = Number(data.amount || 0)
    if (!Number.isFinite(amount)) continue
    summary.transactionCount += 1
    summary.netRevenue += amount
    if (data.type === 'payment' && amount > 0) summary.collectedAmount += amount
    if (data.type === 'refund' && amount < 0) summary.refundedAmount += Math.abs(amount)
    if (data.type === 'reversal' && amount < 0) summary.reversedAmount += Math.abs(amount)
    if (data.type === 'adjustment') summary.adjustmentAmount += amount
    const date = vietnamDateKey(data.effectiveAt)
    if (date) dailyTotals.set(date, Number(dailyTotals.get(date) || 0) + amount)
  }
  summary.dailySeries = Array.from(dailyTotals, ([date, total]) => ({ date, total })).sort((a, b) => a.date.localeCompare(b.date))
  return summary
}

function ledgerBaseQuery(db, input) {
  let query = db.collection('ledgerEntries')
    .orderBy('effectiveAt', 'desc')
    .orderBy(FieldPath.documentId(), 'desc')
  if (input.startAt) query = query.where('effectiveAt', '>=', input.startAt)
  if (input.endAt) query = query.where('effectiveAt', '<=', input.endAt)
  return query
}

async function listLedgerPage(db, input) {
  const matches = []
  let queryCursor = input.cursor
  let lastScanned = null
  let exhausted = false
  let scanned = 0
  const chunkSize = Math.min(500, Math.max(100, input.pageSize * 3))

  while (matches.length <= input.pageSize && !exhausted && scanned < maximumLedgerScan) {
    let query = ledgerBaseQuery(db, input)
    if (queryCursor) query = query.startAfter(Timestamp.fromMillis(queryCursor.effectiveAtMillis), queryCursor.id)
    const snapshot = await query.limit(chunkSize).get()
    if (snapshot.empty) {
      exhausted = true
      break
    }
    scanned += snapshot.size
    lastScanned = snapshot.docs[snapshot.docs.length - 1]
    queryCursor = {
      id: lastScanned.id,
      effectiveAtMillis: timestampMillis(lastScanned.data().effectiveAt),
    }
    for (const item of snapshot.docs) {
      if (ledgerMatches(item.data(), input)) matches.push(item)
      if (matches.length > input.pageSize) break
    }
    if (snapshot.size < chunkSize) exhausted = true
  }

  const hasExtraMatch = matches.length > input.pageSize
  const selected = matches.slice(0, input.pageSize)
  const hasMore = hasExtraMatch || !exhausted
  const cursorDocument = hasExtraMatch ? selected[selected.length - 1] : hasMore ? lastScanned : null
  return {
    entries: selected.map(serializeLedgerDocument),
    hasMore,
    nextCursor: cursorDocument ? encodeCursor(cursorDocument) : null,
  }
}

async function financeActor(request, db) {
  const actor = await trustedAccessContext(request, db)
  requireCapability(actor, 'finance.operations.manage')
  return actor
}

async function assertFinancePeriodOpen(transaction, db, value) {
  const periodId = financePeriodId(value)
  if (!periodId) throw new HttpsError('invalid-argument', 'Không thể xác định kỳ tài chính.')
  const period = await transaction.get(db.doc(`financePeriods/${periodId}`))
  if (period.exists && period.data().status === 'locked') {
    throw new HttpsError('failed-precondition', `Kỳ tài chính ${periodId} đã khóa.`)
  }
}

function updatedInstallments(contractData, installmentId, nextStatus, amount) {
  if (!installmentId) return null
  if (!Array.isArray(contractData.installments)) throw new HttpsError('failed-precondition', 'Hợp đồng không có lịch trả góp.')
  const current = contractData.installments.find((item) => item?.id === installmentId)
  if (!current) throw new HttpsError('not-found', 'Không tìm thấy kỳ trả góp.')
  const expectedStatus = nextStatus === 'paid' ? 'pending' : 'paid'
  if (current.status !== expectedStatus) {
    throw new HttpsError('failed-precondition', nextStatus === 'paid' ? 'Kỳ trả góp đã được thanh toán hoặc không còn hiệu lực.' : 'Kỳ trả góp chưa được thanh toán.')
  }
  if (Number(current.amount || 0) !== amount) throw new HttpsError('failed-precondition', 'Số tiền không khớp với kỳ trả góp.')
  const installments = contractData.installments.map((item) => item.id === installmentId ? { ...item, status: nextStatus } : item)
  const nextPending = installments
    .filter((item) => item.status === 'pending' && item.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0]
  return { installments, nextPaymentDate: nextPending?.date || null }
}

function createFinanceLedgerFunctions({ db, onCall }) {
  const listFinanceLedger = onCall(async (request) => {
    await financeActor(request, db)
    const input = normalizeLedgerListInput(request.data || {})
    const [page, summarySnapshot] = await Promise.all([
      listLedgerPage(db, input),
      ledgerBaseQuery(db, input).select('amount', 'type', 'status', 'branchId', 'effectiveAt').get(),
    ])
    return {
      ...page,
      summary: summarizeLedgerDocuments(summarySnapshot.docs, input),
      canonicalOnly: true,
      source: 'ledgerEntries',
    }
  })

  const recordContractPayment = onCall(async (request) => {
    const actor = await financeActor(request, db)
    const contractId = text(request.data?.contractId, 'Mã hợp đồng')
    const amount = positiveAmount(request.data?.amount)
    const idempotencyKey = text(request.data?.idempotencyKey, 'Khóa chống trùng', 100)
    const effectiveAt = effectiveTimestamp(request.data?.effectiveAt)
    const paymentMethod = text(request.data?.paymentMethod, 'Phương thức thanh toán', 50)
    const cashAccountId = optionalText(request.data?.cashAccountId, 'Tài khoản quỹ', 200)
    const installmentId = optionalText(request.data?.installmentId, 'Kỳ trả góp', 100)
    const contractReference = db.doc(`contracts/${contractId}`)
    const ledgerReference = db.collection('ledgerEntries').doc()
    return db.runTransaction(async (transaction) => {
      const [contract, duplicate] = await Promise.all([
        transaction.get(contractReference),
        transaction.get(db.collection('ledgerEntries').where('idempotencyKey', '==', idempotencyKey).limit(1)),
      ])
      if (!contract.exists) throw new HttpsError('not-found', 'Không tìm thấy hợp đồng.')
      if (!duplicate.empty) return { entryId: duplicate.docs[0].id, unchanged: true, referenceCode: duplicate.docs[0].data().referenceCode }
      await assertFinancePeriodOpen(transaction, db, effectiveAt)
      const cashAccount = await cashAccountForMovement(transaction, db, cashAccountId, amount)
      const data = contract.data()
      const totalDue = Number(data.totalPrice || 0) - Number(data.discount || 0)
      const nextPaid = Number(data.paidAmount || 0) + amount
      if (nextPaid > totalDue) throw new HttpsError('failed-precondition', 'Khoản thu vượt số tiền hợp đồng còn lại.')
      const installmentPatch = updatedInstallments(data, installmentId, 'paid', amount)
      const code = referenceCode('THU', ledgerReference)
      transaction.create(ledgerReference, { schemaVersion: 1, type: 'payment', contractId, studentId: data.studentId || '', branchId: data.branchId || '', installmentId: installmentId || null, cashAccountId: cashAccountId || null, amount, effectiveAt, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid, paymentMethod, referenceCode: code, idempotencyKey, status: 'posted', note: typeof request.data?.note === 'string' ? request.data.note.trim().slice(0, 500) : '' })
      transaction.update(contractReference, { paidAmount: nextPaid, ...(installmentPatch || {}), financeProjectionUpdatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      createCashMovement(transaction, db, ledgerReference, cashAccount, amount, effectiveAt, actor.uid, 'contract_payment')
      return { entryId: ledgerReference.id, unchanged: false, referenceCode: code }
    })
  })

  const reverseContractPayment = onCall(async (request) => {
    const actor = await financeActor(request, db)
    const entryId = text(request.data?.entryId, 'Mã bút toán')
    const idempotencyKey = text(request.data?.idempotencyKey, 'Khóa chống trùng', 100)
    const reason = text(request.data?.reason, 'Lý do', 500)
    const reversalEffectiveAt = Timestamp.now()
    const originalReference = db.doc(`ledgerEntries/${entryId}`)
    const reversalReference = db.collection('ledgerEntries').doc()
    return db.runTransaction(async (transaction) => {
      const [original, duplicate] = await Promise.all([transaction.get(originalReference), transaction.get(db.collection('ledgerEntries').where('idempotencyKey', '==', idempotencyKey).limit(1))])
      if (!original.exists || original.data().type !== 'payment') throw new HttpsError('failed-precondition', 'Chỉ có thể hoàn tác khoản thu hợp lệ.')
      if (!duplicate.empty) return { entryId: duplicate.docs[0].id, unchanged: true }
      if (original.data().status === 'reversed') throw new HttpsError('already-exists', 'Khoản thu đã được hoàn tác.')
      await assertFinancePeriodOpen(transaction, db, reversalEffectiveAt)
      const originalCashAccountId = optionalText(original.data().cashAccountId, 'Tài khoản quỹ', 200)
      const cashAccount = await cashAccountForMovement(transaction, db, originalCashAccountId, -positiveAmount(original.data().amount))
      const contractReference = db.doc(`contracts/${original.data().contractId}`)
      const contract = await transaction.get(contractReference)
      if (!contract.exists) throw new HttpsError('failed-precondition', 'Hợp đồng nguồn không còn tồn tại.')
      const amount = positiveAmount(original.data().amount)
      const installmentPatch = updatedInstallments(contract.data(), original.data().installmentId || '', 'pending', amount)
      transaction.create(reversalReference, { ...original.data(), type: 'reversal', amount: -amount, effectiveAt: reversalEffectiveAt, reversedEntryId: entryId, referenceCode: referenceCode('DAO', reversalReference), idempotencyKey, reason, status: 'posted', createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid })
      transaction.update(originalReference, { status: 'reversed', reversedAt: FieldValue.serverTimestamp(), reversedBy: actor.uid, reversalEntryId: reversalReference.id })
      transaction.update(contractReference, { paidAmount: Math.max(0, Number(contract.data().paidAmount || 0) - amount), ...(installmentPatch || {}), financeProjectionUpdatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      createCashMovement(transaction, db, reversalReference, cashAccount, -amount, reversalEffectiveAt, actor.uid, 'contract_payment_reversal')
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
    const installmentId = optionalText(request.data?.installmentId, 'Kỳ trả góp', 100)
    const cashAccountId = optionalText(request.data?.cashAccountId, 'Tài khoản quỹ', 200)
    const reference = db.collection('ledgerEntries').doc()
    const contractReference = db.doc(`contracts/${contractId}`)
    return db.runTransaction(async (transaction) => {
      const [contract, duplicate] = await Promise.all([transaction.get(contractReference), transaction.get(db.collection('ledgerEntries').where('idempotencyKey', '==', idempotencyKey).limit(1))])
      if (!contract.exists) throw new HttpsError('not-found', 'Không tìm thấy hợp đồng.')
      if (!duplicate.empty) return { entryId: duplicate.docs[0].id, unchanged: true }
      await assertFinancePeriodOpen(transaction, db, effectiveAt)
      const cashAccount = await cashAccountForMovement(transaction, db, cashAccountId, -amount)
      if (amount > Number(contract.data().paidAmount || 0)) throw new HttpsError('failed-precondition', 'Khoản hoàn vượt tổng tiền đã thu.')
      const installmentPatch = updatedInstallments(contract.data(), installmentId, 'pending', amount)
      transaction.create(reference, { schemaVersion: 1, type: 'refund', contractId, studentId: contract.data().studentId || '', branchId: contract.data().branchId || '', installmentId: installmentId || null, cashAccountId: cashAccountId || null, amount: -amount, effectiveAt, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid, paymentMethod: text(request.data?.paymentMethod || 'transfer', 'Phương thức hoàn'), referenceCode: referenceCode('HOAN', reference), idempotencyKey, reason, status: 'posted' })
      transaction.update(contractReference, { paidAmount: Number(contract.data().paidAmount || 0) - amount, ...(installmentPatch || {}), financeProjectionUpdatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
      createCashMovement(transaction, db, reference, cashAccount, -amount, effectiveAt, actor.uid, 'contract_refund')
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

module.exports = {
  createFinanceLedgerFunctions,
  normalizeLedgerListInput,
  summarizeLedgerDocuments,
  updatedInstallments,
}
