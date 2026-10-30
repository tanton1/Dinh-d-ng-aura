import { firebaseBusinessReportingFunctions, firebaseFunctions } from '../lib/firebaseFunctions'
import { firebaseAuth } from '../lib/firebase'
import { runKeyedSingleFlight } from '../utils/singleFlight'
import { createClientCorrelationId } from './clientTelemetryService'
import { callReadOnlyFunction, runReadOnlyWithFallback } from './readOnlyCallableService'

const pendingReads = new Map<string, Promise<unknown>>()

function callBusinessReportingRead<Input, Output>(name: string, input: Input): Promise<Output> {
  const uid = firebaseAuth?.currentUser?.uid
  const execute = () => invokeBusinessReportingRead<Input, Output>(name, input)
  // Coalesce only simultaneous reads from the same signed-in account. A
  // completed result is never cached, so refreshes observe corrections.
  if (!uid) return execute()
  return runKeyedSingleFlight(pendingReads, JSON.stringify([uid, name, input]), execute) as Promise<Output>
}

async function invokeBusinessReportingRead<Input, Output>(name: string, input: Input): Promise<Output> {
  const correlationId = createClientCorrelationId()
  const invoke = (functionsClient: typeof firebaseFunctions, callableName: string) => {
    if (!functionsClient) throw new Error('Firebase Functions chưa sẵn sàng.')
    return callReadOnlyFunction<Input, Output>(callableName, input, {
      functionsClient,
      // A regional failover should happen quickly; the second region owns the
      // retry budget instead of waiting through three attempts in one region.
      maximumAttempts: 1,
      timeoutMs: 18_000,
      correlationId,
    })
  }
  if (!firebaseBusinessReportingFunctions) return invoke(firebaseFunctions, name)
  return runReadOnlyWithFallback(
    () => invoke(firebaseBusinessReportingFunctions, `${name}Regional`),
    () => invoke(firebaseFunctions, name),
  )
}

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
    cashTransactionsTruncated?: boolean
    payrollLimitReached?: boolean
    cashAccountsTruncated?: boolean
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
  return callBusinessReportingRead<BusinessPerformanceQuery, BusinessPerformanceReport>('listBusinessPerformance', input)
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
  billingStatus: string
  countsTowardContract: boolean
  isExempt: boolean
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
  } | null
  hasMore: boolean
  nextCursor: string | null
  filters: { startDate: string; endDate: string; status: TrainingHistoryStatus; allTime?: boolean }
}

export interface SessionUsageSummary {
  historySessions: number
  chargedSessions: number
  attendedSessions: number
  presentSessions: number
  lateSessions: number
  noShowSessions: number
  chargedNoShowSessions: number
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
  sourceVersion?: 'contract-usage-v3-daily' | 'contract-usage-v2' | string
}

export interface StudentContractUsageResponse {
  schemaVersion: 1
  studentId: string
  formulaVersion: 'contract-usage-v3-daily' | 'contract-usage-v2'
  summaries: ContractUsageSummary[]
  dataQuality: {
    scannedContracts: number
    scannedSessions: number
    unlinkedChargedSessions: number
    requiresReview: number
  }
}

export interface TrainingHistoryQuery {
  startDate?: string
  endDate?: string
  allTime?: boolean
  status?: TrainingHistoryStatus
  pageSize?: number
  cursor?: string | null
  /** Cursor pages may retain totals from the first page of the same scope. */
  includeSummary?: boolean
}

export async function listStudentTrainingHistory(studentId: string, query: TrainingHistoryQuery): Promise<TrainingHistoryPage> {
  return callBusinessReportingRead<{ studentId: string } & TrainingHistoryQuery, TrainingHistoryPage>('listStudentTrainingHistory', { studentId, ...query })
}

export async function listTrainerTeachingHistory(trainerId: string, query: TrainingHistoryQuery): Promise<TrainingHistoryPage> {
  return callBusinessReportingRead<{ trainerId: string } & TrainingHistoryQuery, TrainingHistoryPage>('listTrainerTeachingHistory', { trainerId, ...query })
}

export async function getStudentContractUsage(studentId: string, contractId?: string): Promise<StudentContractUsageResponse> {
  return callBusinessReportingRead<{ studentId: string; contractId?: string }, StudentContractUsageResponse>('getStudentContractUsage', {
    studentId,
    ...(contractId ? { contractId } : {}),
  })
}
