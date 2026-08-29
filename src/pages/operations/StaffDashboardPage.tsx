import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
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
import { getMyStaffPayroll } from '../../services/staffPayrollService'
import type { ViewId } from '../../types'
import {
  buildStaffDashboardPayrollChart,
  type StaffDashboardPayrollSnapshot,
} from '../../utils/staffDashboardPayroll'
import './StaffDashboardPage.css'

const vietnamDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
})

function dateKey(date = new Date()) { return vietnamDateFormatter.format(date) }
function addDays(value: string, amount: number) {
  return dateKey(new Date(Date.parse(`${value}T12:00:00+07:00`) + amount * 86_400_000))
}
function money(value: unknown) {
  const parsed = Number(value)
  const safe = Number.isFinite(parsed) ? Math.round(parsed) : 0
  return `${safe.toLocaleString('vi-VN')}đ`
}
function periodLabel(periodId: string) {
  const matched = /^(\d{4})-(\d{2})$/.exec(periodId)
  return matched ? `Tháng ${Number(matched[2])}/${matched[1]}` : periodId
}
function chartHeight(value: number, maximum: number) {
  if (value <= 0 || maximum <= 0) return '0%'
  return `${Math.max(7, Math.round(value / maximum * 100))}%`
}
function demoPayrollSnapshot(periodId: string): StaffDashboardPayrollSnapshot {
  const workdayDates = ['03', '10', '17', '24', '28']
  return {
    periodId,
    amounts: { baseSalaryAmount: 9_600_000, teachingPayAmount: 2_450_000 },
    workdays: {
      days: workdayDates.map((day, index) => ({
        date: `${periodId}-${day}`,
        weekday: index + 1,
        status: index < 3 ? 'present' as const : 'upcoming' as const,
        eligible: true,
        holidayName: '',
        note: '',
        revision: index < 3 ? 1 : 0,
        teachingSlotCount: index < 3 ? index + 1 : 0,
        source: index < 3 ? 'admin_override' as const : 'calendar' as const,
      })),
    },
    teachingSlots: [
      { key: 'demo-pay-1', date: `${periodId}-03`, hour: 7, branchId: 'demo', dailyPosition: 1, tier: 'standard', rate: 450_000, policyId: 'demo', policyName: 'Chính sách PT', studentCount: 2, sessionIds: ['demo-1', 'demo-2'] },
      { key: 'demo-pay-2', date: `${periodId}-10`, hour: 8, branchId: 'demo', dailyPosition: 1, tier: 'standard', rate: 750_000, policyId: 'demo', policyName: 'Chính sách PT', studentCount: 1, sessionIds: ['demo-3'] },
      { key: 'demo-pay-3', date: `${periodId}-17`, hour: 18, branchId: 'demo', dailyPosition: 1, tier: 'after_threshold_evening', rate: 1_250_000, policyId: 'demo', policyName: 'Chính sách PT', studentCount: 1, sessionIds: ['demo-4'] },
    ],
    run: { official: false },
  }
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
  const periodId = today.slice(0, 7)
  const [scope, setScope] = useState<CoachWorkspaceScope | null>(null)
  const [sessions, setSessions] = useState<TrainerSessionSummary[]>([])
  const [payroll, setPayroll] = useState<StaffDashboardPayrollSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [payrollLoading, setPayrollLoading] = useState(true)
  const [error, setError] = useState('')
  const [payrollError, setPayrollError] = useState('')
  const canViewPayroll = capabilities.includes('payroll.self.view') || isDemo

  const load = useCallback(async () => {
    setLoading(true); setError(''); setPayrollError(''); setPayrollLoading(canViewPayroll)
    if (isDemo) {
      const demoSessions: TrainerSessionSummary[] = [
        { id: 'demo-5', studentId: 'demo-e', trainerId: 'demo-staff', studentName: 'Đỗ Khánh Linh', date: today, hour: 6, status: 'attended', attendanceStatus: 'present', billingStatus: 'charged', timeZone: 'Asia/Ho_Chi_Minh' },
        { id: 'demo-6', studentId: 'demo-f', trainerId: 'demo-staff', studentName: 'Võ Bảo Ngọc', date: today, hour: 7, status: 'attended', attendanceStatus: 'present', billingStatus: 'charged', timeZone: 'Asia/Ho_Chi_Minh' },
        { id: 'demo-1', studentId: 'demo-a', trainerId: 'demo-staff', studentName: 'Nguyễn Minh Anh', date: today, hour: 8, status: 'attended', attendanceStatus: 'present', billingStatus: 'charged', timeZone: 'Asia/Ho_Chi_Minh' },
        { id: 'demo-2', studentId: 'demo-b', trainerId: 'demo-staff', studentName: 'Trần Thu Hà', date: today, hour: 8, status: 'attended', attendanceStatus: 'present', billingStatus: 'charged', timeZone: 'Asia/Ho_Chi_Minh' },
        { id: 'demo-7', studentId: 'demo-g', trainerId: 'demo-staff', studentName: 'Phan Mỹ Duyên', date: today, hour: 9, status: 'attended', attendanceStatus: 'present', billingStatus: 'charged', timeZone: 'Asia/Ho_Chi_Minh' },
        { id: 'demo-8', studentId: 'demo-h', trainerId: 'demo-staff', studentName: 'Ngô Hoàng Anh', date: today, hour: 10, status: 'scheduled', attendanceStatus: 'pending', billingStatus: 'pending', timeZone: 'Asia/Ho_Chi_Minh' },
        { id: 'demo-9', studentId: 'demo-i', trainerId: 'demo-staff', studentName: 'Lâm Thanh Trúc', date: today, hour: 17, status: 'scheduled', attendanceStatus: 'pending', billingStatus: 'pending', timeZone: 'Asia/Ho_Chi_Minh' },
        { id: 'demo-3', studentId: 'demo-c', trainerId: 'demo-staff', studentName: 'Lê Ngọc Mai', date: today, hour: 18, status: 'scheduled', attendanceStatus: 'pending', billingStatus: 'pending', timeZone: 'Asia/Ho_Chi_Minh' },
        { id: 'demo-4', studentId: 'demo-d', trainerId: 'demo-staff', studentName: 'Phạm Thảo Vy', date: addDays(today, 1), hour: 7, status: 'scheduled', attendanceStatus: 'pending', billingStatus: 'pending', timeZone: 'Asia/Ho_Chi_Minh' },
      ]
      setScope({ schemaVersion: 1, source: 'pt_contract_assignments', staffId: 'demo-staff', tabs: { students: true, schedule: true, requests: true, nutrition: true }, counts: { primaryStudents: 8, secondaryStudents: 3, nutritionStudents: 5, teachingSessions: 24, pendingRequests: 2 } })
      setSessions(demoSessions); setPayroll(demoPayrollSnapshot(periodId)); setLoading(false); setPayrollLoading(false); return
    }
    const [workspaceResult, payrollResult] = await Promise.allSettled([
      getMyTrainerWorkspace('schedule', today, today, 500),
      canViewPayroll ? getMyStaffPayroll(periodId) : Promise.resolve(null),
    ])
    if (workspaceResult.status === 'fulfilled') {
      setScope(workspaceResult.value.scope); setSessions(workspaceResult.value.sessions)
    } else {
      setError(workspaceResult.reason instanceof Error ? workspaceResult.reason.message : 'Chưa thể tải tổng quan công việc Staff.')
    }
    if (payrollResult.status === 'fulfilled') {
      setPayroll(payrollResult.value)
    } else {
      setPayroll(null)
      setPayrollError(payrollResult.reason instanceof Error ? payrollResult.reason.message : 'Chưa thể tải dữ liệu thu nhập tháng này.')
    }
    setLoading(false); setPayrollLoading(false)
  }, [canViewPayroll, isDemo, periodId, today])

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
  const payrollChart = useMemo(() => payroll ? buildStaffDashboardPayrollChart(payroll) : null, [payroll])
  const teachingSlotCount = payrollChart?.buckets.reduce((sum, bucket) => sum + bucket.teachingSlotCount, 0) || 0

  const slides = useMemo<AuraMetricSlide[]>(() => [
    { id: 'today', eyebrow: 'Ca dạy hôm nay', value: `${todayShiftCount} ca`, detail: `${todaySessions.length} lượt học viên trong lịch`, icon: <Dumbbell size={20} />, tone: 'pink', actionLabel: 'Mở lịch làm việc', onSelect: () => onNavigate('staff-schedule') },
    { id: 'attendance', eyebrow: 'Chờ xác nhận', value: `${pendingAttendance} lượt`, detail: pendingAttendance ? 'Ưu tiên hoàn tất hiện diện sau ca' : 'Không có ca quá giờ đang chờ', icon: <Clock3 size={20} />, tone: 'orange', actionLabel: 'Kiểm tra ca dạy', onSelect: () => onNavigate('staff-schedule') },
    { id: 'students', eyebrow: 'Học viên phụ trách', value: `${(scope?.counts.primaryStudents || 0) + (scope?.counts.secondaryStudents || 0)}`, detail: `${scope?.counts.primaryStudents || 0} chính · ${scope?.counts.secondaryStudents || 0} phụ`, icon: <Users size={20} />, tone: 'sunset', actionLabel: 'Xem học viên', onSelect: () => onNavigate('staff-students') },
    { id: 'requests', eyebrow: 'Yêu cầu lịch', value: `${scope?.counts.pendingRequests || 0} chờ`, detail: 'Đổi, hủy và điều chỉnh ca của bạn', icon: <RotateCcw size={20} />, tone: 'ink', actionLabel: 'Mở yêu cầu', onSelect: () => onNavigate('staff-requests') },
  ], [onNavigate, pendingAttendance, scope, todaySessions.length, todayShiftCount])

  return <main className="staff-dashboard" data-testid="staff-dashboard-page">
    <header className="staff-dashboard__heading">
      <div><small>AURA STAFF</small><h1>Tổng quan công việc</h1><p>{today.split('-').reverse().join('/')} · Dữ liệu chỉ trong phạm vi được phân công</p></div>
      <button type="button" aria-label="Tải lại tổng quan Staff" disabled={loading} onClick={() => void load()}><RefreshCw className={loading ? 'is-spinning' : ''} size={19} /></button>
    </header>

    <AuraMetricCarousel slides={slides} label="Tổng quan công việc Staff" loading={loading} />
    {error && <section className="staff-dashboard__state"><Clock3 size={20} /><div><strong>Chưa tải đủ dữ liệu công việc</strong><p>{error}</p></div><button type="button" onClick={() => void load()}>Thử lại</button></section>}

    <section className="staff-dashboard__today">
      <header><div><small>CA HÔM NAY</small><h2>Lịch dạy và hiện diện</h2></div><button type="button" onClick={() => onNavigate('staff-schedule')}>Xem tuần <CalendarDays size={17} /></button></header>
      {groupedToday.length ? <div className="staff-dashboard__timeline">{groupedToday.map((group) => {
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

    <section className="staff-dashboard__payroll" aria-label="Biểu đồ lương và hoa hồng ca dạy trong tháng" aria-busy={payrollLoading}>
      <header>
        <div><small>THU NHẬP · {periodLabel(periodId).toUpperCase()}</small><h2>Lương & hoa hồng ca dạy</h2></div>
        {canViewPayroll && <button type="button" onClick={() => onNavigate('staff-payroll')}>Chi tiết <WalletCards size={17} /></button>}
      </header>
      {payrollLoading ? <div className="staff-dashboard__payroll-loading" aria-label="Đang tải biểu đồ thu nhập"><span /><span /><span /><span /><span /></div>
        : payrollError ? <div className="staff-dashboard__payroll-state"><BarChart3 size={28} /><strong>Chưa tải được dữ liệu thu nhập</strong><p>{payrollError}</p><button type="button" onClick={() => void load()}>Thử lại</button></div>
          : payrollChart ? <>
            <div className="staff-dashboard__payroll-summary">
              <article><span><WalletCards size={17} />Lương theo công</span><strong>{money(payrollChart.baseSalaryAmount)}</strong><small>{payrollChart.official ? 'Đã khóa số liệu' : 'Tạm tính trong kỳ'}</small></article>
              <article><span><CircleDollarSign size={17} />Hoa hồng ca dạy</span><strong>{money(payrollChart.teachingPayAmount)}</strong><small>{teachingSlotCount} ca đã ghi nhận</small></article>
            </div>
            <div className="staff-dashboard__chart" role="img" aria-label={`Biểu đồ ${periodLabel(periodId)}: lương ${money(payrollChart.baseSalaryAmount)}, hoa hồng ca dạy ${money(payrollChart.teachingPayAmount)}`}>
              {payrollChart.buckets.map((bucket) => <article key={bucket.id}>
                <div className="staff-dashboard__bars">
                  <span className="is-salary" style={{ height: chartHeight(bucket.baseSalaryAmount, payrollChart.maxBucketAmount) }} title={`Lương ${bucket.label}: ${money(bucket.baseSalaryAmount)}`} />
                  <span className="is-teaching" style={{ height: chartHeight(bucket.teachingPayAmount, payrollChart.maxBucketAmount) }} title={`Hoa hồng ca dạy ${bucket.label}: ${money(bucket.teachingPayAmount)}`} />
                </div>
                <strong>{bucket.label}</strong><small>{bucket.teachingSlotCount} ca</small>
              </article>)}
            </div>
            <footer><span><i className="is-salary" />Lương theo công</span><span><i className="is-teaching" />Hoa hồng ca dạy</span><small>Tiền ca chỉ ghi nhận sau điểm danh hợp lệ.</small></footer>
          </> : <div className="staff-dashboard__payroll-state"><BarChart3 size={28} /><strong>Chưa có dữ liệu thu nhập</strong><p>Bảng lương tháng sẽ xuất hiện khi tài khoản được cấp quyền và có chính sách phù hợp.</p></div>}
    </section>
  </main>
}
