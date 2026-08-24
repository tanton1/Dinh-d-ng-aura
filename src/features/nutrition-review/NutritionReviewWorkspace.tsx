import { useCallback, useEffect, useMemo, useState } from 'react'
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
import './NutritionReviewWorkspace.css'

type StatusFilter = NutritionReviewStatus | 'all'

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

export function NutritionReviewWorkspace({
  compact = false,
  title = 'Duyệt bữa ăn học viên',
}: {
  compact?: boolean
  title?: string
}) {
  const [reviews, setReviews] = useState<NutritionMealReview[]>([])
  const [scope, setScope] = useState<'all' | 'assigned'>('assigned')
  const [assignmentCount, setAssignmentCount] = useState(0)
  const [availableCoaches, setAvailableCoaches] = useState<Array<{ id: string; name: string; positions: string[]; branchIds: string[] }>>([])
  const [hasMore, setHasMore] = useState(false)
  const [status, setStatus] = useState<StatusFilter>('pending')
  const [coachId, setCoachId] = useState('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [detailSlide, setDetailSlide] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await listNutritionMealReviews(status, 24)
      setReviews(result.reviews)
      setScope(result.scope)
      setAssignmentCount(result.assignmentCount)
      setAvailableCoaches(result.coaches || [])
      setHasMore(result.hasMore)
      setSelectedId((current) => result.reviews.some((item) => item.id === current) ? current : result.reviews[0]?.id || '')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải danh sách bữa ăn được phân công.')
      setReviews([])
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('vi')
    return reviews.filter((item) => {
      if (coachId === 'unassigned' && item.assignedCoachIds.length) return false
      if (coachId !== 'all' && coachId !== 'unassigned' && !item.assignedCoachIds.includes(coachId)) return false
      if (!normalized) return true
      return [item.studentName, item.note, item.mealType, item.assignedCoachName]
        .some((value) => value.toLocaleLowerCase('vi').includes(normalized))
    })
  }, [coachId, query, reviews])

  const selected = filtered.find((item) => item.id === selectedId) || filtered[0] || null
  useEffect(() => {
    if (!selected) return
    setFeedback(selected.coachFeedback || selected.analysis.coachFeedbackSuggestion || '')
    setDetailSlide(0)
  }, [selected?.id])

  const submit = async (action: 'approve' | 'reject' | 'feedback') => {
    if (!selected || submitting) return
    if (action !== 'reject' && feedback.trim().length < 3) {
      setError('Vui lòng nhập nhận xét từ 3 ký tự trước khi gửi.')
      setDetailSlide(2)
      return
    }
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
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể cập nhật bản duyệt.')
    } finally {
      setSubmitting(false)
    }
  }

  const counts = useMemo(() => ({
    pending: reviews.filter((item) => item.status === 'pending').length,
    high: reviews.filter((item) => item.priority === 'high').length,
    students: new Set(reviews.map((item) => item.userId)).size,
  }), [reviews])

  return <section className={`nrw-page ${compact ? 'is-compact' : ''}`}>
    <header className="nrw-hero">
      <div className="nrw-hero-copy">
        <p><Sparkles size={16} /> Aura Nutrition Coach</p>
        <h1>{title}</h1>
        <span>{scope === 'all' ? 'Toàn bộ học viên · lọc theo HLV chăm dinh dưỡng' : `${assignmentCount} học viên trong phạm vi chăm sóc của bạn`}</span>
      </div>
      <div className="nrw-hero-orb"><CheckCircle2 size={34} /></div>
      <div className="nrw-kpis" aria-label="Tổng quan duyệt món">
        <article><strong>{counts.pending}</strong><span>chờ duyệt</span></article>
        <article><strong>{counts.students}</strong><span>học viên</span></article>
        <article><strong>{counts.high}</strong><span>ưu tiên</span></article>
      </div>
    </header>

    <div className="nrw-toolbar">
      <div className="nrw-status-tabs" aria-label="Lọc trạng thái">
        {(['pending', 'approved', 'rejected', 'all'] as StatusFilter[]).map((item) => <button
          type="button"
          key={item}
          className={status === item ? 'is-active' : ''}
          onClick={() => setStatus(item)}
        >{item === 'all' ? 'Tất cả' : statusLabel(item)}</button>)}
      </div>
      <label className="nrw-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm học viên hoặc món ăn" /></label>
      {scope === 'all' && <select value={coachId} onChange={(event) => setCoachId(event.target.value)} aria-label="Lọc HLV chăm dinh dưỡng">
        <option value="all">Tất cả HLV dinh dưỡng</option>
        {availableCoaches.map((coach) => <option key={coach.id} value={coach.id}>{coach.name}</option>)}
        <option value="unassigned">Chưa phân HLV</option>
      </select>}
      <button type="button" className="nrw-refresh" onClick={() => void load()} disabled={loading} aria-label="Làm mới"><RefreshCw size={18} /></button>
    </div>

    {notice && <div className="nrw-message is-success" role="status"><CheckCircle2 size={18} />{notice}<button onClick={() => setNotice('')} aria-label="Đóng">×</button></div>}
    {error && <div className="nrw-message is-error" role="alert"><AlertCircle size={18} />{error}<button onClick={() => setError('')} aria-label="Đóng">×</button></div>}

    {loading ? <div className="nrw-empty"><RefreshCw className="is-spinning" /><strong>Đang đồng bộ bữa ăn…</strong><span>Chỉ tải dữ liệu thuộc phạm vi HLV đã được phân công.</span></div> : filtered.length === 0 ? <div className="nrw-empty"><CheckCircle2 /><strong>Không có bữa ăn trong bộ lọc này</strong><span>Hãy đổi trạng thái, HLV hoặc từ khóa tìm kiếm.</span></div> : <>
      <div className="nrw-review-carousel" aria-label="Danh sách bữa ăn dạng carousel">
        {filtered.map((item) => <button
          type="button"
          key={item.id}
          className={`nrw-review-card ${selected?.id === item.id ? 'is-selected' : ''}`}
          onClick={() => setSelectedId(item.id)}
        >
          <div className="nrw-card-image">{item.image ? <img src={item.image} alt="Bữa ăn học viên gửi" /> : <Sparkles size={30} />}</div>
          <div className="nrw-card-body">
            <span className={`nrw-state is-${item.status}`}>{statusLabel(item.status)}</span>
            <strong>{item.studentName}</strong>
            <small>{item.mealType} · {dateTime(item.createdAt)}</small>
            <p><Flame size={14} /> {Math.round(item.totalKcal)} kcal · {Math.round(item.totalProtein)}g đạm</p>
            <em><UserRound size={13} /> {item.assignedCoachName || 'Chưa phân HLV dinh dưỡng'}</em>
          </div>
        </button>)}
      </div>

      {selected && <article className="nrw-detail">
        <div className="nrw-detail-top">
          <div className="nrw-detail-identity"><small>HỒ SƠ DUYỆT · {selected.revision + 1}</small><h2>{selected.studentName}</h2><p>{selected.studentGoal || 'Chưa cập nhật mục tiêu dinh dưỡng'}</p>{scope === 'all' && <div className="nrw-assign-coach"><UsersRound size={15} /><span>HLV dinh dưỡng: {selected.assignedCoachName || 'Chưa phân công'}<small>Thiết lập tại Học viên PT Gym → Hợp đồng.</small></span></div>}</div>
          <div className="nrw-slide-control"><button onClick={() => setDetailSlide((value) => Math.max(0, value - 1))} disabled={detailSlide === 0} aria-label="Slide trước"><ChevronLeft /></button><span>{detailSlide + 1}/3</span><button onClick={() => setDetailSlide((value) => Math.min(2, value + 1))} disabled={detailSlide === 2} aria-label="Slide sau"><ChevronRight /></button></div>
        </div>
        <div className="nrw-detail-window">
          <div className="nrw-detail-track" style={{ transform: `translateX(-${detailSlide * 100}%)` }}>
            <section className="nrw-slide nrw-overview-slide">
              <div className="nrw-main-photo">{selected.image ? <img src={selected.image} alt="Bữa ăn đang duyệt" /> : <Sparkles size={44} />}</div>
              <div className="nrw-meal-summary"><span className={`nrw-state is-${selected.status}`}>{statusLabel(selected.status)}</span><h3>{selected.mealType}</h3><p>{selected.note || 'Học viên chưa thêm ghi chú cho bữa ăn.'}</p><div className="nrw-macro-row"><b>{Math.round(selected.totalKcal)}<small>kcal</small></b><b>{Math.round(selected.totalProtein)}<small>protein</small></b><b>{Math.round(selected.totalCarb)}<small>carb</small></b><b>{Math.round(selected.totalFat)}<small>fat</small></b></div></div>
            </section>
            <section className="nrw-slide nrw-analysis-slide">
              <div className="nrw-ai-title"><Sparkles /><div><small>AURA VISION</small><h3>Phân tích để HLV kiểm chứng</h3></div></div>
              <div className="nrw-analysis-grid">
                <article><strong>Mục tiêu</strong><p>{selected.analysis.goalAlignmentAssessment || selected.studentGoal || 'Chưa đủ dữ liệu mục tiêu.'}</p></article>
                <article><strong>Cân bằng macro</strong><p>{selected.analysis.macroBalanceAssessment || 'Chưa có đánh giá macro riêng.'}</p></article>
                <article><strong>Khẩu phần & chế biến</strong><p>{selected.analysis.quantityAndCookingAnalysis || selected.analysis.portionAndCalorieRationale || 'Chưa có mô tả chi tiết.'}</p></article>
                <article><strong>Gợi ý tối ưu</strong><p>{selected.analysis.calorieOptimizationTip || selected.analysis.aiSuggestion || 'HLV bổ sung nhận xét ở slide tiếp theo.'}</p></article>
              </div>
            </section>
            <section className="nrw-slide nrw-feedback-slide">
              <div className="nrw-feedback-head"><Send /><div><small>PHẢN HỒI CỦA HLV</small><h3>Ngắn gọn, rõ việc cần làm tiếp</h3></div></div>
              <div className="nrw-quick-feedback">{quickFeedback.map((item) => <button key={item} type="button" onClick={() => setFeedback(item)}>{item}</button>)}</div>
              <textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} maxLength={2000} placeholder="Nhận xét dành riêng cho học viên…" />
              <div className="nrw-actions">
                <button type="button" className="is-secondary" disabled={submitting} onClick={() => void submit('feedback')}><Send size={17} /> Gửi nhận xét</button>
                <button type="button" className="is-reject" disabled={submitting} onClick={() => void submit('reject')}><XCircle size={17} /> Cần chỉnh</button>
                <button type="button" className="is-primary" disabled={submitting} onClick={() => void submit('approve')}><CheckCircle2 size={17} /> Duyệt bữa ăn</button>
              </div>
            </section>
          </div>
        </div>
        <div className="nrw-dots" aria-label="Chọn slide chi tiết">{[0, 1, 2].map((value) => <button key={value} onClick={() => setDetailSlide(value)} className={detailSlide === value ? 'is-active' : ''} aria-label={`Slide ${value + 1}`} />)}</div>
      </article>}
      {hasMore && <p className="nrw-limit-note"><UsersRound size={16} /> Đang hiển thị 24 bản gần nhất. Dùng bộ lọc để thu hẹp danh sách.</p>}
    </>}
  </section>
}
