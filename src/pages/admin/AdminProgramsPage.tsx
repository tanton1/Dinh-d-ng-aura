import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Copy,
  Dumbbell,
  Eye,
  FileImage,
  FileSpreadsheet,
  FileText,
  GripVertical,
  Layers3,
  Play,
  Plus,
  Save,
  Search,
  Settings2,
  Sparkles,
  Timer,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import ExercisePrescriptionFields from '../../components/coaching/ExercisePrescriptionFields'
import { PageHeader } from '../../components/ui'
import { workoutExercises } from '../../data'
import { listManagedPtPrograms, loadManagedPtProgram, readPtExercisePrescription, visibleExerciseTags, type ManagedPtProgramSummary } from '../../services/ptCoachingProgramService'
import '../../styles-coaching.css'
import type {
  LessonResourceKind,
  ProgramResourceDraft,
  ProgramQuizDraft,
  ProgramQuizQuestionDraft,
  WorkoutProgramDraftInput,
  WorkoutProgramExerciseDraft,
  WorkoutProgramSessionDraft,
} from '../../types'

interface AdminProgramsPageProps {
  initialProgram?: WorkoutProgramDraftInput
  onSave?: (program: WorkoutProgramDraftInput) => Promise<{ programId: string; versionId: string }>
  onRetry?: () => void
  canPublish?: boolean
  canSubmit?: boolean
}

const exerciseResourceKinds = [
  { kind: 'slide' as const, label: 'Slide', icon: FileSpreadsheet },
  { kind: 'video' as const, label: 'Video', icon: Video },
  { kind: 'document' as const, label: 'Tài liệu', icon: FileText },
]

const muscleFilters = ['Tất cả', 'Toàn thân', 'Lưng', 'Core'] as const
type MuscleFilter = typeof muscleFilters[number]

function createExerciseDraft(base?: Partial<WorkoutProgramExerciseDraft>): WorkoutProgramExerciseDraft {
  return {
    id: `exercise-${crypto.randomUUID()}`,
    name: base?.name ?? 'Bài tập',
    sets: base?.sets ?? 3,
    reps: base?.reps ?? '10',
    rest: base?.rest ?? 45,
    rpe: base?.rpe ?? 7,
    tags: base?.tags ? [...base.tags] : [],
    notes: base?.notes ?? '',
  }
}

function createDefaultResource(kind: LessonResourceKind): ProgramResourceDraft {
  return {
    id: `resource-${crypto.randomUUID()}`,
    kind,
    title: '',
    url: '',
    note: '',
  }
}

function createDefaultQuiz(): ProgramQuizDraft {
  return {
    id: `quiz-${crypto.randomUUID()}`,
    passPercent: 70,
    questionOrder: 'sequential',
    questions: [{
      id: `question-${crypto.randomUUID()}`,
      question: '',
      options: ['', ''],
      correctIndex: 0,
    }],
  }
}

function createSessionDraft(day: number, week = 1): WorkoutProgramSessionDraft {
  return {
    id: `session-w${week}-d${day}`,
    dayLabel: `Buổi ${day}`,
    focus: 'Tối ưu hoạt động cơ bản',
    durationMinutes: 45,
    tags: ['Buổi tập'],
    coachNotes: '',
    exercises: [],
    resources: [],
    quiz: createDefaultQuiz(),
  }
}

function cloneSessionForWeek(session: WorkoutProgramSessionDraft, day: number, week: number): WorkoutProgramSessionDraft {
  return {
    ...structuredClone(session),
    id: `session-w${week}-d${day}`,
  }
}

function normalizeProgram(input?: WorkoutProgramDraftInput): WorkoutProgramDraftInput {
  if (!input) return createDefaultProgram()
  const legacySessions = Object.fromEntries(Object.entries(input.sessionsByDay ?? {})
    .filter(([, session]) => Boolean(session && session.id && session.dayLabel))) as Record<number, WorkoutProgramSessionDraft>
  const weeksByWeek = input.weeksByWeek && Object.keys(input.weeksByWeek).length
    ? structuredClone(input.weeksByWeek)
    : { 1: { weekNumber: 1, label: 'Tuần 1', sessionsByDay: structuredClone(legacySessions) } }
  return {
    ...structuredClone(input),
    schemaVersion: 2,
    versionId: input.versionId || `program-version-${crypto.randomUUID()}`,
    sessionsByDay: weeksByWeek[1]?.sessionsByDay ?? legacySessions,
    weeksByWeek,
  }
}

function createDefaultProgram(): WorkoutProgramDraftInput {
  const sessionsByDay = {
    1: createSessionDraft(1, 1),
    2: createSessionDraft(2, 1),
    3: createSessionDraft(3, 1),
    4: createSessionDraft(4, 1),
  }
  return {
    schemaVersion: 2,
    versionId: `program-version-${crypto.randomUUID()}`,
    title: 'Giáo án nâng cao',
    description: 'Chương trình tập luyện tập trung',
    durationWeeks: 8,
    daysPerWeek: 4,
    status: 'draft',
    sessionsByDay,
    weeksByWeek: { 1: { weekNumber: 1, label: 'Tuần 1', sessionsByDay } },
  }
}

function formatVietnameseDate() {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date())
}

function formatOptions(question: ProgramQuizQuestionDraft) {
  if (!question.options.length) return ['']
  return question.options
}

