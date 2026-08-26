import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebase'
import { normalizeOperationsDashboardData } from '../utils/operationsDashboardNormalization'
export type { DashboardActionMetric, OperationsDashboardData } from '../utils/operationsDashboardNormalization'

export async function getOperationsDashboard(input: { startAt?: string; endAt?: string; branchId?: string; forceRefresh?: boolean } = {}) {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  const result = await httpsCallable<typeof input, unknown>(firebaseFunctions, 'getOperationsDashboard')(input)
  return normalizeOperationsDashboardData(result.data)
}

export async function listStaffAttendance(periodId: string) {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return (await httpsCallable<{ periodId: string }, { periodId: string; rows: Array<{ trainerId: string; sessionCount: number; lastOccurredAt: string }>; eventCount: number; truncated: boolean; source: 'attendanceEvents' }>(firebaseFunctions, 'listStaffAttendance')({ periodId })).data
}
