import React, { useState } from 'react'
import { Apple, ChevronRight, Dumbbell, Flame, Info, Activity, ShieldCheck } from 'lucide-react'

interface EnergyBalanceCardProps {
  onOpenDetails?: () => void
  intake?: number
  basal?: number
  dailyActivity?: number
  workout?: number
  thermicEffect?: number
  confidence?: 'Cao' | 'Trung bình' | 'Thấp'
  goal?: 'lose-fat' | 'gain-muscle' | 'healthy' | string
  periodDays?: number // Number of days logged with meals
  totalPeriodDays?: number // 7, 30, or 90
  activeDays?: number // Same as periodDays, used for check
  workoutDays?: number // Number of days with workout logs
  onLogMeal?: () => void
  onLogWorkout?: () => void
}

function getEnergyBalanceStatus(avgDailyBalance: number) {
  if (avgDailyBalance < -500) return { text: 'Thâm hụt cao', color: '#dc2626', bg: '#fee2e2' }
  if (avgDailyBalance < -150) return { text: 'Thâm hụt vừa', color: '#ea580c', bg: '#ffedd5' }
  if (avgDailyBalance <= 150) return { text: 'Gần cân bằng', color: '#059669', bg: '#ecfdf5' }
  if (avgDailyBalance <= 400) return { text: 'Thặng dư vừa', color: '#2563eb', bg: '#dbeafe' }
  return { text: 'Thặng dư cao', color: '#7c3aed', bg: '#f3e8ff' }
}

