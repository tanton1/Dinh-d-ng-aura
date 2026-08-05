import React from 'react'
import { ChevronRight, Info } from 'lucide-react'

interface NutritionProgressCardProps {
  onOpenDetails?: () => void
  onLogMeal?: () => void
  avgCalories?: number
  targetCalories?: number
  proteinGrams?: number
  proteinGoal?: number
  carbGrams?: number
  carbGoal?: number
  fatGrams?: number
  fatGoal?: number
  fiberGrams?: number
  fiberGoal?: number
  waterMl?: number
  waterGoal?: number
  activeDays?: number
}

function getNutrientStatus(actual: number, target: number, label: string) {
  if (target <= 0) return { text: 'Chưa đặt', bg: '#f1f5f9', fg: '#64748b' }
  const ratio = actual / target
  if (label.toLowerCase().includes('protein')) {
    if (ratio < 0.8) return { text: 'Thiếu', bg: '#fef3c7', fg: '#d97706' }
    return { text: 'Đạt', bg: '#ecfdf5', fg: '#059669' }
  }
  if (ratio < 0.8) return { text: 'Thiếu', bg: '#fef3c7', fg: '#d97706' }
  if (ratio <= 1.1) return { text: 'Đạt', bg: '#ecfdf5', fg: '#059669' }
  if (ratio <= 1.25) return { text: 'Vượt nhẹ', bg: '#ffedd5', fg: '#ea580c' }
  return { text: 'Vượt nhiều', bg: '#fee2e2', fg: '#dc2626' }
}

export function NutritionProgressCard({
  onOpenDetails,
  onLogMeal,
  avgCalories = 0,
  targetCalories = 2200,
  proteinGrams = 0,
  proteinGoal = 125,
  carbGrams = 0,
  carbGoal = 250,
  fatGrams = 0,
  fatGoal = 70,
  fiberGrams = 0,
  fiberGoal = 25,
  waterMl = 0,
  waterGoal = 2000,
  activeDays = 0,
}: NutritionProgressCardProps = {}) {
  const calPercent = targetCalories > 0 ? Math.round((avgCalories / targetCalories) * 100) : 0

  const items = [
    { label: 'Protein', actual: proteinGrams, target: proteinGoal, unit: 'g', color: '#f72567' },
    { label: 'Carb', actual: carbGrams, target: carbGoal, unit: 'g', color: '#ff7a38' },
    { label: 'Chất béo', actual: fatGrams, target: fatGoal, unit: 'g', color: '#8b5cf6' },
    { label: 'Chất xơ', actual: fiberGrams, target: fiberGoal, unit: 'g', color: '#10b981' },
    { label: 'Nước uống', actual: waterMl, target: waterGoal, unit: 'ml', color: '#0284c7' },
  ]

  const radius = 42
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (Math.min(100, calPercent) / 100) * circumference

  if (activeDays === 0) {
    return (
      <div className="pg-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', margin: 0 }}>Dinh dưỡng tuần này</h2>
            <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>
              Chưa ghi nhận dữ liệu
            </span>
          </div>
        </div>

        <div style={{ background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 12, padding: '24px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: '#1e293b' }}>
              Chưa có dữ liệu dinh dưỡng tuần này
            </span>
            <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>
              Hãy bắt đầu ghi nhận các bữa ăn hôm nay để Aura phân tích lượng calo và dinh dưỡng đa lượng cho bạn.
            </span>
          </div>

          <button
            type="button"
            onClick={onLogMeal}
            style={{
              padding: '8px 20px',
              background: '#f72567',
              color: '#ffffff',
              border: 'none',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 2px 4px rgba(247, 37, 103, 0.1)'
            }}
          >
            Ghi bữa ăn ngay
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="pg-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', margin: 0 }}>Dinh dưỡng tuần này</h2>
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>
            Dữ liệu ghi nhận: <strong style={{ color: '#0f172a' }}>{activeDays}/7 ngày</strong>
          </span>
        </div>
        <button
          type="button"
          onClick={onOpenDetails}
          style={{
            background: 'none',
            border: 'none',
            color: '#f72567',
            fontWeight: 700,
            fontSize: 12,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            padding: 0,
          }}
        >
          <span>Chi tiết</span>
          <ChevronRight size={14} />
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 20, alignItems: 'start' }}>
        {/* Circle Calorie Gauge */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', paddingTop: 8 }}>
          <div style={{ position: 'relative', width: 104, height: 104 }}>
            <svg viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)', width: '100%', height: '100%' }}>
              <circle cx="50" cy="50" r={radius} fill="none" stroke="#fce7f3" strokeWidth="9" />
              <circle
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke="url(#pgNutriGrad)"
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
              />
              <defs>
                <linearGradient id="pgNutriGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#f72567" />
                  <stop offset="100%" stopColor="#ff7a38" />
                </linearGradient>
              </defs>
            </svg>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ fontSize: 18, fontWeight: 900, color: '#0f172a', lineHeight: 1.1 }}>{avgCalories.toLocaleString('vi-VN')}</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', marginTop: 1 }}>/ {targetCalories.toLocaleString('vi-VN')}</span>
              <span style={{ fontSize: 8, fontWeight: 800, color: '#94a3b8' }}>kcal/ngày</span>
            </div>
          </div>
          <span style={{ fontSize: 12, fontWeight: 800, color: calPercent < 80 ? '#d97706' : '#10b981', marginTop: 8 }}>
            {calPercent}% mục tiêu
          </span>
        </div>

        {/* Detailed Macros List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((m) => {
            const percent = m.target > 0 ? Math.round((m.actual / m.target) * 100) : 0
            const status = getNutrientStatus(m.actual, m.target, m.label)

            return (
              <div key={m.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {/* Micro Label & Values */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: '#1e293b' }}>{m.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginTop: 1 }}>
                      {m.actual} / {m.target} {m.unit}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#0f172a' }}>{percent}% mục tiêu</span>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 800,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: status.bg,
                        color: status.fg,
                      }}
                    >
                      {status.text}
                    </span>
                  </div>
                </div>

                {/* Progress Bar */}
                <div style={{ width: '100%', height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${Math.min(100, percent)}%`,
                      height: '100%',
                      background: m.color,
                      borderRadius: 3,
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
