import { httpsCallable } from 'firebase/functions'
import { collection, doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { firebaseAuth, firebaseFunctions, firestoreDb } from '../lib/firebase'
import type { LessonWorkoutReference, WorkoutProgramDraftInput, WorkoutProgramExerciseDraft, WorkoutProgramSessionDraft } from '../types'
import type { RuntimeWorkoutProgram } from './workoutProgramService'

const META_PREFIX = 'pt:'
const RIR_PREFIX = `${META_PREFIX}rir:`
const TEMPO_PREFIX = `${META_PREFIX}tempo:`
const SUBSTITUTE_PREFIX = `${META_PREFIX}substitute:`

export interface PtExercisePrescription {
  rir: number
  tempo: string
  substitute: string
}

export interface ManagedPtProgramSummary {
  id: string
  title: string
  description: string
  status: WorkoutProgramDraftInput['status']
  coachId: string
  currentVersionId: string
  durationWeeks: number
  daysPerWeek: number
  updatedAt: string | null
}

function draftQuiz(sessionId: string) {
  return {
    id: `quiz-${sessionId}`,
    passPercent: 70,
    questionOrder: 'sequential' as const,
    questions: [],
  }
}

function draftSession(value: unknown, fallbackId: string): WorkoutProgramSessionDraft {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const id = typeof data.id === 'string' && data.id ? data.id : fallbackId
  const exercises = Array.isArray(data.exercises) ? data.exercises.flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object') return []
    const exercise = raw as Record<string, unknown>
    const name = typeof exercise.name === 'string' ? exercise.name : ''
    if (!name.trim()) return []
    return [{
      id: typeof exercise.id === 'string' && exercise.id ? exercise.id : `${id}-exercise-${index + 1}`,
      name,
      catalogExerciseId: typeof exercise.catalogExerciseId === 'string' ? exercise.catalogExerciseId : undefined,
      catalogRevision: typeof exercise.catalogRevision === 'number' ? exercise.catalogRevision : undefined,
      origin: exercise.origin === 'catalog' ? 'catalog' as const : 'custom' as const,
      exerciseSnapshot: exercise.exerciseSnapshot && typeof exercise.exerciseSnapshot === 'object'
        ? structuredClone(exercise.exerciseSnapshot) as WorkoutProgramExerciseDraft['exerciseSnapshot']
        : undefined,
      sets: typeof exercise.sets === 'number' ? Math.max(1, Math.round(exercise.sets)) : 1,
      reps: typeof exercise.reps === 'string' ? exercise.reps : '10',
      rest: typeof exercise.rest === 'number' ? Math.max(0, Math.round(exercise.rest)) : 60,
      rpe: typeof exercise.rpe === 'number' ? Math.max(1, Math.min(10, Math.round(exercise.rpe))) : 7,
      tags: Array.isArray(exercise.tags) ? exercise.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      notes: typeof exercise.notes === 'string' ? exercise.notes : '',
    }]
  }) : []
  const resources: WorkoutProgramSessionDraft['resources'] = Array.isArray(data.resources) ? data.resources.flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object') return []
    const resource = raw as Record<string, unknown>
    const kind: WorkoutProgramSessionDraft['resources'][number]['kind'] = resource.kind === 'slide' || resource.kind === 'video' ? resource.kind : 'document'
    return [{
      id: typeof resource.id === 'string' && resource.id ? resource.id : `${id}-resource-${index + 1}`,
      kind,
      title: typeof resource.title === 'string' ? resource.title : '',
      url: typeof resource.url === 'string' ? resource.url : '',
      note: typeof resource.note === 'string' ? resource.note : '',
    }]
  }) : []
  return {
    id,
    dayLabel: typeof data.dayLabel === 'string' ? data.dayLabel : 'Buổi tập',
    focus: typeof data.focus === 'string' ? data.focus : '',
    durationMinutes: typeof data.durationMinutes === 'number' ? Math.max(1, Math.round(data.durationMinutes)) : 45,
    tags: Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    coachNotes: typeof data.coachNotes === 'string' ? data.coachNotes : '',
    exercises,
    resources,
    quiz: draftQuiz(id),
  }
}

