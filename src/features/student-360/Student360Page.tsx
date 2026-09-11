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
  Coins,
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
  X,
  Zap,
} from 'lucide-react'
import type { ViewId } from '../../types'
import {
  createStudentCareActivity,
  getStudent360NutritionActivityDetail,
  getStudent360Overview,
  getStudent360ProgressPhotos,
  listStudent360Timeline,
  refreshStudent360Projection,
} from './student360Service'
import type {
  Student360Action,
  Student360NutritionActivityDetail,
  Student360Overview,
  Student360Photo,
  Student360Tab,
  Student360TimelineEvent,
} from './types'
import './Student360Page.css'
import { getStudentLoyaltySummary } from '../loyalty/loyaltyService'
import type { LoyaltyAccount } from '../loyalty/types'

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
  { id: 'more', label: 'Lịch', icon: CalendarDays },
  { id: 'coaching', label: 'Chuyên môn', icon: Dumbbell },
  { id: 'contract', label: 'Hợp đồng', icon: FileText },
  { id: 'activity', label: 'Nhật ký', icon: History },
]

const timelineFilters = [
  { id: 'all', label: 'Tất cả' },
  { id: 'training', label: 'Tập luyện' },
  { id: 'nutrition', label: 'Dinh dưỡng' },
  { id: 'care', label: 'Chăm sóc' },
  { id: 'contract', label: 'Hợp đồng & thanh toán' },
] as const

const timelineSourceGuide = [
  { label: 'Hợp đồng', source: 'contracts + contractAuditLogs', detail: 'Tạo, sửa, gia hạn, mua thêm buổi, bảo lưu và hủy. Audit ghi người thao tác, revision và trường thay đổi.' },
  { label: 'Thanh toán', source: 'ledgerEntries (chuẩn) · payments (cũ)', detail: 'Chỉ lấy payment, refund, reversal hoặc adjustment. Revenue recognition nội bộ không hiển thị để tránh nhân đôi doanh thu.' },
  { label: 'Buổi tập', source: 'sessions', detail: 'Lịch đã xếp, đã tập, đi trễ, vắng hoặc trạng thái buổi. Mã session là khóa đối chiếu với lịch sử.' },
  { label: 'Dinh dưỡng', source: 'users/{uid}/mealLogs + mealReviews', detail: 'Một bữa là một sự kiện. Ảnh và nhận xét riêng tư chỉ được tải khi người có quyền mở chi tiết.' },
  { label: 'Check-in & tiến độ', source: 'dailyCheckins + progressCheckIns (chuẩn) · bodyMetrics/progressPhotos (cũ)', detail: 'Một lần ghi nhận mới gom số đo và bộ ảnh vào cùng check-in. Timeline chỉ lưu metadata, không nhúng ảnh hoặc ghi chú nhạy cảm.' },
  { label: 'Chăm sóc & gia hạn', source: 'studentCareActivities + contractRenewalCases', detail: 'Cuộc gọi, Zalo, ghi chú, việc cần làm và các bước chăm sóc tái ký.' },
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

function paymentCopy(status?: 'paid' | 'due' | 'overdue') {
  if (status === 'paid') return 'Đã thanh toán'
  if (status === 'overdue') return 'Quá hạn'
  if (status === 'due') return 'Sắp đến hạn'
  return 'Chưa có lịch thu'
}

function availabilityCopy(source: string) {
  if (source === 'weekly') return 'Lịch tuần đã gửi'
  if (source === 'inherited_weekly') return 'Kế thừa lịch gần nhất'
  if (source === 'legacy_default') return 'Lịch mặc định cũ'
  return 'Chưa có lịch rảnh'
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
    schemaVersion: 2,
    formulaVersion: 'student-health-v1',
    studentId,
    accountUid: 'demo-account',
    generatedAt: new Date().toISOString(),
    generatedAtMillis: Date.now(),
    permissions: { scope: 'system', canViewOperations: true, canViewTraining: true, canViewNutrition: true, canViewProgress: true, canViewProgressPhotos: true, canManageProgress: true, canViewFinancialStatus: true, canViewFinancialAmounts: true, canViewRenewal: true, canManageCare: true, canManageContract: true, canRefreshProjection: true },
    identity: { id: studentId, accountUid: 'demo-account', name: 'Nguyễn Minh Anh', phone: '0900 000 001', email: 'minhanh@aurafitness.vn', dob: '1995-06-18', avatarUrl: null, status: 'active', joinDate: '2026-02-10', goals: ['Giảm mỡ', 'Tăng sức mạnh thân dưới'], sessionsPerWeek: 3 },
    assignments: { branchId: 'branch-demo', branchName: 'Aura Hải Châu', trainerIds: ['trainer-1', 'trainer-2'], trainerNames: ['PT Hải Âu', 'PT Minh'], nutritionCoachIds: ['coach-1'], nutritionCoachNames: ['Coach Linh'], salesIds: ['sales-1'], salesNames: ['Sales Thu'] },
    contract: { id: 'contract-demo', packageName: 'PT 1:1 · 6 tháng', status: 'active', startDate: '2026-06-02', endDate: '2026-12-18', daysRemaining: 105, totalSessions: 72, storedUsedSessions: 34, chargedSessions: 34, exemptSessions: 1, pendingReconciliationSessions: 0, usedSessions: 34, remainingSessions: 38, legacyProjectionAdjustment: 0, projectionDelta: 0, reconciliationStatus: 'matched', payment: { status: 'due', total: 18_000_000, paid: 14_000_000, outstanding: 4_000_000, nextPaymentDate: '2026-09-12' }, pausePeriods: [{ requestId: 'off-1', type: 'off', startDate: '2026-07-12', endDate: '2026-07-20', durationDays: 9 }], extensions: [] },
    schedule: { weekId: toKey(today), weekEnd: toKey(new Date(today.getTime() + 6 * 86_400_000)), requiredSessions: 3, bookedSessions: 2, nextSession: { id: 'session-demo', date: toKey(future), hour: 17, trainerId: 'trainer-1', status: 'scheduled' }, sessions: [{ id: 'session-1', date: toKey(today), hour: 17, status: 'completed', attendanceStatus: 'present' }, { id: 'session-2', date: toKey(future), hour: 17, status: 'scheduled', attendanceStatus: 'scheduled' }], availability: { slots: ['T2-17', 'T4-17', 'T6-18', 'T7-08', 'CN-09'], confirmed: true, source: 'inherited_weekly', sourceWeekId: '2026-08-31', minimumSlots: 5 } },
    attendance: { rate28Days: 92, attended: 11, late: 1, noShow: 1, total: 12, weeklyTrend: [{ weekStart: '2026-08-10', rate: 100, total: 3 }, { weekStart: '2026-08-17', rate: 100, total: 3 }, { weekStart: '2026-08-24', rate: 67, total: 3 }, { weekStart: '2026-08-31', rate: 100, total: 3 }], lastAttendanceAt: new Date().toISOString() },
    training: { adherence28Days: 92, completed28Days: 11, target28Days: 12, workoutLogCount: 18, latestWorkoutAt: new Date().toISOString(), program: { id: 'program-1', title: 'Build Strength · Phase 2', goal: 'Glute strength · Core stability · Fat loss', status: 'active', revision: 3, trainingDays: [{ id: 'day-1', title: 'Lower Body', focusMuscles: ['Mông', 'Đùi'], exercises: [{ id: 'hip-thrust', nameVi: 'Hip Thrust', sets: 4, repMinimum: 10, repMaximum: 10, targetWeightKg: 70 }] }] }, recentLogs: [{ id: 'log-1', date: toKey(today), title: 'Lower Body', painNotes: null, completedSets: 16, totalVolumeKg: 4620, maximumWeightKg: 70 }] },
    nutrition: { loggedMeals: 16, loggedDays: 6, averageCalories: 1618, averageProtein: 102, targetCalories: 1650, targetProtein: 110, lastMealAt: new Date().toISOString() },
    progress: { latestDate: toKey(today), latestWeightKg: 59.9, latestWaistCm: 70, latestBodyFatPercent: 27, latestHipsCm: 94, latestThighCm: 54, latestArmCm: 27, latestChestCm: 84, latestMuscleMassKg: 23.5, weightChangeKg: -4.9, waistChangeCm: -8, bodyFatChangePercent: -5, measurementCount: 8 },
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
    { id: 'timeline-1', type: 'training', group: 'training', groupLabel: 'Buổi tập', sourceLabel: 'Lịch buổi tập', sourceCollection: 'sessions', occurredAt: new Date(now - 60 * 60_000).toISOString(), sortKey: now * 1000, title: 'PT xác nhận có mặt', description: 'Buổi Lower Body · 17:00', audience: 'operations', metadata: {} },
    { id: 'timeline-2', type: 'nutrition', group: 'nutrition', groupLabel: 'Dinh dưỡng', sourceLabel: 'Nhật ký bữa ăn', sourceCollection: 'mealLogs', occurredAt: new Date(now - 8 * 60 * 60_000).toISOString(), sortKey: (now - 8 * 60 * 60_000) * 1000, title: 'Bữa ăn đã được duyệt', description: 'Bữa sáng giàu đạm · 420 kcal · 32g protein', audience: 'coaching', metadata: { mealId: 'meal-demo', reviewId: 'meal-demo', status: 'approved', mealType: 'Bữa sáng', calories: 420, protein: 32, hasImage: false, confidence: 'verified' } },
    { id: 'timeline-3', type: 'progress', group: 'progress', groupLabel: 'Tiến độ', sourceLabel: 'Số đo cơ thể', sourceCollection: 'bodyMetrics', occurredAt: new Date(now - 86_400_000).toISOString(), sortKey: (now - 86_400_000) * 1000, title: 'Cập nhật chỉ số cơ thể', description: '59,9kg · eo 70cm', audience: 'coaching', metadata: {} },
  ]
}

