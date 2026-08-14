import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { firebaseAuth, firebaseFunctions, firebaseStorage, firestoreDb } from '../lib/firebase'
import { safeLocalStorageSet } from '../lib/safeStorage'
import { reportClientIssue } from './clientTelemetryService'
import { compressBase64Image } from './firebaseNutritionLogService'
export {
  cleanMealForStorage,
  compressBase64Image,
  deleteUserActivityLog,
  deleteUserMealLog,
  deleteUserWaterLog,
  saveUserActivityLog,
  saveUserMealLog,
  saveUserWaterLog,
  subscribeToUserActivityLogs,
  subscribeToUserMealLogs,
  subscribeToUserWaterLogs,
} from './firebaseNutritionLogService'
export {
  deleteUserProgressPhoto,
  deleteUserWeightLog,
  saveUserBodyMeasurements,
  saveUserGamification,
  saveUserProgressPhoto,
  saveUserWeightLog,
  subscribeToUserBodyMeasurements,
  subscribeToUserGamification,
  subscribeToUserProgressPhotos,
  subscribeToUserWeightLogs,
  uploadUserProgressPhoto,
} from './firebaseProgressService'
import type {
  AdminUserRecord,
  Course,
  CourseDraftInput,
  CourseQuizAnswerKeys,
  CourseProgress,
  AdminStudentProgress,
  CourseAnalytics,
  CourseSettings,
  Enrollment,
  EnrollmentStatus,
  LessonResourceKind,
  MediaAssetReference,
  AdminStudentDirectoryItem,
  UserProfile,
  UserRole,
  WorkoutLogInput,
  WorkoutProgramDraftInput,
  WorkoutProgramSessionDraft,
} from '../types'
import { courses as demoCourses, workoutExercises } from '../data'
import { auraFoundationCourse } from '../course-template'

/** Sample Academy content is never shown as Firebase data in a production build. */
export const academyDemoFallbackEnabled = import.meta.env.DEV || import.meta.env.MODE === 'e2e'

function requireDb() {
  if (!firestoreDb) throw new Error('Firebase chưa được cấu hình. Hãy kiểm tra file .env.local.')
  return firestoreDb
}

function requireFunctions() {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa được cấu hình.')
  return firebaseFunctions
}

const clientMutableProfileFields = [
  'phoneNumber',
  'displayName',
  'photoURL',
  'onboardingCompleted',
  'onboardingData',
  'goals',
  'heightCm',
  'weightKg',
  'targetWeightDeltaKg',
  'targetTimeframeMonths',
  'targetSpeedPace',
  'injuries',
  'equipment',
  'notificationSettings',
  'mealReminderTime',
  'nutritionProfile',
  'biologicalSex',
  'birthYear',
  'activityLevel',
  'sleepHours',
  'sleepQuality',
  'stressLevel',
  'dietType',
  'healthConditions',
] as const

function clientMutableProfileValues(values: Partial<UserProfile>) {
  const source = values as Record<string, unknown>
  const safe: Record<string, unknown> = {}
  for (const field of clientMutableProfileFields) {
    if (source[field] !== undefined) safe[field] = source[field]
  }
  return withoutUndefined(safe)
}

function normalizeCourseSettings(value: unknown): CourseSettings {
  const settings = value && typeof value === 'object' ? value as Partial<CourseSettings> : {}
  const completionPercent = typeof settings.completionPercent === 'number'
    && Number.isInteger(settings.completionPercent)
    && settings.completionPercent >= 50
    && settings.completionPercent <= 100
      ? settings.completionPercent
      : 100
  return {
    // Invalid legacy documents fail closed in the learner UI until an admin saves a valid schema.
    accessTier: settings.accessTier === 'free' || settings.accessTier === 'pro' ? settings.accessTier : 'pro',
    visibility: settings.visibility === 'members' || settings.visibility === 'private' ? settings.visibility : 'private',
    completionPercent,
    certificateEnabled: settings.certificateEnabled === true,
    dripSchedule: settings.dripSchedule === 'weekly' ? 'weekly' : 'none',
  }
}

function mapCourseData(id: string, data: DocumentData): Course {
  return {
    id,
    title: data.title ?? 'Khóa học chưa có tên',
    description: data.description ?? '',
    category: data.category ?? 'Dinh dưỡng chuyên sâu',
    level: data.level ?? 'Mọi cấp độ',
    coach: data.coach ?? 'Aura Academy',
    lessons: data.lessons ?? 0,
    duration: data.duration ?? 'Tự học',
    progress: data.progress ?? 0,
    accent: data.accent ?? 'purple',
    icon: data.icon ?? 'nutrition',
    status: data.learnerStatus ?? (data.status === 'published' ? 'Khám phá' : 'Đang học'),
    publicationStatus: data.status ?? 'draft',
    slug: data.slug,
    outcomes: Array.isArray(data.outcomes) ? data.outcomes : [],
    requirements: Array.isArray(data.requirements) ? data.requirements : [],
    modules: Array.isArray(data.modules) ? data.modules : [],
    settings: normalizeCourseSettings(data.settings),
    coverUrl: data.coverUrl,
    schemaVersion: data.schemaVersion === 2 ? 2 : undefined,
    revision: Number.isInteger(data.revision) && data.revision >= 0 ? data.revision : 0,
    updatedAt: data.updatedAt,
  }
}

