import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, BarChart3, BookOpen, CalendarDays, Check, ChevronRight, Dumbbell,
  History, Plus, RefreshCw, Save, Search, Sparkles, Target, Trash2, Users, Weight, X,
} from 'lucide-react'
import { listExerciseCatalogPage } from '../../services/exerciseCatalogService'
import type { ExerciseCatalogItem } from '../../types'
import { exerciseMatchesMuscleGroup, exerciseMuscleGroupOptions, type ExerciseMuscleGroupId } from '../../utils/exerciseMuscleGroups'
import {
  getPtWorkoutWorkspace,
  listPtWorkoutHistory,
  savePtSessionWorkoutLog,
  savePtStudentTrainingPlan,
  type PtTrainingDay,
  type PtTrainingExercise,
  type PtTrainingProgram,
  type PtWorkoutHistory,
  type PtWorkoutLog,
  type PtWorkoutSession,
  type PtWorkoutSet,
  type PtWorkoutStudent,
  type PtWorkoutWorkspace,
} from '../../services/ptWorkoutTrackingService'
import './PtWorkoutWorkspacePage.css'
import ExerciseCatalogManager from '../../components/exercise-catalog/ExerciseCatalogManager'

type WorkspaceTab = 'today' | 'program' | 'library' | 'history'

const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })
function todayKey() { return dateFormatter.format(new Date()) }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function normalizeSearchText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLocaleLowerCase('vi-VN').trim()
}
function emptyProgram(): PtTrainingProgram {
  return {
    title: 'Giáo án PT Aura', goal: '', coachNotes: '', status: 'active', revision: 0,
    trainingDays: [{ id: crypto.randomUUID(), title: 'Buổi 1', focusMuscles: [], notes: '', order: 0, exercises: [] }],
  }
}

function demoWorkspace(date: string): PtWorkoutWorkspace {
  const students: PtWorkoutStudent[] = [
    { id: 'student-a', name: 'Nguyễn Minh Anh', phone: '0900000001', branchId: 'branch-demo' },
    { id: 'student-b', name: 'Trần Thu Hà', phone: '0900000002', branchId: 'branch-demo' },
  ]
  const programs = students.map((student) => ({
    id: student.id,
    studentId: student.id,
    title: 'Mông đùi & toàn thân',
    goal: 'Tăng sức mạnh và cải thiện vóc dáng',
    coachNotes: '',
    status: 'active' as const,
    revision: 1,
    trainingDays: [{
      id: 'lower-a', title: 'Mông đùi A', focusMuscles: ['Mông', 'Đùi sau'], notes: '', order: 0,
      exercises: [{
        id: 'demo-hip-thrust', catalogExerciseId: 'demo-hip-thrust', catalogRevision: 1, nameVi: 'Đẩy hông với tạ đòn',
        targetMuscles: ['Mông'], secondaryMuscles: ['Đùi sau'], equipment: ['Tạ đòn'], instructionsVi: [], cuesVi: [], media: {},
        trackingMode: 'weight_reps' as const, sets: 4, repMinimum: 8, repMaximum: 12, durationSeconds: 0, distanceMeters: 0,
        targetWeightKg: 30, targetRpe: 8, targetRir: 2, tempo: '', restSeconds: 75, unilateral: false, notes: '',
      }],
    }],
  }))
  return {
    students,
    sessions: students.map((student, index) => ({ id: `session-demo-${index}`, studentId: student.id, trainerId: 'trainer-demo', date, hour: 8, status: 'scheduled' })),
    programs, logs: [],
  }
}

function exerciseFromCatalog(item: ExerciseCatalogItem): PtTrainingExercise {
  const prescription = item.defaultPrescription
  const numbers = prescription.reps.match(/\d+/g)?.map(Number) ?? [10, 12]
  const durableVideo = item.media.videos?.find((video) => video.provider === 'aura' && video.url)
  return {
    id: crypto.randomUUID(), catalogExerciseId: item.id, catalogRevision: item.revision, nameVi: item.nameVi,
    targetMuscles: item.targetMuscles, secondaryMuscles: item.secondaryMuscles, equipment: item.equipment,
    instructionsVi: item.instructionsVi, cuesVi: item.cuesVi, media: { posterUrl: durableVideo?.posterUrl || item.media.posterUrl || item.media.startImageUrl, animationUrl: durableVideo?.url || item.media.animationUrl },
    trackingMode: 'weight_reps', sets: prescription.sets, repMinimum: numbers[0] || 10, repMaximum: numbers[1] || numbers[0] || 12,
    durationSeconds: 0, distanceMeters: 0, targetWeightKg: 0, targetRpe: prescription.rpe, targetRir: 3,
    tempo: '', restSeconds: prescription.restSeconds, unilateral: false, notes: '',
  }
}

function defaultSets(day: PtTrainingDay): PtWorkoutSet[] {
  return day.exercises.flatMap((exercise) => Array.from({ length: exercise.sets }, (_, index) => ({
    exerciseId: exercise.id, catalogExerciseId: exercise.catalogExerciseId, exerciseName: exercise.nameVi,
    setNumber: index + 1, setType: index === 0 ? 'warmup' as const : 'working' as const,
    weightKg: exercise.targetWeightKg, reps: 0, durationSeconds: 0, distanceMeters: 0,
    rpe: 0, rir: 0, painLevel: 0, completed: false, notes: '',
  })))
}

function sessionGroupKey(session: PtWorkoutSession) {
  return [session.branchId || 'branch', session.trainerId || 'trainer', session.date, session.hour].join('|')
}

function groupedSessions(sessions: PtWorkoutSession[]) {
  const groups = new Map<string, PtWorkoutSession[]>()
  sessions.forEach((session) => {
    const key = sessionGroupKey(session)
    groups.set(key, [...(groups.get(key) || []), session])
  })
  return [...groups.entries()].sort(([, left], [, right]) => {
    const firstLeft = left[0]
    const firstRight = right[0]
    return `${firstLeft.date}-${String(firstLeft.hour).padStart(2, '0')}-${firstLeft.trainerName || firstLeft.trainerId}`
      .localeCompare(`${firstRight.date}-${String(firstRight.hour).padStart(2, '0')}-${firstRight.trainerName || firstRight.trainerId}`, 'vi')
  })
}

