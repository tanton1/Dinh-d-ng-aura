import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import AppShell from './components/AppShell'
import { normalizeOnboardingProfile } from './onboarding/defaults'
import { hasPermission, type Permission } from './config/permissions'
import { calculateNutritionTargets, canonicalNutritionProfile } from './services/nutritionSyncService'
import { useAuth } from './contexts/AuthContext'
import { useCourses } from './hooks/useCourses'
import { useLearningProgress } from './hooks/useLearningProgress'
import { useDailyNutritionSummary } from './hooks/useDailyNutritionSummary'
import type { NutritionProfileDraft } from './features/nutrition/types'
import type { EatCleanRoute } from './features/eat-clean/types'
import type { ProfileUpdateInput } from './pages/student/ProfilePage'
import type { AiCoachLearningContext } from './services/nutritionService'
import {
  enrollInCourse,
  manageAcademyEnrollment,
  markLessonComplete,
  saveCourseDraft,
  subscribeToAllEnrollments,
  subscribeToAllStudentProgress,
  subscribeToAdminUsers,
  uploadUserAvatar,
  updateUserRole,
} from './services/firebaseService'
import { savePtWorkoutProgram } from './services/ptCoachingProgramService'
import { savePtWorkoutLog } from './services/ptCoachingWorkoutService'
import { trackProductEvent } from './services/analyticsService'
import type {
  AdminStudentDirectoryItem,
  AdminUserRecord,
  AppMode,
  Course,
  CourseAnalytics,
  CourseDraftInput,
  AdminStudentProgress,
  CourseProgress,
  Enrollment,
  ViewId,
  UserRole,
} from './types'
import { flattenCourseLessons, getInitialDemoCompletedLessonIds } from './utils/courseContent'
import ChunkErrorBoundary, { lazyWithRetry } from './components/ChunkErrorBoundary'
import { adminViewPermissions, adminViews, canonicalRouteHash, eatCleanRouteHash, getCurrentRoute, isSameRoute, resolveSupportedView, routeHash, student360RouteHash, type AuraRoute, type Student360Source } from './routing/appRouting'
import { routeCapabilities, type StaffPosition } from './identity/access'
import { toCourseDraft } from './utils/courseDraft'
import { DatabaseProvider } from './contexts/DatabaseContext'
import './styles.css'
import './styles-aura.css'
import './styles-progress.css'
import './styles-ai-coach.css'
import './styles-ui-v4.css'
import { AuraUiRolloutProvider } from './features/ui-rollout/AuraUiRolloutContext'

const AdminAcademyStudentsPage = lazyWithRetry(() => import('./pages/admin/AdminAcademyStudentsPage'))
const Onboarding = lazyWithRetry(() => import('./onboarding/Onboarding'))
const HomePage = lazyWithRetry(() => import('./pages/student/HomePage'))
const AuraClubPage = lazyWithRetry(() => import('./features/loyalty/AuraClubPage'))
const AdminCoursesPage = lazyWithRetry(() => import('./pages/admin/AdminCoursesPage'))
const AdminDashboard = lazyWithRetry(() => import('./pages/admin/AdminDashboard'))
const AdminLoyaltyPage = lazyWithRetry(() => import('./features/loyalty/AdminLoyaltyPage'))
const AdminTodaySessionsPage = lazyWithRetry(() => import('./pages/admin/AdminTodaySessionsPage'))
const TrainerQualityPage = lazyWithRetry(() => import('./pages/admin/TrainerQualityPage'))
const AdminProgramsPage = lazyWithRetry(() => import('./pages/admin/AdminProgramsPage'))
const AdminRolesPage = lazyWithRetry(() => import('./pages/admin/AdminRolesPage'))
const AdminStudentsPage = lazyWithRetry(() => import('./pages/admin/AdminStudentsPage'))
const AdminNutritionReviewsPage = lazyWithRetry(() => import('./pages/admin/AdminNutritionReviewsPage'))
const AdminNotificationsPage = lazyWithRetry(() => import('./pages/admin/AdminNotificationsPage'))
const CourseEditorPage = lazyWithRetry(() => import('./pages/admin/CourseEditorPage'))
const CourseDetailPage = lazyWithRetry(() => import('./pages/student/CourseDetailPage'))
const CoursesPage = lazyWithRetry(() => import('./pages/student/CoursesPage'))
const NutritionPage = lazyWithRetry(() => import('./pages/student/NutritionPage'))
const ProfilePage = lazyWithRetry(() => import('./pages/student/ProfilePage'))
const ProgressPage = lazyWithRetry(() => import('./pages/student/ProgressPage'))
const ProgressPhotoStudio = lazyWithRetry(() => import('./pages/student/ProgressPhotoStudio'))
const SchedulePage = lazyWithRetry(() => import('./pages/student/SchedulePage'))
const StudentAvailabilityPage = lazyWithRetry(() => import('./pages/student/StudentAvailabilityPage'))
const StudentPtWorkoutPage = lazyWithRetry(() => import('./pages/student/StudentPtWorkoutPage'))
const WorkoutPage = lazyWithRetry(() => import('./pages/student/WorkoutPage'))
const EatCleanPage = lazyWithRetry(() => import('./features/eat-clean/EatCleanPage'))
const AdminEatCleanPage = lazyWithRetry(() => import('./features/eat-clean/admin/AdminEatCleanPage'))
const DeliveryPage = lazyWithRetry(() => import('./features/delivery/DeliveryPage'))
const AuraOperationsFrame = lazyWithRetry(() => import('./components/AuraOperationsFrame'))

// Gym PT Operations & Food Database Views
const AdminPTStudentManagement = lazyWithRetry(() => import('./components/admin/pt/StudentManagement'))
const SchedulerWrapper = lazyWithRetry(() => import('./components/schedule/SchedulerWrapper'))
const BranchScheduleWorkspace = lazyWithRetry(() => import('./components/schedule/BranchScheduleWorkspace'))
const TrainingHistoryWorkspace = lazyWithRetry(() => import('./components/admin/pt/TrainingHistoryWorkspace'))
const ContractRenewals = lazyWithRetry(() => import('./components/admin/pt/ContractRenewals'))
const AdminFinanceHub = lazyWithRetry(() => import('./components/admin/pt/AdminFinanceHub'))
const AdminPayroll = lazyWithRetry(() => import('./components/admin/pt/TrainerPayroll'))
const AdminPackageSettings = lazyWithRetry(() => import('./components/admin/pt/PackageSettings'))
const AdminQuoteGenerator = lazyWithRetry(() => import('./components/admin/pt/QuoteGenerator'))
const AdminScheduleSettings = lazyWithRetry(() => import('./components/admin/pt/ScheduleSettings'))
const TrainerPortalV2 = lazyWithRetry(() => import('./pages/operations/TrainerPortalV2'))
const StaffDashboardPage = lazyWithRetry(() => import('./pages/operations/StaffDashboardPage'))
const StaffScheduleWorkspace = lazyWithRetry(() => import('./pages/operations/StaffScheduleWorkspace'))
const SalesPortalV2 = lazyWithRetry(() => import('./pages/operations/SalesPortalV2'))
const StaffNutritionReviewsPage = lazyWithRetry(() => import('./pages/operations/StaffNutritionReviewsPage'))
const StaffPayrollPage = lazyWithRetry(() => import('./pages/operations/StaffPayrollPage'))
const PtWorkoutWorkspacePage = lazyWithRetry(() => import('./pages/operations/PtWorkoutWorkspacePage'))
const Student360Page = lazyWithRetry(() => import('./features/student-360/Student360Page'))


const roleLabels: Record<UserRole, string> = {
  student: 'Học viên',
  coach: 'Huấn luyện viên',
  trainer: 'HLV PT Gym',
  sales: 'Kinh doanh / Sales',
  manager: 'Quản lý Chi nhánh',
  editor: 'Biên tập viên',
  shipper: 'Shipper Eat Clean',
  admin: 'Administrator',
  super_admin: 'Super Administrator',
  user: 'Khách hàng',
}

function legacyStaffPosition(role: UserRole): StaffPosition | null {
  if (role === 'trainer') return 'trainer_pt'
  if (role === 'coach') return 'coach_online'
  if (role === 'sales') return 'sales'
  if (role === 'manager') return 'branch_manager'
  if (role === 'editor') return 'academy_editor'
  if (role === 'shipper') return 'shipper'
  return null
}

function canonicalNutritionGoal(value: unknown): NutritionProfileDraft['goal'] | undefined {
  if (value === 'fat_loss' || value === 'lose-fat') return 'lose-fat'
  if (value === 'muscle_gain' || value === 'gain-muscle') return 'gain-muscle'
  if (value === 'maintain' || value === 'maintenance') return 'maintain'
  return undefined
}

/**
 * Root profile fields are the compatibility source for shared body metrics.
 * Nutrition-only fields stay in nutritionProfile, while this reader presents
 * one consistent object to every nutrition/progress surface during migration.
 */