function mapCourse(snapshot: QueryDocumentSnapshot<DocumentData>): Course {
  return mapCourseData(snapshot.id, snapshot.data())
}

export function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => withoutUndefined(item)) as T
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    // Keep Firestore Timestamp and FieldValue instances intact. Recursing into
    // them would turn serverTimestamp() into an invalid plain object.
    if (prototype !== Object.prototype && prototype !== null) return value
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => (
        item === undefined ? [] : [[key, withoutUndefined(item)]]
      )),
    ) as T
  }
  return value
}

type MealAnalysisSnapshot = Record<string, unknown>

function isMealAnalysisSnapshot(value: unknown): value is MealAnalysisSnapshot {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Finds the first structured analysis object while ignoring legacy review
 * strings. A JSON object string is accepted only to recover older records.
 */
export function resolveMealAnalysisSnapshot(...candidates: unknown[]): MealAnalysisSnapshot | undefined {
  for (const candidate of candidates) {
    if (isMealAnalysisSnapshot(candidate)) return withoutUndefined(candidate)
    if (typeof candidate !== 'string' || !candidate.trim().startsWith('{')) continue
    try {
      const parsed = JSON.parse(candidate)
      if (isMealAnalysisSnapshot(parsed)) return withoutUndefined(parsed)
    } catch {
      // A legacy Coach review is plain text, not an analysis snapshot.
    }
  }
  return undefined
}

function mapCourseProgress(snapshot: QueryDocumentSnapshot<DocumentData>): CourseProgress {
  const data = snapshot.data()
  return {
    courseId: typeof data.courseId === 'string' ? data.courseId : snapshot.id,
    completedLessonIds: Array.isArray(data.completedLessonIds)
      ? data.completedLessonIds.filter((item): item is string => typeof item === 'string')
      : [],
    percent: typeof data.percent === 'number' ? data.percent : 0,
    lastLessonId: typeof data.lastLessonId === 'string' ? data.lastLessonId : '',
    completedAt: data.completedAt,
    updatedAt: data.updatedAt,
  }
}

function mapEnrollment(snapshot: QueryDocumentSnapshot<DocumentData>): Enrollment {
  const data = snapshot.data()
  const knownStatuses: EnrollmentStatus[] = ['active', 'completed', 'cancelled']
  const status = knownStatuses.includes(data.status as EnrollmentStatus)
    ? data.status as EnrollmentStatus
    : 'cancelled'
  return {
    id: snapshot.id,
    userId: typeof data.userId === 'string' ? data.userId : '',
    courseId: typeof data.courseId === 'string' ? data.courseId : '',
    status,
    enrolledAt: data.enrolledAt,
    updatedAt: data.updatedAt,
  }
}

function mapAdminStudentProgress(snapshot: QueryDocumentSnapshot<DocumentData>): AdminStudentProgress {
  const data = mapCourseProgress(snapshot)
  const path = snapshot.ref.path.split('/')
  const userId = path.length >= 3 && path[0] === 'users' && path[2] === 'progress'
    ? path[1]
    : ''
  return { ...data, userId }
}

function requireDocumentId(value: string, label: string) {
  const normalized = value.trim()
  if (!normalized || normalized.includes('/')) {
    throw new Error(`${label} không hợp lệ.`)
  }
  return normalized
}

export function getEnrollmentId(userId: string, courseId: string) {
  return `${requireDocumentId(userId, 'UID')}_${requireDocumentId(courseId, 'Mã khóa học')}`
}

export function subscribeToCourses(
  includeDrafts: boolean,
  onData: (items: Course[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const db = requireDb()
  if (includeDrafts) {
    return onSnapshot(
      collection(db, 'courses'),
      { includeMetadataChanges: true },
      (snapshot) => {
        const items = snapshot.docs.map(mapCourse)
        onData(items.length > 0 ? items : (academyDemoFallbackEnabled ? demoCourses : []))
      },
      (error) => {
        onData(academyDemoFallbackEnabled ? demoCourses : [])
        onError(error)
      },
    )
  }

  // Learners receive entitlement-filtered content through a callable. The
  // underlying course document is staff-only because it contains full modules.
  let active = true
  const callable = httpsCallable<Record<string, never>, unknown>(requireFunctions(), 'listAcademyCourses')
  void callable({})
    .then((response) => {
      if (!active) return
      const payload = response.data && typeof response.data === 'object' ? response.data as Record<string, unknown> : {}
      const courses = Array.isArray(payload.courses) ? payload.courses : []
      const mapped = courses.flatMap((value) => {
        if (!value || typeof value !== 'object') return []
        const course = value as Record<string, unknown>
        return typeof course.id === 'string' ? [mapCourseData(course.id, course)] : []
      })
      onData(mapped.length > 0 ? mapped : (academyDemoFallbackEnabled ? demoCourses : []))
    })
    .catch((error: Error) => {
      if (!active) return
      onData(academyDemoFallbackEnabled ? demoCourses : [])
      onError(error)
    })
  return () => { active = false }
}

export function subscribeToAllEnrollments(
  onData: (items: Enrollment[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const db = requireDb()
  return onSnapshot(
    collection(db, 'enrollments'),
    { includeMetadataChanges: true },
    (snapshot) => onData(snapshot.docs.map(mapEnrollment)),
    (error) => onError(error),
  )
}

export function subscribeToAllStudentProgress(
  onData: (items: AdminStudentProgress[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const db = requireDb()
  return onSnapshot(
    collectionGroup(db, 'progress'),
    { includeMetadataChanges: true },
    (snapshot) => onData(snapshot.docs.map(mapAdminStudentProgress)),
    (error) => onError(error),
  )
}

export function subscribeToUserProgress(
  userId: string,
  onData: (items: CourseProgress[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const db = requireDb()
  const normalizedUserId = requireDocumentId(userId, 'UID')
  return onSnapshot(
    collection(db, 'users', normalizedUserId, 'progress'),
    { includeMetadataChanges: true },
    (snapshot) => onData(snapshot.docs.map(mapCourseProgress)),
    (error) => onError(error),
  )
}

export function subscribeToUserEnrollments(
  userId: string,
  onData: (items: Enrollment[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const db = requireDb()
  const normalizedUserId = requireDocumentId(userId, 'UID')
  const reference = query(collection(db, 'enrollments'), where('userId', '==', normalizedUserId))
  return onSnapshot(
    reference,
    { includeMetadataChanges: true },
    (snapshot) => onData(snapshot.docs.map(mapEnrollment)),
    (error) => onError(error),
  )
}

export async function enrollInCourse(userId: string, courseId: string): Promise<string> {
  const normalizedUserId = requireDocumentId(userId, 'UID')
  const normalizedCourseId = requireDocumentId(courseId, 'Mã khóa học')
  const callable = httpsCallable<{ courseId: string }, { enrollmentId: string }>(requireFunctions(), 'enrollInCourse')
  const result = await callable({ courseId: normalizedCourseId })
  const expectedEnrollmentId = getEnrollmentId(normalizedUserId, normalizedCourseId)
  if (result.data.enrollmentId !== expectedEnrollmentId) throw new Error('Phản hồi ghi danh không hợp lệ.')
  return result.data.enrollmentId
}

export async function manageAcademyEnrollment(input: {
  email: string
  courseId: string
  action: 'assign' | 'cancel'
}) {
  const payload = {
    email: input.email.trim().toLowerCase(),
    courseId: requireDocumentId(input.courseId, 'Mã khóa học'),
    action: input.action,
  }
  const callable = httpsCallable<typeof payload, { userId: string; courseId: string; status: EnrollmentStatus }>(
    requireFunctions(),
    'manageAcademyEnrollment',
  )
  const response = await callable(payload)
  if (response.data.courseId !== payload.courseId) throw new Error('Phản hồi quản lý ghi danh không hợp lệ.')
  return response.data
}

export async function createOrUpdateUserProfile(profile: UserProfile) {
  const db = requireDb()
  const authenticatedUser = firebaseAuth?.currentUser
  if (!authenticatedUser || authenticatedUser.uid !== profile.uid) {
    throw new Error('Phiên đăng nhập không khớp với hồ sơ cần cập nhật.')
  }
  const reference = doc(db, 'users', profile.uid)
  
  try {
    const existing = await getDoc(reference);
    
    if (!existing.exists()) {
      const newProfileData = withoutUndefined({
        ...clientMutableProfileValues(profile),
        uid: profile.uid,
        email: authenticatedUser.email ?? '',
        displayName: profile.displayName || authenticatedUser.displayName || 'Thành viên Aura',
        role: 'student',
        membership: 'free',
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      })
      await setDoc(reference, newProfileData)
    } else {
      const updateData = withoutUndefined({
        ...clientMutableProfileValues(profile),
        displayName: profile.displayName || existing.data()?.displayName,
        photoURL: profile.photoURL ?? existing.data()?.photoURL,
        updatedAt: serverTimestamp(),
      })
      await setDoc(reference, updateData, { merge: true })
    }
  } catch (error: any) {
    console.warn('Error in createOrUpdateUserProfile (possibly offline):', error);
    if (error?.code !== 'unavailable' && error?.message?.indexOf('offline') === -1 && error?.message?.indexOf('network') === -1) {
       // Only throw if it's not a typical offline/network error, to prevent blocking login
       throw error;
    }
  }
}

/** Saves course content, private quiz keys, revision and audit atomically on the server. */
export async function saveCourseDraft(input: CourseDraftInput & { publish?: boolean }) {
  const normalizedCourseId = requireDocumentId(input.id, 'Mã khóa học')
  const expectedRevision = Number.isInteger(input.revision) && (input.revision ?? 0) >= 0
    ? input.revision ?? 0
    : 0
  const payload = {
    course: withoutUndefined({ ...input, id: normalizedCourseId }),
    expectedRevision,
  }
  const callable = httpsCallable<
    typeof payload,
    { courseId: string; revision: number; status: string }
  >(requireFunctions(), 'saveCourseDraftAtomic')
  try {
    const response = await callable(payload)
    if (response.data.courseId !== normalizedCourseId
        || !Number.isInteger(response.data.revision)
        || response.data.revision <= expectedRevision) {
      throw new Error('Phản hồi lưu khóa học không hợp lệ.')
    }
    return response.data
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
    if (code === 'functions/aborted' || code === 'aborted') {
      throw new Error('Khóa học đã được chỉnh sửa ở phiên khác. Hãy tải lại trang để lấy bản mới nhất rồi lưu lại.')
    }
    throw error
  }
}

export async function loadCourseQuizAnswerKeys(courseId: string): Promise<CourseQuizAnswerKeys> {
  const db = requireDb()
  const normalizedCourseId = requireDocumentId(courseId, 'MÃ£ khÃ³a há»c')
  const snapshot = await getDocs(collection(db, 'courses', normalizedCourseId, 'quizKeys'))
  return Object.fromEntries(snapshot.docs.map((item) => {
    const rawAnswers = item.data().answers
    const answers = rawAnswers && typeof rawAnswers === 'object'
      ? Object.fromEntries(Object.entries(rawAnswers as Record<string, unknown>)
          .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] >= 0)
          .map(([questionId, optionIndex]) => [questionId, [optionIndex]]))
      : {}
    return [item.id, answers]
  }))
}

function workoutSessionForPublicRead(session: WorkoutProgramSessionDraft) {
  return withoutUndefined({
    ...session,
    quiz: session.quiz
      ? {
          ...session.quiz,
          questions: session.quiz.questions.map(({ correctIndex: _answerKey, ...question }) => question),
        }
      : undefined,
  })
}

function workoutProgramForPublicRead(input: Omit<WorkoutProgramDraftInput, 'id'>) {
  const sessionsByDay = Object.fromEntries(Object.entries(input.sessionsByDay).map(([day, session]) => [
    day,
    workoutSessionForPublicRead(session),
  ]))
  const weeksByWeek = input.weeksByWeek
    ? Object.fromEntries(Object.entries(input.weeksByWeek).map(([week, weekDraft]) => [
        week,
        {
          ...weekDraft,
          sessionsByDay: Object.fromEntries(Object.entries(weekDraft.sessionsByDay).map(([day, session]) => [
            day,
            workoutSessionForPublicRead(session),
          ])),
        },
      ]))
    : undefined
  return withoutUndefined({ ...input, sessionsByDay, weeksByWeek })
}

function workoutProgramQuizKeys(input: Omit<WorkoutProgramDraftInput, 'id'>) {
  const weeks = input.weeksByWeek ?? {
    1: { weekNumber: 1, label: 'Tuần 1', sessionsByDay: input.sessionsByDay },
  }
  const seenSessionIds = new Set<string>()
  return Object.values(weeks).flatMap((week) => Object.values(week.sessionsByDay).map((session) => {
    const sessionId = requireDocumentId(session.id, 'Mã session')
    if (seenSessionIds.has(sessionId)) throw new Error(`Session ID ${sessionId} bị trùng trong giáo án.`)
    seenSessionIds.add(sessionId)
    const answers = Object.fromEntries(session.quiz.questions.map((question) => {
      if (!Number.isInteger(question.correctIndex)
          || question.correctIndex < 0
          || question.correctIndex >= question.options.length) {
        throw new Error(`Quiz của session ${sessionId} có đáp án không hợp lệ.`)
      }
      return [question.id, question.correctIndex]
    }))
    return {
      sessionId,
      quizId: session.quiz.id,
      passPercent: session.quiz.passPercent,
      questionCount: session.quiz.questions.length,
      answers,
    }
  }))
}

function validateWorkoutProgramForPublish(input: WorkoutProgramDraftInput) {
  if (input.status !== 'published') return
  if (!input.title.trim() || !input.description.trim()) throw new Error('Hãy hoàn thiện tên và mô tả giáo án trước khi xuất bản.')
  const weeks = input.weeksByWeek ?? {}
  for (let weekNumber = 1; weekNumber <= input.durationWeeks; weekNumber += 1) {
    const week = weeks[weekNumber]
    if (!week) throw new Error(`Tuần ${weekNumber} chưa được cấu hình.`)
    for (let day = 1; day <= input.daysPerWeek; day += 1) {
      const session = week.sessionsByDay[day]
      if (!session || !session.exercises.length) throw new Error(`Tuần ${weekNumber}, buổi ${day} chưa có bài tập.`)
      if (!session.quiz.questions.length
          || session.quiz.questions.some((question) => (
            !question.question.trim()
            || question.options.length < 2
            || question.options.some((option) => !option.trim())
          ))) {
        throw new Error(`Quiz của tuần ${weekNumber}, buổi ${day} chưa hoàn thiện.`)
      }
    }
  }
}

export async function saveWorkoutProgram(input: {
  id?: string
} & WorkoutProgramDraftInput) {
  const db = requireDb()
  validateWorkoutProgramForPublish(input)
  const reference = input.id ? doc(db, 'programs', input.id) : doc(collection(db, 'programs'))
  const existing = await getDoc(reference)
  const { id: _documentId, ...programInput } = input
  const versionId = `program-version-${crypto.randomUUID()}`
  const sessionsByDay = input.weeksByWeek?.[1]?.sessionsByDay ?? input.sessionsByDay
  const canonicalProgram = workoutProgramForPublicRead({
    ...programInput,
    schemaVersion: 2 as const,
    versionId,
    sessionsByDay,
    status: input.status ?? 'draft',
  })
  const versionReference = doc(reference, 'versions', versionId)
  const batch = writeBatch(db)
  batch.set(versionReference, {
    ...canonicalProgram,
    programId: reference.id,
    versionId,
    createdAt: serverTimestamp(),
  })
  workoutProgramQuizKeys({ ...programInput, sessionsByDay }).forEach((key) => {
    batch.set(doc(versionReference, 'quizKeys', key.sessionId), {
      quizId: key.quizId,
      answers: key.answers,
      passPercent: key.passPercent,
      questionCount: key.questionCount,
      updatedAt: serverTimestamp(),
    })
  })
  batch.set(reference, {
    ...canonicalProgram,
    currentVersionId: versionId,
    updatedAt: serverTimestamp(),
    ...(!existing.exists() ? { createdAt: serverTimestamp() } : {}),
  }, { merge: true })
  await batch.commit()
  return { programId: reference.id, versionId }
}

const courseMediaTypes: Record<LessonResourceKind, RegExp> = {
  video: /^video\//,
  slide: /^(application\/pdf|application\/vnd\.(ms-powerpoint|openxmlformats-officedocument\.presentationml\.presentation))$/,
  document: /^(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|text\/plain)$/,
}

export function uploadCourseCover(
  courseId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<string> {
  if (!firebaseStorage || !firebaseAuth?.currentUser) return Promise.reject(new Error('Bạn cần đăng nhập để tải ảnh lên Firebase.'))

  const normalizedCourseId = requireDocumentId(courseId, 'Mã khóa học')
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(normalizedCourseId)) {
    return Promise.reject(new Error('Mã khóa học không hợp lệ để tải ảnh bìa.'))
  }
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    return Promise.reject(new Error('Vui lòng chọn ảnh định dạng JPG, PNG hoặc WEBP.'))
  }
  
  const maxBytes = 5 * 1024 * 1024 // 5MB
  if (file.size < 1 || file.size > maxBytes) {
    return Promise.reject(new Error('Kích thước ảnh không được vượt quá 5MB.'))
  }

  const assetId = crypto.randomUUID()
  const safeFileName = (file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'cover.jpg').slice(0, 200)
  const storagePath = `public-assets/course-covers/${normalizedCourseId}/${assetId}-${safeFileName}`
  
  const task = uploadBytesResumable(storageRef(firebaseStorage, storagePath), file, {
    contentType: file.type,
    customMetadata: { courseId: normalizedCourseId, uploadedBy: firebaseAuth.currentUser.uid },
  })

  return new Promise((resolve, reject) => {
    task.on(
      'state_changed',
      (snap) => {
        if (onProgress && snap.totalBytes > 0) {
          onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100))
        }
      },
      (error) => reject(error),
      () => {
        getDownloadURL(task.snapshot.ref).then(resolve).catch(reject)
      }
    )
  })
}

/** Uploads a private course asset. Learners resolve it through getCourseMediaUrl. */
export function uploadCourseMedia(
  input: { courseId: string; lessonId: string; kind: LessonResourceKind },
  file: File,
  onProgress?: (percent: number) => void,
): Promise<MediaAssetReference> {
  if (!firebaseStorage || !firebaseAuth?.currentUser) return Promise.reject(new Error('Bạn cần đăng nhập để tải học liệu lên Firebase.'))
  const courseId = requireDocumentId(input.courseId, 'Mã khóa học')
  const lessonId = requireDocumentId(input.lessonId, 'Mã bài học')
  if (!courseMediaTypes[input.kind].test(file.type)) {
    return Promise.reject(new Error('Định dạng tệp không phù hợp với loại học liệu đã chọn.'))
  }
  const maxBytes = input.kind === 'video' ? 500 * 1024 * 1024 : 50 * 1024 * 1024
  if (file.size < 1 || file.size > maxBytes) {
    return Promise.reject(new Error(`Tệp phải nhỏ hơn ${input.kind === 'video' ? '500 MB' : '50 MB'}.`))
  }

  const assetId = crypto.randomUUID()
  const safeFileName = file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'media'
  const storagePath = `course-media/${courseId}/${lessonId}/${assetId}-${safeFileName}`
  const task = uploadBytesResumable(storageRef(firebaseStorage, storagePath), file, {
    contentType: file.type,
    customMetadata: { courseId, lessonId, mediaId: assetId, assetId, uploadedBy: firebaseAuth.currentUser.uid, resourceKind: input.kind },
  })

  return new Promise((resolve, reject) => {
    task.on('state_changed',
      (snapshot) => onProgress?.(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)),
      reject,
      () => resolve({
        assetId,
        storagePath,
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        status: 'ready',
      }),
    )
  })
}

/**
 * Canonical API: markLessonComplete(userId, courseId, lessonId).
 * The optional fourth argument is ignored and only keeps older callers compiling.
 */
export async function markLessonComplete(
  userId: string,
  courseId: string,
  lessonId: string,
  workoutLogId?: string,
): Promise<CourseProgress> {
  const normalizedUserId = requireDocumentId(userId, 'UID')
  const normalizedCourseId = requireDocumentId(courseId, 'Mã khóa học')
  const normalizedLessonId = requireDocumentId(lessonId, 'Mã bài học')
  const callable = httpsCallable<
    { courseId: string; lessonId: string; workoutLogId?: string },
    Pick<CourseProgress, 'courseId' | 'completedLessonIds' | 'percent' | 'lastLessonId'> & { userId: string }
  >(requireFunctions(), 'completeCourseLesson')
  const result = await callable({
    courseId: normalizedCourseId,
    lessonId: normalizedLessonId,
    ...(workoutLogId ? { workoutLogId: requireDocumentId(workoutLogId, 'Mã nhật ký') } : {}),
  })
  if (result.data.userId !== normalizedUserId || result.data.courseId !== normalizedCourseId) {
    throw new Error('Phản hồi tiến độ không hợp lệ.')
  }
  const { userId: _responseUserId, ...progress } = result.data
  return progress
}

export async function saveWorkoutLog(
  userId: string,
  input: WorkoutLogInput,
  courseContext?: { courseId: string; lessonId: string },
) {
  const db = requireDb()
  const normalizedUserId = requireDocumentId(userId, 'UID')
  const normalizedLogId = requireDocumentId(input.clientLogId, 'Mã nhật ký')
  if (courseContext) {
    const payload = {
      courseId: requireDocumentId(courseContext.courseId, 'Mã khóa học'),
      lessonId: requireDocumentId(courseContext.lessonId, 'Mã bài học'),
      log: { ...input, clientLogId: normalizedLogId },
    }
    const callable = httpsCallable<typeof payload, { userId: string; logId: string }>(
      requireFunctions(),
      'saveCourseWorkoutLog',
    )
    const result = await callable(payload)
    if (result.data.userId !== normalizedUserId || result.data.logId !== normalizedLogId) {
      throw new Error('Phản hồi lưu buổi tập không hợp lệ.')
    }
    return result.data
  }
  return setDoc(doc(db, 'users', normalizedUserId, 'workoutLogs', normalizedLogId), {
    ...input,
    completedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  }, { merge: true })
}

export async function updateUserProfile(userId: string, values: Partial<UserProfile>) {
  const db = requireDb()
  const reference = doc(db, 'users', userId)
  const cleanValues = clientMutableProfileValues(values)
  // Persist remotely before updating the local cache. This prevents a failed
  // Firestore write from looking successful after the next page refresh.
  await setDoc(reference, { ...cleanValues, updatedAt: serverTimestamp() }, { merge: true })
  safeSetCache(`user_profile:${userId}`, cleanValues)
  if (typeof window !== 'undefined') {
    try {
      const raw1 = window.localStorage.getItem(`aura:user-profile:${userId}`)
      const raw2 = window.localStorage.getItem(`aura:profile:${userId}`)
      const p1 = raw1 ? JSON.parse(raw1) : {}
      const p2 = raw2 ? JSON.parse(raw2) : {}
      const merged = { ...p1, ...p2, ...cleanValues }
      window.localStorage.setItem(`aura:user-profile:${userId}`, JSON.stringify(merged))
      window.localStorage.setItem(`aura:profile:${userId}`, JSON.stringify(merged))
    } catch {}
  }
}

export function subscribeToAdminUsers(
  onData: (items: AdminUserRecord[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const db = requireDb()
  return onSnapshot(
    collection(db, 'users'),
    (snapshot) => onData(snapshot.docs.map((item) => {
      const data = item.data() as Partial<UserProfile> & { disabled?: boolean }
      return {
        uid: item.id,
        displayName: data.displayName ?? 'Thành viên Aura',
        email: data.email ?? '',
        role: data.role ?? 'student',
        photoURL: data.photoURL,
        membership: data.membership,
        status: data.disabled ? 'disabled' : 'active',
        notificationSettings: data.notificationSettings,
        goals: Array.isArray(data.goals) ? data.goals : undefined,
        nutritionProfile: data.nutritionProfile?.goal
          ? { goal: data.nutritionProfile.goal }
          : undefined,
        lastActive: 'Đã đồng bộ Firebase',
      }
    })),
    (error) => onError(error),
  )
}

export async function updateUserRole(userId: string, role: UserRole) {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa được cấu hình.')
  const updateRole = httpsCallable<{ uid: string; role: UserRole }, { tokenRefreshRequired: boolean }>(
    firebaseFunctions,
    'updateUserRole',
  )
  await updateRole({ uid: userId, role })
}

export async function seedAuraFoundationCourse(publish = true) {
  return saveCourseDraft({
    ...auraFoundationCourse,
    publicationStatus: publish ? 'published' : 'draft',
    publish,
  })
}

export async function seedAuraDemoData() {
  if (!academyDemoFallbackEnabled) {
    throw new Error('Không được phép tạo dữ liệu mẫu Academy trong production.')
  }
  const db = requireDb()
  await seedAuraFoundationCourse(false)
  const batch = writeBatch(db)

  workoutExercises.forEach((exercise) => {
    batch.set(doc(db, 'exercises', `exercise-${exercise.id}`), {
      ...exercise,
      tags: [exercise.target],
      status: 'published',
      updatedAt: serverTimestamp(),
    })
  })

  await batch.commit()
}

export async function submitMealReview(userId: string, userName: string, meal: any) {
  const db = requireDb()
  const reference = doc(db, 'mealReviews', meal.id)
  
  let cleanedMeal = { ...meal }
  const analysisSnapshot = resolveMealAnalysisSnapshot(meal.analysisSnapshot, meal.aiAnalysis)
  if (analysisSnapshot) {
    // Keep the snapshot next to the meal for backwards-compatible readers and
    // at the review root as the immutable source used during approval.
    cleanedMeal.aiAnalysis = analysisSnapshot
    cleanedMeal.analysisSnapshot = analysisSnapshot
  }
  const rawImg = meal.image || meal.imageUrl || meal.img || meal.fileName
  if (rawImg && typeof rawImg === 'string' && rawImg.startsWith('data:image')) {
    try {
      const compressed = await compressBase64Image(rawImg)
      if (cleanedMeal.image) cleanedMeal.image = compressed
      if (cleanedMeal.imageUrl) cleanedMeal.imageUrl = compressed
      if (cleanedMeal.img) cleanedMeal.img = compressed
      if (cleanedMeal.fileName) cleanedMeal.fileName = compressed
    } catch (e) {
      console.warn('Image compression error:', e)
    }
  }

  let studentGoal = meal.studentGoal || meal.userGoal
  let studentCondition = meal.studentCondition || meal.userCondition

  if (!studentGoal || !studentCondition) {
    try {
      const userDoc = await getDoc(doc(db, 'users', userId))
      if (userDoc.exists()) {
        const uData = userDoc.data()
        const np = uData.nutritionProfile || uData.profile || uData
        if (np) {
          const goalStr = np.goal === 'lose-fat' ? 'Giảm mỡ thâm hụt calo' : np.goal === 'gain-muscle' ? 'Tăng cơ nạc' : 'Duy trì vóc dáng'
          const sexStr = np.biologicalSex === 'female' ? 'Nữ' : np.biologicalSex === 'male' ? 'Nam' : ''
          const ageStr = np.age ? `${np.age} tuổi` : ''
          const hStr = np.heightCm ? `Cao ${np.heightCm}cm` : ''
          const wStr = np.weightKg ? `Nặng ${np.weightKg}kg` : ''
          const trStr = np.trainingSessions ? `Tập ${np.trainingSessions} buổi/tuần` : ''
          if (!studentGoal) studentGoal = goalStr
          if (!studentCondition) studentCondition = [sexStr, ageStr, hStr, wStr, trStr].filter(Boolean).join(', ')
        }
      }
    } catch (e) {
      console.warn('Could not fetch user profile for meal review:', e)
    }
  }

  await setDoc(
    reference,
    withoutUndefined({
      id: meal.id,
      userId,
      userName,
      studentGoal: studentGoal || 'Giảm mỡ thâm hụt calo & Tăng cơ nạc',
      studentCondition: studentCondition || 'Tập gym 3-4 buổi/tuần (Chỉ số theo nhật ký)',
      meal: cleanedMeal,
      analysisSnapshot,
      status: 'pending',
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    }),
    { merge: true },
  )
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code ?? 'unknown')
    : 'unknown'
  console.error('Firestore operation failed', { operationType, path, code })
  reportClientIssue('firestore', error, { phase: operationType, retryable: true })
  throw new Error('Không thể đồng bộ dữ liệu. Vui lòng thử lại.')
}

export async function updateMealReview(reviewId: string, updates: any) {
  const db = requireDb()
  
  // Clean updates to prevent duplicating large base64 image strings in secondary fields
  let sanitizedUpdates = { ...updates }
  if (sanitizedUpdates.approvedMeal && typeof sanitizedUpdates.approvedMeal === 'object') {
    const cleanApproved = { ...sanitizedUpdates.approvedMeal }
    if (cleanApproved.img && cleanApproved.img.length > 50000) delete cleanApproved.img
    if (cleanApproved.image && cleanApproved.image.length > 50000) delete cleanApproved.image
    if (cleanApproved.fileName && cleanApproved.fileName.length > 50000) delete cleanApproved.fileName
    sanitizedUpdates.approvedMeal = cleanApproved
  }

  const reference = doc(db, 'mealReviews', reviewId)
  try {
    await updateDoc(
      reference,
      withoutUndefined({
        ...sanitizedUpdates,
        updatedAt: serverTimestamp(),
      })
    )
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `mealReviews/${reviewId}`)
  }

  // If coach feedback is provided, sync to user's mealLogs
  if (sanitizedUpdates.coachFeedback) {
    let reviewSnap
    try {
      reviewSnap = await getDoc(reference)
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `mealReviews/${reviewId}`)
      return
    }

    if (reviewSnap.exists()) {
      const data = reviewSnap.data()
      if (data.userId && data.meal?.id) {
        const mealRef = doc(db, 'users', data.userId, 'mealLogs', data.meal.id)
        try {
          const mealSnapshot = await getDoc(mealRef)
          const existingAnalysis = mealSnapshot.exists()
            ? resolveMealAnalysisSnapshot(
                mealSnapshot.data().analysisSnapshot,
                mealSnapshot.data().aiAnalysis,
              )
            : undefined
          const reviewAnalysis = resolveMealAnalysisSnapshot(
            data.analysisSnapshot,
            data.meal?.analysisSnapshot,
            data.meal?.aiAnalysis,
            data.aiAnalysis,
            sanitizedUpdates.analysisSnapshot,
            sanitizedUpdates.aiAnalysis,
          )
          const mealLogUpdate: Record<string, unknown> = {
            coachFeedback: sanitizedUpdates.coachFeedback,
            reviewStatus: sanitizedUpdates.status || 'approved',
            updatedAt: serverTimestamp(),
          }
          // Never overwrite an existing structured analysis. Only repair an
          // older null/missing log from the immutable review snapshot.
          if (!existingAnalysis && reviewAnalysis) {
            mealLogUpdate.aiAnalysis = reviewAnalysis
          }
          await setDoc(mealRef, withoutUndefined(mealLogUpdate), { merge: true })
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `users/${data.userId}/mealLogs/${data.meal.id}`)
        }
      }
    }
  }
}

function safeGetCache(key: string, defaultValue: any) {
  try {
    const val = typeof window !== 'undefined' ? window.localStorage.getItem(`aura:cache:${key}`) : null;
    return val ? JSON.parse(val) : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

function safeSetCache(key: string, value: any) {
  safeLocalStorageSet(`aura:cache:${key}`, JSON.stringify(value))
}

export function subscribeToAllMealReviews(
  onData: (reviews: any[]) => void,
  onError?: (error: Error) => void
) {
  const db = requireDb()
  const q = query(
    collection(db, 'mealReviews'),
    orderBy('createdAt', 'desc')
  )
  return onSnapshot(
    q,
    (snapshot) => {
      const results = snapshot.docs.map((d) => ({
        ...d.data(),
        id: d.id,
      }))
      safeSetCache('all_meal_reviews', results)
      onData(results)
    },
    (error) => {
      console.warn('Firestore subscription status warning (all_meal_reviews):', error.message || error)
      const cached = safeGetCache('all_meal_reviews', [])
      onData(cached)
      if (onError) onError(error)
    }
  )
}
