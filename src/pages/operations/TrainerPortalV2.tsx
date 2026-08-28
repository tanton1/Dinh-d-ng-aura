import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, CheckCheck, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, Clock3, MapPin, Phone, RefreshCw, Search, Timer, UserCheck, UserX, X } from 'lucide-react'
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
function addDateDays(value: string, amount: number) {
  return dateString(new Date(Date.parse(`${value}T12:00:00+07:00`) + amount * 86_400_000))
}
function mondayOf(value: string) {
  const weekday = new Date(`${value}T12:00:00+07:00`).getUTCDay()
  return addDateDays(value, -((weekday + 6) % 7))
}
function compactDate(value: string) {
  const [, month, day] = value.split('-')
  return `${day}/${month}`
}
function normalizedSearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('vi-VN').trim()
}
function alertsForStudent(student: TrainerStudentSummary) {
  return Array.isArray(student.alerts) ? student.alerts : []
}

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

export default function TrainerPortalV2({ section = 'students', embedded = false, isDemo = false }: { section?: TrainerWorkspaceSection; embedded?: boolean; isDemo?: boolean }) {
  const [workspace, setWorkspace] = useState<CoachWorkspaceScope | null>(null)
  const [scopeLoading, setScopeLoading] = useState(true)
  const [scopeError, setScopeError] = useState('')
  const [students, setStudents] = useState<TrainerStudentSummary[]>([])
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([])
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
  const [studentQuery, setStudentQuery] = useState('')
  const [studentBranch, setStudentBranch] = useState('all')
  const [studentScope, setStudentScope] = useState<'all' | 'attention' | 'primary' | 'secondary' | 'schedule'>('all')
  const canViewStudents = workspace?.tabs.students === true
  const canViewSchedule = workspace?.tabs.schedule === true
  const canViewRequests = workspace?.tabs.requests === true
  const canOpenSection = section === 'students'
    ? canViewStudents
    : section === 'schedule'
      ? canViewSchedule
      : canViewRequests
  const rangeFrom = useMemo(() => section === 'schedule' ? mondayOf(from) : from, [from, section])
  const to = useMemo(() => addDateDays(rangeFrom, 13), [rangeFrom])
  const studentNames = useMemo(() => new Map([
    ...students.map((student) => [student.id, student.name] as const),
    ...sessions.filter((session) => session.studentName).map((session) => [session.studentId, session.studentName as string] as const),
  ]), [sessions, students])
  const branchNames = useMemo(() => new Map(branches.map((branch) => [branch.id, branch.name])), [branches])
  const scheduledByStudent = useMemo(() => {
    const mapped = new Map<string, TrainerSessionSummary[]>()
    sessions.filter((session) => ['scheduled', 'rescheduled', 'completed', 'attended', 'no_show'].includes(session.status)).forEach((session) => {
      mapped.set(session.studentId, [...(mapped.get(session.studentId) || []), session])
    })
    mapped.forEach((items) => items.sort((left, right) => `${left.date}-${left.hour ?? 0}`.localeCompare(`${right.date}-${right.hour ?? 0}`)))
    return mapped
  }, [sessions])
  const filteredStudents = useMemo(() => {
    const query = normalizedSearch(studentQuery)
    return students.filter((student) => {
      const matchesQuery = !query || normalizedSearch(`${student.name} ${student.phone} ${student.email}`).includes(query)
      const matchesBranch = studentBranch === 'all' || student.branchId === studentBranch
      const matchesScope = studentScope === 'all'
        || (studentScope === 'attention' && alertsForStudent(student).length > 0)
        || student.assignmentRole === studentScope
        || (studentScope === 'schedule' && scheduledByStudent.has(student.id))
      return matchesQuery && matchesBranch && matchesScope
    }).sort((left, right) => {
      const rank = (student: TrainerStudentSummary) => alertsForStudent(student).some((item) => item.severity === 'critical')
        ? 0
        : alertsForStudent(student).some((item) => item.severity === 'warning') ? 1 : 2
      return rank(left) - rank(right) || left.name.localeCompare(right.name, 'vi')
    })
  }, [scheduledByStudent, studentBranch, studentQuery, studentScope, students])
  const load = useCallback(async () => {
    setScopeLoading(true); setLoading(true); setScopeError(''); setError('')
    if (isDemo) {
      const demoSessions: TrainerSessionSummary[] = [
        { id: 'staff-week-1', studentId: 'student-a', trainerId: 'demo-staff', studentName: 'Nguyễn Minh Anh', date: rangeFrom, hour: 8, status: 'attended', attendanceStatus: 'present', billingStatus: 'charged', contractId: 'contract-a', revision: 1, timeZone: 'Asia/Ho_Chi_Minh' },
        { id: 'staff-week-2', studentId: 'student-b', trainerId: 'demo-staff', studentName: 'Trần Thu Hà', date: rangeFrom, hour: 8, status: 'attended', attendanceStatus: 'present', billingStatus: 'charged', contractId: 'contract-b', revision: 1, timeZone: 'Asia/Ho_Chi_Minh' },
        { id: 'staff-week-3', studentId: 'student-c', trainerId: 'demo-staff', studentName: 'Lê Ngọc Mai', date: addDateDays(rangeFrom, 2), hour: 18, status: 'scheduled', attendanceStatus: 'pending', billingStatus: 'pending', contractId: 'contract-c', revision: 1, timeZone: 'Asia/Ho_Chi_Minh' },
        { id: 'staff-week-4', studentId: 'student-d', trainerId: 'demo-staff', studentName: 'Phạm Thảo Vy', date: addDateDays(rangeFrom, 4), hour: 7, status: 'scheduled', attendanceStatus: 'pending', billingStatus: 'pending', contractId: 'contract-d', revision: 1, timeZone: 'Asia/Ho_Chi_Minh' },
      ]
      setWorkspace({ schemaVersion: 1, source: 'pt_contract_assignments', staffId: 'demo-staff', tabs: { students: true, schedule: true, requests: true, nutrition: true }, counts: { primaryStudents: 3, secondaryStudents: 1, nutritionStudents: 2, teachingSessions: 4, pendingRequests: 1 } })
      setStudents(section === 'students' ? [
        { id: 'student-a', name: 'Nguyễn Minh Anh', phone: '0900000001', email: '', branchId: 'branch-demo', status: 'active', sessionsPerWeek: 3, assignmentRole: 'primary', alerts: [{ code: 'AVAILABILITY_LOW', severity: 'warning', title: 'Lịch rảnh mới có 3/5 khung', message: 'Khuyến khích học viên bổ sung 2 khung để dễ xếp đủ buổi.', dueDate: rangeFrom }], availabilitySlotCount: 3, minimumAvailabilitySlots: 5, availabilityWeekId: rangeFrom, contract: { id: 'contract-a', status: 'active', totalSessions: 36, usedSessions: 12 } },
        { id: 'student-b', name: 'Trần Thu Hà', phone: '0900000002', email: '', branchId: 'branch-demo', status: 'active', sessionsPerWeek: 2, assignmentRole: 'secondary', alerts: [{ code: 'PAYMENT_OVERDUE', severity: 'critical', title: 'Kỳ thanh toán đã quá hạn', message: 'Lịch trả góp cần được bộ phận phụ trách đối soát và liên hệ học viên.', dueDate: rangeFrom }], availabilitySlotCount: 5, minimumAvailabilitySlots: 5, availabilityWeekId: rangeFrom, contract: { id: 'contract-b', status: 'active', totalSessions: 72, usedSessions: 21 } },
      ] : [])
      setBranches([{ id: 'branch-demo', name: 'Chi nhánh Aura' }])
      setSessions(demoSessions)
      setRequests(section === 'students' ? [] : [{ id: 'request-demo', sessionId: 'staff-week-3', studentId: 'student-c', contractId: 'contract-c', type: 'reschedule', status: 'pending', originalDate: addDateDays(rangeFrom, 2), originalHour: 18, newDate: addDateDays(rangeFrom, 3), newHour: 18, reason: 'Đề nghị đổi ca theo lịch làm việc' }])
      setScopeLoading(false); setLoading(false); return
    }
    try {
      if (section === 'students') {
        const [result, scheduleResult] = await Promise.all([
          getMyTrainerWorkspace('students', rangeFrom, to, 200),
          getMyTrainerWorkspace('schedule', rangeFrom, addDateDays(rangeFrom, 61), 500),
        ])
        const merged = new Map(result.students.map((student) => [student.id, student]))
        scheduleResult.sessions.forEach((session) => {
          if (merged.has(session.studentId)) return
          merged.set(session.studentId, {
            id: session.studentId,
            name: session.studentName || 'Học viên Aura',
            phone: session.studentPhone || '',
            email: session.studentEmail || '',
            branchId: session.studentBranchId || '',
            status: 'active',
            sessionsPerWeek: 0,
            assignmentRole: 'schedule',
            alerts: [],
            availabilitySlotCount: 0,
            minimumAvailabilitySlots: 5,
            contract: null,
          })
        })
        setWorkspace(result.scope)
        setStudents([...merged.values()].sort((left, right) => left.name.localeCompare(right.name, 'vi')))
        setBranches(result.branches || [])
        setSessions(scheduleResult.sessions)
        setRequests([])
        return
      }
      const result = await getMyTrainerWorkspace(section, rangeFrom, to)
      setWorkspace(result.scope)
      setStudents(result.students)
      setBranches(result.branches || [])
      setSessions(result.sessions)
      setRequests(result.requests ?? [])
    } catch (cause) {
      setScopeError(cause instanceof Error ? cause.message : 'Không thể tải dữ liệu được phân công.')
    } finally {
      setScopeLoading(false); setLoading(false)
    }
  }, [isDemo, rangeFrom, section, to])
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

  return <section className={`opv2-page${embedded ? ' is-embedded' : ''}${section === 'students' ? ' is-students' : ''}`}>
    {!embedded && section === 'students' && <header className="opv2-student-heading"><div><p className="opv2-kicker-dark">AURA STAFF · HỌC VIÊN</p><h1>Học viên phụ trách</h1><p>Hợp nhất học viên được giao và học viên có trong lịch dạy của bạn.</p></div><button type="button" aria-label="Tải lại học viên" disabled={loading} onClick={() => void load()}><RefreshCw className={loading ? 'is-spinning' : ''} /></button></header>}
    {!embedded && section !== 'students' && <section className="opv2-hero"><p className="opv2-kicker">Aura Staff · Công việc</p><h1>{sectionCopy[section].title}</h1><p>{sectionCopy[section].description}</p></section>}
    {scopeLoading && <div className="opv2-state"><RefreshCw className="is-spinning" /> Đang đối chiếu phân công trong Học viên PT Gym…</div>}
    {!scopeLoading && scopeError && <div className="opv2-state is-error">{scopeError}<button className="opv2-action" onClick={() => void load()}>Kết nối lại</button></div>}
    {!scopeLoading && workspace && !canOpenSection && <section className="opv2-guidance"><CircleAlert size={20} /><div><strong>Chưa có dữ liệu được phân công</strong><p>Trang này chỉ hiển thị dữ liệu gắn trực tiếp với tài khoản Staff của bạn. Quản trị viên có thể cập nhật PT chính, PT phụ hoặc lịch dạy tại hồ sơ học viên.</p></div></section>}
    {!scopeLoading && workspace && canOpenSection && <>
    {!embedded && section !== 'students' && <section className="opv2-summary"><div className="opv2-stat"><strong>{workspace.counts.primaryStudents}</strong><span>học viên PT chính</span></div><div className="opv2-stat"><strong>{workspace.counts.secondaryStudents}</strong><span>học viên PT phụ</span></div><div className="opv2-stat"><strong>{workspace.counts.teachingSessions}</strong><span>buổi được phân công</span></div></section>}
    {notice && <div className="opv2-notice"><CheckCircle2 size={18} /> {notice}</div>}
    {loading && <div className="opv2-state"><RefreshCw className="is-spinning" /> Đang đồng bộ phạm vi làm việc…</div>}
    {error && !requestTarget && <div className="opv2-state is-error">{error}<button className="opv2-action" onClick={() => void load()}>Thử lại</button></div>}

    {!loading && !error && section === 'students' && <>
      <section className="opv2-student-metrics" aria-label="Tổng hợp học viên phụ trách"><div className="is-alert"><strong>{students.filter((item) => alertsForStudent(item).length > 0).length}</strong><span>Cần xử lý</span></div><div><strong>{students.length}</strong><span>Tất cả</span></div><div><strong>{students.filter((item) => item.assignmentRole === 'primary').length}</strong><span>PT chính</span></div><div><strong>{students.filter((item) => item.assignmentRole === 'secondary').length}</strong><span>PT phụ</span></div><div><strong>{scheduledByStudent.size}</strong><span>Có lịch dạy</span></div></section>
      <section className="opv2-student-filters" aria-label="Lọc học viên">
        <label className="is-search"><Search /><input aria-label="Tìm học viên" value={studentQuery} onChange={(event) => setStudentQuery(event.target.value)} placeholder="Tên hoặc số điện thoại" /></label>
        <label><MapPin /><select aria-label="Lọc theo chi nhánh" value={studentBranch} onChange={(event) => setStudentBranch(event.target.value)}><option value="all">Tất cả chi nhánh</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        <label><UserCheck /><select aria-label="Lọc theo phân công" value={studentScope} onChange={(event) => setStudentScope(event.target.value as typeof studentScope)}><option value="all">Mọi học viên</option><option value="attention">Cần xử lý</option><option value="primary">PT chính</option><option value="secondary">PT phụ</option><option value="schedule">Có lịch dạy</option></select></label>
      </section>
      <div className="opv2-student-result"><h2>{filteredStudents.length} học viên</h2><span>{studentBranch === 'all' ? 'Tất cả chi nhánh trong phạm vi' : branchNames.get(studentBranch) || 'Chi nhánh đã chọn'}</span></div>
      <div className="opv2-list opv2-student-list">{filteredStudents.map((student) => {
        const studentSessions = scheduledByStudent.get(student.id) || []
        const studentAlerts = alertsForStudent(student)
        const remaining = student.contract ? Math.max(0, student.contract.totalSessions - student.contract.usedSessions) : null
        return <article className={`opv2-card opv2-student-card${studentAlerts.length ? ' has-alerts' : ''}`} key={student.id}>
          <div className="opv2-card-head"><div><h3>{student.name}</h3><p>{student.phone ? <><Phone size={13} /> {student.phone}</> : 'Chưa có số điện thoại'}</p></div><span className="opv2-badge">{student.assignmentRole === 'primary' ? 'PT chính' : student.assignmentRole === 'secondary' ? 'PT phụ' : 'Theo lịch dạy'}</span></div>
          <div className="opv2-student-meta"><span><MapPin /> {branchNames.get(student.branchId) || (student.branchId ? 'Chi nhánh được phân công' : 'Chưa xác định chi nhánh')}</span><span>{remaining === null ? 'Hợp đồng cần đối chiếu' : `Còn ${remaining}/${student.contract?.totalSessions || 0} buổi`}</span></div>
          {studentAlerts.length > 0 && <div className="opv2-student-alerts" aria-label={`Cảnh báo của ${student.name}`}>{studentAlerts.slice(0, 3).map((alert, index) => <div className={`is-${alert.severity}`} key={`${alert.code}-${alert.dueDate || index}`}><CircleAlert /><span><strong>{alert.title}</strong><small>{alert.message}</small></span></div>)}{studentAlerts.length > 3 && <em>+{studentAlerts.length - 3} cảnh báo khác</em>}</div>}
          <div className="opv2-student-schedule"><strong><CalendarDays /> Lịch dạy được phân</strong>{studentSessions.length ? <div>{studentSessions.slice(0, 3).map((session) => <span key={session.id}>{compactDate(session.date)} · {String(session.hour ?? '--').padStart(2, '0')}:00</span>)}</div> : <small>Chưa có ca trong 62 ngày tới</small>}</div>
        </article>
      })}{filteredStudents.length === 0 && <div className="opv2-state">Không có học viên phù hợp bộ lọc.</div>}</div>
    </>}

    {!loading && !error && section === 'schedule' && (() => {
      const now = clockNow
      const daySessions = sessions.filter((session) => session.date === from && ['scheduled', 'rescheduled', 'completed', 'attended', 'no_show'].includes(session.status))
      const confirmed = daySessions.filter((session) => attendanceState(session) !== 'pending')
      const pendingStarted = daySessions.filter((session) => attendanceState(session) === 'pending' && sessionStartsAt(session) <= now)
      const future = daySessions.filter((session) => sessionStartsAt(session) > now)
      const weekDays = Array.from({ length: 6 }, (_, index) => ({ date: addDateDays(rangeFrom, index), label: `T${index + 2}` }))
      const matrixHours = [...new Set([6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 19, 20, ...sessions.map((session) => session.hour).filter((hour): hour is number => Number.isInteger(hour))])].sort((a, b) => a - b)
      const matrixIndex = new Map<string, TrainerSessionSummary[]>()
      sessions.forEach((session) => {
        if (!weekDays.some((day) => day.date === session.date) || !Number.isInteger(session.hour) || ['cancelled', 'student_cancelled', 'trainer_cancelled'].includes(session.status)) return
        const key = `${session.date}:${session.hour}`
        matrixIndex.set(key, [...(matrixIndex.get(key) || []), session])
      })
      return <>
        <section className="opv2-week-card">
          <header><div><p className="opv2-kicker-dark">Ma trận tuần</p><h2>{compactDate(rangeFrom)} – {compactDate(addDateDays(rangeFrom, 5))}</h2></div><div><button type="button" aria-label="Tuần trước" onClick={() => setFrom(addDateDays(rangeFrom, -7))}><ChevronLeft /></button><button type="button" aria-label="Tuần sau" onClick={() => setFrom(addDateDays(rangeFrom, 7))}><ChevronRight /></button></div></header>
          <div className="opv2-week-scroll" role="region" aria-label="Ma trận lịch dạy chi tiết cả tuần" tabIndex={0}>
            <div className="opv2-week-matrix">
              <span className="opv2-week-corner">Giờ</span>
              {weekDays.map((day) => <button type="button" key={day.date} className={`opv2-week-day${from === day.date ? ' is-selected' : ''}`} onClick={() => setFrom(day.date)}><strong>{day.label}</strong><small>{compactDate(day.date)}</small></button>)}
              {matrixHours.map((hour) => <div className="opv2-week-row" key={hour}>
                <time>{String(hour).padStart(2, '0')}:00</time>
                {weekDays.map((day) => {
                  const items = matrixIndex.get(`${day.date}:${hour}`) || []
                  const pending = items.some((item) => attendanceState(item) === 'pending' && sessionStartsAt(item) <= now)
                  const done = items.length > 0 && items.every((item) => attendanceState(item) !== 'pending')
                  return <button type="button" key={day.date} className={`opv2-week-cell${items.length ? ' has-session' : ''}${pending ? ' is-pending' : ''}${done ? ' is-done' : ''}`} aria-label={`${day.label} ${String(hour).padStart(2, '0')}:00, ${items.length} học viên`} onClick={() => setFrom(day.date)}>
                    {items.length ? <><b>{items.length}/2</b>{items.slice(0, 2).map((item) => <span key={item.id}>{studentNames.get(item.studentId) || item.studentName || 'Học viên'}</span>)}</> : <i>—</i>}
                  </button>
                })}
              </div>)}
            </div>
          </div>
          <footer><span><i className="is-done" /> Đã xác nhận</span><span><i className="is-pending" /> Chờ PT</span><span><i /> Sắp tới</span></footer>
        </section>
        <div className="opv2-toolbar opv2-today-toolbar"><div><p className="opv2-kicker-dark">Chi tiết ngày</p><h2 className="opv2-section-title">{compactDate(from)}</h2></div><input className="opv2-date" aria-label="Ngày lịch dạy" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div>
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
              <p className={charged ? 'is-charged' : ''}>{charged ? 'Đã tự động tính 1 buổi' : session.billingStatus === 'review_required' ? 'PT vẫn xác nhận hiện diện · quản lý đang đối soát quota' : started ? 'Hệ thống đang hoàn tất tính buổi' : 'Chưa tới giờ · chưa tính buổi'}</p>
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
