import { firebaseBusinessReportingFunctions, firebaseFunctions } from '../lib/firebaseFunctions'
import { firebaseAuth } from '../lib/firebase'
import { runKeyedSingleFlight } from '../utils/singleFlight'
import { createClientCorrelationId } from './clientTelemetryService'
import { callReadOnlyFunction, runReadOnlyWithFallback } from './readOnlyCallableService'

const pendingReads = new Map<string, Promise<unknown>>()

export function callBusinessReportingRead<Input, Output>(name: string, input: Input): Promise<Output> {
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
      // Period reports can take over 20 seconds on a cold instance. Give that
      // bounded aggregation time to finish instead of duplicating its reads
      // in the fallback region after 18 seconds. History keeps its short budget.
      maximumAttempts: 1,
      timeoutMs: name === 'listBusinessPerformance' ? 45_000 : ['listFinanceReconciliationCases', 'getFinanceReconciliationCase'].includes(name) ? 30_000 : 18_000,
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
  includeReconciliationIndex?: boolean
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
  /** Additive report fields: absence on an older backend means unavailable. */
  receipts?: { gross: number; refunds: number; reversals: number; adjustments: number; net: number }
  /** PT contract sales, only supported for the all / pt_gym source scopes. */
  sales?: { grossContractSales: number; contractSalesAdjustment: number; netContractSales: number; contractCount: number; complete: boolean } | null
  balanceMovement: { receivableMovement: number; deferredRevenueMovement: number }
  sourceRows: BusinessSourceRow[]
  dailySeries: Array<{ date: string; cashNet: number; recognisedRevenue: number; operatingExpense: number; operatingResult: number;
    grossCash?: number; netCash?: number; contractSales?: number; salesAdjustment?: number }>
  dataQuality: {
    scannedLedgerEntries: number
    ledgerTruncated: boolean
    contractsTruncated?: boolean
    scannedSalesContracts?: number
    contractSalesReadMode?: 'indexed' | 'legacy_gate' | 'legacy_coverage' | 'legacy_stale' | 'legacy_index' | 'not_requested'
    cancelledSalesBaselineUnverified?: number
    contractSalesDatesMissing?: number
    cashTransactionsTruncated?: boolean
    payrollLimitReached?: boolean
    cashAccountsTruncated?: boolean
    legacyUnclassifiedEntries: number
    unlinkedCashTransactions: number
    unlinkedCashTransactionCount?: number
    payrollPaidOutsideLedger: number
    reconciliation?: { schemaVersion: 1; evidenceCount: number; matchedInPeriod: number; pendingConfirmation: number;
      automaticReview: number; billingReview: number; recognitionReview: number; exempt: number; unresolved: number;
      conflicts: number; missingBranch: number; posted: number; verifiedMissingPosting: null;
      zeroValueConfirmed?: number; exemptBreakdown?: { duplicate: number; returned: number; complimentary: number; other: number };
      caseIndex?: Record<string, string[]> }
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

export interface TrainingHistoryContract {
  id: string
  packageName: string
  status: string
  startDate: string | null
  endDate: string | null
}

export interface TrainingHistoryRecord {
  id: string
  date: string
  hour: number | null
  status: string
  studentId: string
  trainerId: string
  branchId: string
  contractId: string
  contract?: TrainingHistoryContract | null
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
  includeContracts?: boolean
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
