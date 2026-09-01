import React from 'react'
import { ArrowRight, Bot, CheckCircle2, ClipboardList, Dumbbell, Sparkles, Target } from 'lucide-react'

export interface AiWeeklySummary {
  mealLoggedDays: number
  mealCount: number
  waterLoggedDays: number
  workoutDays: number
  weightLogCount: number
}

interface AiWeeklyAnalysisCardProps {
  onOpenCoach: () => void
  onPrepareCoach?: () => void
  summary: AiWeeklySummary
}

export function AiWeeklyAnalysisCard({ onOpenCoach, onPrepareCoach, summary }: AiWeeklyAnalysisCardProps) {
  const hasEnoughNutritionData = summary.mealLoggedDays >= 3
  const priorities: string[] = []

  if (summary.mealLoggedDays < 3) priorities.push('Ghi ít nhất một bữa trong ngày để Aura hiểu nhịp ăn thực tế hơn.')
  if (summary.waterLoggedDays < 3) priorities.push('Ghi lượng nước ở một vài thời điểm cố định, không cần cố đạt số hoàn hảo.')
  if (summary.workoutDays === 0) priorities.push('Ghi một hoạt động nhẹ hoặc buổi tập để lời khuyên phục hồi có đúng ngữ cảnh.')
  if (priorities.length === 0) priorities.push('Tiếp tục ghi nhận đều đặn; Aura sẽ ưu tiên thay đổi nhỏ dựa trên xu hướng nhiều ngày.')

  return (
    <div className="pg-ai-card">
      <div className="pg-ai-card-inner">
        <div className="pg-ai-robot-badge"><Bot size={28} /></div>
        <div className="pg-ai-review-content">
          <div className="pg-ai-eyebrow"><Sparkles size={16} /> Tổng quan dữ liệu 7 ngày</div>
          <h3>{hasEnoughNutritionData ? 'Aura đã có đủ dữ liệu để cùng bạn nhìn lại' : 'Cần thêm vài ngày ghi nhận để tư vấn chính xác'}</h3>
          <p className="pg-ai-review-lead">
            {hasEnoughNutritionData
              ? 'Các số dưới đây lấy trực tiếp từ nhật ký của bạn, không dùng dữ liệu mẫu.'
              : 'Aura sẽ nói rõ phần còn thiếu thay vì tự suy đoán cân nặng, khẩu phần hay nguyên nhân tiến độ.'}
          </p>

          <div className="pg-ai-review-stats" aria-label="Dữ liệu bảy ngày gần nhất">
            <div><ClipboardList size={17} /><span><strong>{summary.mealLoggedDays}/7 ngày</strong> có bữa ăn · {summary.mealCount} bữa</span></div>
            <div><Dumbbell size={17} /><span><strong>{summary.workoutDays} ngày</strong> có vận động</span></div>
            <div><Target size={17} /><span><strong>{summary.waterLoggedDays} ngày</strong> có ghi nước · {summary.weightLogCount} lần cân</span></div>
          </div>

          <div className="pg-ai-priority-box">
            <span>Việc nhỏ giúp Aura hiểu bạn hơn</span>
            {priorities.slice(0, 2).map((item) => (
              <div key={item}><CheckCircle2 size={16} /><p>{item}</p></div>
            ))}
          </div>

          <button type="button" onPointerEnter={onPrepareCoach} onPointerDown={onPrepareCoach} onFocus={onPrepareCoach} onClick={onOpenCoach} className="pg-ai-review-action">
            <span>{hasEnoughNutritionData ? 'Cùng Aura phân tích và trò chuyện' : 'Tâm sự với Aura ngay cả khi chưa đủ dữ liệu'}</span>
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