export function EnergyBalanceCard({
  onOpenDetails,
  intake = 0,
  basal = 0,
  dailyActivity = 0,
  workout = 0,
  thermicEffect = 0,
  confidence = 'Trung bình',
  goal = 'lose-fat',
  periodDays = 1,
  totalPeriodDays = 7,
  activeDays = 0,
  workoutDays = 0,
  onLogMeal,
  onLogWorkout,
}: EnergyBalanceCardProps = {}) {
  const [showBreakdown, setShowBreakdown] = useState(false)

  const isPeriod7 = totalPeriodDays === 7
  const isPeriod30 = totalPeriodDays === 30
  const isPeriod90 = totalPeriodDays === 90

  // Standard requirement thresholds
  const minMealDays = isPeriod7 ? 5 : isPeriod30 ? 20 : 60
  const minWorkoutDays = isPeriod7 ? 3 : isPeriod30 ? 12 : 35

  const hasEnoughData = activeDays >= minMealDays && workoutDays >= minWorkoutDays

  if (!hasEnoughData) {
    const periodName = isPeriod7 ? 'tuần' : isPeriod30 ? 'tháng' : 'quý'
    return (
      <div className="pg-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', margin: 0 }}>Cân bằng năng lượng</h2>
          <Info size={14} style={{ color: '#94a3b8' }} />
        </div>

        <div style={{ background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: '#1e293b' }}>
              Chưa đủ dữ liệu để tính cân bằng {periodName}
            </span>
            <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>
              Bạn cần ghi chép thêm thông tin để thuật toán phân tích chính xác:
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 300, textAlign: 'left', background: '#ffffff', padding: 14, borderRadius: 8, border: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
              <span style={{ color: activeDays >= minMealDays ? '#10b981' : '#f59e0b', fontSize: 14 }}>
                {activeDays >= minMealDays ? '✓' : '•'}
              </span>
              <span style={{ color: activeDays >= minMealDays ? '#10b981' : '#475569' }}>
                Ghi bữa ăn ít nhất {minMealDays} ngày ({activeDays}/{minMealDays} ngày)
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}>
              <span style={{ color: workoutDays >= minWorkoutDays ? '#10b981' : '#f59e0b', fontSize: 14 }}>
                {workoutDays >= minWorkoutDays ? '✓' : '•'}
              </span>
              <span style={{ color: workoutDays >= minWorkoutDays ? '#10b981' : '#475569' }}>
                Ghi vận động ít nhất {minWorkoutDays} ngày ({workoutDays}/{minWorkoutDays} ngày)
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#10b981' }}>
              <span style={{ fontSize: 14 }}>✓</span>
              <span style={{ color: '#475569' }}>Cập nhật cân nặng hiện tại</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, width: '100%', justifyContent: 'center' }}>
            <button
              type="button"
              onClick={onLogMeal}
              style={{
                flex: 1,
                maxWidth: 140,
                padding: '10px 16px',
                background: '#ec4899',
                color: '#ffffff',
                border: 'none',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 800,
                cursor: 'pointer',
                textAlign: 'center',
                boxShadow: '0 2px 4px rgba(247, 37, 103, 0.1)'
              }}
            >
              Ghi bữa ăn
            </button>
            <button
              type="button"
              onClick={onLogWorkout}
              style={{
                flex: 1,
                maxWidth: 140,
                padding: '10px 16px',
                background: '#ffffff',
                color: '#ec4899',
                border: '1.5px solid #ec4899',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 800,
                cursor: 'pointer',
                textAlign: 'center'
              }}
            >
              Ghi vận động
            </button>
          </div>
        </div>
      </div>
    )
  }

  const denominator = Math.max(1, periodDays)
  const totalExpenditure = basal + dailyActivity + workout + thermicEffect
  const balance = intake - totalExpenditure
  const avgDailyBalance = Math.round(balance / denominator)

  // Status and Target evaluation
  const statusInfo = getEnergyBalanceStatus(avgDailyBalance)

  let goalText = 'Duy trì'
  let targetRangeText = '−100 đến +100 kcal/ngày'
  let isMatch = false

  if (goal === 'lose-fat') {
    goalText = 'Giảm mỡ'
    targetRangeText = '−200 đến −400 kcal/ngày'
    isMatch = avgDailyBalance >= -400 && avgDailyBalance <= -200
  } else if (goal === 'gain-muscle') {
    goalText = 'Tăng cân / Tăng cơ'
    targetRangeText = '+150 đến +300 kcal/ngày'
    isMatch = avgDailyBalance >= 150 && avgDailyBalance <= 300
  } else {
    isMatch = avgDailyBalance >= -100 && avgDailyBalance <= 100
  }

  const confidenceColor = confidence === 'Cao' ? '#10b981' : confidence === 'Trung bình' ? '#f59e0b' : '#ef4444'

  return (
    <div className="pg-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', margin: 0 }}>Cân bằng năng lượng</h2>
          <Info size={14} style={{ color: '#94a3b8' }} />
        </div>
        <button
          type="button"
          onClick={() => setShowBreakdown(!showBreakdown)}
          style={{
            background: 'none',
            border: 'none',
            color: '#ec4899',
            fontWeight: 700,
            fontSize: 12,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            padding: 0,
          }}
        >
          <span>{showBreakdown ? 'Thu gọn' : 'Chi tiết'}</span>
          <ChevronRight size={14} style={{ transform: showBreakdown ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
        </button>
      </div>

      {/* Main Stats Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '4px 0' }}>
        <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>
            TỔNG NẠP VÀO ({activeDays} ngày)
          </span>
          <strong style={{ fontSize: 18, fontWeight: 900, color: '#0f172a' }}>
            {intake.toLocaleString('vi-VN')}
          </strong>
          <span style={{ fontSize: 11, color: '#64748b', marginLeft: 3 }}>kcal</span>
        </div>

        <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>
            TỔNG TIÊU HAO ({activeDays} ngày)
          </span>
          <strong style={{ fontSize: 18, fontWeight: 900, color: '#0f172a' }}>
            {totalExpenditure.toLocaleString('vi-VN')}
          </strong>
          <span style={{ fontSize: 11, color: '#64748b', marginLeft: 3 }}>kcal</span>
        </div>
      </div>

      {/* Breakdown Accordion Panel */}
      {showBreakdown && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: '#f8fafc', padding: 12, borderRadius: 8, fontSize: 13, border: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Apple size={14} style={{ color: '#059669' }} />
              <span style={{ color: '#475569', fontWeight: 600 }}>Nạp vào</span>
            </div>
            <strong style={{ color: '#0f172a' }}>{intake.toLocaleString('vi-VN')} kcal</strong>
          </div>

          <div style={{ height: 1, background: '#e2e8f0' }} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Flame size={14} style={{ color: '#ef4444' }} />
              <span style={{ color: '#475569', fontWeight: 500 }}>Tiêu hao nền (BMR)</span>
            </div>
            <strong style={{ color: '#475569' }}>{basal.toLocaleString('vi-VN')} kcal</strong>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Activity size={14} style={{ color: '#3b82f6' }} />
              <span style={{ color: '#475569', fontWeight: 500 }}>Sinh hoạt hằng ngày (ước tính)</span>
            </div>
            <strong style={{ color: '#475569' }}>{dailyActivity.toLocaleString('vi-VN')} kcal</strong>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Dumbbell size={14} style={{ color: '#ea580c' }} />
              <span style={{ color: '#475569', fontWeight: 500 }}>Tập luyện (ghi nhận)</span>
            </div>
            <strong style={{ color: '#475569' }}>{workout.toLocaleString('vi-VN')} kcal</strong>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ShieldCheck size={14} style={{ color: '#8b5cf6' }} />
              <span style={{ color: '#475569', fontWeight: 500 }}>Hiệu ứng nhiệt (TEF 10%)</span>
            </div>
            <strong style={{ color: '#475569' }}>{thermicEffect.toLocaleString('vi-VN')} kcal</strong>
          </div>

          <div style={{ height: 1, background: '#cbd5e1', margin: '4px 0' }} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 700 }}>
            <span style={{ color: '#0f172a' }}>Tổng tiêu hao</span>
            <strong style={{ color: '#ef4444' }}>{totalExpenditure.toLocaleString('vi-VN')} kcal</strong>
          </div>
        </div>
      )}

      <div style={{ height: 1, background: '#f1f5f9' }} />

      {/* Target Balance Details */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>Chênh lệch ({activeDays} ngày)</span>
            <div style={{ fontSize: 22, fontWeight: 900, color: balance < 0 ? '#10b981' : '#ec4899', marginTop: 1 }}>
              {balance >= 0 ? '+' : ''}{balance.toLocaleString('vi-VN')} kcal
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>Trung bình</span>
            <div style={{ fontSize: 16, fontWeight: 800, color: avgDailyBalance < 0 ? '#10b981' : '#ec4899', marginTop: 1 }}>
              {avgDailyBalance >= 0 ? '+' : ''}{avgDailyBalance.toLocaleString('vi-VN')} kcal/ngày
            </div>
          </div>
        </div>

        {/* Goal Matching & Quality Indicators */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 4, background: '#f8fafc', padding: 10, borderRadius: 8, fontSize: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ color: '#64748b', fontWeight: 600 }}>Mục tiêu {goalText}:</span>
            <span style={{ color: '#1e293b', fontWeight: 800 }}>{targetRangeText}</span>
            <span style={{ color: isMatch ? '#10b981' : '#d97706', fontWeight: 700, marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              ● {isMatch ? 'Đúng lộ trình' : 'Cần điều chỉnh'}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, borderLeft: '1px solid #e2e8f0', paddingLeft: 10 }}>
            <span style={{ color: '#64748b', fontWeight: 600 }}>Độ tin cậy:</span>
            <span style={{ color: '#1e293b', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: confidenceColor }} />
              {confidence}
            </span>
            <span style={{ color: '#64748b', fontWeight: 500, fontSize: 11, marginTop: 2 }}>
              Dựa trên nhật ký nạp & vận động
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
