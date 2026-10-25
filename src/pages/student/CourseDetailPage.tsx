import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
import { ProgressBar } from '../../components/ui'
import type { AcademyPracticeCompletionEvidence, Course, CourseLessonDraft, CourseProgress } from '../../types'
import { flattenCourseLessons, getCourseModules, getInitialDemoCompletedLessonIds } from '../../utils/courseContent'
import '../../styles-academy.css'
import AcademyLoadError from '../../components/academy/AcademyLoadError'
import { courseLoadErrorMessage } from '../../features/academy/courseLoadError'
import { useAcademyChapterDelivery } from '../../features/academy/useAcademyChapterDelivery'
import { academyQuizCompletionCurrent } from '../../features/academy/quizPolicy'
import '../../components/academy/academy-module-upgrades.css'

type ReaderView = 'content' | 'resources'

const CoursePdfReader = lazy(() => import('../../components/CourseLessonRuntime').then((module) => ({ default: module.CoursePdfReader })))
const CoursePrimaryContent = lazy(() => import('../../components/CourseLessonRuntime').then((module) => ({ default: module.CoursePrimaryContent })))
const CourseQuizRunner = lazy(() => import('../../components/CourseLessonRuntime').then((module) => ({ default: module.CourseQuizRunner })))
const CourseResourceItem = lazy(() => import('../../components/CourseLessonRuntime').then((module) => ({ default: module.CourseResourceItem })))
const AcademyChapterLearningStudio = lazy(() => import('../../components/academy/AcademyChapterLearningStudio'))

function CourseRuntimeFallback() {
  return <div className="lesson-empty-state" role="status"><BookOpen size={28} /><h2>Đang chuẩn bị bài học…</h2><p>Aura đang tải đúng định dạng nội dung cho chương này.</p></div>
}

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
  loadError?: string | null
  onRetry?: () => void
  allowDemoContent?: boolean
  previewMode?: boolean
  accessRevision?: string
  onBack: () => void
  onSelectLesson: (lessonId: string) => void
  onEnroll: () => Promise<void>
  onComplete: (courseId: string, lessonId: string, workoutLogId?: string, practiceEvidence?: AcademyPracticeCompletionEvidence, chapterVersion?: string) => Promise<void>
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

function isPdfResource(resource: NonNullable<CourseLessonDraft['resources']>[number]) {
  if (resource.assetRef?.contentType) return resource.assetRef.contentType === 'application/pdf'
  if (/\.pdf(?:$|\?)/i.test(resource.url)) return true
  // Some older Firebase references omit contentType and use a document kind.
  // Never treat an explicitly named Word/text file as an embeddable PDF.
  return resource.kind === 'document' && !/\.(docx?|txt)(?:$|\?)/i.test(resource.url)
}

function firstPdfResource(lesson: CourseLessonDraft | undefined) {
  return lesson?.resources?.find(isPdfResource)
}

export default function CourseDetailPage(props: CourseDetailPageProps) {
  const delivery = useAcademyChapterDelivery({ course: props.course, lessonId: props.activeLessonId, lastLessonId: props.progress?.lastLessonId,
    ownerId: props.noteOwnerId, accessRevision: props.accessRevision ?? JSON.stringify([props.enrolled, props.accessLocked, props.enrolledAt, props.previewMode]),
    enrolled: props.enrolled, enrolledAt: props.enrolledAt, accessLocked: props.accessLocked === true,
    previewMode: props.previewMode === true, demoMode: props.allowDemoContent === true, loading: props.loading === true,
    accessError: props.learningWarning || props.loadError, onRefreshCatalog: props.onRetry })
  return <CourseDetailView {...props} course={delivery.course}
    key={`${props.noteOwnerId}:${props.course?.id ?? ''}:${props.accessRevision ?? ''}`}
    chapterLoading={delivery.loading} chapterError={delivery.error} onRetryChapter={delivery.retry}
    loadedReviewLessons={delivery.usesDelivery ? delivery.loadedLessons : undefined}
    onPrepareReview={delivery.usesDelivery ? delivery.prepareReview : undefined}
    onPreparePortfolio={delivery.usesDelivery ? delivery.preparePortfolio : undefined} />
}

