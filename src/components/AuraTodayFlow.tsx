import {
  Activity,
  ArrowRight,
  CalendarDays,
  Check,
  Droplets,
  Flame,
  Sparkles,
  Utensils,
} from 'lucide-react'
import { useRef, useState } from 'react'
import '../styles-home-today-flow.css'

interface TodayMealSummary {
  id?: string
  time?: string
  label?: string
  title?: string
  calories?: number
}

interface TodayScheduleSummary {
  dateLabel: string
  timeLabel: string
  trainerName: string
}

interface AuraTodayFlowProps {
  firstName: string
  streak?: number
  goalLabel: string
  caloriesConsumed: number
  calorieGoal: number
  proteinConsumed: number
  proteinGoal: number
  waterMl: number
  waterGoalMl?: number
  mealsCount: number
  checkedIn: boolean
  movementMinutesToday?: number
  weeklyMovementMinutes?: number
  todayMeals?: TodayMealSummary[]
  onOpenNutrition: () => void
  onOpenEatClean?: () => void
  onCheckIn: () => void
  onOpenProgress: () => void
  onOpenSchedule: () => void
  scheduleState?: 'loading' | 'linked' | 'unlinked' | 'unavailable'
  todaySessionCount?: number
  nextSession?: TodayScheduleSummary | null
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value)
}

function percent(value: number, goal: number) {
  return Math.min(100, Math.max(0, Math.round((value / Math.max(goal, 1)) * 100)))
}

