import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Coffee,
  Droplets,
  Dumbbell,
  Flame,
  Heart,
  Plus,
  RefreshCw,
  Salad,
  Search,
  Bookmark,
  ScanLine,
  Trash2,
  Utensils,
  Wheat,
  Footprints,
  X,
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

  const handleManualSync = () => {
    setHealthSyncing(true)
    setTimeout(() => {
      const addedSteps = Math.floor(Math.random() * 300) + 120
      const addedKcal = Math.floor(Math.random() * 25) + 15
      setHealthSteps((prev) => prev + addedSteps)
      setHealthActiveKcal((prev) => prev + addedKcal)
      setSyncLastTime('Vừa xong')
      setHealthSyncing(false)
    }, 800)
  }

  return (
    <div className="nutrition-home nutrition-home--cal-ai">
      {/* Brand Topbar with Health Sync Pill */}
      <div className="nutrition-home-topbar">
        <div className="nutrition-home-brand-logo">
          <div className="nutrition-brand-text">
            <h1>Nhật ký dinh dưỡng</h1>
          </div>
        </div>

        <button
          type="button"
          className={`apple-health-pill ${healthSyncActive ? 'is-connected' : ''}`}
          onClick={() => setShowHealthModal(true)}
          title="Quản lý đồng bộ thiết bị sức khỏe"
        >
          <Activity size={15} />
          <span>{healthSyncActive ? `Đồng bộ sức khỏe (${formatNumber(healthActiveKcal)} kcal)` : 'Đồng bộ sức khỏe'}</span>
          <span className={`sync-dot ${healthSyncActive ? 'is-active' : ''}`} />
        </button>
      </div>

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
                  <div className="burned-card-header">
                    <span className="burned-subtitle">Calo tiêu hao vận động</span>
                    <strong className="burned-total">{formatNumber(activityCalories)} <small>kcal</small></strong>
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
                        <h3>{meal.title}</h3>
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
          <div className="apple-health-modal" role="dialog" aria-modal="true" aria-labelledby="apple-health-title">
            <div className="apple-health-modal-header">
              <div className="apple-health-title-group">
                <div className="apple-health-badge-icon">
                  <Activity size={24} />
                </div>
                <div>
                  <h2 id="apple-health-title">Đồng bộ ứng dụng & thiết bị sức khỏe</h2>
                  <p>Tự động cập nhật số bước chân, calo vận động & chỉ số sinh hiệu từ đồng hồ & điện thoại.</p>
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

            <div className="apple-health-status-card">
              <div className="health-status-top">
                <div className="health-status-info">
                  <span className={`health-badge ${healthSyncActive ? 'is-active' : ''}`}>
                    {healthSyncActive ? 'Đang hoạt động 🟢' : 'Đã ngắt kết nối ⚪'}
                  </span>
                  <h3>{healthSyncActive ? 'Đã kết nối thiết bị sức khỏe' : 'Chưa bật đồng bộ tự động'}</h3>
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
                <div className="health-live-stats-grid">
                  <div className="health-stat-box">
                    <span className="stat-icon kcal">
                      <Flame size={18} fill="currentColor" />
                    </span>
                    <div>
                      <strong>{formatNumber(healthActiveKcal)} kcal</strong>
                      <small>Calo tiêu hao hằng ngày</small>
                    </div>
                  </div>
                  <div className="health-stat-box">
                    <span className="stat-icon steps">
                      <Footprints size={18} />
                    </span>
                    <div>
                      <strong>{formatNumber(healthSteps)} bước</strong>
                      <small>Số bước (~3.4 km)</small>
                    </div>
                  </div>
                  <div className="health-stat-box">
                    <span className="stat-icon hr">
                      <Heart size={18} />
                    </span>
                    <div>
                      <strong>{healthHeartRate} bpm</strong>
                      <small>Nhịp tim trung bình</small>
                    </div>
                  </div>
                  <div className="health-stat-box">
                    <span className="stat-icon sleep">
                      <Droplets size={18} />
                    </span>
                    <div>
                      <strong>{healthSleepHours} giờ</strong>
                      <small>Thời gian ngủ (Phục hồi 95%)</small>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="apple-health-actions">
              <button
                type="button"
                className="health-sync-btn"
                onClick={handleManualSync}
                disabled={healthSyncing || !healthSyncActive}
              >
                <RefreshCw size={16} className={healthSyncing ? 'spinning' : ''} />
                <span>{healthSyncing ? 'Đang quét cảm biến...' : 'Đồng bộ thiết bị ngay'}</span>
              </button>
            </div>

            <div className="apple-health-ideas-section">
              <h3>💡 Ý tưởng & Giải pháp kết nối thiết bị thực tế</h3>
              <div className="ideas-grid">
                <div className="idea-card">
                  <strong>1. Native Health Bridge (App Mobile)</strong>
                  <p>Đọc dữ liệu bước chân và calo vận động trực tiếp từ cảm biến phần cứng của điện thoại & đồng hồ.</p>
                </div>
                <div className="idea-card">
                  <strong>2. Smart Watch Webhook Integration</strong>
                  <p>Thiết lập đồng bộ tự động: Mỗi khi hoàn thành tập luyện trên đồng hồ thông minh, ứng dụng tự động nhận dữ liệu.</p>
                </div>
                <div className="idea-card">
                  <strong>3. Google Health Connect & Bluetooth Bridge</strong>
                  <p>Kết nối đồng bộ chéo với Health Connect trên Android và các thiết bị đo nhịp tim Bluetooth LE trực tiếp.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
