import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebase'

export interface OperationsDashboardData {
  schemaVersion: 1
  range: { startAt: string; endAt: string; timeZone: string }
  branchId: string
  finance: { contractSales: number; cashCollected: number; refunds: number; reversals: number; adjustments: number; netCash: number; receivables: number }
  clients: { total: number; active: number; newInRange: number; activeContracts: number }
  operations: { sessions: number; attendanceEvents: number; sessionStatus: Record<string, number>; activeTrainers: number; activeStaff: number; branches: number }
  quality: { completeness: 'complete' | 'partial'; missingContractEffectiveDate: number; truncated: boolean; canonicalFinanceSource: string; canonicalAttendanceSource: string }
  generatedAt: string
}

export async function getOperationsDashboard(input: { startAt?: string; endAt?: string; branchId?: string } = {}) {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return (await httpsCallable<typeof input, OperationsDashboardData>(firebaseFunctions, 'getOperationsDashboard')(input)).data
}

export async function listStaffAttendance(periodId: string) {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return (await httpsCallable<{ periodId: string }, { periodId: string; rows: Array<{ trainerId: string; sessionCount: number; lastOccurredAt: string }>; eventCount: number; truncated: boolean; source: 'attendanceEvents' }>(firebaseFunctions, 'listStaffAttendance')({ periodId })).data
}
