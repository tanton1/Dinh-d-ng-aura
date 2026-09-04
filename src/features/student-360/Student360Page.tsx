import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  Copy,
  Dumbbell,
  FileText,
  HeartPulse,
  History,
  Image as ImageIcon,
  Info,
  LayoutDashboard,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  Phone,
  RefreshCw,
  Ruler,
  Salad,
  Scale,
  ShieldCheck,
  Sparkles,
  Target,
  UserRound,
  WalletCards,
  X,
  Zap,
} from 'lucide-react'
import type { ViewId } from '../../types'
import {
  createStudentCareActivity,
  getStudent360Overview,
  getStudent360ProgressPhotos,
  listStudent360Timeline,
  refreshStudent360Projection,
} from './student360Service'
import type {
  Student360Action,
  Student360Overview,
  Student360Photo,
  Student360Tab,
  Student360TimelineEvent,
} from './types'
import './Student360Page.css'

const Student360ContractWorkspace = lazy(() => import('./Student360ContractWorkspace'))

interface Props {
  studentId: string
  source: string
  isDemo?: boolean
  onBack: () => void
  onNavigate: (view: ViewId, studentId?: string, studentName?: string) => void
}

const tabs: Array<{ id: Student360Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'activity', label: 'Hoạt động', icon: History },
  { id: 'coaching', label: 'Huấn luyện', icon: Dumbbell },
  { id: 'contract', label: 'Hợp đồng', icon: FileText },
  { id: 'more', label: 'Thêm', icon: MoreHorizontal },
]

const timelineFilters = [
  { id: 'all', label: 'Tất cả' },
  { id: 'training', label: 'Tập luyện' },
  { id: 'nutrition', label: 'Dinh dưỡng' },
  { id: 'progress', label: 'Tiến độ' },
  { id: 'care', label: 'Chăm sóc' },
  { id: 'contract', label: 'Hợp đồng' },
] as const

const timelineRanges = [
  { id: '30d', label: '30 ngày', days: 30 },
  { id: '90d', label: '90 ngày', days: 90 },
  { id: 'all', label: 'Toàn bộ', days: 0 },
] as const

const currency = new Intl.NumberFormat('vi-VN')
const dateFormatter = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
const dateTimeFormatter = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function safeDate(value?: string | null, withTime = false) {
  if (!value) return 'Chưa cập nhật'
  const date = new Date(value.length === 10 ? `${value}T12:00:00+07:00` : value)
  return Number.isNaN(date.getTime()) ? value : (withTime ? dateTimeFormatter : dateFormatter).format(date)
}

function statusCopy(status: Student360Overview['identity']['status']) {
  if (status === 'frozen') return 'Đang bảo lưu'
  if (status === 'expired') return 'Hết hạn'
  if (status === 'inactive') return 'Ngừng hoạt động'
  return 'Đang hoạt động'
}

function healthCopy(status: Student360Overview['health']['status']) {
  if (status === 'stable') return 'Ổn định'
  if (status === 'attention') return 'Cần chú ý'
  return 'Cần xử lý'
}

function confidenceCopy(value: Student360Overview['health']['confidence']) {
  return value === 'high' ? 'Cao' : value === 'medium' ? 'Trung bình' : 'Thấp'
}

function availabilityCopy(source: string) {
  if (source === 'weekly') return 'Lịch tuần đã gửi'
  if (source === 'inherited_weekly') return 'Kế thừa lịch gần nhất'
  if (source === 'legacy_default') return 'Lịch mặc định cũ'
  return 'Chưa có lịch rảnh'
}

function renewalStage(value?: string) {
  const labels: Record<string, string> = {
    uncontacted: 'Chưa liên hệ', contacted: 'Đã liên hệ', interested: 'Quan tâm',
    quote_sent: 'Đã gửi báo giá', follow_up: 'Đang theo dõi', won: 'Đã gia hạn', lost: 'Không gia hạn',
  }
  return labels[value || ''] || 'Chưa có hồ sơ renew'
}

function actionLabel(action: Student360Action['action'], canExecute: boolean) {
  if (!canExecute) return 'Báo quản lý'
  const labels: Record<Student360Action['action'], string> = {
    schedule: 'Mở lịch tập', finance: 'Báo quản lý', contact: 'Ghi nhận liên hệ',
    contract: 'Đối soát hợp đồng', training: 'Xem huấn luyện', progress: 'Xem tiến độ',
    nutrition: 'Xem dinh dưỡng', renewal: 'Mở chăm sóc renew',
  }
  return labels[action]
}

