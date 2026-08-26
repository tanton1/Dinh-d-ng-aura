import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebase'
import { reportClientIssue } from './clientTelemetryService'

export type StaffAttendanceStatus =
  | 'present'
  | 'remote'
  | 'business_trip'
  | 'training'
  | 'paid_leave'
  | 'unpaid_leave'
  | 'unexcused_absence'
  | 'sick_leave'
  | 'maternity_leave'
  | 'pending'

export type WorkdayDisplayStatus = StaffAttendanceStatus
  | 'auto_present_teaching'
  | 'weekly_rest'
  | 'paid_holiday'
  | 'outside_employment'
  | 'upcoming'

export interface WorkCalendarHoliday {
  date: string
  name: string
  paid: boolean
}

export interface WorkCalendar {
  periodId: string
  branchId: string
  weeklyRestDays: number[]
  holidays: WorkCalendarHoliday[]
  status: 'approved' | 'provisional'
  revision: number
  source: 'branch_calendar' | 'global_calendar' | 'default_sunday_calendar'
  approved: boolean
}

export interface StaffWorkday {
  date: string
  weekday: number
  status: WorkdayDisplayStatus
  eligible: boolean
  holidayName: string
  note: string
  revision: number
  teachingSlotCount: number
  source: 'admin_override' | 'teaching_slots' | 'calendar'
}

export interface StaffWorkdaySummary {
  standardWorkdays: number
  eligibleWorkdays: number
  paidDays: number
  unpaidDays: number
  pendingDays: number
  benefitReviewDays: number
  estimatedPaidDays: number
  dailyRate: number
  baseSalary: number
  baseSalaryEarned: number
  fixedBonus: number
  employmentType: 'full_time' | 'part_time' | 'collaborator'
  employmentLevel: 'probation' | 'official' | 'senior'
  workdayEnabled: boolean
  autoPaidDays: number
  autoFullDayTeachingSlotThreshold: number
  calendarReviewRequired: boolean
  attendanceReviewRequired: boolean
  reviewRequired: boolean
  employment: { start: string; end: string }
  days: StaffWorkday[]
}

export interface StaffPayrollAmounts {
  baseSalaryAmount: number
  teachingPayAmount: number
  commissionAmount: number
  bonusAmount: number
  adjustmentAmount: number
  deductionAmount: number
  grossAmount: number
  finalAmount: number
}

export interface StaffPayrollIdentity {
  name: string
  employeeCode: string
  branchId: string
  photoURL: string
  employmentType: 'full_time' | 'part_time' | 'collaborator'
  employmentLevel: 'probation' | 'official' | 'senior'
  payrollPolicyId: string
}

export interface StaffTeachingSlot {
  key: string
  date: string
  hour: number
  branchId: string
  dailyPosition: number
  tier: 'standard' | 'after_threshold' | 'after_threshold_evening'
  rate: number
  policyId: string
  policyName: string
  studentCount: number
  sessionIds: string[]
}

export interface MyStaffPayroll {
  staffId: string
  periodId: string
  identity: StaffPayrollIdentity
  calendar: WorkCalendar
  workdays: StaffWorkdaySummary
  amounts: StaffPayrollAmounts
  teachingSlots: StaffTeachingSlot[]
  teachingEvidence?: { slotCount: number; truncated: boolean; source: string }
  referralCommission: {
    rate: number
    contractCount: number
    cashCollectedAmount: number
    cashReversedAmount: number
    netCashAmount: number
    commissionAmount: number
    reversalAmount: number
    evidence: Array<{ ledgerEntryId: string; contractId: string; cashImpact: number; rate: number; commissionImpact: number }>
    unresolvedEntryCount: number
    ambiguousCodeEntryCount: number
    invalidRateEntryCount: number
  }
  compensationPolicy: {
    id: string
    name: string
    eligibleProfiles: string[]
    payrollProfile: 'probation' | 'official' | 'senior' | 'part_time' | 'collaborator'
    assigned: boolean
    estimated: boolean
  }
  run: {
    exists: boolean
    status: 'estimating' | 'draft' | 'reviewed' | 'locked' | 'paid'
    official: boolean
    updatedAt: string
    paidAt: string
  }
  generatedAt: string
}

