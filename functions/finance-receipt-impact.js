'use strict'

// Net receipts retain legacy receipt/refund/adjustment entries and manual
// receipts. Expense refunds and payroll corrections belong to cash flow only.
function ledgerReceiptImpact(value) {
  if (!['payment', 'refund', 'reversal', 'adjustment'].includes(value.type)) return 0
  if (['accounting', 'payroll'].includes(value.source)) return 0
  if (/^(expense_|payroll_)/.test(value.eventClass || '')) return 0
  const expense = Number(value.expenseImpact || 0)
  if (Number.isFinite(expense) && expense !== 0) return 0
  if (value.cashImpact !== undefined && value.cashImpact !== null && Number.isFinite(Number(value.cashImpact))) {
    return Number(value.cashImpact)
  }
  const amount = Number(value.amount || 0)
  return Number.isFinite(amount) ? amount : 0
}

module.exports = { ledgerReceiptImpact }
