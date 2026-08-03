import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebase'
import type { LessonWorkoutReference } from '../types'

export interface RuntimeWorkoutExercise {
  id: string
  name: string
  sets: number
  reps: string
  rest: number
  rpe: number
  tags: string[]
  notes: string
}

export interface RuntimeWorkoutSession {
  id: string
  dayLabel: string
  focus: string
  durationMinutes: number
  coachNotes: string
  exercises: RuntimeWorkoutExercise[]
}

export interface RuntimeWorkoutProgram {
  programId: string
  programTitle: string
  versionId: string
  weekNumber?: number
  session: RuntimeWorkoutSession
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Dữ liệu giáo án thiếu ${label}.`)
  }
  return value.trim()
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Dữ liệu giáo án có ${label} không hợp lệ.`)
  }
  return value
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map((item) => item.trim())
    .slice(0, 12)
}

function parseExercise(value: unknown, index: number): RuntimeWorkoutExercise {
  if (!isRecord(value)) throw new Error(`Bài tập số ${index + 1} không hợp lệ.`)
  return {
    id: requiredString(value.id, `mã bài tập số ${index + 1}`),
    name: requiredString(value.name, `tên bài tập số ${index + 1}`),
    sets: boundedInteger(value.sets, 1, 100, `số hiệp của bài tập số ${index + 1}`),
    reps: requiredString(value.reps, `số lần của bài tập số ${index + 1}`),
    rest: boundedInteger(value.rest, 0, 3_600, `thời gian nghỉ của bài tập số ${index + 1}`),
    rpe: typeof value.rpe === 'number' && Number.isFinite(value.rpe)
      ? Math.min(10, Math.max(1, Math.round(value.rpe)))
      : 7,
    tags: stringList(value.tags),
    notes: typeof value.notes === 'string' ? value.notes.trim().slice(0, 4_000) : '',
  }
}

function parseSession(value: unknown, expectedSessionId: string): RuntimeWorkoutSession {
  if (!isRecord(value) || value.id !== expectedSessionId) {
    throw new Error('Buổi tập liên kết không hợp lệ.')
  }
  const exercises = Array.isArray(value.exercises)
    ? value.exercises.map(parseExercise)
    : []
  if (!exercises.length) throw new Error('Buổi tập chưa có bài tập nào.')
  if (new Set(exercises.map((item) => item.id)).size !== exercises.length) {
    throw new Error('Buổi tập có mã bài tập bị trùng.')
  }

  return {
    id: expectedSessionId,
    dayLabel: typeof value.dayLabel === 'string' && value.dayLabel.trim()
      ? value.dayLabel.trim()
      : 'Buổi tập Aura',
    focus: typeof value.focus === 'string' ? value.focus.trim() : '',
    durationMinutes: typeof value.durationMinutes === 'number' && Number.isFinite(value.durationMinutes)
      ? Math.min(24 * 60, Math.max(1, Math.round(value.durationMinutes)))
      : 45,
    coachNotes: typeof value.coachNotes === 'string' ? value.coachNotes.trim().slice(0, 4_000) : '',
    exercises,
  }
}

function assertDocumentId(value: string, label: string) {
  if (!value || value.length > 1_500 || value.includes('/') || /^__.*__$/.test(value)) {
    throw new Error(`${label} không hợp lệ.`)
  }
}

/**
 * Resolves a lesson's immutable workout snapshot through the entitlement-aware
 * callable. There is deliberately no direct Firestore or parent-program
 * fallback: a missing/malformed version fails closed so a learner can never be
 * served a newer or unauthorized workout.
 */
export async function loadWorkoutProgramSession(
  input: {
    courseId: string
    lessonId: string
    workoutRef: LessonWorkoutReference
  },
): Promise<RuntimeWorkoutProgram> {
  if (!firebaseFunctions) throw new Error('Dịch vụ giáo án chưa sẵn sàng.')
  const { courseId, lessonId, workoutRef } = input
  assertDocumentId(courseId, 'Mã khóa học')
  assertDocumentId(lessonId, 'Mã bài học')
  assertDocumentId(workoutRef.programId, 'Mã giáo án')
  assertDocumentId(workoutRef.versionId, 'Mã phiên bản')
  assertDocumentId(workoutRef.sessionId, 'Mã buổi tập')

  const payload = {
    courseId,
    lessonId,
    programId: workoutRef.programId,
    sessionId: workoutRef.sessionId,
    versionId: workoutRef.versionId,
  }
  const callable = httpsCallable<typeof payload, unknown>(firebaseFunctions, 'getCourseWorkoutSession')
  const response = await callable(payload)
  if (!isRecord(response.data)) throw new Error('Phản hồi giáo án không hợp lệ.')
  const data = response.data
  if (
    data.programId !== workoutRef.programId
    || data.versionId !== workoutRef.versionId
    || data.sessionId !== workoutRef.sessionId
  ) throw new Error('Định danh phiên bản giáo án không khớp với bài học.')

  return {
    programId: workoutRef.programId,
    programTitle: typeof data.title === 'string' && data.title.trim()
      ? data.title.trim()
      : typeof data.programTitle === 'string' && data.programTitle.trim()
        ? data.programTitle.trim()
        : 'Giáo án Aura Fitness',
    versionId: workoutRef.versionId,
    weekNumber: typeof data.weekNumber === 'number' && Number.isInteger(data.weekNumber)
      ? data.weekNumber
      : undefined,
    session: parseSession(data.session, workoutRef.sessionId),
  }
}