export interface StaffAttendanceRow {
  staffId: string
  name: string
  branchId: string
  employmentType: 'full_time' | 'part_time' | 'collaborator'
  baseSalary: number
  standardWorkdays: number
  eligibleWorkdays: number
  paidDays: number
  autoPaidDays: number
  teachingSlotCount: number
  estimatedPaidDays: number
  unpaidDays: number
  pendingDays: number
  baseSalaryEarned: number
  teachingPayAmount: number
  commissionAmount: number
  bonusAmount: number
  deductionAmount: number
  grossAmount: number
  finalAmount: number
  policyName: string
  policyConfigured: boolean
  referralCommissionRate: number
  referralContractCount: number
  referralCashCollectedAmount: number
  referralCashReversedAmount: number
  referralNetCashAmount: number
  referralCommissionReversalAmount: number
  reviewRequired: boolean
  calendarApproved: boolean
}

export interface StaffPayrollLiveSummary {
  activeStaffCount: number
  teachingSlotCount: number
  baseSalaryAmount: number
  teachingPayAmount: number
  commissionAmount: number
  bonusAmount: number
  deductionAmount: number
  estimatedTotal: number
  reviewRequiredCount: number
  unconfiguredPolicyCount: number
}

type UnknownRecord = Record<string, unknown>

function callable<Input, Output>(name: string) {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  const invoke = httpsCallable<Input, Output>(firebaseFunctions, name, { timeout: 30_000 })
  return async (input: Input) => {
    const retryableCodes = new Set([
      'functions/internal',
      'functions/resource-exhausted',
      'functions/unavailable',
      'functions/deadline-exceeded',
    ])
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await invoke(input)
      } catch (error) {
        lastError = error
        const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
          ? error.code
          : ''
        reportClientIssue('firestore', error, {
          phase: `payroll_callable_${name}`,
          route: window.location.hash,
          retryable: retryableCodes.has(code),
        })
        if (!retryableCodes.has(code) || attempt === 2) throw error
        await new Promise((resolve) => window.setTimeout(resolve, 400 * (2 ** attempt)))
      }
    }
    throw lastError
  }
}

function object(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? value as UnknownRecord : {}
}

