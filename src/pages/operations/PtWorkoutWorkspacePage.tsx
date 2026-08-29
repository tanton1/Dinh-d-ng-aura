import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, BarChart3, CalendarDays, Check, ChevronRight, Dumbbell,
  History, Plus, RefreshCw, Save, Search, Sparkles, Target, Trash2, Users, Weight,
} from 'lucide-react'
import { listExerciseCatalog } from '../../services/exerciseCatalogService'
import type { ExerciseCatalogItem } from '../../types'
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

type WorkspaceTab = 'today' | 'program' | 'history'

const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })
const muscleLabels = ['Tất cả', 'Mông', 'Đùi trước', 'Đùi sau', 'Lưng', 'Ngực', 'Vai', 'Tay', 'Bụng']

function todayKey() { return dateFormatter.format(new Date()) }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function emptyProgram(): PtTrainingProgram {
  return {
    title: 'Giáo án PT Aura', goal: '', coachNotes: '', status: 'active', revision: 0,
    trainingDays: [{ id: crypto.randomUUID(), title: 'Buổi 1', focusMuscles: [], notes: '', order: 0, exercises: [] }],
  }
}

function demoWorkspace(date: string): PtWorkoutWorkspace {
  const students: PtWorkoutStudent[] = [
    { id: 'student-demo-a', name: 'Nguyễn Minh Anh', phone: '0900000001', branchId: 'branch-demo' },
    { id: 'student-demo-b', name: 'Trần Thu Hà', phone: '0900000002', branchId: 'branch-demo' },
  ]
  return {
    students,
    sessions: students.map((student, index) => ({ id: `session-demo-${index}`, studentId: student.id, trainerId: 'trainer-demo', date, hour: 8, status: 'scheduled' })),
    programs: [], logs: [],
  }
}

