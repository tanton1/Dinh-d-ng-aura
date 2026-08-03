export type AppMode = 'student' | 'admin'

export type UserRole = 'student' | 'coach' | 'editor' | 'admin' | 'super_admin'

export interface AppUser {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
}

export interface UserProfile {
  uid: string
  email: string
  displayName: string
  photoURL?: string | null
  role: UserRole
  membership: 'free' | 'pro' | 'coach'
  onboardingCompleted?: boolean
  goals?: string[]
  heightCm?: number | null
  weightKg?: number | null
  injuries?: string[]
  equipment?: string[]
  notificationSettings?: Record<string, boolean | undefined>
  nutritionProfile?: {
    goal: 'lose-fat' | 'gain-muscle' | 'maintain'
    age: number
    biologicalSex: 'female' | 'male'
    heightCm: number
    weightKg: number
    activityLevel: 'low' | 'moderate' | 'high'
    trainingSessions: number
    eatingStyle: string
    allergies: string
  }
  createdAt?: unknown
  updatedAt?: unknown
}

export interface AdminUserRecord {
  uid: string
  displayName: string
  email: string
  role: UserRole
  photoURL?: string | null
  membership?: UserProfile['membership']
  status?: 'active' | 'invited' | 'disabled'
  lastActive?: string
}

export interface CourseProgress {
  courseId: string
  completedLessonIds: string[]
  percent: number
  lastLessonId: string
  completedAt?: unknown
  updatedAt?: unknown
}

export type EnrollmentStatus = 'active' | 'completed' | 'cancelled'

export interface Enrollment {
  id: string
  userId: string
  courseId: string
  status: EnrollmentStatus
  enrolledAt?: unknown
  updatedAt?: unknown
}

export interface AdminStudentProgress extends CourseProgress {
  userId: string
}

export interface CourseAnalytics {
  courseId: string
  learners: number
  activeLearners: number
  completedLearners: number
  averageCompletion: number
  rating: number | null
  updatedAt?: unknown
}

export interface AdminStudentDirectoryItem {
  uid: string
  displayName: string
  email: string
  role: UserRole
  membership: UserProfile['membership']
  status: 'active' | 'inactive' | 'invited'
  programs: string[]
  totalEnrollments: number
  activeEnrollments: number
  completedEnrollments: number
  averageProgress: number
  streak: number
  lastActivityAt?: unknown
}

export type StudentView =
  | 'home'
  | 'courses'
  | 'course-detail'
  | 'schedule'
  | 'nutrition'
  | 'progress'
  | 'profile'
  | 'workout'

export type AdminView =
  | 'admin-dashboard'
  | 'admin-courses'
  | 'admin-course-editor'
  | 'admin-academy-students'
  | 'admin-programs'
  | 'admin-students'
  | 'admin-roles'

export type ViewId = StudentView | AdminView

export interface Course {
  id: number | string
  title: string
  description: string
  category: string
  level: string
  coach: string
  lessons: number
  duration: string
  progress: number
  accent: string
  icon: string
  status?: 'Đang học' | 'Đã hoàn thành' | 'Khám phá'
  publicationStatus?: PublicationStatus
  slug?: string
  outcomes?: string[]
  requirements?: string[]
  modules?: CourseModuleDraft[]
  settings?: CourseSettings
  coverUrl?: string
  /** Version of the persisted curriculum contract. Missing means the legacy V1 shape. */
  schemaVersion?: 2
  updatedAt?: unknown
}

export interface MediaAssetReference {
  assetId: string
  storagePath: string
  fileName?: string
  contentType?: string
  sizeBytes?: number
  status?: 'uploading' | 'ready' | 'failed'
}

export interface LessonCompletionPolicy {
  mode: 'manual' | 'media-progress' | 'quiz-pass' | 'workout-complete'
  /** Required percentage for media-progress. Defaults to 80 when omitted. */
  thresholdPercent?: number
  /** Quiz id to grade. Defaults to the lesson quiz when omitted. */
  quizId?: string
}

export interface LessonWorkoutReference {
  programId: string
  sessionId: string
  versionId: string
}

export interface LessonPrimaryContent {
  /** `workout` is retained only for reading legacy courses. Academy editors no longer create it. */
  kind: 'resource' | 'rich-text' | 'workout'
  resourceId?: string
  body?: string
}

export interface AcademyGlossaryEntry {
  id: string
  term: string
  definition: string
}

export interface AcademyRecallPrompt {
  id: string
  prompt: string
  answer: string
}

export interface AcademyFlashcard {
  id: string
  front: string
  back: string
  hint?: string
}

export interface AcademyLessonMemory {
  /** A 60-second recap shown before deeper review tools. */
  recap?: string
  takeaways: string[]
  glossary: AcademyGlossaryEntry[]
  recallPrompts: AcademyRecallPrompt[]
  flashcards: AcademyFlashcard[]
}

export interface AcademyReviewRating {
  cardId: string
  rating: 'forgot' | 'hard' | 'remembered' | 'easy'
  reviewedAt: string
  nextReviewAt: string
  intervalDays: number
}

