import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions, firebaseScheduleOptimizerFunctions } from '../lib/firebaseFunctions'

export type PayrollRunStatus = 'draft' | 'reviewed' | 'locked' | 'paid'
export type PayrollPolicyApplicationMode = 'single' | 'staff_profile' | 'trainer_assignment' | 'effective_date'
export type PayrollProfile = 'probation' | 'official' | 'senior' | 'part_time' | 'collaborator'
export type PayrollRankCode = 'p0' | 'p1' | 'p2' | 'p3' | 'p4'
export type PayrollTeachingRateMode = 'absolute' | 'percent_of_rank_rate'
export type PayrollRemediation = 'workdays' | 'teaching_history' | 'staff_profile' | 'policy' | 'delete_rebuild' | 'retry'

export interface PayrollViolation {
  code: string
  severity: 'error' | 'warning'
  title: string
  detail: string
  remediation: PayrollRemediation
  staffId?: string
  staffName?: string
  trainerId?: string
  trainerName?: string
  trainerIds?: string[]
  trainerNames?: string[]
  studentId?: string
  studentName?: string
  studentIds?: string[]
  studentNames?: string[]
  branchId?: string
  branchName?: string
  branchIds?: string[]
  branchNames?: string[]
  sessionIds?: string[]
  conflictingSessionIds?: string[]
  date?: string
  hour?: number
  hours?: number[]
  sessionId?: string
  attendanceEventId?: string
  policyId?: string
  periodId?: string
  supportId?: string
  runStatus?: string
  relatedSessions?: Array<{
    sessionId: string
    trainerId?: string
    trainerName?: string
    branchId?: string
    branchName?: string
    date?: string
    hour?: number | null
  }>
}

export interface PayrollFailure {
  message: string
  code: string
  violations: PayrollViolation[]
}

export interface PayrollAdjustment {
  id: string
  periodId: string
  staffId: string
  staffSnapshot: { name?: string; employeeCode?: string; branchId?: string }
  type: 'bonus' | 'deduction'
  amount: number
  reason: string
  evidenceReference: string
  status: 'active' | 'voided'
  createdAt: string
  voidedAt: string
}

export type PayrollEarningStatus = 'pending_review' | 'approved' | 'disputed' | 'rejected' | 'reversed' | 'paid'
export interface PayrollEarningEvent {
  id: string
  periodId: string
  staffId: string
  type: 'renew_commission' | 'self_generated_commission' | 'kpi_bonus' | 'bonus' | 'deduction' | 'renew_commission_reversal' | 'other'
  sourceType: string
  sourceId: string
  grossAmount: number
  signedAmount: number
  evidenceReference: string
  description: string
  status: PayrollEarningStatus
  reviewReason: string
  createdAt: string
  reviewedAt: string
  deadline: string
  originalRate?: number
  attributionPercent?: number
  commissionBaseAmount?: number
}

export interface PayrollRunSummary {
  id: string
  periodId: string
  policyVersion: number
  policyName: string
  policyIds: string[]
  policyApplicationMode: PayrollPolicyApplicationMode
  status: PayrollRunStatus
  requiresRebuild: boolean
  sourceDataStale: boolean
  storedTeachingSlotCount?: number
  attendanceCount: number
  teachingSlotCount: number
  crossBranchWarningCount?: number
  attendanceEventCount: number
  trainerCount: number
  staffCount: number
  workdayStaffCount: number
  attendanceReviewRequiredCount: number
  calendarReviewRequiredCount: number
  teachingEvidenceReviewRequiredCount: number
  teachingEvidenceReviewRequiredSessionIds: string[]
  validationViolationCount: number
  validationViolations: PayrollViolation[]
  attendanceReviewRequired: boolean
  baseSalaryAmount: number
  teachingPayAmount: number
  commissionAmount: number
  bonusAmount: number
  deductionAmount: number
  earningEventApprovedAmount?: number
  earningEventPendingAmount?: number
  earningEventDisputedAmount?: number
  sessionEvidencePendingAmount?: number
  targetStatus?: 'approved' | 'provisional' | 'not_required' | ''
  targetSource?: 'current_period' | 'manager_input' | 'previous_period' | 'policy_default' | ''
  targetSourcePeriodId?: string
  grossAmount: number
  adjustmentAmount: number
  finalAmount: number
  intelligenceSchemaVersion?: number
  intelligencePolicyId?: string
  intelligenceSummary?: {
    enabled: boolean
    policyId: string
    policyVersion: number
    policyName: string
    staffCount: number
    evidenceCount: number
    reviewCount: number
    renewalWonCount: number
    attributedRevenue: number
    rankCounts: Record<string, number>
    amountImpact: 'none'
    sourceTruncated: boolean
  }
  createdAt: string
  updatedAt: string
}

export interface PayrollPolicy {
  id: string
  name: string
  audience: 'employee' | 'collaborator' | 'all'
  eligibleProfiles: PayrollProfile[]
  version: number
  effectiveFrom: string
  teachingRateMode: PayrollTeachingRateMode
  defaultRankCode: PayrollRankCode
  rankRateCards: Record<PayrollRankCode, number>
  rateTierPercents: { standard: number; afterThreshold: number; evening: number; afterThresholdEvening: number }
  eveningRequiresOvertime: true
  ratePerSession: number
  dailySessionThreshold: number
  rateAfterDailyThreshold: number
  eveningStartHour: number
  rateAfterDailyThresholdEvening: number
  capabilities: {
    baseSalaryEnabled: boolean
    teachingCommissionEnabled: boolean
    kpiBonusEnabled: boolean
    renewCommissionEnabled: boolean
    selfGeneratedCommissionEnabled: boolean
    additionalBonusEnabled: boolean
  }
  renewEligibility: { maxDaysRemaining: number; maxSessionsRemaining: number; minConsumedPercent: number; requireMostlyUsedProgram: boolean }
  sessionEvidence: { enabled: boolean; noteSlaHours: number; requiredFields: string[]; allowManagerOverride: boolean }
  dispute: { resolutionSlaHours: number; allowPartialPayment: boolean }
  status: 'active' | 'inactive'
  usageCount: number
  canDelete: boolean
  createdAt: string
}

