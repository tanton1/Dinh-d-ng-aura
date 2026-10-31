import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebaseFunctions'
import { callBusinessReportingRead } from './businessReportingService'

export interface ReconciliationRow {
  attendanceId: string; sessionId: string; studentId: string; trainerId: string; studentName: string; trainerName: string
  date: string; hour: number | null; branchId: string; contractId: string; billingStatus: string; attendanceStatus: string
  category: string; exemptionKind: string; issueCode: string; reason: string
}
export interface ReviewContract {
  id: string; packageName: string; status: string; totalSessions: number; usedSessions: number; totalPrice: number | null
  discount: number; paidAmount: number | null; startDate: string; endDate: string
}
export interface ReviewAction { id: string; label: string; sessionsDelta: number; revenueDelta: number; cashDelta: number }
export interface ReconciliationCase extends ReconciliationRow {
  token: string; contract: ReviewContract | null; revenueContract: ReviewContract | null
  actions: ReviewAction[]; blockers: string[]; candidates: ReviewContract[]; duplicateOfSessionId: string
  billing: { status: string; ordinal: number | null } | null
  usageProof?: { chargedSessions: number; storedUsedSessions: number; retainedOrdinal: number } | null
  returned: { reason: string; returnedSessions: number; revenueReversed: number } | null
  ledger: Array<{ id: string; status: string; type: string; revenue: number; cash: number; date: string; contractId: string }>
  history: Array<{ id: string; action: string; reason: string; actorName: string; createdAt: string; effect: ReviewAction; currentEvidence: boolean }>
}
export const listFinanceReconciliationCases = (attendanceIds: string[]) => callBusinessReportingRead<{ attendanceIds: string[] }, { rows: ReconciliationRow[]; missing: string[] }>('listFinanceReconciliationCases', { attendanceIds })
export const getFinanceReconciliationCase = (attendanceId: string, targetContractId = '') => callBusinessReportingRead<{ attendanceId: string; targetContractId: string }, ReconciliationCase>('getFinanceReconciliationCase', { attendanceId, targetContractId })
export async function resolveFinanceReconciliationCase(input: { attendanceId: string; targetContractId: string; action: string; reason: string; token: string; requestId: string }) {
  if (!firebaseFunctions) throw new Error('Firebase chưa sẵn sàng.')
  return (await httpsCallable<typeof input, ReviewAction & { unchanged: boolean }>(firebaseFunctions, 'resolveFinanceReconciliationCase', { timeout: 120_000 })(input)).data
}