function resolveCanonicalNutritionProfile(profile: any, localProfile: NutritionProfileDraft | null): NutritionProfileDraft | undefined {
  const base = profile?.nutritionProfile ?? localProfile
  if (!base) return undefined
  const rootGoal = canonicalNutritionGoal(profile?.goals?.[0])
  return {
    ...canonicalNutritionProfile({ ...profile, nutritionProfile: base }),
    ...(rootGoal ? { goal: rootGoal } : {}),
    ...(profile?.heightCm !== null && profile?.heightCm !== undefined ? { heightCm: profile.heightCm } : {}),
    ...(profile?.weightKg !== null && profile?.weightKg !== undefined ? { weightKg: profile.weightKg } : {}),
    ...(profile?.targetWeightDeltaKg !== null && profile?.targetWeightDeltaKg !== undefined ? { targetWeightDeltaKg: profile.targetWeightDeltaKg } : {}),
    ...(profile?.targetTimeframeMonths !== null && profile?.targetTimeframeMonths !== undefined ? { targetTimeframeMonths: profile.targetTimeframeMonths } : {}),
    ...(profile?.targetSpeedPace ? { targetSpeedPace: profile.targetSpeedPace } : {}),
  }
}

const learnerAcademyViews = new Set<ViewId>(['courses', 'course-detail', 'progress'])
const adminAcademyViews = new Set<ViewId>(['admin-courses', 'admin-course-editor', 'admin-academy-students', 'admin-students'])
const adminDirectoryViews = new Set<ViewId>(['admin-academy-students', 'admin-students', 'admin-roles', 'admin-hr', 'admin-notifications'])
const adminAcademyAnalyticsViews = new Set<ViewId>(['admin-courses', 'admin-academy-students', 'admin-students'])

