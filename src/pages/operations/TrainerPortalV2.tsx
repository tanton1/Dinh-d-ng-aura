import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, CalendarDays, CheckCheck, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, Clock3, Dumbbell, History, MapPin, Phone, RefreshCw, Search, Timer, UserCheck, UserX, X } from 'lucide-react'
import {
  bulkConfirmMySessions,
  getMyTrainerStudentDetail,
  getMyTrainerWorkspace,
  recordMySessionAttendance,
  requestSessionChange,
  type TrainerSessionRequestSummary,
  type TrainerSessionSummary,
  type TrainerStudentSummary,
  type TrainerStudentDetail,
  type CoachWorkspaceScope,
} from '../../services/ptOperationsV2Service'
import TrainingHistoryPanel from '../../components/admin/pt/TrainingHistoryPanel'
import type { ViewId } from '../../types'
import './OperationsPortalV2.css'
import './OperationsAttendance.css'

export type TrainerWorkspaceSection = 'students' | 'schedule' | 'requests'

const sectionCopy: Record<TrainerWorkspaceSection, { title: string; description: string }> = {
  students: {
    title: 'Học viên phụ trách',
    description: 'Chỉ hiển thị học viên được phân công và đang có hợp đồng còn hiệu lực.',
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '—'
  const [, month, day] = value.split('-')
  return `${day}/${month}`
}
function normalizedSearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('vi-VN').trim()
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

function availabilitySourceCopy(detail: TrainerStudentDetail['availability']) {
  if (detail.source === 'weekly') return { label: 'Tuần hiện tại', note: 'Học viên đã gửi hoặc điều chỉnh riêng cho tuần này.' }
  if (detail.source === 'inherited_weekly' && detail.sourceWeekId) {
    return { label: 'Lịch gần nhất', note: `Không có điều chỉnh tuần này · đang kế thừa lịch đã gửi từ tuần ${compactDate(detail.sourceWeekId)}.` }
  }
  if (detail.source === 'legacy_default' && detail.confirmed) return { label: 'Lịch mặc định', note: 'Chưa có lịch theo tuần · đang dùng lịch hồ sơ đã xác nhận.' }
  if (detail.source === 'legacy_default') return { label: 'Chưa xác nhận', note: 'Có lịch cũ trong hồ sơ nhưng học viên chưa xác nhận, nên chưa dùng để tự động xếp lịch.' }
  return { label: 'Chưa đăng ký', note: 'Chưa có lịch tuần hiện tại hoặc lịch đã gửi gần nhất để kế thừa.' }
}

export default function TrainerPortalV2({ section = 'students', embedded = false, isDemo = false, onNavigate }: { section?: TrainerWorkspaceSection; embedded?: boolean; isDemo?: boolean; onNavigate?: (view: ViewId, studentId?: string, studentName?: string) => void }) {
  const [workspace, setWorkspace] = useState<CoachWorkspaceScope | null>(null)
  const [scopeLoading, setScopeLoading] = useState(true)
  const [scopeError, setScopeError] = useState('')
  const [students, setStudents] = useState<TrainerStudentSummary[]>([])
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([])
  const [sessions, setSessions] = useState<TrainerSessionSummary[]>([])
  const [requests, setRequests] = useState<TrainerSessionRequestSummary[]>([])
  const [from, setFrom] = useState(dateString(new Date()))
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
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
  const [studentScope, setStudentScope] = useState<'all' | 'primary' | 'secondary' | 'schedule'>('all')
  const [detailTarget, setDetailTarget] = useState<TrainerStudentSummary | null>(null)
  const [studentDetail, setStudentDetail] = useState<TrainerStudentDetail | null>(null)
  const [detailTab, setDetailTab] = useState<'overview' | 'history' | 'workout'>('overview')
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const detailRequestRef = useRef(0)
  const loadedRef = useRef(false)
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
        || student.assignmentRole === studentScope
        || (studentScope === 'schedule' && scheduledByStudent.has(student.id))
      return matchesQuery && matchesBranch && matchesScope
    }).sort((left, right) => left.name.localeCompare(right.name, 'vi'))
  }, [scheduledByStudent, studentBranch, studentQuery, studentScope, students])
  const load = useCallback(async () => {
    if (loadedRef.current) setRefreshing(true)
    else { setScopeLoading(true); setLoading(true) }
    setScopeError(''); setError('')
    if (isDemo) {
      const demoSessions: TrainerSessionSummary[] = [
        { id: 'staff-week-1', studentId: 'student-a', trainerId: 'demo-staff', studentName: 'Nguyễn Minh Anh', date: rangeFrom, hour: 8, status: 'attended', attendanceStatus: 'present', billingStatus: 'charged', contractId: 'contract-a', revision: 1, timeZone: 'Asia/Ho_Chi_Minh' },
        { id: 'staff-week-2', studentId: 'student-b', trainerId: 'demo-staff', studentName: 'Trần Thu Hà', date: rangeFrom, hour: 8, status: 'attended', attendanceStatus: 'present', billingStatus: 'charged', contractId: 'contract-b', revision: 1, timeZone: 'Asia/Ho_Chi_Minh' },
        { id: 'staff-week-3', studentId: 'student-c', trainerId: 'demo-staff', studentName: 'Lê Ngọc Mai', date: addDateDays(rangeFrom, 2), hour: 18, status: 'scheduled', attendanceStatus: 'pending', billingStatus: 'pending', contractId: 'contract-c', revision: 1, timeZone: 'Asia/Ho_Chi_Minh' },
        { id: 'staff-week-4', studentId: 'student-d', trainerId: 'demo-staff', studentName: 'Phạm Thảo Vy', date: addDateDays(rangeFrom, 4), hour: 7, status: 'scheduled', attendanceStatus: 'pending', billingStatus: 'pending', contractId: 'contract-d', revision: 1, timeZone: 'Asia/Ho_Chi_Minh' },
      ]
      setWorkspace({ schemaVersion: 1, source: 'pt_contract_assignments', staffId: 'demo-staff', tabs: { students: true, schedule: true, requests: true, nutrition: true }, counts: { primaryStudents: 3, secondaryStudents: 1, nutritionStudents: 2, teachingSessions: 4, pendingRequests: 1 } })
      setStudents(section === 'students' ? [
        { id: 'student-a', name: 'Nguyễn Minh Anh', phone: '0900000001', email: '', branchId: 'branch-demo', status: 'active', sessionsPerWeek: 3, assignmentRole: 'primary', contract: { id: 'contract-a', status: 'active', totalSessions: 36, usedSessions: 12 } },
        { id: 'student-b', name: 'Trần Thu Hà', phone: '0900000002', email: '', branchId: 'branch-demo', status: 'active', sessionsPerWeek: 2, assignmentRole: 'secondary', contract: { id: 'contract-b', status: 'active', totalSessions: 72, usedSessions: 21 } },
      ] : [])
      setBranches([{ id: 'branch-demo', name: 'Chi nhánh Aura' }])
      setSessions(demoSessions)
      setRequests(section === 'students' ? [] : [{ id: 'request-demo', sessionId: 'staff-week-3', studentId: 'student-c', contractId: 'contract-c', type: 'reschedule', status: 'pending', originalDate: addDateDays(rangeFrom, 2), originalHour: 18, newDate: addDateDays(rangeFrom, 3), newHour: 18, reason: 'Đề nghị đổi ca theo lịch làm việc' }])
      loadedRef.current = true; setScopeLoading(false); setLoading(false); setRefreshing(false); return
    }
    try {
      if (section === 'students') {
        const result = await getMyTrainerWorkspace('students', rangeFrom, addDateDays(rangeFrom, 61), 500)
        const merged = new Map(result.students.map((student) => [student.id, student]))
        result.sessions.forEach((session) => {
          if (merged.has(session.studentId) || !session.contractEffective || !session.contract) return
          merged.set(session.studentId, {
            id: session.studentId,
            name: session.studentName || 'Học viên Aura',
            phone: session.studentPhone || '',
            email: session.studentEmail || '',
            branchId: session.studentBranchId || '',
            status: 'active',
            sessionsPerWeek: 0,
            assignmentRole: 'schedule',
            contract: session.contract,
          })
        })
        setWorkspace(result.scope)
        setStudents([...merged.values()].sort((left, right) => left.name.localeCompare(right.name, 'vi')))
        setBranches(result.branches || [])
        setSessions(result.sessions)
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
      loadedRef.current = true; setScopeLoading(false); setLoading(false); setRefreshing(false)
    }
  }, [isDemo, rangeFrom, section, to])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const openStudentDetail = async (student: TrainerStudentSummary) => {
    const requestId = detailRequestRef.current + 1
    detailRequestRef.current = requestId
    setDetailTarget(student)
    setStudentDetail(null)
    setDetailTab('overview')
    setDetailError('')
    setDetailLoading(true)
    if (isDemo) {
      const demoContract = student.contract
      setStudentDetail({
        schemaVersion: 2,
        formulaVersion: 'contract-usage-v2',
        student: { id: student.id, name: student.name, phone: student.phone, email: student.email, branchId: student.branchId },
        contracts: demoContract ? [{
          id: demoContract.id,
          packageName: 'Gói PT Aura',
          status: demoContract.status,
          startDate: demoContract.startDate || rangeFrom,
          endDate: demoContract.endDate || addDateDays(rangeFrom, 90),
          totalSessions: demoContract.totalSessions,
          usedSessions: demoContract.usedSessions,
          remainingSessions: demoContract.remainingSessions ?? Math.max(0, demoContract.totalSessions - demoContract.usedSessions),
          chargedSessions: demoContract.chargedSessions ?? demoContract.usedSessions,
          historySessions: demoContract.historySessions ?? demoContract.usedSessions,
          reconciliationStatus: demoContract.reconciliationStatus || 'matched',
          schedulableToday: true,
          pausedToday: false,
        }] : [],
        sessions: scheduledByStudent.get(student.id) || [],
        availability: { weekId: mondayOf(rangeFrom), slots: ['T2-8', 'T3-18', 'T5-7', 'T6-18'], status: 'submitted', confirmed: true, locked: false, cutoffAt: '', source: 'weekly', sourceWeekId: mondayOf(rangeFrom) },
        trainingProgram: { id: 'student-a', title: 'Thân dưới & mông', goal: 'Tăng sức mạnh và săn chắc', status: 'active', revision: 2, trainingDayCount: 3, exerciseCount: 18, updatedAt: `${rangeFrom}T09:00:00+07:00`, trainingDays: [{ id: 'day-a', title: 'Mông đùi A', focusMuscles: ['Mông', 'Đùi sau'], notes: '', exercises: [{ id: 'hip-thrust', nameVi: 'Đẩy hông với tạ đòn', targetMuscles: ['Mông'], secondaryMuscles: ['Đùi sau'], sets: 4, repMinimum: 8, repMaximum: 12, targetWeightKg: 30, targetRpe: 8, restSeconds: 75, notes: '' }] }] },
        workoutLogs: [{ id: 'demo-log', date: rangeFrom, programName: 'Thân dưới & mông', completedAt: `${rangeFrom}T09:00:00+07:00` }],
      })
      setDetailLoading(false)
      return
    }
    try {
      const detail = await getMyTrainerStudentDetail(student.id, mondayOf(rangeFrom))
      if (detailRequestRef.current === requestId) setStudentDetail(detail)
    } catch (cause) {
      if (detailRequestRef.current === requestId) setDetailError(cause instanceof Error ? cause.message : 'Chưa thể tải hồ sơ học viên.')
    } finally {
      if (detailRequestRef.current === requestId) setDetailLoading(false)
    }
  }

  const closeStudentDetail = () => {
    detailRequestRef.current += 1
    setDetailTarget(null)
    setStudentDetail(null)
    setDetailError('')
    setDetailLoading(false)
  }

  const markAttendance = async (
    session: TrainerSessionSummary,
    status: 'present' | 'late' | 'no_show',
    lateMinutes?: 5 | 10 | 15,
    details: { noShowReason?: '' | 'busy' | 'sick' | 'forgot' | 'unreachable' | 'other'; note?: string } = {},
  ) => {
    if (attendanceBusy) return
    setAttendanceBusy(session.id); setError('')
    try {
      const result = await recordMySessionAttendance({
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
      setSessions((current) => current.map((item) => item.id === session.id ? {
        ...item,
        revision: result.revision,
        attendanceStatus: status,
        status: status === 'no_show' ? 'no_show' : 'attended',
        billingStatus: 'charged',
        lateMinutes: status === 'late' ? lateMinutes : null,
      } : item))
      setNotice(status === 'no_show' ? 'Đã ghi nhận học viên không đến. Buổi đã tính vẫn được giữ nguyên.' : 'Đã ghi nhận hiện diện. Số buổi không bị tính thêm lần nữa.')
      void load()
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
      const confirmed = new Map(result.results.filter((item) => item.ok).map((item) => [item.sessionId, item.revision]))
      setSessions((current) => current.map((session) => confirmed.has(session.id) ? { ...session, revision: confirmed.get(session.id), attendanceStatus: 'present', status: 'attended', billingStatus: 'charged' } : session))
      setNotice(result.failed ? `Đã xác nhận ${result.confirmed}/${result.total} buổi; ${result.failed} buổi cần tải lại để đối soát.` : `Đã xác nhận ${result.confirmed} học viên đều có tập.`)
      void load()
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
    {!embedded && section === 'students' && <header className="opv2-student-heading"><div><p className="opv2-kicker-dark">AURA STAFF · HỌC VIÊN</p><h1>Học viên phụ trách</h1><p>Học viên được phân công hoặc có lịch dạy, với hợp đồng đang còn thời hạn và số buổi.</p></div><button type="button" aria-label="Tải lại học viên" disabled={loading || refreshing} onClick={() => void load()}><RefreshCw className={loading || refreshing ? 'is-spinning' : ''} /></button></header>}
    {!embedded && section !== 'students' && <section className="opv2-hero"><p className="opv2-kicker">Aura Staff · Công việc</p><h1>{sectionCopy[section].title}</h1><p>{sectionCopy[section].description}</p></section>}
    {scopeLoading && <div className="opv2-state"><RefreshCw className="is-spinning" /> Đang đối chiếu phân công trong Học viên PT Gym…</div>}
    {!scopeLoading && scopeError && <div className="opv2-state is-error" data-testid="staff-workspace-error"><strong>Không thể tải không gian Staff</strong><span>{scopeError}</span><small>Đây không phải trạng thái “chưa có chi nhánh”. Aura cần đối chiếu kết nối hoặc hồ sơ phân quyền của tài khoản.</small><button className="opv2-action" onClick={() => void load()}>Kết nối lại</button></div>}
    {!scopeLoading && workspace && !canOpenSection && <section className="opv2-guidance"><CircleAlert size={20} /><div><strong>Chưa có ca hoặc học viên được phân công</strong><p>Chi nhánh vẫn hoạt động bình thường. Trang này chỉ hiện hợp đồng còn hiệu lực và lịch dạy gắn trực tiếp với tài khoản Staff; quản trị viên có thể cập nhật PT chính, PT phụ hoặc lịch dạy tại hồ sơ học viên.</p></div></section>}
    {!scopeLoading && workspace && canOpenSection && <>
    {!embedded && section !== 'students' && <section className="opv2-summary"><div className="opv2-stat"><strong>{workspace.counts.primaryStudents}</strong><span>học viên PT chính</span></div><div className="opv2-stat"><strong>{workspace.counts.secondaryStudents}</strong><span>học viên PT phụ</span></div><div className="opv2-stat"><strong>{workspace.counts.teachingSessions}</strong><span>buổi được phân công</span></div></section>}
    {notice && <div className="opv2-notice"><CheckCircle2 size={18} /> {notice}</div>}
    {loading && <div className="opv2-state"><RefreshCw className="is-spinning" /> Đang đồng bộ phạm vi làm việc…</div>}
    {error && !requestTarget && <div className="opv2-state is-error">{error}<button className="opv2-action" onClick={() => void load()}>Thử lại</button></div>}

    {!loading && section === 'students' && <>
      <section className="opv2-student-metrics" aria-label="Tổng hợp học viên phụ trách"><div><strong>{students.length}</strong><span>Đang hiệu lực</span></div><div><strong>{students.filter((item) => item.assignmentRole === 'primary').length}</strong><span>PT chính</span></div><div><strong>{students.filter((item) => item.assignmentRole === 'secondary').length}</strong><span>PT phụ</span></div><div><strong>{students.filter((item) => scheduledByStudent.has(item.id)).length}</strong><span>Có lịch dạy</span></div></section>
      <section className="opv2-student-filters" aria-label="Lọc học viên">
        <label className="is-search"><Search /><input aria-label="Tìm học viên" value={studentQuery} onChange={(event) => setStudentQuery(event.target.value)} placeholder="Tên hoặc số điện thoại" /></label>
        <label><MapPin /><select aria-label="Lọc theo chi nhánh" value={studentBranch} onChange={(event) => setStudentBranch(event.target.value)}><option value="all">Tất cả chi nhánh</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        <label><UserCheck /><select aria-label="Lọc theo phân công" value={studentScope} onChange={(event) => setStudentScope(event.target.value as typeof studentScope)}><option value="all">Mọi học viên</option><option value="primary">PT chính</option><option value="secondary">PT phụ</option><option value="schedule">Có lịch dạy</option></select></label>
      </section>
      <div className="opv2-student-result"><h2>{filteredStudents.length} học viên</h2><span>{studentBranch === 'all' ? 'Tất cả chi nhánh trong phạm vi' : branchNames.get(studentBranch) || 'Chi nhánh đã chọn'}</span></div>
      <div className="opv2-list opv2-student-list">{filteredStudents.map((student) => {
        const studentSessions = scheduledByStudent.get(student.id) || []
        const remaining = student.contract ? student.contract.remainingSessions ?? Math.max(0, student.contract.totalSessions - student.contract.usedSessions) : null
        return <article className="opv2-card opv2-student-card" key={student.id}>
          <div className="opv2-card-head"><div><h3>{student.name}</h3><p>{student.phone ? <><Phone size={13} /> {student.phone}</> : 'Chưa có số điện thoại'}</p></div><span className="opv2-badge">{student.assignmentRole === 'primary' ? 'PT chính' : student.assignmentRole === 'secondary' ? 'PT phụ' : 'Theo lịch dạy'}</span></div>
          <div className="opv2-student-meta"><span><MapPin /> {branchNames.get(student.branchId) || (student.branchId ? 'Chi nhánh được phân công' : 'Chưa xác định chi nhánh')}</span><span>{remaining === null ? 'Hợp đồng cần đối chiếu' : `Còn ${remaining}/${student.contract?.totalSessions || 0} buổi`}</span></div>
          <div className="opv2-student-schedule"><strong><CalendarDays /> Lịch dạy được phân</strong>{studentSessions.length ? <div>{studentSessions.slice(0, 3).map((session) => <span key={session.id}>{compactDate(session.date)} · {String(session.hour ?? '--').padStart(2, '0')}:00</span>)}</div> : <small>Chưa có ca trong 62 ngày tới</small>}</div>
          <button type="button" className="opv2-student-open" onClick={() => void openStudentDetail(student)}>Xem hồ sơ & lịch sử</button>
        </article>
      })}{filteredStudents.length === 0 && <div className="opv2-state">Không có học viên còn hợp đồng hiệu lực phù hợp bộ lọc.</div>}</div>
    </>}

    {!loading && section === 'schedule' && (() => {
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

    {!loading && section === 'requests' && <>
      <section className="opv2-guidance"><CircleAlert size={20} /><div><strong>Phân biệt OFF học viên và nghỉ ca PT</strong><p>OFF/Bảo lưu là quyền lợi hợp đồng của học viên. PT nghỉ ca gửi đổi/hủy từng buổi tại tab Lịch 14 ngày; nghỉ nhiều ngày cần báo quản lý để đánh dấu PT OFF trên ma trận trước khi publish.</p></div></section>
      <h2 className="opv2-section-title">Lịch sử yêu cầu của tôi</h2>
      <div className="opv2-list">{requests.map((request) => <article className="opv2-card" key={request.id}><div className="opv2-card-head"><div><h3>{request.type === 'cancel' ? 'Xin hủy ca dạy' : 'Xin đổi ca dạy'}</h3><p>{request.originalDate} · {String(request.originalHour ?? '--').padStart(2, '0')}:00 · {studentNames.get(request.studentId) || 'Học viên Aura'}</p></div><span className={`opv2-badge is-${request.status}`}>{requestStatus(request.status)}</span></div>{request.type === 'reschedule' && request.newDate && <p>Đề xuất: {request.newDate} · {String(request.newHour ?? '--').padStart(2, '0')}:00</p>}<p>{request.reason}</p></article>)}{requests.length === 0 && <div className="opv2-state">Bạn chưa gửi yêu cầu đổi hoặc hủy ca nào.</div>}</div>
    </>}

    {attendanceTarget && <div className="opv2-sheet-layer" role="presentation"><button type="button" className="opv2-sheet-backdrop" aria-label="Đóng" onClick={() => setAttendanceTarget(null)} /><section className="opv2-sheet opv2-attendance-sheet" role="dialog" aria-modal="true" aria-labelledby="trainer-attendance-title"><header><div><small>AURA PT · HIỆN DIỆN</small><h2 id="trainer-attendance-title">Học viên có tập không?</h2></div><button type="button" aria-label="Đóng" onClick={() => setAttendanceTarget(null)}><X size={19} /></button></header><p className="opv2-sheet-current"><b>{studentNames.get(attendanceTarget.studentId) || 'Học viên Aura'}</b><br />{attendanceTarget.date} · {String(attendanceTarget.hour ?? '--').padStart(2, '0')}:00</p><div className="opv2-billing-confirm"><CheckCircle2 size={18} /><span>Buổi được hệ thống tính độc lập. Sửa hiện diện không làm tăng số buổi thêm lần nữa.</span></div><div className="opv2-attendance-options"><button type="button" disabled={attendanceBusy === attendanceTarget.id} onClick={() => void markAttendance(attendanceTarget, 'present')}><UserCheck size={20} /><span><b>Có tập</b><small>Đến đúng giờ</small></span></button><button type="button" disabled={attendanceBusy === attendanceTarget.id} onClick={() => void markAttendance(attendanceTarget, 'late', 5)}><Timer size={20} /><span><b>Đi trễ 5'</b><small>Ghi nhận nhanh</small></span></button><button type="button" disabled={attendanceBusy === attendanceTarget.id} onClick={() => void markAttendance(attendanceTarget, 'late', 10)}><Timer size={20} /><span><b>Đi trễ 10'</b><small>Ghi nhận nhanh</small></span></button><button type="button" disabled={attendanceBusy === attendanceTarget.id} onClick={() => void markAttendance(attendanceTarget, 'late', 15)}><Timer size={20} /><span><b>Đi trễ 15'+</b><small>Ghi nhận nhanh</small></span></button><button type="button" className="is-no-show" disabled={attendanceBusy === attendanceTarget.id || sessionStartsAt(attendanceTarget) + 15 * 60_000 > Date.now()} onClick={() => void markAttendance(attendanceTarget, 'no_show', undefined, { noShowReason, note: attendanceNote })}><UserX size={20} /><span><b>Không đến</b><small>Chỉ mở sau 15 phút</small></span></button></div><details className="opv2-attendance-details"><summary>+ Thêm lý do không đến (không bắt buộc)</summary><label>Lý do<select value={noShowReason} onChange={(event) => setNoShowReason(event.target.value as typeof noShowReason)}><option value="">Không ghi lý do</option><option value="busy">Bận việc</option><option value="sick">Sức khỏe</option><option value="forgot">Quên lịch</option><option value="unreachable">Không liên lạc được</option><option value="other">Khác</option></select></label><label>Ghi chú<textarea maxLength={300} value={attendanceNote} onChange={(event) => setAttendanceNote(event.target.value)} placeholder="Thông tin ngắn để CSKH đối chiếu…" /></label></details>{error && <p className="opv2-form-error">{error}</p>}</section></div>}

    {bulkTargets.length > 0 && <div className="opv2-sheet-layer" role="presentation"><button type="button" className="opv2-sheet-backdrop" aria-label="Đóng" onClick={() => setBulkTargets([])} /><section className="opv2-sheet opv2-bulk-confirm-sheet" role="dialog" aria-modal="true" aria-labelledby="trainer-bulk-attendance-title"><header><div><small>AURA PT · XÁC NHẬN NHANH</small><h2 id="trainer-bulk-attendance-title">Tất cả đều đã tập?</h2></div><button type="button" aria-label="Đóng" onClick={() => setBulkTargets([])}><X size={19} /></button></header><p className="opv2-sheet-current">Xác nhận <b>{bulkTargets.length} học viên</b> trong các ca đã bắt đầu đều có tập. Bạn vẫn có thể sửa riêng ca đi trễ hoặc không đến sau đó.</p><footer><button type="button" onClick={() => setBulkTargets([])}>Xem lại</button><button type="button" disabled={attendanceBusy === 'bulk'} onClick={() => void bulkConfirmToday(bulkTargets)}>{attendanceBusy === 'bulk' ? 'Đang xác nhận…' : 'Xác nhận tất cả'}</button></footer>{error && <p className="opv2-form-error">{error}</p>}</section></div>}

    {requestTarget && <div className="opv2-sheet-layer" role="presentation"><button type="button" className="opv2-sheet-backdrop" aria-label="Đóng" onClick={() => setRequestTarget(null)} /><section className="opv2-sheet" role="dialog" aria-modal="true" aria-labelledby="trainer-request-title"><header><div><small>AURA PT · YÊU CẦU CA DẠY</small><h2 id="trainer-request-title">Đổi hoặc hủy lịch</h2></div><button type="button" aria-label="Đóng" onClick={() => setRequestTarget(null)}><X size={19} /></button></header><p className="opv2-sheet-current">Buổi {requestTarget.date} · {String(requestTarget.hour ?? '--').padStart(2, '0')}:00</p><form onSubmit={submitRequest}><div className="opv2-sheet-segment"><button type="button" className={requestType === 'cancel' ? 'active' : ''} onClick={() => setRequestType('cancel')}>Hủy ca</button><button type="button" className={requestType === 'reschedule' ? 'active' : ''} onClick={() => setRequestType('reschedule')}>Đổi ca</button></div>{requestType === 'reschedule' && <div className="opv2-sheet-fields"><label>Ngày mới<input type="date" value={requestDate} onChange={(event) => setRequestDate(event.target.value)} /></label><label>Giờ mới<select value={requestHour} onChange={(event) => setRequestHour(event.target.value)}><option value="">Chọn giờ</option>{[6,7,8,9,10,11,14,15,16,17,18,19,20].map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select></label></div>}<label>Lý do<textarea maxLength={500} value={requestReason} onChange={(event) => setRequestReason(event.target.value)} placeholder="Nêu rõ lý do để quản lý xử lý…" /></label>{error && <p className="opv2-form-error">{error}</p>}<footer><button type="button" onClick={() => setRequestTarget(null)}>Để sau</button><button type="submit" disabled={submitting}>{submitting ? 'Đang gửi…' : 'Gửi yêu cầu'}</button></footer></form></section></div>}

    {detailTarget && <div className="opv2-sheet-layer" role="presentation"><button type="button" className="opv2-sheet-backdrop" aria-label="Đóng hồ sơ học viên" onClick={closeStudentDetail} /><section className="opv2-sheet opv2-student-detail" role="dialog" aria-modal="true" aria-labelledby="trainer-student-detail-title"><header><div><small>HỒ SƠ HỌC VIÊN</small><h2 id="trainer-student-detail-title">{detailTarget.name}</h2><p>{detailTarget.phone || detailTarget.email || 'Chưa có thông tin liên hệ'}</p></div><button type="button" aria-label="Đóng" onClick={closeStudentDetail}><X size={19} /></button></header>
      <nav className="opv2-student-detail__tabs" aria-label="Chi tiết học viên"><button type="button" className={detailTab === 'overview' ? 'active' : ''} onClick={() => setDetailTab('overview')}><CalendarClock /> Tổng quan</button><button type="button" className={detailTab === 'history' ? 'active' : ''} onClick={() => setDetailTab('history')}><History /> Lịch sử</button><button type="button" className={detailTab === 'workout' ? 'active' : ''} onClick={() => setDetailTab('workout')}><Dumbbell /> Giáo án</button></nav>
      {detailLoading && <div className="opv2-state"><RefreshCw className="is-spinning" /> Đang đối chiếu lịch sử và hợp đồng…</div>}
      {detailError && <div className="opv2-state is-error">{detailError}<button type="button" className="opv2-action" onClick={() => void openStudentDetail(detailTarget)}>Thử lại</button></div>}
      {!detailLoading && studentDetail && detailTab === 'overview' && <div className="opv2-student-detail__content">
        <article className="opv2-profile-summary"><div><small>Chi nhánh</small><strong>{branchNames.get(String(studentDetail.student.branchId || detailTarget.branchId)) || 'Chưa xác định'}</strong></div><div><small>Mục tiêu tuần</small><strong>{Number(studentDetail.student.sessionsPerWeek || detailTarget.sessionsPerWeek || 0)} buổi</strong></div>{studentDetail.student.dob && <div><small>Ngày sinh</small><strong>{compactDate(String(studentDetail.student.dob))}</strong></div>}</article>
        {studentDetail.contracts.map((contract) => { const schedulableInWeek = contract.schedulableOnWeek ?? contract.schedulableToday; return <article className="opv2-contract-summary" key={contract.id}><header><div><strong>{contract.packageName}</strong><small>{contract.startDate} → {contract.endDate}</small></div><span className={schedulableInWeek ? 'is-active' : 'is-inactive'}>{contract.pausedToday ? 'Bảo lưu hôm nay' : schedulableInWeek ? 'Hiệu lực trong tuần' : 'Không thể xếp'}</span></header><div><b>{contract.remainingSessions}</b><span>buổi còn lại</span><small>{contract.usedSessions}/{contract.totalSessions} buổi đã tính theo lịch sử</small></div>{contract.reconciliationStatus !== 'matched' && <p><CircleAlert /> Dữ liệu cũ đang được đối chiếu; Aura ưu tiên lịch sử có tính buổi.</p>}</article> })}
        {studentDetail.contracts.length === 0 && <div className="opv2-state">Chưa có gói tập hợp lệ để hiển thị.</div>}
        {(() => { const source = availabilitySourceCopy(studentDetail.availability); const availability = studentDetail.availability; return <article className="opv2-availability-summary"><header><strong><CalendarClock /> Lịch rảnh áp dụng tuần {compactDate(availability.weekId)}</strong><span>{source.label} · {availability.slots.length} khung</span></header><p className="opv2-availability-source">{source.note}</p>{availability.slots.length ? <div>{availability.slots.map((slot) => <span key={slot}>{slot.replace('-', ' · ')}:00</span>)}</div> : <p>Chưa có lịch rảnh hợp lệ để xếp lịch.</p>}<footer className="opv2-availability-meta"><span>{availability.requiredSessions || detailTarget.sessionsPerWeek || 0} buổi/tuần</span><span>Tối thiểu {availability.minimumSlots || 5} khung</span><span>Phiên bản #{availability.sourceRevision ?? availability.revision ?? 0}</span></footer></article> })()}
        {(() => { const weekStart = studentDetail.availability.weekId; const weekEnd = addDateDays(weekStart, 6); const ordered = studentDetail.sessions.filter((session) => session.date >= weekStart && session.date <= weekEnd).sort((left, right) => `${left.date}-${String(left.hour ?? 0).padStart(2, '0')}`.localeCompare(`${right.date}-${String(right.hour ?? 0).padStart(2, '0')}`)); return <article className="opv2-schedule-summary"><header><strong><CalendarDays /> Lịch đã xếp trong tuần</strong><span>{ordered.length} buổi</span></header>{ordered.length ? <div>{ordered.slice(0, 8).map((session) => <div className="opv2-schedule-summary__row" key={session.id}><time>{compactDate(session.date)} · {String(session.hour ?? '--').padStart(2, '0')}:00</time><span className={`opv2-schedule-summary__status is-${attendanceState(session)}`}>{attendanceLabel(session)}</span>{session.contractEffective === false && <small>Hợp đồng không còn hiệu lực tại ngày buổi</small>}</div>)}{ordered.length > 8 && <small className="opv2-schedule-summary__more">Còn {ordered.length - 8} buổi · xem đầy đủ trong tab Lịch sử</small>}</div> : <p>Chưa có buổi nào trong tuần này.</p>}</article> })()}
        <div className="opv2-student-detail__actions"><button type="button" onClick={() => { setDetailTarget(null); onNavigate?.('staff-workouts', studentDetail.student.id, studentDetail.student.name || detailTarget.name) }}><Dumbbell /> Mở giáo án</button><button type="button" onClick={() => { setDetailTarget(null); onNavigate?.('staff-nutrition-reviews', studentDetail.student.id, studentDetail.student.name || detailTarget.name) }}><CheckCircle2 /> Duyệt món</button></div>
      </div>}
      {!detailLoading && studentDetail && detailTab === 'history' && <TrainingHistoryPanel
        subject="student"
        subjectId={studentDetail.student.id}
        subjectName={studentDetail.student.name || detailTarget.name}
        contractId={studentDetail.contracts.find((contract) => contract.schedulableOnWeek)?.id || studentDetail.contracts.find((contract) => contract.schedulableToday)?.id || studentDetail.contracts[0]?.id}
        isDemo={isDemo}
        initialSessions={studentDetail.sessions}
        initialContracts={studentDetail.contracts}
      />}
      {!detailLoading && studentDetail && detailTab === 'workout' && <div className="opv2-student-workout">{studentDetail.trainingProgram ? <><article className="opv2-training-plan-summary"><header><div><small>GIÁO ÁN ĐANG ÁP DỤNG</small><strong>{studentDetail.trainingProgram.title}</strong></div><span>{studentDetail.trainingProgram.status === 'active' ? 'Đang áp dụng' : 'Bản nháp'}</span></header>{studentDetail.trainingProgram.goal && <p>{studentDetail.trainingProgram.goal}</p>}<div><b>{studentDetail.trainingProgram.trainingDayCount}</b><small>buổi mẫu</small><b>{studentDetail.trainingProgram.exerciseCount}</b><small>bài tập</small></div></article><div className="opv2-training-days">{studentDetail.trainingProgram.trainingDays.map((day) => <details key={day.id}><summary><span><strong>{day.title}</strong><small>{day.focusMuscles.join(' · ') || 'Chưa phân nhóm cơ'}</small></span><b>{day.exercises.length} bài</b></summary><div>{day.exercises.map((exercise) => <article key={exercise.id}><div><strong>{exercise.nameVi}</strong><small>{exercise.targetMuscles.join(' · ') || 'Toàn thân'}{exercise.secondaryMuscles.length ? ` · hỗ trợ ${exercise.secondaryMuscles.join(', ')}` : ''}</small></div><span>{exercise.sets} hiệp · {exercise.repMinimum}{exercise.repMaximum && exercise.repMaximum !== exercise.repMinimum ? `–${exercise.repMaximum}` : ''} lần{exercise.targetWeightKg ? ` · ${exercise.targetWeightKg}kg` : ''}{exercise.targetRpe ? ` · RPE ${exercise.targetRpe}` : ''}</span></article>)}</div></details>)}</div></> : <div className="opv2-state">Học viên chưa có giáo án đang lưu.</div>}<div className="opv2-student-history">{studentDetail.workoutLogs.slice(0, 20).map((log) => <article key={log.id}><time>{compactDate(String(log.date || log.completedAt || log.updatedAt || '').slice(0, 10))}<small>{log.hour === null || log.hour === undefined ? '' : `${String(log.hour).padStart(2, '0')}:00`}</small></time><div><strong>{String(log.trainingDayTitle || log.programName || log.workoutName || log.title || 'Buổi tập đã ghi nhận')}</strong><span>{log.metrics?.completedSets ? `${log.metrics.completedSets} hiệp · ${Math.round(log.metrics.totalVolumeKg).toLocaleString('vi-VN')} kg tổng tải · tối đa ${Math.round(log.metrics.maximumWeightKg || 0)}kg` : String(log.note || log.status || 'Đã lưu kết quả buổi tập')}</span>{log.painNotes && <small className="is-warning">Lưu ý đau mỏi: {log.painNotes}</small>}</div></article>)}{studentDetail.workoutLogs.length === 0 && <div className="opv2-state">Chưa có nhật ký mức tạ hoặc kết quả buổi tập.</div>}</div></div>}
    </section></div>}
    </>}
  </section>
}