export default function AuraTodayFlow({
  firstName,
  streak = 0,
  goalLabel,
  caloriesConsumed,
  calorieGoal,
  proteinConsumed,
  proteinGoal,
  waterMl,
  waterGoalMl = 2_000,
  mealsCount,
  checkedIn,
  movementMinutesToday = 0,
  weeklyMovementMinutes = 0,
  todayMeals = [],
  onOpenNutrition,
  onOpenEatClean,
  onCheckIn,
  onOpenProgress,
  onOpenSchedule,
  scheduleState = 'loading',
  todaySessionCount = 0,
  nextSession = null,
}: AuraTodayFlowProps) {
  const statusTrackRef = useRef<HTMLDivElement>(null)
  const [activeStatusIndex, setActiveStatusIndex] = useState(0)
  const calorieDelta = calorieGoal - caloriesConsumed
  const calorieProgress = percent(caloriesConsumed, calorieGoal)
  const proteinProgress = percent(proteinConsumed, proteinGoal)
  const waterProgress = percent(waterMl, waterGoalMl)
  const movementProgress = percent(movementMinutesToday, 30)
  const hasMeal = mealsCount > 0
  const sortedMeals = [...todayMeals]
    .filter((meal) => meal.title || meal.label)
    .sort((left, right) => (left.time ?? '').localeCompare(right.time ?? ''))
    .slice(0, 4)

  const scheduleCard = scheduleState === 'loading'
    ? { value: '…', unit: 'đang tải lịch PT', detail: 'Aura đang đồng bộ các buổi đã được xếp.', progress: 0, progressLabel: 'Đang đồng bộ lịch PT' }
    : scheduleState === 'unlinked'
      ? { value: 'Chưa nối', unit: 'hồ sơ lịch PT', detail: 'Mở lịch để kiểm tra liên kết tài khoản.', progress: 0, progressLabel: 'Hồ sơ lịch PT chưa liên kết' }
      : scheduleState === 'unavailable'
        ? { value: 'Tạm lỗi', unit: 'đồng bộ lịch PT', detail: 'Chạm để mở lịch và thử tải lại.', progress: 0, progressLabel: 'Chưa đồng bộ được lịch PT' }
        : todaySessionCount > 0
          ? { value: formatNumber(todaySessionCount), unit: 'buổi hôm nay', detail: nextSession ? `${nextSession.timeLabel} · ${nextSession.trainerName}` : 'Mở lịch để xem chi tiết buổi tập.', progress: 100, progressLabel: `${todaySessionCount} buổi PT hôm nay` }
          : nextSession
            ? { value: nextSession.timeLabel, unit: nextSession.dateLabel, detail: `Buổi PT · ${nextSession.trainerName}`, progress: 100, progressLabel: `Đã đồng bộ buổi PT tiếp theo vào ${nextSession.dateLabel}` }
            : { value: '0', unit: 'buổi sắp tới', detail: 'Chưa có buổi PT nào được xếp.', progress: 0, progressLabel: 'Chưa có buổi PT sắp tới' }

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
      id: 'schedule',
      tone: 'schedule',
      icon: <CalendarDays size={20} />,
      label: 'Lịch tập',
      ...scheduleCard,
      action: onOpenSchedule,
    },
    {
      id: 'movement',
      tone: 'movement',
      icon: <Activity size={20} />,
      label: 'Vận động',
      value: formatNumber(movementMinutesToday),
      unit: 'phút hôm nay',
      detail: `${formatNumber(weeklyMovementMinutes)}/150 phút tuần · ${checkedIn ? 'đã điểm danh' : 'chưa điểm danh'}`,
      progress: movementProgress,
      progressLabel: `${movementProgress}% mốc 30 phút hôm nay`,
      action: onOpenSchedule,
    },
  ]

  const selectStatus = (index: number) => {
    const track = statusTrackRef.current
    const card = track?.children.item(index) as HTMLElement | null
    const firstCard = track?.children.item(0) as HTMLElement | null
    if (track && card && firstCard) track.scrollTo({ left: card.offsetLeft - firstCard.offsetLeft, behavior: 'smooth' })
    setActiveStatusIndex(index)
  }

  const updateActiveStatus = () => {
    const track = statusTrackRef.current
    if (!track) return
    const cards = Array.from(track.children) as HTMLElement[]
    if (cards.length === 0) return
    const firstOffset = cards[0].offsetLeft
    const index = cards.reduce((closest, card, currentIndex) => (
      Math.abs(card.offsetLeft - firstOffset - track.scrollLeft)
        < Math.abs(cards[closest].offsetLeft - firstOffset - track.scrollLeft)
        ? currentIndex
        : closest
    ), 0)
    setActiveStatusIndex(index)
  }

  const nextAction = !hasMeal
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
      : movementMinutesToday < 30
        ? {
            eyebrow: 'VIỆC NÊN LÀM TIẾP THEO',
            title: 'Tạo một nhịp vận động ngắn',
            detail: `Bạn đã vận động ${formatNumber(movementMinutesToday)}/30 phút hôm nay. Một buổi ngắn vẫn tạo khác biệt.`,
            label: 'Mở lịch vận động',
            action: onOpenSchedule,
            icon: <Activity size={21} />,
          }
        : !checkedIn
            ? {
                eyebrow: 'HOÀN TẤT NHỊP HÔM NAY',
                title: 'Điểm danh để ghi nhận sự đều đặn',
                detail: 'Aura sẽ lưu chuỗi thói quen sau khi các dữ liệu sức khỏe chính đã được ưu tiên.',
                label: 'Điểm danh +50 XP',
                action: onCheckIn,
                icon: <Flame size={21} />,
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
          <h2 id="aura-today-flow-title">Hôm nay của {firstName}</h2>
        </div>
        <div className="aura-today-flow__heading-actions">
          <span className="aura-today-flow__streak" aria-label={`${streak} ngày liên tục`}>
            <Flame size={15} fill="currentColor" aria-hidden="true" />
            <strong>{Math.max(0, streak)}</strong>
            <span>ngày streak</span>
          </span>
          <p>Vuốt để xem · chạm để mở chi tiết</p>
        </div>
      </header>

      <div ref={statusTrackRef} onScroll={updateActiveStatus} className="aura-today-flow__status-track" aria-label="Dinh dưỡng, lịch tập và vận động">
        {statusCards.map((card) => (
          <button
            type="button"
            key={card.id}
            className={`aura-today-flow__status is-${card.tone}`}
            onClick={card.action}
            data-testid={`today-status-${card.id}`}
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
      <div className="aura-today-flow__dots" aria-label="Chọn nhịp hôm nay">
        {statusCards.map((card, index) => (
          <button type="button" key={card.id} className={index === activeStatusIndex ? 'is-active' : ''} aria-label={`Xem ${card.label}`} aria-current={index === activeStatusIndex ? 'true' : undefined} onClick={() => selectStatus(index)} />
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
          {onOpenEatClean && (
            <button type="button" className="aura-today-flow__eat-clean" onClick={onOpenEatClean}>
              <span><Sparkles size={17} /><strong>Aura chọn bữa Eat Clean</strong></span>
              <small>Dựa trên phần kcal và protein còn lại hôm nay</small>
              <ArrowRight size={18} />
            </button>
          )}
        </article>
      </div>
    </section>
  )
}
