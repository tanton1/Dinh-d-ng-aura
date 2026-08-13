import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  Circle,
  FileText,
  ListChecks,
  LockKeyhole,
  MessageCircle,
  NotebookPen,
  Play,
  Sparkles,
} from 'lucide-react'
import AcademyLessonStudy from '../../components/academy/AcademyLessonStudy'
import { CoursePrimaryContent, CourseQuizRunner, CourseResourceItem } from '../../components/CourseLessonRuntime'
import { ProgressBar } from '../../components/ui'
import { getAcademyCoachNote, loadAcademyNoteFromCloud, saveAcademyNoteToCloud } from '../../services/academyLearningService'
import { summarizeLessonWithAi } from '../../services/generativeAiService'
import type { Course, CourseLessonDraft, CourseProgress } from '../../types'
import { flattenCourseLessons, getCourseModules, getInitialDemoCompletedLessonIds } from '../../utils/courseContent'

type LessonTab = 'overview' | 'memory' | 'resources' | 'notes' | 'discussion'

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

function lessonIcon(lesson: CourseLessonDraft) {
  if (lesson.type === 'Quiz') return <ListChecks size={13} />
  if (lesson.type === 'Bài đọc') return <BookOpen size={13} />
  if (lesson.type === 'Buổi tập') return <BookOpen size={13} />
  return <Play size={13} />
}

type RuntimeCompletionPolicy = {
  mode: 'manual' | 'media-progress' | 'quiz-pass'
  thresholdPercent?: number
  quizId?: string
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
      quizId: typeof explicit.quizId === 'string' ? explicit.quizId : undefined,
    }
  }
  if (lesson?.type === 'Quiz') return { mode: 'quiz-pass' }
  return { mode: 'manual' }
}

function timestampToMillis(value: unknown) {
  if (value instanceof Date) return value.getTime()
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis()
  }
  const parsed = typeof value === 'string' || typeof value === 'number' ? new Date(value).getTime() : Number.NaN
  return Number.isNaN(parsed) ? null : parsed
}

