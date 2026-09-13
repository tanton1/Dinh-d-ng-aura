import React from 'react'
import { lazyWithRetry } from '../../components/ChunkErrorBoundary'
import { MEAL_TYPE_LABELS, formatNumber, clampPercent } from '../../features/nutrition/presentation'
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
import MealImage from '../../components/nutrition/MealImage'

export type NutritionWorkspaceSection = 'today' | 'diary' | 'classic-diary' | 'plan' | 'menu' | 'explore' | 'catalog' | 'insights'
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
  imageStoragePath?: string
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
  reviewStatus?: 'pending' | 'approved' | 'rejected'
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
  carbs?: number
  fat?: number
  prepMinutes?: number
  image?: string
  rationale?: string
  source?: string
  servingMultiplier?: number
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
          const active = activeSection === id || (id === 'explore' && (activeSection === 'classic-diary' || activeSection === 'menu' || activeSection === 'catalog' || activeSection === 'insights'))
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

export const NutritionDiaryPage = lazyWithRetry(() => import('./NutritionDiarySections').then((module) => ({ default: module.NutritionDiaryPage })))
export const NutritionClassicDiaryPage = lazyWithRetry(() => import('./NutritionDiarySections').then((module) => ({ default: module.NutritionClassicDiaryPage })))

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

export interface NutritionMenuPageProps {
  days: NutritionPlanDay[]
  selectedDayId: string
  meals: NutritionPlannedMeal[]
  dailyCalorieGoal: number
  sourceTitle?: string
  weekLabel?: string
  errorMessage?: string
  isLoading?: boolean
  onSelectDay: (dayId: string) => void
  onOpenMeal?: (mealId: string) => void
  onOpenPlan: () => void
  onReload?: () => void
  onShiftWeek?: (direction: -1 | 1) => void
}