function demoOverview(studentId: string): Student360Overview {
  const today = new Date()
  const future = new Date(today.getTime() + 86_400_000)
  const toKey = (date: Date) => date.toISOString().slice(0, 10)
  return {
    schemaVersion: 1,
    formulaVersion: 'student-health-v1',
    studentId,
    accountUid: 'demo-account',
    generatedAt: new Date().toISOString(),
    generatedAtMillis: Date.now(),
    permissions: { scope: 'system', canViewOperations: true, canViewTraining: true, canViewNutrition: true, canViewProgress: true, canViewProgressPhotos: true, canViewFinancialStatus: true, canViewFinancialAmounts: true, canViewRenewal: true, canManageCare: true, canManageContract: true, canRefreshProjection: true },
    identity: { id: studentId, accountUid: 'demo-account', name: 'Nguyễn Minh Anh', phone: '0900 000 001', email: 'minhanh@aurafitness.vn', dob: '1995-06-18', avatarUrl: null, status: 'active', joinDate: '2026-02-10', goals: ['Giảm mỡ', 'Tăng sức mạnh thân dưới'], sessionsPerWeek: 3 },
    assignments: { branchId: 'branch-demo', branchName: 'Aura Hải Châu', trainerIds: ['trainer-1', 'trainer-2'], trainerNames: ['PT Hải Âu', 'PT Minh'], nutritionCoachIds: ['coach-1'], nutritionCoachNames: ['Coach Linh'], salesIds: ['sales-1'], salesNames: ['Sales Thu'] },
    contract: { id: 'contract-demo', packageName: 'PT 1:1 · 6 tháng', status: 'active', startDate: '2026-06-02', endDate: '2026-12-18', daysRemaining: 105, totalSessions: 72, storedUsedSessions: 34, chargedSessions: 34, exemptSessions: 1, pendingReconciliationSessions: 0, usedSessions: 34, remainingSessions: 38, legacyProjectionAdjustment: 0, projectionDelta: 0, reconciliationStatus: 'matched', payment: { status: 'due', total: 18_000_000, paid: 14_000_000, outstanding: 4_000_000, nextPaymentDate: '2026-09-12' }, pausePeriods: [{ requestId: 'off-1', type: 'off', startDate: '2026-07-12', endDate: '2026-07-20', durationDays: 9 }], extensions: [] },
    schedule: { weekId: toKey(today), weekEnd: toKey(new Date(today.getTime() + 6 * 86_400_000)), requiredSessions: 3, bookedSessions: 2, nextSession: { id: 'session-demo', date: toKey(future), hour: 17, trainerId: 'trainer-1', status: 'scheduled' }, sessions: [{ id: 'session-1', date: toKey(today), hour: 17, status: 'completed', attendanceStatus: 'present' }, { id: 'session-2', date: toKey(future), hour: 17, status: 'scheduled', attendanceStatus: 'scheduled' }], availability: { slots: ['T2-17', 'T4-17', 'T6-18', 'T7-08', 'CN-09'], confirmed: true, source: 'inherited_weekly', sourceWeekId: '2026-08-31', minimumSlots: 5 } },
    attendance: { rate28Days: 92, attended: 11, late: 1, noShow: 1, total: 12, weeklyTrend: [{ weekStart: '2026-08-10', rate: 100, total: 3 }, { weekStart: '2026-08-17', rate: 100, total: 3 }, { weekStart: '2026-08-24', rate: 67, total: 3 }, { weekStart: '2026-08-31', rate: 100, total: 3 }], lastAttendanceAt: new Date().toISOString() },
    training: { adherence28Days: 92, completed28Days: 11, target28Days: 12, workoutLogCount: 18, latestWorkoutAt: new Date().toISOString(), program: { id: 'program-1', title: 'Build Strength · Phase 2', goal: 'Glute strength · Core stability · Fat loss', status: 'active', revision: 3, trainingDays: [{ id: 'day-1', title: 'Lower Body', focusMuscles: ['Mông', 'Đùi'], exercises: [{ id: 'hip-thrust', nameVi: 'Hip Thrust', sets: 4, repMinimum: 10, repMaximum: 10, targetWeightKg: 70 }] }] }, recentLogs: [{ id: 'log-1', date: toKey(today), title: 'Lower Body', painNotes: null, completedSets: 16, totalVolumeKg: 4620, maximumWeightKg: 70 }] },
    nutrition: { loggedMeals: 16, loggedDays: 6, averageCalories: 1618, averageProtein: 102, targetCalories: 1650, targetProtein: 110, lastMealAt: new Date().toISOString() },
    progress: { latestDate: toKey(today), latestWeightKg: 59.9, latestWaistCm: 70, latestBodyFatPercent: 27, weightChangeKg: -4.9, waistChangeCm: -8, bodyFatChangePercent: -5, measurementCount: 8 },
    renewal: { caseId: 'renewal-demo', stage: 'uncontacted', probability: 76, riskCategory: 'early', lastContactAt: null, nextActionAt: null, assignedSalesId: 'sales-1' },
    health: { score: 82, status: 'stable', confidence: 'high', observedWeight: 100, components: [{ id: 'attendance', label: 'Tập đều', weight: 25, score: 92, reason: '92% buổi có mặt trong 28 ngày.', available: true }, { id: 'training', label: 'Hoàn thành lịch tập', weight: 20, score: 92, reason: '11/12 buổi mục tiêu.', available: true }, { id: 'nutrition', label: 'Dinh dưỡng', weight: 15, score: 83, reason: '6/7 ngày có nhật ký ăn.', available: true }, { id: 'progress', label: 'Tiến độ cơ thể', weight: 15, score: 85, reason: 'Đã cập nhật trong tuần.', available: true }, { id: 'engagement', label: 'Tương tác', weight: 10, score: 80, reason: 'Lịch rảnh và hoạt động đầy đủ.', available: true }, { id: 'payment', label: 'Thanh toán', weight: 5, score: 65, reason: 'Còn khoản cần thanh toán.', available: true }, { id: 'renewal', label: 'Sẵn sàng gia hạn', weight: 10, score: 76, reason: 'Còn 105 ngày và 38 buổi.', available: true }] },
    alerts: [{ id: 'weekly-schedule-short', severity: 'amber', title: 'Tuần này chưa đủ lịch', message: 'Đã xếp 2/3 buổi mục tiêu.', action: 'schedule', audience: 'operations' }],
    nextActions: [{ id: 'action-weekly', priority: 1, severity: 'amber', title: 'Bổ sung một buổi trong tuần', message: 'Đã xếp 2/3 buổi mục tiêu.', description: 'Thử thêm một khung trong lịch rảnh hiện có.', action: 'schedule', audience: 'operations' }],
    dataQuality: [],
    cache: { hit: true, stale: false, maxAgeSeconds: 300 },
  }
}

function demoTimeline(): Student360TimelineEvent[] {
  const now = Date.now()
  return [
    { id: 'timeline-1', type: 'training', occurredAt: new Date(now - 60 * 60_000).toISOString(), sortKey: now * 1000, title: 'PT xác nhận có mặt', description: 'Buổi Lower Body · 17:00', audience: 'operations', metadata: {} },
    { id: 'timeline-2', type: 'nutrition', occurredAt: new Date(now - 8 * 60 * 60_000).toISOString(), sortKey: (now - 8 * 60 * 60_000) * 1000, title: 'Đã ghi nhận bữa sáng', description: 'Bữa sáng giàu đạm · 420 kcal', audience: 'coaching', metadata: {} },
    { id: 'timeline-3', type: 'progress', occurredAt: new Date(now - 86_400_000).toISOString(), sortKey: (now - 86_400_000) * 1000, title: 'Cập nhật chỉ số cơ thể', description: '59,9kg · eo 70cm', audience: 'coaching', metadata: {} },
  ]
}