function draftSessions(value: unknown, weekNumber: number) {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([dayKey, session]) => {
    const day = Number(dayKey)
    if (!Number.isInteger(day) || day < 1 || day > 7) return []
    return [[day, draftSession(session, `session-w${weekNumber}-d${day}`)]]
  })) as WorkoutProgramDraftInput['sessionsByDay']
}

function decodeMetadata(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function readPtExercisePrescription(tags: string[]): PtExercisePrescription {
  const rirTag = tags.find((tag) => tag.startsWith(RIR_PREFIX))
  const parsedRir = Number(rirTag?.slice(RIR_PREFIX.length))
  const tempoTag = tags.find((tag) => tag.startsWith(TEMPO_PREFIX))
  const substituteTag = tags.find((tag) => tag.startsWith(SUBSTITUTE_PREFIX))

  return {
    rir: Number.isFinite(parsedRir) ? Math.min(5, Math.max(0, Math.round(parsedRir))) : 3,
    tempo: decodeMetadata(tempoTag?.slice(TEMPO_PREFIX.length) ?? '') || '2-0-2-0',
    substitute: decodeMetadata(substituteTag?.slice(SUBSTITUTE_PREFIX.length) ?? ''),
  }
}

export function writePtExercisePrescription(
  exercise: WorkoutProgramExerciseDraft,
  patch: Partial<PtExercisePrescription>,
): string[] {
  const current = readPtExercisePrescription(exercise.tags)
  const next = { ...current, ...patch }
  const visibleTags = exercise.tags.filter((tag) => !tag.startsWith(META_PREFIX))
  return [
    ...visibleTags,
    `${RIR_PREFIX}${Math.min(5, Math.max(0, Math.round(next.rir)))}`,
    `${TEMPO_PREFIX}${encodeURIComponent(next.tempo.trim() || '2-0-2-0')}`,
    ...(next.substitute.trim()
      ? [`${SUBSTITUTE_PREFIX}${encodeURIComponent(next.substitute.trim())}`]
      : []),
  ]
}

export function visibleExerciseTags(tags: string[]) {
  return tags.filter((tag) => !tag.startsWith(META_PREFIX))
}

function coachingSessionForWrite(session: WorkoutProgramSessionDraft) {
  return {
    id: session.id,
    dayLabel: session.dayLabel,
    focus: session.focus,
    durationMinutes: session.durationMinutes,
    tags: session.tags,
    coachNotes: session.coachNotes,
    resources: session.resources
      .filter((resource) => resource.title.trim() && resource.url.trim())
      .slice(0, 24)
      .map((resource) => ({
        id: resource.id,
        kind: ['slide', 'video', 'document'].includes(resource.kind) ? resource.kind : 'document',
        title: resource.title.trim().slice(0, 200),
        url: resource.url.trim().slice(0, 2_000),
        note: (resource.note ?? '').trim().slice(0, 1_000),
      })),
    exercises: session.exercises.map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      origin: exercise.origin ?? (exercise.catalogExerciseId ? 'catalog' : 'custom'),
      ...(exercise.catalogExerciseId ? { catalogExerciseId: exercise.catalogExerciseId } : {}),
      ...(exercise.catalogRevision ? { catalogRevision: exercise.catalogRevision } : {}),
      ...(exercise.exerciseSnapshot ? { exerciseSnapshot: structuredClone(exercise.exerciseSnapshot) } : {}),
      sets: exercise.sets,
      reps: exercise.reps,
      rest: exercise.rest,
      rpe: exercise.rpe,
      tags: exercise.tags,
      notes: exercise.notes,
    })),
  }
}

