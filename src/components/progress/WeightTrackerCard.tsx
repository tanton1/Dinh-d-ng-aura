import React from 'react'
import { CalendarDays, Info, Plus, TrendingUp, TrendingDown } from 'lucide-react'

interface WeightTrackerCardProps {
  currentWeightKg: number
  startWeightKg: number
  goalWeightKg: number
  targetDateText?: string
  onOpenLogWeight: () => void
}

export function WeightTrackerCard({
  currentWeightKg = 65.0,
  startWeightKg = 65.0,
  goalWeightKg = 67.0,
  targetDateText = '10/09/2026',
  onOpenLogWeight,
}: WeightTrackerCardProps) {
  const diffFromStart = (currentWeightKg - startWeightKg).toFixed(1)
  const totalChangeNeeded = goalWeightKg - startWeightKg
  const changeAchieved = currentWeightKg - startWeightKg
  
  let percentComplete = 0
  if (totalChangeNeeded === 0) {
    percentComplete = 100
  } else {
    const rawPercent = (changeAchieved / totalChangeNeeded) * 100
    percentComplete = Math.min(100, Math.max(0, Math.round(rawPercent)))
  }

  return (
    <div className="pg-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#64748b' }}>Cân nặng hiện tại</span>
          <Info size={16} style={{ color: '#cbd5e1' }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 8 }}>
          <span style={{ fontSize: 44, fontWeight: 900, color: '#0f172a', letterSpacing: '-0.04em' }}>
            {currentWeightKg.toFixed(1)}
          </span>
          <span style={{ fontSize: 16, fontWeight: 800, color: '#64748b' }}>kg</span>
        </div>

        {(() => {
          const isLossGoal = totalChangeNeeded < 0
          const isGainGoal = totalChangeNeeded > 0
          const numDiff = Number(diffFromStart)
          
          const isGoodProgress = isLossGoal 
            ? numDiff <= 0 
            : (isGainGoal ? numDiff >= 0 : true)
            
          const bg = isGoodProgress ? '#ecfdf5' : '#fff0f5'
          const fg = isGoodProgress ? '#059669' : '#db1557'
          
          return (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 10px',
                borderRadius: 9999,
                background: bg,
                color: fg,
                fontSize: 12,
                fontWeight: 800,
                marginTop: 8,
              }}
            >
              {numDiff < 0 ? <TrendingDown size={14} /> : <TrendingUp size={14} />}
              <span>{numDiff >= 0 ? `+${diffFromStart}` : diffFromStart} kg / 7 ngày</span>
            </div>
          )
        })()}

        {/* Start vs Goal Progress bar */}
        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b', marginBottom: 6 }}>
            <span>Bắt đầu: <strong style={{ color: '#0f172a' }}>{startWeightKg.toFixed(1)} kg</strong></span>
            <span>Mục tiêu: <strong style={{ color: '#0f172a' }}>{goalWeightKg.toFixed(1)} kg</strong></span>
          </div>

          <div style={{ position: 'relative', width: '100%', height: 8, background: '#fce7f3', borderRadius: 4 }}>
            <div
              style={{
                width: `${percentComplete}%`,
                height: '100%',
                borderRadius: 4,
                background: 'linear-gradient(110deg, #f72567 0%, #ff7a38 100%)',
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: `${percentComplete}%`,
                transform: 'translate(-50%, -50%)',
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: '#ffffff',
                border: '3px solid #f72567',
                boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
              }}
            />
          </div>

          <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#94a3b8', marginTop: 8 }}>
            {percentComplete}% hoàn thành
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b', marginTop: 14 }}>
          <CalendarDays size={15} style={{ color: '#94a3b8' }} />
          <span>Dự kiến đạt mục tiêu: <strong>{targetDateText}</strong></span>
        </div>
      </div>

      <button type="button" onClick={onOpenLogWeight} className="pg-weight-btn">
        <Plus size={18} strokeWidth={3} />
        <span>Ghi cân nặng</span>
      </button>
    </div>
  )
}
