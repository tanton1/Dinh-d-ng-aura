import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebase'

export type PayrollRunStatus = 'draft' | 'reviewed' | 'locked' | 'paid'
export type PayrollPolicyApplicationMode = 'single' | 'trainer_assignment' | 'effective_date'

export interface PayrollRunSummary {
  id: string
  periodId: string
  policyVersion: number
  policyName: string
  policyIds: string[]
  policyApplicationMode: PayrollPolicyApplicationMode
  status: PayrollRunStatus
  requiresRebuild: boolean
  storedTeachingSlotCount?: number
  attendanceCount: number
  teachingSlotCount: number
  attendanceEventCount: number
  trainerCount: number
  staffCount: number
  workdayStaffCount: number
  attendanceReviewRequiredCount: number
  calendarReviewRequiredCount: number
  attendanceReviewRequired: boolean
  baseSalaryAmount: number
  teachingPayAmount: number
  bonusAmount: number
  grossAmount: number
  adjustmentAmount: number
  finalAmount: number
  createdAt: string
  updatedAt: string
}

export interface PayrollPolicy {
  id: string
  name: string
  audience: 'employee' | 'collaborator' | 'all'
  version: number
  effectiveFrom: string
  ratePerSession: number
  dailySessionThreshold: number
  rateAfterDailyThreshold: number
  eveningStartHour: number
  rateAfterDailyThresholdEvening: number
  status: 'active' | 'inactive'
  usageCount: number
  canDelete: boolean
  createdAt: string
}

export type PayrollTeachingTier = 'standard' | 'after_threshold' | 'after_threshold_evening'

export interface PayrollTeachingSlot {
  key: string
  date: string
  hour: number
  branchId: string
  dailyPosition: number
  tier: PayrollTeachingTier
  rate: number
  policyId: string
  policyName: string
  studentCount: number
  sessionIds: string[]
}

export interface PayrollTierSummary {
  standardCount: number
  standardAmount: number
  afterThresholdCount: number
  afterThresholdAmount: number
  afterThresholdEveningCount: number
  afterThresholdEveningAmount: number
}

