const { FieldValue } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { cashAccountForMovement, createCashMovement, createReceiptVoucher, receiptPayer, assertFinancePeriodOpen } = require('./finance-ledger')
const { contractPaymentJournal } = require('./accounting-core')

function initialContractPayment(input, canCollect) {
  if (input === undefined) return null
  if (!canCollect) throw new HttpsError('permission-denied', 'Bạn không có quyền ghi nhận tiền trả trước.')
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpsError('invalid-argument', 'Khoản trả trước không hợp lệ.')
  const amount = Number(input.amount)
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 10_000_000_000) throw new HttpsError('invalid-argument', 'Số tiền trả trước không hợp lệ.')
  if (!amount) return null
  const { paymentMethod, cashAccountId } = input
  if (!['cash', 'transfer', 'card'].includes(paymentMethod)) throw new HttpsError('invalid-argument', 'Phương thức thanh toán không hợp lệ.')
  if (typeof cashAccountId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(cashAccountId)) throw new HttpsError('invalid-argument', 'Vui lòng chọn quỹ nhận tiền trả trước.')
  return { amount, paymentMethod, cashAccountId }
}

// Finish every read before the caller starts writing the contract and receipt.
async function prepareInitialContractPayment({ transaction, db, payment, contract, effectiveAt }) {
  if (!payment) return null
  await assertFinancePeriodOpen(transaction, db, effectiveAt)
  const cashAccount = await cashAccountForMovement(transaction, db, payment.cashAccountId, payment.amount)
  if (cashAccount.data.branchId && cashAccount.data.branchId !== contract.branchId) throw new HttpsError('failed-precondition', 'Quỹ nhận tiền không thuộc chi nhánh của hợp đồng.')
  const student = await transaction.get(db.doc(`students/${contract.studentId}`))
  return { ...payment, cashAccount, payer: receiptPayer(student, contract), effectiveAt }
}

function postInitialContractPayment({ transaction, db, plan, contract, actorUid }) {
  if (!plan) return {}
  const { amount, paymentMethod, cashAccount, payer, effectiveAt } = plan
  const ledgerReference = db.collection('ledgerEntries').doc()
  const journalReference = db.doc(`journalEntries/${ledgerReference.id}`)
  const journal = contractPaymentJournal({ amount, cashAccountType: cashAccount.data.type, recognisedReceivable: 0, advanceAccountCode: '131' })
  const note = `Thu trả trước hợp đồng ${contract.id}`
  const receipt = createReceiptVoucher(transaction, db, { ledgerReference, journalReference, cashAccount, contract, payer, journal, effectiveAt, actorUid, paymentMethod, description: note, source: 'contract_creation' })
  transaction.create(ledgerReference, {
    schemaVersion: 4, type: 'payment', eventClass: 'cash_collection', source: 'pt_gym',
    contractId: contract.id, studentId: contract.studentId, branchId: contract.branchId,
    installmentId: null, cashAccountId: cashAccount.reference.id, journalEntryId: journalReference.id,
    accountingDocumentId: receipt.reference.id, voucherNumber: receipt.voucherNumber,
    accountingCashAccountType: cashAccount.data.type, accountingAdvanceAccountCode: '131',
    amount, cashImpact: amount, revenueImpact: 0, expenseImpact: 0, receivableImpact: 0, deferredRevenueImpact: amount,
    effectiveAt, paymentMethod, referenceCode: receipt.voucherNumber, idempotencyKey: `contract-initial:${contract.id}`,
    status: 'posted', note, createdAt: FieldValue.serverTimestamp(), createdBy: actorUid,
  })
  transaction.create(journalReference, {
    schemaVersion: 1, documentType: 'receipt_voucher', documentId: receipt.reference.id,
    sourceLedgerEntryId: ledgerReference.id, referenceCode: receipt.voucherNumber, branchId: contract.branchId,
    effectiveAt, lines: journal.lines, totalDebit: journal.totalDebit, totalCredit: journal.totalCredit,
    status: 'posted', createdAt: FieldValue.serverTimestamp(), createdBy: actorUid,
  })
  createCashMovement(transaction, db, ledgerReference, cashAccount, amount, effectiveAt, actorUid, 'contract_payment', {
    referenceCode: receipt.voucherNumber, accountingDocumentId: receipt.reference.id, payerName: payer.name, note,
  })
  return { paymentEntryId: ledgerReference.id, receiptVoucherId: receipt.reference.id, receiptVoucherNumber: receipt.voucherNumber }
}

module.exports = { initialContractPayment, prepareInitialContractPayment, postInitialContractPayment }
