import { useSyncExternalStore } from 'react'
type Owner = { uid: string } | null
const subscribers = new Set<() => void>()
const authSubscribers = new Set<(owner: Owner) => void>()
export const firebaseAuth = { currentUser: { uid: 'admin-a' } as Owner }
let auth = { user: { uid: 'admin-a' } as Owner, role: 'admin', accessContext: { uid: 'admin-a', accessRole: 'admin', status: 'active', authzVersion: 1, branchIds: ['a'], positions: [], capabilities: ['system.manage'] }, authzReady: true, backendMode: 'firebase' }
const subscribe = (callback: () => void) => { subscribers.add(callback); return () => { subscribers.delete(callback) } }
export const useAuth = () => useSyncExternalStore(subscribe, () => auth)
export const useAuraUiRollout = () => ({ loading: false, isEnabled: () => false })
export function onAuthStateChanged(_auth: unknown, callback: (owner: Owner) => void) {
  authSubscribers.add(callback); callback(firebaseAuth.currentUser)
  return () => { authSubscribers.delete(callback) }
}
type Listener = { path: string; active: boolean; success: (value: any) => void; failure: (error: unknown) => void }
export const state = {
  listeners: [] as Listener[], snapshot: {} as Record<string, any>, renders: [] as Record<string, any>[], refresh: () => {},
  savedRefresh: () => {}, forceProviderRender: () => {}, effectRuns: 0,
  authState() { return { actualUid: firebaseAuth.currentUser?.uid ?? null, contextUid: auth.user?.uid ?? null, authzReady: auth.authzReady, authzVersion: auth.accessContext.authzVersion, branchIds: auth.accessContext.branchIds } },
  saveRefresh() { this.savedRefresh = this.refresh },
  emit(index: number, name: string) {
    // Deliberately deliver a queued callback even after unsubscribe.
    this.listeners[index].success({ docs: [{ id: name, data: () => ({ name, status: 'active' }) }], size: 1 })
  },
  fail(index: number, code = 'unavailable') { this.listeners[index].failure({ code, message: 'fixture' }) },
  empty(index: number) { this.listeners[index].success({ docs: [], size: 0 }) },
  config(index: number, revision: number) { this.listeners[index].success({ exists: () => true, data: () => ({ revision }) }) },
  owner(uid: string | null, publishContext = true) {
    firebaseAuth.currentUser = uid ? { uid } : null
    authSubscribers.forEach(callback => callback(firebaseAuth.currentUser))
    if (publishContext) this.context(uid)
  },
  context(uid: string | null) {
    auth = { ...auth, user: uid ? { uid } : null, accessContext: { ...auth.accessContext, uid: uid || '' } }
    subscribers.forEach(callback => callback())
  },
  access(patch: Record<string, unknown>) {
    auth = { ...auth, accessContext: { ...auth.accessContext, ...patch } }
    subscribers.forEach(callback => callback())
  },
  ready(value: boolean) { auth = { ...auth, authzReady: value }; subscribers.forEach(callback => callback()) },
  rerender() { auth = { ...auth, user: auth.user ? { ...auth.user } : null, accessContext: { ...auth.accessContext, branchIds: [...auth.accessContext.branchIds], positions: [...auth.accessContext.positions], capabilities: [...auth.accessContext.capabilities] } }; subscribers.forEach(callback => callback()) },
  route(name: string) { location.hash = `#/${name}` },
}
declare global { interface Window { __legacy: typeof state } }
window.__legacy = state
export const db = {}
export const collection = (_db: unknown, path: string) => ({ path })
export const doc = (_db: unknown, ...path: string[]) => ({ path: path.join('/') })
export const query = (reference: { path: string }) => reference
export const where = () => ({}), orderBy = () => ({}), limit = () => ({})
export function onSnapshot(reference: { path: string }, success: Listener['success'], failure: Listener['failure']) {
  const entry = { path: reference.path, active: true, success, failure }; state.listeners.push(entry)
  return () => { entry.active = false }
}
const unused = async () => { throw new Error('Unexpected write') }
export const setDoc = unused, deleteDoc = unused, runTransaction = unused, updateDoc = unused
export const createScheduleConfigCommandKey = unused, saveScheduleConfig = unused
export const createStudentCommandKey = unused, updateStudentProfile = unused
export const archiveBranch = unused, createBranchCommandKey = unused, upsertBranch = unused
export const mutateStudent360Contract = unused
