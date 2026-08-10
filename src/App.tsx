import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Utensils, Flame, Dumbbell, HeartPulse } from 'lucide-react'
import AppShell from './components/AppShell'
import Onboarding from './onboarding/Onboarding'
import { hasPermission, type Permission } from './config/permissions'
import { calculateNutritionTargets } from './services/nutritionSyncService'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { useCourses } from './hooks/useCourses'
import { useLearningProgress } from './hooks/useLearningProgress'
import AuthPage from './pages/auth/AuthPage'
import HomePage from './pages/student/HomePage'
import type { NutritionProfileDraft } from './pages/student/NutritionPage'
import type { ProfileUpdateInput } from './pages/student/ProfilePage'
import { analyzeFoodPhoto } from './services/nutritionService'
import {
  enrollInCourse,
  manageAcademyEnrollment,
  markLessonComplete,
  saveCourseDraft,
  subscribeToAllEnrollments,
  subscribeToAllStudentProgress,
  subscribeToAdminUsers,
  updateUserProfile,
  updateUserRole,
} from './services/firebaseService'
import { savePtWorkoutProgram } from './services/ptCoachingProgramService'
import { savePtWorkoutLog } from './services/ptCoachingWorkoutService'
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
} from './types'
import { flattenCourseLessons, getInitialDemoCompletedLessonIds } from './utils/courseContent'
import { idlePrefetchStudentRoutes, idlePrefetchAdminRoutes } from './utils/routePreloader'

function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    let pageHasBeenRefreshed = false;
    try {
      pageHasBeenRefreshed = sessionStorage.getItem('aura_page_refreshed_for_chunk') === 'true';
    } catch (e) {
      // Ignore sessionStorage errors
    }

    try {
      const component = await factory()
      try { sessionStorage.removeItem('aura_page_refreshed_for_chunk') } catch (e) {}
      return component
    } catch (firstError) {
      // Attempt immediate retry after a brief delay
      try {
        await new Promise((resolve) => setTimeout(resolve, 500))
        const retryComponent = await factory()
        try { sessionStorage.removeItem('aura_page_refreshed_for_chunk') } catch (e) {}
        return retryComponent
      } catch (secondError) {
        if (!pageHasBeenRefreshed) {
          try { sessionStorage.setItem('aura_page_refreshed_for_chunk', 'true') } catch (e) {}
          window.location.reload()
          return new Promise<{ default: T }>(() => {})
        }
        try { sessionStorage.removeItem('aura_page_refreshed_for_chunk') } catch (e) {}
        throw secondError
      }
    }
  })
}

interface ChunkErrorBoundaryProps {
  children: React.ReactNode
}