export function NutritionMenuPage({ days, selectedDayId, meals, dailyCalorieGoal, sourceTitle, weekLabel, errorMessage, isLoading = false, onSelectDay, onOpenMeal, onOpenPlan, onReload, onShiftWeek }: NutritionMenuPageProps) {
  const dayMeals = meals.filter((meal) => meal.dayId === selectedDayId).sort((left, right) => left.time.localeCompare(right.time))
  const dayCalories = dayMeals.reduce((sum, meal) => sum + meal.calories, 0)
  const dayProtein = dayMeals.reduce((sum, meal) => sum + meal.protein, 0)
  const selectedDay = days.find((day) => day.id === selectedDayId)
  return (
    <section className="nutrition-workspace-page nutrition-plan nutrition-menu" id="nutrition-workspace-panel-menu" aria-label="Thực đơn đã xác nhận">
      <header className="nutrition-workspace-page__header"><div><span className="nutrition-workspace-eyebrow">THỰC ĐƠN ĐANG DÙNG</span><h1>Thực đơn đã xác nhận</h1><p>Bản thực đơn ổn định để bạn theo dõi trong tuần, không thay đổi khi đang chỉnh kế hoạch nháp.</p>{sourceTitle && <div className="nutrition-plan-state"><span className="nutrition-plan-state--active">Đã xác nhận</span><small>{sourceTitle}</small></div>}</div><div className="nutrition-workspace-page__header-actions"><button type="button" className="nutrition-workspace-button nutrition-workspace-button--primary" onClick={onOpenPlan}><ShoppingBasket size={17} /> Mở kế hoạch</button></div></header>
      {errorMessage && <div className="nutrition-plan-error" role="alert"><CircleAlert size={18} /><span>{errorMessage}</span>{onReload && <button type="button" onClick={onReload}>Tải lại</button>}</div>}
      <div className="nutrition-plan-weekbar">{onShiftWeek && <button type="button" onClick={() => onShiftWeek(-1)} aria-label="Tuần trước"><ChevronLeft size={19} /></button>}<strong>{weekLabel ?? 'Tuần đang chọn'}</strong>{onShiftWeek && <button type="button" onClick={() => onShiftWeek(1)} aria-label="Tuần sau"><ChevronRight size={19} /></button>}</div>
      <div className="nutrition-plan-week" role="tablist" aria-label="Chọn ngày trong thực đơn" aria-busy={isLoading}>{days.map((day) => <button type="button" key={day.id} className={day.id === selectedDayId ? 'is-active' : ''} onClick={() => onSelectDay(day.id)} role="tab" aria-selected={day.id === selectedDayId}><span>{day.isToday ? 'Hôm nay' : day.weekday}</span><strong>{day.date}</strong>{day.label && <small>{day.label}</small>}</button>)}</div>
      {meals.length || isLoading ? <><div className={`nutrition-plan-summary ${isLoading ? 'is-loading' : ''}`.trim()}><div><span><Target size={18} /></span><div><small>{selectedDay?.label ?? selectedDay?.weekday ?? 'Ngày đã chọn'}</small><strong>{formatNumber(dayCalories)} / {formatNumber(dailyCalorieGoal)} kcal</strong></div></div><div><small>Tổng đạm</small><strong>{formatNumber(dayProtein)}g</strong></div><div><small>Số bữa</small><strong>{dayMeals.length}</strong></div><div className="nutrition-plan-summary__track"><span style={{ width: `${clampPercent(dayCalories, dailyCalorieGoal)}%` }} /></div></div><div className="nutrition-plan-schedule nutrition-menu__schedule">{isLoading ? <div className="nutrition-plan-loading" role="status"><RefreshCw className="is-spinning" size={20} /><span>Đang tải thực đơn…</span></div> : dayMeals.length ? <ol>{dayMeals.map((meal) => <li key={meal.id}><time>{meal.time}</time><span className="nutrition-plan-meal__line" aria-hidden="true" /><article><div className="nutrition-plan-meal__visual">{meal.image ? <img src={meal.image} alt="" /> : <span><Utensils size={22} /></span>}</div><div className="nutrition-plan-meal__content"><span>{meal.label || MEAL_TYPE_LABELS[meal.type]}</span><button type="button" onClick={() => onOpenMeal?.(meal.id)} disabled={!onOpenMeal}>{meal.title}</button><p>{meal.description ?? `${meal.calories} kcal · ${meal.protein}g đạm`}</p></div></article></li>)}</ol> : <div className="nutrition-workspace-empty"><span><CalendarDays size={23} /></span><h3>Ngày này chưa có món</h3><p>Chọn ngày khác để xem thực đơn đã xác nhận.</p></div>}</div></> : <div className="nutrition-menu-empty"><span><ShoppingBasket size={25} /></span><h2>Tuần này chưa có thực đơn được xác nhận</h2><p>Mở Kế hoạch tuần, tạo hoặc điều chỉnh các món rồi bấm “Xác nhận tuần”.</p><button type="button" onClick={onOpenPlan}><Sparkles size={17} /> Tạo kế hoạch tuần</button></div>}
    </section>
  )
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
  menu?: NutritionMenuPageProps
  legacyPlanContent?: ReactNode
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
  menu,
  legacyPlanContent,
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
      <React.Suspense fallback={<div role="status" aria-live="polite">Đang tải nội dung dinh dưỡng…</div>}>
      <div className="nutrition-workspace__content">
        {assistantIsPage && assistant ? <AskAuraPanel {...assistant} /> : <>
          {activeSection === 'today' && <div id="nutrition-workspace-panel-today">{todayContent}</div>}
          {activeSection === 'diary' && <NutritionDiaryPage {...diary} />}
          {activeSection === 'classic-diary' && <NutritionClassicDiaryPage {...diary} />}
          {activeSection === 'plan' && (legacyPlanContent ?? <NutritionPlanPage {...plan} />)}
          {activeSection === 'menu' && menu && <NutritionMenuPage {...menu} />}
          {v4 && activeSection === 'explore' && <section className="nutrition-explore" aria-labelledby="nutrition-explore-title"><header><small>KHÁM PHÁ DINH DƯỠNG</small><h2 id="nutrition-explore-title">Tìm món và hiểu tiến độ</h2><p>Các công cụ tham khảo được gom tại đây để phần Hôm nay luôn tập trung vào việc cần làm.</p></header><div><button type="button" onClick={onOpenCatalog}><span><Database size={21} /></span><strong>Thư viện món ăn</strong><small>Tìm món theo khẩu phần và macro</small><ChevronRight size={18} /></button><button type="button" onClick={onOpenSaved ?? onOpenCatalog}><span><Salad size={21} /></span><strong>Món đã lưu</strong><small>Mở nhanh món bạn dùng thường xuyên</small><ChevronRight size={18} /></button><button type="button" onClick={() => { window.location.hash = '#/progress' }}><span><BarChart3 size={21} /></span><strong>Tiến độ</strong><small>Mở hành trình cơ thể và thói quen</small><ChevronRight size={18} /></button>{onOpenEatClean && <button type="button" onClick={onOpenEatClean}><span><ShoppingBasket size={21} /></span><strong>Eat Clean</strong><small>Chọn món phù hợp mục tiêu hôm nay</small><ChevronRight size={18} /></button>}</div></section>}
          {activeSection === 'insights' && <section className="nutrition-explore" aria-labelledby="nutrition-progress-link-title"><header><h2 id="nutrition-progress-link-title">Tiến độ đã có trang riêng</h2><p>Ảnh, số đo, xu hướng và Aura Club được gom trong một hành trình thống nhất.</p></header><div><button type="button" onClick={() => { window.location.hash = '#/progress' }}><span><BarChart3 size={21} /></span><strong>Mở trang Tiến độ</strong><small>Không tải lại dữ liệu dinh dưỡng trùng lặp</small><ChevronRight size={18} /></button></div></section>}
        </>}
      </div>
      </React.Suspense>
      {assistant && !assistantIsPage && <AskAuraPanel {...assistant} />}
    </div>
  )
}
