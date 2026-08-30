import { callReadOnlyFunction } from './readOnlyCallableService'

export type BusinessSource = 'all' | 'pt_gym' | 'online_coaching' | 'nutrition_coaching' | 'academy' | 'eat_clean' | 'delivery_fee' | 'payroll' | 'other' | 'legacy_unclassified'

export interface BusinessPerformanceQuery {
  startDate: string
  endDate: string
  branchId?: string
  source?: BusinessSource
}

export interface BusinessSourceRow {
  source: Exclude<BusinessSource, 'all'>
  cashIn: number
  cashOut: number
  cashNet: number
  recognisedRevenue: number
  operatingExpense: number
  operatingResult: number
  entryCount: number
}

export interface BusinessPerformanceReport {
  schemaVersion: 3
  range: { startDate: string; endDate: string; timeZone: string }
  branchId: string
  source: BusinessSource
  managementPnl: { recognisedRevenue: number; operatingExpense: number; operatingResult: number }
  cashFlow: { cashIn: number; cashOut: number; cashNet: number }
  balanceMovement: { receivableMovement: number; deferredRevenueMovement: number }
  sourceRows: BusinessSourceRow[]
  dailySeries: Array<{ date: string; cashNet: number; recognisedRevenue: number; operatingExpense: number; operatingResult: number }>
  dataQuality: {
    scannedLedgerEntries: number
    ledgerTruncated: boolean
    legacyUnclassifiedEntries: number
    unlinkedCashTransactions: number
    payrollPaidOutsideLedger: number
    attendanceEvents: number
    recognisedAttendanceEvents: number
    unrecognisedAttendanceEvents: number
    attendanceTruncated: boolean
    cashAccounts: number
    cashAccountsReady: boolean
    missingSourceIntegrations: string[]
    message: string
  }
}

export async function listBusinessPerformance(input: BusinessPerformanceQuery): Promise<BusinessPerformanceReport> {
  return callReadOnlyFunction<BusinessPerformanceQuery, BusinessPerformanceReport>('listBusinessPerformance', input)
}

export type TrainingHistorySubject = 'student' | 'trainer'
export type TrainingHistoryStatus = 'all' | 'scheduled' | 'rescheduled' | 'completed' | 'attended' | 'no_show' | 'student_cancelled' | 'trainer_cancelled' | 'corrected'

export interface TrainingHistoryRecord {
  id: string
  date: string
  hour: number | null
  status: string
  studentId: string
  trainerId: string
  branchId: string
  contractId: string
  counterpartId: string
  counterpartName: string
  attendance: {
    id: string
    type: string
    billingStatus: string
    attendanceStatus: string
    lateMinutes: number | null
    noShowReason: string
    occurredAt: string
    createdAt: string
  } | null
  events: Array<{ id: string; type: string; reason: string; createdAt: string }>
  revision: number
}

export interface TrainingHistoryPage {
  schemaVersion: number
  subjectType: TrainingHistorySubject
  subjectId: string
  records: TrainingHistoryRecord[]
  summary: {
    total: number
    completed: number
    noShow: number
    cancelled: number
    byStatus: Record<string, number>
    usage?: SessionUsageSummary
    teaching: { totalShifts: number; pairedShifts: number; learnerBookings: number; maxLearnersPerShift: number } | null
    truncated: boolean
  }
  hasMore: boolean
  nextCursor: string | null
  filters: { startDate: string; endDate: string; status: TrainingHistoryStatus }
}

export interface SessionUsageSummary {
  historySessions: number
  chargedSessions: number
  attendedSessions: number
  presentSessions: number
  lateSessions: number
  noShowSessions: number
  policyChargedSessions: number
  chargedPendingAttendanceSessions: number
  exemptSessions: number
  pendingSessions: number
  legacyChargedSessions: number
}

export interface ContractUsageSummary extends SessionUsageSummary {
  contractId: string
  packageName: string
  status: string
  startDate: string
  endDate: string
  totalSessions: number
  storedUsedSessions: number
  legacyProjectionAdjustment: number
  usedSessions: number
  remainingSessions: number
  projectionDelta: number
  reconciliationStatus: 'matched' | 'legacy_projection' | 'projection_behind' | 'over_entitlement'
}

export interface StudentContractUsageResponse {
  schemaVersion: 1
  studentId: string
  formulaVersion: 'contract-usage-v2'
  summaries: ContractUsageSummary[]
  dataQuality: {
    scannedContracts: number
    scannedSessions: number
    unlinkedChargedSessions: number
    requiresReview: number
  }
}

export interface TrainingHistoryQuery {
  startDate: string
  endDate: string
  status?: TrainingHistoryStatus
  pageSize?: number
  cursor?: string | null
}

export async function listStudentTrainingHistory(studentId: string, query: TrainingHistoryQuery): Promise<TrainingHistoryPage> {
  return callReadOnlyFunction<{ studentId: string } & TrainingHistoryQuery, TrainingHistoryPage>('listStudentTrainingHistory', { studentId, ...query })
}

export async function listTrainerTeachingHistory(trainerId: string, query: TrainingHistoryQuery): Promise<TrainingHistoryPage> {
  return callReadOnlyFunction<{ trainerId: string } & TrainingHistoryQuery, TrainingHistoryPage>('listTrainerTeachingHistory', { trainerId, ...query })
}

export async function getStudentContractUsage(studentId: string, contractId?: string): Promise<StudentContractUsageResponse> {
  return callReadOnlyFunction<{ studentId: string; contractId?: string }, StudentContractUsageResponse>('getStudentContractUsage', {
    studentId,
    ...(contractId ? { contractId } : {}),
  })
}
