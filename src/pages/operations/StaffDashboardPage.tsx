import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  CheckCircle2,
  ChefHat,
  Clock3,
  Dumbbell,
  RefreshCw,
  RotateCcw,
  UserRoundCheck,
  Users,
  WalletCards,
} from 'lucide-react'
import AuraMetricCarousel, { type AuraMetricSlide } from '../../components/admin/pt/AuraMetricCarousel'
import { getMyTrainerWorkspace, type CoachWorkspaceScope, type TrainerSessionSummary } from '../../services/ptOperationsV2Service'
import type { ViewId } from '../../types'
import './StaffDashboardPage.css'

const vietnamDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
})

function dateKey(date = new Date()) { return vietnamDateFormatter.format(date) }
function addDays(value: string, amount: number) {
  return dateKey(new Date(Date.parse(`${value}T12:00:00+07:00`) + amount * 86_400_000))
}
function sessionAttendance(session: TrainerSessionSummary) {
  if (session.attendanceStatus && session.attendanceStatus !== 'policy_charge') return session.attendanceStatus
  if (['completed', 'attended'].includes(session.status)) return 'present'
  if (session.status === 'no_show') return 'no_show'
  return 'pending'
}
function statusLabel(session: TrainerSessionSummary) {
  const attendance = sessionAttendance(session)
  if (attendance === 'present') return 'Có tập'
  if (attendance === 'late') return 'Đi trễ'
  if (attendance === 'no_show') return 'Không đến'
  const startsAt = Date.parse(`${session.date}T${String(session.hour ?? 0).padStart(2, '0')}:00:00+07:00`)
  return startsAt > Date.now() ? 'Sắp tới' : 'Chờ xác nhận'
}

interface Props {
  onNavigate: (view: ViewId) => void
  capabilities: string[]
  isDemo?: boolean
}

