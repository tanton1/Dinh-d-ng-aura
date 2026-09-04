import type { Permission } from '../config/permissions'
import type { ViewId } from '../types'

export const adminViews: ViewId[] = [
  'admin-dashboard',
  'admin-loyalty',
  'admin-today-sessions',
  'admin-pt-students',
  'admin-pt-schedule',
  'admin-training-history',
  'admin-pt-workouts',
  'admin-trainer-quality',
  'admin-renewals',
  'admin-report',
  'admin-finance',
  'admin-hr',
  'admin-payroll',
  'admin-packages',
  'admin-quotes',
  'admin-schedule-settings',
  'admin-courses',
  'admin-course-editor',
  'admin-academy-students',
  'admin-programs',
  'admin-students',
  'admin-roles',
  'admin-nutrition-reviews',
  'admin-eat-clean',
  'admin-notifications',
]

const validViews: ViewId[] = [
  'home',
  'aura-club',
  'courses',
  'course-detail',
  'schedule',
  'student-availability',
  'pt-workout',
  'nutrition',
  'eat-clean',
  'trainer-portal',
  'sales-portal',
  'staff-dashboard',
  'staff-students',
  'staff-schedule',
  'staff-workouts',
  'staff-availability',
  'staff-requests',
  'staff-nutrition-reviews',
  'staff-quotes',
  'staff-renewals',
  'staff-payroll',
  'student-360',
  'progress',
  'progress-photo-studio',
  'profile',
  'workout',
  'delivery',
  ...adminViews,
]

export const adminViewPermissions: Partial<Record<ViewId, Permission>> = {
  'admin-dashboard': 'dashboard.view',
  'admin-loyalty': 'dashboard.view',
  'admin-today-sessions': 'dashboard.view',
  'admin-pt-students': 'student.view_assigned',
  'admin-pt-schedule': 'dashboard.view',
  'admin-training-history': 'analytics.view_all',
  'admin-pt-workouts': 'program.view',
  'admin-trainer-quality': 'analytics.view_all',
  'admin-renewals': 'dashboard.view',
  'admin-report': 'analytics.view_all',
  'admin-finance': 'analytics.view_all',
  'admin-hr': 'team.view',
  'admin-payroll': 'analytics.view_assigned',
  'admin-packages': 'dashboard.view',
  'admin-quotes': 'dashboard.view',
  'admin-schedule-settings': 'dashboard.view',
  'admin-courses': 'course.view',
  'admin-course-editor': 'course.edit',
  'admin-academy-students': 'enrollment.manage',
  'admin-programs': 'program.view',
  'admin-students': 'student.view_assigned',
  'admin-roles': 'team.view',
  'admin-nutrition-reviews': 'student.view_assigned',
  'admin-eat-clean': 'eat_clean.manage',
  'admin-notifications': 'team.view',
}

export interface AuraRoute {
  view: ViewId
  courseId: string | null
  lessonId: string | null
  studentId: string | null
  source: Student360Source | null
  eatCleanScreen: 'store' | 'meal' | 'cart' | 'checkout' | 'orders' | 'order' | 'success'
  mealId: string | null
  orderId: string | null
  loyaltyTab: 'rewards' | 'missions' | 'levels' | 'referral' | 'history'
}

const eatCleanScreens = new Set<AuraRoute['eatCleanScreen']>(['store', 'meal', 'cart', 'checkout', 'orders', 'order', 'success'])
const loyaltyTabs = new Set<AuraRoute['loyaltyTab']>(['rewards', 'missions', 'levels', 'referral', 'history'])

/**
 * Routes retired from the app navigation remain canonicalized so links shared
 * before the cleanup never lead to a blank page. The underlying data is kept
 * intact; only duplicate surfaces were removed.
 */
