import type { ViewId } from '../types'

const preloadedRoutes = new Set<ViewId>()

const routeImporters: Partial<Record<ViewId, () => Promise<unknown>>> = {
  courses: () => import('../pages/student/CoursesPage'),
  'course-detail': () => import('../pages/student/CourseDetailPage'),
  nutrition: () => import('../pages/student/NutritionPage'),
  'meal-plan': () => import('../pages/student/MealPlanPage'),
  progress: () => import('../pages/student/ProgressPage'),
  'progress-photo-studio': () => import('../pages/student/ProgressPhotoStudio'),
  schedule: () => import('../pages/student/SchedulePage'),
  profile: () => import('../pages/student/ProfilePage'),
  workout: () => import('../pages/student/WorkoutPage'),
  'admin-dashboard': () => import('../pages/admin/AdminDashboard'),
  'admin-courses': () => import('../pages/admin/AdminCoursesPage'),
  'admin-course-editor': () => import('../pages/admin/CourseEditorPage'),
  'admin-academy-students': () => import('../pages/admin/AdminAcademyStudentsPage'),
  'admin-students': () => import('../pages/admin/AdminStudentsPage'),
  'admin-programs': () => import('../pages/admin/AdminProgramsPage'),
  'admin-meal-plans': () => import('../pages/admin/AdminMealPlansPage'),
  'admin-nutrition-reviews': () => import('../pages/admin/AdminNutritionReviewsPage'),
  'admin-roles': () => import('../pages/admin/AdminRolesPage'),
  'admin-notifications': () => import('../pages/admin/AdminNotificationsPage'),
}

type NetworkInformation = {
  saveData?: boolean
  effectiveType?: string
}

function shouldAvoidPrefetch() {
  if (typeof navigator === 'undefined') return true
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection
  return connection?.saveData === true || connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g'
}

export function prefetchRoute(view: ViewId) {
  const importer = routeImporters[view]
  if (!importer || preloadedRoutes.has(view) || shouldAvoidPrefetch()) return

  preloadedRoutes.add(view)
  void importer().catch(() => {
    preloadedRoutes.delete(view)
  })
}
