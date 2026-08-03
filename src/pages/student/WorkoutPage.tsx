import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Dumbbell,
  HeartPulse,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Sparkles,
  ShieldCheck,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { workoutExercises } from '../../data'
import { useAuth } from '../../contexts/AuthContext'
import { isFirebaseConfigured } from '../../lib/firebase'
import type { LessonWorkoutReference, ViewId, WorkoutLogInput } from '../../types'
import {
  loadWorkoutProgramSession,
  type RuntimeWorkoutExercise,
  type RuntimeWorkoutProgram,
} from '../../services/workoutProgramService'
import { loadPtWorkoutSession, readPtExercisePrescription, visibleExerciseTags } from '../../services/ptCoachingProgramService'
import { loadAssignedPtWorkout, type CompletedPtProgram } from '../../services/ptCoachingWorkoutService'
import '../../styles-coaching.css'

const DEMO_WORKOUT_REF: LessonWorkoutReference = {
  programId: 'foundation-strength-8-week',
  sessionId: 'week-3-full-body-a',
  versionId: 'demo-v1',
}
const WORKOUT_DRAFT_KEY_PREFIX = 'aura-workout-draft:v2'
const DRAFT_VERSION = 2
const MAX_WORKOUT_SECONDS = 24 * 60 * 60
const EXERCISE_COLORS = ['purple', 'green', 'orange', 'pink', 'blue']

type CompletedSet = WorkoutLogInput['sets'][number]
type CompletedSets = Record<string, CompletedSet[]>
type SetInput = { weightKg: number; reps: number }
type SetInputs = Record<string, SetInput>

interface WorkoutDraft {
  version: number
  clientLogId: string
  programId: string
  sessionId: string
  versionId: string
  exerciseIndex: number
  completedSets: CompletedSets
  setInputs: SetInputs
  elapsed: number
  paused: boolean
  rest: number
  finished: boolean
  perceivedExertion: number
  readiness: number
  sleepQuality: number
  painNote: string
}

interface WorkoutPageProps {
  onNavigate: (view: ViewId) => void
  onSave?: (log: WorkoutLogInput) => Promise<void>
  onExit?: () => void
  courseId?: string
  lessonId?: string
  workoutRef?: LessonWorkoutReference
  workoutTitle?: string
}

interface WorkoutSessionPlayerProps extends WorkoutPageProps {
  workoutRef: LessonWorkoutReference
  runtime: RuntimeWorkoutProgram
}

function clampNumber(value: unknown, minimum: number, maximum: number, fallback: number) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback
}

function defaultReps(repsLabel: string) {
  const firstNumber = repsLabel.match(/\d+/)?.[0]
  return Math.round(clampNumber(firstNumber, 1, 1_000, 10))
}

function getDefaultSetInputs(exercises: RuntimeWorkoutExercise[]): SetInputs {
  return Object.fromEntries(exercises.map((item) => [
    item.id,
    { weightKg: 16, reps: defaultReps(item.reps) },
  ]))
}

function countCompletedSets(completedSets: CompletedSets) {
  return Object.values(completedSets).reduce((total, sets) => total + sets.length, 0)
}