interface ChunkErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class ChunkErrorBoundary extends Component<ChunkErrorBoundaryProps, ChunkErrorBoundaryState> {
  constructor(props: ChunkErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ChunkErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Chunk loading error caught by boundary:', error, errorInfo)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="course-detail-state" role="alert" style={{ padding: '40px 20px', textAlign: 'center' }}>
          <span className="brand-mark compact" aria-hidden="true">A<span /></span>
          <h1 style={{ fontSize: '20px', margin: '16px 0 8px' }}>Giao diện đang được cập nhật</h1>
          <p style={{ color: '#666', marginBottom: '20px' }}>Một số tập tin đã được đổi mới. Lỗi: {this.state.error?.message}</p>
          <button type="button" className="primary-button" onClick={this.handleReload}>
            Tải lại ứng dụng
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

const AdminAcademyStudentsPage = lazyWithRetry(() => import('./pages/admin/AdminAcademyStudentsPage'))
const AdminCoursesPage = lazyWithRetry(() => import('./pages/admin/AdminCoursesPage'))
const AdminDashboard = lazyWithRetry(() => import('./pages/admin/AdminDashboard'))
const AdminProgramsPage = lazyWithRetry(() => import('./pages/admin/AdminProgramsPage'))
const AdminRolesPage = lazyWithRetry(() => import('./pages/admin/AdminRolesPage'))
const AdminStudentsPage = lazyWithRetry(() => import('./pages/admin/AdminStudentsPage'))
const AdminNutritionReviewsPage = lazyWithRetry(() => import('./pages/admin/AdminNutritionReviewsPage'))
const AdminMealPlansPage = lazyWithRetry(() => import('./pages/admin/AdminMealPlansPage'))
const AdminNotificationsPage = lazyWithRetry(() => import('./pages/admin/AdminNotificationsPage'))
const CourseEditorPage = lazyWithRetry(() => import('./pages/admin/CourseEditorPage'))
const CourseDetailPage = lazyWithRetry(() => import('./pages/student/CourseDetailPage'))
const CoursesPage = lazyWithRetry(() => import('./pages/student/CoursesPage'))
const NutritionPage = lazyWithRetry(() => import('./pages/student/NutritionPage'))
const MealPlanPage = lazyWithRetry(() => import('./pages/student/MealPlanPage'))
const ProfilePage = lazyWithRetry(() => import('./pages/student/ProfilePage'))
const ProgressPage = lazyWithRetry(() => import('./pages/student/ProgressPage'))
const ProgressPhotoStudio = lazyWithRetry(() => import('./pages/student/ProgressPhotoStudio'))
const SchedulePage = lazyWithRetry(() => import('./pages/student/SchedulePage'))
const WorkoutPage = lazyWithRetry(() => import('./pages/student/WorkoutPage'))

const adminViews: ViewId[] = ['admin-dashboard', 'admin-courses', 'admin-course-editor', 'admin-academy-students', 'admin-programs', 'admin-students', 'admin-roles', 'admin-nutrition-reviews', 'admin-meal-plans', 'admin-notifications']
const validViews: ViewId[] = ['home', 'courses', 'course-detail', 'schedule', 'nutrition', 'meal-plan', 'progress', 'progress-photo-studio', 'profile', 'workout', ...adminViews]

const adminViewPermissions: Partial<Record<ViewId, Permission>> = {
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

interface AuraRoute {
  view: ViewId
  courseId: string | null
  lessonId: string | null
}

function getCurrentRoute(): AuraRoute {
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

function routeHash(view: ViewId, courseId?: string | null, lessonId?: string | null) {
  const params = new URLSearchParams()
  if (courseId) params.set('courseId', courseId)
  if (lessonId) params.set('lessonId', lessonId)
  const query = params.toString()
  return `#/${view}${query ? `?${query}` : ''}`
}

function isSameRoute(left: AuraRoute, right: AuraRoute) {
  return left.view === right.view
    && left.courseId === right.courseId
    && left.lessonId === right.lessonId
}

const roleLabels = {
  student: 'Học viên',
  coach: 'Huấn luyện viên',
  editor: 'Biên tập viên',
  admin: 'Administrator',
  super_admin: 'Super Administrator',
}

function toCourseDraft(course: Course): CourseDraftInput {
  return {
    id: String(course.id),
    coverUrl: course.coverUrl,
    slug: course.slug ?? String(course.id),
    title: course.title,
    description: course.description,
    category: course.category,
    level: course.level,
    coach: course.coach,
    duration: course.duration,
    outcomes: course.outcomes ?? [],
    requirements: course.requirements ?? [],
    modules: course.modules ?? [],
    settings: course.settings ?? {
      accessTier: 'pro',
      completionPercent: 80,
      certificateEnabled: true,
      dripSchedule: 'weekly',
      visibility: 'members',
    },
    publicationStatus: course.publicationStatus ?? 'draft',
  }
}

function AuraApplication() {
  const { user, profile, role, setPreviewRole, loading, backendMode, signOut } = useAuth()
  const canAccessAdmin = hasPermission(role, 'dashboard.view')
  const canManageAcademy = canAccessAdmin && hasPermission(role, 'course.view')
  const canManageCoaching = canAccessAdmin && hasPermission(role, 'program.view')
  const [route, setRoute] = useState<AuraRoute>(getCurrentRoute)
  const routeRef = useRef(route)
  const [editorDirty, setEditorDirty] = useState(false)
  const [courseNoteDirty, setCourseNoteDirty] = useState(false)
  const [mobileMenu, setMobileMenu] = useState(false)
  const [adminUsers, setAdminUsers] = useState<AdminUserRecord[]>([])
  const [adminUsersLoading, setAdminUsersLoading] = useState(false)
  const [adminEnrollments, setAdminEnrollments] = useState<Enrollment[]>([])
  const [adminStudentProgress, setAdminStudentProgress] = useState<AdminStudentProgress[]>([])
  const [adminCourseAnalytics, setAdminCourseAnalytics] = useState<CourseAnalytics[]>([])
  const [globalSearchQuery, setGlobalSearchQuery] = useState('')
  const [localNutritionProfile, setLocalNutritionProfile] = useState<NutritionProfileDraft | null>(null)
  const [forceOnboarding, setForceOnboarding] = useState(false)
  const [localProfile, setLocalProfile] = useState<ProfileUpdateInput | null>(null)
  const [localEnrollmentIds, setLocalEnrollmentIds] = useState<Set<string>>(() => new Set())
  const [demoProgressByCourseId, setDemoProgressByCourseId] = useState<Map<string, CourseProgress>>(() => new Map())
  const learningData = useLearningProgress(user?.uid, backendMode === 'firebase' && Boolean(user))
  const academyAccessRevision = `${profile?.membership ?? 'free'}:${[...learningData.enrollmentByCourseId.entries()].map(([courseId, enrollment]) => `${courseId}:${enrollment.status}`).sort().join('|')}:${[...localEnrollmentIds].sort().join('|')}`
  const studentCourseData = useCourses(Boolean(user), false, academyAccessRevision)
  const adminCourseData = useCourses(Boolean(user) && canManageAcademy, true)
  const view = route.view
  const mode: AppMode = adminViews.includes(view) ? 'admin' : 'student'

  useEffect(() => {
    idlePrefetchStudentRoutes()
    if (canAccessAdmin) {
      idlePrefetchAdminRoutes()
    }
  }, [canAccessAdmin])

  useEffect(() => {
    const profileKey = `aura:nutrition-profile:${user?.uid ?? 'demo'}`
    try {
      const savedProfile = window.localStorage.getItem(profileKey)
      setLocalNutritionProfile(savedProfile ? JSON.parse(savedProfile) as NutritionProfileDraft : null)
    } catch {
      setLocalNutritionProfile(null)
    }
  }, [user?.uid])

  useEffect(() => {
    const profileKey = `aura:profile:${user?.uid ?? 'demo'}`
    try {
      const savedProfile = window.localStorage.getItem(profileKey)
      setLocalProfile(savedProfile ? JSON.parse(savedProfile) as ProfileUpdateInput : null)
    } catch {
      setLocalProfile(null)
    }
  }, [user?.uid])

  const isOnboardingDone = !forceOnboarding && Boolean(
    profile?.onboardingCompleted ||
    profile?.nutritionProfile ||
    localNutritionProfile ||
    (profile?.heightCm && profile?.weightKg) ||
    (profile?.goals && profile.goals.length > 0) ||
    (user?.uid && typeof window !== 'undefined' && window.localStorage.getItem(`aura:onboarding-completed:${user.uid}`) === 'true') ||
    (typeof window !== 'undefined' && window.localStorage.getItem(`aura:onboarding-completed:${user?.uid ?? 'demo'}`) === 'true')
  )

  useEffect(() => {
    if (user && backendMode === 'firebase' && isOnboardingDone && profile && !profile.onboardingCompleted) {
      updateUserProfile(user.uid, { onboardingCompleted: true }).catch(() => {})
    }
  }, [user, backendMode, isOnboardingDone, profile])

  const saveProfile = async (values: ProfileUpdateInput) => {
    // Recalculate targets based on new values
    const rawGoal = values.goals ? values.goals[0] : (profile?.nutritionProfile?.goal || 'maintain');
    const safeGoal = rawGoal === 'fat_loss' ? 'lose-fat' : rawGoal === 'muscle_gain' ? 'gain-muscle' : 'maintain';
    
    const mergedProfileData = {
      ...(profile?.nutritionProfile || {}),
      ...(localNutritionProfile || {}),
      ...values,
      heightCm: values.heightCm ?? profile?.nutritionProfile?.heightCm ?? 165,
      weightKg: values.weightKg ?? profile?.nutritionProfile?.weightKg ?? 60,
      targetWeightDeltaKg: values.targetWeightDeltaKg ?? profile?.nutritionProfile?.targetWeightDeltaKg ?? 0,
      targetTimeframeMonths: values.targetTimeframeMonths ?? profile?.nutritionProfile?.targetTimeframeMonths ?? 3,
      goal: safeGoal
    }
    const newTargets = calculateNutritionTargets(mergedProfileData as any)
    
    const nextNutritionProfile = {
      ...mergedProfileData,
      age: mergedProfileData.age ?? 30,
      biologicalSex: mergedProfileData.biologicalSex ?? 'female',
      targetSpeedPace: mergedProfileData.targetSpeedPace || undefined,
      goal: safeGoal as "lose-fat" | "gain-muscle" | "maintain",
      targetCalories: newTargets.targetCaloriesKcal,
      protein: newTargets.proteinG,
      carbs: newTargets.carbsG,
      fat: newTargets.fatG,
      waterLiters: newTargets.waterLiters,
      steps: newTargets.stepsPerDay
    } as any;

    if (user?.uid) {
      try {
        window.localStorage.setItem(`aura:onboarding-completed:${user.uid}`, 'true')
        window.localStorage.setItem(`aura:profile:${user.uid}`, JSON.stringify(values))
        window.localStorage.setItem(`aura:user-profile:${user.uid}`, JSON.stringify(values))
        window.localStorage.setItem(`aura:nutrition-profile:${user.uid}`, JSON.stringify(nextNutritionProfile))
      } catch {
        // Storage unavailable
      }
    }
    
    setLocalProfile((current: any) => {
      const next: ProfileUpdateInput = {
        ...current,
        ...values,
        notificationSettings: values.notificationSettings
          ? { ...current?.notificationSettings, ...values.notificationSettings }
          : current?.notificationSettings,
      }
      try {
        window.localStorage.setItem(`aura:profile:${user?.uid ?? 'demo'}`, JSON.stringify(next))
        window.localStorage.setItem(`aura:user-profile:${user?.uid ?? 'demo'}`, JSON.stringify(next))
      } catch {
        // The in-memory profile remains editable when storage is unavailable.
      }
      return next
    })

    setLocalNutritionProfile(nextNutritionProfile as any)

    if (backendMode === 'firebase' && user) {
      try {
        await updateUserProfile(user.uid, {
          ...values,
          nutritionProfile: nextNutritionProfile,
          onboardingCompleted: true,
        })
      } catch (err) {
        console.warn("Could not save profile to Firebase (network or quota limit):", err)
      }
      return
    }
  }

  useEffect(() => {
    if (!user || backendMode !== 'firebase' || !hasPermission(role, 'team.view')) return
    setAdminUsersLoading(true)
    return subscribeToAdminUsers(
      (items) => {
        setAdminUsers(items)
        setAdminUsersLoading(false)
      },
      () => setAdminUsersLoading(false),
    )
  }, [backendMode, role, user])

  useEffect(() => {
    if (!user || backendMode !== 'firebase' || !hasPermission(role, 'analytics.view_all')) return
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
  }, [backendMode, role, user])

  useEffect(() => {
    routeRef.current = route
  }, [route])

  useEffect(() => {
    const onHashChange = () => {
      const nextRoute = getCurrentRoute()
      const currentRoute = routeRef.current
      if (isSameRoute(currentRoute, nextRoute)) return
      const unsavedWarning = currentRoute.view === 'admin-course-editor' && editorDirty
        ? 'Bạn có thay đổi chưa lưu. Rời trình tạo khóa học và bỏ các thay đổi này?'
        : currentRoute.view === 'course-detail' && courseNoteDirty
          ? 'Ghi chú bài học chưa được lưu. Bạn vẫn muốn rời trang này?'
          : null
      if (unsavedWarning && !window.confirm(unsavedWarning)) {
        window.history.replaceState(null, '', routeHash(currentRoute.view, currentRoute.courseId, currentRoute.lessonId))
        return
      }
      if (currentRoute.view === 'admin-course-editor') setEditorDirty(false)
      if (currentRoute.view === 'course-detail') setCourseNoteDirty(false)
      routeRef.current = nextRoute
      setRoute(nextRoute)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [courseNoteDirty, editorDirty])

  useEffect(() => {
    if (backendMode === 'firebase') {
      setLocalEnrollmentIds(new Set())
      setDemoProgressByCourseId(new Map())
    }
  }, [backendMode, user?.uid])

  const goTo = (next: ViewId, courseId?: string | null, lessonId?: string | null) => {
    if (adminViews.includes(next) && !canAccessAdmin) return
    const requiredPermission = adminViewPermissions[next]
    if (requiredPermission && !hasPermission(role, requiredPermission)) return
    const nextRoute = { view: next, courseId: courseId ?? null, lessonId: lessonId ?? null }
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
    const nextHash = routeHash(next, courseId, lessonId)
    if (window.location.hash !== nextHash) window.location.hash = nextHash
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const navigate = (next: ViewId) => goTo(next)
  const openCourse = (courseId: string, lessonId?: string | null) => goTo('course-detail', courseId, lessonId)

  useEffect(() => {
    const requiredPermission = adminViewPermissions[view]
    const outsideAdminBoundary = adminViews.includes(view) && !canAccessAdmin
    if (!loading && (outsideAdminBoundary || (requiredPermission && !hasPermission(role, requiredPermission)))) goTo('home')
  }, [canAccessAdmin, loading, role, view])

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
    const completionByCourse = new Map<string, number[]>()
    for (const progress of adminStudentProgress) {
      const values = completionByCourse.get(progress.courseId) ?? []
      values.push(progress.percent)
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
      const completionValues = completionByCourse.get(courseId) ?? []
      const averageCompletion = completionValues.length
        ? Math.round(completionValues.reduce((total, value) => total + value, 0) / completionValues.length)
        : 0
      return {
        courseId,
        learners: enrollments.length,
        activeLearners: enrollments.filter((item) => item.status === 'active').length,
        completedLearners: enrollments.filter((item) => item.status === 'completed').length,
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

  const selectedCourse = route.courseId
    ? studentCourses.find((course) => String(course.id) === route.courseId)
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
  if (loading) {
    return (
      <div className="aura-loading-container">
        <div className="aura-loading-overlay"></div>
        
        <div className="aura-loading-center">
           <div className="aura-loading-logo-group">
              <div className="aura-loading-img-wrapper">
                <img src="/aura-onboarding.png" alt="Aura Fitness Loading" className="aura-loading-brand-img" />
              </div>
              <h1 className="aura-loading-h1">AURA</h1>
              <h2 className="aura-loading-h2">FITNESS & NUTRITION</h2>
           </div>
        </div>

        <div className="aura-loading-features">
            <div className="aura-loading-feature">
                <div className="aura-loading-icon-circle">
                    <Utensils />
                </div>
                <span className="aura-loading-feature-text">Dinh dưỡng<br/>khoa học</span>
            </div>
            <div className="aura-loading-feature">
                <div className="aura-loading-icon-circle">
                    <Flame />
                </div>
                <span className="aura-loading-feature-text">Đốt mỡ<br/>hiệu quả</span>
            </div>
            <div className="aura-loading-feature">
                <div className="aura-loading-icon-circle">
                    <Dumbbell />
                </div>
                <span className="aura-loading-feature-text">Tập luyện<br/>thông minh</span>
            </div>
            <div className="aura-loading-feature">
                <div className="aura-loading-icon-circle">
                    <HeartPulse />
                </div>
                <span className="aura-loading-feature-text">Sức khỏe<br/>bền vững</span>
            </div>
        </div>

        <div className="aura-loading-footer">
          <div className="aura-loading-slogan-group">
              <div className="aura-loading-line"></div>
              <p className="aura-loading-slogan">Your Body - Your Aura</p>
              <div className="aura-loading-line"></div>
          </div>
          <small className="aura-loading-status">Đồng bộ hồ sơ và tiến độ từ Firebase...</small>
        </div>
      </div>
    )
  }

  if (backendMode === 'firebase' && !user) return <AuthPage />

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
      case 'courses': return <CoursesPage onOpenCourse={openCourse} courseItems={studentCourses} loading={studentCourseData.loading || learningData.loading} error={studentCourseData.error} warning={learningData.error} initialQuery={globalSearchQuery} />
      case 'course-detail': return <CourseDetailPage course={selectedCourse} progress={selectedProgress} activeLessonId={selectedLessonId} enrolled={selectedEnrollment} enrolledAt={selectedEnrollmentRecord?.enrolledAt} noteOwnerId={user?.uid ?? 'demo'} onNoteDirtyChange={setCourseNoteDirty} accessLocked={selectedCourseLocked} learningWarning={learningData.error} loading={studentCourseData.loading || learningData.loading} allowDemoContent={backendMode === 'demo'} onBack={() => navigate('courses')} onSelectLesson={(lessonId) => selectedCourseId && openCourse(selectedCourseId, lessonId)} onEnroll={enrollSelectedCourse} onComplete={completeLesson} onUpgrade={() => navigate('profile')} />
      case 'schedule': return <SchedulePage key={user?.uid ?? 'demo'} onNavigate={navigate} isDemo={backendMode === 'demo'} ownerId={user?.uid ?? 'demo'} />
      case 'nutrition': return <NutritionPage
        key={user?.uid ?? 'demo'}
        displayName={effectiveDisplayName ?? user?.displayName ?? undefined}
        isDemo={backendMode === 'demo'}
        storageOwnerId={user?.uid ?? 'demo'}
        hasProfile={!forceOnboarding && Boolean(profile?.nutritionProfile || localNutritionProfile)}
        profile={profile?.nutritionProfile ?? localNutritionProfile ?? undefined}
        onProfileComplete={async (nutritionProfile) => {
          setLocalNutritionProfile(nutritionProfile)
          try {
            window.localStorage.setItem(`aura:nutrition-profile:${user?.uid ?? 'demo'}`, JSON.stringify(nutritionProfile))
          } catch {
            // Ignore quota error
          }
          if (user?.uid) {
            try {
              window.localStorage.setItem(`aura:onboarding-completed:${user.uid}`, 'true')
            } catch {
              // Ignore
            }
          }
          if (backendMode === 'firebase' && user) {
            await updateUserProfile(user.uid, {
              nutritionProfile,
              heightCm: nutritionProfile.heightCm,
              weightKg: nutritionProfile.weightKg,
              targetWeightDeltaKg: nutritionProfile.targetWeightDeltaKg,
              targetTimeframeMonths: nutritionProfile.targetTimeframeMonths,
              targetSpeedPace: nutritionProfile.targetSpeedPace,
              goals: [nutritionProfile.goal],
              onboardingCompleted: true,
            })
          }
        }}
        onAnalyzeImage={async (file, options) => {
          const p: any = profile?.nutritionProfile ?? localNutritionProfile
          const goalStr = p?.goal === 'lose-fat' ? 'Giảm mỡ thâm hụt calo' : p?.goal === 'gain-muscle' ? 'Tăng cơ nạc' : 'Duy trì vóc dáng'
          const sexStr = p?.biologicalSex === 'female' ? 'Nữ' : p?.biologicalSex === 'male' ? 'Nam' : ''
          const ageStr = p?.age ? `${p.age} tuổi` : ''
          const heightStr = p?.heightCm ? `${p.heightCm}cm` : effectiveHeight ? `${effectiveHeight}cm` : ''
          const weightStr = p?.weightKg ? `${p.weightKg}kg` : effectiveWeight ? `${effectiveWeight}kg` : ''
          const calStr = p?.targetCalories ? `Mục tiêu ${p.targetCalories} kcal/ngày` : ''
          const userCondStr = [sexStr, ageStr, heightStr, weightStr, calStr].filter(Boolean).join(', ')

          return analyzeFoodPhoto(file, {
            ...options,
            userGoal: goalStr,
            userCondition: userCondStr || 'Học viên Aura Fitness',
          })
        }}
      />
      case 'meal-plan': return <MealPlanPage onNavigate={navigate} />
      case 'progress-photo-studio': return <ProgressPhotoStudio onNavigate={navigate} ownerId={user?.uid ?? 'demo'} />
      case 'progress': return <ProgressPage ownerId={user?.uid ?? 'demo'} courseItems={studentCourses} progressItems={backendMode === 'firebase' ? learningData.progress : Array.from(demoProgressByCourseId.values())} loading={studentCourseData.loading || learningData.loading} error={studentCourseData.error || learningData.error} onOpenCourse={openCourse} onNavigate={navigate} weightKg={effectiveWeight} targetWeightDeltaKg={effectiveTargetWeightDeltaKg} targetTimeframeMonths={effectiveTargetTimeframeMonths} heightCm={effectiveHeight} />
      case 'profile': return <ProfilePage fullProfile={profile} displayName={effectiveDisplayName} email={profile?.email} membership={profile?.membership} goals={effectiveGoals} heightCm={effectiveHeight} weightKg={effectiveWeight} targetWeightDeltaKg={effectiveTargetWeightDeltaKg} targetTimeframeMonths={effectiveTargetTimeframeMonths} targetSpeedPace={effectiveTargetSpeedPace} notificationSettings={effectiveNotifications} mealReminderTime={profile?.mealReminderTime} onSave={saveProfile} onSignOut={signOut} onEditProfile={() => setForceOnboarding(true)} />
      case 'workout': {
        return <WorkoutPage key="pt-coaching-workout" onNavigate={navigate} onSave={async (log) => {
          if (backendMode === 'firebase' && user) {
            await savePtWorkoutLog(user.uid, log)
          }
        }} />
      }
      case 'admin-dashboard': return <AdminDashboard adminName={effectiveDisplayName ?? 'Admin Aura'} canCreate={hasPermission(role, 'course.create')} canManageAcademy={canManageAcademy} canManageCoaching={canManageCoaching} canManageEnrollments={hasPermission(role, 'enrollment.manage')} onNavigate={navigate} />
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
        return <CourseEditorPage key={editingCourseId ?? 'new-course'} initialCourse={editingCourse ? toCourseDraft(editingCourse) : undefined} onNavigate={navigate} onDirtyChange={setEditorDirty} canPublish={hasPermission(role, 'course.publish')} saveTarget={backendMode === 'firebase' ? 'firebase' : 'demo'} onSave={async (course, publish) => {
          if (backendMode === 'firebase') {
            const savedCourseId = await saveCourseDraft({ ...course, publish })
            if (!editingCourseId) window.history.replaceState(null, '', routeHash('admin-course-editor', savedCourseId))
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
      case 'admin-roles': return <AdminRolesPage users={adminUsers} currentRole={role} currentUserUid={user?.uid} loading={adminUsersLoading} onRoleChange={updateUserRole} />
      case 'admin-nutrition-reviews': return <AdminNutritionReviewsPage onNavigate={navigate} />
      case 'admin-meal-plans': return <AdminMealPlansPage onNavigate={navigate} />
      case 'admin-notifications': return <AdminNotificationsPage onNavigate={navigate} users={adminUsers} currentUserUid={user?.uid} />
      default: return (
        <HomePage
          onNavigate={navigate}
          onOpenCourse={openCourse}
          courseItems={studentCourses}
          displayName={effectiveDisplayName}
          isDemo={backendMode === 'demo'}
          ownerId={user?.uid ?? 'demo'}
          progressItems={backendMode === 'firebase' ? learningData.progress : Array.from(demoProgressByCourseId.values())}
        />
      )
    }
  }

  if ((user || backendMode === 'demo') && !isOnboardingDone) {
    return (
      <Onboarding 
        initialProfile={profile || {}}
        onSkip={async () => {
          const uid = user?.uid ?? 'demo';
          try {
            window.localStorage.setItem(`aura:onboarding-completed:${uid}`, 'true');
          } catch (e) {
            console.error('LocalStorage error:', e);
          }
          setForceOnboarding(false);

          if (backendMode === 'firebase' && user) {
            try {
              const { doc, setDoc } = await import('firebase/firestore');
              const { firestoreDb } = await import('./lib/firebase');
              if (firestoreDb) {
                const userRef = doc(firestoreDb, 'users', user.uid);
                await setDoc(userRef, { 
                  onboardingCompleted: true
                }, { merge: true });
              }
            } catch (e) {
              console.error('Firestore onboarding skip save error:', e);
            }
          }

          navigate('courses');
        }}
        onComplete={async (profile, plan) => {
          const uid = user?.uid ?? 'demo';
          const nutritionProfile = {
            ...profile,
            age: plan.age || (profile?.birthYear ? new Date().getFullYear() - profile.birthYear : 30),
            goal: profile.primaryGoal === 'fat_loss' ? 'lose-fat' : profile.primaryGoal === 'muscle_gain' ? 'gain-muscle' : 'maintain',
            targetWeightDeltaKg: profile.targetWeightKg && profile.weightKg ? profile.targetWeightKg - profile.weightKg : 0,
            targetTimeframeMonths: Math.max(1, Math.round((plan.estimatedWeeks || 12) / 4.33)) || 3,
            targetCalories: plan.targetCaloriesKcal,
            protein: plan.proteinG,
            carbs: plan.carbsG,
            fat: plan.fatG,
            waterLiters: plan.waterLiters,
            steps: plan.stepsPerDay
          };

          try {
            window.localStorage.setItem(`aura:onboarding-completed:${uid}`, 'true');
            window.localStorage.setItem(`aura:nutrition-profile:${uid}`, JSON.stringify(nutritionProfile));
          } catch (e) {
            console.error('LocalStorage error:', e);
          }

          setLocalNutritionProfile(nutritionProfile);
          setForceOnboarding(false);

          if (backendMode === 'firebase' && user) {
            try {
              const { doc, setDoc } = await import('firebase/firestore');
              const { firestoreDb } = await import('./lib/firebase');
              if (firestoreDb) {
                const userRef = doc(firestoreDb, 'users', user.uid);
                await setDoc(userRef, { 
                  onboardingCompleted: true,
                  onboardingData: profile,
                  nutritionProfile,
                  heightCm: profile.heightCm,
                  weightKg: profile.weightKg,
                  goals: profile.goals || (profile.primaryGoal ? [profile.primaryGoal] : []),
                  biologicalSex: profile.biologicalSex,
                  birthYear: profile.birthYear,
                  activityLevel: profile.activityLevel,
                  sleepHours: profile.sleepHours,
                  sleepQuality: profile.sleepQuality,
                  stressLevel: profile.stressLevel,
                  dietType: profile.dietType,
                  healthConditions: profile.healthConditions
                }, { merge: true });
              }
            } catch (e) {
              console.error('Firestore onboarding save error:', e);
            }
          }

          navigate('nutrition');
        }} 
      />
    )
  }

  return (
    <AppShell
      mode={mode}
      view={view}
      onNavigate={navigate}
      onModeChange={changeMode}
      mobileMenu={mobileMenu}
      setMobileMenu={setMobileMenu}
      userName={effectiveDisplayName ?? user?.displayName ?? 'Thành viên Aura'}
      userRole={roleLabels[role]}
      role={role}
      setPreviewRole={setPreviewRole}
      userPhoto={profile?.photoURL ?? user?.photoURL}
      backendMode={backendMode}
      canAccessAdmin={canAccessAdmin}
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
    >
      <ChunkErrorBoundary>
        <Suspense fallback={<RouteLoadingFallback />}>
          {renderPage()}
        </Suspense>
      </ChunkErrorBoundary>
    </AppShell>
  )
}

function RouteLoadingFallback() {
  return (
    <div className="aura-route-fallback-card" role="status" aria-live="polite">
      <img src="/aura-onboarding.png" alt="Aura Loading" className="aura-route-fallback-img" />
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a', margin: '0 0 6px 0' }}>Đang tải không gian Aura...</h1>
      <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>Nội dung đang được đồng bộ và tối ưu hiển thị mượt mà.</p>
    </div>
  )
}

function BookOpenIcon() {
  return <span className="brand-mark compact">A<span /></span>
}

export default function App() {
  return <AuthProvider><AuraApplication /></AuthProvider>
}
