import type { FinanceLedgerSummary, FinanceLedgerQuery, FinanceLedgerPage } from './financeLedgerTypes'
export type { FinanceLedgerType, FinanceLedgerStatus, FinanceLedgerEntry, FinanceLedgerSummary, FinanceLedgerQuery, FinanceLedgerPage } from './financeLedgerTypes'
import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebaseFunctions'
import { normalizeFinanceLedgerPage } from '../utils/financeLedgerNormalization'
export { normalizeFinanceLedgerSummary } from '../utils/financeLedgerNormalization'

function callable<Input, Output>(name: string) {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return httpsCallable<Input, Output>(firebaseFunctions, name)
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
  const { callSecondaryRead } = await import('./secondaryReadService')
  const result = await callSecondaryRead<FinanceLedgerQuery, unknown>('listFinanceLedger', {
    pageSize: 50,
    status: 'all',
    ...query,
  })
  return normalizeFinanceLedgerPage(result)
}

export async function recordContractPayment(input: {
  contractId: string
  amount: number
  effectiveAt: string
  paymentMethod: string
  idempotencyKey: string
  note?: string
  installmentId?: string
  cashAccountId: string
  expectedSettlementRevision?: number
}) {
  return (await callable<typeof input, { entryId: string; unchanged: boolean; referenceCode: string; receiptVoucherId: string | null; receiptVoucherNumber: string | null }>('recordContractPayment')(input)).data
}

export async function reverseContractPayment(entryId: string, reason: string) {
  return (await callable<{ entryId: string; reason: string; idempotencyKey: string }, { entryId: string; unchanged: boolean; receiptVoucherId?: string; receiptVoucherNumber?: string }>('reverseContractPayment')({ entryId, reason, idempotencyKey: crypto.randomUUID() })).data
}

export async function lockFinancePeriod(periodId: string) {
  return (await callable<{ periodId: string }, { periodId: string; status: 'locked' }>('lockFinancePeriod')({ periodId })).data
}
