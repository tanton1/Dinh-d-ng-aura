import React from 'react'
import {
  Activity,
  BarChart3,
  CalendarDays,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Database,
  Droplets,
  Dumbbell,
  ImagePlus,
  MessageCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Salad,
  Send,
  ShoppingBasket,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Utensils,
  WandSparkles,
  X,
} from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import '../../styles-nutrition-workspace.css'

const ProgressPage = React.lazy(() => import('./ProgressPage'))

export type NutritionWorkspaceSection = 'today' | 'diary' | 'plan' | 'explore' | 'catalog' | 'insights'
export type NutritionMealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'
export type NutritionDataConfidence = 'verified' | 'estimated' | 'needs-review'
export type NutritionActivityIntensity = 'low' | 'moderate' | 'high'

export interface NutritionDailyTargets {
  calories: number
  protein: number
  carbs: number
  fat: number
  waterMl: number
}

export interface NutritionMealEntry {
  id: string
  time: string
  type: NutritionMealType
  label: string
  title: string
  description?: string
  calories: number
  protein: number
  carbs: number
  fat: number
  image?: string
  confidence?: NutritionDataConfidence
  sourceLabel?: string
  reviewStatus?: 'pending' | 'reviewed'
  cookingNote?: string
  portionNote?: string
  coachFeedback?: string
}

export interface NutritionActivityEntry {
  id: string
  time: string
  title: string
  durationMinutes: number
  intensity: NutritionActivityIntensity
  estimatedCalories: number
}

export interface NutritionWaterEntry {
  id: string
  time: string
  amountMl: number
}

export interface NutritionPlanDay {
  id: string
  weekday: string
  date: number
  label?: string
  isToday?: boolean
}

export interface NutritionPlannedMeal {
  id: string
  catalogId?: string
  dayId: string
  time: string
  type: NutritionMealType
  label: string
  title: string
  description?: string
  calories: number
  protein: number
  prepMinutes?: number
  image?: string
  rationale?: string
  source?: string
}

export interface AuraAssistantMessage {
  id: string
  role: 'assistant' | 'user'
  content: string
  evidence?: string[]
  confidenceLabel?: string
  imagePreviewUrl?: string
  imageKind?: AuraAssistantImageKind
}

export type AuraAssistantImageKind = 'body' | 'meal'

export interface AuraAssistantImageAttachment {
  file: File
  kind: AuraAssistantImageKind
}

export interface AuraContextItem {
  id: string
  label: string
  value: string
}

export interface NutritionSectionNavProps {
  activeSection: NutritionWorkspaceSection
  onSectionChange: (section: NutritionWorkspaceSection) => void
  onScan: () => void
  onOpenCatalog?: () => void
  onOpenAskAura: () => void
  className?: string
  v4?: boolean
}

const LEGACY_SECTION_ITEMS: Array<{
  id: NutritionWorkspaceSection
  label: string
  icon: typeof Salad
}> = [
  { id: 'today', label: 'Hôm nay', icon: Salad },
  { id: 'diary', label: 'Nhật ký', icon: CalendarDays },
  { id: 'plan', label: 'Thực đơn', icon: ShoppingBasket },
  { id: 'catalog', label: 'Món ăn', icon: Database },
  { id: 'insights', label: 'Tiến độ', icon: BarChart3 },
]

const V4_SECTION_ITEMS: Array<{
  id: NutritionWorkspaceSection
  label: string
  icon: typeof Salad
}> = [
  { id: 'today', label: 'Hôm nay', icon: Salad },
  { id: 'diary', label: 'Nhật ký', icon: CalendarDays },
  { id: 'plan', label: 'Kế hoạch', icon: ShoppingBasket },
  { id: 'explore', label: 'Khám phá', icon: Database },
]

const MEAL_TYPE_LABELS: Record<NutritionMealType, string> = {
  breakfast: 'Bữa sáng',
  lunch: 'Bữa trưa',
  dinner: 'Bữa tối',
  snack: 'Bữa phụ',
}

const INTENSITY_LABELS: Record<NutritionActivityIntensity, string> = {
  low: 'Nhẹ',
  moderate: 'Vừa',
  high: 'Cao',
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value)
}

function clampPercent(value: number, goal: number) {
  return Math.min(100, Math.max(0, Math.round((value / Math.max(goal, 1)) * 100)))
}

function confidenceCopy(confidence: NutritionDataConfidence | undefined) {
  if (confidence === 'estimated') return 'AI ước tính'
  if (confidence === 'needs-review') return 'Cần xác nhận'
  return 'Đã kiểm chứng'
}