export interface PayrollTarget {
  periodId: string
  status: 'approved' | 'provisional'
  source: 'current_period' | 'manager_input' | 'previous_period' | 'policy_default'
  sourcePeriodId: string
  metricTargets: Record<string, number>
  reason: string
  approvedBy: string
  approvedAt: string
}

export interface PayrollIntelligenceMetric {
  id: string
  label: string
  source: string
  enabled: boolean
  weight: number
  target: number
  direction: 'higher_is_better' | 'lower_is_better'
  cap: number
}

export interface PayrollIntelligencePolicy {
  id: string
  name: string
  version: number
  effectiveFrom: string
  status: 'active' | 'inactive'
  enabled: boolean
  metrics: Record<string, PayrollIntelligenceMetric>
  attributionRules: Array<{ sourceType: string; priority: string[]; splitMode: 'single' | 'equal' }>
  rankBands: Array<{ code: string; label: string; minScore: number; maxScore: number }>
  renew: { wonStages: string[]; creditAssisted: boolean }
  amountImpact: 'none'
}

export interface PayrollEvidenceLedgerEntry {
  id: string
  sourceType: string
  sourceId: string
  date: string
  staffId: string
  role: string
  quantity: number
  value: number
  status: 'verified' | 'review'
  attributionConflict?: boolean
  reason: string
}

export interface PayrollIntelligenceSnapshot {
  schemaVersion: number
  enabled: boolean
  policyId: string
  policyVersion: number
  policyName: string
  policySnapshot?: PayrollIntelligencePolicy | null
  evidenceLedger: PayrollEvidenceLedgerEntry[]
  evidenceLedgerSummary: { count: number; reviewCount: number; truncated: boolean; bySource: Record<string, number>; byRole: Record<string, number> }
  attribution: { conflictCount: number; sourceCount: number; attributedRevenue: number; attributedCommission: number; bySource: Record<string, number>; byRole: Record<string, number> }
  renew: { wonCount: number; assistedCount: number; attributedRevenue: number; reviewCount: number }
  kpi: { enabled: boolean; score: number | null; weightTotal: number; metrics: Array<{ id: string; label: string; source: string; target: number; actual: number; weight: number; score: number; weightedScore: number }>; reason?: string }
  rank: { code: string; label: string; score: number | null; configured: boolean }
  amountImpact: 'none'
}

export type PayrollTeachingTier = 'standard' | 'after_threshold' | 'after_threshold_evening'

export interface PayrollTeachingSlot {
  key: string
  date: string
  hour: number
  branchId: string
  branchIds?: string[]
  crossBranchWarning?: boolean
  dailyPosition: number
  tier: PayrollTeachingTier
  rate: number
  policyId: string
  policyName: string
  studentCount: number
  sessionIds: string[]
  studentIds?: string[]
}

export interface PayrollTierSummary {
  standardCount: number
  standardAmount: number
  afterThresholdCount: number
  afterThresholdAmount: number
  afterThresholdEveningCount: number
  afterThresholdEveningAmount: number
}

