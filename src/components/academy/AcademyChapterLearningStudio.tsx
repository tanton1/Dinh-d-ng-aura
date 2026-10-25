import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  BookOpen,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Compass,
  Layers3,
  Lightbulb,
  ListChecks,
  Save,
  ShieldAlert,
  Sparkles,
  Target,
} from 'lucide-react'
import { getAuraNutritionChapter } from '../../data/auraNutritionLearnerChapters'
import { buildAuraNutritionLearningDesign } from '../../data/auraNutritionLearningDesign'
import { auraNutritionStudyGuides } from '../../data/auraNutritionStudyGuides'
import { auraPracticeMode } from '../../data/auraNutritionPracticePolicy'
import { academyMastery } from '../../features/academy/mastery'
import { useAcademyWorkbook } from '../../features/academy/useAcademyWorkbook'
import { academyWorkbookSignature } from '../../features/academy/workbookPersistence'
import {
  loadAcademyReviewState,
  type AcademyReviewState,
  type AcademyWorkbookState,
} from '../../services/academyLearningService'
import type { AcademyLearningCardKind, AcademyPracticeCompletionEvidence, CourseLessonDraft } from '../../types'
import AcademyFullChapterReader from './AcademyFullChapterReader'
import AcademyLessonStudy from './AcademyLessonStudy'
import AcademySubmissionPanel from './AcademySubmissionPanel'
import AcademyWorkbookHistory from './AcademyWorkbookHistory'
import AcademyChapterArticle from './AcademyChapterArticle'

const AcademyPortfolioStudio = lazy(() => import('./AcademyPortfolioStudio'))

type StudioView = 'learn' | 'remember' | 'practice' | 'quiz'

type AcademyChapterLearningStudioProps = {
  chapter: number
  ownerId: string
  courseId: string
  coreLesson: CourseLessonDraft
  reviewLessons?: CourseLessonDraft[]
  portfolioLessons?: CourseLessonDraft[]
  onPrepareReview?: (lessonIds: string[]) => Promise<CourseLessonDraft[]>
  onPreparePortfolio?: (chapter: 5 | 10 | 15 | 20) => Promise<CourseLessonDraft[]>
  reviewScopeKey?: string
  canStudy: boolean
  quizCompleted: boolean
  quizPreviouslyCompleted?: boolean
  practiceCompleted?: boolean
  submittedPracticeRevision?: number
  practiceSubmissionRevisions?: Record<string, number>
  practiceSubmissionDefinitionVersions?: Record<string, number>
  practiceSubmissionDefinitionHashes?: Record<string, string>
  completedLessonIds?: string[]
  onSubmitPractice?: (evidence: AcademyPracticeCompletionEvidence) => Promise<void>
  demoMode?: boolean
  quizContent: ReactNode | ((onReviewCards: (ids: string[]) => void, cards: Array<{ id: string; title: string }>) => ReactNode)
}

const views: Array<{ id: StudioView; label: string; shortLabel: string; icon: typeof BookOpen }> = [
  { id: 'learn', label: 'Nắm lõi', shortLabel: 'Học', icon: Lightbulb },
  { id: 'remember', label: 'Ghi nhớ', shortLabel: 'Nhớ', icon: Brain },
  { id: 'practice', label: 'Thực hành', shortLabel: 'Làm', icon: ClipboardCheck },
  { id: 'quiz', label: 'Kiểm tra', shortLabel: 'Kiểm', icon: ListChecks },
]

const cardCopy: Record<AcademyLearningCardKind, { label: string; icon: typeof BookOpen }> = {
  core: { label: 'Nắm lõi', icon: Lightbulb },
  compare: { label: 'So sánh', icon: Layers3 },
  model: { label: 'Mô hình', icon: Compass },
  'vietnam-example': { label: 'Ví dụ Việt Nam', icon: Sparkles },
  myth: { label: 'Hiểu lầm', icon: ShieldAlert },
  decision: { label: 'Ra quyết định', icon: Target },
  safety: { label: 'Cổng an toàn', icon: ShieldAlert },
  reflection: { label: 'Tự soi', icon: Brain },
}

const rubricCopy = {
  data: ['Đủ dữ liệu', 'Có bối cảnh, thời gian và tín hiệu cần thiết.'],
  mechanism: ['Đúng cơ chế', 'Giải thích theo chương, không tự chẩn đoán.'],
  feasibility: ['Có thể làm', 'Hành động cụ thể và có phiên bản ngày bận.'],
  safety: ['An toàn', 'Có điều kiện dừng và đúng người cần hỏi.'],
} as const

const decisionCopy: Array<{ value: NonNullable<AcademyWorkbookState['decision']>; label: string }> = [
  { value: 'keep', label: 'Giữ' },
  { value: 'adjust', label: 'Chỉnh' },
  { value: 'stop', label: 'Dừng' },
  { value: 'refer', label: 'Hỏi chuyên môn' },
]

