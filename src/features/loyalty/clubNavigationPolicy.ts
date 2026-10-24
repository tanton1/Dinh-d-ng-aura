import type { AppMode, UserRole, ViewId } from '../../types'

/** PT, personal and learner workspaces keep their existing application dock. */
export function usesClubOperationsDock(view: ViewId, role: UserRole, mode: AppMode, isStaffWorkspace: boolean) {
  return view === 'admin-loyalty' && mode === 'admin' && !isStaffWorkspace && (role === 'admin' || role === 'super_admin')
}
