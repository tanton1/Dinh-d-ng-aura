import { useSyncExternalStore } from 'react'
const listeners = new Set<() => void>()
const access = { uid: 'admin-a', authzVersion: 1, status: 'active', accessRole: 'admin', branchIds: ['branch-a', 'branch-b'], capabilities: ['dashboard.view', 'payroll.operations.manage'], positions: [] as string[] }
let snapshot = { user: { uid: 'admin-a' }, accessContext: access, authzReady: true }
export function changeAuth(uid: string, authzVersion = 1) {
  snapshot = { user: { uid }, accessContext: { ...access, uid, authzVersion }, authzReady: true }
  listeners.forEach((listener) => listener())
}
export function changeAuthority(changes: { userUid?: string; accessUid?: string; status?: string; accessRole?: string; branchIds?: string[]; capabilities?: string[]; authzReady?: boolean }) {
  snapshot = { user: { uid: changes.userUid ?? snapshot.user.uid }, authzReady: changes.authzReady ?? snapshot.authzReady,
    accessContext: { ...snapshot.accessContext,
      uid: changes.accessUid ?? snapshot.accessContext.uid,
      status: changes.status ?? snapshot.accessContext.status,
      accessRole: changes.accessRole ?? snapshot.accessContext.accessRole,
      branchIds: changes.branchIds ?? snapshot.accessContext.branchIds,
      capabilities: changes.capabilities ?? snapshot.accessContext.capabilities,
    },
  }
  listeners.forEach((listener) => listener())
}
export function useAuth() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => snapshot)
}
export const useAuraUiSurface = () => false
