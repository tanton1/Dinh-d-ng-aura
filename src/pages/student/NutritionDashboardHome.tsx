import React, { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  Activity,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coffee,
  Droplets,
  Dumbbell,
  Flame,
  Footprints,
  Heart,
  Plus,
  Salad,
  ScanLine,
  Sparkles,
  Trash2,
  Utensils,
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
  selectedDate: string
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
  water: number
  waterGoal: number
  trainingSessions: number
  dailyPlan: NutritionHomePlanItem[]
  allergies?: string
  onSelectDate: (date: string) => void
  onShiftWeek: (direction: -1 | 1) => void
  onOpenQuickAdd: () => void
  onOpenCatalog?: () => void
  onOpenEatClean?: () => void
  onOpenWater: () => void
  onOpenExercise: () => void
  onLogWater: (amount: number) => void
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

export default React.memo(NutritionDashboardHome)
function NutritionDashboardHome({
  selectedDate,
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
  onOpenCatalog,
  onOpenEatClean,
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

  const nextAction = meals.length === 0
    ? { eyebrow: 'BẮT ĐẦU NGÀY', title: 'Ghi bữa ăn đầu tiên', detail: 'Chụp ảnh hoặc nhập nhanh món bạn vừa ăn.', label: 'Ghi bữa ngay', icon: ScanLine, action: onOpenQuickAdd }
    : water < waterGoal * 0.5
      ? { eyebrow: 'ƯU TIÊN BÂY GIỜ', title: 'Bổ sung 250 ml nước', detail: `Bạn mới đạt ${clampPercent(water, waterGoal)}% mục tiêu nước.`, label: '+250 ml', icon: Droplets, action: () => onLogWater(250) }
      : proteinRemaining > 20
        ? { eyebrow: 'GỢI Ý TỪ AURA', title: 'Chọn thêm món giàu đạm', detail: `Còn thiếu khoảng ${formatNumber(proteinRemaining)}g đạm để chạm mục tiêu.`, label: onOpenEatClean ? 'Đặt món Eat Clean' : onOpenCatalog ? 'Mở Catalog dinh dưỡng' : 'Ghi bữa tiếp theo', icon: Salad, action: onOpenEatClean ?? onOpenCatalog ?? onOpenQuickAdd }
        : calorieDelta < 0
          ? { eyebrow: 'CÂN BẰNG LẠI', title: 'Thêm một hoạt động nhẹ', detail: 'Đi bộ hoặc vận động vừa sức; không tự động bù trừ ngân sách ăn.', label: 'Ghi vận động', icon: Footprints, action: onOpenExercise }
          : { eyebrow: 'ĐANG ĐÚNG NHỊP', title: 'Duy trì lựa chọn hiện tại', detail: 'Macro chính đang cân bằng; tiếp tục ghi lại các bữa còn lại.', label: 'Thêm bữa tiếp theo', icon: Sparkles, action: onOpenQuickAdd }

  const mealRhythm = [
    { type: 'breakfast' as const, label: 'Bữa sáng', window: '06:00–09:00' },
    { type: 'lunch' as const, label: 'Bữa trưa', window: '11:00–13:30' },
    { type: 'snack' as const, label: 'Bữa phụ', window: '14:00–17:00' },
    { type: 'dinner' as const, label: 'Bữa tối', window: '18:00–21:00' },
  ].map((slot) => ({ ...slot, meal: meals.find((meal) => meal.type === slot.type) }))

  const NextActionIcon = nextAction.icon

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
                  <p>Apple Health và Health Connect</p>
                  <button type="button" className="connect-btn" disabled title="Tính năng đang được hoàn thiện với dữ liệu thiết bị thật">Sắp ra mắt</button>
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

      <section className="nutrition-next-action" aria-label="Việc nên làm tiếp theo">
        <span className="nutrition-next-action__icon"><NextActionIcon size={22} /></span>
        <div>
          <small>{nextAction.eyebrow}</small>
          <h2>{nextAction.title}</h2>
          <p>{nextAction.detail}</p>
        </div>
        <button type="button" onClick={nextAction.action}>{nextAction.label} <ArrowRight size={16} /></button>
      </section>

      <section className="nutrition-meal-rhythm" aria-labelledby="nutrition-meal-rhythm-title">
        <div className="nutrition-meal-rhythm__heading">
          <div><span>NHỊP BỮA ĂN</span><h2 id="nutrition-meal-rhythm-title">Một ngày, bốn điểm chạm</h2></div>
          <small>{mealRhythm.filter((slot) => slot.meal).length}/4 đã ghi</small>
        </div>
        <div className="nutrition-meal-rhythm__grid">
          {mealRhythm.map((slot) => (
            <button
              type="button"
              key={slot.type}
              className={slot.meal ? 'is-complete' : ''}
              onClick={() => slot.meal && onOpenMeal ? onOpenMeal(slot.meal.id) : onOpenQuickAdd()}
            >
              <span className="nutrition-meal-rhythm__marker">{slot.meal ? <Check size={15} /> : <Plus size={15} />}</span>
              <span className="nutrition-meal-rhythm__copy"><strong>{slot.label}</strong><small>{slot.meal ? slot.meal.title : slot.window}</small></span>
              {slot.meal ? <em>{formatNumber(slot.meal.calories)} kcal</em> : <em>Ghi bữa</em>}
            </button>
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

    </div>
  )
}