function Metric({ label, value, note, tone }: { label: string; value: string | number; note: string; tone?: string }) {
  return <article className={`student360-metric${tone ? ` is-${tone}` : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>
}

function Card({ title, icon: Icon, action, children, className = '' }: { title: string; icon: typeof Activity; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <article className={`student360-card ${className}`}><header><div><Icon size={18} /><h2>{title}</h2></div>{action}</header>{children}</article>
}

function State({ type, children }: { type?: 'error'; children: React.ReactNode }) {
  return <div className={`student360-state${type ? ` is-${type}` : ''}`}>{children}</div>
}

export default function Student360Page({ studentId, source, isDemo = false, onBack, onNavigate }: Props) {
  const [activeTab, setActiveTab] = useState<Student360Tab>('overview')
  const [overview, setOverview] = useState<Student360Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [timeline, setTimeline] = useState<Student360TimelineEvent[]>([])
  const [timelineFilter, setTimelineFilter] = useState<(typeof timelineFilters)[number]['id']>('all')
  const [timelineRange, setTimelineRange] = useState<(typeof timelineRanges)[number]['id']>('90d')
  const [timelineCursor, setTimelineCursor] = useState<number | null>(null)
  const [timelineHasMore, setTimelineHasMore] = useState(false)
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [photos, setPhotos] = useState<Student360Photo[]>([])
  const [photosLoading, setPhotosLoading] = useState(false)
  const [photosLoaded, setPhotosLoaded] = useState(false)
  const [photoCursor, setPhotoCursor] = useState<string | null>(null)
  const [photoHasMore, setPhotoHasMore] = useState(false)
  const activePhotoStudentRef = useRef(studentId)
  const [careType, setCareType] = useState<'call' | 'zalo' | 'note' | 'action_completed' | null>(null)
  const [careActionId, setCareActionId] = useState<string | undefined>()
  const [careNote, setCareNote] = useState('')
  const [careSaving, setCareSaving] = useState(false)

  const loadOverview = useCallback(async (force = false) => {
    force ? setRefreshing(true) : setLoading(true)
    setError('')
    try {
      const result = isDemo ? demoOverview(studentId) : force
        ? (await refreshStudent360Projection(studentId), await getStudent360Overview(studentId))
        : await getStudent360Overview(studentId)
      setOverview(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải Học viên 360.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [isDemo, studentId])

  useEffect(() => { void loadOverview(false) }, [loadOverview])

  const loadTimeline = useCallback(async (append = false) => {
    if (timelineLoading) return
    setTimelineLoading(true)
    try {
      if (isDemo) {
        setTimeline(demoTimeline())
        setTimelineHasMore(false)
        return
      }
      const types = timelineFilter === 'all'
        ? undefined
        : timelineFilter === 'contract'
          ? ['off', 'freeze', 'schedule_change', 'finance', 'renewal', 'contract']
          : timelineFilter === 'training'
            ? ['training', 'workout']
            : timelineFilter === 'care'
              ? ['care', 'checkin']
            : [timelineFilter]
      const rangeDays = timelineRanges.find((item) => item.id === timelineRange)?.days || 0
      const result = await listStudent360Timeline({ studentId, types, cursor: append ? timelineCursor : null, pageSize: 30, ...(rangeDays ? { fromMillis: Date.now() - rangeDays * 86_400_000 } : {}) })
      setTimeline((current) => append ? [...current, ...result.rows] : result.rows)
      setTimelineCursor(result.nextCursor)
      setTimelineHasMore(result.hasMore)
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Không thể tải dòng hoạt động.')
    } finally {
      setTimelineLoading(false)
    }
  }, [isDemo, studentId, timelineCursor, timelineFilter, timelineLoading, timelineRange])

  useEffect(() => {
    if (activeTab !== 'activity') return
    setTimelineCursor(null)
    void loadTimeline(false)
    // loadTimeline deliberately changes after a page response; pagination is
    // user-triggered and must not cause the first page to load again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, timelineFilter, timelineRange, studentId])

  useEffect(() => {
    activePhotoStudentRef.current = studentId
    setPhotos([])
    setPhotosLoaded(false)
    setPhotoCursor(null)
    setPhotoHasMore(false)
  }, [studentId])

  useEffect(() => {
    if (activeTab !== 'coaching' || photosLoaded || !overview?.permissions.canViewProgressPhotos) return
    let cancelled = false
    setPhotosLoading(true)
    if (isDemo) {
      setPhotos([])
      setPhotosLoaded(true)
      setPhotoCursor(null)
      setPhotoHasMore(false)
      setPhotosLoading(false)
      return
    }
    void getStudent360ProgressPhotos(studentId)
      .then((result) => {
        if (cancelled) return
        setPhotos(result.rows)
        setPhotoCursor(result.nextCursor)
        setPhotoHasMore(result.hasMore)
      })
      .catch((cause) => {
        if (!cancelled) setNotice(cause instanceof Error ? cause.message : 'Không thể tải ảnh tiến độ.')
      })
      .finally(() => {
        if (!cancelled) { setPhotosLoaded(true); setPhotosLoading(false) }
      })
    return () => { cancelled = true }
  }, [activeTab, isDemo, overview?.permissions.canViewProgressPhotos, photosLoaded, studentId])

  const loadMorePhotos = async () => {
    if (isDemo || photosLoading || !photoHasMore || !photoCursor) return
    setPhotosLoading(true)
    try {
      const result = await getStudent360ProgressPhotos(studentId, photoCursor)
      if (activePhotoStudentRef.current !== studentId) return
      setPhotos((current) => {
        const byId = new Map(current.map((record) => [record.id, record]))
        result.rows.forEach((record) => byId.set(record.id, record))
        return [...byId.values()]
      })
      setPhotoCursor(result.nextCursor)
      setPhotoHasMore(result.hasMore)
    } catch (cause) {
      if (activePhotoStudentRef.current === studentId) setNotice(cause instanceof Error ? cause.message : 'Không thể tải thêm ảnh tiến độ.')
    } finally {
      if (activePhotoStudentRef.current === studentId) setPhotosLoading(false)
    }
  }

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 3500)
    return () => window.clearTimeout(timer)
  }, [notice])

  const copyPhone = async () => {
    if (!overview?.identity.phone) return
    try {
      await navigator.clipboard.writeText(overview.identity.phone)
      setNotice('Đã sao chép số điện thoại.')
    } catch {
      setNotice('Không thể sao chép tự động. Số điện thoại: ' + overview.identity.phone)
    }
  }

  const openCare = (type: NonNullable<typeof careType>, actionId?: string, initialNote = '') => {
    setCareType(type)
    setCareActionId(actionId)
    setCareNote(initialNote)
  }

  const saveCare = async () => {
    if (!careType || !overview) return
    setCareSaving(true)
    try {
      if (!isDemo) await createStudentCareActivity({ studentId, type: careType, note: careNote, actionId: careActionId })
      setCareType(null)
      setNotice('Đã ghi nhận vào lịch sử chăm sóc.')
      if (activeTab === 'activity') await loadTimeline(false)
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Không thể lưu hoạt động chăm sóc.')
    } finally {
      setCareSaving(false)
    }
  }

  const canExecuteAction = (item: Student360Action) => {
    if (!overview) return false
    if (item.action === 'contact') return overview.permissions.canManageCare
    if (item.action === 'training') return overview.permissions.canViewTraining
    if (item.action === 'nutrition') return overview.permissions.canViewNutrition
    if (item.action === 'progress') return overview.permissions.canViewProgress
    if (item.action === 'renewal') return overview.permissions.canViewRenewal
    if (item.action === 'schedule') return overview.permissions.canManageContract
    if (item.action === 'contract') return overview.permissions.canManageContract
    if (item.action === 'finance') return source === 'admin-pt-students' && overview.permissions.canViewFinancialAmounts
    return false
  }

  const reportToManager = (item: Student360Action) => {
    openCare('note', item.id, `Báo quản lý: ${item.title}. ${item.description}`)
  }

  const performAction = (item: Student360Action) => {
    if (!overview) return
    if (!canExecuteAction(item)) return reportToManager(item)
    const staff = source.startsWith('staff')
    if (item.action === 'schedule') return onNavigate('admin-pt-schedule', studentId, overview.identity.name)
    if (item.action === 'training') { setActiveTab('coaching'); return }
    if (item.action === 'progress') { setActiveTab('coaching'); return }
    if (item.action === 'nutrition') { setActiveTab('coaching'); return }
    if (item.action === 'renewal') return onNavigate(staff ? 'staff-renewals' : 'admin-renewals', studentId, overview.identity.name)
    if (item.action === 'contract') { setActiveTab('contract'); return }
    if (item.action === 'finance') return onNavigate('admin-finance', studentId, overview.identity.name)
    openCare(item.action === 'contact' ? 'call' : 'action_completed', item.id)
  }

  const latestProgramDays = useMemo(() => overview?.training.program?.trainingDays || [], [overview])

  if (loading) return <main className="student360-page"><State><LoaderCircle className="is-spinning" /><h1>Đang dựng góc nhìn 360</h1><p>Aura đang đối chiếu hợp đồng, lịch tập và tiến độ.</p></State></main>
  if (error || !overview) return <main className="student360-page"><State type="error"><AlertTriangle /><h1>Chưa thể mở Học viên 360</h1><p>{error || 'Hồ sơ không có dữ liệu.'}</p><div><button type="button" onClick={onBack}>Quay lại</button><button type="button" onClick={() => void loadOverview(false)}>Thử lại</button></div></State></main>

  const { identity, assignments, contract, schedule, attendance, training, nutrition, progress, renewal, health, permissions } = overview
  const usedLabel = contract ? `${contract.usedSessions}/${contract.totalSessions}` : '—'
  const daysLabel = contract?.daysRemaining === null || contract?.daysRemaining === undefined ? '—' : Math.max(0, contract.daysRemaining)

  return <main className="student360-page" data-tab={activeTab}>
    <header className="student360-header">
      <div className="student360-header__bar">
        <button type="button" className="student360-icon-button" aria-label="Quay lại danh sách học viên" onClick={onBack}><ArrowLeft /></button>
        <div className="student360-identity">
          <span className="student360-avatar">{identity.avatarUrl ? <img src={identity.avatarUrl} alt="" /> : identity.name.charAt(0).toUpperCase()}</span>
          <div><small>HỌC VIÊN 360 · {identity.id}</small><h1>{identity.name}</h1><p>{assignments.branchName || 'Chưa xác định chi nhánh'} · {assignments.trainerNames[0] || assignments.nutritionCoachNames[0] || 'Chưa phân người phụ trách'}</p></div>
        </div>
        <div className="student360-header__actions">
          {identity.phone && <a className="student360-icon-button" href={`tel:${identity.phone.replace(/\s/g, '')}`} aria-label={`Gọi ${identity.name}`}><Phone /></a>}
          {identity.phone && <button type="button" className="student360-icon-button" onClick={() => void copyPhone()} aria-label="Sao chép số điện thoại"><Copy /></button>}
          {permissions.canManageCare && <button type="button" className="student360-icon-button" onClick={() => openCare('note')} aria-label="Thêm ghi chú chăm sóc"><MessageCircle /></button>}
          <details className="student360-business-menu">
            <summary className="student360-icon-button" aria-label="Mở menu nghiệp vụ"><MoreHorizontal /></summary>
            <div>
              {permissions.canManageContract && <button type="button" onClick={() => onNavigate('admin-pt-schedule', studentId, identity.name)}><CalendarPlus /> Tạo hoặc điều chỉnh lịch</button>}
              {permissions.canManageCare && <button type="button" onClick={() => openCare('note')}><MessageCircle /> Ghi chú chăm sóc</button>}
              {permissions.canViewRenewal && <button type="button" onClick={() => onNavigate(source.startsWith('staff') ? 'staff-renewals' : 'admin-renewals', studentId, identity.name)}><Sparkles /> Mở hồ sơ gia hạn</button>}
              {permissions.canManageContract && <button type="button" onClick={() => setActiveTab('contract')}><FileText /> Đổi PT · bảo lưu · sửa hợp đồng</button>}
              {permissions.canRefreshProjection && <button type="button" disabled={refreshing} onClick={() => void loadOverview(true)}><RefreshCw className={refreshing ? 'is-spinning' : ''} /> Đối soát dữ liệu</button>}
            </div>
          </details>
        </div>
      </div>
    </header>
      <div className="student360-status-row">
        <span className={`student360-status is-${identity.status}`}><i />{statusCopy(identity.status)}</span>
        {assignments.trainerNames[0] && <span>PT chính: {assignments.trainerNames[0]}</span>}
        {assignments.trainerNames.length > 1 && <span>PT phụ: {assignments.trainerNames.slice(1).join(' · ')}</span>}
        {assignments.nutritionCoachNames.length > 0 && <span>Dinh dưỡng: {assignments.nutritionCoachNames.join(' · ')}</span>}
      </div>
      <section className="student360-metrics" aria-label="Chỉ số nhanh">
        <Metric label="Health Score" value={health.score} note={`${healthCopy(health.status)} · Tin cậy ${confidenceCopy(health.confidence)}`} tone={health.status} />
        <Metric label="Số buổi" value={usedLabel} note={contract ? `Còn ${contract.remainingSessions} buổi` : 'Chưa có hợp đồng'} />
        {permissions.canViewOperations
          ? <Metric label="Attendance 28 ngày" value={attendance.rate28Days === null ? '—' : `${attendance.rate28Days}%`} note={`${attendance.attended} có mặt · ${attendance.noShow} vắng`} />
          : <Metric label="Phạm vi dữ liệu" value={permissions.scope === 'sales' ? 'CSKH' : 'Coach'} note="Đã che lịch vận hành theo quyền" />}
        <Metric label="Thời hạn" value={daysLabel} note={contract?.endDate ? `ngày · đến ${safeDate(contract.endDate)}` : 'Chưa có ngày hết hạn'} />
      </section>

    <nav className="student360-tabs student360-tabs--desktop" aria-label="Nội dung Học viên 360">{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={activeTab === id ? 'active' : ''} aria-current={activeTab === id ? 'page' : undefined} onClick={() => setActiveTab(id)}><Icon /><span>{label}</span></button>)}</nav>

    <div className="student360-content">
      {activeTab === 'overview' && <div className="student360-overview-grid">
        <section className="student360-main-column">
          {permissions.canViewOperations && <Card title="Buổi tiếp theo" icon={CalendarDays} action={<button type="button" className="student360-link" onClick={() => onNavigate(source.startsWith('staff') ? 'staff-schedule' : 'admin-pt-schedule', studentId, identity.name)}>Mở lịch</button>}>
            {schedule.nextSession ? <div className="student360-next-session"><time><strong>{safeDate(schedule.nextSession.date)}</strong><span>{schedule.nextSession.hour === null ? 'Chưa chốt giờ' : `${String(schedule.nextSession.hour).padStart(2, '0')}:00`}</span></time><div><b>{assignments.trainerNames[0] || 'PT Aura'}</b><span>{assignments.branchName || 'Chi nhánh Aura'}</span></div><span className="student360-pill">Đã xếp lịch</span></div> : <p className="student360-empty">Chưa có buổi tập sắp tới.</p>}
          </Card>}

          {permissions.canViewOperations && <Card title="Lịch tuần này" icon={ClipboardCheck} action={<span className="student360-card-count">{schedule.bookedSessions}/{schedule.requiredSessions} buổi</span>}>
            <div className="student360-week-progress"><i style={{ width: `${Math.min(100, schedule.requiredSessions ? schedule.bookedSessions / schedule.requiredSessions * 100 : 0)}%` }} /></div>
            <div className="student360-session-list">{schedule.sessions.map((session) => <div key={session.id}><time>{safeDate(session.date)} · {session.hour === null ? '--' : String(session.hour).padStart(2, '0')}:00</time><span className={`is-${session.attendanceStatus}`}>{session.attendanceStatus === 'present' ? 'Đã tập' : session.attendanceStatus === 'late' ? 'Đi trễ' : session.attendanceStatus === 'no_show' ? 'Không đến' : 'Đã xếp'}</span></div>)}{schedule.sessions.length === 0 && <p className="student360-empty">Tuần này chưa có lịch tập.</p>}</div>
          </Card>}

          <Card title="Hợp đồng & quyền lợi" icon={WalletCards} action={<button type="button" className="student360-link" onClick={() => setActiveTab('contract')}>Xem chi tiết</button>}>
            {contract ? <><div className="student360-contract-head"><div><strong>{contract.packageName}</strong><span>{safeDate(contract.startDate)} → {safeDate(contract.endDate)}</span></div><b>{contract.remainingSessions}<small>buổi còn lại</small></b></div><div className="student360-entitlement"><span><i style={{ width: `${Math.min(100, contract.totalSessions ? contract.usedSessions / contract.totalSessions * 100 : 0)}%` }} /></span><small>{contract.usedSessions} đã dùng · {contract.remainingSessions} còn lại</small></div>{contract.reconciliationStatus !== 'matched' && <div className="student360-inline-warning"><AlertTriangle /> Số buổi đang được đối soát theo lịch sử có tính buổi.</div>}</> : <p className="student360-empty">Học viên chưa có hợp đồng.</p>}
          </Card>

          {permissions.canViewProgress && <Card title="Tiến độ gần nhất" icon={Activity} action={<button type="button" className="student360-link" onClick={() => setActiveTab('coaching')}>Xem chi tiết</button>}>
            {progress ? <div className="student360-progress-summary"><div><Scale /><strong>{progress.latestWeightKg ?? '—'}<small>kg</small></strong><span>{progress.weightChangeKg === null ? 'Chưa có so sánh' : `${progress.weightChangeKg > 0 ? '+' : ''}${progress.weightChangeKg}kg`}</span></div><div><Ruler /><strong>{progress.latestWaistCm ?? '—'}<small>cm eo</small></strong><span>{progress.waistChangeCm === null ? 'Chưa có so sánh' : `${progress.waistChangeCm > 0 ? '+' : ''}${progress.waistChangeCm}cm`}</span></div><div><HeartPulse /><strong>{progress.latestBodyFatPercent ?? '—'}<small>% mỡ</small></strong><span>{progress.bodyFatChangePercent === null ? 'Chưa có so sánh' : `${progress.bodyFatChangePercent > 0 ? '+' : ''}${progress.bodyFatChangePercent}%`}</span></div></div> : <p className="student360-empty">Chưa có dữ liệu cân đo hoặc bạn không có quyền xem.</p>}
          </Card>}

          {permissions.canViewNutrition && <Card title="Dinh dưỡng 7 ngày" icon={Salad} action={<button type="button" className="student360-link" onClick={() => onNavigate(source.startsWith('staff') ? 'staff-nutrition-reviews' : 'admin-nutrition-reviews', studentId, identity.name)}>Mở duyệt món</button>}>
            {nutrition ? <div className="student360-nutrition"><div><strong>{nutrition.averageCalories}</strong><span>kcal trung bình</span><small>Mục tiêu {nutrition.targetCalories ?? '—'}</small></div><div><strong>{nutrition.averageProtein}g</strong><span>protein trung bình</span><small>Mục tiêu {nutrition.targetProtein ?? '—'}g</small></div><div><strong>{nutrition.loggedDays}/7</strong><span>ngày có nhật ký</span><small>{nutrition.loggedMeals} bữa đã ghi</small></div></div> : <p className="student360-empty">Chưa áp dụng hoặc chưa có dữ liệu dinh dưỡng.</p>}
          </Card>}
        </section>

        <aside className="student360-side-column">
          <Card title="Việc cần làm tiếp theo" icon={Zap} className="student360-action-card">
            <div className="student360-actions">{overview.nextActions.map((item) => <button type="button" key={item.id} className={`is-${item.severity}`} onClick={() => performAction(item)}><span>{item.priority}</span><div><strong>{item.title}</strong><small>{item.description}</small><b>{actionLabel(item.action, canExecuteAction(item))} →</b></div></button>)}{overview.nextActions.length === 0 && <div className="student360-all-good"><Check /><strong>Không có việc khẩn cấp</strong><span>Dữ liệu hiện tại đang ổn định.</span></div>}</div>
          </Card>

          <Card title="Health Score minh bạch" icon={HeartPulse}>
            <div className="student360-score-ring" style={{ '--score': `${health.score * 3.6}deg` } as React.CSSProperties}><div><strong>{health.score}</strong><span>/100</span></div></div>
            <div className="student360-score-components">{health.components.map((component) => <details key={component.id}><summary><span>{component.label}<small>{component.available ? `${component.weight}% trọng số` : 'Chưa đủ dữ liệu'}</small></span><b>{component.score ?? '—'}</b><ChevronDown /></summary><p>{component.reason}</p></details>)}</div>
          </Card>

          {permissions.canViewOperations && <Card title="Tỷ lệ đi tập" icon={Activity}>
            <div className="student360-attendance-chart">{attendance.weeklyTrend.map((week) => <div key={week.weekStart}><span><i style={{ height: `${Math.max(5, week.rate ?? 0)}%` }} /></span><small>{safeDate(week.weekStart).slice(0, 5)}</small><b>{week.rate === null ? '—' : `${week.rate}%`}</b></div>)}</div>
          </Card>}

          {permissions.canViewRenewal && <Card title="Gia hạn" icon={Sparkles}>
            {renewal ? <div className="student360-renewal"><div><strong>{renewal.probability}%</strong><span>Khả năng gia hạn theo hồ sơ hiện tại</span></div><dl><div><dt>Trạng thái</dt><dd>{renewalStage(renewal.stage)}</dd></div><div><dt>Lần liên hệ cuối</dt><dd>{safeDate(renewal.lastContactAt)}</dd></div></dl><button type="button" onClick={() => onNavigate(source.startsWith('staff') ? 'staff-renewals' : 'admin-renewals', studentId, identity.name)}>Mở hồ sơ renew</button></div> : <p className="student360-empty">Chưa tạo hồ sơ chăm sóc gia hạn.</p>}
          </Card>}
        </aside>
      </div>}

      {activeTab === 'activity' && <section className="student360-section">
        <div className="student360-section-heading"><div><small>CRM TIMELINE</small><h2>Toàn bộ hoạt động</h2><p>Dữ liệu được lọc theo quyền của tài khoản hiện tại.</p></div></div>
        <div className="student360-timeline-toolbar"><div className="student360-filter-chips">{timelineFilters.map((filter) => <button type="button" key={filter.id} className={timelineFilter === filter.id ? 'active' : ''} onClick={() => setTimelineFilter(filter.id)}>{filter.label}</button>)}</div><div className="student360-filter-chips is-range">{timelineRanges.map((range) => <button type="button" key={range.id} className={timelineRange === range.id ? 'active' : ''} onClick={() => setTimelineRange(range.id)}>{range.label}</button>)}</div></div>
        <div className="student360-timeline">{timeline.map((item) => <article key={item.id}><div className={`student360-timeline-icon is-${item.type}`}>{item.type === 'training' || item.type === 'workout' ? <Dumbbell /> : item.type === 'nutrition' ? <Salad /> : item.type === 'progress' || item.type === 'checkin' ? <Activity /> : item.type === 'finance' ? <CircleDollarSign /> : item.type === 'care' ? <MessageCircle /> : <FileText />}</div><div><time>{safeDate(item.occurredAt, true)}{typeof item.metadata.actorName === 'string' && item.metadata.actorName ? ` · ${item.metadata.actorName}` : ''}</time><strong>{item.title}</strong><p>{item.description}</p>{typeof item.metadata.amount === 'number' && <small>{currency.format(item.metadata.amount)}đ</small>}</div></article>)}{!timeline.length && !timelineLoading && <State><History /><h3>Chưa có hoạt động</h3><p>Không có sự kiện phù hợp bộ lọc hiện tại.</p></State>}{timelineLoading && <State><LoaderCircle className="is-spinning" /> Đang tải hoạt động…</State>}</div>
        {timelineHasMore && <button type="button" className="student360-load-more" disabled={timelineLoading} onClick={() => void loadTimeline(true)}>Tải thêm hoạt động</button>}
      </section>}

      {activeTab === 'coaching' && <section className="student360-section">
        <div className="student360-section-heading"><div><small>COACHING 360</small><h2>Huấn luyện & tiến độ</h2><p>Giáo án, dinh dưỡng, cân đo và lưu ý chuyên môn.</p></div></div>
        {!permissions.canViewTraining && !permissions.canViewNutrition && !permissions.canViewProgress ? <State type="error"><ShieldCheck /><h3>Dữ liệu chuyên môn được giới hạn</h3><p>Vai trò hiện tại chỉ được xem hợp đồng và chăm sóc.</p></State> : <div className="student360-coaching-grid">
          {permissions.canViewTraining && <Card title="Giáo án đang áp dụng" icon={Dumbbell} action={<button type="button" className="student360-link" onClick={() => onNavigate(source.startsWith('staff') ? 'staff-workouts' : 'admin-pt-workouts', studentId, identity.name)}>Mở giáo án</button>}>
            {training.program ? <><div className="student360-program"><span>ĐANG ÁP DỤNG</span><strong>{training.program.title}</strong><p>{training.program.goal || 'Chưa ghi mục tiêu giáo án.'}</p></div><div className="student360-program-days">{latestProgramDays.map((raw, index) => { const day = raw as { id?: string; title?: string; focusMuscles?: string[]; exercises?: Array<{ id?: string; nameVi?: string; name?: string; sets?: number; repMinimum?: number; repMaximum?: number; targetWeightKg?: number }> }; return <details key={day.id || index}><summary><span><strong>{day.title || `Buổi ${index + 1}`}</strong><small>{day.focusMuscles?.join(' · ') || 'Chưa phân nhóm cơ'}</small></span><b>{day.exercises?.length || 0} bài</b><ChevronDown /></summary><div>{day.exercises?.slice(0, 12).map((exercise, exerciseIndex) => <div key={exercise.id || exerciseIndex}><span>{exercise.nameVi || exercise.name || 'Bài tập'}</span><small>{exercise.sets || 0} hiệp · {exercise.repMinimum || 0}{exercise.repMaximum && exercise.repMaximum !== exercise.repMinimum ? `–${exercise.repMaximum}` : ''} lần{exercise.targetWeightKg ? ` · ${exercise.targetWeightKg}kg` : ''}</small></div>)}</div></details> })}</div></> : <p className="student360-empty">Học viên chưa có giáo án đang áp dụng.</p>}
          </Card>}
          {permissions.canViewTraining && <Card title="Nhật ký tập gần đây" icon={Activity}>
            <div className="student360-workout-logs">{training.recentLogs?.map((log) => <article key={log.id}><time>{safeDate(log.date)}</time><div><strong>{log.title}</strong><span>{log.completedSets ? `${log.completedSets} hiệp` : 'Đã ghi nhận'}{log.totalVolumeKg ? ` · ${currency.format(Math.round(log.totalVolumeKg))}kg tổng tải` : ''}{log.maximumWeightKg ? ` · tối đa ${log.maximumWeightKg}kg` : ''}</span>{log.painNotes && <small><AlertTriangle /> {log.painNotes}</small>}</div></article>)}{!training.recentLogs?.length && <p className="student360-empty">Chưa có nhật ký mức tạ.</p>}</div>
          </Card>}
          {permissions.canViewProgress && <Card title="Chỉ số cơ thể" icon={Scale}>
            {progress ? <><div className="student360-progress-summary is-detail"><div><Scale /><strong>{progress.latestWeightKg ?? '—'}<small>kg</small></strong><span>{progress.weightChangeKg === null ? '—' : `${progress.weightChangeKg > 0 ? '+' : ''}${progress.weightChangeKg}kg`}</span></div><div><Ruler /><strong>{progress.latestWaistCm ?? '—'}<small>cm eo</small></strong><span>{progress.waistChangeCm === null ? '—' : `${progress.waistChangeCm > 0 ? '+' : ''}${progress.waistChangeCm}cm`}</span></div><div><HeartPulse /><strong>{progress.latestBodyFatPercent ?? '—'}<small>% mỡ</small></strong><span>{progress.bodyFatChangePercent === null ? '—' : `${progress.bodyFatChangePercent > 0 ? '+' : ''}${progress.bodyFatChangePercent}%`}</span></div></div><p className="student360-updated">Cập nhật {safeDate(progress.latestDate)} · {progress.measurementCount} lần đo</p></> : <p className="student360-empty">Chưa có dữ liệu cân đo.</p>}
          </Card>}
          {permissions.canViewNutrition && <Card title="Dinh dưỡng" icon={Salad}>
            {nutrition ? <div className="student360-nutrition is-detail"><div><strong>{nutrition.averageCalories}</strong><span>kcal/ngày</span><small>Mục tiêu {nutrition.targetCalories ?? '—'}</small></div><div><strong>{nutrition.averageProtein}g</strong><span>protein/ngày</span><small>Mục tiêu {nutrition.targetProtein ?? '—'}g</small></div><div><strong>{nutrition.loggedMeals}</strong><span>bữa đã ghi</span><small>{nutrition.loggedDays}/7 ngày</small></div></div> : <p className="student360-empty">Chưa có dữ liệu dinh dưỡng.</p>}
          </Card>}
          {permissions.canViewProgressPhotos && <Card title="Ảnh tiến độ" icon={ImageIcon} className="student360-photo-card">
            {!photosLoaded && photosLoading ? <State><LoaderCircle className="is-spinning" /> Đang mở ảnh riêng tư…</State> : photos.length ? <><div className="student360-photo-list">{photos.map((record) => <article key={record.id}><time>{safeDate(record.date)}</time><div>{record.images.map((image, index) => <button type="button" key={`${record.id}-${index}`} onClick={() => window.open(image.url, '_blank', 'noopener,noreferrer')}><img loading="lazy" src={image.url} alt={`Tiến độ ${identity.name} ngày ${safeDate(record.date)}`} />{image.legacy && <span>Ảnh cũ</span>}</button>)}</div></article>)}</div>{photoHasMore && <button type="button" className="student360-load-more" disabled={photosLoading} onClick={() => void loadMorePhotos()}>{photosLoading ? 'Đang tải thêm…' : 'Tải thêm ảnh'}</button>}</> : <p className="student360-empty">Chưa có ảnh tiến độ hoặc ảnh đang chờ chuyển sang kho riêng tư.</p>}
          </Card>}
        </div>}
      </section>}

      {activeTab === 'contract' && <section className="student360-section">
        <div className="student360-section-heading"><div><small>CONTRACT & ENTITLEMENT</small><h2>Hợp đồng và quyền lợi</h2><p>Xem, sửa, bảo lưu, gia hạn, hủy và quản lý thanh toán ngay trong hồ sơ 360.</p></div></div>
        {contract && <div className="student360-contract-grid student360-contract-grid--entitlement">
          <Card title={contract.packageName} icon={FileText}>
            <div className="student360-entitlement-tree"><div><strong>{contract.totalSessions}</strong><span>Tổng quyền lợi</span></div><i /><div className="student360-entitlement-branches"><div><strong>{contract.usedSessions}</strong><span>Đã dùng</span><small>{contract.chargedSessions} buổi đã tính{contract.legacyProjectionAdjustment ? ` · ${contract.legacyProjectionAdjustment} buổi dữ liệu cũ` : ''}</small></div><div><strong>{contract.exemptSessions}</strong><span>Miễn trừ</span><small>Không trừ quyền lợi hợp đồng</small></div><div><strong>{contract.pendingReconciliationSessions}</strong><span>Chờ đối soát</span><small>Cần quản lý xác nhận trước khi trừ buổi</small></div><div><strong>{contract.remainingSessions}</strong><span>Còn lại</span><small>Có thể tiếp tục xếp theo hiệu lực hợp đồng</small></div></div></div>
            <dl className="student360-definition-list"><div><dt>Hiệu lực</dt><dd>{safeDate(contract.startDate)} → {safeDate(contract.endDate)}</dd></div><div><dt>Đối soát</dt><dd>{contract.reconciliationStatus === 'matched' ? 'Đã khớp lịch sử' : 'Cần kiểm tra dữ liệu cũ'}</dd></div></dl>
          </Card>
        </div>}
        <Suspense fallback={<State><LoaderCircle className="is-spinning" /><h3>Đang mở trung tâm nghiệp vụ hợp đồng…</h3></State>}>
          <Student360ContractWorkspace studentId={studentId} overview={overview} source={source} isDemo={isDemo} onNavigate={onNavigate} onChanged={() => loadOverview(false)} onNotice={setNotice} />
        </Suspense>
      </section>}

      {activeTab === 'more' && <section className="student360-section">
        <div className="student360-section-heading"><div><small>HỒ SƠ VẬN HÀNH</small><h2>Thông tin và chất lượng dữ liệu</h2><p>Người phụ trách, lịch rảnh và các điểm cần hoàn thiện.</p></div></div>
        <div className="student360-more-grid">
          <Card title="Thông tin học viên" icon={UserRound}><dl className="student360-definition-list"><div><dt>Họ tên</dt><dd>{identity.name}</dd></div><div><dt>Điện thoại</dt><dd>{identity.phone || 'Chưa cập nhật'}</dd></div><div><dt>Email</dt><dd>{identity.email || 'Chưa cập nhật'}</dd></div><div><dt>Ngày sinh</dt><dd>{safeDate(identity.dob)}</dd></div><div><dt>Ngày tham gia</dt><dd>{safeDate(identity.joinDate)}</dd></div><div><dt>Mã tài khoản</dt><dd>{identity.accountUid || 'Chưa liên kết'}</dd></div></dl></Card>
          <Card title="Người phụ trách" icon={ShieldCheck}><dl className="student360-definition-list"><div><dt>Chi nhánh</dt><dd>{assignments.branchName || 'Chưa xác định'}</dd></div><div><dt>PT chính/phụ</dt><dd>{assignments.trainerNames.join(' · ') || 'Chưa phân công'}</dd></div><div><dt>Coach dinh dưỡng</dt><dd>{assignments.nutritionCoachNames.join(' · ') || 'Chưa phân công'}</dd></div><div><dt>Sales chăm sóc</dt><dd>{(assignments.salesNames || []).join(' · ') || 'Chưa phân công'}</dd></div></dl></Card>
          {permissions.canViewOperations && <Card title="Lịch rảnh đang áp dụng" icon={CalendarDays}><div className="student360-availability"><div><strong>{availabilityCopy(schedule.availability.source)}</strong><span>{schedule.availability.sourceWeekId ? `Nguồn tuần ${safeDate(schedule.availability.sourceWeekId)}` : 'Chưa xác định tuần nguồn'}</span></div><div>{schedule.availability.slots.map((slot) => <span key={slot}>{slot.replace('-', ' · ')}:00</span>)}</div><small>{schedule.availability.confirmed ? 'Đã xác nhận' : 'Chưa xác nhận'} · {schedule.availability.slots.length}/{schedule.availability.minimumSlots} khung tối thiểu</small></div></Card>}
          <Card title="Mục tiêu" icon={Target}><div className="student360-goals">{identity.goals.map((goal) => <span key={goal}><Check />{goal}</span>)}{identity.goals.length === 0 && <p className="student360-empty">Học viên chưa thiết lập mục tiêu đo lường được.</p>}</div></Card>
          <Card title="Chất lượng dữ liệu" icon={Info} className={overview.dataQuality.length ? 'has-warning' : ''}>{overview.dataQuality.length ? <div className="student360-quality-list">{overview.dataQuality.map((issue) => <div key={issue.code}><AlertTriangle /><span><strong>{issue.code}</strong><small>{issue.message}</small></span></div>)}</div> : <div className="student360-all-good"><Check /><strong>Dữ liệu cốt lõi đã sẵn sàng</strong><span>Không phát hiện liên kết thiếu hoặc lệch số buổi.</span></div>}</Card>
          <Card title="Kế hoạch chăm sóc" icon={ClipboardCheck}><div className="student360-care-plan"><span><Check /> Kiểm tra cân nặng hàng tuần</span><span><Check /> Theo dõi lịch tập đủ mục tiêu</span><span><Check /> Review dinh dưỡng theo phân công</span><span><Check /> Liên hệ renew trước khi hết hạn</span><button type="button" onClick={() => openCare('note')}>+ Thêm ghi chú chăm sóc</button></div></Card>
        </div>
      </section>}
    </div>

    <nav className="student360-tabs student360-tabs--mobile" aria-label="Nội dung Học viên 360 trên điện thoại">{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={activeTab === id ? 'active' : ''} aria-current={activeTab === id ? 'page' : undefined} onClick={() => { setActiveTab(id); window.scrollTo({ top: 0, behavior: 'smooth' }) }}><Icon /><span>{label}</span></button>)}</nav>

    {careType && <div className="student360-dialog-layer" role="presentation"><button type="button" className="student360-dialog-backdrop" aria-label="Đóng" onClick={() => setCareType(null)} /><section className="student360-dialog" role="dialog" aria-modal="true" aria-labelledby="student360-care-title"><header><div><small>NHẬT KÝ CHĂM SÓC</small><h2 id="student360-care-title">{careType === 'call' ? 'Ghi nhận cuộc gọi' : careType === 'zalo' ? 'Ghi nhận liên hệ Zalo' : careType === 'action_completed' ? 'Hoàn tất việc cần làm' : 'Thêm ghi chú'}</h2></div><button type="button" aria-label="Đóng" onClick={() => setCareType(null)}><X /></button></header><p>{identity.name} · {identity.phone || 'Chưa có số điện thoại'}</p><label>Ghi chú<textarea rows={4} maxLength={1000} value={careNote} onChange={(event) => setCareNote(event.target.value)} placeholder="Nội dung trao đổi, kết quả hoặc việc cần theo dõi tiếp…" /></label><footer><button type="button" onClick={() => setCareType(null)}>Hủy</button><button type="button" disabled={careSaving || (careType === 'note' && careNote.trim().length < 2)} onClick={() => void saveCare()}>{careSaving ? 'Đang lưu…' : 'Lưu vào lịch sử'}</button></footer></section></div>}

    {notice && <div className="student360-toast" role="status">{notice}</div>}
  </main>
}