export interface PayrollWorkday {
  date: string
  weekday: number
  status: string
  eligible: boolean
  holidayName: string
  note: string
  revision: number
  teachingSlotCount: number
  source: 'admin_override' | 'teaching_slots' | 'calendar'
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
  crossBranchWarningCount?: number
  teachingDayCount: number
  teachingSlots: PayrollTeachingSlot[]
  tierSummary: PayrollTierSummary
  ratePerSession: number
  baseSalaryAmount: number
  teachingPayAmount: number
  commissionAmount: number
  referralCommission?: {
    rate: number
    contractCount: number
    cashCollectedAmount: number
    cashReversedAmount: number
    netCashAmount: number
    commissionAmount: number
    reversalAmount: number
  }
  bonusAmount: number
  deductionAmount: number
  earningEventApprovedAmount?: number
  earningEventPendingAmount?: number
  earningEventDisputedAmount?: number
  sessionEvidencePendingAmount?: number
  recurringBonusAmount: number
  manualBonusAmount: number
  manualDeductionAmount: number
  payrollAdjustments: Array<Pick<PayrollAdjustment, 'id' | 'type' | 'amount' | 'reason' | 'evidenceReference'>>
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
  workdayDays: PayrollWorkday[]
  attendanceReviewRequired: boolean
  calendarReviewRequired: boolean
  grossAmount: number
  adjustmentAmount: number
  finalAmount: number
  intelligenceSchemaVersion?: number
  incentivePolicyId?: string
  incentivePolicySnapshot?: PayrollIntelligencePolicy | null
  evidenceLedger?: PayrollEvidenceLedgerEntry[]
  evidenceLedgerSummary?: PayrollIntelligenceSnapshot['evidenceLedgerSummary']
  attributionSummary?: PayrollIntelligenceSnapshot['attribution']
  renewSummary?: PayrollIntelligenceSnapshot['renew']
  kpiSummary?: PayrollIntelligenceSnapshot['kpi']
  rankSummary?: PayrollIntelligenceSnapshot['rank']
  incentiveAmount?: number
  incentiveAmountImpact?: 'none'
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

function callable<Input, Output>(name: string, timeoutMs = 45_000) {
  const functions = firebaseScheduleOptimizerFunctions || firebaseFunctions
  if (!functions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return httpsCallable<Input, Output>(functions, `${name}V2`, { timeout: timeoutMs })
}

function violationFromUnknown(value: unknown): PayrollViolation | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const code = typeof raw.code === 'string' ? raw.code : ''
  const title = typeof raw.title === 'string' ? raw.title : ''
  const detail = typeof raw.detail === 'string' ? raw.detail : ''
  if (!code && !title && !detail) return null
  const remediation: PayrollRemediation = ['workdays', 'teaching_history', 'staff_profile', 'policy', 'delete_rebuild', 'retry'].includes(String(raw.remediation))
    ? raw.remediation as PayrollRemediation
    : 'retry'
  return {
    code: code || 'PAYROLL_VALIDATION_FAILED',
    severity: raw.severity === 'warning' ? 'warning' : 'error',
    title: title || 'Dữ liệu kỳ lương chưa hợp lệ',
    detail: detail || title || 'Hãy đối soát dữ liệu trước khi lập kỳ lương.',
    remediation,
    staffId: typeof raw.staffId === 'string' ? raw.staffId : undefined,
    staffName: typeof raw.staffName === 'string' ? raw.staffName : undefined,
    trainerId: typeof raw.trainerId === 'string' ? raw.trainerId : undefined,
    trainerName: typeof raw.trainerName === 'string' ? raw.trainerName : undefined,
    trainerIds: Array.isArray(raw.trainerIds) ? raw.trainerIds.filter((id): id is string => typeof id === 'string') : undefined,
    trainerNames: Array.isArray(raw.trainerNames) ? raw.trainerNames.filter((name): name is string => typeof name === 'string') : undefined,
    studentId: typeof raw.studentId === 'string' ? raw.studentId : undefined,
    studentName: typeof raw.studentName === 'string' ? raw.studentName : undefined,
    studentIds: Array.isArray(raw.studentIds) ? raw.studentIds.filter((id): id is string => typeof id === 'string') : undefined,
    studentNames: Array.isArray(raw.studentNames) ? raw.studentNames.filter((name): name is string => typeof name === 'string') : undefined,
    branchId: typeof raw.branchId === 'string' ? raw.branchId : undefined,
    branchName: typeof raw.branchName === 'string' ? raw.branchName : undefined,
    branchIds: Array.isArray(raw.branchIds) ? raw.branchIds.filter((id): id is string => typeof id === 'string') : undefined,
    branchNames: Array.isArray(raw.branchNames) ? raw.branchNames.filter((name): name is string => typeof name === 'string') : undefined,
    sessionIds: Array.isArray(raw.sessionIds) ? raw.sessionIds.filter((id): id is string => typeof id === 'string') : undefined,
    conflictingSessionIds: Array.isArray(raw.conflictingSessionIds) ? raw.conflictingSessionIds.filter((id): id is string => typeof id === 'string') : undefined,
    date: typeof raw.date === 'string' ? raw.date : undefined,
    hour: Number.isInteger(Number(raw.hour)) ? Number(raw.hour) : undefined,
    hours: Array.isArray(raw.hours) ? raw.hours.map(Number).filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23) : undefined,
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : undefined,
    attendanceEventId: typeof raw.attendanceEventId === 'string' ? raw.attendanceEventId : undefined,
    policyId: typeof raw.policyId === 'string' ? raw.policyId : undefined,
    periodId: typeof raw.periodId === 'string' ? raw.periodId : undefined,
    supportId: typeof raw.supportId === 'string' ? raw.supportId : undefined,
    runStatus: typeof raw.runStatus === 'string' ? raw.runStatus : undefined,
    relatedSessions: Array.isArray(raw.relatedSessions)
      ? raw.relatedSessions.map((item) => {
        if (!item || typeof item !== 'object') return null
        const value = item as Record<string, unknown>
        const sessionId = typeof value.sessionId === 'string' ? value.sessionId : ''
        if (!sessionId) return null
        return {
          sessionId,
          trainerId: typeof value.trainerId === 'string' ? value.trainerId : undefined,
          trainerName: typeof value.trainerName === 'string' ? value.trainerName : undefined,
          branchId: typeof value.branchId === 'string' ? value.branchId : undefined,
          branchName: typeof value.branchName === 'string' ? value.branchName : undefined,
          date: typeof value.date === 'string' ? value.date : undefined,
          hour: value.hour === null ? null : Number.isInteger(Number(value.hour)) ? Number(value.hour) : undefined,
        }
      }).filter((item): item is NonNullable<typeof item> => Boolean(item))
      : undefined,
  }
}

