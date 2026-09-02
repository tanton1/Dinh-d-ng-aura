import React, { useState } from 'react'
import { Apple, Dumbbell, Flame, Info, Scale, ShieldCheck, Sparkles, ChevronDown, ChevronUp } from 'lucide-react'
import type { ProgressScoreResult } from '../../utils/progressScoreCalculator'
import { calculateProgressScore } from '../../utils/progressScoreCalculator'

interface WeeklyScoreCardProps {
  scoreResult?: ProgressScoreResult
  score?: number
  maxScore?: number
  weightChangeText?: string
  weightSubText?: string
  nutritionPercent?: number
  workoutsCount?: number
  streakDays?: number
  statusTagText?: string
  insightText?: React.ReactNode
  daysOfData?: number
}

export function WeeklyScoreCard({
  scoreResult,
  score: fallbackScore = 0,
  maxScore = 100,
  weightChangeText = '+0.2 kg',
  weightSubText = 'So với tuần trước ↑',
  nutritionPercent = 0,
  workoutsCount = 0,
  streakDays = 0,
  statusTagText,
  insightText,
  daysOfData = 7,
}: WeeklyScoreCardProps) {
  const [showFormulaModal, setShowFormulaModal] = useState(false)
  const [showBreakdown, setShowBreakdown] = useState(false)

  // Calculate score from formula engine if scoreResult not passed
  const activeResult: ProgressScoreResult = scoreResult || calculateProgressScore({
    adherence: { mealLoggingRate: 0, calorieTargetRate: 0, proteinTargetRate: 0, hydrationRate: 0, dailyTaskRate: 0 },
    nutrition: { calorieScore: 0, proteinScore: 0 },
    activity: { workoutCompletionScore: 0, activeMinutesScore: 0, consistencyScore: 0 },
    body: {},
    tracking: { mealTrackingRate: 0, weightTrackingRate: 0, workoutTrackingRate: 0, hydrationTrackingRate: 0 },
  }, 0)

  const finalScore = scoreResult ? scoreResult.total : activeResult.total || fallbackScore
  const activeStatusTag = statusTagText || activeResult.statusTag
  const breakdown = activeResult.breakdown

  const radius = 54
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (finalScore / maxScore) * circumference

  const confidenceLabel =
    activeResult.confidence === 'high'
      ? 'Cao'
      : activeResult.confidence === 'medium'
      ? 'Trung bình'
      : 'Thấp'

  const confidenceBg =
    activeResult.confidence === 'high'
      ? '#dcfce7'
      : activeResult.confidence === 'medium'
      ? '#fef9c3'
      : '#fee2e2'

  const confidenceTextColor =
    activeResult.confidence === 'high'
      ? '#166534'
      : activeResult.confidence === 'medium'
      ? '#854d0e'
      : '#991b1b'

  if (activeResult.isSettingUp) {
    return (
      <div className="pg-card pg-hero-card" style={{ background: 'linear-gradient(135deg, #fff5f8 0%, #ffffff 100%)', border: '1px solid #fce7f3' }}>
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 44, height: 44, borderRadius: 14, background: '#fce7f3', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ec4899', flexShrink: 0 }}>
              <Sparkles size={24} />
            </div>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', margin: 0 }}>Đang thiết lập điểm tiến độ</h3>
              <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0 0' }}>
                {activeResult.setupMessage}
              </p>
            </div>
          </div>
          <div style={{ background: '#ffffff', borderRadius: 12, padding: '12px 16px', border: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>Tiến độ thu thập dữ liệu</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#ec4899' }}>{daysOfData}/3 ngày tối thiểu</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pg-card pg-hero-card">
      <div className="pg-hero-grid">
        {/* Gauge Left Column */}
        <div className="pg-hero-gauge-col">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <h2>Điểm tiến độ tuần này</h2>
            <button
              type="button"
              onClick={() => setShowFormulaModal(true)}
              style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#94a3b8' }}
              title="Xem công thức tính điểm"
            >
              <Info size={15} />
            </button>
          </div>

          <div className="pg-gauge-circle-wrap">
            <svg viewBox="0 0 130 130" style={{ transform: 'rotate(-90deg)', width: '100%', height: '100%' }}>
              <circle cx="65" cy="65" r={radius} fill="none" stroke="#fbcfe8" strokeWidth="12" />
              <circle
                cx="65"
                cy="65"
                r={radius}
                fill="none"
                stroke="url(#pgHeroGrad)"
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                style={{ transition: 'stroke-dashoffset 0.8s ease' }}
              />
              <defs>
                <linearGradient id="pgHeroGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ec4899" />
                  <stop offset="100%" stopColor="#fb923c" />
                </linearGradient>
              </defs>
            </svg>
            <div className="pg-gauge-circle-inner">
              <span className="pg-gauge-val">{finalScore}</span>
              <span className="pg-gauge-sub">/{maxScore}</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <span className="pg-hero-status-tag">{activeStatusTag}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#64748b', fontWeight: 600 }}>
              <span style={{ padding: '2px 8px', borderRadius: 12, background: confidenceBg, color: confidenceTextColor, display: 'flex', alignItems: 'center', gap: 4 }}>
                <ShieldCheck size={12} /> Độ tin cậy: {confidenceLabel}
              </span>
              <span>•</span>
              <span>Dữ liệu: {activeResult.dataCoverage}%</span>
            </div>
          </div>
        </div>

        {/* 2x2 Stats Grid Right Column */}
        <div className="pg-hero-stats-grid">
          {/* 1. Weight */}
          <div className="pg-hero-stat-item">
            <div className="pg-hero-stat-icon pink">
              <Scale size={20} />
            </div>
            <div className="pg-hero-stat-info">
              <label>Cân nặng</label>
              <strong>{weightChangeText}</strong>
              <span>{weightSubText}</span>
            </div>
          </div>

          {/* 2. Nutrition */}
          <div className="pg-hero-stat-item">
            <div className="pg-hero-stat-icon green">
              <Apple size={20} />
            </div>
            <div className="pg-hero-stat-info">
              <label>Dinh dưỡng</label>
              <strong>{nutritionPercent}%</strong>
              <span style={{ color: '#059669' }}>Mục tiêu ↑</span>
            </div>
          </div>

          {/* 3. Workout */}
          <div className="pg-hero-stat-item">
            <div className="pg-hero-stat-icon orange">
              <Dumbbell size={20} />
            </div>
            <div className="pg-hero-stat-info">
              <label>Vận động</label>
              <strong>{workoutsCount} buổi</strong>
              <span style={{ color: '#ea580c' }}>Hoàn thành ↑</span>
            </div>
          </div>

          {/* 4. Streak */}
          <div className="pg-hero-stat-item">
            <div className="pg-hero-stat-icon purple">
              <Flame size={20} />
            </div>
            <div className="pg-hero-stat-info">
              <label>Chuỗi duy trì</label>
              <strong>{streakDays} ngày</strong>
              <span style={{ color: '#7e22ce' }}>Liên tiếp ↑</span>
            </div>
          </div>
        </div>
      </div>

      {/* AI Insight banner at bottom */}
      <div className="pg-hero-banner" style={{ marginTop: 12 }}>
        <Sparkles size={18} style={{ color: '#ec4899', fill: '#ec4899', flexShrink: 0 }} />
        <div>
          {insightText || (
            <>
              <strong style={{ color: '#db1557' }}>Tốt hơn tuần trước 8 điểm.</strong> Bạn đang duy trì thói quen tuân thủ rất tốt!
            </>
          )}
        </div>
      </div>

      {/* Formula Modal / Explanation popup */}
      {showFormulaModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(4px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setShowFormulaModal(false)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 20,
              maxWidth: 520,
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: 24,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: 0 }}>
                Công thức tính điểm tiến độ (0–100)
              </h3>
              <button
                type="button"
                onClick={() => setShowFormulaModal(false)}
                style={{ background: '#f1f5f9', border: 'none', width: 30, height: 30, borderRadius: 15, fontSize: 16, cursor: 'pointer', fontWeight: 'bold' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, marginBottom: 16 }}>
              Điểm tiến độ là điểm tổng hợp đánh giá mức độ tuân thủ và thói quen tích cực, không chỉ dựa vào việc cân nặng tăng hay giảm.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 12, borderLeft: '4px solid #ec4899' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>1. Tuân thủ kế hoạch — Trọng số 40%</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                  Bao gồm tỷ lệ ghi bữa ăn (37.5%), hoàn thành calo (25%), protein (20%), nước (10%), nhiệm vụ ngày (7.5%).
                </div>
              </div>

              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 12, borderLeft: '4px solid #10b981' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>2. Dinh dưỡng — Trọng số 25%</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                  Đánh giá vùng calo mục tiêu, đạt ngưỡng protein tối thiểu, chất xơ, rau quả và phân bố bữa ăn.
                </div>
              </div>

              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 12, borderLeft: '4px solid #f97316' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>3. Vận động — Trọng số 15%</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                  Số buổi tập hoàn thành theo kế hoạch (50%), phút hoạt động (25%), phân bổ tập luyện & duy trì.
                </div>
              </div>

              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 12, borderLeft: '4px solid #8b5cf6' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>4. Thay đổi cơ thể — Trọng số 15%</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                  So sánh tốc độ thay đổi thực tế với tốc độ mục tiêu cá nhân (giảm mỡ, tăng cơ, duy trì).
                </div>
              </div>

              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 12, borderLeft: '4px solid #06b6d4' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>5. Duy trì dữ liệu — Trọng số 5%</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                  Tần suất ghi nhật ký đều đặn để đảm bảo độ tin cậy của dữ liệu phân tích.
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowFormulaModal(false)}
              style={{
                width: '100%',
                padding: '12px',
                background: '#ec4899',
                color: '#ffffff',
                border: 'none',
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Đã hiểu
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
