import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, LoaderCircle, Send, ShieldCheck, Star } from 'lucide-react'
import {
  getMyPendingSessionFeedback,
  submitSessionFeedback,
  type PendingSessionFeedback,
  type SessionFeedbackIssueCategory,
  type SessionFeedbackTag,
} from '../../services/sessionFeedbackService'
import './SessionFeedbackPrompt.css'

const SCORE_LABELS = ['Rất chưa hài lòng', 'Chưa hài lòng', 'Bình thường', 'Hài lòng', 'Rất hài lòng']
const TAGS: Array<{ id: SessionFeedbackTag; label: string; positive: boolean }> = [
  { id: 'trainer_on_time', label: 'PT đúng giờ', positive: true },
  { id: 'clear_guidance', label: 'Hướng dẫn dễ hiểu', positive: true },
  { id: 'good_technique_correction', label: 'Sửa kỹ thuật tốt', positive: true },
  { id: 'motivating', label: 'Tạo động lực', positive: true },
  { id: 'appropriate_intensity', label: 'Cường độ phù hợp', positive: true },
  { id: 'caring', label: 'Quan tâm học viên', positive: true },
  { id: 'workout_not_suitable', label: 'Bài tập chưa phù hợp', positive: false },
  { id: 'trainer_late', label: 'PT đến trễ', positive: false },
  { id: 'limited_guidance', label: 'Ít hướng dẫn', positive: false },
  { id: 'poor_attitude', label: 'Thái độ chưa tốt', positive: false },
]