export function NutritionSectionNav({
  activeSection,
  onSectionChange,
  onOpenCatalog,
  className = '',
  v4 = false,
}: Omit<NutritionSectionNavProps, 'onScan' | 'onOpenAskAura'> & { onScan?: () => void; onOpenAskAura?: () => void }) {
  const sectionItems = v4 ? V4_SECTION_ITEMS : LEGACY_SECTION_ITEMS
  return (
    <nav className={`nutrition-workspace-nav ${v4 ? 'nutrition-workspace-nav--v4' : ''} ${className}`.trim()} aria-label="Điều hướng dinh dưỡng">
      <div className="nutrition-workspace-nav__sections" aria-label="Khu vực dinh dưỡng">
        {sectionItems.filter(({ id }) => id !== 'catalog' || Boolean(onOpenCatalog)).map(({ id, label, icon: Icon }) => {
          const active = activeSection === id || (id === 'explore' && (activeSection === 'catalog' || activeSection === 'insights'))
          return (
            <button
              type="button"
              key={id}
              className={active ? 'is-active' : ''}
              onClick={() => {
                if (!v4 && id === 'catalog') onOpenCatalog?.()
                else onSectionChange(id)
              }}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

export interface NutritionDiaryDaySummary {
  date: string
  mealCount: number
  calories: number
  protein: number
  waterMl: number
  activityCount: number
  reviewCount: number
}

export interface NutritionDiaryPageProps {
  dateKey: string
  dateLabel: string
  todayKey: string
  historyFromDate: string
  daySummaries: NutritionDiaryDaySummary[]
  targets: NutritionDailyTargets
  meals: NutritionMealEntry[]
  activities: NutritionActivityEntry[]
  waterEntries?: NutritionWaterEntry[]
  waterMl: number
  onSelectDate: (dateKey: string) => void
  onGoToday: () => void
  onAddMeal: () => void
  onAddWater: () => void
  onAddExercise: () => void
  onOpenMeal?: (mealId: string) => void
  onEditMeal?: (mealId: string) => void
  onDeleteMeal?: (mealId: string) => void
  onDeleteActivity?: (activityId: string) => void
  onDeleteWater?: (waterId: string) => void
}

type DiaryTimelineEntry =
  | { kind: 'meal'; id: string; time: string; item: NutritionMealEntry }
  | { kind: 'activity'; id: string; time: string; item: NutritionActivityEntry }
  | { kind: 'water'; id: string; time: string; item: NutritionWaterEntry }

type DiaryFilter = 'all' | 'meal' | 'water' | 'activity' | 'review'
type DiaryView = 'day' | 'week' | 'month'

const DIARY_FILTERS: Array<{ id: DiaryFilter; label: string }> = [
  { id: 'all', label: 'Tất cả' },
  { id: 'meal', label: 'Bữa ăn' },
  { id: 'water', label: 'Nước' },
  { id: 'activity', label: 'Vận động' },
  { id: 'review', label: 'Cần kiểm tra' },
]

const DIARY_VIEWS: Array<{ id: DiaryView; label: string }> = [
  { id: 'day', label: 'Ngày' },
  { id: 'week', label: 'Tuần' },
  { id: 'month', label: 'Tháng' },
]

function parseDiaryDate(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, Math.max(0, month - 1), day || 1, 12, 0, 0, 0)
}

function diaryDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function shiftDiaryDate(dateKey: string, amount: number, unit: DiaryView) {
  const date = parseDiaryDate(dateKey)
  if (unit === 'day') date.setDate(date.getDate() + amount)
  if (unit === 'week') date.setDate(date.getDate() + amount * 7)
  if (unit === 'month') {
    const currentDay = date.getDate()
    date.setDate(1)
    date.setMonth(date.getMonth() + amount)
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
    date.setDate(Math.min(currentDay, lastDay))
  }
  return diaryDateKey(date)
}

function diaryWeekKeys(dateKey: string) {
  const date = parseDiaryDate(dateKey)
  const weekday = date.getDay()
  date.setDate(date.getDate() - (weekday === 0 ? 6 : weekday - 1))
  return Array.from({ length: 7 }, (_, index) => {
    const item = new Date(date)
    item.setDate(date.getDate() + index)
    return diaryDateKey(item)
  })
}

function diaryMonthKeys(dateKey: string) {
  const date = parseDiaryDate(dateKey)
  const total = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  return Array.from({ length: total }, (_, index) => diaryDateKey(new Date(date.getFullYear(), date.getMonth(), index + 1, 12)))
}

function diaryPeriodKeys(dateKey: string, view: DiaryView) {
  if (view === 'week') return diaryWeekKeys(dateKey)
  if (view === 'month') return diaryMonthKeys(dateKey)
  return [dateKey]
}

function shortDiaryDate(dateKey: string, includeWeekday = false) {
  return new Intl.DateTimeFormat('vi-VN', includeWeekday
    ? { weekday: 'short', day: '2-digit', month: '2-digit' }
    : { day: '2-digit', month: '2-digit' }).format(parseDiaryDate(dateKey))
}

export function NutritionDiaryPage({
  dateKey,
  dateLabel,
  todayKey,
  historyFromDate,
  daySummaries,
  targets,
  meals,
  activities,
  waterEntries = [],
  waterMl,
  onSelectDate,
  onGoToday,
  onAddMeal,
  onAddWater,
  onAddExercise,
  onOpenMeal,
  onEditMeal,
  onDeleteMeal,
  onDeleteActivity,
  onDeleteWater,
}: NutritionDiaryPageProps) {
  const [activeFilter, setActiveFilter] = useState<DiaryFilter>('all')
  const [activeView, setActiveView] = useState<DiaryView>('day')
  const totals = useMemo(() => meals.reduce((result, meal) => ({
    calories: result.calories + meal.calories,
    protein: result.protein + meal.protein,
    carbs: result.carbs + meal.carbs,
    fat: result.fat + meal.fat,
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 }), [meals])

  const timeline = useMemo<DiaryTimelineEntry[]>(() => [
    ...meals.map((item) => ({ kind: 'meal' as const, id: `meal-${item.id}`, time: item.time, item })),
    ...activities.map((item) => ({ kind: 'activity' as const, id: `activity-${item.id}`, time: item.time, item })),
    ...waterEntries.map((item) => ({ kind: 'water' as const, id: `water-${item.id}`, time: item.time, item })),
  ].sort((left, right) => left.time.localeCompare(right.time)), [activities, meals, waterEntries])

  const filteredTimeline = useMemo(() => timeline.filter((event) => {
    if (activeFilter === 'all') return true
    if (activeFilter === 'review') return event.kind === 'meal' && (event.item.reviewStatus === 'pending' || event.item.confidence !== 'verified')
    return event.kind === activeFilter
  }), [activeFilter, timeline])
  const needsReviewCount = useMemo(() => meals.filter((meal) => meal.reviewStatus === 'pending' || meal.confidence !== 'verified').length, [meals])
  const summaryByDate = useMemo(() => new Map(daySummaries.map((item) => [item.date, item])), [daySummaries])
  const visibleDateKeys = diaryPeriodKeys(dateKey, activeView)
  const periodSummary = visibleDateKeys.reduce((result, item) => {
    const summary = summaryByDate.get(item)
    if (!summary) return result
    result.mealCount += summary.mealCount
    result.calories += summary.calories
    result.protein += summary.protein
    result.waterMl += summary.waterMl
    result.activityCount += summary.activityCount
    result.reviewCount += summary.reviewCount
    result.loggedDays += summary.mealCount || summary.waterMl || summary.activityCount ? 1 : 0
    return result
  }, { mealCount: 0, calories: 0, protein: 0, waterMl: 0, activityCount: 0, reviewCount: 0, loggedDays: 0 })
  const shiftedBack = shiftDiaryDate(dateKey, -1, activeView)
  const shiftedForward = shiftDiaryDate(dateKey, 1, activeView)
  const eligibleDates = (anchorDateKey: string) => diaryPeriodKeys(anchorDateKey, activeView)
    .filter((item) => item >= historyFromDate && item <= todayKey)
  const canShiftBack = eligibleDates(shiftedBack).length > 0
  const canShiftForward = eligibleDates(shiftedForward).length > 0
  const periodLabel = activeView === 'day'
    ? dateLabel
    : activeView === 'week'
      ? `${shortDiaryDate(visibleDateKeys[0])} – ${shortDiaryDate(visibleDateKeys[visibleDateKeys.length - 1])}`
      : new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric' }).format(parseDiaryDate(dateKey))

  const chooseDate = (nextDateKey: string) => {
    if (nextDateKey < historyFromDate || nextDateKey > todayKey) return
    onSelectDate(nextDateKey)
  }

  const shiftPeriod = (direction: -1 | 1) => {
    const next = direction < 0 ? shiftedBack : shiftedForward
    if ((direction < 0 && !canShiftBack) || (direction > 0 && !canShiftForward)) return
    const eligible = eligibleDates(next)
    const boundedNext = next < historyFromDate ? eligible[0] : next > todayKey ? eligible[eligible.length - 1] : next
    chooseDate(boundedNext)
  }

  const openDay = (nextDateKey: string) => {
    chooseDate(nextDateKey)
    setActiveView('day')
  }

  return (
    <section className="nutrition-workspace-page nutrition-diary" id="nutrition-workspace-panel-diary" aria-label="Nhật ký dinh dưỡng">
      <header className="nutrition-diary-header">
        <div className="nutrition-diary-header__copy">
          <span className="nutrition-workspace-eyebrow">NHẬT KÝ DINH DƯỠNG</span>
          <h1>Tra cứu những gì bạn đã ghi</h1>
          <p>Bữa ăn, nước và vận động được lưu theo thời gian để dễ kiểm tra và chỉnh sửa.</p>
        </div>
        <button type="button" className="nutrition-diary-add" onClick={onAddMeal}><Plus size={18} /> Thêm bản ghi</button>
      </header>

      <section className="nutrition-diary-toolbar" aria-label="Thời gian nhật ký">
        <div className="nutrition-diary-view-switch" role="tablist" aria-label="Chế độ xem nhật ký">
          {DIARY_VIEWS.map((view) => <button type="button" role="tab" aria-selected={activeView === view.id} className={activeView === view.id ? 'is-active' : ''} key={view.id} onClick={() => setActiveView(view.id)}>{view.label}</button>)}
        </div>
        <div className="nutrition-diary-date">
          <button type="button" onClick={() => shiftPeriod(-1)} disabled={!canShiftBack} aria-label={activeView === 'day' ? 'Ngày trước' : activeView === 'week' ? 'Tuần trước' : 'Tháng trước'}><ChevronLeft size={19} /></button>
          <strong>{periodLabel}</strong>
          <button type="button" onClick={() => shiftPeriod(1)} disabled={!canShiftForward} aria-label={activeView === 'day' ? 'Ngày sau' : activeView === 'week' ? 'Tuần sau' : 'Tháng sau'}><ChevronRight size={19} /></button>
        </div>
        <button type="button" className="nutrition-diary-today" onClick={onGoToday} disabled={dateKey === todayKey && activeView === 'day'}><CalendarDays size={17} /> Về hôm nay</button>
      </section>

      <section className="nutrition-diary-summary" aria-label={`Tóm tắt ${periodLabel}`}>
        <div><small>{activeView === 'day' ? 'Bữa ăn' : 'Tổng bữa'}</small><strong>{activeView === 'day' ? meals.length : periodSummary.mealCount}</strong></div>
        <div><small>Năng lượng</small><strong>{formatNumber(activeView === 'day' ? totals.calories : periodSummary.calories)} <em>kcal</em></strong>{activeView === 'day' && <span>/ {formatNumber(targets.calories)} mục tiêu</span>}</div>
        <div><small>Đạm</small><strong>{formatNumber(activeView === 'day' ? totals.protein : periodSummary.protein)}<em>g</em></strong></div>
        <div><small>Nước</small><strong>{formatNumber(activeView === 'day' ? waterMl : periodSummary.waterMl)} <em>ml</em></strong></div>
        <div><small>{activeView === 'day' ? 'Cần kiểm tra' : 'Ngày đã ghi'}</small><strong>{activeView === 'day' ? needsReviewCount : periodSummary.loggedDays}</strong></div>
      </section>

      {activeView === 'week' && (
        <section className="nutrition-diary-period-list" aria-label="Nhật ký theo tuần">
          {visibleDateKeys.map((item) => {
            const summary = summaryByDate.get(item)
            const hasData = Boolean(summary && (summary.mealCount || summary.waterMl || summary.activityCount))
            return <button type="button" key={item} disabled={item > todayKey || item < historyFromDate} className={`${item === dateKey ? 'is-selected' : ''} ${hasData ? 'has-data' : ''}`.trim()} onClick={() => openDay(item)}><span><strong>{shortDiaryDate(item, true)}</strong>{item === todayKey && <small>Hôm nay</small>}</span><span>{summary?.mealCount ?? 0} bữa</span><span>{formatNumber(summary?.calories ?? 0)} kcal</span><span>{formatNumber(summary?.protein ?? 0)}g đạm</span><i aria-hidden="true" /></button>
          })}
        </section>
      )}

      {activeView === 'month' && (
        <section className="nutrition-diary-month" aria-label="Nhật ký theo tháng">
          <div className="nutrition-diary-month__weekdays" aria-hidden="true">{['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((item) => <span key={item}>{item}</span>)}</div>
          <div className="nutrition-diary-month__grid" style={{ '--diary-month-offset': parseDiaryDate(visibleDateKeys[0]).getDay() === 0 ? 7 : parseDiaryDate(visibleDateKeys[0]).getDay() } as React.CSSProperties}>
            {visibleDateKeys.map((item, index) => {
              const summary = summaryByDate.get(item)
              const hasData = Boolean(summary && (summary.mealCount || summary.waterMl || summary.activityCount))
              return <button type="button" key={item} disabled={item > todayKey || item < historyFromDate} className={`${index === 0 ? 'is-first' : ''} ${item === dateKey ? 'is-selected' : ''} ${hasData ? 'has-data' : ''}`.trim()} onClick={() => openDay(item)} aria-label={`${shortDiaryDate(item, true)}${hasData ? `, ${summary?.mealCount ?? 0} bữa` : ', chưa có dữ liệu'}`}><strong>{parseDiaryDate(item).getDate()}</strong><span>{summary?.mealCount ?? 0} bữa</span><i aria-hidden="true" /></button>
            })}
          </div>
          <p>Nhật ký tháng hiển thị dữ liệu trong 90 ngày gần nhất. Chọn một ngày để xem và chỉnh sửa chi tiết.</p>
        </section>
      )}

      {activeView === 'day' && <div className="nutrition-diary-layout">
        <div className="nutrition-diary-timeline">
          <div className="nutrition-workspace-section-heading">
            <div><h2>Dòng thời gian</h2><p>{timeline.length ? `${filteredTimeline.length}/${timeline.length} bản ghi đang hiển thị` : 'Chưa có bản ghi trong ngày này'}</p></div>
          </div>

          <div className="nutrition-diary-filters" aria-label="Lọc nhật ký">
            {DIARY_FILTERS.map((filter) => (
              <button
                type="button"
                key={filter.id}
                className={activeFilter === filter.id ? 'is-active' : ''}
                onClick={() => setActiveFilter(filter.id)}
                aria-pressed={activeFilter === filter.id}
              >
                {filter.label}{filter.id === 'review' && needsReviewCount > 0 ? <span>{needsReviewCount}</span> : null}
              </button>
            ))}
          </div>

          {timeline.length === 0 ? (
            <div className="nutrition-workspace-empty">
              <span><Utensils size={23} /></span>
              <h3>Bắt đầu bằng bữa ăn đầu tiên</h3>
              <p>Chụp ảnh hoặc ghi bữa ăn để theo dõi dinh dưỡng nhất quán hơn.</p>
              <button type="button" onClick={onAddMeal}><Plus size={16} /> Ghi bữa ăn</button>
            </div>
          ) : filteredTimeline.length === 0 ? (
            <div className="nutrition-workspace-empty nutrition-workspace-empty--compact">
              <span><Database size={23} /></span>
              <h3>Không có dữ liệu trong bộ lọc này</h3>
              <p>Chọn “Tất cả” hoặc ghi thêm dữ liệu để tiếp tục theo dõi.</p>
              <button type="button" onClick={() => setActiveFilter('all')}>Xem tất cả</button>
            </div>
          ) : (
            <ol className="nutrition-diary-events">
              {filteredTimeline.map((event) => {
                if (event.kind === 'meal') {
                  const meal = event.item
                  const statusLabel = meal.reviewStatus === 'reviewed' ? 'Đã duyệt' : meal.reviewStatus === 'pending' ? 'Chờ coach' : confidenceCopy(meal.confidence)
                  const statusTone = meal.reviewStatus === 'reviewed' ? 'reviewed' : meal.reviewStatus === 'pending' ? 'pending' : meal.confidence ?? 'verified'
                  return (
                    <li key={event.id} className="nutrition-diary-event nutrition-diary-event--meal">
                      <time>{meal.time}</time>
                      <span className="nutrition-diary-event__node"><Utensils size={16} /></span>
                      <article>
                        <div className="nutrition-diary-event__visual" onClick={() => onOpenMeal?.(meal.id)} style={{ cursor: onOpenMeal ? 'pointer' : 'default' }}>
                          {meal.image ? <img src={meal.image} alt="" /> : <span><Salad size={22} /></span>}
                        </div>
                        <div className="nutrition-diary-event__content">
                          <div className="nutrition-diary-event__meta">
                            <span>{meal.label || MEAL_TYPE_LABELS[meal.type]}</span>
                            <span className={`nutrition-confidence nutrition-confidence--${statusTone}`}>{statusLabel}</span>
                          </div>
                          <button type="button" className="nutrition-diary-event__title" onClick={() => onOpenMeal?.(meal.id)} disabled={!onOpenMeal}>{meal.title}</button>
                          {meal.description && <p>{meal.description}</p>}
                          <div className="nutrition-diary-event__nutrition" onClick={() => onOpenMeal?.(meal.id)} style={{ cursor: onOpenMeal ? 'pointer' : 'default' }}><strong>{formatNumber(meal.calories)} kcal</strong><span>{formatNumber(meal.protein)}g P</span><span>{formatNumber(meal.carbs)}g C</span><span>{formatNumber(meal.fat)}g F</span></div>
                          {(meal.portionNote || meal.cookingNote || meal.sourceLabel) && <div className="nutrition-diary-event__evidence">{meal.portionNote && <span>Khẩu phần: {meal.portionNote}</span>}{meal.cookingNote && <span>Chế biến: {meal.cookingNote}</span>}{meal.sourceLabel && <span>Nguồn: {meal.sourceLabel}</span>}</div>}
                          {meal.coachFeedback && <p className="nutrition-diary-event__coach">Coach: {meal.coachFeedback}</p>}
                        </div>
                        {(onEditMeal || onDeleteMeal) && (
                          <details className="nutrition-diary-event__menu">
                            <summary aria-label={`Thao tác với ${meal.title}`}><MoreHorizontal size={19} /></summary>
                            <div>{onOpenMeal && <button type="button" onClick={() => onOpenMeal(meal.id)}>Xem chi tiết</button>}{onEditMeal && <button type="button" onClick={() => onEditMeal(meal.id)}>Sửa bản ghi</button>}{onDeleteMeal && <button type="button" className="is-danger" onClick={() => onDeleteMeal(meal.id)}><Trash2 size={15} /> Xóa</button>}</div>
                          </details>
                        )}
                      </article>
                    </li>
                  )
                }

                if (event.kind === 'activity') {
                  const activity = event.item
                  return (
                    <li key={event.id} className="nutrition-diary-event nutrition-diary-event--activity">
                      <time>{activity.time}</time>
                      <span className="nutrition-diary-event__node"><Activity size={16} /></span>
                      <article>
                        <span className="nutrition-diary-event__compact-icon"><Dumbbell size={20} /></span>
                        <div className="nutrition-diary-event__content">
                          <div className="nutrition-diary-event__meta"><span>LUYỆN TẬP</span><span>Ước tính riêng</span></div>
                          <strong className="nutrition-diary-event__plain-title">{activity.title}</strong>
                          <p>{activity.durationMinutes} phút · Cường độ {INTENSITY_LABELS[activity.intensity].toLowerCase()} · {formatNumber(activity.estimatedCalories)} kcal</p>
                        </div>
                        {onDeleteActivity && <details className="nutrition-diary-event__menu"><summary aria-label={`Thao tác với ${activity.title}`}><MoreHorizontal size={19} /></summary><div><button type="button" className="is-danger" onClick={() => onDeleteActivity(activity.id)}><Trash2 size={15} /> Xóa</button></div></details>}
                      </article>
                    </li>
                  )
                }

                return (
                  <li key={event.id} className="nutrition-diary-event nutrition-diary-event--water">
                    <time>{event.time}</time>
                    <span className="nutrition-diary-event__node"><Droplets size={16} /></span>
                    <article><span className="nutrition-diary-event__compact-icon"><Droplets size={20} /></span><div className="nutrition-diary-event__content"><div className="nutrition-diary-event__meta"><span>NƯỚC</span></div><strong className="nutrition-diary-event__plain-title">+{formatNumber(event.item.amountMl)} ml</strong></div>{onDeleteWater && <details className="nutrition-diary-event__menu"><summary aria-label="Thao tác với lần ghi nước"><MoreHorizontal size={19} /></summary><div><button type="button" className="is-danger" onClick={() => onDeleteWater(event.item.id)}><Trash2 size={15} /> Xóa</button></div></details>}</article>
                  </li>
                )
              })}
            </ol>
          )}
        </div>

        <aside className="nutrition-diary-quick" aria-label="Thêm bản ghi">
          <h2>Thêm bản ghi</h2>
          <p>Chọn loại dữ liệu cần bổ sung cho {dateLabel.toLocaleLowerCase('vi-VN')}.</p>
          <button type="button" onClick={onAddMeal}><span><Utensils size={18} /></span><div><strong>Bữa ăn</strong><small>Quét ảnh, tìm món hoặc nhập tay</small></div><ChevronRight size={17} /></button>
          <button type="button" onClick={onAddWater}><span><Droplets size={18} /></span><div><strong>Nước</strong><small>Ghi đúng lượng đã uống</small></div><ChevronRight size={17} /></button>
          <button type="button" onClick={onAddExercise}><span><Activity size={18} /></span><div><strong>Vận động</strong><small>Thời lượng và cường độ</small></div><ChevronRight size={17} /></button>
          <div className="nutrition-diary-quick__note"><CircleAlert size={15} /><p>Kcal vận động chỉ dùng để tham khảo, không tự cộng vào ngân sách ăn.</p></div>
        </aside>
      </div>}
    </section>
  )
}

export interface NutritionPlanPageProps {
  days: NutritionPlanDay[]
  selectedDayId: string
  meals: NutritionPlannedMeal[]
  dailyCalorieGoal: number
  strategyTitle?: string
  strategyDescription?: string
  constraints?: string[]
  status?: 'draft' | 'active'
  sourceTitle?: string
  weekLabel?: string
  errorMessage?: string
  isLoading?: boolean
  isGenerating?: boolean
  isSaving?: boolean
  canEdit?: boolean
  onSelectDay: (dayId: string) => void
  onGeneratePlan: () => void
  onAddMeal: (dayId: string) => void
  onReplaceMeal?: (mealId: string) => void
  onRemoveMeal?: (mealId: string) => void
  onOpenMeal?: (mealId: string) => void
  onConfirmPlan?: () => void
  onReload?: () => void
  onShiftWeek?: (direction: -1 | 1) => void
}

export function NutritionPlanPage({
  days,
  selectedDayId,
  meals,
  dailyCalorieGoal,
  strategyTitle = 'Cân bằng năng lượng, ưu tiên đủ đạm',
  strategyDescription = 'Aura phân bổ khẩu phần theo mục tiêu, lịch tập và những món bạn thường chọn.',
  constraints = [],
  status,
  sourceTitle,
  weekLabel,
  errorMessage,
  isLoading = false,
  isGenerating = false,
  isSaving = false,
  canEdit = true,
  onSelectDay,
  onGeneratePlan,
  onAddMeal,
  onReplaceMeal,
  onRemoveMeal,
  onOpenMeal,
  onConfirmPlan,
  onReload,
  onShiftWeek,
}: NutritionPlanPageProps) {
  const dayMeals = meals.filter((meal) => meal.dayId === selectedDayId).sort((left, right) => left.time.localeCompare(right.time))
  const dayCalories = dayMeals.reduce((sum, meal) => sum + meal.calories, 0)
  const dayProtein = dayMeals.reduce((sum, meal) => sum + meal.protein, 0)
  const selectedDay = days.find((day) => day.id === selectedDayId)
  const coveredDayCount = days.filter((day) => meals.some((meal) => meal.dayId === day.id)).length
  const planIsComplete = coveredDayCount === days.length && days.length === 7

  return (
    <section className="nutrition-workspace-page nutrition-plan" id="nutrition-workspace-panel-plan" aria-label="Kế hoạch bữa ăn">
      <header className="nutrition-workspace-page__header">
        <div><span className="nutrition-workspace-eyebrow">THỰC ĐƠN 7 NGÀY</span><h1>Kế hoạch tuần của bạn</h1><p>Chọn món từ thư viện, điều chỉnh rồi xác nhận để dùng trong tuần.</p>{(status || sourceTitle) && <div className="nutrition-plan-state"><span className={`nutrition-plan-state--${status ?? 'active'}`}>{status === 'draft' ? 'Bản nháp' : 'Đã xác nhận'}</span>{sourceTitle && <small>{sourceTitle}</small>}<small>{coveredDayCount}/7 ngày có món</small></div>}</div>
        <div className="nutrition-workspace-page__header-actions">
          {status === 'draft' && onConfirmPlan && <button type="button" className="nutrition-workspace-button nutrition-workspace-button--secondary" onClick={onConfirmPlan} disabled={isSaving || isGenerating || !planIsComplete} title={planIsComplete ? undefined : 'Mỗi ngày cần ít nhất một món'}><Check size={17} /> {isSaving ? 'Đang lưu…' : 'Xác nhận tuần'}</button>}
          <button type="button" className="nutrition-workspace-button nutrition-workspace-button--primary" onClick={onGeneratePlan} disabled={isGenerating || isSaving}>{isGenerating ? <RefreshCw className="is-spinning" size={17} /> : <WandSparkles size={17} />} {isGenerating ? 'Đang tạo...' : meals.length ? 'Tạo lại gợi ý' : 'Tạo với Aura'}</button>
        </div>
      </header>

      {errorMessage && <div className="nutrition-plan-error" role="alert"><CircleAlert size={18} /><span>{errorMessage}</span>{onReload && <button type="button" onClick={onReload}>Tải lại</button>}</div>}

      <div className="nutrition-plan-weekbar">
        {onShiftWeek && <button type="button" onClick={() => onShiftWeek(-1)} aria-label="Tuần trước"><ChevronLeft size={19} /></button>}
        <strong>{weekLabel ?? 'Tuần đang chọn'}</strong>
        {onShiftWeek && <button type="button" onClick={() => onShiftWeek(1)} aria-label="Tuần sau"><ChevronRight size={19} /></button>}
      </div>

      <div className="nutrition-plan-week" role="tablist" aria-label="Chọn ngày trong kế hoạch" aria-busy={isLoading}>
        {days.map((day) => {
          const active = day.id === selectedDayId
          return <button type="button" key={day.id} className={active ? 'is-active' : ''} onClick={() => onSelectDay(day.id)} role="tab" aria-selected={active}><span>{day.isToday ? 'Hôm nay' : day.weekday}</span><strong>{day.date}</strong>{day.label && <small>{day.label}</small>}</button>
        })}
      </div>

      <div className={`nutrition-plan-summary ${isLoading ? 'is-loading' : ''}`.trim()}>
        <div><span><Target size={18} /></span><div><small>{selectedDay?.label ?? selectedDay?.weekday ?? 'Ngày đã chọn'}</small><strong>{formatNumber(dayCalories)} / {formatNumber(dailyCalorieGoal)} kcal</strong></div></div>
        <div><small>Tổng đạm</small><strong>{formatNumber(dayProtein)}g</strong></div>
        <div><small>Số bữa</small><strong>{dayMeals.length}</strong></div>
        <div className="nutrition-plan-summary__track"><span style={{ width: `${clampPercent(dayCalories, dailyCalorieGoal)}%` }} /></div>
      </div>

      <div className="nutrition-plan-layout">
        <div className="nutrition-plan-schedule">
          <div className="nutrition-workspace-section-heading"><div><h2>Lịch bữa ăn</h2><p>{canEdit ? 'Thêm hoặc đổi món trực tiếp từ thư viện Aura.' : 'Tạo bản nháp riêng để điều chỉnh thực đơn được giao.'}</p></div><button type="button" onClick={() => onAddMeal(selectedDayId)} disabled={!canEdit || isSaving || isLoading}><Plus size={16} /> Thêm bữa</button></div>
          {isLoading ? (
            <div className="nutrition-plan-loading" role="status" aria-live="polite"><RefreshCw className="is-spinning" size={20} /><span>Đang tải kế hoạch tuần…</span></div>
          ) : dayMeals.length ? (
            <ol>
              {dayMeals.map((meal) => (
                <li key={meal.id}>
                  <time>{meal.time}</time>
                  <span className="nutrition-plan-meal__line" aria-hidden="true" />
                  <article>
                    <div className="nutrition-plan-meal__visual">{meal.image ? <img src={meal.image} alt="" /> : <span><Utensils size={22} /></span>}</div>
                    <div className="nutrition-plan-meal__content"><span>{meal.label || MEAL_TYPE_LABELS[meal.type]}</span><button type="button" onClick={() => onOpenMeal?.(meal.id)} disabled={!onOpenMeal}>{meal.title}</button><p>{meal.description ?? `${meal.calories} kcal · ${meal.protein}g đạm${meal.prepMinutes ? ` · ${meal.prepMinutes} phút` : ''}`}</p>{meal.rationale && <small><Sparkles size={13} /> {meal.rationale}</small>}</div>
                    {canEdit && (onReplaceMeal || onRemoveMeal) && <div className="nutrition-plan-meal__actions">{onReplaceMeal && <button type="button" className="nutrition-plan-meal__replace" onClick={() => onReplaceMeal(meal.id)} disabled={isSaving}><RefreshCw size={15} /><span>Đổi</span></button>}{onRemoveMeal && <button type="button" className="nutrition-plan-meal__remove" onClick={() => onRemoveMeal(meal.id)} disabled={isSaving} aria-label={`Xóa ${meal.title}`}><Trash2 size={15} /></button>}</div>}
                  </article>
                </li>
              ))}
            </ol>
          ) : (
            <div className="nutrition-workspace-empty"><span><CalendarDays size={23} /></span><h3>Ngày này chưa có thực đơn</h3><p>Tạo gợi ý 7 ngày từ thư viện món Aura, sau đó đổi từng món nếu cần.</p><button type="button" onClick={onGeneratePlan} disabled={isGenerating}><Sparkles size={16} /> Tạo bằng Aura</button></div>
          )}
        </div>

        <aside className="nutrition-plan-strategy">
          <span className="nutrition-plan-strategy__icon"><Sparkles size={20} /></span>
          <span className="nutrition-workspace-eyebrow">CHIẾN LƯỢC CỦA AURA</span>
          <h2>{strategyTitle}</h2>
          <p>{strategyDescription}</p>
          <div className="nutrition-plan-strategy__rule" />
          <strong>Dữ liệu đã sử dụng</strong>
          <ul>
            {(constraints.length ? constraints : ['Mục tiêu và chỉ số cơ thể', 'Lịch tập trong tuần', 'Sở thích và món cần tránh']).map((constraint) => <li key={constraint}><Check size={15} /> {constraint}</li>)}
          </ul>
          <small><CircleAlert size={14} /> {status === 'active' ? 'Đây là thực đơn đang dùng. Mọi lần chỉnh tiếp theo sẽ trở thành bản nháp mới.' : 'Bản nháp chỉ trở thành thực đơn chính sau khi bạn xác nhận.'}</small>
        </aside>
      </div>
    </section>
  )
}

export interface AskAuraPanelProps {
  open: boolean
  variant?: 'sheet' | 'page'
  title?: string
  messages: AuraAssistantMessage[]
  context?: AuraContextItem[]
  suggestions?: string[]
  isLoading?: boolean
  onClose: () => void
  onSubmit: (question: string, attachment?: AuraAssistantImageAttachment) => void
}

export function AskAuraPanel({
  open,
  variant = 'sheet',
  title = 'Hỏi Aura',
  messages,
  context = [],
  suggestions = [],
  isLoading = false,
  onClose,
  onSubmit,
}: AskAuraPanelProps) {
  const [question, setQuestion] = useState('')
  const [pendingImage, setPendingImage] = useState<{
    file: File
    kind: AuraAssistantImageKind
    previewUrl: string
  } | null>(null)
  const [imageMenuOpen, setImageMenuOpen] = useState(false)
  const headingId = useId()
  const inputId = useId()
  const imageInputRef = useRef<HTMLInputElement>(null)
  const imageKindRef = useRef<AuraAssistantImageKind>('meal')

  useEffect(() => () => {
    if (pendingImage) URL.revokeObjectURL(pendingImage.previewUrl)
  }, [pendingImage])

  if (!open) return null

  const submitQuestion = (value: string) => {
    const normalized = value.trim()
    if ((!normalized && !pendingImage) || isLoading) return
    const fallbackQuestion = pendingImage?.kind === 'body'
      ? 'Nhận xét vóc dáng hiện tại và gợi ý hướng cải thiện phù hợp với mình.'
      : 'Phân tích món ăn này và tư vấn theo mục tiêu hiện tại của mình.'
    onSubmit(normalized || fallbackQuestion, pendingImage ? { file: pendingImage.file, kind: pendingImage.kind } : undefined)
    if (pendingImage) URL.revokeObjectURL(pendingImage.previewUrl)
    setPendingImage(null)
    setQuestion('')
  }

  const chooseImage = (kind: AuraAssistantImageKind) => {
    imageKindRef.current = kind
    setImageMenuOpen(false)
    imageInputRef.current?.click()
  }

  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type.toLowerCase()) || file.size <= 0 || file.size > 8 * 1024 * 1024) return
    if (pendingImage) URL.revokeObjectURL(pendingImage.previewUrl)
    setPendingImage({ file, kind: imageKindRef.current, previewUrl: URL.createObjectURL(file) })
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    submitQuestion(question)
  }

  const panel = (
    <aside className={`ask-aura ask-aura--${variant}`} role={variant === 'sheet' ? 'dialog' : 'region'} aria-modal={variant === 'sheet' ? true : undefined} aria-labelledby={headingId}>
      <header className="ask-aura__header">
        <span className="ask-aura__mark"><Sparkles size={20} /></span>
        <div><small>TRỢ LÝ DINH DƯỠNG</small><h2 id={headingId}>{title}</h2></div>
        <button type="button" onClick={onClose} aria-label="Đóng trợ lý Aura"><X size={20} /></button>
      </header>

      {context.length > 0 && (
        <div className="ask-aura__context" aria-label="Ngữ cảnh Aura đang sử dụng">
          <span><Target size={15} /> Đang phân tích</span>
          <div>{context.map((item) => <p key={item.id}><small>{item.label}</small><strong>{item.value}</strong></p>)}</div>
        </div>
      )}

      <div className="ask-aura__messages" aria-live="polite">
        {messages.length ? messages.map((message) => (
          <article key={message.id} className={`ask-aura-message ask-aura-message--${message.role}`}>
            {message.role === 'assistant' && <span><Sparkles size={15} /></span>}
            <div>{message.imagePreviewUrl && <figure className="ask-aura-message__image"><img src={message.imagePreviewUrl} alt={message.imageKind === 'body' ? 'Ảnh vóc dáng đã gửi' : 'Ảnh món ăn đã gửi'} /><figcaption>{message.imageKind === 'body' ? <><Camera size={12} /> Vóc dáng</> : <><Utensils size={12} /> Món ăn</>}</figcaption></figure>}<p>{message.content}</p>{message.evidence?.length ? <div className="ask-aura-message__evidence"><strong>Căn cứ</strong>{message.evidence.map((item) => <small key={item}><Check size={12} /> {item}</small>)}</div> : null}{message.confidenceLabel && <em>{message.confidenceLabel}</em>}</div>
          </article>
        )) : (
          <div className="ask-aura__welcome"><span><MessageCircle size={24} /></span><h3>Bạn muốn hiểu điều gì?</h3><p>Aura phân tích hồ sơ và nhật ký đã ghi để đưa ra gợi ý theo ngữ cảnh của bạn.</p></div>
        )}
        {isLoading && <div className="ask-aura__thinking"><Sparkles size={15} /><span>Aura đang đối chiếu dữ liệu</span><i /><i /><i /></div>}
      </div>

      {suggestions.length > 0 && (
        <div className="ask-aura__suggestions" aria-label="Câu hỏi gợi ý">
          {suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => submitQuestion(suggestion)} disabled={isLoading}>{suggestion}</button>)}
        </div>
      )}

      <form className="ask-aura__composer" onSubmit={handleSubmit}>
        <label htmlFor={inputId}>Câu hỏi cho Aura</label>
        {pendingImage && <div className="ask-aura__pending-image"><img src={pendingImage.previewUrl} alt="Ảnh chờ gửi" /><span><strong>{pendingImage.kind === 'body' ? 'Ảnh vóc dáng' : 'Ảnh món ăn'}</strong><small>Ảnh tự xoá sau khi AI phân tích</small></span><button type="button" onClick={() => setPendingImage(null)} aria-label="Bỏ ảnh"><Trash2 size={16} /></button></div>}
        {imageMenuOpen && <div className="ask-aura__image-menu"><button type="button" onClick={() => chooseImage('body')}><Camera size={17} /> Vóc dáng</button><button type="button" onClick={() => chooseImage('meal')}><Utensils size={17} /> Món ăn</button></div>}
        <input ref={imageInputRef} className="ask-aura__file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageChange} tabIndex={-1} aria-hidden="true" />
        <div className="ask-aura__composer-row"><button type="button" className="ask-aura__attach" onClick={() => setImageMenuOpen((current) => !current)} disabled={isLoading} aria-label="Thêm ảnh"><ImagePlus size={18} /></button><input id={inputId} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={pendingImage ? 'Mô tả điều muốn tư vấn (không bắt buộc)' : 'Hỏi Aura hoặc gửi ảnh…'} autoComplete="off" /><button type="submit" disabled={(!question.trim() && !pendingImage) || isLoading} aria-label="Gửi câu hỏi"><Send size={18} /></button></div>
        <small>Ảnh chỉ dùng cho câu trả lời hiện tại và tự xoá; Aura không thay thế tư vấn y khoa.</small>
      </form>
    </aside>
  )

  if (variant === 'page') return panel
  return <div className="ask-aura-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>{panel}</div>
}

export interface NutritionWorkspaceProps {
  activeSection: NutritionWorkspaceSection
  onSectionChange: (section: NutritionWorkspaceSection) => void
  todayContent: ReactNode
  diary: NutritionDiaryPageProps
  plan: NutritionPlanPageProps
  menuContent?: ReactNode
  insights?: any
  assistant?: AskAuraPanelProps
  onScan: () => void
  onOpenCatalog?: () => void
  onOpenSaved?: () => void
  onOpenEatClean?: () => void
  onOpenAskAura: () => void
  className?: string
  weightKg?: number
  targetWeightDeltaKg?: number
  targetTimeframeMonths?: number
  heightCm?: number
  nutritionProfile?: import('../../features/nutrition/types').NutritionProfileDraft | null
  ownerId?: string
  v4?: boolean
}

export default React.memo(NutritionWorkspace)
function NutritionWorkspace({
  activeSection,
  onSectionChange,
  todayContent,
  diary,
  plan,
  menuContent,
  assistant,
  onScan,
  onOpenCatalog,
  onOpenSaved,
  onOpenEatClean,
  onOpenAskAura,
  className = '',
  weightKg,
  targetWeightDeltaKg,
  targetTimeframeMonths,
  heightCm,
  nutritionProfile,
  ownerId,
  v4 = false,
}: NutritionWorkspaceProps) {
  const assistantIsPage = Boolean(assistant?.open && assistant.variant === 'page')
  return (
    <div className={`nutrition-workspace ${className}`.trim()}>
      <NutritionSectionNav activeSection={activeSection} onSectionChange={onSectionChange} onScan={onScan} onOpenCatalog={onOpenCatalog} onOpenAskAura={onOpenAskAura} v4={v4} />
      <div className="nutrition-workspace__content">
        {assistantIsPage && assistant ? <AskAuraPanel {...assistant} /> : <>
          {activeSection === 'today' && <div id="nutrition-workspace-panel-today">{todayContent}</div>}
          {activeSection === 'diary' && <NutritionDiaryPage {...diary} />}
          {activeSection === 'plan' && (menuContent ?? <NutritionPlanPage {...plan} />)}
          {v4 && activeSection === 'explore' && <section className="nutrition-explore" aria-labelledby="nutrition-explore-title"><header><small>KHÁM PHÁ DINH DƯỠNG</small><h2 id="nutrition-explore-title">Tìm món và hiểu tiến độ</h2><p>Các công cụ tham khảo được gom tại đây để phần Hôm nay luôn tập trung vào việc cần làm.</p></header><div><button type="button" onClick={onOpenCatalog}><span><Database size={21} /></span><strong>Thư viện món ăn</strong><small>Tìm món theo khẩu phần và macro</small><ChevronRight size={18} /></button><button type="button" onClick={onOpenSaved ?? onOpenCatalog}><span><Salad size={21} /></span><strong>Món đã lưu</strong><small>Mở nhanh món bạn dùng thường xuyên</small><ChevronRight size={18} /></button><button type="button" onClick={() => onSectionChange('insights')}><span><BarChart3 size={21} /></span><strong>Tiến độ dinh dưỡng</strong><small>Xem xu hướng cân nặng và thói quen</small><ChevronRight size={18} /></button>{onOpenEatClean && <button type="button" onClick={onOpenEatClean}><span><ShoppingBasket size={21} /></span><strong>Eat Clean</strong><small>Chọn món phù hợp mục tiêu hôm nay</small><ChevronRight size={18} /></button>}</div></section>}
          {activeSection === 'insights' && (
            <React.Suspense fallback={<div role="status" aria-live="polite">Đang tải phân tích tiến độ…</div>}>
              <ProgressPage
                ownerId={ownerId}
                onNavigate={(view) => { if (typeof view === 'string') onSectionChange(view as any) }}
                weightKg={weightKg}
                targetWeightDeltaKg={targetWeightDeltaKg}
                targetTimeframeMonths={targetTimeframeMonths}
                heightCm={heightCm}
                nutritionProfile={nutritionProfile}
              />
            </React.Suspense>
          )}
        </>}
      </div>
      {assistant && !assistantIsPage && <AskAuraPanel {...assistant} />}
    </div>
  )
}
