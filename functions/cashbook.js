const { FieldPath, FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const { assertFinancePeriodOpen, receiptVoucherNumber } = require('./finance-ledger')
const {
  CHART_OF_ACCOUNTS,
  EXPENSE_PURPOSES,
  expenseVoucherJournal,
  reversedJournalLines,
  amountInVietnameseWords,
} = require('./accounting-core')

const accountTypes = new Set(['cash', 'bank', 'wallet'])
const transactionTypes = new Set(['opening_balance', 'income', 'expense', 'transfer_in', 'transfer_out', 'reversal'])
const EXPENSE_APPROVAL_SEPARATION_THRESHOLD = 10_000_000

function clean(value, label, max = 200) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result || result.length > max) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return result
}

function optionalClean(value, max = 200) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''
}

function amount(value, allowZero = false) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < (allowZero ? 0 : 1) || result > 100000000000) throw new HttpsError('invalid-argument', 'Số tiền không hợp lệ.')
  return result
}

function effectiveAt(value) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) throw new HttpsError('invalid-argument', 'Ngày hạch toán không hợp lệ.')
  return Timestamp.fromDate(date)
}

async function actorForFinance(request, db) {
  const actor = await trustedAccessContext(request, db)
  requireCapability(actor, 'finance.operations.manage')
  return actor
}

function serializeAccount(snapshot) {
  const value = snapshot.data()
  return { id: snapshot.id, name: value.name || '', type: value.type || 'cash', branchId: value.branchId || '', currency: 'VND', balance: Number(value.balance || 0), status: value.status || 'active', openingBalanceAt: value.openingBalanceAt?.toDate?.().toISOString?.() || '' }
}

function serializeTransaction(snapshot) {
  const value = snapshot.data()
  return { id: snapshot.id, accountId: value.accountId || '', pairedAccountId: value.pairedAccountId || '', branchId: value.branchId || '', type: value.type || '', category: value.category || '', amount: Number(value.amount || 0), effectiveAt: value.effectiveAt?.toDate?.().toISOString?.() || '', referenceCode: value.referenceCode || '', note: value.note || '', status: value.status || 'posted', reversedTransactionId: value.reversedTransactionId || '' }
}

function timestampIso(value) {
  return value?.toDate?.().toISOString?.() || ''
}

function serializeExpenseVoucher(snapshot) {
  const value = snapshot.data() || {}
  return {
    id: snapshot.id,
    voucherNumber: value.voucherNumber || '',
    documentType: value.documentType || 'expense_voucher',
    status: value.status || 'draft',
    revision: Number(value.revision || 0),
    accountId: value.accountId || '',
    branchId: value.branchId || '',
    purposeCode: value.purposeCode || '',
    purposeLabel: value.purposeLabel || '',
    payeeName: value.payeeName || '',
    payeeAddress: value.payeeAddress || '',
    description: value.description || '',
    invoiceNumber: value.invoiceNumber || '',
    attachmentUrls: Array.isArray(value.attachmentUrls) ? value.attachmentUrls.slice(0, 10) : [],
    originalDocumentCount: Number(value.originalDocumentCount || 0),
    amountBeforeTax: Number(value.amountBeforeTax || 0),
    vatAmount: Number(value.vatAmount || 0),
    totalAmount: Number(value.totalAmount || 0),
    amountInWords: value.amountInWords || '',
    journalLines: Array.isArray(value.journalLines) ? value.journalLines : [],
    effectiveAt: timestampIso(value.effectiveAt),
    createdAt: timestampIso(value.createdAt),
    submittedAt: timestampIso(value.submittedAt),
    postedAt: timestampIso(value.postedAt),
    reversedAt: timestampIso(value.reversedAt),
    createdBy: value.createdBy || '',
    approvedBy: value.approvedBy || '',
    postedBy: value.postedBy || '',
    reversedBy: value.reversedBy || '',
    reversalVoucherId: value.reversalVoucherId || '',
  }
}

