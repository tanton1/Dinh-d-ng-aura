import { RevenueComparisonChart } from '../../components/admin/pt/finance-analytics/FinanceChartGraphic'
import './AdminDashboard.css'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  BookOpen,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  CircleHelp,
  Clock3,
  ClipboardCheck,
  RefreshCw,
  Salad,
  UserPlus,
  Users,
  WalletCards,
} from 'lucide-react'
import type { ViewId } from '../../types'
import {
  getOperationsDashboard,
  type DashboardActionMetric,
  type OperationsDashboardData,
} from '../../services/operationsDashboardService'
import AuraMetricCarousel, { type AuraMetricSlide } from '../../components/admin/pt/AuraMetricCarousel'
import DateRangeFilter from '../../components/admin/pt/DateRangeFilter'
import {
  getStaffPayrollStatement,
  listStaffPayrollAttendance,
  type StaffAttendanceRow,
} from '../../services/staffPayrollService'
import {
  buildStaffDashboardPayrollChart,
  type StaffDashboardPayrollSnapshot,
} from '../../utils/staffDashboardPayroll'
import { useDebounce } from '../../hooks/useDebounce'
import { useAuth } from '../../contexts/AuthContext'
import { trackProductEvent } from '../../services/analyticsService'
import { useAuraUiSurface } from '../../features/ui-rollout/AuraUiRolloutContext'
const OperationalActionCenter = lazy(() => import('../../components/operations/OperationalActionCenter'))

function money(value: number) {
  const amount = Number(value)
  return `${Math.round(Number.isFinite(amount) ? amount : 0).toLocaleString('vi-VN')}đ`
}

function startOfMonth() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
}

function currentMinute() {
  const now = new Date()
  now.setSeconds(0, 0)
  return now.toISOString()
}

function dashboardErrorMessage(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (code.includes('permission-denied')) return 'Tài khoản chưa có quyền xem Tổng quan hoặc phạm vi chi nhánh chưa được đồng bộ.'
  if (code.includes('unauthenticated')) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để tải Tổng quan.'
  if (code.includes('resource-exhausted')) return 'Dữ liệu trong kỳ quá lớn. Hãy chọn khoảng thời gian ngắn hơn rồi thử lại.'
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return 'Dịch vụ Tổng quan chưa phản hồi. Các số liệu cũ không được giả định là dữ liệu mới.'
}

function compactMoney(value: number) {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0
  return new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 }).format(amount)
}

const vietnamDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
})

function payrollPeriodId(date = new Date()) {
  return vietnamDateFormatter.format(date).slice(0, 7)
}

function periodLabel(periodId: string) {
  const matched = /^(\d{4})-(\d{2})$/.exec(periodId)
  return matched ? `Tháng ${Number(matched[2])}/${matched[1]}` : periodId
}

function chartHeight(value: number, maximum: number) {
  if (value <= 0 || maximum <= 0) return '0%'
  return `${Math.max(7, Math.round(value / maximum * 100))}%`
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'A'
  return parts.slice(-2).map((part) => part[0]?.toUpperCase()).join('')
}

function payrollErrorMessage(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (code.includes('permission-denied')) return 'Tài khoản chưa có quyền xem bảng lương nhân sự trong phạm vi này.'
  if (code.includes('unauthenticated')) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để xem bảng lương.'
  return error instanceof Error && error.message ? error.message : 'Chưa thể tải dữ liệu lương và tiền ca dạy.'
}

interface AdminPayrollStaffTab {
  staffId: string
  name: string
  employmentType: StaffAttendanceRow['employmentType']
  teachingSlotCount: number
  baseSalaryEarned: number
  teachingPayAmount: number
  finalAmount: number
  reviewRequired: boolean
}

interface DemoPayrollProfile extends AdminPayrollStaffTab {
  teachingRates: Array<{ day: number; rate: number }>
  official: boolean
}

const demoPayrollProfiles: DemoPayrollProfile[] = [
  { staffId: 'trainer-1', name: 'PT Mai', employmentType: 'full_time', teachingSlotCount: 3, baseSalaryEarned: 9_600_000, teachingPayAmount: 2_450_000, finalAmount: 12_050_000, reviewRequired: false, official: false, teachingRates: [{ day: 3, rate: 450_000 }, { day: 10, rate: 750_000 }, { day: 17, rate: 1_250_000 }] },
  { staffId: 'trainer-2', name: 'PT Tấn', employmentType: 'full_time', teachingSlotCount: 4, baseSalaryEarned: 8_800_000, teachingPayAmount: 3_100_000, finalAmount: 11_900_000, reviewRequired: false, official: true, teachingRates: [{ day: 4, rate: 550_000 }, { day: 11, rate: 650_000 }, { day: 18, rate: 800_000 }, { day: 25, rate: 1_100_000 }] },
  { staffId: 'trainer-3', name: 'PT Âu', employmentType: 'part_time', teachingSlotCount: 3, baseSalaryEarned: 7_900_000, teachingPayAmount: 1_850_000, finalAmount: 9_750_000, reviewRequired: true, official: false, teachingRates: [{ day: 5, rate: 450_000 }, { day: 12, rate: 650_000 }, { day: 19, rate: 750_000 }] },
  { staffId: 'trainer-4', name: 'PT Hùng', employmentType: 'collaborator', teachingSlotCount: 4, baseSalaryEarned: 0, teachingPayAmount: 2_100_000, finalAmount: 2_100_000, reviewRequired: false, official: false, teachingRates: [{ day: 6, rate: 450_000 }, { day: 13, rate: 450_000 }, { day: 20, rate: 550_000 }, { day: 27, rate: 650_000 }] },
]

function demoPayrollRoster(): AdminPayrollStaffTab[] {
  return demoPayrollProfiles.map(({ teachingRates: _teachingRates, official: _official, ...profile }) => profile)
}

