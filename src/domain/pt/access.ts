import type { AccessContext } from '../../identity/access'
import type { UserProfile } from '../../types'

export type LegacyPtScheduleWorkspace = 'admin' | 'trainer' | 'student' | 'forbidden'

/**
 * The legacy scheduler still reads admin-only collections. Production access
 * therefore requires the canonical Identity v2 capability and a matching
 * elevated access role. Trainer and learner scheduling use their actor-scoped
 * pages instead of falling through this component.
 */
export function resolveLegacyPtScheduleWorkspace(
  profile: UserProfile | null | undefined,
  accessContext: AccessContext | null | undefined,
  backendMode: 'demo' | 'firebase',
): LegacyPtScheduleWorkspace {
  if (!profile) return 'forbidden'

  if (backendMode === 'demo') {
    if (profile.role === 'admin' || profile.role === 'super_admin') return 'admin'
    if (profile.role === 'trainer') return 'trainer'
    if (profile.role === 'student' || profile.role === 'user') return 'student'
    return 'forbidden'
  }

  if (!accessContext || accessContext.status !== 'active') return 'forbidden'
  const elevatedRole = accessContext.accessRole === 'admin' || accessContext.accessRole === 'super_admin'
  if (elevatedRole && accessContext.capabilities.includes('pt.operations.manage')) return 'admin'
  return 'forbidden'
}

export function isOperationsAdmin(
  profile: UserProfile | null | undefined,
  accessContext: AccessContext | null | undefined,
  backendMode: 'demo' | 'firebase',
): boolean {
  return resolveLegacyPtScheduleWorkspace(profile, accessContext, backendMode) === 'admin'
}
