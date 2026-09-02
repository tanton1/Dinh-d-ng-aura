import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Bookmark,
  BookmarkCheck,
  Check,
  Dumbbell,
  History,
  Images,
  Info,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Target,
  Weight,
} from 'lucide-react'
import { getPtStudentTrainingPlan, listPtWorkoutHistory, type PtTrainingProgram, type PtWorkoutHistory } from '../../services/ptWorkoutTrackingService'
import { listExerciseCatalog } from '../../services/exerciseCatalogService'
import type { ExerciseCatalogItem, ExerciseCatalogMediaImage } from '../../types'
import { exerciseMatchesMuscleGroup, exerciseMuscleGroupOptions, type ExerciseMuscleGroupId } from '../../utils/exerciseMuscleGroups'
import ExerciseMediaPlayer from '../../components/exercise-catalog/ExerciseMediaPlayer'
import '../operations/PtWorkoutWorkspacePage.css'
import './StudentPtWorkoutPage.css'

type StudentWorkoutTab = 'plan' | 'history' | 'library'
type LibraryFilter = 'all' | 'beginner' | 'intermediate' | 'advanced' | 'home'

const libraryFilterLabels: Record<LibraryFilter, string> = {
  all: 'Tất cả', beginner: 'Cơ bản', intermediate: 'Trung bình', advanced: 'Nâng cao', home: 'Tại nhà',
}

function demoCatalog(): ExerciseCatalogItem[] {
  const create = (input: Pick<ExerciseCatalogItem, 'id' | 'nameVi' | 'nameEn' | 'targetMuscles' | 'bodyParts' | 'equipment' | 'difficulty' | 'environment' | 'goals' | 'instructionsVi' | 'cuesVi' | 'commonMistakesVi'>): ExerciseCatalogItem => ({
    ...input, schemaVersion: 1, revision: 1, status: 'published', aliasesVi: [], secondaryMuscles: [],
    breathingVi: 'Thở ra khi dùng lực, hít vào khi trở về vị trí ban đầu.', media: { images: [] },
    defaultPrescription: { sets: 3, reps: '10–12', restSeconds: 60, rpe: 7 },
    source: { provider: 'aura', sourceExerciseId: input.id, sourceVersion: 'demo', license: 'Aura-owned' }, sourceAttribution: 'Aura Fitness',
  })
  return [
    create({ id: 'demo-hip-thrust', nameVi: 'Đẩy hông với tạ đòn', nameEn: 'Barbell Hip Thrust', targetMuscles: ['Mông'], bodyParts: ['Thân dưới'], equipment: ['Tạ đòn', 'Ghế'], difficulty: 'intermediate', environment: ['gym'], goals: ['Tăng cơ'], instructionsVi: ['Tựa lưng trên vào ghế và đặt thanh tạ ngang hông.', 'Đẩy gót chân xuống sàn, nâng hông đến khi thân người tạo đường thẳng.', 'Giữ một nhịp ở đỉnh rồi hạ xuống có kiểm soát.'], cuesVi: ['Siết bụng và không ưỡn lưng ở điểm cao nhất.'], commonMistakesVi: ['Dùng lưng dưới thay vì siết mông.', 'Đặt chân quá xa làm mất lực đẩy.'] }),
    create({ id: 'demo-goblet-squat', nameVi: 'Goblet Squat', nameEn: 'Goblet Squat', targetMuscles: ['Đùi trước', 'Mông'], bodyParts: ['Thân dưới'], equipment: ['Tạ đơn'], difficulty: 'beginner', environment: ['gym', 'home'], goals: ['Sức mạnh'], instructionsVi: ['Giữ tạ trước ngực, mở chân rộng bằng vai.', 'Hạ hông xuống và giữ đầu gối cùng hướng mũi chân.', 'Đạp sàn đứng lên, giữ thân người ổn định.'], cuesVi: ['Giữ ngực mở và trọng tâm ở giữa bàn chân.'], commonMistakesVi: ['Đổ gối vào trong.', 'Nhấc gót chân khỏi sàn.'] }),
    create({ id: 'demo-rdl', nameVi: 'Romanian Deadlift', nameEn: 'Romanian Deadlift', targetMuscles: ['Đùi sau', 'Lưng'], bodyParts: ['Thân dưới'], equipment: ['Tạ đơn'], difficulty: 'intermediate', environment: ['gym', 'home'], goals: ['Tăng cơ'], instructionsVi: ['Đứng thẳng, giữ tạ sát hai bên đùi.', 'Đẩy hông ra sau và hạ tạ dọc theo chân.', 'Siết mông đưa hông về trước để trở lại tư thế đứng.'], cuesVi: ['Giữ cột sống trung lập trong toàn bộ biên độ.'], commonMistakesVi: ['Cuộn lưng khi hạ tạ.', 'Hạ tạ quá sâu làm mất kiểm soát.'] }),
  ]
}