export function parsePayrollFailure(cause: unknown): PayrollFailure {
  const raw = cause && typeof cause === 'object' ? cause as Record<string, unknown> : {}
  const message = cause instanceof Error ? cause.message : typeof raw.message === 'string' ? raw.message : ''
  const code = typeof raw.code === 'string' ? raw.code.replace(/^functions\//i, '').toLowerCase() : ''
  const directDetails = raw.details && typeof raw.details === 'object' ? raw.details as Record<string, unknown> : {}
  const customData = raw.customData && typeof raw.customData === 'object' ? raw.customData as Record<string, unknown> : {}
  const customDetails = customData.details && typeof customData.details === 'object' ? customData.details as Record<string, unknown> : {}
  const details = Object.keys(directDetails).length ? directDetails : customDetails
  const violations = Array.isArray(details.violations)
    ? details.violations.map(violationFromUnknown).filter((item): item is PayrollViolation => Boolean(item))
    : []
  return { message, code, violations }
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
    policyApplicationMode: raw.policyApplicationMode === 'staff_profile' || raw.policyApplicationMode === 'trainer_assignment' || raw.policyApplicationMode === 'effective_date'
      ? raw.policyApplicationMode
      : 'single',
    status: status(raw.status),
    requiresRebuild: raw.requiresRebuild === true,
    sourceDataStale: raw.sourceDataStale === true,
    storedTeachingSlotCount: Math.max(0, Math.trunc(amount(raw.storedTeachingSlotCount))),
    attendanceCount: teachingSlotCount,
    teachingSlotCount,
    crossBranchWarningCount: Math.max(0, Math.trunc(amount(raw.crossBranchWarningCount))),
    attendanceEventCount: Math.max(0, Math.trunc(amount(raw.attendanceEventCount ?? raw.attendanceCount))),
    trainerCount: Math.max(0, Math.trunc(amount(raw.trainerCount))),
    staffCount: Math.max(0, Math.trunc(amount(raw.staffCount ?? raw.trainerCount))),
    workdayStaffCount: Math.max(0, Math.trunc(amount(raw.workdayStaffCount))),
    attendanceReviewRequiredCount: Math.max(0, Math.trunc(amount(raw.attendanceReviewRequiredCount))),
    calendarReviewRequiredCount: Math.max(0, Math.trunc(amount(raw.calendarReviewRequiredCount))),
    teachingEvidenceReviewRequiredCount: Math.max(0, Math.trunc(amount(raw.teachingEvidenceReviewRequiredCount))),
    teachingEvidenceReviewRequiredSessionIds: Array.isArray(raw.teachingEvidenceReviewRequiredSessionIds)
      ? raw.teachingEvidenceReviewRequiredSessionIds.filter((value): value is string => typeof value === 'string').slice(0, 500)
      : [],
    validationViolationCount: Math.max(0, Math.trunc(amount(raw.validationViolationCount))),
    validationViolations: Array.isArray(raw.validationViolations)
      ? raw.validationViolations.map(violationFromUnknown).filter((item): item is PayrollViolation => Boolean(item)).slice(0, 100)
      : [],
    attendanceReviewRequired: raw.attendanceReviewRequired === true,
    baseSalaryAmount: amount(raw.baseSalaryAmount),
    teachingPayAmount: amount(raw.teachingPayAmount ?? raw.grossAmount),
    commissionAmount: amount(raw.commissionAmount),
    bonusAmount: amount(raw.bonusAmount),
    deductionAmount: amount(raw.deductionAmount),
    earningEventApprovedAmount: amount(raw.earningEventApprovedAmount),
    earningEventPendingAmount: amount(raw.earningEventPendingAmount),
    earningEventDisputedAmount: amount(raw.earningEventDisputedAmount),
    sessionEvidencePendingAmount: amount(raw.sessionEvidencePendingAmount),
    targetStatus: ['approved', 'provisional', 'not_required'].includes(String(raw.targetStatus)) ? raw.targetStatus as PayrollRunSummary['targetStatus'] : '',
    targetSource: ['current_period', 'manager_input', 'previous_period', 'policy_default'].includes(String(raw.targetSource)) ? raw.targetSource as PayrollRunSummary['targetSource'] : '',
    targetSourcePeriodId: typeof raw.targetSourcePeriodId === 'string' ? raw.targetSourcePeriodId : '',
    grossAmount: amount(raw.grossAmount),
    adjustmentAmount: amount(raw.adjustmentAmount),
    finalAmount: amount(raw.finalAmount || raw.grossAmount),
    intelligenceSchemaVersion: amount(raw.intelligenceSchemaVersion),
    intelligencePolicyId: typeof raw.intelligencePolicyId === 'string' ? raw.intelligencePolicyId : '',
    intelligenceSummary: raw.intelligenceSummary && typeof raw.intelligenceSummary === 'object' ? {
      enabled: (raw.intelligenceSummary as Record<string, unknown>).enabled === true,
      policyId: typeof (raw.intelligenceSummary as Record<string, unknown>).policyId === 'string' ? String((raw.intelligenceSummary as Record<string, unknown>).policyId) : '',
      policyVersion: amount((raw.intelligenceSummary as Record<string, unknown>).policyVersion),
      policyName: typeof (raw.intelligenceSummary as Record<string, unknown>).policyName === 'string' ? String((raw.intelligenceSummary as Record<string, unknown>).policyName) : '',
      staffCount: amount((raw.intelligenceSummary as Record<string, unknown>).staffCount), evidenceCount: amount((raw.intelligenceSummary as Record<string, unknown>).evidenceCount), reviewCount: amount((raw.intelligenceSummary as Record<string, unknown>).reviewCount), renewalWonCount: amount((raw.intelligenceSummary as Record<string, unknown>).renewalWonCount), attributedRevenue: amount((raw.intelligenceSummary as Record<string, unknown>).attributedRevenue), rankCounts: ((raw.intelligenceSummary as Record<string, unknown>).rankCounts && typeof (raw.intelligenceSummary as Record<string, unknown>).rankCounts === 'object' ? (raw.intelligenceSummary as Record<string, unknown>).rankCounts : {}) as Record<string, number>, amountImpact: 'none', sourceTruncated: (raw.intelligenceSummary as Record<string, unknown>).sourceTruncated === true,
    } : undefined,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
  }
}

function normaliseIntelligencePolicy(value: unknown): PayrollIntelligencePolicy | null {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const metrics = raw.metrics && typeof raw.metrics === 'object' ? Object.fromEntries(Object.entries(raw.metrics as Record<string, unknown>).flatMap(([key, value]) => {
    const item = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    return [[key, {
        id: typeof item.id === 'string' ? item.id : key,
        label: typeof item.label === 'string' ? item.label : key,
        source: typeof item.source === 'string' ? item.source : '',
        enabled: item.enabled === true,
        weight: amount(item.weight),
        target: amount(item.target),
        direction: item.direction === 'lower_is_better' ? 'lower_is_better' as const : 'higher_is_better' as const,
        cap: amount(item.cap) || 100,
      }]]
  })) : {}
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    name: typeof raw.name === 'string' ? raw.name : 'Phân tích hiệu suất Aura',
    version: amount(raw.version) || 1,
    effectiveFrom: typeof raw.effectiveFrom === 'string' ? raw.effectiveFrom : '',
    status: raw.status === 'inactive' ? 'inactive' : 'active',
    enabled: raw.enabled !== false,
    metrics,
    attributionRules: Array.isArray(raw.attributionRules) ? raw.attributionRules.flatMap((value) => {
      const item = value && typeof value === 'object' ? value as Record<string, unknown> : {}
      const sourceType = typeof item.sourceType === 'string' ? item.sourceType : ''
      const priority = Array.isArray(item.priority) ? item.priority.filter((entry): entry is string => typeof entry === 'string') : []
      return sourceType && priority.length ? [{ sourceType, priority, splitMode: item.splitMode === 'equal' ? 'equal' as const : 'single' as const }] : []
    }) : [],
    rankBands: Array.isArray(raw.rankBands) ? raw.rankBands.flatMap((value) => {
      const item = value && typeof value === 'object' ? value as Record<string, unknown> : {}
      const label = typeof item.label === 'string' ? item.label : ''
      return label ? [{ code: typeof item.code === 'string' ? item.code : label, label, minScore: amount(item.minScore), maxScore: amount(item.maxScore) || 100 }] : []
    }) : [],
    renew: raw.renew && typeof raw.renew === 'object' ? {
      wonStages: Array.isArray((raw.renew as Record<string, unknown>).wonStages) ? ((raw.renew as Record<string, unknown>).wonStages as unknown[]).filter((value): value is string => typeof value === 'string') : ['won'],
      creditAssisted: (raw.renew as Record<string, unknown>).creditAssisted === true,
    } : { wonStages: ['won'], creditAssisted: false },
    amountImpact: 'none',
  }
}