function createClientLogId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `workout-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

function sanitizeDraft(
  value: unknown,
  workoutRef: LessonWorkoutReference,
  exercises: RuntimeWorkoutExercise[],
): WorkoutDraft | null {
  if (!value || typeof value !== 'object') return null
  const draft = value as Partial<WorkoutDraft>
  if (
    draft.version !== DRAFT_VERSION
    || draft.programId !== workoutRef.programId
    || draft.sessionId !== workoutRef.sessionId
    || draft.versionId !== workoutRef.versionId
  ) return null

  const rawCompletedSets = draft.completedSets && typeof draft.completedSets === 'object'
    ? draft.completedSets
    : {}
  const rawSetInputs = draft.setInputs && typeof draft.setInputs === 'object'
    ? draft.setInputs
    : {}
  const completedSets: CompletedSets = {}
  const setInputs = getDefaultSetInputs(exercises)

  exercises.forEach((item) => {
    const candidateSets = (rawCompletedSets as Record<string, unknown>)[item.id]
    if (Array.isArray(candidateSets)) {
      completedSets[item.id] = candidateSets.slice(0, item.sets).map((candidate, index) => {
        const set = candidate && typeof candidate === 'object' ? candidate as Partial<CompletedSet> : {}
        return {
          exerciseId: item.id,
          exerciseName: item.name,
          setNumber: index + 1,
          weightKg: clampNumber(set.weightKg, 0, 1_000, 16),
          reps: Math.round(clampNumber(set.reps, 1, 1_000, defaultReps(item.reps))),
        }
      })
    }

    const candidateInput = (rawSetInputs as Record<string, unknown>)[item.id]
    if (candidateInput && typeof candidateInput === 'object') {
      const input = candidateInput as Partial<SetInput>
      setInputs[item.id] = {
        weightKg: clampNumber(input.weightKg, 0, 1_000, 16),
        reps: Math.round(clampNumber(input.reps, 1, 1_000, defaultReps(item.reps))),
      }
    }
  })

  const totalSets = exercises.reduce((total, item) => total + item.sets, 0)
  const allSetsComplete = countCompletedSets(completedSets) >= totalSets
  return {
    version: DRAFT_VERSION,
    clientLogId: typeof draft.clientLogId === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(draft.clientLogId)
      ? draft.clientLogId
      : createClientLogId(),
    programId: workoutRef.programId,
    sessionId: workoutRef.sessionId,
    versionId: workoutRef.versionId,
    exerciseIndex: Math.round(clampNumber(draft.exerciseIndex, 0, exercises.length - 1, 0)),
    completedSets,
    setInputs,
    elapsed: Math.round(clampNumber(draft.elapsed, 0, MAX_WORKOUT_SECONDS, 0)),
    paused: Boolean(draft.paused),
    rest: Math.round(clampNumber(draft.rest, 0, 60 * 60, 0)),
    finished: allSetsComplete && Boolean(draft.finished),
    perceivedExertion: Math.round(clampNumber(draft.perceivedExertion, 1, 4, 2)),
    readiness: Math.round(clampNumber(draft.readiness, 1, 5, 3)),
    sleepQuality: Math.round(clampNumber(draft.sleepQuality, 1, 5, 3)),
    painNote: typeof draft.painNote === 'string' ? draft.painNote.trim().slice(0, 1_000) : '',
  }
}

function getWorkoutDraftKey(userId: string | undefined, workoutRef: LessonWorkoutReference) {
  return `${WORKOUT_DRAFT_KEY_PREFIX}:${workoutRef.programId}:${workoutRef.sessionId}:${workoutRef.versionId}:${userId || 'demo'}`
}

function loadWorkoutDraft(
  storageKey: string,
  workoutRef: LessonWorkoutReference,
  exercises: RuntimeWorkoutExercise[],
) {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null
    const draft = sanitizeDraft(JSON.parse(raw), workoutRef, exercises)
    if (!draft) window.localStorage.removeItem(storageKey)
    return draft
  } catch {
    try {
      window.localStorage.removeItem(storageKey)
    } catch {
      // Local storage can be unavailable; the workout still works in memory.
    }
    return null
  }
}

function clearWorkoutDraft(storageKey: string) {
  try {
    window.localStorage.removeItem(storageKey)
  } catch {
    // Firebase remains the source of truth when local storage is unavailable.
  }
}

function createDemoRuntime(workoutRef: LessonWorkoutReference): RuntimeWorkoutProgram {
  return {
    programId: workoutRef.programId,
    programTitle: 'Giáo án Aura Fitness',
    versionId: workoutRef.versionId,
    session: {
      id: workoutRef.sessionId,
      dayLabel: 'Full Body Strength A',
      focus: 'Sức mạnh toàn thân',
      durationMinutes: 45,
      coachNotes: 'Ưu tiên kỹ thuật chuẩn và dừng lại nếu cảm thấy đau nhói.',
      exercises: workoutExercises.map((item) => ({
        id: String(item.id),
        name: item.name,
        sets: item.sets,
        reps: item.reps,
        rest: item.rest,
        rpe: 7,
        tags: [...item.target.split(' · '), 'pt:rir:3', 'pt:tempo:2-0-2-0'],
        notes: '',
      })),
    },
  }
}

export default function WorkoutPage(props: WorkoutPageProps) {
  const { courseId, lessonId, workoutRef: explicitWorkoutRef, onExit, onNavigate } = props
  const legacyCourseContext = Boolean(courseId || lessonId)
  const [reloadToken, setReloadToken] = useState(0)
  const [resolvedWorkoutRef, setResolvedWorkoutRef] = useState<LessonWorkoutReference | null>(() => (
    explicitWorkoutRef ?? (isFirebaseConfigured ? null : DEMO_WORKOUT_REF)
  ))
  const [runtime, setRuntime] = useState<RuntimeWorkoutProgram | null>(() => (
    isFirebaseConfigured ? null : createDemoRuntime(explicitWorkoutRef ?? DEMO_WORKOUT_REF)
  ))
  const [programCompletion, setProgramCompletion] = useState<CompletedPtProgram | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!isFirebaseConfigured) {
      const demoRef = explicitWorkoutRef ?? DEMO_WORKOUT_REF
      setResolvedWorkoutRef(demoRef)
      setRuntime(createDemoRuntime(demoRef))
      setProgramCompletion(null)
      setLoadError(null)
      return
    }
    let active = true
    setRuntime(null)
    setProgramCompletion(null)
    setLoadError(null)
    if (!explicitWorkoutRef) {
      loadAssignedPtWorkout()
        .then((result) => {
          if (!active) return
          if (result.programCompleted) {
            setResolvedWorkoutRef(null)
            setProgramCompletion(result)
            return
          }
          setResolvedWorkoutRef(result.workoutRef)
          setRuntime(result.runtime)
        })
        .catch((error: unknown) => {
          if (!active) return
          setLoadError(error instanceof Error ? error.message : 'Không thể tải buổi tập được PT phân công.')
        })
      return () => { active = false }
    }
    if (legacyCourseContext && (!courseId?.trim() || !lessonId?.trim())) {
      setLoadError('Liên kết buổi tập cũ thiếu thông tin xác thực.')
      return
    }
    const loader = legacyCourseContext
      ? loadWorkoutProgramSession({ courseId: courseId!, lessonId: lessonId!, workoutRef: explicitWorkoutRef })
      : loadPtWorkoutSession(explicitWorkoutRef)
    loader
      .then((result) => {
        if (!active) return
        setResolvedWorkoutRef(explicitWorkoutRef)
        setRuntime(result)
      })
      .catch((error: unknown) => {
        if (!active) return
        setLoadError(error instanceof Error ? error.message : 'Không thể tải phiên bản giáo án PT.')
      })
    return () => {
      active = false
    }
  }, [courseId, explicitWorkoutRef, legacyCourseContext, lessonId, reloadToken])

  const leaveWorkout = () => {
    if (onExit) onExit()
    else onNavigate('schedule')
  }

  if (loadError) {
    return (
      <div className="course-detail-state" role="alert">
        <Dumbbell size={34} />
        <h1>Chưa thể mở buổi tập PT</h1>
        <p>{loadError} Aura đã dừng tải để không hiển thị nhầm giáo án hoặc phiên bản chưa được PT gán.</p>
        <div className="inline-actions">
          <button type="button" className="primary-button" onClick={() => setReloadToken((value) => value + 1)}>Thử tải lại</button>
          <button type="button" className="secondary-button" onClick={leaveWorkout}>Quay lại lịch tập</button>
        </div>
      </div>
    )
  }

  if (programCompletion) {
    return (
      <div className="course-detail-state pt-program-complete" role="status">
        <div className="completion-mark"><Check size={40} strokeWidth={3} /></div>
        <span className="eyebrow">CHU KỲ PT HOÀN THÀNH</span>
        <h1>Bạn đã hoàn thành giáo án!</h1>
        <p>{programCompletion.programTitle} · {programCompletion.completedSessionCount}/{programCompletion.totalSessions} buổi đã lưu. PT sẽ đánh giá kết quả trước khi giao chu kỳ tiếp theo.</p>
        <button type="button" className="primary-button" onClick={leaveWorkout}>Quay lại lịch tập</button>
      </div>
    )
  }

  if (!runtime) {
    return (
      <div className="course-detail-state" aria-busy="true" aria-live="polite">
        <LoaderCircle className="spin" size={34} />
        <h1>Đang tải giáo án PT</h1>
        <p>Aura đang xác thực đúng phân công, phiên bản và buổi tập của khách hàng.</p>
      </div>
    )
  }

  const workoutRef = resolvedWorkoutRef ?? DEMO_WORKOUT_REF

  return (
    <WorkoutSessionPlayer
      {...props}
      key={`${runtime.programId}:${runtime.versionId}:${runtime.session.id}`}
      workoutRef={workoutRef}
      runtime={runtime}
    />
  )
}

function WorkoutSessionPlayer({
  onNavigate,
  onSave,
  onExit,
  workoutRef,
  workoutTitle,
  runtime,
}: WorkoutSessionPlayerProps) {
  const { user } = useAuth()
  const exercises = runtime.session.exercises
  const resolvedTitle = workoutTitle?.trim() || runtime.session.dayLabel || runtime.session.focus
  const workoutDraftKey = getWorkoutDraftKey(user?.uid, workoutRef)
  const [initialDraft] = useState<WorkoutDraft | null>(() => (
    loadWorkoutDraft(workoutDraftKey, workoutRef, exercises)
  ))
  const [clientLogId] = useState(() => initialDraft?.clientLogId ?? createClientLogId())
  const [exerciseIndex, setExerciseIndex] = useState(initialDraft?.exerciseIndex ?? 0)
  const [completedSets, setCompletedSets] = useState<CompletedSets>(initialDraft?.completedSets ?? {})
  const [setInputs, setSetInputs] = useState<SetInputs>(
    initialDraft?.setInputs ?? getDefaultSetInputs(exercises),
  )
  const [elapsed, setElapsed] = useState(initialDraft?.elapsed ?? 0)
  const [paused, setPaused] = useState(initialDraft?.paused ?? false)
  const [rest, setRest] = useState(initialDraft?.rest ?? 0)
  const [finished, setFinished] = useState(initialDraft?.finished ?? false)
  const [perceivedExertion, setPerceivedExertion] = useState(initialDraft?.perceivedExertion ?? 2)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [muted, setMuted] = useState(true)
  const [videoExpanded, setVideoExpanded] = useState(false)
  const [techniqueOpen, setTechniqueOpen] = useState(false)
  const [preflightComplete, setPreflightComplete] = useState(Boolean(initialDraft))
  const [readiness, setReadiness] = useState(initialDraft?.readiness ?? 3)
  const [sleepQuality, setSleepQuality] = useState(initialDraft?.sleepQuality ?? 3)
  const [painNote, setPainNote] = useState(initialDraft?.painNote ?? '')

  const exercise = exercises[exerciseIndex]
  const prescription = readPtExercisePrescription(exercise.tags)
  const exerciseLabels = visibleExerciseTags(exercise.tags)
  const currentCompletedSets = completedSets[exercise.id] ?? []
  const currentSets = currentCompletedSets.length
  const currentInput = setInputs[exercise.id] ?? {
    weightKg: 16,
    reps: defaultReps(exercise.reps),
  }
  const totalSets = exercises.reduce((sum, item) => sum + item.sets, 0)
  const flattenedSets = useMemo(
    () => exercises.flatMap((item) => completedSets[item.id] ?? []),
    [completedSets, exercises],
  )
  const doneSets = flattenedSets.length
  const allSetsComplete = doneSets >= totalSets
  const progress = Math.min(100, Math.round((doneSets / totalSets) * 100))
  const totalLoadKg = useMemo(
    () => flattenedSets.reduce((total, set) => total + set.weightKg * set.reps, 0),
    [flattenedSets],
  )
  const techniqueTips = useMemo(() => {
    const fromExercise = exercise.notes
      .split(/\r?\n/)
      .map((item) => item.replace(/^[-•]\s*/, '').trim())
      .filter(Boolean)
    if (fromExercise.length) return fromExercise.slice(0, 3)
    return [
      'Giữ cột sống trung lập và siết cơ trung tâm trước mỗi lần lặp.',
      'Hít vào ở pha hạ, thở ra khi tạo lực; duy trì nhịp độ có kiểm soát.',
      'Dừng ngay nếu có cảm giác đau nhói hoặc kỹ thuật mất ổn định.',
    ]
  }, [exercise.notes])

  useEffect(() => {
    if (!preflightComplete || paused || finished || elapsed >= MAX_WORKOUT_SECONDS) return
    const id = window.setInterval(() => setElapsed((value) => Math.min(MAX_WORKOUT_SECONDS, value + 1)), 1_000)
    return () => window.clearInterval(id)
  }, [elapsed, finished, paused, preflightComplete])

  useEffect(() => {
    if (rest <= 0 || paused || finished) return
    const id = window.setInterval(() => setRest((value) => Math.max(0, value - 1)), 1_000)
    return () => window.clearInterval(id)
  }, [finished, paused, rest])

  useEffect(() => {
    const draft: WorkoutDraft = {
      version: DRAFT_VERSION,
      clientLogId,
      programId: workoutRef.programId,
      sessionId: workoutRef.sessionId,
      versionId: workoutRef.versionId,
      exerciseIndex,
      completedSets,
      setInputs,
      elapsed,
      paused,
      rest,
      finished,
      perceivedExertion,
      readiness,
      sleepQuality,
      painNote,
    }
    const id = window.setTimeout(() => {
      try {
        window.localStorage.setItem(workoutDraftKey, JSON.stringify(draft))
      } catch {
        // The in-memory workout remains usable when local storage is unavailable.
      }
    }, 150)
    return () => window.clearTimeout(id)
  }, [clientLogId, completedSets, elapsed, exerciseIndex, finished, painNote, paused, perceivedExertion, readiness, rest, setInputs, sleepQuality, workoutDraftKey, workoutRef.programId, workoutRef.sessionId, workoutRef.versionId])

  useEffect(() => {
    if (doneSets === 0) return
    const confirmReload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', confirmReload)
    return () => window.removeEventListener('beforeunload', confirmReload)
  }, [doneSets])

  const timeLabel = useMemo(
    () => `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`,
    [elapsed],
  )

  const updateCurrentInput = (values: Partial<SetInput>) => {
    setSetInputs((current) => ({
      ...current,
      [exercise.id]: {
        weightKg: clampNumber(values.weightKg ?? currentInput.weightKg, 0, 1_000, currentInput.weightKg),
        reps: Math.round(clampNumber(values.reps ?? currentInput.reps, 1, 1_000, currentInput.reps)),
      },
    }))
  }

  const completeSet = () => {
    if (currentSets >= exercise.sets) return
    const next = currentSets + 1
    const completedSet: CompletedSet = {
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      setNumber: next,
      weightKg: currentInput.weightKg,
      reps: currentInput.reps,
    }
    setCompletedSets((value) => ({
      ...value,
      [exercise.id]: [...(value[exercise.id] ?? []), completedSet],
    }))
    if (next < exercise.sets) setRest(exercise.rest)
    if (doneSets + 1 >= totalSets) {
      setRest(0)
      setFinished(true)
    }
  }

  const exitWorkout = () => {
    if (doneSets > 0 && !window.confirm('Tiến độ đã được lưu trên thiết bị. Bạn có thể quay lại để tiếp tục buổi tập này. Thoát bây giờ?')) return
    if (doneSets === 0) clearWorkoutDraft(workoutDraftKey)
    if (onExit) onExit()
    else onNavigate('schedule')
  }

  const persistWorkout = async () => {
    if (!allSetsComplete) return
    if (!onSave) {
      clearWorkoutDraft(workoutDraftKey)
      onNavigate('schedule')
      return
    }
    setSaveState('saving')
    try {
      const workoutLog: WorkoutLogInput & { versionId: string } = {
        clientLogId,
        programId: workoutRef.programId,
        sessionId: workoutRef.sessionId,
        versionId: workoutRef.versionId,
        title: resolvedTitle,
        durationSeconds: elapsed,
        completedSets: flattenedSets.length,
        totalLoadKg,
        perceivedExertion,
        readiness,
        sleepQuality,
        painNote: painNote.trim().slice(0, 1_000),
        sets: flattenedSets,
      }
      await onSave(workoutLog)
      clearWorkoutDraft(workoutDraftKey)
      if (onExit) onExit()
      else onNavigate('schedule')
    } catch {
      setSaveState('error')
    }
  }

  if (!preflightComplete) {
    return (
      <div className="pt-workout-preflight">
        <section className="card">
          <div className="pt-scope-badge"><ShieldCheck size={15} /> PT COACHING</div>
          <div className="pt-preflight-heading"><span><HeartPulse size={25} /></span><div><small>CHECK-IN TRƯỚC BUỔI TẬP</small><h1>{resolvedTitle}</h1><p>{runtime.programTitle} · {runtime.session.durationMinutes} phút · {exercises.length} bài tập</p></div></div>
          <div className="pt-preflight-note"><strong>Chỉ dẫn từ PT</strong><p>{runtime.session.coachNotes || 'Ưu tiên kỹ thuật, tuân thủ RPE/RIR được giao và dừng lại nếu xuất hiện đau nhói.'}</p></div>
          <div className="pt-preflight-grid">
            <label><span>Mức sẵn sàng hôm nay</span><div>{[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} className={readiness === value ? 'active' : ''} aria-pressed={readiness === value} onClick={() => setReadiness(value)}>{value}</button>)}</div><small>1 = rất mệt · 5 = rất sẵn sàng</small></label>
            <label><span>Chất lượng giấc ngủ</span><div>{[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} className={sleepQuality === value ? 'active' : ''} aria-pressed={sleepQuality === value} onClick={() => setSleepQuality(value)}>{value}</button>)}</div><small>Giúp PT hiểu khả năng phục hồi</small></label>
            <label className="span-2"><span>Đau hoặc khó chịu cần lưu ý</span><textarea rows={3} value={painNote} onChange={(event) => setPainNote(event.target.value)} placeholder="Để trống nếu không có; nếu đau nhói, hãy dừng tập và trao đổi với PT." /></label>
          </div>
          {(readiness <= 2 || painNote.trim()) && <div className="pt-preflight-warning"><AlertCircle size={18} /><span><strong>Cần điều chỉnh cường độ</strong><small>Giảm mức tạ, giữ RIR cao hơn và báo lại cho PT nếu cảm giác không ổn.</small></span></div>}
          <footer><button type="button" className="outline-button" onClick={() => onExit ? onExit() : onNavigate('schedule')}>Quay lại lịch</button><button type="button" className="primary-button" onClick={() => setPreflightComplete(true)}><Play size={17} fill="currentColor" /> Bắt đầu buổi tập</button></footer>
        </section>
      </div>
    )
  }

  if (finished) {
    const firstName = user?.displayName?.trim().split(/\s+/).at(-1) || 'bạn'
    return (
      <div className="workout-complete">
        <div className="complete-confetti" aria-hidden="true"><i /><i /><i /><i /><i /></div>
        <div className="completion-mark"><Check size={44} strokeWidth={3} /></div>
        <span className="eyebrow">BUỔI TẬP HOÀN THÀNH</span>
        <h1>Tuyệt vời lắm, {firstName}!</h1>
        <p>Bạn vừa tiến thêm một bước trên hành trình mạnh mẽ hơn.</p>
        <div className="completion-stats">
          <div><Clock3 size={21} /><strong>{timeLabel}</strong><span>Thời gian</span></div>
          <div><Dumbbell size={21} /><strong>{doneSets}</strong><span>Tổng số hiệp</span></div>
          <div><Sparkles size={21} /><strong>{totalLoadKg.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} kg</strong><span>Tổng tải</span></div>
        </div>
        <div className="rpe-card">
          <strong>Buổi tập hôm nay thế nào?</strong>
          <span>Chọn cảm nhận của bạn</span>
          <div>{['Rất nhẹ', 'Vừa sức', 'Khó', 'Rất khó'].map((item, index) => (
            <button type="button" className={perceivedExertion === index + 1 ? 'active' : ''} aria-pressed={perceivedExertion === index + 1} disabled={saveState === 'saving'} onClick={() => setPerceivedExertion(index + 1)} key={item}><i>{index + 1}</i>{item}</button>
          ))}</div>
        </div>
        {saveState === 'error' && <div className="save-error" role="alert">Chưa thể đồng bộ Firebase. Dữ liệu vẫn được giữ trên thiết bị, hãy thử lại.</div>}
        <button type="button" className="primary-button large" onClick={persistWorkout} disabled={saveState === 'saving'}>
          {saveState === 'saving' ? 'Đang lưu kết quả...' : saveState === 'error' ? 'Thử lưu lại' : 'Lưu kết quả & về lịch tập'}
        </button>
      </div>
    )
  }

  return (
    <div className="workout-player-page">
      <header className="workout-header">
        <button type="button" className="workout-exit" aria-label="Kết thúc buổi tập" onClick={exitWorkout}><X size={21} /><span>Kết thúc</span></button>
        <div className="workout-header__center"><strong>{resolvedTitle}</strong><span>{runtime.programTitle} · Phiên bản {workoutRef.versionId}</span><i className="pt-workout-context"><Dumbbell size={12} /> PT COACHING</i></div>
        <div className="workout-clock"><Clock3 size={18} /><strong>{timeLabel}</strong><button type="button" aria-label={paused ? 'Tiếp tục tính giờ' : 'Tạm dừng tính giờ'} aria-pressed={paused} onClick={() => setPaused((value) => !value)}>{paused ? <Play size={17} fill="currentColor" /> : <Pause size={17} fill="currentColor" />}</button></div>
      </header>

      <div className="workout-overall-progress" role="progressbar" aria-label="Tiến độ buổi tập" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>

      <div className="workout-layout">
        <aside className="workout-list-panel">
          <div className="workout-list-heading"><span>BÀI TẬP</span><strong>{exerciseIndex + 1}/{exercises.length}</strong></div>
          {exercises.map((item, index) => {
            const itemDone = completedSets[item.id]?.length ?? 0
            return (
              <button type="button" key={item.id} className={`${index === exerciseIndex ? 'active' : ''} ${itemDone >= item.sets ? 'done' : ''}`} aria-current={index === exerciseIndex ? 'step' : undefined} onClick={() => setExerciseIndex(index)}>
                <span className={`exercise-index ${EXERCISE_COLORS[index % EXERCISE_COLORS.length]}`}>{itemDone >= item.sets ? <Check size={16} /> : String(index + 1).padStart(2, '0')}</span>
                <span><strong>{item.name}</strong><small>{item.sets} hiệp · {item.reps}</small></span>
                <em>{itemDone}/{item.sets}</em>
              </button>
            )
          })}
          <div className="workout-help"><CircleHelp size={19} /><span><strong>Cần hỗ trợ?</strong><small>Xem hướng dẫn an toàn</small></span></div>
        </aside>

        <main className="current-exercise">
          <div className={`exercise-video ${videoExpanded ? 'is-expanded' : ''}`}>
            <div className="exercise-video__bg" aria-hidden="true"><span /><i /><b /></div>
            <div className="exercise-silhouette" aria-hidden="true"><i className="head"/><i className="body"/><i className="arm left"/><i className="arm right"/><i className="leg left"/><i className="leg right"/></div>
            <button type="button" className="video-sound" aria-label={muted ? 'Bật âm thanh minh họa' : 'Tắt âm thanh minh họa'} aria-pressed={!muted} onClick={() => setMuted((value) => !value)}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
            <button type="button" className="video-expand" aria-label={videoExpanded ? 'Thu nhỏ minh họa' : 'Phóng to minh họa'} aria-pressed={videoExpanded} onClick={() => setVideoExpanded((value) => !value)}>{videoExpanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>
            <span className="loop-label"><RotateCcw size={13} /> Minh họa kỹ thuật</span>
          </div>

          <div className="exercise-copy">
            <div>
              <span className="eyebrow">BÀI {String(exerciseIndex + 1).padStart(2, '0')} · {(exerciseLabels.join(' · ') || runtime.session.focus || 'TOÀN THÂN').toUpperCase()}</span>
              <h1>{exercise.name}</h1>
              <p>{exercise.notes || runtime.session.coachNotes || 'Thực hiện chậm, giữ nhịp thở đều và ưu tiên biên độ có kiểm soát.'}</p>
            </div>
            <button type="button" className="technique-button" aria-expanded={techniqueOpen} onClick={() => setTechniqueOpen((value) => !value)}><Play size={16} fill="currentColor" /> {techniqueOpen ? 'Ẩn kỹ thuật' : 'Xem kỹ thuật'}</button>
          </div>

          {techniqueOpen && (
            <section className="technique-panel" aria-label={`Kỹ thuật ${exercise.name}`}>
              <div><Sparkles size={20} /><span><strong>Chỉ dẫn kỹ thuật từ PT</strong><small>Tuân thủ mức nỗ lực và tempo trước khi tăng mức tạ.</small></span></div>
              <div className="pt-technique-metrics"><span>RPE {exercise.rpe}/10</span><span>RIR {prescription.rir}</span><span>Tempo {prescription.tempo}</span><span>Nghỉ {exercise.rest}s</span></div>
              <ol>{techniqueTips.map((tip) => <li key={tip}>{tip}</li>)}</ol>
              {prescription.substitute && <div className="pt-substitute-note"><RotateCcw size={15} /><span>Nếu không phù hợp, dùng bài thay thế: <strong>{prescription.substitute}</strong></span></div>}
            </section>
          )}

          <div className="set-tracker">
            <div className="set-tracker__header"><strong>HIỆP {Math.min(currentSets + 1, exercise.sets)} / {exercise.sets}</strong><span>{exercise.reps} · RPE {exercise.rpe} · RIR {prescription.rir} · Tempo {prescription.tempo}</span></div>
            <div className="set-inputs">
              <label><span>MỨC TẠ (KG)</span><div><button type="button" aria-label="Giảm mức tạ" onClick={() => updateCurrentInput({ weightKg: currentInput.weightKg - 1 })}>−</button><input aria-label="Mức tạ theo kilogram" type="number" min="0" max="1000" step="0.5" inputMode="decimal" value={currentInput.weightKg} onChange={(event) => updateCurrentInput({ weightKg: Number(event.target.value) })} /><button type="button" aria-label="Tăng mức tạ" onClick={() => updateCurrentInput({ weightKg: currentInput.weightKg + 1 })}>+</button></div><small>Tùy chỉnh theo khả năng</small></label>
              <span className="multiply">×</span>
              <label><span>SỐ LẦN</span><div><button type="button" aria-label="Giảm số lần" onClick={() => updateCurrentInput({ reps: currentInput.reps - 1 })}>−</button><input aria-label="Số lần lặp" type="number" min="1" max="1000" step="1" inputMode="numeric" value={currentInput.reps} onChange={(event) => updateCurrentInput({ reps: Number(event.target.value) })} /><button type="button" aria-label="Tăng số lần" onClick={() => updateCurrentInput({ reps: currentInput.reps + 1 })}>+</button></div><small>Mục tiêu: {exercise.reps}</small></label>
              <button type="button" className="complete-set-button" onClick={completeSet} disabled={currentSets >= exercise.sets}><Check size={22} /> {currentSets >= exercise.sets ? 'Đã hoàn thành bài' : 'Hoàn thành hiệp'}</button>
            </div>
          </div>

          {rest > 0 && <div className="rest-banner" role="timer" aria-live="polite"><div className="rest-ring"><span>{rest}</span></div><div><strong>Thời gian nghỉ</strong><span>Hít thở sâu và chuẩn bị cho hiệp tiếp theo.</span></div><button type="button" onClick={() => setRest(0)}><SkipForward size={17} /> Bỏ qua</button></div>}

          <div className="workout-navigation">
            <button type="button" disabled={exerciseIndex === 0} onClick={() => setExerciseIndex((value) => Math.max(0, value - 1))}><ChevronLeft size={18} /> Bài trước</button>
            <span><i style={{ width: `${((exerciseIndex + 1) / exercises.length) * 100}%` }} /></span>
            <button type="button" disabled={exerciseIndex === exercises.length - 1 && !allSetsComplete} onClick={() => exerciseIndex === exercises.length - 1 ? setFinished(allSetsComplete) : setExerciseIndex((value) => value + 1)}>{exerciseIndex === exercises.length - 1 ? allSetsComplete ? 'Hoàn tất buổi tập' : 'Hoàn thành đủ hiệp' : 'Bài tiếp theo'} <ChevronRight size={18} /></button>
          </div>
        </main>
      </div>
    </div>
  )
}