export default function StaffDashboardPage({ onNavigate, capabilities, isDemo = false }: Props) {
  const today = dateKey()
  const [scope, setScope] = useState<CoachWorkspaceScope | null>(null)
  const [sessions, setSessions] = useState<TrainerSessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const can = useCallback((capability: string) => capabilities.includes(capability) || isDemo, [capabilities, isDemo])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    if (isDemo) {
      const demoSessions: TrainerSessionSummary[] = [
        { id: 'demo-1', studentId: 'demo-a', trainerId: 'demo-staff', studentName: 'Nguyễn Minh Anh', date: today, hour: 8, status: 'attended', attendanceStatus: 'present', billingStatus: 'charged', timeZone: 'Asia/Ho_Chi_Minh' },
        { id: 'demo-2', studentId: 'demo-b', trainerId: 'demo-staff', studentName: 'Trần Thu Hà', date: today, hour: 8, status: 'attended', attendanceStatus: 'present', billingStatus: 'charged', timeZone: 'Asia/Ho_Chi_Minh' },
        { id: 'demo-3', studentId: 'demo-c', trainerId: 'demo-staff', studentName: 'Lê Ngọc Mai', date: today, hour: 18, status: 'scheduled', attendanceStatus: 'pending', billingStatus: 'pending', timeZone: 'Asia/Ho_Chi_Minh' },
        { id: 'demo-4', studentId: 'demo-d', trainerId: 'demo-staff', studentName: 'Phạm Thảo Vy', date: addDays(today, 1), hour: 7, status: 'scheduled', attendanceStatus: 'pending', billingStatus: 'pending', timeZone: 'Asia/Ho_Chi_Minh' },
      ]
      setScope({ schemaVersion: 1, source: 'pt_contract_assignments', staffId: 'demo-staff', tabs: { students: true, schedule: true, requests: true, nutrition: true }, counts: { primaryStudents: 8, secondaryStudents: 3, nutritionStudents: 5, teachingSessions: 24, pendingRequests: 2 } })
      setSessions(demoSessions); setLoading(false); return
    }
    try {
      const result = await getMyTrainerWorkspace('schedule', today, addDays(today, 6))
      setScope(result.scope); setSessions(result.sessions)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chưa thể tải tổng quan công việc Staff.')
    } finally { setLoading(false) }
  }, [isDemo, today])

  useEffect(() => { void load() }, [load])

  const todaySessions = useMemo(() => sessions
    .filter((session) => session.date === today && !['cancelled', 'student_cancelled', 'trainer_cancelled'].includes(session.status))
    .sort((left, right) => Number(left.hour ?? 99) - Number(right.hour ?? 99)), [sessions, today])
  const todayShiftCount = useMemo(() => new Set(todaySessions.map((session) => `${session.date}:${session.hour}`)).size, [todaySessions])
  const pendingAttendance = todaySessions.filter((session) => sessionAttendance(session) === 'pending'
    && Date.parse(`${session.date}T${String(session.hour ?? 0).padStart(2, '0')}:00:00+07:00`) <= Date.now()).length
  const groupedToday = useMemo(() => {
    const groups = new Map<string, TrainerSessionSummary[]>()
    todaySessions.forEach((session) => {
      const key = `${session.date}:${session.hour}`
      groups.set(key, [...(groups.get(key) || []), session])
    })
    return [...groups.entries()].map(([key, items]) => ({ key, hour: items[0]?.hour, items }))
  }, [todaySessions])

  const slides = useMemo<AuraMetricSlide[]>(() => [
    { id: 'today', eyebrow: 'Ca dạy hôm nay', value: `${todayShiftCount} ca`, detail: `${todaySessions.length} lượt học viên trong lịch`, icon: <Dumbbell size={20} />, tone: 'pink', actionLabel: 'Mở lịch làm việc', onSelect: () => onNavigate('staff-schedule') },
    { id: 'attendance', eyebrow: 'Chờ xác nhận', value: `${pendingAttendance} lượt`, detail: pendingAttendance ? 'Ưu tiên hoàn tất hiện diện sau ca' : 'Không có ca quá giờ đang chờ', icon: <Clock3 size={20} />, tone: 'orange', actionLabel: 'Kiểm tra ca dạy', onSelect: () => onNavigate('staff-schedule') },
    { id: 'students', eyebrow: 'Học viên phụ trách', value: `${(scope?.counts.primaryStudents || 0) + (scope?.counts.secondaryStudents || 0)}`, detail: `${scope?.counts.primaryStudents || 0} chính · ${scope?.counts.secondaryStudents || 0} phụ`, icon: <Users size={20} />, tone: 'sunset', actionLabel: 'Xem học viên', onSelect: () => onNavigate('staff-students') },
    { id: 'requests', eyebrow: 'Yêu cầu lịch', value: `${scope?.counts.pendingRequests || 0} chờ`, detail: 'Đổi, hủy và điều chỉnh ca của bạn', icon: <RotateCcw size={20} />, tone: 'ink', actionLabel: 'Mở yêu cầu', onSelect: () => onNavigate('staff-requests') },
  ], [onNavigate, pendingAttendance, scope, todaySessions.length, todayShiftCount])

  const modules = [
    { view: 'staff-students' as const, capability: 'coach.workspace.view', label: 'Học viên', detail: 'Hồ sơ được phân công', icon: Users },
    { view: 'staff-schedule' as const, capability: 'coach.workspace.view', label: 'Lịch làm việc', detail: 'Dạy · rảnh · yêu cầu', icon: CalendarDays },
    { view: 'staff-nutrition-reviews' as const, capability: 'coach.workspace.view', label: 'Duyệt món', detail: `${scope?.counts.nutritionStudents || 0} học viên dinh dưỡng`, icon: ChefHat },
    { view: 'staff-renewals' as const, capability: 'renewals.workspace.view', label: 'Tái ký', detail: 'Hợp đồng đang chăm sóc', icon: RefreshCw },
    { view: 'staff-payroll' as const, capability: 'payroll.self.view', label: 'Lương', detail: 'Tạm tính và đối soát', icon: WalletCards },
  ].filter((module) => can(module.capability))

  return <main className="staff-dashboard" data-testid="staff-dashboard-page">
    <header className="staff-dashboard__heading">
      <div><small>AURA STAFF</small><h1>Tổng quan công việc</h1><p>{today.split('-').reverse().join('/')} · Dữ liệu chỉ trong phạm vi được phân công</p></div>
      <button type="button" aria-label="Tải lại tổng quan Staff" disabled={loading} onClick={() => void load()}><RefreshCw className={loading ? 'is-spinning' : ''} size={19} /></button>
    </header>

    <AuraMetricCarousel slides={slides} label="Tổng quan công việc Staff" loading={loading} />
    {error && <section className="staff-dashboard__state"><Clock3 size={20} /><div><strong>Chưa tải đủ dữ liệu công việc</strong><p>{error}</p></div><button type="button" onClick={() => void load()}>Thử lại</button></section>}

    <section className="staff-dashboard__today">
      <header><div><small>CA HÔM NAY</small><h2>Lịch dạy và hiện diện</h2></div><button type="button" onClick={() => onNavigate('staff-schedule')}>Xem tuần <CalendarDays size={17} /></button></header>
      {groupedToday.length ? <div className="staff-dashboard__timeline">{groupedToday.slice(0, 5).map((group) => {
        const statuses = group.items.map(statusLabel)
        const pending = statuses.some((status) => status === 'Chờ xác nhận')
        const future = statuses.every((status) => status === 'Sắp tới')
        return <button type="button" key={group.key} onClick={() => onNavigate('staff-schedule')}>
          <time>{String(group.hour ?? '--').padStart(2, '0')}:00</time>
          <span><strong>{group.items.map((item) => item.studentName || 'Học viên Aura').join(' · ')}</strong><small>{group.items.length} học viên · {pending ? 'Chờ PT xác nhận' : future ? 'Sắp tới' : statuses.join(' · ')}</small></span>
          <i className={pending ? 'is-pending' : future ? 'is-future' : 'is-done'}>{pending ? <Clock3 /> : future ? <CalendarDays /> : <CheckCircle2 />}</i>
        </button>
      })}</div> : <div className="staff-dashboard__empty"><UserRoundCheck size={28} /><strong>Không có ca dạy hôm nay</strong><p>Mở lịch tuần để xem các ca tiếp theo.</p></div>}
    </section>

    <section className="staff-dashboard__modules">
      <header><small>MODULE STAFF</small><h2>Truy cập nhanh</h2></header>
      <div>{modules.map(({ view, label, detail, icon: Icon }) => <button type="button" key={view} onClick={() => onNavigate(view)}><span><Icon size={21} /></span><strong>{label}</strong><small>{detail}</small></button>)}</div>
    </section>
  </main>
}
