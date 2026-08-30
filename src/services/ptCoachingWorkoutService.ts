import { firebaseFunctions } from '../lib/firebaseFunctions'
import { httpsCallable } from 'firebase/functions'
import type { LessonWorkoutReference, WorkoutLogInput } from '../types'
import type { RuntimeWorkoutProgram } from './workoutProgramService'

function requireDocumentId(value: string, label: string) {
  const normalized = value.trim()
  if (!normalized || normalized.includes('/') || normalized.length > 1_500) throw new Error(`${label} không hợp lệ.`)
  return normalized
}

export async function savePtWorkoutLog(userId: string, input: WorkoutLogInput) {
  if (!firebaseFunctions) throw new Error('Dịch vụ PT Coaching chưa sẵn sàng.')
  const clientId = requireDocumentId(userId, 'UID khách hàng')
  const callable = httpsCallable<{ log: WorkoutLogInput }, { userId: string; logId: string }>(firebaseFunctions, 'savePtWorkoutLog')
  const response = await callable({ log: input })
  if (response.data?.userId !== clientId) throw new Error('Nhật ký PT trả về sai tài khoản.')
  return response.data
}

export interface CompletedPtProgram {
  programCompleted: true
  programId: string
  versionId: string
  programTitle: string
  completedSessionCount: number
  totalSessions: number
}

export interface ActivePtWorkout {
  programCompleted: false
  workoutRef: LessonWorkoutReference
  runtime: RuntimeWorkoutProgram
}

/**
 * Resolves the next session from the active PT assignment. The callable owns
 * week/session selection so the client never lists an unpublished version.
 */
export async function loadAssignedPtWorkout(): Promise<{
  programCompleted: false
  workoutRef: LessonWorkoutReference
  runtime: RuntimeWorkoutProgram
} | CompletedPtProgram> {
  if (!firebaseFunctions) throw new Error('Dịch vụ PT Coaching chưa sẵn sàng.')
  const callable = httpsCallable<Record<string, never>, unknown>(firebaseFunctions, 'getPtAssignedWorkout')
  const response = await callable({})
  const data = response.data && typeof response.data === 'object' ? response.data as Record<string, unknown> : {}
  const programId = requireDocumentId(String(data.programId ?? ''), 'Mã giáo án')
  const versionId = requireDocumentId(String(data.versionId ?? ''), 'Mã phiên bản')
  const programTitle = typeof data.programTitle === 'string' ? data.programTitle : 'Giáo án PT Aura'
  if (data.programCompleted === true) {
    return {
      programCompleted: true,
      programId,
      versionId,
      programTitle,
      completedSessionCount: typeof data.completedSessionCount === 'number' ? Math.max(0, Math.round(data.completedSessionCount)) : 0,
      totalSessions: typeof data.totalSessions === 'number' ? Math.max(0, Math.round(data.totalSessions)) : 0,
    }
  }
  const session = data.session && typeof data.session === 'object' ? data.session as Record<string, unknown> : null
  const sessionId = requireDocumentId(String(data.sessionId ?? session?.id ?? ''), 'Mã buổi tập')
  if (!session || !Array.isArray(session.exercises) || !session.exercises.length) throw new Error('Buổi tập được phân công chưa có bài tập.')
  const workoutRef = { programId, versionId, sessionId }
  const runtime: RuntimeWorkoutProgram = {
    programId,
    versionId,
    programTitle,
    weekNumber: typeof data.weekNumber === 'number' ? data.weekNumber : undefined,
    session: {
      id: sessionId,
      dayLabel: typeof session.dayLabel === 'string' ? session.dayLabel : 'Buổi tập PT',
      focus: typeof session.focus === 'string' ? session.focus : '',
      durationMinutes: typeof session.durationMinutes === 'number' ? session.durationMinutes : 45,
      coachNotes: typeof session.coachNotes === 'string' ? session.coachNotes : '',
      exercises: session.exercises.flatMap((raw, index) => {
        if (!raw || typeof raw !== 'object') return []
        const exercise = raw as Record<string, unknown>
        const name = typeof exercise.name === 'string' ? exercise.name.trim() : ''
        if (!name) return []
        return [{
          id: typeof exercise.id === 'string' && exercise.id ? exercise.id : `exercise-${index + 1}`,
          name,
          sets: typeof exercise.sets === 'number' ? Math.max(1, Math.round(exercise.sets)) : 1,
          reps: typeof exercise.reps === 'string' && exercise.reps ? exercise.reps : '10',
          rest: typeof exercise.rest === 'number' ? Math.max(0, Math.round(exercise.rest)) : 60,
          rpe: typeof exercise.rpe === 'number' ? Math.max(1, Math.min(10, Math.round(exercise.rpe))) : 7,
          tags: Array.isArray(exercise.tags) ? exercise.tags.filter((tag): tag is string => typeof tag === 'string') : [],
          notes: typeof exercise.notes === 'string' ? exercise.notes : '',
        }]
      }),
    },
  }
  if (!runtime.session.exercises.length) throw new Error('Buổi tập được phân công chưa có bài tập hợp lệ.')
  return { programCompleted: false, workoutRef, runtime }
}