function AuraApplication() {
  const { user, profile, role, accessContext, setPreviewRole, loading, backendMode, signOut, changePassword, hasCapability, authorizationError, authzReady, profileSyncState, saveProfileChanges } = useAuth()
  const canAccessAdmin = hasPermission(role, 'dashboard.view')
  const canManageAcademy = canAccessAdmin && hasPermission(role, 'course.view')
  const canManageCoaching = canAccessAdmin && hasPermission(role, 'program.view')
  const isStaffWorkspace = accessContext?.accessRole === 'staff'
    || ['coach', 'trainer', 'sales', 'manager', 'editor'].includes(role)
  const staffPositions = useMemo<StaffPosition[]>(() => {
    if (accessContext?.positions.length) return accessContext.positions
    const fallback = legacyStaffPosition(role)
    return fallback ? [fallback] : []
  }, [accessContext?.positions, role])
  const [route, setRoute] = useState<AuraRoute>(getCurrentRoute)
  const view = route.view
  const routeRef = useRef(route)
  const editorDirtyRef = useRef(false)
  const courseNoteDirtyRef = useRef(false)
  const [adminPreviewCourseId, setAdminPreviewCourseId] = useState<string | null>(null)
  const [editorDirty, setEditorDirty] = useState(false)
  const [courseNoteDirty, setCourseNoteDirty] = useState(false)
  const [mobileMenu, setMobileMenu] = useState(false)
  const [adminUsers, setAdminUsers] = useState<AdminUserRecord[]>([])
  const [adminUsersLoading, setAdminUsersLoading] = useState(false)
  const [adminEnrollments, setAdminEnrollments] = useState<Enrollment[]>([])
  const [adminStudentProgress, setAdminStudentProgress] = useState<AdminStudentProgress[]>([])
  const [adminCourseAnalytics, setAdminCourseAnalytics] = useState<CourseAnalytics[]>([])
  const [globalSearchQuery, setGlobalSearchQuery] = useState('')
  const [staffStudentFocus, setStaffStudentFocus] = useState<{ id: string; name: string } | null>(null)
  const [localNutritionProfile, setLocalNutritionProfile] = useState<NutritionProfileDraft | null>(null)
  const [forceOnboarding, setForceOnboarding] = useState(false)
  const [localProfile, setLocalProfile] = useState<ProfileUpdateInput | null>(null)
  const [localEnrollmentIds, setLocalEnrollmentIds] = useState<Set<string>>(() => new Set())
  const [demoProgressByCourseId, setDemoProgressByCourseId] = useState<Map<string, CourseProgress>>(() => new Map())
  const learnerAcademyEnabled = Boolean(user) && learnerAcademyViews.has(view)
  const adminAcademyEnabled = Boolean(user) && canManageAcademy && (
    adminAcademyViews.has(view) || (view === 'course-detail' && adminPreviewCourseId !== null)
  )
  const adminDirectoryEnabled = Boolean(user) && adminDirectoryViews.has(view)
  const adminAcademyAnalyticsEnabled = Boolean(user) && adminAcademyAnalyticsViews.has(view)
  const learningData = useLearningProgress(
    user?.uid,
    backendMode === 'firebase' && learnerAcademyEnabled,
  )
  const academyAccessRevision = `${profile?.membership ?? 'free'}:${[...learningData.enrollmentByCourseId.entries()].map(([courseId, enrollment]) => `${courseId}:${enrollment.status}`).sort().join('|')}:${[...localEnrollmentIds].sort().join('|')}`
  const studentCourseData = useCourses(learnerAcademyEnabled, false, academyAccessRevision)
  const adminCourseData = useCourses(adminAcademyEnabled, true)
  const mode: AppMode = view === 'student-360'
    ? route.source === 'admin-pt-students' ? 'admin' : 'student'
    : adminViews.includes(view) ? 'admin' : 'student'
  const effectiveNutritionProfile = resolveCanonicalNutritionProfile(profile, localNutritionProfile)
  const dailyNutrition = useDailyNutritionSummary(
    user?.uid ?? 'demo',
    effectiveNutritionProfile,
    backendMode === 'firebase' && Boolean(user) && view === 'eat-clean',
  )

  useEffect(() => {
    if (backendMode !== 'demo') {
      setLocalNutritionProfile(null)
      return
    }
    // Demo/E2E fixtures are intentionally isolated from the production
    // profile cache contract and are never written back to Firestore.
    try {
      const raw = window.localStorage.getItem(`aura:nutrition-profile:${user?.uid ?? 'demo'}`)
      setLocalNutritionProfile(raw ? JSON.parse(raw) as NutritionProfileDraft : null)
    } catch {
      setLocalNutritionProfile(null)
    }
  }, [backendMode, user?.uid])

  // Onboarding is an explicit full-screen editor launched from Nutrition or
  // Profile. A missing/legacy profile must not replace the app loading screen
  // with the onboarding welcome page during sign-in.
  const showOnboarding = forceOnboarding && role !== 'shipper'

  const saveProfile = async (values: ProfileUpdateInput) => {
    // Only merge the canonical profile in Firebase mode. Local demo/cache
    // values must never overwrite a real profile when the user changes one
    // field (for example notification settings).
    const baseNutritionProfile: Record<string, any> = backendMode === 'firebase'
      ? (profile?.nutritionProfile || {})
      : (localNutritionProfile || profile?.nutritionProfile || {})
    const rawGoal = values.goals?.[0] ?? baseNutritionProfile.goal
    const safeGoal = rawGoal === 'fat_loss' || rawGoal === 'lose-fat'
      ? 'lose-fat'
      : rawGoal === 'muscle_gain' || rawGoal === 'gain-muscle'
        ? 'gain-muscle'
        : rawGoal === 'maintain' || rawGoal === 'maintenance'
          ? 'maintain'
          : undefined

    const mergedProfileData = {
      ...baseNutritionProfile,
      ...values,
      ...(safeGoal ? { goal: safeGoal } : {}),
    } as Record<string, any>

    // Nutrition targets are meaningful only when the minimum profile inputs
    // are present. Do not silently invent height, weight, age or sex.
    const hasCompleteNutritionInputs = [
      mergedProfileData.age,
      mergedProfileData.heightCm,
      mergedProfileData.weightKg,
      mergedProfileData.biologicalSex,
      mergedProfileData.goal,
    ].every((value) => value !== null && value !== undefined && value !== '')
    if (values.targetWeightDeltaKg !== undefined && values.targetWeightDeltaKg !== baseNutritionProfile.targetWeightDeltaKg) {
      mergedProfileData.targetWeightKg = Number(mergedProfileData.weightKg) + Number(values.targetWeightDeltaKg)
    }
    const newTargets = hasCompleteNutritionInputs
      ? calculateNutritionTargets(mergedProfileData as any)
      : null

    const nextNutritionProfile = {
      ...canonicalNutritionProfile(mergedProfileData),
      ...(newTargets ? {
        targetCalories: newTargets.targetCaloriesKcal,
        protein: newTargets.proteinG,
        carbs: newTargets.carbsG,
        fat: newTargets.fatG,
        waterLiters: newTargets.waterLiters,
        steps: newTargets.stepsPerDay,
      } : {}),
    } as any;

    if (backendMode === 'firebase' && user) {
      await saveProfileChanges({
        ...values,
        nutritionProfile: nextNutritionProfile,
        // Keep the shared root fields synchronized while old clients still
        // read them. Nutrition/progress pages use the normalized reader above.
        ...(nextNutritionProfile.heightCm !== undefined ? { heightCm: nextNutritionProfile.heightCm } : {}),
        ...(nextNutritionProfile.weightKg !== undefined ? { weightKg: nextNutritionProfile.weightKg } : {}),
        ...(nextNutritionProfile.targetWeightDeltaKg !== undefined ? { targetWeightDeltaKg: nextNutritionProfile.targetWeightDeltaKg } : {}),
        ...(nextNutritionProfile.targetTimeframeMonths !== undefined ? { targetTimeframeMonths: nextNutritionProfile.targetTimeframeMonths } : {}),
        ...(nextNutritionProfile.targetSpeedPace !== undefined ? { targetSpeedPace: nextNutritionProfile.targetSpeedPace } : {}),
        onboardingCompleted: true,
      })
      return
    }

    setLocalProfile((current) => {
      const next: ProfileUpdateInput = {
        ...current,
        ...values,
        notificationSettings: values.notificationSettings
          ? { ...current?.notificationSettings, ...values.notificationSettings }
          : current?.notificationSettings,
      }
      return next
    })

    setLocalNutritionProfile(nextNutritionProfile)
  }

  useEffect(() => {
    if (!adminDirectoryEnabled || backendMode !== 'firebase' || !hasPermission(role, 'team.view')) {
      setAdminUsersLoading(false)
      return
    }
    setAdminUsersLoading(true)
    return subscribeToAdminUsers(
      (items) => {
        setAdminUsers(items)
        setAdminUsersLoading(false)
      },
      () => setAdminUsersLoading(false),
    )
  }, [adminDirectoryEnabled, backendMode, role])

  useEffect(() => {
    if (!adminAcademyAnalyticsEnabled || backendMode !== 'firebase' || !hasPermission(role, 'analytics.view_all')) return
    return (() => {
      const unsubEnrollments = subscribeToAllEnrollments(
        (items) => setAdminEnrollments(items),
        () => setAdminEnrollments((current) => current),
      )
      const unsubProgress = subscribeToAllStudentProgress(
        (items) => setAdminStudentProgress(items),
        () => setAdminStudentProgress((current) => current),
      )
      return () => {
        unsubEnrollments()
        unsubProgress()
      }
    })()
  }, [adminAcademyAnalyticsEnabled, backendMode, role])

  useEffect(() => {
    if (!user || backendMode !== 'firebase') return
    void trackProductEvent('page_view', {
      view,
      ...(route.courseId ? { courseId: route.courseId } : {}),
    })
  }, [backendMode, route.courseId, user, view])

  useEffect(() => {
    routeRef.current = route
  }, [route])

  useEffect(() => {
    editorDirtyRef.current = editorDirty
  }, [editorDirty])

  useEffect(() => {
    courseNoteDirtyRef.current = courseNoteDirty
  }, [courseNoteDirty])

  useEffect(() => {
    const onHashChange = () => {
      const nextRoute = getCurrentRoute()
      const currentRoute = routeRef.current
      if (isSameRoute(currentRoute, nextRoute)) return
      const unsavedWarning = currentRoute.view === 'admin-course-editor' && editorDirtyRef.current
        ? 'Bạn có thay đổi chưa lưu. Rời trình tạo khóa học và bỏ các thay đổi này?'
        : currentRoute.view === 'course-detail' && courseNoteDirtyRef.current
          ? 'Ghi chú bài học chưa được lưu. Bạn vẫn muốn rời trang này?'
          : null
      if (unsavedWarning && !window.confirm(unsavedWarning)) {
        window.history.replaceState(null, '', routeHash(currentRoute.view, currentRoute.courseId, currentRoute.lessonId))
        return
      }
      if (currentRoute.view === 'admin-course-editor') {
        editorDirtyRef.current = false
        setEditorDirty(false)
      }
      if (currentRoute.view === 'course-detail') {
        courseNoteDirtyRef.current = false
        setCourseNoteDirty(false)
      }
      routeRef.current = nextRoute
      setRoute(nextRoute)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    if (backendMode === 'firebase') {
      setLocalEnrollmentIds(new Set())
      setDemoProgressByCourseId(new Map())
    }
  }, [backendMode, user?.uid])

  const goTo = (next: ViewId, courseId?: string | null, lessonId?: string | null) => {
    const supportedNext = resolveSupportedView(next)
    const capability = routeCapabilities[supportedNext as keyof typeof routeCapabilities]
    if (backendMode === 'firebase' && capability && (!authzReady || !hasCapability(capability))) return
    if (adminViews.includes(supportedNext) && !canAccessAdmin) return
    const requiredPermission = adminViewPermissions[supportedNext]
    if (requiredPermission && !hasPermission(role, requiredPermission)) return
    const nextRoute: AuraRoute = {
      view: supportedNext,
      courseId: courseId ?? null,
      lessonId: lessonId ?? null,
      studentId: null,
      source: null,
      eatCleanScreen: 'store',
      mealId: null,
      orderId: null,
      loyaltyTab: 'rewards',
    }
    const routeChanges = !isSameRoute(route, nextRoute)
    const unsavedWarning = route.view === 'admin-course-editor' && editorDirty
      ? 'Bạn có thay đổi chưa lưu. Rời trình tạo khóa học và bỏ các thay đổi này?'
      : route.view === 'course-detail' && courseNoteDirty
        ? 'Ghi chú bài học chưa được lưu. Bạn vẫn muốn rời trang này?'
        : null
    if (routeChanges && unsavedWarning && !window.confirm(unsavedWarning)) return
    if (routeChanges && route.view === 'admin-course-editor') setEditorDirty(false)
    if (routeChanges && route.view === 'course-detail') setCourseNoteDirty(false)
    routeRef.current = nextRoute
    setRoute(nextRoute)
    const nextHash = canonicalRouteHash(next, courseId, lessonId)
    if (window.location.hash !== nextHash) window.location.hash = nextHash
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const navigate = (next: ViewId) => {
    // A student opened from the detail sheet is a one-off deep link. Regular
    // menu navigation must not keep forcing that old student in another page.
    setStaffStudentFocus(null)
    goTo(next)
  }
  const openStudent360 = (studentId: string, source: Student360Source, studentName = '') => {
    if (!studentId) return
    const nextRoute: AuraRoute = {
      view: 'student-360',
      courseId: null,
      lessonId: null,
      studentId,
      source,
      eatCleanScreen: 'store',
      mealId: null,
      orderId: null,
      loyaltyTab: 'rewards',
    }
    setStaffStudentFocus({ id: studentId, name: studentName })
    routeRef.current = nextRoute
    setRoute(nextRoute)
    const nextHash = student360RouteHash(studentId, source)
    if (window.location.hash !== nextHash) window.location.hash = nextHash
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const navigateStaffStudent = (next: ViewId, studentId?: string, studentName?: string) => {
    if (next === 'student-360' && studentId) {
      openStudent360(studentId, 'staff-students', studentName)
      return
    }
    setStaffStudentFocus(studentId ? { id: studentId, name: studentName || '' } : null)
    goTo(next)
  }
  const navigateEatClean = (screen: AuraRoute['eatCleanScreen'] = 'store', resourceId?: string | null) => {
    const nextHash = eatCleanRouteHash(screen, resourceId)
    if (window.location.hash !== nextHash) window.location.hash = nextHash
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const navigateEatCleanRoute = (next: EatCleanRoute) => {
    switch (next.screen) {
      case 'meal-detail':
        navigateEatClean('meal', next.mealId)
        break
      case 'order-detail':
        navigateEatClean('order', next.orderId)
        break
      case 'cart':
      case 'checkout':
      case 'orders':
        navigateEatClean(next.screen)
        break
      default:
        navigateEatClean('store')
    }
  }
  const openCourse = (courseId: string, lessonId?: string | null) => {
    setAdminPreviewCourseId(null)
    goTo('course-detail', courseId, lessonId)
  }

  useEffect(() => {
    const requiredPermission = adminViewPermissions[view]
    const outsideAdminBoundary = adminViews.includes(view) && !canAccessAdmin
    if (loading) return
    // Keep the intended deep-link while the sign-in screen is shown. This lets
    // a valid user continue to the requested workspace after authentication,
    // instead of being silently sent to Home before sign-in completes.
    if (backendMode === 'firebase' && !user) return
    // AuthContext intentionally exposes a provisional student profile while
    // Firebase claims and the canonical access context are still resolving.
    // Keep the requested deep-link intact until that authorization result is
    // final; otherwise a valid Staff/Admin URL can be redirected to Home.
    if (backendMode === 'firebase' && user && !authzReady) return
    if (role === 'shipper' && view !== 'delivery') {
      goTo('delivery')
      return
    }
    if (isStaffWorkspace && role !== 'shipper' && view === 'home') {
      goTo('staff-dashboard')
      return
    }
    if (view === 'delivery' && role !== 'shipper') {
      goTo('home')
      return
    }
    const capability = routeCapabilities[view as keyof typeof routeCapabilities]
    const outsideCapabilityBoundary = backendMode === 'firebase' && Boolean(capability) && authzReady && !hasCapability(capability)
    if (outsideAdminBoundary || outsideCapabilityBoundary || (requiredPermission && !hasPermission(role, requiredPermission))) goTo('home')
  }, [authzReady, backendMode, canAccessAdmin, hasCapability, isStaffWorkspace, loading, role, user, view])

  const studentCourses = useMemo(() => studentCourseData.courses
    .filter((course) => {
      if (course.settings?.visibility !== 'private' || canManageAcademy) return true
      const courseId = String(course.id)
      const enrollmentStatus = learningData.enrollmentByCourseId.get(courseId)?.status
      return enrollmentStatus === 'active' || enrollmentStatus === 'completed' || localEnrollmentIds.has(courseId)
    })
    .map((course) => {
      const courseId = String(course.id)
      const firebaseProgress = learningData.progressByCourseId.get(courseId)
      const demoProgress = demoProgressByCourseId.get(courseId)
      const demoLessons = backendMode === 'demo' ? flattenCourseLessons(course, true) : []
      const demoCompletedCount = backendMode === 'demo' ? getInitialDemoCompletedLessonIds(course).length : 0
      const demoInitialPercent = demoLessons.length ? Math.round((demoCompletedCount / demoLessons.length) * 100) : 0
      const progress = backendMode === 'firebase' ? firebaseProgress?.percent ?? 0 : demoProgress?.percent ?? demoInitialPercent
      const firebaseEnrollment = learningData.enrollmentByCourseId.get(courseId)
      const enrolled = backendMode === 'firebase'
        ? firebaseEnrollment?.status === 'active' || firebaseEnrollment?.status === 'completed' || localEnrollmentIds.has(courseId)
        : course.status !== 'Khám phá' || localEnrollmentIds.has(courseId)
      const completionThreshold = course.settings?.completionPercent ?? 100
      const demoCompletedCountForStatus = demoProgress?.completedLessonIds.length ?? demoCompletedCount
      const courseCompleted = backendMode === 'firebase'
        ? firebaseEnrollment?.status === 'completed'
        : demoLessons.length > 0 && demoCompletedCountForStatus * 100 >= completionThreshold * demoLessons.length
      return {
        ...course,
        progress,
        status: courseCompleted ? 'Đã hoàn thành' as const : enrolled || progress > 0 ? 'Đang học' as const : 'Khám phá' as const,
      }
    }), [
      backendMode,
      canManageAcademy,
      demoProgressByCourseId,
      learningData.enrollmentByCourseId,
      learningData.progressByCourseId,
      localEnrollmentIds,
      studentCourseData.courses,
    ])

  useEffect(() => {
    const completionByCourse = new Map<string, Array<{ userId: string; percent: number }>>()
    for (const progress of adminStudentProgress) {
      const values = completionByCourse.get(progress.courseId) ?? []
      values.push({ userId: progress.userId, percent: progress.percent })
      completionByCourse.set(progress.courseId, values)
    }
    const enrollmentsByCourse = new Map<string, Enrollment[]>()
    for (const enrollment of adminEnrollments) {
      const values = enrollmentsByCourse.get(enrollment.courseId) ?? []
      values.push(enrollment)
      enrollmentsByCourse.set(enrollment.courseId, values)
    }
    setAdminCourseAnalytics(adminCourseData.courses.map((course) => {
      const courseId = String(course.id)
      const enrollments = enrollmentsByCourse.get(courseId) ?? []
      const countedEnrollments = enrollments.filter((item) => item.status !== 'cancelled')
      const countedUserIds = new Set(countedEnrollments.map((item) => item.userId))
      const completionValues = (completionByCourse.get(courseId) ?? [])
        .filter((item) => countedUserIds.has(item.userId))
        .map((item) => item.percent)
      const averageCompletion = completionValues.length
        ? Math.round(completionValues.reduce((total, value) => total + value, 0) / completionValues.length)
        : 0
      return {
        courseId,
        learners: countedEnrollments.length,
        activeLearners: countedEnrollments.filter((item) => item.status === 'active').length,
        completedLearners: countedEnrollments.filter((item) => item.status === 'completed').length,
        averageCompletion,
        rating: null,
        updatedAt: course.updatedAt,
      } satisfies CourseAnalytics
    }))
  }, [adminCourseData.courses, adminEnrollments, adminStudentProgress])

  const adminStudentsDirectory = useMemo(() => {
    const toMillis = (value: unknown) => {
      if (!value) return null
      if (typeof value === 'number') return value
      if (value instanceof Date) return value.getTime()
      if (typeof value === 'string') {
        const parsed = new Date(value).getTime()
        return Number.isNaN(parsed) ? null : parsed
      }
      if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
        const date = value.toDate()
        if (!(date instanceof Date)) return null
        return date.getTime()
      }
      return null
    }
    const coursesById = new Map(adminCourseData.courses.map((course) => [String(course.id), course.title]))
    const enrollmentsByUser = new Map<string, Enrollment[]>()
    for (const enrollment of adminEnrollments) {
      const existing = enrollmentsByUser.get(enrollment.userId) ?? []
      existing.push(enrollment)
      enrollmentsByUser.set(enrollment.userId, existing)
    }
    const progressByUser = new Map<string, AdminStudentProgress[]>()
    for (const progress of adminStudentProgress) {
      const existing = progressByUser.get(progress.userId) ?? []
      existing.push(progress)
      progressByUser.set(progress.userId, existing)
    }
    return adminUsers.map((adminUser) => {
      const enrollments = enrollmentsByUser.get(adminUser.uid) ?? []
      const progresses = progressByUser.get(adminUser.uid) ?? []
      const averageProgress = progresses.length
        ? Math.round(progresses.reduce((total, item) => total + item.percent, 0) / progresses.length)
        : 0
      const lastActivity = (() => {
        const entries = [...enrollments, ...progresses]
        const times = entries
        .map((item) => {
          const enrollment = item as Enrollment & { enrolledAt?: unknown; completedAt?: unknown }
          return toMillis(item.updatedAt ?? enrollment.enrolledAt ?? enrollment.completedAt ?? null)
        })
        .filter((value): value is number => value !== null)
        if (!times.length) return undefined
        const mostRecent = Math.max(...times)
        return new Date(mostRecent)
      })()
      const programs = enrollments
        .map((enrollment) => coursesById.get(enrollment.courseId) ?? enrollment.courseId)
      const totalEnrollments = enrollments.length
      const status = adminUser.status === 'disabled'
        ? 'inactive'
        : totalEnrollments === 0
          ? 'invited'
          : 'active'
      return {
        uid: adminUser.uid,
        displayName: adminUser.displayName,
        email: adminUser.email,
        role: adminUser.role,
        membership: adminUser.membership ?? 'free',
        status,
        programs: [...new Set(programs)],
        totalEnrollments,
        activeEnrollments: enrollments.filter((item) => item.status === 'active').length,
        completedEnrollments: enrollments.filter((item) => item.status === 'completed').length,
        averageProgress,
        streak: Math.min(30, progresses.length),
        lastActivityAt: lastActivity,
      } satisfies AdminStudentDirectoryItem
    })
  }, [adminCourseData.courses, adminEnrollments, adminStudentProgress, adminUsers])

  const isAdminCoursePreview = Boolean(route.courseId && adminPreviewCourseId === route.courseId)
  const selectedCourse = route.courseId
    ? isAdminCoursePreview
      ? adminCourseData.courses.find((course) => String(course.id) === route.courseId)
      : studentCourses.find((course) => String(course.id) === route.courseId)
    : studentCourses[0]
  const selectedCourseId = selectedCourse ? String(selectedCourse.id) : null
  const selectedProgress = selectedCourse
    ? backendMode === 'firebase'
      ? learningData.progressByCourseId.get(String(selectedCourse.id))
      : demoProgressByCourseId.get(String(selectedCourse.id)) ?? {
        courseId: String(selectedCourse.id),
        completedLessonIds: getInitialDemoCompletedLessonIds(selectedCourse),
        percent: selectedCourse.progress,
        lastLessonId: '',
      }
    : undefined
  const selectedCourseLessons = selectedCourse
    ? flattenCourseLessons(selectedCourse, backendMode === 'demo')
    : []
  const selectedLessonId = selectedCourseLessons.some((lesson) => lesson.id === route.lessonId)
    ? route.lessonId
    : selectedCourseLessons.some((lesson) => lesson.id === selectedProgress?.lastLessonId)
      ? selectedProgress?.lastLessonId
      : selectedCourseLessons[0]?.id
  const selectedLesson = selectedCourseLessons.find((lesson) => lesson.id === selectedLessonId)
  const aiCoachLearningContext: AiCoachLearningContext | null = view === 'course-detail' && selectedCourse && selectedLesson
    ? {
        courseTitle: String(selectedCourse.title),
        chapter: selectedLesson.tags?.find((tag) => /^Chương\s+\d+$/i.test(tag)) ?? undefined,
        lessonTitle: selectedLesson.title,
        summary: selectedLesson.summary?.slice(0, 500),
        takeaways: selectedLesson.memory?.takeaways.slice(0, 3),
        workbookSummary: selectedLesson.tags?.includes('Thực hành')
          ? 'Học viên đang ở bài thực hành; hãy hỏi một câu ngắn, gợi mở và khuyến khích ghi dữ liệu vào workbook.'
          : undefined,
      }
    : null
  const selectedEnrollmentRecord = selectedCourse
    ? learningData.enrollmentByCourseId.get(String(selectedCourse.id))
    : undefined
  const selectedEnrollment = selectedCourse
    ? backendMode === 'firebase'
      ? selectedEnrollmentRecord?.status === 'active'
        || selectedEnrollmentRecord?.status === 'completed'
        || localEnrollmentIds.has(String(selectedCourse.id))
      : selectedCourse.status !== 'Khám phá' || localEnrollmentIds.has(String(selectedCourse.id))
    : false
  const selectedCourseLocked = Boolean(
    selectedCourse?.settings?.accessTier === 'pro'
    && profile?.membership !== 'pro'
    && profile?.membership !== 'coach'
    && !canManageAcademy,
  )
  const changeMode = (next: AppMode) => {
    if (next === 'admin' && !canAccessAdmin) return
    navigate(next === 'admin' ? 'admin-dashboard' : 'home')
  }

  const completeLesson = async (courseId: string, lessonId: string, workoutLogId?: string) => {
    const course = studentCourses.find((item) => String(item.id) === courseId)
    if (!course) throw new Error('Không tìm thấy khóa học.')
    if (backendMode === 'firebase') {
      if (!user) throw new Error('Bạn cần đăng nhập để lưu tiến độ.')
      await markLessonComplete(user.uid, courseId, lessonId, workoutLogId)
      return
    }

    const lessons = flattenCourseLessons(course, true)
    setDemoProgressByCourseId((current) => {
      const next = new Map(current)
      const existing = current.get(courseId)
      const completedLessonIds = [...new Set([
        ...(existing?.completedLessonIds ?? getInitialDemoCompletedLessonIds(course)),
        lessonId,
      ])]
      next.set(courseId, {
        courseId,
        completedLessonIds,
        percent: lessons.length ? Math.min(100, Math.round((completedLessonIds.length / lessons.length) * 100)) : 0,
        lastLessonId: lessonId,
      })
      return next
    })
  }

  const enrollSelectedCourse = async () => {
    if (!selectedCourse || selectedCourseLocked) throw new Error('Khóa học này yêu cầu gói Pro.')
    const courseId = String(selectedCourse.id)
    if (backendMode === 'firebase') {
      if (!user) throw new Error('Bạn cần đăng nhập để ghi danh.')
      await enrollInCourse(user.uid, courseId)
    }
    setLocalEnrollmentIds((current) => new Set(current).add(courseId))
  }

  const createCourse = () => goTo('admin-course-editor')
  const editCourse = (courseId: string) => goTo('admin-course-editor', courseId)
  const previewAdminCourse = (courseId: string) => {
    setAdminPreviewCourseId(courseId)
    goTo('course-detail', courseId)
  }
  const editingCourseId = view === 'admin-course-editor' ? route.courseId : null
  const editingCourse = editingCourseId
    ? adminCourseData.courses.find((course) => String(course.id) === editingCourseId)
    : undefined
  const effectiveDisplayName = profile?.displayName ?? localProfile?.displayName ?? user?.displayName ?? undefined
  const effectiveGoals = (profile?.goals && profile.goals.length > 0)
    ? profile.goals
    : (localProfile?.goals && localProfile.goals.length > 0)
      ? localProfile.goals
      : profile?.nutritionProfile?.goal
        ? [profile.nutritionProfile.goal]
        : localNutritionProfile?.goal
          ? [localNutritionProfile.goal]
          : []
  const effectiveHeight = profile?.heightCm ?? localProfile?.heightCm ?? profile?.nutritionProfile?.heightCm ?? localNutritionProfile?.heightCm ?? null
  const effectiveWeight = profile?.weightKg ?? localProfile?.weightKg ?? profile?.nutritionProfile?.weightKg ?? localNutritionProfile?.weightKg ?? null
  const effectiveTargetWeightDeltaKg = profile?.targetWeightDeltaKg ?? localProfile?.targetWeightDeltaKg ?? profile?.nutritionProfile?.targetWeightDeltaKg ?? localNutritionProfile?.targetWeightDeltaKg ?? null
  const effectiveTargetTimeframeMonths = profile?.targetTimeframeMonths ?? localProfile?.targetTimeframeMonths ?? profile?.nutritionProfile?.targetTimeframeMonths ?? localNutritionProfile?.targetTimeframeMonths ?? null
  const effectiveTargetSpeedPace = profile?.targetSpeedPace ?? localProfile?.targetSpeedPace ?? profile?.nutritionProfile?.targetSpeedPace ?? localNutritionProfile?.targetSpeedPace ?? null
  const effectiveNotifications = profile?.notificationSettings ?? localProfile?.notificationSettings

  const renderPage = () => {
    switch (view) {
      case 'aura-club': return <AuraClubPage isDemo={backendMode === 'demo'} ownerId={user?.uid ?? 'demo'} initialTab={route.loyaltyTab} onNavigate={navigate} />
      case 'courses': return <CoursesPage onOpenCourse={openCourse} courseItems={studentCourses} loading={studentCourseData.loading || learningData.loading} error={studentCourseData.error} onRetry={studentCourseData.retry} warning={learningData.error} initialQuery={globalSearchQuery} />
      case 'course-detail': return <CourseDetailPage course={selectedCourse} progress={selectedProgress} activeLessonId={selectedLessonId} enrolled={selectedEnrollment} enrolledAt={selectedEnrollmentRecord?.enrolledAt} noteOwnerId={user?.uid ?? 'demo'} onNoteDirtyChange={setCourseNoteDirty} accessLocked={selectedCourseLocked} learningWarning={learningData.error} loadError={isAdminCoursePreview ? adminCourseData.error : studentCourseData.error} onRetry={isAdminCoursePreview ? adminCourseData.retry : studentCourseData.retry} loading={(isAdminCoursePreview ? adminCourseData.loading : studentCourseData.loading) || learningData.loading} allowDemoContent={backendMode === 'demo'} previewMode={isAdminCoursePreview} onBack={() => {
        if (isAdminCoursePreview) {
          setAdminPreviewCourseId(null)
          navigate('admin-courses')
          return
        }
        navigate('courses')
      }} onSelectLesson={(lessonId) => selectedCourseId && (isAdminCoursePreview ? goTo('course-detail', selectedCourseId, lessonId) : openCourse(selectedCourseId, lessonId))} onEnroll={enrollSelectedCourse} onComplete={completeLesson} onUpgrade={() => navigate('profile')} />
      case 'schedule': return <SchedulePage key={user?.uid ?? 'demo'} onNavigate={navigate} isDemo={backendMode === 'demo'} ownerId={user?.uid ?? 'demo'} />
      case 'student-availability': return <StudentAvailabilityPage key={user?.uid ?? 'demo'} onNavigate={navigate} isDemo={backendMode === 'demo'} />
      case 'nutrition': return <NutritionPage
        key={user?.uid ?? 'demo'}
        displayName={effectiveDisplayName ?? user?.displayName ?? undefined}
        isDemo={backendMode === 'demo'}
        storageOwnerId={user?.uid ?? 'demo'}
        hasProfile={!forceOnboarding && Boolean(profile?.nutritionProfile || localNutritionProfile)}
        profile={effectiveNutritionProfile}
        syncState={profileSyncState}
        onStartOnboarding={() => setForceOnboarding(true)}
        onProfileComplete={async (nutritionProfile) => {
          if (backendMode === 'firebase' && user) {
            await saveProfileChanges({
              nutritionProfile,
              heightCm: nutritionProfile.heightCm,
              weightKg: nutritionProfile.weightKg,
              targetWeightDeltaKg: nutritionProfile.targetWeightDeltaKg,
              targetTimeframeMonths: nutritionProfile.targetTimeframeMonths,
              targetSpeedPace: nutritionProfile.targetSpeedPace,
              goals: [nutritionProfile.goal],
              onboardingCompleted: true,
            })
            return
          }
          setLocalNutritionProfile(nutritionProfile)
        }}
        onAnalyzeImage={async (file, options) => {
          const p: any = effectiveNutritionProfile
          const goalStr = p?.goal === 'lose-fat' ? 'Giảm mỡ thâm hụt calo' : p?.goal === 'gain-muscle' ? 'Tăng cơ nạc' : 'Duy trì vóc dáng'
          const sexStr = p?.biologicalSex === 'female' ? 'Nữ' : p?.biologicalSex === 'male' ? 'Nam' : ''
          const ageStr = p?.age ? `${p.age} tuổi` : ''
          const heightStr = p?.heightCm ? `${p.heightCm}cm` : effectiveHeight ? `${effectiveHeight}cm` : ''
          const weightStr = p?.weightKg ? `${p.weightKg}kg` : effectiveWeight ? `${effectiveWeight}kg` : ''
          const targets = p ? calculateNutritionTargets(p) : null
          const targetCalories = p?.targetCalories ?? targets?.targetCaloriesKcal
          const targetProtein = p?.protein ?? targets?.proteinG
          const targetCarbs = p?.carbs ?? targets?.carbsG
          const targetFat = p?.fat ?? targets?.fatG
          const targetStr = targetCalories
            ? `Mục tiêu ngày ${Math.round(targetCalories)} kcal, ${Math.round(targetProtein || 0)}g đạm, ${Math.round(targetCarbs || 0)}g carb, ${Math.round(targetFat || 0)}g béo`
            : ''
          const userCondStr = [sexStr, ageStr, heightStr, weightStr, targetStr].filter(Boolean).join(', ')

          const { analyzeFoodPhoto } = await import('./services/nutritionService')
          return analyzeFoodPhoto(file, {
            ...options,
            userGoal: goalStr,
            userCondition: userCondStr || 'Học viên Aura Fitness',
          })
        }}
        onOpenEatClean={() => navigateEatClean('store')}
      />
      case 'eat-clean': {
        const eatCleanRoute: EatCleanRoute = route.eatCleanScreen === 'meal' && route.mealId
          ? { screen: 'meal-detail', mealId: route.mealId }
          : route.eatCleanScreen === 'cart'
            ? { screen: 'cart' }
            : route.eatCleanScreen === 'checkout'
              ? { screen: 'checkout' }
              : route.eatCleanScreen === 'orders'
                ? { screen: 'orders' }
                : (route.eatCleanScreen === 'order' || route.eatCleanScreen === 'success') && route.orderId
                  ? { screen: 'order-detail', orderId: route.orderId }
                  : { screen: 'storefront' }
        const goal = effectiveNutritionProfile?.goal === 'gain-muscle'
          ? 'gain-muscle'
          : effectiveNutritionProfile?.goal === 'lose-fat'
            ? 'lose-fat'
            : 'maintain'
        const allergies = String(effectiveNutritionProfile?.allergies ?? '')
          .split(/[,;\n]/)
          .map((item) => item.trim())
          .filter(Boolean)
        return <EatCleanPage
          key={user?.uid ?? 'demo'}
          route={eatCleanRoute}
          onNavigate={navigateEatCleanRoute}
          ownerId={user?.uid ?? 'demo'}
          displayName={effectiveDisplayName}
          isDemo={backendMode === 'demo'}
          recommendationProfile={{
            goal,
            calorieTarget: dailyNutrition.calorieTarget,
            remainingCalories: dailyNutrition.remainingCalories,
            remainingProtein: dailyNutrition.remainingProtein,
            allergies,
            eatingStyle: effectiveNutritionProfile?.eatingStyle,
          }}
          onBack={() => navigate('nutrition')}
          onOrderCreated={(order) => {
            trackProductEvent('eat_clean_order_created', { orderId: order.id, total: order.total })
          }}
          onConsumptionConfirmed={(order) => {
            trackProductEvent('eat_clean_consumption_confirmed', { orderId: order.id })
          }}
        />
      }
      case 'progress-photo-studio': return <ProgressPhotoStudio onNavigate={navigate} ownerId={backendMode === 'firebase' ? (user?.uid ?? 'anonymous') : 'demo'} />
      case 'progress': return <ProgressPage ownerId={backendMode === 'firebase' ? (user?.uid ?? 'anonymous') : 'demo'} courseItems={studentCourses} progressItems={backendMode === 'firebase' ? learningData.progress : Array.from(demoProgressByCourseId.values())} loading={studentCourseData.loading || learningData.loading} error={studentCourseData.error || learningData.error} onOpenCourse={openCourse} onNavigate={navigate} weightKg={effectiveWeight} targetWeightDeltaKg={effectiveTargetWeightDeltaKg} targetTimeframeMonths={effectiveTargetTimeframeMonths} heightCm={effectiveHeight} nutritionProfile={effectiveNutritionProfile} />
      case 'student-360': {
        const source = route.source || (canAccessAdmin ? 'admin-pt-students' : 'staff-students')
        const internalActor = backendMode === 'demo'
          || accessContext?.accessRole === 'staff'
          || accessContext?.accessRole === 'admin'
          || accessContext?.accessRole === 'super_admin'
          || ['coach', 'trainer', 'sales', 'manager', 'admin', 'super_admin'].includes(role)
        if (backendMode === 'firebase' && !authzReady) return <div className="course-detail-state" role="status"><h1>Đang xác minh quyền truy cập</h1><p>Aura đang đối chiếu phạm vi học viên của tài khoản.</p></div>
        if (!route.studentId || !internalActor) return <div className="course-detail-state" role="alert"><h1>Không thể mở Học viên 360</h1><p>Trang này chỉ dành cho nhân sự Aura và cần một mã học viên hợp lệ.</p><button className="primary-button" onClick={() => navigate(internalActor ? source : 'home')}>Quay lại</button></div>
        return <Student360Page
          studentId={route.studentId}
          source={source}
          isDemo={backendMode === 'demo'}
          onBack={() => navigate(source)}
          onNavigate={navigateStaffStudent}
        />
      }
      case 'profile': return <ProfilePage userId={user?.uid} fullProfile={backendMode === 'demo' ? { ...profile, ...localProfile } : profile} displayName={effectiveDisplayName} email={profile?.email} membership={profile?.membership} goals={effectiveGoals} heightCm={effectiveHeight} weightKg={effectiveWeight} targetWeightDeltaKg={effectiveTargetWeightDeltaKg} targetTimeframeMonths={effectiveTargetTimeframeMonths} targetSpeedPace={effectiveTargetSpeedPace} notificationSettings={effectiveNotifications} mealReminderTime={profile?.mealReminderTime} syncState={profileSyncState} onSave={saveProfile} onSignOut={signOut} onChangePassword={changePassword} onEditProfile={() => setForceOnboarding(true)} onUploadAvatar={async (file, onProgress) => {
        if (backendMode === 'firebase' && user) {
          const photoURL = await uploadUserAvatar(user.uid, file, onProgress)
          await saveProfileChanges({ photoURL })
          return photoURL
        }
        const photoURL = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Không thể đọc ảnh đã chọn.'))
          reader.onerror = () => reject(new Error('Không thể đọc ảnh đã chọn.'))
          reader.readAsDataURL(file)
        })
        setLocalProfile((current) => ({ ...current, photoURL }))
        onProgress?.(100)
        return photoURL
      }} />
      case 'workout': {
        return <WorkoutPage key="pt-coaching-workout" onNavigate={navigate} onSave={async (log) => {
          if (backendMode === 'firebase' && user) {
            await savePtWorkoutLog(user.uid, log)
          }
        }} />
      }
      case 'delivery': return <DeliveryPage driverId={user?.uid ?? 'demo-shipper'} displayName={effectiveDisplayName ?? 'Shipper Aura'} onSignOut={signOut} />
      case 'admin-dashboard': return backendMode === 'firebase' && (!authzReady || !hasCapability('pt.operations.manage'))
        ? <div className="course-detail-state" role="status"><h1>{authzReady ? 'Không có quyền mở Tổng quan' : 'Đang xác minh quyền Tổng quan'}</h1><p>{authzReady ? 'Khu vực này chỉ dành cho quản trị viên hoặc quản lý có quyền vận hành.' : 'Aura đang đối chiếu phạm vi vận hành trước khi tải dữ liệu.'}</p></div>
        : <AdminDashboard adminName={effectiveDisplayName ?? 'Admin Aura'} isDemo={backendMode === 'demo'} canViewPayroll={backendMode === 'demo' || hasCapability('payroll.operations.manage')} canCreate={hasPermission(role, 'course.create')} canManageAcademy={canManageAcademy} canManageCoaching={canManageCoaching} canManageEnrollments={hasPermission(role, 'enrollment.manage')} onNavigate={navigate} />
      case 'admin-loyalty': return backendMode === 'firebase' && (!authzReady || !hasCapability('loyalty.dashboard.read'))
        ? <div className="course-detail-state" role="status"><h1>{authzReady ? 'Không có quyền mở Aura Club' : 'Đang xác minh quyền Aura Club'}</h1><p>{authzReady ? 'Tài khoản chưa được cấp quyền điều hành loyalty.' : 'Aura đang đối chiếu phạm vi quản trị.'}</p></div>
        : <AuraOperationsFrame><AdminLoyaltyPage
          isDemo={backendMode === 'demo'}
          canRunBackfill={accessContext?.accessRole === 'admin' || accessContext?.accessRole === 'super_admin'}
          canManagePolicy={backendMode === 'demo' || hasCapability('loyalty.policy.manage')}
          canManageRewards={backendMode === 'demo' || hasCapability('loyalty.reward.manage')}
          canManageAmbassadors={backendMode === 'demo' || hasCapability('loyalty.ambassador.manage')}
          canReviewRedemptions={backendMode === 'demo' || hasCapability('loyalty.redemption.review')}
          canAudit={backendMode === 'demo' || hasCapability('loyalty.audit.read')}
          canAdjust={backendMode === 'demo' || hasCapability('loyalty.adjust.request')}
          canApproveAdjustments={backendMode === 'demo' || hasCapability('loyalty.adjust.approve')}
        /></AuraOperationsFrame>
      case 'admin-today-sessions': return <AuraOperationsFrame><AdminTodaySessionsPage onNavigate={navigate} /></AuraOperationsFrame>
      case 'admin-courses': return <AdminCoursesPage
        courseItems={adminCourseData.courses}
        analytics={adminCourseAnalytics}
        loading={adminCourseData.loading}
        error={adminCourseData.error}
        initialQuery={globalSearchQuery}
        canCreate={hasPermission(role, 'course.create')}
        canEdit={hasPermission(role, 'course.edit')}
        onCreate={createCourse}
        onEdit={editCourse}
        onView={previewAdminCourse}
      />
      case 'admin-academy-students': return <AdminAcademyStudentsPage
        users={adminUsers}
        courses={adminCourseData.courses}
        enrollments={adminEnrollments}
        loading={adminUsersLoading || adminCourseData.loading}
        onManage={async (input) => { await manageAcademyEnrollment(input) }}
      />
      case 'admin-course-editor': {
        if (editingCourseId && adminCourseData.loading) return <div className="course-detail-state"><BookOpenIcon /><h1>Đang tải giáo án</h1><p>Aura đang lấy phiên bản mới nhất từ Firebase.</p></div>
        if (editingCourseId && adminCourseData.error) return <div className="course-detail-state"><BookOpenIcon /><h1>Chưa thể tải giáo án</h1><p>{adminCourseData.error}</p><button className="primary-button" onClick={() => navigate('admin-courses')}>Thử lại từ danh sách</button></div>
        if (editingCourseId && !editingCourse) return <div className="course-detail-state"><BookOpenIcon /><h1>Không tìm thấy giáo án</h1><p>Giáo án có thể đã bị xóa hoặc bạn không có quyền truy cập.</p><button className="primary-button" onClick={() => navigate('admin-courses')}>Về danh sách</button></div>
        return <CourseEditorPage key={editingCourseId ?? 'new-course'} initialCourse={editingCourse ? toCourseDraft(editingCourse) : undefined} onNavigate={navigate} onDirtyChange={setEditorDirty} canPublish={hasPermission(role, 'course.publish')} saveTarget={backendMode === 'firebase' ? 'firebase' : 'demo'} onSave={async (course) => {
          if (backendMode === 'firebase') {
            const result = await saveCourseDraft(course)
            if (!editingCourseId) window.history.replaceState(null, '', routeHash('admin-course-editor', result.courseId))
            return result
          }
        }} />
      }
      case 'admin-programs': return <AdminProgramsPage canPublish={hasPermission(role, 'program.publish')} canSubmit={hasPermission(role, 'program.submit')} onSave={async (program) => {
        if (backendMode === 'firebase') return savePtWorkoutProgram(program)
        return {
          programId: program.id ?? `program-${crypto.randomUUID()}`,
          versionId: `program-version-${crypto.randomUUID()}`,
        }
      }} />
      case 'admin-students': return <AdminStudentsPage
        students={adminStudentsDirectory}
        loading={adminUsersLoading || adminCourseData.loading}
        error={adminCourseData.error || learningData.error}
        onRetry={() => {
          window.location.reload()
        }}
      />
      case 'admin-roles': return <AuraOperationsFrame><AdminRolesPage users={adminUsers} currentRole={role} currentUserUid={user?.uid} loading={adminUsersLoading} onRoleChange={updateUserRole} /></AuraOperationsFrame>
      case 'admin-nutrition-reviews': return <AdminNutritionReviewsPage onNavigate={navigate} />
      case 'admin-notifications': return <AdminNotificationsPage onNavigate={navigate} users={adminUsers} currentUserUid={user?.uid} canManageUiRollout={role === 'super_admin'} backendMode={backendMode} />
      case 'admin-eat-clean': return <AdminEatCleanPage currentRole={role} isDemo={backendMode === 'demo'} />

      // PT Coaching & Gym Management Views
      case 'trainer-portal':
      case 'staff-students': return <AuraOperationsFrame><TrainerPortalV2 section="students" isDemo={backendMode === 'demo'} onNavigate={navigateStaffStudent} /></AuraOperationsFrame>
      case 'staff-dashboard': return <AuraOperationsFrame><StaffDashboardPage onNavigate={navigate} capabilities={accessContext?.capabilities || []} positions={staffPositions} branchCount={accessContext?.branchIds.length || 0} isDemo={backendMode === 'demo'} /></AuraOperationsFrame>
      case 'staff-schedule': return <AuraOperationsFrame><StaffScheduleWorkspace initialTab="teaching" canManageAvailability={backendMode === 'demo' || hasCapability('pt.availability.self.manage')} isDemo={backendMode === 'demo'} onNavigate={navigate} /></AuraOperationsFrame>
      case 'staff-workouts': return <AuraOperationsFrame><PtWorkoutWorkspacePage isDemo={backendMode === 'demo'} canPublishCatalog={role === 'admin' || role === 'super_admin'} initialStudentId={staffStudentFocus?.id} /></AuraOperationsFrame>
      case 'staff-availability': return <AuraOperationsFrame><StaffScheduleWorkspace initialTab="availability" canManageAvailability={backendMode === 'demo' || hasCapability('pt.availability.self.manage')} isDemo={backendMode === 'demo'} onNavigate={navigate} /></AuraOperationsFrame>
      case 'staff-requests': return <AuraOperationsFrame><StaffScheduleWorkspace initialTab="requests" canManageAvailability={backendMode === 'demo' || hasCapability('pt.availability.self.manage')} isDemo={backendMode === 'demo'} onNavigate={navigate} /></AuraOperationsFrame>
      case 'staff-nutrition-reviews': return <AuraOperationsFrame><StaffNutritionReviewsPage initialStudentName={staffStudentFocus?.name} /></AuraOperationsFrame>
      case 'sales-portal':
      case 'staff-quotes': return <AuraOperationsFrame><SalesPortalV2 /></AuraOperationsFrame>
      case 'staff-renewals': return <AuraOperationsFrame><ContractRenewals onNavigate={(view) => navigate(view as ViewId)} /></AuraOperationsFrame>
      case 'staff-payroll': return <AuraOperationsFrame><StaffPayrollPage /></AuraOperationsFrame>

      case 'pt-workout': return <StudentPtWorkoutPage isDemo={backendMode === 'demo'} ownerId={user?.uid ?? 'demo'} />

      case 'admin-pt-students': return <AuraOperationsFrame className="aura-operations-page--students"><AdminPTStudentManagement user={user as any} profile={profile} initialStudentId={staffStudentFocus?.id} onOpenStudent360={(studentId, studentName) => openStudent360(studentId, 'admin-pt-students', studentName)} /></AuraOperationsFrame>
      case 'admin-pt-schedule': return <AuraOperationsFrame className="aura-operations-page--schedule">{backendMode === 'firebase'
        ? !authzReady
          ? <div className="course-detail-state" role="status"><h1>Đang xác minh phạm vi lịch</h1><p>Aura đang tải quyền chi nhánh trước khi mở công cụ xếp lịch.</p></div>
          : accessContext?.capabilities.includes('pt.schedule.branch.publish')
            ? <BranchScheduleWorkspace key={`${accessContext.uid}:${accessContext.authzVersion}`} accessContext={accessContext} onNavigate={(view) => navigate(view)} />
            : <div className="course-detail-state" role="alert"><h1>Chưa được cấp quyền xếp lịch</h1><p>Trang lịch được khóa an toàn vì tài khoản chưa có phạm vi chi nhánh phù hợp.</p></div>
        : <SchedulerWrapper user={user as any} profile={profile} accessContext={accessContext} backendMode={backendMode} onNavigate={(view) => navigate(view as ViewId)} />}</AuraOperationsFrame>
      case 'admin-training-history': return <AuraOperationsFrame><TrainingHistoryWorkspace /></AuraOperationsFrame>
      case 'admin-pt-workouts': return <AuraOperationsFrame><PtWorkoutWorkspacePage isDemo={backendMode === 'demo'} canPublishCatalog={accessContext?.accessRole === 'admin' || accessContext?.accessRole === 'super_admin' || role === 'admin' || role === 'super_admin'} initialStudentId={staffStudentFocus?.id} /></AuraOperationsFrame>
      case 'admin-trainer-quality': return <AuraOperationsFrame><TrainerQualityPage isDemo={backendMode === 'demo'} /></AuraOperationsFrame>
      case 'admin-renewals': return <AuraOperationsFrame><ContractRenewals onNavigate={(view) => navigate(view as ViewId)} /></AuraOperationsFrame>
      case 'admin-report': return backendMode === 'firebase' && (!authzReady || !hasCapability('pt.operations.manage'))
        ? <div className="course-detail-state" role="status"><h1>{authzReady ? 'Không có quyền mở Tổng quan' : 'Đang xác minh quyền Tổng quan'}</h1><p>{authzReady ? 'Khu vực này chỉ dành cho quản trị viên hoặc quản lý có quyền vận hành.' : 'Aura đang đối chiếu phạm vi vận hành trước khi tải dữ liệu.'}</p></div>
        : <AdminDashboard adminName={effectiveDisplayName ?? 'Admin Aura'} isDemo={backendMode === 'demo'} canViewPayroll={backendMode === 'demo' || hasCapability('payroll.operations.manage')} canCreate={hasPermission(role, 'course.create')} canManageAcademy={canManageAcademy} canManageCoaching={canManageCoaching} canManageEnrollments={hasPermission(role, 'enrollment.manage')} onNavigate={navigate} />
      case 'admin-finance': return <AuraOperationsFrame><AdminFinanceHub user={user as any} profile={profile} /></AuraOperationsFrame>
      case 'admin-hr': return <AuraOperationsFrame><AdminRolesPage users={adminUsers} currentRole={role} currentUserUid={user?.uid} loading={adminUsersLoading} onRoleChange={updateUserRole} /></AuraOperationsFrame>
      case 'admin-payroll': return <AuraOperationsFrame>{backendMode === 'firebase' && (!authzReady || !hasCapability('payroll.operations.manage'))
        ? <div className="course-detail-state" role="status"><h1>{authzReady ? 'Không có quyền quản lý bảng lương' : 'Đang xác minh quyền bảng lương'}</h1><p>{authzReady ? 'Chỉ quản trị viên được cấp quyền payroll.operations.manage mới có thể xem bảng lương nhân sự.' : 'Aura đang đối chiếu phạm vi quyền trước khi tải dữ liệu lương.'}</p></div>
        : <AdminPayroll user={user as any} profile={profile} />}</AuraOperationsFrame>
      case 'admin-packages': return <AuraOperationsFrame><div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6"><AdminPackageSettings user={user as any} profile={profile} /></div></AuraOperationsFrame>
      case 'admin-quotes': return <AuraOperationsFrame><AdminQuoteGenerator user={user as any} profile={profile} onNavigate={(view) => navigate(view as ViewId)} /></AuraOperationsFrame>
      case 'admin-schedule-settings': return <AuraOperationsFrame><div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6"><AdminScheduleSettings /></div></AuraOperationsFrame>

      default: return (
        <HomePage
          onNavigate={navigate}
          onOpenCourse={openCourse}
          courseItems={studentCourses}
          displayName={effectiveDisplayName}
          isDemo={backendMode === 'demo'}
          ownerId={user?.uid ?? 'demo'}
          progressItems={backendMode === 'firebase' ? learningData.progress : Array.from(demoProgressByCourseId.values())}
          nutritionProfile={profile?.nutritionProfile ?? localNutritionProfile}
        />
      )
    }
  }

  if ((user || backendMode === 'demo') && showOnboarding) {
    return (
      <Suspense fallback={<RouteLoadingFallback />}>
        <Onboarding
          initialProfile={
            (() => {
              const src = profile?.onboardingData || profile || {};
              return Object.fromEntries(Object.entries(src).filter(([_, v]) => v !== undefined));
            })()
          }
        onSkip={async (skippedProfile) => {
          const persistedDefaults = normalizeOnboardingProfile(skippedProfile);
          const skippedProfileUpdate = {
            onboardingCompleted: true,
            onboardingData: persistedDefaults,
            birthYear: persistedDefaults.birthYear,
            heightCm: persistedDefaults.heightCm,
            weightKg: persistedDefaults.weightKg,
          };

          if (backendMode === 'firebase' && user) {
            await saveProfileChanges(skippedProfileUpdate as any);
          }
          if (backendMode === 'demo') setLocalProfile((current) => ({
            ...current,
            birthYear: persistedDefaults.birthYear,
            heightCm: persistedDefaults.heightCm,
            weightKg: persistedDefaults.weightKg,
            onboardingData: persistedDefaults,
          }));
          setForceOnboarding(false);

          navigate('courses');
        }}
        onComplete={async (profile, plan) => {
          // Numeric controls display 165 cm / 60 kg before the member touches
          // them. Persist the hydrated draft so Firestore never receives null
          // for values the member actually saw and accepted.
          const persistedProfile = normalizeOnboardingProfile(profile);
          const nutritionProfile = {
            ...persistedProfile,
            age: plan.age || (persistedProfile.birthYear ? new Date().getFullYear() - persistedProfile.birthYear : 30),
            goal: persistedProfile.primaryGoal === 'fat_loss' ? 'lose-fat' : persistedProfile.primaryGoal === 'muscle_gain' ? 'gain-muscle' : 'maintain',
            targetWeightKg: persistedProfile.targetWeightKg ?? undefined,
            targetWeightDeltaKg: persistedProfile.targetWeightKg && persistedProfile.weightKg ? persistedProfile.targetWeightKg - persistedProfile.weightKg : 0,
            targetTimeframeMonths: Math.max(1, Math.round((plan.estimatedWeeks || 12) / 4.33)) || 3,
            targetCalories: plan.targetCaloriesKcal,
            protein: plan.proteinG,
            carbs: plan.carbsG,
            fat: plan.fatG,
            waterLiters: plan.waterLiters,
            steps: plan.stepsPerDay
          } as any;

          const profileUpdate = {
            onboardingCompleted: true,
            onboardingData: persistedProfile,
            nutritionProfile,
            heightCm: persistedProfile.heightCm,
            weightKg: persistedProfile.weightKg,
            goals: persistedProfile.primaryGoal ? [persistedProfile.primaryGoal] : [],
            biologicalSex: persistedProfile.biologicalSex,
            birthYear: persistedProfile.birthYear,
            activityLevel: persistedProfile.activityLevel,
            sleepHours: persistedProfile.sleepHours,
            sleepQuality: persistedProfile.sleepQuality,
            stressLevel: persistedProfile.stressLevel,
            dietType: persistedProfile.dietType,
            healthConditions: persistedProfile.healthConditions
          };

          // Firestore is the source of truth in production. Do not show the
          // onboarding as completed until the complete normalized profile has
          // actually been persisted successfully.
          if (backendMode === 'firebase' && user) {
            await saveProfileChanges(profileUpdate as any);
          }

          if (backendMode === 'demo') setLocalNutritionProfile(nutritionProfile);
          setForceOnboarding(false);

          navigate('nutrition');
        }} 
        />
      </Suspense>
    )
  }

  return (
    <AuraUiRolloutProvider userId={user?.uid ?? 'demo'} role={role} demo={backendMode === 'demo'}>
    <AppShell
      mode={mode}
      view={view}
      onNavigate={navigate}
      onModeChange={changeMode}
      mobileMenu={mobileMenu}
      setMobileMenu={setMobileMenu}
      userName={effectiveDisplayName ?? user?.displayName ?? 'Thành viên Aura'}
      userRole={roleLabels[role]}
      userId={user?.uid ?? 'demo'}
      role={role}
      setPreviewRole={setPreviewRole}
      userPhoto={profile?.photoURL ?? user?.photoURL}
      backendMode={backendMode}
      isStaffWorkspace={isStaffWorkspace}
      staffPositions={staffPositions}
      onSignOut={signOut}
      onSearch={(query) => {
        setGlobalSearchQuery(query)
        if (mode !== 'admin') {
          navigate('courses')
          return
        }
        const inCoachingWorkspace = view === 'admin-students' || view === 'admin-programs'
        navigate((inCoachingWorkspace || !canManageAcademy) && canManageCoaching
          ? 'admin-students'
          : 'admin-courses')
      }}
      canNavigate={(nextView) => {
        const capability = routeCapabilities[nextView as keyof typeof routeCapabilities]
        return backendMode !== 'firebase' || !capability || (authzReady && hasCapability(capability))
      }}
      authorizationError={authorizationError}
      aiCoachConversationScope={`progress-${user?.uid ?? 'demo'}`}
      aiCoachLearningContext={aiCoachLearningContext}
    >
      <ChunkErrorBoundary>
        <Suspense fallback={<RouteLoadingFallback />}>
          {renderPage()}
        </Suspense>
      </ChunkErrorBoundary>
    </AppShell>
    </AuraUiRolloutProvider>
  )
}

function RouteLoadingFallback() {
  return (
    <div className="aura-route-fallback-card" role="status" aria-live="polite">
      <h1>Chào mừng bạn đến với Aura Fitness</h1>
      <p>Nội dung đang được đồng bộ.</p>
      <span className="aura-loading-progress"><i /></span>
    </div>
  )
}

function BookOpenIcon() {
  return <span className="brand-mark compact">A<span /></span>
}

export default function AuthenticatedAuraApplication() {
  return (
    <DatabaseProvider>
      <AuraApplication />
    </DatabaseProvider>
  )
}
