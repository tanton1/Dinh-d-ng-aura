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
  Flame,
  ListPlus,
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
  Wheat,
  X,
} from 'lucide-react'
import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import ProgressPage from './ProgressPage'
import '../../styles-nutrition-workspace.css'

export type NutritionWorkspaceSection = 'today' | 'diary' | 'plan' | 'catalog' | 'insights'
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
}

export interface AuraAssistantMessage {
  id: string
  role: 'assistant' | 'user'
  content: string
  evidence?: string[]
  confidenceLabel?: string
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
  onOpenCatalog: () => void
  onOpenAskAura: () => void
  className?: string
}

const SECTION_ITEMS: Array<{
  id: NutritionWorkspaceSection
  label: string
  icon: typeof Salad
}> = [
  { id: 'today', label: 'Hôm nay', icon: Salad },
  { id: 'diary', label: 'Nhật ký', icon: CalendarDays },
  { id: 'plan', label: 'Kế hoạch', icon: ListPlus },
  { id: 'catalog', label: 'Thư viện', icon: Database },
  { id: 'insights', label: 'Tiến độ', icon: BarChart3 },
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
}: Omit<NutritionSectionNavProps, 'onScan' | 'onOpenAskAura'> & { onScan?: () => void; onOpenAskAura?: () => void }) {
  return (
    <nav className={`nutrition-workspace-nav ${className}`.trim()} aria-label="Điều hướng dinh dưỡng">
      <div className="nutrition-workspace-nav__sections" aria-label="Khu vực dinh dưỡng">
        {SECTION_ITEMS.map(({ id, label, icon: Icon }) => {
          const active = activeSection === id
          return (
            <button
              type="button"
              key={id}
              className={active ? 'is-active' : ''}
              onClick={() => id === 'catalog' ? onOpenCatalog() : onSectionChange(id)}
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

interface NutritionMetricProgressProps {
  label: string
  value: number
  goal: number
  unit: string
  icon: ReactNode
  tone: 'energy' | 'protein' | 'carbs' | 'fat' | 'water'
}

function NutritionMetricProgress({ label, value, goal, unit, icon, tone }: NutritionMetricProgressProps) {
  const percent = clampPercent(value, goal)
  return (
    <div className={`nutrition-diary-metric nutrition-diary-metric--${tone}`}>
      <div className="nutrition-diary-metric__heading">
        <span>{icon}</span>
        <div><small>{label}</small><strong>{formatNumber(value)}<em> / {formatNumber(goal)}{unit}</em></strong></div>
      </div>
      <div className="nutrition-diary-metric__track" role="progressbar" aria-label={`${label}: ${value} trên ${goal}${unit}`} aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(value, goal)}>
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

export interface NutritionDiaryPageProps {
  dateLabel: string
  targets: NutritionDailyTargets
  meals: NutritionMealEntry[]
  activities: NutritionActivityEntry[]
  waterEntries?: NutritionWaterEntry[]
  waterMl: number
  assistantBrief?: string
  onShiftDate?: (direction: -1 | 1) => void
  onAddMeal: () => void
  onAddWater: () => void
  onAddExercise: () => void
  onOpenMeal?: (mealId: string) => void
  onEditMeal?: (mealId: string) => void
  onDeleteMeal?: (mealId: string) => void
  onDeleteActivity?: (activityId: string) => void
}

type DiaryTimelineEntry =
  | { kind: 'meal'; id: string; time: string; item: NutritionMealEntry }
  | { kind: 'activity'; id: string; time: string; item: NutritionActivityEntry }
  | { kind: 'water'; id: string; time: string; item: NutritionWaterEntry }

export function NutritionDiaryPage({
  dateLabel,
  targets,
  meals,
  activities,
  waterEntries = [],
  waterMl,
  assistantBrief,
  onShiftDate,
  onAddMeal,
  onAddWater,
  onAddExercise,
  onOpenMeal,
  onEditMeal,
  onDeleteMeal,
  onDeleteActivity,
}: NutritionDiaryPageProps) {
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

  const caloriesRemaining = targets.calories - totals.calories
  const defaultBrief = meals.length
    ? caloriesRemaining > 0
      ? `Bạn còn khoảng ${formatNumber(caloriesRemaining)} kcal. Aura sẽ ưu tiên món phù hợp với phần macro còn thiếu.`
      : `Bạn đã vượt mục tiêu khoảng ${formatNumber(Math.abs(caloriesRemaining))} kcal. Hãy ưu tiên nước và bữa nhẹ giàu chất xơ.`
    : 'Chưa có bữa ăn nào hôm nay. Hãy ghi bữa đầu tiên để Aura bắt đầu phân tích.'

  return (
    <section className="nutrition-workspace-page nutrition-diary" id="nutrition-workspace-panel-diary" aria-label="Nhật ký dinh dưỡng">
      <header className="nutrition-workspace-page__header">
        <div>
          <span className="nutrition-workspace-eyebrow">NHẬT KÝ NGÀY</span>
          <h1>Mọi lựa chọn trong ngày</h1>
          <p>Bữa ăn, nước và vận động được sắp theo đúng thời gian.</p>
        </div>
        <div className="nutrition-diary-date">
          <button type="button" onClick={() => onShiftDate?.(-1)} disabled={!onShiftDate} aria-label="Ngày trước"><ChevronLeft size={18} /></button>
          <strong>{dateLabel}</strong>
          <button type="button" onClick={() => onShiftDate?.(1)} disabled={!onShiftDate} aria-label="Ngày sau"><ChevronRight size={18} /></button>
        </div>
      </header>

      <div className="nutrition-assistant-brief">
        <span><Sparkles size={18} aria-hidden="true" /></span>
        <div><small>AURA NHẬN XÉT</small><p>{assistantBrief ?? defaultBrief}</p></div>
        <button type="button" onClick={onAddMeal}>Ghi bữa tiếp theo <ChevronRight size={16} /></button>
      </div>

      <div className="nutrition-diary-metrics" aria-label="Tiến độ mục tiêu ngày">
        <NutritionMetricProgress label="Năng lượng" value={totals.calories} goal={targets.calories} unit=" kcal" icon={<Flame size={16} />} tone="energy" />
        <NutritionMetricProgress label="Đạm" value={totals.protein} goal={targets.protein} unit="g" icon={<Dumbbell size={16} />} tone="protein" />
        <NutritionMetricProgress label="Carb" value={totals.carbs} goal={targets.carbs} unit="g" icon={<Wheat size={16} />} tone="carbs" />
        <NutritionMetricProgress label="Chất béo" value={totals.fat} goal={targets.fat} unit="g" icon={<Droplets size={16} />} tone="fat" />
        <NutritionMetricProgress label="Nước" value={waterMl} goal={targets.waterMl} unit="ml" icon={<Droplets size={16} />} tone="water" />
      </div>

      <div className="nutrition-diary-layout">
        <div className="nutrition-diary-timeline">
          <div className="nutrition-workspace-section-heading">
            <div><h2>Dòng thời gian</h2><p>{timeline.length} hoạt động đã ghi</p></div>
            <button type="button" onClick={onAddMeal}><Plus size={16} /> Thêm món</button>
          </div>

          {timeline.length === 0 ? (
            <div className="nutrition-workspace-empty">
              <span><Utensils size={23} /></span>
              <h3>Bắt đầu bằng bữa ăn đầu tiên</h3>
              <p>Chụp ảnh hoặc chọn món từ thư viện để ghi nhanh và chính xác hơn.</p>
              <button type="button" onClick={onAddMeal}><Plus size={16} /> Ghi bữa ăn</button>
            </div>
          ) : (
            <ol className="nutrition-diary-events">
              {timeline.map((event) => {
                if (event.kind === 'meal') {
                  const meal = event.item
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
                            <span className={`nutrition-confidence nutrition-confidence--${meal.confidence ?? 'verified'}`}>{confidenceCopy(meal.confidence)}</span>
                          </div>
                          <button type="button" className="nutrition-diary-event__title" onClick={() => onOpenMeal?.(meal.id)} disabled={!onOpenMeal}>{meal.title}</button>
                          {meal.description && <p>{meal.description}</p>}
                          <div className="nutrition-diary-event__nutrition" onClick={() => onOpenMeal?.(meal.id)} style={{ cursor: onOpenMeal ? 'pointer' : 'default' }}><strong>{formatNumber(meal.calories)} kcal</strong><span>{formatNumber(meal.protein)}g P</span><span>{formatNumber(meal.carbs)}g C</span><span>{formatNumber(meal.fat)}g F</span></div>
                        </div>
                        {(onEditMeal || onDeleteMeal) && (
                          <div className="nutrition-diary-event__actions">
                            {onEditMeal && <button type="button" onClick={() => onEditMeal(meal.id)} aria-label={`Chỉnh ${meal.title}`}><MoreHorizontal size={18} /></button>}
                            {onDeleteMeal && <button type="button" onClick={() => onDeleteMeal(meal.id)} aria-label={`Xóa ${meal.title}`}><Trash2 size={16} /></button>}
                          </div>
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
                        {onDeleteActivity && <button type="button" className="nutrition-diary-event__delete" onClick={() => onDeleteActivity(activity.id)} aria-label={`Xóa ${activity.title}`}><Trash2 size={16} /></button>}
                      </article>
                    </li>
                  )
                }

                return (
                  <li key={event.id} className="nutrition-diary-event nutrition-diary-event--water">
                    <time>{event.time}</time>
                    <span className="nutrition-diary-event__node"><Droplets size={16} /></span>
                    <article><span className="nutrition-diary-event__compact-icon"><Droplets size={20} /></span><div className="nutrition-diary-event__content"><div className="nutrition-diary-event__meta"><span>NƯỚC</span></div><strong className="nutrition-diary-event__plain-title">+{formatNumber(event.item.amountMl)} ml</strong></div></article>
                  </li>
                )
              })}
            </ol>
          )}
        </div>

        <aside className="nutrition-diary-quick" aria-label="Ghi nhanh">
          <span className="nutrition-workspace-eyebrow">GHI NHANH</span>
          <h2>Thêm trong vài giây</h2>
          <p>Mỗi dữ liệu đều có thời gian và có thể chỉnh lại sau.</p>
          <button type="button" onClick={onAddMeal}><span><Utensils size={18} /></span><div><strong>Bữa ăn</strong><small>Ảnh AI hoặc thư viện</small></div><ChevronRight size={17} /></button>
          <button type="button" onClick={onAddWater}><span><Droplets size={18} /></span><div><strong>Nước</strong><small>250, 500 hoặc 750 ml</small></div><ChevronRight size={17} /></button>
          <button type="button" onClick={onAddExercise}><span><Activity size={18} /></span><div><strong>Luyện tập</strong><small>Giờ, thời lượng, cường độ</small></div><ChevronRight size={17} /></button>
          <div className="nutrition-diary-quick__note"><CircleAlert size={15} /><p>Kcal vận động được theo dõi riêng, không tự cộng vào ngân sách ăn.</p></div>
        </aside>
      </div>
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
  isGenerating?: boolean
  onSelectDay: (dayId: string) => void
  onGeneratePlan: () => void
  onAddMeal: (dayId: string) => void
  onReplaceMeal?: (mealId: string) => void
  onOpenMeal?: (mealId: string) => void
  onCreateShoppingList?: () => void
}

export function NutritionPlanPage({
  days,
  selectedDayId,
  meals,
  dailyCalorieGoal,
  strategyTitle = 'Cân bằng năng lượng, ưu tiên đủ đạm',
  strategyDescription = 'Aura phân bổ khẩu phần theo mục tiêu, lịch tập và những món bạn thường chọn.',
  constraints = [],
  isGenerating = false,
  onSelectDay,
  onGeneratePlan,
  onAddMeal,
  onReplaceMeal,
  onOpenMeal,
  onCreateShoppingList,
}: NutritionPlanPageProps) {
  const dayMeals = meals.filter((meal) => meal.dayId === selectedDayId).sort((left, right) => left.time.localeCompare(right.time))
  const dayCalories = dayMeals.reduce((sum, meal) => sum + meal.calories, 0)
  const dayProtein = dayMeals.reduce((sum, meal) => sum + meal.protein, 0)
  const selectedDay = days.find((day) => day.id === selectedDayId)

  return (
    <section className="nutrition-workspace-page nutrition-plan" id="nutrition-workspace-panel-plan" aria-label="Kế hoạch bữa ăn">
      <header className="nutrition-workspace-page__header">
        <div><span className="nutrition-workspace-eyebrow">KẾ HOẠCH 7 NGÀY</span><h1>Ăn đúng mà không phải nghĩ nhiều</h1><p>Aura đề xuất trước, bạn luôn là người quyết định.</p></div>
        <div className="nutrition-workspace-page__header-actions">
          {onCreateShoppingList && <button type="button" className="nutrition-workspace-button nutrition-workspace-button--secondary" onClick={onCreateShoppingList}><ShoppingBasket size={17} /> Danh sách mua</button>}
          <button type="button" className="nutrition-workspace-button nutrition-workspace-button--primary" onClick={onGeneratePlan} disabled={isGenerating}>{isGenerating ? <RefreshCw className="is-spinning" size={17} /> : <WandSparkles size={17} />} {isGenerating ? 'Đang tạo...' : 'Tạo bản nháp với Aura'}</button>
        </div>
      </header>

      <div className="nutrition-plan-week" role="tablist" aria-label="Chọn ngày trong kế hoạch">
        {days.map((day) => {
          const active = day.id === selectedDayId
          return <button type="button" key={day.id} className={active ? 'is-active' : ''} onClick={() => onSelectDay(day.id)} role="tab" aria-selected={active}><span>{day.isToday ? 'Hôm nay' : day.weekday}</span><strong>{day.date}</strong>{day.label && <small>{day.label}</small>}</button>
        })}
      </div>

      <div className="nutrition-plan-summary">
        <div><span><Target size={18} /></span><div><small>{selectedDay?.label ?? selectedDay?.weekday ?? 'Ngày đã chọn'}</small><strong>{formatNumber(dayCalories)} / {formatNumber(dailyCalorieGoal)} kcal</strong></div></div>
        <div><small>Tổng đạm</small><strong>{formatNumber(dayProtein)}g</strong></div>
        <div><small>Số bữa</small><strong>{dayMeals.length}</strong></div>
        <div className="nutrition-plan-summary__track"><span style={{ width: `${clampPercent(dayCalories, dailyCalorieGoal)}%` }} /></div>
      </div>

      <div className="nutrition-plan-layout">
        <div className="nutrition-plan-schedule">
          <div className="nutrition-workspace-section-heading"><div><h2>Lịch bữa ăn</h2><p>Có thể đổi món mà vẫn giữ mục tiêu tương đương.</p></div><button type="button" onClick={() => onAddMeal(selectedDayId)}><Plus size={16} /> Thêm bữa</button></div>
          {dayMeals.length ? (
            <ol>
              {dayMeals.map((meal) => (
                <li key={meal.id}>
                  <time>{meal.time}</time>
                  <span className="nutrition-plan-meal__line" aria-hidden="true" />
                  <article>
                    <div className="nutrition-plan-meal__visual">{meal.image ? <img src={meal.image} alt="" /> : <span><Utensils size={22} /></span>}</div>
                    <div className="nutrition-plan-meal__content"><span>{meal.label || MEAL_TYPE_LABELS[meal.type]}</span><button type="button" onClick={() => onOpenMeal?.(meal.id)} disabled={!onOpenMeal}>{meal.title}</button><p>{meal.description ?? `${meal.calories} kcal · ${meal.protein}g đạm${meal.prepMinutes ? ` · ${meal.prepMinutes} phút` : ''}`}</p>{meal.rationale && <small><Sparkles size={13} /> {meal.rationale}</small>}</div>
                    {onReplaceMeal && <button type="button" className="nutrition-plan-meal__replace" onClick={() => onReplaceMeal(meal.id)}><RefreshCw size={15} /><span>Đổi món</span></button>}
                  </article>
                </li>
              ))}
            </ol>
          ) : (
            <div className="nutrition-workspace-empty"><span><CalendarDays size={23} /></span><h3>Ngày này chưa có kế hoạch</h3><p>Để Aura phân bổ các bữa theo mục tiêu của bạn hoặc tự thêm từng bữa.</p><button type="button" onClick={onGeneratePlan}><Sparkles size={16} /> Tạo bằng Aura</button></div>
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
          <small><CircleAlert size={14} /> Aura không tự thay đổi mục tiêu hoặc lưu kế hoạch khi bạn chưa xác nhận.</small>
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
  onSubmit: (question: string) => void
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
  const headingId = useId()
  const inputId = useId()

  if (!open) return null

  const submitQuestion = (value: string) => {
    const normalized = value.trim()
    if (!normalized || isLoading) return
    onSubmit(normalized)
    setQuestion('')
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
            <div><p>{message.content}</p>{message.evidence?.length ? <div className="ask-aura-message__evidence"><strong>Căn cứ</strong>{message.evidence.map((item) => <small key={item}><Check size={12} /> {item}</small>)}</div> : null}{message.confidenceLabel && <em>{message.confidenceLabel}</em>}</div>
          </article>
        )) : (
          <div className="ask-aura__welcome"><span><MessageCircle size={24} /></span><h3>Bạn muốn hiểu điều gì?</h3><p>Aura phân tích hồ sơ và nhật ký; khi bạn hỏi món ăn, Aura đối chiếu trực tiếp thư viện dinh dưỡng.</p></div>
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
        <div><input id={inputId} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ví dụ: Bữa tối nên ăn gì?" autoComplete="off" /><button type="submit" disabled={!question.trim() || isLoading} aria-label="Gửi câu hỏi"><Send size={18} /></button></div>
        <small>Thông tin chỉ mang tính hỗ trợ, không thay thế tư vấn y khoa.</small>
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
  insights?: any
  assistant?: AskAuraPanelProps
  onScan: () => void
  onOpenCatalog: () => void
  onOpenAskAura: () => void
  className?: string
  weightKg?: number
  targetWeightDeltaKg?: number
  targetTimeframeMonths?: number
  ownerId?: string
}

export default React.memo(NutritionWorkspace)
function NutritionWorkspace({
  activeSection,
  onSectionChange,
  todayContent,
  diary,
  plan,
  assistant,
  onScan,
  onOpenCatalog,
  onOpenAskAura,
  className = '',
  weightKg,
  targetWeightDeltaKg,
  targetTimeframeMonths,
  ownerId,
}: NutritionWorkspaceProps) {
  const assistantIsPage = Boolean(assistant?.open && assistant.variant === 'page')
  return (
    <div className={`nutrition-workspace ${className}`.trim()}>
      <NutritionSectionNav activeSection={activeSection} onSectionChange={onSectionChange} onScan={onScan} onOpenCatalog={onOpenCatalog} onOpenAskAura={onOpenAskAura} />
      <div className="nutrition-workspace__content">
        {assistantIsPage && assistant ? <AskAuraPanel {...assistant} /> : <>
          {activeSection === 'today' && <div id="nutrition-workspace-panel-today">{todayContent}</div>}
          {activeSection === 'diary' && <NutritionDiaryPage {...diary} />}
          {activeSection === 'plan' && <NutritionPlanPage {...plan} />}
          {activeSection === 'insights' && (
            <ProgressPage
              ownerId={ownerId}
              onNavigate={(view) => { if (typeof view === 'string') onSectionChange(view as any) }}
              weightKg={weightKg}
              targetWeightDeltaKg={targetWeightDeltaKg}
              targetTimeframeMonths={targetTimeframeMonths}
            />
          )}
        </>}
      </div>
      {assistant && !assistantIsPage && <AskAuraPanel {...assistant} />}
    </div>
  )
}
