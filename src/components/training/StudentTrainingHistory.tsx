import { AlertCircle, History, LoaderCircle } from 'lucide-react'
import type { TrainingHistoryPage, TrainingHistoryRecord } from '../../services/businessReportingService'
import './StudentTrainingHistory.css'

export type StudentTrainingHistoryDemoSession = {
  id: string
  date: string
  hour: number | null
  trainerName: string
  status: string
}

export type StudentTrainingHistoryDemoSummary = {
  total: number
  attended: number
  chargedNoShow: number
  exempt: number
}

type Props = {
  page: TrainingHistoryPage | null
  loading: boolean
  error?: string
  isDemo?: boolean
  quotaUsed?: number | null
  quotaTotal?: number | null
  demoSessions?: StudentTrainingHistoryDemoSession[]
  demoSummary?: StudentTrainingHistoryDemoSummary
  onRetry?: () => void
  onLoadMore?: () => void
  className?: string
}

const statusLabels: Record<string, string> = {
  scheduled: 'Đã xếp lịch',
  completed: 'Đã hoàn thành',
  cancelled: 'Đã hủy',
  canceled_by_student: 'Học viên báo nghỉ',
  student_cancelled: 'Học viên báo nghỉ',
  trainer_cancelled: 'PT báo nghỉ',
  no_show: 'Vắng mặt',
  rescheduled: 'Đã đổi lịch',
}

