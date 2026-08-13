import type { CSSProperties } from 'react'
import {
  ArrowRight,
  BookOpenCheck,
  Check,
  ChevronRight,
  Droplets,
  Flame,
  Footprints,
  Sparkles,
  Target,
  Utensils,
} from 'lucide-react'
import '../styles-home-today-flow.css'

interface AuraTodayFlowProps {
  firstName: string
  goalLabel: string
  caloriesConsumed: number
  calorieGoal: number
  proteinConsumed: number
  proteinGoal: number
  waterMl: number
  mealsCount: number
  loggingStreak: number
  checkedIn: boolean
  learningTitle?: string
  learningProgress?: number
  onOpenNutrition: () => void
  onCheckIn: () => void
  onOpenLearning: () => void
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value)
}

function percent(value: number, goal: number) {
  return Math.min(100, Math.max(0, Math.round((value / Math.max(goal, 1)) * 100)))
}

export default function AuraTodayFlow({
  firstName,
  goalLabel,
  caloriesConsumed,
  calorieGoal,
  proteinConsumed,
  proteinGoal,
  waterMl,
  mealsCount,
  loggingStreak,
  checkedIn,
  learningTitle,
  learningProgress = 0,
  onOpenNutrition,
  onCheckIn,
  onOpenLearning,
}: AuraTodayFlowProps) {
  const calorieDelta = calorieGoal - caloriesConsumed
  const calorieProgress = percent(caloriesConsumed, calorieGoal)
  const proteinProgress = percent(proteinConsumed, proteinGoal)
  const hasMeal = mealsCount > 0
  const hydrated = waterMl >= 1200

  const dayState = !hasMeal
    ? { label: 'Sẵn sàng khởi động', detail: 'Một bữa ăn được ghi sẽ giúp Aura bắt đầu cá nhân hóa nhịp hôm nay.' }
    : calorieDelta < 0
      ? { label: 'Cân bằng nhẹ nhàng', detail: `Bạn đang cao hơn mục tiêu ${formatNumber(Math.abs(calorieDelta))} kcal. Không cần nhịn bù, chỉ cần trở lại nhịp đều.` }
      : calorieProgress >= 80 && proteinProgress >= 75
        ? { label: 'Đang đúng nhịp', detail: 'Năng lượng và đạm đang tiến gần mục tiêu. Hãy duy trì lựa chọn hiện tại.' }
        : { label: 'Còn dư địa tốt', detail: `Bạn còn ${formatNumber(calorieDelta)} kcal và ${formatNumber(Math.max(0, proteinGoal - proteinConsumed))}g đạm cho phần còn lại của ngày.` }

  const missions = [
    {
      id: 'check-in',
      label: 'Đánh dấu ngày mới',
      detail: checkedIn ? 'Đã điểm danh và giữ chuỗi thói quen.' : 'Điểm danh để nhận 50 XP hôm nay.',
      complete: checkedIn,
      icon: <Footprints size={18} />,
      action: onCheckIn,
      tone: 'pink',
    },
    {
      id: 'meal',
      label: 'Ghi ít nhất một bữa',
      detail: hasMeal ? `${mealsCount} bữa · ${formatNumber(caloriesConsumed)} kcal đã ghi.` : 'Chụp hoặc chọn món để cập nhật năng lượng.',
      complete: hasMeal,
      icon: <Utensils size={18} />,
      action: onOpenNutrition,
      tone: 'orange',
    },
    {
      id: 'water',
      label: 'Giữ nhịp uống nước',
      detail: hydrated ? `${formatNumber(waterMl)} ml · nhịp nước đang tốt.` : `${formatNumber(waterMl)} / 1.200 ml cho mốc tiếp theo.`,
      complete: hydrated,
      icon: <Droplets size={18} />,
      action: onOpenNutrition,
      tone: 'coral',
    },
  ]
  const completedMissions = missions.filter((mission) => mission.complete).length

  const timeline = [
    { time: 'SÁNG', label: 'Khởi động ngày', detail: checkedIn ? 'Đã điểm danh' : 'Chờ điểm danh', complete: checkedIn },
    { time: 'TRƯA', label: 'Ghi bữa & năng lượng', detail: hasMeal ? `${mealsCount} bữa đã ghi` : 'Chưa có dữ liệu', complete: hasMeal },
    { time: 'CHIỀU', label: 'Giữ nhịp nước', detail: waterMl ? `${formatNumber(waterMl)} ml` : 'Bổ sung nước', complete: hydrated },
    { time: 'TỐI', label: 'Một bước học tập', detail: learningTitle ?? 'Khám phá Aura Academy', complete: learningProgress >= 100 },
  ]
  const currentTimelineIndex = timeline.findIndex((item) => !item.complete)

  const nextAction = !checkedIn
    ? { eyebrow: 'BƯỚC NHẸ NHẤT', title: 'Điểm danh để bắt đầu nhịp hôm nay', detail: 'Chỉ mất một chạm và giúp Aura ghi nhận chuỗi thói quen của bạn.', label: 'Điểm danh +50 XP', action: onCheckIn, icon: <Flame size={20} /> }
    : !hasMeal
      ? { eyebrow: 'VIỆC NÊN LÀM TIẾP', title: 'Ghi bữa đầu tiên trong ngày', detail: 'Aura sẽ cập nhật calo còn lại và gợi ý cân bằng phù hợp ngay sau khi bạn ghi bữa.', label: 'Mở Dinh dưỡng', action: onOpenNutrition, icon: <Utensils size={20} /> }
      : !hydrated
        ? { eyebrow: 'VIỆC NÊN LÀM TIẾP', title: 'Bổ sung một cốc nước', detail: `Bạn đang ở ${formatNumber(waterMl)} ml. Một bước nhỏ sẽ đưa nhịp nước hôm nay tiến gần mục tiêu hơn.`, label: 'Ghi nước uống', action: onOpenNutrition, icon: <Droplets size={20} /> }
        : { eyebrow: 'GIỮ ĐÀ TỐT', title: 'Dành một nhịp ngắn cho việc học', detail: learningTitle ? `Tiếp tục “${learningTitle}” từ vị trí bạn đã dừng.` : 'Khám phá một bài học ngắn phù hợp với hành trình của bạn.', label: learningTitle ? 'Tiếp tục học' : 'Mở Academy', action: onOpenLearning, icon: <BookOpenCheck size={20} /> }

  const ringStyle = { '--today-progress': `${calorieProgress * 3.6}deg` } as CSSProperties

  return (
    <section className="aura-today-flow" aria-labelledby="aura-today-flow-title">
      <header className="aura-today-flow__heading">
        <div>
          <span><Sparkles size={15} /> AURA TODAY FLOW</span>
          <h2 id="aura-today-flow-title">Nhịp hôm nay của {firstName}</h2>
          <p>Một góc nhìn gọn về năng lượng, nhiệm vụ và bước nên làm tiếp theo.</p>
        </div>
        <div className="aura-today-flow__streak"><Flame size={16} fill="currentColor" /><strong>{loggingStreak}</strong><span>ngày ghi bữa</span></div>
      </header>

      <div className="aura-today-flow__summary">
        <article className="aura-today-flow__state">
          <span className="aura-today-flow__state-label"><Target size={15} /> TRẠNG THÁI NGÀY</span>
          <h3>{dayState.label}</h3>
          <p>{dayState.detail}</p>
          <small>Mục tiêu · {goalLabel}</small>
        </article>

        <article className="aura-today-flow__energy">
          <div className="aura-today-flow__ring" style={ringStyle}>
            <div><strong>{calorieDelta >= 0 ? formatNumber(calorieDelta) : `+${formatNumber(Math.abs(calorieDelta))}`}</strong><span>{calorieDelta >= 0 ? 'kcal còn lại' : 'kcal vượt'}</span></div>
          </div>
          <div className="aura-today-flow__energy-copy">
            <span>NĂNG LƯỢNG HÔM NAY</span>
            <strong>{formatNumber(caloriesConsumed)} <small>/ {formatNumber(calorieGoal)} kcal</small></strong>
            <div><i style={{ width: `${calorieProgress}%` }} /></div>
            <p>{formatNumber(proteinConsumed)}g đạm · {formatNumber(waterMl)}ml nước</p>
          </div>
        </article>
      </div>

      <div className="aura-today-flow__section-title">
        <div><span>NHIỆM VỤ MỖI NGÀY</span><h3>3 Daily Missions</h3></div>
        <strong>{completedMissions}/3 hoàn thành</strong>
      </div>
      <div className="aura-today-flow__missions">
        {missions.map((mission) => (
          <button type="button" key={mission.id} className={`aura-today-flow__mission is-${mission.tone} ${mission.complete ? 'is-complete' : ''}`} onClick={mission.action} disabled={mission.id === 'check-in' && mission.complete}>
            <span>{mission.complete ? <Check size={18} /> : mission.icon}</span>
            <div><strong>{mission.label}</strong><small>{mission.detail}</small></div>
            <ChevronRight size={17} />
          </button>
        ))}
      </div>

      <div className="aura-today-flow__section-title aura-today-flow__section-title--timeline">
        <div><span>NHỊP TRONG NGÀY</span><h3>Timeline hôm nay</h3></div>
      </div>
      <div className="aura-today-flow__timeline">
        {timeline.map((item, index) => (
          <div className={item.complete ? 'is-complete' : index === currentTimelineIndex ? 'is-current' : ''} key={item.time}>
            <span>{item.complete ? <Check size={13} /> : index + 1}</span>
            <small>{item.time}</small>
            <strong>{item.label}</strong>
            <p>{item.detail}</p>
          </div>
        ))}
      </div>

      <article className="aura-today-flow__next">
        <span>{nextAction.icon}</span>
        <div><small>{nextAction.eyebrow}</small><h3>{nextAction.title}</h3><p>{nextAction.detail}</p></div>
        <button type="button" onClick={nextAction.action}>{nextAction.label} <ArrowRight size={16} /></button>
      </article>
    </section>
  )
}
