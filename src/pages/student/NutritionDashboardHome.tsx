import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Activity,
  Apple,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Droplets,
  Dumbbell,
  Flame,
  Pencil,
  Plus,
  Salad,
  Search,
  Sparkles,
  Trash2,
  Utensils,
  Wheat,
} from 'lucide-react'

export interface NutritionHomeDay {
  id: string
  day: string
  date: number
  isToday: boolean
  fullDate: Date
}

export interface NutritionHomeMeal {
  id: string
  label: string
  time: string
  title: string
  description: string
  calories: number
  protein: number
  carbs: number
  fat: number
  image?: string
  type: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  source?: 'ai-scan' | 'demo' | 'catalog' | 'manual'
  confidence?: 'verified' | 'estimated' | 'needs-review'
}

export interface NutritionHomeActivity {
  id: string
  startTime: string
  title: string
  durationMinutes: number
  intensity: 'low' | 'moderate' | 'high'
  estimatedCalories: number
}

export interface NutritionHomeMetric {
  label: string
  value: number
  goal: number
  unit: string
  tone: string
  inverse: boolean
  complete: boolean
}

export interface NutritionHomePlanItem {
  time: string
  label: string
  title: string
  calories: number
  protein: number
}

interface NutritionDashboardHomeProps {
  firstName: string
  selectedDate: string
  selectedDateLabel: string
  days: NutritionHomeDay[]
  loggedDateIds: Set<string>
  meals: NutritionHomeMeal[]
  activities: NutritionHomeActivity[]
  activityCalories: number
  activityMinutes: number
  caloriesConsumed: number
  calorieGoal: number
  caloriePercent: number
  proteinConsumed: number
  proteinGoal: number
  carbsConsumed: number
  carbGoal: number
  fatConsumed: number
  fatGoal: number
  qualityMetrics: NutritionHomeMetric[]
  qualityDataComplete: boolean
  water: number
  waterGoal: number
  goalLabel: string
  trainingSessions: number
  dailyPlan: NutritionHomePlanItem[]
  allergies?: string
  onSelectDate: (date: string) => void
  onShiftWeek: (direction: -1 | 1) => void
  onOpenQuickAdd: () => void
  onOpenCatalog: () => void
  onOpenWater: () => void
  onOpenExercise: () => void
  onAskAura: () => void
  onLogWater: (amount: number) => void
  onEditProfile: () => void
  onDeleteMeal: (mealId: string) => void
  onDeleteActivity: (activityId: string) => void
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value)
}