function formatSessionDate(value: string) {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00+07:00`)
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }).format(parsed)
}

function historyBillingStatus(record: TrainingHistoryRecord) {
  return String(record.billingStatus || record.attendance?.billingStatus || '').trim().toLowerCase()
}

function historyRecordLabel(record: TrainingHistoryRecord) {
  const billingStatus = historyBillingStatus(record)
  const attendanceStatus = String(record.attendance?.attendanceStatus || '').trim().toLowerCase()
  const exempt = record.isExempt || billingStatus === 'exempt'
  const noShow = attendanceStatus === 'no_show' || record.status === 'no_show'
  const attended = ['present', 'late'].includes(attendanceStatus) || ['completed', 'attended'].includes(record.status)
  if (exempt) {
    if (noShow) return 'Vắng mặt · miễn trừ'
    if (attended) return attendanceStatus === 'late' ? 'Đã tập · miễn trừ · đi trễ' : 'Đã tập · miễn trừ'
    return `${statusLabels[record.status] ?? record.status} · miễn trừ`
  }
  if (noShow) return record.countsTowardContract || billingStatus === 'charged' ? 'Vắng mặt · tính buổi' : 'Vắng mặt · chờ đối soát'
  if (attended) return attendanceStatus === 'late' ? 'Đã tập · đi trễ' : 'Đã tập'
  if (billingStatus === 'charged') return 'Tính buổi · chờ xác nhận'
  return statusLabels[record.status] ?? record.status
}

function historyRecordTone(record: TrainingHistoryRecord) {
  const billingStatus = historyBillingStatus(record)
  if (record.isExempt || billingStatus === 'exempt') return 'is-exempt'
  if (record.attendance?.attendanceStatus === 'no_show' || record.status === 'no_show') return record.countsTowardContract || billingStatus === 'charged' ? 'is-charged' : 'is-pending'
  if (['present', 'late'].includes(String(record.attendance?.attendanceStatus || '').toLowerCase()) || ['completed', 'attended'].includes(record.status)) return 'is-attended'
  return 'is-pending'
}

function demoTone(status: string) {
  if (['completed', 'attended'].includes(status)) return 'is-attended'
  if (status === 'no_show') return 'is-charged'
  if (status.includes('cancel')) return 'is-exempt'
  return 'is-pending'
}

export default function StudentTrainingHistory({
  page,
  loading,
  error = '',
  isDemo = false,
  quotaUsed = null,
  quotaTotal = null,
  demoSessions = [],
  demoSummary = { total: 0, attended: 0, chargedNoShow: 0, exempt: 0 },
  onRetry,
  onLoadMore,
  className = '',
}: Props) {
  const total = isDemo ? demoSummary.total : page?.summary?.total ?? 0
  const usage = page?.summary?.usage
  const historyCharged = usage ? Number(usage.chargedSessions ?? 0) : null
  const quotaDiffers = !isDemo && Boolean(page)
    && historyCharged !== null
    && quotaUsed !== null && quotaUsed !== undefined
    && Number.isFinite(Number(quotaUsed)) && Number.isFinite(Number(quotaTotal))
    && Number(quotaUsed) !== historyCharged

  return <section className={`student-session-history${className ? ` ${className}` : ''}`} aria-busy={loading}>
    <header>
      <div><small>AURA · NHẬT KÝ TẬP LUYỆN</small><h2>Lịch sử buổi tập</h2><p>Toàn bộ lịch sử từ khi bắt đầu tập. Mỗi buổi ghi rõ đã tập, vắng có tính buổi hoặc miễn trừ.</p></div>
      <span>{total} buổi</span>
    </header>
    {isDemo ? <div className="student-history-summary"><span><b>{demoSummary.attended}</b>Đã tập</span><span><b>{demoSummary.chargedNoShow}</b>Vắng tính buổi</span><span><b>{demoSummary.exempt}</b>Miễn trừ</span></div> : usage ? <div className="student-history-summary"><span><b>{usage.attendedSessions ?? 0}</b>Đã tập</span><span><b>{usage.chargedNoShowSessions ?? 0}</b>Vắng tính buổi</span><span><b>{usage.exemptSessions ?? 0}</b>Miễn trừ</span></div> : null}
    {quotaDiffers ? <div className="student-history-notice"><AlertCircle size={17} /><span>{quotaUsed} buổi tính quota · lịch sử có {historyCharged} buổi tính quota duy nhất theo ngày (tổng {total} dòng lịch sử). Số liệu chênh lệch cần đối soát.</span></div> : null}
    {error ? <div className="student-history-notice" role="alert"><AlertCircle size={17} /><span>{error}</span>{onRetry && <button type="button" onClick={onRetry}>Thử lại</button>}</div> : null}
    {loading && !page && !isDemo ? <div className="student-session-empty"><LoaderCircle size={28} className="is-spinning" /><strong>Đang tải toàn bộ lịch sử…</strong><span>Đang đối chiếu số buổi đã tập, vắng và miễn trừ.</span></div> : null}
    {!loading && !error && !isDemo && page && page.records.length === 0 ? <div className="student-session-empty"><History size={28} /><strong>Chưa có lịch sử tập luyện</strong><span>Các buổi đã hoàn thành hoặc được điều chỉnh sẽ xuất hiện tại đây.</span></div> : null}
    {isDemo && demoSessions.length > 0 ? <div>{demoSessions.map((session) => <article className={demoTone(session.status)} key={session.id}><span>{formatSessionDate(session.date)} · {session.hour === null ? '--:--' : `${String(session.hour).padStart(2, '0')}:00`}</span><strong>{session.trainerName}</strong><em>{statusLabels[session.status] ?? session.status}</em></article>)}</div> : null}
    {!isDemo && page?.records.length ? <div>{page.records.map((record) => <article className={historyRecordTone(record)} key={record.id}><span>{formatSessionDate(record.date)} · {record.hour === null ? '--:--' : `${String(record.hour).padStart(2, '0')}:00`}</span><strong>{record.counterpartName}</strong><em>{historyRecordLabel(record)}</em></article>)}</div> : null}
    {!isDemo && page?.summary?.truncated ? <div className="student-history-notice"><AlertCircle size={17} /><span>Lịch sử vượt giới hạn tải một lần; tổng số liệu đang hiển thị trong phạm vi hệ thống đã đối chiếu.</span></div> : null}
    {!isDemo && page?.hasMore && onLoadMore ? <button type="button" className="student-history-more" disabled={loading} onClick={onLoadMore}>{loading ? 'Đang tải…' : page.summary ? `Tải thêm lịch sử (${Math.max(0, page.summary.total - page.records.length)} buổi)` : 'Tải thêm lịch sử'}</button> : null}
  </section>
}
