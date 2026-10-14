import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Flame,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  UserRound,
  UsersRound,
  XCircle,
} from 'lucide-react'
import {
  listNutritionMealReviews,
  reviewNutritionMeal,
  type NutritionMealReview,
  type NutritionReviewStatus,
} from '../../services/nutritionReviewService'
import { detailSlideIndex, durationLabel, mealImageShape, type MealImageShape } from './nutritionReviewDisplay'
import './NutritionReviewWorkspace.css'

type StatusFilter = NutritionReviewStatus | 'all'

const emptySummary = {
  total: 0,
  pending: 0,
  approved: 0,
  rejected: 0,
  overdue: 0,
  highPriority: 0,
  students: 0,
}

const quickFeedback = [
  'Bữa ăn khá cân bằng. Em duy trì khẩu phần này và bổ sung thêm rau xanh nhé.',
  'Nguồn đạm tốt. Em giảm nhẹ phần tinh bột và ưu tiên cách chế biến ít dầu.',
  'Cần tăng thêm protein để sát mục tiêu hôm nay. Có thể thêm trứng, cá hoặc ức gà.',
]

function dateTime(value: number) {
  if (!value) return 'Chưa có thời gian'
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

function statusLabel(value: NutritionReviewStatus) {
  if (value === 'approved') return 'Đã duyệt'
  if (value === 'rejected') return 'Cần chỉnh'
  return 'Chờ duyệt'
}

function ReviewPhoto({ source, alt, kind }: { source: string; alt: string; kind: 'card' | 'detail' }) {
  const [failedSource, setFailedSource] = useState('')
  const [shape, setShape] = useState<MealImageShape>('square')
  const usable = Boolean(source) && failedSource !== source
  const displayedShape = kind === 'card' ? 'square' : shape
  const className = `${kind === 'card' ? 'nrw-card-image' : 'nrw-main-photo'} is-${displayedShape} ${usable ? '' : 'is-empty'}`
  return <div className={className}>
    {usable
      ? <img
        src={source}
        alt={alt}
        loading={kind === 'card' ? 'lazy' : 'eager'}
        decoding="async"
        onLoad={(event) => setShape(mealImageShape(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight))}
        onError={() => setFailedSource(source)}
      />
      : <span className="nrw-image-fallback"><Sparkles size={kind === 'card' ? 27 : 34} /><small>Không có ảnh gốc</small></span>}
  </div>
}

export function NutritionReviewWorkspace({
  compact = false,
  title = 'Duyệt bữa ăn học viên',
  initialQuery = '',
  initialFocus = null,
}: {
  compact?: boolean
  title?: string
  initialQuery?: string
  initialFocus?: string | null
}) {
  const [reviews, setReviews] = useState<NutritionMealReview[]>([])
  const [scope, setScope] = useState<'all' | 'assigned'>('assigned')
  const [availableCoaches, setAvailableCoaches] = useState<Array<{ id: string; name: string; positions: string[]; branchIds: string[] }>>([])
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [filteredCount, setFilteredCount] = useState(0)
  const [filteredCountExact, setFilteredCountExact] = useState(false)
  const [summary, setSummary] = useState(emptySummary)
  const [summaryTruncated, setSummaryTruncated] = useState(false)
  const [summaryCountsTruncated, setSummaryCountsTruncated] = useState(false)
  const [slaMinutes, setSlaMinutes] = useState(120)
  const [status, setStatus] = useState<StatusFilter>('pending')
  const [focus, setFocus] = useState<'overdue' | 'all'>(initialFocus === 'overdue' ? 'overdue' : 'all')
  const [coachId, setCoachId] = useState('all')
  const [query, setQuery] = useState(initialQuery)
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery.trim())
  const [selectedId, setSelectedId] = useState('')
  const [detailSlide, setDetailSlide] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [loadFailed, setLoadFailed] = useState(false)
  const [notice, setNotice] = useState('')
  const detailWindowRef = useRef<HTMLDivElement>(null)
  const detailScrollTimerRef = useRef<number | null>(null)
  const feedbackScrollTimerRef = useRef<number | null>(null)
  const feedbackTextareaRef = useRef<HTMLTextAreaElement>(null)
  const requestIdRef = useRef(0)
  const inFlightReadRef = useRef('')
  const submittingRef = useRef(false)
  const dataKeyRef = useRef('')

  useEffect(() => {
    setFocus(initialFocus === 'overdue' ? 'overdue' : 'all')
    if (initialFocus === 'overdue') setStatus('pending')
  }, [initialFocus])

  useEffect(() => {
    setQuery(initialQuery)
    setDebouncedQuery(initialQuery.trim())
  }, [initialQuery])

  useEffect(() => () => { requestIdRef.current += 1; inFlightReadRef.current = '' }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedQuery(query.trim()), 320)
    return () => window.clearTimeout(timeoutId)
  }, [query])

  const requestPage = useCallback(async (cursor: string | null, append: boolean, forceRefresh = false) => {
    const dataKey = JSON.stringify([coachId, debouncedQuery, focus, status])
    const readKey = JSON.stringify([dataKey, cursor, append])
    if (inFlightReadRef.current === readKey) return
    inFlightReadRef.current = readKey
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    if (append) setLoadingMore(true)
    else {
      setLoading(true)
      setLoadingMore(false)
      if (dataKeyRef.current !== dataKey) {
        setReviews([])
        setSelectedId('')
        setHasMore(false)
        setNextCursor(null)
      }
    }
    setError('')
    setLoadFailed(false)
    try {
      const result = await listNutritionMealReviews({
        status,
        limit: 30,
        cursor,
        coachId,
        query: debouncedQuery,
        focus,
        forceRefresh,
      })
      if (requestId !== requestIdRef.current) return
      dataKeyRef.current = dataKey
      setReviews((current) => append
        ? [...new Map([...current, ...result.reviews].map((item) => [item.id, item])).values()]
        : result.reviews)
      setScope(result.scope)
      setAvailableCoaches(result.coaches || [])
      setHasMore(result.hasMore)
      setNextCursor(result.nextCursor)
      setFilteredCount(result.filteredCount)
      setFilteredCountExact(result.filteredCountExact ?? (!debouncedQuery && coachId === 'all' && focus === 'all'))
      setSummary(result.summary || emptySummary)
      setSummaryTruncated(Boolean(result.summaryTruncated))
      setSummaryCountsTruncated(Boolean(result.summaryCountsTruncated))
      setSlaMinutes(result.slaMinutes || 120)
      setSelectedId((current) => append || result.reviews.some((item) => item.id === current) ? current : result.reviews[0]?.id || '')
    } catch (cause) {
      if (requestId !== requestIdRef.current) return
      setError(cause instanceof Error ? cause.message : 'Không thể tải danh sách bữa ăn được phân công.')
      setLoadFailed(true)
    } finally {
      if (requestId === requestIdRef.current) {
        inFlightReadRef.current = ''
        if (append) setLoadingMore(false)
        else setLoading(false)
      }
    }
  }, [coachId, debouncedQuery, focus, status])

  const load = useCallback(() => requestPage(null, false), [requestPage])
  const refresh = useCallback(() => requestPage(null, false, true), [requestPage])
  const loadRef = useRef(refresh)
  loadRef.current = refresh

  useEffect(() => { void load() }, [load])

  const filtered = focus === 'overdue' ? reviews.filter((item) => item.isOverdue) : reviews

  const selected = filtered.find((item) => item.id === selectedId) || filtered[0] || null
  const goToDetailSlide = useCallback((value: number, behavior: ScrollBehavior = 'smooth') => {
    const target = Math.min(2, Math.max(0, Math.trunc(value)))
    if (feedbackScrollTimerRef.current !== null) window.clearTimeout(feedbackScrollTimerRef.current)
    const scrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : behavior
    setDetailSlide(target)
    const viewport = detailWindowRef.current
    if (!viewport) return
    const overflowX = window.getComputedStyle(viewport).overflowX
    if (overflowX === 'auto' || overflowX === 'scroll') {
      viewport.scrollTo({ left: viewport.clientWidth * target, behavior: scrollBehavior })
    }
    // On touch widths the feedback slide lives below the review queue. Move
    // the document viewport with the horizontal slide so the primary input is
    // immediately usable instead of leaving the user at the page header.
    if (target === 2) {
      feedbackScrollTimerRef.current = window.setTimeout(() => {
        feedbackScrollTimerRef.current = null
        feedbackTextareaRef.current?.scrollIntoView({ behavior: scrollBehavior, block: 'center', inline: 'nearest' })
      }, scrollBehavior === 'smooth' ? 80 : 0)
    }
  }, [])

  const handleDetailScroll = useCallback(() => {
    const viewport = detailWindowRef.current
    if (!viewport) return
    if (detailScrollTimerRef.current !== null) {
      window.clearTimeout(detailScrollTimerRef.current)
    }
    detailScrollTimerRef.current = window.setTimeout(() => {
      detailScrollTimerRef.current = null
      const activeViewport = detailWindowRef.current
      if (!activeViewport || activeViewport.clientWidth <= 0) return
      const target = detailSlideIndex(activeViewport.scrollLeft, activeViewport.clientWidth)
      const targetLeft = activeViewport.clientWidth * target
      setDetailSlide(target)
      if (Math.abs(activeViewport.scrollLeft - targetLeft) > 1) {
        activeViewport.scrollTo({ left: targetLeft, behavior: 'smooth' })
      }
    }, 140)
  }, [])

  useEffect(() => () => {
    if (detailScrollTimerRef.current !== null) {
      window.clearTimeout(detailScrollTimerRef.current)
    }
    if (feedbackScrollTimerRef.current !== null) window.clearTimeout(feedbackScrollTimerRef.current)
  }, [])

  useEffect(() => {
    if (!selected) return
    if (feedbackScrollTimerRef.current !== null) {
      window.clearTimeout(feedbackScrollTimerRef.current)
      feedbackScrollTimerRef.current = null
    }
    if (detailScrollTimerRef.current !== null) {
      window.clearTimeout(detailScrollTimerRef.current)
      detailScrollTimerRef.current = null
    }
    setFeedback(selected.coachFeedback || selected.analysis.coachFeedbackSuggestion || '')
    setDetailSlide(0)
    detailWindowRef.current?.scrollTo({ left: 0, behavior: 'auto' })
  }, [selected?.id])

  useEffect(() => {
    const textarea = feedbackTextareaRef.current
    if (!textarea) return
    textarea.style.height = '0px'
    textarea.style.height = `${Math.max(150, textarea.scrollHeight + 2)}px`
  }, [feedback, selected?.id])

  useEffect(() => {
    const viewport = detailWindowRef.current
    if (!viewport) return
    const slides = viewport.querySelectorAll<HTMLElement>('.nrw-slide')
    const activeSlide = slides[detailSlide]
    if (!activeSlide) return
    const syncHeight = () => {
      const overflowX = window.getComputedStyle(viewport).overflowX
      viewport.style.height = overflowX === 'auto' || overflowX === 'scroll'
        ? `${activeSlide.scrollHeight}px`
        : ''
    }
    syncHeight()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(syncHeight) : null
    observer?.observe(activeSlide)
    window.addEventListener('resize', syncHeight)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', syncHeight)
    }
  }, [detailSlide, selected?.id])

  const submit = async (action: 'approve' | 'reject' | 'feedback') => {
    if (!selected || submittingRef.current || loading || loadingMore || loadFailed) return
    if (feedback.trim().length < 3) {
      setError('Vui lòng nhập nhận xét từ 3 ký tự trước khi gửi.')
      goToDetailSlide(2)
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    setError('')
    try {
      await reviewNutritionMeal({
        reviewId: selected.id,
        action,
        feedback: feedback.trim(),
        expectedRevision: selected.revision,
      })
      setNotice(action === 'approve' ? 'Đã duyệt và đồng bộ nhận xét vào nhật ký của học viên.' : action === 'reject' ? 'Đã chuyển bữa ăn sang trạng thái cần chỉnh.' : 'Đã gửi nhận xét cho học viên.')
      await loadRef.current()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể cập nhật bản duyệt.')
      // A timeout/conflict can mean the server already changed the revision.
      // Do not submit again against stale state before a successful refresh.
      setLoadFailed(true)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const statusCount = useMemo<Record<StatusFilter, number>>(() => ({
    pending: summary.pending,
    approved: summary.approved,
    rejected: summary.rejected,
    all: summary.total,
  }), [summary])

  return <section className={`nrw-page ${compact ? 'is-compact' : ''}`} aria-busy={loading || loadingMore || submitting}>
    <header className="nrw-hero">
      <div className="nrw-hero-copy">
        <p><Sparkles size={16} /> Aura Nutrition Coach</p>
        <h1>{title}</h1>
        <span>{scope === 'all' ? 'Toàn bộ học viên · lọc theo HLV chăm dinh dưỡng' : 'Bữa ăn trong phạm vi chăm sóc và bữa đang chờ đã giao cho bạn.'}</span>
      </div>
      <div className="nrw-hero-orb"><CheckCircle2 size={34} /></div>
      <div className="nrw-kpis" aria-label="Tổng quan duyệt món">
        <article><strong>{summaryCountsTruncated ? '≥ ' : ''}{summary.pending}</strong><span>chờ duyệt</span></article>
        <article className={summary.overdue ? 'is-alert' : ''}><strong>{summaryTruncated ? '≥ ' : ''}{summary.overdue}</strong><span>quá SLA {durationLabel(slaMinutes)}</span></article>
        <article><strong>{summary.approved}</strong><span>đã duyệt</span></article>
      </div>
    </header>

    <div className="nrw-toolbar">
      <div className="nrw-status-tabs" aria-label="Lọc trạng thái">
        {(['pending', 'approved', 'rejected', 'all'] as StatusFilter[]).map((item) => <button
          type="button"
          key={item}
          className={status === item ? 'is-active' : ''}
          aria-pressed={status === item}
          disabled={submitting}
          onClick={() => { setStatus(item); setFocus('all') }}
        >{item === 'all' ? 'Tất cả' : statusLabel(item)} <b>{summaryCountsTruncated && (item === 'pending' || item === 'all') ? '≥ ' : ''}{statusCount[item]}</b></button>)}
      </div>
      <button type="button" className={`nrw-focus-toggle ${focus === 'overdue' ? 'is-active' : ''}`} aria-pressed={focus === 'overdue'} disabled={submitting} onClick={() => { setStatus('pending'); setFocus((current) => current === 'overdue' ? 'all' : 'overdue') }}>
        Chỉ bữa quá hạn
      </button>
      <label className="nrw-search"><Search size={17} /><input value={query} disabled={submitting} onChange={(event) => setQuery(event.target.value)} aria-label="Tìm học viên hoặc món ăn" placeholder="Tìm học viên hoặc món ăn" /></label>
      {scope === 'all' && <select value={coachId} disabled={submitting} onChange={(event) => setCoachId(event.target.value)} aria-label="Lọc HLV chăm dinh dưỡng">
        <option value="all">Tất cả HLV dinh dưỡng</option>
        {availableCoaches.map((coach) => <option key={coach.id} value={coach.id}>{coach.name}</option>)}
        <option value="unassigned">Chưa phân HLV</option>
      </select>}
      <button type="button" className="nrw-refresh" onClick={() => void refresh()} disabled={loading || loadingMore || submitting} aria-label="Làm mới"><RefreshCw size={18} /></button>
    </div>

    {notice && <div className="nrw-message is-success" role="status"><CheckCircle2 size={18} />{notice}<button onClick={() => setNotice('')} aria-label="Đóng">×</button></div>}
    {error && <div className="nrw-message is-error" role="alert"><AlertCircle size={18} /><span>{error}</span><button className="nrw-retry" onClick={() => void refresh()} disabled={loading || submitting}>Tải lại</button><button onClick={() => setError('')} aria-label="Đóng">×</button></div>}
    {loading && filtered.length > 0 && <p className="nrw-sync-note" role="status">Đang làm mới danh sách…</p>}

    {loading && filtered.length === 0 ? <div className="nrw-empty"><RefreshCw className="is-spinning" /><strong>Đang đồng bộ bữa ăn…</strong><span>Chỉ tải dữ liệu thuộc phạm vi được cấp quyền.</span></div> : loadFailed && filtered.length === 0 ? <div className="nrw-empty"><AlertCircle /><strong>Chưa tải được danh sách bữa ăn</strong><span>Không phải hàng chờ trống. Bấm Tải lại ở thông báo phía trên.</span></div> : filtered.length === 0 ? <div className="nrw-empty"><CheckCircle2 /><strong>{hasMore ? 'Chưa có kết quả trong phần vừa tải' : 'Không có bữa ăn trong bộ lọc này'}</strong><span>{hasMore ? 'Vẫn còn bản ghi để tìm tiếp.' : 'Hãy đổi trạng thái, HLV hoặc từ khóa tìm kiếm.'}</span>{hasMore && nextCursor && <button type="button" onClick={() => void requestPage(nextCursor, true)} disabled={loadingMore}>{loadingMore ? 'Đang tải…' : 'Tìm tiếp trong lịch sử'}</button>}</div> : <>
      <div className="nrw-review-carousel" aria-label="Danh sách bữa ăn dạng carousel">
        {filtered.map((item) => <button
          type="button"
          key={item.id}
          className={`nrw-review-card ${selected?.id === item.id ? 'is-selected' : ''} ${item.isOverdue ? 'is-overdue' : ''}`}
          disabled={submitting}
          onClick={() => setSelectedId(item.id)}
        >
          <ReviewPhoto source={item.image} alt="Bữa ăn học viên gửi" kind="card" />
          <div className="nrw-card-body">
            <span className={`nrw-state is-${item.status}`}>{item.isOverdue ? `Trễ ${durationLabel(item.overdueMinutes)}` : statusLabel(item.status)}</span>
            <strong>{item.studentName}</strong>
            <small>{item.mealType} · {dateTime(item.createdAt)}</small>
            <p><Flame size={14} /> {Math.round(item.totalKcal)} kcal · {Math.round(item.totalProtein)}g đạm</p>
            <em><UserRound size={13} /> {item.assignedCoachName || 'Chưa phân HLV dinh dưỡng'}</em>
          </div>
        </button>)}
      </div>

      {selected && <article className="nrw-detail">
        <div className="nrw-detail-top">
          <div className="nrw-detail-identity"><small>HỒ SƠ DUYỆT · {selected.revision + 1}</small><h2>{selected.studentName}</h2><p>{selected.studentGoal || 'Chưa cập nhật mục tiêu dinh dưỡng'}</p>{scope === 'all' && <div className="nrw-assign-coach"><UsersRound size={15} /><span>HLV dinh dưỡng: {selected.assignedCoachName || 'Chưa phân công'}<small>Gán tại hồ sơ Học viên PT.</small></span></div>}</div>
          <div className="nrw-detail-navigation"><button type="button" className="nrw-feedback-link" onClick={() => goToDetailSlide(2)}>Viết nhận xét</button><div className="nrw-slide-control"><button onClick={() => goToDetailSlide(detailSlide - 1)} disabled={detailSlide === 0} aria-label="Slide trước"><ChevronLeft /></button><span>{detailSlide + 1}/3</span><button onClick={() => goToDetailSlide(detailSlide + 1)} disabled={detailSlide === 2} aria-label="Slide sau"><ChevronRight /></button></div></div>
        </div>
        <div className="nrw-detail-window" ref={detailWindowRef} onScroll={handleDetailScroll} aria-label="Chi tiết bữa ăn, vuốt ngang để chuyển slide">
          <div className={`nrw-detail-track is-slide-${detailSlide}`} style={{ transform: `translateX(-${detailSlide * 100}%)` }}>
            <section className="nrw-slide nrw-overview-slide">
              <ReviewPhoto source={selected.image} alt="Bữa ăn đang duyệt" kind="detail" />
              <div className="nrw-meal-summary"><span className={`nrw-state is-${selected.status}`}>{statusLabel(selected.status)}</span><h3>{selected.mealType}</h3><p>{selected.note || 'Học viên chưa thêm ghi chú cho bữa ăn.'}</p><div className="nrw-macro-row"><b>{Math.round(selected.totalKcal)}<small>kcal</small></b><b>{Math.round(selected.totalProtein)}<small>protein</small></b><b>{Math.round(selected.totalCarb)}<small>carb</small></b><b>{Math.round(selected.totalFat)}<small>fat</small></b></div></div>
            </section>
            <section className="nrw-slide nrw-analysis-slide">
              <div className="nrw-ai-title"><Sparkles /><div><small>AURA VISION</small><h3>Phân tích để HLV kiểm chứng</h3></div></div>
              <div className="nrw-analysis-grid">
                <article><strong>Mục tiêu</strong><p>{selected.analysis.goalAlignmentAssessment || selected.studentGoal || 'Chưa đủ dữ liệu mục tiêu.'}</p></article>
                <article><strong>Cân bằng macro</strong><p>{selected.analysis.macroBalanceAssessment || 'Chưa có đánh giá macro riêng.'}</p></article>
                <article><strong>Khẩu phần & chế biến</strong><p>{selected.analysis.quantityAndCookingAnalysis || selected.analysis.portionAndCalorieRationale || 'Chưa có mô tả chi tiết.'}</p></article>
                <article><strong>Gợi ý tối ưu</strong><p>{selected.analysis.calorieOptimizationTip || selected.analysis.aiSuggestion || 'HLV bổ sung nhận xét ở slide tiếp theo.'}</p></article>
                {selected.items.length > 0 && <article><strong>Thành phần AI nhận diện</strong><p>{selected.items.map((item) => `${item.name || 'Thành phần'} · ${Math.round(item.weight)}g · ${Math.round(item.kcal)} kcal`).join(' • ')}</p></article>}
                {selected.calorieRange && <article><strong>Khoảng năng lượng ước tính</strong><p>{Math.round(selected.calorieRange.low)}–{Math.round(selected.calorieRange.high)} kcal. Coach cần đối chiếu khẩu phần và cách chế biến trước khi duyệt.</p></article>}
                {selected.unresolvedQuestions.length > 0 && <article><strong>Câu hỏi còn thiếu dữ liệu</strong><p>{selected.unresolvedQuestions.join(' • ')}</p></article>}
              </div>
            </section>
            <section className="nrw-slide nrw-feedback-slide">
              <div className="nrw-feedback-head"><Send /><div><small>PHẢN HỒI CỦA HLV</small><h3>Ngắn gọn, rõ việc cần làm tiếp</h3></div></div>
              <div className="nrw-quick-feedback">{quickFeedback.map((item) => <button key={item} type="button" disabled={submitting} onClick={() => setFeedback(item)}>{item}</button>)}</div>
              <textarea ref={feedbackTextareaRef} rows={5} value={feedback} disabled={submitting} aria-label="Nhận xét dành riêng cho học viên" onChange={(event) => setFeedback(event.target.value)} maxLength={2000} placeholder="Nhận xét dành riêng cho học viên…" />
              <fieldset className="nrw-actions" disabled={submitting || loading || loadingMore || loadFailed}>
                <button type="button" className="is-secondary" disabled={submitting} onClick={() => void submit('feedback')}><Send size={17} /> Gửi nhận xét</button>
                <button type="button" className="is-reject" disabled={submitting} onClick={() => void submit('reject')}><XCircle size={17} /> Cần chỉnh</button>
                <button type="button" className="is-primary" disabled={submitting} onClick={() => void submit('approve')}><CheckCircle2 size={17} /> Duyệt bữa ăn</button>
              </fieldset>
            </section>
          </div>
        </div>
        <div className="nrw-dots" aria-label="Chọn slide chi tiết">{[0, 1, 2].map((value) => <button key={value} onClick={() => goToDetailSlide(value)} className={detailSlide === value ? 'is-active' : ''} aria-label={`Slide ${value + 1}`} />)}</div>
      </article>}
      <div className="nrw-pagination-note">
        <p className="nrw-limit-note"><UsersRound size={16} /> Đang hiển thị {filtered.length}{filteredCountExact ? `/${Math.max(filtered.length, filteredCount)}` : ''} bữa ăn{!filteredCountExact && hasMore ? ' · Còn dữ liệu để tìm tiếp' : ''}. {status === 'pending' ? 'Bữa chờ lâu nhất xếp trước.' : 'Lịch sử mới nhất xếp trước.'}</p>
        {hasMore && <button type="button" onClick={() => void requestPage(nextCursor, true)} disabled={loadingMore || !nextCursor}>{loadingMore ? 'Đang tải…' : 'Tải thêm bữa ăn'}</button>}
      </div>
      {summaryTruncated && <div className="nrw-message" role="status"><AlertCircle size={18} />{summaryCountsTruncated ? 'Các số có dấu ≥ là mức tối thiểu trong phần dữ liệu đã kiểm tra.' : 'Số bữa quá hạn là mức tối thiểu trong phần dữ liệu đã kiểm tra.'} Bấm Tải thêm để tiếp tục; dữ liệu chưa tải không bị xóa.</div>}
    </>}
  </section>
}
