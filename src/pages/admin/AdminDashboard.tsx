import '../../styles-admin.css'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  CircleHelp,
  ClipboardCheck,
  Dumbbell,
  GraduationCap,
  RefreshCw,
  Salad,
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

function money(value: number) {
  const amount = Number(value)
  return `${Math.round(Number.isFinite(amount) ? amount : 0).toLocaleString('vi-VN')}đ`
}

function startOfMonth() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
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

  const load = useCallback(async (forceRefresh = false) => {
    forceRefresh ? setRefreshing(true) : setLoading(true)
    setError('')
    try {
      const result = await getOperationsDashboard({
        startAt: startOfMonth(),
        endAt: new Date().toISOString(),
        branchId: 'all',
        forceRefresh,
      })
      setData(result)
    } catch {
      setError('Chưa thể tải dữ liệu điều hành. Aura vẫn giữ số liệu đồng bộ gần nhất nếu có.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

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
    return values
      .filter((item) => item.metric.available)
      .sort((left, right) => {
        const severity = { critical: 0, warning: 1, normal: 2 }
        return severity[left.severity] - severity[right.severity]
          || right.metric.overdueCount - left.metric.overdueCount
          || right.metric.actionCount - left.metric.actionCount
      })
  }, [data])

  const metricSlides = useMemo<AuraMetricSlide[]>(() => {
    if (!data) {
      return [
        { id: 'loading-1', eyebrow: 'CÔNG NỢ ĐẾN HẠN', value: '—', detail: 'Đang đối chiếu ledger canonical', icon: <CircleDollarSign size={20} />, tone: 'ink' },
        { id: 'loading-2', eyebrow: 'TÁI KÝ ĐẾN HẠN', value: '—', detail: 'Đang tải hàng đợi chăm sóc', icon: <Users size={20} />, tone: 'pink' },
        { id: 'loading-3', eyebrow: 'LỊCH CẦN XỬ LÝ', value: '—', detail: 'Đang kiểm tra lịch và yêu cầu', icon: <CalendarClock size={20} />, tone: 'sunset' },
        { id: 'loading-4', eyebrow: 'DUYỆT BỮA ĂN', value: '—', detail: 'Đang đối chiếu SLA dinh dưỡng', icon: <Salad size={20} />, tone: 'orange' },
      ]
    }
    const actionable = actions.filter((item) => item.metric.actionCount > 0)
    if (!actionable.length) {
      return [{
        id: 'healthy', eyebrow: 'AURA · VẬN HÀNH HÔM NAY', value: 'Đang ổn định',
        detail: 'Không có hồ sơ quá hạn hoặc công việc đến hạn trong phạm vi của bạn.',
        icon: <CheckCircle2 size={20} />, tone: 'pink',
      }]
    }
    return actionable.slice(0, 4).map((item) => ({
      id: item.id, eyebrow: item.label, value: item.value, detail: item.detail,
      icon: item.icon, tone: item.tone, actionLabel: 'Xử lý ngay',
      onSelect: () => goTo(item.view, item.focus),
    }))
  }, [actions, data, goTo])

  const taskItems = useMemo(() => {
    const items = [...actions.filter((item) => item.metric.actionCount > 0)]
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
  }, [actions, data])

  const quickMetrics = useMemo(() => {
    if (!data) return []
    return [
      data.permissions.finance && { id: 'cash', label: 'Thực thu tháng', value: money(data.finance.cashCollected), detail: 'Ledger đã ghi nhận', icon: <WalletCards size={19} /> },
      data.permissions.finance && { id: 'debt', label: 'Tổng công nợ', value: money(data.finance.receivables), detail: `${data.actionSummary.overdueReceivables.totalCount} hợp đồng còn nợ`, icon: <CircleDollarSign size={19} /> },
      data.permissions.clients && { id: 'clients', label: 'Học viên hoạt động', value: data.clients.active.toLocaleString('vi-VN'), detail: `${data.clients.newInRange} học viên mới tháng này`, icon: <Users size={19} /> },
      data.permissions.operations && { id: 'today', label: 'Buổi tập hôm nay', value: `${data.today.completedSessions}/${data.today.scheduledSessions}`, detail: `Hoàn thành kỳ này ${data.operations.completionRate}%`, icon: <Dumbbell size={19} /> },
    ].filter(Boolean) as Array<{ id: string; label: string; value: string; detail: string; icon: ReactNode }>
  }, [data])

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
    <AuraMetricCarousel slides={metricSlides} label="Các việc cần xử lý" loading={loading && !data} />

    <section className="admin-dashboard__syncbar" aria-label="Trạng thái tổng quan">
      <div><small>AURA · TỔNG QUAN</small><strong>Chào {adminName}</strong><span>{data?.generatedAt ? `Đồng bộ ${new Date(data.generatedAt).toLocaleString('vi-VN')}${data.cache.hit ? ' · dữ liệu đệm' : ''}` : 'Đang kết nối dữ liệu vận hành'}</span></div>
      <div className="admin-dashboard__sync-actions">
        <details className="admin-dashboard__help"><summary aria-label="Giải thích số liệu"><CircleHelp size={18} /></summary><div><b>Nguồn số liệu</b><span>Tiền thu lấy từ ledger canonical. Buổi tập lấy từ sessions và attendanceEvents. Dashboard không dùng payment legacy thay thế.</span></div></details>
        <button type="button" onClick={() => void load(true)} disabled={refreshing} aria-label="Làm mới tổng quan"><RefreshCw className={refreshing ? 'spin' : ''} size={18} /><span>{refreshing ? 'Đang tải' : 'Làm mới'}</span></button>
      </div>
    </section>

    {error && <div className="admin-data-warning"><AlertCircle size={18} /><span>{error}</span><button type="button" onClick={() => void load(true)}>Thử lại</button></div>}

    <div className="admin-dashboard__main-grid">
      <section className="admin-dashboard__tasks" aria-labelledby="dashboard-tasks-title">
        <header><div><small>ƯU TIÊN THEO SLA</small><h2 id="dashboard-tasks-title">Hôm nay cần làm</h2></div><span>{taskItems.length}</span></header>
        {loading && !data
          ? <div className="admin-dashboard__task-skeleton" aria-label="Đang tải công việc"><i /><i /><i /></div>
          : taskItems.length
            ? <div className="admin-dashboard__task-list">{taskItems.map((item) => <button key={item.id} type="button" className={`is-${item.severity}`} onClick={() => goTo(item.view, item.focus)}><span className="admin-dashboard__task-icon">{item.icon}</span><span><strong>{item.label}</strong><small>{item.taskDetail}</small></span><ArrowRight size={17} /></button>)}</div>
            : <div className="admin-dashboard__healthy"><CheckCircle2 size={24} /><div><strong>Không có việc quá hạn</strong><span>Các hàng đợi trong phạm vi của bạn đang được xử lý đúng SLA.</span></div></div>}
      </section>

      <section className="admin-dashboard__glance" aria-labelledby="dashboard-glance-title">
        <header><small>NHÌN NHANH</small><h2 id="dashboard-glance-title">Vận hành hiện tại</h2></header>
        <div>{quickMetrics.map((item) => <article key={item.id}><span>{item.icon}</span><small>{item.label}</small><strong>{item.value}</strong><p>{item.detail}</p></article>)}</div>
      </section>
    </div>

    {shortcuts.length > 0 && <section className="admin-dashboard__shortcuts" aria-label="Lối tắt công việc"><header><small>LỐI TẮT</small><strong>Mở nhanh công việc</strong></header><div>{shortcuts.map((item) => <button key={item.id} type="button" onClick={() => onNavigate(item.view)}>{item.icon}<span>{item.label}</span></button>)}</div></section>}
  </div>
}
