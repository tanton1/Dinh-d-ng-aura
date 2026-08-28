import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebase'
import { normalizeOperationsDashboardData } from '../utils/operationsDashboardNormalization'
export type { DashboardActionMetric, OperationsDashboardData } from '../utils/operationsDashboardNormalization'

const dashboardPreviewEnabled = import.meta.env.MODE === 'e2e'

function previewDashboard(input: { startAt?: string; endAt?: string; branchId?: string }) {
  const startAt = input.startAt || '2026-08-01T00:00:00.000+07:00'
  const endAt = input.endAt || '2026-08-27T23:59:59.999+07:00'
  return normalizeOperationsDashboardData({
    schemaVersion: 7,
    range: { startAt, endAt, timeZone: 'Asia/Ho_Chi_Minh' },
    branchId: input.branchId || 'all',
    scope: { branchId: input.branchId || 'all', branchIds: [], unrestricted: true },
    permissions: { finance: true, clients: true, operations: true, schedule: true, renewals: true, nutritionReviews: true, academy: true, payroll: true, quality: true },
    actionSummary: {
      overdueReceivables: { available: true, totalCount: 48, actionCount: 6, overdueCount: 4, dueTodayCount: 2, warningCount: 42, amount: 18_500_000 },
      dueRenewals: { available: true, totalCount: 23, actionCount: 8, overdueCount: 3, dueTodayCount: 5, warningCount: 15, amount: 42_000_000 },
      pendingScheduleRequests: { available: true, totalCount: 7, actionCount: 9, overdueCount: 1, dueTodayCount: 2, warningCount: 2, amount: 0 },
      overdueMealReviews: { available: true, totalCount: 36, actionCount: 36, overdueCount: 12, dueTodayCount: 24, warningCount: 0, amount: 0 },
      missingContractEffectiveDate: { available: true, totalCount: 0, actionCount: 0, overdueCount: 0, dueTodayCount: 0, warningCount: 0, amount: 0 },
    },
    today: {
      scheduledSessions: 42,
      completedSessions: 27,
      pendingRequests: 7,
      attendance: { charged: 31, confirmed: 29, present: 24, late: 3, noShow: 2, pendingConfirmation: 2, attendanceRate: 93.1, confirmationRate: 93.5 },
      rows: [
        { id: 'today-1', hour: 8, studentId: 'student-1', studentName: 'Nguyễn Thu An', trainerId: 'trainer-1', trainerName: 'PT Mai', attendanceStatus: 'present', billingStatus: 'charged' },
        { id: 'today-2', hour: 9, studentId: 'student-2', studentName: 'Trần Minh Anh', trainerId: 'trainer-2', trainerName: 'PT Tấn', attendanceStatus: 'late', billingStatus: 'charged' },
        { id: 'today-3', hour: 10, studentId: 'student-3', studentName: 'Lê Ngọc Hà', trainerId: 'trainer-1', trainerName: 'PT Mai', attendanceStatus: 'pending', billingStatus: 'pending' },
        { id: 'today-4', hour: 11, studentId: 'student-4', studentName: 'Phạm Thanh Trúc', trainerId: 'trainer-3', trainerName: 'PT Âu', attendanceStatus: 'no_show', billingStatus: 'charged' },
      ],
      truncated: false,
    },
    finance: { contractSales: 310_000_000, recognizedRevenue: 219_160_415, cashCollected: 274_750_000, refunds: 2_000_000, reversals: 0, adjustments: 500_000, netCash: 273_250_000, receivables: 290_300_000, frozenReceivables: 24_000_000, ledgerEntries: 980 },
    receivables: {
      summary: {
        overdue: { count: 4, amount: 12_500_000 },
        dueThisWeek: { count: 3, amount: 9_000_000 },
        dueThisMonth: { count: 8, amount: 28_500_000 },
      },
      rows: [
        { id: 'debt-1', contractId: 'contract-1', studentId: 'student-1', studentName: 'Nguyễn Thu An', phone: '0901234567', packageName: 'PT 6 tháng', dueDate: '2026-08-20', amount: 5_000_000, status: 'overdue' },
        { id: 'debt-2', contractId: 'contract-2', studentId: 'student-2', studentName: 'Trần Minh Anh', phone: '0909876543', packageName: 'PT 3 tháng', dueDate: '2026-08-28', amount: 4_000_000, status: 'due_this_week' },
        { id: 'debt-3', contractId: 'contract-3', studentId: 'student-3', studentName: 'Lê Ngọc Hà', phone: '0912345678', packageName: 'PT 12 tháng', dueDate: '2026-08-31', amount: 7_500_000, status: 'due_this_month' },
      ],
      truncated: false,
    },
    clients: { total: 296, active: 283, newInRange: 12, activeContracts: 160, preservedContracts: 11, exhaustedContracts: 14, expiringSoonContracts: 28 },
    analytics: {
      revenue: { granularity: 'day', points: [
        { key: '2026-08-01', label: '01/08', contractSales: 48_000_000, recognizedRevenue: 35_000_000, grossCash: 42_000_000, netCash: 42_000_000 },
        { key: '2026-08-08', label: '08/08', contractSales: 62_000_000, recognizedRevenue: 41_000_000, grossCash: 55_000_000, netCash: 53_000_000 },
        { key: '2026-08-15', label: '15/08', contractSales: 75_000_000, recognizedRevenue: 56_000_000, grossCash: 68_000_000, netCash: 68_000_000 },
        { key: '2026-08-22', label: '22/08', contractSales: 81_000_000, recognizedRevenue: 61_000_000, grossCash: 72_000_000, netCash: 72_000_000 },
        { key: '2026-08-27', label: '27/08', contractSales: 44_000_000, recognizedRevenue: 26_160_415, grossCash: 37_750_000, netCash: 38_250_000 },
      ] },
      packages: { totalActive: 160, preservedContracts: 11, items: [
        { id: 'pt-3m', name: 'PT 3 tháng', count: 72, percent: 45 },
        { id: 'pt-6m', name: 'PT 6 tháng', count: 53, percent: 33.1 },
        { id: 'pt-12m', name: 'PT 12 tháng', count: 35, percent: 21.9 },
      ] },
      attendance: { confirmedSessions: 887, attendedSessions: 845, noShowSessions: 42, attendanceRate: 95.3, absenceRate: 4.7 },
      off: { activeContracts: 160, approvedContracts: 18, activeWithoutOff: 142, approvedRequests: 21, pendingRequests: 3, preservationRequests: 2, preservedContracts: 11, rate: 11.3 },
    },
    operations: { sessions: 931, attendanceEvents: 887, sessionStatus: { completed: 845, no_show: 42, scheduled: 44 }, completionRate: 95, activeTrainers: 9, activeStaff: 26, branches: 2 },
    quality: { completeness: 'complete', missingContractEffectiveDate: 0, truncated: false, canonicalFinanceSource: 'ledgerEntries', canonicalAttendanceSource: 'attendanceEvents', sourceCounts: { ledgerEntries: 980, contracts: 314, students: 296, sessions: 931, attendanceEvents: 887 } },
    filters: { branches: [{ id: 'thai-thi-boi', name: 'Thái Thị Bôi' }, { id: 'nguyen-van-linh', name: 'Nguyễn Văn Linh' }] },
    generatedAt: new Date().toISOString(),
    cache: { hit: false, ttlSeconds: 60 },
  })
}

export async function getOperationsDashboard(input: { startAt?: string; endAt?: string; branchId?: string; forceRefresh?: boolean } = {}) {
  if (dashboardPreviewEnabled) return previewDashboard(input)
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  const result = await httpsCallable<typeof input, unknown>(firebaseFunctions, 'getOperationsDashboard')(input)
  return normalizeOperationsDashboardData(result.data)
}

export async function listStaffAttendance(periodId: string) {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa sẵn sàng.')
  return (await httpsCallable<{ periodId: string }, { periodId: string; rows: Array<{ trainerId: string; sessionCount: number; lastOccurredAt: string }>; eventCount: number; truncated: boolean; source: 'attendanceEvents' }>(firebaseFunctions, 'listStaffAttendance')({ periodId })).data
}
