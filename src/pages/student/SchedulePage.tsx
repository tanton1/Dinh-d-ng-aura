import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  Check,
  Clock3,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  History,
  Link2,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ScrollText,
  UserRound,
  WalletCards,
} from 'lucide-react'
import LeaveRequestModal from '../../components/schedule/LeaveRequestModal'
import SessionRequestModal from '../../components/schedule/SessionRequestModal'
import {
  asStudentPtScheduleError,
  listMyStudentPtSchedule,
  StudentPtScheduleServiceError,
  type StudentPtScheduleData,
  type StudentPtSession,
} from '../../services/studentPtScheduleService'
import type { ViewId } from '../../types'
import '../../styles-coaching.css'
import './StudentSchedulePage.css'

const DEFAULT_DAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const DEFAULT_HOURS = [6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 19, 20]
const DAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
type StudentScheduleTab = 'this-week' | 'next-week' | 'contract' | 'requests' | 'history'

function scheduleTabFromRoute(): StudentScheduleTab | null {
  if (typeof window === 'undefined') return null
  const value = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('tab')
  return value && ['this-week', 'next-week', 'contract', 'requests', 'history'].includes(value)
    ? value as StudentScheduleTab
    : null
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

function issueCopy(issue: StudentPtScheduleServiceError) {
  switch (issue.issueCode) {
    case 'AUTH_REQUIRED':
      return { title: 'Phiên đăng nhập đã hết hạn', description: 'Vui lòng đăng nhập lại để xem lịch PT của bạn.' }
    case 'ACCESS_SYNC_REQUIRED':
      return { title: 'Quyền tài khoản chưa đồng bộ', description: 'Hãy đăng xuất, đăng nhập lại. Nếu vẫn còn lỗi, quản trị viên cần đồng bộ Role Assignment và Auth claims.' }
    case 'STUDENT_ROLE_REQUIRED':
      return { title: 'Tài khoản chưa có lịch cá nhân', description: 'Trang này dành cho học viên hoặc Staff đã liên kết hồ sơ học viên. Vui lòng liên hệ quản trị viên nếu bạn cần dùng lịch cá nhân.' }
    case 'PROFILE_NOT_LINKED':
      return { title: 'Chưa liên kết hồ sơ học viên', description: 'Quản trị viên cần liên kết UID đăng nhập với mã hồ sơ CRM trước khi lịch có thể hiển thị.' }
    case 'ACCESS_DENIED':
      return { title: 'Không có quyền xem lịch', description: 'Tài khoản đang bị khóa hoặc chưa được cấp quyền truy cập lịch học viên.' }
    case 'REVISION_CONFLICT':
      return { title: 'Lịch rảnh vừa được cập nhật ở nơi khác', description: 'Aura đã tải lại phiên bản mới nhất. Hãy kiểm tra và chọn lại các thay đổi cần lưu.' }
    case 'AVAILABILITY_LOCKED':
      return { title: 'Lịch rảnh của tuần đã khóa', description: 'Hạn gửi là 10:00 Chủ nhật trước tuần tập. Hãy chọn tuần kế tiếp hoặc liên hệ vận hành khi cần điều chỉnh.' }
    case 'MINIMUM_AVAILABILITY_REQUIRED':
      return { title: 'Chưa đủ khung giờ rảnh', description: issue.message }
    case 'AVAILABILITY_EMPTY':
      return { title: 'Không thể gửi lịch trống', description: 'Nếu cần nghỉ, hãy giữ lịch rảnh và tạo yêu cầu OFF hoặc bảo lưu.' }
    case 'INVALID_REQUEST':
      return { title: 'Dữ liệu lịch chưa hợp lệ', description: issue.message }
    case 'SYNC_UNAVAILABLE':
      return { title: 'Dịch vụ lịch đang tạm gián đoạn', description: 'Hãy kiểm tra kết nối và thử lại sau ít phút.' }
    default:
      return { title: 'Chưa thể đồng bộ lịch học viên', description: issue.message }
  }
}

function toIsoDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(date: Date, amount: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

function fromIsoDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function startOfWeek(date: Date) {
  const weekday = date.getDay()
  return addDays(date, weekday === 0 ? -6 : 1 - weekday)
}

function dayCode(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00+07:00`)
  const weekday = date.getDay()
  return weekday === 0 ? 'CN' : `T${weekday + 1}`
}

function slotIdForSession(session: StudentPtSession) {
  return session.hour === null ? '' : `${dayCode(session.date)}-${session.hour}`
}

function formatSessionDate(value: string) {
  return new Intl.DateTimeFormat('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date(`${value}T00:00:00+07:00`))
}

function canRequestSessionChange(session: StudentPtSession, deadlineHours = 12) {
  if (session.hour === null || session.status !== 'scheduled') return false
  const startsAt = Date.parse(`${session.date}T${String(session.hour).padStart(2, '0')}:00:00+07:00`)
  return Number.isFinite(startsAt) && startsAt - Date.now() >= deadlineHours * 60 * 60 * 1000
}

function formatMoney(value: number) {
  return `${Math.max(0, Number(value || 0)).toLocaleString('vi-VN')}đ`
}

function formatContractDate(value: string | null | undefined) {
  if (!value) return 'Chưa cập nhật'
  const parsed = fromIsoDate(value)
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(parsed) : 'Chưa cập nhật'
}

function contractStatusLabel(value: string) {
  return ({ active: 'Đang hiệu lực', future: 'Gói tiếp theo', frozen: 'Đang bảo lưu', expired: 'Đã hết hạn', cancelled: 'Đã hủy' } as Record<string, string>)[value] ?? value
}

export default function SchedulePage({ onNavigate, isDemo = false }: { onNavigate: (view: ViewId) => void; isDemo?: boolean; ownerId?: string }) {
  const today = useMemo(() => new Date(), [])
  const range = useMemo(() => ({ from: toIsoDate(addDays(today, -180)), to: toIsoDate(addDays(today, 180)) }), [today])
  const [data, setData] = useState<StudentPtScheduleData | null>(null)
  const [activeTab, setActiveTab] = useState<StudentScheduleTab>(() => scheduleTabFromRoute() ?? 'this-week')
  const [weekOffset, setWeekOffset] = useState(0)
  const [selectedDate, setSelectedDate] = useState(toIsoDate(today))
  const [loading, setLoading] = useState(true)
  const [loadIssue, setLoadIssue] = useState<StudentPtScheduleServiceError | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [requestSession, setRequestSession] = useState<StudentPtSession | null>(null)
  const [showPauseRequest, setShowPauseRequest] = useState(false)
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null)
  const [heroSlide, setHeroSlide] = useState(0)
  const heroTrackRef = useRef<HTMLDivElement>(null)
  const weekStart = useMemo(() => addDays(startOfWeek(today), weekOffset * 7), [today, weekOffset])
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart])
  const availabilityWeekId = useMemo(() => toIsoDate(weekStart), [weekStart])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadIssue(null)
    try {
      if (isDemo) {
        const demo: StudentPtScheduleData = {
          schemaVersion: 4,
          linked: true,
          identityLink: { status: 'linked', source: 'auth_uid', studentId: 'demo-student', crmProfileIdConfigured: false },
          student: {
            id: 'demo-student', name: 'An Nguyễn', branchId: 'demo-branch', sessionsPerWeek: 3,
            availableSlots: ['T2-18', 'T3-18', 'T4-19', 'T5-18', 'T6-19'], isScheduleConfirmed: true, availabilityRevision: 1,
            availability: { weekId: availabilityWeekId, slots: ['T2-18', 'T3-18', 'T4-19', 'T5-18', 'T6-19'], minimumSlots: 5, requiredSessions: 3, revision: 1, status: 'submitted', locked: false, cutoffAt: addDays(weekStart, -1).toISOString(), submittedAt: new Date().toISOString(), source: 'weekly' },
          },
          scheduleConfig: { workingDays: DEFAULT_DAYS, workingHours: DEFAULT_HOURS },
          sessions: [
            { id: 'demo-1', date: toIsoDate(addDays(today, 1)), hour: 18, status: 'scheduled', trainerId: 'demo-trainer', trainerName: 'PT Minh', branchId: 'demo-branch', verifiedByStudent: false, scheduleEntryId: '', revision: 1, timeZone: 'Asia/Ho_Chi_Minh' },
            { id: 'demo-2', date: toIsoDate(addDays(today, 3)), hour: 19, status: 'scheduled', trainerId: 'demo-trainer', trainerName: 'PT Minh', branchId: 'demo-branch', verifiedByStudent: false, scheduleEntryId: '', revision: 1, timeZone: 'Asia/Ho_Chi_Minh' },
          ],
          sessionsTruncated: false,
          contracts: [{
            id: 'demo-contract', packageName: 'PT Personal 24 buổi', status: 'active', startDate: toIsoDate(addDays(today, -30)), endDate: toIsoDate(addDays(today, 90)), totalSessions: 24, usedSessions: 8, remainingSessions: 16,
            totalAmount: 12_000_000, paidAmount: 8_000_000, outstandingAmount: 4_000_000, paymentStatus: 'due_soon', nextPaymentDate: toIsoDate(addDays(today, 5)), daysUntilEnd: 90,
            installments: [{ id: 'demo-payment-1', date: toIsoDate(addDays(today, -30)), amount: 8_000_000, status: 'paid' }, { id: 'demo-payment-2', date: toIsoDate(addDays(today, 5)), amount: 4_000_000, status: 'pending' }],
          }],
          contractAlerts: [{ code: 'PAYMENT_DUE_SOON', severity: 'warning', contractId: 'demo-contract', title: 'Kỳ thanh toán còn 5 ngày', message: 'PT Personal 24 buổi · 4.000.000đ', dueDate: toIsoDate(addDays(today, 5)), amount: 4_000_000 }],
          sessionRequests: [],
          pauseRequests: [],
        }
        setData(demo)
        return
      }
      const response = await listMyStudentPtSchedule(range.from, range.to, availabilityWeekId)
      setData(response)
    } catch (caught) {
      setLoadIssue(asStudentPtScheduleError(caught))
    } finally {
      setLoading(false)
    }
  }, [availabilityWeekId, isDemo, range.from, range.to, today, weekStart])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const syncTabFromRoute = () => {
      const nextTab = scheduleTabFromRoute()
      if (nextTab) setActiveTab(nextTab)
    }
    window.addEventListener('hashchange', syncTabFromRoute)
    return () => window.removeEventListener('hashchange', syncTabFromRoute)
  }, [])

  const changeDeadlineHours = data?.scheduleConfig.sessionChangeDeadlineHours ?? 12
  const complimentaryChangeCancelPerMonth = data?.scheduleConfig.complimentaryChangeCancelPerMonth ?? 1
  const offMaxDaysPerRequest = data?.scheduleConfig.offMaxDaysPerRequest ?? 14
  const upcomingSessions = useMemo(() => (data?.sessions ?? [])
    .filter((session) => session.date >= toIsoDate(today) && session.status === 'scheduled')
    .sort((left, right) => `${left.date}-${left.hour ?? 99}`.localeCompare(`${right.date}-${right.hour ?? 99}`)), [data?.sessions, today])
  const historySessions = useMemo(() => (data?.sessions ?? [])
    .filter((session) => session.status !== 'scheduled' || session.date < toIsoDate(today))
    .sort((left, right) => `${right.date}-${right.hour ?? 99}`.localeCompare(`${left.date}-${left.hour ?? 99}`)), [data?.sessions, today])
  const scheduleRequests = data?.sessionRequests ?? []
  const pauseRequests = data?.pauseRequests ?? []
  const pendingRequestCount = scheduleRequests.filter((request) => request.status === 'pending').length + pauseRequests.filter((request) => request.status === 'pending').length
  const todayKey = toIsoDate(today)
  const contracts = data?.contracts ?? []
  const activeContract = contracts.find((contract) => contract.status === 'active'
    && (!contract.startDate || contract.startDate <= todayKey)
    && (!contract.endDate || contract.endDate >= todayKey)
    && contract.remainingSessions > 0)
  const futureContract = contracts
    .filter((contract) => ['active', 'future'].includes(contract.status) && contract.startDate > todayKey)
    .sort((left, right) => left.startDate.localeCompare(right.startDate))[0]
  const displayContract = activeContract ?? futureContract ?? contracts[0]
  const selectedContract = contracts.find((contract) => contract.id === selectedContractId) ?? displayContract
  const contractAlerts = data?.contractAlerts ?? []
  const selectedSessions = useMemo(() => (data?.sessions ?? [])
    .filter((session) => session.date === selectedDate)
    .sort((left, right) => (left.hour ?? 99) - (right.hour ?? 99)), [data?.sessions, selectedDate])
  const weekSessions = useMemo(() => {
    const first = toIsoDate(weekDays[0])
    const last = toIsoDate(weekDays[6])
    return (data?.sessions ?? []).filter((session) => session.date >= first && session.date <= last && session.status !== 'cancelled')
  }, [data?.sessions, weekDays])
  const completedThisWeek = weekSessions.filter((session) => session.status === 'completed').length
  const weekCompletion = weekSessions.length ? Math.round(completedThisWeek / weekSessions.length * 100) : 0
  const weekLabel = `${new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: 'short' }).format(weekDays[0])} – ${new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: 'short', year: 'numeric' }).format(weekDays[6])}`
  const selectedLabel = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' }).format(fromIsoDate(selectedDate))

  const selectWeek = (offset: 0 | 1) => {
    setWeekOffset(offset)
    setSelectedDate(offset === 0 ? toIsoDate(today) : toIsoDate(addDays(startOfWeek(today), 7)))
    setActiveTab(offset === 0 ? 'this-week' : 'next-week')
  }
  const goToday = () => selectWeek(0)
  const selectUpcoming = (session: StudentPtSession) => {
    const targetOffset = Math.floor((fromIsoDate(session.date).getTime() - startOfWeek(today).getTime()) / (7 * 86_400_000))
    setWeekOffset(targetOffset > 0 ? 1 : 0)
    setActiveTab(targetOffset > 0 ? 'next-week' : 'this-week')
    setSelectedDate(session.date)
  }
  const selectHeroSlide = (index: number) => {
    const normalizedIndex = Math.min(2, Math.max(0, index))
    setHeroSlide(normalizedIndex)
    const track = heroTrackRef.current
    if (track) track.scrollTo({ left: track.clientWidth * normalizedIndex, behavior: 'smooth' })
  }
  const loadIssueContent = loadIssue ? issueCopy(loadIssue) : null
  const missingProfileDescription = data?.identityLink?.crmProfileIdConfigured
    ? 'Mã hồ sơ CRM đã được cấu hình nhưng không còn khớp dữ liệu học viên. Quản trị viên cần kiểm tra lại liên kết.'
    : 'Tài khoản này chưa được ghép với hồ sơ PT đã chuyển dữ liệu. Quản trị viên cần bổ sung crmProfileId cho Role Assignment.'

  return (
    <div className="page schedule-page pt-schedule-page student-schedule-page student-schedule-page--classic" aria-busy={loading}>
      {loading && <div className="student-schedule-state" role="status"><LoaderCircle className="spin" size={30} /><strong>Đang liên kết lịch học viên</strong><span>Aura đang tải lịch tuần và khung giờ rảnh của bạn.</span></div>}
      {!loading && loadIssue && loadIssueContent && <div className="student-schedule-state is-error" role="alert"><AlertCircle size={28} /><strong>{loadIssueContent.title}</strong><span>{loadIssueContent.description}</span><button type="button" onClick={() => void load()}><RefreshCw size={16} /> {loadIssue.retryable ? 'Thử lại' : 'Kiểm tra lại'}</button></div>}
      {!loading && !loadIssue && data && !data.linked && <div className="student-schedule-state is-warning"><Link2 size={28} /><strong>Chưa liên kết hồ sơ học viên</strong><span>{missingProfileDescription}</span></div>}

      {!loading && !loadIssue && data?.student && <>
        <section className="student-schedule-hero" aria-roledescription="carousel" aria-label="Tổng quan lịch học viên">
          <div
            ref={heroTrackRef}
            className="student-schedule-hero__track"
            onScroll={(event) => {
              const track = event.currentTarget
              if (track.clientWidth > 0) setHeroSlide(Math.min(2, Math.max(0, Math.round(track.scrollLeft / track.clientWidth))))
            }}
          >
            <article className="student-schedule-hero__slide is-welcome" aria-label="Giới thiệu lịch học viên">
              <div><small>AURA FITNESS · LỊCH HỌC VIÊN</small><h1>Lịch tập luyện</h1><p>Xem lịch tuần, các buổi PT sắp tới và cập nhật khung giờ bạn có thể tập.</p></div>
              <span className="student-schedule-hero__icon"><CalendarCheck size={30} /></span>
              <button type="button" onClick={() => selectHeroSlide(1)}>Xem kế hoạch tuần <ChevronRight size={16} /></button>
            </article>
            <article className="student-schedule-hero__slide is-week" aria-label="Kế hoạch tuần">
              <div><small>KẾ HOẠCH TUẦN CỦA BẠN</small><h2>{weekSessions.length} buổi tập</h2><p>{weekLabel} · Lịch được đối chiếu với thời gian rảnh đã đăng ký.</p></div>
              <div className="student-schedule-hero__metric"><strong>{weekCompletion}%</strong><span>Hoàn thành</span></div>
              <div className="student-schedule-hero__progress"><i style={{ width: `${weekCompletion}%` }} /></div>
            </article>
            <article className="student-schedule-hero__slide is-contract" aria-label="Gói tập đang liên kết">
              <div><small>GÓI TẬP ĐANG LIÊN KẾT</small><h2>{displayContract?.packageName ?? 'Chưa có gói tập'}</h2><p>{displayContract ? `Hiệu lực đến ${formatContractDate(displayContract.endDate)}` : 'Liên hệ vận hành để liên kết hợp đồng PT.'}</p></div>
              {displayContract && <><div className="student-schedule-hero__metric"><strong>{displayContract.usedSessions}/{displayContract.totalSessions}</strong><span>Buổi đã dùng</span></div><div className="student-schedule-hero__progress"><i style={{ width: `${Math.min(100, displayContract.totalSessions ? displayContract.usedSessions / displayContract.totalSessions * 100 : 0)}%` }} /></div><button type="button" onClick={() => { setSelectedContractId(displayContract.id); setActiveTab('contract') }}>Xem thanh toán & hợp đồng</button></>}
            </article>
          </div>
          <footer className="student-schedule-hero__controls">
            <span>{heroSlide + 1}/3</span>
            <div>{[0, 1, 2].map((index) => <button type="button" key={index} className={heroSlide === index ? 'active' : ''} aria-label={`Xem slide ${index + 1}`} aria-current={heroSlide === index ? 'true' : undefined} onClick={() => selectHeroSlide(index)} />)}</div>
            <button type="button" aria-label={heroSlide === 2 ? 'Quay lại slide đầu' : 'Slide tiếp theo'} onClick={() => selectHeroSlide(heroSlide === 2 ? 0 : heroSlide + 1)}><ChevronRight size={17} /></button>
          </footer>
        </section>

        <nav className="student-schedule-tabs" aria-label="Nội dung lịch học viên">
          <button type="button" className={activeTab === 'this-week' ? 'active' : ''} onClick={() => selectWeek(0)}><CalendarCheck size={16} /><span>Tuần này</span></button>
          <button type="button" className={activeTab === 'next-week' ? 'active' : ''} onClick={() => selectWeek(1)}><CalendarDays size={16} /><span>Tuần sau</span></button>
          <button type="button" onClick={() => onNavigate('student-availability')}><CalendarRange size={16} /><span>Lịch rảnh</span><ChevronRight size={14} /></button>
          <button type="button" className={activeTab === 'contract' ? 'active' : ''} onClick={() => setActiveTab('contract')}><WalletCards size={16} /><span>Hợp đồng</span>{contractAlerts.length > 0 && <i>{contractAlerts.length}</i>}</button>
          <button type="button" className={activeTab === 'requests' ? 'active' : ''} onClick={() => setActiveTab('requests')}><ScrollText size={16} /><span>Yêu cầu</span>{pendingRequestCount > 0 && <i>{pendingRequestCount}</i>}</button>
          <button type="button" className={activeTab === 'history' ? 'active' : ''} onClick={() => setActiveTab('history')}><History size={16} /><span>Lịch sử</span></button>
        </nav>

        {contractAlerts.length > 0 && <section className="student-contract-alert-rail" aria-label="Cảnh báo hợp đồng và thanh toán">
          {contractAlerts.map((alert, index) => <button type="button" className={`is-${alert.severity}`} key={`${alert.code}-${alert.contractId}-${alert.dueDate ?? index}`} onClick={() => { setSelectedContractId(alert.contractId); setActiveTab('contract') }}>
            <AlertCircle size={18} /><span><strong>{alert.title}</strong><small>{alert.message}</small></span><ChevronRight size={16} />
          </button>)}
        </section>}

        {(activeTab === 'this-week' || activeTab === 'next-week') && <section className="schedule-layout">
          <div className="calendar-panel card">
            <div className="calendar-header"><button type="button" aria-label="Tuần trước" disabled={weekOffset === 0} onClick={() => selectWeek(0)}><ChevronLeft size={19} /></button><div><strong>{weekLabel}</strong><button type="button" onClick={goToday}>Hôm nay</button></div><button type="button" aria-label="Tuần sau" disabled={weekOffset === 1} onClick={() => selectWeek(1)}><ChevronRight size={19} /></button></div>
            <div className="week-strip">{weekDays.map((date) => {
              const iso = toIsoDate(date)
              const session = (data.sessions ?? []).find((item) => item.date === iso && item.status !== 'cancelled')
              return <button type="button" key={iso} className={selectedDate === iso ? 'active' : ''} aria-pressed={selectedDate === iso} aria-label={`${DAY_LABELS[date.getDay()]} ngày ${date.getDate()}, ${session ? 'có lịch' : 'không có lịch'}`} onClick={() => setSelectedDate(iso)}><span>{DAY_LABELS[date.getDay()]}</span><strong>{date.getDate()}</strong>{session && <i />}</button>
            })}</div>
            <div className="day-label"><span>{selectedLabel.toLocaleUpperCase('vi')}</span><small>{selectedSessions.length} buổi tập</small></div>

            {selectedSessions.length ? selectedSessions.map((session) => {
              const matched = (data.student?.availableSlots ?? []).includes(slotIdForSession(session))
              return <article className={`timeline-event featured ${session.status}`} key={session.id}>
                <div className="event-time"><strong>{session.hour === null ? '--:--' : `${String(session.hour).padStart(2, '0')}:00`}</strong><span>Buổi PT</span></div><div className="event-line"><i /></div>
                <div className="event-detail"><div className="event-icon purple"><Dumbbell size={22} /></div><div><span>HUẤN LUYỆN CÁ NHÂN</span><h3>Buổi tập PT</h3><p><UserRound size={13} /> {session.trainerName}</p><em className={`pt-activity-status ${session.status}`}>{statusLabels[session.status] ?? session.status}</em><small className={matched ? 'student-classic-match is-linked' : 'student-classic-match needs-review'}>{matched ? <><Link2 size={12} /> Khớp lịch rảnh</> : <><AlertCircle size={12} /> Cần rà soát lịch rảnh</>}</small>{session.status === 'scheduled' && <button type="button" disabled={!canRequestSessionChange(session, changeDeadlineHours)} title={!canRequestSessionChange(session, changeDeadlineHours) ? `Đã qua hạn gửi trước ${changeDeadlineHours} giờ` : undefined} className="student-session-policy-action" onClick={() => setRequestSession(session)}>{canRequestSessionChange(session, changeDeadlineHours) ? 'Đổi / hủy buổi' : `Đã qua hạn ${changeDeadlineHours} giờ`}</button>}</div></div>
              </article>
            }) : <div className="schedule-empty-inline"><CalendarDays size={28} /><h3>Chưa có lịch trong ngày này</h3><p>Khi vận hành xếp lịch, buổi tập sẽ xuất hiện tại đây.</p></div>}
          </div>

          <aside className="schedule-side">
            <article className="card next-week"><div className="section-heading"><div><h2>Sắp tới</h2><p>Các buổi PT gần nhất</p></div><button type="button" className="text-button" onClick={goToday}>Tuần hiện tại</button></div>{upcomingSessions.length ? upcomingSessions.slice(0, 5).map((session) => {
              const date = fromIsoDate(session.date)
              return <button type="button" className="upcoming-item" key={session.id} onClick={() => selectUpcoming(session)}><span className="upcoming-date"><strong>{date.getDate()}</strong><small>THG {date.getMonth() + 1}</small></span><span><small>{session.hour === null ? 'Chưa rõ giờ' : `${String(session.hour).padStart(2, '0')}:00`} · Buổi tập PT</small><strong>{session.trainerName}</strong><em>{statusLabels[session.status] ?? session.status}</em></span><ChevronRight size={17} /></button>
            }) : <div className="schedule-empty-state compact"><CalendarCheck size={26} /><h3>Chưa có lịch sắp tới</h3><p>Buổi tập mới sẽ xuất hiện sau khi được xếp lịch.</p></div>}</article>
            <article className="card consistency-card"><div className="consistency-icon"><CalendarDays size={24} /></div><div><span className="eyebrow">TIẾN ĐỘ GÓI TẬP</span><h3>{activeContract ? `${activeContract.usedSessions}/${activeContract.totalSessions} buổi` : 'Chưa có gói tập'}</h3><p>{activeContract?.packageName ?? 'Liên hệ vận hành để cập nhật hợp đồng.'}</p></div><div className="consistency-dots">{weekDays.slice(0, 5).map((date) => {
              const dayItems = (data.sessions ?? []).filter((item) => item.date === toIsoDate(date))
              const done = dayItems.some((item) => item.status === 'completed')
              return <span className={done ? 'done' : selectedDate === toIsoDate(date) ? 'current' : ''} key={toIsoDate(date)}>{done ? '✓' : date.getDate()}</span>
            })}</div></article>
            <button type="button" className="reschedule-button" onClick={goToday}><RotateCcw size={17} /> Quay về tuần hiện tại</button>
          </aside>
        </section>}
        {message && <div className="student-schedule-message" role="status"><Check size={17} /> {message}</div>}
        {data.sessionsTruncated && <div className="student-schedule-state is-warning" role="status"><AlertCircle size={24} /><strong>Khoảng lịch có quá nhiều buổi tập</strong><span>Aura đang hiển thị 1.000 buổi đầu tiên. Hãy chuyển sang khoảng thời gian ngắn hơn để xem đầy đủ.</span></div>}
        {activeTab === 'contract' && <section className="student-contract-center">
          <header><div><small>AURA · HỢP ĐỒNG & THANH TOÁN</small><h2>Gói tập của bạn</h2><p>Thông tin chỉ đọc, được đồng bộ từ hợp đồng và lịch thanh toán canonical của Aura.</p></div>{selectedContract && <span className={`is-${selectedContract.paymentStatus}`}>{selectedContract.outstandingAmount > 0 ? `Còn ${formatMoney(selectedContract.outstandingAmount)}` : 'Đã thanh toán'}</span>}</header>
          {contracts.length > 0 ? <>
            <div className="student-contract-carousel" aria-label="Danh sách hợp đồng">
              {contracts.map((contract) => <button type="button" key={contract.id} className={`${selectedContract?.id === contract.id ? 'active' : ''} is-${contract.status}`} onClick={() => setSelectedContractId(contract.id)}>
                <span><small>{contractStatusLabel(contract.status)}</small><strong>{contract.packageName}</strong></span>
                <em>{contract.remainingSessions} buổi còn lại · tổng {contract.totalSessions}</em>
                <i><b style={{ width: `${Math.min(100, contract.totalAmount ? contract.paidAmount / contract.totalAmount * 100 : contract.outstandingAmount ? 0 : 100)}%` }} /></i>
                <span className="student-contract-card-footer"><span>{formatContractDate(contract.startDate)} → {formatContractDate(contract.endDate)}</span><strong>{contract.outstandingAmount > 0 ? `Nợ ${formatMoney(contract.outstandingAmount)}` : 'Đã thu đủ'}</strong></span>
              </button>)}
            </div>
            {selectedContract && <div className="student-contract-detail">
              <div className="student-contract-kpis"><article><small>Giá trị hợp đồng</small><strong>{formatMoney(selectedContract.totalAmount)}</strong></article><article><small>Đã thanh toán</small><strong>{formatMoney(selectedContract.paidAmount)}</strong></article><article className={selectedContract.outstandingAmount > 0 ? 'is-warning' : 'is-paid'}><small>Công nợ còn lại</small><strong>{formatMoney(selectedContract.outstandingAmount)}</strong></article></div>
              <div className="student-payment-schedule"><header><div><small>LỊCH THANH TOÁN</small><h3>Các kỳ của {selectedContract.packageName}</h3></div>{selectedContract.nextPaymentDate && <span>Kỳ tới {formatContractDate(selectedContract.nextPaymentDate)}</span>}</header>
                {(selectedContract.installments ?? []).length > 0 ? <div>{(selectedContract.installments ?? []).map((installment, index) => {
                  const overdue = installment.status === 'pending' && installment.date < todayKey
                  const dueToday = installment.status === 'pending' && installment.date === todayKey
                  const status = installment.status === 'paid' ? 'Đã thanh toán' : installment.status === 'cancelled' ? 'Đã hủy' : overdue ? 'Quá hạn' : dueToday ? 'Đến hạn hôm nay' : 'Chờ thanh toán'
                  return <article className={`${installment.status === 'paid' ? 'is-paid' : overdue || dueToday ? 'is-overdue' : 'is-pending'}`} key={installment.id}><span>{index + 1}</span><div><strong>Kỳ {index + 1} · {formatMoney(installment.amount)}</strong><small>Hạn {formatContractDate(installment.date)}</small></div><em>{status}</em></article>
                })}</div> : <div className="student-session-empty"><WalletCards size={27} /><strong>{selectedContract.outstandingAmount > 0 ? 'Chưa có lịch trả góp chi tiết' : 'Hợp đồng đã thanh toán đủ'}</strong><span>{selectedContract.nextPaymentDate ? `Kỳ thanh toán tiếp theo: ${formatContractDate(selectedContract.nextPaymentDate)}` : 'Aura chưa ghi nhận kỳ thanh toán nào cần xử lý.'}</span></div>}
              </div>
              {activeContract?.id === selectedContract.id && <button type="button" className="student-contract-pause-action" onClick={() => setShowPauseRequest(true)}><CalendarRange size={17} /> Đăng ký OFF / Bảo lưu</button>}
            </div>}
          </> : <div className="student-session-empty"><WalletCards size={30} /><strong>Chưa liên kết hợp đồng</strong><span>Vui lòng liên hệ Aura để kiểm tra hồ sơ gói tập.</span></div>}
        </section>}

        {activeTab === 'requests' && <section className="student-request-center">
          <header><div><small>AURA · YÊU CẦU LỊCH</small><h2>Đổi, hủy, OFF và bảo lưu</h2><p>Theo dõi toàn bộ yêu cầu và kết quả xử lý trong một nơi.</p></div><button type="button" onClick={() => selectWeek(0)}>Chọn buổi để đổi/hủy</button></header>
          <div className="student-request-policy-grid"><article><Clock3 size={18} /><strong>Đổi/Hủy buổi</strong><span>Gửi trước {changeDeadlineHours} giờ. Mỗi tháng có {complimentaryChangeCancelPerMonth} lượt không tính buổi.</span></article><article><CalendarRange size={18} /><strong>OFF/Bảo lưu</strong><span>OFF tối đa {offMaxDaysPerRequest} ngày; dài hơn chuyển sang bảo lưu.</span><button type="button" disabled={!activeContract} onClick={() => setShowPauseRequest(true)}>Tạo yêu cầu</button></article></div>
          <div className="student-request-history-list">
            {[...scheduleRequests.map((request) => ({ id: request.id, kind: request.type === 'cancel' ? 'Hủy buổi' : 'Đổi lịch', status: request.status, date: request.originalDate, detail: request.type === 'reschedule' && request.newDate ? `Đề xuất ${request.newDate} · ${String(request.newHour ?? '--').padStart(2, '0')}:00` : request.reason, charged: request.countsTowardContract ?? request.expectedCountsTowardContract })), ...pauseRequests.map((request) => ({ id: request.id, kind: request.type === 'preservation' ? 'Bảo lưu hợp đồng' : 'OFF hợp đồng', status: request.status, date: `${request.startDate} → ${request.endDate}`, detail: request.newContractEndDate ? `Hạn mới: ${request.newContractEndDate}` : request.reason, charged: false }))]
              .map((request) => <article key={request.id}><span className={`student-request-status is-${request.status}`}>{request.status === 'approved' ? 'Đã duyệt' : request.status === 'rejected' ? 'Từ chối' : 'Chờ duyệt'}</span><div><strong>{request.kind}</strong><small>{request.date}</small><p>{request.detail}</p></div>{request.charged && <em>Có tính buổi</em>}</article>)}
            {!scheduleRequests.length && !pauseRequests.length && <div className="student-session-empty"><ScrollText size={28} /><strong>Chưa có yêu cầu nào</strong><span>Chọn một buổi trong Tuần này/Tuần sau hoặc tạo OFF/Bảo lưu tại đây.</span></div>}
          </div>
        </section>}

        {activeTab === 'history' && <section className="student-session-history"><header><div><small>AURA · NHẬT KÝ TẬP LUYỆN</small><h2>Lịch sử buổi tập</h2><p>Hiển thị tối đa 180 ngày gần nhất, gồm buổi hoàn thành, đổi, hủy và vắng.</p></div><span>{historySessions.length} buổi</span></header>{historySessions.length > 0 ? <div>{historySessions.map((session) => <article key={session.id}><span>{formatSessionDate(session.date)} · {session.hour === null ? '--:--' : `${String(session.hour).padStart(2, '0')}:00`}</span><strong>{session.trainerName}</strong><em>{statusLabels[session.status] ?? session.status}</em></article>)}</div> : <div className="student-session-empty"><History size={28} /><strong>Chưa có lịch sử tập luyện</strong><span>Các buổi đã hoàn thành hoặc được điều chỉnh sẽ xuất hiện tại đây.</span></div>}</section>}
        {requestSession && <SessionRequestModal session={requestSession} onClose={() => setRequestSession(null)} onCreated={(value) => { setMessage(value); setActiveTab('requests'); void load() }} />}
        {showPauseRequest && activeContract && <LeaveRequestModal contractId={activeContract.id} policy={data.scheduleConfig} onClose={() => setShowPauseRequest(false)} onCreated={(value) => { setMessage(value); setActiveTab('requests'); void load() }} />}
      </>}
    </div>
  )
}
