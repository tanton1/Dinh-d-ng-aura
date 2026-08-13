import {
  Activity,
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  Check,
  Droplets,
  Flame,
  Sparkles,
  Utensils,
} from 'lucide-react'
import '../styles-home-today-flow.css'

interface TodayMealSummary {
  id?: string
  time?: string
  label?: string
  title?: string
  calories?: number
}

interface UpcomingScheduleSummary {
  title: string
  date: string
  time: string
  durationMinutes?: number
}

interface AuraTodayFlowProps {
  firstName: string
  goalLabel: string
  caloriesConsumed: number
  calorieGoal: number
  proteinConsumed: number
  proteinGoal: number
  waterMl: number
  waterGoalMl?: number
  mealsCount: number
  checkedIn: boolean
  weeklyMovementMinutes?: number
  learningTitle?: string
  learningProgress?: number
  todayMeals?: TodayMealSummary[]
  upcomingSchedule?: UpcomingScheduleSummary | null
  onOpenNutrition: () => void
  onCheckIn: () => void
  onOpenLearning: () => void
  onOpenProgress: () => void
  onOpenSchedule: () => void
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value)
}

function percent(value: number, goal: number) {
  return Math.min(100, Math.max(0, Math.round((value / Math.max(goal, 1)) * 100)))
}

