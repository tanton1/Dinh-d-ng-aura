import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { BadgeDollarSign, CalendarClock, CheckCircle2, CircleAlert, Clock3, RefreshCw, Soup, UsersRound, X } from 'lucide-react'
import { NutritionReviewWorkspace } from '../../features/nutrition-review/NutritionReviewWorkspace'
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

const SalesWorkspace = lazy(() => import('./SalesPortalV2'))
const RenewalWorkspace = lazy(() => import('../../components/admin/pt/ContractRenewals'))

type TrainerTab = 'students' | 'schedule' | 'requests' | 'nutrition' | 'sales' | 'renewals'

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

export default function TrainerPortalV2({ initialTab = 'students', canUseSales = false, canUseRenewals = false }: { initialTab?: TrainerTab; canUseSales?: boolean; canUseRenewals?: boolean }) {
  const [workspace, setWorkspace] = useState<CoachWorkspaceScope | null>(null)
  const [scopeLoading, setScopeLoading] = useState(true)
  const [scopeError, setScopeError] = useState('')
  const [tab, setTab] = useState<TrainerTab>(initialTab)
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
  const canReviewNutrition = workspace?.tabs.nutrition === true
  const to = useMemo(() => { const date = new Date(`${from}T00:00:00`); date.setDate(date.getDate() + 14); return dateString(date) }, [from])
  const studentNames = useMemo(() => new Map([
    ...students.map((student) => [student.id, student.name] as const),
    ...sessions.filter((session) => session.studentName).map((session) => [session.studentId, session.studentName as string] as const),
  ]), [sessions, students])
  const pendingCount = requests.length
    ? requests.filter((request) => request.status === 'pending').length
    : workspace?.counts.pendingRequests || 0

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

  useEffect(() => {
    const available: TrainerTab[] = [
      ...(canViewStudents ? ['students'] as TrainerTab[] : []),
      ...(canViewSchedule ? ['schedule'] as TrainerTab[] : []),
      ...(canReviewNutrition ? ['nutrition'] as TrainerTab[] : []),
      ...(canUseSales ? ['sales'] as TrainerTab[] : []),
      ...(canUseRenewals ? ['renewals'] as TrainerTab[] : []),
      ...(canViewRequests ? ['requests'] as TrainerTab[] : []),
    ]
    if ((workspace || canUseSales || canUseRenewals) && available.length && !available.includes(tab)) setTab(available[0])
  }, [canReviewNutrition, canUseRenewals, canUseSales, canViewRequests, canViewSchedule, canViewStudents, tab, workspace])

  const load = useCallback(async () => {
    if (['nutrition', 'sales', 'renewals'].includes(tab)) { setLoading(false); return }
    if (!workspace) { setLoading(false); return }
    setLoading(true); setError('')
    try {
      if (tab === 'students' && canViewStudents) {
        const result = await listMyAssignedStudents()
        setStudents(result.students)
      } else if ((tab === 'schedule' || tab === 'requests') && canViewSchedule) {
        const result = await listMyTrainerSchedule(from, to)
        setSessions(result.sessions)
        setRequests(result.requests ?? [])
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tải dữ liệu được phân công.') }
    finally { setLoading(false) }
  }, [canViewSchedule, canViewStudents, from, tab, to, workspace])
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
      setTab('requests')
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể gửi yêu cầu.') }
    finally { setSubmitting(false) }
  }

  const trainerDataTab = ['students', 'schedule', 'requests'].includes(tab)

  return <section className="opv2-page">
    <section className="opv2-hero"><p className="opv2-kicker">Aura Staff · Phạm vi cá nhân</p><h1>Không gian làm việc</h1><p>Một nơi duy nhất cho học viên, lịch dạy, dinh dưỡng, báo giá và tái ký. Mỗi mục chỉ mở khi bạn có phân công hoặc capability tương ứng.</p></section>
    {scopeLoading && <div className="opv2-state"><RefreshCw className="is-spinning" /> Đang đối chiếu phân công trong Học viên PT Gym…</div>}
    {!scopeLoading && scopeError && <div className={`opv2-state ${canUseSales || canUseRenewals ? 'is-warning' : 'is-error'}`}>{scopeError}<button className="opv2-action" onClick={() => void loadScope()}>Kết nối lại</button></div>}
    {!scopeLoading && workspace && !canViewStudents && !canViewSchedule && !canReviewNutrition && !canUseSales && !canUseRenewals && <section className="opv2-guidance"><CircleAlert size={20} /><div><strong>Chưa có phạm vi công việc</strong><p>Quản trị viên cần gán học viên, chức danh hoặc phạm vi tại Đội ngũ Aura. Không cần mở thêm trang quản trị cho tài khoản Staff.</p></div></section>}
    {!scopeLoading && (workspace || canUseSales || canUseRenewals) && (canViewStudents || canViewSchedule || canReviewNutrition || canUseSales || canUseRenewals) && <>
    <nav className="opv2-tabs" aria-label="Khu vực làm việc HLV">
      {canViewStudents && <button className={`opv2-tab ${tab === 'students' ? 'is-active' : ''}`} onClick={() => setTab('students')}><UsersRound size={16} /> Học viên PT</button>}
      {canViewSchedule && <button className={`opv2-tab ${tab === 'schedule' ? 'is-active' : ''}`} onClick={() => setTab('schedule')}><CalendarClock size={16} /> Lịch dạy</button>}
      {canReviewNutrition && <button className={`opv2-tab ${tab === 'nutrition' ? 'is-active' : ''}`} onClick={() => setTab('nutrition')}><Soup size={16} /> Duyệt món ăn</button>}
      {canUseSales && <button className={`opv2-tab ${tab === 'sales' ? 'is-active' : ''}`} onClick={() => setTab('sales')}><BadgeDollarSign size={16} /> Báo giá</button>}
      {canUseRenewals && <button className={`opv2-tab ${tab === 'renewals' ? 'is-active' : ''}`} onClick={() => setTab('renewals')}><RefreshCw size={16} /> Tái ký</button>}
      {canViewRequests && <button className={`opv2-tab ${tab === 'requests' ? 'is-active' : ''}`} onClick={() => setTab('requests')}><Clock3 size={16} /> Yêu cầu {pendingCount > 0 && <i>{pendingCount}</i>}</button>}
    </nav>
    {workspace && ['students', 'schedule', 'requests'].includes(tab) && <section className="opv2-summary"><div className="opv2-stat"><strong>{workspace.counts.primaryStudents}</strong><span>học viên PT chính</span></div><div className="opv2-stat"><strong>{workspace.counts.secondaryStudents}</strong><span>học viên PT phụ</span></div><div className="opv2-stat"><strong>{workspace.counts.teachingSessions}</strong><span>buổi được phân công</span></div></section>}
    {notice && <div className="opv2-notice"><CheckCircle2 size={18} /> {notice}</div>}
    {loading && tab !== 'nutrition' && <div className="opv2-state"><RefreshCw className="is-spinning" /> Đang đồng bộ phạm vi làm việc…</div>}
    {error && trainerDataTab && !requestTarget && <div className="opv2-state is-error">{error}<button className="opv2-action" onClick={() => void load()}>Thử lại</button></div>}

    {tab === 'nutrition' && canReviewNutrition && <NutritionReviewWorkspace compact title="Bữa ăn học viên tôi phụ trách" />}
    {tab === 'sales' && canUseSales && <Suspense fallback={<div className="opv2-state"><RefreshCw className="is-spinning" /> Đang mở báo giá…</div>}><SalesWorkspace embedded /></Suspense>}
    {tab === 'renewals' && canUseRenewals && <Suspense fallback={<div className="opv2-state"><RefreshCw className="is-spinning" /> Đang mở hồ sơ tái ký…</div>}><RenewalWorkspace /></Suspense>}

    {!loading && !error && tab === 'students' && <><h2 className="opv2-section-title">Học viên được phân công</h2><div className="opv2-list">{students.map((student) => <article className="opv2-card" key={student.id}><div className="opv2-card-head"><div><h3>{student.name}</h3><p>{student.phone || 'Chưa có số điện thoại'}</p></div><span className="opv2-badge">{student.assignmentRole === 'primary' ? 'PT chính' : 'PT phụ'}</span></div><p>Hợp đồng: {student.contract ? `${student.contract.usedSessions}/${student.contract.totalSessions} buổi` : 'Chưa có'}</p></article>)}{students.length === 0 && <div className="opv2-state">Chưa có học viên PT được phân công.</div>}</div></>}

    {!loading && !error && tab === 'schedule' && <><div className="opv2-toolbar"><div><h2 className="opv2-section-title">Lịch dạy sắp tới</h2><p>Đổi/hủy phải gửi trước giờ tập ít nhất 12 giờ.</p></div><input className="opv2-date" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div><div className="opv2-list">{sessions.map((session) => {
      const requestable = ['scheduled', 'rescheduled'].includes(session.status) && Boolean(session.contractId) && sessionStartsAt(session) - Date.now() >= 12 * 60 * 60 * 1000
      return <article className="opv2-card" key={session.id}><div className="opv2-card-head"><div><h3>{session.date} · {String(session.hour ?? '--').padStart(2, '0')}:00</h3><p>{studentNames.get(session.studentId) || 'Học viên chưa đồng bộ tên'}</p></div><span className="opv2-badge">{session.status}</span></div><div className="opv2-card-actions"><button className="opv2-action is-secondary" disabled={!requestable} title={!requestable ? 'Đã qua hạn 12 giờ hoặc buổi chưa liên kết hợp đồng' : undefined} onClick={() => openRequest(session)}>Đổi / hủy</button><button className="opv2-action" disabled={!['scheduled', 'rescheduled'].includes(session.status)} onClick={() => void confirm(session)}>Xác nhận đã tập</button></div></article>
    })}{sessions.length === 0 && <div className="opv2-state">Không có buổi tập trong khoảng này.</div>}</div></>}

    {!loading && !error && tab === 'requests' && <>
      <section className="opv2-guidance"><CircleAlert size={20} /><div><strong>Phân biệt OFF học viên và nghỉ ca PT</strong><p>OFF/Bảo lưu là quyền lợi hợp đồng của học viên. PT nghỉ ca gửi đổi/hủy từng buổi tại tab Lịch 14 ngày; nghỉ nhiều ngày cần báo quản lý để đánh dấu PT OFF trên ma trận trước khi publish.</p></div></section>
      <h2 className="opv2-section-title">Lịch sử yêu cầu của tôi</h2>
      <div className="opv2-list">{requests.map((request) => <article className="opv2-card" key={request.id}><div className="opv2-card-head"><div><h3>{request.type === 'cancel' ? 'Xin hủy ca dạy' : 'Xin đổi ca dạy'}</h3><p>{request.originalDate} · {String(request.originalHour ?? '--').padStart(2, '0')}:00 · {studentNames.get(request.studentId) || 'Học viên Aura'}</p></div><span className={`opv2-badge is-${request.status}`}>{requestStatus(request.status)}</span></div>{request.type === 'reschedule' && request.newDate && <p>Đề xuất: {request.newDate} · {String(request.newHour ?? '--').padStart(2, '0')}:00</p>}<p>{request.reason}</p></article>)}{requests.length === 0 && <div className="opv2-state">Bạn chưa gửi yêu cầu đổi hoặc hủy ca nào.</div>}</div>
    </>}

    {requestTarget && <div className="opv2-sheet-layer" role="presentation"><button type="button" className="opv2-sheet-backdrop" aria-label="Đóng" onClick={() => setRequestTarget(null)} /><section className="opv2-sheet" role="dialog" aria-modal="true" aria-labelledby="trainer-request-title"><header><div><small>AURA PT · YÊU CẦU CA DẠY</small><h2 id="trainer-request-title">Đổi hoặc hủy lịch</h2></div><button type="button" aria-label="Đóng" onClick={() => setRequestTarget(null)}><X size={19} /></button></header><p className="opv2-sheet-current">Buổi {requestTarget.date} · {String(requestTarget.hour ?? '--').padStart(2, '0')}:00</p><form onSubmit={submitRequest}><div className="opv2-sheet-segment"><button type="button" className={requestType === 'cancel' ? 'active' : ''} onClick={() => setRequestType('cancel')}>Hủy ca</button><button type="button" className={requestType === 'reschedule' ? 'active' : ''} onClick={() => setRequestType('reschedule')}>Đổi ca</button></div>{requestType === 'reschedule' && <div className="opv2-sheet-fields"><label>Ngày mới<input type="date" value={requestDate} onChange={(event) => setRequestDate(event.target.value)} /></label><label>Giờ mới<select value={requestHour} onChange={(event) => setRequestHour(event.target.value)}><option value="">Chọn giờ</option>{[6,7,8,9,10,11,14,15,16,17,18,19,20].map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select></label></div>}<label>Lý do<textarea maxLength={500} value={requestReason} onChange={(event) => setRequestReason(event.target.value)} placeholder="Nêu rõ lý do để quản lý xử lý…" /></label>{error && <p className="opv2-form-error">{error}</p>}<footer><button type="button" onClick={() => setRequestTarget(null)}>Để sau</button><button type="submit" disabled={submitting}>{submitting ? 'Đang gửi…' : 'Gửi yêu cầu'}</button></footer></form></section></div>}
    </>}
  </section>
}