function serializeReceiptVoucher(snapshot) {
  const value = snapshot.data() || {}
  return {
    id: snapshot.id,
    voucherNumber: value.voucherNumber || '',
    documentType: value.documentType || 'receipt_voucher',
    status: value.status || 'posted',
    revision: Number(value.revision || 0),
    accountId: value.accountId || '',
    branchId: value.branchId || '',
    contractId: value.contractId || '',
    studentId: value.studentId || '',
    payerName: value.payerName || 'Học viên Aura',
    payerAddress: value.payerAddress || '',
    description: value.description || '',
    paymentMethod: value.paymentMethod || '',
    source: value.source || 'pt_gym',
    installmentId: value.installmentId || '',
    totalAmount: Number(value.totalAmount || 0),
    amountInWords: value.amountInWords || '',
    journalLines: Array.isArray(value.journalLines) ? value.journalLines : [],
    effectiveAt: timestampIso(value.effectiveAt),
    createdAt: timestampIso(value.createdAt),
    postedAt: timestampIso(value.postedAt),
    reversedAt: timestampIso(value.reversedAt),
    ledgerEntryId: value.ledgerEntryId || '',
    journalEntryId: value.journalEntryId || '',
    cashTransactionId: value.cashTransactionId || '',
    originalVoucherId: value.originalVoucherId || '',
    reversalVoucherId: value.reversalVoucherId || '',
    reason: value.reason || '',
    createdBy: value.createdBy || '',
    postedBy: value.postedBy || '',
    reversedBy: value.reversedBy || '',
    derived: value.derived === true,
  }
}

function voucherNumber(reference, branchId, at) {
  const date = at.toDate().toISOString().slice(0, 10).replaceAll('-', '')
  const branch = String(branchId || 'AURA').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase() || 'AURA'
  return `PC-${branch}-${date}-${reference.id.slice(0, 6).toUpperCase()}`
}