export default function AdminProgramsPage({ initialProgram, onSave, onRetry, canPublish = false, canSubmit = false }: AdminProgramsPageProps) {
  const [program, setProgram] = useState<WorkoutProgramDraftInput>(() => normalizeProgram(initialProgram))
  const [activeDay, setActiveDay] = useState(1)
  const [week, setWeek] = useState(1)
  const [exerciseQuery, setExerciseQuery] = useState('')
  const [muscleFilter, setMuscleFilter] = useState<MuscleFilter>('Tất cả')
  const [sessionTagInput, setSessionTagInput] = useState('')
  const [resourceKind, setResourceKind] = useState<LessonResourceKind>('video')
  const [resourceUrl, setResourceUrl] = useState('')
  const [resourceTitle, setResourceTitle] = useState('')
  const [resourceNote, setResourceNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [managedPrograms, setManagedPrograms] = useState<ManagedPtProgramSummary[]>([])
  const [programListLoading, setProgramListLoading] = useState(Boolean(onSave))
  const [programLoading, setProgramLoading] = useState(false)

  useEffect(() => {
    let active = true
    if (!onSave) {
      setProgramListLoading(false)
      return () => { active = false }
    }
    void listManagedPtPrograms()
      .then((items) => { if (active) setManagedPrograms(items) })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'Không thể tải danh sách giáo án.') })
      .finally(() => { if (active) setProgramListLoading(false) })
    return () => { active = false }
  }, [])

  const currentWeek = Math.min(Math.max(week, 1), program.durationWeeks)
  const currentWeekSessions = useMemo(
    () => program.weeksByWeek?.[currentWeek]?.sessionsByDay ?? (currentWeek === 1 ? program.sessionsByDay : {}),
    [currentWeek, program.sessionsByDay, program.weeksByWeek],
  )
  const currentSession = useMemo(() => {
    const template = program.weeksByWeek?.[1]?.sessionsByDay[activeDay] ?? program.sessionsByDay[activeDay]
    return currentWeekSessions[activeDay]
      ?? (template ? cloneSessionForWeek(template, activeDay, currentWeek) : createSessionDraft(activeDay, currentWeek))
  }, [activeDay, currentWeek, currentWeekSessions, program.sessionsByDay, program.weeksByWeek])

  const resourcesFiltered = useMemo(() => {
    const normalized = exerciseQuery.trim().toLowerCase()
    return workoutExercises.filter((item) => {
      const searchMatch = item.name.toLowerCase().includes(normalized) || item.target.toLowerCase().includes(normalized)
      if (!searchMatch || muscleFilter === 'Tất cả') return searchMatch
      if (muscleFilter === 'Toàn thân') return true
      return item.target.toLocaleLowerCase('vi').includes(muscleFilter.toLocaleLowerCase('vi'))
    })
  }, [exerciseQuery, muscleFilter])

  const updateSession = (updater: (value: WorkoutProgramSessionDraft) => WorkoutProgramSessionDraft) => {
    setProgram((current) => {
      const weekSessions = current.weeksByWeek?.[currentWeek]?.sessionsByDay
        ?? (currentWeek === 1 ? current.sessionsByDay : {})
      const template = current.weeksByWeek?.[1]?.sessionsByDay[activeDay] ?? current.sessionsByDay[activeDay]
      const baseSession = weekSessions[activeDay]
        ?? (template ? cloneSessionForWeek(template, activeDay, currentWeek) : createSessionDraft(activeDay, currentWeek))
      const nextSession = updater(baseSession)
      const nextWeekSessions = { ...weekSessions, [activeDay]: nextSession }
      return {
        ...current,
        schemaVersion: 2,
        sessionsByDay: currentWeek === 1 ? nextWeekSessions : current.sessionsByDay,
        weeksByWeek: {
          ...(current.weeksByWeek ?? {}),
          [currentWeek]: {
            ...(current.weeksByWeek?.[currentWeek] ?? { weekNumber: currentWeek, label: `Tuần ${currentWeek}` }),
            sessionsByDay: nextWeekSessions,
          },
        },
      }
    })
  }

  const ensureDay = (day: number) => {
    setProgram((current) => {
      const weekSessions = current.weeksByWeek?.[currentWeek]?.sessionsByDay
        ?? (currentWeek === 1 ? current.sessionsByDay : {})
      if (weekSessions[day]) return current
      const template = current.weeksByWeek?.[1]?.sessionsByDay[day] ?? current.sessionsByDay[day]
      const nextWeekSessions = {
        ...weekSessions,
        [day]: template ? cloneSessionForWeek(template, day, currentWeek) : createSessionDraft(day, currentWeek),
      }
      return {
        ...current,
        sessionsByDay: currentWeek === 1 ? nextWeekSessions : current.sessionsByDay,
        weeksByWeek: {
          ...(current.weeksByWeek ?? {}),
          [currentWeek]: { weekNumber: currentWeek, label: `Tuần ${currentWeek}`, sessionsByDay: nextWeekSessions },
        },
      }
    })
  }

  const changeDaysPerWeek = (next: number) => {
    const nextDays = Math.max(1, Math.min(7, next))
    setProgram((current) => {
      const sourceWeeks = current.weeksByWeek ?? { 1: { weekNumber: 1, sessionsByDay: current.sessionsByDay } }
      const weeksByWeek = Object.fromEntries(Object.entries(sourceWeeks).map(([weekKey, weekDraft]) => {
        const weekNumber = Number(weekKey)
        const sessionsByDay: WorkoutProgramDraftInput['sessionsByDay'] = {}
        for (let day = 1; day <= nextDays; day += 1) {
          sessionsByDay[day] = weekDraft.sessionsByDay[day] ?? createSessionDraft(day, weekNumber)
        }
        return [weekNumber, { ...weekDraft, weekNumber, sessionsByDay }]
      }))
      return {
        ...current,
        daysPerWeek: nextDays,
        weeksByWeek,
        sessionsByDay: weeksByWeek[1]?.sessionsByDay ?? current.sessionsByDay,
      }
    })
    setActiveDay(Math.min(activeDay, nextDays))
  }

  const copyCurrentDay = () => {
    if (program.daysPerWeek >= 7) {
      setError('Giáo án đã đạt tối đa 7 buổi mỗi tuần.')
      return
    }
    const nextDay = program.daysPerWeek + 1
    setProgram((current) => {
      const sourceWeeks = current.weeksByWeek ?? { 1: { weekNumber: 1, sessionsByDay: current.sessionsByDay } }
      const weeksByWeek = Object.fromEntries(Object.entries(sourceWeeks).map(([weekKey, weekDraft]) => {
        const weekNumber = Number(weekKey)
        const source = weekNumber === currentWeek
          ? weekDraft.sessionsByDay[activeDay] ?? createSessionDraft(activeDay, weekNumber)
          : createSessionDraft(nextDay, weekNumber)
        return [weekNumber, {
          ...weekDraft,
          sessionsByDay: {
            ...weekDraft.sessionsByDay,
            [nextDay]: {
              ...structuredClone(source),
              id: `session-w${weekNumber}-d${nextDay}`,
              dayLabel: `Buổi ${nextDay}`,
              tags: [...source.tags],
            },
          },
        }]
      }))
      return {
        ...current,
        weeksByWeek,
        sessionsByDay: weeksByWeek[1]?.sessionsByDay ?? current.sessionsByDay,
        daysPerWeek: Math.max(current.daysPerWeek, nextDay),
      }
    })
    setActiveDay(nextDay)
    setError(null)
  }

  const copyWeekForward = () => {
    if (currentWeek >= program.durationWeeks) {
      setError('Đây đã là tuần cuối cùng của giáo án.')
      return
    }
    const targetWeek = currentWeek + 1
    setProgram((current) => {
      const sourceSessions = current.weeksByWeek?.[currentWeek]?.sessionsByDay
        ?? (currentWeek === 1 ? current.sessionsByDay : {})
      const sessionsByDay = Object.fromEntries(Object.entries(sourceSessions).map(([dayKey, session]) => {
        const day = Number(dayKey)
        return [day, cloneSessionForWeek(session, day, targetWeek)]
      }))
      return {
        ...current,
        weeksByWeek: {
          ...(current.weeksByWeek ?? {}),
          [targetWeek]: { weekNumber: targetWeek, label: `Tuần ${targetWeek}`, sessionsByDay },
        },
      }
    })
    setWeek(targetWeek)
    setError(null)
  }

  const addExercise = (name: string) => {
    const matched = workoutExercises.find((item) => item.name === name)
    updateSession((session) => ({
      ...session,
      exercises: [
        ...session.exercises,
        createExerciseDraft({
          name,
          sets: 4,
          reps: '10',
          rest: 60,
          notes: matched ? matched.target : '',
        }),
      ],
    }))
  }

  const removeExercise = (id: string) => {
    updateSession((session) => ({
      ...session,
      exercises: session.exercises.filter((item) => item.id !== id),
    }))
  }

  const updateExercise = (id: string, patch: Partial<WorkoutProgramExerciseDraft>) => {
    updateSession((session) => ({
      ...session,
      exercises: session.exercises.map((exercise) => exercise.id === id ? { ...exercise, ...patch } : exercise),
    }))
  }

  const addExerciseTag = (id: string, value: string) => {
    const tag = value.trim()
    if (!tag) return
    updateSession((session) => ({
      ...session,
      exercises: session.exercises.map((item) => item.id === id
        ? { ...item, tags: item.tags.includes(tag) ? item.tags : [...item.tags, tag] }
        : item,
      ),
    }))
  }

  const removeExerciseTag = (id: string, tag: string) => {
    updateSession((session) => ({
      ...session,
      exercises: session.exercises.map((item) => item.id === id
        ? { ...item, tags: item.tags.filter((itemTag) => itemTag !== tag) }
        : item,
      ),
    }))
  }

  const addSessionTag = () => {
    const tag = sessionTagInput.trim()
    if (!tag) return
    updateSession((session) => ({
      ...session,
      tags: session.tags.includes(tag) ? session.tags : [...session.tags, tag],
    }))
    setSessionTagInput('')
  }

  const removeSessionTag = (tag: string) => {
    updateSession((session) => ({
      ...session,
      tags: session.tags.filter((item) => item !== tag),
    }))
  }

  const addResource = () => {
    const normalizedTitle = resourceTitle.trim()
    const normalizedUrl = resourceUrl.trim()
    if (!normalizedTitle || !normalizedUrl) {
      setError('Hãy nhập tên và URL cho tài nguyên trước khi thêm.')
      return
    }
    if (!/^(https?:\/\/|\/)/i.test(normalizedUrl)) {
      setError('URL tài nguyên phải bắt đầu bằng http://, https:// hoặc /.')
      return
    }
    const payload = createDefaultResource(resourceKind)
    payload.title = normalizedTitle
    payload.url = normalizedUrl
    payload.note = resourceNote.trim()
    updateSession((session) => ({
      ...session,
      resources: [...session.resources, payload],
    }))
    setResourceUrl('')
    setResourceTitle('')
    setResourceNote('')
    setError(null)
  }

  const updateResource = (resourceId: string, patch: Partial<ProgramResourceDraft>) => {
    updateSession((session) => ({
      ...session,
      resources: session.resources.map((resource) => resource.id === resourceId
        ? { ...resource, ...patch }
        : resource,
      ),
    }))
  }

  const removeResource = (resourceId: string) => {
    updateSession((session) => ({
      ...session,
      resources: session.resources.filter((resource) => resource.id !== resourceId),
    }))
  }

  const updateQuizQuestion = (questionId: string, patch: Partial<ProgramQuizQuestionDraft>) => {
    updateSession((session) => {
      const current = session.quiz
      if (!current) return session
      return {
        ...session,
        quiz: {
          ...current,
          questions: current.questions.map((question) => question.id === questionId
            ? { ...question, ...patch }
            : question,
          ),
        },
      }
    })
  }

  const addQuizQuestion = () => {
    updateSession((session) => ({
      ...session,
      quiz: {
        ...(session.quiz ?? createDefaultQuiz()),
        questions: [
          ...(session.quiz?.questions ?? []),
          {
            id: `question-${crypto.randomUUID()}`,
            question: '',
            options: ['', ''],
            correctIndex: 0,
          },
        ],
      },
    }))
  }

  const removeQuizQuestion = (questionId: string) => {
    updateSession((session) => {
      const quiz = session.quiz ?? createDefaultQuiz()
      return {
        ...session,
        quiz: {
          ...quiz,
          questions: quiz.questions.filter((question) => question.id !== questionId),
        },
      }
    })
  }

  const updateQuizOption = (questionId: string, optionIndex: number, value: string) => {
    updateSession((session) => {
      const quiz = session.quiz ?? createDefaultQuiz()
      return {
        ...session,
        quiz: {
          ...quiz,
          questions: quiz.questions.map((question) => {
            if (question.id !== questionId) return question
            const nextOptions = formatOptions(question).map((option, index) => index === optionIndex ? value : option)
            return {
              ...question,
              options: nextOptions,
            }
          }),
        },
      }
    })
  }

  const addQuizOption = (questionId: string) => {
    updateSession((session) => {
      const quiz = session.quiz ?? createDefaultQuiz()
      return {
        ...session,
        quiz: {
          ...quiz,
          questions: quiz.questions.map((question) => question.id === questionId
            ? { ...question, options: [...question.options, ''] }
            : question,
          ),
        },
      }
    })
  }

  const removeQuizOption = (questionId: string, optionIndex: number) => {
    updateSession((session) => {
      const quiz = session.quiz ?? createDefaultQuiz()
      return {
        ...session,
        quiz: {
          ...quiz,
          questions: quiz.questions.map((question) => question.id === questionId
            ? {
              ...question,
              options: question.options.filter((_, index) => index !== optionIndex),
              correctIndex: question.correctIndex === optionIndex
                ? 0
                : question.correctIndex > optionIndex
                  ? question.correctIndex - 1
                  : question.correctIndex,
            }
            : question,
          ),
        },
      }
    })
  }

  const openManagedProgram = async (programId: string) => {
    if (!programId) {
      setProgram(createDefaultProgram())
      setActiveDay(1)
      setWeek(1)
      setError(null)
      return
    }
    const summary = managedPrograms.find((item) => item.id === programId)
    if (!summary) return
    setProgramLoading(true)
    setError(null)
    try {
      const draft = await loadManagedPtProgram(summary.id, summary.currentVersionId)
      setProgram(normalizeProgram(draft))
      setActiveDay(1)
      setWeek(1)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể mở phiên bản giáo án.')
    } finally {
      setProgramLoading(false)
    }
  }

  const clonePublishedProgram = () => {
    const { id: _publishedId, ...copy } = structuredClone(program)
    setProgram({
      ...copy,
      versionId: `program-version-${crypto.randomUUID()}`,
      title: `${program.title} · Bản mới`,
      status: 'draft',
    })
    setWeek(1)
    setActiveDay(1)
    setError(null)
  }

  const saveProgram = async () => {
    if (!onSave) {
      setError('Backend chưa có hàm lưu. Vui lòng kiểm tra lại cấu hình.')
      return
    }
    if (program.id && program.status === 'published') {
      setError('Giáo án đã xuất bản đang được khách hàng sử dụng. Hãy nhân bản để chỉnh sửa mà không làm gián đoạn assignment hiện tại.')
      return
    }
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const savedProgram = await onSave({
        ...program,
        schemaVersion: 2,
        versionId: program.versionId || `program-version-${crypto.randomUUID()}`,
        sessionsByDay: program.weeksByWeek?.[1]?.sessionsByDay ?? program.sessionsByDay,
        title: program.title.trim() || `Giáo án ${formatVietnameseDate()}`,
        description: program.description.trim() || 'Giáo án huấn luyện',
        status: program.status ?? 'draft',
      })
      setProgram((current) => ({
        ...current,
        id: savedProgram.programId,
        versionId: savedProgram.versionId,
      }))
      void listManagedPtPrograms().then(setManagedPrograms).catch(() => undefined)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1800)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Không thể lưu giáo án. Vui lòng kiểm tra quyền admin và thử lại.')
    } finally {
      setSaving(false)
    }
  }

  const activeDayLabel = `Buổi ${activeDay}`
  const dayOptions = Array.from({ length: Math.min(7, program.daysPerWeek) }, (_, index) => index + 1)
  const daySummary = `${currentSession.exercises.length} bài tập · ${currentSession.durationMinutes} phút`
  const statusLabel = program.status === 'published'
    ? 'Đang được xuất bản'
    : program.status === 'review'
      ? 'Đang chờ duyệt'
      : 'Bản nháp'
  const statusActionLabel = program.status === 'published'
    ? 'Đã xuất bản · Chỉ đọc'
    : canPublish
      ? `${statusLabel} · Nhấn để xuất bản`
      : program.status === 'review'
        ? 'Đã gửi duyệt · Nhấn để sửa tiếp'
        : 'Bản nháp · Nhấn để gửi duyệt'

  return (
    <div className="page admin-programs-page">
      <PageHeader
        eyebrow="PT COACHING · PROGRAM STUDIO"
        title="Thiết kế giáo án gym"
        description="Xây dựng giáo án theo tuần, buổi và bài tập để PT quản lý khách hàng. Phân hệ này độc lập với khóa học Aura Academy."
        action={
          <div className="admin-header-actions">
            <button className="outline-button" onClick={() => setPreviewOpen(true)}><Eye size={17} /> Xem trước</button>
            <button className="primary-button" onClick={saveProgram} disabled={saving || !onSave || Boolean(program.id && program.status === 'published')}>
              {saved ? <Check size={17} /> : <Save size={17} />}
              {saving ? 'Đang lưu...' : saved ? 'Đã lưu' : 'Lưu giáo án'}
            </button>
          </div>
        }
      />

      <section className="card pt-program-catalog">
        <div><span className="eyebrow">KHO GIÁO ÁN PT</span><h2>Mở bản nháp, gửi duyệt hoặc xuất bản</h2><p>Nội dung mỗi lần lưu được tạo thành một version bất biến; Administrator có thể mở bản chờ duyệt của PT mà không đổi người sở hữu.</p></div>
        <div className="admin-header-actions">
          <select aria-label="Chọn giáo án PT" value={program.id ?? ''} onChange={(event) => void openManagedProgram(event.target.value)} disabled={programListLoading || programLoading}>
            <option value="">{programListLoading ? 'Đang tải kho giáo án...' : 'Tạo giáo án mới'}</option>
            {managedPrograms.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.status === 'published' ? 'Đã xuất bản' : item.status === 'review' ? 'Chờ duyệt' : 'Bản nháp'}</option>)}
          </select>
          <button className="outline-button" type="button" onClick={() => void openManagedProgram('')} disabled={programLoading}><Plus size={16} /> Giáo án mới</button>
          {program.id && program.status === 'published' && <button className="primary-button" type="button" onClick={clonePublishedProgram}><Copy size={16} /> Nhân bản để chỉnh sửa</button>}
        </div>
      </section>

      <section className="card pt-program-brief">
        <div className="pt-program-brief__intro">
          <span className="pt-scope-badge"><Dumbbell size={15} /> PT COACHING</span>
          <div>
            <h2>Thông tin chương trình huấn luyện</h2>
            <p>Giáo án gym chỉ được gán từ hồ sơ khách hàng PT; không mở khóa hay ảnh hưởng tiến độ khóa học dinh dưỡng.</p>
          </div>
        </div>
        <div className="pt-program-brief__fields">
          <label><span>Tên giáo án</span><input value={program.title} onChange={(event) => setProgram((current) => ({ ...current, title: event.target.value }))} placeholder="Ví dụ: Hypertrophy 12 tuần" /></label>
          <label className="wide"><span>Mục tiêu & đối tượng</span><input value={program.description} onChange={(event) => setProgram((current) => ({ ...current, description: event.target.value }))} placeholder="Mục tiêu, trình độ và lưu ý chính của chương trình" /></label>
          <label><span>Số tuần</span><input type="number" min={1} max={24} value={program.durationWeeks} onChange={(event) => setProgram((current) => ({ ...current, durationWeeks: Math.max(1, Math.min(24, Number(event.target.value) || 1)) }))} /></label>
          <label><span>Buổi / tuần</span><input type="number" min={1} max={7} value={program.daysPerWeek} onChange={(event) => changeDaysPerWeek(Number(event.target.value) || 1)} /></label>
        </div>
      </section>

      <div className="program-info-bar">
        <div className="program-icon"><Dumbbell size={25} /></div>
        <div>
          <span>GIÁO ÁN PT</span>
          <strong>{program.title}</strong>
          <small>{program.durationWeeks} tuần · {program.daysPerWeek} buổi / tuần · {statusLabel}</small>
        </div>
        <button
          type="button"
          className={`status-badge ${program.status === 'published' ? 'published' : 'draft'}`}
          disabled={Boolean(program.id && program.status === 'published') || (!canPublish && !canSubmit)}
          title={canPublish ? 'Đổi trạng thái xuất bản; nhấn Lưu để áp dụng' : 'Gửi bản hoàn chỉnh cho Administrator duyệt'}
          onClick={() => setProgram((current) => ({
            ...current,
            status: current.id && current.status === 'published'
              ? current.status
              : canPublish
              ? current.status === 'published' ? 'draft' : 'published'
              : current.status === 'review' ? 'draft' : 'review',
          }))}
        >{statusActionLabel}</button>
        <div className="program-meta">
          <span><CalendarDays size={16} /> {activeDayLabel} / tuần {currentWeek}</span>
          <span><Timer size={16} /> {daySummary}</span>
          <button onClick={() => setWeek((value) => (value % program.durationWeeks) + 1)}><Sparkles size={17} /> Thay đổi tuần</button>
        </div>
      </div>

      <section className="program-builder-layout">
        <aside className="exercise-library card">
          <div className="library-heading">
            <div><h2>Thư viện bài tập</h2><span>{workoutExercises.length} bài tập</span></div>
            <button title="Nạp lại" onClick={onRetry ?? (() => setExerciseQuery(''))}><Upload size={17} /></button>
          </div>
          <div className="library-search"><Search size={17} /><input value={exerciseQuery} onChange={(event) => setExerciseQuery(event.target.value)} placeholder="Tìm bài tập..." /></div>
          <div className="muscle-pills">
            {muscleFilters.map((filter) => <button key={filter} className={muscleFilter === filter ? 'active' : ''} onClick={() => setMuscleFilter(filter)}>{filter}</button>)}
          </div>
          <div className="library-list">
            {resourcesFiltered.map((item) => (
              <button className="library-exercise" key={item.id} onClick={() => addExercise(item.name)}>
                <span className={`library-thumb ${item.color}`}><Play size={15} /></span>
                <span><strong>{item.name}</strong><small>{item.target}</small></span>
                <Plus size={17} />
              </button>
            ))}
          </div>
          <button className="create-exercise" onClick={() => addExercise('Bài tập mới')}><Plus size={16} /> Tạo bài tập mới</button>
        </aside>

        <main className="plan-canvas">
          <div className="week-navigation">
            <button onClick={() => setWeek((value) => Math.max(1, value - 1))}><ChevronLeft size={18} /></button>
            <div><small>Tuần đang chọn</small><strong>{currentWeek} / {program.durationWeeks}</strong></div>
            <button onClick={() => setWeek((value) => Math.min(program.durationWeeks, value + 1))}><ChevronRight size={18} /></button>
            <span />
            <button className="outline-button small" onClick={() => changeDaysPerWeek(program.daysPerWeek + 1)}><Copy size={15} /> Tăng buổi / tuần</button>
            <button className="outline-button small" onClick={copyCurrentDay} disabled={program.daysPerWeek >= 7}><Layers3 size={15} /> Nhân thêm buổi</button>
            <button className="outline-button small" onClick={copyWeekForward} disabled={currentWeek >= program.durationWeeks}><Copy size={15} /> Sao chép sang tuần kế</button>
            <button className="outline-button small" onClick={() => setProgram((value) => ({ ...value, durationWeeks: Math.max(2, value.durationWeeks - 1) }))}><Settings2 size={15} /> Giảm tuần</button>
            <button className="outline-button small" onClick={() => setProgram((value) => ({ ...value, durationWeeks: Math.min(24, value.durationWeeks + 1) }))}><Settings2 size={15} /> Tăng tuần</button>
          </div>

          <div className="day-tabs">
            {dayOptions.map((day) => (
              <button
                key={day}
                className={activeDay === day ? 'active' : ''}
                onClick={() => {
                  ensureDay(day)
                  setActiveDay(day)
                }}
              >
                <span>NGÀY {day}</span>
                <strong>{(currentWeekSessions[day]?.dayLabel) ?? `Buổi ${day}`}</strong>
                <small>{(currentWeekSessions[day]?.exercises.length ?? 0)} bài tập</small>
              </button>
            ))}
          </div>

          <div className="day-workout-card">
            <header>
              <div>
                <span className="eyebrow">NGÀY {activeDay} / TUẦN {currentWeek}</span>
                <h2>
                  <input
                    value={currentSession.dayLabel}
                    onChange={(event) => updateSession((session) => ({ ...session, dayLabel: event.target.value }))}
                    aria-label="Ten buoi"
                    style={{ border: 0, outline: 0, minWidth: 180, fontSize: 22, fontWeight: 700, background: 'transparent' }}
                  />
                </h2>
                <p>
                  <input
                    value={currentSession.focus}
                    onChange={(event) => updateSession((session) => ({ ...session, focus: event.target.value }))}
                    placeholder="Mục tiêu buổi tập"
                    style={{ width: '100%', border: 0, outline: 0, background: 'transparent', color: 'var(--muted)' }}
                  />
                </p>
                <small title="Mã kỹ thuật phục vụ gán giáo án cho khách hàng">Mã giáo án: {program.id} · Buổi: {currentSession.id} · Phiên bản: {program.versionId}</small>
              </div>
              <div>
                <span><Timer size={15} /> <input
                  value={currentSession.durationMinutes}
                  onChange={(event) => updateSession((session) => ({ ...session, durationMinutes: Number(event.target.value) || 30 }))}
                  style={{ width: 52, border: 0, outline: 0, background: 'transparent', textAlign: 'right' }}
                /> phút</span>
                <button title="Về buổi đầu tiên" onClick={() => setActiveDay(1)}><ArrowLeft size={18} /></button>
              </div>
            </header>

            <div className="exercise-table-head"><span /><span>BÀI TẬP</span><span>THẺ</span><span>SET</span><span>REP</span><span>NGHỈ</span><span>RPE</span><span /></div>
            <div className="builder-lesson-meta">
              <div>
                <label><span>Thẻ buổi</span><input value={sessionTagInput} onChange={(event) => setSessionTagInput(event.target.value)} placeholder="Nhập thẻ buổi tập" /><button className="outline-button" onClick={addSessionTag}>Thêm thẻ</button></label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {currentSession.tags.map((tag) => (
                    <button key={tag} className="tag-chip" type="button" onClick={() => removeSessionTag(tag)}>{tag} <X size={12} /></button>
                  ))}
                </div>
              </div>
            </div>

            <div className="plan-exercises">
              {currentSession.exercises.map((exercise, index) => (
                <article className="pt-exercise-prescription-card" key={exercise.id}>
                <div className="plan-exercise-row">
                  <GripVertical size={17} />
                  <span>
                    <i className={['green', 'orange', 'purple', 'blue', 'pink'][index % 5]}>{String(index + 1).padStart(2, '0')}</i>
                    <span>
                      <strong>
                        <input
                          value={exercise.name}
                          onChange={(event) => updateExercise(exercise.id, { name: event.target.value })}
                          style={{ border: 0, outline: 0, background: 'transparent', width: 140, fontWeight: 800 }}
                        />
                      </strong>
                      <small>
                        <input
                          value={exercise.notes}
                          onChange={(event) => updateExercise(exercise.id, { notes: event.target.value })}
                          placeholder="Ghi chú"
                          style={{ border: 0, outline: 0, background: 'transparent', width: 170, fontSize: 10 }}
                        />
                      </small>
                    </span>
                  </span>
                  <span>
                    {visibleExerciseTags(exercise.tags).map((tag) => <small key={tag} className="tag-chip" style={{ marginRight: 4 }} onClick={() => removeExerciseTag(exercise.id, tag)}>{tag}</small>)}
                    <button className="outline-button" onClick={() => addExerciseTag(exercise.id, `muc-${index + 1}`)}>+</button>
                  </span>
                  <input
                    value={exercise.sets}
                    onChange={(event) => updateExercise(exercise.id, { sets: Number(event.target.value) || 0 })}
                    type="number"
                    min={0}
                  />
                  <input
                    value={exercise.reps}
                    onChange={(event) => updateExercise(exercise.id, { reps: event.target.value })}
                  />
                  <span className="rest-value">
                    <input
                      value={exercise.rest}
                      onChange={(event) => updateExercise(exercise.id, { rest: Number(event.target.value) || 0 })}
                      type="number"
                      min={0}
                    />s
                  </span>
                  <span className="rpe-value">
                    <input
                      value={exercise.rpe}
                      onChange={(event) => updateExercise(exercise.id, { rpe: Number(event.target.value) || 1 })}
                      type="number"
                      min={1}
                      max={10}
                    />
                  </span>
                  <div>
                    <button title="Sao chép" onClick={() => updateSession((session) => ({ ...session, exercises: [...session.exercises, { ...exercise, id: `exercise-${crypto.randomUUID()}` }] }))}><Copy size={15} /></button>
                    <button title="Xóa" onClick={() => removeExercise(exercise.id)}><Trash2 size={15} /></button>
                  </div>
                </div>
                <ExercisePrescriptionFields exercise={exercise} onChange={(tags) => updateExercise(exercise.id, { tags })} />
                </article>
              ))}
            </div>

            <div className="workout-note" style={{ marginTop: 12 }}>
              <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>Chỉ dẫn chung của PT cho buổi tập</strong>
                <button className="outline-button" onClick={() => updateSession((session) => ({ ...session, coachNotes: '' }))}>Xóa hết</button>
              </label>
              <textarea
                value={currentSession.coachNotes}
                onChange={(event) => updateSession((session) => ({ ...session, coachNotes: event.target.value }))}
                placeholder="Cue kỹ thuật, mức nỗ lực, lưu ý chấn thương và điều chỉnh riêng cho khách hàng."
                rows={3}
              />
            </div>

            <section className="builder-lesson-editor" style={{ marginTop: 14 }} hidden aria-hidden="true">
              <div className="builder-lesson-meta">
                <label><span>Học liệu buổi tập</span><div className="exercise-table-head" style={{ gridTemplateColumns: 'auto', borderRadius: 0 }}><span>Slide, video và tài liệu cho buổi này</span></div></label>
              </div>

              <div className="builder-resource-grid">
                <label className="builder-resource-row">
                  <span className="resource-kind-icon"><FileSpreadsheet size={15} /></span>
                  <select value={resourceKind} onChange={(event) => setResourceKind(event.target.value as LessonResourceKind)}>
                    {exerciseResourceKinds.map((item) => <option key={item.kind} value={item.kind}>{item.label}</option>)}
                  </select>
                  <input className="resource-title" value={resourceTitle} onChange={(event) => setResourceTitle(event.target.value)} placeholder="Tiêu đề tài nguyên" />
                  <input className="resource-url" value={resourceUrl} onChange={(event) => setResourceUrl(event.target.value)} placeholder="URL slide/video/document" />
                  <input className="resource-note" value={resourceNote} onChange={(event) => setResourceNote(event.target.value)} placeholder="Ghi chú" />
                  <button className="outline-button" onClick={addResource}><Upload size={15} /> Thêm</button>
                </label>

                {currentSession.resources.map((resource) => {
                  const kindIcon = exerciseResourceKinds.find((item) => item.kind === resource.kind)?.icon ?? FileImage
                  const Icon = kindIcon
                  return (
                    <article className="builder-resource-row" key={resource.id}>
                      <span className="resource-kind-icon"><Icon size={14} /></span>
                      <select value={resource.kind} onChange={(event) => updateResource(resource.id, { kind: event.target.value as LessonResourceKind })}>
                        {exerciseResourceKinds.map((item) => <option key={item.kind} value={item.kind}>{item.label}</option>)}
                      </select>
                      <input className="resource-title" value={resource.title} onChange={(event) => updateResource(resource.id, { title: event.target.value })} />
                      <input className="resource-url" value={resource.url} onChange={(event) => updateResource(resource.id, { url: event.target.value })} />
                      <input className="resource-note" value={resource.note || ''} onChange={(event) => updateResource(resource.id, { note: event.target.value })} />
                      <button onClick={() => removeResource(resource.id)}><Trash2 size={13} /></button>
                    </article>
                  )
                })}
              </div>
            </section>

            <section className="builder-quiz" style={{ marginTop: 14 }} hidden aria-hidden="true">
              <div className="builder-quiz-head">
                <span><strong>Quiz của buổi tập</strong><small>Xây dựng câu hỏi đánh giá hiệu quả</small></span>
                <select
                  value={currentSession.quiz.questionOrder}
                  onChange={(event) => updateSession((session) => ({ ...session, quiz: { ...(session.quiz ?? createDefaultQuiz()), questionOrder: event.target.value as 'sequential' | 'shuffle' } }))}
                >
                  <option value="sequential">Theo thứ tự</option>
                  <option value="shuffle">Ngẫu nhiên</option>
                </select>
                <select
                  value={currentSession.quiz.passPercent}
                  onChange={(event) => updateSession((session) => ({ ...session, quiz: { ...(session.quiz ?? createDefaultQuiz()), passPercent: Number(event.target.value) } }))}
                >
                  <option value={60}>Đạt 60%</option>
                  <option value={70}>Đạt 70%</option>
                  <option value={80}>Đạt 80%</option>
                  <option value={90}>Đạt 90%</option>
                </select>
              </div>

              {currentSession.quiz.questions.map((question, questionIndex) => (
                <article className="builder-question" key={question.id}>
                  <div className="builder-question-head">
                    <strong>Câu hỏi {questionIndex + 1}</strong>
                    <button onClick={() => removeQuizQuestion(question.id)}><Trash2 size={14} /></button>
                  </div>
                  <textarea
                    value={question.question}
                    onChange={(event) => updateQuizQuestion(question.id, { question: event.target.value })}
                    rows={2}
                    placeholder="Nhập nội dung câu hỏi..."
                  />
                  <div className="builder-quiz-options">
                    {formatOptions(question).map((option, optionIndex) => (
                      <label key={`${question.id}-${optionIndex}`}>
                        <input
                          type="radio"
                          checked={question.correctIndex === optionIndex}
                          onChange={() => updateQuizQuestion(question.id, { correctIndex: optionIndex })}
                        />
                        <input
                          value={option}
                          onChange={(event) => updateQuizOption(question.id, optionIndex, event.target.value)}
                          placeholder={`Lựa chọn ${optionIndex + 1}`}
                        />
                        <button onClick={() => removeQuizOption(question.id, optionIndex)}>
                          <X size={14} />
                        </button>
                      </label>
                    ))}
                  </div>
                  <button className="outline-button" onClick={() => addQuizOption(question.id)}>Thêm lựa chọn</button>
                </article>
              ))}

              <button className="outline-button" onClick={addQuizQuestion}><Plus size={14} /> Thêm câu hỏi</button>
            </section>

            {error && <div className="builder-save-error" role="alert"><ClipboardList size={16} /> {error}</div>}

            {saved && <div className="program-summary"><span><Layers3 size={17} /> Đã lưu thành công</span><span><Timer size={17} /> {new Intl.DateTimeFormat('vi-VN', { minute: '2-digit', second: '2-digit' }).format(new Date())}</span></div>}

            <div className="program-summary">
              <span><Layers3 size={17} /> {currentSession.exercises.length} bài tập</span>
              <span><Timer size={17} /> Thời lượng {currentSession.durationMinutes} phút</span>
              <span><Dumbbell size={17} /> {program.durationWeeks} tuần</span>
            </div>
          </div>
        </main>
      </section>

      {previewOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setPreviewOpen(false)}>
          <section className="program-preview-modal" role="dialog" aria-modal="true" aria-labelledby="program-preview-title" onClick={(event) => event.stopPropagation()}>
            <header>
              <div><span className="eyebrow">XEM TRƯỚC GIÁO ÁN</span><h2 id="program-preview-title">{program.title}</h2><p>{currentSession.dayLabel} · Tuần {currentWeek}</p></div>
              <button className="icon-button" aria-label="Đóng xem trước" onClick={() => setPreviewOpen(false)}><X size={18} /></button>
            </header>
            <div className="program-preview-stats">
              <span><Dumbbell size={18} /><strong>{currentSession.exercises.length}</strong><small>bài tập</small></span>
              <span><Timer size={18} /><strong>{currentSession.durationMinutes}</strong><small>phút</small></span>
            </div>
            <div className="program-preview-content">
              <div><h3>Mục tiêu buổi tập</h3><p>{currentSession.focus || 'Chưa nhập mục tiêu.'}</p></div>
              <div><h3>Danh sách bài tập</h3>{currentSession.exercises.length ? <ol>{currentSession.exercises.map((exercise) => {
                const prescription = readPtExercisePrescription(exercise.tags)
                return <li key={exercise.id}><span><strong>{exercise.name}</strong><small>{exercise.notes || 'Chưa có ghi chú'}{prescription.substitute ? ` · Thay thế: ${prescription.substitute}` : ''}</small></span><b>{exercise.sets} × {exercise.reps} · RPE {exercise.rpe} · RIR {prescription.rir} · {prescription.tempo}</b></li>
              })}</ol> : <p className="preview-empty">Chưa có bài tập. Hãy chọn bài từ thư viện bên trái.</p>}</div>
              {currentSession.coachNotes && <div><h3>Ghi chú huấn luyện viên</h3><p>{currentSession.coachNotes}</p></div>}
            </div>
            <footer><button className="outline-button" onClick={() => setPreviewOpen(false)}>Quay lại chỉnh sửa</button><button className="primary-button" onClick={() => { setPreviewOpen(false); void saveProgram() }} disabled={saving || !onSave || Boolean(program.id && program.status === 'published')}><Save size={16} /> Lưu giáo án</button></footer>
          </section>
        </div>
      )}
    </div>
  )
}

