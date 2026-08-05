import React from 'react'
import { Sparkles } from 'lucide-react'
import type { ProgressCategory, ProgressPeriod } from '../../types/progressTypes'

interface ProgressHeaderProps {
  period: ProgressPeriod
  onPeriodChange: (p: ProgressPeriod) => void
  category: ProgressCategory
  onCategoryChange: (c: ProgressCategory) => void
  onOpenCoach: () => void
}

export function ProgressHeader({
  period,
  onPeriodChange,
  category,
  onCategoryChange,
  onOpenCoach,
}: ProgressHeaderProps) {
  const periodOptions: Array<{ id: ProgressPeriod; label: string }> = [
    { id: '7-days', label: '7 ngày' },
    { id: '30-days', label: '30 ngày' },
    { id: '90-days', label: '90 ngày' },
    { id: 'all', label: 'Tất cả' },
  ]

  const categoryOptions: Array<{ id: ProgressCategory; label: string }> = [
    { id: 'overview', label: 'Tổng quan' },
    { id: 'body', label: 'Cơ thể' },
    { id: 'nutrition', label: 'Dinh dưỡng' },
    { id: 'workout', label: 'Vận động' },
    { id: 'achievements', label: 'Thành tích' },
  ]

  return (
    <div className="pg-header-container">
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="pg-header-left">
            <h1>Tiến độ</h1>
            <p>Theo dõi hành trình thay đổi của cơ thể, dinh dưỡng và thói quen mỗi ngày.</p>
          </div>
          <button type="button" onClick={onOpenCoach} className="pg-coach-trigger-btn">
            <Sparkles size={18} />
            <span>AI Coach</span>
          </button>
        </div>

        {/* Time Period selector */}
        <div className="pg-period-bar" style={{ marginTop: 18 }}>
          {periodOptions.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onPeriodChange(opt.id)}
              className={`pg-period-btn ${period === opt.id ? 'active' : ''}`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Category Pills */}
        <div className="pg-category-nav">
          {categoryOptions.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => onCategoryChange(cat.id)}
              className={`pg-category-pill ${category === cat.id ? 'active' : ''}`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
