import { normalizeOperationsDashboardData } from '../../src/utils/operationsDashboardNormalization'
export type { DashboardActionMetric, OperationsDashboardData } from '../../src/utils/operationsDashboardNormalization'
export type { StaffAttendanceRow } from '../../src/services/staffPayrollService'

function request(type: string, input: Record<string, unknown>, value: unknown) {
  const fixture = (window as any).dashboardFixture
  const id = fixture.calls.length
  fixture.calls.push({ id, type, input, uid: fixture.uid })
  const key = `${type}:${input.branchId || input.staffId || fixture.uid}`
  if (fixture.hold.includes(key)) return new Promise((resolve, reject) => fixture.pending.set(id, { resolve, reject, value }))
  return Promise.resolve(value)
}

export function getOperationsDashboard(input: Record<string, unknown>) {
  const branchId = input.branchId || 'all'
  const amount = branchId === 'branch-a' ? 222222 : branchId === 'branch-b' ? 333333 : (window as any).dashboardFixture.uid === 'admin-a' ? 111111 : 444444
  return request('dashboard', input, normalizeOperationsDashboardData({
    schemaVersion: 7,
    branchId, range: { startAt: input.startAt, endAt: input.endAt, timeZone: 'Asia/Ho_Chi_Minh' },
    permissions: { payroll: true, finance: true, clients: true, operations: true, quality: (window as any).dashboardFixture.canViewQuality !== false },
    quality: (window as any).dashboardFixture.quality || {},
    finance: { recognizedRevenue: amount },
    filters: { branches: [{ id: 'branch-a', name: 'Cơ sở A' }, { id: 'branch-b', name: 'Cơ sở B' }] },
    generatedAt: '2026-10-24T06:00:00Z',
  }))
}

export function listStaffPayrollAttendance(periodId: string, branchId: string, options: unknown) {
  return request('roster', { periodId, branchId, options }, { rows: [
    { staffId: 'staff-a', name: 'PT An', employmentType: 'full_time', teachingSlotCount: 2, finalAmount: 10000000, reviewRequired: false },
    { staffId: 'staff-b', name: 'PT Bình', employmentType: 'part_time', teachingSlotCount: 3, finalAmount: 6000000, reviewRequired: false },
  ] })
}

export function getStaffPayrollStatement(periodId: string, staffId: string) {
  return request('statement', { periodId, staffId }, {
    periodId, amounts: { baseSalaryAmount: staffId === 'staff-a' ? 9000000 : 5000000, teachingPayAmount: 1000000 },
    workdays: { days: [] }, teachingSlots: [], run: { official: false },
  })
}
export const trackProductEvent = async () => {}
