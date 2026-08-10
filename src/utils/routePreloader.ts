import type { ViewId } from '../types'

const preloadedRoutes = new Set<string>()

export function prefetchRoute(view: ViewId) {
  if (preloadedRoutes.has(view)) return
  preloadedRoutes.add(view)

  switch (view) {
    case 'courses':
      import('../pages/student/CoursesPage').catch(() => {})
      break
    case 'nutrition':
      import('../pages/student/NutritionPage').catch(() => {})
      break
    case 'progress':
      import('../pages/student/ProgressPage').catch(() => {})
      break
    case 'schedule':
      import('../pages/student/SchedulePage').catch(() => {})
      break
    case 'profile':
      import('../pages/student/ProfilePage').catch(() => {})
      break
    case 'workout':
      import('../pages/student/WorkoutPage').catch(() => {})
      break
    case 'admin-dashboard':
      import('../pages/admin/AdminDashboard').catch(() => {})
      break
    case 'admin-courses':
      import('../pages/admin/AdminCoursesPage').catch(() => {})
      break
    case 'admin-students':
      import('../pages/admin/AdminStudentsPage').catch(() => {})
      break
    case 'admin-programs':
      import('../pages/admin/AdminProgramsPage').catch(() => {})
      break
    case 'admin-roles':
      import('../pages/admin/AdminRolesPage').catch(() => {})
      break
    case 'admin-nutrition-reviews':
      import('../pages/admin/AdminNutritionReviewsPage').catch(() => {})
      break
    case 'admin-notifications':
      import('../pages/admin/AdminNotificationsPage').catch(() => {})
      break
    default:
      break
  }
}

export function idlePrefetchStudentRoutes() {
  const studentViews: ViewId[] = ['courses', 'nutrition', 'progress', 'schedule', 'profile', 'workout']
  const scheduleTask = typeof window !== 'undefined' && 'requestIdleCallback' in window
    ? (window as any).requestIdleCallback
    : (cb: () => void) => setTimeout(cb, 1500)

  scheduleTask(() => {
    studentViews.forEach((view, idx) => {
      setTimeout(() => prefetchRoute(view), idx * 300)
    })
  })
}

export function idlePrefetchAdminRoutes() {
  const adminViews: ViewId[] = ['admin-dashboard', 'admin-courses', 'admin-students', 'admin-programs', 'admin-nutrition-reviews', 'admin-roles', 'admin-notifications']
  const scheduleTask = typeof window !== 'undefined' && 'requestIdleCallback' in window
    ? (window as any).requestIdleCallback
    : (cb: () => void) => setTimeout(cb, 2000)

  scheduleTask(() => {
    adminViews.forEach((view, idx) => {
      setTimeout(() => prefetchRoute(view), idx * 300)
    })
  })
}