function validatePtProgram(input: WorkoutProgramDraftInput) {
  if (!input.title.trim()) throw new Error('Hãy nhập tên giáo án PT.')
  if (!input.description.trim()) throw new Error('Hãy nhập mục tiêu và đối tượng của giáo án.')
  if (input.durationWeeks < 1 || input.durationWeeks > 24) throw new Error('Giáo án PT cần từ 1 đến 24 tuần.')
  if (input.daysPerWeek < 1 || input.daysPerWeek > 7) throw new Error('Số buổi mỗi tuần cần từ 1 đến 7.')
  if (input.status === 'draft') return

  const weeks = input.weeksByWeek ?? { 1: { weekNumber: 1, label: 'Tuần 1', sessionsByDay: input.sessionsByDay } }
  for (let weekNumber = 1; weekNumber <= input.durationWeeks; weekNumber += 1) {
    const week = weeks[weekNumber]
    if (!week) throw new Error(`Tuần ${weekNumber} chưa được cấu hình.`)
    for (let day = 1; day <= input.daysPerWeek; day += 1) {
      const session = week.sessionsByDay[day]
      if (!session?.dayLabel.trim() || !session.exercises.length) throw new Error(`Tuần ${weekNumber}, buổi ${day} chưa có bài tập.`)
      session.exercises.forEach((exercise, index) => {
        if (!exercise.name.trim() || exercise.sets < 1 || !exercise.reps.trim()) {
          throw new Error(`Tuần ${weekNumber}, buổi ${day}, bài ${index + 1} chưa có chỉ định hợp lệ.`)
        }
      })
    }
  }
}

export async function listManagedPtPrograms(): Promise<ManagedPtProgramSummary[]> {
  if (!firebaseFunctions) return []
  const callable = httpsCallable<{ limit: number }, unknown>(firebaseFunctions, 'listManagedPtPrograms')
  const response = await callable({ limit: 300 })
  const data = response.data && typeof response.data === 'object' ? response.data as Record<string, unknown> : {}
  if (!Array.isArray(data.programs)) return []
  return data.programs.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const program = raw as Record<string, unknown>
    const status = program.status === 'review' || program.status === 'published' ? program.status : 'draft'
    if (typeof program.id !== 'string' || typeof program.title !== 'string'
        || typeof program.coachId !== 'string' || typeof program.currentVersionId !== 'string') return []
    return [{
      id: program.id,
      title: program.title,
      description: typeof program.description === 'string' ? program.description : '',
      status,
      coachId: program.coachId,
      currentVersionId: program.currentVersionId,
      durationWeeks: typeof program.durationWeeks === 'number' ? program.durationWeeks : 1,
      daysPerWeek: typeof program.daysPerWeek === 'number' ? program.daysPerWeek : 1,
      updatedAt: typeof program.updatedAt === 'string' ? program.updatedAt : null,
    }]
  })
}

