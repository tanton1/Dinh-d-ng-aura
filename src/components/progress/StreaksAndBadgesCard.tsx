import React, { useState, useEffect, useMemo } from 'react'
import {
  Award,
  ChevronRight,
  Flame,
  Trophy,
  Calendar,
  Check,
  Lock,
  Sparkles,
  HelpCircle,
  X,
  ShieldCheck,
  Zap,
  Star
} from 'lucide-react'
import { saveUserGamification, subscribeToUserGamification } from '../../services/firebaseService'
import type { CourseProgress } from '../../types'

interface StreaksAndBadgesCardProps {
  ownerId?: string
  progressItems?: CourseProgress[]
}

interface InteractiveBadge {
  id: string
  title: string
  category: 'starter' | 'streak' | 'nutrition' | 'workout' | 'body'
  icon: string
  description: string
  target: number
  actual: number
  unit: string
  tip: string
  rewardXp: number
}

export function StreaksAndBadgesCard({ ownerId, progressItems }: StreaksAndBadgesCardProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'nutrition' | 'workout' | 'streak'>('all')
  const [showBadgeModal, setShowBadgeModal] = useState<InteractiveBadge | null>(null)
  const [celebrateCheckIn, setCelebrateCheckIn] = useState(false)

  // Gamification stats state with offline local storage fallback
  const [streak, setStreak] = useState<number>(() => {
    const isDemoUser = ownerId === 'demo'
    const cached = localStorage.getItem(`aura:gamification:streak:${ownerId}`)
    return cached ? parseInt(cached, 10) : (isDemoUser ? 5 : 0)
  })
  const [longestStreak, setLongestStreak] = useState<number>(() => {
    const isDemoUser = ownerId === 'demo'
    const cached = localStorage.getItem(`aura:gamification:longest-streak:${ownerId}`)
    return cached ? parseInt(cached, 10) : (isDemoUser ? 14 : 0)
  })
  const [xp, setXp] = useState<number>(() => {
    const isDemoUser = ownerId === 'demo'
    const cached = localStorage.getItem(`aura:gamification:xp:${ownerId}`)
    return cached ? parseInt(cached, 10) : (isDemoUser ? 320 : 0)
  })
  const [checkedInDates, setCheckedInDates] = useState<string[]>(() => {
    const isDemoUser = ownerId === 'demo'
    const cached = localStorage.getItem(`aura:gamification:checked-in-dates:${ownerId}`)
    if (cached) {
      try {
        return JSON.parse(cached)
      } catch {
        return []
      }
    }
    if (isDemoUser) {
      // Generate some default previous dates for a friendly beginning for demo user
      const today = new Date()
      const yesterday = new Date(today)
      yesterday.setDate(today.getDate() - 1)
      const d2 = new Date(today)
      d2.setDate(today.getDate() - 2)
      const d3 = new Date(today)
      d3.setDate(today.getDate() - 3)
      const d4 = new Date(today)
      d4.setDate(today.getDate() - 4)

      return [
        yesterday.toISOString().split('T')[0],
        d2.toISOString().split('T')[0],
        d3.toISOString().split('T')[0],
        d4.toISOString().split('T')[0],
      ]
    }
    return []
  })

  // Load local storage values or defaults when ownerId changes to prevent leaking other user's state
  useEffect(() => {
    const isDemoUser = ownerId === 'demo'
    
    const cachedStreak = localStorage.getItem(`aura:gamification:streak:${ownerId}`)
    setStreak(cachedStreak ? parseInt(cachedStreak, 10) : (isDemoUser ? 5 : 0))

    const cachedLongest = localStorage.getItem(`aura:gamification:longest-streak:${ownerId}`)
    setLongestStreak(cachedLongest ? parseInt(cachedLongest, 10) : (isDemoUser ? 14 : 0))

    const cachedXp = localStorage.getItem(`aura:gamification:xp:${ownerId}`)
    setXp(cachedXp ? parseInt(cachedXp, 10) : (isDemoUser ? 320 : 0))

    const cachedDates = localStorage.getItem(`aura:gamification:checked-in-dates:${ownerId}`)
    if (cachedDates) {
      try {
        setCheckedInDates(JSON.parse(cachedDates))
      } catch {
        setCheckedInDates([])
      }
    } else if (isDemoUser) {
      const today = new Date()
      const yesterday = new Date(today)
      yesterday.setDate(today.getDate() - 1)
      const d2 = new Date(today)
      d2.setDate(today.getDate() - 2)
      const d3 = new Date(today)
      d3.setDate(today.getDate() - 3)
      const d4 = new Date(today)
      d4.setDate(today.getDate() - 4)

      setCheckedInDates([
        yesterday.toISOString().split('T')[0],
        d2.toISOString().split('T')[0],
        d3.toISOString().split('T')[0],
        d4.toISOString().split('T')[0],
      ])
    } else {
      setCheckedInDates([])
    }
  }, [ownerId])

  // Subscribe to real-time gamification stats from Firestore
  useEffect(() => {
    if (!ownerId || ownerId === 'demo' || ownerId === 'anonymous') return

    const unsubscribe = subscribeToUserGamification(ownerId, (remote) => {
      if (remote) {
        if (typeof remote.streak === 'number') {
          setStreak(remote.streak)
          localStorage.setItem(`aura:gamification:streak:${ownerId}`, remote.streak.toString())
        }
        if (typeof remote.longestStreak === 'number') {
          setLongestStreak(remote.longestStreak)
          localStorage.setItem(`aura:gamification:longest-streak:${ownerId}`, remote.longestStreak.toString())
        }
        if (typeof remote.xp === 'number') {
          setXp(remote.xp)
          localStorage.setItem(`aura:gamification:xp:${ownerId}`, remote.xp.toString())
        }
        if (Array.isArray(remote.checkedInDates)) {
          setCheckedInDates(remote.checkedInDates)
          localStorage.setItem(`aura:gamification:checked-in-dates:${ownerId}`, JSON.stringify(remote.checkedInDates))
        }
      }
    }, (err) => {
      console.warn('Error syncing gamification stats from Firestore:', err)
    })

    return () => unsubscribe()
  }, [ownerId])

  // Get current calendar week dates (Monday to Sunday)
  const weekDays = useMemo(() => {
    const today = new Date()
    const dayOfWeek = today.getDay() // 0 is Sunday, 1-6 is Mon-Sat
    const mondayDiff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek // Monday is starting index
    const days = []
    
    for (let i = 0; i < 7; i++) {
      const d = new Date(today)
      d.setDate(today.getDate() + mondayDiff + i)
      const yr = d.getFullYear()
      const mo = String(d.getMonth() + 1).padStart(2, '0')
      const dy = String(d.getDate()).padStart(2, '0')
      const dateStr = `${yr}-${mo}-${dy}`
      days.push({
        dateStr,
        label: d.getDate().toString(),
        name: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'][i],
        isToday: dateStr === today.toISOString().split('T')[0]
      })
    }
    return days
  }, [])

  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], [])
  const isCheckedInToday = checkedInDates.includes(todayStr)

  // Level computation (each level is 500 XP)
  const currentLevel = Math.floor(xp / 500) + 1
  const xpInCurrentLevel = xp % 500
  const xpPercent = Math.round((xpInCurrentLevel / 500) * 100)

  // Query physical logging histories in LocalStorage to compute real badge progress
  const journalMetrics = useMemo(() => {
    let mealsCount = 0
    let waterDaysCount = 0
    let workoutsCount = 0
    let weightLogsCount = 0

    try {
      const mealsRaw = localStorage.getItem(`aura:nutrition:meals:v2:${ownerId}`)
      if (mealsRaw) {
        const meals = JSON.parse(mealsRaw)
        if (Array.isArray(meals)) {
          const uniqueDays = new Set(meals.filter(m => m.status === 'logged').map(m => m.date))
          mealsCount = uniqueDays.size
        }
      }

      const waterRaw = localStorage.getItem(`aura:nutrition:water-entries:v1:${ownerId}`)
      if (waterRaw) {
        const water = JSON.parse(waterRaw)
        if (Array.isArray(water)) {
          const uniqueDays = new Set(water.map(w => w.date))
          waterDaysCount = uniqueDays.size
        }
      }

      const weightRaw = localStorage.getItem(`aura:progress:weight-records:${ownerId}`)
      if (weightRaw) {
        const weights = JSON.parse(weightRaw)
        if (Array.isArray(weights)) {
          weightLogsCount = weights.length
        }
      }

      const actRaw = localStorage.getItem(`aura:nutrition:activities:v1:${ownerId}`)
      if (actRaw) {
        const acts = JSON.parse(actRaw)
        if (Array.isArray(acts)) {
          workoutsCount = acts.length
        }
      }
    } catch (e) {
      console.error('Error computing badge metrics:', e)
    }

    return {
      mealsCount,
      waterDaysCount,
      workoutsCount,
      weightLogsCount
    }
  }, [ownerId])

  const completedLessonsCount = useMemo(() => {
    if (!progressItems || !Array.isArray(progressItems)) return 0
    return progressItems.reduce((acc, progress) => acc + (progress.completedLessonIds?.length || 0), 0)
  }, [progressItems])

  // System Badges config with real dynamic progress calculation
  const badges: InteractiveBadge[] = useMemo(() => {
    return [
      {
        id: 'b1',
        title: '7 Ngày Dinh Dưỡng',
        category: 'nutrition',
        icon: '🥗',
        description: 'Ghi nhận bữa ăn đủ 7 ngày',
        target: 7,
        actual: journalMetrics.mealsCount,
        unit: 'ngày',
        tip: 'Mở khóa dễ dàng bằng cách ghi chép đầy đủ bữa sáng, trưa, tối hằng ngày để Aura phân tích năng lượng chính xác nhất.',
        rewardXp: 150
      },
      {
        id: 'b2',
        title: 'Kỷ Luật Luyện Tập',
        category: 'workout',
        icon: '🏋️',
        description: 'Hoàn thành 10 bài tập luyện',
        target: 10,
        actual: journalMetrics.workoutsCount,
        unit: 'buổi',
        tip: 'Ghi chép các hoạt động thể thao, nâng tạ hoặc cardio trong thẻ vận động để tích lũy buổi tập của bạn.',
        rewardXp: 200
      },
      {
        id: 'b3',
        title: 'Đủ Nước Đủ Sức',
        category: 'starter',
        icon: '💧',
        description: 'Ghi nước uống đủ 5 ngày',
        target: 5,
        actual: journalMetrics.waterDaysCount,
        unit: 'ngày',
        tip: 'Đặt mục tiêu nước và bấm ghi chép mỗi cốc nước 250ml uống được trong ngày. Uống đủ nước thúc đẩy trao đổi chất vượt trội.',
        rewardXp: 100
      },
      {
        id: 'b4',
        title: 'Thói Quen Sắt Đá',
        category: 'streak',
        icon: '🔥',
        description: 'Duy trì chuỗi điểm danh 7 ngày',
        target: 7,
        actual: streak,
        unit: 'ngày',
        tip: 'Bấm nút điểm danh hoặc ghi chép bất kỳ chỉ số sức khỏe nào mỗi ngày để giữ ngọn lửa kỷ luật luôn bùng cháy.',
        rewardXp: 250
      },
      {
        id: 'b5',
        title: 'Kỷ Luật Cân Nặng',
        category: 'body',
        icon: '⚖️',
        description: 'Theo dõi cân nặng đủ 5 lần',
        target: 5,
        actual: journalMetrics.weightLogsCount,
        unit: 'lần',
        tip: 'Cân nặng có sự biến động tự nhiên. Ghi nhận cân nặng thường xuyên vào buổi sáng khi ngủ dậy giúp bạn nắm bắt xu hướng chính xác.',
        rewardXp: 100
      },
      {
        id: 'b6',
        title: 'Khởi Đầu Hoàn Hảo',
        category: 'starter',
        icon: '🏆',
        description: 'Thiết lập chỉ số sinh trắc học',
        target: 1,
        actual: journalMetrics.weightLogsCount > 0 ? 1 : 0,
        unit: 'mục',
        tip: 'Điền đầy đủ chiều cao, cân nặng mục tiêu và tỷ lệ mỡ cơ thể để Aura kiến tạo lộ trình dinh dưỡng cá nhân hóa hoàn chỉnh nhất.',
        rewardXp: 50
      },
      {
        id: 'b7',
        title: 'Chuyên Cần Academy',
        category: 'workout',
        icon: '📚',
        description: 'Hoàn thành 5 bài học lý thuyết',
        target: 5,
        actual: completedLessonsCount,
        unit: 'bài',
        tip: 'Học lý thuyết dinh dưỡng ứng dụng tại thẻ Học viện giúp bạn xây dựng nền tảng thói quen ăn uống khoa học nhất.',
        rewardXp: 100
      },
      {
        id: 'b8',
        title: 'Khoa Học Dinh Dưỡng',
        category: 'streak',
        icon: '🎓',
        description: 'Hoàn thành 15 bài học lý thuyết',
        target: 15,
        actual: completedLessonsCount,
        unit: 'bài',
        tip: 'Kiên trì chinh phục từng bài học ngắn 5 phút mỗi ngày tại học viện để sớm làm chủ cơ thể và dinh dưỡng của chính mình.',
        rewardXp: 300
      }
    ]
  }, [journalMetrics, streak, completedLessonsCount])

  const filteredBadges = badges.filter((b) => activeTab === 'all' || b.category === activeTab)

  const unlockedBadgesCount = useMemo(() => {
    return badges.filter(b => b.actual >= b.target).length
  }, [badges])

  // Trigger check-in action
  const handleCheckIn = () => {
    if (isCheckedInToday) return

    const newDates = [...checkedInDates, todayStr]
    
    // Calculate new streak
    let newStreak = streak
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().split('T')[0]

    if (checkedInDates.includes(yesterdayStr)) {
      newStreak = streak + 1
    } else {
      newStreak = 1
    }

    const newLongest = Math.max(longestStreak, newStreak)
    const newXp = xp + 50

    setCheckedInDates(newDates)
    setStreak(newStreak)
    setLongestStreak(newLongest)
    setXp(newXp)

    // Save locally
    localStorage.setItem(`aura:gamification:checked-in-dates:${ownerId}`, JSON.stringify(newDates))
    localStorage.setItem(`aura:gamification:streak:${ownerId}`, newStreak.toString())
    localStorage.setItem(`aura:gamification:longest-streak:${ownerId}`, newLongest.toString())
    localStorage.setItem(`aura:gamification:xp:${ownerId}`, newXp.toString())

    // Save to Firestore
    if (ownerId && ownerId !== 'anonymous') {
      saveUserGamification(ownerId, {
        checkedInDates: newDates,
        streak: newStreak,
        longestStreak: newLongest,
        xp: newXp
      }).catch((err) => {
        console.error('Error syncing check-in with Firestore:', err)
      })
    }

    // Trigger celebration animation
    setCelebrateCheckIn(true)
    setTimeout(() => {
      setCelebrateCheckIn(false)
    }, 4000)
  }

  return (
    <div className="pg-card" style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'relative' }}>
      
      {/* Check-In Celebration Particles (pure CSS) */}
      {celebrateCheckIn && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(255, 255, 255, 0.95)',
          zIndex: 100,
          borderRadius: 16,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          animation: 'fade-in 0.3s ease-out'
        }}>
          <div style={{ position: 'relative', width: 80, height: 80, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, #10b981, #059669)', borderRadius: '50%', color: '#ffffff', boxShadow: '0 10px 25px rgba(16, 185, 129, 0.3)' }}>
            <Check size={42} strokeWidth={3} />
            <div style={{ position: 'absolute', inset: -8, borderRadius: '50%', border: '2px dashed #10b981', animation: 'spin 12s linear infinite' }} />
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 900, color: '#0f172a', marginTop: 16, marginBottom: 4 }}>Điểm danh thành công!</h3>
          <p style={{ fontSize: 13, color: '#059669', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Sparkles size={14} /> +50 kinh nghiệm (XP) tích lũy
          </p>
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500, marginTop: 12 }}>Chuỗi kỷ luật của bạn đạt {streak} ngày</span>
        </div>
      )}

      {/* Header section */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', margin: 0 }}>Điểm danh & Huy hiệu</h2>
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>
            Giữ ngọn lửa kỷ luật để mở khóa thành tựu xuất sắc
          </span>
        </div>

        {/* Level and XP indicator */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 150, background: '#f8fafc', padding: '8px 12px', borderRadius: 10, border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#475569', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <Zap size={12} style={{ color: '#ea580c', fill: '#ea580c' }} />
              Cấp độ {currentLevel}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b' }}>{xp} XP</span>
          </div>
          <div style={{ width: '100%', height: 6, background: '#cbd5e1', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${xpPercent}%`, height: '100%', background: 'linear-gradient(90deg, #ec4899 0%, #fb923c 100%)', borderRadius: 3 }} />
          </div>
          <span style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, textAlign: 'right' }}>Còn {500 - xpInCurrentLevel} XP lên cấp</span>
        </div>
      </div>

      {/* Gamification Numbers summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Streak card */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fffbeb', border: '1px solid #fef3c7', padding: '12px 14px', borderRadius: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#fef3c7', display: 'grid', placeItems: 'center', color: '#ea580c' }}>
            <Flame size={20} style={{ fill: '#ea580c' }} />
          </div>
          <div>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#d97706', display: 'block' }}>CHUỖI HIỆN TẠI</span>
            <strong style={{ fontSize: 18, fontWeight: 900, color: '#92400e' }}>{streak} ngày</strong>
          </div>
        </div>

        {/* Badges card */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#f5f3ff', border: '1px solid #ddd6fe', padding: '12px 14px', borderRadius: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#ddd6fe', display: 'grid', placeItems: 'center', color: '#8b5cf6' }}>
            <Award size={20} />
          </div>
          <div>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#7c3aed', display: 'block' }}>ĐÃ MỞ KHÓA</span>
            <strong style={{ fontSize: 18, fontWeight: 900, color: '#5b21b6' }}>{unlockedBadgesCount} / {badges.length} huy hiệu</strong>
          </div>
        </div>
      </div>

      {/* Attendance Board Calendar Grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: '#f8fafc', padding: 14, borderRadius: 12, border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#334155', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Calendar size={14} style={{ color: '#ec4899' }} />
            Bảng điểm danh tuần này
          </span>
          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Kỷ lục chuỗi: <strong>{longestStreak} ngày</strong></span>
        </div>

        {/* Weekly strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, textAlign: 'center' }}>
          {weekDays.map((day) => {
            const isCompleted = checkedInDates.includes(day.dateStr)
            
            return (
              <div key={day.dateStr} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: day.isToday ? '#ec4899' : '#94a3b8' }}>
                  {day.name} {day.isToday && '•'}
                </span>
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: '50%',
                    background: isCompleted 
                      ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' 
                      : (day.isToday ? '#fce7f3' : '#e2e8f0'),
                    color: isCompleted ? '#ffffff' : (day.isToday ? '#ec4899' : '#64748b'),
                    border: day.isToday && !isCompleted ? '1.5px solid #ec4899' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 900,
                    boxShadow: isCompleted ? '0 3px 6px rgba(16, 185, 129, 0.2)' : 'none',
                  }}
                >
                  {isCompleted ? <Check size={14} strokeWidth={3} /> : day.label}
                </div>
              </div>
            )
          })}
        </div>

        {/* Check-In Action Button */}
        <button
          type="button"
          disabled={isCheckedInToday}
          onClick={handleCheckIn}
          style={{
            marginTop: 8,
            width: '100%',
            height: 40,
            borderRadius: 8,
            border: 'none',
            background: isCheckedInToday 
              ? '#e2e8f0' 
              : 'linear-gradient(90deg, #ec4899 0%, #fb923c 100%)',
            color: isCheckedInToday ? '#94a3b8' : '#ffffff',
            fontSize: 13,
            fontWeight: 800,
            cursor: isCheckedInToday ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            boxShadow: isCheckedInToday ? 'none' : '0 4px 10px rgba(247, 37, 103, 0.15)',
            transition: 'all 0.2s'
          }}
        >
          {isCheckedInToday ? (
            <>
              <Check size={14} strokeWidth={3} />
              <span>Đã điểm danh hôm nay (Quay lại vào ngày mai)</span>
            </>
          ) : (
            <>
              <Sparkles size={14} />
              <span>Bấm Điểm Danh Hôm Nay (+50 XP)</span>
            </>
          )}
        </button>
      </div>

      {/* Badges tabs filter */}
      <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid #f1f5f9', paddingBottom: 6 }}>
        {[
          { id: 'all', label: 'Tất cả' },
          { id: 'nutrition', label: 'Dinh dưỡng' },
          { id: 'workout', label: 'Vận động' },
          { id: 'streak', label: 'Chuỗi' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as any)}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              border: 'none',
              background: activeTab === tab.id ? '#fce7f3' : 'transparent',
              color: activeTab === tab.id ? '#ec4899' : '#64748b',
              fontSize: 12,
              fontWeight: 800,
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Badges Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
        {filteredBadges.map((badge) => {
          const isUnlocked = badge.actual >= badge.target
          const percent = Math.min(100, Math.round((badge.actual / badge.target) * 100))

          return (
            <div
              key={badge.id}
              onClick={() => setShowBadgeModal(badge)}
              style={{
                background: isUnlocked ? '#ffffff' : '#f8fafc',
                border: isUnlocked ? '1.5px solid #fbcfe8' : '1px dashed #cbd5e1',
                borderRadius: 14,
                padding: '14px 10px',
                textAlign: 'center',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                position: 'relative',
                transition: 'all 0.2s',
              }}
              className="badge-item-card"
            >
              {/* Badge Icon */}
              <div style={{
                fontSize: 32,
                filter: isUnlocked ? 'none' : 'grayscale(100%) opacity(40%)',
                transform: 'scale(1)',
                transition: 'transform 0.2s'
              }}>
                {badge.icon}
              </div>

              {/* Locked/Unlocked Icon Indicator */}
              <div style={{
                position: 'absolute',
                top: 8,
                right: 8,
                color: isUnlocked ? '#10b981' : '#94a3b8'
              }}>
                {isUnlocked ? (
                  <ShieldCheck size={14} style={{ fill: '#ecfdf5' }} />
                ) : (
                  <Lock size={12} />
                )}
              </div>

              {/* Title & Stats */}
              <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: 2 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: isUnlocked ? '#0f172a' : '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {badge.title}
                </span>
                <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>
                  {badge.description}
                </span>
              </div>

              {/* Progress bar for locked badges */}
              <div style={{ width: '100%', marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, fontWeight: 700, color: isUnlocked ? '#10b981' : '#64748b' }}>
                  <span>{percent}%</span>
                  <span>{badge.actual}/{badge.target} {badge.unit}</span>
                </div>
                <div style={{ width: '100%', height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    width: `${percent}%`,
                    height: '100%',
                    background: isUnlocked 
                      ? 'linear-gradient(90deg, #10b981, #059669)' 
                      : 'linear-gradient(90deg, #ec4899, #fb923c)',
                    borderRadius: 2
                  }} />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Custom Interactive Badge Details Modal */}
      {showBadgeModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.6)',
          backdropFilter: 'blur(4px)',
          zIndex: 999,
          display: 'grid',
          placeItems: 'center',
          padding: 16
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 16,
            width: '100%',
            maxWidth: 380,
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            border: '1px solid #f1f5f9',
            overflow: 'hidden',
            animation: 'scale-up 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
          }}>
            {/* Modal Header */}
            <div style={{ position: 'relative', background: 'linear-gradient(135deg, #fff0f5, #fce7f3)', padding: '24px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => setShowBadgeModal(null)}
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  background: 'rgba(255, 255, 255, 0.8)',
                  border: 'none',
                  borderRadius: '50%',
                  width: 26,
                  height: 26,
                  display: 'grid',
                  placeItems: 'center',
                  cursor: 'pointer',
                  color: '#475569'
                }}
              >
                <X size={14} />
              </button>

              <div style={{ fontSize: 60, marginBottom: 10, animation: 'bounce 2s infinite' }}>
                {showBadgeModal.icon}
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 900, color: '#0f172a', margin: 0 }}>{showBadgeModal.title}</h3>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: showBadgeModal.actual >= showBadgeModal.target ? '#ecfdf5' : '#f1f5f9', color: showBadgeModal.actual >= showBadgeModal.target ? '#059669' : '#64748b', marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {showBadgeModal.actual >= showBadgeModal.target ? (
                  <>
                    <ShieldCheck size={12} />
                    Đã hoàn thành
                  </>
                ) : (
                  <>
                    <Lock size={10} />
                    Chưa mở khóa
                  </>
                )}
              </span>
            </div>

            {/* Modal Body */}
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              
              {/* Requirements & Progress */}
              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>YÊU CẦU MỞ KHÓA</span>
                <p style={{ fontSize: 13, color: '#1e293b', fontWeight: 600, margin: 0 }}>
                  {showBadgeModal.description}
                </p>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, fontWeight: 800, color: '#475569', marginTop: 4 }}>
                  <span>Tiến độ:</span>
                  <span style={{ color: showBadgeModal.actual >= showBadgeModal.target ? '#10b981' : '#ec4899' }}>
                    {showBadgeModal.actual} / {showBadgeModal.target} {showBadgeModal.unit}
                  </span>
                </div>
              </div>

              {/* Coaching/Motivation Tips */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <HelpCircle size={12} style={{ color: '#8b5cf6' }} />
                  Bí kíp của huấn luyện viên Aura:
                </span>
                <p style={{ fontSize: 12, color: '#475569', fontWeight: 500, lineHeight: 1.5, margin: 0 }}>
                  {showBadgeModal.tip}
                </p>
              </div>

              {/* Reward */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1.5px solid #f1f5f9', paddingTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Star size={16} style={{ color: '#ea580c', fill: '#fef3c7' }} />
                  <span style={{ fontSize: 12, color: '#475569', fontWeight: 700 }}>Phần thưởng hoàn thành:</span>
                </div>
                <strong style={{ fontSize: 14, color: '#ea580c', fontWeight: 800 }}>+{showBadgeModal.rewardXp} XP</strong>
              </div>

              {/* Close Button */}
              <button
                type="button"
                onClick={() => setShowBadgeModal(null)}
                style={{
                  width: '100%',
                  height: 40,
                  borderRadius: 8,
                  border: 'none',
                  background: '#0f172a',
                  color: '#ffffff',
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: 'pointer',
                  marginTop: 4
                }}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
