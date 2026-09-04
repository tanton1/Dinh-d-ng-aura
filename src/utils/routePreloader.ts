import type { ViewId } from '../types'

const preloadedRoutes = new Set<ViewId>()

const routeImporters: Partial<Record<ViewId, () => Promise<unknown>>> = {
  'aura-club': () => import('../features/loyalty/AuraClubPage'),
  courses: () => import('../pages/student/CoursesPage'),
  'course-detail': () => import('../pages/student/CourseDetailPage'),
  nutrition: () => import('../pages/student/NutritionPage'),
  'eat-clean': () => import('../features/eat-clean/pages/EatCleanPage'),
  progress: () => import('../pages/student/ProgressPage'),
  'progress-photo-studio': () => import('../pages/student/ProgressPhotoStudio'),
  schedule: () => import('../pages/student/SchedulePage'),
  'student-availability': () => import('../pages/student/StudentAvailabilityPage'),
  'pt-workout': () => import('../pages/student/StudentPtWorkoutPage'),
  profile: () => import('../pages/student/ProfilePage'),
  workout: () => import('../pages/student/WorkoutPage'),
  'trainer-portal': () => import('../pages/operations/TrainerPortalV2'),
  'sales-portal': () => import('../pages/operations/SalesPortalV2'),
  'staff-dashboard': () => import('../pages/operations/StaffDashboardPage'),
  'staff-students': () => import('../pages/operations/TrainerPortalV2'),
  'staff-schedule': () => import('../pages/operations/StaffScheduleWorkspace'),
  'staff-workouts': () => import('../pages/operations/PtWorkoutWorkspacePage'),
  'staff-availability': () => import('../pages/operations/StaffScheduleWorkspace'),
  'staff-requests': () => import('../pages/operations/StaffScheduleWorkspace'),
  'staff-nutrition-reviews': () => import('../features/nutrition-review/NutritionReviewWorkspace'),
  'staff-quotes': () => import('../pages/operations/SalesPortalV2'),
  'staff-renewals': () => import('../components/admin/pt/ContractRenewals'),
  'staff-payroll': () => import('../pages/operations/StaffPayrollPage'),
  'student-360': () => import('../features/student-360/Student360Page'),
  'admin-pt-students': () => import('../components/admin/pt/StudentManagement'),
  'admin-pt-schedule': () => Promise.all([
    import('../components/schedule/SchedulerWrapper'),
    import('../components/schedule/BranchScheduleWorkspace'),
  ]),
  'admin-training-history': () => import('../components/admin/pt/TrainingHistoryWorkspace'),
  'admin-pt-workouts': () => import('../pages/operations/PtWorkoutWorkspacePage'),
  'admin-trainer-quality': () => import('../pages/admin/TrainerQualityPage'),
  'admin-renewals': () => import('../components/admin/pt/ContractRenewals'),
  'admin-report': () => import('../pages/admin/AdminDashboard'),
  'admin-finance': () => import('../components/admin/pt/FinanceManagement'),
  'admin-payroll': () => import('../components/admin/pt/TrainerPayroll'),
  'admin-hr': () => import('../pages/admin/AdminRolesPage'),
  'admin-packages': () => import('../components/admin/pt/PackageSettings'),
  'admin-quotes': () => import('../components/admin/pt/QuoteGenerator'),
  'admin-schedule-settings': () => import('../components/admin/pt/ScheduleSettings'),
  delivery: () => import('../features/delivery/DeliveryPage'),
  'admin-dashboard': () => import('../pages/admin/AdminDashboard'),
  'admin-loyalty': () => import('../features/loyalty/AdminLoyaltyPage'),
  'admin-today-sessions': () => import('../pages/admin/AdminTodaySessionsPage'),
  'admin-courses': () => import('../pages/admin/AdminCoursesPage'),
  'admin-course-editor': () => import('../pages/admin/CourseEditorPage'),
  'admin-academy-students': () => import('../pages/admin/AdminAcademyStudentsPage'),
  'admin-students': () => import('../pages/admin/AdminStudentsPage'),
  'admin-programs': () => import('../pages/admin/AdminProgramsPage'),
  'admin-eat-clean': () => import('../features/eat-clean/admin/AdminEatCleanPage'),
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
