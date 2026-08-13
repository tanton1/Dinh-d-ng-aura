import type { Permission } from '../config/permissions'
import type { ViewId } from '../types'

export const adminViews: ViewId[] = [
  'admin-dashboard',
  'admin-courses',
  'admin-course-editor',
  'admin-academy-students',
  'admin-programs',
  'admin-students',
  'admin-roles',
  'admin-nutrition-reviews',
  'admin-meal-plans',
  'admin-notifications',
]

const validViews: ViewId[] = [
  'home',
  'courses',
  'course-detail',
  'schedule',
  'nutrition',
  'meal-plan',
  'progress',
  'progress-photo-studio',
  'profile',
  'workout',
  ...adminViews,
]

export const adminViewPermissions: Partial<Record<ViewId, Permission>> = {
  'admin-dashboard': 'dashboard.view',
  'admin-courses': 'course.view',
  'admin-course-editor': 'course.edit',
  'admin-academy-students': 'enrollment.manage',
  'admin-programs': 'program.view',
  'admin-students': 'student.view_assigned',
  'admin-roles': 'team.view',
  'admin-nutrition-reviews': 'student.view_assigned',
  'admin-meal-plans': 'student.view_assigned',
  'admin-notifications': 'team.view',
}

export interface AuraRoute {
  view: ViewId
  courseId: string | null
  lessonId: string | null
}

export function getCurrentRoute(): AuraRoute {
  const rawHash = window.location.hash.replace(/^#\/?/, '')
  const [rawView = 'home', rawQuery = ''] = rawHash.split('?')
  const view = validViews.includes(rawView as ViewId) ? rawView as ViewId : 'home'
  const params = new URLSearchParams(rawQuery)
  return {
    view,
    courseId: params.get('courseId'),
    lessonId: params.get('lessonId'),
  }
}

export function routeHash(view: ViewId, courseId?: string | null, lessonId?: string | null) {
  const params = new URLSearchParams()
  if (courseId) params.set('courseId', courseId)
  if (lessonId) params.set('lessonId', lessonId)
  const query = params.toString()
  return `#/${view}${query ? `?${query}` : ''}`
}

export function isSameRoute(left: AuraRoute, right: AuraRoute) {
  return left.view === right.view
    && left.courseId === right.courseId
    && left.lessonId === right.lessonId
}
