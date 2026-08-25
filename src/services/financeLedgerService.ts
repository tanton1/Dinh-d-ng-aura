import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebase'
import { normalizeFinanceLedgerPage } from '../utils/financeLedgerNormalization'
export { normalizeFinanceLedgerSummary } from '../utils/financeLedgerNormalization'

function callable<Input, Output>(name: string) {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return httpsCallable<Input, Output>(firebaseFunctions, name)
}

export type FinanceLedgerType = 'payment' | 'refund' | 'adjustment' | 'reversal' | 'revenue_recognition' | 'expense' | 'payroll'
export type FinanceLedgerStatus = 'pending' | 'posted' | 'reversed'

export interface FinanceLedgerEntry {
  id: string
  type: FinanceLedgerType
  eventClass: string
  source: string
  contractId: string
  studentId: string
  branchId: string
  installmentId: string
  amount: number
  cashImpact: number | null
  revenueImpact: number | null
  expenseImpact: number | null
  receivableImpact: number | null
  deferredRevenueImpact: number | null
  effectiveAt: string
  paymentMethod: string
  referenceCode: string
  status: FinanceLedgerStatus
  reversedEntryId: string
  note: string
  reason: string
}

export interface FinanceLedgerSummary {
  collectedAmount: number
  refundedAmount: number
  reversedAmount: number
  adjustmentAmount: number
  cashIn: number
  cashOut: number
  cashNet: number
  recognisedRevenue: number
  operatingExpense: number
  operatingResult: number
  /** Compatibility alias returned for older clients. Prefer cashNet. */
  netRevenue: number
  transactionCount: number
  dailySeries: Array<{ date: string; total: number }>
}

export interface FinanceLedgerQuery {
  pageSize?: number
  cursor?: string | null
  startAt?: string
  endAt?: string
  branchId?: string
  types?: FinanceLedgerType[]
  status?: FinanceLedgerStatus | 'all'
}

export interface FinanceLedgerPage {
  entries: FinanceLedgerEntry[]
  summary: FinanceLedgerSummary
  hasMore: boolean
  nextCursor: string | null
  canonicalOnly: true
  source: 'ledgerEntries'
}

export const emptyFinanceLedgerSummary: FinanceLedgerSummary = {
  collectedAmount: 0,
  refundedAmount: 0,
  reversedAmount: 0,
  adjustmentAmount: 0,
  cashIn: 0,
  cashOut: 0,
  cashNet: 0,
  recognisedRevenue: 0,
  operatingExpense: 0,
  operatingResult: 0,
  netRevenue: 0,
  transactionCount: 0,
  dailySeries: [],
}

export async function listFinanceLedger(query: FinanceLedgerQuery = {}): Promise<FinanceLedgerPage> {
  const result = await callable<FinanceLedgerQuery, unknown>('listFinanceLedger')({
    pageSize: 50,
    status: 'all',
    ...query,
  })
  return normalizeFinanceLedgerPage(result.data)
}

export async function recordContractPayment(input: {
  contractId: string
  amount: number
  effectiveAt: string
  paymentMethod: string
  idempotencyKey: string
  note?: string
  installmentId?: string
  cashAccountId?: string
}) {
  return (await callable<typeof input, { entryId: string; unchanged: boolean; referenceCode: string }>('recordContractPayment')(input)).data
}

export async function reverseContractPayment(entryId: string, reason: string) {
  return (await callable<{ entryId: string; reason: string; idempotencyKey: string }, { entryId: string; unchanged: boolean }>('reverseContractPayment')({ entryId, reason, idempotencyKey: crypto.randomUUID() })).data
}

export async function recordRefund(input: {
  contractId: string
  amount: number
  effectiveAt: string
  paymentMethod: string
  reason: string
  installmentId?: string
  cashAccountId?: string
  idempotencyKey?: string
}) {
  const idempotencyKey = input.idempotencyKey || crypto.randomUUID()
  return (await callable<Omit<typeof input, 'idempotencyKey'> & { idempotencyKey: string }, { entryId: string; unchanged: boolean }>('recordRefund')({ ...input, idempotencyKey })).data
}

export async function lockFinancePeriod(periodId: string) {
  return (await callable<{ periodId: string }, { periodId: string; status: 'locked' }>('lockFinancePeriod')({ periodId })).data
}
