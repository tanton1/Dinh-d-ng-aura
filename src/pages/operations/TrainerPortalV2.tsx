import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CircleAlert, RefreshCw, X } from 'lucide-react'
import {
  confirmMySession,
  getMyCoachWorkspaceScope,
  listMyAssignedStudents,
  listMyTrainerSchedule,
  requestSessionChange,
  type TrainerSessionRequestSummary,
  type TrainerSessionSummary,
  type TrainerStudentSummary,
  type CoachWorkspaceScope,
} from '../../services/ptOperationsV2Service'
import './OperationsPortalV2.css'

export type TrainerWorkspaceSection = 'students' | 'schedule' | 'requests'

const sectionCopy: Record<TrainerWorkspaceSection, { title: string; description: string }> = {
  students: {
    title: 'Học viên phụ trách',
    description: 'Danh sách học viên được gán PT chính hoặc PT phụ cho tài khoản của bạn.',
  },
  schedule: {
    title: 'Lịch dạy của tôi',
    description: 'Theo dõi từng ca dạy, xác nhận buổi tập và gửi yêu cầu thay đổi đúng quy trình.',
  },
  requests: {
    title: 'Yêu cầu đổi và hủy lịch',
    description: 'Lịch sử yêu cầu của riêng bạn, tách biệt khỏi trang lịch dạy và các nghiệp vụ khác.',
  },
}

function dateString(date: Date) { return date.toISOString().slice(0, 10) }

function sessionStartsAt(session: TrainerSessionSummary) {
  if (!Number.isInteger(session.hour)) return Number.NaN
  return Date.parse(`${session.date}T${String(session.hour).padStart(2, '0')}:00:00+07:00`)
}

function requestStatus(status: string) {
  if (status === 'approved') return 'Đã duyệt'
  if (status === 'rejected') return 'Từ chối'
  return 'Chờ duyệt'
}