export default function PtWorkoutWorkspacePage({ isDemo = false, canPublishCatalog = false, initialStudentId = '' }: { isDemo?: boolean; canPublishCatalog?: boolean; initialStudentId?: string }) {
  const initialStudentAppliedRef = useRef(false)
  const [tab, setTab] = useState<WorkspaceTab>('today')
  const [date, setDate] = useState(todayKey())
  const [branchFilter, setBranchFilter] = useState('all')
  const [trainerFilter, setTrainerFilter] = useState('all')
  const [workspace, setWorkspace] = useState<PtWorkoutWorkspace>({ sessions: [], students: [], programs: [], logs: [] })
  const [selectedStudentId, setSelectedStudentId] = useState(initialStudentId)
  const [studentSearchQuery, setStudentSearchQuery] = useState('')
  const [studentPickerOpen, setStudentPickerOpen] = useState(false)
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [programDraft, setProgramDraft] = useState<PtTrainingProgram>(emptyProgram)
  const [selectedDayId, setSelectedDayId] = useState('')
  const [sets, setSets] = useState<PtWorkoutSet[]>([])
  const [catalog, setCatalog] = useState<ExerciseCatalogItem[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogHasMore, setCatalogHasMore] = useState(false)
  const [catalogCursor, setCatalogCursor] = useState<string | null>(null)
  const [catalogQuery, setCatalogQuery] = useState('')
  const [muscleFilter, setMuscleFilter] = useState<ExerciseMuscleGroupId>('all')
  const [catalogVisibleCount, setCatalogVisibleCount] = useState(24)
  const [history, setHistory] = useState<PtWorkoutHistory | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [coachNotes, setCoachNotes] = useState('')
  const [painNotes, setPainNotes] = useState('')
  const [nextSessionPlan, setNextSessionPlan] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pendingDeleteDayId, setPendingDeleteDayId] = useState('')
  const deleteConfirmRef = useRef<HTMLButtonElement>(null)
  const catalogRequestIdRef = useRef(0)

  const studentMap = useMemo(() => new Map(workspace.students.map((student) => [student.id, student])), [workspace.students])
  const eligibleStudents = useMemo(() => workspace.students.filter((student) => student.eligibleForNewProgram !== false && student.assignmentSource !== 'teaching_session'), [workspace.students])
  const matchingStudents = useMemo(() => {
    const query = normalizeSearchText(studentSearchQuery)
    return eligibleStudents
      .filter((student) => !query || normalizeSearchText(`${student.name} ${student.phone || ''}`).includes(query))
      .sort((left, right) => left.name.localeCompare(right.name, 'vi'))
      .slice(0, 10)
  }, [eligibleStudents, studentSearchQuery])
  const programMap = useMemo(() => new Map(workspace.programs.map((program) => [program.studentId || program.id || '', program])), [workspace.programs])
  const selectedSession = workspace.sessions.find((session) => session.id === selectedSessionId) || null
  const selectedProgram = programMap.get(selectedStudentId) || null
  const selectedDay = programDraft.trainingDays.find((day) => day.id === selectedDayId) || programDraft.trainingDays[0]
  const pendingDeleteDay = programDraft.trainingDays.find((day) => day.id === pendingDeleteDayId) || null
  const selectedLog = workspace.logs.find((log) => log.sessionId === selectedSessionId && log.studentId === selectedStudentId) || null
  const branchOptions = useMemo(() => [...new Map(workspace.sessions.filter((session) => session.branchId).map((session) => [session.branchId as string, session.branchName || 'Chi nhánh Aura'])).entries()], [workspace.sessions])
  const trainerOptions = useMemo(() => [...new Map(workspace.sessions.filter((session) => session.trainerId).map((session) => [session.trainerId, session.trainerName || 'PT Aura'])).entries()], [workspace.sessions])
  const visibleSessions = useMemo(() => workspace.sessions.filter((session) => (branchFilter === 'all' || session.branchId === branchFilter) && (trainerFilter === 'all' || session.trainerId === trainerFilter)), [branchFilter, trainerFilter, workspace.sessions])
  const sessionGroups = useMemo(() => groupedSessions(visibleSessions), [visibleSessions])
  const distinctSessionCount = sessionGroups.length
  const completedVisibleCount = useMemo(() => {
    const ids = new Set(visibleSessions.map((session) => session.id))
    return workspace.logs.filter((log) => ids.has(log.sessionId) && log.status === 'completed').length
  }, [visibleSessions, workspace.logs])
  const selectedLogLocked = selectedLog?.status === 'completed'
  const previousPerformance = useMemo(() => {
    const result = new Map<string, PtWorkoutSet>()
    if (!history || !selectedDay) return result
    for (const log of history.logs) {
      if (log.sessionId === selectedSessionId || log.status !== 'completed') continue
      for (const set of log.sets || []) {
        if (!set.completed || result.has(set.catalogExerciseId || '')) continue
        result.set(set.catalogExerciseId || '', set)
      }
    }
    return result
  }, [history, selectedDay, selectedSessionId])
  const muscleGroups = useMemo(() => exerciseMuscleGroupOptions(catalog), [catalog])

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      const result = isDemo ? demoWorkspace(date) : await getPtWorkoutWorkspace(date)
      setWorkspace(result)
      const firstSession = result.sessions[0]
      const preferredStudentId = !initialStudentAppliedRef.current && initialStudentId && result.students.some((item) => item.id === initialStudentId) ? initialStudentId : ''
      const preferredSession = preferredStudentId ? result.sessions.find((session) => session.studentId === preferredStudentId) : null
      setSelectedSessionId((current) => preferredSession?.id || (result.sessions.some((item) => item.id === current) ? current : firstSession?.id || ''))
      setSelectedStudentId((current) => preferredStudentId || (result.students.some((item) => item.id === current) ? current : firstSession?.studentId || result.students[0]?.id || ''))
      if (preferredStudentId) {
        initialStudentAppliedRef.current = true
        setTab('program')
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tải dữ liệu giáo án PT.') }
    finally { setLoading(false) }
  }, [date, initialStudentId, isDemo])

  useEffect(() => { void load(false) }, [load])
  useEffect(() => {
    if (visibleSessions.some((session) => session.id === selectedSessionId)) return
    const first = visibleSessions[0]
    setSelectedSessionId(first?.id || '')
    if (first && tab === 'today') setSelectedStudentId(first.studentId)
  }, [selectedSessionId, tab, visibleSessions])
  const loadCatalog = useCallback(async (append = false) => {
    const requestId = ++catalogRequestIdRef.current
    setCatalogLoading(true)
    if (!append) { setCatalog([]); setCatalogCursor(null); setCatalogHasMore(false) }
    try {
      if (isDemo) {
        if (requestId === catalogRequestIdRef.current) setCatalog(demoWorkspace(date).programs.flatMap((program) => program.trainingDays.flatMap((day) => day.exercises)).map((exercise) => ({ id: exercise.catalogExerciseId, schemaVersion: 1, revision: 1, status: 'published', nameVi: exercise.nameVi, nameEn: exercise.nameVi, aliasesVi: [], bodyParts: exercise.targetMuscles, targetMuscles: exercise.targetMuscles, secondaryMuscles: exercise.secondaryMuscles, equipment: exercise.equipment, environment: ['gym'], difficulty: 'beginner', goals: [], instructionsVi: exercise.instructionsVi, cuesVi: exercise.cuesVi, commonMistakesVi: [], media: {}, defaultPrescription: { sets: exercise.sets, reps: `${exercise.repMinimum}–${exercise.repMaximum}`, restSeconds: exercise.restSeconds, rpe: exercise.targetRpe }, source: { provider: 'aura', sourceExerciseId: exercise.catalogExerciseId, sourceVersion: 'demo', license: 'Aura-owned' }, sourceAttribution: 'Aura Fitness' } as ExerciseCatalogItem)))
        setCatalogHasMore(false); setCatalogCursor(null)
      } else {
        const page = await listExerciseCatalogPage({ query: catalogQuery.trim(), cursor: append ? catalogCursor : null, pageSize: 36 })
        if (requestId !== catalogRequestIdRef.current) return
        setCatalog((current) => append ? [...new Map([...current, ...page.items].map((item) => [item.id, item])).values()] : page.items)
        setCatalogHasMore(page.hasMore); setCatalogCursor(page.nextCursor)
      }
    } catch (cause) { if (requestId === catalogRequestIdRef.current) setError(cause instanceof Error ? cause.message : 'Không thể tải thư viện bài tập.') }
    finally { if (requestId === catalogRequestIdRef.current) setCatalogLoading(false) }
  }, [catalogCursor, catalogQuery, date, isDemo])

  useEffect(() => { if (tab === 'program' && !catalog.length && !catalogLoading) void loadCatalog(false) }, [catalog.length, catalogLoading, loadCatalog, tab])
  useEffect(() => {
    if (tab !== 'program' || !catalog.length) return
    const timer = window.setTimeout(() => { void loadCatalog(false) }, 300)
    return () => window.clearTimeout(timer)
  }, [catalogQuery])
  useEffect(() => {
    const next = selectedProgram ? clone(selectedProgram) : emptyProgram()
    setProgramDraft(next)
    setSelectedDayId(next.trainingDays[0]?.id || '')
  }, [selectedProgram, selectedStudentId])
  useEffect(() => {
    setStudentSearchQuery(studentMap.get(selectedStudentId)?.name || '')
  }, [selectedStudentId, studentMap])
  useEffect(() => {
    if (!pendingDeleteDayId) return
    deleteConfirmRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) setPendingDeleteDayId('')
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [pendingDeleteDayId, saving])
  useEffect(() => {
    if (!selectedSession || !selectedDay) { setSets([]); return }
    const log = workspace.logs.find((item) => item.sessionId === selectedSession.id && item.studentId === selectedSession.studentId)
    let localSets: PtWorkoutSet[] | null = null
    if (!log || log.status !== 'completed') {
      try {
        const stored = window.localStorage.getItem(`aura-workout-draft:${selectedSession.id}:${selectedDay.id}`)
        const parsed = stored ? JSON.parse(stored) : null
        if (Array.isArray(parsed)) localSets = parsed
      } catch { /* local draft is optional */ }
    }
    setSets(log?.trainingDayId === selectedDay.id ? clone(log.sets) : localSets || defaultSets(selectedDay))
    setCoachNotes(log?.coachNotes || '')
    setPainNotes(log?.painNotes || '')
    setNextSessionPlan(log?.nextSessionPlan || '')
  }, [selectedDay?.id, selectedSession?.id, workspace.logs])
  useEffect(() => {
    if (!selectedStudentId) { setHistory(null); return }
    let active = true
    setHistoryLoading(true)
    if (isDemo) {
      setHistory({ studentId: selectedStudentId, logs: workspace.logs, analytics: { completedWorkouts: 0, totalVolumeKg: 0, painAlerts: 0, personalRecords: [] } })
      setHistoryLoading(false)
      return () => { active = false }
    }
    void listPtWorkoutHistory(selectedStudentId, 60)
      .then((result) => { if (active) setHistory(result) })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Không thể tải tiến bộ.') })
      .finally(() => { if (active) setHistoryLoading(false) })
    return () => { active = false }
  }, [isDemo, selectedStudentId, workspace.logs])
  useEffect(() => {
    if (!selectedSession || !selectedDay || selectedLogLocked || !sets.length) return
    const timer = window.setTimeout(() => {
      try { window.localStorage.setItem(`aura-workout-draft:${selectedSession.id}:${selectedDay.id}`, JSON.stringify(sets)) } catch { /* optional */ }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [selectedDay?.id, selectedLogLocked, selectedSession?.id, sets])

  const filteredCatalog = useMemo(() => {
    const query = catalogQuery.trim().toLocaleLowerCase('vi')
    return catalog.filter((item) => {
      const matchesQuery = !query || [item.nameVi, item.nameEn, ...item.targetMuscles, ...item.bodyParts].join(' ').toLocaleLowerCase('vi').includes(query)
      const matchesMuscle = exerciseMatchesMuscleGroup(item, muscleFilter)
      return matchesQuery && matchesMuscle
    })
  }, [catalog, catalogQuery, muscleFilter])
  const visibleCatalog = filteredCatalog.slice(0, catalogVisibleCount)
  useEffect(() => { setCatalogVisibleCount(24) }, [catalogQuery, muscleFilter])

  const selectSession = (session: PtWorkoutSession) => {
    setSelectedSessionId(session.id); setSelectedStudentId(session.studentId); setNotice(''); setError('')
  }

  const updateDay = (updater: (day: PtTrainingDay) => PtTrainingDay) => {
    setProgramDraft((current) => ({ ...current, trainingDays: current.trainingDays.map((day) => day.id === selectedDay?.id ? updater(day) : day) }))
  }

  const addExercise = (item: ExerciseCatalogItem) => {
    if (!selectedDay || selectedDay.exercises.some((exercise) => exercise.catalogExerciseId === item.id)) return
    updateDay((day) => ({ ...day, exercises: [...day.exercises, exerciseFromCatalog(item)] }))
  }

  const saveProgram = async (
    draft: PtTrainingProgram = programDraft,
    options: { successMessage?: string; stayOnProgram?: boolean; nextDayId?: string } = {},
  ) => {
    if (!selectedStudentId || !draft.trainingDays.every((day) => day.exercises.length)) { setError('Mỗi buổi giáo án cần ít nhất một bài tập.'); return false }
    setSaving(true); setError('')
    try {
      if (isDemo) {
        const next = { ...draft, studentId: selectedStudentId, revision: draft.revision + 1 }
        setWorkspace((current) => ({ ...current, programs: [...current.programs.filter((item) => (item.studentId || item.id) !== selectedStudentId), next] }))
        setProgramDraft(next)
      } else {
        const result = await savePtStudentTrainingPlan({
          studentId: selectedStudentId, expectedRevision: draft.revision,
          program: { title: draft.title, goal: draft.goal, coachNotes: draft.coachNotes, status: draft.status, trainingDays: draft.trainingDays },
        })
        const next = { ...clone(draft), id: selectedStudentId, studentId: selectedStudentId, revision: result.revision }
        setProgramDraft(next)
        setWorkspace((current) => ({
          ...current,
          programs: [...current.programs.filter((item) => (item.studentId || item.id) !== selectedStudentId), next],
        }))
      }
      if (options.nextDayId) setSelectedDayId(options.nextDayId)
      setNotice(options.successMessage || 'Đã lưu giáo án.')
      if (!options.stayOnProgram) setTab('today')
      return true
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể lưu giáo án.'); return false }
    finally { setSaving(false) }
  }

  const requestDeleteDay = () => {
    if (!selectedDay) return
    if (programDraft.trainingDays.length <= 1) {
      setError('Giáo án phải còn ít nhất một buổi. Hãy thêm buổi mới trước khi xóa buổi này.')
      return
    }
    setError(''); setNotice(''); setPendingDeleteDayId(selectedDay.id)
  }

  const confirmDeleteDay = async () => {
    if (!pendingDeleteDay) return
    const remainingDays = programDraft.trainingDays
      .filter((day) => day.id !== pendingDeleteDay.id)
      .map((day, order) => ({ ...day, order }))
    const currentIndex = programDraft.trainingDays.findIndex((day) => day.id === pendingDeleteDay.id)
    const nextDay = remainingDays[Math.min(currentIndex, remainingDays.length - 1)]
    const saved = await saveProgram(
      { ...programDraft, trainingDays: remainingDays },
      {
        successMessage: `Đã xóa ${pendingDeleteDay.title} khỏi giáo án. Lịch sử tập và mức tạ cũ vẫn được giữ nguyên.`,
        stayOnProgram: true,
        nextDayId: nextDay?.id,
      },
    )
    if (saved) setPendingDeleteDayId('')
  }

  const saveLog = async (status: 'draft' | 'completed') => {
    if (!selectedSession || !selectedDay) return
    if (selectedLogLocked) { setError('Nhật ký đã hoàn thành và được khóa.'); return }
    setSaving(true); setError('')
    try {
      if (isDemo) {
        const log: PtWorkoutLog = {
          id: `demo-${selectedSession.id}`, sessionId: selectedSession.id, studentId: selectedSession.studentId,
          date: selectedSession.date, hour: selectedSession.hour, trainingDayId: selectedDay.id, trainingDayTitle: selectedDay.title,
          status, revision: (selectedLog?.revision || 0) + 1, sets: clone(sets), coachNotes, painNotes, nextSessionPlan,
          metrics: { completedSets: sets.filter((set) => set.completed).length, totalVolumeKg: sets.reduce((sum, set) => sum + (set.completed ? set.weightKg * set.reps : 0), 0), maximumWeightKg: Math.max(0, ...sets.map((set) => set.completed ? set.weightKg : 0)), maximumRpe: Math.max(0, ...sets.map((set) => set.rpe)), painAlert: sets.some((set) => set.painLevel >= 4) },
        }
        setWorkspace((current) => ({ ...current, logs: [...current.logs.filter((item) => item.sessionId !== selectedSession.id), log] }))
      } else {
        const result = await savePtSessionWorkoutLog({ sessionId: selectedSession.id, studentId: selectedSession.studentId, expectedRevision: selectedLog?.revision || 0, trainingDayId: selectedDay.id, status, sets, coachNotes, painNotes, nextSessionPlan })
        const log: PtWorkoutLog = {
          id: result.logId,
          sessionId: selectedSession.id,
          studentId: selectedSession.studentId,
          date: selectedSession.date,
          hour: selectedSession.hour,
          trainingDayId: selectedDay.id,
          trainingDayTitle: selectedDay.title,
          status: result.status,
          revision: result.revision,
          sets: clone(sets),
          coachNotes,
          painNotes,
          nextSessionPlan,
          metrics: result.metrics,
        }
        setWorkspace((current) => ({
          ...current,
          logs: [...current.logs.filter((item) => !(item.sessionId === selectedSession.id && item.studentId === selectedSession.studentId)), log],
        }))
      }
      try { window.localStorage.removeItem(`aura-workout-draft:${selectedSession.id}:${selectedDay.id}`) } catch { /* optional */ }
      if (status === 'completed') {
        const groupKey = sessionGroupKey(selectedSession)
        const nextLearner = workspace.sessions.find((session) => session.id !== selectedSession.id
          && sessionGroupKey(session) === groupKey
          && !workspace.logs.some((log) => log.sessionId === session.id && log.status === 'completed'))
        if (nextLearner) selectSession(nextLearner)
      }
      setNotice(status === 'completed' ? 'Đã hoàn thành nhật ký buổi tập.' : 'Đã lưu nháp nhật ký.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể lưu nhật ký buổi tập.') }
    finally { setSaving(false) }
  }

  return (
    <main className="pt-workout-workspace">
      <section className="pt-workout-workspace__slides" aria-label="Tổng quan giáo án">
        <article className="pt-workout-workspace__hero"><span>AURA PT · WORKOUT</span><h1>Giáo án & mức tạ</h1><p>Ghi chính xác từng hiệp ngay trong ca dạy.</p><Dumbbell /></article>
        <article className="pt-workout-workspace__metric"><small>Ca trong ngày</small><strong>{distinctSessionCount}</strong><span>{visibleSessions.length} lượt học viên · {completedVisibleCount} đã ghi</span><CalendarDays /></article>
        <article className="pt-workout-workspace__metric"><small>Đã có giáo án</small><strong>{workspace.programs.length}</strong><span>{eligibleStudents.length} học viên còn hợp đồng</span><Target /></article>
      </section>

      <nav className="pt-workout-workspace__tabs" aria-label="Nội dung giáo án">
        <button className={tab === 'today' ? 'is-active' : ''} onClick={() => setTab('today')}><Activity />Ca tập</button>
        <button className={tab === 'program' ? 'is-active' : ''} onClick={() => setTab('program')}><Dumbbell />Giáo án</button>
        <button className={tab === 'library' ? 'is-active' : ''} onClick={() => setTab('library')}><BookOpen />Thư viện</button>
        <button className={tab === 'history' ? 'is-active' : ''} onClick={() => setTab('history')}><History />Tiến bộ</button>
      </nav>

      {(error || notice) && <div className={`pt-workout-workspace__message ${error ? 'is-error' : 'is-success'}`} role={error ? 'alert' : 'status'}>{error || notice}</div>}

      <div className="pt-workout-workspace__toolbar">
        {tab === 'today' && <label>Ngày tập<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>}
        {tab === 'today' && branchOptions.length > 1 && <label>Chi nhánh<select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}><option value="all">Tất cả</option>{branchOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
        {tab === 'today' && trainerOptions.length > 1 && <label>PT<select value={trainerFilter} onChange={(event) => setTrainerFilter(event.target.value)}><option value="all">Tất cả</option>{trainerOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
        {(tab === 'program' || tab === 'history') && <div className="pt-workout-workspace__student-picker">
           <label htmlFor="pt-workout-student-search">Tìm học viên</label>
           <select
             className="pt-workout-workspace__student-select-a11y"
             aria-label="Học viên"
             value={selectedStudentId}
             onChange={(event) => setSelectedStudentId(event.target.value)}
           >
             <option value="">Chọn học viên</option>
             {eligibleStudents.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
           </select>
           <div className="pt-workout-workspace__student-search">
            <span className="pt-workout-workspace__student-search-icon" aria-hidden="true"><Search /></span>
            <input
              id="pt-workout-student-search"
              value={studentSearchQuery}
              onFocus={(event) => { event.currentTarget.select(); setStudentPickerOpen(true) }}
              onBlur={() => window.setTimeout(() => setStudentPickerOpen(false), 120)}
              onChange={(event) => { setStudentSearchQuery(event.target.value); setStudentPickerOpen(true) }}
              placeholder="Nhập tên hoặc số điện thoại"
              autoComplete="off"
              aria-label="Tìm nhanh học viên theo tên hoặc số điện thoại"
              aria-expanded={studentPickerOpen}
              aria-controls="pt-workout-student-results"
            />
            {studentSearchQuery && <button type="button" aria-label="Xóa nội dung tìm kiếm" onMouseDown={(event) => event.preventDefault()} onClick={() => { setStudentSearchQuery(''); setStudentPickerOpen(true) }}><X /></button>}
          </div>
          {studentPickerOpen && <div id="pt-workout-student-results" className="pt-workout-workspace__student-results" role="listbox" aria-label="Kết quả học viên">
            {matchingStudents.map((student) => <button
              type="button"
              role="option"
              aria-selected={student.id === selectedStudentId}
              className={student.id === selectedStudentId ? 'is-selected' : ''}
              key={student.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { setSelectedStudentId(student.id); setStudentSearchQuery(student.name); setStudentPickerOpen(false) }}
            ><span><strong>{student.name}</strong><small>{student.phone || 'Chưa có số điện thoại'}</small></span>{student.id === selectedStudentId && <Check />}</button>)}
            {!matchingStudents.length && <p>Không tìm thấy học viên còn hợp đồng.</p>}
          </div>}
        </div>}
        <button className="pt-workout-workspace__refresh" onClick={() => void load(true)} disabled={loading}><RefreshCw />{loading ? 'Đang tải' : 'Làm mới'}</button>
      </div>

      {tab === 'today' && <section className="pt-workout-workspace__today">
        <aside className="pt-workout-workspace__session-rail">
          <div className="pt-workout-workspace__section-title"><div><span>CA DẠY</span><h2>{date === todayKey() ? 'Hôm nay' : date}</h2></div><Users /></div>
          {!loading && !sessionGroups.length && <div className="pt-workout-workspace__empty"><Check /><strong>Không có ca trong ngày</strong><span>Chọn ngày khác để xem lịch.</span></div>}
          {sessionGroups.map(([key, sessions]) => <div className="pt-workout-workspace__session-group" key={key}>
            <strong>{String(sessions[0].hour).padStart(2, '0')}:00</strong><span>{sessions.length > 1 ? `Ca đôi · ${sessions.length} học viên` : 'Ca cá nhân'} · {sessions[0].trainerName || 'PT Aura'}{sessions[0].branchName ? ` · ${sessions[0].branchName}` : ''}</span>
            {sessions.map((session) => {
              const student = studentMap.get(session.studentId)
              const log = workspace.logs.find((item) => item.sessionId === session.id)
              return <button key={session.id} className={session.id === selectedSessionId ? 'is-active' : ''} onClick={() => selectSession(session)}>
                <span><b>{student?.name || 'Học viên Aura'}</b><small>{programMap.has(session.studentId) ? 'Đã có giáo án' : 'Chưa có giáo án'}</small></span>
                <em className={log?.status === 'completed' ? 'is-done' : ''}>{log?.status === 'completed' ? 'Đã ghi' : log ? 'Nháp' : 'Mở'}</em><ChevronRight />
              </button>
            })}
          </div>)}
        </aside>

        <div className="pt-workout-workspace__logger">
          {!selectedSession ? <div className="pt-workout-workspace__empty"><Dumbbell /><strong>Chọn một ca tập</strong><span>Ca đôi được nhóm theo giờ, nhật ký vẫn tách theo từng học viên.</span></div>
            : !selectedProgram ? <div className="pt-workout-workspace__empty"><Sparkles /><strong>{studentMap.get(selectedSession.studentId)?.name} chưa có giáo án</strong><span>{studentMap.get(selectedSession.studentId)?.eligibleForNewProgram === false ? 'Học viên không còn hợp đồng hiệu lực; ca cũ chỉ được giữ để đối chiếu lịch sử.' : 'Tạo giáo án theo nhóm cơ trước khi nhập mức tạ.'}</span>{studentMap.get(selectedSession.studentId)?.eligibleForNewProgram !== false && <button onClick={() => setTab('program')}>Tạo giáo án</button>}</div>
              : <>
                <header><div><span>NHẬT KÝ CA TẬP</span><h2>{studentMap.get(selectedSession.studentId)?.name}</h2><p>{String(selectedSession.hour).padStart(2, '0')}:00 · {selectedSession.date}</p></div><label>Buổi<select value={selectedDayId} onChange={(event) => setSelectedDayId(event.target.value)}>{programDraft.trainingDays.map((day) => <option key={day.id} value={day.id}>{day.title}</option>)}</select></label></header>
                {selectedLogLocked && <div className="pt-workout-workspace__locked"><Check /><span><strong>Nhật ký đã hoàn thành</strong> Dữ liệu được khóa để bảo toàn lịch sử.</span></div>}
                <div className="pt-workout-workspace__set-list">
                  {selectedDay?.exercises.map((exercise) => <article className="pt-workout-workspace__log-exercise" key={exercise.id}>
                    <div className="pt-workout-workspace__exercise-heading"><div>{exercise.media.posterUrl ? <img src={exercise.media.posterUrl} alt="" /> : <Weight />}</div><span><b>{exercise.nameVi}</b><small>{exercise.targetMuscles.join(' · ') || 'Toàn thân'} · {exercise.sets} hiệp · RPE {exercise.targetRpe}</small>{previousPerformance.get(exercise.catalogExerciseId) && <em>Lần trước: {previousPerformance.get(exercise.catalogExerciseId)?.weightKg || 0} kg × {previousPerformance.get(exercise.catalogExerciseId)?.reps || 0}</em>}</span></div>
                    <div className="pt-workout-workspace__set-grid pt-workout-workspace__set-grid--head"><span>Hiệp</span><span>Kg</span><span>Reps</span><span>RPE</span><span>Đau</span><span>Xong</span></div>
                    {sets.map((set, setIndex) => set.exerciseId === exercise.id && <div className="pt-workout-workspace__set-grid" key={`${exercise.id}-${set.setNumber}`}>
                      <strong>{set.setNumber}</strong>
                      <label><small>Kg</small><input disabled={selectedLogLocked} aria-label={`Mức tạ hiệp ${set.setNumber}`} type="number" min="0" step="0.5" value={set.weightKg || ''} onChange={(event) => setSets((current) => current.map((item, index) => index === setIndex ? { ...item, weightKg: Number(event.target.value) } : item))} /></label>
                      <label><small>Reps</small><input disabled={selectedLogLocked} aria-label={`Số lần hiệp ${set.setNumber}`} type="number" min="0" value={set.reps || ''} onChange={(event) => setSets((current) => current.map((item, index) => index === setIndex ? { ...item, reps: Number(event.target.value) } : item))} /></label>
                      <label><small>RPE</small><input disabled={selectedLogLocked} aria-label={`RPE hiệp ${set.setNumber}`} type="number" min="0" max="10" value={set.rpe || ''} onChange={(event) => setSets((current) => current.map((item, index) => index === setIndex ? { ...item, rpe: Number(event.target.value) } : item))} /></label>
                      <label><small>Đau</small><input disabled={selectedLogLocked} aria-label={`Mức đau hiệp ${set.setNumber}`} type="number" min="0" max="10" value={set.painLevel || ''} onChange={(event) => setSets((current) => current.map((item, index) => index === setIndex ? { ...item, painLevel: Number(event.target.value) } : item))} /></label>
                      <button disabled={selectedLogLocked} aria-label={`Hoàn thành hiệp ${set.setNumber}`} className={set.completed ? 'is-complete' : ''} onClick={() => setSets((current) => current.map((item, index) => index === setIndex ? { ...item, completed: !item.completed } : item))}><Check /></button>
                    </div>)}
                  </article>)}
                </div>
                <div className="pt-workout-workspace__notes"><label>Ghi chú PT<textarea disabled={selectedLogLocked} value={coachNotes} onChange={(event) => setCoachNotes(event.target.value)} placeholder="Mục tiêu, kỹ thuật và phản hồi của buổi tập" /></label><label className={sets.some((set) => set.painLevel >= 4) ? 'has-alert' : ''}>Đau / hạn chế vận động<textarea disabled={selectedLogLocked} value={painNotes} onChange={(event) => setPainNotes(event.target.value)} placeholder="Ghi “không đau” hoặc mô tả phản ứng cần lưu ý" /></label><label>Kế hoạch buổi sau<textarea disabled={selectedLogLocked} value={nextSessionPlan} onChange={(event) => setNextSessionPlan(event.target.value)} placeholder="Bài chính, mức tải hoặc điều chỉnh dự kiến" /></label></div>
                {!selectedLogLocked && <footer><span className="pt-workout-workspace__autosave">Tự lưu trên thiết bị</span><button onClick={() => void saveLog('draft')} disabled={saving}><Save />Lưu nháp</button><button className="is-primary" onClick={() => void saveLog('completed')} disabled={saving}><Check />Hoàn thành buổi</button></footer>}
              </>}
        </div>
      </section>}

      {tab === 'program' && <section className="pt-workout-workspace__program">
        {!selectedStudentId ? <div className="pt-workout-workspace__empty"><Users /><strong>Chọn học viên</strong><span>Giáo án luôn thuộc một hồ sơ học viên cụ thể.</span></div> : <>
          <div className="pt-workout-workspace__program-editor">
            <header><div><span>GIÁO ÁN ĐANG ÁP DỤNG</span><h2>{studentMap.get(selectedStudentId)?.name}</h2></div><em>Revision {programDraft.revision}</em></header>
            <div className="pt-workout-workspace__program-fields"><label>Tên giáo án<input value={programDraft.title} onChange={(event) => setProgramDraft((current) => ({ ...current, title: event.target.value }))} /></label><label>Mục tiêu<input value={programDraft.goal} onChange={(event) => setProgramDraft((current) => ({ ...current, goal: event.target.value }))} placeholder="Tăng cơ mông, cải thiện sức mạnh…" /></label></div>
            <div className="pt-workout-workspace__day-navigation">
              <div className="pt-workout-workspace__day-tabs">{programDraft.trainingDays.map((day) => <button type="button" key={day.id} className={day.id === selectedDay?.id ? 'is-active' : ''} onClick={() => setSelectedDayId(day.id)}>{day.title}</button>)}<button type="button" onClick={() => { const id = crypto.randomUUID(); setProgramDraft((current) => ({ ...current, trainingDays: [...current.trainingDays, { id, title: `Buổi ${current.trainingDays.length + 1}`, focusMuscles: [], notes: '', order: current.trainingDays.length, exercises: [] }] })); setSelectedDayId(id) }}><Plus />Buổi</button></div>
              <button type="button" className="pt-workout-workspace__delete-day" onClick={requestDeleteDay} disabled={!selectedDay || programDraft.trainingDays.length <= 1} title={programDraft.trainingDays.length <= 1 ? 'Giáo án phải còn ít nhất một buổi' : `Xóa ${selectedDay?.title || 'buổi này'}`}><Trash2 />Xóa buổi</button>
            </div>
            {selectedDay && <>
              <div className="pt-workout-workspace__day-fields"><input value={selectedDay.title} onChange={(event) => updateDay((day) => ({ ...day, title: event.target.value }))} aria-label="Tên buổi" /><input value={selectedDay.focusMuscles.join(', ')} onChange={(event) => updateDay((day) => ({ ...day, focusMuscles: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) }))} placeholder="Nhóm cơ: Mông, Đùi sau…" aria-label="Nhóm cơ" /></div>
              <div className="pt-workout-workspace__prescriptions">
                {selectedDay.exercises.map((exercise) => <article key={exercise.id}>
                  <div>{exercise.media.posterUrl ? <img src={exercise.media.posterUrl} alt="" /> : <Dumbbell />}<span><b>{exercise.nameVi}</b><small>{exercise.targetMuscles.join(' · ')}</small></span><button aria-label={`Xóa ${exercise.nameVi}`} onClick={() => updateDay((day) => ({ ...day, exercises: day.exercises.filter((item) => item.id !== exercise.id) }))}><Trash2 /></button></div>
                  <div><label>Hiệp<input type="number" min="1" max="12" value={exercise.sets} onChange={(event) => updateDay((day) => ({ ...day, exercises: day.exercises.map((item) => item.id === exercise.id ? { ...item, sets: Number(event.target.value) } : item) }))} /></label><label>Reps<input value={`${exercise.repMinimum}-${exercise.repMaximum}`} onChange={(event) => { const [minimum, maximum] = event.target.value.split('-').map(Number); updateDay((day) => ({ ...day, exercises: day.exercises.map((item) => item.id === exercise.id ? { ...item, repMinimum: minimum || 1, repMaximum: maximum || minimum || 1 } : item) })) }} /></label><label>RPE<input type="number" min="1" max="10" value={exercise.targetRpe} onChange={(event) => updateDay((day) => ({ ...day, exercises: day.exercises.map((item) => item.id === exercise.id ? { ...item, targetRpe: Number(event.target.value) } : item) }))} /></label><label>Nghỉ<input type="number" min="0" value={exercise.restSeconds} onChange={(event) => updateDay((day) => ({ ...day, exercises: day.exercises.map((item) => item.id === exercise.id ? { ...item, restSeconds: Number(event.target.value) } : item) }))} /></label></div>
                </article>)}
                {!selectedDay.exercises.length && <div className="pt-workout-workspace__empty is-compact"><Dumbbell /><strong>Chưa có bài tập</strong><span>Chọn từ thư viện bên dưới.</span></div>}
              </div>
            </>}
            <label className="pt-workout-workspace__coach-note">Ghi chú chung<textarea value={programDraft.coachNotes} onChange={(event) => setProgramDraft((current) => ({ ...current, coachNotes: event.target.value }))} /></label>
            <button className="pt-workout-workspace__save-program" onClick={() => void saveProgram()} disabled={saving}><Save />{saving ? 'Đang lưu…' : 'Lưu giáo án'}</button>
          </div>
          <aside className="pt-workout-workspace__catalog">
            <div className="pt-workout-workspace__section-title"><div><span>THƯ VIỆN AURA</span><h2>Chọn theo nhóm cơ</h2></div><Sparkles /></div>
            <label className="pt-workout-workspace__search"><Search /><input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Tìm bài tập…" /></label>
            <div className="pt-workout-workspace__muscles" role="group" aria-label="Lọc bài tập theo nhóm cơ">{muscleGroups.map((group) => <button className={group.id === muscleFilter ? 'is-active' : ''} onClick={() => setMuscleFilter(group.id)} key={group.id}>{group.label}<small>{group.count}</small></button>)}</div>
            <div className="pt-workout-workspace__catalog-list">{visibleCatalog.map((item) => <button key={item.id} onClick={() => addExercise(item)} disabled={selectedDay?.exercises.some((exercise) => exercise.catalogExerciseId === item.id)}>{item.media.posterUrl || item.media.startImageUrl ? <img src={item.media.posterUrl || item.media.startImageUrl} alt="" /> : <Dumbbell />}<span><b>{item.nameVi}</b><small>{item.targetMuscles.join(' · ') || item.bodyParts.join(' · ')}</small></span><Plus /></button>)}</div>
            {(visibleCatalog.length < filteredCatalog.length || catalogHasMore) && <button className="pt-workout-workspace__catalog-more" onClick={() => {
              if (visibleCatalog.length < filteredCatalog.length) setCatalogVisibleCount((current) => current + 24)
              else void loadCatalog(true)
            }} disabled={catalogLoading}>{catalogLoading ? 'Đang tải…' : visibleCatalog.length < filteredCatalog.length ? `Xem thêm ${Math.min(24, filteredCatalog.length - visibleCatalog.length)} bài` : 'Tải thêm bài'}</button>}
          </aside>
        </>}
      </section>}

      {tab === 'library' && <ExerciseCatalogManager canPublish={canPublishCatalog} isDemo={isDemo} />}

      {tab === 'history' && <section className="pt-workout-workspace__history">
        {!selectedStudentId ? <div className="pt-workout-workspace__empty"><Users /><strong>Chọn học viên</strong></div> : historyLoading && !history ? <div className="pt-workout-workspace__empty"><RefreshCw /><strong>Đang tải tiến bộ</strong></div> : history && <>
          <div className="pt-workout-workspace__history-metrics"><article><Dumbbell /><span><small>Nhật ký mức tạ</small><strong>{history.analytics.completedWorkouts}</strong></span></article><article><Weight /><span><small>Tổng volume</small><strong>{history.analytics.totalVolumeKg.toLocaleString('vi-VN')} kg</strong></span></article><article className={history.analytics.painAlerts ? 'has-alert' : ''}><AlertTriangle /><span><small>Cảnh báo đau</small><strong>{history.analytics.painAlerts}</strong></span></article></div>
          <div className="pt-workout-workspace__history-grid"><div><div className="pt-workout-workspace__section-title"><div><span>LỊCH SỬ</span><h2>Các buổi đã ghi</h2></div><History /></div>{history.logs.map((log) => <article className="pt-workout-workspace__history-log" key={log.id}><time>{log.date} · {String(log.hour).padStart(2, '0')}:00</time><div><b>{log.trainingDayTitle}</b><span>{log.metrics.completedSets} hiệp · {log.metrics.totalVolumeKg.toLocaleString('vi-VN')} kg</span></div><em className={log.status === 'completed' ? 'is-done' : ''}>{log.status === 'completed' ? 'Hoàn thành' : 'Nháp'}</em></article>)}{!history.logs.length && <div className="pt-workout-workspace__empty is-compact"><BarChart3 /><strong>Chưa có nhật ký</strong><span>Tiến bộ sẽ xuất hiện sau buổi tập đầu tiên.</span></div>}</div><aside><div className="pt-workout-workspace__section-title"><div><span>KỶ LỤC</span><h2>Mức tạ tốt nhất</h2></div><Sparkles /></div>{history.analytics.personalRecords.map((record) => <article key={record.catalogExerciseId}><span><b>{record.exerciseName}</b><small>Volume hiệp tốt nhất {record.maximumSetVolumeKg.toLocaleString('vi-VN')} kg</small></span><strong>{record.maximumWeightKg} kg</strong></article>)}</aside></div>
        </>}
      </section>}

      {pendingDeleteDay && <div className="pt-workout-workspace__dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setPendingDeleteDayId('') }}>
        <section className="pt-workout-workspace__dialog" role="dialog" aria-modal="true" aria-labelledby="delete-training-day-title" aria-describedby="delete-training-day-description">
          <div className="pt-workout-workspace__dialog-icon"><Trash2 /></div>
          <div><span>XÓA BUỔI GIÁO ÁN</span><h2 id="delete-training-day-title">Xóa “{pendingDeleteDay.title}”?</h2></div>
          <p id="delete-training-day-description">Buổi này sẽ được xóa khỏi giáo án hiện tại của {studentMap.get(selectedStudentId)?.name || 'học viên'}. Các buổi đã tập, mức tạ và lịch sử tiến bộ trước đây vẫn được giữ nguyên.</p>
          <div className="pt-workout-workspace__dialog-actions"><button type="button" onClick={() => setPendingDeleteDayId('')} disabled={saving}>Giữ lại</button><button ref={deleteConfirmRef} type="button" className="is-danger" onClick={() => void confirmDeleteDay()} disabled={saving}>{saving ? 'Đang xóa…' : 'Xóa buổi'}</button></div>
        </section>
      </div>}
    </main>
  )
}