function formatNutrientDisplay(value: number, unit: string) {
  if (unit === 'mg' && Math.abs(value) >= 1000) {
    return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value / 1000)}k`
  }
  return formatNumber(value)
}

function clampPercent(value: number, goal: number) {
  return Math.min(100, Math.max(0, Math.round((value / Math.max(goal, 1)) * 100)))
}

function progressStyle(percent: number) {
  return { '--nutrition-home-progress': `${percent * 3.6}deg` } as CSSProperties
}

interface NutrientProgressProps {
  icon: ReactNode
  label: string
  value: number
  goal: number
  unit: string
  tone: string
  inverse?: boolean
  complete?: boolean
}

function NutrientProgress({ icon, label, value, goal, unit, tone, inverse = false, complete = true }: NutrientProgressProps) {
  const percent = clampPercent(value, goal)
  const remaining = Math.max(0, goal - value)
  const overage = Math.max(0, value - goal)
  const isOver = complete && overage > 0
  const status = !complete
    ? 'Chưa đủ dữ liệu'
    : isOver
      ? `Vượt ${formatNumber(overage)}${unit}`
      : inverse
        ? `Còn ${formatNumber(remaining)}${unit} tới giới hạn`
        : `Còn ${formatNumber(remaining)}${unit}`

  return (
    <div
      className={`nutrition-home-nutrient nutrition-home-nutrient--${tone} ${isOver ? 'is-over' : ''} ${!complete ? 'is-incomplete' : ''}`}
      role="progressbar"
      aria-label={`${label}: ${complete ? `${value} trên ${goal} ${unit}` : 'chưa đủ dữ liệu'}`}
      aria-valuemin={0}
      aria-valuemax={goal}
      aria-valuenow={complete ? Math.min(value, goal) : undefined}
      aria-valuetext={complete ? `${formatNumber(value)} trên ${formatNumber(goal)} ${unit}; ${status}` : 'Chưa đủ dữ liệu'}
    >
      <div className="nutrition-home-nutrient__top">
        <span className="nutrition-home-nutrient__icon">{icon}</span>
        <span className="nutrition-home-nutrient__label">{label}</span>
      </div>
      <div className="nutrition-home-nutrient__value">
        <strong>{complete ? formatNutrientDisplay(value, unit) : '—'}<small>{complete ? unit : ''}</small></strong>
        <div className="nutrition-home-nutrient__ring" style={progressStyle(complete ? percent : 0)} aria-hidden="true"><span>{complete ? `${percent}%` : '—'}</span></div>
      </div>
      <small className="nutrition-home-nutrient__goal">{complete ? `${inverse ? 'Giới hạn' : 'Mục tiêu'} ${formatNumber(goal)}${unit}` : 'Nguồn món chưa có chỉ số này'}</small>
      <span className="nutrition-home-nutrient__status">{status}</span>
    </div>
  )
}

function MealVisual({ meal }: { meal: NutritionHomeMeal }) {
  if (meal.image) return <img src={meal.image} alt="" />
  const Icon = meal.type === 'breakfast' ? Apple : meal.type === 'snack' ? Salad : Utensils
  return <span><Icon size={23} /></span>
}

function MealEvidenceBadge({ meal }: { meal: NutritionHomeMeal }) {
  const evidence = meal.confidence
    ?? (meal.source === 'catalog' ? 'verified' : meal.source === 'ai-scan' ? 'estimated' : 'needs-review')

  if (evidence === 'verified') {
    return <small className="nutrition-home-meal__evidence nutrition-home-meal__evidence--verified" title="Dinh dưỡng được đối chiếu với cơ sở dữ liệu"><Check size={11} /> Đã kiểm chứng</small>
  }

  if (evidence === 'estimated') {
    return <small className="nutrition-home-meal__evidence nutrition-home-meal__evidence--estimated" title="Giá trị do AI ước tính từ ảnh và cần được xem như một khoảng tham khảo"><Sparkles size={11} /> AI ước tính</small>
  }

  return <small className="nutrition-home-meal__evidence nutrition-home-meal__evidence--needs-review" title="Bản ghi chưa có đủ căn cứ dữ liệu"><CircleAlert size={11} /> Cần xác nhận</small>
}

export default function NutritionDashboardHome({
  firstName,
  selectedDate,
  selectedDateLabel,
  days,
  loggedDateIds,
  meals,
  activities,
  activityCalories,
  activityMinutes,
  caloriesConsumed,
  calorieGoal,
  caloriePercent,
  proteinConsumed,
  proteinGoal,
  carbsConsumed,
  carbGoal,
  fatConsumed,
  fatGoal,
  qualityMetrics,
  qualityDataComplete,
  water,
  waterGoal,
  goalLabel,
  trainingSessions,
  dailyPlan,
  allergies,
  onSelectDate,
  onShiftWeek,
  onOpenQuickAdd,
  onOpenCatalog,
  onOpenWater,
  onOpenExercise,
  onAskAura,
  onLogWater,
  onEditProfile,
  onDeleteMeal,
  onDeleteActivity,
}: NutritionDashboardHomeProps) {
  const dateStripRef = useRef<HTMLDivElement>(null)
  const nutrientRailRef = useRef<HTMLDivElement>(null)
  const weekTouchStart = useRef<{ x: number; y: number } | null>(null)
  const [nutrientSlide, setNutrientSlide] = useState(0)
  const calorieDelta = calorieGoal - caloriesConsumed
  const selectedIsToday = days.some((day) => day.id === selectedDate && day.isToday)
  const energyLabel = calorieDelta >= 0
    ? selectedIsToday ? 'Còn lại hôm nay' : 'Còn lại trong ngày'
    : 'Vượt mục tiêu'
  const energyValue = Math.abs(calorieDelta)
  const waterPercent = clampPercent(water, waterGoal)
  const waterRemaining = Math.max(0, waterGoal - water)
  const planMealTypes: NutritionHomeMeal['type'][] = ['breakfast', 'lunch', 'snack', 'dinner']
  const completedMealTypes = new Set(meals.map((meal) => meal.type))
  const nextMealIndex = dailyPlan.findIndex((_, index) => !completedMealTypes.has(planMealTypes[index]))
  const planCompleted = dailyPlan.length > 0 && nextMealIndex === -1
  const nextMeal = nextMealIndex >= 0 ? dailyPlan[nextMealIndex] : undefined
  const proteinRemaining = Math.max(0, proteinGoal - proteinConsumed)
  const insight = !meals.length
    ? 'Chụp bữa ăn đầu tiên để Aura bắt đầu hiểu nhịp dinh dưỡng của bạn.'
    : proteinRemaining > 20
      ? `Bạn còn khoảng ${proteinRemaining}g đạm. Bữa tiếp theo nên ưu tiên một nguồn đạm nạc.`
      : calorieDelta > 0
        ? `Nhịp năng lượng đang ổn. Bạn còn ${formatNumber(calorieDelta)} kcal cho phần còn lại của ngày.`
        : 'Bạn đã chạm mục tiêu năng lượng. Ưu tiên nước và thực phẩm giàu chất xơ ở bữa tiếp theo.'
  const healthCopy = !meals.length
    ? 'Ghi một bữa để Aura bắt đầu phân tích vi chất.'
    : !qualityDataComplete
      ? 'Một số món chưa có đủ vi chất; Aura giữ trạng thái thiếu thay vì suy đoán.'
      : 'Ba chỉ số vi chất đã có đủ dữ liệu để đối chiếu mục tiêu ngày.'
  const timelineEntries = [
    ...meals.map((meal) => ({ kind: 'meal' as const, time: meal.time, item: meal })),
    ...activities.map((activity) => ({ kind: 'activity' as const, time: activity.startTime, item: activity })),
  ].sort((left, right) => right.time.localeCompare(left.time))
  const intensityLabels: Record<NutritionHomeActivity['intensity'], string> = { low: 'Nhẹ', moderate: 'Vừa', high: 'Cao' }
  const nutrientSlides = [
    {
      id: 'macro',
      title: 'Năng lượng chính',
      description: 'Đạm, carb và chất béo theo mục tiêu ngày.',
      items: [
        { label: 'Đạm', value: proteinConsumed, goal: proteinGoal, unit: 'g', tone: 'protein', icon: <Dumbbell size={17} /> },
        { label: 'Carb', value: carbsConsumed, goal: carbGoal, unit: 'g', tone: 'carb', icon: <Wheat size={17} /> },
        { label: 'Chất béo', value: fatConsumed, goal: fatGoal, unit: 'g', tone: 'fat', icon: <Droplets size={17} /> },
      ] satisfies NutrientProgressProps[],
    },
    {
      id: 'balance',
      title: 'Cân bằng bữa ăn',
      description: qualityDataComplete ? 'Đối chiếu chất xơ, đường và natri trong cùng một khung.' : healthCopy,
      items: qualityMetrics.map((metric, index): NutrientProgressProps => ({
        label: metric.label,
        value: metric.value,
        goal: metric.goal,
        unit: metric.unit,
        tone: metric.tone,
        inverse: metric.inverse,
        complete: metric.complete,
        icon: index === 0 ? <Salad size={17} /> : index === 1 ? <Apple size={17} /> : <CircleAlert size={17} />,
      })),
    },
  ]
  const weekRangeLabel = days.length
    ? `${new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: 'short' }).format(days[0].fullDate)} – ${new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: 'short', year: days[0].fullDate.getFullYear() === days.at(-1)?.fullDate.getFullYear() ? undefined : 'numeric' }).format(days.at(-1)?.fullDate ?? days[0].fullDate)}`
    : ''
  const weekIncludesToday = days.some((day) => day.isToday)

  const goToNutrientSlide = (index: number) => {
    const nextIndex = Math.min(nutrientSlides.length - 1, Math.max(0, index))
    setNutrientSlide(nextIndex)
    nutrientRailRef.current?.children.item(nextIndex)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' })
  }

  const handleNutrientScroll = () => {
    const rail = nutrientRailRef.current
    if (!rail?.clientWidth) return
    setNutrientSlide(Math.min(nutrientSlides.length - 1, Math.max(0, Math.round(rail.scrollLeft / rail.clientWidth))))
  }

  const finishWeekSwipe = (x: number, y: number) => {
    const start = weekTouchStart.current
    weekTouchStart.current = null
    if (!start) return
    const deltaX = x - start.x
    const deltaY = y - start.y
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY)) return
    onShiftWeek(deltaX > 0 ? -1 : 1)
  }

  useEffect(() => {
    dateStripRef.current
      ?.querySelector<HTMLElement>('[aria-current="date"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [selectedDate])

  return (
    <div className="nutrition-home">
      <header className="nutrition-home-header">
        <div className="nutrition-home-title">
          <span className="nutrition-home-brand"><Salad size={17} /> Aura Nutrition</span>
          <h1>{selectedIsToday ? `Hôm nay của ${firstName}` : 'Dinh dưỡng ngày đã chọn'}</h1>
          <p>{selectedDateLabel} · Theo dõi vừa đủ để chọn tốt hơn.</p>
        </div>
        <button type="button" className="nutrition-home-goal" onClick={onEditProfile} aria-label={`Chỉnh mục tiêu dinh dưỡng: ${goalLabel}`}>
          <span><Sparkles size={16} /></span>
          <span><small>Mục tiêu</small><strong>{goalLabel}</strong></span>
          <Pencil size={15} />
        </button>
      </header>

      <section
        className="nutrition-home-week"
        aria-label={`Chọn ngày trong tuần ${weekRangeLabel}`}
        onTouchStart={(event) => { const touch = event.touches[0]; weekTouchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null }}
        onTouchEnd={(event) => { const touch = event.changedTouches[0]; if (touch) finishWeekSwipe(touch.clientX, touch.clientY) }}
      >
        <div className="nutrition-home-week__toolbar">
          <button type="button" className="nutrition-home-week__arrow" onClick={() => onShiftWeek(-1)} aria-label="Tuần trước"><ChevronLeft size={18} /></button>
          <div><span>{weekIncludesToday ? 'Tuần này' : 'Tuần đã chọn'}</span><strong>{weekRangeLabel}</strong></div>
          <button type="button" className="nutrition-home-week__arrow" onClick={() => onShiftWeek(1)} aria-label="Tuần sau"><ChevronRight size={18} /></button>
        </div>
        <div className="nutrition-home-week__days" data-testid="nutrition-date-tabs" ref={dateStripRef}>
          {days.map((item) => {
            const active = item.id === selectedDate
            const fullLabel = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(item.fullDate)
            const hasLog = loggedDateIds.has(item.id)
            return (
              <button type="button" className={active ? 'is-active' : ''} key={item.id} onClick={() => onSelectDate(item.id)} aria-label={`${fullLabel}${hasLog ? ', đã có nhật ký' : ''}`} aria-pressed={active} aria-current={active ? 'date' : undefined}>
                <span>{item.isToday ? 'Nay' : item.day}</span>
                <strong>{item.date}</strong>
                {hasLog && <i aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      </section>

      <section className="nutrition-home-overview" aria-label={selectedIsToday ? 'Tổng quan hôm nay' : 'Tổng quan ngày đã chọn'}>
        <article className="nutrition-home-energy">
          <div className="nutrition-home-card-heading">
            <div><span>NĂNG LƯỢNG</span><h2>{selectedIsToday ? 'Ngân sách hôm nay' : 'Ngân sách trong ngày'}</h2></div>
            <p>{meals.length} bữa đã ghi</p>
          </div>

          <div className="nutrition-home-energy__hero">
            <div className="nutrition-home-energy__copy">
              <span>{energyLabel}</span>
              <strong>{formatNumber(energyValue)} <small>kcal</small></strong>
              <p>Đã nạp {formatNumber(caloriesConsumed)} / {formatNumber(calorieGoal)} kcal</p>
            </div>
            <div
              className={`nutrition-home-ring ${calorieDelta < 0 ? 'is-over' : ''}`}
              style={progressStyle(caloriePercent)}
              role="progressbar"
              aria-label="Tiến độ năng lượng"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={caloriePercent}
              aria-valuetext={calorieDelta >= 0 ? `${caloriePercent}% đã dùng; còn ${formatNumber(energyValue)} kilocalo` : `${caloriePercent}% đã dùng; vượt ${formatNumber(energyValue)} kilocalo`}
            >
              <span><Flame size={22} fill="currentColor" /><strong>{caloriePercent}%</strong><small>đã dùng</small></span>
            </div>
          </div>

          <div className="nutrition-home-energy__activity-note">
            <Dumbbell size={16} />
            <span>Vận động <strong>≈ {formatNumber(activityCalories)} kcal</strong></span>
            <small>Theo dõi riêng, không cộng vào ngân sách ăn</small>
          </div>

          <section className="nutrition-home-nutrients" aria-labelledby="nutrition-home-nutrients-title" aria-roledescription="carousel">
            <div className="nutrition-home-nutrients__heading">
              <div><span>DƯỠNG CHẤT</span><h3 id="nutrition-home-nutrients-title">Tất cả trong một nhịp</h3></div>
              <div className="nutrition-home-nutrients__arrows">
                <button type="button" onClick={() => goToNutrientSlide(nutrientSlide - 1)} disabled={nutrientSlide === 0} aria-label="Nhóm dưỡng chất trước"><ChevronLeft size={17} /></button>
                <button type="button" onClick={() => goToNutrientSlide(nutrientSlide + 1)} disabled={nutrientSlide === nutrientSlides.length - 1} aria-label="Nhóm dưỡng chất sau"><ChevronRight size={17} /></button>
              </div>
            </div>
            <div className="nutrition-home-nutrients__rail" ref={nutrientRailRef} onScroll={handleNutrientScroll}>
              {nutrientSlides.map((slide, slideIndex) => (
                <div className="nutrition-home-nutrients__slide" key={slide.id} role="group" aria-label={`${slide.title}, trang ${slideIndex + 1} trên ${nutrientSlides.length}`}>
                  <div className="nutrition-home-nutrients__slide-heading"><strong>{slide.title}</strong><small>{slide.description}</small></div>
                  <div className="nutrition-home-nutrients__grid">
                    {slide.items.map((item) => <NutrientProgress key={item.label} {...item} />)}
                  </div>
                </div>
              ))}
            </div>
            <div className="nutrition-home-nutrients__dots" aria-label="Chọn nhóm dưỡng chất">
              {nutrientSlides.map((slide, index) => <button type="button" key={slide.id} className={nutrientSlide === index ? 'is-active' : ''} onClick={() => goToNutrientSlide(index)} aria-label={`Xem ${slide.title}`} aria-current={nutrientSlide === index ? 'true' : undefined} />)}
            </div>
          </section>
        </article>

        <aside className="nutrition-home-assistant" aria-labelledby="nutrition-assistant-title">
          <div className="nutrition-home-assistant__heading">
            <span className="nutrition-home-assistant__avatar"><Sparkles size={18} /></span>
            <div><strong>Aura</strong><small>Trợ lý bữa tiếp theo</small></div>
            <span className="nutrition-home-assistant__confidence"><Check size={12} /> {meals.length >= 2 ? 'Căn cứ khá' : 'Đang học từ bạn'}</span>
          </div>
          <span className="nutrition-home-assistant__eyebrow">GỢI Ý DÀNH CHO BẠN</span>
          <h2 id="nutrition-assistant-title">{planCompleted ? `Bạn đã hoàn thành kế hoạch ${selectedIsToday ? 'hôm nay' : 'trong ngày này'}.` : proteinRemaining > 20 ? `Bổ sung khoảng ${formatNumber(proteinRemaining)}g đạm ở bữa tiếp theo` : 'Giữ bữa tiếp theo nhẹ và cân bằng'}</h2>
          <p>{insight}</p>

          <div className="nutrition-home-assistant__signals" aria-label="Các chỉ số Aura đang cân nhắc">
            <span><small>Năng lượng</small><strong>{calorieDelta >= 0 ? `${formatNumber(calorieDelta)} kcal còn lại` : `Vượt ${formatNumber(Math.abs(calorieDelta))} kcal`}</strong></span>
            <span><small>Đạm</small><strong>{proteinRemaining > 0 ? `${formatNumber(proteinRemaining)}g còn lại` : 'Đã đạt mục tiêu'}</strong></span>
          </div>

          {nextMeal && !planCompleted && (
            <div className="nutrition-home-assistant__plan">
              <span className="nutrition-home-assistant__plan-icon"><Utensils size={17} /></span>
              <div><span>{nextMeal.time} · {nextMeal.label}</span><strong>{nextMeal.title}</strong><small>{nextMeal.calories} kcal · {nextMeal.protein}g đạm</small></div>
            </div>
          )}

          <div className="nutrition-home-assistant__buttons">
            <button type="button" className="nutrition-home-assistant__primary" onClick={onOpenCatalog}>
              <Search size={18} /><span>Xem món phù hợp</span><ChevronRight size={17} />
            </button>
            <button type="button" className="nutrition-home-assistant__secondary" onClick={onAskAura}><Sparkles size={17} /> Hỏi Aura</button>
          </div>

          <div className="nutrition-home-assistant__evidence"><CircleAlert size={13} /><span>Dựa trên hồ sơ và {meals.length} bữa đã ghi; hãy kiểm tra khẩu phần thực tế trước khi lưu.</span></div>
        </aside>
      </section>

      <section className="nutrition-home-content">
        <article className="nutrition-home-diary">
          <div className="nutrition-home-section-heading">
            <div><span>NHẬT KÝ</span><h2>Gần đây</h2><p>{timelineEntries.length ? `${meals.length} bữa · ${activities.length} hoạt động` : 'Chưa có dữ liệu trong ngày này'}</p></div>
            <button type="button" className="nutrition-home-text-button" onClick={onOpenQuickAdd}><Plus size={16} /> Ghi nhanh</button>
          </div>

          {timelineEntries.length ? (
            <div className="nutrition-home-meals">
              {timelineEntries.map((entry) => {
                if (entry.kind === 'meal') {
                  const meal = entry.item
                  return (
                    <article className="nutrition-home-meal" key={`meal-${meal.id}`}>
                      <div className="nutrition-home-meal__visual"><MealVisual meal={meal} /></div>
                      <div className="nutrition-home-meal__body">
                        <div className="nutrition-home-meal__meta"><span>{meal.label} · {meal.time}</span><MealEvidenceBadge meal={meal} /></div>
                        <h3>{meal.title}</h3>
                        <p>{meal.description}</p>
                        <div className="nutrition-home-meal__nutrition"><strong>{formatNumber(meal.calories)} kcal</strong><span>{formatNumber(meal.protein)}g đạm</span><span>{formatNumber(meal.carbs)}g carb</span><span>{formatNumber(meal.fat)}g béo</span></div>
                      </div>
                      <button type="button" className="nutrition-home-meal__delete" aria-label={`Xóa ${meal.title} khỏi nhật ký`} onClick={() => onDeleteMeal(meal.id)}><Trash2 size={16} /></button>
                    </article>
                  )
                }

                const activity = entry.item
                return (
                  <article className="nutrition-home-meal nutrition-home-meal--activity" key={`activity-${activity.id}`}>
                    <div className="nutrition-home-meal__visual"><span><Dumbbell size={23} /></span></div>
                    <div className="nutrition-home-meal__body">
                      <div className="nutrition-home-meal__meta"><span>Vận động · {activity.startTime}</span><small className="is-activity"><Activity size={11} /> Đã ghi</small></div>
                      <h3>{activity.title}</h3>
                      <p>{activity.durationMinutes} phút · Cường độ {intensityLabels[activity.intensity].toLocaleLowerCase('vi-VN')}</p>
                      <div className="nutrition-home-meal__nutrition"><strong>≈ {formatNumber(activity.estimatedCalories)} kcal</strong><span>Năng lượng vận động ước tính</span></div>
                    </div>
                    <button type="button" className="nutrition-home-meal__delete" aria-label={`Xóa ${activity.title} khỏi nhật ký`} onClick={() => onDeleteActivity(activity.id)}><Trash2 size={16} /></button>
                  </article>
                )
              })}
            </div>
          ) : (
            <div className="nutrition-home-empty">
              <span><Salad size={25} /></span>
              <div><strong>{selectedIsToday ? 'Chưa có dữ liệu hôm nay' : 'Chưa có dữ liệu trong ngày này'}</strong><p>Quét một bữa ăn hoặc ghi nhanh để Aura bắt đầu phân tích.</p></div>
              <button type="button" onClick={onOpenQuickAdd}><Plus size={16} /> Ghi nhanh</button>
            </div>
          )}
        </article>

        <aside className="nutrition-home-rhythm" aria-labelledby="nutrition-rhythm-title">
          <div className="nutrition-home-section-heading">
            <div><span>NHỊP TRONG NGÀY</span><h2 id="nutrition-rhythm-title">Cân bằng vừa đủ</h2></div>
          </div>

          <section className="nutrition-home-rhythm__water" aria-label="Nước trong ngày">
            <div className="nutrition-home-water__hero">
              <div className="nutrition-home-water__gauge" style={progressStyle(waterPercent)} role="progressbar" aria-label="Tiến độ uống nước" aria-valuemin={0} aria-valuemax={waterGoal} aria-valuenow={Math.min(water, waterGoal)} aria-valuetext={`${formatNumber(water)} trên ${formatNumber(waterGoal)} mililít`}>
                <span><Droplets size={22} /><strong>{waterPercent}%</strong></span>
              </div>
              <div className="nutrition-home-water__copy"><small>HYDRATION</small><h3>{formatNumber(water)} <span>/ {formatNumber(waterGoal)} ml</span></h3><p>{waterRemaining > 0 ? `Còn ${formatNumber(waterRemaining)} ml · khoảng ${Math.ceil(waterRemaining / 250)} cốc nhỏ` : selectedIsToday ? 'Bạn đã đạt mục tiêu nước hôm nay.' : 'Bạn đã đạt mục tiêu nước trong ngày này.'}</p></div>
            </div>
            <div className="nutrition-home-rhythm__quick" role="group" aria-label="Ghi nước nhanh">
              <button type="button" onClick={() => onLogWater(250)}><Droplets size={15} /><span><strong>+250</strong><small>1 ly</small></span></button>
              <button type="button" onClick={() => onLogWater(500)}><Droplets size={15} /><span><strong>+500</strong><small>1 chai</small></span></button>
              <button type="button" onClick={() => onLogWater(750)}><Droplets size={15} /><span><strong>+750</strong><small>1 bình</small></span></button>
              <button type="button" onClick={onOpenWater}><Plus size={15} /><span><strong>Khác</strong><small>Tùy chỉnh</small></span></button>
            </div>
          </section>

          <section className="nutrition-home-rhythm__activity" aria-label="Vận động trong ngày">
            <div className="nutrition-home-rhythm__row-heading"><span><Dumbbell size={18} /></span><div><small>Vận động</small><strong>≈ {formatNumber(activityCalories)} <em>kcal</em></strong></div><button type="button" onClick={onOpenExercise} aria-label="Ghi buổi tập"><Plus size={17} /></button></div>
            <p><Clock3 size={14} /> {activityMinutes} phút · {activities.length} buổi</p>
            <small>Theo dõi riêng, không tự cộng vào ngân sách ăn.</small>
          </section>

          <footer className="nutrition-home-rhythm__footer">
            <span><Sparkles size={16} /></span>
            <div><small>MỤC TIÊU CỦA BẠN</small><strong>{goalLabel}</strong><p>{trainingSessions} buổi tập/tuần · {formatNumber(calorieGoal)} kcal/ngày</p></div>
            <button type="button" onClick={onEditProfile} aria-label="Chỉnh mục tiêu"><Pencil size={15} /></button>
          </footer>
          {allergies && <p className="nutrition-home-rhythm__allergies"><CircleAlert size={14} /> Cần tránh: {allergies}</p>}
        </aside>
      </section>
    </div>
  )
}