function demoPayrollStatement(periodId: string, staffId: string): StaffDashboardPayrollSnapshot | null {
  const profile = demoPayrollProfiles.find((item) => item.staffId === staffId)
  if (!profile) return null
  const [year, month] = periodId.split('-').map(Number)
  const daysInMonth = new Date(year, month, 0).getDate()
  const workdayNumbers = [3, 7, 10, 14, 17, 21, 24, 28, 29].filter((day) => day <= daysInMonth)
  return {
    periodId,
    amounts: {
      baseSalaryAmount: profile.baseSalaryEarned,
      teachingPayAmount: profile.teachingPayAmount,
    },
    workdays: {
      days: workdayNumbers.map((day, index) => ({
        date: `${periodId}-${String(day).padStart(2, '0')}`,
        weekday: index % 7,
        status: 'present' as const,
        eligible: profile.employmentType !== 'collaborator',
        holidayName: '',
        note: '',
        revision: 1,
        teachingSlotCount: profile.teachingRates.some((slot) => slot.day === day) ? 1 : 0,
        source: 'admin_override' as const,
      })),
    },
    teachingSlots: profile.teachingRates.map((slot, index) => ({
      key: `${staffId}-demo-slot-${index}`,
      date: `${periodId}-${String(slot.day).padStart(2, '0')}`,
      hour: index % 2 ? 18 : 7,
      branchId: 'demo',
      dailyPosition: 1,
      tier: index > 1 ? 'after_threshold' as const : 'standard' as const,
      rate: slot.rate,
      policyId: 'demo-policy',
      policyName: 'Chính sách PT Aura',
      studentCount: 1,
      sessionIds: [`${staffId}-demo-session-${index}`],
    })),
    run: { official: profile.official },
  }
}

function rangeCaption(startAt: string, endAt: string) {
  const start = new Date(startAt)
  const end = new Date(endAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Kỳ đang chọn'
  const format = (value: Date) => value.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: start.getFullYear() === end.getFullYear() ? undefined : 'numeric' })
  return `${format(start)} – ${format(end)}`
}

const ratioPalette = ['#f62f82', '#ff8751', '#7d4d70', '#f5a6c4', '#ffc3a7', '#bda6b3']

function ratioGradient(items: Array<{ percent: number }>) {
  let cursor = 0
  const segments = items.map((item, index) => {
    const start = cursor
    cursor += Math.max(0, item.percent)
    return `${ratioPalette[index % ratioPalette.length]} ${start}% ${Math.min(100, cursor)}%`
  })
  return segments.length ? `conic-gradient(${segments.join(',')})` : 'conic-gradient(#f3e8ed 0 100%)'
}

function focusedHash(view: ViewId, focus?: string) {
  const params = new URLSearchParams()
  if (focus) params.set('focus', focus)
  const query = params.toString()
  return `#/${view}${query ? `?${query}` : ''}`
}

type ActionTone = AuraMetricSlide['tone']
type ActionSeverity = 'critical' | 'warning' | 'normal'

interface DashboardAction {
  id: string
  label: string
  value: string
  detail: string
  taskDetail: string
  metric: DashboardActionMetric
  icon: ReactNode
  tone: ActionTone
  severity: ActionSeverity
  view: ViewId
  focus: string
}

interface Props {
  onNavigate: (view: ViewId) => void
  adminName?: string
  isDemo?: boolean
  /**
   * The dashboard is also reachable from legacy staff routes because the
   * legacy role map grants `dashboard.view`. Payroll roster/statement calls,
   * however, are admin-only. Keep this explicit capability gate at the UI
   * boundary so a staff dashboard can never fan out into admin payroll calls
   * while authz is still resolving or when a stale hash opens this page.
   */
  canViewPayroll?: boolean
  canManageCoaching?: boolean
}

export default function AdminDashboard(props: Props) {
  const { user, accessContext, authzReady } = useAuth()
  // Account/permission changes discard all financial and payroll state before
  // a new actor can see the previous actor's response, including pending reads.
  const authorityKey = JSON.stringify([
    props.isDemo === true, user?.uid || '', authzReady, accessContext?.uid,
    accessContext?.authzVersion, accessContext?.status, accessContext?.accessRole,
    [...(accessContext?.branchIds || [])].sort(), [...(accessContext?.capabilities || [])].sort(),
    [...(accessContext?.positions || [])].sort(), props.canViewPayroll === true, props.canManageCoaching === true,
  ])
  const readsEnabled = props.isDemo === true || Boolean(user && authzReady && accessContext?.uid === user.uid && accessContext?.status === 'active')
  if (!readsEnabled) return <div className="page admin-dashboard" role="status">Đang kiểm tra quyền xem tổng quan…</div>
  return <AdminDashboardContent key={authorityKey} {...props} authorityKey={authorityKey} authorizationVersion={accessContext?.authzVersion || 0} />
}

