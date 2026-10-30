import { useEffect } from 'react'

export const calls = { subscriptions: [] as string[], stops: [] as string[], active: [] as string[], workspace: [] as string[], availability: [] as string[], roster: [] as number[], reporting: [] as Array<{ name: string; input: Record<string, unknown>; region: string }>, ledger: [] as Record<string, unknown>[], cashAccounts: 0 }
Object.assign(window, { isolationCalls: calls })
export const db = {}
export const useAuth = () => ({ user: { uid: 'admin' }, role: 'admin', accessContext: { accessRole: 'admin' }, authzReady: true, backendMode: 'firebase' })
export const useAuraUiRollout = () => ({ loading: false, isEnabled: () => false })
export const collection = (_db: unknown, path: string) => ({ path })
export const doc = (_db: unknown, ...path: string[]) => ({ path: path.join('/') })
export const query = (reference: { path: string }) => reference
export const where = () => ({})
export const orderBy = () => ({})
export const limit = () => ({})
export function onSnapshot(reference: { path: string }, callback: (value: unknown) => void) {
  calls.subscriptions.push(reference.path)
  calls.active.push(reference.path)
  let active = true
  queueMicrotask(() => { if (active) callback({ docs: [{ id: 'trainer', data: () => ({ name: 'PT Test', status: 'active' }) }], size: 1 }) })
  return () => { if (!active) return; active = false; calls.stops.push(reference.path); calls.active.splice(calls.active.indexOf(reference.path), 1) }
}
const unused = async () => { throw new Error('Unexpected write') }
export const setDoc = unused, deleteDoc = unused, runTransaction = unused, updateDoc = unused
export const createScheduleConfigCommandKey = unused, saveScheduleConfig = unused
export const createStudentCommandKey = unused, updateStudentProfile = unused
export const archiveBranch = unused, createBranchCommandKey = unused, upsertBranch = unused
export const bulkConfirmMySessions = unused, recordMySessionAttendance = unused, reportMySessionAdvanceAbsence = unused
export const requestStudentSessionAddition = unused, requestSessionChange = unused, createStudentCareActivity = unused, saveMyTrainerAvailability = unused
export const getPtTrainerAvailability = async () => { throw new Error('Unexpected managed trainer availability read') }
export const savePtTrainerAvailability = unused
export const useWorkspaceAccountId = () => 'trainer'
export const useVietnamDay = () => '2026-10-24'
export function useWorkspaceSync(options: { scopeKey: string; refresh: () => Promise<void> }) {
  useEffect(() => { void options.refresh() }, [options.scopeKey])
  return { error: false, accept: () => {}, failed: () => {}, retry: () => void options.refresh() }
}
export async function getMyTrainerWorkspace(section: string) {
  calls.workspace.push(section)
  return { scope: { tabs: { students: true, schedule: true, requests: true }, counts: { primaryStudents: 0, secondaryStudents: 0, teachingSessions: 0 }, branchIds: [] }, students: section === 'schedule' ? (window as any).legacyInitialRoster || [] : [], sessions: section === 'schedule' ? (window as any).isolationSessions || [] : [], branches: [], requests: [{ id: 'request', studentId: 'student', studentName: 'Minh Nguyệt', type: 'cancel', status: 'pending', originalDate: '2026-10-24', originalHour: 18, reason: 'Test' }] }
}
export async function listMyAssignedStudents(limit: number) {
  calls.roster.push(limit)
  if ((window as any).deferRoster) return new Promise((resolve) => { (window as any).finishRoster = resolve })
  return { students: [], hasMore: (window as any).rosterHasMore || false }
}
export async function getMyTrainerAvailability(weekId?: string) {
  calls.availability.push(weekId || 'recurring')
  const result = { trainerName: 'PT Test', weekId: weekId || null, availableSlots: ['T2-6'], baseAvailableSlots: ['T2-6'], offDates: [], locked: false, updatedAt: null, availabilityMode: 'configured', availabilityRevision: 1, scheduleConfig: { workingDays: ['T2', 'T3'], workingHours: [6, 7] } }
  if ((window as any).deferAvailability) return new Promise((resolve) => {
    const pending = (window as any).pendingAvailability ||= {}
    pending[weekId || 'recurring'] = (name: string) => resolve({ ...result, trainerName: name })
  })
  return result
}
