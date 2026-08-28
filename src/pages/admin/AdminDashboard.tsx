import '../../styles-admin.css'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  CircleHelp,
  Clock3,
  ClipboardCheck,
  GraduationCap,
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
  return 'Dịch vụ Tổng quan chưa phản hồi. Các số liệu cũ không được giả định là dữ liệu mới.'
}

function compactMoney(value: number) {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0
  return new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 }).format(amount)
}

function rangeCaption(startAt: string, endAt: string) {
  const start = new Date(startAt)
  const end = new Date(endAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Kỳ đang chọn'
  const format = (value: Date) => value.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: start.getFullYear() === end.getFullYear() ? undefined : 'numeric' })
  return `${format(start)} – ${format(end)}`
}

type RevenuePoint = OperationsDashboardData['analytics']['revenue']['points'][number]

function RevenueTrend({ points }: { points: RevenuePoint[] }) {
  if (!points.length) return <div className="admin-dashboard__chart-empty">Chưa có dòng tiền hoặc doanh số trong kỳ này.</div>
  const width = 660
  const height = 190
  const top = 14
  const bottom = 30
  const chartLeft = 62
  const chartRight = 14
  const values = points.flatMap((item) => [item.contractSales, item.recognizedRevenue, item.grossCash, item.netCash])
  const maximum = Math.max(1, ...values)
  const minimum = Math.min(0, ...values)
  const span = Math.max(1, maximum - minimum)
  const x = (index: number) => points.length === 1 ? (chartLeft + width - chartRight) / 2 : chartLeft + index / (points.length - 1) * (width - chartLeft - chartRight)
  const y = (value: number) => top + (maximum - value) / span * (height - top - bottom)
  const path = (pick: (item: RevenuePoint) => number) => points.map((item, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(pick(item)).toFixed(1)}`).join(' ')
  const areaPath = (pick: (item: RevenuePoint) => number) => `${path(pick)} L${x(points.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`
  const barWidth = Math.max(3, Math.min(13, (width - chartLeft - chartRight) / Math.max(1, points.length) * .46))
  const labelStep = Math.max(1, Math.ceil(points.length / 6))
  return <div className="admin-dashboard__revenue-chart">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Biểu đồ doanh số hợp đồng, doanh thu thực hiện và thực thu ròng">
      <defs>
        <linearGradient id="dashboardRevenueArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff8751" stopOpacity=".24" /><stop offset="100%" stopColor="#ff8751" stopOpacity=".02" /></linearGradient>
      </defs>
      {[0, .5, 1].map((ratio) => <g key={ratio}><line x1={chartLeft} x2={width - chartRight} y1={top + ratio * (height - top - bottom)} y2={top + ratio * (height - top - bottom)} /><text className="is-axis" x="2" y={top + ratio * (height - top - bottom) + 3}>{compactMoney(maximum - ratio * span)}</text></g>)}
      <line className="is-zero" x1={chartLeft} x2={width - chartRight} y1={y(0)} y2={y(0)} />
      {points.map((item, index) => <rect key={`cash-${item.key}`} className="is-cash-bar" x={x(index) - barWidth / 2} y={Math.min(y(item.grossCash), y(0))} width={barWidth} height={Math.max(1, Math.abs(y(item.grossCash) - y(0)))} rx="2"><title>{`${item.label}: thực thu gộp ${money(item.grossCash)}`}</title></rect>)}
      <path className="is-revenue-area" d={areaPath((item) => item.recognizedRevenue)} />
      <path className="is-sales" d={path((item) => item.contractSales)} />
      <path className="is-revenue" d={path((item) => item.recognizedRevenue)} />
      <path className="is-net" d={path((item) => item.netCash)} />
      {points.map((item, index) => <g key={item.key}>
        <circle className="is-sales" cx={x(index)} cy={y(item.contractSales)} r="3"><title>{`${item.label}: doanh số ${money(item.contractSales)}`}</title></circle>
        <circle className="is-revenue" cx={x(index)} cy={y(item.recognizedRevenue)} r="3"><title>{`${item.label}: doanh thu thực hiện ${money(item.recognizedRevenue)}`}</title></circle>
        <circle className="is-net" cx={x(index)} cy={y(item.netCash)} r="3"><title>{`${item.label}: thu ròng ${money(item.netCash)}`}</title></circle>
        {(index % labelStep === 0 || index === points.length - 1) && <text x={x(index)} y={height - 8} textAnchor="middle">{item.label}</text>}
      </g>)}
    </svg>
  </div>
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
  canCreate?: boolean
  canManageAcademy?: boolean
  canManageCoaching?: boolean
  canManageEnrollments?: boolean
}

export default function AdminDashboard({
  onNavigate,
  adminName = 'Admin Aura',
  canCreate = false,
  canManageAcademy = false,
  canManageCoaching = false,
  canManageEnrollments = false,
}: Props) {
  const [data, setData] = useState<OperationsDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [range, setRange] = useState(() => ({ startAt: startOfMonth(), endAt: currentMinute() }))
  const [branchId, setBranchId] = useState('all')
  const loadGeneration = useRef(0)

  const load = useCallback(async (forceRefresh = false) => {
    const generation = ++loadGeneration.current
    forceRefresh ? setRefreshing(true) : setLoading(true)
    setError('')
    try {
      const result = await getOperationsDashboard({
        startAt: range.startAt,
        endAt: range.endAt,
        branchId,
        forceRefresh,
      })
      if (generation === loadGeneration.current) setData(result)
    } catch (loadError) {
      if (generation === loadGeneration.current) setError(dashboardErrorMessage(loadError))
    } finally {
      if (generation === loadGeneration.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [branchId, range.endAt, range.startAt])

  useEffect(() => { void load() }, [load])

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
        view: 'admin-pt-schedule', focus: 'requests',
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
      data.permissions.payroll && { id: 'payroll', label: 'Lương', view: 'admin-payroll' as ViewId, icon: <CircleDollarSign size={20} /> },
      data.permissions.nutritionReviews && { id: 'reviews', label: 'Duyệt món', view: 'admin-nutrition-reviews' as ViewId, icon: <Salad size={20} /> },
      data.permissions.academy && canManageAcademy && { id: 'academy', label: 'Khóa học', view: 'admin-courses' as ViewId, icon: <GraduationCap size={20} /> },
      data.permissions.operations && canManageCoaching && { id: 'history', label: 'Lịch sử tập', view: 'admin-training-history' as ViewId, icon: <BookOpen size={20} /> },
      data.permissions.academy && canManageEnrollments && { id: 'academy-students', label: 'Học viên Academy', view: 'admin-academy-students' as ViewId, icon: <Users size={20} /> },
      data.permissions.academy && canCreate && { id: 'create-course', label: 'Tạo khóa học', view: 'admin-course-editor' as ViewId, icon: <GraduationCap size={20} /> },
    ].filter(Boolean) as Array<{ id: string; label: string; view: ViewId; icon: ReactNode }>
  }, [canCreate, canManageAcademy, canManageCoaching, canManageEnrollments, data])

  return <div className="page admin-dashboard admin-dashboard--v2">
    <AuraMetricCarousel slides={reportSlides} label="Báo cáo nhanh theo kỳ" loading={loading && !data} />

    <section className="admin-dashboard__syncbar" aria-label="Trạng thái tổng quan">
      <div><small>AURA · TỔNG QUAN</small><strong>Chào {adminName}</strong><span className={`admin-dashboard__data-state ${error ? 'is-error' : loading || refreshing ? 'is-loading' : 'is-synced'}`}><i />{data?.generatedAt ? `Đồng bộ ${new Date(data.generatedAt).toLocaleString('vi-VN')}${data.cache.hit ? ' · dữ liệu đệm' : ''}` : error ? 'Chưa đồng bộ dữ liệu' : 'Đang kết nối dữ liệu vận hành'}</span></div>
      <div className="admin-dashboard__sync-actions">
        {data && data.filters.branches.length > 1 && <label className="admin-dashboard__branch-filter" aria-label="Lọc theo chi nhánh"><Building2 size={15} /><select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="all">Tất cả cơ sở</option>{data.filters.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
        <DateRangeFilter compact excludeFuture allowAll={false} initialRange="Tháng này" onFilter={updateRange} />
        <details className="admin-dashboard__help"><summary aria-label="Giải thích số liệu"><CircleHelp size={18} /></summary><div><b>Nguồn số liệu</b><span>Tiền thu lấy từ ledger canonical; doanh thu thực hiện lấy từ các buổi đã ghi nhận; hiện diện lấy từ sessions và attendanceEvents.</span>{data?.quality.truncated && <span><b>Cảnh báo:</b> kỳ đang chọn vượt giới hạn quét. Hãy thu hẹp bộ lọc để xem đủ dữ liệu.</span>}</div></details>
        <button type="button" onClick={() => void load(true)} disabled={refreshing} aria-label="Làm mới tổng quan"><RefreshCw className={refreshing ? 'spin' : ''} size={18} /><span>{refreshing ? 'Đang tải' : 'Làm mới'}</span></button>
      </div>
    </section>

    {error && <div className="admin-data-warning"><AlertCircle size={18} /><span>{error}</span><button type="button" onClick={() => void load(true)}>Thử lại</button></div>}

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
          <div className="admin-dashboard__chart-legend"><span className="is-cash">Thực thu gộp</span><span className="is-sales">Doanh số HĐ</span><span className="is-revenue">Doanh thu thực hiện</span><span className="is-net">Thực thu ròng</span></div>
          <RevenueTrend points={data.analytics.revenue.points} />
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

    {shortcuts.length > 0 && <section className="admin-dashboard__shortcuts" aria-label="Lối tắt công việc"><header><small>LỐI TẮT</small><strong>Mở nhanh công việc</strong></header><div>{shortcuts.map((item) => <button key={item.id} type="button" onClick={() => onNavigate(item.view)}>{item.icon}<span>{item.label}</span></button>)}</div></section>}
  </div>
}