export interface AcademyLessonLearningState {
  courseId: string
  lessonId: string
  notes: string
  confidence: 1 | 2 | 3 | 4 | 5
  recallAnswers: Record<string, string>
  reviews: Record<string, AcademyReviewRating>
  updatedAt: string
}

export interface ProgramResourceDraft {
  id: string
  kind: LessonResourceKind
  title: string
  url: string
  note?: string
}

export interface ProgramQuizQuestionDraft {
  id: string
  question: string
  options: string[]
  correctIndex: number
}

export interface ProgramQuizDraft {
  id: string
  passPercent: number
  questionOrder: 'sequential' | 'shuffle'
  questions: ProgramQuizQuestionDraft[]
}

export interface WorkoutProgramExerciseDraft {
  id: string
  name: string
  sets: number
  reps: string
  rest: number
  rpe: number
  tags: string[]
  notes: string
}

export interface WorkoutProgramSessionDraft {
  id: string
  dayLabel: string
  focus: string
  durationMinutes: number
  tags: string[]
  coachNotes: string
  exercises: WorkoutProgramExerciseDraft[]
  resources: ProgramResourceDraft[]
  quiz: ProgramQuizDraft
}

export interface WorkoutProgramDraftInput {
  id?: string
  schemaVersion?: 2
  /** Stable id for the immutable program version referenced by course lessons. */
  versionId?: string
  title: string
  description: string
  durationWeeks: number
  daysPerWeek: number
  status: 'draft' | 'review' | 'published'
  /** Legacy V1 mirror of week 1. Kept while existing workout clients migrate. */
  sessionsByDay: Record<number, WorkoutProgramSessionDraft>
  /** V2 source of truth. Each week owns an independent set of sessions. */
  weeksByWeek?: Record<number, WorkoutProgramWeekDraft>
}

export interface WorkoutProgramWeekDraft {
  weekNumber: number
  label?: string
  sessionsByDay: Record<number, WorkoutProgramSessionDraft>
}

export type PublicationStatus = 'draft' | 'review' | 'scheduled' | 'published' | 'archived'
export type CourseLessonType = 'Video' | 'Bài đọc' | 'Quiz' | 'Buổi tập'

export type LessonResourceKind = 'slide' | 'video' | 'document'

export interface LessonResourceDraft {
  id: string
  kind: LessonResourceKind
  title: string
  url: string
  note?: string
  assetRef?: MediaAssetReference
  isPrimary?: boolean
}

export interface LessonQuizQuestionDraft {
  id: string
  question: string
  options: string[]
  /** @deprecated Admin-only legacy field. It is stripped before a course is persisted. */
  correctIndex?: number
}

export interface LessonQuizPublicSettings {
  maxAttempts?: number
  timeLimitMinutes?: number
  revealMode?: 'never' | 'after-submit' | 'after-pass'
}

export interface LessonQuizDraft {
  id: string
  passPercent: number
  questionOrder: 'sequential' | 'shuffle'
  publicSettings?: LessonQuizPublicSettings
  questions: LessonQuizQuestionDraft[]
}

/** Admin/editor-only answer state. Never write this object to the public course document. */
export type CourseQuizAnswerKeys = Record<string, Record<string, number[]>>

export interface CourseLessonDraft {
  id: string
  title: string
  type: CourseLessonType
  duration: string
  preview?: boolean
  summary?: string
  resources?: LessonResourceDraft[]
  tags?: string[]
  coachNotes?: string
  memory?: AcademyLessonMemory
  quiz?: LessonQuizDraft
  primaryContent?: LessonPrimaryContent
  completionPolicy?: LessonCompletionPolicy
  workoutRef?: LessonWorkoutReference
}

export interface CourseModuleDraft {
  id: string
  title: string
  order: number
  lessons: CourseLessonDraft[]
}

export interface CourseSettings {
  accessTier: 'free' | 'pro'
  completionPercent: number
  certificateEnabled: boolean
  dripSchedule: 'none' | 'weekly'
  visibility: 'members' | 'private'
}

export interface CourseDraftInput {
  id: string
  schemaVersion?: 2
  /** Editor-only keys, persisted into courses/{courseId}/quizKeys/{lessonId}. */
  quizAnswerKeys?: CourseQuizAnswerKeys
  coverUrl?: string
  title: string
  slug: string
  description: string
  category: string
  level: string
  coach: string
  duration: string
  outcomes: string[]
  requirements: string[]
  modules: CourseModuleDraft[]
  settings: CourseSettings
  publicationStatus: PublicationStatus
}

export interface Lesson {
  id: number
  title: string
  type: 'Video' | 'Bài đọc' | 'Quiz' | 'Buổi tập'
  duration: string
  completed?: boolean
  active?: boolean
}

export interface Exercise {
  id: number
  name: string
  target: string
  sets: number
  reps: string
  rest: number
  icon: string
  color: string
}

export interface WorkoutLogInput {
  clientLogId: string
  programId: string
  sessionId: string
  versionId: string
  title: string
  durationSeconds: number
  completedSets: number
  totalLoadKg: number
  perceivedExertion: number
  readiness?: number
  sleepQuality?: number
  painNote?: string
  sets: Array<{
    exerciseId: string
    exerciseName: string
    setNumber: number
    weightKg: number
    reps: number
  }>
}
