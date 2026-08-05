import React, { useState, useEffect, useRef } from 'react'
import {
  Activity,
  Bike,
  Bot,
  Calendar,
  Check,
  ChevronDown,
  Clock3,
  Droplet,
  Dumbbell,
  Flame,
  Footprints,
  HeartPulse,
  Laugh,
  Smile,
  Sparkles,
  Utensils,
  Waves,
  X,
  Zap
} from 'lucide-react'

export type WorkoutActivityKind = 'strength' | 'running' | 'walking' | 'cycling' | 'hiit' | 'swimming' | 'yoga' | 'other'
export type WorkoutIntensityLevel = 'low' | 'moderate' | 'high'

export interface WorkoutLogDraft {
  startTime: string
  kind: WorkoutActivityKind
  title: string
  durationMinutes: number
  intensity: WorkoutIntensityLevel
  estimatedCalories: number
  met: number
  weightKgAtEstimate: number
}

export interface WorkoutLogSheetProps {
  dateLabel?: string
  weightKg?: number
  onClose: () => void
  onSave: (activity: WorkoutLogDraft) => void
}

const ACTIVITY_LIST: Array<{
  value: WorkoutActivityKind
  label: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  met: Record<WorkoutIntensityLevel, number>
}> = [
  { value: 'strength', label: 'Tập tạ', icon: Dumbbell, met: { low: 3.0, moderate: 5.5, high: 6.0 } },
  { value: 'running', label: 'Chạy bộ', icon: Flame, met: { low: 6.0, moderate: 8.3, high: 11.0 } },
  { value: 'walking', label: 'Đi bộ', icon: Footprints, met: { low: 2.8, moderate: 3.5, high: 4.8 } },
  { value: 'cycling', label: 'Đạp xe', icon: Bike, met: { low: 4.0, moderate: 6.8, high: 10.0 } },
  { value: 'hiit', label: 'HIIT', icon: Zap, met: { low: 5.0, moderate: 8.0, high: 10.5 } },
  { value: 'swimming', label: 'Bơi lội', icon: Waves, met: { low: 4.5, moderate: 6.0, high: 9.0 } },
  { value: 'yoga', label: 'Yoga', icon: Sparkles, met: { low: 2.0, moderate: 3.0, high: 4.0 } },
  { value: 'other', label: 'Hoạt động khác', icon: Activity, met: { low: 2.5, moderate: 4.0, high: 6.0 } },
]

