import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  Compass,
  ExternalLink,
  FileSpreadsheet,
  FileType,
  Footprints,
  Lightbulb,
  LoaderCircle,
  LockKeyhole,
  ListChecks,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  Timer,
} from 'lucide-react'
import type { CourseLessonDraft, LessonResourceDraft } from '../types'
import {
  getCourseMediaUrl,
  gradeCourseQuiz,
  safeCourseMediaUrl,
  type QuizGradeResult,
} from '../services/courseRuntimeService'

type RuntimeResource = LessonResourceDraft & {
  assetRef?: {
    assetId: string
    storagePath: string
    contentType?: string
    fileName?: string
    sizeBytes?: number
    status?: 'uploading' | 'ready' | 'failed'
  }
  isPrimary?: boolean
}

type RuntimeLesson = CourseLessonDraft & {
  primaryContent?: {
    kind: 'resource' | 'rich-text' | 'workout'
    resourceId?: string
    body?: string
  }
  quiz?: CourseLessonDraft['quiz'] & {
    publicSettings?: {
      maxAttempts?: number
      timeLimitMinutes?: number
      revealMode?: 'never' | 'after-submit' | 'after-pass'
    }
  }
}

interface ResolvedMediaState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  url: string | null
  contentType?: string
  message?: string
}

const resourceLabels = {
  slide: 'slide',
  video: 'video',
  document: 'tài liệu',
}

function stableOrderScore(value: string) {
  let score = 0
  for (let index = 0; index < value.length; index += 1) score = Math.imul(31, score) + value.charCodeAt(index) | 0
  return score
}

function runtimeResource(resource: LessonResourceDraft): RuntimeResource {
  return resource as RuntimeResource
}

function useResolvedMedia(courseId: string, lessonId: string, resource: RuntimeResource | undefined, enabled: boolean) {
  const [retryKey, setRetryKey] = useState(0)
  const [state, setState] = useState<ResolvedMediaState>({ status: 'idle', url: null })
  const storagePath = resource?.assetRef?.storagePath
  const externalUrl = resource?.url
  const contentType = resource?.assetRef?.contentType
  const assetStatus = resource?.assetRef?.status

  useEffect(() => {
    let cancelled = false
    let refreshTimer: number | undefined
    if (!enabled || !resource) {
      setState({ status: 'idle', url: null })
      return
    }
    if (assetStatus && assetStatus !== 'ready') {
      setState({
        status: 'error',
        url: null,
        message: assetStatus === 'uploading' ? 'Media đang được xử lý.' : 'Media tải lên chưa sẵn sàng.',
      })
      return
    }

    const resolve = async () => {
      setState({ status: 'loading', url: null })
      try {
        if (storagePath) {
          const resolved = await getCourseMediaUrl({ courseId, lessonId, storagePath })
          if (cancelled) return
          setState({ status: 'ready', url: resolved.url, contentType: resolved.contentType ?? contentType })
          if (resolved.expiresAt) {
            const refreshAfter = Math.max(15_000, resolved.expiresAt - Date.now() - 30_000)
            refreshTimer = window.setTimeout(() => setRetryKey((value) => value + 1), refreshAfter)
          }
          return
        }
        const safeUrl = safeCourseMediaUrl(externalUrl)
        if (!safeUrl) throw new Error('Tài nguyên chưa có liên kết HTTPS hợp lệ.')
        if (!cancelled) setState({ status: 'ready', url: safeUrl, contentType })
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'error',
            url: null,
            message: error instanceof Error ? error.message : 'Không thể mở media lúc này.',
          })
        }
      }
    }

    void resolve()
    return () => {
      cancelled = true
      if (refreshTimer) window.clearTimeout(refreshTimer)
    }
  }, [assetStatus, contentType, courseId, enabled, externalUrl, lessonId, resource, retryKey, storagePath])

  return { ...state, retry: () => setRetryKey((value) => value + 1) }
}

function trustedVideoEmbed(value: string) {
  const url = new URL(value)
  if (url.hostname === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0]
    return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : null
  }
  if (url.hostname === 'www.youtube.com' || url.hostname === 'youtube.com') {
    const id = url.pathname.startsWith('/embed/') ? url.pathname.split('/')[2] : url.searchParams.get('v')
    return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : null
  }
  if (url.hostname === 'vimeo.com' || url.hostname === 'www.vimeo.com') {
    const id = url.pathname.split('/').filter(Boolean)[0]
    return id && /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : null
  }
  if (url.hostname === 'player.vimeo.com' && url.pathname.startsWith('/video/')) return url.href
  return null
}

