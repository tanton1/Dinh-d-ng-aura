import type { UserRole } from '../types'

export type Permission =
  | 'dashboard.view'
  | 'course.view'
  | 'course.create'
  | 'course.edit'
  | 'course.submit'
  | 'course.review'
  | 'course.publish'
  | 'course.archive'
  | 'course.delete'
  | 'course.media.upload'
  | 'program.view'
  | 'program.create'
  | 'program.edit'
  | 'program.submit'
  | 'program.publish'
  | 'program.delete'
  | 'exercise.view'
  | 'exercise.manage'
  | 'student.view_assigned'
  | 'student.view_all'
  | 'student.manage'
  | 'enrollment.manage'
  | 'analytics.view_assigned'
  | 'analytics.view_all'
  | 'team.view'
  | 'role.assign'
  | 'role.assign_super_admin'
  | 'audit.view'
  | 'system.manage'
  | 'eat_clean.manage'
  | 'eat_clean.deliver'

const allPermissions = [
  'dashboard.view',
  'course.view',
  'course.create',
  'course.edit',
  'course.submit',
  'course.review',
  'course.publish',
  'course.archive',
  'course.delete',
  'course.media.upload',
  'program.view',
  'program.create',
  'program.edit',
  'program.submit',
  'program.publish',
  'program.delete',
  'exercise.view',
  'exercise.manage',
  'student.view_assigned',
  'student.view_all',
  'student.manage',
  'enrollment.manage',
  'analytics.view_assigned',
  'analytics.view_all',
  'team.view',
  'role.assign',
  'role.assign_super_admin',
  'audit.view',
  'system.manage',
  'eat_clean.manage',
  'eat_clean.deliver',
] as const satisfies readonly Permission[]

export const rolePermissions = {
  student: [
    'course.view',
    'program.view',
    'exercise.view',
  ],
  coach: [
    'dashboard.view',
    'program.view',
    'program.create',
    'program.edit',
    'program.submit',
    'exercise.view',
    'exercise.manage',
    'student.view_assigned',
    'analytics.view_assigned',
  ],
  editor: [
    'dashboard.view',
    'course.view',
    'course.create',
    'course.edit',
    'course.submit',
    'course.media.upload',
    'analytics.view_assigned',
  ],
  shipper: [
    'eat_clean.deliver',
  ],
  admin: [
    'dashboard.view',
    'course.view',
    'course.create',
    'course.edit',
    'course.submit',
    'course.review',
    'course.publish',
    'course.archive',
    'course.delete',
    'course.media.upload',
    'program.view',
    'program.create',
    'program.edit',
    'program.submit',
    'program.publish',
    'program.delete',
    'exercise.view',
    'exercise.manage',
    'student.view_assigned',
    'student.view_all',
    'student.manage',
    'enrollment.manage',
    'analytics.view_assigned',
    'analytics.view_all',
    'team.view',
    'role.assign',
    'audit.view',
    'eat_clean.manage',
  ],
  trainer: [
    'dashboard.view',
    'program.view',
    'program.create',
    'program.edit',
    'program.submit',
    'exercise.view',
    'exercise.manage',
    'student.view_assigned',
    'analytics.view_assigned',
  ],
  sales: [
    'dashboard.view',
    'student.view_assigned',
    'analytics.view_assigned',
  ],
  manager: [
    'dashboard.view',
    'course.view',
    'program.view',
    'exercise.view',
    'student.view_assigned',
    'student.view_all',
    'student.manage',
    'enrollment.manage',
    'analytics.view_all',
    'team.view',
    'eat_clean.manage',
  ],
  user: [
    'course.view',
    'program.view',
    'exercise.view',
  ],
  super_admin: allPermissions,
} as const satisfies Record<UserRole, readonly Permission[]>

export function hasPermission(
  role: UserRole | string | null | undefined,
  permission: Permission,
): boolean {
  if (!role) return false
  const permissions = (rolePermissions as Record<string, readonly Permission[]>)[role]
  if (!permissions) return false
  return permissions.includes(permission)
}