function academyStudyLesson(lesson: CourseLessonDraft): CourseLessonDraft {
  if (lesson.learningDesign?.practice.reviewRubric) return lesson
  const chapterTag = lesson.tags?.find((tag) => /^Chương\s+\d+$/i.test(tag))
  const chapter = Number(chapterTag?.match(/\d+/)?.[0])
  const source = Number.isInteger(chapter) ? getAuraNutritionChapter(chapter) : undefined
  const guide = Number.isInteger(chapter) ? auraNutritionStudyGuides[chapter] : undefined
  const design = auraPracticeMode(chapter) !== 'coordination' && lesson.learningDesign && lesson.learningDesign.cards.length >= 12
    ? lesson.learningDesign
    : source && guide ? buildAuraNutritionLearningDesign(source, guide) : null
  if (!source || !design || ((lesson.memory?.flashcards.length ?? 0) >= 12 && design.cards.length >= 12)) return lesson
  return {
    ...lesson,
    memory: {
      recap: source.promise,
      takeaways: [...source.takeaways],
      glossary: source.glossary.map(([term, definition], index) => ({ id: `${design.chapterId}-term-${index + 1}`, term, definition })),
      recallPrompts: [
        { id: `${design.chapterId}-recall-1`, prompt: `Hãy giải thích ý chính của “${source.title}” bằng lời của bạn.`, answer: source.takeaways.join(' ') },
        { id: `${design.chapterId}-recall-2`, prompt: 'Dữ liệu nào cần quan sát trước khi điều chỉnh?', answer: source.practiceSteps.join(' ') },
        { id: `${design.chapterId}-recall-3`, prompt: 'Khi nào cần dừng tự thử và hỏi chuyên môn?', answer: source.safety },
      ],
      flashcards: design.cards.map((card) => ({ id: card.id, front: card.title, back: [card.body, card.detail].filter(Boolean).join(' '), hint: cardCopy[card.kind].label })),
    },
  }
}

function studioStorageKey(ownerId: string, chapter: number) {
  return `aura:academy:chapter-studio:v1:${ownerId || 'guest'}:${chapter}`
}

function readInitialView(ownerId: string, chapter: number): StudioView {
  try {
    const value = localStorage.getItem(studioStorageKey(ownerId, chapter))
    return views.some((view) => view.id === value) ? value as StudioView : 'learn'
  } catch {
    return 'learn'
  }
}