export interface PayrollRunItem {
  id: string
  runId: string
  periodId: string
  trainerId: string
  staffId: string
  employmentType: 'full_time' | 'part_time' | 'collaborator'
  staffSnapshot?: {
    name?: string
    employeeCode?: string
    branchId?: string
  }
  trainerSnapshot?: {
    name?: string
    employeeCode?: string
    branchId?: string
  }
  sessionCount: number
  attendanceEventCount: number
  teachingDayCount: number
  teachingSlots: PayrollTeachingSlot[]
  tierSummary: PayrollTierSummary
  ratePerSession: number
  baseSalaryAmount: number
  teachingPayAmount: number
  commissionAmount: number
  bonusAmount: number
  deductionAmount: number
  workdaySummary: {
    employmentType: 'full_time' | 'part_time' | 'collaborator'
    standardWorkdays: number
    eligibleWorkdays: number
    paidDays: number
    autoPaidDays: number
    unpaidDays: number
    pendingDays: number
    benefitReviewDays: number
    estimatedPaidDays: number
  }
  attendanceReviewRequired: boolean
  calendarReviewRequired: boolean
  grossAmount: number
  adjustmentAmount: number
  finalAmount: number
  status: PayrollRunStatus
  requiresRebuild?: boolean
  storedSessionCount?: number
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
  const teachingSlotCount = Math.max(0, Math.trunc(amount(raw.teachingSlotCount ?? raw.attendanceCount)))
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    periodId: typeof raw.periodId === 'string' ? raw.periodId : '',
    policyVersion: amount(raw.policyVersion) || 1,
    policyName: typeof raw.policyName === 'string'
      ? raw.policyName
      : typeof (raw.policySnapshot as { name?: unknown } | undefined)?.name === 'string'
        ? String((raw.policySnapshot as { name: string }).name)
        : '',
    policyIds: Array.isArray(raw.policyIds)
      ? raw.policyIds.filter((id): id is string => typeof id === 'string')
      : typeof raw.policyId === 'string' ? [raw.policyId] : [],
    policyApplicationMode: raw.policyApplicationMode === 'trainer_assignment' || raw.policyApplicationMode === 'effective_date'
      ? raw.policyApplicationMode
      : 'single',
    status: status(raw.status),
    requiresRebuild: raw.requiresRebuild === true,
    storedTeachingSlotCount: Math.max(0, Math.trunc(amount(raw.storedTeachingSlotCount))),
    attendanceCount: teachingSlotCount,
    teachingSlotCount,
    attendanceEventCount: Math.max(0, Math.trunc(amount(raw.attendanceEventCount ?? raw.attendanceCount))),
    trainerCount: Math.max(0, Math.trunc(amount(raw.trainerCount))),
    staffCount: Math.max(0, Math.trunc(amount(raw.staffCount ?? raw.trainerCount))),
    workdayStaffCount: Math.max(0, Math.trunc(amount(raw.workdayStaffCount))),
    attendanceReviewRequiredCount: Math.max(0, Math.trunc(amount(raw.attendanceReviewRequiredCount))),
    calendarReviewRequiredCount: Math.max(0, Math.trunc(amount(raw.calendarReviewRequiredCount))),
    attendanceReviewRequired: raw.attendanceReviewRequired === true,
    baseSalaryAmount: amount(raw.baseSalaryAmount),
    teachingPayAmount: amount(raw.teachingPayAmount ?? raw.grossAmount),
    bonusAmount: amount(raw.bonusAmount),
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
    const rawTrainerSnapshot = raw.trainerSnapshot && typeof raw.trainerSnapshot === 'object'
      ? raw.trainerSnapshot as Record<string, unknown>
      : undefined
    const trainerSnapshot = rawTrainerSnapshot ? {
      name: typeof rawTrainerSnapshot.name === 'string'
        ? rawTrainerSnapshot.name
        : typeof rawTrainerSnapshot.fullName === 'string'
          ? rawTrainerSnapshot.fullName
          : typeof rawTrainerSnapshot.displayName === 'string' ? rawTrainerSnapshot.displayName : undefined,
      employeeCode: typeof rawTrainerSnapshot.employeeCode === 'string' ? rawTrainerSnapshot.employeeCode : undefined,
      branchId: typeof rawTrainerSnapshot.branchId === 'string' ? rawTrainerSnapshot.branchId : undefined,
    } : undefined
    const rawStaffSnapshot = raw.staffSnapshot && typeof raw.staffSnapshot === 'object'
      ? raw.staffSnapshot as Record<string, unknown>
      : rawTrainerSnapshot
    const staffSnapshot = rawStaffSnapshot ? {
      name: typeof rawStaffSnapshot.name === 'string' ? rawStaffSnapshot.name : undefined,
      employeeCode: typeof rawStaffSnapshot.employeeCode === 'string' ? rawStaffSnapshot.employeeCode : undefined,
      branchId: typeof rawStaffSnapshot.branchId === 'string' ? rawStaffSnapshot.branchId : undefined,
    } : undefined
    const teachingSlots: PayrollTeachingSlot[] = Array.isArray(raw.teachingSlots) ? raw.teachingSlots.flatMap((slotValue) => {
      if (!slotValue || typeof slotValue !== 'object') return []
      const slot = slotValue as Record<string, unknown>
      const tier: PayrollTeachingTier = slot.tier === 'after_threshold_evening'
        ? 'after_threshold_evening'
        : slot.tier === 'after_threshold' ? 'after_threshold' : 'standard'
      return [{
        key: typeof slot.key === 'string' ? slot.key : '',
        date: typeof slot.date === 'string' ? slot.date : '',
        hour: Math.max(0, Math.min(23, Math.trunc(amount(slot.hour)))),
        branchId: typeof slot.branchId === 'string' ? slot.branchId : '',
        dailyPosition: Math.max(1, Math.trunc(amount(slot.dailyPosition)) || 1),
        tier,
        rate: amount(slot.rate),
        policyId: typeof slot.policyId === 'string' ? slot.policyId : '',
        policyName: typeof slot.policyName === 'string' ? slot.policyName : '',
        studentCount: Math.max(1, Math.trunc(amount(slot.studentCount)) || 1),
        sessionIds: Array.isArray(slot.sessionIds) ? slot.sessionIds.filter((id): id is string => typeof id === 'string') : [],
      }]
    }) : []
    const tier = raw.tierSummary && typeof raw.tierSummary === 'object' ? raw.tierSummary as Record<string, unknown> : {}
    const rawWorkdaySummary = raw.workdaySummary && typeof raw.workdaySummary === 'object' ? raw.workdaySummary as Record<string, unknown> : {}
    return [{
      id: typeof raw.id === 'string' ? raw.id : '',
      runId: typeof raw.runId === 'string' ? raw.runId : runId,
      periodId: typeof raw.periodId === 'string' ? raw.periodId : '',
      trainerId: typeof raw.trainerId === 'string' ? raw.trainerId : '',
      staffId: typeof raw.staffId === 'string' ? raw.staffId : typeof raw.trainerId === 'string' ? raw.trainerId : '',
      employmentType: raw.employmentType === 'collaborator' || raw.employmentType === 'part_time' ? raw.employmentType : 'full_time',
      staffSnapshot,
      trainerSnapshot,
      sessionCount: teachingSlots.length || Math.max(0, Math.trunc(amount(raw.sessionCount))),
      attendanceEventCount: Math.max(0, Math.trunc(amount(raw.attendanceEventCount ?? raw.sessionCount))),
      teachingDayCount: Math.max(0, Math.trunc(amount(raw.teachingDayCount))),
      teachingSlots,
      tierSummary: {
        standardCount: Math.max(0, Math.trunc(amount(tier.standardCount))),
        standardAmount: amount(tier.standardAmount),
        afterThresholdCount: Math.max(0, Math.trunc(amount(tier.afterThresholdCount))),
        afterThresholdAmount: amount(tier.afterThresholdAmount),
        afterThresholdEveningCount: Math.max(0, Math.trunc(amount(tier.afterThresholdEveningCount))),
        afterThresholdEveningAmount: amount(tier.afterThresholdEveningAmount),
      },
      ratePerSession: amount(raw.ratePerSession),
      baseSalaryAmount: amount(raw.baseSalaryAmount),
      teachingPayAmount: amount(raw.teachingPayAmount ?? raw.grossAmount),
      commissionAmount: amount(raw.commissionAmount),
      bonusAmount: amount(raw.bonusAmount),
      deductionAmount: amount(raw.deductionAmount),
      workdaySummary: {
        employmentType: rawWorkdaySummary.employmentType === 'collaborator' || rawWorkdaySummary.employmentType === 'part_time' ? rawWorkdaySummary.employmentType : 'full_time',
        standardWorkdays: Math.max(0, Math.trunc(amount(rawWorkdaySummary.standardWorkdays))),
        eligibleWorkdays: Math.max(0, Math.trunc(amount(rawWorkdaySummary.eligibleWorkdays))),
        paidDays: Math.max(0, Math.trunc(amount(rawWorkdaySummary.paidDays))),
        autoPaidDays: Math.max(0, Math.trunc(amount(rawWorkdaySummary.autoPaidDays))),
        unpaidDays: Math.max(0, Math.trunc(amount(rawWorkdaySummary.unpaidDays))),
        pendingDays: Math.max(0, Math.trunc(amount(rawWorkdaySummary.pendingDays))),
        benefitReviewDays: Math.max(0, Math.trunc(amount(rawWorkdaySummary.benefitReviewDays))),
        estimatedPaidDays: Math.max(0, Math.trunc(amount(rawWorkdaySummary.estimatedPaidDays))),
      },
      attendanceReviewRequired: raw.attendanceReviewRequired === true,
      calendarReviewRequired: raw.calendarReviewRequired === true,
      grossAmount: amount(raw.grossAmount),
      adjustmentAmount: amount(raw.adjustmentAmount),
      finalAmount: amount(raw.finalAmount || raw.grossAmount),
      status: status(raw.status),
      requiresRebuild: raw.requiresRebuild === true,
      storedSessionCount: Math.max(0, Math.trunc(amount(raw.storedSessionCount))),
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
      audience: raw.audience === 'collaborator' || raw.audience === 'all' ? raw.audience : 'employee',
      version: amount(raw.version) || 1,
      effectiveFrom: typeof raw.effectiveFrom === 'string' ? raw.effectiveFrom : '',
      ratePerSession: amount(raw.ratePerSession),
      dailySessionThreshold: Math.max(1, Math.trunc(amount(raw.dailySessionThreshold)) || 8),
      rateAfterDailyThreshold: amount(raw.rateAfterDailyThreshold ?? raw.ratePerSession),
      eveningStartHour: Math.max(0, Math.min(23, Math.trunc(amount(raw.eveningStartHour ?? 20)))),
      rateAfterDailyThresholdEvening: amount(raw.rateAfterDailyThresholdEvening ?? raw.rateAfterDailyThreshold ?? raw.ratePerSession),
      status: raw.status === 'inactive' ? 'inactive' : 'active',
      usageCount: Math.max(0, Math.trunc(amount(raw.usageCount))),
      canDelete: raw.canDelete === true,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    } satisfies PayrollPolicy]
  }) : []
}

