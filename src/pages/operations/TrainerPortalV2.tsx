import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCheck, CheckCircle2, CircleAlert, Clock3, RefreshCw, Timer, UserCheck, UserX, X } from 'lucide-react'
import {
  bulkConfirmMySessions,
  getMyTrainerWorkspace,
  recordMySessionAttendance,
  requestSessionChange,
  type TrainerSessionRequestSummary,
  type TrainerSessionSummary,
  type TrainerStudentSummary,
  type CoachWorkspaceScope,
} from '../../services/ptOperationsV2Service'
import './OperationsPortalV2.css'
import './OperationsAttendance.css'

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

const vietnamDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function dateString(date: Date) { return vietnamDateFormatter.format(date) }

function sessionStartsAt(session: TrainerSessionSummary) {
  if (!Number.isInteger(session.hour)) return Number.NaN
  return Date.parse(`${session.date}T${String(session.hour).padStart(2, '0')}:00:00+07:00`)
}

function requestStatus(status: string) {
  if (status === 'approved') return 'Đã duyệt'
  if (status === 'rejected') return 'Từ chối'
  return 'Chờ duyệt'
}

function attendanceState(session: TrainerSessionSummary) {
  if (session.attendanceStatus && session.attendanceStatus !== 'policy_charge') return session.attendanceStatus
  if (['completed', 'attended'].includes(session.status)) return 'present'
  if (session.status === 'no_show') return 'no_show'
  return 'pending'
}

