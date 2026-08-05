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
