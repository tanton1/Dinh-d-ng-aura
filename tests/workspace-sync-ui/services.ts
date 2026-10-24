import { currentSync, firebaseAuth } from './signals'
const state = window as any
export const useNutritionWeight = (_id: string, fallback: number) => fallback
export const useAuraUiSurface = () => false
export const subscribeToUserGamification = (_id: string, callback: (value: unknown) => void) => { callback(null); return () => {} }
export const subscribeToUserMealLogsForDate = (_id: string, _day: string, callback: (value: unknown) => void) => { callback([]); return () => {} }
export const subscribeToUserWaterLogsForDate = subscribeToUserMealLogsForDate
export const saveUserGamification = async () => {}
export class StudentPtScheduleServiceError extends Error { issueCode = 'SYNC_UNAVAILABLE'; retryable = true }
export const asStudentPtScheduleError = (error: unknown) => error instanceof StudentPtScheduleServiceError ? error : new StudentPtScheduleServiceError(String(error))
export const studentPtContractHasSchedulableDate = () => false
const begin = async (domain: string, input: unknown) => {
  const uid = firebaseAuth.currentUser?.uid
  const syncState = currentSync(domain)
  state.workspaceCalls.push({ uid, domain, input, syncState })
  const delay = state.workspaceDelay || 0
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
  if (state.workspaceReadFails) throw new Error('Dịch vụ chưa phản hồi.')
  if (state.workspaceAccessDenied) {
    const error = new StudentPtScheduleServiceError('Tài khoản đã bị thu hồi quyền.')
    error.issueCode = 'ACCESS_DENIED'; error.retryable = false
    throw error
  }
  if (uid !== firebaseAuth.currentUser?.uid) throw new Error('Phiên đăng nhập đã thay đổi.')
  return syncState
}
export async function listMyStudentPtSchedule(from: string, to: string, availabilityWeekId: string) {
  const syncState = await begin('studentSchedule', { from, to, availabilityWeekId })
  return { schemaVersion: 4, linked: true, student: { id: firebaseAuth.currentUser?.uid, name: 'Học viên kiểm thử', branchId: 'branch', sessionsPerWeek: 3, availableSlots: state.availabilitySlots || [], isScheduleConfirmed: false, availabilityRevision: state.availabilityRevision || 0, ...(state.availabilitySlots ? { availability: { weekId: availabilityWeekId, slots: state.availabilitySlots, requestedSessions: state.availabilityRequestedSessions ?? null, requiredSessions: 3, minimumSlots: 5, revision: state.availabilityRevision || 0, locked: false, cutoffAt: '', submittedAt: null, source: 'weekly', status: 'submitted' } } : {}) }, scheduleConfig: { workingDays: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7'], workingHours: [8] }, sessions: state.workspaceSessions || [], contracts: [], contractAlerts: [], sessionRequests: [], pauseRequests: [], syncState }
}
export async function saveMyStudentAvailability(input: any) {
  const uid = firebaseAuth.currentUser?.uid
  state.availabilityWrites ??= []
  state.availabilityWrites.push({ uid, ...input })
  if (state.deferAvailabilitySave) await new Promise<void>(resolve => { state.finishAvailabilitySave = resolve })
  if (uid !== firebaseAuth.currentUser?.uid) throw new Error('Phiên đăng nhập đã thay đổi.')
  state.availabilitySlots = input.availableSlots
  state.availabilityRequestedSessions = input.requestedSessions
  state.availabilityRevision = (state.availabilityRevision || 0) + 1
  state.workspaceEmit(`users/${uid}/workspaceChanges/operations`, { studentScheduleVersion: String(state.availabilityRevision).padStart(4, '0') })
  return { availableSlots: input.availableSlots, availabilityRevision: state.availabilityRevision, isScheduleConfirmed: true, availability: { weekId: input.weekId, slots: input.availableSlots, requestedSessions: input.requestedSessions, revision: state.availabilityRevision, requiredSessions: input.requestedSessions || 3, minimumSlots: 5, locked: false, cutoffAt: '', submittedAt: null, source: 'weekly', status: 'submitted' } }
}
export async function getMyTrainerWorkspace(section: string, from: string, to: string) {
  const syncState = await begin('trainerWorkspace', { section, from, to })
  return { schemaVersion: 1, scope: { schemaVersion: 1, staffId: firebaseAuth.currentUser?.uid, branchIds: ['branch'], tabs: { students: true, schedule: true, requests: true }, counts: { primaryStudents: 0, secondaryStudents: 0, teachingSessions: 0 } }, students: [], branches: [{ id: 'branch', name: 'Chi nhánh' }], sessions: state.workspaceSessions || [], requests: [], syncState }
}
export async function listMyAssignedStudents() {
  await begin('trainerWorkspace', { section: 'addition-roster' })
  return { students: [], hasMore: false }
}
export const listStudentTrainingHistory = async (studentId: string) => {
  state.historyCalls ??= []
  state.historyCalls.push(studentId)
  return { records: [], hasMore: false }
}
const noWrite = async () => { throw new Error('Writes disabled in test fixture.') }
export const bulkConfirmMySessions = noWrite
export const recordMySessionAttendance = noWrite
export const reportMySessionAdvanceAbsence = async () => {
  if (!state.allowMutationFixture) return noWrite()
  await new Promise<void>((resolve) => { state.finishWorkspaceMutation = resolve })
  return { revision: 2, notice: { status: 'reported' } }
}
export const requestStudentSessionAddition = noWrite
export const requestSessionChange = noWrite
export const createStudentCareActivity = noWrite
