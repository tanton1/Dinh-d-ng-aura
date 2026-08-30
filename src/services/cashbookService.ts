import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebaseFunctions'

function callable<Input, Output>(name: string) {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return httpsCallable<Input, Output>(firebaseFunctions, name)
}

export type CashAccountType = 'cash' | 'bank' | 'wallet'
export interface CashAccount { id: string; name: string; type: CashAccountType; branchId: string; currency: 'VND'; balance: number; status: string; openingBalanceAt: string }
export interface CashTransaction { id: string; accountId: string; pairedAccountId: string; branchId: string; type: string; category: string; amount: number; effectiveAt: string; referenceCode: string; note: string; status: string; reversedTransactionId: string }

export async function listCashAccounts() { return (await callable<Record<string, never>, { accounts: CashAccount[] }>('listCashAccounts')({})).data }
export async function initializeCashAccount(input: { name: string; type: CashAccountType; branchId: string; openingBalance: number; openingBalanceAt: string; idempotencyKey: string }) { return (await callable<typeof input, { accountId: string }>('initializeCashAccount')(input)).data }
export async function listCashTransactions(input: { accountId?: string; pageSize?: number } = {}) { return (await callable<typeof input, { transactions: CashTransaction[]; hasMore: boolean }>('listCashTransactions')(input)).data }
export async function recordCashExpense(input: { accountId: string; amount: number; category: string; effectiveAt: string; note?: string; idempotencyKey: string }) { return (await callable<typeof input, { transactionId: string }>('recordCashExpense')(input)).data }
export async function transferCash(input: { fromAccountId: string; toAccountId: string; amount: number; effectiveAt: string; idempotencyKey: string }) { return (await callable<typeof input, { transactionId: string }>('transferCash')(input)).data }