export async function savePayrollPolicy(input: {
  name: string
  audience: 'employee' | 'collaborator' | 'all'
  effectiveFrom: string
  ratePerSession: number
  dailySessionThreshold: number
  rateAfterDailyThreshold: number
  eveningStartHour: number
  rateAfterDailyThresholdEvening: number
}) {
  const result = await callable<typeof input, { policyId: string; unchanged: boolean }>('savePayrollPolicy')(input)
  return result.data
}

export interface CreatePayrollRunInput {
  periodId: string
  policyIds: string[]
  defaultPolicyId: string
  policyApplicationMode: Exclude<PayrollPolicyApplicationMode, 'single'>
  trainerPolicyAssignments: Array<{ trainerId: string; policyId: string }>
}

export async function createPayrollRun(input: CreatePayrollRunInput) {
  const result = await callable<CreatePayrollRunInput, { runId: string; unchanged: boolean; status: PayrollRunStatus }>('createPayrollRun')(input)
  return result.data
}

export async function managePayrollPolicy(policyId: string, action: 'hide' | 'restore' | 'delete') {
  const result = await callable<{ policyId: string; action: 'hide' | 'restore' | 'delete' }, { policyId: string; action: string; unchanged: boolean }>('managePayrollPolicy')({ policyId, action })
  return result.data
}

export async function deleteDraftPayrollRun(runId: string) {
  const result = await callable<{ runId: string }, { runId: string; unchanged: boolean }>('deleteDraftPayrollRun')({ runId })
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
