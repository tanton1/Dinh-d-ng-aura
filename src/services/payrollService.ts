import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebase'

export type PayrollRunStatus = 'draft' | 'reviewed' | 'locked' | 'paid'

export interface PayrollRunSummary {
  id: string
  periodId: string
  policyVersion: number
  policyName: string
  status: PayrollRunStatus
  attendanceCount: number
  trainerCount: number
  grossAmount: number
  adjustmentAmount: number
  finalAmount: number
  createdAt: string
  updatedAt: string
}

export interface PayrollPolicy {
  id: string
  name: string
  version: number
  effectiveFrom: string
  ratePerSession: number
  status: 'active' | 'inactive'
  createdAt: string
}

export interface PayrollRunItem {
  id: string
  runId: string
  periodId: string
  trainerId: string
  trainerSnapshot?: {
    name?: string
    employeeCode?: string
    branchId?: string
  }
  sessionCount: number
  ratePerSession: number
  grossAmount: number
  adjustmentAmount: number
  finalAmount: number
  status: PayrollRunStatus
  evidenceSource?: string
  createdAt: string
}

export interface PayrollRunDetail {
  run: PayrollRunSummary & {
    policyId?: string
    paymentReference?: string
    cashAccountId?: string
  }
  items: PayrollRunItem[]
}

function callable<Input, Output>(name: string) {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return httpsCallable<Input, Output>(firebaseFunctions, name)
}

function amount(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function status(value: unknown): PayrollRunStatus {
  return value === 'reviewed' || value === 'locked' || value === 'paid' ? value : 'draft'
}

function normaliseRun(value: unknown): PayrollRunSummary {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    periodId: typeof raw.periodId === 'string' ? raw.periodId : '',
    policyVersion: amount(raw.policyVersion) || 1,
    policyName: typeof raw.policyName === 'string'
      ? raw.policyName
      : typeof (raw.policySnapshot as { name?: unknown } | undefined)?.name === 'string'
        ? String((raw.policySnapshot as { name: string }).name)
        : '',
    status: status(raw.status),
    attendanceCount: Math.max(0, Math.trunc(amount(raw.attendanceCount))),
    trainerCount: Math.max(0, Math.trunc(amount(raw.trainerCount))),
    grossAmount: amount(raw.grossAmount),
    adjustmentAmount: amount(raw.adjustmentAmount),
    finalAmount: amount(raw.finalAmount || raw.grossAmount),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
  }
}

export async function listPayrollRuns(limit = 18) {
  const result = await callable<{ limit: number }, { runs?: unknown[] }>('listPayrollRuns')({ limit })
  return Array.isArray(result.data.runs) ? result.data.runs.map(normaliseRun).filter((run) => run.id) : []
}

export async function getPayrollRun(runId: string): Promise<PayrollRunDetail> {
  const result = await callable<{ runId: string }, { run?: unknown; items?: unknown[] }>('getPayrollRun')({ runId })
  const rawRun = result.data.run && typeof result.data.run === 'object' ? result.data.run as Record<string, unknown> : {}
  const items = Array.isArray(result.data.items) ? result.data.items.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const raw = value as Record<string, unknown>
    const trainerSnapshot = raw.trainerSnapshot && typeof raw.trainerSnapshot === 'object'
      ? raw.trainerSnapshot as PayrollRunItem['trainerSnapshot']
      : undefined
    return [{
      id: typeof raw.id === 'string' ? raw.id : '',
      runId: typeof raw.runId === 'string' ? raw.runId : runId,
      periodId: typeof raw.periodId === 'string' ? raw.periodId : '',
      trainerId: typeof raw.trainerId === 'string' ? raw.trainerId : '',
      trainerSnapshot,
      sessionCount: Math.max(0, Math.trunc(amount(raw.sessionCount))),
      ratePerSession: amount(raw.ratePerSession),
      grossAmount: amount(raw.grossAmount),
      adjustmentAmount: amount(raw.adjustmentAmount),
      finalAmount: amount(raw.finalAmount || raw.grossAmount),
      status: status(raw.status),
      evidenceSource: typeof raw.evidenceSource === 'string' ? raw.evidenceSource : undefined,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    } satisfies PayrollRunItem]
  }) : []
  return {
    run: {
      ...normaliseRun(rawRun),
      policyId: typeof rawRun.policyId === 'string' ? rawRun.policyId : undefined,
      paymentReference: typeof rawRun.paymentReference === 'string' ? rawRun.paymentReference : undefined,
      cashAccountId: typeof rawRun.cashAccountId === 'string' ? rawRun.cashAccountId : undefined,
    },
    items,
  }
}

export async function listPayrollPolicies(): Promise<PayrollPolicy[]> {
  const result = await callable<Record<string, never>, { policies?: unknown[] }>('listPayrollPolicies')({})
  return Array.isArray(result.data.policies) ? result.data.policies.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const raw = value as Record<string, unknown>
    const id = typeof raw.id === 'string' ? raw.id : ''
    if (!id) return []
    return [{
      id,
      name: typeof raw.name === 'string' ? raw.name : 'Chính sách lương PT',
      version: amount(raw.version) || 1,
      effectiveFrom: typeof raw.effectiveFrom === 'string' ? raw.effectiveFrom : '',
      ratePerSession: amount(raw.ratePerSession),
      status: raw.status === 'inactive' ? 'inactive' : 'active',
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    } satisfies PayrollPolicy]
  }) : []
}

export async function savePayrollPolicy(input: { name: string; effectiveFrom: string; ratePerSession: number }) {
  const result = await callable<typeof input, { policyId: string; unchanged: boolean }>('savePayrollPolicy')(input)
  return result.data
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

export interface PayrollPayoutInput {
  runId: string
  cashAccountId: string
  paymentReference: string
}

export interface PayrollPayoutResult {
  runId: string
  status: PayrollRunStatus
  unchanged: boolean
  paymentLedgerEntryId: string
}

/**
 * Payroll payout is deliberately separate from the payroll accrual. The
 * backend creates the cash-book transaction and the immutable payout ledger
 * entry in the same transaction before it marks the run as paid.
 */
export async function markPayrollRunPaid(input: PayrollPayoutInput) {
  const result = await callable<PayrollPayoutInput, PayrollPayoutResult>('markPayrollRunPaid')(input)
  return result.data
}
