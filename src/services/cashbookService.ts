import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebaseFunctions'

function callable<Input, Output>(name: string) {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return httpsCallable<Input, Output>(firebaseFunctions, name)
}

export type CashAccountType = 'cash' | 'bank' | 'wallet'
export interface CashAccount { id: string; name: string; type: CashAccountType; branchId: string; currency: 'VND'; balance: number; status: string; openingBalanceAt: string }
export interface CashTransaction { id: string; accountId: string; pairedAccountId: string; branchId: string; type: string; category: string; amount: number; effectiveAt: string; referenceCode: string; note: string; status: string; reversedTransactionId: string }
export interface S2eCashDetailSettings { businessName: string; address: string; taxCode: string; representativeName: string; unit: string }
export interface S2eCashDetailRow { id: string; voucherNumber: string; documentDate: string; description: string; receipt: number; payment: number; runningBalance: number; category: string }
export interface S2eCashDetailSection {
  account: CashAccount
  sectionType: 'cash' | 'demand_deposit'
  openingBalance: number
  totalReceipt: number
  totalPayment: number
  closingBalance: number
  rows: S2eCashDetailRow[]
}
export interface S2eCashDetailBook {
  formCode: 'S2e-HKD'
  legalBasis: string
  periodStart: string
  periodEnd: string
  settings: S2eCashDetailSettings
  sections: S2eCashDetailSection[]
}
export interface AccountingAccount { code: string; name: string; group: 'asset' | 'liability' | 'revenue' | 'expense' }
export interface ExpensePurpose { code: string; label: string; debitAccountCode: string; expenseImpact: boolean; vatAllowed: boolean }
export interface JournalLine { side: 'debit' | 'credit'; accountCode: string; accountName: string; debit: number; credit: number; description: string }
export type ExpenseVoucherStatus = 'draft' | 'pending_approval' | 'posted' | 'reversed'
export interface ExpenseVoucher {
  id: string
  voucherNumber: string
  documentType: 'expense_voucher' | 'expense_voucher_reversal'
  status: ExpenseVoucherStatus
  revision: number
  accountId: string
  branchId: string
  purposeCode: string
  purposeLabel: string
  payeeName: string
  payeeAddress: string
  description: string
  invoiceNumber: string
  attachmentUrls: string[]
  originalDocumentCount: number
  amountBeforeTax: number
  vatAmount: number
  totalAmount: number
  amountInWords: string
  journalLines: JournalLine[]
  effectiveAt: string
  createdAt: string
  submittedAt: string
  postedAt: string
  reversedAt: string
  createdBy: string
  approvedBy: string
  postedBy: string
  reversedBy: string
  reversalVoucherId: string
}

export type ReceiptVoucherStatus = 'posted' | 'reversed'
export interface ReceiptVoucher {
  id: string
  voucherNumber: string
  documentType: 'receipt_voucher' | 'receipt_voucher_reversal'
  status: ReceiptVoucherStatus
  revision: number
  accountId: string
  branchId: string
  contractId: string
  studentId: string
  payerName: string
  payerAddress: string
  description: string
  paymentMethod: string
  source: string
  installmentId: string
  totalAmount: number
  amountInWords: string
  journalLines: JournalLine[]
  effectiveAt: string
  createdAt: string
  postedAt: string
  reversedAt: string
  ledgerEntryId: string
  journalEntryId: string
  cashTransactionId: string
  originalVoucherId: string
  reversalVoucherId: string
  reason: string
  createdBy: string
  postedBy: string
  reversedBy: string
  derived: boolean
}

export interface ExpenseVoucherInput {
  voucherId?: string
  expectedRevision?: number
  accountId: string
  purposeCode: string
  payeeName: string
  payeeAddress?: string
  description: string
  invoiceNumber?: string
  attachmentUrls?: string[]
  originalDocumentCount?: number
  amountBeforeTax: number
  vatAmount?: number
  effectiveAt: string
  submit: boolean
}

export async function listAccountingCatalog() { return (await callable<Record<string, never>, { accounts: AccountingAccount[]; expensePurposes: ExpensePurpose[]; approvalSeparationThreshold: number }>('listAccountingCatalog')({})).data }
export async function listCashAccounts() { return (await callable<Record<string, never>, { accounts: CashAccount[] }>('listCashAccounts')({})).data }
export async function initializeCashAccount(input: { name: string; type: CashAccountType; branchId: string; openingBalance: number; openingBalanceAt: string; idempotencyKey: string }) { return (await callable<typeof input, { accountId: string }>('initializeCashAccount')(input)).data }
export async function listCashTransactions(input: { accountId?: string; pageSize?: number } = {}) { return (await callable<typeof input, { transactions: CashTransaction[]; hasMore: boolean }>('listCashTransactions')(input)).data }
export async function getS2eCashDetailBook(input: { periodStart: string; periodEnd: string; accountId?: string }) { return (await callable<typeof input, S2eCashDetailBook>('getS2eCashDetailBook')(input)).data }
export async function saveS2eCashDetailSettings(input: S2eCashDetailSettings) { return (await callable<S2eCashDetailSettings, { settings: S2eCashDetailSettings }>('saveS2eCashDetailSettings')(input)).data }
export async function recordCashExpense(input: { accountId: string; amount: number; category: string; effectiveAt: string; note?: string; idempotencyKey: string }) { return (await callable<typeof input, { transactionId: string }>('recordCashExpense')(input)).data }
export async function listExpenseVouchers(input: { pageSize?: number } = {}) { return (await callable<typeof input, { vouchers: ExpenseVoucher[]; hasMore: boolean }>('listExpenseVouchers')(input)).data }
export async function listReceiptVouchers(input: { accountId?: string; pageSize?: number } = {}) { return (await callable<typeof input, { vouchers: ReceiptVoucher[]; hasMore: boolean }>('listReceiptVouchers')(input)).data }
export async function saveExpenseVoucherDraft(input: ExpenseVoucherInput) { return (await callable<ExpenseVoucherInput, { voucherId: string; voucherNumber: string; status: ExpenseVoucherStatus; revision: number; journalLines: JournalLine[] }>('saveExpenseVoucherDraft')(input)).data }
export async function approveAndPostExpenseVoucher(input: { voucherId: string; expectedRevision: number }) { return (await callable<typeof input, { voucherId: string; status: ExpenseVoucherStatus; unchanged: boolean; journalEntryId?: string; ledgerEntryId?: string }>('approveAndPostExpenseVoucher')(input)).data }
export async function reverseExpenseVoucher(input: { voucherId: string; reason: string }) { return (await callable<typeof input, { voucherId: string; status: ExpenseVoucherStatus; unchanged: boolean }>('reverseExpenseVoucher')(input)).data }
export async function transferCash(input: { fromAccountId: string; toAccountId: string; amount: number; effectiveAt: string; idempotencyKey: string }) { return (await callable<typeof input, { transactionId: string }>('transferCash')(input)).data }