function CourseDetailView({
  course,
  progress,
  activeLessonId,
  enrolled,
  enrolledAt,
  noteOwnerId,
  accessRevision,
  accessLocked = false,
  learningWarning,
  loading = false,
  loadError,
  onRetry,
  allowDemoContent = false,
  previewMode = false,
  onBack,
  onSelectLesson,
  onEnroll,
  onComplete,
  onUpgrade,
  chapterLoading,
  chapterError,
  onRetryChapter,
  loadedReviewLessons,
  onPrepareReview,
  onPreparePortfolio,
}: CourseDetailPageProps & { chapterLoading?: boolean; chapterError?: unknown; onRetryChapter?: () => void;
  loadedReviewLessons?: CourseLessonDraft[]; onPrepareReview?: (lessonIds: string[]) => Promise<CourseLessonDraft[]>;
  onPreparePortfolio?: (chapter: 5 | 10 | 15 | 20) => Promise<CourseLessonDraft[]> }) {
  const [readerState, setReaderState] = useState<{ key: string; value: ReaderView }>({ key: '', value: 'content' })
  const [completeState, setCompleteState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [enrollState, setEnrollState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [actionError, setActionError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [mediaProgress, setMediaProgress] = useState(0)
  const [mobileLessonsOpen, setMobileLessonsOpen] = useState(false)
  const [outlineQuery, setOutlineQuery] = useState('')

  const modules = useMemo(() => course ? getCourseModules(course, allowDemoContent) : [], [allowDemoContent, course])
  const lessons = useMemo(() => course ? flattenCourseLessons(course, allowDemoContent) : [], [allowDemoContent, course])
  const isAuraNutritionCurriculum = modules.length === 20
    && modules.every((module) => module.id.startsWith('nutrition-chapter-'))
  const navigationLessons = useMemo(() => {
    if (!isAuraNutritionCurriculum) return lessons
    return modules.flatMap((module) => {
      const coreLesson = module.lessons.find((lesson) => lesson.id.endsWith('-core')) ?? module.lessons[0]
      return coreLesson ? [coreLesson] : []
    })
  }, [isAuraNutritionCurriculum, lessons, modules])
  const fallbackCompletedIds = useMemo(
    () => course && allowDemoContent ? getInitialDemoCompletedLessonIds(course) : [],
    [allowDemoContent, course],
  )
  const completedLessonIds = progress?.completedLessonIds.length ? progress.completedLessonIds : fallbackCompletedIds
  const requestedLesson = lessons.find((lesson) => lesson.id === activeLessonId)
    ?? lessons.find((lesson) => lesson.id === progress?.lastLessonId)
    ?? lessons[0]
  const requestedModule = requestedLesson
    ? modules.find((module) => module.lessons.some((lesson) => lesson.id === requestedLesson.id))
    : undefined
  const selectedLesson = isAuraNutritionCurriculum
    ? requestedModule?.lessons.find((lesson) => lesson.id.endsWith('-core')) ?? navigationLessons[0]
    : requestedLesson
  const completionContext = JSON.stringify([noteOwnerId, course?.id, selectedLesson?.id, selectedLesson?.contentVersion])
  const activeCompletionContext = useRef<string | null>(completionContext)
  activeCompletionContext.current = completionContext
  useEffect(() => { activeCompletionContext.current = completionContext; return () => { activeCompletionContext.current = null } }, [completionContext])
  const selectedPdfResource = firstPdfResource(selectedLesson)
  const authoredReading = selectedLesson?.primaryContent?.kind === 'rich-text' && Boolean(selectedLesson.learningDesign?.practice.reviewRubric)
  const readerIdentity = JSON.stringify([selectedLesson?.id, selectedLesson?.contentVersion, selectedPdfResource?.id, authoredReading])
  const readerView = readerState.key === readerIdentity ? readerState.value : selectedPdfResource && !authoredReading ? 'resources' : 'content'
  const setReaderView = (value: ReaderView) => setReaderState({ key: readerIdentity, value })
  const selectedModuleIndex = selectedLesson
    ? modules.findIndex((module) => module.lessons.some((lesson) => lesson.id === selectedLesson.id))
    : -1
  const selectedModule = selectedModuleIndex >= 0 ? modules[selectedModuleIndex] : undefined
  const selectedChapterQuiz = isAuraNutritionCurriculum
    ? selectedModule?.lessons.find((lesson) => lesson.type === 'Quiz')
    : undefined
  const selectedChapterQuizCompleted = academyQuizCompletionCurrent(selectedChapterQuiz, completedLessonIds, progress?.quizCompletionChapterVersions)
  const selectedChapterPractice = isAuraNutritionCurriculum ? selectedModule?.lessons.find((lesson) => lesson.id.endsWith('-practice')) : undefined
  const selectedLessonIndex = selectedLesson ? navigationLessons.findIndex((lesson) => lesson.id === selectedLesson.id) : -1
  const previousLesson = selectedLessonIndex > 0 ? navigationLessons[selectedLessonIndex - 1] : undefined
  const nextLesson = selectedLessonIndex >= 0 && selectedLessonIndex < navigationLessons.length - 1 ? navigationLessons[selectedLessonIndex + 1] : undefined
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
  const lessonCompleted = selectedLesson?.type === 'Quiz'
    ? academyQuizCompletionCurrent(selectedLesson, completedLessonIds, progress?.quizCompletionChapterVersions)
    : Boolean(selectedLesson && completedLessonIds.includes(selectedLesson.id))
  const completionPolicy = lessonCompletionPolicy(selectedLesson)
  const completionThreshold = Math.max(1, Math.min(100, completionPolicy.thresholdPercent ?? 80))
  const mediaThresholdReached = mediaProgress >= completionThreshold
  const isLegacyWorkoutLesson = selectedLesson?.type === 'Buổi tập'
    || selectedLesson?.completionPolicy?.mode === 'workout-complete'
    || selectedLesson?.primaryContent?.kind === 'workout'
  const taggedChapterNumber = Number(selectedLesson?.tags?.find((tag) => /^Chương\s+\d+$/i.test(tag))?.match(/\d+/)?.[0])
  const fullChapterNumber = Number.isInteger(taggedChapterNumber) && taggedChapterNumber >= 1 && taggedChapterNumber <= 20
    ? taggedChapterNumber
    : selectedModuleIndex + 1
  const canShowFullReader = isAuraNutritionCurriculum
    && selectedLesson?.id.endsWith('-core') === true
    && fullChapterNumber >= 1
    && fullChapterNumber <= 20
  const openToAllMembers = course?.settings?.accessTier === 'free' && course.settings.visibility === 'members'
  const canStudy = (enrolled || previewMode) && !accessLocked && selectedLessonAvailable && !chapterLoading && !chapterError
  const canViewContent = canStudy || Boolean(selectedLesson?.preview && course?.settings?.visibility === 'members' && !chapterLoading && !chapterError)
  const mediaAccess = { ownerId: noteOwnerId, accessRevision: accessRevision ?? JSON.stringify([enrolled, enrolledAt, accessLocked, previewMode]),
    chapterVersion: selectedLesson?.contentVersion, courseRevision: course?.revision ?? 0, authoringPreview: previewMode }
  const normalizedOutlineQuery = normalizeOutlineSearch(outlineQuery)
  const outlineModules = useMemo(() => isAuraNutritionCurriculum
    ? modules.flatMap((module) => {
        const coreLesson = module.lessons.find((lesson) => lesson.id.endsWith('-core')) ?? module.lessons[0]
        return coreLesson ? [{ ...module, lessons: [coreLesson] }] : []
      })
    : modules, [isAuraNutritionCurriculum, modules])
  const visibleModules = useMemo(() => {
    if (!normalizedOutlineQuery) return outlineModules
    return outlineModules.flatMap((module) => {
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
  }, [normalizedOutlineQuery, outlineModules])

  useEffect(() => {
    setCompleteState(lessonCompleted ? 'saved' : 'idle')
  }, [lessonCompleted, selectedLesson?.id, selectedLesson?.contentVersion])

  useEffect(() => {
    // New bespoke chapters deliver the complete text. Retained legacy PDFs
    // stay optional and must not start a media read on entry.
    setReaderView(selectedPdfResource && !authoredReading ? 'resources' : 'content')
    setMediaProgress(0)
    setActionError(null)
  }, [selectedLesson?.id, selectedLesson?.contentVersion, selectedPdfResource?.id, authoredReading])

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
    if (loadError) return <AcademyLoadError error={loadError} onRetry={onRetry} onBack={onBack} />
    return <div className="course-detail-state"><BookOpen size={34} /><h1>Không tìm thấy khóa học</h1><p>Khóa học có thể đã bị ẩn hoặc đường dẫn không đúng.</p><button className="primary-button" onClick={onBack}>Về thư viện</button></div>
  }

  const completeLesson = async () => {
    if (!selectedLesson || !canStudy) return
    setCompleteState('saving')
    setActionError(null)
    try {
      await onComplete(String(course.id), selectedLesson.id, undefined, undefined, selectedLesson.contentVersion)
      if (activeCompletionContext.current !== completionContext) return
      setCompleteState('saved')
    } catch (error) {
      if (activeCompletionContext.current !== completionContext) return
      setCompleteState('error')
      setActionError(courseLoadErrorMessage(error))
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
      setActionError(courseLoadErrorMessage(error))
    }
  }

  const selectLesson = (lessonId: string) => {
    const nextLesson = lessons.find((lesson) => lesson.id === lessonId)
    setReaderView(firstPdfResource(nextLesson) ? 'resources' : 'content')
    onSelectLesson(lessonId)
  }
  const selectMobileLesson = (lessonId: string) => {
    selectLesson(lessonId)
    setMobileLessonsOpen(false)
  }
  const unlockLabel = (unlockAt: number | null) => {
    if (unlockAt === Number.POSITIVE_INFINITY) return 'Đang chờ ngày ghi danh'
    if (unlockAt === null || unlockAt <= now) return null
    return `Mở ${new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short' }).format(new Date(unlockAt))}`
  }
  const lessonNavigationLabel = (lesson: CourseLessonDraft | undefined) => {
    if (!lesson) return null
    if (!isAuraNutritionCurriculum) return lesson.title
    const module = modules.find((item) => item.lessons.some((candidate) => candidate.id === lesson.id))
    return module ? moduleDisplayTitle(module.title) : lesson.title
  }

  const renderCompletionAction = () => {
    if (previewMode) return <span className="course-reader-preview">Xem trước</span>
    if (accessLocked) return <button className="primary-button" onClick={onUpgrade}><LockKeyhole size={16} /> Nâng cấp Pro</button>
    if (!enrolled) {
      return <button className="primary-button" onClick={enroll} disabled={enrollState === 'saving' || lessons.length === 0}><Play size={16} fill="currentColor" /> {enrollState === 'saving' ? 'Đang mở…' : enrollState === 'error' ? 'Thử lại' : openToAllMembers ? 'Bắt đầu miễn phí' : 'Bắt đầu học'}</button>
    }
    if (!selectedLessonAvailable) return <button className="primary-button" disabled><LockKeyhole size={16} /> {unlockLabel(selectedUnlockAt) ?? 'Chưa mở'}</button>
    if (chapterLoading || chapterError) return <button className="primary-button" disabled><BookOpen size={16} /> {chapterLoading ? 'Đang tải chương…' : 'Cần tải lại chương'}</button>
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
    if (chapterError) return <AcademyLoadError error={chapterError} onRetry={onRetryChapter} />
    if (chapterLoading) return <CourseRuntimeFallback />
    if (readerView === 'resources') {
      if (!selectedLesson?.resources?.length) {
        return <div className="lesson-empty-state"><FileText size={28} /><h2>Chưa có tài nguyên</h2><p>Chương này chưa có tệp đính kèm.</p></div>
      }
      if (selectedPdfResource) {
        const supplementalResources = selectedLesson.resources.filter((resource) => resource.id !== selectedPdfResource.id)
        return (
          <article className="course-reader-resources">
            <CoursePdfReader key={`${noteOwnerId}:${course.id}:${selectedLesson.id}:${selectedLesson.contentVersion ?? course.revision ?? 0}`} ownerId={noteOwnerId} courseId={String(course.id)} lessonId={selectedLesson.id} resource={selectedPdfResource} canAccess={canViewContent} mediaAccess={mediaAccess} onRefreshCourse={onRetry} />
            {supplementalResources.length ? (
              <details className="course-reader-supplemental" open>
                <summary>Tài nguyên bổ sung <span>{supplementalResources.length}</span></summary>
                <div className="lesson-resource-list">
                  {supplementalResources.map((resource) => <CourseResourceItem key={resource.id} courseId={String(course.id)} lessonId={selectedLesson.id} resource={resource} canAccess={canViewContent} mediaAccess={mediaAccess} onRefreshCourse={onRetry} />)}
                </div>
              </details>
            ) : null}
          </article>
        )
      }
      return (
        <article className="course-reader-resources">
          <header><div><small>TÀI LIỆU CHƯƠNG {Math.max(1, selectedModuleIndex + 1)}</small><h2>Tài nguyên bổ sung</h2></div><strong>{selectedLesson.resources.length}</strong></header>
          <div className="lesson-resource-list">
            {selectedLesson.resources.map((resource) => <CourseResourceItem key={resource.id} courseId={String(course.id)} lessonId={selectedLesson.id} resource={resource} canAccess={canViewContent} mediaAccess={mediaAccess} onRefreshCourse={onRetry} />)}
          </div>
        </article>
      )
    }
    if (canShowFullReader) {
      if (!canViewContent) {
        return <div className="lesson-empty-state"><LockKeyhole size={28} /><h2>Bài đọc đang được khóa</h2><p>{openToAllMembers ? 'Bấm “Bắt đầu miễn phí” để đọc toàn bộ chương.' : 'Ghi danh khóa học để đọc toàn bộ chương.'}</p></div>
      }
      return (
        <AcademyChapterLearningStudio
          key={`${noteOwnerId}:${course.id}:${selectedLesson.id}:${selectedLesson.contentVersion ?? course.revision ?? 0}`}
          chapter={fullChapterNumber}
          ownerId={noteOwnerId}
          courseId={String(course.id)}
          coreLesson={selectedLesson}
          reviewLessons={loadedReviewLessons?.filter((lesson) => lesson.id.endsWith('-core')) ?? navigationLessons}
          portfolioLessons={navigationLessons}
          onPrepareReview={onPrepareReview}
          onPreparePortfolio={onPreparePortfolio}
          reviewScopeKey={JSON.stringify([course.revision, modules.map((module) => [module.id, module.contentVersion])])}
          canStudy={canStudy && !previewMode}
          quizCompleted={selectedChapterQuizCompleted}
          quizPreviouslyCompleted={Boolean(selectedChapterQuiz && completedLessonIds.includes(selectedChapterQuiz.id) && !selectedChapterQuizCompleted)}
          practiceCompleted={Boolean(selectedChapterPractice && completedLessonIds.includes(selectedChapterPractice.id))}
          submittedPracticeRevision={selectedChapterPractice ? progress?.practiceSubmissionRevisions?.[selectedChapterPractice.id] : undefined}
          practiceSubmissionRevisions={progress?.practiceSubmissionRevisions}
          practiceSubmissionDefinitionVersions={progress?.practiceSubmissionDefinitionVersions}
          practiceSubmissionDefinitionHashes={progress?.practiceSubmissionDefinitionHashes}
          completedLessonIds={progress?.completedLessonIds}
          onSubmitPractice={selectedChapterPractice ? (evidence) => onComplete(String(course.id), selectedChapterPractice.id, undefined, evidence, selectedChapterPractice.contentVersion) : undefined}
          demoMode={allowDemoContent}
          quizContent={(onReviewCards, remediationCards) => selectedChapterQuiz
            ? <CourseQuizRunner
                courseId={String(course.id)}
                lesson={selectedChapterQuiz}
                canSubmit={canStudy && !previewMode}
                demoMode={allowDemoContent}
                completed={selectedChapterQuizCompleted}
                onReviewCards={onReviewCards}
                remediationCards={remediationCards}
                onPassed={() => onComplete(String(course.id), selectedChapterQuiz.id, undefined, undefined, selectedChapterQuiz.contentVersion)}
              />
            : <div className="lesson-empty-state"><ListChecks size={28} /><h2>Checkpoint đang đồng bộ</h2><p>Bài kiểm tra của chương này chưa có trong bản khóa học đang xuất bản.</p></div>}
        />
      )
    }
    if (!selectedLesson) return <div className="lesson-empty-state"><BookOpen size={28} /><h2>Chưa có nội dung</h2></div>
    if (selectedLesson.type === 'Quiz') {
      return <CourseQuizRunner courseId={String(course.id)} lesson={selectedLesson} canSubmit={canStudy && !previewMode} demoMode={allowDemoContent} completed={lessonCompleted} onPassed={completeLesson} />
    }
    return <CoursePrimaryContent courseId={String(course.id)} lesson={selectedLesson} canView={canViewContent} mediaAccess={mediaAccess} onRefreshCourse={onRetry} lockedMessage={accessLocked ? 'Nâng cấp Aura Pro để mở nội dung này.' : openToAllMembers ? 'Bấm Bắt đầu miễn phí để mở toàn bộ bài học.' : selectedLessonAvailable ? 'Ghi danh để mở khóa bài học' : unlockLabel(selectedUnlockAt) ?? 'Bài học chưa mở'} onMediaProgress={setMediaProgress} onOpenResources={() => setReaderView('resources')} />
  }

  const renderOutline = (mobile = false): ReactNode => {
    if (!visibleModules.length) return <p className="course-reader-outline__empty">Không tìm thấy chương hoặc bài phù hợp.</p>
    return visibleModules.map((module) => {
      const moduleIndex = modules.findIndex((item) => item.id === module.id)
      return (
        <section className={`course-reader-outline__module${isAuraNutritionCurriculum ? ' is-chapter' : ''}`} key={module.id}>
          {!isAuraNutritionCurriculum ? <header><span>CHƯƠNG {moduleIndex + 1}</span><strong>{moduleDisplayTitle(module.title)}</strong></header> : null}
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
                  {isAuraNutritionCurriculum ? <span className="course-reader-outline__chapter-copy"><small>CHƯƠNG {moduleIndex + 1}</small><strong>{moduleDisplayTitle(module.title)}</strong></span> : <strong>{lesson.title}</strong>}
                  <i>{String(isAuraNutritionCurriculum ? moduleIndex + 1 : lessonNumber).padStart(2, '0')}</i>
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
        <div className="course-reader-header__progress" aria-label={`${percent}% hoàn thành`}><span>{selectedLessonIndex + 1}/{navigationLessons.length}</span><ProgressBar value={percent} /></div>
        <div className="course-reader-header__action">{renderCompletionAction()}</div>
      </header>

      {(actionError || learningWarning) ? <div className="course-reader-alert" role="alert">{actionError ?? `Tiến độ tạm thời chưa lưu: ${learningWarning}`}</div> : null}

      <div className="course-reader-layout">
        <aside className="course-reader-outline" aria-label="Mục lục khóa học">
          <header><div><small>MỤC LỤC</small><strong>{isAuraNutritionCurriculum ? `${modules.length} chương toàn văn` : `${modules.length} chương · ${lessons.length} bài`}</strong></div></header>
          <label className="course-reader-search"><Search size={15} /><input value={outlineQuery} onChange={(event) => setOutlineQuery(event.target.value)} placeholder="Tìm chương, bài học…" aria-label="Tìm trong mục lục" />{outlineQuery ? <button type="button" onClick={() => setOutlineQuery('')} aria-label="Xóa tìm kiếm">×</button> : null}</label>
          <div className="course-reader-outline__scroll">{renderOutline()}</div>
        </aside>

        <main className="course-reader-main">
          <section className="course-reader-title">
            <div><small>{selectedModule ? `CHƯƠNG ${selectedModuleIndex + 1} / ${modules.length}` : 'BÀI HỌC'}</small><h1>{isAuraNutritionCurriculum && selectedModule ? moduleDisplayTitle(selectedModule.title) : selectedLesson?.title ?? course.title}</h1></div>
            <button type="button" className="course-reader-outline-button" aria-controls="course-outline-sheet" aria-expanded={mobileLessonsOpen} onClick={() => setMobileLessonsOpen(true)}><List size={17} /> Mục lục</button>
          </section>

          <nav className="course-reader-toolbar" aria-label="Công cụ đọc">
            <div role="tablist" aria-label="Loại nội dung">
              {selectedLesson?.resources?.length ? <button type="button" role="tab" aria-selected={readerView === 'resources'} className={readerView === 'resources' ? 'is-active' : ''} onClick={() => setReaderView('resources')}><FileText size={15} />{authoredReading ? 'Tham khảo' : selectedPdfResource ? 'Nội Dung' : 'Tài nguyên'}{selectedLesson.resources.length ? <span className="course-reader-resource-count">{selectedLesson.resources.length}</span> : null}</button> : null}
              {(!selectedPdfResource || isAuraNutritionCurriculum) ? <button type="button" role="tab" aria-selected={readerView === 'content'} className={readerView === 'content' ? 'is-active' : ''} onClick={() => setReaderView('content')}><BookOpen size={15} /> {isAuraNutritionCurriculum ? 'Học cùng Aura' : 'Nội dung'}</button> : null}
            </div>
            <div className="course-reader-lesson-pager">
              <button type="button" disabled={!previousLesson} onClick={() => previousLesson && selectLesson(previousLesson.id)} aria-label="Bài trước"><ChevronLeft size={17} /></button>
              <span>{selectedLessonIndex >= 0 ? `${selectedLessonIndex + 1} / ${navigationLessons.length}` : `0 / ${navigationLessons.length}`}</span>
              <button type="button" disabled={!nextLesson} onClick={() => nextLesson && selectLesson(nextLesson.id)} aria-label="Bài tiếp theo"><ChevronRight size={17} /></button>
            </div>
          </nav>

          <div className="course-reader-content" role="tabpanel"><Suspense fallback={<CourseRuntimeFallback />}>{renderReaderContent()}</Suspense></div>

          <nav className="course-reader-bottom-pager" aria-label="Chuyển bài học">
            <button type="button" disabled={!previousLesson} onClick={() => previousLesson && selectLesson(previousLesson.id)}><ChevronLeft size={17} /><span><small>{isAuraNutritionCurriculum ? 'CHƯƠNG TRƯỚC' : 'BÀI TRƯỚC'}</small><strong>{lessonNavigationLabel(previousLesson) ?? 'Đầu khóa học'}</strong></span></button>
            <button type="button" disabled={!nextLesson} onClick={() => nextLesson && selectLesson(nextLesson.id)}><span><small>{isAuraNutritionCurriculum ? 'CHƯƠNG TIẾP THEO' : 'BÀI TIẾP THEO'}</small><strong>{lessonNavigationLabel(nextLesson) ?? 'Cuối khóa học'}</strong></span><ChevronRight size={17} /></button>
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
