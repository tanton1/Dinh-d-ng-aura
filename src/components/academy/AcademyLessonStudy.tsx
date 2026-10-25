import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Brain,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  Layers3,
  Lightbulb,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import {
  academyMaterialForLesson,
  loadAcademyRecallAnswers,
  loadAcademyReviewState,
  loadAcademyReviewStateFromCloud,
  reviewAcademyCard,
  saveAcademyRecallAnswers,
  type AcademyReviewRating,
  type AcademyReviewState,
} from '../../services/academyLearningService'
import { getDueAcademyReviewCards } from '../../features/academy/reviewQueue'
import type { CourseLessonDraft } from '../../types'
import '../../styles-academy.css'

interface AcademyLessonStudyProps {
  ownerId: string
  courseId: string
  lesson: CourseLessonDraft
  reviewLessons?: CourseLessonDraft[]
  courseOutcomes?: string[]
  canReview: boolean
  onReviewStateChange?: (state: AcademyReviewState) => void
  loadReviewLessons?: (lessonIds: string[]) => Promise<CourseLessonDraft[]>
  reviewScopeKey?: string
}

const ratingCopy: Array<{ value: AcademyReviewRating; label: string; helper: string }> = [
  { value: 'again', label: 'Quên', helper: 'Ôn lại sau 10 phút' },
  { value: 'hard', label: 'Khó', helper: 'Lặp lại sớm' },
  { value: 'good', label: 'Đã nhớ', helper: 'Tăng khoảng ôn' },
  { value: 'easy', label: 'Rất dễ', helper: 'Giãn lịch ôn' },
]

