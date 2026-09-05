import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  BookOpen,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
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
import { getAuraNutritionChapter } from '../../data/auraNutritionCurriculum'
import { buildAuraNutritionLearningDesign } from '../../data/auraNutritionLearningDesign'
import { auraNutritionStudyGuides } from '../../data/auraNutritionStudyGuides'
import {
  loadAcademyReviewState,
  loadAcademyReviewStateFromCloud,
  loadAcademyWorkbook,
  loadAcademyWorkbookFromCloud,
  saveAcademyWorkbook,
  type AcademyReviewState,
  type AcademyWorkbookState,
} from '../../services/academyLearningService'
import type { AcademyLearningCardKind, CourseLessonDraft } from '../../types'
import AcademyFullChapterReader from './AcademyFullChapterReader'
import AcademyLessonStudy from './AcademyLessonStudy'

type StudioView = 'learn' | 'remember' | 'practice' | 'quiz' | 'reader'

type AcademyChapterLearningStudioProps = {
  chapter: number
  ownerId: string
  courseId: string
  coreLesson: CourseLessonDraft
  canStudy: boolean
  quizCompleted: boolean
  quizContent: ReactNode
}

const views: Array<{ id: StudioView; label: string; shortLabel: string; icon: typeof BookOpen }> = [
  { id: 'learn', label: 'Nắm lõi', shortLabel: 'Học', icon: Lightbulb },
  { id: 'remember', label: 'Ghi nhớ', shortLabel: 'Nhớ', icon: Brain },
  { id: 'practice', label: 'Thực hành', shortLabel: 'Làm', icon: ClipboardCheck },
  { id: 'quiz', label: 'Kiểm tra', shortLabel: 'Kiểm', icon: ListChecks },
  { id: 'reader', label: 'Toàn văn', shortLabel: 'Đọc', icon: BookOpen },
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
  canStudy,
  quizCompleted,
  quizContent,
}: AcademyChapterLearningStudioProps) {
  const source = getAuraNutritionChapter(chapter)
  const guide = auraNutritionStudyGuides[chapter]
  const design = useMemo(() => {
    if (coreLesson.learningDesign) return coreLesson.learningDesign
    return source && guide ? buildAuraNutritionLearningDesign(source, guide) : null
  }, [coreLesson.learningDesign, guide, source])
  const studyLesson = useMemo<CourseLessonDraft>(() => {
    if (!source || !design || (coreLesson.memory?.flashcards.length ?? 0) >= 6) return coreLesson
    return {
      ...coreLesson,
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
  }, [coreLesson, design, source])
  const [activeView, setActiveView] = useState<StudioView>(() => readInitialView(ownerId, chapter))
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({})
  const [workbook, setWorkbook] = useState<AcademyWorkbookState>(() => loadAcademyWorkbook(ownerId, courseId, coreLesson.id))
  const [workbookReady, setWorkbookReady] = useState(false)
  const [workbookSaved, setWorkbookSaved] = useState(true)
  const [reviews, setReviews] = useState<AcademyReviewState>(() => loadAcademyReviewState(ownerId, courseId))

  useEffect(() => {
    setActiveView(readInitialView(ownerId, chapter))
    setExpandedCards({})
  }, [chapter, ownerId])

  useEffect(() => {
    try { localStorage.setItem(studioStorageKey(ownerId, chapter), activeView) } catch { /* optional route memory */ }
  }, [activeView, chapter, ownerId])

  useEffect(() => {
    let active = true
    setWorkbook(loadAcademyWorkbook(ownerId, courseId, coreLesson.id))
    setWorkbookReady(false)
    void loadAcademyWorkbookFromCloud(ownerId, courseId, coreLesson.id)
      .then((remote) => { if (active) { setWorkbook(remote); setWorkbookReady(true) } })
      .catch(() => { if (active) setWorkbookReady(true) })
    setReviews(loadAcademyReviewState(ownerId, courseId))
    void loadAcademyReviewStateFromCloud(ownerId, courseId)
      .then((remote) => { if (active) setReviews(remote) })
      .catch(() => undefined)
    return () => { active = false }
  }, [coreLesson.id, courseId, ownerId])

  useEffect(() => {
    if (!workbookReady || !canStudy) return
    setWorkbookSaved(false)
    const timer = window.setTimeout(() => {
      saveAcademyWorkbook(ownerId, courseId, coreLesson.id, workbook)
      setWorkbookSaved(true)
    }, 550)
    return () => window.clearTimeout(timer)
  }, [canStudy, coreLesson.id, courseId, ownerId, workbook, workbookReady])

  if (!source || !guide || !design) {
    return <AcademyFullChapterReader chapter={chapter} ownerId={ownerId} />
  }

  const correctMicroChecks = design.microChecks.filter((check) => workbook.microCheckAnswers[check.id] === check.correctIndex).length
  const microCheckPercent = design.microChecks.length ? Math.round((correctMicroChecks / design.microChecks.length) * 100) : 0
  const reviewedCards = design.cards.filter((card) => reviews.cards[`${coreLesson.id}:${card.id}`]?.reviewedAt).length
  const memoryPercent = design.cards.length ? Math.round((reviewedCards / design.cards.length) * 100) : 0
  const practiceComplete = design.practice.fields.filter((field) => field.required).every((field) => {
    const value = field.id === 'reviewAt' ? workbook.reviewAt : workbook.answers[field.id]
    return String(value ?? '').trim().length > 0
  }) && workbook.safetyAcknowledged
  const mastery = [
    { label: 'Hiểu', value: microCheckPercent, done: microCheckPercent >= 80, view: 'learn' as StudioView },
    { label: 'Nhớ', value: memoryPercent, done: memoryPercent >= 70, view: 'remember' as StudioView },
    { label: 'Làm', value: quizCompleted ? 100 : 0, done: quizCompleted, view: 'quiz' as StudioView },
    { label: 'Dùng', value: practiceComplete ? 100 : 0, done: practiceComplete, view: 'practice' as StudioView },
  ]
  const masteredCount = mastery.filter((item) => item.done).length
  const nextStep = mastery.find((item) => !item.done)

  const updateWorkbook = (update: (current: AcademyWorkbookState) => AcademyWorkbookState) => {
    if (!canStudy) return
    setWorkbook(update)
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
          <p>{source.promise}</p>
        </div>
        <div className="academy-learning-studio__mastery-total"><strong>{masteredCount}/4</strong><span>năng lực đạt</span></div>
      </header>

      <div className="academy-mastery-strip" aria-label="Mức độ nắm vững chương">
        {mastery.map((item) => (
          <button key={item.label} type="button" className={item.done ? 'is-done' : ''} onClick={() => setActiveView(item.view)}>
            <span>{item.done ? <Check size={14} /> : `${item.value}%`}</span>
            <strong>{item.label}</strong>
          </button>
        ))}
        <div><small>BƯỚC TIẾP THEO</small><strong>{nextStep ? `${nextStep.label}: ${nextStep.value}%` : 'Đã nắm vững chương'}</strong></div>
      </div>

      <nav className="academy-learning-studio__tabs" aria-label="Các bước học trong chương">
        {views.map((view) => {
          const Icon = view.icon
          return <button key={view.id} type="button" className={activeView === view.id ? 'is-active' : ''} aria-current={activeView === view.id ? 'page' : undefined} onClick={() => setActiveView(view.id)}><Icon size={16} /><span>{view.label}</span><small>{view.shortLabel}</small></button>
        })}
      </nav>

      {activeView === 'learn' ? (
        <div className="academy-learning-studio__panel">
          <section className="academy-learning-warmup">
            <div><span>01 · KHỞI ĐỘNG</span><h3>{guide.bigQuestion}</h3><p>{guide.opening}</p></div>
            <fieldset disabled={!canStudy}>
              <legend>Mức tự tin trước khi học</legend>
              {[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" className={workbook.confidenceBefore === value ? 'is-selected' : ''} aria-pressed={workbook.confidenceBefore === value} onClick={() => updateWorkbook((current) => ({ ...current, confidenceBefore: value as 1 | 2 | 3 | 4 | 5 }))}>{value}</button>)}
              <small>1 · Chưa rõ &nbsp; 5 · Có thể giải thích</small>
            </fieldset>
          </section>

          <section className="academy-card-deck" aria-labelledby={`card-deck-${chapter}`}>
            <header><div><span>02 · NẮM LÕI</span><h3 id={`card-deck-${chapter}`}>{design.cards.length} thẻ kiến thức</h3><p>Mỗi thẻ giữ một ý. Mở phần “Vì sao” để kiểm tra cách bạn diễn giải.</p></div><strong>{Object.values(expandedCards).filter(Boolean).length}/{design.cards.length} đã mở</strong></header>
            <div>
              {design.cards.map((card, index) => {
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
                <fieldset key={check.id} disabled={!canStudy}>
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

      {activeView === 'remember' ? <div className="academy-learning-studio__panel"><AcademyLessonStudy ownerId={ownerId} courseId={courseId} lesson={studyLesson} canReview={canStudy} onReviewStateChange={setReviews} /></div> : null}

      {activeView === 'practice' ? (
        <div className="academy-learning-studio__panel">
          <section className="academy-practice-studio" aria-labelledby={`practice-${chapter}`}>
            <header><div><span>04 · ỨNG DỤNG</span><h3 id={`practice-${chapter}`}>{design.practice.title}</h3><p>{design.practice.outcome}</p></div><span className={workbookSaved ? 'is-saved' : ''}><Save size={14} />{workbookSaved ? 'Đã lưu' : 'Đang lưu…'}</span></header>
            <div className="academy-practice-studio__evidence">{design.practice.minimumEvidence.map((item) => <span key={item}><CheckCircle2 size={13} />{item}</span>)}</div>
            <div className="academy-practice-studio__fields">
              {design.practice.fields.map((field) => {
                const value = field.id === 'reviewAt' ? workbook.reviewAt : workbook.answers[field.id] ?? ''
                return (
                  <label key={field.id} className={field.kind === 'long' ? 'is-long' : ''}>
                    <span>{field.label}{field.required ? <b aria-label="Bắt buộc">*</b> : null}</span>
                    <small>{field.prompt}</small>
                    {field.kind === 'long'
                      ? <textarea rows={4} value={value} disabled={!canStudy} onChange={(event) => updateAnswer(field.id, event.target.value)} placeholder="Viết ngắn và dựa trên điều bạn quan sát được…" />
                      : <input type={field.kind === 'date' ? 'date' : 'text'} value={value} disabled={!canStudy} onChange={(event) => field.id === 'reviewAt' ? updateWorkbook((current) => ({ ...current, reviewAt: event.target.value })) : updateAnswer(field.id, event.target.value)} />}
                  </label>
                )
              })}
            </div>

            <section className="academy-practice-rubric">
              <header><div><span>RUBRIC TỰ SOI</span><h4>Đầu ra đã đủ dùng chưa?</h4></div><strong>{Object.values(workbook.rubric).reduce<number>((sum, score) => sum + score, 0)}/8</strong></header>
              <div>{Object.entries(rubricCopy).map(([key, copy]) => {
                const rubricKey = key as keyof AcademyWorkbookState['rubric']
                return <article key={key}><div><strong>{copy[0]}</strong><small>{copy[1]}</small></div><span>{[0, 1, 2].map((score) => <button key={score} type="button" className={workbook.rubric[rubricKey] === score ? 'is-selected' : ''} disabled={!canStudy} onClick={() => updateWorkbook((current) => ({ ...current, rubric: { ...current.rubric, [rubricKey]: score as 0 | 1 | 2 } }))}>{score}</button>)}</span></article>
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
          </section>
        </div>
      ) : null}

      {activeView === 'quiz' ? <div className="academy-learning-studio__panel academy-learning-studio__quiz">{quizContent}</div> : null}
      {activeView === 'reader' ? <div className="academy-learning-studio__panel is-reader"><AcademyFullChapterReader chapter={chapter} ownerId={ownerId} /></div> : null}
    </section>
  )
}
