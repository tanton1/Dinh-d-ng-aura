import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  ClipboardList,
  Dumbbell,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  UserRoundCheck,
  Users,
  WalletCards,
} from 'lucide-react'
import AuraMetricCarousel, { type AuraMetricSlide } from '../../components/admin/pt/AuraMetricCarousel'
import type { StaffPosition } from '../../identity/access'
import { getMySalesWorkspace, getMyTrainerWorkspace, type CoachWorkspaceScope, type SalesWorkspace, type TrainerSessionSummary } from '../../services/ptOperationsV2Service'
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
  positions: StaffPosition[]
  branchCount: number
  isDemo?: boolean
}

const positionLabels: Record<StaffPosition, string> = {
  trainer_pt: 'PT Gym',
  coach_online: 'HLV Online',
  sales: 'Sales',
  branch_manager: 'Quản lý chi nhánh',
  academy_editor: 'Biên tập Academy',
  shipper: 'Shipper Eat Clean',
}

export default function StaffDashboardPage({ onNavigate, capabilities, positions, branchCount, isDemo = false }: Props) {
  const today = dateKey()
  const periodId = today.slice(0, 7)
  const effectivePositions = useMemo<StaffPosition[]>(() => positions.length ? positions : isDemo ? ['trainer_pt'] : [], [isDemo, positions])
  const coachDashboard = effectivePositions.some((position) => position === 'trainer_pt' || position === 'coach_online')
  const salesDashboard = effectivePositions.includes('sales')
  const managerDashboard = effectivePositions.includes('branch_manager')
  const academyDashboard = effectivePositions.includes('academy_editor')
  const roleLabel = effectivePositions.map((position) => positionLabels[position]).join(' · ') || 'Nhân sự Aura'
  const [scope, setScope] = useState<CoachWorkspaceScope | null>(null)
  const [sessions, setSessions] = useState<TrainerSessionSummary[]>([])
  const [sales, setSales] = useState<SalesWorkspace | null>(null)
  const [payroll, setPayroll] = useState<StaffDashboardPayrollSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [payrollLoading, setPayrollLoading] = useState(true)
  const [error, setError] = useState('')
  const [payrollError, setPayrollError] = useState('')
  const loadedRef = useRef(false)
  const canViewPayroll = capabilities.includes('payroll.self.view') || isDemo

  const load = useCallback(async () => {
    if (loadedRef.current) setRefreshing(true)
    else setLoading(true)
    setError(''); setPayrollError(''); setPayrollLoading(canViewPayroll && !loadedRef.current)
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
      setSessions(demoSessions); setPayroll(demoPayrollSnapshot(periodId)); setLoading(false); setRefreshing(false); setPayrollLoading(false); loadedRef.current = true; return
    }
    const [workspaceResult, salesResult, payrollResult] = await Promise.allSettled([
      coachDashboard ? getMyTrainerWorkspace('schedule', today, today, 500) : Promise.resolve(null),
      salesDashboard ? getMySalesWorkspace(100) : Promise.resolve(null),
      canViewPayroll ? getMyStaffPayroll(periodId) : Promise.resolve(null),
    ])
    if (workspaceResult.status === 'fulfilled' && workspaceResult.value) {
      setScope(workspaceResult.value.scope); setSessions(workspaceResult.value.sessions)
    } else if (workspaceResult.status === 'rejected') {
      setError(workspaceResult.reason instanceof Error ? workspaceResult.reason.message : 'Chưa thể tải tổng quan công việc Staff.')
    }
    if (salesResult.status === 'fulfilled' && salesResult.value) {
      setSales(salesResult.value)
    } else if (salesResult.status === 'rejected') {
      setError((current) => current || (salesResult.reason instanceof Error ? salesResult.reason.message : 'Chưa thể tải tổng quan Sales.'))
    }
    if (payrollResult.status === 'fulfilled') {
      setPayroll(payrollResult.value)
    } else {
      setPayroll(null)
      setPayrollError(payrollResult.reason instanceof Error ? payrollResult.reason.message : 'Chưa thể tải dữ liệu thu nhập tháng này.')
    }
    loadedRef.current = true
    setLoading(false); setRefreshing(false); setPayrollLoading(false)
  }, [canViewPayroll, coachDashboard, isDemo, periodId, salesDashboard, today])

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

  const slides = useMemo<AuraMetricSlide[]>(() => {
    if (coachDashboard) return [
      { id: 'today', eyebrow: 'Ca dạy hôm nay', value: `${todayShiftCount} ca`, detail: `${todaySessions.length} lượt học viên trong lịch`, icon: <Dumbbell size={20} />, tone: 'pink', actionLabel: 'Mở lịch làm việc', onSelect: () => onNavigate('staff-schedule') },
      { id: 'attendance', eyebrow: 'Chờ xác nhận', value: `${pendingAttendance} lượt`, detail: pendingAttendance ? 'Ưu tiên hoàn tất hiện diện sau ca' : 'Không có ca quá giờ đang chờ', icon: <Clock3 size={20} />, tone: 'orange', actionLabel: 'Kiểm tra ca dạy', onSelect: () => onNavigate('staff-schedule') },
      { id: 'students', eyebrow: 'Học viên phụ trách', value: `${(scope?.counts.primaryStudents || 0) + (scope?.counts.secondaryStudents || 0)}`, detail: `${scope?.counts.primaryStudents || 0} chính · ${scope?.counts.secondaryStudents || 0} phụ`, icon: <Users size={20} />, tone: 'sunset', actionLabel: 'Xem học viên', onSelect: () => onNavigate('staff-students') },
      { id: 'requests', eyebrow: 'Yêu cầu lịch', value: `${scope?.counts.pendingRequests || 0} chờ`, detail: 'Đổi, hủy và điều chỉnh ca của bạn', icon: <RotateCcw size={20} />, tone: 'ink', actionLabel: 'Mở yêu cầu', onSelect: () => onNavigate('staff-requests') },
    ]
    if (salesDashboard) {
      const quotes = sales?.quotes || []
      const openQuotes = quotes.filter((quote) => !['approved', 'converted', 'rejected', 'cancelled'].includes(String(quote.status).toLowerCase())).length
      return [
        { id: 'quotes', eyebrow: 'Báo giá phụ trách', value: `${quotes.length}`, detail: `${openQuotes} báo giá đang theo dõi`, icon: <ClipboardList size={20} />, tone: 'pink', actionLabel: 'Mở báo giá', onSelect: () => onNavigate('staff-quotes') },
        { id: 'branches', eyebrow: 'Phạm vi chi nhánh', value: `${sales?.catalog.branches.length || branchCount}`, detail: 'Chỉ dữ liệu trong phạm vi được cấp', icon: <ShieldCheck size={20} />, tone: 'ink' },
        { id: 'packages', eyebrow: 'Gói có thể tư vấn', value: `${sales?.catalog.packages.length || 0}`, detail: 'Danh mục đang hoạt động', icon: <Dumbbell size={20} />, tone: 'orange' },
        { id: 'renewals', eyebrow: 'Chăm sóc & tái ký', value: 'Mở', detail: 'Theo dõi khách hàng cần gia hạn', icon: <RefreshCw size={20} />, tone: 'sunset', actionLabel: 'Mở tái ký', onSelect: () => onNavigate('staff-renewals') },
      ]
    }
    return [
      { id: 'role', eyebrow: 'Vai trò hiện tại', value: roleLabel, detail: 'Giao diện đã được tinh gọn theo chức danh', icon: <ShieldCheck size={20} />, tone: 'pink' },
      { id: 'branches', eyebrow: 'Phạm vi chi nhánh', value: `${branchCount}`, detail: 'Chi nhánh được cấp trong Identity', icon: <CalendarDays size={20} />, tone: 'ink' },
      { id: 'work', eyebrow: 'Không gian công việc', value: managerDashboard ? 'Điều hành' : academyDashboard ? 'Academy' : 'Cá nhân', detail: 'Chỉ hiển thị module đúng nhiệm vụ', icon: academyDashboard ? <BookOpen size={20} /> : <Users size={20} />, tone: 'orange' },
      { id: 'payroll', eyebrow: 'Lương cá nhân', value: canViewPayroll ? 'Có quyền xem' : 'Chưa được cấp', detail: 'Dữ liệu chỉ đọc và có đối soát', icon: <WalletCards size={20} />, tone: 'sunset', actionLabel: canViewPayroll ? 'Mở bảng lương' : undefined, onSelect: canViewPayroll ? () => onNavigate('staff-payroll') : undefined },
    ]
  }, [academyDashboard, branchCount, canViewPayroll, coachDashboard, managerDashboard, onNavigate, pendingAttendance, roleLabel, sales, salesDashboard, scope, todaySessions.length, todayShiftCount])

  const roleActions = useMemo(() => {
    const actions: Array<{ id: string; label: string; detail: string; view: ViewId; icon: typeof CalendarDays }> = []
    if (coachDashboard) actions.push(
      { id: 'schedule', label: 'Lịch & yêu cầu', detail: 'Ca dạy, lịch rảnh và đổi ca', view: 'staff-schedule', icon: CalendarDays },
      { id: 'students', label: 'Học viên phụ trách', detail: 'Hợp đồng, lịch và giáo án', view: 'staff-students', icon: Users },
    )
    if (salesDashboard) actions.push(
      { id: 'quotes', label: 'Báo giá', detail: 'Tạo và theo dõi báo giá', view: 'staff-quotes', icon: ClipboardList },
      { id: 'renewals', label: 'Tái ký', detail: 'Khách hàng cần chăm sóc', view: 'staff-renewals', icon: RefreshCw },
    )
    if (managerDashboard) actions.push(
      { id: 'branch-schedule', label: 'Lịch chi nhánh', detail: 'Draft, cảnh báo và publish', view: 'admin-pt-schedule', icon: CalendarDays },
      { id: 'branch-renewals', label: 'Duyệt tái ký', detail: 'Pipeline trong phạm vi chi nhánh', view: 'staff-renewals', icon: ShieldCheck },
    )
    if (academyDashboard) actions.push({ id: 'academy', label: 'Aura Academy', detail: 'Nội dung học và thư viện', view: 'courses', icon: BookOpen })
    return actions.filter((item, index) => actions.findIndex((candidate) => candidate.view === item.view) === index)
  }, [academyDashboard, coachDashboard, managerDashboard, salesDashboard])

  return <main className="staff-dashboard" data-testid="staff-dashboard-page">
    <header className="staff-dashboard__heading">
      <div><small>AURA STAFF · {roleLabel.toUpperCase()}</small><h1>Tổng quan công việc</h1><p>{today.split('-').reverse().join('/')} · Dữ liệu chỉ trong phạm vi được phân công</p></div>
      <button type="button" aria-label="Tải lại tổng quan Staff" disabled={loading || refreshing} onClick={() => void load()}><RefreshCw className={loading || refreshing ? 'is-spinning' : ''} size={19} /></button>
    </header>

    <AuraMetricCarousel slides={slides} label="Tổng quan công việc Staff" loading={loading} />
    {error && <section className="staff-dashboard__state"><Clock3 size={20} /><div><strong>Chưa tải đủ dữ liệu công việc</strong><p>{error}</p></div><button type="button" onClick={() => void load()}>Thử lại</button></section>}

    {roleActions.length > 0 && <section className="staff-dashboard__role-actions">
      <header><div><small>TRUY CẬP THEO VAI TRÒ</small><h2>Việc cần làm</h2></div></header>
      <div>{roleActions.map(({ id, label, detail, view: target, icon: Icon }) => <button type="button" key={id} onClick={() => onNavigate(target)}><span><Icon size={19} /></span><strong>{label}</strong><small>{detail}</small></button>)}</div>
    </section>}

    {coachDashboard && <section className="staff-dashboard__today">
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
    </section>}

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
