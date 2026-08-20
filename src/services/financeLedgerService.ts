import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebase'

function callable<Input, Output>(name: string) {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return httpsCallable<Input, Output>(firebaseFunctions, name)
}

export interface FinanceLedgerEntry {
  id: string
  type: 'payment' | 'refund' | 'adjustment' | 'reversal'
  contractId: string
  studentId: string
  branchId: string
  amount: number
  effectiveAt: string
  paymentMethod: string
  referenceCode: string
  status: string
}

export async function listFinanceLedger(limit = 250) {
  return (await callable<{ limit: number }, { entries: FinanceLedgerEntry[] }>('listFinanceLedger')({ limit })).data.entries
}

export async function recordContractPayment(input: {
  contractId: string
  amount: number
  effectiveAt: string
  paymentMethod: string
  idempotencyKey: string
  note?: string
}) {
  return (await callable<typeof input, { entryId: string; unchanged: boolean; referenceCode: string }>('recordContractPayment')(input)).data
}

export async function reverseContractPayment(entryId: string, reason: string) {
  return (await callable<{ entryId: string; reason: string; idempotencyKey: string }, { entryId: string; unchanged: boolean }>('reverseContractPayment')({ entryId, reason, idempotencyKey: crypto.randomUUID() })).data
}

export async function recordRefund(input: { contractId: string; amount: number; effectiveAt: string; paymentMethod: string; reason: string }) {
  return (await callable<typeof input & { idempotencyKey: string }, { entryId: string; unchanged: boolean }>('recordRefund')({ ...input, idempotencyKey: crypto.randomUUID() })).data
}

export async function lockFinancePeriod(periodId: string) {
  return (await callable<{ periodId: string }, { periodId: string; status: 'locked' }>('lockFinancePeriod')({ periodId })).data
}