function mergeTimelineRows(current: Student360TimelineEvent[], incoming: Student360TimelineEvent[]) {
  const byKey = new Map<string, Student360TimelineEvent>()
  ;[...current, ...incoming].forEach((item) => {
    const key = item.dedupeKey || item.id
    const previous = byKey.get(key)
    if (!previous || (item.sortKey || 0) > (previous.sortKey || 0)) byKey.set(key, item)
  })
  return [...byKey.values()].sort((left, right) => right.sortKey - left.sortKey)
}

function Metric({ label, value, note, tone }: { label: string; value: string | number; note: string; tone?: string }) {
  return <article className={`student360-metric${tone ? ` is-${tone}` : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>
}

function Card({ title, icon: Icon, action, children, className = '' }: { title: string; icon: typeof Activity; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <article className={`student360-card ${className}`}><header><div><Icon size={18} /><h2>{title}</h2></div>{action}</header>{children}</article>
}

function ProgressSummary({ progress, detailed = false }: { progress: NonNullable<Student360Overview['progress']>; detailed?: boolean }) {
  const extra = [
    ['Vòng mông', progress.latestHipsCm, 'cm'],
    ['Vòng đùi', progress.latestThighCm, 'cm'],
    ['Bắp tay', progress.latestArmCm, 'cm'],
    ['Vòng ngực', progress.latestChestCm, 'cm'],
    ['Khối lượng cơ', progress.latestMuscleMassKg, 'kg'],
  ] as const
  return <>
    <div className={`student360-progress-summary${detailed ? ' is-detail' : ''}`}><div><Scale /><strong>{progress.latestWeightKg ?? '—'}<small>kg</small></strong><span>{progress.weightChangeKg === null ? 'Chưa có so sánh' : `${progress.weightChangeKg > 0 ? '+' : ''}${progress.weightChangeKg}kg`}</span></div><div><Ruler /><strong>{progress.latestWaistCm ?? '—'}<small>cm eo</small></strong><span>{progress.waistChangeCm === null ? 'Chưa có so sánh' : `${progress.waistChangeCm > 0 ? '+' : ''}${progress.waistChangeCm}cm`}</span></div><div><HeartPulse /><strong>{progress.latestBodyFatPercent ?? '—'}<small>% mỡ</small></strong><span>{progress.bodyFatChangePercent === null ? 'Chưa có so sánh' : `${progress.bodyFatChangePercent > 0 ? '+' : ''}${progress.bodyFatChangePercent}%`}</span></div></div>
    {detailed && <div className="student360-progress-extra">{extra.map(([label, value, unit]) => <span key={label}><small>{label}</small><strong>{value ?? '—'}{value !== null && value !== undefined ? ` ${unit}` : ''}</strong></span>)}</div>}
  </>
}

function State({ type, children }: { type?: 'error'; children: React.ReactNode }) {
  return <div className={`student360-state${type ? ` is-${type}` : ''}`}>{children}</div>
}

function nutritionStatusCopy(status: unknown) {
  if (status === 'approved') return 'Đã duyệt'
  if (status === 'rejected') return 'Cần chỉnh'
  if (status === 'pending') return 'Chờ duyệt'
  return 'Đã ghi'
}

function confidenceLabel(value: unknown) {
  if (value === 'verified' || value === 'high') return 'Tin cậy cao'
  if (value === 'needs-review' || value === 'low') return 'Cần kiểm tra'
  if (value === 'estimated' || value === 'medium') return 'Ước tính'
  return ''
}

function TimelineActivityCard({ item, onOpenNutrition }: { item: Student360TimelineEvent; onOpenNutrition: (item: Student360TimelineEvent) => void }) {
  const isNutrition = item.type === 'nutrition'
  const mealId = typeof item.metadata.mealId === 'string' ? item.metadata.mealId : typeof item.metadata.reviewId === 'string' ? item.metadata.reviewId : ''
  const calories = typeof item.metadata.calories === 'number' ? item.metadata.calories : 0
  const protein = typeof item.metadata.protein === 'number' ? item.metadata.protein : 0
  const thumbnailUrl = item.media?.thumbnailUrl || ''
  const openable = isNutrition && Boolean(mealId)
  const icon = item.type === 'training' || item.type === 'workout' ? <Dumbbell /> : isNutrition ? <Salad /> : item.type === 'progress' || item.type === 'checkin' ? <Activity /> : item.type === 'finance' ? <CircleDollarSign /> : item.type === 'care' ? <MessageCircle /> : <FileText />
  return <article className={isNutrition ? 'is-nutrition' : undefined}>
    {isNutrition ? <button type="button" className={`student360-timeline-media${thumbnailUrl ? ' has-image' : ''}`} disabled={!openable} onClick={() => onOpenNutrition(item)} aria-label={`Xem chi tiết ${item.description}`}>
      {thumbnailUrl ? <img loading="lazy" src={thumbnailUrl} alt="" /> : typeof item.metadata.hasImage === 'boolean' && item.metadata.hasImage ? <ImageIcon /> : <Salad />}
      <span>{thumbnailUrl ? 'Mở ảnh' : 'Xem bữa'}</span>
    </button> : <div className={`student360-timeline-icon is-${item.type}`}>{icon}</div>}
    <div className="student360-timeline-copy">
      <div className="student360-timeline-meta"><time>{safeDate(item.occurredAt, true)}{typeof item.metadata.actorName === 'string' && item.metadata.actorName ? ` · ${item.metadata.actorName}` : ''}</time><span>{item.groupLabel || item.type}</span></div>
      <strong>{item.title}</strong>
      <p>{item.description}</p>
      {typeof item.metadata.amount === 'number' && <small>{currency.format(item.metadata.amount)}đ</small>}
      {isNutrition && <div className="student360-timeline-nutrition-meta">
        {typeof item.metadata.mealType === 'string' && item.metadata.mealType && <span>{item.metadata.mealType}</span>}
        {calories > 0 && <span>{calories} kcal</span>}
        {protein > 0 && <span>{protein}g protein</span>}
        <b className={`is-${String(item.metadata.status || 'logged')}`}>{nutritionStatusCopy(item.metadata.status)}</b>
        {openable && <button type="button" onClick={() => onOpenNutrition(item)}>Xem chi tiết</button>}
      </div>}
      <details className="student360-timeline-details"><summary>Chi tiết đối chiếu</summary><div><span>Nguồn</span><b>{item.sourceLabel || item.sourceCollection || 'CRM Timeline'}</b>{typeof item.metadata.contractId === 'string' && item.metadata.contractId && <><span>Mã hợp đồng</span><b>{item.metadata.contractId}</b></>}{typeof item.metadata.sessionId === 'string' && item.metadata.sessionId && <><span>Mã buổi</span><b>{item.metadata.sessionId}</b></>}{typeof item.metadata.attendanceEventId === 'string' && item.metadata.attendanceEventId && <><span>Mã điểm danh</span><b>{item.metadata.attendanceEventId}</b></>}{typeof item.metadata.confirmationSource === 'string' && item.metadata.confirmationSource && <><span>Nguồn xác nhận</span><b>{item.metadata.confirmationSource === 'auto_after_48h' ? 'Tự động sau 48 giờ' : item.metadata.confirmationSource === 'manual' ? 'Nhân sự xác nhận' : item.metadata.confirmationSource}</b></>}{typeof item.metadata.confirmedAt === 'string' && item.metadata.confirmedAt && <><span>Xác nhận lúc</span><b>{safeDate(item.metadata.confirmedAt, true)}</b></>}{typeof item.metadata.lateMinutes === 'number' && item.metadata.lateMinutes > 0 && <><span>Đi trễ</span><b>{item.metadata.lateMinutes} phút</b></>}{typeof item.metadata.referenceCode === 'string' && item.metadata.referenceCode && <><span>Mã giao dịch</span><b>{item.metadata.referenceCode}</b></>}{isNutrition && mealId && <><span>Mã bữa ăn</span><b>{mealId}</b></>}</div></details>
    </div>
  </article>
}

export default function Student360Page({ studentId, source, isDemo = false, onBack, onNavigate }: Props) {
  const [activeTab, setActiveTab] = useState<Student360Tab>('overview')
  const [overview, setOverview] = useState<Student360Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [timeline, setTimeline] = useState<Student360TimelineEvent[]>([])
  const [timelineError, setTimelineError] = useState('')
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
  const nutritionRequestRef = useRef(0)
  const [nutritionDetailEvent, setNutritionDetailEvent] = useState<Student360TimelineEvent | null>(null)
  const [nutritionDetail, setNutritionDetail] = useState<Student360NutritionActivityDetail | null>(null)
  const [nutritionDetailLoading, setNutritionDetailLoading] = useState(false)
  const [nutritionDetailError, setNutritionDetailError] = useState('')
  const [careType, setCareType] = useState<'call' | 'zalo' | 'note' | 'action_completed' | null>(null)
  const [careActionId, setCareActionId] = useState<string | undefined>()
  const [careNote, setCareNote] = useState('')
  const [careSaving, setCareSaving] = useState(false)
  const [loyaltyAccount, setLoyaltyAccount] = useState<LoyaltyAccount | null>(null)

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
  useEffect(() => {
    let active = true
    if (isDemo) {
      setLoyaltyAccount({ studentId, status: 'active', availablePoints: 2_480, pendingPoints: 180, reservedPoints: 0, debtPoints: 0, lifetimeEarnedPoints: 3_180, lifetimeRedeemedPoints: 700, tierQualifyingValue: 38_000_000, tier: 'gold', tierProgress: { tier: 'gold', nextTier: 'diamond', currentValue: 38_000_000, targetValue: 50_000_000, remainingValue: 12_000_000, percent: 52 }, revision: 1 })
      return () => { active = false }
    }
    void getStudentLoyaltySummary(studentId).then((result) => { if (active) setLoyaltyAccount(result.account) }).catch(() => { if (active) setLoyaltyAccount(null) })
    return () => { active = false }
  }, [isDemo, studentId])

  const loadTimeline = useCallback(async (append = false) => {
    if (timelineLoading) return
    setTimelineLoading(true)
    setTimelineError('')
    try {
      if (isDemo) {
        setTimeline(demoTimeline())
        setTimelineHasMore(false)
        return
      }
      const types = timelineFilter === 'all'
        ? undefined
        : timelineFilter === 'contract'
          ? ['off', 'freeze', 'schedule_change', 'contract', 'finance']
          : timelineFilter === 'training'
            ? ['training', 'workout']
            : timelineFilter === 'care'
              ? ['care', 'checkin', 'progress', 'renewal']
            : [timelineFilter]
      const rangeDays = timelineRanges.find((item) => item.id === timelineRange)?.days || 0
      const result = await listStudent360Timeline({
        studentId,
        ...(types ? { types } : {}),
        ...(append && timelineCursor !== null ? { cursor: timelineCursor } : {}),
        pageSize: 30,
        ...(rangeDays ? { fromMillis: Date.now() - rangeDays * 86_400_000 } : {}),
      })
      setTimeline((current) => append ? mergeTimelineRows(current, result.rows) : mergeTimelineRows([], result.rows))
      setTimelineCursor(result.nextCursor)
      setTimelineHasMore(result.hasMore)
    } catch (cause) {
      setTimelineError(cause instanceof Error ? cause.message : 'Không thể tải dòng hoạt động.')
    } finally {
      setTimelineLoading(false)
    }
  }, [isDemo, studentId, timelineCursor, timelineFilter, timelineLoading, timelineRange])

  useEffect(() => {
    if (activeTab !== 'activity') return
    setTimeline([])
    setTimelineCursor(null)
    setTimelineHasMore(false)
    setTimelineError('')
    void loadTimeline(false)
    // loadTimeline deliberately changes after a page response; pagination is
    // user-triggered and must not cause the first page to load again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, timelineFilter, timelineRange, studentId])

  useEffect(() => {
    activePhotoStudentRef.current = studentId
    nutritionRequestRef.current += 1
    setPhotos([])
    setPhotosLoaded(false)
    setPhotoCursor(null)
    setPhotoHasMore(false)
    setNutritionDetailEvent(null)
    setNutritionDetail(null)
    setNutritionDetailError('')
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

  const closeNutritionDetail = () => {
    nutritionRequestRef.current += 1
    setNutritionDetailEvent(null)
    setNutritionDetail(null)
    setNutritionDetailError('')
    setNutritionDetailLoading(false)
  }

  const openNutritionDetail = async (item: Student360TimelineEvent) => {
    const mealId = typeof item.metadata.mealId === 'string' ? item.metadata.mealId : typeof item.metadata.reviewId === 'string' ? item.metadata.reviewId : ''
    if (!mealId) return
    const reviewId = typeof item.metadata.reviewId === 'string' ? item.metadata.reviewId : undefined
    const requestId = nutritionRequestRef.current + 1
    nutritionRequestRef.current = requestId
    setNutritionDetailEvent(item)
    setNutritionDetail(null)
    setNutritionDetailError('')
    setNutritionDetailLoading(true)
    try {
      const result = isDemo ? {
        schemaVersion: 1 as const, studentId, mealId, title: 'Bữa sáng giàu đạm', description: 'Khẩu phần cân bằng cho ngày tập.', date: new Date().toISOString().slice(0, 10), time: '08:00', mealType: 'Bữa sáng', calories: 420, protein: 32, carbs: 41, fat: 13, fiber: 7, confidence: 'verified', source: 'ai-scan', hasImage: false, imageUrl: null, imageExpiresInSeconds: null,
        items: [{ name: 'Trứng và rau', weight: 220, calories: 260, protein: 24 }], analysis: { portion: 'Khẩu phần phù hợp.', goal: 'Phù hợp mục tiêu hiện tại.', suggestion: 'Giữ lượng rau và đạm như hiện tại.', balance: 'Đạm và chất xơ tốt.' }, review: { id: mealId, status: 'approved', coachFeedback: 'Bữa ăn cân bằng, tiếp tục duy trì.', reviewedAt: new Date().toISOString() },
      } : await getStudent360NutritionActivityDetail({ studentId, mealId, ...(reviewId ? { reviewId } : {}) })
      if (nutritionRequestRef.current === requestId) setNutritionDetail(result)
    } catch (cause) {
      if (nutritionRequestRef.current === requestId) setNutritionDetailError(cause instanceof Error ? cause.message : 'Không thể tải chi tiết bữa ăn.')
    } finally {
      if (nutritionRequestRef.current === requestId) setNutritionDetailLoading(false)
    }
  }

  const openNutritionTimeline = () => {
    setTimelineFilter('nutrition')
    setActiveTab('activity')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  useEffect(() => {
    if (!nutritionDetailEvent) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeNutritionDetail() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [nutritionDetailEvent])

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
  const daysLabel = contract?.daysRemaining === null || contract?.daysRemaining === undefined ? '—' : Math.max(0, contract.daysRemaining)
  const weeklyPercent = Math.min(100, schedule.requiredSessions ? schedule.bookedSessions / schedule.requiredSessions * 100 : 0)
  const paymentStatus = contract?.payment?.status

  return <main className="student360-page aura-ui-v4-surface aura-ui-v4-operations student360-page--v4" data-tab={activeTab}>
    <header className="student360-header">
      <div className="student360-header__bar">
        <button type="button" className="student360-icon-button" aria-label="Quay lại danh sách học viên" onClick={onBack}><ArrowLeft /></button>
        <div className="student360-identity">
          <span className="student360-avatar">{identity.avatarUrl ? <img src={identity.avatarUrl} alt="" /> : identity.name.charAt(0).toUpperCase()}</span>
          <div><small>Hồ sơ học viên</small><h1>{identity.name}</h1><p>{assignments.branchName || 'Chưa xác định chi nhánh'} · {assignments.trainerNames[0] || assignments.nutritionCoachNames[0] || 'Chưa phân người phụ trách'}</p></div>
        </div>
        <div className="student360-header__actions">
          {identity.phone && <a className="student360-icon-button" href={`tel:${identity.phone.replace(/\s/g, '')}`} aria-label={`Gọi ${identity.name}`}><Phone /></a>}
          {identity.phone && <button type="button" className="student360-icon-button" onClick={() => void copyPhone()} aria-label="Sao chép số điện thoại"><Copy /></button>}
          <details className="student360-business-menu">
            <summary className="student360-icon-button" aria-label="Mở menu nghiệp vụ"><MoreHorizontal /></summary>
            <div>
              {permissions.canManageContract && <button type="button" onClick={() => onNavigate('admin-pt-schedule', studentId, identity.name)}><CalendarPlus /> Tạo hoặc điều chỉnh lịch</button>}
              {permissions.canManageCare && <button type="button" onClick={() => openCare('note')}><MessageCircle /> Ghi chú chăm sóc</button>}
              {permissions.canViewRenewal && <button type="button" onClick={() => onNavigate(source.startsWith('staff') ? 'staff-renewals' : 'admin-renewals', studentId, identity.name)}><Sparkles /> Mở hồ sơ gia hạn</button>}
              {permissions.canManageContract && <button type="button" onClick={() => setActiveTab('contract')}><FileText /> Đổi PT · bảo lưu · sửa hợp đồng</button>}
              {permissions.canRefreshProjection && <button type="button" disabled={refreshing} onClick={() => void loadOverview(true)}><RefreshCw className={refreshing ? 'is-spinning' : ''} /> Đối soát dữ liệu</button>}
              {overview.dataQuality.length > 0 && <div className="student360-menu-warning"><AlertTriangle /><span><strong>{overview.dataQuality.length} điểm cần đối soát</strong><small>{overview.dataQuality.slice(0, 2).map((issue) => issue.message).join(' · ')}</small></span></div>}
            </div>
          </details>
        </div>
      </div>
    </header>
      <div className="student360-status-row">
        <span className={`student360-status is-${identity.status}`}><i />{statusCopy(identity.status)}</span>
        <details className="student360-profile-summary"><summary>Hồ sơ & người phụ trách <ChevronDown /></summary><dl><div><dt>Điện thoại</dt><dd>{identity.phone || 'Chưa cập nhật'}</dd></div><div><dt>Email</dt><dd>{identity.email || 'Chưa cập nhật'}</dd></div><div><dt>Ngày sinh</dt><dd>{safeDate(identity.dob)}</dd></div><div><dt>PT chính/phụ</dt><dd>{assignments.trainerNames.join(' · ') || 'Chưa phân công'}</dd></div><div><dt>Coach dinh dưỡng</dt><dd>{assignments.nutritionCoachNames.join(' · ') || 'Chưa phân công'}</dd></div><div><dt>Sales chăm sóc</dt><dd>{assignments.salesNames.join(' · ') || 'Chưa phân công'}</dd></div></dl></details>
      </div>
      <section className="student360-metrics" aria-label="Chỉ số nhanh">
        <Metric label="Quyền lợi" value={contract ? `${contract.remainingSessions}/${contract.totalSessions}` : '—'} note={contract ? `${contract.usedSessions} buổi đã dùng theo lịch sử` : 'Chưa có hợp đồng'} />
        {permissions.canViewOperations ? <Metric label="Lịch tuần" value={`${schedule.bookedSessions}/${schedule.requiredSessions}`} note={schedule.bookedSessions >= schedule.requiredSessions ? 'Đã đủ lịch mục tiêu' : `Còn thiếu ${Math.max(0, schedule.requiredSessions - schedule.bookedSessions)} buổi`} /> : <Metric label="Phạm vi" value={permissions.scope === 'sales' ? 'CSKH' : 'Coach'} note="Hiển thị theo quyền được cấp" />}
        <Metric label="Thời hạn" value={daysLabel} note={contract?.endDate ? `ngày · đến ${safeDate(contract.endDate)}` : 'Chưa có ngày hết hạn'} />
        {permissions.canViewFinancialStatus ? <Metric label="Thanh toán" value={paymentCopy(paymentStatus)} note={contract?.payment?.nextPaymentDate ? `Hạn ${safeDate(contract.payment.nextPaymentDate)}` : 'Không có khoản đến hạn'} tone={paymentStatus === 'overdue' ? 'action_required' : paymentStatus === 'due' ? 'attention' : 'stable'} /> : <Metric label="Chăm sóc" value={health.score} note={`${healthCopy(health.status)} · dữ liệu ${confidenceCopy(health.confidence).toLowerCase()}`} tone={health.status} />}
      </section>

    <nav className="student360-tabs student360-tabs--desktop" aria-label="Nội dung Học viên 360">{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={activeTab === id ? 'active' : ''} aria-current={activeTab === id ? 'page' : undefined} onClick={() => setActiveTab(id)}><Icon /><span>{label}</span></button>)}</nav>

    <div className="student360-content">
      {activeTab === 'overview' && <div className="student360-overview-grid">
        <section className="student360-v4-priority" aria-labelledby="student360-priority-title"><Card title="Cần xử lý" icon={Zap} className="student360-action-card">
          <span id="student360-priority-title" className="aura-visually-hidden">Cần xử lý</span>
          <div className="student360-actions">{overview.nextActions.slice(0, 3).map((item) => <button type="button" key={item.id} className={`is-${item.severity}`} onClick={() => performAction(item)}><span>{item.priority}</span><div><strong>{item.title}</strong><small>{item.description}</small><b>{actionLabel(item.action, canExecuteAction(item))} →</b></div></button>)}{overview.nextActions.length === 0 && <div className="student360-all-good"><Check /><strong>Không có việc khẩn cấp</strong><span>Dữ liệu hiện tại đang ổn định.</span></div>}</div>
        </Card></section>
        <section className="student360-main-column">
          {permissions.canViewOperations && <Card title="Lịch tập" icon={CalendarDays} action={<button type="button" className="student360-link" onClick={() => setActiveTab('more')}>Xem cả tuần</button>}>
            {schedule.nextSession ? <div className="student360-next-session"><time><strong>{safeDate(schedule.nextSession.date)}</strong><span>{schedule.nextSession.hour === null ? 'Chưa chốt giờ' : `${String(schedule.nextSession.hour).padStart(2, '0')}:00`}</span></time><div><b>{assignments.trainerNames[0] || 'PT Aura'}</b><span>{assignments.branchName || 'Chi nhánh Aura'}</span></div><span className="student360-pill">Đã xếp lịch</span></div> : <p className="student360-empty">Chưa có buổi tập sắp tới.</p>}
            <div className="student360-week-snapshot"><div><span>Tuần này</span><strong>{schedule.bookedSessions}/{schedule.requiredSessions} buổi</strong></div><span><i style={{ width: `${weeklyPercent}%` }} /></span><small>{schedule.bookedSessions >= schedule.requiredSessions ? 'Đã đủ lịch theo mục tiêu.' : `Cần bổ sung ${Math.max(0, schedule.requiredSessions - schedule.bookedSessions)} buổi.`}</small></div>
          </Card>}
        </section>

        <aside className="student360-side-column">
          <Card title="Tình trạng chăm sóc" icon={HeartPulse}>
            <div className="student360-care-health"><strong>{health.score}<small>/100</small></strong><div><b>{healthCopy(health.status)}</b><span>{attendance.rate28Days === null ? 'Chưa đủ dữ liệu tham gia' : `${attendance.rate28Days}% đi tập trong 28 ngày`}</span></div></div>
            <details className="student360-health-details"><summary>Xem các tín hiệu <ChevronDown /></summary><div>{health.components.filter((component) => component.available).map((component) => <p key={component.id}><span>{component.label}</span><b>{component.score ?? '—'}</b></p>)}</div></details>
          </Card>

          {loyaltyAccount && <Card title="Aura Club" icon={Coins}>
            <div className="student360-loyalty-summary"><div><strong>{new Intl.NumberFormat('vi-VN').format(loyaltyAccount.availablePoints)}</strong><span>Điểm Aura khả dụng</span></div><div><b>{loyaltyAccount.tier}</b><small>{loyaltyAccount.pendingPoints ? `${new Intl.NumberFormat('vi-VN').format(loyaltyAccount.pendingPoints)} điểm đang chờ` : 'Không có điểm chờ'}</small></div>{loyaltyAccount.debtPoints > 0 && <p><AlertTriangle /> Cần đối soát {new Intl.NumberFormat('vi-VN').format(loyaltyAccount.debtPoints)} điểm nghĩa vụ.</p>}</div>
          </Card>}

        </aside>
      </div>}

      {activeTab === 'activity' && <section className="student360-section">
        <div className="student360-section-heading"><div><small>Nhật ký</small><h2>Lịch sử học viên</h2><p>Tập luyện, dinh dưỡng, chăm sóc và hợp đồng theo thứ tự thời gian.</p></div><details className="student360-timeline-source-help"><summary><Info size={15} /> Nguồn dữ liệu</summary><div><p>Timeline đọc từ dữ liệu nghiệp vụ gốc và loại các bản ghi trùng.</p>{timelineSourceGuide.map((item) => <article key={item.label}><strong>{item.label}</strong><code>{item.source}</code><span>{item.detail}</span></article>)}</div></details></div>
        <div className="student360-timeline-toolbar"><div className="student360-filter-chips">{timelineFilters.map((filter) => <button type="button" key={filter.id} className={timelineFilter === filter.id ? 'active' : ''} onClick={() => setTimelineFilter(filter.id)}>{filter.label}</button>)}</div><div className="student360-filter-chips is-range">{timelineRanges.map((range) => <button type="button" key={range.id} className={timelineRange === range.id ? 'active' : ''} onClick={() => setTimelineRange(range.id)}>{range.label}</button>)}</div></div>
        <div className="student360-timeline">{timeline.map((item) => <TimelineActivityCard key={item.id} item={item} onOpenNutrition={(value) => void openNutritionDetail(value)} />)}{timelineError && <State type="error"><AlertTriangle /><h3>Không thể tải CRM Timeline</h3><p>{timelineError}</p><button type="button" onClick={() => void loadTimeline(false)}>Thử lại</button></State>}{!timeline.length && !timelineLoading && !timelineError && <State><History /><h3>{timelineFilter === 'training' ? 'Chưa có buổi tập chuẩn' : timelineFilter === 'nutrition' ? 'Chưa có nhật ký dinh dưỡng' : 'Chưa có hoạt động'}</h3><p>{timelineFilter === 'training' ? 'Timeline chỉ lấy buổi đã tạo trong sessions. Lịch nháp hoặc ô ma trận cũ chưa phát sinh session sẽ không được tính là lịch sử tập.' : timelineFilter === 'nutrition' ? (overview.identity.accountUid ? 'Chưa có bữa ăn được ghi nhận trong tài khoản Aura.' : 'Học viên chưa liên kết tài khoản Aura nên chưa thể đọc nhật ký bữa ăn.') : 'Không có sự kiện phù hợp bộ lọc hiện tại.'}</p></State>}{timelineLoading && <State><LoaderCircle className="is-spinning" /> Đang tải hoạt động…</State>}</div>
        {timelineHasMore && <button type="button" className="student360-load-more" disabled={timelineLoading} onClick={() => void loadTimeline(true)}>Tải thêm hoạt động</button>}
      </section>}

      {activeTab === 'coaching' && <section className="student360-section">
        <div className="student360-section-heading"><div><small>Chuyên môn</small><h2>Huấn luyện & sức khỏe</h2><p>Mục tiêu, giáo án, mức tạ, tiến độ cơ thể và dinh dưỡng.</p></div></div>
        {!permissions.canViewTraining && !permissions.canViewNutrition && !permissions.canViewProgress && !permissions.canManageProgress ? <State type="error"><ShieldCheck /><h3>Dữ liệu chuyên môn được giới hạn</h3><p>Vai trò hiện tại chỉ được xem hợp đồng và chăm sóc.</p></State> : <div className="student360-coaching-grid">
          <Card title="Mục tiêu hiện tại" icon={Sparkles}><div className="student360-goals">{identity.goals.map((goal) => <span key={goal}><Check />{goal}</span>)}{identity.goals.length === 0 && <p className="student360-empty">Học viên chưa thiết lập mục tiêu đo lường được.</p>}</div></Card>
          {permissions.canViewTraining && <Card title="Giáo án đang áp dụng" icon={Dumbbell} action={<button type="button" className="student360-link" onClick={() => onNavigate(source.startsWith('staff') ? 'staff-workouts' : 'admin-pt-workouts', studentId, identity.name)}>Mở giáo án</button>}>
            {training.program ? <><div className="student360-program"><span>ĐANG ÁP DỤNG</span><strong>{training.program.title}</strong><p>{training.program.goal || 'Chưa ghi mục tiêu giáo án.'}</p></div><div className="student360-program-days">{latestProgramDays.map((raw, index) => { const day = raw as { id?: string; title?: string; focusMuscles?: string[]; exercises?: Array<{ id?: string; nameVi?: string; name?: string; sets?: number; repMinimum?: number; repMaximum?: number; targetWeightKg?: number }> }; return <details key={day.id || index}><summary><span><strong>{day.title || `Buổi ${index + 1}`}</strong><small>{day.focusMuscles?.join(' · ') || 'Chưa phân nhóm cơ'}</small></span><b>{day.exercises?.length || 0} bài</b><ChevronDown /></summary><div>{day.exercises?.slice(0, 12).map((exercise, exerciseIndex) => <div key={exercise.id || exerciseIndex}><span>{exercise.nameVi || exercise.name || 'Bài tập'}</span><small>{exercise.sets || 0} hiệp · {exercise.repMinimum || 0}{exercise.repMaximum && exercise.repMaximum !== exercise.repMinimum ? `–${exercise.repMaximum}` : ''} lần{exercise.targetWeightKg ? ` · ${exercise.targetWeightKg}kg` : ''}</small></div>)}</div></details> })}</div></> : <p className="student360-empty">Học viên chưa có giáo án đang áp dụng.</p>}
          </Card>}
          {permissions.canViewTraining && <Card title="Nhật ký tập gần đây" icon={Activity}>
            <div className="student360-workout-logs">{training.recentLogs?.map((log) => <article key={log.id}><time>{safeDate(log.date)}</time><div><strong>{log.title}</strong><span>{log.completedSets ? `${log.completedSets} hiệp` : 'Đã ghi nhận'}{log.totalVolumeKg ? ` · ${currency.format(Math.round(log.totalVolumeKg))}kg tổng tải` : ''}{log.maximumWeightKg ? ` · tối đa ${log.maximumWeightKg}kg` : ''}</span>{log.painNotes && <small><AlertTriangle /> {log.painNotes}</small>}</div></article>)}{!training.recentLogs?.length && <p className="student360-empty">Chưa có nhật ký mức tạ.</p>}</div>
          </Card>}
          {(permissions.canViewProgress || permissions.canViewProgressPhotos || permissions.canManageProgress) && <Card title="Tiến độ cơ thể" icon={Scale} className="student360-photo-card" action={permissions.canManageProgress ? <button type="button" className="student360-link" onClick={() => onNavigate('progress-photo-studio', studentId, identity.name)}>Cập nhật</button> : undefined}>
            {permissions.canViewProgress && (progress ? <><ProgressSummary progress={progress} detailed /><p className="student360-updated">Cập nhật {safeDate(progress.latestDate)} · {progress.measurementCount} lần ghi nhận</p></> : <p className="student360-empty">Chưa có dữ liệu cân đo.</p>)}
            {permissions.canViewProgressPhotos && <div className="student360-progress-media-block">
              <div className="student360-progress-media-heading"><strong>Bộ ảnh theo lần ghi nhận</strong><small>Ảnh chỉ tải khi người có quyền mở mục này.</small></div>
              {!photosLoaded && photosLoading ? <State><LoaderCircle className="is-spinning" /> Đang mở ảnh riêng tư…</State> : photos.length ? <><div className="student360-photo-list">{photos.map((record) => <article key={record.id}><time>{safeDate(record.date)}</time><div>{record.images.map((image, index) => <button type="button" key={`${record.id}-${index}`} onClick={() => window.open(image.url, '_blank', 'noopener,noreferrer')}><img loading="lazy" src={image.url} alt={`Tiến độ ${identity.name} ngày ${safeDate(record.date)}`} />{image.angle && <span>{image.angle === 'front' ? 'Trước' : image.angle === 'back' ? 'Sau' : image.angle === 'left' ? 'Nghiêng trái' : image.angle === 'right' ? 'Nghiêng phải' : image.angle}</span>}{!image.angle && image.legacy && <span>Ảnh cũ</span>}</button>)}</div></article>)}</div>{photoHasMore && <button type="button" className="student360-load-more" disabled={photosLoading} onClick={() => void loadMorePhotos()}>{photosLoading ? 'Đang tải thêm…' : 'Tải thêm ảnh'}</button>}</> : <p className="student360-empty">Chưa có ảnh tiến độ hoặc ảnh đang chờ chuyển sang kho riêng tư.</p>}
            </div>}
          </Card>}
          {permissions.canViewNutrition && <Card title="Dinh dưỡng" icon={Salad} action={<button type="button" className="student360-link" onClick={openNutritionTimeline}>Mở nhật ký</button>}>
            {nutrition ? <div className="student360-nutrition is-detail"><div><strong>{nutrition.averageCalories}</strong><span>kcal/ngày</span><small>Mục tiêu {nutrition.targetCalories ?? '—'}</small></div><div><strong>{nutrition.averageProtein}g</strong><span>protein/ngày</span><small>Mục tiêu {nutrition.targetProtein ?? '—'}g</small></div><div><strong>{nutrition.loggedMeals}</strong><span>bữa đã ghi</span><small>{nutrition.loggedDays}/7 ngày</small></div></div> : <p className="student360-empty">Chưa có dữ liệu dinh dưỡng.</p>}
          </Card>}
        </div>}
      </section>}

      {activeTab === 'contract' && <section className="student360-section">
        <div className="student360-section-heading"><div><small>Hợp đồng</small><h2>Quyền lợi & thanh toán</h2><p>Chi tiết gói tập, công nợ và lịch sử thay đổi.</p></div></div>
        <Suspense fallback={<State><LoaderCircle className="is-spinning" /><h3>Đang mở trung tâm nghiệp vụ hợp đồng…</h3></State>}>
          <Student360ContractWorkspace studentId={studentId} overview={overview} source={source} isDemo={isDemo} onNavigate={onNavigate} onChanged={() => loadOverview(false)} onNotice={setNotice} />
        </Suspense>
      </section>}

      {activeTab === 'more' && <section className="student360-section">
        <div className="student360-section-heading"><div><small>Lịch tập</small><h2>Tuần hiện tại</h2><p>Lịch đã xếp, mức độ tham gia và lịch rảnh đang áp dụng.</p></div>{permissions.canManageContract && <button type="button" onClick={() => onNavigate(source.startsWith('staff') ? 'staff-schedule' : 'admin-pt-schedule', studentId, identity.name)}>Mở ma trận xếp lịch</button>}</div>
        {!permissions.canViewOperations ? <State type="error"><ShieldCheck /><h3>Lịch vận hành được giới hạn</h3><p>Vai trò hiện tại không có quyền xem lịch chi tiết.</p></State> : <div className="student360-schedule-grid">
          <Card title="Các buổi trong tuần" icon={ClipboardCheck} action={<span className="student360-card-count">{schedule.bookedSessions}/{schedule.requiredSessions} buổi</span>}>
            <div className="student360-week-progress"><i style={{ width: `${weeklyPercent}%` }} /></div>
            <div className="student360-session-list">{schedule.sessions.map((session) => <div key={session.id}><time>{safeDate(session.date)} · {session.hour === null ? '--' : String(session.hour).padStart(2, '0')}:00</time><span className={`is-${session.attendanceStatus}`}>{session.attendanceStatus === 'present' ? 'Đã tập' : session.attendanceStatus === 'late' ? 'Đi trễ' : session.attendanceStatus === 'no_show' ? 'Vắng' : 'Đã xếp'}</span></div>)}{schedule.sessions.length === 0 && <p className="student360-empty">Tuần này chưa có lịch tập.</p>}</div>
          </Card>
          <Card title="Lịch rảnh đang áp dụng" icon={CalendarDays}><div className="student360-availability"><div><strong>{availabilityCopy(schedule.availability.source)}</strong><span>{schedule.availability.sourceWeekId ? `Nguồn tuần ${safeDate(schedule.availability.sourceWeekId)}` : 'Chưa xác định tuần nguồn'}</span></div><div>{schedule.availability.slots.map((slot) => <span key={slot}>{slot.replace('-', ' · ')}:00</span>)}{schedule.availability.slots.length === 0 && <span>Chưa có khung giờ</span>}</div><small>{schedule.availability.confirmed ? 'Đã xác nhận' : 'Chưa xác nhận'} · {schedule.availability.slots.length}/{schedule.availability.minimumSlots} khung tối thiểu</small></div></Card>
          <Card title="Tỷ lệ đi tập 28 ngày" icon={Activity} className="student360-schedule-attendance" action={<span className="student360-card-count">{attendance.rate28Days === null ? 'Chưa đủ dữ liệu' : `${attendance.rate28Days}%`}</span>}>
            <div className="student360-attendance-chart student360-attendance-chart--wide">{attendance.weeklyTrend.map((week) => <div key={week.weekStart}><span><i style={{ height: `${Math.max(5, week.rate ?? 0)}%` }} /></span><small>{safeDate(week.weekStart).slice(0, 5)}</small><b>{week.rate === null ? '—' : `${week.rate}%`}</b></div>)}</div>
            <div className="student360-attendance-summary"><span><strong>{attendance.attended}</strong><small>có mặt</small></span><span><strong>{attendance.late}</strong><small>đi trễ</small></span><span><strong>{attendance.noShow}</strong><small>vắng</small></span></div>
          </Card>
        </div>}
      </section>}
    </div>

    <nav className="student360-tabs student360-tabs--mobile" aria-label="Nội dung Học viên 360 trên điện thoại">{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={activeTab === id ? 'active' : ''} aria-current={activeTab === id ? 'page' : undefined} onClick={() => { setActiveTab(id); window.scrollTo({ top: 0, behavior: 'smooth' }) }}><Icon /><span>{label}</span></button>)}</nav>

    {nutritionDetailEvent && <div className="student360-dialog-layer" role="presentation">
      <button type="button" className="student360-dialog-backdrop" aria-label="Đóng chi tiết bữa ăn" onClick={closeNutritionDetail} />
      <section className="student360-dialog student360-nutrition-dialog" role="dialog" aria-modal="true" aria-labelledby="student360-nutrition-title">
        <header><div><small>HOẠT ĐỘNG DINH DƯỠNG</small><h2 id="student360-nutrition-title">Chi tiết bữa ăn</h2></div><button type="button" aria-label="Đóng" onClick={closeNutritionDetail}><X /></button></header>
        {nutritionDetailLoading && <State><LoaderCircle className="is-spinning" /><h3>Đang mở bữa ăn</h3><p>Aura đang tạo quyền xem ảnh riêng tư.</p></State>}
        {nutritionDetailError && <State type="error"><AlertTriangle /><h3>Chưa thể mở bữa ăn</h3><p>{nutritionDetailError}</p><button type="button" onClick={() => void openNutritionDetail(nutritionDetailEvent)}>Thử lại</button></State>}
        {nutritionDetail && <div className="student360-nutrition-detail">
          {nutritionDetail.imageUrl ? <figure><img src={nutritionDetail.imageUrl} alt={`Bữa ăn ${nutritionDetail.title}`} /><figcaption>Ảnh riêng tư · quyền xem có thời hạn</figcaption></figure> : nutritionDetail.hasImage ? <div className="student360-nutrition-image-state"><ImageIcon /><span>Ảnh đã được ghi nhận nhưng chưa thể tải.</span></div> : null}
          <div className="student360-nutrition-detail__heading"><div><span>{nutritionDetail.mealType}{nutritionDetail.date ? ` · ${safeDate(nutritionDetail.date)}` : ''}{nutritionDetail.time ? ` · ${nutritionDetail.time}` : ''}</span><h3>{nutritionDetail.title}</h3>{nutritionDetail.description && <p>{nutritionDetail.description}</p>}</div>{nutritionDetail.review && <b className={`is-${nutritionDetail.review.status}`}>{nutritionStatusCopy(nutritionDetail.review.status)}</b>}</div>
          <div className="student360-nutrition-macros"><span><b>{nutritionDetail.calories}</b>kcal</span><span><b>{nutritionDetail.protein}g</b>protein</span><span><b>{nutritionDetail.carbs}g</b>carb</span><span><b>{nutritionDetail.fat}g</b>chất béo</span></div>
          {(confidenceLabel(nutritionDetail.confidence) || nutritionDetail.source) && <div className="student360-nutrition-evidence"><ShieldCheck /> <span>{confidenceLabel(nutritionDetail.confidence) || 'Nhật ký học viên'}{nutritionDetail.source ? ` · ${nutritionDetail.source === 'ai-scan' ? 'AI phân tích ảnh' : nutritionDetail.source}` : ''}</span></div>}
          {nutritionDetail.items.length > 0 && <section className="student360-nutrition-detail__section"><h4>Thành phần</h4><div className="student360-nutrition-items">{nutritionDetail.items.map((item, index) => <div key={`${item.name}-${index}`}><span><b>{item.name}</b>{item.weight > 0 && <small>{item.weight}g</small>}</span><strong>{item.calories > 0 ? `${item.calories} kcal` : '—'}</strong></div>)}</div></section>}
          {Object.values(nutritionDetail.analysis).some(Boolean) && <section className="student360-nutrition-detail__section"><h4>Nhận định</h4><div className="student360-nutrition-analysis">{nutritionDetail.analysis.portion && <p><b>Khẩu phần</b><span>{nutritionDetail.analysis.portion}</span></p>}{nutritionDetail.analysis.balance && <p><b>Cân bằng</b><span>{nutritionDetail.analysis.balance}</span></p>}{nutritionDetail.analysis.goal && <p><b>Mục tiêu</b><span>{nutritionDetail.analysis.goal}</span></p>}{nutritionDetail.analysis.suggestion && <p><b>Gợi ý</b><span>{nutritionDetail.analysis.suggestion}</span></p>}</div></section>}
          {nutritionDetail.review?.coachFeedback && <section className="student360-nutrition-feedback"><MessageCircle /><div><b>Nhận xét của Coach</b><p>{nutritionDetail.review.coachFeedback}</p>{nutritionDetail.review.reviewedAt && <small>{safeDate(nutritionDetail.review.reviewedAt, true)}</small>}</div></section>}
        </div>}
        <footer><button type="button" onClick={closeNutritionDetail}>Đóng</button></footer>
      </section>
    </div>}

    {careType && <div className="student360-dialog-layer" role="presentation"><button type="button" className="student360-dialog-backdrop" aria-label="Đóng" onClick={() => setCareType(null)} /><section className="student360-dialog" role="dialog" aria-modal="true" aria-labelledby="student360-care-title"><header><div><small>NHẬT KÝ CHĂM SÓC</small><h2 id="student360-care-title">{careType === 'call' ? 'Ghi nhận cuộc gọi' : careType === 'zalo' ? 'Ghi nhận liên hệ Zalo' : careType === 'action_completed' ? 'Hoàn tất việc cần làm' : 'Thêm ghi chú'}</h2></div><button type="button" aria-label="Đóng" onClick={() => setCareType(null)}><X /></button></header><p>{identity.name} · {identity.phone || 'Chưa có số điện thoại'}</p><label>Ghi chú<textarea rows={4} maxLength={1000} value={careNote} onChange={(event) => setCareNote(event.target.value)} placeholder="Nội dung trao đổi, kết quả hoặc việc cần theo dõi tiếp…" /></label><footer><button type="button" onClick={() => setCareType(null)}>Hủy</button><button type="button" disabled={careSaving || (careType === 'note' && careNote.trim().length < 2)} onClick={() => void saveCare()}>{careSaving ? 'Đang lưu…' : 'Lưu vào lịch sử'}</button></footer></section></div>}

    {notice && <div className="student360-toast" role="status">{notice}</div>}
  </main>
}