function normaliseIntelligence(value: unknown): PayrollIntelligenceSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const summary = raw.evidenceLedgerSummary && typeof raw.evidenceLedgerSummary === 'object' ? raw.evidenceLedgerSummary as Record<string, unknown> : {}
  const attribution = raw.attributionSummary && typeof raw.attributionSummary === 'object' ? raw.attributionSummary as Record<string, unknown> : {}
  const renew = raw.renewSummary && typeof raw.renewSummary === 'object' ? raw.renewSummary as Record<string, unknown> : {}
  const kpi = raw.kpiSummary && typeof raw.kpiSummary === 'object' ? raw.kpiSummary as Record<string, unknown> : {}
  const rank = raw.rankSummary && typeof raw.rankSummary === 'object' ? raw.rankSummary as Record<string, unknown> : {}
  const ledger = Array.isArray(raw.evidenceLedger) ? raw.evidenceLedger.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const item = value as Record<string, unknown>
    const id = typeof item.id === 'string' ? item.id : ''
    return id ? [{ id, sourceType: typeof item.sourceType === 'string' ? item.sourceType : '', sourceId: typeof item.sourceId === 'string' ? item.sourceId : '', date: typeof item.date === 'string' ? item.date : '', staffId: typeof item.staffId === 'string' ? item.staffId : '', role: typeof item.role === 'string' ? item.role : '', quantity: amount(item.quantity), value: amount(item.value), status: item.status === 'review' ? 'review' as const : 'verified' as const, attributionConflict: item.attributionConflict === true, reason: typeof item.reason === 'string' ? item.reason : '' }] : []
  }) : []
  const metricRows = Array.isArray(kpi.metrics) ? kpi.metrics.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const item = value as Record<string, unknown>
    const id = typeof item.id === 'string' ? item.id : ''
    return id ? [{ id, label: typeof item.label === 'string' ? item.label : id, source: typeof item.source === 'string' ? item.source : '', target: amount(item.target), actual: amount(item.actual), weight: amount(item.weight), score: amount(item.score), weightedScore: amount(item.weightedScore) }] : []
  }) : []
  return {
    schemaVersion: Math.max(1, Math.trunc(amount(raw.schemaVersion) || 1)), enabled: raw.enabled === true, policyId: typeof raw.policyId === 'string' ? raw.policyId : '', policyVersion: amount(raw.policyVersion), policyName: typeof raw.policyName === 'string' ? raw.policyName : '', policySnapshot: normaliseIntelligencePolicy(raw.policySnapshot), evidenceLedger: ledger,
    evidenceLedgerSummary: { count: amount(summary.count), reviewCount: amount(summary.reviewCount), truncated: summary.truncated === true, bySource: (summary.bySource && typeof summary.bySource === 'object' ? summary.bySource : {}) as Record<string, number>, byRole: (summary.byRole && typeof summary.byRole === 'object' ? summary.byRole : {}) as Record<string, number> },
    attribution: { conflictCount: amount(attribution.conflictCount), sourceCount: amount(attribution.sourceCount), attributedRevenue: amount(attribution.attributedRevenue), attributedCommission: amount(attribution.attributedCommission), bySource: (attribution.bySource && typeof attribution.bySource === 'object' ? attribution.bySource : {}) as Record<string, number>, byRole: (attribution.byRole && typeof attribution.byRole === 'object' ? attribution.byRole : {}) as Record<string, number> },
    renew: { wonCount: amount(renew.wonCount), assistedCount: amount(renew.assistedCount), attributedRevenue: amount(renew.attributedRevenue), reviewCount: amount(renew.reviewCount) },
    kpi: { enabled: kpi.enabled === true, score: kpi.score === null || kpi.score === undefined ? null : amount(kpi.score), weightTotal: amount(kpi.weightTotal), metrics: metricRows },
    rank: { code: typeof rank.code === 'string' ? rank.code : 'unconfigured', label: typeof rank.label === 'string' ? rank.label : 'Chưa xếp hạng', score: rank.score === null || rank.score === undefined ? null : amount(rank.score), configured: rank.configured === true }, amountImpact: 'none',
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
    const intelligence = normaliseIntelligence(raw)
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
        branchIds: Array.isArray(slot.branchIds) ? slot.branchIds.filter((id): id is string => typeof id === 'string') : undefined,
        crossBranchWarning: slot.crossBranchWarning === true,
        dailyPosition: Math.max(1, Math.trunc(amount(slot.dailyPosition)) || 1),
        tier,
        rate: amount(slot.rate),
        policyId: typeof slot.policyId === 'string' ? slot.policyId : '',
        policyName: typeof slot.policyName === 'string' ? slot.policyName : '',
        studentCount: Math.max(1, Math.trunc(amount(slot.studentCount)) || 1),
        sessionIds: Array.isArray(slot.sessionIds) ? slot.sessionIds.filter((id): id is string => typeof id === 'string') : [],
        studentIds: Array.isArray(slot.studentIds) ? slot.studentIds.filter((id): id is string => typeof id === 'string') : undefined,
      }]
    }) : []
    const tier = raw.tierSummary && typeof raw.tierSummary === 'object' ? raw.tierSummary as Record<string, unknown> : {}
    const rawWorkdaySummary = raw.workdaySummary && typeof raw.workdaySummary === 'object' ? raw.workdaySummary as Record<string, unknown> : {}
    const workdayDays: PayrollWorkday[] = Array.isArray(raw.workdayDays) ? raw.workdayDays.flatMap((dayValue) => {
      if (!dayValue || typeof dayValue !== 'object') return []
      const day = dayValue as Record<string, unknown>
      const date = typeof day.date === 'string' ? day.date : ''
      if (!date) return []
      return [{
        date,
        weekday: Math.max(0, Math.min(6, Math.trunc(amount(day.weekday)))),
        status: typeof day.status === 'string' ? day.status : 'pending',
        eligible: day.eligible === true,
        holidayName: typeof day.holidayName === 'string' ? day.holidayName : '',
        note: typeof day.note === 'string' ? day.note : '',
        revision: Math.max(0, Math.trunc(amount(day.revision))),
        teachingSlotCount: Math.max(0, Math.trunc(amount(day.teachingSlotCount))),
        source: day.source === 'admin_override' || day.source === 'teaching_slots' ? day.source : 'calendar',
      }]
    }) : []
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
      crossBranchWarningCount: Math.max(0, Math.trunc(amount(raw.crossBranchWarningCount))),
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
      referralCommission: raw.referralCommission && typeof raw.referralCommission === 'object' ? {
        rate: amount((raw.referralCommission as Record<string, unknown>).rate),
        contractCount: Math.max(0, Math.trunc(amount((raw.referralCommission as Record<string, unknown>).contractCount))),
        cashCollectedAmount: amount((raw.referralCommission as Record<string, unknown>).cashCollectedAmount),
        cashReversedAmount: amount((raw.referralCommission as Record<string, unknown>).cashReversedAmount),
        netCashAmount: amount((raw.referralCommission as Record<string, unknown>).netCashAmount),
        commissionAmount: amount((raw.referralCommission as Record<string, unknown>).commissionAmount),
        reversalAmount: amount((raw.referralCommission as Record<string, unknown>).reversalAmount),
      } : undefined,
      bonusAmount: amount(raw.bonusAmount),
      deductionAmount: amount(raw.deductionAmount),
      earningEventApprovedAmount: amount(raw.earningEventApprovedAmount),
      earningEventPendingAmount: amount(raw.earningEventPendingAmount),
      earningEventDisputedAmount: amount(raw.earningEventDisputedAmount),
      sessionEvidencePendingAmount: amount(raw.sessionEvidencePendingAmount),
      recurringBonusAmount: amount(raw.recurringBonusAmount ?? raw.bonusAmount),
      manualBonusAmount: amount(raw.manualBonusAmount),
      manualDeductionAmount: amount(raw.manualDeductionAmount),
      payrollAdjustments: Array.isArray(raw.payrollAdjustments) ? raw.payrollAdjustments.flatMap((adjustmentValue) => {
        if (!adjustmentValue || typeof adjustmentValue !== 'object') return []
        const adjustment = adjustmentValue as Record<string, unknown>
        const id = typeof adjustment.id === 'string' ? adjustment.id : ''
        if (!id) return []
        return [{
          id,
          type: adjustment.type === 'deduction' ? 'deduction' as const : 'bonus' as const,
          amount: amount(adjustment.amount),
          reason: typeof adjustment.reason === 'string' ? adjustment.reason : '',
          evidenceReference: typeof adjustment.evidenceReference === 'string' ? adjustment.evidenceReference : '',
        }]
      }) : [],
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
      workdayDays,
      attendanceReviewRequired: raw.attendanceReviewRequired === true,
      calendarReviewRequired: raw.calendarReviewRequired === true,
      grossAmount: amount(raw.grossAmount),
      adjustmentAmount: amount(raw.adjustmentAmount),
      finalAmount: amount(raw.finalAmount || raw.grossAmount),
      intelligenceSchemaVersion: amount(raw.intelligenceSchemaVersion),
      incentivePolicyId: typeof raw.incentivePolicyId === 'string' ? raw.incentivePolicyId : '',
      incentivePolicySnapshot: intelligence?.policySnapshot || null,
      evidenceLedger: intelligence?.evidenceLedger || [],
      evidenceLedgerSummary: intelligence?.evidenceLedgerSummary,
      attributionSummary: intelligence?.attribution,
      renewSummary: intelligence?.renew,
      kpiSummary: intelligence?.kpi,
      rankSummary: intelligence?.rank,
      incentiveAmount: amount(raw.incentiveAmount),
      incentiveAmountImpact: 'none',
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
    const rankRates = raw.rankRateCards && typeof raw.rankRateCards === 'object' ? raw.rankRateCards as Record<string, unknown> : {}
    const tierPercents = raw.rateTierPercents && typeof raw.rateTierPercents === 'object' ? raw.rateTierPercents as Record<string, unknown> : {}
    const capabilities = raw.capabilities && typeof raw.capabilities === 'object' ? raw.capabilities as Record<string, unknown> : {}
    const renew = raw.renewEligibility && typeof raw.renewEligibility === 'object' ? raw.renewEligibility as Record<string, unknown> : {}
    const evidence = raw.sessionEvidence && typeof raw.sessionEvidence === 'object' ? raw.sessionEvidence as Record<string, unknown> : {}
    const dispute = raw.dispute && typeof raw.dispute === 'object' ? raw.dispute as Record<string, unknown> : {}
    return [{
      id,
      name: typeof raw.name === 'string' ? raw.name : 'Chính sách lương PT',
      audience: raw.audience === 'collaborator' || raw.audience === 'all' ? raw.audience : 'employee',
      eligibleProfiles: Array.isArray(raw.eligibleProfiles)
        ? raw.eligibleProfiles.filter((profile): profile is PayrollProfile => typeof profile === 'string' && ['probation', 'official', 'senior', 'part_time', 'collaborator'].includes(profile))
        : raw.audience === 'collaborator' ? ['collaborator'] : raw.audience === 'all' ? ['probation', 'official', 'senior', 'part_time', 'collaborator'] : ['probation', 'official', 'senior', 'part_time'],
      version: amount(raw.version) || 1,
      effectiveFrom: typeof raw.effectiveFrom === 'string' ? raw.effectiveFrom : '',
      teachingRateMode: raw.teachingRateMode === 'percent_of_rank_rate' ? 'percent_of_rank_rate' : 'absolute',
      defaultRankCode: ['p0', 'p1', 'p2', 'p3', 'p4'].includes(String(raw.defaultRankCode)) ? raw.defaultRankCode as PayrollRankCode : 'p0',
      rankRateCards: Object.fromEntries((['p0', 'p1', 'p2', 'p3', 'p4'] as PayrollRankCode[]).map((code) => [code, amount(rankRates[code] ?? raw.ratePerSession)])) as Record<PayrollRankCode, number>,
      rateTierPercents: {
        standard: amount(tierPercents.standard) || 100,
        afterThreshold: amount(tierPercents.afterThreshold) || 100,
        evening: amount(tierPercents.evening) || 100,
        afterThresholdEvening: amount(tierPercents.afterThresholdEvening) || 100,
      },
      eveningRequiresOvertime: true,
      ratePerSession: amount(raw.ratePerSession),
      dailySessionThreshold: Math.max(1, Math.trunc(amount(raw.dailySessionThreshold)) || 8),
      rateAfterDailyThreshold: amount(raw.rateAfterDailyThreshold ?? raw.ratePerSession),
      eveningStartHour: Math.max(0, Math.min(23, Math.trunc(amount(raw.eveningStartHour ?? 20)))),
      rateAfterDailyThresholdEvening: amount(raw.rateAfterDailyThresholdEvening ?? raw.rateAfterDailyThreshold ?? raw.ratePerSession),
      capabilities: {
        baseSalaryEnabled: capabilities.baseSalaryEnabled !== false,
        teachingCommissionEnabled: capabilities.teachingCommissionEnabled !== false,
        kpiBonusEnabled: capabilities.kpiBonusEnabled !== false,
        renewCommissionEnabled: capabilities.renewCommissionEnabled !== false,
        selfGeneratedCommissionEnabled: capabilities.selfGeneratedCommissionEnabled !== false,
        additionalBonusEnabled: capabilities.additionalBonusEnabled !== false,
      },
      renewEligibility: {
        maxDaysRemaining: Math.max(0, Math.trunc(amount(renew.maxDaysRemaining)) || 30),
        maxSessionsRemaining: Math.max(0, Math.trunc(amount(renew.maxSessionsRemaining)) || 6),
        minConsumedPercent: amount(renew.minConsumedPercent) || 70,
        requireMostlyUsedProgram: renew.requireMostlyUsedProgram !== false,
      },
      sessionEvidence: {
        enabled: evidence.enabled === true,
        noteSlaHours: Math.max(1, Math.trunc(amount(evidence.noteSlaHours)) || 12),
        requiredFields: Array.isArray(evidence.requiredFields) ? evidence.requiredFields.filter((field): field is string => typeof field === 'string') : [],
        allowManagerOverride: evidence.allowManagerOverride !== false,
      },
      dispute: {
        resolutionSlaHours: Math.max(1, Math.trunc(amount(dispute.resolutionSlaHours)) || 72),
        allowPartialPayment: dispute.allowPartialPayment !== false,
      },
      status: raw.status === 'inactive' ? 'inactive' : 'active',
      usageCount: Math.max(0, Math.trunc(amount(raw.usageCount))),
      canDelete: raw.canDelete === true,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    } satisfies PayrollPolicy]
  }) : []
}

