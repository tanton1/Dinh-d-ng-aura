import React from 'react'
import { Activity, BicepsFlexed, ChevronRight, CircleDot, Info, PersonStanding } from 'lucide-react'
import type { BodyMeasurements } from '../../types/progressTypes'

interface BodyMetricsCardProps {
  metrics?: BodyMeasurements
  onOpenDetails: () => void
}

const defaultMetrics: BodyMeasurements = {
  bmi: 23.0,
  bmiCategory: 'Khỏe mạnh',
  bodyFatPercentage: 21.3,
  bodyFatStatus: 'Ổn định',
  muscleMassKg: 27.6,
  muscleStatus: 'Tốt',
  waistCm: 76,
  waistStatus: 'Tốt',
  updatedAt: '2026-08-04',
}

export function BodyMetricsCard({
  metrics = defaultMetrics,
  onOpenDetails,
}: BodyMetricsCardProps) {
  return (
    <div className="pg-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <h2 style={{ fontSize: 17, fontWeight: 800, color: '#0f172a', margin: 0 }}>Chỉ số cơ thể</h2>
          <Info size={16} style={{ color: '#cbd5e1' }} />
        </div>
        <button
          type="button"
          onClick={onOpenDetails}
          style={{
            background: 'none',
            border: 'none',
            color: '#ec4899',
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <span>Chi tiết</span>
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="pg-metrics-grid">
        {/* 1. BMI */}
        <div className="pg-metric-card">
          <div className="pg-metric-icon" style={{ background: '#fce7f3', color: '#db2777' }}>
            <PersonStanding size={22} />
          </div>
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>BMI</span>
            <strong style={{ display: 'block', fontSize: 18, fontWeight: 900, color: '#0f172a', marginTop: 2 }}>
              {metrics.bmi.toFixed(1)}
            </strong>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#10b981' }}>{metrics.bmiCategory}</span>
          </div>
        </div>

        {/* 2. Body Fat */}
        <div className="pg-metric-card">
          <div className="pg-metric-icon" style={{ background: '#ffedd5', color: '#ea580c' }}>
            <CircleDot size={22} />
          </div>
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>Mỡ cơ thể</span>
            <strong style={{ display: 'block', fontSize: 18, fontWeight: 900, color: '#0f172a', marginTop: 2 }}>
              {metrics.bodyFatPercentage}%
            </strong>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#ea580c' }}>{metrics.bodyFatStatus}</span>
          </div>
        </div>

        {/* 3. Muscle Mass */}
        <div className="pg-metric-card">
          <div className="pg-metric-icon" style={{ background: '#d1fae5', color: '#059669' }}>
            <BicepsFlexed size={22} />
          </div>
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>Khối cơ</span>
            <strong style={{ display: 'block', fontSize: 18, fontWeight: 900, color: '#0f172a', marginTop: 2 }}>
              {metrics.muscleMassKg} kg
            </strong>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#059669' }}>{metrics.muscleStatus}</span>
          </div>
        </div>

        {/* 4. Waist */}
        <div className="pg-metric-card">
          <div className="pg-metric-icon" style={{ background: '#f3e8ff', color: '#9333ea' }}>
            <Activity size={22} />
          </div>
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>Vòng eo</span>
            <strong style={{ display: 'block', fontSize: 18, fontWeight: 900, color: '#0f172a', marginTop: 2 }}>
              {metrics.waistCm} cm
            </strong>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#059669' }}>{metrics.waistStatus}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
