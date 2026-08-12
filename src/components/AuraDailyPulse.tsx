import { ArrowRight, Flame, Sparkles } from 'lucide-react'
import '../styles-home-pulse.css'

interface AuraDailyPulseProps {
  firstName: string
  goalLabel: string
  caloriesConsumed: number
  calorieGoal: number
  proteinConsumed: number
  proteinGoal: number
  waterMl: number
  mealsCount: number
  loggingStreak: number
  onOpenNutrition: () => void
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value)
}

function percent(value: number, goal: number) {
  return Math.min(100, Math.max(0, Math.round((value / Math.max(goal, 1)) * 100)))
}

export default function AuraDailyPulse({
  firstName,
  goalLabel,
  caloriesConsumed,
  calorieGoal,
  proteinConsumed,
  proteinGoal,
  waterMl,
  mealsCount,
  loggingStreak,
  onOpenNutrition,
}: AuraDailyPulseProps) {
  const calorieDelta = calorieGoal - caloriesConsumed
  const proteinRemaining = Math.max(0, proteinGoal - proteinConsumed)
  const caloriePercent = percent(caloriesConsumed, calorieGoal)
  const dataCompleteness = Math.round(([
    mealsCount > 0,
    waterMl > 0,
    mealsCount > 0 && proteinConsumed > 0,
  ].filter(Boolean).length / 3) * 100)

  const pulseState = mealsCount === 0
    ? { label: 'Sẵn sàng bắt đầu', detail: 'Ghi bữa đầu tiên để Aura tạo nhịp dinh dưỡng cho hôm nay.' }
    : calorieDelta < 0
      ? { label: 'Điều chỉnh nhẹ', detail: `Đang vượt ${formatNumber(Math.abs(calorieDelta))} kcal; ưu tiên nước, rau và vận động nhẹ.` }
      : caloriePercent >= 80 && percent(proteinConsumed, proteinGoal) >= 75
        ? { label: 'Đang đúng nhịp', detail: 'Năng lượng và đạm đang tiến gần mục tiêu. Hãy duy trì lựa chọn hiện tại.' }
        : { label: 'Còn dư địa tốt', detail: `Còn ${formatNumber(calorieDelta)} kcal và ${formatNumber(proteinRemaining)}g đạm cho phần còn lại của ngày.` }

  return (
    <section className="aura-daily-pulse" aria-labelledby="aura-daily-pulse-title">
      <div className="aura-daily-pulse__glow" aria-hidden="true" />
      <header className="aura-daily-pulse__header">
        <div>
          <span><Sparkles size={15} /> AURA DAILY PULSE</span>
          <h2 id="aura-daily-pulse-title">Chào {firstName}, {pulseState.label.toLocaleLowerCase('vi-VN')}</h2>
          <p>Hôm nay · Mục tiêu {goalLabel.toLocaleLowerCase('vi-VN')}</p>
        </div>
        <div className="aura-daily-pulse__streak" title="Chuỗi ngày ghi nhật ký dinh dưỡng liên tiếp">
          <Flame size={17} fill="currentColor" />
          <strong>{loggingStreak}</strong>
          <span>ngày liên tiếp</span>
        </div>
      </header>

      <div className="aura-daily-pulse__body">
        <div className="aura-daily-pulse__energy">
          <span className={calorieDelta < 0 ? 'is-over' : ''}>
            {calorieDelta >= 0 ? formatNumber(calorieDelta) : `+${formatNumber(Math.abs(calorieDelta))}`}
          </span>
          <div>
            <strong>{calorieDelta >= 0 ? 'kcal còn lại' : 'kcal vượt mức'}</strong>
            <small>{formatNumber(caloriesConsumed)} / {formatNumber(calorieGoal)} kcal đã ghi</small>
          </div>
        </div>
        <div className="aura-daily-pulse__status">
          <strong>{pulseState.label}</strong>
          <p>{pulseState.detail}</p>
        </div>
      </div>

      <div className="aura-daily-pulse__footer">
        <div>
          <span>Mức đầy đủ dữ liệu</span>
          <strong>{dataCompleteness}%</strong>
        </div>
        <div className="aura-daily-pulse__completeness" role="progressbar" aria-label={`Mức đầy đủ dữ liệu ${dataCompleteness}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={dataCompleteness}>
          <span style={{ width: `${dataCompleteness}%` }} />
        </div>
        <button type="button" onClick={onOpenNutrition}>Mở Dinh dưỡng <ArrowRight size={14} /></button>
      </div>
    </section>
  )
}