const retiredRouteRedirects: Record<string, { view: ViewId; hash: string }> = {
  'trainer-portal': { view: 'staff-students', hash: '#/staff-students' },
  'sales-portal': { view: 'staff-quotes', hash: '#/staff-quotes' },
  'schedule-pt': { view: 'schedule', hash: '#/schedule' },
  'food-database': { view: 'nutrition', hash: '#/nutrition' },
  'dish-collection': { view: 'nutrition', hash: '#/nutrition' },
  'meal-plan': { view: 'nutrition', hash: '#/nutrition?section=plan' },
  'admin-workout-plans': { view: 'admin-programs', hash: '#/admin-programs' },
  'admin-meal-plans': { view: 'admin-eat-clean', hash: '#/admin-eat-clean' },
  // These routes used to render duplicate workspaces. Keep old bookmarks
  // working while directing navigation, permission checks and prefetching to
  // one canonical screen.
  'admin-report': { view: 'admin-dashboard', hash: '#/admin-dashboard' },
  'admin-roles': { view: 'admin-hr', hash: '#/admin-hr' },
}

export type Student360Source = 'staff-students' | 'admin-pt-students'

const student360Sources = new Set<Student360Source>(['staff-students', 'admin-pt-students'])

export function resolveSupportedView(view: ViewId) {
  return retiredRouteRedirects[view]?.view ?? view
}

export function canonicalRouteHash(view: ViewId, courseId?: string | null, lessonId?: string | null) {
  return retiredRouteRedirects[view]?.hash ?? routeHash(view, courseId, lessonId)
}

/**
 * Canonicalize retired hashes independently from React. Hash navigation can
 * happen while a lazy route is rendering, before (or between) component
 * effects. Keeping this operation synchronous ensures old bookmarks always
 * expose their supported URL and lets the React router read one source of
 * truth afterwards.
 */
export function canonicalizeRetiredRouteHash() {
  const rawHash = window.location.hash.replace(/^#\/?/, '')
  const [rawView = 'home'] = rawHash.split('?')
  const retiredRoute = retiredRouteRedirects[rawView]
  if (!retiredRoute || window.location.hash === retiredRoute.hash) return false
  window.history.replaceState(null, '', retiredRoute.hash)
  return true
}

export function getCurrentRoute(): AuraRoute {
  canonicalizeRetiredRouteHash()
  const rawHash = window.location.hash.replace(/^#\/?/, '')
  const [rawView = 'home', rawQuery = ''] = rawHash.split('?')
  const view = validViews.includes(rawView as ViewId) ? rawView as ViewId : 'home'
  const params = new URLSearchParams(rawQuery)
  return {
    view,
    courseId: params.get('courseId'),
    lessonId: params.get('lessonId'),
    studentId: params.get('studentId'),
    source: student360Sources.has(params.get('source') as Student360Source)
      ? params.get('source') as Student360Source
      : null,
    eatCleanScreen: eatCleanScreens.has(params.get('screen') as AuraRoute['eatCleanScreen'])
      ? params.get('screen') as AuraRoute['eatCleanScreen']
      : 'store',
    mealId: params.get('mealId'),
    orderId: params.get('orderId'),
    loyaltyTab: loyaltyTabs.has(params.get('tab') as AuraRoute['loyaltyTab'])
      ? params.get('tab') as AuraRoute['loyaltyTab']
      : 'rewards',
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
    && left.studentId === right.studentId
    && left.source === right.source
    && left.eatCleanScreen === right.eatCleanScreen
    && left.mealId === right.mealId
    && left.orderId === right.orderId
    && left.loyaltyTab === right.loyaltyTab
}

export function student360RouteHash(studentId: string, source: Student360Source) {
  const params = new URLSearchParams({ studentId, source })
  return `#/student-360?${params.toString()}`
}

export function eatCleanRouteHash(
  screen: AuraRoute['eatCleanScreen'] = 'store',
  resourceId?: string | null,
) {
  const params = new URLSearchParams()
  if (screen !== 'store') params.set('screen', screen)
  if (screen === 'meal' && resourceId) params.set('mealId', resourceId)
  if (['order', 'success'].includes(screen) && resourceId) params.set('orderId', resourceId)
  const query = params.toString()
  return `#/eat-clean${query ? `?${query}` : ''}`
}
