type Callback = (snapshot: any) => void
const listeners = new Map<string, Set<{ next: Callback; error: () => void }>>()
const authListeners = new Set<(user: any) => void>()
const state = window as any
state.signalValues ??= {}
state.signalFailures ??= []
state.workspaceCalls ??= []
state.workspaceHidden = false
Object.defineProperty(document, 'hidden', { configurable: true, get: () => state.workspaceHidden })
export const firebaseAuth = { currentUser: { uid: 'account-a' } as { uid: string } | null }
export const firestoreDb = {}
export const doc = (_db: unknown, path: string) => path
export function onAuthStateChanged(_auth: unknown, callback: (user: any) => void) {
  authListeners.add(callback); callback(firebaseAuth.currentUser)
  return () => authListeners.delete(callback)
}
const snapshot = (path: string, cached = false) => ({ metadata: { fromCache: cached, hasPendingWrites: false }, data: () => state.signalValues[path] })
export function onSnapshot(path: string, _options: unknown, next: Callback, error: () => void) {
  const entry = { next, error }
  if (!listeners.has(path)) listeners.set(path, new Set())
  listeners.get(path)!.add(entry)
  queueMicrotask(() => {
    if (!listeners.get(path)?.has(entry)) return
    if (state.signalFailures.includes(path)) { listeners.get(path)!.delete(entry); error() }
    else if (state.initialSignalValues?.[path]) next({ metadata: { fromCache: false, hasPendingWrites: false }, data: () => state.initialSignalValues[path] })
    else next(snapshot(path))
  })
  return () => { listeners.get(path)?.delete(entry) }
}
state.workspaceEmit = (path: string, values: Record<string, string>, cached = false) => {
  if (!cached) state.signalValues[path] = { ...state.signalValues[path], ...values }
  const value = { metadata: { fromCache: cached, hasPendingWrites: false }, data: () => cached ? values : state.signalValues[path] }
  listeners.get(path)?.forEach((listener) => listener.next(value))
}
state.workspaceFail = (path: string) => { state.signalFailures.push(path); const entries = [...(listeners.get(path) || [])]; listeners.get(path)?.clear(); entries.forEach((entry) => entry.error()) }
state.workspaceAccount = (uid: string) => { firebaseAuth.currentUser = uid ? { uid } : null; authListeners.forEach((callback) => callback(firebaseAuth.currentUser)) }
state.workspaceActivePaths = () => [...listeners].filter(([, value]) => value.size).map(([path]) => path)
export function currentSync(domain: string) {
  const account = firebaseAuth.currentUser?.uid || ''
  const field = domain + 'Version'
  const userVersion = state.signalValues[`users/${account}/workspaceChanges/operations`]?.[field] || '0'
  const policyVersion = state.signalValues['workspaceChanges/policy']?.[field] || '0'
  const branchVersions = domain === 'trainerWorkspace' ? { branch: state.signalValues['workspaceBranchChanges/branch']?.[field] || '0' } : {}
  return { version: JSON.stringify([account, userVersion, policyVersion, branchVersions]), userVersion, policyVersion, branchVersions }
}