function attendanceLabel(session: TrainerSessionSummary) {
  const status = attendanceState(session)
  if (status === 'present') return 'Có tập'
  if (status === 'late') return `Đi trễ${session.lateMinutes ? ` ${session.lateMinutes}${session.lateMinutes === 15 ? '+' : ''} phút` : ''}`
  if (status === 'no_show') return 'Không đến'
  return 'Chờ xác nhận'
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
  const [attendanceTarget, setAttendanceTarget] = useState<TrainerSessionSummary | null>(null)
  const [bulkTargets, setBulkTargets] = useState<TrainerSessionSummary[]>([])
  const [attendanceBusy, setAttendanceBusy] = useState('')
  const [clockNow, setClockNow] = useState(() => Date.now())
  const [noShowReason, setNoShowReason] = useState<'' | 'busy' | 'sick' | 'forgot' | 'unreachable' | 'other'>('')
  const [attendanceNote, setAttendanceNote] = useState('')
  const canViewStudents = workspace?.tabs.students === true
  const canViewSchedule = workspace?.tabs.schedule === true
  const canViewRequests = workspace?.tabs.requests === true
  const canOpenSection = section === 'students'
    ? canViewStudents
    : section === 'schedule'
      ? canViewSchedule
      : canViewRequests
  const to = useMemo(() => dateString(new Date(Date.parse(`${from}T00:00:00+07:00`) + 14 * 86_400_000)), [from])
  const studentNames = useMemo(() => new Map([
    ...students.map((student) => [student.id, student.name] as const),
    ...sessions.filter((session) => session.studentName).map((session) => [session.studentId, session.studentName as string] as const),
  ]), [sessions, students])
  const load = useCallback(async () => {
    setScopeLoading(true); setLoading(true); setScopeError(''); setError('')
    try {
      const result = await getMyTrainerWorkspace(section, from, to)
      setWorkspace(result.scope)
      setStudents(result.students)
      setSessions(result.sessions)
      setRequests(result.requests ?? [])
    } catch (cause) {
      setScopeError(cause instanceof Error ? cause.message : 'Không thể tải dữ liệu được phân công.')
    } finally {
      setScopeLoading(false); setLoading(false)
    }
  }, [from, section, to])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const markAttendance = async (
    session: TrainerSessionSummary,
    status: 'present' | 'late' | 'no_show',
    lateMinutes?: 5 | 10 | 15,
    details: { noShowReason?: '' | 'busy' | 'sick' | 'forgot' | 'unreachable' | 'other'; note?: string } = {},
  ) => {
    if (attendanceBusy) return
    setAttendanceBusy(session.id); setError('')
    try {
      await recordMySessionAttendance({
        sessionId: session.id,
        expectedRevision: Number(session.revision || 0),
        attendanceStatus: status,
        lateMinutes,
        noShowReason: details.noShowReason,
        note: details.note,
      })
      setAttendanceTarget(null)
      setNoShowReason('')
      setAttendanceNote('')
      setNotice(status === 'no_show' ? 'Đã ghi nhận học viên không đến. Buổi đã tính vẫn được giữ nguyên.' : 'Đã ghi nhận hiện diện. Số buổi không bị tính thêm lần nữa.')
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể xác nhận hiện diện.') }
    finally { setAttendanceBusy('') }
  }

  const openAttendance = (session: TrainerSessionSummary) => {
    setAttendanceTarget(session)
    setNoShowReason('')
    setAttendanceNote('')
    setError('')
  }

  const bulkConfirmToday = async (items: TrainerSessionSummary[]) => {
    if (attendanceBusy || !items.length) return
    setAttendanceBusy('bulk'); setError('')
    try {
      const result = await bulkConfirmMySessions(items.slice(0, 30).map((session) => ({ sessionId: session.id, expectedRevision: Number(session.revision || 0) })))
      setBulkTargets([])
      setNotice(result.failed ? `Đã xác nhận ${result.confirmed}/${result.total} buổi; ${result.failed} buổi cần tải lại để đối soát.` : `Đã xác nhận ${result.confirmed} học viên đều có tập.`)
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể xác nhận hàng loạt.') }
    finally { setAttendanceBusy('') }
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
    {!scopeLoading && scopeError && <div className="opv2-state is-error">{scopeError}<button className="opv2-action" onClick={() => void load()}>Kết nối lại</button></div>}
    {!scopeLoading && workspace && !canOpenSection && <section className="opv2-guidance"><CircleAlert size={20} /><div><strong>Chưa có dữ liệu được phân công</strong><p>Trang này chỉ hiển thị dữ liệu gắn trực tiếp với tài khoản Staff của bạn. Quản trị viên có thể cập nhật PT chính, PT phụ hoặc lịch dạy tại hồ sơ học viên.</p></div></section>}
    {!scopeLoading && workspace && canOpenSection && <>
    <section className="opv2-summary"><div className="opv2-stat"><strong>{workspace.counts.primaryStudents}</strong><span>học viên PT chính</span></div><div className="opv2-stat"><strong>{workspace.counts.secondaryStudents}</strong><span>học viên PT phụ</span></div><div className="opv2-stat"><strong>{workspace.counts.teachingSessions}</strong><span>buổi được phân công</span></div></section>
    {notice && <div className="opv2-notice"><CheckCircle2 size={18} /> {notice}</div>}
    {loading && <div className="opv2-state"><RefreshCw className="is-spinning" /> Đang đồng bộ phạm vi làm việc…</div>}
    {error && !requestTarget && <div className="opv2-state is-error">{error}<button className="opv2-action" onClick={() => void load()}>Thử lại</button></div>}

    {!loading && !error && section === 'students' && <><h2 className="opv2-section-title">Học viên được phân công</h2><div className="opv2-list">{students.map((student) => <article className="opv2-card" key={student.id}><div className="opv2-card-head"><div><h3>{student.name}</h3><p>{student.phone || 'Chưa có số điện thoại'}</p></div><span className="opv2-badge">{student.assignmentRole === 'primary' ? 'PT chính' : 'PT phụ'}</span></div><p>Hợp đồng: {student.contract ? `${student.contract.usedSessions}/${student.contract.totalSessions} buổi` : 'Chưa có'}</p></article>)}{students.length === 0 && <div className="opv2-state">Chưa có học viên PT được phân công.</div>}</div></>}

    {!loading && !error && section === 'schedule' && (() => {
      const now = clockNow
      const daySessions = sessions.filter((session) => session.date === from && ['scheduled', 'rescheduled', 'completed', 'attended', 'no_show'].includes(session.status))
      const confirmed = daySessions.filter((session) => attendanceState(session) !== 'pending')
      const pendingStarted = daySessions.filter((session) => attendanceState(session) === 'pending' && sessionStartsAt(session) <= now)
      const future = daySessions.filter((session) => sessionStartsAt(session) > now)
      return <>
        <div className="opv2-toolbar opv2-today-toolbar"><div><p className="opv2-kicker-dark">Ca hôm nay</p><h2 className="opv2-section-title">{from}</h2></div><input className="opv2-date" aria-label="Ngày lịch dạy" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div>
        <section className="opv2-attendance-summary" aria-label="Tổng hợp xác nhận ca dạy">
          <div><strong>{daySessions.length}</strong><span>ca dạy</span></div>
          <div><strong>{confirmed.length}</strong><span>đã xác nhận</span></div>
          <div><strong>{pendingStarted.length}</strong><span>chờ xác nhận</span></div>
          <div><strong>{future.length}</strong><span>chưa tới giờ</span></div>
        </section>
        {pendingStarted.length > 1 && <button className="opv2-bulk-attendance" type="button" disabled={Boolean(attendanceBusy)} onClick={() => setBulkTargets(pendingStarted.slice(0, 30))}><CheckCheck size={18} /> {attendanceBusy === 'bulk' ? 'Đang xác nhận…' : `Xác nhận ${pendingStarted.length} học viên đều đã tập`}</button>}
        <div className="opv2-today-list">{daySessions.map((session) => {
          const startsAt = sessionStartsAt(session)
          const started = startsAt <= now
          const noShowReady = startsAt + 15 * 60_000 <= now
          const state = attendanceState(session)
          const requestable = ['scheduled', 'rescheduled'].includes(session.status) && session.billingStatus !== 'charged' && Boolean(session.contractId) && startsAt - now >= 12 * 60 * 60 * 1000
          const charged = session.billingStatus === 'charged' || ['present', 'late', 'no_show'].includes(state)
          return <article className={`opv2-session-card is-${state}`} key={session.id}>
            <div className="opv2-session-time"><strong>{String(session.hour ?? '--').padStart(2, '0')}:00</strong><span>60 phút</span></div>
            <div className="opv2-session-main"><div className="opv2-session-title"><h3>{studentNames.get(session.studentId) || 'Học viên chưa đồng bộ tên'}</h3><span className={`opv2-attendance-pill is-${state}`}>{state === 'present' ? <UserCheck size={14} /> : state === 'late' ? <Timer size={14} /> : state === 'no_show' ? <UserX size={14} /> : <Clock3 size={14} />}{attendanceLabel(session)}</span></div>
              <p className={charged ? 'is-charged' : ''}>{charged ? 'Đã tự động tính 1 buổi' : started ? 'Hệ thống đang hoàn tất tính buổi' : 'Chưa tới giờ · chưa tính buổi'}</p>
              {state === 'pending' && started ? <small className="opv2-auto-attendance-note"><Clock3 size={13} /> PT có 48 giờ để xác nhận; quá hạn Aura tự ghi Có tập.</small> : null}
              {state === 'pending' && started ? <div className="opv2-quick-attendance"><button type="button" disabled={attendanceBusy === session.id} onClick={() => openAttendance(session)}><UserCheck size={17} /> Có tập</button><button type="button" className="is-no-show" disabled={!noShowReady || attendanceBusy === session.id} title={!noShowReady ? 'Có thể xác nhận sau 15 phút từ giờ bắt đầu' : undefined} onClick={() => void markAttendance(session, 'no_show')}><UserX size={17} /> Không đến</button></div> : null}
              {state !== 'pending' ? <button className="opv2-correct-attendance" type="button" onClick={() => openAttendance(session)}>Sửa xác nhận</button> : null}
              {!started ? <button className="opv2-request-link" type="button" disabled={!requestable} onClick={() => openRequest(session)}>Đổi / hủy trước 12 giờ</button> : null}
            </div>
          </article>
        })}{daySessions.length === 0 && <div className="opv2-state">Không có ca dạy trong ngày đã chọn.</div>}</div>
      </>
    })()}

    {!loading && !error && section === 'requests' && <>
      <section className="opv2-guidance"><CircleAlert size={20} /><div><strong>Phân biệt OFF học viên và nghỉ ca PT</strong><p>OFF/Bảo lưu là quyền lợi hợp đồng của học viên. PT nghỉ ca gửi đổi/hủy từng buổi tại tab Lịch 14 ngày; nghỉ nhiều ngày cần báo quản lý để đánh dấu PT OFF trên ma trận trước khi publish.</p></div></section>
      <h2 className="opv2-section-title">Lịch sử yêu cầu của tôi</h2>
      <div className="opv2-list">{requests.map((request) => <article className="opv2-card" key={request.id}><div className="opv2-card-head"><div><h3>{request.type === 'cancel' ? 'Xin hủy ca dạy' : 'Xin đổi ca dạy'}</h3><p>{request.originalDate} · {String(request.originalHour ?? '--').padStart(2, '0')}:00 · {studentNames.get(request.studentId) || 'Học viên Aura'}</p></div><span className={`opv2-badge is-${request.status}`}>{requestStatus(request.status)}</span></div>{request.type === 'reschedule' && request.newDate && <p>Đề xuất: {request.newDate} · {String(request.newHour ?? '--').padStart(2, '0')}:00</p>}<p>{request.reason}</p></article>)}{requests.length === 0 && <div className="opv2-state">Bạn chưa gửi yêu cầu đổi hoặc hủy ca nào.</div>}</div>
    </>}

    {attendanceTarget && <div className="opv2-sheet-layer" role="presentation"><button type="button" className="opv2-sheet-backdrop" aria-label="Đóng" onClick={() => setAttendanceTarget(null)} /><section className="opv2-sheet opv2-attendance-sheet" role="dialog" aria-modal="true" aria-labelledby="trainer-attendance-title"><header><div><small>AURA PT · HIỆN DIỆN</small><h2 id="trainer-attendance-title">Học viên có tập không?</h2></div><button type="button" aria-label="Đóng" onClick={() => setAttendanceTarget(null)}><X size={19} /></button></header><p className="opv2-sheet-current"><b>{studentNames.get(attendanceTarget.studentId) || 'Học viên Aura'}</b><br />{attendanceTarget.date} · {String(attendanceTarget.hour ?? '--').padStart(2, '0')}:00</p><div className="opv2-billing-confirm"><CheckCircle2 size={18} /><span>Buổi được hệ thống tính độc lập. Sửa hiện diện không làm tăng số buổi thêm lần nữa.</span></div><div className="opv2-attendance-options"><button type="button" disabled={attendanceBusy === attendanceTarget.id} onClick={() => void markAttendance(attendanceTarget, 'present')}><UserCheck size={20} /><span><b>Có tập</b><small>Đến đúng giờ</small></span></button><button type="button" disabled={attendanceBusy === attendanceTarget.id} onClick={() => void markAttendance(attendanceTarget, 'late', 5)}><Timer size={20} /><span><b>Đi trễ 5'</b><small>Ghi nhận nhanh</small></span></button><button type="button" disabled={attendanceBusy === attendanceTarget.id} onClick={() => void markAttendance(attendanceTarget, 'late', 10)}><Timer size={20} /><span><b>Đi trễ 10'</b><small>Ghi nhận nhanh</small></span></button><button type="button" disabled={attendanceBusy === attendanceTarget.id} onClick={() => void markAttendance(attendanceTarget, 'late', 15)}><Timer size={20} /><span><b>Đi trễ 15'+</b><small>Ghi nhận nhanh</small></span></button><button type="button" className="is-no-show" disabled={attendanceBusy === attendanceTarget.id || sessionStartsAt(attendanceTarget) + 15 * 60_000 > Date.now()} onClick={() => void markAttendance(attendanceTarget, 'no_show', undefined, { noShowReason, note: attendanceNote })}><UserX size={20} /><span><b>Không đến</b><small>Chỉ mở sau 15 phút</small></span></button></div><details className="opv2-attendance-details"><summary>+ Thêm lý do không đến (không bắt buộc)</summary><label>Lý do<select value={noShowReason} onChange={(event) => setNoShowReason(event.target.value as typeof noShowReason)}><option value="">Không ghi lý do</option><option value="busy">Bận việc</option><option value="sick">Sức khỏe</option><option value="forgot">Quên lịch</option><option value="unreachable">Không liên lạc được</option><option value="other">Khác</option></select></label><label>Ghi chú<textarea maxLength={300} value={attendanceNote} onChange={(event) => setAttendanceNote(event.target.value)} placeholder="Thông tin ngắn để CSKH đối chiếu…" /></label></details>{error && <p className="opv2-form-error">{error}</p>}</section></div>}

    {bulkTargets.length > 0 && <div className="opv2-sheet-layer" role="presentation"><button type="button" className="opv2-sheet-backdrop" aria-label="Đóng" onClick={() => setBulkTargets([])} /><section className="opv2-sheet opv2-bulk-confirm-sheet" role="dialog" aria-modal="true" aria-labelledby="trainer-bulk-attendance-title"><header><div><small>AURA PT · XÁC NHẬN NHANH</small><h2 id="trainer-bulk-attendance-title">Tất cả đều đã tập?</h2></div><button type="button" aria-label="Đóng" onClick={() => setBulkTargets([])}><X size={19} /></button></header><p className="opv2-sheet-current">Xác nhận <b>{bulkTargets.length} học viên</b> trong các ca đã bắt đầu đều có tập. Bạn vẫn có thể sửa riêng ca đi trễ hoặc không đến sau đó.</p><footer><button type="button" onClick={() => setBulkTargets([])}>Xem lại</button><button type="button" disabled={attendanceBusy === 'bulk'} onClick={() => void bulkConfirmToday(bulkTargets)}>{attendanceBusy === 'bulk' ? 'Đang xác nhận…' : 'Xác nhận tất cả'}</button></footer>{error && <p className="opv2-form-error">{error}</p>}</section></div>}

    {requestTarget && <div className="opv2-sheet-layer" role="presentation"><button type="button" className="opv2-sheet-backdrop" aria-label="Đóng" onClick={() => setRequestTarget(null)} /><section className="opv2-sheet" role="dialog" aria-modal="true" aria-labelledby="trainer-request-title"><header><div><small>AURA PT · YÊU CẦU CA DẠY</small><h2 id="trainer-request-title">Đổi hoặc hủy lịch</h2></div><button type="button" aria-label="Đóng" onClick={() => setRequestTarget(null)}><X size={19} /></button></header><p className="opv2-sheet-current">Buổi {requestTarget.date} · {String(requestTarget.hour ?? '--').padStart(2, '0')}:00</p><form onSubmit={submitRequest}><div className="opv2-sheet-segment"><button type="button" className={requestType === 'cancel' ? 'active' : ''} onClick={() => setRequestType('cancel')}>Hủy ca</button><button type="button" className={requestType === 'reschedule' ? 'active' : ''} onClick={() => setRequestType('reschedule')}>Đổi ca</button></div>{requestType === 'reschedule' && <div className="opv2-sheet-fields"><label>Ngày mới<input type="date" value={requestDate} onChange={(event) => setRequestDate(event.target.value)} /></label><label>Giờ mới<select value={requestHour} onChange={(event) => setRequestHour(event.target.value)}><option value="">Chọn giờ</option>{[6,7,8,9,10,11,14,15,16,17,18,19,20].map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select></label></div>}<label>Lý do<textarea maxLength={500} value={requestReason} onChange={(event) => setRequestReason(event.target.value)} placeholder="Nêu rõ lý do để quản lý xử lý…" /></label>{error && <p className="opv2-form-error">{error}</p>}<footer><button type="button" onClick={() => setRequestTarget(null)}>Để sau</button><button type="submit" disabled={submitting}>{submitting ? 'Đang gửi…' : 'Gửi yêu cầu'}</button></footer></form></section></div>}
    </>}
  </section>
}