export async function listPayrollIntelligencePolicies(): Promise<PayrollIntelligencePolicy[]> {
  const result = await callable<Record<string, never>, { policies?: unknown[] }>('listPayrollIntelligencePolicies')({})
  return Array.isArray(result.data.policies) ? result.data.policies.flatMap((value) => {
    const policy = normaliseIntelligencePolicy(value)
    return policy?.id ? [policy] : []
  }) : []
}

export async function savePayrollIntelligencePolicy(input: {
  name: string
  effectiveFrom: string
  enabled: boolean
  metrics: Record<string, Partial<PayrollIntelligenceMetric> & { source: string }>
  attributionRules: Array<{ sourceType: string; priority: string[]; splitMode?: 'single' | 'equal' }>
  rankBands: Array<{ code?: string; label: string; minScore: number; maxScore: number }>
  renew: { wonStages: string[]; creditAssisted: boolean }
}) {
  const result = await callable<typeof input, { policyId: string; unchanged: boolean }>('savePayrollIntelligencePolicy')(input)
  return result.data
}

export async function managePayrollIntelligencePolicy(policyId: string, action: 'hide' | 'restore' | 'delete') {
  const result = await callable<{ policyId: string; action: typeof action }, { policyId: string; action: string; unchanged: boolean }>('managePayrollIntelligencePolicy')({ policyId, action })
  return result.data
}

