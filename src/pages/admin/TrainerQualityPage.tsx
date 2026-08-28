import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BarChart3, CheckCircle2, ChevronRight, Clock3, Filter, LoaderCircle, RefreshCw, Star, UserRoundCheck } from 'lucide-react'
import {
  listTrainerFeedbackAdmin,
  reviewTrainerFeedback,
  type SessionFeedbackAdminRow,
  type SessionFeedbackStatus,
  type TrainerFeedbackAdminResponse,
} from '../../services/sessionFeedbackService'
import './TrainerQualityPage.css'

const STATUS_LABELS: Record<SessionFeedbackStatus, string> = {
  submitted: 'Đã ghi nhận',
  needs_review: 'Cần xử lý',
  reviewing: 'Đang xử lý',
  resolved: 'Đã hoàn tất',
}
const TAG_LABELS: Record<string, string> = {
  trainer_on_time: 'PT đúng giờ', clear_guidance: 'Hướng dẫn dễ hiểu', good_technique_correction: 'Sửa kỹ thuật tốt', motivating: 'Tạo động lực', appropriate_intensity: 'Cường độ phù hợp', caring: 'Quan tâm học viên', workout_not_suitable: 'Bài tập chưa phù hợp', trainer_late: 'PT đến trễ', limited_guidance: 'Ít hướng dẫn', poor_attitude: 'Thái độ chưa tốt',
}

function dateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(value.length === 10 ? `${value}T00:00:00+07:00` : value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: value.length > 10 ? '2-digit' : undefined, minute: value.length > 10 ? '2-digit' : undefined }).format(date)
}

function demoData(): TrainerFeedbackAdminResponse {
  const today = new Date()
  const day = dateKey(today)
  const rows: SessionFeedbackAdminRow[] = [
    { id: 'feedback-1', sessionId: 'session-1', studentId: 'student-1', studentName: 'Nguyễn Minh Anh', trainerId: 'trainer-1', trainerName: 'PT Minh', branchId: 'branch-1', branchName: 'Cơ sở 1', sessionDate: day, sessionHour: 8, overallScore: 2, tags: ['trainer_late', 'limited_guidance'], comment: 'PT đến trễ và phần sửa kỹ thuật còn ít.', anonymousToTrainer: false, issueCategory: 'lateness', status: 'needs_review', submittedAt: today.toISOString(), reviewedAt: null, reviewedBy: '', resolutionNote: '' },
    { id: 'feedback-2', sessionId: 'session-2', studentId: 'student-2', studentName: 'Trần Thu Hà', trainerId: 'trainer-2', trainerName: 'PT Mai', branchId: 'branch-1', branchName: 'Cơ sở 1', sessionDate: day, sessionHour: 18, overallScore: 5, tags: ['clear_guidance', 'motivating'], comment: 'Buổi tập rất tốt và dễ hiểu.', anonymousToTrainer: true, issueCategory: 'none', status: 'submitted', submittedAt: today.toISOString(), reviewedAt: null, reviewedBy: '', resolutionNote: '' },
    { id: 'feedback-3', sessionId: 'session-3', studentId: 'student-3', studentName: 'Lê Ngọc Lan', trainerId: 'trainer-1', trainerName: 'PT Minh', branchId: 'branch-2', branchName: 'Cơ sở 2', sessionDate: day, sessionHour: 19, overallScore: 4, tags: ['appropriate_intensity', 'caring'], comment: '', anonymousToTrainer: false, issueCategory: 'none', status: 'resolved', submittedAt: today.toISOString(), reviewedAt: today.toISOString(), reviewedBy: 'demo-admin', resolutionNote: 'Đã ghi nhận và phản hồi PT.' },
  ]
  return { schemaVersion: 1, truncated: false, attendanceTruncated: false, trainers: [{ id: 'trainer-1', name: 'PT Minh' }, { id: 'trainer-2', name: 'PT Mai' }], branches: [{ id: 'branch-1', name: 'Cơ sở 1' }, { id: 'branch-2', name: 'Cơ sở 2' }], rows, summary: { total: 3, averageScore: 3.7, lowCount: 1, needsReview: 1, responseRate: 60, eligibleAttendanceCount: 5, byTrainer: [{ trainerId: 'trainer-1', trainerName: 'PT Minh', total: 2, scoreTotal: 6, averageScore: 3, lowCount: 1, needsReview: 1 }, { trainerId: 'trainer-2', trainerName: 'PT Mai', total: 1, scoreTotal: 5, averageScore: 5, lowCount: 0, needsReview: 0 }] } }
}

