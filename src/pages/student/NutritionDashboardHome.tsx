import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  Activity,
  ArrowRight,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock,
  Coffee,
  Droplets,
  Dumbbell,
  Flame,
  Footprints,
  Heart,
  Plus,
  RefreshCw,
  Salad,
  ScanLine,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  TrendingUp,
  Utensils,
  Watch,
  Wheat,
  X,
  Zap,
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
  reviewStatus?: 'pending' | 'reviewed'
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
  onLogWater: (amount: number) => void
  onEditProfile: () => void
  onAskAura?: () => void
  onOpenMeal?: (mealId: string) => void
  onDeleteMeal: (mealId: string) => void
  onDeleteActivity: (activityId: string) => void
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value)
}

function clampPercent(value: number, goal: number) {
  return Math.min(100, Math.max(0, Math.round((value / Math.max(goal, 1)) * 100)))
}

function progressStyle(percent: number) {
  return { '--nutrition-home-progress': `${percent * 3.6}deg` } as CSSProperties
}

function MealVisual({ meal }: { meal: NutritionHomeMeal }) {
  if (meal.image) return <img src={meal.image} alt={meal.title} />
  const Icon = meal.type === 'breakfast' ? Coffee : meal.type === 'snack' ? Salad : Utensils
  return <div className="meal-fallback-icon"><Icon size={24} /></div>
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
  water,
  waterGoal,
  onSelectDate,
  onShiftWeek,
  onOpenQuickAdd,
  onOpenWater,
  onOpenExercise,
  onLogWater,
  onOpenMeal,
  onDeleteMeal,
  onDeleteActivity,
}: NutritionDashboardHomeProps) {
  const dateStripRef = useRef<HTMLDivElement>(null)
  const weekTouchStart = useRef<{ x: number; y: number } | null>(null)
  const carouselTouchStart = useRef<{ x: number; y: number } | null>(null)

  const [slideIndex, setSlideIndex] = useState(0)
  const [showConsumed, setShowConsumed] = useState(false) // toggle remaining vs consumed

  const calorieDelta = calorieGoal - caloriesConsumed

  const proteinRemaining = Math.max(0, proteinGoal - proteinConsumed)
  const carbsRemaining = Math.max(0, carbGoal - carbsConsumed)
  const fatRemaining = Math.max(0, fatGoal - fatConsumed)

  // Calculate dynamic health score out of 10 based on logged meals, macros, fiber & water
  const calRatio = Math.min(1.2, caloriesConsumed / Math.max(1, calorieGoal))
  const protRatio = Math.min(1, proteinConsumed / Math.max(1, proteinGoal))
  const waterRatio = Math.min(1, water / Math.max(1, waterGoal))
  const fiberVal = qualityMetrics.find((m) => m.label.includes('xơ'))?.value ?? 0
  const fiberRatio = Math.min(1, fiberVal / 25)

  let calculatedScore = 5.0
  if (meals.length > 0 || water > 0) {
    const pScore = protRatio * 3.5
    let cScore = 3.5
    if (calRatio > 1.15) {
      cScore = Math.max(1.0, 3.5 - (calRatio - 1.15) * 5)
    } else if (calRatio < 0.4 && meals.length > 0) {
      cScore = calRatio * 3.5 / 0.4
    }
    const fScore = fiberRatio * 1.5
    const wScore = waterRatio * 1.5
    calculatedScore = Math.round(Math.min(10, Math.max(1, pScore + cScore + fScore + wScore)) * 10) / 10
  }
  const healthScore = calculatedScore
  const healthScoreBadge = healthScore >= 8.5 ? 'Xuất sắc 🌟' : healthScore >= 7.0 ? 'Khá tốt 👍' : healthScore >= 5.0 ? 'Cân bằng ⚖️' : 'Cần bổ sung 🥗'

  // Health Score Advice Text
  const healthAdvice = !meals.length
    ? 'Chưa ghi nhận bữa ăn nào trong ngày. Hãy thêm bữa đầu tiên để Aura tính toán năng lượng, vi chất và điểm sức khỏe.'
    : proteinRemaining > 20
      ? 'Lượng đạm hôm nay còn thiếu. Bổ sung thêm thực phẩm giàu đạm như ức gà, trứng, cá hoặc đậu hũ để giữ chỉ số sức khỏe tối ưu.'
      : calorieDelta < 0
        ? 'Bạn đã vượt chỉ tiêu calo hôm nay. Hãy bù đắp bằng việc uống đủ nước và vận động nhẹ nhàng.'
        : 'Chế độ dinh dưỡng trong ngày rất cân bằng! Lượng đạm và năng lượng phân bổ hợp lý.'

  const timelineEntries = [
    ...meals.map((meal) => ({ kind: 'meal' as const, time: meal.time, item: meal })),
    ...activities.map((activity) => ({ kind: 'activity' as const, time: activity.startTime, item: activity })),
  ].sort((left, right) => right.time.localeCompare(left.time))

  const intensityLabels: Record<NutritionHomeActivity['intensity'], string> = { low: 'Nhẹ', moderate: 'Vừa', high: 'Cao' }

  const streakDays = Math.max(1, loggedDateIds.size)

  const finishWeekSwipe = (x: number, y: number) => {
    const start = weekTouchStart.current
    weekTouchStart.current = null
    if (!start) return
    const deltaX = x - start.x
    const deltaY = y - start.y
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY)) return
    onShiftWeek(deltaX > 0 ? -1 : 1)
  }

  const handleCarouselTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0]
    if (touch) carouselTouchStart.current = { x: touch.clientX, y: touch.clientY }
  }

  const handleCarouselTouchEnd = (e: React.TouchEvent) => {
    const start = carouselTouchStart.current
    carouselTouchStart.current = null
    if (!start) return
    const touch = e.changedTouches[0]
    if (!touch) return
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (Math.abs(deltaX) > 35 && Math.abs(deltaX) > Math.abs(deltaY)) {
      if (deltaX < 0) {
        setSlideIndex((prev) => Math.min(2, prev + 1))
      } else {
        setSlideIndex((prev) => Math.max(0, prev - 1))
      }
    }
  }

  useEffect(() => {
    dateStripRef.current
      ?.querySelector<HTMLElement>('[aria-current="date"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [selectedDate])

  const [showHealthModal, setShowHealthModal] = useState(false)
  const [healthSyncActive, setHealthSyncActive] = useState(true)
  const [healthSyncing, setHealthSyncing] = useState(false)
  const [healthSteps, setHealthSteps] = useState(7840)
  const [healthActiveKcal, setHealthActiveKcal] = useState(Math.max(activityCalories, 210))
  const [healthSleepHours, setHealthSleepHours] = useState(7.5)
  const [healthHeartRate, setHealthHeartRate] = useState(68)
  const [syncLastTime, setSyncLastTime] = useState('Vừa xong')
  const [selectedDevice, setSelectedDevice] = useState<'apple' | 'android' | 'garmin' | 'sensor'>('apple')
  const [stepGoal, setStepGoal] = useState<number>(10000)
  const [autoBurnOffset, setAutoBurnOffset] = useState<boolean>(true)
  const [activeStepTab, setActiveStepTab] = useState<number>(1)

  const handleManualSync = (addSteps = 0) => {
    setHealthSyncing(true)
    setTimeout(() => {
      const addedSteps = addSteps > 0 ? addSteps : Math.floor(Math.random() * 300) + 120
      const addedKcal = Math.round(addedSteps * 0.038)
      setHealthSteps((prev) => prev + addedSteps)
      setHealthActiveKcal((prev) => prev + addedKcal)
      setSyncLastTime('Vừa xong')
      setHealthSyncing(false)
    }, 600)
  }

  return (
    <div className="nutrition-home nutrition-home--cal-ai">
      {/* Date Strip Bar (Thứ ngày ở đầu) */}
      <section
        className="nutrition-date-strip"
        aria-label="Chọn ngày trong tuần"
        onTouchStart={(event) => { const touch = event.touches[0]; weekTouchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null }}
        onTouchEnd={(event) => { const touch = event.changedTouches[0]; if (touch) finishWeekSwipe(touch.clientX, touch.clientY) }}
      >
        <button type="button" className="nutrition-date-arrow" onClick={() => onShiftWeek(-1)} aria-label="Tuần trước">
          <ChevronLeft size={18} />
        </button>
        <div className="nutrition-date-pills" ref={dateStripRef}>
          {days.map((item) => {
            const active = item.id === selectedDate
            const hasLog = loggedDateIds.has(item.id)
            return (
              <button
                type="button"
                key={item.id}
                className={`nutrition-date-pill ${active ? 'is-active' : ''}`}
                onClick={() => onSelectDate(item.id)}
                aria-current={active ? 'date' : undefined}
              >
                <span className="day-name">{item.day}</span>
                <span className="day-number-circle">
                  {item.date}
                </span>
                {hasLog && <i className="has-log-dot" />}
              </button>
            )
          })}
        </div>
        <button type="button" className="nutrition-date-arrow" onClick={() => onShiftWeek(1)} aria-label="Tuần sau">
          <ChevronRight size={18} />
        </button>
      </section>

      {/* Main Energy Carousel */}
      <section
        className="nutrition-energy-carousel"
        aria-label="Năng lượng và dinh dưỡng hôm nay"
        onTouchStart={handleCarouselTouchStart}
        onTouchEnd={handleCarouselTouchEnd}
      >
        {/* Left / Right Navigation Arrow Buttons */}
        <button
          type="button"
          className="carousel-nav-btn carousel-nav-prev"
          onClick={() => setSlideIndex((prev) => Math.max(0, prev - 1))}
          disabled={slideIndex === 0}
          aria-label="Slide trước"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          className="carousel-nav-btn carousel-nav-next"
          onClick={() => setSlideIndex((prev) => Math.min(2, prev + 1))}
          disabled={slideIndex === 2}
          aria-label="Slide sau"
        >
          <ChevronRight size={18} />
        </button>

        <div className="nutrition-carousel-wrapper">
          <div
            className="nutrition-carousel-track"
            style={{ transform: `translateX(-${slideIndex * 100}%)` }}
          >
            {/* SLIDE 0: Main Calories + 3 Macro Rings */}
            <div className="nutrition-slide nutrition-slide--macros">
              {/* Hero Card */}
              <div
                className="cal-hero-card"
                onClick={() => setShowConsumed((prev) => !prev)}
                title="Chạm để đổi giữa Calo còn lại và Calo đã nạp"
                role="button"
                tabIndex={0}
              >
                <div className="cal-hero-info">
                  <span className="cal-big-number">
                    {showConsumed
                      ? formatNumber(caloriesConsumed)
                      : calorieDelta >= 0
                        ? formatNumber(calorieDelta)
                        : `+${formatNumber(Math.abs(calorieDelta))}`}
                  </span>
                  <div className="cal-hero-meta">
                    <span className="cal-label">
                      {showConsumed
                        ? 'Calo đã nạp'
                        : calorieDelta >= 0
                          ? 'Calo còn lại'
                          : 'Calo vượt mức'}
                    </span>
                    {activityCalories > 0 && (
                      <span className="cal-activity-bonus" title="Calo vận động">
                        <Dumbbell size={13} /> +{formatNumber(activityCalories)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="cal-hero-ring-container">
                  <div
                    className={`cal-main-ring ${calorieDelta < 0 ? 'is-over' : ''}`}
                    style={progressStyle(caloriePercent)}
                  >
                    <div className="cal-ring-inner">
                      <Flame size={20} fill="currentColor" />
                    </div>
                  </div>
                </div>
              </div>

              {/* 3 Macro Cards (Protein, Carbs, Fat) */}
              <div className="macro-cards-grid">
                {/* Protein Card */}
                <div
                  className="macro-card macro-card--protein"
                  onClick={() => setShowConsumed((prev) => !prev)}
                  title="Chạm để đổi Còn lại / Đã nạp"
                  role="button"
                  tabIndex={0}
                >
                  <div className="macro-card-info">
                    <strong>
                      {showConsumed ? `${formatNumber(proteinConsumed)}g` : `${formatNumber(proteinRemaining)}g`}
                    </strong>
                    <span>{showConsumed ? 'Đạm đã nạp' : 'Đạm còn lại'}</span>
                  </div>
                  <div className="macro-ring" style={progressStyle(clampPercent(proteinConsumed, proteinGoal))}>
                    <div className="macro-ring-inner">
                      <span className="macro-icon-pink">🍗</span>
                    </div>
                  </div>
                </div>

                {/* Carbs Card */}
                <div
                  className="macro-card macro-card--carbs"
                  onClick={() => setShowConsumed((prev) => !prev)}
                  title="Chạm để đổi Còn lại / Đã nạp"
                  role="button"
                  tabIndex={0}
                >
                  <div className="macro-card-info">
                    <strong>
                      {showConsumed ? `${formatNumber(carbsConsumed)}g` : `${formatNumber(carbsRemaining)}g`}
                    </strong>
                    <span>{showConsumed ? 'Carb đã nạp' : 'Carb còn lại'}</span>
                  </div>
                  <div className="macro-ring" style={progressStyle(clampPercent(carbsConsumed, carbGoal))}>
                    <div className="macro-ring-inner">
                      <span className="macro-icon-orange">🌾</span>
                    </div>
                  </div>
                </div>

                {/* Fat Card */}
                <div
                  className="macro-card macro-card--fat"
                  onClick={() => setShowConsumed((prev) => !prev)}
                  title="Chạm để đổi Còn lại / Đã nạp"
                  role="button"
                  tabIndex={0}
                >
                  <div className="macro-card-info">
                    <strong>
                      {showConsumed ? `${formatNumber(fatConsumed)}g` : `${formatNumber(fatRemaining)}g`}
                    </strong>
                    <span>{showConsumed ? 'Béo đã nạp' : 'Béo còn lại'}</span>
                  </div>
                  <div className="macro-ring" style={progressStyle(clampPercent(fatConsumed, fatGoal))}>
                    <div className="macro-ring-inner">
                      <span className="macro-icon-blue">🥑</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* SLIDE 1: Micronutrients & Health Score */}
            <div className="nutrition-slide nutrition-slide--health">
              {/* 3 Micro Cards (Fiber, Sugar, Sodium) */}
              <div className="macro-cards-grid">
                {qualityMetrics.slice(0, 3).map((metric) => {
                  const percent = clampPercent(metric.value, metric.goal)
                  const remaining = Math.max(0, metric.goal - metric.value)
                  const normalizedLabel = metric.label.includes('xơ') || metric.label.includes('Fiber') ? 'Chất xơ'
                    : metric.label.includes('đường') || metric.label.includes('Sugar') ? 'Đường'
                    : metric.label.includes('Natri') || metric.label.includes('Sodium') ? 'Natri'
                    : metric.label
                  return (
                    <div
                      className="macro-card"
                      key={metric.label}
                      onClick={() => setShowConsumed((prev) => !prev)}
                      title="Chạm để đổi giữa Đã nạp và Còn lại"
                      role="button"
                      tabIndex={0}
                    >
                      <div className="macro-card-info">
                        <strong>
                          {showConsumed
                            ? `${formatNumber(metric.value)}${metric.unit}`
                            : `${formatNumber(remaining)}${metric.unit}`}
                        </strong>
                        <span>
                          {normalizedLabel}{' '}
                          {showConsumed
                            ? 'đã nạp'
                            : metric.inverse
                              ? 'hạn mức còn'
                              : 'còn lại'}
                        </span>
                      </div>
                      <div className="macro-ring" style={progressStyle(percent)}>
                        <div className="macro-ring-inner">
                          {normalizedLabel.includes('xơ') ? (
                            <span>🥗</span>
                          ) : normalizedLabel.includes('đường') ? (
                            <span>🍎</span>
                          ) : (
                            <span>🧂</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Health Score Card */}
              <div className="health-score-card">
                <div className="health-score-header">
                  <span className="health-score-title">Điểm sức khỏe bữa ăn</span>
                  <div className="health-score-badge-wrap">
                    <span className="health-score-badge">{healthScoreBadge}</span>
                    <span className="health-score-value">{healthScore}/10</span>
                  </div>
                </div>
                <div className="health-score-bar-track">
                  <div
                    className="health-score-bar-fill"
                    style={{ width: `${Math.min(100, Math.max(10, healthScore * 10))}%` }}
                  />
                </div>
                <p className="health-score-advice">{healthAdvice}</p>
              </div>
            </div>

            {/* SLIDE 2: Health Integration, Activity & Water */}
            <div className="nutrition-slide nutrition-slide--activity-water">
              <div className="activity-water-grid">
                {/* Connect Device Health Card */}
                <div className="connect-health-card">
                  <div className="connect-health-icon"><Heart size={24} fill="#ff3b30" color="#ff3b30" /></div>
                  <h3>Đồng bộ sức khỏe</h3>
                  <p>Theo dõi bước chân tự động</p>
                  <button type="button" className="connect-btn" onClick={() => setShowHealthModal(true)}>Kết nối ngay</button>
                </div>

                {/* Calories Burned Card */}
                <div className="burned-card">
                  <div className="burned-card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <div>
                      <span className="burned-subtitle">Calo tiêu hao vận động</span>
                      <strong className="burned-total">{formatNumber(activityCalories)} <small>kcal</small></strong>
                    </div>
                    <button type="button" className="water-log-pill-btn" onClick={onOpenExercise}>+ Ghi buổi tập</button>
                  </div>
                  <div className="burned-list">
                    <div className="burned-item">
                      <span className="burned-item-icon"><Footprints size={14} /></span>
                      <span className="burned-item-name">Bước chân</span>
                      <span className="burned-item-val">0 kcal</span>
                    </div>
                    {activities.length > 0 ? (
                      activities.map((act) => (
                        <div key={act.id} className="burned-item">
                          <span className="burned-item-icon"><Dumbbell size={14} /></span>
                          <span className="burned-item-name">{act.title}</span>
                          <span className="burned-item-val">{act.estimatedCalories} kcal</span>
                        </div>
                      ))
                    ) : (
                      <p className="burned-empty">Chưa ghi nhận bài tập nào hôm nay</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Water Card Below */}
              <div className="water-card-banner">
                <div className="water-banner-left">
                  <span className="water-glass-emoji">🥛</span>
                  <div>
                    <small>Nước uống</small>
                    <strong>{formatNumber(water)} ml</strong>
                  </div>
                </div>
                <button type="button" className="water-log-pill-btn" onClick={onOpenWater}>+ Ghi nước</button>
              </div>
            </div>
          </div>
        </div>

        {/* Carousel Pagination Dots */}
        <div className="nutrition-carousel-dots">
          {[0, 1, 2].map((idx) => (
            <button
              type="button"
              key={idx}
              className={`carousel-dot ${slideIndex === idx ? 'is-active' : ''}`}
              onClick={() => setSlideIndex(idx)}
              aria-label={`Trang ${idx + 1}`}
            />
          ))}
        </div>
      </section>

      {/* Recently Uploaded / Logged items */}
      <section className="recently-uploaded-section">
        <div className="recently-uploaded-header">
          <h2>Ghi nhận gần đây</h2>
          <button type="button" className="quick-add-text-btn" onClick={onOpenQuickAdd}>
            <Plus size={16} /> Thêm nhanh
          </button>
        </div>

        {timelineEntries.length > 0 ? (
          <div className="recently-uploaded-list">
            {timelineEntries.map((entry) => {
              if (entry.kind === 'meal') {
                const meal = entry.item
                return (
                  <div key={`meal-${meal.id}`} className="recently-card">
                    <div className="recently-card-visual" onClick={() => onOpenMeal?.(meal.id)} style={{ cursor: onOpenMeal ? 'pointer' : 'default' }}>
                      <MealVisual meal={meal} />
                    </div>
                    <div className="recently-card-body" onClick={() => onOpenMeal?.(meal.id)} style={{ cursor: onOpenMeal ? 'pointer' : 'default' }}>
                      <div className="recently-card-top">
                        <h3>{meal.title} {meal.reviewStatus === 'pending' ? <span style={{ marginLeft: 6, fontSize: 11, padding: '2px 6px', background: '#fef3c7', color: '#d97706', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}><Clock size={10} /> Chờ duyệt</span> : meal.reviewStatus === 'reviewed' ? <span style={{ marginLeft: 6, fontSize: 11, padding: '2px 6px', background: '#d1fae5', color: '#059669', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}><Check size={10} /> Đã duyệt</span> : null}</h3>
                        <span className="recently-card-time">{meal.time}</span>
                      </div>
                      <div className="recently-card-calories">
                        <Flame size={14} fill="currentColor" />
                        <strong>{formatNumber(meal.calories)} kcal</strong>
                      </div>
                      <div className="recently-card-details">
                        <span>🍗 {meal.protein}g đạm</span>
                        <span>🌾 {meal.carbs}g carb</span>
                        <span>🥑 {meal.fat}g béo</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="recently-card-delete"
                      onClick={() => onDeleteMeal(meal.id)}
                      aria-label="Xóa món ăn"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )
              }

              const activity = entry.item
              return (
                <div key={`activity-${activity.id}`} className="recently-card recently-card--activity">
                  <div className="recently-card-visual-exercise">
                    <Dumbbell size={22} />
                  </div>
                  <div className="recently-card-body">
                    <div className="recently-card-top">
                      <h3>{activity.title}</h3>
                      <span className="recently-card-time">{activity.startTime}</span>
                    </div>
                    <div className="recently-card-calories">
                      <Flame size={14} fill="currentColor" />
                      <strong>{formatNumber(activity.estimatedCalories)} kcal</strong>
                    </div>
                    <div className="recently-card-details">
                      <span>Cường độ: {intensityLabels[activity.intensity]}</span>
                      <span>⏱️ {activity.durationMinutes} phút</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="recently-card-delete"
                    onClick={() => onDeleteActivity(activity.id)}
                    aria-label="Xóa vận động"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="recently-uploaded-empty">
            <Salad size={28} />
            <p>Chưa có món ăn hoặc vận động nào cho ngày này. Nhấn nút + nổi bên dưới để ghi nhanh!</p>
          </div>
        )}
      </section>

      {/* Prominent Floating Quick-Add Pink Button (+) */}
      <div className="nutrition-pink-fab-container">
        <button
          type="button"
          className="nutrition-pink-fab"
          onClick={onOpenQuickAdd}
          aria-label="Thêm bữa ăn hoặc vận động nhanh"
          title="Thêm nhanh (Quét ảnh / Nhập món / Ghi nước / Vận động)"
        >
          <Plus size={28} strokeWidth={2.8} className="pink-fab-icon" />
        </button>
      </div>

      {/* Apple Health & Health Connect Sync Modal */}
      {showHealthModal && (
        <div
          className="nutrition-sheet-backdrop"
          role="presentation"
          onClick={(event) => event.target === event.currentTarget && setShowHealthModal(false)}
        >
          <div className="apple-health-modal health-interactive-modal" role="dialog" aria-modal="true" aria-labelledby="apple-health-title">
            <div className="apple-health-modal-header">
              <div className="apple-health-title-group">
                <div className="apple-health-badge-icon">
                  <Activity size={24} />
                </div>
                <div>
                  <h2 id="apple-health-title">Trung tâm Thiết bị & Đồng bộ Sức khỏe</h2>
                  <p>Đồng bộ thời gian thực số bước chân, calo tiêu hao & sinh hiệu từ đồng hồ & điện thoại của bạn.</p>
                </div>
              </div>
              <button
                type="button"
                className="nutrition-close-button"
                onClick={() => setShowHealthModal(false)}
                aria-label="Đóng"
              >
                <X size={20} />
              </button>
            </div>

            {/* Device Selector Chips */}
            <div className="health-device-selector">
              <span className="section-label">Thiết bị ưu tiên:</span>
              <div className="device-chips-grid">
                <button
                  type="button"
                  className={`device-chip ${selectedDevice === 'apple' ? 'is-active' : ''}`}
                  onClick={() => setSelectedDevice('apple')}
                >
                  <Watch size={16} />
                  <span>Apple Watch / iOS</span>
                </button>
                <button
                  type="button"
                  className={`device-chip ${selectedDevice === 'android' ? 'is-active' : ''}`}
                  onClick={() => setSelectedDevice('android')}
                >
                  <Smartphone size={16} />
                  <span>Health Connect</span>
                </button>
                <button
                  type="button"
                  className={`device-chip ${selectedDevice === 'garmin' ? 'is-active' : ''}`}
                  onClick={() => setSelectedDevice('garmin')}
                >
                  <Watch size={16} />
                  <span>Garmin / Fitbit</span>
                </button>
                <button
                  type="button"
                  className={`device-chip ${selectedDevice === 'sensor' ? 'is-active' : ''}`}
                  onClick={() => setSelectedDevice('sensor')}
                >
                  <Zap size={16} />
                  <span>Cảm biến di động</span>
                </button>
              </div>
            </div>

            <div className="apple-health-status-card">
              <div className="health-status-top">
                <div className="health-status-info">
                  <span className={`health-badge ${healthSyncActive ? 'is-active' : ''}`}>
                    {healthSyncActive ? 'Đã kết nối 🟢' : 'Đã ngắt kết nối ⚪'}
                  </span>
                  <h3>
                    {healthSyncActive ? (
                      selectedDevice === 'apple' ? 'Đã kết nối Apple HealthKit (Active)' :
                      selectedDevice === 'android' ? 'Đã đồng bộ Google Health Connect' :
                      selectedDevice === 'garmin' ? 'Đã liên kết tài khoản Garmin cloud' :
                      'Đang sử dụng cảm biến CoreMotion di động'
                    ) : 'Chưa bật đồng bộ tự động'}
                  </h3>
                  <small>Cập nhật lần cuối: {syncLastTime}</small>
                </div>
                <label className="health-toggle-switch">
                  <input
                    type="checkbox"
                    checked={healthSyncActive}
                    onChange={(event) => setHealthSyncActive(event.target.checked)}
                  />
                  <span className="slider" />
                </label>
              </div>

              {healthSyncActive && (
                <>
                  <div className="health-live-stats-grid">
                    <div className="health-stat-box">
                      <span className="stat-icon kcal">
                        <Flame size={18} fill="currentColor" />
                      </span>
                      <div>
                        <strong>{formatNumber(healthActiveKcal)} kcal</strong>
                        <small>Calo tiêu hao vận động</small>
                      </div>
                    </div>
                    <div className="health-stat-box">
                      <span className="stat-icon steps">
                        <Footprints size={18} />
                      </span>
                      <div>
                        <strong>{formatNumber(healthSteps)} bước</strong>
                        <small>Tiến độ: {Math.round((healthSteps / stepGoal) * 100)}% mục tiêu</small>
                      </div>
                    </div>
                    <div className="health-stat-box">
                      <span className="stat-icon hr">
                        <Heart size={18} />
                      </span>
                      <div>
                        <strong>{healthHeartRate} bpm</strong>
                        <small>Nhịp tim nghỉ trung bình</small>
                      </div>
                    </div>
                    <div className="health-stat-box">
                      <span className="stat-icon sleep">
                        <Droplets size={18} />
                      </span>
                      <div>
                        <strong>{healthSleepHours} giờ</strong>
                        <small>Giấc ngủ sâu đêm qua</small>
                      </div>
                    </div>
                  </div>

                  {/* Dynamic Configurations inside Connected view */}
                  <div className="health-sync-settings">
                    <div className="setting-slider-group">
                      <div className="slider-header">
                        <span className="lbl"><TrendingUp size={14} /> Mục tiêu số bước hằng ngày:</span>
                        <strong className="val">{formatNumber(stepGoal)} bước</strong>
                      </div>
                      <input
                        type="range"
                        min="4000"
                        max="20000"
                        step="1000"
                        value={stepGoal}
                        onChange={(e) => setStepGoal(parseInt(e.target.value, 10))}
                        className="health-range-slider"
                      />
                    </div>

                    <div className="setting-toggle-row">
                      <div className="toggle-label-group">
                        <span className="lbl">💡 Tự động bù trừ Calo tiêu thụ</span>
                        <p className="desc">Tự động tăng mức trần Calories được ăn hôm nay dựa trên lượng vận động thực tế.</p>
                      </div>
                      <label className="health-toggle-switch small-toggle">
                        <input
                          type="checkbox"
                          checked={autoBurnOffset}
                          onChange={(e) => setAutoBurnOffset(e.target.checked)}
                        />
                        <span className="slider" />
                      </label>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Simulation & Test Hardware Sensors Sandbox */}
            {healthSyncActive && (
              <div className="sensor-simulation-sandbox">
                <div className="sandbox-header">
                  <Sparkles size={16} className="spark-anim" />
                  <h4>Trình giả lập & Kiểm tra cảm biến phần cứng</h4>
                </div>
                <p className="sandbox-desc">Thử nghiệm gửi gói tin bước chân thực tế của cảm biến di động để kiểm chứng thuật toán đồng bộ:</p>

                <div className="sandbox-simulation-actions">
                  <button
                    type="button"
                    className="sim-btn step-1000"
                    onClick={() => handleManualSync(1000)}
                    disabled={healthSyncing}
                  >
                    <span>+1,000 bước</span>
                    <small>~38 kcal tiêu hao</small>
                  </button>
                  <button
                    type="button"
                    className="sim-btn step-3000"
                    onClick={() => handleManualSync(3000)}
                    disabled={healthSyncing}
                  >
                    <span>+3,000 bước</span>
                    <small>~114 kcal tiêu hao</small>
                  </button>
                  <button
                    type="button"
                    className="sim-btn step-custom"
                    onClick={() => handleManualSync(5000)}
                    disabled={healthSyncing}
                  >
                    <span>+5,000 bước (Chạy bộ)</span>
                    <small>~190 kcal tiêu hao</small>
                  </button>
                </div>

                <button
                  type="button"
                  className={`health-sync-btn ${healthSyncing ? 'is-syncing' : ''}`}
                  onClick={() => handleManualSync(0)}
                  disabled={healthSyncing}
                >
                  <RefreshCw size={16} className={healthSyncing ? 'spinning' : ''} />
                  <span>{healthSyncing ? 'Đang giao tiếp với phần cứng thiết bị...' : 'Kiểm tra tín hiệu Bluetooth / Health API'}</span>
                </button>
              </div>
            )}

            {/* Interactive Concept Tab list */}
            <div className="apple-health-ideas-section">
              <div className="ideas-tab-header">
                <h3>🛠️ Kiến trúc vận hành hệ thống kết nối</h3>
                <div className="tab-pills">
                  <button
                    type="button"
                    className={`tab-pill ${activeStepTab === 1 ? 'is-active' : ''}`}
                    onClick={() => setActiveStepTab(1)}
                  >
                    Capacitor Native Bridge
                  </button>
                  <button
                    type="button"
                    className={`tab-pill ${activeStepTab === 2 ? 'is-active' : ''}`}
                    onClick={() => setActiveStepTab(2)}
                  >
                    API / Cloud Sync
                  </button>
                </div>
              </div>

              {activeStepTab === 1 ? (
                <div className="ideas-grid conceptual-grid animate-fade">
                  <div className="idea-card">
                    <div className="card-head">
                      <Smartphone size={16} />
                      <strong>1. iOS Apple HealthKit Bridge</strong>
                    </div>
                    <p>Sử dụng SDK gốc và plugin <code>@periferia/capacitor-healthkit</code> để đọc dữ liệu <code>HKQuantityTypeIdentifierActiveEnergyBurned</code> trực tiếp từ phần cứng Apple HealthKit khi app mở.</p>
                  </div>
                  <div className="idea-card">
                    <div className="card-head">
                      <Watch size={16} />
                      <strong>2. Android Health Connect Sync</strong>
                    </div>
                    <p>Gọi API trung gian của Google Health Connect để đọc chỉ số bước chân và nhịp tim được chia sẻ bởi Samsung Health, Google Fit hay Fitbit một cách bảo mật.</p>
                  </div>
                  <div className="idea-card">
                    <div className="card-head">
                      <Activity size={16} />
                      <strong>3. Web Bluetooth Core Sensors</strong>
                    </div>
                    <p>Giao tiếp trực tiếp với các thiết bị đo nhịp tim đeo ngực Garmin / Polar thông qua Web Bluetooth API của trình duyệt khi chạy bộ tại nhà.</p>
                  </div>
                </div>
              ) : (
                <div className="ideas-grid conceptual-grid animate-fade">
                  <div className="idea-card">
                    <div className="card-head">
                      <ShieldCheck size={16} />
                      <strong>A. Phân quyền bảo mật (Privacy Guard)</strong>
                    </div>
                    <p>Cấp quyền Read-Only cho các trường thông tin cụ thể. Dữ liệu chỉ lưu trữ cục bộ trên máy và đồng bộ về hồ sơ học viên Aura Fitness để PT theo dõi.</p>
                  </div>
                  <div className="idea-card">
                    <div className="card-head">
                      <Sparkles size={16} />
                      <strong>B. Webhook Tự động từ Đồng hồ</strong>
                    </div>
                    <p>Sử dụng phím tắt iOS (iOS Automation Shortcuts): Mỗi khi hoàn thành buổi tập luyện, iPhone tự động đẩy JSON chứa kết quả tới Webhook URL cá nhân của học viên.</p>
                  </div>
                  <div className="idea-card">
                    <div className="card-head">
                      <Plus size={16} />
                      <strong>C. Tự động tính toán Calo thặng dư</strong>
                    </div>
                    <p>Hệ thống tự động tính toán bù trừ: Calories Mục tiêu = BMR + (Calo Vận Động × Hệ số 0.95). Giúp phân bổ lại thực đơn chính xác nhất.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