export default function AcademyLessonStudy({ ownerId, courseId, lesson, reviewLessons = [], courseOutcomes = [], canReview, onReviewStateChange, loadReviewLessons, reviewScopeKey = '' }: AcademyLessonStudyProps) {
  const material = useMemo(() => academyMaterialForLesson(lesson, courseOutcomes), [courseOutcomes, lesson])
  const cards = useMemo(() => material.flashcards.filter((card) => card.front && card.back), [material.flashcards])
  const [revealedRecall, setRevealedRecall] = useState<Record<string, boolean>>({})
  const [recallDrafts, setRecallDrafts] = useState<Record<string, string>>({})
  const [activeCardIndex, setActiveCardIndex] = useState(0)
  const [cardFlipped, setCardFlipped] = useState(false)
  const [reviewQueueOpen, setReviewQueueOpen] = useState(false)
  const [queueCardFlipped, setQueueCardFlipped] = useState(false)
  const [reviewMessage, setReviewMessage] = useState('')
  const [reviewState, setReviewState] = useState(() => loadAcademyReviewState(ownerId, courseId))
  const [historyState, setHistoryState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [queueLoad, setQueueLoad] = useState<{ key: string; loading: boolean; complete: boolean; error: string; lessons: CourseLessonDraft[] }>({ key: '', loading: false, complete: false, error: '', lessons: [] })
  const queueScope = JSON.stringify([ownerId, courseId, lesson.contentVersion, reviewScopeKey])
  const currentScope = useRef<string | null>(queueScope)
  currentScope.current = queueScope
  useEffect(() => { currentScope.current = queueScope; return () => { currentScope.current = null } }, [queueScope])
  const queueReady = queueLoad.key === queueScope && queueLoad.complete
  const now = Date.now()
  const currentChapterCardsToReview = cards.filter((card) => {
    const progress = reviewState.cards[`${lesson.id}:${card.id}`]
    return !progress || progress.dueAt <= now
  })
  const courseReviewLessons = useMemo(() => [...new Map([
    ...(reviewLessons.length ? reviewLessons : [lesson]), ...(queueLoad.key === queueScope ? queueLoad.lessons : []),
  ].map((item) => [item.id, item])).values()], [reviewLessons, lesson, queueLoad.key, queueLoad.lessons, queueScope])
  const courseReviewSources = useMemo(() => courseReviewLessons.map((reviewLesson) => ({
    lessonId: reviewLesson.id,
    lessonTitle: reviewLesson.title,
    chapterLabel: reviewLesson.tags?.find((tag) => /^Chương\s+\d+$/i.test(tag)) ?? 'Bài học',
    cards: academyMaterialForLesson(reviewLesson).flashcards,
  })), [courseReviewLessons])
  const courseDueCards = useMemo(
    () => getDueAcademyReviewCards(courseReviewSources, reviewState, now),
    [courseReviewSources, now, reviewState],
  )
  const activeQueueCard = courseDueCards[0]
  const activeCard = cards[Math.min(activeCardIndex, Math.max(0, cards.length - 1))]
  const moveCard = (index: number) => {
    setActiveCardIndex(Math.max(0, Math.min(cards.length - 1, index)))
    setCardFlipped(false)
    setReviewMessage('')
  }

  useEffect(() => {
    setRevealedRecall({})
    setRecallDrafts(loadAcademyRecallAnswers(ownerId, courseId, lesson.id))
    setActiveCardIndex(0)
    setCardFlipped(false)
    setQueueCardFlipped(false)
    setReviewMessage('')
  }, [courseId, lesson.id, ownerId])

  useEffect(() => {
    setReviewState(loadAcademyReviewState(ownerId, courseId))
    if (!canReview) { setHistoryState('ready'); return }
    let active = true
    setHistoryState('loading')
    void loadAcademyReviewStateFromCloud(ownerId, courseId)
      .then((state) => {
        if (!active) return
        setReviewState(state)
        setHistoryState('ready')
        onReviewStateChange?.(state)
      })
      .catch(() => { if (active) setHistoryState('error') })
    return () => { active = false }
  }, [courseId, ownerId, canReview])

  const openReviewQueue = async () => {
    if (queueLoad.loading || !canReview) return
    if (reviewQueueOpen && queueReady) { setReviewQueueOpen(false); return }
    setReviewQueueOpen(true); setQueueCardFlipped(false)
    setQueueLoad({ key: queueScope, loading: true, complete: false, error: '', lessons: [] })
    try {
      const state = await loadAcademyReviewStateFromCloud(ownerId, courseId)
      if (currentScope.current !== queueScope) return
      setReviewState(state); setHistoryState('ready'); onReviewStateChange?.(state)
      const ids = [...new Set(Object.values(state.cards).filter((card) => card.reviewedAt > 0 && card.dueAt <= Date.now()).map((card) => card.lessonId))]
      const loaded = loadReviewLessons ? await loadReviewLessons(ids) : []
      if (currentScope.current !== queueScope) return
      setQueueLoad({ key: queueScope, loading: false, complete: true, error: '', lessons: loaded })
    } catch (error) {
      if (currentScope.current === queueScope) setQueueLoad({ key: queueScope, loading: false, complete: false,
        error: error instanceof Error ? error.message : 'Chưa tải đủ các chương cần ôn. Hãy thử lại.', lessons: [] })
    }
  }

  const reviewCard = (rating: AcademyReviewRating) => {
    if (!activeCard || !canReview) return
    const nextState = reviewAcademyCard({ ownerId, courseId, lessonId: lesson.id, cardId: activeCard.id, rating })
    setReviewState(nextState)
    onReviewStateChange?.(nextState)
    setReviewMessage(rating === 'again' ? 'Đã đưa thẻ vào lượt ôn gần nhất.' : 'Đã cập nhật lịch ôn cho thẻ này.')
    setCardFlipped(false)
    setActiveCardIndex((index) => cards.length ? (index + 1) % cards.length : 0)
  }

  const reviewQueuedCard = (rating: AcademyReviewRating) => {
    if (!activeQueueCard || !canReview) return
    const nextState = reviewAcademyCard({
      ownerId,
      courseId,
      lessonId: activeQueueCard.lessonId,
      cardId: activeQueueCard.id,
      rating,
    })
    setReviewState(nextState)
    onReviewStateChange?.(nextState)
    setReviewMessage(rating === 'again' ? 'Thẻ sẽ quay lại sau 10 phút.' : 'Đã cập nhật lịch ôn của thẻ.')
    setQueueCardFlipped(false)
  }

  const updateRecallDraft = (recallId: string, value: string) => {
    setRecallDrafts((current) => {
      const next = { ...current, [recallId]: value }
      saveAcademyRecallAnswers(ownerId, courseId, lesson.id, next)
      return next
    })
  }

  const hasConfiguredMaterial = Boolean(
    material.minuteSummary
      || material.keyTakeaways.length
      || material.terms.length
      || material.recallPrompts.length
      || cards.length,
  )

  if (!hasConfiguredMaterial) {
    return <div className="academy-empty"><Brain size={28} /><h2>Bộ ghi nhớ đang được biên soạn</h2><p>Giảng viên sẽ bổ sung tóm tắt, thuật ngữ và flashcard cho bài học này.</p></div>
  }

  return (
    <div className="academy-study">
      <div className="academy-study-hero">
        <div><span className="eyebrow">AURA ACADEMY · DEEP LEARNING</span><h2>Hiểu nhanh, nhớ sâu</h2><p>Chủ động nhớ lại trước khi xem đáp án giúp kiến thức dinh dưỡng bền vững hơn.</p></div>
        <div className="academy-review-stat"><Clock3 size={18} /><span><strong>{currentChapterCardsToReview.length}</strong><small>thẻ chương này</small></span></div>
      </div>

      <section className={`academy-review-queue${courseDueCards.length ? ' has-due' : ' is-clear'}`} aria-labelledby="academy-review-queue-title">
        <header>
          <div><CalendarClock size={19} /><span><small>ÔN CÁCH QUÃNG</small><h3 id="academy-review-queue-title">Hôm nay cần ôn</h3></span></div>
          {loadReviewLessons
            ? <button type="button" aria-expanded={reviewQueueOpen} disabled={!canReview || queueLoad.loading} onClick={() => void openReviewQueue()}>{queueLoad.loading ? 'Đang tải phần cần ôn…' : reviewQueueOpen && queueReady ? 'Thu gọn' : queueLoad.error ? 'Thử tải lại phần ôn' : 'Mở hàng đợi ôn'}</button>
            : courseDueCards.length
            ? <button type="button" aria-expanded={reviewQueueOpen} onClick={() => { setReviewQueueOpen((value) => !value); setQueueCardFlipped(false) }}>{reviewQueueOpen ? 'Thu gọn' : `Ôn ${courseDueCards.length} thẻ`}</button>
            : historyState === 'ready' ? <span className="academy-review-queue__clear"><CheckCircle2 size={15} /> Không có thẻ đến hạn</span> : null}
        </header>
        <p role="status">{queueLoad.loading ? 'Chỉ tải nội dung những chương có thẻ đã học đến hạn.'
          : historyState === 'loading' ? 'Đang tải lịch ôn của bạn…'
          : historyState === 'error' ? 'Chưa đồng bộ được lịch ôn. Các thẻ bên dưới chỉ dựa trên dữ liệu đã lưu trên thiết bị.'
          : loadReviewLessons && !queueReady ? 'Mở hàng đợi để tải các chương có thẻ đến hạn. Chưa tải không có nghĩa là không có thẻ cần ôn.'
          : courseDueCards.length
          ? `${courseDueCards.length} thẻ đã học đang đến hạn. Aura chỉ đưa kiến thức bạn từng xem vào hàng đợi này.`
          : 'Chưa có thẻ đã học nào đến hạn. Bạn có thể tiếp tục bộ thẻ của chương hiện tại.'}</p>
        {queueLoad.key === queueScope && queueLoad.error ? <p role="alert">{queueLoad.error}</p> : null}
        {reviewQueueOpen && activeQueueCard && (!loadReviewLessons || queueReady) ? (
          <div className="academy-review-queue__session">
            <div className="academy-review-queue__progress"><span>{activeQueueCard.chapterLabel} · {activeQueueCard.lessonTitle}</span><strong>{courseDueCards.length} thẻ còn lại</strong></div>
            <button className={`academy-flashcard academy-review-queue__card${queueCardFlipped ? ' is-flipped' : ''}`} type="button" onClick={() => setQueueCardFlipped((value) => !value)} aria-label={queueCardFlipped ? 'Ẩn đáp án thẻ đang ôn' : 'Mở đáp án thẻ đang ôn'}>
              <span>{queueCardFlipped ? 'ĐÁP ÁN' : 'CÂU HỎI'}</span>
              <strong>{queueCardFlipped ? activeQueueCard.back : activeQueueCard.front}</strong>
              {!queueCardFlipped && activeQueueCard.hint ? <small>Gợi ý: {activeQueueCard.hint}</small> : null}
              <em>{queueCardFlipped ? 'Tự đánh giá để Aura lên lịch lần ôn tiếp theo' : 'Chạm để lật thẻ'}</em>
            </button>
            {queueCardFlipped ? <div className="academy-rating-grid">{ratingCopy.map((rating) => <button key={rating.value} type="button" onClick={() => reviewQueuedCard(rating.value)} disabled={!canReview}><strong>{rating.label}</strong><small>{rating.helper}</small></button>)}</div> : null}
          </div>
        ) : null}
      </section>

      {material.minuteSummary ? (
        <section className="academy-minute-summary">
          <div><Sparkles size={18} /><span>60 GIÂY NẮM LÕI</span></div>
          <p>{material.minuteSummary}</p>
        </section>
      ) : null}

      {material.keyTakeaways.length ? (
        <section className="academy-study-section">
          <header><Lightbulb size={18} /><div><h3>Ý chính phải nhớ</h3><p>Tự diễn đạt lại từng ý bằng lời của bạn.</p></div></header>
          <div className="academy-takeaways">
            {material.keyTakeaways.map((takeaway, index) => <div key={`${takeaway}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><p>{takeaway}</p></div>)}
          </div>
        </section>
      ) : null}

      {material.terms.length ? (
        <section className="academy-study-section">
          <header><Layers3 size={18} /><div><h3>Thuật ngữ trọng tâm</h3><p>Từ điển nhanh dành riêng cho bài học.</p></div></header>
          <dl className="academy-terms">
            {material.terms.map((term) => <div key={term.id}><dt>{term.term}</dt><dd>{term.definition}</dd></div>)}
          </dl>
        </section>
      ) : null}

      {material.recallPrompts.length ? (
        <section className="academy-study-section">
          <header><Brain size={18} /><div><h3>Active Recall</h3><p>Viết câu trả lời từ trí nhớ rồi mới mở đáp án gợi ý.</p></div></header>
          <div className="academy-recall-list">
            {material.recallPrompts.map((recall, index) => (
              <article key={recall.id}>
                <span>CÂU TỰ NHỚ {index + 1}</span>
                <h4>{recall.prompt}</h4>
                <textarea aria-label={`Câu tự nhớ ${index + 1}`} maxLength={2000} value={recallDrafts[recall.id] ?? ''} onChange={(event) => updateRecallDraft(recall.id, event.target.value)} placeholder="Viết lại điều bạn nhớ, không cần hoàn hảo..." rows={3} />
                <button className="outline-button small" type="button" onClick={() => setRevealedRecall((current) => ({ ...current, [recall.id]: !current[recall.id] }))}><Eye size={14} /> {revealedRecall[recall.id] ? 'Ẩn đáp án gợi ý' : 'So sánh với đáp án'}</button>
                {revealedRecall[recall.id] ? <div className="academy-recall-answer"><CheckCircle2 size={16} /><p>{recall.answer}</p></div> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {cards.length && activeCard ? (
        <section className="academy-study-section academy-flashcard-section">
          <header><RefreshCw size={18} /><div><h3>Flashcard & lịch ôn</h3><p>Thẻ được lên lịch lại theo mức độ bạn ghi nhớ.</p></div><span>{activeCardIndex + 1}/{cards.length}</span></header>
          <nav className="academy-flashcard-navigation" aria-label="Chọn flashcard">
            <button type="button" disabled={activeCardIndex <= 0} onClick={() => moveCard(activeCardIndex - 1)} aria-label="Thẻ trước"><ChevronLeft size={18} /></button>
            <label><span>Thẻ</span><select aria-label="Chọn thẻ ghi nhớ" value={activeCardIndex} onChange={(event) => moveCard(Number(event.target.value))}>{cards.map((card, index) => <option key={card.id} value={index}>{index + 1}. {card.front}</option>)}</select></label>
            <button type="button" disabled={activeCardIndex >= cards.length - 1} onClick={() => moveCard(activeCardIndex + 1)} aria-label="Thẻ sau"><ChevronRight size={18} /></button>
          </nav>
          <p className="academy-review-hint">Xem trước/sau không thay đổi lịch ôn. Chỉ tự đánh giá sau khi đã thử nhớ câu trả lời.</p>
          <button className={`academy-flashcard ${cardFlipped ? 'is-flipped' : ''}`} type="button" onClick={() => setCardFlipped((value) => !value)} aria-label={cardFlipped ? 'Ẩn đáp án flashcard' : 'Mở đáp án flashcard'}>
            <span>{cardFlipped ? 'ĐÁP ÁN' : 'CÂU HỎI'}</span>
            <strong>{cardFlipped ? activeCard.back : activeCard.front}</strong>
            {!cardFlipped && activeCard.hint ? <small>Gợi ý: {activeCard.hint}</small> : null}
            <em>{cardFlipped ? 'Tự đánh giá mức độ ghi nhớ bên dưới' : 'Chạm để lật thẻ'}</em>
          </button>
          {cardFlipped ? (
            <div className="academy-rating-grid">
              {ratingCopy.map((rating) => <button key={rating.value} type="button" onClick={() => reviewCard(rating.value)} disabled={!canReview}><strong>{rating.label}</strong><small>{rating.helper}</small></button>)}
            </div>
          ) : null}
          {!canReview ? <p className="academy-review-hint">Ghi danh khóa học để lưu lịch ôn tập trên thiết bị này.</p> : null}
          {reviewMessage ? <p className="academy-review-success" role="status"><CheckCircle2 size={15} /> {reviewMessage}</p> : null}
        </section>
      ) : null}
    </div>
  )
}
