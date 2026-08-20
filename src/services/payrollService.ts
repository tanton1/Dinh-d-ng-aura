import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebase'

export type PayrollRunStatus = 'draft' | 'reviewed' | 'locked' | 'paid'

export interface PayrollRunSummary {
  id: string
  periodId: string
  policyVersion: number
  status: PayrollRunStatus
  attendanceCount: number
  trainerCount: number
  grossAmount: number
  adjustmentAmount: number
  finalAmount: number
  createdAt: string
  updatedAt: string
}

function callable<Input, Output>(name: string) {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return httpsCallable<Input, Output>(firebaseFunctions, name)
}

export async function listPayrollRuns(limit = 18) {
  const result = await callable<{ limit: number }, { runs: PayrollRunSummary[] }>('listPayrollRuns')({ limit })
  return result.data.runs
}

export async function createPayrollRun(periodId: string) {
  const result = await callable<{ periodId: string }, { runId: string; unchanged: boolean; status: PayrollRunStatus }>('createPayrollRun')({ periodId })
  return result.data
}

async function transition(name: string, runId: string, paymentReference?: string) {
  const result = await callable<{ runId: string; paymentReference?: string }, { runId: string; status: PayrollRunStatus }>(name)({ runId, paymentReference })
  return result.data
}

export const reviewPayrollRun = (runId: string) => transition('reviewPayrollRun', runId)
export const lockPayrollRun = (runId: string) => transition('lockPayrollRun', runId)
export const markPayrollRunPaid = (runId: string, paymentReference: string) => transition('markPayrollRunPaid', runId, paymentReference)