export default function CourseDetailPage({
  course,
  progress,
  activeLessonId,
  enrolled,
  enrolledAt,
  noteOwnerId,
  onNoteDirtyChange,
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
  const [tab, setTab] = useState<LessonTab>('overview')
  const [completeState, setCompleteState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [enrollState, setEnrollState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [note, setNote] = useState('')
  const [noteSaved, setNoteSaved] = useState(false)
  const savedNote = useRef('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [mediaProgress, setMediaProgress] = useState(0)
  const modules = useMemo(() => course ? getCourseModules(course, allowDemoContent) : [], [allowDemoContent, course])
  const lessons = useMemo(() => course ? flattenCourseLessons(course, allowDemoContent) : [], [allowDemoContent, course])
  const fallbackCompletedIds = useMemo(
    () => course && allowDemoContent ? getInitialDemoCompletedLessonIds(course) : [],
    [allowDemoContent, course],
  )
  const completedLessonIds = progress?.completedLessonIds.length ? progress.completedLessonIds : fallbackCompletedIds
  const [aiSummaryState, setAiSummaryState] = useState<'idle' | 'generating' | 'done'>('idle');
  const [aiSummaryData, setAiSummaryData] = useState<any>(null);

  useEffect(() => {
    setAiSummaryState('idle');
    setAiSummaryData(null);
  }, [activeLessonId]);

  const generateAiSummary = async () => {
    if (!selectedLesson || !course) return;
    try {
      setAiSummaryState('generating');
      const data = await summarizeLessonWithAi({
        courseTitle: course.title,
        lessonTitle: selectedLesson.title,
        lessonContent: selectedLesson.summary || course.description,
      });
      if (data && data.takeaways) {
        setAiSummaryData(data);
        setAiSummaryState('done');
      } else {
        setAiSummaryState('idle');
      }
    } catch (e) {
      alert("Lỗi AI tóm tắt.");
      setAiSummaryState('idle');
    }
  };
  const selectedLesson = lessons.find((lesson) => lesson.id === activeLessonId)
    ?? lessons.find((lesson) => lesson.id === progress?.lastLessonId)
    ?? lessons[0]
  const selectedModuleIndex = selectedLesson
    ? modules.findIndex((module) => module.lessons.some((lesson) => lesson.id === selectedLesson.id))
    : -1
  const selectedModule = selectedModuleIndex >= 0 ? modules[selectedModuleIndex] : undefined
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
  const isLegacyWorkoutLesson = selectedLesson?.type === 'Buổi tập'
    || selectedLesson?.completionPolicy?.mode === 'workout-complete'
    || selectedLesson?.primaryContent?.kind === 'workout'
  const completionThreshold = Math.max(1, Math.min(100, completionPolicy.thresholdPercent ?? 80))
  const mediaThresholdReached = mediaProgress >= completionThreshold
  const canStudy = (enrolled || previewMode) && !accessLocked && selectedLessonAvailable
  const canPreview = Boolean(selectedLesson?.preview)
  const canViewContent = canStudy || canPreview
  const noteStorageKey = course && selectedLesson
    ? `aura-note:${noteOwnerId}:${String(course.id)}:${selectedLesson.id}`
    : ''
  const noteDirty = note !== savedNote.current

  useEffect(() => {
    setCompleteState(lessonCompleted ? 'saved' : 'idle')
    setTab('overview')
    setMediaProgress(0)
    setActionError(null)
  }, [lessonCompleted, selectedLesson?.id])

  useEffect(() => {
    if (!noteStorageKey) {
      setNote('')
      savedNote.current = ''
      return
    }
    let storedNote = ''
    try {
      storedNote = localStorage.getItem(noteStorageKey) ?? ''
      setNote(storedNote)
      savedNote.current = storedNote
    } catch {
      setNote('')
      savedNote.current = ''
    }
    setNoteSaved(false)
    if (storedNote || !course || !selectedLesson) return
    let active = true
    void loadAcademyNoteFromCloud(noteOwnerId, String(course.id), selectedLesson.id)
      .then((cloudNote) => {
        if (!active || cloudNote === null) return
        setNote(cloudNote)
        savedNote.current = cloudNote
        try { localStorage.setItem(noteStorageKey, cloudNote) } catch { /* Cloud remains the durable copy. */ }
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [course, noteOwnerId, noteStorageKey, selectedLesson])

  useEffect(() => {
    if (!noteDirty) return
    const warnAboutUnsavedNote = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnAboutUnsavedNote)
    return () => window.removeEventListener('beforeunload', warnAboutUnsavedNote)
  }, [noteDirty])

  useEffect(() => {
    onNoteDirtyChange?.(noteDirty)
    return () => onNoteDirtyChange?.(false)
  }, [noteDirty, onNoteDirtyChange])

  useEffect(() => {
    if (!dripEnabled || enrolledAtMillis === null) return
    const nearestUnlock = modules
      .map((_, moduleIndex) => enrolledAtMillis + moduleIndex * 7 * 24 * 60 * 60 * 1000)
      .filter((unlockAt) => unlockAt > now)
      .sort((left, right) => left - right)[0]
    if (!nearestUnlock) return
    const timeout = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(2_147_000_000, Math.max(50, nearestUnlock - now + 50)),
    )
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

  const saveNote = () => {
    if (!noteStorageKey || !selectedLesson) return
    try {
      localStorage.setItem(noteStorageKey, note)
      savedNote.current = note
      setNoteSaved(true)
      void saveAcademyNoteToCloud(noteOwnerId, String(course.id), selectedLesson.id, note).catch(() => undefined)
    } catch {
      setNoteSaved(false)
    }
  }

  const selectLesson = (lessonId: string) => onSelectLesson(lessonId)

  const unlockLabel = (unlockAt: number | null) => {
    if (unlockAt === Number.POSITIVE_INFINITY) return 'Đang chờ đăng ký ngày ghi danh'
    if (unlockAt === null || unlockAt <= now) return null
    return `Mở ${new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short' }).format(new Date(unlockAt))}`
  }

  const renderTab = () => {
    if (tab === 'resources') {
      if (!selectedLesson?.resources?.length) {
        return <div className="lesson-empty-state"><FileText size={28} /><h2>Chưa có tài liệu đính kèm</h2><p>Giảng viên sẽ cập nhật tài liệu cho bài học này khi sẵn sàng.</p></div>
      }
      return (
        <article className="lesson-resources">
          <h2>Tài liệu bài học</h2>
          <div className="lesson-resource-list">
            {selectedLesson.resources.map((resource) => (
              <CourseResourceItem
                key={resource.id}
                courseId={String(course.id)}
                lessonId={selectedLesson.id}
                resource={resource}
                canAccess={canViewContent}
              />
            ))}
          </div>
        </article>
      )
    }
    if (tab === 'notes') {
      return (
        <div className="lesson-notes">
          <div><NotebookPen size={22} /><span><strong>Ghi chú cá nhân</strong><small>Ghi chú được lưu trên thiết bị này.</small></span></div>
          <textarea value={note} onChange={(event) => { setNote(event.target.value); setNoteSaved(false) }} placeholder="Ghi lại điểm quan trọng, mục tiêu hoặc câu hỏi của bạn..." />
          <button className="primary-button" onClick={saveNote}><Check size={17} /> {noteSaved ? 'Đã lưu ghi chú' : 'Lưu ghi chú'}</button>
        </div>
      )
    }
    if (tab === 'memory') {
      if (!selectedLesson) return <div className="lesson-empty-state"><BookOpen size={28} /><h2>Chưa có bài học để ôn</h2></div>
      return <AcademyLessonStudy ownerId={noteOwnerId} courseId={String(course.id)} lesson={selectedLesson} courseOutcomes={course.outcomes} canReview={canStudy && !previewMode} />
    }
    if (tab === 'discussion') {
      return <div className="lesson-empty-state"><MessageCircle size={28} /><h2>Thảo luận đang hoàn thiện</h2><p>Gặp lại bạn sẽ có thể đặt câu hỏi và trao đổi trực tiếp dưới mỗi bài học.</p><span className="coming-soon-badge">SẮP RA MẮT</span></div>
    }
    return (
      <>
        {selectedLesson?.type === 'Quiz' ? (
          <CourseQuizRunner
            courseId={String(course.id)}
            lesson={selectedLesson}
            canSubmit={canStudy && !previewMode}
            demoMode={allowDemoContent}
            completed={lessonCompleted}
            onPassed={completeLesson}
          />
        ) : null}
        <article className="lesson-copy">
        <h2>Bạn sẽ học được gì?</h2>
        <div className="takeaway-grid">
          {(course.outcomes?.length ? course.outcomes : [
            `Nắm vững nội dung cốt lõi của ${course.title}`,
            'Hiểu cơ chế dinh dưỡng thay vì chỉ ghi nhớ con số',
            'Biết phân tích thông tin và bằng chứng dinh dưỡng',
            'Ứng dụng kiến thức vào tình huống thực tế',
          ]).slice(0, 4).map((outcome) => <span key={outcome}><CheckCircle2 size={19} /> {outcome}</span>)}
        </div>
        <h2>Nội dung bài học</h2>
        <p>{selectedLesson?.summary || course.description}</p>
        {selectedLesson?.tags?.length ? (
          <div className="lesson-tags">
            <strong>Tag bài học:</strong>
            <div>{selectedLesson.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
          </div>
        ) : null}
                {getAcademyCoachNote(selectedLesson) ? <div className="coach-notes-block"><NotebookPen size={17} /><div><strong>Ghi chú giảng viên</strong><p>{getAcademyCoachNote(selectedLesson)}</p></div></div> : null}
        
        {/* AI Summary Block */}
        <div style={{ marginTop: 24, padding: 20, borderRadius: 12, background: 'linear-gradient(to right, #f8fafc, #f1f5f9)', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
             <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
               <Sparkles size={18} color="#8b5cf6" />
               <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#334155' }}>AI Tổng hợp</h3>
             </div>
             {aiSummaryState === 'idle' && (
                <button className="primary-button" style={{ background: '#8b5cf6', border: '1px solid #8b5cf6', fontSize: 12, padding: '6px 12px' }} onClick={generateAiSummary}>
                  Tạo Tóm Tắt & Thẻ Ghi Nhớ
                </button>
             )}
             {aiSummaryState === 'generating' && (
                <span style={{ fontSize: 12, color: '#64748b' }}>Đang phân tích...</span>
             )}
          </div>
          
          {aiSummaryState === 'done' && aiSummaryData && (
            <div>
              <div style={{ marginBottom: 16 }}>
                <strong style={{ fontSize: 13, color: '#475569', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Takeaways</strong>
                <ul style={{ paddingLeft: 20, margin: 0, color: '#334155', fontSize: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {aiSummaryData.takeaways?.map((item: string, idx: number) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong style={{ fontSize: 13, color: '#475569', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Key Concepts</strong>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {aiSummaryData.keyConcepts?.map((concept: any, idx: number) => (
                    <div key={idx} style={{ background: '#fff', padding: '10px 14px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                      <strong style={{ color: '#0f172a', display: 'block', fontSize: 14 }}>{concept.term}</strong>
                      <p style={{ margin: 0, color: '#64748b', fontSize: 13, marginTop: 4 }}>{concept.definition}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        </article>
      </>
    )
  }
  return (
    <div className="course-detail-page">
      <div className="course-detail-topline">
        <button className="back-button" onClick={onBack}><ArrowLeft size={18} /> {previewMode ? 'Quay lại quản trị' : 'Quay lại khóa học'}</button>
        {previewMode
          ? <div className="course-preview-indicator"><span>XEM TRƯỚC HỌC VIÊN</span><strong>Không ghi tiến độ</strong></div>
          : <div><span>{percent}% hoàn thành</span><ProgressBar value={percent} /><strong>{completedLessonIds.length}/{lessons.length} bài</strong></div>}
      </div>

        <div className="learning-layout">
        <section className="lesson-main">
          {selectedLesson ? (
            <CoursePrimaryContent
              courseId={String(course.id)}
              lesson={selectedLesson}
              canView={canViewContent}
              lockedMessage={accessLocked ? 'Nâng cấp Aura Pro để mở nội dung này.' : selectedLessonAvailable ? 'Ghi danh để mở khóa bài học' : unlockLabel(selectedUnlockAt) ?? 'Bài học chưa mở'}
              onMediaProgress={setMediaProgress}
            />
          ) : (
            <div className="lesson-empty-state media"><BookOpen size={30} /><h2>Khóa học chưa có bài học</h2><p>Quản trị viên cần bổ sung ít nhất một bài trước khi học viên bắt đầu.</p></div>
          )}

          <div className="lesson-title-row">
            <div>
              <span className="eyebrow">{selectedModule?.title?.toUpperCase() ?? 'NỘI DUNG KHÓA HỌC'}</span>
              <h1>{selectedLesson?.title ?? course.title}</h1>
              <p>{selectedLesson?.summary || course.description}</p>
            </div>
            {previewMode ? (
              <button className="outline-button" disabled><Sparkles size={18} /> Chế độ xem trước</button>
            ) : accessLocked ? (
              <button className="primary-button" onClick={onUpgrade}><LockKeyhole size={18} /> Nâng cấp gói Pro</button>
            ) : !enrolled ? (
              <button className="primary-button" onClick={enroll} disabled={enrollState === 'saving' || lessons.length === 0}><Play size={18} fill="currentColor" /> {enrollState === 'saving' ? 'Đang ghi danh...' : enrollState === 'error' ? 'Thử ghi danh lại' : 'Bắt đầu khóa học'}</button>
            ) : !selectedLessonAvailable ? (
              <button className="primary-button" disabled title={unlockLabel(selectedUnlockAt) ?? undefined}><LockKeyhole size={18} /> {unlockLabel(selectedUnlockAt) ?? 'Bài học chưa mở'}</button>
            ) : isLegacyWorkoutLesson ? (
              <button className="primary-button" disabled title="Giảng viên cần chuyển bài học kế thừa sang nội dung Aura Academy"><BookOpen size={18} /> Nội dung đang chuyển đổi</button>
            ) : completionPolicy.mode === 'quiz-pass' ? (
              <button className="primary-button" disabled><ListChecks size={18} /> {lessonCompleted ? 'Đã đạt quiz' : 'Hoàn thành quiz bên dưới'}</button>
            ) : completionPolicy.mode === 'media-progress' ? (
              <button className="primary-button" onClick={completeLesson} disabled={!selectedLesson || completeState === 'saving' || completeState === 'saved' || !mediaThresholdReached}><Check size={18} /> {completeState === 'saving' ? 'Đang lưu...' : completeState === 'saved' ? 'Đã hoàn thành' : mediaThresholdReached ? 'Hoàn thành bài học' : `Đã xem ${mediaProgress}%/${completionThreshold}%`}</button>
            ) : (
              <button className="primary-button" onClick={completeLesson} disabled={!selectedLesson || completeState === 'saving' || completeState === 'saved'}><Check size={18} /> {completeState === 'saving' ? 'Đang đóng...' : completeState === 'saved' ? 'Đã hoàn thành' : completeState === 'error' ? 'Thử đóng lại' : 'Đánh dấu hoàn thành'}</button>
            )}
          </div>
          {selectedLesson && canViewContent ? <div className="lesson-completion-status" role="status" aria-live="polite">{previewMode ? 'Bạn đang xem nội dung bằng quyền quản trị. Mọi thao tác hoàn thành và quiz đều không được ghi.' : isLegacyWorkoutLesson ? 'Bài học kế thừa đang chờ giảng viên chuyển đổi sang Aura Academy.' : completionPolicy.mode === 'media-progress' ? `Điều kiện hoàn thành: xem ít nhất ${completionThreshold}% media.` : completionPolicy.mode === 'quiz-pass' ? 'Điều kiện hoàn thành: đạt điểm yêu cầu của quiz.' : 'Bạn chủ động đánh dấu khi đã học xong nội dung.'}</div> : null}
          {(actionError || learningWarning) && <div className="learning-action-error" role="alert">{actionError ?? `Tiến độ tạm thời chưa lưu: ${learningWarning}`}</div>}

          <div className="lesson-tabs" role="tablist" aria-label="Nội dung bài học">
            <button role="tab" aria-selected={tab === 'overview'} className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Tổng quan</button>
            <button role="tab" aria-selected={tab === 'memory'} className={tab === 'memory' ? 'active' : ''} onClick={() => setTab('memory')}>Ghi nhớ sâu</button>
            <button role="tab" aria-selected={tab === 'resources'} className={tab === 'resources' ? 'active' : ''} onClick={() => setTab('resources')}>Tài liệu</button>
            <button role="tab" aria-selected={tab === 'notes'} className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>Ghi chú</button>
            <button role="tab" aria-selected={tab === 'discussion'} className={tab === 'discussion' ? 'active' : ''} onClick={() => setTab('discussion')}>Thảo luận</button>
          </div>
          <div role="tabpanel">{renderTab()}</div>
        </section>

        <aside className="lesson-sidebar">
          <div className="lesson-sidebar__heading"><div><span className="eyebrow">KHÓA HỌC</span><h2>{course.title}</h2><small>{course.coach} · {course.duration}</small></div></div>
          {modules.map((module, moduleIndex) => {
            const moduleCompleted = module.lessons.filter((lesson) => completedLessonIds.includes(lesson.id)).length
            return (
              <div className="lesson-module" key={module.id}>
                <div className="module-heading"><div><span>CHƯƠNG {moduleIndex + 1}</span><strong>{module.title}</strong></div><small>{moduleCompleted}/{module.lessons.length} bài</small></div>
                <div className="lesson-list">
                  {module.lessons.map((lesson) => {
                    const completed = completedLessonIds.includes(lesson.id)
                    const active = selectedLesson?.id === lesson.id
                    const number = lessons.findIndex((item) => item.id === lesson.id) + 1
                    const lessonUnlockAt = getModuleUnlockAt(moduleIndex)
                    const dripLocked = lessonUnlockAt !== null && lessonUnlockAt > now
                    const dripLabel = unlockLabel(lessonUnlockAt)
                    return (
                      <button key={lesson.id} className={`${active ? 'active' : ''} ${completed ? 'completed' : ''} ${dripLocked ? 'locked' : ''}`} disabled={dripLocked && !lesson.preview} onClick={() => selectLesson(lesson.id)} aria-current={active ? 'step' : undefined}>
                        <span className="lesson-state">{completed ? <CheckCircle2 size={20} /> : dripLocked ? <LockKeyhole size={18} /> : active ? <Play size={18} fill="currentColor" /> : <Circle size={19} />}</span>
                        <span><strong>{lesson.title}</strong><small>{lessonIcon(lesson)} {lesson.type === 'Buổi tập' ? 'Bài học kế thừa' : lesson.type} · {lesson.duration}{lesson.preview ? ' · Xem thử' : dripLabel ? ` · ${dripLabel}` : ''}</small></span>
                        <i>{String(number).padStart(2, '0')}</i>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
           <div className="coach-help"><div className="avatar green">{course.coach.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</div><div><strong>Cần trợ giúp?</strong><span>Gửi câu hỏi cho giảng viên</span></div><MessageCircle size={18} /></div>
        </aside>
      </div>
    </div>
  )
}