function formatScheduleDate(dateId: string) {
  const target = new Date(`${dateId}T12:00:00`)
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const targetStart = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  const dayDelta = Math.round((targetStart.getTime() - todayStart.getTime()) / 86_400_000)
  if (dayDelta === 0) return 'Hôm nay'
  if (dayDelta === 1) return 'Ngày mai'
  return new Intl.DateTimeFormat('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(target)
}

export default function AuraTodayFlow({
  firstName,
  goalLabel,
  caloriesConsumed,
  calorieGoal,
  proteinConsumed,
  proteinGoal,
  waterMl,
  waterGoalMl = 2_000,
  mealsCount,
  checkedIn,
  weeklyMovementMinutes = 0,
  learningTitle,
  learningProgress = 0,
  todayMeals = [],
  upcomingSchedule,
  onOpenNutrition,
  onCheckIn,
  onOpenLearning,
  onOpenProgress,
  onOpenSchedule,
}: AuraTodayFlowProps) {
  const calorieDelta = calorieGoal - caloriesConsumed
  const calorieProgress = percent(caloriesConsumed, calorieGoal)
  const proteinProgress = percent(proteinConsumed, proteinGoal)
  const waterProgress = percent(waterMl, waterGoalMl)
  const movementProgress = percent(weeklyMovementMinutes, 150)
  const hasMeal = mealsCount > 0
  const hasLearning = Boolean(learningTitle)
  const sortedMeals = [...todayMeals]
    .filter((meal) => meal.title || meal.label)
    .sort((left, right) => (left.time ?? '').localeCompare(right.time ?? ''))
    .slice(0, 4)

  const statusCards = [
    {
      id: 'nutrition',
      tone: 'nutrition',
      icon: <Utensils size={20} />,
      label: 'Dinh dưỡng',
      value: calorieDelta >= 0 ? formatNumber(calorieDelta) : `+${formatNumber(Math.abs(calorieDelta))}`,
      unit: calorieDelta >= 0 ? 'kcal còn lại' : 'kcal vượt mục tiêu',
      detail: hasMeal
        ? `${mealsCount} bữa · ${formatNumber(proteinConsumed)}/${formatNumber(proteinGoal)}g đạm`
        : `Chưa ghi bữa · ${goalLabel}`,
      progress: calorieProgress,
      progressLabel: `${calorieProgress}% mục tiêu năng lượng`,
      action: onOpenNutrition,
    },
    {
      id: 'movement',
      tone: 'movement',
      icon: <Activity size={20} />,
      label: 'Vận động',
      value: formatNumber(weeklyMovementMinutes),
      unit: 'phút tuần này',
      detail: checkedIn ? 'Đã điểm danh · duy trì nhịp vận động tuần' : 'Chưa điểm danh hôm nay',
      progress: movementProgress,
      progressLabel: `${movementProgress}% mốc 150 phút/tuần`,
      action: onOpenProgress,
    },
    {
      id: 'learning',
      tone: 'learning',
      icon: <BookOpenCheck size={20} />,
      label: 'Học tập',
      value: hasLearning ? `${Math.round(learningProgress)}%` : 'Sẵn sàng',
      unit: hasLearning ? 'lộ trình đã xong' : 'chọn lộ trình đầu tiên',
      detail: learningTitle ?? 'Khám phá khóa học phù hợp với mục tiêu của bạn',
      progress: hasLearning ? Math.round(learningProgress) : 0,
      progressLabel: hasLearning ? `${Math.round(learningProgress)}% tiến độ khóa học` : 'Chưa tham gia khóa học',
      action: onOpenLearning,
    },
  ]

  const nextAction = !checkedIn
    ? {
        eyebrow: 'VIỆC NÊN LÀM TIẾP THEO',
        title: 'Điểm danh để bắt đầu nhịp hôm nay',
        detail: 'Một thao tác ngắn giúp Aura ghi nhận chuỗi thói quen và mở khóa 50 XP.',
        label: 'Điểm danh +50 XP',
        action: onCheckIn,
        icon: <Flame size={21} />,
      }
    : !hasMeal
      ? {
          eyebrow: 'VIỆC NÊN LÀM TIẾP THEO',
          title: 'Ghi bữa đầu tiên trong ngày',
          detail: 'Sau khi có dữ liệu bữa ăn, Aura sẽ cập nhật năng lượng và macro còn lại.',
          label: 'Mở Dinh dưỡng',
          action: onOpenNutrition,
          icon: <Utensils size={21} />,
        }
      : waterProgress < 60
        ? {
            eyebrow: 'VIỆC NÊN LÀM TIẾP THEO',
            title: 'Bổ sung một cốc nước',
            detail: `Bạn đã ghi ${formatNumber(waterMl)}/${formatNumber(waterGoalMl)} ml nước hôm nay.`,
            label: 'Ghi nước uống',
            action: onOpenNutrition,
            icon: <Droplets size={21} />,
          }
        : hasLearning && learningProgress < 100
          ? {
              eyebrow: 'VIỆC NÊN LÀM TIẾP THEO',
              title: 'Học tiếp từ vị trí đang dở',
              detail: `Tiếp tục “${learningTitle}” bằng một bài học ngắn.`,
              label: 'Tiếp tục học',
              action: onOpenLearning,
              icon: <BookOpenCheck size={21} />,
            }
          : {
              eyebrow: 'GIỮ ĐÀ TỐT',
              title: 'Xem lại tiến độ tuần này',
              detail: 'Tổng hợp những gì đã hoàn thành và chọn một mục tiêu nhỏ tiếp theo.',
              label: 'Xem tiến độ',
              action: onOpenProgress,
              icon: <Sparkles size={21} />,
            }

  return (
    <section className="aura-today-flow" aria-labelledby="aura-today-flow-title">
      <header className="aura-today-flow__heading">
        <div>
          <span><Sparkles size={16} /> TỔNG QUAN HÔM NAY</span>
          <h2 id="aura-today-flow-title">Ba nhịp chính của {firstName}</h2>
        </div>
        <p>Vuốt để xem · chạm để mở chi tiết</p>
      </header>

      <div className="aura-today-flow__status-track" aria-label="Dinh dưỡng, vận động và học tập">
        {statusCards.map((card) => (
          <button
            type="button"
            key={card.id}
            className={`aura-today-flow__status is-${card.tone}`}
            onClick={card.action}
          >
            <span className="aura-today-flow__status-icon">{card.icon}</span>
            <span className="aura-today-flow__status-label">{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.unit}</small>
            <p>{card.detail}</p>
            <span
              className="aura-today-flow__status-progress"
              role="progressbar"
              aria-label={card.progressLabel}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(100, Math.max(0, card.progress))}
            >
              <i style={{ width: `${Math.min(100, Math.max(0, card.progress))}%` }} />
            </span>
            <ArrowRight className="aura-today-flow__status-arrow" size={18} />
          </button>
        ))}
      </div>

      <article className="aura-today-flow__next">
        <span>{nextAction.icon}</span>
        <div>
          <small>{nextAction.eyebrow}</small>
          <h3>{nextAction.title}</h3>
          <p>{nextAction.detail}</p>
        </div>
        <button type="button" onClick={nextAction.action}>{nextAction.label} <ArrowRight size={17} /></button>
      </article>

      <div className="aura-today-flow__rhythm-grid">
        <article className="aura-today-flow__rhythm-card">
          <header>
            <div><span><Utensils size={16} /> NHỊP BỮA ĂN</span><h3>Dữ liệu hôm nay</h3></div>
            <button type="button" onClick={onOpenNutrition}>Chi tiết <ArrowRight size={16} /></button>
          </header>
          {sortedMeals.length > 0 ? (
            <div className="aura-today-flow__meal-list">
              {sortedMeals.map((meal, index) => (
                <div key={meal.id ?? `${meal.time}-${index}`}>
                  <span>{meal.time || '--:--'}</span>
                  <i>{index + 1}</i>
                  <p><strong>{meal.label || 'Bữa ăn'}</strong><small>{meal.title || 'Đã ghi nhận'}{meal.calories ? ` · ${formatNumber(meal.calories)} kcal` : ''}</small></p>
                  <Check size={16} />
                </div>
              ))}
            </div>
          ) : (
            <button type="button" className="aura-today-flow__empty" onClick={onOpenNutrition}>
              <Utensils size={22} />
              <span><strong>Chưa có bữa ăn được ghi</strong><small>Thêm bữa đầu tiên để Aura tạo nhịp dinh dưỡng hôm nay.</small></span>
              <ArrowRight size={18} />
            </button>
          )}
        </article>

        <article className="aura-today-flow__rhythm-card">
          <header>
            <div><span><CalendarDays size={16} /> LỊCH THỰC TẾ</span><h3>Hoạt động sắp tới</h3></div>
            <button type="button" onClick={onOpenSchedule}>Mở lịch <ArrowRight size={16} /></button>
          </header>
          {upcomingSchedule ? (
            <button type="button" className="aura-today-flow__schedule" onClick={onOpenSchedule}>
              <span><CalendarDays size={21} /></span>
              <p>
                <small>{formatScheduleDate(upcomingSchedule.date)} · {upcomingSchedule.time}</small>
                <strong>{upcomingSchedule.title}</strong>
                {upcomingSchedule.durationMinutes ? <em>{upcomingSchedule.durationMinutes} phút</em> : null}
              </p>
              <ArrowRight size={18} />
            </button>
          ) : (
            <button type="button" className="aura-today-flow__empty" onClick={onOpenSchedule}>
              <CalendarDays size={22} />
              <span><strong>Chưa có hoạt động sắp tới</strong><small>Lịch chỉ hiển thị dữ liệu thật do bạn hoặc PT đã tạo.</small></span>
              <ArrowRight size={18} />
            </button>
          )}
        </article>
      </div>
    </section>
  )
}