function exerciseFromCatalog(item: ExerciseCatalogItem): PtTrainingExercise {
  const prescription = item.defaultPrescription
  const numbers = prescription.reps.match(/\d+/g)?.map(Number) ?? [10, 12]
  return {
    id: crypto.randomUUID(), catalogExerciseId: item.id, catalogRevision: item.revision, nameVi: item.nameVi,
    targetMuscles: item.targetMuscles, secondaryMuscles: item.secondaryMuscles, equipment: item.equipment,
    instructionsVi: item.instructionsVi, cuesVi: item.cuesVi, media: { posterUrl: item.media.posterUrl || item.media.startImageUrl, animationUrl: item.media.animationUrl },
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

function groupedSessions(sessions: PtWorkoutSession[]) {
  const groups = new Map<string, PtWorkoutSession[]>()
  sessions.forEach((session) => {
    const key = `${session.date}-${session.hour}`
    groups.set(key, [...(groups.get(key) || []), session])
  })
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
}

export default function PtWorkoutWorkspacePage({ isDemo = false }: { isDemo?: boolean }) {
  const [tab, setTab] = useState<WorkspaceTab>('today')
  const [date, setDate] = useState(todayKey())
  const [workspace, setWorkspace] = useState<PtWorkoutWorkspace>({ sessions: [], students: [], programs: [], logs: [] })
  const [selectedStudentId, setSelectedStudentId] = useState('')
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [programDraft, setProgramDraft] = useState<PtTrainingProgram>(emptyProgram)
  const [selectedDayId, setSelectedDayId] = useState('')
  const [sets, setSets] = useState<PtWorkoutSet[]>([])
  const [catalog, setCatalog] = useState<ExerciseCatalogItem[]>([])
  const [catalogQuery, setCatalogQuery] = useState('')
  const [muscleFilter, setMuscleFilter] = useState('Tất cả')
  const [history, setHistory] = useState<PtWorkoutHistory | null>(null)
  const [coachNotes, setCoachNotes] = useState('')
  const [painNotes, setPainNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const studentMap = useMemo(() => new Map(workspace.students.map((student) => [student.id, student])), [workspace.students])
  const programMap = useMemo(() => new Map(workspace.programs.map((program) => [program.studentId || program.id || '', program])), [workspace.programs])
  const selectedSession = workspace.sessions.find((session) => session.id === selectedSessionId) || null
  const selectedProgram = programMap.get(selectedStudentId) || null
  const selectedDay = programDraft.trainingDays.find((day) => day.id === selectedDayId) || programDraft.trainingDays[0]
  const selectedLog = workspace.logs.find((log) => log.sessionId === selectedSessionId && log.studentId === selectedStudentId) || null
  const sessionGroups = useMemo(() => groupedSessions(workspace.sessions), [workspace.sessions])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const result = isDemo ? demoWorkspace(date) : await getPtWorkoutWorkspace(date)
      setWorkspace(result)
      const firstSession = result.sessions[0]
      setSelectedSessionId((current) => result.sessions.some((item) => item.id === current) ? current : firstSession?.id || '')
      setSelectedStudentId((current) => result.students.some((item) => item.id === current) ? current : firstSession?.studentId || result.students[0]?.id || '')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tải dữ liệu giáo án PT.') }
    finally { setLoading(false) }
  }, [date, isDemo])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (tab !== 'program' || catalog.length || isDemo) return
    void listExerciseCatalog({ includeReview: false }).then(setCatalog).catch((cause) => setError(cause instanceof Error ? cause.message : 'Không thể tải thư viện bài tập.'))
  }, [catalog.length, isDemo, tab])
  useEffect(() => {
    const next = selectedProgram ? clone(selectedProgram) : emptyProgram()
    setProgramDraft(next)
    setSelectedDayId(next.trainingDays[0]?.id || '')
  }, [selectedProgram, selectedStudentId])
  useEffect(() => {
    if (!selectedSession || !selectedDay) { setSets([]); return }
    const log = workspace.logs.find((item) => item.sessionId === selectedSession.id && item.studentId === selectedSession.studentId)
    setSets(log?.trainingDayId === selectedDay.id ? clone(log.sets) : defaultSets(selectedDay))
    setCoachNotes(log?.coachNotes || '')
    setPainNotes(log?.painNotes || '')
  }, [selectedDay?.id, selectedSession?.id, workspace.logs])
  useEffect(() => {
    if (tab !== 'history' || !selectedStudentId) return
    if (isDemo) {
      setHistory({ studentId: selectedStudentId, logs: workspace.logs, analytics: { completedWorkouts: 0, totalVolumeKg: 0, painAlerts: 0, personalRecords: [] } })
      return
    }
    setHistory(null)
    void listPtWorkoutHistory(selectedStudentId).then(setHistory).catch((cause) => setError(cause instanceof Error ? cause.message : 'Không thể tải tiến bộ.'))
  }, [isDemo, selectedStudentId, tab, workspace.logs])

  const filteredCatalog = useMemo(() => {
    const query = catalogQuery.trim().toLocaleLowerCase('vi')
    return catalog.filter((item) => {
      const matchesQuery = !query || [item.nameVi, item.nameEn, ...item.targetMuscles, ...item.bodyParts].join(' ').toLocaleLowerCase('vi').includes(query)
      const matchesMuscle = muscleFilter === 'Tất cả' || [...item.targetMuscles, ...item.bodyParts].some((value) => value.toLocaleLowerCase('vi').includes(muscleFilter.toLocaleLowerCase('vi')))
      return matchesQuery && matchesMuscle
    }).slice(0, 24)
  }, [catalog, catalogQuery, muscleFilter])

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

  const saveProgram = async () => {
    if (!selectedStudentId || !programDraft.trainingDays.every((day) => day.exercises.length)) { setError('Mỗi buổi giáo án cần ít nhất một bài tập.'); return }
    setSaving(true); setError('')
    try {
      if (isDemo) {
        const next = { ...programDraft, studentId: selectedStudentId, revision: programDraft.revision + 1 }
        setWorkspace((current) => ({ ...current, programs: [...current.programs.filter((item) => (item.studentId || item.id) !== selectedStudentId), next] }))
      } else {
        await savePtStudentTrainingPlan({
          studentId: selectedStudentId, expectedRevision: programDraft.revision,
          program: { title: programDraft.title, goal: programDraft.goal, coachNotes: programDraft.coachNotes, status: programDraft.status, trainingDays: programDraft.trainingDays },
        })
        await load()
      }
      setNotice('Đã lưu giáo án và tạo revision mới.'); setTab('today')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể lưu giáo án.') }
    finally { setSaving(false) }
  }

  const saveLog = async (status: 'draft' | 'completed') => {
    if (!selectedSession || !selectedDay) return
    setSaving(true); setError('')
    try {
      if (isDemo) {
        const log: PtWorkoutLog = {
          id: `demo-${selectedSession.id}`, sessionId: selectedSession.id, studentId: selectedSession.studentId,
          date: selectedSession.date, hour: selectedSession.hour, trainingDayId: selectedDay.id, trainingDayTitle: selectedDay.title,
          status, revision: (selectedLog?.revision || 0) + 1, sets: clone(sets), coachNotes, painNotes,
          metrics: { completedSets: sets.filter((set) => set.completed).length, totalVolumeKg: sets.reduce((sum, set) => sum + (set.completed ? set.weightKg * set.reps : 0), 0), maximumWeightKg: Math.max(0, ...sets.map((set) => set.completed ? set.weightKg : 0)), maximumRpe: Math.max(0, ...sets.map((set) => set.rpe)), painAlert: sets.some((set) => set.painLevel >= 4) },
        }
        setWorkspace((current) => ({ ...current, logs: [...current.logs.filter((item) => item.sessionId !== selectedSession.id), log] }))
      } else {
        await savePtSessionWorkoutLog({ sessionId: selectedSession.id, studentId: selectedSession.studentId, expectedRevision: selectedLog?.revision || 0, trainingDayId: selectedDay.id, status, sets, coachNotes, painNotes })
        await load()
      }
      setNotice(status === 'completed' ? 'Đã hoàn thành nhật ký buổi tập.' : 'Đã lưu nháp nhật ký.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể lưu nhật ký buổi tập.') }
    finally { setSaving(false) }
  }

  return (
    <main className="pt-workout-workspace">
      <section className="pt-workout-workspace__slides" aria-label="Tổng quan giáo án">
        <article className="pt-workout-workspace__hero"><span>AURA PT · WORKOUT</span><h1>Giáo án & mức tạ</h1><p>Ghi chính xác từng hiệp ngay trong ca dạy.</p><Dumbbell /></article>
        <article className="pt-workout-workspace__metric"><small>Ca trong ngày</small><strong>{workspace.sessions.length}</strong><span>{workspace.logs.filter((log) => log.status === 'completed').length} đã ghi xong</span><CalendarDays /></article>
        <article className="pt-workout-workspace__metric"><small>Đã có giáo án</small><strong>{workspace.programs.length}</strong><span>{workspace.students.length} học viên trong phạm vi</span><Target /></article>
      </section>

      <nav className="pt-workout-workspace__tabs" aria-label="Nội dung giáo án">
        <button className={tab === 'today' ? 'is-active' : ''} onClick={() => setTab('today')}><Activity />Ca tập</button>
        <button className={tab === 'program' ? 'is-active' : ''} onClick={() => setTab('program')}><Dumbbell />Giáo án</button>
        <button className={tab === 'history' ? 'is-active' : ''} onClick={() => setTab('history')}><History />Tiến bộ</button>
      </nav>

      {(error || notice) && <div className={`pt-workout-workspace__message ${error ? 'is-error' : 'is-success'}`} role={error ? 'alert' : 'status'}>{error || notice}</div>}

      <div className="pt-workout-workspace__toolbar">
        {tab === 'today' && <label>Ngày tập<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>}
        {(tab === 'program' || tab === 'history') && <label>Học viên<select value={selectedStudentId} onChange={(event) => setSelectedStudentId(event.target.value)}><option value="">Chọn học viên</option>{workspace.students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}</select></label>}
        <button className="pt-workout-workspace__refresh" onClick={() => void load()} disabled={loading}><RefreshCw />{loading ? 'Đang tải' : 'Làm mới'}</button>
      </div>

      {tab === 'today' && <section className="pt-workout-workspace__today">
        <aside className="pt-workout-workspace__session-rail">
          <div className="pt-workout-workspace__section-title"><div><span>CA DẠY</span><h2>{date === todayKey() ? 'Hôm nay' : date}</h2></div><Users /></div>
          {!loading && !sessionGroups.length && <div className="pt-workout-workspace__empty"><Check /><strong>Không có ca trong ngày</strong><span>Chọn ngày khác để xem lịch.</span></div>}
          {sessionGroups.map(([key, sessions]) => <div className="pt-workout-workspace__session-group" key={key}>
            <strong>{String(sessions[0].hour).padStart(2, '0')}:00</strong><span>{sessions.length > 1 ? `Ca đôi · ${sessions.length} học viên` : 'Ca cá nhân'}</span>
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
            : !selectedProgram ? <div className="pt-workout-workspace__empty"><Sparkles /><strong>{studentMap.get(selectedSession.studentId)?.name} chưa có giáo án</strong><span>Tạo giáo án theo nhóm cơ trước khi nhập mức tạ.</span><button onClick={() => setTab('program')}>Tạo giáo án</button></div>
              : <>
                <header><div><span>NHẬT KÝ CA TẬP</span><h2>{studentMap.get(selectedSession.studentId)?.name}</h2><p>{String(selectedSession.hour).padStart(2, '0')}:00 · {selectedSession.date}</p></div><label>Buổi<select value={selectedDayId} onChange={(event) => setSelectedDayId(event.target.value)}>{programDraft.trainingDays.map((day) => <option key={day.id} value={day.id}>{day.title}</option>)}</select></label></header>
                <div className="pt-workout-workspace__set-list">
                  {selectedDay?.exercises.map((exercise) => <article className="pt-workout-workspace__log-exercise" key={exercise.id}>
                    <div className="pt-workout-workspace__exercise-heading"><div>{exercise.media.posterUrl ? <img src={exercise.media.posterUrl} alt="" /> : <Weight />}</div><span><b>{exercise.nameVi}</b><small>{exercise.targetMuscles.join(' · ') || 'Toàn thân'} · {exercise.sets} hiệp · RPE {exercise.targetRpe}</small></span></div>
                    <div className="pt-workout-workspace__set-grid pt-workout-workspace__set-grid--head"><span>Hiệp</span><span>Kg</span><span>Reps</span><span>RPE</span><span>Đau</span><span>Xong</span></div>
                    {sets.map((set, setIndex) => set.exerciseId === exercise.id && <div className="pt-workout-workspace__set-grid" key={`${exercise.id}-${set.setNumber}`}>
                      <strong>{set.setNumber}</strong>
                      <input aria-label={`Mức tạ hiệp ${set.setNumber}`} type="number" min="0" step="0.5" value={set.weightKg || ''} onChange={(event) => setSets((current) => current.map((item, index) => index === setIndex ? { ...item, weightKg: Number(event.target.value) } : item))} />
                      <input aria-label={`Số lần hiệp ${set.setNumber}`} type="number" min="0" value={set.reps || ''} onChange={(event) => setSets((current) => current.map((item, index) => index === setIndex ? { ...item, reps: Number(event.target.value) } : item))} />
                      <input aria-label={`RPE hiệp ${set.setNumber}`} type="number" min="0" max="10" value={set.rpe || ''} onChange={(event) => setSets((current) => current.map((item, index) => index === setIndex ? { ...item, rpe: Number(event.target.value) } : item))} />
                      <input aria-label={`Mức đau hiệp ${set.setNumber}`} type="number" min="0" max="10" value={set.painLevel || ''} onChange={(event) => setSets((current) => current.map((item, index) => index === setIndex ? { ...item, painLevel: Number(event.target.value) } : item))} />
                      <button aria-label={`Hoàn thành hiệp ${set.setNumber}`} className={set.completed ? 'is-complete' : ''} onClick={() => setSets((current) => current.map((item, index) => index === setIndex ? { ...item, completed: !item.completed } : item))}><Check /></button>
                    </div>)}
                  </article>)}
                </div>
                <div className="pt-workout-workspace__notes"><label>Ghi chú PT<textarea value={coachNotes} onChange={(event) => setCoachNotes(event.target.value)} placeholder="Kỹ thuật, cảm nhận, điều chỉnh buổi sau…" /></label><label className={sets.some((set) => set.painLevel >= 4) ? 'has-alert' : ''}>Đau / hạn chế vận động<textarea value={painNotes} onChange={(event) => setPainNotes(event.target.value)} placeholder="Chỉ ghi khi cần lưu ý an toàn" /></label></div>
                <footer><button onClick={() => void saveLog('draft')} disabled={saving}><Save />Lưu nháp</button><button className="is-primary" onClick={() => void saveLog('completed')} disabled={saving}><Check />Hoàn thành buổi</button></footer>
              </>}
        </div>
      </section>}

      {tab === 'program' && <section className="pt-workout-workspace__program">
        {!selectedStudentId ? <div className="pt-workout-workspace__empty"><Users /><strong>Chọn học viên</strong><span>Giáo án luôn thuộc một hồ sơ học viên cụ thể.</span></div> : <>
          <div className="pt-workout-workspace__program-editor">
            <header><div><span>GIÁO ÁN ĐANG ÁP DỤNG</span><h2>{studentMap.get(selectedStudentId)?.name}</h2></div><em>Revision {programDraft.revision}</em></header>
            <div className="pt-workout-workspace__program-fields"><label>Tên giáo án<input value={programDraft.title} onChange={(event) => setProgramDraft((current) => ({ ...current, title: event.target.value }))} /></label><label>Mục tiêu<input value={programDraft.goal} onChange={(event) => setProgramDraft((current) => ({ ...current, goal: event.target.value }))} placeholder="Tăng cơ mông, cải thiện sức mạnh…" /></label></div>
            <div className="pt-workout-workspace__day-tabs">{programDraft.trainingDays.map((day) => <button key={day.id} className={day.id === selectedDay?.id ? 'is-active' : ''} onClick={() => setSelectedDayId(day.id)}>{day.title}</button>)}<button onClick={() => { const id = crypto.randomUUID(); setProgramDraft((current) => ({ ...current, trainingDays: [...current.trainingDays, { id, title: `Buổi ${current.trainingDays.length + 1}`, focusMuscles: [], notes: '', order: current.trainingDays.length, exercises: [] }] })); setSelectedDayId(id) }}><Plus />Buổi</button></div>
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
            <div className="pt-workout-workspace__muscles">{muscleLabels.map((muscle) => <button className={muscle === muscleFilter ? 'is-active' : ''} onClick={() => setMuscleFilter(muscle)} key={muscle}>{muscle}</button>)}</div>
            <div className="pt-workout-workspace__catalog-list">{filteredCatalog.map((item) => <button key={item.id} onClick={() => addExercise(item)} disabled={selectedDay?.exercises.some((exercise) => exercise.catalogExerciseId === item.id)}>{item.media.posterUrl || item.media.startImageUrl ? <img src={item.media.posterUrl || item.media.startImageUrl} alt="" /> : <Dumbbell />}<span><b>{item.nameVi}</b><small>{item.targetMuscles.join(' · ') || item.bodyParts.join(' · ')}</small></span><Plus /></button>)}</div>
          </aside>
        </>}
      </section>}

      {tab === 'history' && <section className="pt-workout-workspace__history">
        {!selectedStudentId ? <div className="pt-workout-workspace__empty"><Users /><strong>Chọn học viên</strong></div> : !history ? <div className="pt-workout-workspace__empty"><RefreshCw /><strong>Đang tải tiến bộ</strong></div> : <>
          <div className="pt-workout-workspace__history-metrics"><article><Dumbbell /><span><small>Buổi đã ghi</small><strong>{history.analytics.completedWorkouts}</strong></span></article><article><Weight /><span><small>Tổng volume</small><strong>{history.analytics.totalVolumeKg.toLocaleString('vi-VN')} kg</strong></span></article><article className={history.analytics.painAlerts ? 'has-alert' : ''}><AlertTriangle /><span><small>Cảnh báo đau</small><strong>{history.analytics.painAlerts}</strong></span></article></div>
          <div className="pt-workout-workspace__history-grid"><div><div className="pt-workout-workspace__section-title"><div><span>LỊCH SỬ</span><h2>Các buổi đã ghi</h2></div><History /></div>{history.logs.map((log) => <article className="pt-workout-workspace__history-log" key={log.id}><time>{log.date} · {String(log.hour).padStart(2, '0')}:00</time><div><b>{log.trainingDayTitle}</b><span>{log.metrics.completedSets} hiệp · {log.metrics.totalVolumeKg.toLocaleString('vi-VN')} kg</span></div><em className={log.status === 'completed' ? 'is-done' : ''}>{log.status === 'completed' ? 'Hoàn thành' : 'Nháp'}</em></article>)}{!history.logs.length && <div className="pt-workout-workspace__empty is-compact"><BarChart3 /><strong>Chưa có nhật ký</strong><span>Tiến bộ sẽ xuất hiện sau buổi tập đầu tiên.</span></div>}</div><aside><div className="pt-workout-workspace__section-title"><div><span>KỶ LỤC</span><h2>Mức tạ tốt nhất</h2></div><Sparkles /></div>{history.analytics.personalRecords.map((record) => <article key={record.catalogExerciseId}><span><b>{record.exerciseName}</b><small>Volume hiệp tốt nhất {record.maximumSetVolumeKg.toLocaleString('vi-VN')} kg</small></span><strong>{record.maximumWeightKg} kg</strong></article>)}</aside></div>
        </>}
      </section>}
    </main>
  )
}