function trustedSlideEmbed(value: string) {
  const url = new URL(value)
  if (url.hostname !== 'docs.google.com' || !url.pathname.startsWith('/presentation/')) return null
  return url.href
}

function MediaLoading() {
  return <div className="lesson-media-status" role="status"><LoaderCircle className="spin" size={16} /> Đang mở media bảo mật...</div>
}

function AcademyRichLesson({ lesson, body }: { lesson: CourseLessonDraft; body: string }) {
  const isPractice = lesson.tags?.includes('Thực hành') === true
  const chapterLabel = lesson.tags?.find((tag) => /^Chương\s+\d+$/i.test(tag)) ?? 'AURA ACADEMY'
  const phaseLabel = lesson.tags?.find((tag) => !/^Chương\s+\d+$/i.test(tag) && !['Thực hành', 'Giáo trình 2026'].includes(tag))
  const takeaways = lesson.memory?.takeaways.slice(0, 3) ?? []
  const terms = lesson.memory?.glossary.slice(0, 3) ?? []
  const visualPath = isPractice
    ? [
        { label: 'Quan sát', detail: 'Bắt đầu từ dữ liệu thật', Icon: Compass },
        { label: 'Thử nhỏ', detail: 'Chọn một bước vừa sức', Icon: Footprints },
        { label: 'Rà lại', detail: 'Giữ, chỉnh hoặc dừng', Icon: Target },
      ]
    : [
        { label: 'Nhìn rộng', detail: 'Hiểu đúng bối cảnh', Icon: Compass },
        { label: 'Nắm lõi', detail: 'Giữ ba ý quan trọng', Icon: Lightbulb },
        { label: 'Nhớ sâu', detail: 'Tự nói lại bằng lời mình', Icon: Brain },
      ]

  return (
    <article className="lesson-copy lesson-primary-copy academy-rich-lesson">
      <header className={`academy-lesson-visual ${isPractice ? 'is-practice' : ''}`}>
        <div className="academy-lesson-visual__glow" aria-hidden="true" />
        <div className="academy-lesson-visual__meta">
          <span><Sparkles size={13} /> {chapterLabel}</span>
          {phaseLabel ? <span>{phaseLabel}</span> : null}
          <span><Timer size={13} /> {lesson.duration}</span>
        </div>
        <div className="academy-lesson-visual__copy">
          <span>{isPractice ? 'XƯỞNG THỰC HÀNH' : 'BẢN ĐỒ HỌC NHANH'}</span>
          <h2>{isPractice ? 'Biến kiến thức thành một bước làm được ngay' : 'Hiểu theo lớp, nhớ bằng kết nối'}</h2>
          <p>{lesson.summary}</p>
        </div>
        <div className="academy-learning-path" aria-label="Nhịp học của bài">
          {visualPath.map(({ label, detail, Icon }, index) => (
            <div key={label}>
              <span><Icon size={18} /></span>
              <strong>{label}</strong>
              <small>{detail}</small>
              {index < visualPath.length - 1 ? <i aria-hidden="true" /> : null}
            </div>
          ))}
        </div>
      </header>

      {takeaways.length ? (
        <section className={`academy-visual-takeaways ${isPractice ? 'is-practice' : ''}`} aria-label={isPractice ? 'Ba bước thực hành' : 'Ba ý cần mang theo'}>
          <div className="academy-section-kicker"><Lightbulb size={17} /><span><small>{isPractice ? 'LÀM THEO NHỊP' : '60 GIÂY NẮM LÕI'}</small><strong>{isPractice ? 'Ba bước để bắt đầu' : 'Ba ý cần mang theo'}</strong></span></div>
          <div>
            {takeaways.map((item, index) => (
              <article key={item}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <p>{item}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="academy-rich-lesson__body">
        <ReactMarkdown>{body}</ReactMarkdown>
      </div>

      {terms.length ? (
        <section className="academy-concept-strip" aria-label="Từ khóa của bài học">
          <div className="academy-section-kicker"><Brain size={17} /><span><small>TỪ KHÓA</small><strong>Chạm để tạo liên kết</strong></span></div>
          <dl>
            {terms.map((entry) => <div key={entry.id}><dt>{entry.term}</dt><dd>{entry.definition}</dd></div>)}
          </dl>
        </section>
      ) : null}
    </article>
  )
}

export function CoursePrimaryContent({
  courseId,
  lesson,
  canView,
  lockedMessage,
  onMediaProgress,
}: {
  courseId: string
  lesson: CourseLessonDraft
  canView: boolean
  lockedMessage: string
  onMediaProgress?: (percent: number) => void
}) {
  const runtimeLesson = lesson as RuntimeLesson
  const resources = (lesson.resources ?? []).map(runtimeResource)
  const primaryResource = resources.find((resource) => resource.id === runtimeLesson.primaryContent?.resourceId)
    ?? resources.find((resource) => resource.isPrimary)
    ?? resources.find((resource) => lesson.type === 'Video' ? resource.kind === 'video' : resource.kind !== 'video')
  const media = useResolvedMedia(courseId, lesson.id, primaryResource, canView && runtimeLesson.primaryContent?.kind !== 'rich-text')

  if (!canView) {
    return <div className="video-player locked"><div className="video-pattern"><i /><i /><i /></div><div className="video-copy"><strong>{lesson.title}</strong><small>{lockedMessage}</small></div><div className="video-play" aria-hidden="true"><LockKeyhole size={29} /></div></div>
  }

  if (runtimeLesson.primaryContent?.kind === 'rich-text' && runtimeLesson.primaryContent.body?.trim()) {
    return <AcademyRichLesson lesson={lesson} body={runtimeLesson.primaryContent.body} />
  }

  if (runtimeLesson.primaryContent?.kind === 'workout' || lesson.type === 'Buổi tập') {
    return <div className="video-player"><div className="video-pattern"><i /><i /><i /></div><div className="video-copy"><strong>{lesson.title}</strong><small>Nội dung kế thừa này cần được giảng viên chuyển đổi sang bài học Aura Academy.</small></div><div className="video-play" aria-hidden="true"><FileType size={29} /></div></div>
  }

  if (!primaryResource) {
    return <div className="video-player"><div className="video-pattern"><i /><i /><i /></div><div className="video-copy"><strong>{lesson.title}</strong><small>{lesson.type === 'Quiz' ? 'Hoàn thành bài kiểm tra bên dưới.' : 'Giảng viên chưa thêm media chính.'}</small></div><div className="video-play" aria-hidden="true">{lesson.type === 'Video' ? <Play size={29} fill="currentColor" /> : lesson.type === 'Quiz' ? <ListChecks size={29} /> : <FileType size={29} />}</div></div>
  }

  if (media.status === 'loading') return <div className="video-player"><MediaLoading /></div>
  if (media.status === 'error' || !media.url) {
    return <div className="video-player"><div className="lesson-media-status" role="alert"><AlertCircle size={16} /> {media.message ?? 'Media chưa sẵn sàng.'}<button className="outline-button small" onClick={media.retry}><RefreshCw size={13} /> Thử lại</button></div></div>
  }

  const videoEmbed = primaryResource.kind === 'video' ? trustedVideoEmbed(media.url) : null
  const slideEmbed = primaryResource.kind === 'slide' ? trustedSlideEmbed(media.url) : null
  const looksLikeVideo = media.contentType?.startsWith('video/') || /\.(mp4|webm|ogg)(?:$|\?)/i.test(media.url)
  const looksLikePdf = media.contentType === 'application/pdf' || /\.pdf(?:$|\?)/i.test(media.url)

  if (primaryResource.kind === 'video' && videoEmbed) {
    return <div className="video-player lesson-runtime-player"><iframe src={videoEmbed} title={primaryResource.title || lesson.title} allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /></div>
  }
  if (primaryResource.kind === 'video' && looksLikeVideo) {
    return <div className="video-player lesson-runtime-player"><video controls preload="metadata" src={media.url} onTimeUpdate={(event) => { const video = event.currentTarget; if (Number.isFinite(video.duration) && video.duration > 0) onMediaProgress?.(Math.round((video.currentTime / video.duration) * 100)) }}>Trình duyệt của bạn chưa hỗ trợ phát video.</video></div>
  }
  if (primaryResource.kind === 'slide' && slideEmbed) {
    return <div className="video-player lesson-runtime-player"><iframe src={slideEmbed} title={primaryResource.title || lesson.title} allowFullScreen sandbox="allow-scripts allow-same-origin allow-popups" referrerPolicy="no-referrer" /></div>
  }
  if (primaryResource.kind === 'document' && looksLikePdf) {
    return <div className="video-player lesson-runtime-player"><iframe src={media.url} title={primaryResource.title || lesson.title} sandbox="allow-same-origin" referrerPolicy="no-referrer" /></div>
  }

  return <div className="video-player"><div className="video-pattern"><i /><i /><i /></div><div className="video-copy"><strong>{primaryResource.title || lesson.title}</strong><small>Mở {resourceLabels[primaryResource.kind]} trong cửa sổ mới.</small></div><a className="video-play" href={media.url} target="_blank" rel="noopener noreferrer" aria-label={`Mở ${primaryResource.title || resourceLabels[primaryResource.kind]}`}><ExternalLink size={26} /></a></div>
}

export function CourseResourceItem({
  courseId,
  lessonId,
  resource,
  canAccess = true,
}: {
  courseId: string
  lessonId: string
  resource: LessonResourceDraft
  canAccess?: boolean
}) {
  const runtime = runtimeResource(resource)
  const media = useResolvedMedia(courseId, lessonId, runtime, canAccess)
  const Icon = runtime.kind === 'slide' ? FileSpreadsheet : runtime.kind === 'video' ? Play : FileType
  const content = <><span><Icon size={16} /></span><div><strong>{runtime.title || `Tài nguyên ${resourceLabels[runtime.kind]}`}</strong><small>{runtime.assetRef?.storagePath ? <><ShieldCheck size={12} /> Media bảo mật Aura</> : <><ExternalLink size={12} /> Liên kết ngoài</>}</small>{runtime.note ? <small>{runtime.note}</small> : null}</div></>

  if (!canAccess) return <div className="lesson-resource-item is-disabled" aria-disabled="true"><LockKeyhole size={16} /><div><strong>{runtime.title}</strong><small>Ghi danh để mở tài nguyên này.</small></div></div>
  if (media.status === 'loading') return <div className="lesson-resource-item is-disabled" role="status"><LoaderCircle className="spin" size={16} /><div><strong>{runtime.title}</strong><small>Đang tạo liên kết an toàn...</small></div></div>
  if (media.status !== 'ready' || !media.url) return <button type="button" className="lesson-resource-item is-disabled" onClick={media.retry} aria-label={`Thử tải lại ${runtime.title}`}>{content}<RefreshCw size={14} /></button>
  return <a href={media.url} className="lesson-resource-item" target="_blank" rel="noopener noreferrer">{content}</a>
}

export function CourseQuizRunner({
  courseId,
  lesson,
  canSubmit,
  demoMode,
  completed,
  onPassed,
}: {
  courseId: string
  lesson: CourseLessonDraft
  canSubmit: boolean
  demoMode: boolean
  completed: boolean
  onPassed: () => Promise<void>
}) {
  const runtimeLesson = lesson as RuntimeLesson
  const quiz = runtimeLesson.quiz
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'error'>('idle')
  const [result, setResult] = useState<QuizGradeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [localAttempts, setLocalAttempts] = useState(0)
  const questions = useMemo(() => {
    const items = [...(quiz?.questions ?? [])]
    if (quiz?.questionOrder !== 'shuffle') return items
    return items.sort((left, right) => stableOrderScore(`${lesson.id}:${left.id}`) - stableOrderScore(`${lesson.id}:${right.id}`))
  }, [lesson.id, quiz?.questionOrder, quiz?.questions])
  const configuredMaxAttempts = quiz?.publicSettings?.maxAttempts
  const maxAttempts = typeof configuredMaxAttempts === 'number' && configuredMaxAttempts > 0
    ? configuredMaxAttempts
    : undefined
  const attemptsExhausted = !result?.passed && (
    result?.attemptsRemaining === 0
    || (typeof maxAttempts === 'number' && localAttempts >= maxAttempts)
  )

  useEffect(() => {
    setAnswers({})
    setSubmitState('idle')
    setResult(null)
    setError(null)
    setLocalAttempts(0)
  }, [lesson.id])

  if (!quiz || questions.length === 0) {
    return <div className="lesson-empty-state"><AlertCircle size={28} /><h2>Quiz chưa sẵn sàng</h2><p>Giảng viên cần bổ sung câu hỏi trước khi bạn có thể làm bài.</p></div>
  }

  const submit = async () => {
    if (!canSubmit || submitState === 'submitting' || attemptsExhausted) return
    if (questions.some((question) => answers[question.id] === undefined)) {
      setError('Hãy chọn một đáp án cho tất cả câu hỏi trước khi nộp bài.')
      return
    }
    setSubmitState('submitting')
    setError(null)
    try {
      let grade: QuizGradeResult
      if (demoMode) {
        const hasLegacyKey = questions.every((question) => typeof question.correctIndex === 'number')
        if (!hasLegacyKey) throw new Error('Quiz demo chưa có khóa đáp án để chấm thử.')
        const correctCount = questions.filter((question) => answers[question.id] === question.correctIndex).length
        const percent = Math.round((correctCount / questions.length) * 100)
        grade = { correctCount, totalQuestions: questions.length, percent, passed: percent >= quiz.passPercent }
      } else {
        grade = await gradeCourseQuiz({ courseId, lessonId: lesson.id, answers })
      }
      setLocalAttempts((value) => value + 1)
      setResult(grade)
      if (grade.passed && !completed) await onPassed()
      setSubmitState('idle')
    } catch (caught) {
      setSubmitState('error')
      setError(caught instanceof Error ? caught.message : 'Không thể chấm bài lúc này. Vui lòng thử lại.')
    }
  }

  const retry = () => {
    setAnswers({})
    setResult(null)
    setError(null)
    setSubmitState('idle')
  }

  const retryCompletion = async () => {
    if (!result?.passed || completed || submitState === 'submitting') return
    setSubmitState('submitting')
    setError(null)
    try {
      await onPassed()
      setSubmitState('idle')
    } catch (caught) {
      setSubmitState('error')
      setError(caught instanceof Error ? caught.message : 'Không thể lưu tiến độ. Vui lòng thử lại.')
    }
  }

  return (
    <section className="quiz-outline course-quiz-runner" aria-labelledby={`quiz-${lesson.id}`}>
      <div className="quiz-overview"><span><ShieldCheck size={15} /> Đáp án được chấm bảo mật trên Aura</span><span>Điểm đạt: {quiz.passPercent}%</span>{maxAttempts ? <span>Tối đa: {maxAttempts} lần</span> : null}</div>
      <h2 id={`quiz-${lesson.id}`}>{lesson.title}</h2>
      {questions.map((question, questionIndex) => (
        <fieldset key={question.id} disabled={submitState === 'submitting' || Boolean(result)}>
          <legend>Câu {questionIndex + 1}. {question.question || `Câu hỏi ${questionIndex + 1}`}</legend>
          {question.options.map((option, optionIndex) => (
            <label key={`${question.id}-${optionIndex}`}>
              <input type="radio" name={`quiz-${lesson.id}-${question.id}`} checked={answers[question.id] === optionIndex} onChange={() => { setAnswers((current) => ({ ...current, [question.id]: optionIndex })); setError(null) }} />
              <span>{option || `Lựa chọn ${optionIndex + 1}`}</span>
            </label>
          ))}
        </fieldset>
      ))}
      {result ? <div className={`learning-action-error ${result.passed ? 'is-success' : ''}`} role="status" aria-live="polite">{result.passed ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}<strong>{result.passed ? 'Bạn đã đạt!' : 'Chưa đạt lần này'}</strong><span>{result.correctCount}/{result.totalQuestions} câu đúng · {result.percent}%</span>{result.attemptsRemaining !== undefined && result.attemptsRemaining !== null ? <small>Còn {result.attemptsRemaining} lượt làm.</small> : null}</div> : null}
      {error ? <div className="learning-action-error" role="alert">{error}</div> : null}
      {!canSubmit ? <p><LockKeyhole size={14} /> Hãy ghi danh và mở khóa bài học để nộp quiz.</p> : null}
      {result?.passed && error && !completed ? <button className="outline-button" type="button" onClick={() => void retryCompletion()} disabled={submitState === 'submitting'}><RefreshCw size={15} /> {submitState === 'submitting' ? 'Đang lưu tiến độ...' : 'Thử lưu tiến độ lại'}</button> : result && !result.passed && !attemptsExhausted ? <button className="outline-button" type="button" onClick={retry}><RefreshCw size={15} /> Làm lại quiz</button> : <button className="primary-button" type="button" onClick={submit} disabled={!canSubmit || submitState === 'submitting' || Boolean(result) || attemptsExhausted}>{submitState === 'submitting' ? <><LoaderCircle className="spin" size={16} /> Đang chấm bài...</> : completed || result?.passed ? <><CheckCircle2 size={16} /> Đã hoàn thành</> : 'Nộp bài kiểm tra'}</button>}
      {attemptsExhausted ? <p role="status">Bạn đã dùng hết số lượt làm quiz. Hãy liên hệ huấn luyện viên để được hỗ trợ.</p> : null}
    </section>
  )
}