function attachmentUrls(value) {
  if (!Array.isArray(value)) return []
  if (value.length > 10) throw new HttpsError('invalid-argument', 'Mỗi phiếu chỉ được đính kèm tối đa 10 chứng từ.')
  return value.map((item) => {
    const url = optionalClean(item, 1000)
    if (!/^https:\/\//i.test(url)) throw new HttpsError('invalid-argument', 'Liên kết chứng từ đính kèm không hợp lệ.')
    return url
  })
}

function createCashbookFunctions({ db, onCall }) {
  const listAccountingCatalog = onCall(async (request) => {
    await actorForFinance(request, db)
    return {
      accounts: Object.values(CHART_OF_ACCOUNTS),
      expensePurposes: Object.entries(EXPENSE_PURPOSES).map(([code, value]) => ({ code, ...value })),
      approvalSeparationThreshold: EXPENSE_APPROVAL_SEPARATION_THRESHOLD,
    }
  })

  const listCashAccounts = onCall(async (request) => {
    await actorForFinance(request, db)
    const snapshot = await db.collection('cashAccounts').orderBy('name').limit(200).get()
    return { accounts: snapshot.docs.map(serializeAccount) }
  })

  const initializeCashAccount = onCall(async (request) => {
    const actor = await actorForFinance(request, db)
    const name = clean(request.data?.name, 'Tên tài khoản quỹ', 120)
    const type = clean(request.data?.type, 'Loại tài khoản', 30)
    if (!accountTypes.has(type)) throw new HttpsError('invalid-argument', 'Loại tài khoản quỹ không hợp lệ.')
    const branchId = clean(request.data?.branchId, 'Chi nhánh', 100)
    const openingBalance = amount(request.data?.openingBalance, true)
    const at = effectiveAt(request.data?.openingBalanceAt)
    const idempotencyKey = clean(request.data?.idempotencyKey, 'Khóa chống trùng', 120)
    const accountReference = db.collection('cashAccounts').doc()
    const transactionReference = db.doc(`cashTransactions/opening_${idempotencyKey}`)
    await db.runTransaction(async (transaction) => {
      const duplicate = await transaction.get(transactionReference)
      if (duplicate.exists) return
      transaction.create(accountReference, { schemaVersion: 1, name, type, branchId, currency: 'VND', balance: openingBalance, status: 'active', openingBalanceAt: at, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid, updatedAt: FieldValue.serverTimestamp() })
      transaction.create(transactionReference, { schemaVersion: 1, accountId: accountReference.id, branchId, type: 'opening_balance', category: 'opening_balance', amount: openingBalance, effectiveAt: at, status: 'posted', referenceCode: `OB-${accountReference.id.slice(0, 8).toUpperCase()}`, idempotencyKey, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid })
    })
    return { accountId: accountReference.id }
  })

  const listCashTransactions = onCall(async (request) => {
    await actorForFinance(request, db)
    const accountId = typeof request.data?.accountId === 'string' ? request.data.accountId.trim() : ''
    const pageSize = Math.min(100, Math.max(1, Number.isInteger(request.data?.pageSize) ? request.data.pageSize : 50))
    let query = db.collection('cashTransactions').orderBy('effectiveAt', 'desc').orderBy(FieldPath.documentId(), 'desc')
    if (accountId) query = query.where('accountId', '==', accountId)
    const snapshot = await query.limit(pageSize).get()
    return { transactions: snapshot.docs.map(serializeTransaction), hasMore: snapshot.size === pageSize }
  })

  const recordCashExpense = onCall(async (request) => {
    await actorForFinance(request, db)
    throw new HttpsError('failed-precondition', 'Ghi chi nhanh đã ngừng sử dụng. Hãy lập Phiếu chi để có chứng từ, phê duyệt và bút toán Nợ/Có đầy đủ.')
  })

  const listExpenseVouchers = onCall(async (request) => {
    await actorForFinance(request, db)
    const pageSize = Math.min(100, Math.max(1, Number.isInteger(request.data?.pageSize) ? request.data.pageSize : 50))
    const snapshot = await db.collection('accountingDocuments')
      .orderBy('createdAt', 'desc')
      .limit(Math.min(300, pageSize * 3))
      .get()
    const voucherDocuments = snapshot.docs
      .filter((document) => ['expense_voucher', 'expense_voucher_reversal'].includes(document.data()?.documentType))
      .slice(0, pageSize)
    return { vouchers: voucherDocuments.map(serializeExpenseVoucher), hasMore: voucherDocuments.length === pageSize }
  })

  const listReceiptVouchers = onCall(async (request) => {
    await actorForFinance(request, db)
    const pageSize = Math.min(100, Math.max(1, Number.isInteger(request.data?.pageSize) ? request.data.pageSize : 50))
    const accountId = optionalClean(request.data?.accountId, 200)
    const scanLimit = Math.min(500, pageSize * 5)
    const [snapshot, ledgerSnapshot] = await Promise.all([
      db.collection('accountingDocuments').orderBy('createdAt', 'desc').limit(scanLimit).get(),
      db.collection('ledgerEntries').orderBy('effectiveAt', 'desc').limit(scanLimit).get(),
    ])
    const receiptDocuments = snapshot.docs
      .filter((document) => ['receipt_voucher', 'receipt_voucher_reversal'].includes(document.data()?.documentType))
      .filter((document) => !accountId || document.data()?.accountId === accountId)
    const linkedLedgerIds = new Set(receiptDocuments.map((document) => document.data()?.ledgerEntryId).filter(Boolean))
    const legacyPayments = ledgerSnapshot.docs
      .filter((document) => document.data()?.type === 'payment')
      .filter((document) => Number(document.data()?.amount || 0) > 0)
      .filter((document) => !linkedLedgerIds.has(document.id))
      .filter((document) => !accountId || document.data()?.cashAccountId === accountId)
      .slice(0, pageSize)
    const journalReferences = legacyPayments
      .map((document) => document.data()?.journalEntryId)
      .filter(Boolean)
      .map((id) => db.doc(`journalEntries/${id}`))
    const studentIds = [...new Set(legacyPayments.map((document) => document.data()?.studentId).filter(Boolean))]
    const [journalSnapshots, studentSnapshots] = await Promise.all([
      journalReferences.length ? db.getAll(...journalReferences) : [],
      studentIds.length ? db.getAll(...studentIds.map((id) => db.doc(`students/${id}`))) : [],
    ])
    const journals = new Map(journalSnapshots.filter((item) => item.exists).map((item) => [item.id, item.data()]))
    const students = new Map(studentSnapshots.filter((item) => item.exists).map((item) => [item.id, item.data()]))
    const legacyReceipts = legacyPayments.map((document) => {
      const value = document.data()
      const student = students.get(value.studentId) || {}
      const journal = journals.get(value.journalEntryId) || {}
      const legacyReference = { id: `receipt_${document.id}` }
      return {
        id: `derived_${document.id}`,
        voucherNumber: value.voucherNumber || receiptVoucherNumber(legacyReference, value.branchId, value.effectiveAt),
        documentType: 'receipt_voucher',
        status: value.status === 'reversed' ? 'reversed' : 'posted',
        revision: 0,
        accountId: value.cashAccountId || '',
        branchId: value.branchId || '',
        contractId: value.contractId || '',
        studentId: value.studentId || '',
        payerName: student.name || student.displayName || `Học viên ${String(value.studentId || '').slice(0, 24)}`.trim(),
        payerAddress: student.address || student.homeAddress || '',
        description: value.note || `Thu tiền hợp đồng ${value.contractId || ''}`.trim(),
        paymentMethod: value.paymentMethod || '',
        source: value.source || 'pt_gym',
        installmentId: value.installmentId || '',
        totalAmount: Number(value.amount || 0),
        amountInWords: amountInVietnameseWords(Number(value.amount || 0)),
        journalLines: Array.isArray(journal.lines) ? journal.lines : [],
        effectiveAt: timestampIso(value.effectiveAt),
        createdAt: timestampIso(value.createdAt),
        postedAt: timestampIso(value.createdAt),
        reversedAt: timestampIso(value.reversedAt),
        ledgerEntryId: document.id,
        journalEntryId: value.journalEntryId || '',
        cashTransactionId: value.cashAccountId ? `ledger_${document.id}` : '',
        originalVoucherId: '',
        reversalVoucherId: '',
        reason: '',
        createdBy: value.createdBy || '',
        postedBy: value.createdBy || '',
        reversedBy: value.reversedBy || '',
        derived: true,
      }
    })
    const vouchers = [...receiptDocuments.map(serializeReceiptVoucher), ...legacyReceipts]
      .sort((left, right) => String(right.effectiveAt || right.createdAt).localeCompare(String(left.effectiveAt || left.createdAt)))
      .slice(0, pageSize)
    return { vouchers, hasMore: vouchers.length === pageSize }
  })

  const saveExpenseVoucherDraft = onCall(async (request) => {
    const actor = await actorForFinance(request, db)
    const voucherId = optionalClean(request.data?.voucherId, 200)
    if (voucherId && !/^[A-Za-z0-9_-]+$/.test(voucherId)) throw new HttpsError('invalid-argument', 'Mã phiếu chi không hợp lệ.')
    const reference = voucherId ? db.doc(`accountingDocuments/${voucherId}`) : db.collection('accountingDocuments').doc()
    const expectedRevision = Number(request.data?.expectedRevision || 0)
    const accountId = clean(request.data?.accountId, 'Tài khoản quỹ', 200)
    const purposeCode = clean(request.data?.purposeCode, 'Mục đích chi', 80)
    const payeeName = clean(request.data?.payeeName, 'Người nhận tiền', 200)
    const payeeAddress = optionalClean(request.data?.payeeAddress, 300)
    const description = clean(request.data?.description, 'Nội dung chi', 500)
    const invoiceNumber = optionalClean(request.data?.invoiceNumber, 100)
    const originalDocumentCount = amount(request.data?.originalDocumentCount || 0, true)
    if (originalDocumentCount > 100) throw new HttpsError('invalid-argument', 'Số chứng từ gốc không hợp lệ.')
    const at = effectiveAt(request.data?.effectiveAt)
    const submit = request.data?.submit === true
    const urls = attachmentUrls(request.data?.attachmentUrls)
    return db.runTransaction(async (transaction) => {
      const [current, account] = await Promise.all([
        transaction.get(reference),
        transaction.get(db.doc(`cashAccounts/${accountId}`)),
      ])
      if (!account.exists || account.data().status !== 'active') throw new HttpsError('failed-precondition', 'Tài khoản quỹ không hoạt động.')
      if (current.exists && current.data().status !== 'draft') throw new HttpsError('failed-precondition', 'Chỉ phiếu nháp mới được chỉnh sửa.')
      const currentRevision = Number(current.data()?.revision || 0)
      if (current.exists && currentRevision !== expectedRevision) throw new HttpsError('aborted', 'Phiếu chi đã thay đổi. Hãy tải lại.')
      let journal
      try {
        journal = expenseVoucherJournal({
          purposeCode,
          amountBeforeTax: request.data?.amountBeforeTax,
          vatAmount: request.data?.vatAmount || 0,
          cashAccountType: account.data().type,
          description,
        })
      } catch (cause) {
        throw new HttpsError('invalid-argument', cause instanceof Error ? cause.message : 'Bút toán phiếu chi không hợp lệ.')
      }
      const revision = currentRevision + 1
      const data = {
        schemaVersion: 1,
        documentType: 'expense_voucher',
        voucherNumber: current.data()?.voucherNumber || voucherNumber(reference, account.data().branchId, at),
        status: submit ? 'pending_approval' : 'draft',
        revision,
        accountId,
        cashAccountType: account.data().type,
        branchId: account.data().branchId || '',
        purposeCode,
        purposeLabel: journal.purposeLabel,
        payeeName,
        payeeAddress,
        description,
        invoiceNumber,
        attachmentUrls: urls,
        originalDocumentCount,
        amountBeforeTax: journal.amountBeforeTax,
        vatAmount: journal.vatAmount,
        totalAmount: journal.totalAmount,
        amountInWords: amountInVietnameseWords(journal.totalAmount),
        expenseImpact: journal.expenseImpact,
        journalLines: journal.lines,
        totalDebit: journal.totalDebit,
        totalCredit: journal.totalCredit,
        effectiveAt: at,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actor.uid,
        ...(submit ? { submittedAt: FieldValue.serverTimestamp(), submittedBy: actor.uid } : {}),
        ...(!current.exists ? { createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid } : {}),
      }
      transaction.set(reference, data, { merge: true })
      return { voucherId: reference.id, voucherNumber: data.voucherNumber, status: data.status, revision, journalLines: journal.lines }
    })
  })

  const approveAndPostExpenseVoucher = onCall(async (request) => {
    const actor = await actorForFinance(request, db)
    const voucherId = clean(request.data?.voucherId, 'Mã phiếu chi', 200)
    const expectedRevision = Number(request.data?.expectedRevision || 0)
    const reference = db.doc(`accountingDocuments/${voucherId}`)
    const journalReference = db.doc(`journalEntries/${voucherId}`)
    const ledgerReference = db.doc(`ledgerEntries/expense_voucher_${voucherId}`)
    const cashReference = db.doc(`cashTransactions/expense_voucher_${voucherId}`)
    return db.runTransaction(async (transaction) => {
      const voucher = await transaction.get(reference)
      if (!voucher.exists || voucher.data().documentType !== 'expense_voucher') throw new HttpsError('not-found', 'Không tìm thấy phiếu chi.')
      const data = voucher.data()
      if (data.status === 'posted') return { voucherId, status: 'posted', unchanged: true }
      if (data.status !== 'pending_approval') throw new HttpsError('failed-precondition', 'Phiếu chi chưa được gửi duyệt.')
      if (Number(data.revision || 0) !== expectedRevision) throw new HttpsError('aborted', 'Phiếu chi đã thay đổi. Hãy tải lại.')
      if (Number(data.totalAmount || 0) >= EXPENSE_APPROVAL_SEPARATION_THRESHOLD && data.createdBy === actor.uid) {
        throw new HttpsError('failed-precondition', `Phiếu từ ${EXPENSE_APPROVAL_SEPARATION_THRESHOLD.toLocaleString('vi-VN')}đ phải do người khác phê duyệt.`)
      }
      const [account, duplicateJournal, duplicateLedger, duplicateCash] = await Promise.all([
        transaction.get(db.doc(`cashAccounts/${data.accountId}`)),
        transaction.get(journalReference),
        transaction.get(ledgerReference),
        transaction.get(cashReference),
      ])
      if (duplicateJournal.exists || duplicateLedger.exists || duplicateCash.exists) throw new HttpsError('already-exists', 'Phiếu đã có dữ liệu ghi sổ nhưng trạng thái chưa đồng bộ. Cần đối soát.')
      await assertFinancePeriodOpen(transaction, db, data.effectiveAt)
      if (!account.exists || account.data().status !== 'active') throw new HttpsError('failed-precondition', 'Tài khoản quỹ không hoạt động.')
      const total = amount(data.totalAmount)
      if (Number(account.data().balance || 0) < total) throw new HttpsError('failed-precondition', 'Số dư quỹ không đủ để ghi phiếu chi.')
      transaction.update(account.ref, { balance: FieldValue.increment(-total), updatedAt: FieldValue.serverTimestamp() })
      transaction.create(journalReference, {
        schemaVersion: 1, documentId: voucherId, documentType: 'expense_voucher', voucherNumber: data.voucherNumber,
        branchId: data.branchId || '', effectiveAt: data.effectiveAt, status: 'posted', lines: data.journalLines,
        totalDebit: data.totalDebit, totalCredit: data.totalCredit, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid,
      })
      transaction.create(ledgerReference, {
        schemaVersion: 4, type: 'expense', eventClass: 'expense_voucher', source: 'accounting', expenseCategory: data.purposeCode,
        documentId: voucherId, journalEntryId: journalReference.id, cashAccountId: data.accountId, branchId: data.branchId || '',
        amount: -total, cashImpact: -total, revenueImpact: 0, expenseImpact: Number(data.expenseImpact || 0), receivableImpact: 0,
        deferredRevenueImpact: 0, effectiveAt: data.effectiveAt, note: data.description || '', status: 'posted', referenceCode: data.voucherNumber,
        idempotencyKey: `expense-voucher:${voucherId}`, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid,
      })
      transaction.create(cashReference, {
        schemaVersion: 3, accountId: data.accountId, branchId: data.branchId || '', type: 'expense', category: data.purposeCode,
        amount: -total, effectiveAt: data.effectiveAt, payeeName: data.payeeName, note: data.description || '', status: 'posted',
        referenceCode: data.voucherNumber, idempotencyKey: `expense-voucher:${voucherId}`, ledgerEntryId: ledgerReference.id,
        accountingDocumentId: voucherId, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid,
      })
      transaction.update(reference, {
        status: 'posted', revision: FieldValue.increment(1), approvedAt: FieldValue.serverTimestamp(), approvedBy: actor.uid,
        postedAt: FieldValue.serverTimestamp(), postedBy: actor.uid, journalEntryId: journalReference.id, ledgerEntryId: ledgerReference.id,
        cashTransactionId: cashReference.id, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid,
      })
      return { voucherId, status: 'posted', unchanged: false, journalEntryId: journalReference.id, ledgerEntryId: ledgerReference.id }
    })
  })

  const reverseExpenseVoucher = onCall(async (request) => {
    const actor = await actorForFinance(request, db)
    const voucherId = clean(request.data?.voucherId, 'Mã phiếu chi', 200)
    const reason = clean(request.data?.reason, 'Lý do đảo phiếu', 500)
    const originalReference = db.doc(`accountingDocuments/${voucherId}`)
    const reversalReference = db.doc(`accountingDocuments/reversal_${voucherId}`)
    const journalReference = db.doc(`journalEntries/reversal_${voucherId}`)
    const ledgerReference = db.doc(`ledgerEntries/expense_voucher_reversal_${voucherId}`)
    const cashReference = db.doc(`cashTransactions/expense_voucher_reversal_${voucherId}`)
    const at = Timestamp.now()
    return db.runTransaction(async (transaction) => {
      const [original, duplicate] = await Promise.all([transaction.get(originalReference), transaction.get(reversalReference)])
      if (duplicate.exists) return { voucherId: reversalReference.id, status: 'posted', unchanged: true }
      if (!original.exists || original.data().status !== 'posted') throw new HttpsError('failed-precondition', 'Chỉ phiếu đã ghi sổ mới được đảo.')
      const data = original.data()
      const [account, duplicateJournal, duplicateLedger, duplicateCash] = await Promise.all([
        transaction.get(db.doc(`cashAccounts/${data.accountId}`)), transaction.get(journalReference), transaction.get(ledgerReference), transaction.get(cashReference),
      ])
      if (duplicateJournal.exists || duplicateLedger.exists || duplicateCash.exists) throw new HttpsError('already-exists', 'Dữ liệu đảo phiếu chưa đồng bộ. Cần đối soát.')
      await assertFinancePeriodOpen(transaction, db, at)
      if (!account.exists || account.data().status !== 'active') throw new HttpsError('failed-precondition', 'Tài khoản quỹ không hoạt động.')
      const total = amount(data.totalAmount)
      let lines
      try { lines = reversedJournalLines(data.journalLines) } catch { throw new HttpsError('failed-precondition', 'Bút toán gốc không hợp lệ để đảo.') }
      const reversalNumber = `DAO-${data.voucherNumber}`.slice(0, 100)
      transaction.update(account.ref, { balance: FieldValue.increment(total), updatedAt: FieldValue.serverTimestamp() })
      transaction.create(reversalReference, {
        ...data, documentType: 'expense_voucher_reversal', voucherNumber: reversalNumber, status: 'posted', revision: 1,
        journalLines: lines, effectiveAt: at, reason, originalVoucherId: voucherId, createdAt: FieldValue.serverTimestamp(),
        createdBy: actor.uid, approvedAt: FieldValue.serverTimestamp(), approvedBy: actor.uid, postedAt: FieldValue.serverTimestamp(), postedBy: actor.uid,
        journalEntryId: journalReference.id, ledgerEntryId: ledgerReference.id, cashTransactionId: cashReference.id,
      })
      transaction.create(journalReference, {
        schemaVersion: 1, documentId: reversalReference.id, documentType: 'expense_voucher_reversal', voucherNumber: reversalNumber,
        originalJournalEntryId: data.journalEntryId || voucherId, branchId: data.branchId || '', effectiveAt: at, status: 'posted', lines,
        totalDebit: total, totalCredit: total, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid,
      })
      transaction.create(ledgerReference, {
        schemaVersion: 4, type: 'reversal', eventClass: 'expense_voucher_reversal', source: 'accounting', expenseCategory: data.purposeCode,
        documentId: reversalReference.id, originalDocumentId: voucherId, journalEntryId: journalReference.id, cashAccountId: data.accountId,
        branchId: data.branchId || '', amount: total, cashImpact: total, revenueImpact: 0, expenseImpact: -Number(data.expenseImpact || 0),
        receivableImpact: 0, deferredRevenueImpact: 0, effectiveAt: at, reason, status: 'posted', referenceCode: reversalNumber,
        idempotencyKey: `expense-voucher-reversal:${voucherId}`, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid,
      })
      transaction.create(cashReference, {
        schemaVersion: 3, accountId: data.accountId, branchId: data.branchId || '', type: 'reversal', category: data.purposeCode,
        amount: total, effectiveAt: at, note: reason, status: 'posted', referenceCode: reversalNumber,
        reversedTransactionId: data.cashTransactionId || `expense_voucher_${voucherId}`, ledgerEntryId: ledgerReference.id,
        accountingDocumentId: reversalReference.id, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid,
      })
      transaction.update(originalReference, {
        status: 'reversed', revision: FieldValue.increment(1), reversedAt: FieldValue.serverTimestamp(), reversedBy: actor.uid,
        reversalVoucherId: reversalReference.id, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid,
      })
      return { voucherId: reversalReference.id, status: 'posted', unchanged: false }
    })
  })

  const transferCash = onCall(async (request) => {
    const actor = await actorForFinance(request, db)
    const fromAccountId = clean(request.data?.fromAccountId, 'Quỹ nguồn', 200)
    const toAccountId = clean(request.data?.toAccountId, 'Quỹ nhận', 200)
    if (fromAccountId === toAccountId) throw new HttpsError('invalid-argument', 'Quỹ nguồn và quỹ nhận phải khác nhau.')
    const transferAmount = amount(request.data?.amount)
    const at = effectiveAt(request.data?.effectiveAt)
    const idempotencyKey = clean(request.data?.idempotencyKey, 'Khóa chống trùng', 120)
    const outReference = db.doc(`cashTransactions/transfer_out_${idempotencyKey}`)
    const inReference = db.doc(`cashTransactions/transfer_in_${idempotencyKey}`)
    await db.runTransaction(async (transaction) => {
      const [duplicate, from, to] = await Promise.all([transaction.get(outReference), transaction.get(db.doc(`cashAccounts/${fromAccountId}`)), transaction.get(db.doc(`cashAccounts/${toAccountId}`))])
      if (duplicate.exists) return
      if (!from.exists || !to.exists || from.data().status !== 'active' || to.data().status !== 'active') throw new HttpsError('failed-precondition', 'Tài khoản quỹ không hoạt động.')
      if (Number(from.data().balance || 0) < transferAmount) throw new HttpsError('failed-precondition', 'Số dư quỹ nguồn không đủ.')
      transaction.update(from.ref, { balance: FieldValue.increment(-transferAmount), updatedAt: FieldValue.serverTimestamp() })
      transaction.update(to.ref, { balance: FieldValue.increment(transferAmount), updatedAt: FieldValue.serverTimestamp() })
      const common = { schemaVersion: 1, effectiveAt: at, status: 'posted', idempotencyKey, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid }
      transaction.create(outReference, { ...common, accountId: fromAccountId, pairedAccountId: toAccountId, branchId: from.data().branchId || '', type: 'transfer_out', category: 'internal_transfer', amount: -transferAmount, referenceCode: `TRF-${idempotencyKey.slice(0, 8).toUpperCase()}` })
      transaction.create(inReference, { ...common, accountId: toAccountId, pairedAccountId: fromAccountId, branchId: to.data().branchId || '', type: 'transfer_in', category: 'internal_transfer', amount: transferAmount, referenceCode: `TRF-${idempotencyKey.slice(0, 8).toUpperCase()}` })
    })
    return { transactionId: outReference.id }
  })

  return {
    listAccountingCatalog,
    listCashAccounts,
    initializeCashAccount,
    listCashTransactions,
    recordCashExpense,
    listExpenseVouchers,
    listReceiptVouchers,
    saveExpenseVoucherDraft,
    approveAndPostExpenseVoucher,
    reverseExpenseVoucher,
    transferCash,
  }
}

module.exports = { createCashbookFunctions, accountTypes, transactionTypes }
