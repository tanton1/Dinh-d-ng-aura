import {
  Activity,
  ArrowRight,
  BookOpenCheck,
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
  learningTitle?: string
  learningProgress?: number
  todayMeals?: TodayMealSummary[]
  onOpenNutrition: () => void
  onOpenEatClean?: () => void
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
  learningTitle,
  learningProgress = 0,
  todayMeals = [],
  onOpenNutrition,
  onOpenEatClean,
  onCheckIn,
  onOpenLearning,
  onOpenProgress,
  onOpenSchedule,
}: AuraTodayFlowProps) {
  const statusTrackRef = useRef<HTMLDivElement>(null)
  const [activeStatusIndex, setActiveStatusIndex] = useState(0)
  const calorieDelta = calorieGoal - caloriesConsumed
  const calorieProgress = percent(caloriesConsumed, calorieGoal)
  const proteinProgress = percent(proteinConsumed, proteinGoal)
  const waterProgress = percent(waterMl, waterGoalMl)
  const movementProgress = percent(movementMinutesToday, 30)
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
      value: formatNumber(movementMinutesToday),
      unit: 'phút hôm nay',
      detail: `${formatNumber(weeklyMovementMinutes)}/150 phút tuần · ${checkedIn ? 'đã điểm danh' : 'chưa điểm danh'}`,
      progress: movementProgress,
      progressLabel: `${movementProgress}% mốc 30 phút hôm nay`,
      action: onOpenSchedule,
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
        : hasLearning && learningProgress < 100
          ? {
              eyebrow: 'VIỆC NÊN LÀM TIẾP THEO',
              title: 'Học tiếp từ vị trí đang dở',
              detail: `Tiếp tục “${learningTitle}” bằng một bài học ngắn.`,
              label: 'Tiếp tục học',
              action: onOpenLearning,
              icon: <BookOpenCheck size={21} />,
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

      <div ref={statusTrackRef} onScroll={updateActiveStatus} className="aura-today-flow__status-track" aria-label="Dinh dưỡng, vận động và học tập">
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
