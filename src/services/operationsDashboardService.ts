import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebase'

export interface DashboardActionMetric {
  available: boolean
  totalCount: number
  actionCount: number
  overdueCount: number
  dueTodayCount: number
  warningCount: number
  amount: number
  truncated: boolean
}

export interface OperationsDashboardData {
  schemaVersion: 2
  range: { startAt: string; endAt: string; timeZone: string }
  branchId: string
  scope: { branchId: string; branchIds: string[]; unrestricted: boolean }
  permissions: {
    finance: boolean
    clients: boolean
    operations: boolean
    schedule: boolean
    renewals: boolean
    nutritionReviews: boolean
    academy: boolean
    payroll: boolean
    quality: boolean
  }
  actionSummary: {
    overdueReceivables: DashboardActionMetric
    dueRenewals: DashboardActionMetric
    pendingScheduleRequests: DashboardActionMetric
    overdueMealReviews: DashboardActionMetric
    missingContractEffectiveDate: DashboardActionMetric
  }
  today: { scheduledSessions: number; completedSessions: number; pendingRequests: number }
  finance: { contractSales: number; cashCollected: number; refunds: number; reversals: number; adjustments: number; netCash: number; receivables: number }
  clients: { total: number; active: number; newInRange: number; activeContracts: number }
  operations: { sessions: number; attendanceEvents: number; sessionStatus: Record<string, number>; completionRate: number; activeTrainers: number; activeStaff: number; branches: number }
  quality: { completeness: 'complete' | 'partial'; missingContractEffectiveDate: number; truncated: boolean; canonicalFinanceSource: string; canonicalAttendanceSource: string }
  generatedAt: string
  cache: { hit: boolean; ttlSeconds: number }
}

export async function getOperationsDashboard(input: { startAt?: string; endAt?: string; branchId?: string; forceRefresh?: boolean } = {}) {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return (await httpsCallable<typeof input, OperationsDashboardData>(firebaseFunctions, 'getOperationsDashboard')(input)).data
}

export async function listStaffAttendance(periodId: string) {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return (await httpsCallable<{ periodId: string }, { periodId: string; rows: Array<{ trainerId: string; sessionCount: number; lastOccurredAt: string }>; eventCount: number; truncated: boolean; source: 'attendanceEvents' }>(firebaseFunctions, 'listStaffAttendance')({ periodId })).data
}