export default function TrainerQualityPage({ isDemo = false }: { isDemo?: boolean }) {
  const now = useMemo(() => new Date(), [])
  const monthStart = useMemo(() => new Date(now.getFullYear(), now.getMonth(), 1), [now])
  const [from, setFrom] = useState(dateKey(monthStart))
  const [to, setTo] = useState(dateKey(now))
  const [trainerId, setTrainerId] = useState('')
  const [branchId, setBranchId] = useState('')
  const [status, setStatus] = useState<SessionFeedbackStatus | ''>('')
  const [score, setScore] = useState(0)
  const [data, setData] = useState<TrainerFeedbackAdminResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [action, setAction] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      setData(isDemo ? demoData() : await listTrainerFeedbackAdmin({ from, to, trainerId, branchId, status, score: score || undefined }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Chưa thể tải dữ liệu chất lượng PT.')
    } finally { setLoading(false) }
  }, [branchId, from, isDemo, score, status, to, trainerId])
  useEffect(() => { void load() }, [load])

  const rows = useMemo(() => [...(data?.rows ?? [])].sort((left, right) => {
    const rank = (item: SessionFeedbackAdminRow) => item.status === 'needs_review' ? 0 : item.status === 'reviewing' ? 1 : item.status === 'submitted' ? 2 : 3
    return rank(left) - rank(right) || String(right.submittedAt || '').localeCompare(String(left.submittedAt || ''))
  }), [data?.rows])
  const selected = rows.find((item) => item.id === selectedId) ?? null
  const distribution = [5, 4, 3, 2, 1].map((value) => ({ value, count: rows.filter((item) => item.overallScore === value).length }))
  const maximumDistribution = Math.max(1, ...distribution.map((item) => item.count))

  const setPreset = (days: number) => {
    const start = new Date(now)
    start.setDate(start.getDate() - days + 1)
    setFrom(dateKey(start)); setTo(dateKey(now))
  }
  const runAction = async (feedbackId: string, nextAction: 'mark_reviewing' | 'resolve' | 'reopen') => {
    setAction(`${feedbackId}:${nextAction}`); setError('')
    try {
      if (!isDemo) await reviewTrainerFeedback({ feedbackId, action: nextAction, note })
      setNote(''); setSelectedId(null); await load()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Chưa thể cập nhật phản hồi.') }
    finally { setAction('') }
  }

  return <main className="trainer-quality-page">
    <section className="trainer-quality-metrics" aria-label="Tổng hợp chất lượng PT">
      <article className="is-primary"><small>ĐIỂM TRUNG BÌNH</small><strong>{data?.summary.averageScore.toFixed(1) ?? '0.0'}<Star fill="currentColor" /></strong><span>{data?.summary.total ?? 0} lượt đánh giá trong kỳ</span></article>
      <article><small>TỶ LỆ PHẢN HỒI</small><strong>{data?.summary.responseRate ?? 0}%</strong><span>{data?.summary.total ?? 0}/{data?.summary.eligibleAttendanceCount ?? 0} buổi có tập</span></article>
      <article className={(data?.summary.lowCount ?? 0) > 0 ? 'is-warning' : ''}><small>ĐÁNH GIÁ 1–2 ĐIỂM</small><strong>{data?.summary.lowCount ?? 0}</strong><span>Cần xem lại trải nghiệm học viên</span></article>
      <article className={(data?.summary.needsReview ?? 0) > 0 ? 'is-critical' : ''}><small>CHƯA XỬ LÝ</small><strong>{data?.summary.needsReview ?? 0}</strong><span>Phản hồi đang chờ quản lý</span></article>
    </section>

    <section className="trainer-quality-toolbar" aria-label="Bộ lọc đánh giá PT">
      <div className="trainer-quality-presets"><button type="button" onClick={() => setPreset(7)}>7 ngày</button><button type="button" onClick={() => setPreset(30)}>30 ngày</button><button type="button" onClick={() => { setFrom(dateKey(monthStart)); setTo(dateKey(now)) }}>Tháng này</button></div>
      <label><span>Từ ngày</span><input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
      <label><span>Đến ngày</span><input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
      <label><span>PT</span><select value={trainerId} onChange={(event) => setTrainerId(event.target.value)}><option value="">Tất cả PT</option>{data?.trainers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><span>Trạng thái</span><select value={status} onChange={(event) => setStatus(event.target.value as SessionFeedbackStatus | '')}><option value="">Mọi trạng thái</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button type="button" className="trainer-quality-refresh" onClick={() => void load()}><RefreshCw /> Tải lại</button>
    </section>

    {error && <div className="trainer-quality-state is-error" role="alert"><AlertTriangle /> {error}</div>}
    {loading && <div className="trainer-quality-state" role="status"><LoaderCircle className="spin" /> Đang tải phản hồi học viên…</div>}
    {!loading && data && <>
      <section className="trainer-quality-analysis">
        <article className="trainer-quality-chart"><header><span><BarChart3 /></span><div><small>PHÂN BỐ ĐIỂM</small><h2>Mức độ hài lòng</h2></div></header><div>{distribution.map((item) => <span key={item.value}><b>{item.value}<Star fill="currentColor" /></b><i><em style={{ width: `${item.count / maximumDistribution * 100}%` }} /></i><strong>{item.count}</strong></span>)}</div></article>
        <article className="trainer-quality-ranking"><header><span><UserRoundCheck /></span><div><small>THEO HUẤN LUYỆN VIÊN</small><h2>Chất lượng PT</h2></div></header><div>{data.summary.byTrainer.map((item) => <button type="button" key={item.trainerId} onClick={() => setTrainerId(item.trainerId)}><span><strong>{item.trainerName}</strong><small>{item.total} đánh giá · {item.lowCount} điểm thấp</small></span><b>{item.averageScore.toFixed(1)}<Star fill="currentColor" /></b><ChevronRight /></button>)}{!data.summary.byTrainer.length && <p>Chưa có dữ liệu PT trong kỳ.</p>}</div></article>
      </section>

      <section className="trainer-quality-list"><header><div><small>HÀNG CHỜ QUẢN LÝ</small><h2>{rows.length} phản hồi</h2></div><button type="button" onClick={() => setStatus(status === 'needs_review' ? '' : 'needs_review')}><Filter /> {status === 'needs_review' ? 'Bỏ lọc' : 'Chỉ cần xử lý'}</button></header>
        <div>{rows.map((row) => <article className={`is-${row.status}${row.overallScore <= 2 ? ' is-low' : ''}`} key={row.id}>
          <button type="button" className="trainer-quality-row" aria-expanded={selectedId === row.id} onClick={() => { setSelectedId(selectedId === row.id ? null : row.id); setNote(row.resolutionNote || '') }}>
            <span className="trainer-quality-score"><strong>{row.overallScore}</strong><Star fill="currentColor" /></span>
            <span className="trainer-quality-copy"><small>{row.branchName} · {formatDate(row.sessionDate)} {row.sessionHour === null ? '' : `· ${String(row.sessionHour).padStart(2, '0')}:00`}</small><strong>{row.trainerName}</strong><em>{row.anonymousToTrainer ? 'Học viên ẩn danh với PT' : row.studentName}</em><p>{row.comment || row.tags.map((tag) => TAG_LABELS[tag] || tag).join(' · ') || 'Không có nhận xét thêm.'}</p></span>
            <span className={`trainer-quality-status is-${row.status}`}>{STATUS_LABELS[row.status]}</span>
          </button>
          {selectedId === row.id && <div className="trainer-quality-detail"><div className="trainer-quality-tags">{row.tags.map((tag) => <span key={tag}>{TAG_LABELS[tag] || tag}</span>)}</div><dl><div><dt>Session</dt><dd>{row.sessionId}</dd></div><div><dt>Gửi lúc</dt><dd>{formatDate(row.submittedAt)}</dd></div><div><dt>Nhóm vấn đề</dt><dd>{row.issueCategory === 'none' ? 'Không có' : row.issueCategory}</dd></div></dl><label><span>Ghi chú xử lý</span><textarea rows={3} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Kết quả xác minh, trao đổi với PT hoặc học viên…" /></label><footer>{row.status === 'needs_review' && <button type="button" disabled={Boolean(action)} onClick={() => void runAction(row.id, 'mark_reviewing')}><Clock3 /> Nhận xử lý</button>}{row.status !== 'resolved' && <button type="button" className="is-resolve" disabled={Boolean(action) || note.trim().length < 3} onClick={() => void runAction(row.id, 'resolve')}><CheckCircle2 /> Hoàn tất</button>}{row.status === 'resolved' && <button type="button" disabled={Boolean(action)} onClick={() => void runAction(row.id, 'reopen')}><RefreshCw /> Mở lại</button>}</footer></div>}
        </article>)}{!rows.length && <div className="trainer-quality-empty"><CheckCircle2 /><strong>Chưa có phản hồi trong bộ lọc</strong><span>Đánh giá mới sẽ xuất hiện sau khi học viên hoàn thành buổi tập.</span></div>}</div>
      </section>
    </>}
  </main>
}