export async function reviewPayrollSessionEvidence(sessionId: string, decision: 'approved' | 'rejected' | 'reset', reason = '') {
  const input = { sessionId, decision, reason }
  const result = await callable<typeof input, { sessionId: string; decision: string; unchanged: boolean }>('reviewPayrollSessionEvidence')(input)
  return result.data
}

export async function listPayrollEarningEvents(periodId: string, staffId?: string): Promise<{ events: PayrollEarningEvent[]; summary: { approvedAmount: number; pendingAmount: number; disputedAmount: number; rejectedAmount: number; payableAmount: number } }> {
  const result = await callable<{ periodId: string; staffId?: string }, { events?: unknown[]; summary?: Record<string, unknown> }>('listPayrollEarningEvents')({ periodId, staffId })
  const events = Array.isArray(result.data.events) ? result.data.events.flatMap((value) => {
    const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    const id = typeof raw.id === 'string' ? raw.id : ''
    if (!id) return []
    return [{
      id,
      periodId: typeof raw.periodId === 'string' ? raw.periodId : periodId,
      staffId: typeof raw.staffId === 'string' ? raw.staffId : '',
      type: String(raw.type || 'other') as PayrollEarningEvent['type'],
      sourceType: typeof raw.sourceType === 'string' ? raw.sourceType : '',
      sourceId: typeof raw.sourceId === 'string' ? raw.sourceId : '',
      grossAmount: amount(raw.grossAmount), signedAmount: amount(raw.signedAmount),
      evidenceReference: typeof raw.evidenceReference === 'string' ? raw.evidenceReference : '',
      description: typeof raw.description === 'string' ? raw.description : '',
      status: String(raw.status || 'pending_review') as PayrollEarningStatus,
      reviewReason: typeof raw.reviewReason === 'string' ? raw.reviewReason : '',
      originalRate: amount(raw.originalRate), attributionPercent: amount(raw.attributionPercent) || 100, commissionBaseAmount: amount(raw.commissionBaseAmount),
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '', reviewedAt: typeof raw.reviewedAt === 'string' ? raw.reviewedAt : '', deadline: typeof raw.deadline === 'string' ? raw.deadline : '',
    }]
  }) : []
  const summary = result.data.summary || {}
  return { events, summary: { approvedAmount: amount(summary.approvedAmount), pendingAmount: amount(summary.pendingAmount), disputedAmount: amount(summary.disputedAmount), rejectedAmount: amount(summary.rejectedAmount), payableAmount: amount(summary.payableAmount) } }
}

