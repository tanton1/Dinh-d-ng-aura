import { useSyncExternalStore } from 'react'

const contextSubscribers = new Set<() => void>()
const ownerSubscribers = new Set<() => void>()
export const auth = { currentUser: { uid: 'actor-a' } as { uid: string } | null }
export const firebaseAuth = auth
let context = {
  user: auth.currentUser, profile: { uid: 'actor-a', role: 'admin', authzVersion: 1, disabled: false, displayName: 'Actor A' },
  role: 'admin', authzReady: true, backendMode: 'firebase',
  accessContext: { uid: 'actor-a', accessRole: 'admin', status: 'active', authzVersion: 1, branchIds: ['north', 'south'], positions: ['trainer_pt', 'branch_manager'], capabilities: ['pt.operations.manage', 'coach.workspace.view'] },
}
const subscribe = (callback: () => void) => { contextSubscribers.add(callback); return () => { contextSubscribers.delete(callback) } }
export function useAuth() { return useSyncExternalStore(subscribe, () => context) }
export function onAuthStateChanged(_auth: unknown, callback: () => void) {
  ownerSubscribers.add(callback)
  callback()
  return () => { ownerSubscribers.delete(callback) }
}
type Pending = { kind: 'overview' | 'projection'; studentId: string; owner: string | null; resolve: (value: any) => void; reject: (error: Error) => void }
export const state = {
  pending: [] as Pending[], navigation: [] as unknown[][], telemetry: [] as unknown[],
  contractCallbacks: [] as Array<() => Promise<void>>, go: (_id: string) => {}, unmount: () => {},
  afterUnmountCallback: null as (() => Promise<void>) | null,
  setOwner(uid: string | null, updateContext = true) {
    auth.currentUser = uid ? { uid } : null
    ownerSubscribers.forEach(callback => callback())
    if (updateContext) this.setContext({ user: auth.currentUser, profile: { ...context.profile, uid }, accessContext: { ...context.accessContext, uid } })
  },
  setContext(patch: any) { context = { ...context, ...patch }; contextSubscribers.forEach(callback => callback()) },
  setAccess(patch: any) { this.setContext({ accessContext: { ...context.accessContext, ...patch } }) },
  equivalentContext() {
    this.setContext({ user: { ...context.user }, profile: { ...context.profile, displayName: 'Display-only change' }, accessContext: { ...context.accessContext, branchIds: [...context.accessContext.branchIds].reverse(), capabilities: [...context.accessContext.capabilities].reverse(), positions: [...context.accessContext.positions].reverse() } })
  },
  resolve(index: number, label?: string) {
    const pending = this.pending[index]
    if (!pending) throw Error(`Missing pending request ${index}`)
    pending.resolve(pending.kind === 'overview' ? overview(pending.studentId, label) : {})
  },
  reject(index: number, code = 'permission-denied') { this.pending[index].reject(Object.assign(new Error(`Old ${code}`), { code: `functions/${code}` })) },
}
Object.assign(window, { student360: state })
function deferred(kind: Pending['kind'], studentId: string) {
  return new Promise<any>((resolve, reject) => state.pending.push({ kind, studentId, owner: auth.currentUser?.uid ?? null, resolve, reject }))
}
export function getStudent360Overview(studentId: string) { return deferred('overview', studentId) }
export function refreshStudent360Projection(studentId: string) { return deferred('projection', studentId) }
export function overview(studentId: string, label = `Learner ${studentId}`) {
  return {
    studentId, generatedAt: '2026-10-30T12:00:00Z',
    permissions: { scope: 'system', canManageContract: true, canManageCare: true, canViewFinancialAmounts: true, canRefreshProjection: true },
    identity: { id: studentId, name: label, phone: '0900000000', status: 'active', goals: [] },
    assignments: { branchId: 'north', branchName: 'North', trainerIds: [], trainerNames: [], nutritionCoachIds: [], nutritionCoachNames: [], salesIds: [], salesNames: [] },
    contract: null, schedule: { requiredSessions: 0, bookedSessions: 0, sessions: [], availability: { slots: [] } },
    attendance: { rate28Days: null }, training: { program: null }, nutrition: {}, progress: null, renewal: null,
    health: { score: 0, status: 'stable', confidence: 'low', components: [] },
    nextActions: [], alerts: [], dataQuality: [], cache: { hit: true, stale: false },
  }
}
export function useAuraUiSurface() { return true }
export async function createStudentCareActivity() { throw Error('Unexpected write in overview fixture') }
export async function getStudent360NutritionActivityDetail() { throw Error('Unexpected nutrition read in overview fixture') }
export async function getStudent360ProgressPhotos() { return { photos: [], hasMore: false, nextCursor: null } }
export async function listStudent360Timeline() { return { events: [], hasMore: false, nextCursor: null } }
export async function listStudentTrainingHistory() { return { rows: [], hasMore: false, nextCursor: null } }
export async function getStudentLoyaltySummary() { return { account: null } }
export async function trackProductEvent(...args: unknown[]) { state.telemetry.push(args) }