export async function loadManagedPtProgram(programId: string, versionId: string): Promise<WorkoutProgramDraftInput> {
  if (!firestoreDb) throw new Error('Firebase PT Coaching chưa sẵn sàng.')
  if (!programId || !versionId || programId.includes('/') || versionId.includes('/')) {
    throw new Error('Mã giáo án hoặc phiên bản không hợp lệ.')
  }
  const programReference = doc(firestoreDb, 'coachingPrograms', programId)
  const [programSnapshot, versionSnapshot] = await Promise.all([
    getDoc(programReference),
    getDoc(doc(programReference, 'versions', versionId)),
  ])
  if (!programSnapshot.exists() || !versionSnapshot.exists()) throw new Error('Không tìm thấy phiên bản giáo án PT.')
  const program = programSnapshot.data()
  const version = versionSnapshot.data()
  if (program.domain !== 'pt-coaching' || version.domain !== 'pt-coaching'
      || version.programId !== programId || version.versionId !== versionId) {
    throw new Error('Phiên bản giáo án không thuộc PT Coaching.')
  }
  if (program.currentVersionId !== versionId) {
    throw new Error('Giáo án đã có phiên bản mới hơn. Hãy tải lại kho giáo án.')
  }
  const weeksByWeek = version.weeksByWeek && typeof version.weeksByWeek === 'object'
    ? Object.fromEntries(Object.entries(version.weeksByWeek as Record<string, unknown>).flatMap(([weekKey, rawWeek]) => {
        const weekNumber = Number(weekKey)
        if (!Number.isInteger(weekNumber) || weekNumber < 1 || !rawWeek || typeof rawWeek !== 'object') return []
        const week = rawWeek as Record<string, unknown>
        return [[weekNumber, {
          weekNumber,
          label: typeof week.label === 'string' ? week.label : `Tuần ${weekNumber}`,
          sessionsByDay: draftSessions(week.sessionsByDay, weekNumber),
        }]]
      }))
    : { 1: { weekNumber: 1, label: 'Tuần 1', sessionsByDay: draftSessions(version.sessionsByDay, 1) } }
  const status: WorkoutProgramDraftInput['status'] = program.status === 'review' || program.status === 'published'
    ? program.status
    : 'draft'
  return {
    id: programId,
    schemaVersion: 2,
    versionId,
    title: typeof program.title === 'string' ? program.title : 'Giáo án PT',
    description: typeof program.description === 'string' ? program.description : '',
    durationWeeks: typeof program.durationWeeks === 'number' ? program.durationWeeks : 1,
    daysPerWeek: typeof program.daysPerWeek === 'number' ? program.daysPerWeek : 1,
    status,
    sessionsByDay: weeksByWeek[1]?.sessionsByDay ?? {},
    weeksByWeek,
  }
}

