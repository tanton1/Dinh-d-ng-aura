const { AggregateField, FieldPath, FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')
const { assertFinancePeriodOpen, receiptVoucherNumber } = require('./finance-ledger')
const {
  CHART_OF_ACCOUNTS,
  EXPENSE_PURPOSES,
  RECEIPT_PURPOSES,
  expenseVoucherJournal,
  manualReceiptJournal,
  reversedJournalLines,
  amountInVietnameseWords,
} = require('./accounting-core')

const accountTypes = new Set(['cash', 'bank', 'wallet'])
const transactionTypes = new Set(['opening_balance', 'income', 'expense', 'transfer_in', 'transfer_out', 'reversal'])
const EXPENSE_APPROVAL_SEPARATION_THRESHOLD = 10_000_000
const S2E_MAX_ACCOUNTS = 50
const S2E_MAX_ROWS_PER_ACCOUNT = 2000

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

function s2ePeriod(startValue, endValue) {
  const start = new Date(startValue)
  const end = new Date(endValue)
  if (!startValue || !endValue || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new HttpsError('invalid-argument', 'Kỳ kê khai S2e-HKD không hợp lệ.')
  }
  const days = (end.getTime() - start.getTime()) / 86400000
  if (days > 366) throw new HttpsError('invalid-argument', 'Mỗi lần chỉ được lập S2e-HKD cho tối đa 366 ngày.')
  return { start: Timestamp.fromDate(start), end: Timestamp.fromDate(end) }
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

function s2eSettings(value = {}) {
  return {
    businessName: optionalClean(value.businessName, 200) || 'AURA FITNESS',
    address: optionalClean(value.address, 300),
    taxCode: optionalClean(value.taxCode, 80),
    representativeName: optionalClean(value.representativeName, 200),
    unit: optionalClean(value.unit, 30) || 'VND',
  }
}

function s2eDescription(value, accountNames) {
  if (optionalClean(value.note, 500)) return optionalClean(value.note, 500)
  if (value.type === 'transfer_in') return `Nhận chuyển tiền từ ${accountNames.get(value.pairedAccountId) || 'tài khoản khác'}`
  if (value.type === 'transfer_out') return `Chuyển tiền sang ${accountNames.get(value.pairedAccountId) || 'tài khoản khác'}`
  const labels = {
    contract_payment: 'Thu tiền hợp đồng học viên',
    contract_payment_reversal: 'Đảo khoản thu hợp đồng',
    contract_refund: 'Hoàn tiền hợp đồng',
    payroll_payment: 'Thanh toán tiền lương',
    internal_transfer: 'Điều chuyển tiền nội bộ',
  }
  return labels[value.category] || optionalClean(value.category, 200) || 'Nghiệp vụ thu, chi tiền'
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
      receiptPurposes: Object.entries(RECEIPT_PURPOSES).map(([code, value]) => ({ code, ...value })),
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

  const getS2eCashDetailBook = onCall(async (request) => {
    await actorForFinance(request, db)
    const accountId = optionalClean(request.data?.accountId, 200)
    const period = s2ePeriod(request.data?.periodStart, request.data?.periodEnd)
    const [accountSnapshot, settingsSnapshot] = await Promise.all([
      db.collection('cashAccounts').orderBy('name').limit(S2E_MAX_ACCOUNTS + 1).get(),
      db.doc('accountingSettings/s2e_hkd').get(),
    ])
    if (accountSnapshot.size > S2E_MAX_ACCOUNTS) throw new HttpsError('resource-exhausted', `S2e-HKD hỗ trợ tối đa ${S2E_MAX_ACCOUNTS} tài khoản tiền.`)
    const allAccounts = accountSnapshot.docs.map(serializeAccount)
    const selectedAccounts = accountId ? allAccounts.filter((item) => item.id === accountId) : allAccounts
    if (accountId && selectedAccounts.length === 0) throw new HttpsError('not-found', 'Không tìm thấy tài khoản tiền cần lập sổ.')
    const accountNames = new Map(allAccounts.map((item) => [item.id, item.name]))
    const sections = await Promise.all(selectedAccounts.map(async (account) => {
      const baseQuery = db.collection('cashTransactions').where('accountId', '==', account.id)
      const [openingSnapshot, rowSnapshot] = await Promise.all([
        baseQuery.where('effectiveAt', '<', period.start).aggregate({ amount: AggregateField.sum('amount') }).get(),
        baseQuery.where('effectiveAt', '>=', period.start).where('effectiveAt', '<', period.end)
          .orderBy('effectiveAt', 'asc').orderBy(FieldPath.documentId(), 'asc').limit(S2E_MAX_ROWS_PER_ACCOUNT + 1).get(),
      ])
      if (rowSnapshot.size > S2E_MAX_ROWS_PER_ACCOUNT) {
        throw new HttpsError('resource-exhausted', `Tài khoản ${account.name} có trên ${S2E_MAX_ROWS_PER_ACCOUNT} dòng trong kỳ. Hãy chia kỳ kê khai ngắn hơn.`)
      }
      let openingBalance = Number(openingSnapshot.data().amount || 0)
      const transactionDocuments = []
      rowSnapshot.docs.forEach((document) => {
        const value = document.data()
        const transactionAmount = Number(value.amount || 0)
        if (value.type === 'opening_balance') {
          openingBalance += transactionAmount
          return
        }
        transactionDocuments.push({ document, value, transactionAmount })
      })
      let runningBalance = openingBalance
      let totalReceipt = 0
      let totalPayment = 0
      const rows = transactionDocuments.map(({ document, value, transactionAmount }) => {
        const receipt = transactionAmount > 0 ? transactionAmount : 0
        const payment = transactionAmount < 0 ? Math.abs(transactionAmount) : 0
        totalReceipt += receipt
        totalPayment += payment
        runningBalance += transactionAmount
        return {
          id: document.id,
          voucherNumber: optionalClean(value.referenceCode, 100),
          documentDate: timestampIso(value.effectiveAt),
          description: s2eDescription(value, accountNames),
          receipt,
          payment,
          runningBalance,
          category: optionalClean(value.category, 120),
        }
      })
      return {
        account,
        sectionType: account.type === 'cash' ? 'cash' : 'demand_deposit',
        openingBalance,
        totalReceipt,
        totalPayment,
        closingBalance: openingBalance + totalReceipt - totalPayment,
        rows,
      }
    }))
    return {
      formCode: 'S2e-HKD',
      legalBasis: 'Thông tư số 152/2025/TT-BTC ngày 31/12/2025 của Bộ trưởng Bộ Tài chính',
      periodStart: period.start.toDate().toISOString(),
      periodEnd: period.end.toDate().toISOString(),
      settings: s2eSettings(settingsSnapshot.data()),
      sections,
    }
  })

  const saveS2eCashDetailSettings = onCall(async (request) => {
    const actor = await actorForFinance(request, db)
    const settings = {
      businessName: clean(request.data?.businessName, 'Tên hộ/cá nhân kinh doanh', 200),
      address: clean(request.data?.address, 'Địa chỉ', 300),
      taxCode: clean(request.data?.taxCode, 'Mã số thuế', 80),
      representativeName: optionalClean(request.data?.representativeName, 200),
      unit: optionalClean(request.data?.unit, 30) || 'VND',
    }
    await db.doc('accountingSettings/s2e_hkd').set({
      schemaVersion: 1,
      ...settings,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
    }, { merge: true })
    return { settings }
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

  const createManualReceiptVoucher = onCall(async (request) => {
    const actor = await actorForFinance(request, db)
    const accountId = clean(request.data?.accountId, 'Tài khoản thu', 200)
    const purposeCode = clean(request.data?.purposeCode, 'Mục đích thu', 80)
    const payerName = clean(request.data?.payerName, 'Người nộp tiền', 200)
    const payerAddress = optionalClean(request.data?.payerAddress, 300)
    const description = clean(request.data?.description, 'Nội dung thu', 500)
    const receiptAmount = amount(request.data?.amount)
    const at = effectiveAt(request.data?.effectiveAt)
    const paymentMethod = clean(request.data?.paymentMethod, 'Phương thức thanh toán', 50)
    const idempotencyKey = clean(request.data?.idempotencyKey, 'Khóa chống trùng', 120)
    const ledgerReference = db.doc(`ledgerEntries/manual_receipt_${idempotencyKey}`)
    const voucherReference = db.doc(`accountingDocuments/manual_receipt_${idempotencyKey}`)
    const journalReference = db.doc(`journalEntries/manual_receipt_${idempotencyKey}`)
    const cashReference = db.doc(`cashTransactions/manual_receipt_${idempotencyKey}`)
    return db.runTransaction(async (transaction) => {
      const [duplicate, account] = await Promise.all([
        transaction.get(voucherReference),
        transaction.get(db.doc(`cashAccounts/${accountId}`)),
      ])
      if (duplicate.exists) return { voucherId: voucherReference.id, voucherNumber: duplicate.data().voucherNumber, ledgerEntryId: ledgerReference.id, unchanged: true }
      await assertFinancePeriodOpen(transaction, db, at)
      if (!account.exists || account.data().status !== 'active') throw new HttpsError('failed-precondition', 'Tài khoản quỹ không hoạt động.')
      let journal
      try {
        journal = manualReceiptJournal({ purposeCode, amount: receiptAmount, cashAccountType: account.data().type, description })
      } catch (cause) {
        throw new HttpsError('invalid-argument', cause instanceof Error ? cause.message : 'Bút toán phiếu thu không hợp lệ.')
      }
      const number = receiptVoucherNumber(voucherReference, account.data().branchId, at)
      const common = { createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid }
      transaction.update(account.ref, { balance: FieldValue.increment(receiptAmount), updatedAt: FieldValue.serverTimestamp() })
      transaction.create(voucherReference, {
        schemaVersion: 1, documentType: 'receipt_voucher', voucherNumber: number, status: 'posted', revision: 1,
        accountId, cashAccountType: account.data().type, branchId: account.data().branchId || '', contractId: '', studentId: '',
        payerName, payerAddress, description, paymentMethod, source: 'manual_receipt', installmentId: null,
        purposeCode, purposeLabel: journal.purposeLabel, revenueImpact: journal.revenueImpact,
        totalAmount: receiptAmount, amountInWords: amountInVietnameseWords(receiptAmount), journalLines: journal.lines,
        totalDebit: journal.totalDebit, totalCredit: journal.totalCredit, effectiveAt: at, ledgerEntryId: ledgerReference.id,
        journalEntryId: journalReference.id, cashTransactionId: cashReference.id, ...common,
        postedAt: FieldValue.serverTimestamp(), postedBy: actor.uid,
      })
      transaction.create(journalReference, {
        schemaVersion: 1, documentId: voucherReference.id, documentType: 'receipt_voucher', voucherNumber: number,
        branchId: account.data().branchId || '', effectiveAt: at, status: 'posted', lines: journal.lines,
        totalDebit: journal.totalDebit, totalCredit: journal.totalCredit, ...common,
      })
      transaction.create(ledgerReference, {
        schemaVersion: 4, type: 'payment', eventClass: 'manual_cash_receipt', source: 'other', documentId: voucherReference.id,
        journalEntryId: journalReference.id, accountingDocumentId: voucherReference.id, voucherNumber: number,
        cashAccountId: accountId, branchId: account.data().branchId || '', amount: receiptAmount, cashImpact: receiptAmount,
        revenueImpact: journal.revenueImpact, expenseImpact: 0, receivableImpact: purposeCode === 'receivable_collection' ? -receiptAmount : 0,
        deferredRevenueImpact: 0, effectiveAt: at, note: description, status: 'posted', referenceCode: number,
        idempotencyKey, paymentMethod, ...common,
      })
      transaction.create(cashReference, {
        schemaVersion: 3, accountId, branchId: account.data().branchId || '', type: 'income', category: purposeCode,
        amount: receiptAmount, effectiveAt: at, payerName, note: description, status: 'posted', referenceCode: number,
        idempotencyKey, ledgerEntryId: ledgerReference.id, accountingDocumentId: voucherReference.id, ...common,
      })
      return { voucherId: voucherReference.id, voucherNumber: number, ledgerEntryId: ledgerReference.id, unchanged: false }
    })
  })

  const reverseManualReceiptVoucher = onCall(async (request) => {
    const actor = await actorForFinance(request, db)
    const voucherId = clean(request.data?.voucherId, 'Mã phiếu thu', 200)
    const reason = clean(request.data?.reason, 'Lý do đảo phiếu', 500)
    const originalReference = db.doc(`accountingDocuments/${voucherId}`)
    const reversalReference = db.doc(`accountingDocuments/reversal_${voucherId}`)
    const journalReference = db.doc(`journalEntries/reversal_${voucherId}`)
    const ledgerReference = db.doc(`ledgerEntries/reversal_${voucherId}`)
    const cashReference = db.doc(`cashTransactions/reversal_${voucherId}`)
    const at = Timestamp.now()
    return db.runTransaction(async (transaction) => {
      const [original, duplicate] = await Promise.all([transaction.get(originalReference), transaction.get(reversalReference)])
      if (duplicate.exists) return { voucherId: reversalReference.id, voucherNumber: duplicate.data().voucherNumber, unchanged: true }
      if (!original.exists || original.data().documentType !== 'receipt_voucher' || original.data().source !== 'manual_receipt') {
        throw new HttpsError('failed-precondition', 'Chỉ phiếu thu phát sinh đã ghi sổ mới dùng thao tác này.')
      }
      if (original.data().status !== 'posted') throw new HttpsError('failed-precondition', 'Phiếu thu không còn ở trạng thái đã ghi sổ.')
      await assertFinancePeriodOpen(transaction, db, at)
      const data = original.data()
      const account = await transaction.get(db.doc(`cashAccounts/${data.accountId}`))
      if (!account.exists || account.data().status !== 'active') throw new HttpsError('failed-precondition', 'Tài khoản quỹ không hoạt động.')
      const total = amount(data.totalAmount)
      if (Number(account.data().balance || 0) < total) throw new HttpsError('failed-precondition', 'Số dư không đủ để đảo phiếu thu này.')
      let lines
      try { lines = reversedJournalLines(data.journalLines) } catch { throw new HttpsError('failed-precondition', 'Bút toán phiếu thu gốc không hợp lệ để đảo.') }
      const reversalNumber = `DAO-${data.voucherNumber}`.slice(0, 100)
      const common = { createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid }
      transaction.update(account.ref, { balance: FieldValue.increment(-total), updatedAt: FieldValue.serverTimestamp() })
      transaction.create(reversalReference, {
        ...data, documentType: 'receipt_voucher_reversal', voucherNumber: reversalNumber, status: 'posted', revision: 1,
        description: `Đảo phiếu thu ${data.voucherNumber}: ${reason}`.slice(0, 500), journalLines: lines,
        effectiveAt: at, ledgerEntryId: ledgerReference.id, journalEntryId: journalReference.id, cashTransactionId: cashReference.id,
        originalVoucherId: voucherId, reason, ...common, postedAt: FieldValue.serverTimestamp(), postedBy: actor.uid,
      })
      transaction.create(journalReference, {
        schemaVersion: 1, documentId: reversalReference.id, documentType: 'receipt_voucher_reversal', voucherNumber: reversalNumber,
        originalJournalEntryId: data.journalEntryId || '', branchId: data.branchId || '', effectiveAt: at, status: 'posted',
        lines, totalDebit: total, totalCredit: total, ...common,
      })
      transaction.create(ledgerReference, {
        schemaVersion: 4, type: 'reversal', eventClass: 'manual_cash_receipt_reversal', source: 'other',
        documentId: reversalReference.id, originalDocumentId: voucherId, journalEntryId: journalReference.id,
        accountingDocumentId: reversalReference.id, voucherNumber: reversalNumber, cashAccountId: data.accountId,
        branchId: data.branchId || '', amount: -total, cashImpact: -total, revenueImpact: -Number(data.revenueImpact || 0),
        expenseImpact: 0, receivableImpact: data.purposeCode === 'receivable_collection' ? total : 0, deferredRevenueImpact: 0,
        effectiveAt: at, reason, note: reason, status: 'posted', referenceCode: reversalNumber,
        idempotencyKey: `manual-receipt-reversal:${voucherId}`, ...common,
      })
      transaction.create(cashReference, {
        schemaVersion: 3, accountId: data.accountId, branchId: data.branchId || '', type: 'reversal', category: data.purposeCode || '',
        amount: -total, effectiveAt: at, payerName: data.payerName || '', note: reason, status: 'posted', referenceCode: reversalNumber,
        reversedTransactionId: data.cashTransactionId || '', ledgerEntryId: ledgerReference.id,
        accountingDocumentId: reversalReference.id, ...common,
      })
      transaction.update(originalReference, {
        status: 'reversed', revision: FieldValue.increment(1), reversedAt: FieldValue.serverTimestamp(), reversedBy: actor.uid,
        reversalVoucherId: reversalReference.id, updatedAt: FieldValue.serverTimestamp(),
      })
      if (data.ledgerEntryId) transaction.update(db.doc(`ledgerEntries/${data.ledgerEntryId}`), { status: 'reversed', reversedAt: FieldValue.serverTimestamp(), reversedBy: actor.uid, reversalEntryId: ledgerReference.id })
      return { voucherId: reversalReference.id, voucherNumber: reversalNumber, unchanged: false }
    })
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
    getS2eCashDetailBook,
    saveS2eCashDetailSettings,
    recordCashExpense,
    listExpenseVouchers,
    listReceiptVouchers,
    createManualReceiptVoucher,
    reverseManualReceiptVoucher,
    saveExpenseVoucherDraft,
    approveAndPostExpenseVoucher,
    reverseExpenseVoucher,
    transferCash,
  }
}

module.exports = { createCashbookFunctions, accountTypes, transactionTypes }