export function WorkoutLogSheet({ dateLabel = 'hôm nay', weightKg = 60, onClose, onSave }: WorkoutLogSheetProps) {
  const now = new Date()
  const defaultTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  const [kind, setKind] = useState<WorkoutActivityKind>('strength')
  const [startTime, setStartTime] = useState(defaultTime)
  const [durationMinutes, setDurationMinutes] = useState(30)
  const [intensity, setIntensity] = useState<WorkoutIntensityLevel>('moderate')
  const [activitySelectorOpen, setActivitySelectorOpen] = useState(false)

  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const option = ACTIVITY_LIST.find((item) => item.value === kind) ?? ACTIVITY_LIST[0]
  const safeDuration = Number.isFinite(durationMinutes) ? Math.min(600, Math.max(1, Math.round(durationMinutes))) : 1
  const met = option.met[intensity]
  
  const estimatedCalories = Math.round((met * 3.5 * Math.max(30, weightKg) / 200) * safeDuration)
  const caloriesPerMinute = ((met * 3.5 * Math.max(30, weightKg)) / 200).toFixed(1)

  // Impact Score
  const baseIntensityScore = intensity === 'high' ? 82 : intensity === 'moderate' ? 70 : 45
  const durationBonus = Math.min(safeDuration / 3, 15)
  const impactScore = Math.min(100, Math.round(baseIntensityScore + durationBonus))

  // Recommendations
  const recoveryHours = intensity === 'high' ? 36 : intensity === 'moderate' ? 24 : 12
  const hydrationMl = Math.round(Math.max(300, safeDuration * 15))
  const proteinRange = kind === 'strength' || kind === 'hiit' ? '20–25 g' : '12–18 g'

  // AI Insight sentence
  const getAiInsight = () => {
    if (kind === 'strength' && intensity === 'moderate') {
      return 'Buổi tập cường độ vừa giúp đốt cháy calo hiệu quả và cải thiện sức mạnh cơ bắp.'
    }
    if (kind === 'strength' && intensity === 'high') {
      return 'Buổi tập tạ cường độ cao kích thích tối đa sự phát triển cơ bắp và phục hồi năng lượng.'
    }
    if (intensity === 'high') {
      return 'Bài tập cường độ cao tiêu tốn nhiều calo. Hãy chú ý bổ sung đủ nước và bù đạm sau tập.'
    }
    if (kind === 'running' || kind === 'cycling' || kind === 'hiit') {
      return 'Bài tập cardio giúp nâng cao sức bền tim mạch và thúc đẩy quá trình trao đổi chất.'
    }
    return `Hoạt động ${option.label.toLowerCase()} giúp duy trì thể lực dồi dào và tinh thần sảng khoái.`
  }

  const handleSubmit = () => {
    if (!safeDuration || !startTime) return
    onSave({
      startTime,
      kind,
      title: option.label,
      durationMinutes: safeDuration,
      intensity,
      estimatedCalories,
      met,
      weightKgAtEstimate: weightKg,
    })
  }

  const SelectedIcon = option.icon

  return (
    <div
      className="workout-log-sheet-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div ref={modalRef} className="workout-log-sheet-modal">
        {/* Header */}
        <div className="wls-header">
          <div className="wls-header-left">
            <div className="wls-header-icon">
              <Dumbbell size={22} strokeWidth={2.5} />
            </div>
            <div className="wls-header-title">
              <h2>Ghi buổi tập</h2>
              <p>Theo dõi để tiến bộ mỗi ngày</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="wls-close-btn"
            aria-label="Đóng"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <div className="wls-body">
          {/* 1. Activity Selector */}
          <div className="wls-field-group">
            <span className="wls-field-label">Loại hoạt động</span>
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setActivitySelectorOpen(!activitySelectorOpen)}
                className="wls-activity-btn"
              >
                <div className="wls-activity-btn-left">
                  <div className="wls-activity-icon">
                    <SelectedIcon size={20} />
                  </div>
                  <span className="wls-activity-name">{option.label}</span>
                </div>
                <ChevronDown
                  size={18}
                  style={{
                    color: '#94a3b8',
                    transform: activitySelectorOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.2s',
                  }}
                />
              </button>

              {/* Activity Dropdown Grid */}
              {activitySelectorOpen && (
                <div className="wls-activity-menu">
                  {ACTIVITY_LIST.map((item) => {
                    const ItemIcon = item.icon
                    const isSelected = kind === item.value
                    return (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => {
                          setKind(item.value)
                          setActivitySelectorOpen(false)
                        }}
                        className={`wls-activity-option ${isSelected ? 'active' : ''}`}
                      >
                        <span
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 24,
                            height: 24,
                            borderRadius: 6,
                            background: isSelected ? '#e11d48' : '#e2e8f0',
                            color: isSelected ? '#fff' : '#475569',
                          }}
                        >
                          <ItemIcon size={14} />
                        </span>
                        {item.label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 2. Start Time */}
          <div className="wls-time-row">
            <div className="wls-time-left">
              <Clock3 size={17} style={{ color: '#db2777' }} />
              <span>Thời gian bắt đầu</span>
            </div>
            <div className="wls-time-pill">
              <Calendar size={13} />
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
          </div>

          {/* 3. Duration */}
          <div className="wls-field-group">
            <div className="wls-duration-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Clock3 size={17} style={{ color: '#db2777' }} />
                <h3>Thời lượng</h3>
              </div>
              <span>Tối đa 600 phút</span>
            </div>

            {/* Quick Presets */}
            <div className="wls-duration-presets">
              {[15, 30, 45, 60].map((mins) => {
                const isSelected = safeDuration === mins
                return (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => setDurationMinutes(mins)}
                    className={`wls-duration-preset-btn ${isSelected ? 'active' : ''}`}
                  >
                    {mins} phút
                  </button>
                )
              })}
            </div>

            {/* Slider Card */}
            <div className="wls-slider-card">
              <div className="wls-slider-val">
                {safeDuration}
                <span>phút</span>
              </div>
              <input
                type="range"
                min={1}
                max={120}
                step={1}
                value={safeDuration}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                className="wls-slider-input"
              />
              <div className="wls-slider-labels">
                <span>0</span>
                <span>600</span>
              </div>
            </div>
          </div>

          {/* 4. Intensity Selector */}
          <div className="wls-field-group">
            <div className="wls-field-label">
              <Activity size={16} style={{ color: '#db2777' }} />
              <span>Cường độ</span>
            </div>
            <div className="wls-intensity-grid">
              {[
                { level: 'low', label: 'Nhẹ', icon: Smile },
                { level: 'moderate', label: 'Vừa', icon: Laugh },
                { level: 'high', label: 'Cao', icon: Flame },
              ].map(({ level, label, icon: Icon }) => {
                const isSelected = intensity === level
                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setIntensity(level as WorkoutIntensityLevel)}
                    className={`wls-intensity-card ${isSelected ? 'active' : ''}`}
                  >
                    <Icon size={18} style={{ color: isSelected ? '#e11d48' : '#94a3b8' }} />
                    <span>{label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 5. Calorie & Impact Summary Card */}
          <div className="wls-summary-card">
            <div className="wls-summary-top">
              <div className="wls-summary-burned">
                <span className="wls-summary-title">
                  <Flame size={14} style={{ color: '#f97316', fill: '#f97316' }} /> Tiêu hao ước tính
                </span>
                <div className="wls-summary-value">
                  {estimatedCalories}
                  <span>kcal</span>
                </div>
                <div className="wls-summary-rate">
                  ≈ {caloriesPerMinute} kcal/phút
                </div>
                <div className="wls-summary-dots">
                  {Array.from({ length: 20 }).map((_, idx) => {
                    const activeRatio = Math.min(1, estimatedCalories / 400)
                    const isActive = idx / 20 <= activeRatio
                    return (
                      <span
                        key={idx}
                        className={`wls-summary-dot ${isActive ? 'active' : ''}`}
                      />
                    )
                  })}
                </div>
              </div>

              {/* Impact Score Gauge */}
              <div className="wls-gauge-container">
                <div className="wls-gauge-wrapper">
                  <svg viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)', width: '100%', height: '100%' }}>
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#f1f5f9" strokeWidth="8" />
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      fill="none"
                      stroke="url(#wlsImpactGrad)"
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray={251.2}
                      strokeDashoffset={251.2 - (impactScore / 100) * 251.2}
                      style={{ transition: 'stroke-dashoffset 0.5s ease' }}
                    />
                    <defs>
                      <linearGradient id="wlsImpactGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#db2777" />
                        <stop offset="100%" stopColor="#f97316" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="wls-gauge-center">
                    <div className="wls-gauge-score">{impactScore}</div>
                    <div className="wls-gauge-label">Impact</div>
                  </div>
                </div>
                <span className="wls-gauge-subtext">Tuyệt vời!</span>
              </div>
            </div>

            {/* Recommendations */}
            <div className="wls-recs-grid">
              <div className="wls-rec-item">
                <span className="wls-rec-label">
                  <HeartPulse size={12} style={{ color: '#10b981' }} /> Recovery
                </span>
                <span className="wls-rec-val">{recoveryHours} giờ</span>
              </div>
                <div className="wls-rec-item">
                <span className="wls-rec-label">
                  <Droplet size={12} style={{ color: '#3b82f6' }} /> Hydration
                </span>
                <span className="wls-rec-val">{hydrationMl} ml</span>
              </div>
              <div className="wls-rec-item">
                <span className="wls-rec-label">
                  <Utensils size={12} style={{ color: '#a855f7' }} /> Protein
                </span>
                <span className="wls-rec-val">{proteinRange}</span>
              </div>
            </div>
          </div>

          {/* 6. AI Insight Card */}
          <div className="wls-ai-card">
            <div className="wls-ai-left">
              <span className="wls-ai-title">
                <Sparkles size={14} style={{ fill: '#db2777' }} /> AI Insight
              </span>
              <p className="wls-ai-text">{getAiInsight()}</p>
            </div>
            <div className="wls-ai-robot">
              <Bot size={24} />
            </div>
          </div>
        </div>

        {/* Save Workout Button */}
        <div className="wls-footer">
          <button
            type="button"
            disabled={!safeDuration || !startTime}
            onClick={handleSubmit}
            className="wls-save-btn"
          >
            <Check size={20} strokeWidth={3} />
            <span>Lưu buổi tập</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default WorkoutLogSheet