/** Persists a PT-only program and creates a new immutable version on every save. */
export async function savePtWorkoutProgram(input: WorkoutProgramDraftInput) {
  if (!firestoreDb || !firebaseAuth?.currentUser) throw new Error('Firebase PT Coaching chưa sẵn sàng.')
  validatePtProgram(input)
  const coachId = firebaseAuth.currentUser.uid
  const reference = input.id
    ? doc(firestoreDb, 'coachingPrograms', input.id)
    : doc(collection(firestoreDb, 'coachingPrograms'))
  const versionId = `pt-program-version-${crypto.randomUUID()}`
  const sourceWeeks = input.weeksByWeek ?? { 1: { weekNumber: 1, label: 'Tuần 1', sessionsByDay: input.sessionsByDay } }
  const weeksByWeek = Object.fromEntries(Object.entries(sourceWeeks).map(([weekKey, week]) => [
    weekKey,
    {
      weekNumber: week.weekNumber,
      label: week.label ?? `Tuần ${week.weekNumber}`,
      sessionsByDay: Object.fromEntries(Object.entries(week.sessionsByDay).map(([dayKey, session]) => [dayKey, coachingSessionForWrite(session)])),
    },
  ]))
  const sessionsByDay = weeksByWeek[1]?.sessionsByDay ?? {}
  const versionReference = doc(reference, 'versions', versionId)
  await runTransaction(firestoreDb, async (transaction) => {
    const existing = input.id ? await transaction.get(reference) : null
    if (input.id && !existing?.exists()) throw new Error('Giáo án không còn tồn tại. Hãy tải lại kho giáo án.')
    const existingData = existing?.data()
    if (existingData?.status === 'published') {
      throw new Error('Giáo án đã xuất bản là bản chỉ đọc. Hãy nhân bản để tạo chu kỳ chỉnh sửa mới.')
    }
    if (existing?.exists() && (!input.versionId || existingData?.currentVersionId !== input.versionId)) {
      throw new Error('Giáo án đã có version mới hơn. Hãy tải lại trước khi lưu để tránh ghi đè thay đổi của người khác.')
    }
    const ownerId = existing?.exists() && typeof existingData?.coachId === 'string'
      ? existingData.coachId
      : coachId
    const canonical = {
      schemaVersion: 2,
      domain: 'pt-coaching',
      coachId: ownerId,
      title: input.title.trim(),
      description: input.description.trim(),
      durationWeeks: input.durationWeeks,
      daysPerWeek: input.daysPerWeek,
      status: input.status,
    }
    transaction.set(versionReference, {
      ...canonical,
      programId: reference.id,
      versionId,
      sessionsByDay,
      weeksByWeek,
      createdAt: serverTimestamp(),
    })
    transaction.set(reference, {
      ...canonical,
      currentVersionId: versionId,
      updatedAt: serverTimestamp(),
      ...(!existing?.exists() ? { createdAt: serverTimestamp() } : {}),
    }, { merge: true })
  })
  return { programId: reference.id, versionId }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Giáo án PT thiếu ${label}.`)
  return value.trim()
}

function parseRuntimeProgram(value: unknown, expected: LessonWorkoutReference): RuntimeWorkoutProgram {
  if (!isRecord(value) || !isRecord(value.session)) throw new Error('Phản hồi giáo án PT không hợp lệ.')
  if (value.programId !== expected.programId || value.versionId !== expected.versionId) {
    throw new Error('Phiên bản giáo án PT không khớp với phân công.')
  }
  const rawSession = value.session
  if (rawSession.id !== expected.sessionId || !Array.isArray(rawSession.exercises) || !rawSession.exercises.length) {
    throw new Error('Buổi tập PT không hợp lệ hoặc chưa có bài tập.')
  }

  return {
    programId: expected.programId,
    versionId: expected.versionId,
    programTitle: typeof value.programTitle === 'string' && value.programTitle.trim()
      ? value.programTitle.trim()
      : typeof value.title === 'string' && value.title.trim()
        ? value.title.trim()
        : 'Giáo án PT',
    weekNumber: typeof value.weekNumber === 'number' ? value.weekNumber : undefined,
    session: {
      id: expected.sessionId,
      dayLabel: requiredString(rawSession.dayLabel, 'tên buổi tập'),
      focus: typeof rawSession.focus === 'string' ? rawSession.focus.trim() : '',
      durationMinutes: typeof rawSession.durationMinutes === 'number'
        ? Math.max(1, Math.min(1_440, Math.round(rawSession.durationMinutes)))
        : 45,
      coachNotes: typeof rawSession.coachNotes === 'string' ? rawSession.coachNotes.trim() : '',
      exercises: rawSession.exercises.map((item, index) => {
        if (!isRecord(item)) throw new Error(`Bài tập số ${index + 1} không hợp lệ.`)
        return {
          id: requiredString(item.id, `mã bài tập số ${index + 1}`),
          name: requiredString(item.name, `tên bài tập số ${index + 1}`),
          sets: typeof item.sets === 'number' ? Math.max(1, Math.min(100, Math.round(item.sets))) : 1,
          reps: requiredString(item.reps, `số lần lặp của bài tập số ${index + 1}`),
          rest: typeof item.rest === 'number' ? Math.max(0, Math.min(3_600, Math.round(item.rest))) : 60,
          rpe: typeof item.rpe === 'number' ? Math.max(1, Math.min(10, Math.round(item.rpe))) : 7,
          tags: Array.isArray(item.tags)
            ? item.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 20)
            : [],
          notes: typeof item.notes === 'string' ? item.notes.trim() : '',
        }
      }),
    },
  }
}

/** Loads only the immutable session assigned to the signed-in PT client. */
export async function loadPtWorkoutSession(workoutRef: LessonWorkoutReference) {
  if (!firebaseFunctions) throw new Error('Dịch vụ PT Coaching chưa sẵn sàng.')
  const payload = {
    programId: workoutRef.programId,
    versionId: workoutRef.versionId,
    sessionId: workoutRef.sessionId,
  }
  const callable = httpsCallable<typeof payload, unknown>(firebaseFunctions, 'getPtWorkoutSession')
  const response = await callable(payload)
  return parseRuntimeProgram(response.data, workoutRef)
}