function text(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function number(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function integer(value: unknown) {
  return Math.max(0, Math.trunc(number(value)))
}

function attendanceStatus(value: unknown): WorkdayDisplayStatus {
  const accepted = new Set<WorkdayDisplayStatus>([
    'present', 'remote', 'business_trip', 'training', 'paid_leave',
    'unpaid_leave', 'unexcused_absence', 'sick_leave', 'maternity_leave',
    'pending', 'auto_present_teaching', 'weekly_rest', 'paid_holiday', 'outside_employment', 'upcoming',
  ])
  return accepted.has(value as WorkdayDisplayStatus) ? value as WorkdayDisplayStatus : 'pending'
}

function normalizeCalendar(value: unknown): WorkCalendar {
  const raw = object(value)
  return {
    periodId: text(raw.periodId),
    branchId: text(raw.branchId),
    weeklyRestDays: Array.isArray(raw.weeklyRestDays)
      ? raw.weeklyRestDays.map(integer).filter((day) => day <= 6)
      : [0],
    holidays: Array.isArray(raw.holidays) ? raw.holidays.flatMap((holidayValue) => {
      const holiday = object(holidayValue)
      const date = text(holiday.date)
      return date ? [{ date, name: text(holiday.name), paid: holiday.paid !== false }] : []
    }) : [],
    status: raw.status === 'approved' ? 'approved' : 'provisional',
    revision: integer(raw.revision),
    source: raw.source === 'branch_calendar' || raw.source === 'global_calendar'
      ? raw.source
      : 'default_sunday_calendar',
    approved: raw.approved === true,
  }
}

function normalizeWorkdays(value: unknown): StaffWorkdaySummary {
  const raw = object(value)
  const employment = object(raw.employment)
  return {
    standardWorkdays: integer(raw.standardWorkdays),
    eligibleWorkdays: integer(raw.eligibleWorkdays),
    paidDays: integer(raw.paidDays),
    unpaidDays: integer(raw.unpaidDays),
    pendingDays: integer(raw.pendingDays),
    benefitReviewDays: integer(raw.benefitReviewDays),
    estimatedPaidDays: integer(raw.estimatedPaidDays),
    dailyRate: number(raw.dailyRate),
    baseSalary: number(raw.baseSalary),
    baseSalaryEarned: number(raw.baseSalaryEarned),
    fixedBonus: number(raw.fixedBonus),
    employmentType: raw.employmentType === 'collaborator' || raw.employmentType === 'part_time' ? raw.employmentType : 'full_time',
    employmentLevel: raw.employmentLevel === 'probation' || raw.employmentLevel === 'senior' ? raw.employmentLevel : 'official',
    workdayEnabled: raw.workdayEnabled === true,
    autoPaidDays: integer(raw.autoPaidDays),
    autoFullDayTeachingSlotThreshold: Math.max(1, integer(raw.autoFullDayTeachingSlotThreshold) || 5),
    calendarReviewRequired: raw.calendarReviewRequired === true,
    attendanceReviewRequired: raw.attendanceReviewRequired === true,
    reviewRequired: raw.reviewRequired === true,
    employment: { start: text(employment.start), end: text(employment.end) },
    days: Array.isArray(raw.days) ? raw.days.flatMap((dayValue) => {
      const day = object(dayValue)
      const date = text(day.date)
      return date ? [{
        date,
        weekday: integer(day.weekday),
        status: attendanceStatus(day.status),
        eligible: day.eligible === true,
        holidayName: text(day.holidayName),
        note: text(day.note),
        revision: integer(day.revision),
        teachingSlotCount: integer(day.teachingSlotCount),
        source: day.source === 'admin_override' || day.source === 'teaching_slots' ? day.source : 'calendar',
      }] : []
    }) : [],
  }
}

function normalizeAmounts(value: unknown): StaffPayrollAmounts {
  const raw = object(value)
  return {
    baseSalaryAmount: number(raw.baseSalaryAmount),
    teachingPayAmount: number(raw.teachingPayAmount),
    commissionAmount: number(raw.commissionAmount),
    bonusAmount: number(raw.bonusAmount),
    adjustmentAmount: number(raw.adjustmentAmount),
    deductionAmount: number(raw.deductionAmount),
    grossAmount: number(raw.grossAmount),
    finalAmount: number(raw.finalAmount),
  }
}

function normalizeIdentity(value: unknown): StaffPayrollIdentity {
  const raw = object(value)
  return {
    name: text(raw.name) || 'Nhân viên Aura',
    employeeCode: text(raw.employeeCode),
    branchId: text(raw.branchId),
    photoURL: text(raw.photoURL),
    employmentType: raw.employmentType === 'collaborator' || raw.employmentType === 'part_time' ? raw.employmentType : 'full_time',
    employmentLevel: raw.employmentLevel === 'probation' || raw.employmentLevel === 'senior' ? raw.employmentLevel : 'official',
    payrollPolicyId: text(raw.payrollPolicyId),
  }
}

function normalizeTeachingSlots(value: unknown): StaffTeachingSlot[] {
  return Array.isArray(value) ? value.flatMap((slotValue) => {
    const raw = object(slotValue)
    const key = text(raw.key)
    if (!key) return []
    const tier = raw.tier === 'after_threshold_evening'
      ? 'after_threshold_evening'
      : raw.tier === 'after_threshold' ? 'after_threshold' : 'standard'
    return [{
      key,
      date: text(raw.date),
      hour: integer(raw.hour),
      branchId: text(raw.branchId),
      dailyPosition: Math.max(1, integer(raw.dailyPosition)),
      tier,
      rate: number(raw.rate),
      policyId: text(raw.policyId),
      policyName: text(raw.policyName),
      studentCount: Math.max(1, integer(raw.studentCount)),
      sessionIds: Array.isArray(raw.sessionIds) ? raw.sessionIds.filter((id): id is string => typeof id === 'string') : [],
    }]
  }) : []
}

function normalizeStaffPayrollStatement(rawValue: unknown, periodId: string, staffId = ''): MyStaffPayroll {
  const raw = object(rawValue)
  const run = object(raw.run)
  const runStatus = run.status === 'draft' || run.status === 'reviewed' || run.status === 'locked' || run.status === 'paid'
    ? run.status
    : 'estimating'
  return {
    staffId: text(raw.staffId) || staffId,
    periodId: text(raw.periodId) || periodId,
    identity: normalizeIdentity(raw.identity),
    calendar: normalizeCalendar(raw.calendar),
    workdays: normalizeWorkdays(raw.workdays),
    amounts: normalizeAmounts(raw.amounts),
    teachingSlots: normalizeTeachingSlots(raw.teachingSlots),
    teachingEvidence: raw.teachingEvidence && typeof raw.teachingEvidence === 'object' ? {
      slotCount: integer(object(raw.teachingEvidence).slotCount),
      truncated: object(raw.teachingEvidence).truncated === true,
      source: text(object(raw.teachingEvidence).source),
    } : undefined,
    referralCommission: {
      rate: number(object(raw.referralCommission).rate),
      contractCount: integer(object(raw.referralCommission).contractCount),
      cashCollectedAmount: number(object(raw.referralCommission).cashCollectedAmount),
      cashReversedAmount: number(object(raw.referralCommission).cashReversedAmount),
      netCashAmount: number(object(raw.referralCommission).netCashAmount),
      commissionAmount: number(object(raw.referralCommission).commissionAmount),
      reversalAmount: number(object(raw.referralCommission).reversalAmount),
      evidence: Array.isArray(object(raw.referralCommission).evidence) ? (object(raw.referralCommission).evidence as unknown[]).flatMap((value) => {
        const item = object(value)
        const ledgerEntryId = text(item.ledgerEntryId)
        return ledgerEntryId ? [{
          ledgerEntryId,
          contractId: text(item.contractId),
          cashImpact: number(item.cashImpact),
          rate: number(item.rate),
          commissionImpact: number(item.commissionImpact),
        }] : []
      }) : [],
      unresolvedEntryCount: integer(object(raw.referralCommission).unresolvedEntryCount),
      ambiguousCodeEntryCount: integer(object(raw.referralCommission).ambiguousCodeEntryCount),
      invalidRateEntryCount: integer(object(raw.referralCommission).invalidRateEntryCount),
    },
    compensationPolicy: {
      id: text(object(raw.compensationPolicy).id),
      name: text(object(raw.compensationPolicy).name) || 'Chưa gán chính sách',
      eligibleProfiles: Array.isArray(object(raw.compensationPolicy).eligibleProfiles)
        ? (object(raw.compensationPolicy).eligibleProfiles as unknown[]).filter((value): value is string => typeof value === 'string')
        : [],
      payrollProfile: ['probation', 'official', 'senior', 'part_time', 'collaborator'].includes(text(object(raw.compensationPolicy).payrollProfile))
        ? text(object(raw.compensationPolicy).payrollProfile) as MyStaffPayroll['compensationPolicy']['payrollProfile']
        : 'official',
      assigned: object(raw.compensationPolicy).assigned === true,
      estimated: object(raw.compensationPolicy).estimated !== false,
    },
    run: {
      exists: run.exists === true,
      status: runStatus,
      official: run.official === true,
      updatedAt: text(run.updatedAt),
      paidAt: text(run.paidAt),
    },
    generatedAt: text(raw.generatedAt),
  }
}

export async function getMyStaffPayroll(periodId: string): Promise<MyStaffPayroll> {
  const result = await callable<{ periodId: string }, UnknownRecord>('getMyStaffPayroll')({ periodId })
  return normalizeStaffPayrollStatement(result.data, periodId)
}

export async function getStaffPayrollStatement(periodId: string, staffId: string): Promise<MyStaffPayroll> {
  const result = await callable<{ periodId: string; staffId: string }, UnknownRecord>('getStaffPayrollStatement')({ periodId, staffId })
  return normalizeStaffPayrollStatement(result.data, periodId, staffId)
}

export async function listStaffPayrollAttendance(periodId: string, branchId = '') {
  const result = await callable<{ periodId: string; branchId?: string }, { periodId?: unknown; asOfDate?: unknown; rows?: unknown[]; summary?: unknown; referralDiagnostics?: unknown; truncated?: unknown }>('listStaffPayrollAttendance')({ periodId, branchId })
  const rows: StaffAttendanceRow[] = Array.isArray(result.data.rows) ? result.data.rows.flatMap((rowValue) => {
    const raw = object(rowValue)
    const staffId = text(raw.staffId)
    if (!staffId) return []
    return [{
      staffId,
      name: text(raw.name) || 'Chưa cập nhật tên',
      branchId: text(raw.branchId),
      employmentType: raw.employmentType === 'collaborator' || raw.employmentType === 'part_time' ? raw.employmentType : 'full_time',
      baseSalary: number(raw.baseSalary),
      standardWorkdays: integer(raw.standardWorkdays),
      eligibleWorkdays: integer(raw.eligibleWorkdays),
      paidDays: integer(raw.paidDays),
      autoPaidDays: integer(raw.autoPaidDays),
      teachingSlotCount: integer(raw.teachingSlotCount),
      estimatedPaidDays: integer(raw.estimatedPaidDays),
      unpaidDays: integer(raw.unpaidDays),
      pendingDays: integer(raw.pendingDays),
      baseSalaryEarned: number(raw.baseSalaryEarned),
      teachingPayAmount: number(raw.teachingPayAmount),
      commissionAmount: number(raw.commissionAmount),
      bonusAmount: number(raw.bonusAmount),
      deductionAmount: number(raw.deductionAmount),
      grossAmount: number(raw.grossAmount),
      finalAmount: number(raw.finalAmount),
      policyName: text(raw.policyName),
      policyConfigured: raw.policyConfigured !== false,
      referralCommissionRate: number(raw.referralCommissionRate),
      referralContractCount: integer(raw.referralContractCount),
      referralCashCollectedAmount: number(raw.referralCashCollectedAmount),
      referralCashReversedAmount: number(raw.referralCashReversedAmount),
      referralNetCashAmount: number(raw.referralNetCashAmount),
      referralCommissionReversalAmount: number(raw.referralCommissionReversalAmount),
      reviewRequired: raw.reviewRequired === true,
      calendarApproved: raw.calendarApproved === true,
    }]
  }) : []
  const rawSummary = object(result.data.summary)
  const summary: StaffPayrollLiveSummary = {
    activeStaffCount: integer(rawSummary.activeStaffCount),
    teachingSlotCount: integer(rawSummary.teachingSlotCount),
    baseSalaryAmount: number(rawSummary.baseSalaryAmount),
    teachingPayAmount: number(rawSummary.teachingPayAmount),
    commissionAmount: number(rawSummary.commissionAmount),
    bonusAmount: number(rawSummary.bonusAmount),
    deductionAmount: number(rawSummary.deductionAmount),
    estimatedTotal: number(rawSummary.estimatedTotal),
    reviewRequiredCount: integer(rawSummary.reviewRequiredCount),
    unconfiguredPolicyCount: integer(rawSummary.unconfiguredPolicyCount),
  }
  return {
    periodId: text(result.data.periodId) || periodId,
    asOfDate: text(result.data.asOfDate),
    rows,
    summary,
    referralDiagnostics: {
      unresolvedEntryCount: integer(object(result.data.referralDiagnostics).unresolvedEntryCount),
      ambiguousCodeEntryCount: integer(object(result.data.referralDiagnostics).ambiguousCodeEntryCount),
      invalidRateEntryCount: integer(object(result.data.referralDiagnostics).invalidRateEntryCount),
    },
    truncated: result.data.truncated === true,
  }
}

export async function getStaffPayrollAttendanceDetail(periodId: string, staffId: string) {
  const result = await callable<{ periodId: string; staffId: string }, UnknownRecord>('getStaffPayrollAttendanceDetail')({ periodId, staffId })
  const raw = object(result.data)
  return {
    periodId: text(raw.periodId) || periodId,
    staffId: text(raw.staffId) || staffId,
    identity: normalizeIdentity(raw.identity),
    calendar: normalizeCalendar(raw.calendar),
    workdays: normalizeWorkdays(raw.workdays),
  }
}

export async function saveStaffAttendanceDay(input: { staffId: string; date: string; status: StaffAttendanceStatus; note?: string }) {
  const result = await callable<typeof input, { staffId: string; date: string; status: StaffAttendanceStatus; revision: number }>('saveStaffAttendanceDay')(input)
  return result.data
}

export async function fillMissingStaffAttendanceDays(input: { staffId: string; periodId: string }) {
  const result = await callable<typeof input, { staffId: string; periodId: string; createdCount: number; unchanged: boolean }>('fillMissingStaffAttendanceDays')(input)
  return result.data
}

export async function saveWorkCalendar(input: { periodId: string; branchId?: string; weeklyRestDays: number[]; holidays: WorkCalendarHoliday[]; expectedRevision: number }) {
  const result = await callable<typeof input, { periodId: string; branchId: string; revision: number; status: 'approved' }>('saveWorkCalendar')(input)
  return result.data
}

export async function submitMyPayrollInquiry(input: { periodId: string; category: 'attendance' | 'teaching' | 'commission' | 'deduction' | 'other'; message: string }) {
  const result = await callable<typeof input, { inquiryId: string; status: 'open' }>('submitMyPayrollInquiry')(input)
  return result.data
}
