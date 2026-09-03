import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  FileText,
  List,
  ListChecks,
  LockKeyhole,
  Play,
  Search,
} from 'lucide-react'
import AcademyFullChapterReader from '../../components/academy/AcademyFullChapterReader'
import { CoursePrimaryContent, CourseQuizRunner, CourseResourceItem } from '../../components/CourseLessonRuntime'
import { ProgressBar } from '../../components/ui'
import type { Course, CourseLessonDraft, CourseProgress } from '../../types'
import { flattenCourseLessons, getCourseModules, getInitialDemoCompletedLessonIds } from '../../utils/courseContent'
import '../../styles-academy.css'

type ReaderView = 'content' | 'resources'

interface CourseDetailPageProps {
  course?: Course
  progress?: CourseProgress
  activeLessonId?: string | null
  enrolled: boolean
  enrolledAt?: unknown
  noteOwnerId: string
  onNoteDirtyChange?: (dirty: boolean) => void
  accessLocked?: boolean
  learningWarning?: string | null
  loading?: boolean
  allowDemoContent?: boolean
  previewMode?: boolean
  onBack: () => void
  onSelectLesson: (lessonId: string) => void
  onEnroll: () => Promise<void>
  onComplete: (courseId: string, lessonId: string) => Promise<void>
  onUpgrade: () => void
}

type RuntimeCompletionPolicy = {
  mode: 'manual' | 'media-progress' | 'quiz-pass'
  thresholdPercent?: number
}

function lessonCompletionPolicy(lesson: CourseLessonDraft | undefined): RuntimeCompletionPolicy {
  const explicit = lesson?.completionPolicy
  if (explicit?.mode === 'workout-complete') return { mode: 'manual' }
  if (explicit && ['manual', 'media-progress', 'quiz-pass'].includes(explicit.mode)) {
    return {
      mode: explicit.mode,
      thresholdPercent: typeof explicit.thresholdPercent === 'number' && Number.isFinite(explicit.thresholdPercent)
        ? explicit.thresholdPercent
        : undefined,
    }
  }
  return lesson?.type === 'Quiz' ? { mode: 'quiz-pass' } : { mode: 'manual' }
}

function timestampToMillis(value: unknown) {
  if (value instanceof Date) return value.getTime()
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') return value.toMillis()
  const parsed = typeof value === 'string' || typeof value === 'number' ? new Date(value).getTime() : Number.NaN
  return Number.isNaN(parsed) ? null : parsed
}

function moduleDisplayTitle(title: string) {
  return title.replace(/^Chương\s+\d+\s*[·:.-]?\s*/i, '').trim() || title
}

function normalizeOutlineSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export default function CourseDetailPage({
  course,
  progress,
  activeLessonId,
  enrolled,
  enrolledAt,
  noteOwnerId,
  accessLocked = false,
  learningWarning,
  loading = false,
  allowDemoContent = false,
  previewMode = false,
  onBack,
  onSelectLesson,
  onEnroll,
  onComplete,
  onUpgrade,
}: CourseDetailPageProps) {
  const [readerView, setReaderView] = useState<ReaderView>('content')
  const [completeState, setCompleteState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [enrollState, setEnrollState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [actionError, setActionError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [mediaProgress, setMediaProgress] = useState(0)
  const [mobileLessonsOpen, setMobileLessonsOpen] = useState(false)
  const [outlineQuery, setOutlineQuery] = useState('')

  const modules = useMemo(() => course ? getCourseModules(course, allowDemoContent) : [], [allowDemoContent, course])
  const lessons = useMemo(() => course ? flattenCourseLessons(course, allowDemoContent) : [], [allowDemoContent, course])
  const fallbackCompletedIds = useMemo(
    () => course && allowDemoContent ? getInitialDemoCompletedLessonIds(course) : [],
    [allowDemoContent, course],
  )
  const completedLessonIds = progress?.completedLessonIds.length ? progress.completedLessonIds : fallbackCompletedIds
  const selectedLesson = lessons.find((lesson) => lesson.id === activeLessonId)
    ?? lessons.find((lesson) => lesson.id === progress?.lastLessonId)
    ?? lessons[0]
  const selectedModuleIndex = selectedLesson
    ? modules.findIndex((module) => module.lessons.some((lesson) => lesson.id === selectedLesson.id))
    : -1
  const selectedModule = selectedModuleIndex >= 0 ? modules[selectedModuleIndex] : undefined
  const selectedLessonIndex = selectedLesson ? lessons.findIndex((lesson) => lesson.id === selectedLesson.id) : -1
  const previousLesson = selectedLessonIndex > 0 ? lessons[selectedLessonIndex - 1] : undefined
  const nextLesson = selectedLessonIndex >= 0 && selectedLessonIndex < lessons.length - 1 ? lessons[selectedLessonIndex + 1] : undefined
  const dripEnabled = enrolled && !previewMode && !allowDemoContent && course?.settings?.dripSchedule === 'weekly'
  const enrolledAtMillis = timestampToMillis(enrolledAt)
  const getModuleUnlockAt = (moduleIndex: number) => {
    if (!dripEnabled || moduleIndex <= 0) return null
    if (enrolledAtMillis === null) return Number.POSITIVE_INFINITY
    return enrolledAtMillis + moduleIndex * 7 * 24 * 60 * 60 * 1000
  }
  const selectedUnlockAt = getModuleUnlockAt(selectedModuleIndex)
  const selectedLessonAvailable = selectedUnlockAt === null || selectedUnlockAt <= now
  const percent = Math.max(0, Math.min(100, progress?.percent ?? course?.progress ?? 0))
  const lessonCompleted = Boolean(selectedLesson && completedLessonIds.includes(selectedLesson.id))
  const completionPolicy = lessonCompletionPolicy(selectedLesson)
  const completionThreshold = Math.max(1, Math.min(100, completionPolicy.thresholdPercent ?? 80))
  const mediaThresholdReached = mediaProgress >= completionThreshold
  const isLegacyWorkoutLesson = selectedLesson?.type === 'Buổi tập'
    || selectedLesson?.completionPolicy?.mode === 'workout-complete'
    || selectedLesson?.primaryContent?.kind === 'workout'
  const isAuraNutritionCurriculum = modules.length === 20
    && modules.every((module) => module.id.startsWith('nutrition-chapter-'))
  const taggedChapterNumber = Number(selectedLesson?.tags?.find((tag) => /^Chương\s+\d+$/i.test(tag))?.match(/\d+/)?.[0])
  const fullChapterNumber = Number.isInteger(taggedChapterNumber) && taggedChapterNumber >= 1 && taggedChapterNumber <= 20
    ? taggedChapterNumber
    : selectedModuleIndex + 1
  const canShowFullReader = isAuraNutritionCurriculum
    && selectedLesson?.id.endsWith('-core') === true
    && fullChapterNumber >= 1
    && fullChapterNumber <= 20
  const openToAllMembers = course?.settings?.accessTier === 'free' && course.settings.visibility === 'members'
  const canStudy = (enrolled || previewMode) && !accessLocked && selectedLessonAvailable
  const canViewContent = canStudy || Boolean(selectedLesson?.preview)
  const normalizedOutlineQuery = normalizeOutlineSearch(outlineQuery)
  const visibleModules = useMemo(() => {
    if (!normalizedOutlineQuery) return modules
    return modules.flatMap((module) => {
      const moduleMatches = normalizeOutlineSearch(module.title).includes(normalizedOutlineQuery)
      const matchingLessons = moduleMatches
        ? module.lessons
        : module.lessons.filter((lesson) => normalizeOutlineSearch([
            lesson.title,
            lesson.summary,
            ...(lesson.tags ?? []),
          ].filter(Boolean).join(' ')).includes(normalizedOutlineQuery))
      return matchingLessons.length ? [{ ...module, lessons: matchingLessons }] : []
    })
  }, [modules, normalizedOutlineQuery])

  useEffect(() => {
    setCompleteState(lessonCompleted ? 'saved' : 'idle')
    setReaderView('content')
    setMediaProgress(0)
    setActionError(null)
  }, [lessonCompleted, selectedLesson?.id])

  useEffect(() => {
    if (!mobileLessonsOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileLessonsOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [mobileLessonsOpen])

  useEffect(() => {
    if (!dripEnabled || enrolledAtMillis === null) return
    const nearestUnlock = modules
      .map((_, moduleIndex) => enrolledAtMillis + moduleIndex * 7 * 24 * 60 * 60 * 1000)
      .filter((unlockAt) => unlockAt > now)
      .sort((left, right) => left - right)[0]
    if (!nearestUnlock) return
    const timeout = window.setTimeout(() => setNow(Date.now()), Math.min(2_147_000_000, Math.max(50, nearestUnlock - now + 50)))
    return () => window.clearTimeout(timeout)
  }, [dripEnabled, enrolledAtMillis, modules, now])

  if (loading) {
    return <div className="course-detail-state"><BookOpen size={34} /><h1>Đang tải khóa học</h1><p>Aura đang đồng bộ nội dung và tiến độ của bạn.</p></div>
  }
  if (!course) {
    return <div className="course-detail-state"><BookOpen size={34} /><h1>Không tìm thấy khóa học</h1><p>Khóa học có thể đã bị ẩn hoặc đường dẫn không đúng.</p><button className="primary-button" onClick={onBack}>Về thư viện</button></div>
  }

  const completeLesson = async () => {
    if (!selectedLesson || !canStudy) return
    setCompleteState('saving')
    setActionError(null)
    try {
      await onComplete(String(course.id), selectedLesson.id)
      setCompleteState('saved')
    } catch (error) {
      setCompleteState('error')
      setActionError(error instanceof Error ? error.message : 'Không thể lưu tiến độ. Vui lòng thử lại.')
    }
  }

  const enroll = async () => {
    setEnrollState('saving')
    setActionError(null)
    try {
      await onEnroll()
      setEnrollState('idle')
    } catch (error) {
      setEnrollState('error')
      setActionError(error instanceof Error ? error.message : 'Không thể ghi danh. Vui lòng thử lại.')
    }
  }

  const selectLesson = (lessonId: string) => onSelectLesson(lessonId)
  const selectMobileLesson = (lessonId: string) => {
    selectLesson(lessonId)
    setMobileLessonsOpen(false)
  }
  const unlockLabel = (unlockAt: number | null) => {
    if (unlockAt === Number.POSITIVE_INFINITY) return 'Đang chờ ngày ghi danh'
    if (unlockAt === null || unlockAt <= now) return null
    return `Mở ${new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short' }).format(new Date(unlockAt))}`
  }

  const renderCompletionAction = () => {
    if (previewMode) return <span className="course-reader-preview">Xem trước</span>
    if (accessLocked) return <button className="primary-button" onClick={onUpgrade}><LockKeyhole size={16} /> Nâng cấp Pro</button>
    if (!enrolled) {
      return <button className="primary-button" onClick={enroll} disabled={enrollState === 'saving' || lessons.length === 0}><Play size={16} fill="currentColor" /> {enrollState === 'saving' ? 'Đang mở…' : enrollState === 'error' ? 'Thử lại' : openToAllMembers ? 'Bắt đầu miễn phí' : 'Bắt đầu học'}</button>
    }
    if (!selectedLessonAvailable) return <button className="primary-button" disabled><LockKeyhole size={16} /> {unlockLabel(selectedUnlockAt) ?? 'Chưa mở'}</button>
    if (isLegacyWorkoutLesson) return <button className="primary-button" disabled><BookOpen size={16} /> Đang chuyển đổi</button>
    if (completionPolicy.mode === 'quiz-pass') return <button className="primary-button" disabled><ListChecks size={16} /> {lessonCompleted ? 'Đã hoàn thành' : 'Hoàn thành quiz'}</button>
    const disabled = !selectedLesson || completeState === 'saving' || completeState === 'saved'
      || (completionPolicy.mode === 'media-progress' && !mediaThresholdReached)
    const label = completeState === 'saving'
      ? 'Đang lưu…'
      : completeState === 'saved'
        ? 'Đã hoàn thành'
        : completionPolicy.mode === 'media-progress' && !mediaThresholdReached
          ? `${mediaProgress}% / ${completionThreshold}%`
          : completeState === 'error' ? 'Thử lại' : 'Hoàn thành'
    return <button className="primary-button" onClick={completeLesson} disabled={disabled}><Check size={16} /> {label}</button>
  }

  const renderReaderContent = () => {
    if (readerView === 'resources') {
      if (!selectedLesson?.resources?.length) {
        return <div className="lesson-empty-state"><FileText size={28} /><h2>Chưa có tài liệu PDF</h2><p>Chương này chưa có tệp đính kèm.</p></div>
      }
      return (
        <article className="course-reader-resources">
          <header><div><small>TÀI LIỆU CHƯƠNG {Math.max(1, selectedModuleIndex + 1)}</small><h2>PDF và tài liệu tải về</h2></div><strong>{selectedLesson.resources.length}</strong></header>
          <div className="lesson-resource-list">
            {selectedLesson.resources.map((resource) => <CourseResourceItem key={resource.id} courseId={String(course.id)} lessonId={selectedLesson.id} resource={resource} canAccess={canViewContent} />)}
          </div>
        </article>
      )
    }
    if (canShowFullReader) {
      if (!canViewContent) {
        return <div className="lesson-empty-state"><LockKeyhole size={28} /><h2>Bài đọc đang được khóa</h2><p>{openToAllMembers ? 'Bấm “Bắt đầu miễn phí” để đọc toàn bộ chương.' : 'Ghi danh khóa học để đọc toàn bộ chương.'}</p></div>
      }
      return <AcademyFullChapterReader chapter={fullChapterNumber} ownerId={noteOwnerId} onOpenPdf={() => setReaderView('resources')} />
    }
    if (!selectedLesson) return <div className="lesson-empty-state"><BookOpen size={28} /><h2>Chưa có nội dung</h2></div>
    if (selectedLesson.type === 'Quiz') {
      return <CourseQuizRunner courseId={String(course.id)} lesson={selectedLesson} canSubmit={canStudy && !previewMode} demoMode={allowDemoContent} completed={lessonCompleted} onPassed={completeLesson} />
    }
    return <CoursePrimaryContent courseId={String(course.id)} lesson={selectedLesson} canView={canViewContent} lockedMessage={accessLocked ? 'Nâng cấp Aura Pro để mở nội dung này.' : openToAllMembers ? 'Bấm Bắt đầu miễn phí để mở toàn bộ bài học.' : selectedLessonAvailable ? 'Ghi danh để mở khóa bài học' : unlockLabel(selectedUnlockAt) ?? 'Bài học chưa mở'} onMediaProgress={setMediaProgress} onOpenResources={() => setReaderView('resources')} />
  }

  const renderOutline = (mobile = false): ReactNode => {
    if (!visibleModules.length) return <p className="course-reader-outline__empty">Không tìm thấy chương hoặc bài phù hợp.</p>
    return visibleModules.map((module) => {
      const moduleIndex = modules.findIndex((item) => item.id === module.id)
      return (
        <section className="course-reader-outline__module" key={module.id}>
          <header><span>CHƯƠNG {moduleIndex + 1}</span><strong>{moduleDisplayTitle(module.title)}</strong></header>
          <div>
            {module.lessons.map((lesson) => {
              const completed = completedLessonIds.includes(lesson.id)
              const active = selectedLesson?.id === lesson.id
              const lessonNumber = lessons.findIndex((item) => item.id === lesson.id) + 1
              const unlockAt = getModuleUnlockAt(moduleIndex)
              const locked = unlockAt !== null && unlockAt > now
              return (
                <button key={lesson.id} className={`${active ? 'is-active' : ''} ${completed ? 'is-complete' : ''}`} disabled={locked && !lesson.preview} onClick={() => mobile ? selectMobileLesson(lesson.id) : selectLesson(lesson.id)} aria-current={active ? 'page' : undefined}>
                  <span>{completed ? <CheckCircle2 size={16} /> : locked ? <LockKeyhole size={15} /> : <Circle size={15} />}</span>
                  <strong>{lesson.title}</strong>
                  <i>{String(lessonNumber).padStart(2, '0')}</i>
                </button>
              )
            })}
          </div>
        </section>
      )
    })
  }

  return (
    <div className="course-reader-page">
      <header className="course-reader-header">
        <button type="button" className="course-reader-back" onClick={onBack} aria-label="Quay lại thư viện"><ArrowLeft size={18} /></button>
        <div className="course-reader-header__title">
          <small>{course.title}</small>
          <strong>{selectedModule ? `Chương ${selectedModuleIndex + 1} · ${moduleDisplayTitle(selectedModule.title)}` : 'Nội dung khóa học'}</strong>
        </div>
        <div className="course-reader-header__progress" aria-label={`${percent}% hoàn thành`}><span>{selectedLessonIndex + 1}/{lessons.length}</span><ProgressBar value={percent} /></div>
        <div className="course-reader-header__action">{renderCompletionAction()}</div>
      </header>

      {(actionError || learningWarning) ? <div className="course-reader-alert" role="alert">{actionError ?? `Tiến độ tạm thời chưa lưu: ${learningWarning}`}</div> : null}

      <div className="course-reader-layout">
        <aside className="course-reader-outline" aria-label="Mục lục khóa học">
          <header><div><small>MỤC LỤC</small><strong>{modules.length} chương · {lessons.length} bài</strong></div></header>
          <label className="course-reader-search"><Search size={15} /><input value={outlineQuery} onChange={(event) => setOutlineQuery(event.target.value)} placeholder="Tìm chương, bài học…" aria-label="Tìm trong mục lục" />{outlineQuery ? <button type="button" onClick={() => setOutlineQuery('')} aria-label="Xóa tìm kiếm">×</button> : null}</label>
          <div className="course-reader-outline__scroll">{renderOutline()}</div>
        </aside>

        <main className="course-reader-main">
          <section className="course-reader-title">
            <div><small>{selectedModule ? `CHƯƠNG ${selectedModuleIndex + 1}` : 'BÀI HỌC'}</small><h1>{selectedLesson?.title ?? course.title}</h1></div>
            <button type="button" className="course-reader-outline-button" aria-controls="course-outline-sheet" aria-expanded={mobileLessonsOpen} onClick={() => setMobileLessonsOpen(true)}><List size={17} /> Mục lục</button>
          </section>

          <nav className="course-reader-toolbar" aria-label="Công cụ đọc">
            <div role="tablist" aria-label="Loại nội dung">
              <button type="button" role="tab" aria-selected={readerView === 'content'} className={readerView === 'content' ? 'is-active' : ''} onClick={() => setReaderView('content')}><BookOpen size={15} /> Nội dung</button>
              <button type="button" role="tab" aria-selected={readerView === 'resources'} className={readerView === 'resources' ? 'is-active' : ''} onClick={() => setReaderView('resources')}><FileText size={15} /> Tài liệu PDF {selectedLesson?.resources?.length ? <span>{selectedLesson.resources.length}</span> : null}</button>
            </div>
            <div className="course-reader-lesson-pager">
              <button type="button" disabled={!previousLesson} onClick={() => previousLesson && selectLesson(previousLesson.id)} aria-label="Bài trước"><ChevronLeft size={17} /></button>
              <span>{selectedLessonIndex >= 0 ? `${selectedLessonIndex + 1} / ${lessons.length}` : `0 / ${lessons.length}`}</span>
              <button type="button" disabled={!nextLesson} onClick={() => nextLesson && selectLesson(nextLesson.id)} aria-label="Bài tiếp theo"><ChevronRight size={17} /></button>
            </div>
          </nav>

          <div className="course-reader-content" role="tabpanel">{renderReaderContent()}</div>

          <nav className="course-reader-bottom-pager" aria-label="Chuyển bài học">
            <button type="button" disabled={!previousLesson} onClick={() => previousLesson && selectLesson(previousLesson.id)}><ChevronLeft size={17} /><span><small>BÀI TRƯỚC</small><strong>{previousLesson?.title ?? 'Đầu khóa học'}</strong></span></button>
            <button type="button" disabled={!nextLesson} onClick={() => nextLesson && selectLesson(nextLesson.id)}><span><small>BÀI TIẾP THEO</small><strong>{nextLesson?.title ?? 'Cuối khóa học'}</strong></span><ChevronRight size={17} /></button>
          </nav>
        </main>
      </div>

      {mobileLessonsOpen ? (
        <div className="mobile-lesson-sheet-backdrop" role="presentation" onClick={() => setMobileLessonsOpen(false)}>
          <section id="course-outline-sheet" className="mobile-lesson-sheet course-reader-sheet" role="dialog" aria-modal="true" aria-label="Mục lục khóa học" onClick={(event) => event.stopPropagation()}>
            <header><div><span className="eyebrow">MỤC LỤC KHÓA HỌC</span><h2>{course.title}</h2></div><button type="button" aria-label="Đóng mục lục" onClick={() => setMobileLessonsOpen(false)}>×</button></header>
            <label className="course-reader-search"><Search size={15} /><input value={outlineQuery} onChange={(event) => setOutlineQuery(event.target.value)} placeholder="Tìm chương, bài học…" aria-label="Tìm trong mục lục" />{outlineQuery ? <button type="button" onClick={() => setOutlineQuery('')} aria-label="Xóa tìm kiếm">×</button> : null}</label>
            <div className="mobile-lesson-sheet__body course-reader-sheet__body">{renderOutline(true)}</div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