function AdminDashboardContent({
  onNavigate,
  adminName = 'Admin Aura',
  isDemo = false,
  canViewPayroll = false,
  canManageCoaching = false,
  authorizationVersion,
  authorityKey,
}: Props & { authorizationVersion: number; authorityKey: string }) {
  const dashboardV4 = useAuraUiSurface('admin-dashboard')
  const actionCenterEnabled = useAuraUiSurface('action-center')
  const [response, setResponse] = useState<{ queryKey: string; branchId: string; value: OperationsDashboardData } | null>(null)
  const [requestLoading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [requestError, setError] = useState<{ queryKey: string; message: string } | null>(null)
  const [range, setRange] = useState(() => ({ startAt: startOfMonth(), endAt: currentMinute() }))
  const [branchId, setBranchId] = useState('all')
  const dashboardQuery = useMemo(() => ({ branchId, startAt: range.startAt, endAt: range.endAt }), [branchId, range.endAt, range.startAt])
  const debouncedDashboardQuery = useDebounce(dashboardQuery, 250)
  const queryKey = JSON.stringify(dashboardQuery)
  const currentQueryKey = useRef(queryKey)
  currentQueryKey.current = queryKey
  const data = response?.queryKey === queryKey ? response.value : null
  const error = requestError?.queryKey === queryKey ? requestError.message : ''
  const loading = requestLoading || queryKey !== JSON.stringify(debouncedDashboardQuery)
  const loadGeneration = useRef(0)
  const load = useCallback(async (forceRefresh = false) => {
    const requestedQueryKey = JSON.stringify(debouncedDashboardQuery)
    if (requestedQueryKey !== currentQueryKey.current) return
    const generation = ++loadGeneration.current
    const isCurrent = () => generation === loadGeneration.current && requestedQueryKey === currentQueryKey.current
    const requestStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    forceRefresh ? setRefreshing(true) : setLoading(true)
    setError(null)
    try {
      const result = await getOperationsDashboard({
        startAt: debouncedDashboardQuery.startAt,
        endAt: debouncedDashboardQuery.endAt,
        branchId: debouncedDashboardQuery.branchId,
        forceRefresh,
      }, { authorizationVersion, authorityKey })
      if (isCurrent()) {
        setResponse({ queryKey: requestedQueryKey, branchId: debouncedDashboardQuery.branchId, value: result })
        void trackProductEvent('admin_dashboard_loaded', {
          durationMs: Math.max(0, Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - requestStartedAt)),
          cacheTier: result.cache.tier,
          branchScope: result.branchId === 'all' ? 'all' : 'branch',
          forceRefresh,
        })
      }
    } catch (loadError) {
      if (isCurrent()) setError({ queryKey: requestedQueryKey, message: dashboardErrorMessage(loadError) })
    } finally {
      if (isCurrent()) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [authorizationVersion, authorityKey, debouncedDashboardQuery.branchId, debouncedDashboardQuery.endAt, debouncedDashboardQuery.startAt])

  useEffect(() => {
    void load()
    return () => { loadGeneration.current += 1 }
  }, [load])

  // Reporting date changes do not reload the independently selected payroll
  // month. Branch changes unmount the card and require opening the new scope.
  const payrollEnabled = canViewPayroll && response?.branchId === branchId && response.value.permissions.payroll === true

  const updateRange = useCallback((start: Date, end: Date) => {
    const now = new Date()
    const safeEnd = new Date(Math.min(end.getTime(), now.getTime()))
    safeEnd.setMilliseconds(0)
    if (safeEnd.toDateString() === now.toDateString()) safeEnd.setSeconds(0)
    const safeStart = new Date(start)
    safeStart.setMilliseconds(0)
    const startAt = safeStart.toISOString()
    const endAt = safeEnd.toISOString()
    setRange((current) => current.startAt === startAt && current.endAt === endAt ? current : { startAt, endAt })
  }, [])

  const goTo = useCallback((view: ViewId, focus?: string) => {
    if (focus) {
      window.location.hash = focusedHash(view, focus)
      return
    }
    onNavigate(view)
  }, [onNavigate])

  const actions = useMemo<DashboardAction[]>(() => {
    if (!data) return []
    const receivables = data.actionSummary.overdueReceivables
    const renewals = data.actionSummary.dueRenewals
    const schedule = data.actionSummary.pendingScheduleRequests
    const nutrition = data.actionSummary.overdueMealReviews
    const values: DashboardAction[] = [
      {
        id: 'receivables', label: 'Công nợ đến hạn',
        value: receivables.actionCount ? money(receivables.amount) : 'Đúng hạn',
        detail: `${receivables.overdueCount} quá hạn · ${receivables.dueTodayCount} đến hạn hôm nay`,
        taskDetail: `${receivables.actionCount} hợp đồng cần thu · ${money(receivables.amount)}`,
        metric: receivables, icon: <CircleDollarSign size={20} />, tone: 'ink',
        severity: receivables.overdueCount ? 'critical' : receivables.dueTodayCount ? 'warning' : 'normal',
        view: 'admin-finance', focus: 'overdue',
      },
      {
        id: 'renewals', label: 'Tái ký đến hạn', value: `${renewals.actionCount.toLocaleString('vi-VN')} hồ sơ`,
        detail: `${renewals.overdueCount} quá SLA · ${renewals.dueTodayCount} cần chăm hôm nay`,
        taskDetail: `${renewals.overdueCount} quá SLA · ${renewals.dueTodayCount} đến hạn hôm nay`,
        metric: renewals, icon: <Users size={20} />, tone: 'pink',
        severity: renewals.overdueCount ? 'critical' : renewals.dueTodayCount ? 'warning' : 'normal',
        view: 'admin-renewals', focus: 'overdue',
      },
      {
        id: 'schedule', label: 'Lịch cần xử lý', value: `${schedule.actionCount.toLocaleString('vi-VN')} việc`,
        detail: `${schedule.totalCount} yêu cầu · ${schedule.warningCount} lịch nháp`,
        taskDetail: `${schedule.totalCount} yêu cầu đổi, hủy hoặc off · ${schedule.warningCount} lịch nháp`,
        metric: schedule, icon: <CalendarClock size={20} />, tone: 'sunset',
        severity: schedule.overdueCount ? 'critical' : schedule.actionCount ? 'warning' : 'normal',
        view: 'admin-training-history', focus: 'requests',
      },
      {
        id: 'nutrition', label: 'Duyệt bữa ăn', value: `${nutrition.actionCount.toLocaleString('vi-VN')} bữa`,
        detail: `${nutrition.overdueCount} quá SLA · ưu tiên cũ nhất trước`,
        taskDetail: `${nutrition.overdueCount} quá SLA trong ${nutrition.totalCount} bữa chờ duyệt`,
        metric: nutrition, icon: <Salad size={20} />, tone: 'orange',
        severity: nutrition.overdueCount ? 'critical' : nutrition.actionCount ? 'warning' : 'normal',
        view: 'admin-nutrition-reviews', focus: 'overdue',
      },
    ]
    return values.filter((item) => item.metric.available || data.scope.unrestricted)
  }, [data])

  const priorityActions = useMemo(() => [...actions].sort((left, right) => {
    const severity = { critical: 0, warning: 1, normal: 2 }
    return severity[left.severity] - severity[right.severity]
      || right.metric.overdueCount - left.metric.overdueCount
      || right.metric.actionCount - left.metric.actionCount
  }), [actions])

  const reportSlides = useMemo<AuraMetricSlide[]>(() => {
    if (!data && !error) {
      return [
        { id: 'loading-revenue', eyebrow: 'DOANH THU THỰC HIỆN', value: '—', detail: 'Đang tổng hợp theo kỳ báo cáo', icon: <CircleDollarSign size={20} />, tone: 'ink' },
        { id: 'loading-students', eyebrow: 'HỌC VIÊN MỚI', value: '—', detail: 'Đang đối chiếu hồ sơ mới', icon: <UserPlus size={20} />, tone: 'pink' },
        { id: 'loading-cash', eyebrow: 'THỰC THU RÒNG', value: '—', detail: 'Đang đối chiếu ledger canonical', icon: <WalletCards size={20} />, tone: 'sunset' },
        { id: 'loading-contracts', eyebrow: 'HỢP ĐỒNG HIỆU LỰC', value: '—', detail: 'Đang kiểm tra thời hạn và số buổi', icon: <ClipboardCheck size={20} />, tone: 'orange' },
        { id: 'loading-debt', eyebrow: 'CÔNG NỢ QUÁ HẠN', value: '—', detail: 'Đang lập danh sách cần thu', icon: <Clock3 size={20} />, tone: 'ink' },
      ]
    }
    if (!data) {
      return Array.from({ length: 5 }, (_, index) => ({
        id: `error-${index}`, eyebrow: ['DOANH THU THỰC HIỆN', 'HỌC VIÊN MỚI', 'THỰC THU RÒNG', 'HỢP ĐỒNG HIỆU LỰC', 'CÔNG NỢ QUÁ HẠN'][index],
        value: 'Chưa đồng bộ', detail: 'Không dùng số liệu cũ thay thế', icon: index === 1 ? <UserPlus size={20} /> : <CircleDollarSign size={20} />,
        tone: (['ink', 'pink', 'sunset', 'orange', 'ink'][index] as AuraMetricSlide['tone']), actionLabel: 'Thử lại', onSelect: () => void load(true),
      }))
    }
    const caption = rangeCaption(data.range.startAt, data.range.endAt)
    return [
      {
        id: 'revenue', eyebrow: 'DOANH THU THỰC HIỆN', value: money(data.finance.recognizedRevenue),
        detail: `${caption} · không cộng vào dòng tiền`, icon: <CircleDollarSign size={20} />, tone: 'ink',
        actionLabel: 'Xem biểu đồ', onSelect: () => document.getElementById('dashboard-analytics-title')?.scrollIntoView({ behavior: 'smooth' }),
      },
      {
        id: 'new-students', eyebrow: 'HỌC VIÊN MỚI', value: `${data.clients.newInRange.toLocaleString('vi-VN')} hồ sơ`,
        detail: `${caption} · ${data.clients.active.toLocaleString('vi-VN')} học viên đang hoạt động`, icon: <UserPlus size={20} />, tone: 'pink',
        actionLabel: 'Mở học viên', onSelect: () => goTo('admin-pt-students'),
      },
      {
        id: 'net-cash', eyebrow: 'THỰC THU RÒNG', value: money(data.finance.netCash),
        detail: `${money(data.finance.cashCollected)} thu gộp · đã trừ hoàn/đảo`, icon: <WalletCards size={20} />, tone: 'sunset',
        actionLabel: 'Mở tài chính', onSelect: () => goTo('admin-finance'),
      },
      {
        id: 'active-contracts', eyebrow: 'HỢP ĐỒNG HIỆU LỰC', value: `${data.clients.activeContracts.toLocaleString('vi-VN')} hợp đồng`,
        detail: `Còn thời hạn, còn buổi · ${data.clients.preservedContracts} đang bảo lưu`, icon: <ClipboardCheck size={20} />, tone: 'orange',
        actionLabel: 'Mở học viên', onSelect: () => goTo('admin-pt-students'),
      },
      {
        id: 'overdue-debt', eyebrow: 'CÔNG NỢ QUÁ HẠN', value: money(data.receivables.summary.overdue.amount),
        detail: `${data.receivables.summary.overdue.count} kỳ cần ưu tiên thu`, icon: <Clock3 size={20} />, tone: 'ink',
        actionLabel: 'Xem công nợ', onSelect: () => document.getElementById('dashboard-receivables-title')?.scrollIntoView({ behavior: 'smooth' }),
      },
    ]
  }, [data, error, goTo, load])

  const taskItems = useMemo(() => {
    const items = [...priorityActions.filter((item) => item.metric.actionCount > 0)]
    const missingDates = data?.actionSummary.missingContractEffectiveDate
    if (missingDates?.available && missingDates.actionCount > 0) {
      items.push({
        id: 'contract-quality', label: 'Hợp đồng thiếu ngày ký', value: `${missingDates.actionCount} hồ sơ`,
        detail: 'Cần đối soát dữ liệu', taskDetail: `${missingDates.actionCount} hợp đồng chưa có ngày ghi nhận doanh số hợp lệ`,
        metric: missingDates, icon: <ClipboardCheck size={20} />, tone: 'orange', severity: 'warning',
        view: 'admin-pt-students', focus: 'contract-quality',
      })
    }
    return items.slice(0, 5)
  }, [data, priorityActions])

  const shortcuts = useMemo(() => {
    if (!data) return []
    return [
      data.permissions.clients && { id: 'students', label: 'Học viên', view: 'admin-pt-students' as ViewId, icon: <Users size={20} /> },
      data.permissions.schedule && { id: 'schedule', label: 'Xếp lịch', view: 'admin-pt-schedule' as ViewId, icon: <CalendarClock size={20} /> },
      data.permissions.finance && { id: 'finance', label: 'Trả góp', view: 'admin-finance' as ViewId, icon: <WalletCards size={20} /> },
      data.permissions.renewals && { id: 'renewals', label: 'Tái ký', view: 'admin-renewals' as ViewId, icon: <ClipboardCheck size={20} /> },
      payrollEnabled && { id: 'payroll', label: 'Lương', view: 'admin-payroll' as ViewId, icon: <CircleDollarSign size={20} /> },
      data.permissions.nutritionReviews && { id: 'reviews', label: 'Duyệt món', view: 'admin-nutrition-reviews' as ViewId, icon: <Salad size={20} /> },
      data.permissions.operations && canManageCoaching && { id: 'history', label: 'Lịch sử tập', view: 'admin-training-history' as ViewId, icon: <BookOpen size={20} /> },
    ].filter(Boolean) as Array<{ id: string; label: string; view: ViewId; icon: ReactNode }>
  }, [canManageCoaching, data, payrollEnabled])

  return <div className={`page admin-dashboard admin-dashboard--v2${dashboardV4 ? ' aura-ui-v4-surface aura-ui-v4-operations admin-dashboard--v4' : ''}`}>
    <section className="admin-dashboard__syncbar" aria-label="Trạng thái tổng quan">
      <div><small>AURA · TỔNG QUAN</small><strong>Chào {adminName}</strong><span className={`admin-dashboard__data-state ${error ? 'is-error' : loading || refreshing ? 'is-loading' : 'is-synced'}`}><i />{data?.generatedAt ? `Đồng bộ ${new Date(data.generatedAt).toLocaleString('vi-VN')}${data.cache.hit ? ' · dữ liệu đệm' : ''}` : error ? 'Chưa đồng bộ dữ liệu' : 'Đang kết nối dữ liệu vận hành'}</span></div>
      <div className="admin-dashboard__sync-actions">
        {response && response.value.filters.branches.length > 1 && <label className="admin-dashboard__branch-filter" aria-label="Lọc theo chi nhánh"><Building2 size={15} /><select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="all">Tất cả cơ sở</option>{response.value.filters.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
        <DateRangeFilter compact excludeFuture allowAll={false} initialRange="Tháng này" onFilter={updateRange} />
        <details className="admin-dashboard__help"><summary aria-label="Giải thích số liệu"><CircleHelp size={18} /></summary><div><b>Nguồn số liệu</b><span>Tiền thu lấy từ ledger canonical; doanh thu thực hiện lấy từ các buổi đã ghi nhận; hiện diện lấy từ sessions và attendanceEvents.</span>{data?.quality.truncated && <span><b>Cảnh báo:</b> kỳ đang chọn vượt giới hạn quét. Hãy thu hẹp bộ lọc để xem đủ dữ liệu.</span>}</div></details>
        <button type="button" onClick={() => void load(true)} disabled={loading || refreshing} aria-label="Làm mới tổng quan"><RefreshCw className={refreshing ? 'spin' : ''} size={18} /><span>{refreshing ? 'Đang tải' : 'Làm mới'}</span></button>
      </div>
    </section>

    {error && <div className="admin-data-warning"><AlertCircle size={18} /><span>{error}</span><button type="button" onClick={() => void load(true)}>Thử lại</button></div>}
    {data?.permissions.quality && (data.quality.cancelledSettlementReviewRequired > 0 || data.quality.cancelledSalesBaselineUnverified > 0) && <div className="admin-data-warning" role="note" aria-label="Đối soát hợp đồng đã hủy"><AlertCircle size={18} /><span>Hợp đồng đã hủy: {data.quality.cancelledSettlementReviewRequired} cần rà soát quyết toán; {data.quality.cancelledSalesBaselineUnverified} chưa xác minh doanh số ký gốc. Mở hồ sơ học viên để đối soát.</span>{data.permissions.clients && <button type="button" onClick={() => goTo('admin-pt-students')}>Mở Học viên</button>}</div>}

    <div className="admin-dashboard__main-grid">
      <section className="admin-dashboard__tasks" aria-labelledby="dashboard-tasks-title">
        <header><div><small>ƯU TIÊN THEO SLA</small><h2 id="dashboard-tasks-title">Hôm nay cần làm</h2></div><span>{taskItems.length}</span></header>
        {loading && !data
          ? <div className="admin-dashboard__task-skeleton" aria-label="Đang tải công việc"><i /><i /><i /></div>
          : !data
            ? <div className="admin-dashboard__unavailable"><AlertCircle size={22} /><div><strong>Chưa thể xác định công việc hôm nay</strong><span>Tổng quan không hiển thị trạng thái “ổn định” khi dữ liệu chưa tải thành công.</span></div></div>
          : taskItems.length
            ? <div className="admin-dashboard__task-list">{taskItems.map((item) => <button key={item.id} type="button" className={`is-${item.severity}`} onClick={() => goTo(item.view, item.focus)}><span className="admin-dashboard__task-icon">{item.icon}</span><span><strong>{item.label}</strong><small>{item.taskDetail}</small></span><ArrowRight size={17} /></button>)}</div>
            : <div className="admin-dashboard__healthy"><CheckCircle2 size={24} /><div><strong>Không có việc quá hạn</strong><span>Các hàng đợi trong phạm vi của bạn đang được xử lý đúng SLA.</span></div></div>}
      </section>

      <section className="admin-dashboard__attendance" aria-labelledby="dashboard-attendance-title">
        <header>
          <div><small>HIỆN DIỆN HÔM NAY</small><h2 id="dashboard-attendance-title">Ca tập trong ngày</h2></div>
          <button type="button" onClick={() => goTo('admin-today-sessions')}>Xem thêm<ArrowRight size={15} /></button>
        </header>
        {loading && !data ? <div className="admin-dashboard__metric-skeleton"><i /><i /><i /><i /><i /></div>
          : !data ? <div className="admin-dashboard__unavailable"><AlertCircle size={22} /><div><strong>Chưa tải được hiện diện hôm nay</strong><span>Không suy đoán trạng thái điểm danh từ dữ liệu cũ.</span></div></div>
            : <div className="admin-dashboard__attendance-metrics" aria-label="Số liệu ca tập hôm nay">
              <span className="is-total"><small>Tổng ca</small><b>{data.today.scheduledSessions}</b></span>
              <span className="is-present"><small>Có tập</small><b>{data.today.attendance.present}</b></span>
              <span className="is-late"><small>Đi trễ</small><b>{data.today.attendance.late}</b></span>
              <span className="is-no-show"><small>Vắng</small><b>{data.today.attendance.noShow}</b></span>
              <span className="is-pending"><small>Chờ PT</small><b>{data.today.attendance.pendingConfirmation}</b></span>
            </div>}
      </section>
    </div>

    {actionCenterEnabled && <Suspense fallback={null}><OperationalActionCenter
      isDemo={isDemo}
      onOpenStudent={(studentId) => {
        window.location.hash = `#/student-360?studentId=${encodeURIComponent(studentId)}&source=admin-pt-students`
      }}
    /></Suspense>}

    <AuraMetricCarousel slides={reportSlides} label="Báo cáo nhanh theo kỳ" loading={loading && !data} />

    {payrollEnabled && <AdminDashboardPayroll key={branchId} branchId={branchId} isDemo={isDemo} onOpenPayroll={() => goTo('admin-payroll')} />}

    {data?.permissions.finance && <section className="admin-dashboard__receivables" aria-labelledby="dashboard-receivables-title">
      <header><div><small>CÔNG NỢ KHÁCH HÀNG</small><h2 id="dashboard-receivables-title">Lịch cần thu</h2></div><button type="button" onClick={() => goTo('admin-finance', 'overdue')}>Xem thêm<ArrowRight size={15} /></button></header>
      <div className="admin-dashboard__debt-metrics" aria-label="Tổng hợp công nợ cần thu">
        <span className="is-overdue"><small>Quá hạn</small><b>{money(data.receivables.summary.overdue.amount)}</b><em>{data.receivables.summary.overdue.count} kỳ</em></span>
        <span><small>Tuần này</small><b>{money(data.receivables.summary.dueThisWeek.amount)}</b><em>{data.receivables.summary.dueThisWeek.count} kỳ</em></span>
        <span><small>Tháng này</small><b>{money(data.receivables.summary.dueThisMonth.amount)}</b><em>{data.receivables.summary.dueThisMonth.count} kỳ</em></span>
      </div>
    </section>}

    {data && (data.permissions.finance || data.permissions.clients || data.permissions.operations) && <section className="admin-dashboard__analytics" aria-labelledby="dashboard-analytics-title">
      <header><div><small>PHÂN TÍCH</small><h2 id="dashboard-analytics-title">Xu hướng & cơ cấu</h2><p>{rangeCaption(data.range.startAt, data.range.endAt)}</p></div></header>
      <div className="admin-dashboard__analytics-grid">
        {data.permissions.finance && <article className="admin-dashboard__chart-card admin-dashboard__chart-card--revenue">
          <header><div><small>DOANH THU & DÒNG TIỀN</small><strong>Biến động theo {data.analytics.revenue.granularity === 'day' ? 'ngày' : data.analytics.revenue.granularity === 'week' ? 'tuần' : 'tháng'}</strong></div><details><summary aria-label="Giải thích biểu đồ tài chính"><CircleHelp size={15} /></summary><p>Doanh số là giá trị hợp đồng ký trong kỳ. Doanh thu thực hiện là giá trị dịch vụ đã hoàn thành. Thực thu ròng chỉ phản ánh dòng tiền thực tế.</p></details></header>
          <div className="admin-dashboard__chart-totals"><span><small>Doanh số ký</small><b>{compactMoney(data.finance.contractSales)}</b></span><span><small>Doanh thu TH</small><b>{compactMoney(data.finance.recognizedRevenue)}</b></span><span><small>Thực thu ròng</small><b>{compactMoney(data.finance.netCash)}</b></span></div>
          <RevenueComparisonChart points={data.analytics.revenue.points} />
        </article>}

        {data.permissions.clients && <article className="admin-dashboard__chart-card admin-dashboard__chart-card--ratio">
          <header><div><small>CƠ CẤU GÓI TẬP</small><strong>{data.analytics.packages.totalActive} hiệu lực · {data.analytics.packages.preservedContracts} bảo lưu</strong></div><details><summary aria-label="Giải thích hợp đồng hiệu lực"><CircleHelp size={15} /></summary><p>Hợp đồng hiệu lực phải đã bắt đầu, còn thời hạn, còn buổi và không ở trong thời gian bảo lưu. Hợp đồng bảo lưu được tách thành số liệu riêng.</p></details></header>
          <div className="admin-dashboard__ratio-body">
            <div className="admin-dashboard__donut" style={{ background: ratioGradient(data.analytics.packages.items) }}><span><b>{data.analytics.packages.totalActive}</b><small>hợp đồng</small></span></div>
            <div className="admin-dashboard__ratio-legend">{data.analytics.packages.items.length ? data.analytics.packages.items.map((item, index) => <span key={item.id}><i style={{ background: ratioPalette[index % ratioPalette.length] }} /><b>{item.name}</b><small>{item.count} · {item.percent}%</small></span>) : <p>Chưa có hợp đồng đủ điều kiện.</p>}</div>
          </div>
          <div className="admin-dashboard__package-bars" aria-label="Tỷ lệ từng gói tập">{data.analytics.packages.items.map((item, index) => <div key={item.id}><span><b>{item.name}</b><small>{item.count} HĐ · {item.percent}%</small></span><i><em style={{ width: `${item.percent}%`, background: ratioPalette[index % ratioPalette.length] }} /></i></div>)}</div>
        </article>}

        {data.permissions.operations && <article className="admin-dashboard__chart-card admin-dashboard__chart-card--ratio">
          <header><div><small>TỶ LỆ ĐI TẬP</small><strong>{data.analytics.attendance.attendanceRate}% có tập · {data.analytics.attendance.absenceRate}% vắng</strong></div><details><summary aria-label="Giải thích tỷ lệ đi tập"><CircleHelp size={15} /></summary><p>Tỷ lệ chỉ tính các buổi đã được PT hoặc hệ thống xác nhận trong khoảng ngày đang chọn. Đi trễ vẫn được tính là có tập.</p></details></header>
          <div className="admin-dashboard__ratio-body">
            <div className="admin-dashboard__donut" style={{ background: ratioGradient([{ percent: data.analytics.attendance.attendanceRate }, { percent: data.analytics.attendance.absenceRate }]) }}><span><b>{data.analytics.attendance.attendanceRate}%</b><small>đi tập</small></span></div>
            <div className="admin-dashboard__ratio-legend">
              <span><i style={{ background: ratioPalette[0] }} /><b>Có tập</b><small>{data.analytics.attendance.attendedSessions} buổi</small></span>
              <span><i style={{ background: ratioPalette[1] }} /><b>Vắng</b><small>{data.analytics.attendance.noShowSessions} buổi</small></span>
              <span><i style={{ background: '#eadde4' }} /><b>Đã xác nhận</b><small>{data.analytics.attendance.confirmedSessions} buổi</small></span>
            </div>
          </div>
        </article>}
      </div>
    </section>}

    {shortcuts.length > 0 && (dashboardV4 ? <details className="admin-dashboard__shortcuts admin-dashboard__shortcuts--collapsed"><summary><span><small>CÔNG CỤ KHÁC</small><strong>Mở nhanh công việc</strong></span><ArrowRight size={17} /></summary><div>{shortcuts.map((item) => <button key={item.id} type="button" onClick={() => onNavigate(item.view)}>{item.icon}<span>{item.label}</span></button>)}</div></details> : <section className="admin-dashboard__shortcuts" aria-label="Lối tắt công việc"><header><small>LỐI TẮT</small><strong>Mở nhanh công việc</strong></header><div>{shortcuts.map((item) => <button key={item.id} type="button" onClick={() => onNavigate(item.view)}>{item.icon}<span>{item.label}</span></button>)}</div></section>)}
  </div>
}

function AdminDashboardPayroll({ branchId, isDemo, onOpenPayroll }: { branchId: string; isDemo: boolean; onOpenPayroll: () => void }) {
  const currentPayrollPeriodId = useMemo(() => payrollPeriodId(), [])
  const [payrollRoster, setPayrollRoster] = useState<AdminPayrollStaffTab[]>([])
  const [selectedPayrollStaffId, setSelectedPayrollStaffId] = useState('')
  const [payrollStatement, setPayrollStatement] = useState<StaffDashboardPayrollSnapshot | null>(null)
  const [payrollRosterLoading, setPayrollRosterLoading] = useState(false)
  const [payrollStatementLoading, setPayrollStatementLoading] = useState(false)
  const [payrollRosterError, setPayrollRosterError] = useState('')
  const [payrollStatementError, setPayrollStatementError] = useState('')
  const payrollRosterGeneration = useRef(0)
  const payrollStatementGeneration = useRef(0)
  const [payrollVisible, setPayrollVisible] = useState(false)


  useEffect(() => () => {
    payrollRosterGeneration.current += 1
    payrollStatementGeneration.current += 1
  }, [])

  const loadPayrollRoster = useCallback(async () => {
    const generation = ++payrollRosterGeneration.current
    setPayrollRosterLoading(true)
    setPayrollRosterError('')
    try {
      const rows = isDemo
        ? demoPayrollRoster()
        : (await listStaffPayrollAttendance(currentPayrollPeriodId, branchId === 'all' ? '' : branchId, { forceRefresh: true })).rows
          .map((row) => ({
            staffId: row.staffId,
            name: row.name,
            employmentType: row.employmentType,
            teachingSlotCount: row.teachingSlotCount,
            baseSalaryEarned: row.baseSalaryEarned,
            teachingPayAmount: row.teachingPayAmount,
            finalAmount: row.finalAmount,
            reviewRequired: row.reviewRequired,
          }))
          .sort((left, right) => left.name.localeCompare(right.name, 'vi'))
      if (generation !== payrollRosterGeneration.current) return
      setPayrollRoster(rows)
      setSelectedPayrollStaffId((current) => rows.some((row) => row.staffId === current) ? current : '')
    } catch (payrollError) {
      if (generation !== payrollRosterGeneration.current) return
      setPayrollRoster([])
      setSelectedPayrollStaffId('')
      setPayrollRosterError(payrollErrorMessage(payrollError))
    } finally {
      if (generation === payrollRosterGeneration.current) setPayrollRosterLoading(false)
    }
  }, [branchId, currentPayrollPeriodId, isDemo])

  useEffect(() => {
    if (payrollVisible) void loadPayrollRoster()
  }, [loadPayrollRoster, payrollVisible])

  const loadPayrollStatement = useCallback(async (staffId: string) => {
    const generation = ++payrollStatementGeneration.current
    if (!staffId) {
      setPayrollStatement(null)
      setPayrollStatementLoading(false)
      setPayrollStatementError('')
      return
    }
    setPayrollStatement(null)
    setPayrollStatementLoading(true)
    setPayrollStatementError('')
    try {
      const result = isDemo
        ? demoPayrollStatement(currentPayrollPeriodId, staffId)
        : await getStaffPayrollStatement(currentPayrollPeriodId, staffId)
      if (generation !== payrollStatementGeneration.current) return
      setPayrollStatement(result)
      if (!result) setPayrollStatementError('Không tìm thấy sao kê của nhân sự đã chọn.')
    } catch (payrollError) {
      if (generation !== payrollStatementGeneration.current) return
      setPayrollStatement(null)
      setPayrollStatementError(payrollErrorMessage(payrollError))
    } finally {
      if (generation === payrollStatementGeneration.current) setPayrollStatementLoading(false)
    }
  }, [currentPayrollPeriodId, isDemo])

  useEffect(() => {
    if (payrollVisible) void loadPayrollStatement(selectedPayrollStaffId)
  }, [loadPayrollStatement, payrollVisible, selectedPayrollStaffId])

  const selectedPayrollStaff = useMemo(
    () => payrollRoster.find((staff) => staff.staffId === selectedPayrollStaffId) || null,
    [payrollRoster, selectedPayrollStaffId],
  )
  const payrollChart = useMemo(
    () => payrollStatement ? buildStaffDashboardPayrollChart(payrollStatement) : null,
    [payrollStatement],
  )
  const payrollTeachingSlotCount = payrollChart?.buckets.reduce((sum, bucket) => sum + bucket.teachingSlotCount, 0) || 0

  return <section className="admin-dashboard__payroll" aria-labelledby="dashboard-payroll-title" aria-busy={payrollRosterLoading || payrollStatementLoading}>
      <header>
        <div><small>QUỸ LƯƠNG · {periodLabel(currentPayrollPeriodId).toUpperCase()}</small><h2 id="dashboard-payroll-title">Lương & tiền ca dạy</h2><p>Chọn từng nhân sự để xem thu nhập đã ghi nhận theo tuần.</p></div>
        <button type="button" onClick={onOpenPayroll}>Xem bảng lương<ArrowRight size={15} /></button>
      </header>
      {!payrollVisible ? <div className="admin-dashboard__payroll-state"><BarChart3 size={27} /><strong>Thu nhập theo từng nhân sự</strong><p>Mở danh sách và chọn nhân sự cần xem trong tháng.</p><button type="button" onClick={() => setPayrollVisible(true)}>Xem thu nhập nhân sự</button></div>
        : payrollRosterLoading
        ? <div className="admin-dashboard__payroll-loading" aria-label="Đang tải bảng lương nhân sự"><div className="admin-dashboard__payroll-tab-skeleton"><i /><i /><i /></div><div className="admin-dashboard__payroll-chart-skeleton"><span /><span /><span /><span /><span /></div></div>
        : payrollRosterError
          ? <div className="admin-dashboard__payroll-state"><BarChart3 size={27} /><strong>Chưa tải được danh sách nhân sự</strong><p>{payrollRosterError}</p><button type="button" onClick={() => void loadPayrollRoster()}>Thử lại</button></div>
          : !payrollRoster.length
            ? <div className="admin-dashboard__payroll-state"><Users size={27} /><strong>Chưa có nhân sự trong kỳ</strong><p>Biểu đồ sẽ xuất hiện khi bảng lương tháng có ít nhất một nhân sự.</p></div>
            : <>
              <div className="admin-dashboard__payroll-tabs" role="tablist" aria-label="Chọn nhân sự xem biểu đồ lương">
                {payrollRoster.map((staff) => <button
                  id={`dashboard-payroll-tab-${staff.staffId}`}
                  key={staff.staffId}
                  type="button"
                  role="tab"
                  aria-selected={staff.staffId === selectedPayrollStaffId}
                  aria-controls="dashboard-payroll-panel"
                  tabIndex={0}
                  className={staff.staffId === selectedPayrollStaffId ? 'is-active' : ''}
                  onClick={() => {
                    if (staff.staffId === selectedPayrollStaffId) return
                    payrollStatementGeneration.current += 1
                    setPayrollStatement(null)
                    setPayrollStatementError('')
                    setPayrollStatementLoading(true)
                    setSelectedPayrollStaffId(staff.staffId)
                  }}
                >
                  <span className="admin-dashboard__payroll-avatar" aria-hidden="true">{initials(staff.name)}</span>
                  <span><strong>{staff.name}</strong><small>{staff.teachingSlotCount} ca · {compactMoney(staff.finalAmount)}</small></span>
                  {staff.reviewRequired && <i aria-label="Cần đối soát" />}
                </button>)}
              </div>
              <div id="dashboard-payroll-panel" className="admin-dashboard__payroll-panel" role="tabpanel" aria-labelledby={selectedPayrollStaffId ? `dashboard-payroll-tab-${selectedPayrollStaffId}` : undefined}>
                {!selectedPayrollStaffId ? <div className="admin-dashboard__payroll-state"><Users size={27} /><strong>Chọn nhân sự để xem thu nhập</strong><p>Biểu đồ chi tiết được tải sau khi bạn chọn.</p></div>
                  : payrollStatementLoading
                  ? <div className="admin-dashboard__payroll-chart-skeleton" aria-label="Đang tải biểu đồ thu nhập"><span /><span /><span /><span /><span /></div>
                  : payrollStatementError
                    ? <div className="admin-dashboard__payroll-state"><BarChart3 size={27} /><strong>Chưa tải được sao kê của {selectedPayrollStaff?.name || 'nhân sự'}</strong><p>{payrollStatementError}</p><button type="button" onClick={() => void loadPayrollStatement(selectedPayrollStaffId)}>Thử lại</button></div>
                    : payrollChart && selectedPayrollStaff ? <>
                      <div className="admin-dashboard__payroll-person">
                        <span><strong>{selectedPayrollStaff.name}</strong><small>{selectedPayrollStaff.employmentType === 'full_time' ? 'Toàn thời gian' : selectedPayrollStaff.employmentType === 'part_time' ? 'Bán thời gian' : 'Cộng tác viên'} · {payrollTeachingSlotCount} ca đã ghi nhận</small></span>
                        <em className={selectedPayrollStaff.reviewRequired ? 'is-review' : payrollChart.official ? 'is-official' : ''}>{selectedPayrollStaff.reviewRequired ? 'Cần đối soát' : payrollChart.official ? 'Đã khóa' : 'Tạm tính'}</em>
                      </div>
                      <div className="admin-dashboard__payroll-summary">
                        <article><span><WalletCards size={17} />Lương theo công</span><strong>{money(payrollChart.baseSalaryAmount)}</strong><small>{payrollChart.official ? 'Đã khóa số liệu' : 'Tạm tính trong kỳ'}</small></article>
                        <article><span><CircleDollarSign size={17} />Tiền ca dạy</span><strong>{money(payrollChart.teachingPayAmount)}</strong><small>{payrollTeachingSlotCount} ca đủ điều kiện</small></article>
                      </div>
                      <div className="admin-dashboard__payroll-chart" role="img" aria-label={`Biểu đồ thu nhập ${selectedPayrollStaff.name} trong ${periodLabel(currentPayrollPeriodId)}: lương ${money(payrollChart.baseSalaryAmount)}, tiền ca dạy ${money(payrollChart.teachingPayAmount)}`}>
                        {payrollChart.buckets.map((bucket) => <article key={bucket.id}>
                          <div className="admin-dashboard__payroll-bars">
                            <span className="is-salary" style={{ height: chartHeight(bucket.baseSalaryAmount, payrollChart.maxBucketAmount) }} title={`Lương ${bucket.label}: ${money(bucket.baseSalaryAmount)}`} />
                            <span className="is-teaching" style={{ height: chartHeight(bucket.teachingPayAmount, payrollChart.maxBucketAmount) }} title={`Tiền ca dạy ${bucket.label}: ${money(bucket.teachingPayAmount)}`} />
                          </div>
                          <strong>{bucket.label}</strong><small>{bucket.teachingSlotCount} ca</small>
                        </article>)}
                      </div>
                      <footer><span><i className="is-salary" />Lương theo công</span><span><i className="is-teaching" />Tiền ca dạy</span><small>Tiền ca chỉ ghi nhận sau điểm danh hợp lệ.</small></footer>
                    </> : <div className="admin-dashboard__payroll-state"><BarChart3 size={27} /><strong>Chưa có dữ liệu thu nhập</strong><p>Nhân sự này chưa có sao kê trong tháng đang xem.</p></div>}
              </div>
            </>}
    </section>
}