function mediaImages(item: ExerciseCatalogItem): ExerciseCatalogMediaImage[] {
  const images = item.media.images?.filter((image) => image.url) ?? []
  const stills = images.filter((image) => image.mimeType !== 'image/gif' && !/\.gif(?:$|[?#])/i.test(image.url))
  if (stills.length) return stills
  if (images.length) return images
  return [
    item.media.posterUrl ? { id: `${item.id}-poster`, url: item.media.posterUrl, role: 'start', order: 0 } : null,
    item.media.startImageUrl && item.media.startImageUrl !== item.media.posterUrl ? { id: `${item.id}-start`, url: item.media.startImageUrl, role: 'start', order: 0 } : null,
    item.media.endImageUrl ? { id: `${item.id}-end`, url: item.media.endImageUrl, role: 'end', order: 1 } : null,
  ].filter((image): image is ExerciseCatalogMediaImage => Boolean(image))
}

function difficultyLabel(value: ExerciseCatalogItem['difficulty']) { return libraryFilterLabels[value] }

function compactDate(value: string) {
  const [, month, day] = value.split('-')
  return month && day ? `${day}/${month}` : value
}

function VolumeTrend({ history }: { history: PtWorkoutHistory }) {
  const points = history.logs
    .filter((log) => log.status === 'completed')
    .slice(0, 12)
    .reverse()
    .map((log) => ({ label: compactDate(log.date), value: Number(log.metrics?.totalVolumeKg || 0) }))
  const maximum = Math.max(1, ...points.map((point) => point.value))
  const coordinates = points.map((point, index) => ({
    ...point,
    x: points.length === 1 ? 50 : 6 + (index / (points.length - 1)) * 88,
    y: 86 - (point.value / maximum) * 68,
  }))
  return <div className="pt-workout-learner__trend">
    <header><div><span>XU HƯỚNG</span><h3>Volume theo buổi</h3></div><small>{points.length} buổi gần nhất</small></header>
    {!coordinates.length ? <div className="pt-workout-learner__trend-empty"><BarChart3 />Chưa đủ dữ liệu để vẽ xu hướng.</div> : <>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Biểu đồ volume tập luyện theo buổi">
        <defs><linearGradient id="student-volume-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#f52f7b" stopOpacity=".28"/><stop offset="1" stopColor="#f52f7b" stopOpacity="0"/></linearGradient></defs>
        <path d={`M ${coordinates[0].x} 90 L ${coordinates.map((point) => `${point.x} ${point.y}`).join(' L ')} L ${coordinates.at(-1)?.x} 90 Z`} fill="url(#student-volume-fill)" />
        <polyline points={coordinates.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#f52f7b" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
        {coordinates.map((point) => <circle key={`${point.label}-${point.x}`} cx={point.x} cy={point.y} r="2.4" fill="#fff" stroke="#f52f7b" strokeWidth="1.4" vectorEffect="non-scaling-stroke"><title>{point.label}: {point.value.toLocaleString('vi-VN')} kg</title></circle>)}
      </svg>
      <div className="pt-workout-learner__trend-labels"><span>{coordinates[0]?.label}</span><strong>Cao nhất {Math.round(maximum).toLocaleString('vi-VN')} kg</strong><span>{coordinates.at(-1)?.label}</span></div>
    </>}
  </div>
}

function ExerciseVisual({ item, className = '' }: { item: ExerciseCatalogItem; className?: string }) {
  const image = mediaImages(item)[0]
  return <div className={`student-library__visual ${className}`}>
    {image ? <img src={image.url} alt={image.alt || item.nameVi} loading="lazy" /> : <Dumbbell aria-hidden="true" />}
    <span className="student-library__visual-glow" aria-hidden="true" />
  </div>
}

function ExerciseDetail({ item, isInCurrentPlan, onBack, onOpenPlan, saved, onToggleSaved }: {
  item: ExerciseCatalogItem; isInCurrentPlan: boolean; onBack: () => void; onOpenPlan: () => void; saved: boolean; onToggleSaved: () => void
}) {
  const PosterIcon = saved ? BookmarkCheck : Bookmark
  return <article className="student-library__detail" aria-label={`Chi tiết ${item.nameVi}`}>
    <div className="student-library__detail-media">
      <button type="button" className="student-library__back" onClick={onBack}><ArrowLeft /><span>Thư viện</span></button>
      <button type="button" className="student-library__detail-save" onClick={onToggleSaved} aria-label={saved ? 'Bỏ lưu bài tập' : 'Lưu bài tập'}><PosterIcon /></button>
      <ExerciseMediaPlayer exerciseId={item.id} name={item.nameVi} media={item.media} externalMedia={item.externalMedia} />
      {item.sourceAttribution && item.sourceAttribution !== 'Aura Fitness' && <small className="student-library__media-credit">{item.sourceAttribution}</small>}
    </div>
    <div className="student-library__detail-body">
      <div className="student-library__detail-heading"><div><span>{item.nameEn || 'AURA EXERCISE'}</span><h2>{item.nameVi}</h2><p>{item.targetMuscles.join(' · ') || item.bodyParts.join(' · ') || 'Bài tập toàn thân'}</p></div><PosterIcon aria-hidden="true" /></div>
      <div className="student-library__chips"><span>{difficultyLabel(item.difficulty)}</span>{item.environment.map((value) => <span key={value}>{value === 'home' ? 'Tại nhà' : 'Phòng gym'}</span>)}{item.equipment.slice(0, 1).map((value) => <span key={value}>{value}</span>)}</div>
      <div className="student-library__prescription"><span><b>{item.defaultPrescription.sets}</b><small>hiệp</small></span><span><b>{item.defaultPrescription.reps}</b><small>reps</small></span><span><b>RPE {item.defaultPrescription.rpe}</b><small>mục tiêu</small></span><span><b>{item.defaultPrescription.restSeconds}s</b><small>nghỉ</small></span></div>
      {!!item.instructionsVi.length && <section className="student-library__technique"><h3>Kỹ thuật thực hiện</h3>{item.instructionsVi.map((instruction, index) => <div className="student-library__step" key={`${item.id}-instruction-${index}`}><b>{index + 1}</b><span>{instruction}</span></div>)}</section>}
      {!!item.cuesVi.length && <section className="student-library__technique student-library__technique--compact"><h3>Điểm cần nhớ</h3><ul className="student-library__bullet-list">{item.cuesVi.map((cue, index) => <li key={`${item.id}-cue-${index}`}>{cue}</li>)}</ul></section>}
      {item.breathingVi && <div className="student-library__info"><Info /><span><strong>Nhịp thở</strong>{item.breathingVi}</span></div>}
      {!!item.commonMistakesVi.length && <div className="student-library__warning"><AlertTriangle /><span><strong>Lưu ý an toàn</strong><ul className="student-library__bullet-list">{item.commonMistakesVi.map((mistake, index) => <li key={`${item.id}-mistake-${index}`}>{mistake}</li>)}</ul></span></div>}
      <button type="button" className="student-library__primary-action" onClick={isInCurrentPlan ? onOpenPlan : onToggleSaved}>{isInCurrentPlan ? <><Check />Mở trong giáo án của tôi</> : saved ? <><BookmarkCheck />Đã lưu để xem sau</> : <><Bookmark />Lưu vào bài tập yêu thích</>}</button>
    </div>
  </article>
}

export default function StudentPtWorkoutPage({ isDemo = false, ownerId = 'demo' }: { isDemo?: boolean; ownerId?: string }) {
  const favoritesStorageKey = `aura-student-exercise-favorites:${ownerId}`
  const [program, setProgram] = useState<PtTrainingProgram | null>(null)
  const [history, setHistory] = useState<PtWorkoutHistory | null>(null)
  const [dayIndex, setDayIndex] = useState(0)
  const [activeTab, setActiveTab] = useState<StudentWorkoutTab>('plan')
  const [catalog, setCatalog] = useState<ExerciseCatalogItem[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogRequested, setCatalogRequested] = useState(false)
  const [catalogError, setCatalogError] = useState('')
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalogFilter, setCatalogFilter] = useState<LibraryFilter>('all')
  const [muscleFilter, setMuscleFilter] = useState<ExerciseMuscleGroupId>('all')
  const [visibleCatalogCount, setVisibleCatalogCount] = useState(24)
  const [selectedExercise, setSelectedExercise] = useState<ExerciseCatalogItem | null>(null)
  const [savedIds, setSavedIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(window.localStorage.getItem(favoritesStorageKey) || '[]')) } catch { return new Set() }
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = async () => {
    setLoading(true); setError('')
    if (isDemo) {
      setProgram(null)
      setHistory({ studentId: 'student-demo', logs: [], analytics: { completedWorkouts: 0, totalVolumeKg: 0, painAlerts: 0, personalRecords: [] } })
      setDayIndex(0)
      setLoading(false)
      return
    }
    const results = await Promise.allSettled([getPtStudentTrainingPlan(), listPtWorkoutHistory()])
    const messages: string[] = []
    if (results[0].status === 'fulfilled') { setProgram(results[0].value); setDayIndex(0) }
    else {
      setProgram(null)
      messages.push(results[0].reason instanceof Error ? results[0].reason.message : 'Không thể tải giáo án.')
    }
    if (results[1].status === 'fulfilled') setHistory(results[1].value)
    else {
      setHistory(null)
      messages.push(results[1].reason instanceof Error ? results[1].reason.message : 'Không thể tải lịch sử tập luyện.')
    }
    setError(messages.join(' '))
    setLoading(false)
  }
  const loadCatalog = async () => {
    if (catalogLoading) return
    setCatalogRequested(true)
    setCatalogLoading(true); setCatalogError('')
    try { setCatalog(isDemo ? demoCatalog() : await listExerciseCatalog()) }
    catch (cause) { setCatalogError(cause instanceof Error ? cause.message : 'Không thể tải thư viện bài tập.') }
    finally { setCatalogLoading(false) }
  }
  useEffect(() => { void load() }, [isDemo])
  useEffect(() => {
    if (isDemo) return
    const refresh = () => { if (!document.hidden) void load() }
    const onVisibilityChange = () => { if (!document.hidden) refresh() }
    document.addEventListener('visibilitychange', onVisibilityChange)
    const timer = window.setInterval(refresh, 90_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.clearInterval(timer)
    }
  }, [isDemo])
  useEffect(() => { if (activeTab === 'library' && !catalogRequested) void loadCatalog() }, [activeTab, catalogRequested])
  useEffect(() => { try { window.localStorage.setItem(favoritesStorageKey, JSON.stringify([...savedIds])) } catch { /* unavailable in private mode */ } }, [favoritesStorageKey, savedIds])
  useEffect(() => {
    try { setSavedIds(new Set(JSON.parse(window.localStorage.getItem(favoritesStorageKey) || '[]'))) } catch { setSavedIds(new Set()) }
  }, [favoritesStorageKey])
  useEffect(() => { setVisibleCatalogCount(24) }, [catalogFilter, catalogQuery, muscleFilter])

  const day = program?.trainingDays[dayIndex]
  const planExerciseIds = useMemo(() => new Set((program?.trainingDays || []).flatMap((trainingDay) => trainingDay.exercises.map((exercise) => exercise.catalogExerciseId))), [program])
  const muscleGroups = useMemo(() => exerciseMuscleGroupOptions(catalog), [catalog])
  const filteredCatalog = useMemo(() => {
    const query = catalogQuery.trim().toLocaleLowerCase('vi')
    return catalog.filter((item) => {
      const searchable = [item.nameVi, item.nameEn, ...item.aliasesVi, ...item.targetMuscles, ...item.bodyParts, ...item.equipment].join(' ').toLocaleLowerCase('vi')
      const filterMatch = catalogFilter === 'all' || item.difficulty === catalogFilter || (catalogFilter === 'home' && item.environment.includes('home'))
      return filterMatch && exerciseMatchesMuscleGroup(item, muscleFilter) && (!query || searchable.includes(query))
    })
  }, [catalog, catalogFilter, catalogQuery, muscleFilter])
  const visibleCatalog = filteredCatalog.slice(0, visibleCatalogCount)
  const toggleSaved = (exerciseId: string) => setSavedIds((current) => { const next = new Set(current); if (next.has(exerciseId)) next.delete(exerciseId); else next.add(exerciseId); return next })
  const openPlan = () => { setActiveTab('plan'); setSelectedExercise(null); setNotice('Đã mở giáo án của bạn. Chọn đúng buổi để bắt đầu tập.'); window.setTimeout(() => setNotice(''), 3500) }

  return <main className="pt-workout-workspace pt-workout-learner">
    <section className="pt-workout-workspace__slides" aria-label="Tổng quan tập luyện">
      <article className="pt-workout-workspace__hero"><span>AURA PT · CỦA BẠN</span><h1>Tập luyện</h1><p>Giáo án, kỹ thuật và thư viện bài tập được thiết kế cho bạn.</p><Dumbbell /></article>
      <article className="pt-workout-workspace__metric"><small>Nhật ký mức tạ</small><strong>{history?.analytics.completedWorkouts || 0}</strong><span>Buổi đã hoàn thành ghi nhận bài tập</span><History /></article>
      <article className="pt-workout-workspace__metric"><small>Tổng volume</small><strong>{Math.round(history?.analytics.totalVolumeKg || 0).toLocaleString('vi-VN')}</strong><span>kg qua các buổi đã hoàn thành</span><Weight /></article>
    </section>
    {(error || notice) && <div className={`pt-workout-workspace__message ${error ? 'is-error' : 'is-success'}`} role={error ? 'alert' : 'status'}>{error || notice}</div>}
    {!selectedExercise && <nav className="student-library__tabs" aria-label="Khu vực tập luyện">
      <button type="button" className={activeTab === 'plan' ? 'is-active' : ''} onClick={() => { setActiveTab('plan'); setSelectedExercise(null) }}><Dumbbell />Giáo án của tôi</button>
      <button type="button" className={activeTab === 'history' ? 'is-active' : ''} onClick={() => { setActiveTab('history'); setSelectedExercise(null) }}><BarChart3 />Lịch sử & tiến bộ</button>
      <button type="button" className={activeTab === 'library' ? 'is-active' : ''} onClick={() => { setActiveTab('library'); setSelectedExercise(null) }}><Images />Khám phá bài tập<span>{catalog.length || '…'}</span></button>
    </nav>}
    {activeTab === 'plan' && <>
      <div className="pt-workout-workspace__toolbar"><div className="pt-workout-learner__title"><span>GIÁO ÁN HIỆN TẠI</span><strong>{program?.title || 'Chưa được phân giáo án'}</strong></div><button className="pt-workout-workspace__refresh" onClick={() => void load()} disabled={loading}><RefreshCw />Làm mới</button></div>
      {!loading && !program ? <section className="pt-workout-workspace__logger"><div className="pt-workout-workspace__empty"><Sparkles /><strong>PT đang chuẩn bị giáo án</strong><span>Khi giáo án được lưu, các buổi tập và mức tạ sẽ xuất hiện tại đây.</span></div></section> : program && <>
        <nav className="pt-workout-workspace__day-tabs pt-workout-learner__days">{program.trainingDays.map((item, index) => <button type="button" className={index === dayIndex ? 'is-active' : ''} onClick={() => setDayIndex(index)} key={item.id}>{item.title}</button>)}</nav>
        <section className="pt-workout-workspace__today pt-workout-learner__content">
          <div className="pt-workout-workspace__logger"><header><div><span>NHÓM CƠ</span><h2>{day?.title}</h2><p>{day?.focusMuscles.join(' · ') || program.goal}</p></div><Target /></header><div className="pt-workout-workspace__set-list">{day?.exercises.map((exercise) => <article className="pt-workout-workspace__log-exercise" key={exercise.id}><div className="pt-workout-workspace__exercise-heading"><div>{exercise.media.posterUrl ? <img src={exercise.media.posterUrl} alt="" /> : <Dumbbell />}</div><span><b>{exercise.nameVi}</b><small>{exercise.targetMuscles.join(' · ')}</small></span></div><div className="pt-workout-learner__prescription"><span><b>{exercise.sets}</b><small>hiệp</small></span><span><b>{exercise.repMinimum}–{exercise.repMaximum}</b><small>reps</small></span><span><b>RPE {exercise.targetRpe}</b><small>mục tiêu</small></span><span><b>{exercise.restSeconds}s</b><small>nghỉ</small></span></div>{exercise.cuesVi.length > 0 && <p>{exercise.cuesVi[0]}</p>}</article>)}</div></div>
          <aside className="pt-workout-workspace__session-rail"><div className="pt-workout-workspace__section-title"><div><span>TIẾN BỘ</span><h2>Kỷ lục mức tạ</h2></div><BarChart3 /></div>{history?.analytics.personalRecords.slice(0, 8).map((record) => <article className="pt-workout-learner__record" key={record.catalogExerciseId}><span><b>{record.exerciseName}</b><small>Hiệp tốt nhất {record.maximumSetVolumeKg.toLocaleString('vi-VN')} kg</small></span><strong>{record.maximumWeightKg} kg</strong></article>)}{history?.analytics.painAlerts ? <div className="pt-workout-learner__alert"><AlertTriangle />Có {history.analytics.painAlerts} buổi cần PT lưu ý đau/hạn chế vận động.</div> : null}</aside>
        </section>
      </>}
    </>}
    {activeTab === 'history' && <section className="pt-workout-learner__history" aria-label="Lịch sử và tiến bộ">
      <div className="pt-workout-learner__history-metrics">
        <article><History /><span><small>Nhật ký mức tạ</small><strong>{history?.analytics.completedWorkouts || 0}</strong></span></article>
        <article><Weight /><span><small>Tổng volume</small><strong>{Math.round(history?.analytics.totalVolumeKg || 0).toLocaleString('vi-VN')} kg</strong></span></article>
        <article className={history?.analytics.painAlerts ? 'has-alert' : ''}><AlertTriangle /><span><small>Lưu ý đau</small><strong>{history?.analytics.painAlerts || 0}</strong></span></article>
      </div>
      {history && <VolumeTrend history={history} />}
      <div className="pt-workout-learner__history-layout">
        <div className="pt-workout-learner__history-list">
          <header><div><span>NHẬT KÝ</span><h2>Các buổi gần nhất</h2></div><History /></header>
          {history?.logs.map((log) => <article key={log.id} className={log.status === 'completed' ? 'is-completed' : 'is-draft'}>
            <time>{compactDate(log.date)}<small>{String(log.hour).padStart(2, '0')}:00</small></time>
            <div><strong>{log.trainingDayTitle || 'Buổi tập Aura'}</strong><span>{log.metrics.completedSets} hiệp · {Math.round(log.metrics.totalVolumeKg).toLocaleString('vi-VN')} kg{log.coachNotes ? ` · ${log.coachNotes}` : ''}</span></div>
            <em>{log.status === 'completed' ? 'Hoàn thành' : 'Nháp'}</em>
          </article>)}
          {!loading && !history?.logs.length && <div className="pt-workout-workspace__empty is-compact"><Dumbbell /><strong>Chưa có nhật ký mức tạ</strong><span>Buổi tập sẽ xuất hiện khi PT bắt đầu ghi giáo án thực tế.</span></div>}
        </div>
        <aside className="pt-workout-learner__records"><header><div><span>KỶ LỤC</span><h2>Mức tạ tốt nhất</h2></div><Sparkles /></header>{history?.analytics.personalRecords.map((record) => <article key={record.catalogExerciseId}><span><strong>{record.exerciseName}</strong><small>Volume hiệp {record.maximumSetVolumeKg.toLocaleString('vi-VN')} kg</small></span><b>{record.maximumWeightKg} kg</b></article>)}{!history?.analytics.personalRecords.length && <p>Kỷ lục sẽ được tổng hợp từ các hiệp làm việc đã hoàn thành.</p>}</aside>
      </div>
    </section>}
    {activeTab === 'library' && <section className="student-library" aria-label="Thư viện bài tập">
      {selectedExercise ? <ExerciseDetail item={selectedExercise} isInCurrentPlan={planExerciseIds.has(selectedExercise.id)} onBack={() => setSelectedExercise(null)} onOpenPlan={openPlan} saved={savedIds.has(selectedExercise.id)} onToggleSaved={() => toggleSaved(selectedExercise.id)} /> : <>
        <div className="student-library__intro"><div><span>THƯ VIỆN AURA</span><h2>Khám phá bài tập</h2><p>Chọn bài phù hợp, xem kỹ thuật và lưu lại để tham khảo.</p></div><button type="button" className="student-library__refresh" onClick={() => void loadCatalog()} disabled={catalogLoading} aria-label="Tải lại thư viện"><RefreshCw /></button></div>
        <div className="student-library__search"><Search /><input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Tìm tên bài, nhóm cơ, dụng cụ…" aria-label="Tìm bài tập" /><SlidersHorizontal aria-hidden="true" /></div>
        <div className="student-library__filter-block"><strong>Nhóm cơ</strong><div className="student-library__filters" role="group" aria-label="Lọc theo nhóm cơ">{muscleGroups.map((group) => <button type="button" className={muscleFilter === group.id ? 'is-active' : ''} onClick={() => setMuscleFilter(group.id)} key={group.id}>{group.label}<small>{group.count}</small></button>)}</div></div>
        <div className="student-library__filter-block is-secondary"><strong>Mức độ</strong><div className="student-library__filters" role="group" aria-label="Lọc theo mức độ">{(Object.keys(libraryFilterLabels) as LibraryFilter[]).map((filter) => <button type="button" className={catalogFilter === filter ? 'is-active' : ''} onClick={() => setCatalogFilter(filter)} key={filter}>{libraryFilterLabels[filter]}</button>)}</div></div>
        {catalogError && <div className="student-library__inline-error" role="alert"><AlertTriangle />{catalogError}<button type="button" onClick={() => void loadCatalog()}>Thử lại</button></div>}
        {catalogLoading && <div className="student-library__loading" role="status" aria-live="polite"><RefreshCw />Đang tải thư viện bài tập…</div>}
        {!catalogLoading && !catalogError && <>
          <div className="student-library__section-heading"><div><h3>Gợi ý cho bạn</h3><p>{filteredCatalog.length} bài tập đã xuất bản</p></div><span>{savedIds.size} đã lưu</span></div>
          {visibleCatalog[0] && <button type="button" className="student-library__featured" onClick={() => setSelectedExercise(visibleCatalog[0])}><ExerciseVisual item={visibleCatalog[0]} /><span><small>{visibleCatalog[0].targetMuscles.join(' · ').toLocaleUpperCase('vi')}</small><strong>{visibleCatalog[0].nameVi}</strong><em>{difficultyLabel(visibleCatalog[0].difficulty)} · Xem kỹ thuật từng bước →</em></span></button>}
          <div className="student-library__grid">{visibleCatalog.slice(1).map((item) => <button type="button" className="student-library__card" onClick={() => setSelectedExercise(item)} key={item.id}><span className="student-library__card-media"><ExerciseVisual item={item} /><span className="student-library__difficulty">{difficultyLabel(item.difficulty)}</span><span className="student-library__save" aria-label={savedIds.has(item.id) ? 'Đã lưu' : 'Lưu bài tập'} onClick={(event) => { event.stopPropagation(); toggleSaved(item.id) }}>{savedIds.has(item.id) ? <BookmarkCheck /> : <Bookmark />}</span></span><span className="student-library__card-copy"><strong>{item.nameVi}</strong><small>{item.targetMuscles.join(' · ') || item.bodyParts.join(' · ')}</small></span></button>)}</div>
          {visibleCatalog.length < filteredCatalog.length && <button type="button" className="student-library__load-more" onClick={() => setVisibleCatalogCount((current) => current + 24)}>Xem thêm {Math.min(24, filteredCatalog.length - visibleCatalog.length)} bài tập</button>}
          {!filteredCatalog.length && <div className="student-library__empty"><Search /><strong>Không tìm thấy bài tập</strong><span>Thử từ khóa khác hoặc bỏ bớt bộ lọc.</span></div>}
        </>}
      </>}
    </section>}
  </main>
}
