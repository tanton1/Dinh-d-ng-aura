const { FieldPath, FieldValue, Timestamp } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { trustedAccessContext, requireCapability } = require('./identity-access')

const accountTypes = new Set(['cash', 'bank', 'wallet'])
const transactionTypes = new Set(['opening_balance', 'income', 'expense', 'transfer_in', 'transfer_out', 'reversal'])

function clean(value, label, max = 200) {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result || result.length > max) throw new HttpsError('invalid-argument', `${label} không hợp lệ.`)
  return result
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

function createCashbookFunctions({ db, onCall }) {
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
    const actor = await actorForFinance(request, db)
    const accountId = clean(request.data?.accountId, 'Tài khoản quỹ', 200)
    const expenseAmount = amount(request.data?.amount)
    const category = clean(request.data?.category, 'Nhóm chi', 80)
    const note = typeof request.data?.note === 'string' ? request.data.note.trim().slice(0, 500) : ''
    const at = effectiveAt(request.data?.effectiveAt)
    const idempotencyKey = clean(request.data?.idempotencyKey, 'Khóa chống trùng', 120)
    const reference = db.doc(`cashTransactions/expense_${idempotencyKey}`)
    await db.runTransaction(async (transaction) => {
      const [duplicate, account] = await Promise.all([transaction.get(reference), transaction.get(db.doc(`cashAccounts/${accountId}`))])
      if (duplicate.exists) return
      if (!account.exists || account.data().status !== 'active') throw new HttpsError('failed-precondition', 'Tài khoản quỹ không hoạt động.')
      if (Number(account.data().balance || 0) < expenseAmount) throw new HttpsError('failed-precondition', 'Số dư quỹ không đủ.')
      transaction.update(account.ref, { balance: FieldValue.increment(-expenseAmount), updatedAt: FieldValue.serverTimestamp() })
      transaction.create(reference, { schemaVersion: 1, accountId, branchId: account.data().branchId || '', type: 'expense', category, amount: -expenseAmount, effectiveAt: at, note, status: 'posted', referenceCode: `EXP-${reference.id.slice(-8).toUpperCase()}`, idempotencyKey, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid })
    })
    return { transactionId: reference.id }
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

  return { listCashAccounts, initializeCashAccount, listCashTransactions, recordCashExpense, transferCash }
}

module.exports = { createCashbookFunctions, accountTypes, transactionTypes }