export default function AcademyChapterLearningStudio({
  chapter,
  ownerId,
  courseId,
  coreLesson,
  reviewLessons = [],
  portfolioLessons,
  onPrepareReview,
  onPreparePortfolio,
  reviewScopeKey,
  canStudy,
  quizCompleted,
  quizPreviouslyCompleted = false,
  practiceCompleted = false,
  submittedPracticeRevision,
  practiceSubmissionRevisions,
  practiceSubmissionDefinitionVersions,
  practiceSubmissionDefinitionHashes,
  completedLessonIds,
  onSubmitPractice,
  demoMode = false,
  quizContent,
}: AcademyChapterLearningStudioProps) {
  const source = getAuraNutritionChapter(chapter)
  const guide = auraNutritionStudyGuides[chapter]
  const bespoke = Boolean(coreLesson.learningDesign?.practice.reviewRubric)
  const design = useMemo(() => {
    if (coreLesson.learningDesign?.practice.reviewRubric) return coreLesson.learningDesign
    if (auraPracticeMode(chapter) !== 'coordination' && coreLesson.learningDesign && coreLesson.learningDesign.cards.length >= 12) return coreLesson.learningDesign
    return source && guide ? buildAuraNutritionLearningDesign(source, guide) : null
  }, [chapter, coreLesson.learningDesign, guide, source])
  const portfolioMilestone = chapter === 5 || chapter === 10 || chapter === 15 || chapter === 20
  const studyLessons = useMemo(() => {
    const candidates = reviewLessons.length ? reviewLessons : [coreLesson]
    return candidates.map(academyStudyLesson)
  }, [coreLesson, reviewLessons])
  const studyLesson = useMemo(
    () => studyLessons.find((lesson) => lesson.id === coreLesson.id) ?? academyStudyLesson(coreLesson),
    [coreLesson, studyLessons],
  )
  const [activeView, setActiveView] = useState<StudioView>(() => readInitialView(ownerId, chapter))
  const [quizOpened, setQuizOpened] = useState(false)
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({})
  const [remediationIds, setRemediationIds] = useState<string[]>([])
  const cardsRef = useRef<HTMLElement>(null)
  const panelHeadingRef = useRef<HTMLHeadingElement>(null)
  const workbookController = useAcademyWorkbook(ownerId, courseId, coreLesson.id, canStudy, { definitionVersion: design?.practice.version, definitionHash: design?.practice.identityHash })
  const { workbook, ready: workbookReady, synced: workbookSaved, issue: workbookSyncIssue, change: changeDraft } = workbookController
  const [practiceSubmitting, setPracticeSubmitting] = useState(false)
  const [practiceError, setPracticeError] = useState<string | null>(null)
  const [localSubmittedRevision, setLocalSubmittedRevision] = useState<number | null>(null)
  const [localSubmittedSignature, setLocalSubmittedSignature] = useState<string | null>(null)
  const [localSubmittedDefinitionVersion, setLocalSubmittedDefinitionVersion] = useState<number | null>(null)
  const [localSubmittedDefinitionHash, setLocalSubmittedDefinitionHash] = useState<string | undefined>()
  const [changingDefinition, setChangingDefinition] = useState(false)
  const [reviews, setReviews] = useState<AcademyReviewState>(() => loadAcademyReviewState(ownerId, courseId))

  useEffect(() => { if (activeView === 'quiz') setQuizOpened(true) }, [activeView])
  useEffect(() => { setActiveView(readInitialView(ownerId, chapter)); setExpandedCards({}) }, [chapter, ownerId])
  useEffect(() => {
    try { localStorage.setItem(studioStorageKey(ownerId, chapter), activeView) } catch { /* optional route memory */ }
  }, [activeView, chapter, ownerId])
  useEffect(() => { setReviews(loadAcademyReviewState(ownerId, courseId)) }, [courseId, ownerId])
  if (!design || (!bespoke && (!source || !guide))) {
    return <AcademyFullChapterReader chapter={chapter} ownerId={ownerId} />
  }

  const learningProgress = academyMastery(design, workbook, reviews, coreLesson.id)
  const microCheckPercent = learningProgress.understandPercent
  const memoryPercent = learningProgress.memoryPercent
  const dueReviewCount = learningProgress.due
  const practiceComplete = learningProgress.practiceComplete
  const versionMismatch = workbook.definitionVersion !== design.practice.version
    || Boolean(design.practice.identityHash && workbook.definitionHash !== design.practice.identityHash)
  const hasHistoricalSubmission = practiceCompleted || localSubmittedRevision !== null
  const practiceId = coreLesson.id.replace('-core', '-practice')
  const practiceSubmitted = (practiceCompleted && (practiceSubmissionDefinitionVersions?.[practiceId] ?? 1) === design.practice.version
      && (!design.practice.identityHash || practiceSubmissionDefinitionHashes?.[practiceId] === design.practice.identityHash))
    || (localSubmittedRevision !== null && localSubmittedDefinitionVersion === design.practice.version
      && (!design.practice.identityHash || localSubmittedDefinitionHash === design.practice.identityHash))
  const latestSubmittedRevision = localSubmittedRevision ?? submittedPracticeRevision
  const currentPracticeSubmitted = practiceSubmitted && (demoMode
    ? localSubmittedSignature === academyWorkbookSignature(workbook)
    : !workbook.pendingSync && latestSubmittedRevision === workbook.cloudRevision)
  const mastery = [
    { label: 'Hiểu', value: microCheckPercent, done: microCheckPercent >= 80, view: 'learn' as StudioView },
    { label: 'Nhớ', value: memoryPercent, done: memoryPercent >= 70, view: 'remember' as StudioView },
    { label: 'Làm', value: quizCompleted ? 100 : 0, done: quizCompleted, view: 'quiz' as StudioView },
    { label: 'Dùng', value: practiceSubmitted ? 100 : Math.min(99, learningProgress.practicePercent), done: practiceSubmitted, view: 'practice' as StudioView },
  ]
  const masteredCount = mastery.filter((item) => item.done).length
  const nextStep = mastery.find((item) => !item.done)
  const journeyStatus = masteredCount === mastery.length
    ? 'Đã hoàn tất các bước'
    : dueReviewCount > 0
      ? 'Cần ôn'
      : mastery[0].done && mastery[1].done
        ? 'Sẵn sàng thực hành'
        : 'Đang học'
  const journeyStatusTone = journeyStatus === 'Đã hoàn tất các bước'
    ? 'mastered'
    : journeyStatus === 'Cần ôn'
      ? 'review'
      : journeyStatus === 'Sẵn sàng thực hành'
        ? 'ready'
        : 'learning'

  const updateWorkbook = (update: (current: AcademyWorkbookState) => AcademyWorkbookState) => {
    if (versionMismatch || changingDefinition) return
    changeDraft(update)
    setPracticeError(null)
  }
  const submitPractice = async () => {
    if (!practiceComplete || !onSubmitPractice || practiceSubmitting || !canStudy || versionMismatch) return
    setPracticeSubmitting(true)
    setPracticeError(null)
    try {
      const synchronized = demoMode ? workbook : await workbookController.flush()
      await onSubmitPractice({ workbookLessonId: coreLesson.id, workbookRevision: synchronized.cloudRevision })
      setLocalSubmittedRevision(synchronized.cloudRevision)
      setLocalSubmittedSignature(academyWorkbookSignature(synchronized))
      setLocalSubmittedDefinitionVersion(synchronized.definitionVersion)
      setLocalSubmittedDefinitionHash(synchronized.definitionHash)
    } catch (error) {
      setPracticeError(error instanceof Error ? error.message : 'Chưa nộp được bài. Bản nháp vẫn được giữ.')
    } finally {
      setPracticeSubmitting(false)
    }
  }

  const beginNewDefinition = async () => {
    if (changingDefinition || !versionMismatch) return
    setChangingDefinition(true); setPracticeError(null)
    try { await workbookController.beginDefinition(design.practice.version, demoMode) }
    catch (cause) { setPracticeError(cause instanceof Error ? cause.message : 'Chưa thể bắt đầu bản mới. Bản cũ vẫn được giữ.') }
    finally { setChangingDefinition(false) }
  }
  const reviewCards = (ids: string[]) => {
    const valid = ids.filter((id) => design.cards.some((card) => card.id === id))
    setRemediationIds(valid)
    setExpandedCards((current) => ({ ...current, ...Object.fromEntries(valid.map((id) => [id, true])) }))
    setActiveView('learn')
    window.requestAnimationFrame(() => { cardsRef.current?.scrollIntoView({ block: 'start' }); cardsRef.current?.focus({ preventScroll: true }) })
  }
  const moduleDescriptions: Record<StudioView, string> = {
    learn: `${design.cards.length} thẻ kiến thức · ${design.microChecks.length} câu tự kiểm. Đọc nguyên lý, xem tình huống và sửa cách hiểu.`,
    remember: `${learningProgress.remembered}/${design.cards.length} thẻ tự đánh giá đã nhớ · ${learningProgress.reviewed} thẻ đã ôn. Lật thẻ trước khi tự đánh giá.`,
    practice: `${learningProgress.practiceFilled}/${learningProgress.practiceTotal} mục bắt buộc đã điền. ${auraPracticeMode(chapter) === 'coordination' ? 'Chuẩn bị hồ sơ phối hợp; không tự thay đổi chế độ điều trị.' : 'Hoàn thiện đầu ra của chương và nộp để ghi nhận tiến độ.'}`,
    quiz: 'Bài kiểm tra được chấm trên Aura. Sau khi nộp, mở lại thẻ gợi ý để hiểu vì sao cần sửa.',
  }
  const updateAnswer = (fieldId: string, value: string) => updateWorkbook((current) => ({
    ...current,
    answers: { ...current.answers, [fieldId]: value.slice(0, 2000) },
  }))

  return (
    <section className="academy-learning-studio" aria-labelledby={`academy-learning-studio-${chapter}`}>
      <header className="academy-learning-studio__header">
        <div>
          <span>AURA LEARNING DESIGN · CHƯƠNG {chapter}</span>
          <h2 id={`academy-learning-studio-${chapter}`}>Hiểu · Nhớ · Làm · Dùng</h2>
          <p>{bespoke ? coreLesson.summary : source?.promise}</p>
        </div>
        <div className="academy-learning-studio__status"><span className={`is-${journeyStatusTone}`}>{journeyStatus}</span><div className="academy-learning-studio__mastery-total"><strong>{masteredCount}/4</strong><span>mốc học tập</span></div></div>
      </header>

      <div className="academy-mastery-strip" aria-label="Mức độ nắm vững chương">
        {mastery.map((item) => (
          <button key={item.label} type="button" className={item.done ? 'is-done' : ''} onClick={() => setActiveView(item.view)}>
            <span>{item.done ? <Check size={14} /> : `${item.value}%`}</span>
            <strong>{item.label}</strong>
          </button>
        ))}
        <div><small>BƯỚC TIẾP THEO</small>{nextStep ? <button type="button" onClick={() => { setActiveView(nextStep.view); window.requestAnimationFrame(() => panelHeadingRef.current?.focus()) }}>Tiếp tục {views.find((item) => item.id === nextStep.view)?.label.toLowerCase()} <ChevronRight size={15} /></button> : <strong>Đã hoàn tất 4 phần</strong>}</div>
      </div>

      <details className="academy-progress-help"><summary>Tiến độ này được tính thế nào?</summary><p>Hiểu: đúng từ 80% câu tự kiểm. Nhớ: tự đánh giá đã nhớ từ 70% thẻ. Làm: đạt checkpoint được chấm trên Aura. Dùng: đã nộp bài thực hành đủ mục bắt buộc và xác nhận an toàn. Điền đủ ô chưa phải là nộp bài; nộp bài không đồng nghĩa được coach đánh giá đạt hoặc có năng lực chuyên môn.</p></details>

      <nav className="academy-learning-studio__tabs" aria-label="Các bước học trong chương">
        {views.map((view) => {
          const Icon = view.icon
          return <button key={view.id} type="button" className={activeView === view.id ? 'is-active' : ''} aria-current={activeView === view.id ? 'page' : undefined} onClick={() => setActiveView(view.id)}><Icon size={16} /><span>{view.label}</span><small>{view.shortLabel}</small></button>
        })}
      </nav>
      <div className="academy-module-intro"><h3 ref={panelHeadingRef} tabIndex={-1}>{views.find((item) => item.id === activeView)?.label}</h3><p>{moduleDescriptions[activeView]}</p>{!workbookReady ? <small role="status">Đang tải bài thực hành đã lưu…</small> : null}</div>

      {activeView === 'learn' ? (
        <div className="academy-learning-studio__panel">
          {bespoke && coreLesson.primaryContent?.kind === 'rich-text' ? <AcademyChapterArticle lesson={coreLesson} /> : null}
          <section className="academy-learning-warmup">
            <div>{bespoke ? <><h3>Tự nhớ sau bài đọc</h3><p>Thử giải thích lại các ý chính trước khi mở thẻ và làm câu tự kiểm bên dưới.</p></> : <><span>01 · KHỞI ĐỘNG</span><h3>{guide?.bigQuestion}</h3><p>{guide?.opening}</p></>}</div>
            <fieldset disabled={!canStudy || !workbookReady}>
              <legend>Mức tự tin trước khi học</legend>
              {[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" className={workbook.confidenceBefore === value ? 'is-selected' : ''} aria-pressed={workbook.confidenceBefore === value} onClick={() => updateWorkbook((current) => ({ ...current, confidenceBefore: value as 1 | 2 | 3 | 4 | 5 }))}>{value}</button>)}
              <small>1 · Chưa rõ &nbsp; 5 · Có thể giải thích</small>
            </fieldset>
          </section>

          <section ref={cardsRef} tabIndex={-1} className="academy-card-deck" aria-labelledby={`card-deck-${chapter}`}>
            <header><div><span>02 · NẮM LÕI</span><h3 id={`card-deck-${chapter}`}>{design.cards.length} thẻ kiến thức</h3><p>Mỗi thẻ giữ một ý. Mở phần “Vì sao” để kiểm tra cách bạn diễn giải.</p></div><strong>{Object.values(expandedCards).filter(Boolean).length}/{design.cards.length} đã mở</strong></header>
            {remediationIds.length ? <p className="academy-remediation-notice" role="status">Đang xem {remediationIds.length} thẻ gợi ý từ checkpoint. <button type="button" onClick={() => setRemediationIds([])}>Xem tất cả thẻ</button></p> : null}
            <div>
              {design.cards.filter((card) => !remediationIds.length || remediationIds.includes(card.id)).map((card) => {
                const index = design.cards.findIndex((item) => item.id === card.id)
                const copy = cardCopy[card.kind]
                const Icon = copy.icon
                const expanded = Boolean(expandedCards[card.id])
                return (
                  <article key={card.id} className={`academy-learning-card is-${card.kind}${expanded ? ' is-expanded' : ''}`}>
                    <header><span><Icon size={15} />{copy.label}</span><b>{String(index + 1).padStart(2, '0')}</b></header>
                    <h4>{card.title}</h4>
                    <p>{card.body}</p>
                    {card.detail ? <div hidden={!expanded}>{card.detail}</div> : null}
                    {card.detail ? <button type="button" aria-expanded={expanded} onClick={() => setExpandedCards((current) => ({ ...current, [card.id]: !expanded }))}>{expanded ? 'Thu gọn' : 'Vì sao?'}<ChevronDown size={15} /></button> : null}
                  </article>
                )
              })}
            </div>
          </section>

          <section className="academy-micro-checks" aria-labelledby={`micro-check-${chapter}`}>
            <header><div><span>03 · MICRO-CHECK</span><h3 id={`micro-check-${chapter}`}>Sửa hiểu sai ngay</h3><p>Đạt từ 80% để hoàn thành năng lực Hiểu. Không giới hạn lượt.</p></div><strong>{microCheckPercent}%</strong></header>
            {design.microChecks.map((check, index) => {
              const selected = workbook.microCheckAnswers[check.id]
              const answered = Number.isInteger(selected)
              return (
                <fieldset key={check.id} disabled={!canStudy || !workbookReady}>
                  <legend>{index + 1}. {check.prompt}</legend>
                  {check.options.map((option, optionIndex) => (
                    <label key={`${check.id}-${optionIndex}`} className={answered && selected === optionIndex ? (optionIndex === check.correctIndex ? 'is-correct' : 'is-wrong') : ''}>
                      <input type="radio" name={check.id} checked={selected === optionIndex} onChange={() => updateWorkbook((current) => ({ ...current, microCheckAnswers: { ...current.microCheckAnswers, [check.id]: optionIndex } }))} />
                      <span>{option.label}</span>
                      {answered && selected === optionIndex ? <small>{option.feedback}</small> : null}
                    </label>
                  ))}
                </fieldset>
              )
            })}
          </section>
        </div>
      ) : null}

      {activeView === 'remember' ? <div className="academy-learning-studio__panel"><AcademyLessonStudy ownerId={ownerId} courseId={courseId} lesson={studyLesson} reviewLessons={studyLessons} canReview={canStudy} onReviewStateChange={setReviews}
        reviewScopeKey={reviewScopeKey} loadReviewLessons={onPrepareReview ? async (ids) => (await onPrepareReview(ids)).filter((lesson) => lesson.id.endsWith('-core')).map(academyStudyLesson) : undefined} /></div> : null}

      {activeView === 'practice' ? (
        <div className="academy-learning-studio__panel">
          {!design.practice.reviewRubric && guide?.deepDive?.challenge ? <section className="academy-challenge-card" aria-label={auraPracticeMode(chapter) === 'coordination' ? 'Bài tập phối hợp' : 'Thử nghiệm 7 ngày'}>
            <div className="academy-challenge-card__title"><ClipboardCheck size={20} /><div><small>{auraPracticeMode(chapter) === 'coordination' ? 'HỒ SƠ VÀ CÂU HỎI' : 'THỬ TRONG ĐỜI SỐNG'}</small><strong>{guide.deepDive.challenge.title}</strong></div><span>{guide.deepDive.challenge.days.filter((day) => workbook.challengeDone[`day-${day.day}`]).length}/{guide.deepDive.challenge.days.length}</span></div>
            <p className="academy-review-hint">{auraPracticeMode(chapter) === 'coordination' ? 'Ba bước chuẩn bị, không phải ba ngày thử chế độ ăn. Có thể dùng tình huống giả định; không cần chia sẻ dữ liệu sức khỏe riêng tư.' : 'Đánh dấu khi đã làm; không bắt buộc hoàn thành trong 7 ngày liên tiếp. Giữ điều kiện an toàn của chương.'}</p>
            <div className="academy-challenge-days">{guide.deepDive.challenge.days.map((day) => <label key={day.day} className={workbook.challengeDone[`day-${day.day}`] ? 'is-done' : ''}><input type="checkbox" disabled={!canStudy || !workbookReady} checked={Boolean(workbook.challengeDone[`day-${day.day}`])} onChange={(event) => updateWorkbook((current) => ({ ...current, challengeDone: { ...current.challengeDone, [`day-${day.day}`]: event.target.checked } }))} /><span><b>{auraPracticeMode(chapter) === 'coordination' ? 'Bước' : 'Ngày'} {day.day}</b>{day.task}<small>{day.reflection}</small></span></label>)}</div>
          </section> : null}
          {portfolioMilestone ? <Suspense fallback={<div className="academy-portfolio-loading" role="status">Đang chuẩn bị portfolio chặng…</div>}><AcademyPortfolioStudio
            chapter={chapter}
            ownerId={ownerId}
            courseId={courseId}
            lessons={portfolioLessons ?? studyLessons}
            onPreparePortfolio={onPreparePortfolio}
            definitionScopeKey={reviewScopeKey}
            currentLessonId={coreLesson.id}
            currentWorkbook={workbook}
            canStudy={canStudy && workbookReady}
            practiceSubmissionRevisions={practiceSubmissionRevisions}
            practiceSubmissionDefinitionVersions={practiceSubmissionDefinitionVersions}
            practiceSubmissionDefinitionHashes={practiceSubmissionDefinitionHashes}
            completedLessonIds={completedLessonIds}
          /></Suspense> : null}
          <section className="academy-practice-studio" aria-labelledby={`practice-${chapter}`}>
            <header><div><span>04 · ỨNG DỤNG</span><h3 id={`practice-${chapter}`}>{design.practice.title}</h3><p>{design.practice.outcome}</p></div><span className={workbookSaved ? 'is-saved' : workbookSyncIssue ? 'has-error' : ''}><Save size={14} />{workbookController.status}</span></header>
            {!workbookController.deviceSaved ? <p role="alert">Thiết bị chưa lưu được bản nháp. Giữ trang này mở cho tới khi đồng bộ hoặc sao chép nội dung ra ngoài.</p> : null}
            {versionMismatch ? <div className="academy-practice-version" role="status">
              <h4>Yêu cầu bài thực hành đã thay đổi</h4>
              <p>{workbook.definitionVersion !== design.practice.version ? `Bản nháp đang theo phiên bản ${workbook.definitionVersion}; bài hiện tại dùng phiên bản ${design.practice.version}. ` : 'Nội dung yêu cầu hoặc tiêu chí đánh giá đã được cập nhật. '}Câu trả lời và tự đánh giá cũ không tự chuyển sang yêu cầu mới.</p>
              <AcademyWorkbookHistory ownerId={ownerId} courseId={courseId} lessonId={coreLesson.id} draft={workbook} />
              <button type="button" className="outline-button" disabled={!canStudy || !workbookReady || changingDefinition || workbookController.saving || workbookSyncIssue === 'conflict'} onClick={() => void beginNewDefinition()}>{changingDefinition ? 'Đang giữ bản cũ…' : 'Giữ bản cũ và bắt đầu bản mới'}</button>
              <p>Bản chưa đồng bộ chỉ khôi phục trên thiết bị đã dùng. Bản Cloud được giữ riêng khi bản mới đồng bộ thành công.</p>
              {practiceError ? <p role="alert">{practiceError}</p> : null}
            </div> : <AcademyWorkbookHistory ownerId={ownerId} courseId={courseId} lessonId={coreLesson.id} archiveId={workbook.previousArchiveId} />}
            {workbookSyncIssue ? (
              <div className={`academy-practice-sync academy-practice-sync--${workbookSyncIssue}`} role="alert">
                <ShieldAlert size={18} />
                <div>
                  <strong>{workbookSyncIssue === 'conflict' ? 'Có bản mới từ thiết bị khác' : workbookSyncIssue === 'size' ? 'Bài quá dài để đồng bộ' : 'Chưa đồng bộ lên Cloud'}</strong>
                  <p>{workbookSyncIssue === 'conflict' ? 'Tải bản Cloud để tiếp tục; bản nháp hiện tại được giữ trong bản sao khôi phục trên thiết bị.' : workbookSyncIssue === 'size' ? 'Rút gọn câu trả lời trước khi thử lại. Hệ thống không cắt mất nội dung để đồng bộ.' : 'Kiểm tra kết nối và phiên đăng nhập rồi thử lại. Trạng thái lưu trên thiết bị được hiển thị riêng ở trên.'}</p>
                </div>
                <button type="button" onClick={() => workbookSyncIssue === 'conflict' || !workbook.pendingSync ? void workbookController.reload() : workbookController.retry()}>{workbookSyncIssue === 'conflict' ? 'Tải bản mới nhất' : 'Thử lại'}</button>
              </div>
            ) : null}
            {!versionMismatch ? <><div className="academy-practice-studio__evidence">{design.practice.minimumEvidence.map((item) => <span key={item}><CheckCircle2 size={13} />{item}</span>)}</div>
            <div className="academy-practice-studio__fields">
              {design.practice.fields.map((field) => {
                const value = field.id === 'reviewAt' ? workbook.reviewAt : workbook.answers[field.id] ?? ''
                return (
                  <label key={field.id} className={field.kind === 'long' ? 'is-long' : ''}>
                    <span>{field.label}{field.required ? <b aria-label="Bắt buộc">*</b> : null}</span>
                    <small>{field.prompt}</small>
                    {field.kind === 'long'
                      ? <textarea rows={4} value={value} disabled={!canStudy || !workbookReady} onChange={(event) => updateAnswer(field.id, event.target.value)} placeholder="Viết ngắn và dựa trên điều bạn quan sát được…" />
                      : <input type={field.kind === 'date' ? 'date' : 'text'} value={value} disabled={!canStudy || !workbookReady} onChange={(event) => field.id === 'reviewAt' ? updateWorkbook((current) => ({ ...current, reviewAt: event.target.value })) : updateAnswer(field.id, event.target.value)} />}
                  </label>
                )
              })}
            </div>

            <section className="academy-practice-rubric">
              <header><div><span>RUBRIC TỰ SOI</span><h4>Đầu ra đã đủ dùng chưa?</h4></div><strong>{Object.values(workbook.rubric).reduce<number>((sum, score) => sum + score, 0)}/8</strong></header>
              <div>{(design.practice.reviewRubric?.criteria ?? Object.entries(rubricCopy).map(([id, copy]) => ({ id: id as keyof AcademyWorkbookState['rubric'], label: copy[0], levels: ['Cần bổ sung.', 'Đã có một phần.', copy[1]] }))).map((criterion) => {
                const rubricKey = criterion.id
                return <article key={rubricKey}><div><strong>{criterion.label}</strong><small>{criterion.levels[workbook.rubric[rubricKey]]}</small>{design.practice.reviewRubric ? <details><summary>Xem các mức đánh giá</summary><ol start={0}>{criterion.levels.map((level) => <li key={level}>{level}</li>)}</ol></details> : null}</div><span>{[0, 1, 2].map((score) => <button key={score} type="button" aria-label={`${criterion.label}: ${score} — ${criterion.levels[score]}`} className={workbook.rubric[rubricKey] === score ? 'is-selected' : ''} disabled={!canStudy || !workbookReady} onClick={() => updateWorkbook((current) => ({ ...current, rubric: { ...current.rubric, [rubricKey]: score as 0 | 1 | 2 } }))}>{score}</button>)}</span></article>
              })}</div>
            </section>

            <section className="academy-practice-decision">
              <div><span>QUYẾT ĐỊNH SAU KHI RÀ</span><h4>Giữ · chỉnh · dừng · hỏi chuyên môn</h4><p>Chọn sau khi đã nhìn lại dữ liệu vào ngày rà. Không dùng lựa chọn này như chẩn đoán.</p></div>
              <div>{decisionCopy.map((item) => <button key={item.value} type="button" className={workbook.decision === item.value ? 'is-selected' : ''} disabled={!canStudy} onClick={() => updateWorkbook((current) => ({ ...current, decision: item.value }))}>{item.label}</button>)}</div>
            </section>

            <label className="academy-practice-safety">
              <input type="checkbox" checked={workbook.safetyAcknowledged} disabled={!canStudy} onChange={(event) => updateWorkbook((current) => ({ ...current, safetyAcknowledged: event.target.checked }))} />
              <span><strong>{design.safetyGate?.title}</strong><small>{design.safetyGate?.body}</small></span>
            </label>
            <label className="academy-practice-share">
              <input type="checkbox" checked={workbook.sharedWithCoach} disabled={!canStudy} onChange={(event) => updateWorkbook((current) => ({ ...current, sharedWithCoach: event.target.checked }))} />
              <span><strong>Chia sẻ bài thực hành với coach phụ trách</strong><small>Mặc định chỉ bạn xem được. Khi bật, chỉ coach đang được phân công mới có quyền đọc; bạn có thể tắt bất cứ lúc nào.</small></span>
            </label>
            <div className="academy-practice-submission">
              <div>
                <strong>{practiceSubmitted ? 'Đã ghi nhận bài nộp' : hasHistoricalSubmission ? 'Đã nộp phiên bản trước — bản mới chưa nộp' : practiceComplete ? 'Đã điền đủ — chưa nộp bài' : 'Bản nháp thực hành'}</strong>
                <p>{practiceSubmitted ? 'Tiến độ thực hành đã được ghi nhận. Đây chưa phải kết quả đánh giá của coach.' : 'Nộp bài để ghi nhận phần thực hành vào tiến độ khóa học. Câu trả lời cần đủ mục bắt buộc và xác nhận an toàn.'}</p>
                <small>Khi nộp, một bản riêng được giữ để đối chiếu; sửa nháp sau đó không thay đổi nội dung đã nộp.</small>
                {practiceSubmitted && !currentPracticeSubmitted ? <small>Bản nháp hiện tại có thể khác bản đã nộp; nộp lại để ghi nhận bản mới.</small> : null}
              </div>
              <button type="button" className="outline-button" disabled={!canStudy || !workbookReady || !practiceComplete || practiceSubmitting || currentPracticeSubmitted || !onSubmitPractice} onClick={() => void submitPractice()}>{practiceSubmitting ? 'Đang nộp…' : currentPracticeSubmitted ? 'Đã nộp bản này' : practiceSubmitted ? 'Nộp lại bài thực hành' : 'Nộp bài thực hành'}</button>
              {practiceError ? <p role="alert">{practiceError}</p> : null}
            </div>
            </> : null}
            <AcademySubmissionPanel key={`${ownerId}:${courseId}:${coreLesson.id}`} userId={ownerId} courseId={courseId}
              artifactId={coreLesson.id} currentWorkbookRevision={workbook.cloudRevision} pendingDraft={workbook.pendingSync}
              refreshKey={latestSubmittedRevision ?? 0} />
          </section>
        </div>
      ) : null}

      {activeView === 'quiz' || quizOpened ? <div hidden={activeView !== 'quiz'}><div className="academy-learning-studio__panel academy-learning-studio__quiz">
        {quizPreviouslyCompleted ? <p role="status">Đã lưu lần hoàn thành trước; chưa có xác nhận đạt checkpoint của phiên bản chương hiện tại. Lịch sử cũ vẫn được giữ.</p> : null}
        {typeof quizContent === 'function' ? quizContent(reviewCards, design.cards) : quizContent}
        {quizCompleted ? <fieldset className="academy-confidence-after" disabled={!canStudy || !workbookReady}><legend>Sau khi học, bạn tự tin giải thích ở mức nào?</legend><p>So với trước khi học: {workbook.confidenceBefore ?? 'chưa đánh giá'}/5. Tự tin không thay thế kết quả kiểm tra.</p><div>{[1, 2, 3, 4, 5].map((score) => <button key={score} type="button" aria-pressed={workbook.confidenceAfter === score} onClick={() => updateWorkbook((current) => ({ ...current, confidenceAfter: score as 1 | 2 | 3 | 4 | 5 }))}>{score}</button>)}</div></fieldset> : null}
      </div></div> : null}
    </section>
  )
}