export async function savePayrollEarningEvent(input: { periodId: string; staffId: string; type: PayrollEarningEvent['type']; grossAmount: number; sourceType: string; sourceId: string; evidenceReference: string; description: string; deadlineHours?: number; originalRate?: number; attributionPercent?: number; commissionBaseAmount?: number }) {
  const result = await callable<typeof input, { eventId: string; unchanged: boolean; status: PayrollEarningStatus }>('savePayrollEarningEvent')(input)
  return result.data
}

export async function reviewPayrollEarningEvent(eventId: string, decision: 'approved' | 'disputed' | 'rejected' | 'pending_review', reason: string) {
  const result = await callable<{ eventId: string; decision: typeof decision; reason: string }, { eventId: string; status: PayrollEarningStatus; unchanged: boolean }>('reviewPayrollEarningEvent')({ eventId, decision, reason })
  return result.data
}

export async function approveRenewAttribution(input: { caseId: string; reason: string; splits: Array<{ staffId: string; role: string; percent: number }> }) {
  const result = await callable<typeof input, { caseId: string; splits: typeof input.splits }>('approveRenewAttribution')(input)
  return result.data
}

export async function getPayrollTarget(periodId: string): Promise<PayrollTarget> {
  const result = await callable<{ periodId: string }, { target?: unknown }>('getPayrollTarget')({ periodId })
  const raw = result.data.target && typeof result.data.target === 'object' ? result.data.target as Record<string, unknown> : {}
  const metricTargets = raw.metricTargets && typeof raw.metricTargets === 'object'
    ? Object.fromEntries(Object.entries(raw.metricTargets as Record<string, unknown>).flatMap(([key, value]) => {
      const target = amount(value)
      return target > 0 ? [[key, target] as const] : []
    }))
    : {}
  return {
    periodId: typeof raw.periodId === 'string' ? raw.periodId : periodId,
    status: raw.status === 'approved' ? 'approved' : 'provisional',
    source: ['current_period', 'manager_input', 'previous_period', 'policy_default'].includes(String(raw.source)) ? raw.source as PayrollTarget['source'] : 'policy_default',
    sourcePeriodId: typeof raw.sourcePeriodId === 'string' ? raw.sourcePeriodId : '',
    metricTargets,
    reason: typeof raw.reason === 'string' ? raw.reason : '',
    approvedBy: typeof raw.approvedBy === 'string' ? raw.approvedBy : '',
    approvedAt: typeof raw.approvedAt === 'string' ? raw.approvedAt : '',
  }
}

export async function savePayrollTarget(input: { periodId: string; metricTargets: Record<string, number>; reason: string }) {
  const result = await callable<typeof input, { periodId: string; status: 'provisional'; revision: number }>('savePayrollTarget')(input)
  return result.data
}

export async function approvePayrollTarget(periodId: string, reason: string) {
  const result = await callable<{ periodId: string; reason: string }, { periodId: string; status: 'approved' }>('approvePayrollTarget')({ periodId, reason })
  return result.data
}

export async function savePayrollPolicy(input: {
  name: string
  audience: 'employee' | 'collaborator' | 'all'
  eligibleProfiles: PayrollProfile[]
  effectiveFrom: string
  teachingRateMode: PayrollTeachingRateMode
  defaultRankCode: PayrollRankCode
  rankRateCards: Record<PayrollRankCode, number>
  rateTierPercents: PayrollPolicy['rateTierPercents']
  ratePerSession: number
  dailySessionThreshold: number
  rateAfterDailyThreshold: number
  eveningStartHour: number
  rateAfterDailyThresholdEvening: number
  capabilities: PayrollPolicy['capabilities']
  renewEligibility: PayrollPolicy['renewEligibility']
  sessionEvidence: PayrollPolicy['sessionEvidence']
  dispute: PayrollPolicy['dispute']
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
  const result = await callable<CreatePayrollRunInput, { runId: string; unchanged: boolean; status: PayrollRunStatus }>('createPayrollRun', 300_000)(input)
  return result.data
}

export async function listPayrollAdjustments(periodId: string): Promise<PayrollAdjustment[]> {
  const result = await callable<{ periodId: string }, { adjustments?: unknown[] }>('listPayrollAdjustments')({ periodId })
  return Array.isArray(result.data.adjustments) ? result.data.adjustments.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const raw = value as Record<string, unknown>
    const id = typeof raw.id === 'string' ? raw.id : ''
    const staffId = typeof raw.staffId === 'string' ? raw.staffId : ''
    if (!id || !staffId) return []
    const snapshot = raw.staffSnapshot && typeof raw.staffSnapshot === 'object' ? raw.staffSnapshot as Record<string, unknown> : {}
    return [{
      id,
      periodId: typeof raw.periodId === 'string' ? raw.periodId : periodId,
      staffId,
      staffSnapshot: {
        name: typeof snapshot.name === 'string' ? snapshot.name : undefined,
        employeeCode: typeof snapshot.employeeCode === 'string' ? snapshot.employeeCode : undefined,
        branchId: typeof snapshot.branchId === 'string' ? snapshot.branchId : undefined,
      },
      type: raw.type === 'deduction' ? 'deduction' as const : 'bonus' as const,
      amount: amount(raw.amount),
      reason: typeof raw.reason === 'string' ? raw.reason : '',
      evidenceReference: typeof raw.evidenceReference === 'string' ? raw.evidenceReference : '',
      status: raw.status === 'voided' ? 'voided' as const : 'active' as const,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
      voidedAt: typeof raw.voidedAt === 'string' ? raw.voidedAt : '',
    } satisfies PayrollAdjustment]
  }) : []
}

export async function savePayrollAdjustment(input: {
  periodId: string
  staffId: string
  type: 'bonus' | 'deduction'
  amount: number
  reason: string
  evidenceReference?: string
  requestId?: string
}) {
  const requestId = input.requestId || (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replaceAll('-', '_')
    : `payroll_${Date.now()}_${Math.random().toString(36).slice(2)}`)
  const result = await callable<typeof input & { requestId: string }, { adjustmentId: string; unchanged: boolean }>('savePayrollAdjustment')({ ...input, requestId })
  return result.data
}

export async function voidPayrollAdjustment(adjustmentId: string) {
  const result = await callable<{ adjustmentId: string }, { adjustmentId: string; unchanged: boolean }>('voidPayrollAdjustment')({ adjustmentId })
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