export default function TrainerPortalV2({ section = 'students' }: { section?: TrainerWorkspaceSection }) {
  const [workspace, setWorkspace] = useState<CoachWorkspaceScope | null>(null)
  const [scopeLoading, setScopeLoading] = useState(true)
  const [scopeError, setScopeError] = useState('')
  const [students, setStudents] = useState<TrainerStudentSummary[]>([])
  const [sessions, setSessions] = useState<TrainerSessionSummary[]>([])
  const [requests, setRequests] = useState<TrainerSessionRequestSummary[]>([])
  const [from, setFrom] = useState(dateString(new Date()))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [requestTarget, setRequestTarget] = useState<TrainerSessionSummary | null>(null)
  const [requestType, setRequestType] = useState<'cancel' | 'reschedule'>('cancel')
  const [requestReason, setRequestReason] = useState('')
  const [requestDate, setRequestDate] = useState('')
  const [requestHour, setRequestHour] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const canViewStudents = workspace?.tabs.students === true
  const canViewSchedule = workspace?.tabs.schedule === true
  const canViewRequests = workspace?.tabs.requests === true
  const canOpenSection = section === 'students'
    ? canViewStudents
    : section === 'schedule'
      ? canViewSchedule
      : canViewRequests
  const to = useMemo(() => { const date = new Date(`${from}T00:00:00`); date.setDate(date.getDate() + 14); return dateString(date) }, [from])
  const studentNames = useMemo(() => new Map([
    ...students.map((student) => [student.id, student.name] as const),
    ...sessions.filter((session) => session.studentName).map((session) => [session.studentId, session.studentName as string] as const),
  ]), [sessions, students])
  const loadScope = useCallback(async () => {
    setScopeLoading(true)
    setScopeError('')
    try {
      setWorkspace(await getMyCoachWorkspaceScope())
    } catch (cause) {
      setScopeError(cause instanceof Error ? cause.message : 'Không thể xác minh phân công HLV.')
    } finally {
      setScopeLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadScope()
  }, [loadScope])

  const load = useCallback(async () => {
    if (!workspace) { setLoading(false); return }
    setLoading(true); setError('')
    try {
      if (section === 'students' && canViewStudents) {
        const result = await listMyAssignedStudents()
        setStudents(result.students)
      } else if ((section === 'schedule' || section === 'requests') && canViewSchedule) {
        const result = await listMyTrainerSchedule(from, to)
        setSessions(result.sessions)
        setRequests(result.requests ?? [])
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tải dữ liệu được phân công.') }
    finally { setLoading(false) }
  }, [canViewSchedule, canViewStudents, from, section, to, workspace])
  useEffect(() => { void load() }, [load])

  const confirm = async (session: TrainerSessionSummary) => {
    try { await confirmMySession(session.id, Number(session.revision || 0)); setNotice('Đã xác nhận buổi tập và cập nhật số buổi an toàn.'); await load() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể xác nhận buổi tập.') }
  }

  const openRequest = (session: TrainerSessionSummary) => {
    setRequestTarget(session)
    setRequestType('cancel')
    setRequestReason('')
    setRequestDate('')
    setRequestHour('')
    setError('')
  }

  const submitRequest = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!requestTarget || submitting) return
    if (!requestTarget.contractId) return setError('Buổi tập chưa liên kết hợp đồng; quản trị viên cần đối soát trước khi đổi lịch.')
    if (requestReason.trim().length < 3) return setError('Vui lòng nhập lý do từ 3 ký tự.')
    if (requestType === 'reschedule' && (!requestDate || requestHour === '')) return setError('Vui lòng chọn ngày và giờ mới.')
    setSubmitting(true); setError('')
    try {
      await requestSessionChange({
        sessionId: requestTarget.id,
        contractId: requestTarget.contractId,
        type: requestType,
        reason: requestReason.trim(),
        newDate: requestType === 'reschedule' ? requestDate : undefined,
        newHour: requestType === 'reschedule' ? Number(requestHour) : undefined,
      })
      setRequestTarget(null)
      setNotice('Đã gửi yêu cầu tới bộ phận xếp lịch. Thay đổi do PT đề nghị không dùng lượt miễn của học viên.')
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể gửi yêu cầu.') }
    finally { setSubmitting(false) }
  }

  return <section className="opv2-page">
    <section className="opv2-hero"><p className="opv2-kicker">Aura Staff · Công việc</p><h1>{sectionCopy[section].title}</h1><p>{sectionCopy[section].description}</p></section>
    {scopeLoading && <div className="opv2-state"><RefreshCw className="is-spinning" /> Đang đối chiếu phân công trong Học viên PT Gym…</div>}
    {!scopeLoading && scopeError && <div className="opv2-state is-error">{scopeError}<button className="opv2-action" onClick={() => void loadScope()}>Kết nối lại</button></div>}
    {!scopeLoading && workspace && !canOpenSection && <section className="opv2-guidance"><CircleAlert size={20} /><div><strong>Chưa có dữ liệu được phân công</strong><p>Trang này chỉ hiển thị dữ liệu gắn trực tiếp với tài khoản Staff của bạn. Quản trị viên có thể cập nhật PT chính, PT phụ hoặc lịch dạy tại hồ sơ học viên.</p></div></section>}
    {!scopeLoading && workspace && canOpenSection && <>
    <section className="opv2-summary"><div className="opv2-stat"><strong>{workspace.counts.primaryStudents}</strong><span>học viên PT chính</span></div><div className="opv2-stat"><strong>{workspace.counts.secondaryStudents}</strong><span>học viên PT phụ</span></div><div className="opv2-stat"><strong>{workspace.counts.teachingSessions}</strong><span>buổi được phân công</span></div></section>
    {notice && <div className="opv2-notice"><CheckCircle2 size={18} /> {notice}</div>}
    {loading && <div className="opv2-state"><RefreshCw className="is-spinning" /> Đang đồng bộ phạm vi làm việc…</div>}
    {error && !requestTarget && <div className="opv2-state is-error">{error}<button className="opv2-action" onClick={() => void load()}>Thử lại</button></div>}

    {!loading && !error && section === 'students' && <><h2 className="opv2-section-title">Học viên được phân công</h2><div className="opv2-list">{students.map((student) => <article className="opv2-card" key={student.id}><div className="opv2-card-head"><div><h3>{student.name}</h3><p>{student.phone || 'Chưa có số điện thoại'}</p></div><span className="opv2-badge">{student.assignmentRole === 'primary' ? 'PT chính' : 'PT phụ'}</span></div><p>Hợp đồng: {student.contract ? `${student.contract.usedSessions}/${student.contract.totalSessions} buổi` : 'Chưa có'}</p></article>)}{students.length === 0 && <div className="opv2-state">Chưa có học viên PT được phân công.</div>}</div></>}

    {!loading && !error && section === 'schedule' && <><div className="opv2-toolbar"><div><h2 className="opv2-section-title">Lịch dạy sắp tới</h2><p>Đổi/hủy phải gửi trước giờ tập ít nhất 12 giờ.</p></div><input className="opv2-date" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div><div className="opv2-list">{sessions.map((session) => {
      const requestable = ['scheduled', 'rescheduled'].includes(session.status) && Boolean(session.contractId) && sessionStartsAt(session) - Date.now() >= 12 * 60 * 60 * 1000
      return <article className="opv2-card" key={session.id}><div className="opv2-card-head"><div><h3>{session.date} · {String(session.hour ?? '--').padStart(2, '0')}:00</h3><p>{studentNames.get(session.studentId) || 'Học viên chưa đồng bộ tên'}</p></div><span className="opv2-badge">{session.status}</span></div><div className="opv2-card-actions"><button className="opv2-action is-secondary" disabled={!requestable} title={!requestable ? 'Đã qua hạn 12 giờ hoặc buổi chưa liên kết hợp đồng' : undefined} onClick={() => openRequest(session)}>Đổi / hủy</button><button className="opv2-action" disabled={!['scheduled', 'rescheduled'].includes(session.status)} onClick={() => void confirm(session)}>Xác nhận đã tập</button></div></article>
    })}{sessions.length === 0 && <div className="opv2-state">Không có buổi tập trong khoảng này.</div>}</div></>}

    {!loading && !error && section === 'requests' && <>
      <section className="opv2-guidance"><CircleAlert size={20} /><div><strong>Phân biệt OFF học viên và nghỉ ca PT</strong><p>OFF/Bảo lưu là quyền lợi hợp đồng của học viên. PT nghỉ ca gửi đổi/hủy từng buổi tại tab Lịch 14 ngày; nghỉ nhiều ngày cần báo quản lý để đánh dấu PT OFF trên ma trận trước khi publish.</p></div></section>
      <h2 className="opv2-section-title">Lịch sử yêu cầu của tôi</h2>
      <div className="opv2-list">{requests.map((request) => <article className="opv2-card" key={request.id}><div className="opv2-card-head"><div><h3>{request.type === 'cancel' ? 'Xin hủy ca dạy' : 'Xin đổi ca dạy'}</h3><p>{request.originalDate} · {String(request.originalHour ?? '--').padStart(2, '0')}:00 · {studentNames.get(request.studentId) || 'Học viên Aura'}</p></div><span className={`opv2-badge is-${request.status}`}>{requestStatus(request.status)}</span></div>{request.type === 'reschedule' && request.newDate && <p>Đề xuất: {request.newDate} · {String(request.newHour ?? '--').padStart(2, '0')}:00</p>}<p>{request.reason}</p></article>)}{requests.length === 0 && <div className="opv2-state">Bạn chưa gửi yêu cầu đổi hoặc hủy ca nào.</div>}</div>
    </>}

    {requestTarget && <div className="opv2-sheet-layer" role="presentation"><button type="button" className="opv2-sheet-backdrop" aria-label="Đóng" onClick={() => setRequestTarget(null)} /><section className="opv2-sheet" role="dialog" aria-modal="true" aria-labelledby="trainer-request-title"><header><div><small>AURA PT · YÊU CẦU CA DẠY</small><h2 id="trainer-request-title">Đổi hoặc hủy lịch</h2></div><button type="button" aria-label="Đóng" onClick={() => setRequestTarget(null)}><X size={19} /></button></header><p className="opv2-sheet-current">Buổi {requestTarget.date} · {String(requestTarget.hour ?? '--').padStart(2, '0')}:00</p><form onSubmit={submitRequest}><div className="opv2-sheet-segment"><button type="button" className={requestType === 'cancel' ? 'active' : ''} onClick={() => setRequestType('cancel')}>Hủy ca</button><button type="button" className={requestType === 'reschedule' ? 'active' : ''} onClick={() => setRequestType('reschedule')}>Đổi ca</button></div>{requestType === 'reschedule' && <div className="opv2-sheet-fields"><label>Ngày mới<input type="date" value={requestDate} onChange={(event) => setRequestDate(event.target.value)} /></label><label>Giờ mới<select value={requestHour} onChange={(event) => setRequestHour(event.target.value)}><option value="">Chọn giờ</option>{[6,7,8,9,10,11,14,15,16,17,18,19,20].map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select></label></div>}<label>Lý do<textarea maxLength={500} value={requestReason} onChange={(event) => setRequestReason(event.target.value)} placeholder="Nêu rõ lý do để quản lý xử lý…" /></label>{error && <p className="opv2-form-error">{error}</p>}<footer><button type="button" onClick={() => setRequestTarget(null)}>Để sau</button><button type="submit" disabled={submitting}>{submitting ? 'Đang gửi…' : 'Gửi yêu cầu'}</button></footer></form></section></div>}
    </>}
  </section>
}
