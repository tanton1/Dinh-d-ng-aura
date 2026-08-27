import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarClock,
  CalendarRange,
  Check,
  CircleAlert,
  Clock3,
  FileClock,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react'
import {
  approveContractPauseRequest,
  approveSessionRequest,
  listPtOperationsRequests,
  rejectContractPauseRequest,
  rejectSessionRequest,
  type PtOperationsRequest,
  type PtOperationsRequestPage,
  type PtOperationsRequestStatus,
} from '../../../services/sessionOperationsService'
import '../../../styles-operations-requests.css'

type Props = { kind: 'session' | 'pause' }
type StatusFilter = 'all' | PtOperationsRequestStatus
type Decision = { record: PtOperationsRequest; action: 'approve' | 'reject' }

const statusCopy: Record<PtOperationsRequestStatus, string> = {
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Từ chối',
}

function dateLabel(value: string | null | undefined) {
  if (!value) return 'Chưa cập nhật'
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00+07:00`)
    : new Date(value)
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', ...(value.includes('T') ? { timeStyle: 'short' as const } : {}) }).format(parsed)
}

function slotLabel(date: string | null, hour: number | null) {
  return `${dateLabel(date)}${hour === null ? '' : ` · ${String(hour).padStart(2, '0')}:00`}`
}

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('vi-VN')
}

export default function OperationsRequestCenter({ kind }: Props) {
  const [page, setPage] = useState<PtOperationsRequestPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('pending')
  const [decision, setDecision] = useState<Decision | null>(null)
  const [decisionReason, setDecisionReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setPage(await listPtOperationsRequests(kind))
    } catch (cause) {
      setPage(null)
      setError(cause instanceof Error ? cause.message : 'Không thể tải lịch sử yêu cầu.')
    } finally {
      setLoading(false)
    }
  }, [kind])

  useEffect(() => {
    setQuery('')
    setStatus('pending')
    setDecision(null)
    setNotice('')
    void load()
  }, [kind, load])

  const records = useMemo(() => {
    const needle = normalize(query.trim())
    return (page?.records || []).filter((record) => {
      if (status !== 'all' && record.status !== status) return false
      if (!needle) return true
      return [record.studentName, record.studentPhone, record.packageName, record.reason, record.id]
        .some((value) => normalize(String(value || '')).includes(needle))
    })
  }, [page?.records, query, status])

  const openDecision = (record: PtOperationsRequest, action: Decision['action']) => {
    setDecision({ record, action })
    setDecisionReason('')
    setError('')
  }

  const submitDecision = async () => {
    if (!decision || submitting) return
    if (decision.action === 'reject' && decisionReason.trim().length < 3) {
      setError('Vui lòng nhập lý do từ chối từ 3 ký tự.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const { record, action } = decision
      if (record.kind === 'session') {
        if (action === 'approve') await approveSessionRequest({ requestId: record.id, expectedSessionRevision: record.sessionRevision })
        else await rejectSessionRequest({ requestId: record.id, reason: decisionReason.trim() })
      } else if (action === 'approve') await approveContractPauseRequest(record.id)
      else await rejectContractPauseRequest(record.id, decisionReason.trim())
      setNotice(action === 'approve' ? 'Đã duyệt và lưu lịch sử vận hành.' : 'Đã từ chối và lưu lý do vào lịch sử.')
      setDecision(null)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể xử lý yêu cầu.')
    } finally {
      setSubmitting(false)
    }
  }

  const title = kind === 'session' ? 'Đổi và hủy lịch' : 'OFF và bảo lưu'
  const subtitle = kind === 'session'
    ? 'Duyệt yêu cầu theo buổi và lưu nguyên lịch gốc, lịch đề xuất, chính sách tính buổi.'
    : 'Duyệt quyền lợi hợp đồng, thời gian nghỉ, số ngày cộng hạn và các ca được miễn.'

  return <section className="operations-requests" aria-busy={loading}>
    <header className="operations-requests__header">
      <div><span>{kind === 'session' ? <CalendarClock size={16} /> : <CalendarRange size={16} />} AURA PT · NHẬT KÝ YÊU CẦU</span><h2>{title}</h2><p>{subtitle}</p></div>
      <button type="button" onClick={() => void load()} disabled={loading} aria-label="Tải lại yêu cầu"><RefreshCw className={loading ? 'is-spinning' : ''} size={18} /></button>
    </header>

    <div className="operations-requests__summary" aria-label="Tổng hợp trạng thái">
      {([
        ['all', 'Tất cả', page?.summary.total || 0],
        ['pending', 'Chờ duyệt', page?.summary.pending || 0],
        ['approved', 'Đã duyệt', page?.summary.approved || 0],
        ['rejected', 'Từ chối', page?.summary.rejected || 0],
      ] as Array<[StatusFilter, string, number]>).map(([value, label, count]) => <button type="button" key={value} className={status === value ? 'is-active' : ''} onClick={() => setStatus(value)}><strong>{count}</strong><span>{label}</span></button>)}
    </div>

    <div className="operations-requests__toolbar">
      <label><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tên, SĐT, gói tập hoặc mã yêu cầu" /></label>
      <span>{records.length} hồ sơ trong bộ lọc</span>
    </div>

    {notice && <div className="operations-requests__notice"><ShieldCheck size={17} /> {notice}</div>}
    {error && !decision && <div className="operations-requests__error"><CircleAlert size={17} /> {error}</div>}
    {page?.truncated && <div className="operations-requests__error"><CircleAlert size={17} /> Danh sách đã đạt giới hạn 500 hồ sơ. Hãy dùng tìm kiếm hoặc bộ lọc trạng thái.</div>}

    <div className="operations-requests__list">
      {loading && !page ? <div className="operations-requests__empty"><RefreshCw className="is-spinning" /> Đang tải lịch sử an toàn…</div> : null}
      {!loading && !error && !records.length ? <div className="operations-requests__empty"><FileClock /> Không có yêu cầu phù hợp bộ lọc.</div> : null}
      {records.map((record) => <article key={record.id} className={`operations-request-card is-${record.status}`}>
        <header><span className={`operations-request-card__kind is-${record.type}`}>{record.kind === 'session' ? record.type === 'cancel' ? 'Hủy buổi' : 'Đổi lịch' : record.type === 'off' ? 'OFF' : 'Bảo lưu'}</span><span className={`operations-request-card__status is-${record.status}`}>{statusCopy[record.status]}</span></header>
        <div className="operations-request-card__identity"><span><UserRound size={17} /></span><div><strong>{record.studentName}</strong><small>{record.studentPhone || record.packageName}</small></div></div>
        {record.kind === 'session' ? <div className="operations-request-card__slots"><div><small>Lịch gốc</small><strong>{slotLabel(record.originalDate, record.originalHour)}</strong><span>{record.trainerName}</span></div>{record.type === 'reschedule' && <div className="is-new"><small>Lịch Aura gợi ý</small><strong>{slotLabel(record.newDate, record.newHour)}</strong><span>{record.newTrainerName || record.trainerName}{record.pairsExistingSession ? ' · ưu tiên ghép ca' : ''}</span></div>}</div> : <div className="operations-request-card__slots"><div><small>Từ ngày</small><strong>{dateLabel(record.startDate)}</strong></div><div className="is-new"><small>Đến ngày</small><strong>{dateLabel(record.endDate)}</strong></div></div>}
        <p className="operations-request-card__reason">{record.reason || 'Không ghi lý do.'}</p>
        <div className="operations-request-card__facts">
          <span>{record.packageName}</span>
          {record.kind === 'session' ? <><span>{record.requestedBy === 'trainer' ? 'PT gửi' : 'Học viên gửi'}</span><span>{record.countsTowardContract ? 'Có tính buổi' : `Miễn tính buổi · ${record.policySequence || 1}/${record.complimentaryLimit}`}</span>{record.suggestionRank && <span>Gợi ý #{record.suggestionRank}</span>}</> : <><span>{record.durationDays} ngày</span><span>{record.cancelledSessionCount} ca được xử lý</span>{record.newContractEndDate && <span>Hạn mới {dateLabel(record.newContractEndDate)}</span>}</>}
        </div>
        <details><summary><Clock3 size={14} /> Chi tiết lưu trữ</summary><dl><div><dt>Mã yêu cầu</dt><dd>{record.id}</dd></div><div><dt>Ngày gửi</dt><dd>{dateLabel(record.createdAt)}</dd></div><div><dt>Ngày xử lý</dt><dd>{dateLabel(record.processedAt)}</dd></div>{record.adminNote && <div><dt>Ghi chú quản lý</dt><dd>{record.adminNote}</dd></div>}</dl></details>
        {record.status === 'pending' && <footer><button type="button" className="is-approve" onClick={() => openDecision(record, 'approve')}><Check size={16} /> Duyệt</button><button type="button" className="is-reject" onClick={() => openDecision(record, 'reject')}><X size={16} /> Từ chối</button></footer>}
      </article>)}
    </div>

    {decision && <div className="operations-request-decision" role="presentation"><button className="operations-request-decision__backdrop" type="button" aria-label="Đóng" onClick={() => setDecision(null)} /><section role="dialog" aria-modal="true" aria-labelledby="request-decision-title"><header><div><small>AURA · XÁC NHẬN NGHIỆP VỤ</small><h3 id="request-decision-title">{decision.action === 'approve' ? 'Duyệt yêu cầu?' : 'Từ chối yêu cầu?'}</h3></div><button type="button" aria-label="Đóng" onClick={() => setDecision(null)}><X /></button></header><p>{decision.record.studentName} · {decision.record.reason}</p>{decision.record.kind === 'session' && decision.record.type === 'reschedule' && <div className="operations-request-decision__change"><span><small>Lịch gốc</small><strong>{slotLabel(decision.record.originalDate, decision.record.originalHour)}</strong><em>{decision.record.trainerName}</em></span><span><small>Lịch mới</small><strong>{slotLabel(decision.record.newDate, decision.record.newHour)}</strong><em>{decision.record.newTrainerName || decision.record.trainerName}</em></span></div>}{decision.action === 'reject' && <label>Lý do từ chối<textarea value={decisionReason} maxLength={500} onChange={(event) => setDecisionReason(event.target.value)} placeholder="Nêu rõ lý do để học viên/PT theo dõi…" /></label>}{error && <div className="operations-requests__error"><CircleAlert size={17} /> {error}</div>}<footer><button type="button" onClick={() => setDecision(null)} disabled={submitting}>Quay lại</button><button type="button" className={decision.action === 'approve' ? 'is-approve' : 'is-reject'} onClick={() => void submitDecision()} disabled={submitting}>{submitting ? 'Đang lưu…' : decision.action === 'approve' ? 'Xác nhận duyệt' : 'Xác nhận từ chối'}</button></footer></section></div>}
  </section>
}