function demoSession(): PendingSessionFeedback {
  const date = new Date()
  date.setDate(date.getDate() - 1)
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return {
    sessionId: 'demo-feedback-session',
    date: key,
    hour: 18,
    trainerId: 'demo-trainer',
    trainerName: 'PT Minh',
    branchId: 'demo-branch',
    attendanceStatus: 'present',
    endsAt: new Date(Date.now() - 3_600_000).toISOString(),
    expiresAt: new Date(Date.now() + 48 * 3_600_000).toISOString(),
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' })
    .format(new Date(`${value}T00:00:00+07:00`))
}

export default function SessionFeedbackPrompt({ isDemo = false, onSubmitted }: { isDemo?: boolean; onSubmitted?: () => void }) {
  const [sessions, setSessions] = useState<PendingSessionFeedback[]>([])
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [score, setScore] = useState(0)
  const [tags, setTags] = useState<SessionFeedbackTag[]>([])
  const [comment, setComment] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [issueCategory, setIssueCategory] = useState<SessionFeedbackIssueCategory>('none')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const session = sessions[index] ?? null

  useEffect(() => {
    let active = true
    setLoading(true)
    ;(async () => {
      try {
        const next = isDemo ? { sessions: [demoSession()] } : await getMyPendingSessionFeedback()
        if (active) setSessions(next.sessions)
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'Chưa thể tải đánh giá buổi tập.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [isDemo])

  useEffect(() => {
    setScore(0)
    setTags([])
    setComment('')
    setAnonymous(false)
    setIssueCategory('none')
    setError('')
  }, [session?.sessionId])

  const visibleTags = useMemo(() => score > 0 ? TAGS.filter((item) => score >= 4 ? item.positive : score <= 2 ? !item.positive : true) : [], [score])
  if (loading) return <section className="session-feedback-prompt is-loading" role="status"><LoaderCircle className="spin" /><span>Đang kiểm tra buổi cần đánh giá…</span></section>
  if (!session && !success) return null

  const toggleTag = (tag: SessionFeedbackTag) => setTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag].slice(0, 6))
  const submit = async () => {
    if (!session || !score || submitting) return
    setSubmitting(true)
    setError('')
    try {
      if (!isDemo) await submitSessionFeedback({ sessionId: session.sessionId, overallScore: score, tags, comment, anonymousToTrainer: anonymous, issueCategory })
      const remaining = sessions.filter((item) => item.sessionId !== session.sessionId)
      setSessions(remaining)
      setIndex(Math.min(index, Math.max(0, remaining.length - 1)))
      setSuccess(score <= 2 || ['safety', 'conduct'].includes(issueCategory)
        ? 'Aura đã chuyển phản hồi đến quản lý để kiểm tra.'
        : 'Cảm ơn bạn! Phản hồi đã được ghi nhận.')
      onSubmitted?.()
      window.setTimeout(() => setSuccess(''), 5000)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Chưa thể gửi đánh giá. Vui lòng thử lại.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!session && success) return <section className="session-feedback-prompt is-success" role="status"><CheckCircle2 /><div><small>AURA ĐÃ GHI NHẬN</small><strong>{success}</strong></div></section>

  return <section className="session-feedback-prompt" aria-label="Đánh giá PT sau buổi tập">
    <header>
      <span><Star fill="currentColor" /></span>
      <div><small>ĐÁNH GIÁ SAU BUỔI TẬP</small><h2>Buổi tập với {session.trainerName} thế nào?</h2><p>{formatDate(session.date)} · {String(session.hour).padStart(2, '0')}:00 · Đã ghi nhận có tập</p></div>
      {sessions.length > 1 && <nav aria-label="Chuyển buổi cần đánh giá"><button type="button" disabled={index === 0} onClick={() => setIndex((value) => value - 1)} aria-label="Buổi trước"><ChevronLeft /></button><b>{index + 1}/{sessions.length}</b><button type="button" disabled={index === sessions.length - 1} onClick={() => setIndex((value) => value + 1)} aria-label="Buổi tiếp theo"><ChevronRight /></button></nav>}
    </header>

    <div className="session-feedback-prompt__scores" role="radiogroup" aria-label="Mức độ hài lòng">
      {[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} className={score === value ? 'active' : ''} role="radio" aria-checked={score === value} aria-label={`${value} điểm - ${SCORE_LABELS[value - 1]}`} onClick={() => setScore(value)}><Star fill={score >= value ? 'currentColor' : 'none'} /><span>{value}</span></button>)}
    </div>
    <p className="session-feedback-prompt__score-label">{score ? SCORE_LABELS[score - 1] : 'Chạm để chọn mức độ hài lòng'}</p>

    {score > 0 && <div className="session-feedback-prompt__details">
      <div className="session-feedback-prompt__tags"><strong>Điều bạn muốn Aura ghi nhận</strong><div>{visibleTags.map((item) => <button type="button" key={item.id} className={tags.includes(item.id) ? 'active' : ''} aria-pressed={tags.includes(item.id)} onClick={() => toggleTag(item.id)}>{item.label}</button>)}</div></div>
      {score <= 2 && <label className="session-feedback-prompt__issue"><span><AlertTriangle /> Nhóm vấn đề</span><select value={issueCategory} onChange={(event) => setIssueCategory(event.target.value as SessionFeedbackIssueCategory)}><option value="service">Trải nghiệm dịch vụ</option><option value="lateness">PT đi trễ</option><option value="training_quality">Chất lượng hướng dẫn</option><option value="safety">An toàn/chấn thương</option><option value="conduct">Ứng xử</option></select></label>}
      <label className="session-feedback-prompt__comment"><span>Nhận xét thêm <small>không bắt buộc</small></span><textarea value={comment} maxLength={500} rows={3} onChange={(event) => setComment(event.target.value)} placeholder="Điều gì làm buổi tập tốt hơn?" /><small>{comment.length}/500</small></label>
      <label className="session-feedback-prompt__anonymous"><input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} /><span><ShieldCheck /> Ẩn tên khi PT xem phản hồi</span></label>
      {error && <div className="session-feedback-prompt__error" role="alert">{error}</div>}
      <button type="button" className="session-feedback-prompt__submit" disabled={submitting} onClick={() => void submit()}>{submitting ? <LoaderCircle className="spin" /> : <Send />} Gửi đánh giá</button>
      <small className="session-feedback-prompt__policy">Đánh giá không tự động ảnh hưởng lương PT. Admin sẽ xác minh phản hồi cần xử lý.</small>
    </div>}
  </section>
}
