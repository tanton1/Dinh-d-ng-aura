import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
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
import { ref as storageRef, uploadBytesResumable } from 'firebase/storage'
import { firebaseAuth, firebaseFunctions, firebaseStorage, firestoreDb } from '../lib/firebase'
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

function requireDb() {
  if (!firestoreDb) throw new Error('Firebase chưa được cấu hình. Hãy kiểm tra file .env.local.')
  return firestoreDb
}

function requireFunctions() {
  if (!firebaseFunctions) throw new Error('Firebase Functions chưa được cấu hình.')
  return firebaseFunctions
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
    updatedAt: data.updatedAt,
  }
}

function mapCourse(snapshot: QueryDocumentSnapshot<DocumentData>): Course {
  return mapCourseData(snapshot.id, snapshot.data())
}

function withoutUndefined<T>(value: T): T {
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

function courseModulesForPublicRead(input: CourseDraftInput) {
  return withoutUndefined(input.modules.map((module) => ({
    ...module,
    lessons: module.lessons.map((lesson) => {
      const { workoutRef: _legacyWorkoutReference, ...academyLesson } = lesson
      return {
        ...academyLesson,
        type: lesson.type === 'Buổi tập' ? 'Bài đọc' : lesson.type,
        primaryContent: lesson.primaryContent?.kind === 'workout'
          ? { kind: 'rich-text' as const, body: lesson.summary ?? '' }
          : lesson.primaryContent,
        completionPolicy: lesson.type === 'Quiz'
          ? { mode: 'quiz-pass' as const }
          : lesson.completionPolicy?.mode === 'workout-complete'
            ? { mode: 'manual' as const }
            : lesson.completionPolicy,
        quiz: lesson.quiz
          ? {
              ...lesson.quiz,
              questions: lesson.quiz.questions.map(({ correctIndex: _legacyAnswer, ...question }) => question),
            }
          : undefined,
      }
    }),
  })))
}

function quizKeysByLesson(input: CourseDraftInput) {
  return Object.fromEntries(input.modules.flatMap((module) => module.lessons.flatMap((lesson) => {
    if (!lesson.quiz) return []
    const answers = Object.fromEntries(lesson.quiz.questions.map((question) => {
      const editorAnswer = input.quizAnswerKeys?.[lesson.id]?.[question.id]
      const legacyAnswer = typeof question.correctIndex === 'number' ? [question.correctIndex] : []
      return [question.id, legacyAnswer.length ? legacyAnswer : (editorAnswer ?? [])]
    }))
    return [[lesson.id, { quizId: lesson.quiz.id, answers }]]
  }))) as Record<string, { quizId: string; answers: Record<string, number[]> }>
}

async function buildCourseQuizContentHash(
  quiz: { id: string; passPercent: number; questions: Array<{ id: string; question: string; options: string[] }> },
  answers: Record<string, number>,
) {
  const canonical = JSON.stringify({
    quizId: quiz.id,
    passPercent: quiz.passPercent,
    questions: quiz.questions.map((question) => ({
      id: question.id,
      question: question.question,
      options: question.options,
      correctIndex: answers[question.id],
    })),
  })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
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
        onData(items.length > 0 ? items : demoCourses)
      },
      (error) => {
        onData(demoCourses)
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
      onData(mapped.length > 0 ? mapped : demoCourses)
    })
    .catch(() => {
      if (!active) return
      // Fallback to demo courses when cloud function returns auth or sync error
      onData(demoCourses)
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
  console.log('createOrUpdateUserProfile called with profile:', profile);
  const db = requireDb()
  const reference = doc(db, 'users', profile.uid)
  
  try {
    const existing = await getDoc(reference)
    console.log('existing doc exists:', existing.exists());
    
    if (!existing.exists()) {
      console.log('Creating new user profile document...');
      await setDoc(
        reference,
        {
          ...profile,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
      )
      console.log('New user profile document created.');
    } else if (profile.email === 'nhattank16.1@gmail.com' && existing.data()?.role !== 'super_admin') {
      console.log('Upgrading existing user to super_admin...');
      // Upgrade existing user to super_admin if it's the target email
      await setDoc(
        reference,
        {
          role: 'super_admin',
          membership: 'pro',
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
      console.log('Existing user upgraded to super_admin.');
    }
  } catch (error) {
    console.error('Error in createOrUpdateUserProfile:', error);
    throw error;
  }
}

export async function saveCourseDraft(input: CourseDraftInput & { publish?: boolean }) {
  const db = requireDb()
  const reference = doc(db, 'courses', input.id)
  const existing = await getDoc(reference)
  const existingQuizKeys = await getDocs(collection(reference, 'quizKeys'))
  const existingStatus = existing.data()?.status
  const status = input.publish
    ? 'published'
    : input.publicationStatus
  const lessonCount = input.modules.reduce((total, module) => total + module.lessons.length, 0)
  const publicModules = courseModulesForPublicRead(input)
  const quizKeys = quizKeysByLesson(input)
  const existingQuizKeyData = Object.fromEntries(existingQuizKeys.docs.map((item) => [item.id, item.data()]))
  const existingAnswers = Object.fromEntries(existingQuizKeys.docs.map((item) => [
    item.id,
    item.data().answers && typeof item.data().answers === 'object'
      ? item.data().answers as Record<string, number>
      : {},
  ])) as Record<string, Record<string, number>>
  const batch = writeBatch(db)
  batch.set(
    reference,
    {
      schemaVersion: 2,
      title: input.title,
      coverUrl: input.coverUrl?.trim() || null,
      slug: input.slug,
      description: input.description,
      category: input.category,
      level: input.level,
      duration: input.duration,
      coach: input.coach,
      outcomes: input.outcomes,
      requirements: input.requirements,
      modules: publicModules,
      settings: input.settings,
      lessons: lessonCount,
      accent: 'purple',
      icon: 'nutrition',
      status,
      ...(input.publish && existingStatus !== 'published' ? { publishedAt: serverTimestamp() } : {}),
      updatedAt: serverTimestamp(),
      ...(!existing.exists() ? { createdAt: serverTimestamp() } : {}),
    },
    { merge: true },
  )

  const quizKeyDocuments = await Promise.all(Object.entries(quizKeys).map(async ([lessonId, key]) => {
    const lessonQuiz = input.modules.flatMap((module) => module.lessons).find((lesson) => lesson.id === lessonId)?.quiz
    const answers = Object.fromEntries(Object.entries(key.answers).flatMap(([questionId, indexes]) => {
      const answer = indexes[0] ?? existingAnswers[lessonId]?.[questionId]
      return typeof answer === 'number' && answer >= 0 ? [[questionId, answer]] : []
    }))
    return {
      lessonId,
      data: {
      quizId: key.quizId,
      passPercent: lessonQuiz?.passPercent ?? 70,
      answers,
      questionCount: lessonQuiz?.questions.length ?? 0,
      contentHash: lessonQuiz ? await buildCourseQuizContentHash(lessonQuiz, answers) : undefined,
      createdAt: existingQuizKeyData[lessonId]?.createdAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...(firebaseAuth?.currentUser?.uid ? { updatedBy: firebaseAuth.currentUser.uid } : {}),
      },
    }
  }))
  quizKeyDocuments.forEach(({ lessonId, data }) => {
    batch.set(doc(reference, 'quizKeys', lessonId), withoutUndefined(data))
  })
  existingQuizKeys.docs.forEach((keyDocument) => {
    if (!quizKeys[keyDocument.id]) batch.delete(keyDocument.ref)
  })
  await batch.commit()
  return reference.id
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
  await updateDoc(doc(db, 'users', userId), { ...values, updatedAt: serverTimestamp() })
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
  const db = requireDb()
  const batch = writeBatch(db)

  demoCourses.forEach((course) => {
    batch.set(doc(db, 'courses', `course-${course.id}`), {
      ...course,
      learnerStatus: course.status,
      status: course.status === 'Khám phá' ? 'draft' : 'published',
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    })
  })

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

export async function saveUserMealLog(userId: string, meal: Record<string, unknown> & { id: string }) {
  const db = requireDb()
  const reference = doc(db, 'users', userId, 'mealLogs', meal.id)
  await setDoc(
    reference,
    withoutUndefined({
      ...meal,
      updatedAt: serverTimestamp(),
      createdAt: meal.createdAt ?? serverTimestamp(),
    }),
    { merge: true },
  )
}

export async function deleteUserMealLog(userId: string, mealId: string) {
  const db = requireDb()
  const reference = doc(db, 'users', userId, 'mealLogs', mealId)
  await deleteDoc(reference)
}

export function subscribeToUserMealLogs(
  userId: string,
  onData: (meals: any[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const db = requireDb()
  return onSnapshot(
    collection(db, 'users', userId, 'mealLogs'),
    (snapshot) => {
      const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      onData(items)
    },
    (error) => {
      console.error('Error fetching user meal logs from Firestore:', error)
      onError?.(error)
    },
  )
}

export async function saveUserWaterLog(userId: string, entry: Record<string, unknown> & { id: string }) {
  const db = requireDb()
  const reference = doc(db, 'users', userId, 'waterLogs', entry.id)
  await setDoc(
    reference,
    withoutUndefined({
      ...entry,
      updatedAt: serverTimestamp(),
      createdAt: entry.createdAt ?? serverTimestamp(),
    }),
    { merge: true },
  )
}

export async function deleteUserWaterLog(userId: string, entryId: string) {
  const db = requireDb()
  const reference = doc(db, 'users', userId, 'waterLogs', entryId)
  await deleteDoc(reference)
}

export function subscribeToUserWaterLogs(
  userId: string,
  onData: (entries: any[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const db = requireDb()
  return onSnapshot(
    collection(db, 'users', userId, 'waterLogs'),
    (snapshot) => {
      const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      onData(items)
    },
    (error) => {
      console.error('Error fetching user water logs from Firestore:', error)
      onError?.(error)
    },
  )
}

export async function saveUserActivityLog(userId: string, activity: Record<string, unknown> & { id: string }) {
  const db = requireDb()
  const reference = doc(db, 'users', userId, 'activityLogs', activity.id)
  await setDoc(
    reference,
    withoutUndefined({
      ...activity,
      updatedAt: serverTimestamp(),
      createdAt: activity.createdAt ?? serverTimestamp(),
    }),
    { merge: true },
  )
}

export async function deleteUserActivityLog(userId: string, activityId: string) {
  const db = requireDb()
  const reference = doc(db, 'users', userId, 'activityLogs', activityId)
  await deleteDoc(reference)
}

export function subscribeToUserActivityLogs(
  userId: string,
  onData: (activities: any[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const db = requireDb()
  return onSnapshot(
    collection(db, 'users', userId, 'activityLogs'),
    (snapshot) => {
      const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      onData(items)
    },
    (error) => {
      console.error('Error fetching user activity logs from Firestore:', error)
      onError?.(error)
    },
  )
}

