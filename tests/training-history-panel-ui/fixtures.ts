const state = window as any
state.historyCalls = []
state.usageCalls = []
state.correctionCalls = []
state.activeTrainerDirectoryReads = 0
export const useAuth = () => ({ profile: { role: 'admin' } })
const acquireTrainingHistoryTrainerDirectory = () => {
  state.activeTrainerDirectoryReads += 1
  return () => { state.activeTrainerDirectoryReads -= 1 }
}
export const useDatabase = () => ({ trainers: [{ id: 'trainer-1', name: 'PT Một', status: 'active' }], acquireTrainingHistoryTrainerDirectory })

const usage = { historySessions: 3, chargedSessions: 2, attendedSessions: 2, presentSessions: 2, lateSessions: 0, noShowSessions: 0, chargedNoShowSessions: 0, policyChargedSessions: 0, chargedPendingAttendanceSessions: 0, exemptSessions: 1, pendingSessions: 0, legacyChargedSessions: 0 }
function response(call: any, labels: string[] = [call.id], hasMore = false) {
  return {
    schemaVersion: 3, subjectType: call.subject, subjectId: call.id,
    records: labels.map((label) => ({ id: label, date: call.query.endDate, hour: 18, status: 'completed', studentId: call.subject === 'student' ? call.id : label, trainerId: 'trainer-1', branchId: 'branch-1', contractId: 'contract-1', counterpartId: label, counterpartName: label, billingStatus: 'charged', countsTowardContract: true, isExempt: false, attendance: { id: `attendance-${label}`, attendanceStatus: 'present' }, events: [], revision: 1 })),
    summary: { total: 3, completed: 2, noShow: 0, cancelled: 0, byStatus: {}, usage, teaching: call.subject === 'trainer' ? { totalShifts: 1, pairedShifts: 0, learnerBookings: 1, maxLearnersPerShift: 1 } : null, truncated: false },
    hasMore, nextCursor: hasMore ? 'next-page' : null, filters: call.query,
  }
}
function history(subject: string, id: string, query: any) {
  const call = { subject, id, query }
  const index = state.historyCalls.push(call) - 1
  return new Promise((resolve) => {
    state.historyResolvers ??= []
    state.historyResolvers[index] = (labels?: string[], more?: boolean) => resolve(response(call, labels, more))
    if (!state.holdHistory) state.historyResolvers[index]()
  })
}
export const listStudentTrainingHistory = (id: string, query: any) => history('student', id, query)
export const listTrainerTeachingHistory = (id: string, query: any) => history('trainer', id, query)
export async function getStudentContractUsage(studentId: string) {
  state.usageCalls.push(studentId)
  return { summaries: [{ ...usage, contractId: 'contract-1', packageName: `Gói ${studentId}`, status: 'active', totalSessions: 20, usedSessions: 2, remainingSessions: 18, legacyProjectionAdjustment: 0 }] }
}
export async function correctTeachingShift(input: any) {
  state.correctionCalls.push(input)
  if (state.holdCorrection) await new Promise<void>((resolve) => { state.finishCorrection = resolve })
  return { unchanged: false, invalidatedPayrollPeriods: [] }
}
