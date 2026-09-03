import React, { useState, useEffect, useMemo } from 'react'
import { safeLocalStorageSet } from '../../lib/safeStorage'
import { 
  Flame, 
  Award, 
  Check, 
  Calendar, 
  Sparkles, 
  HelpCircle, 
  X, 
  ShieldCheck, 
  Zap, 
  Star,
  Lock
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

  // Load local storage values or defaults when ownerId changes
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
      waterDaysCount,      workoutsCount,
      weightLogsCount
    }
  }, [ownerId])

  const completedLessonsCount = useMemo(() => {
    if (!progressItems || !Array.isArray(progressItems)) return 0
    return progressItems.reduce((acc, progress) => acc + (progress.completedLessonIds?.length || 0), 0)
  }, [progressItems])

  // Badge list definitions
  const badges: InteractiveBadge[] = useMemo(() => {
    return [
      {
        id: 'b1',
        title: 'Thói Quên Đầu Tiên',
        category: 'starter',
        icon: '🌱',
        description: 'Điểm danh 1 ngày duy nhất',
        target: 1,
        actual: streak >= 1 ? 1 : 0,
        unit: 'ngày',
        tip: 'Khởi đầu luôn là bước quan trọng nhất. Hãy ghi nhận nỗ lực của bản thân hôm nay!',
        rewardXp: 50
      },
      {
        id: 'b2',
        title: 'Ngọn Lửa Kỷ Luật',
        category: 'streak',
        icon: '🔥',
        description: 'Giữ chuỗi điểm danh 7 ngày liên tiếp',
        target: 7,
        actual: streak,
        unit: 'ngày',
        tip: 'Duy trì kỷ luật liên tục trong 7 ngày giúp não bộ hình thành đường dẫn thần kinh thói quen mới.',
        rewardXp: 150
      },
      {
        id: 'b3',
        title: 'Chiến Binh Kỷ Luật',
        category: 'streak',
        icon: '⚡',
        description: 'Giữ chuỗi điểm danh 30 ngày liên tiếp',
        target: 30,
        actual: streak,
        unit: 'ngày',
        tip: '30 ngày là cột mốc khẳng định phong cách sống lành mạnh thực sự của một chiến binh.',
        rewardXp: 500
      },
      {
        id: 'b4',
        title: 'Nhật Ký Dinh Dưỡng',
        category: 'nutrition',
        icon: '🥗',
        description: 'Ghi chép bữa ăn trong 3 ngày',
        target: 3,
        actual: journalMetrics.mealsCount,
        unit: 'ngày',
        tip: 'Sử dụng AI Scanner để chụp nhanh bữa ăn hàng ngày giúp kiểm soát Calo chuẩn xác nhất.',
        rewardXp: 100
      },
      {
        id: 'b5',
        title: 'Thói Quên Uống Nước',
        category: 'nutrition',
        icon: '💧',
        description: 'Ghi chép lượng nước uống 5 ngày',
        target: 5,
        actual: journalMetrics.waterDaysCount,
        unit: 'ngày',
        tip: 'Đủ nước giúp tối ưu hóa quá trình trao đổi chất, hỗ trợ giảm mỡ và phục hồi cơ bắp.',
        rewardXp: 100
      },
      {
        id: 'b6',
        title: 'Chỉ Số Vóc Dáng',
        category: 'body',
        icon: '📏',
        description: 'Cập nhật số đo cân nặng / tỷ lệ mỡ',
        target: 1,
        actual: journalMetrics.weightLogsCount,
        unit: 'lần',
        tip: 'Thường xuyên theo dõi chỉ số cân nặng và tỷ lệ mỡ cơ thể để Aura kiến tạo lộ trình dinh dưỡng cá nhân hóa hoàn chỉnh nhất.',
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
    safeLocalStorageSet(`aura:gamification:checked-in-dates:${ownerId}`, JSON.stringify(newDates))
    safeLocalStorageSet(`aura:gamification:streak:${ownerId}`, newStreak.toString())
    safeLocalStorageSet(`aura:gamification:longest-streak:${ownerId}`, newLongest.toString())
    safeLocalStorageSet(`aura:gamification:xp:${ownerId}`, newXp.toString())

    // Save to Firestore
    if (ownerId && ownerId !== 'anonymous' && ownerId !== 'demo') {
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
    <div 
      className="pg-card" 
      style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '18px', 
        position: 'relative',
        marginTop: '20px',
        background: '#ffffff',
        borderRadius: '24px',
        padding: '20px',
        border: '1px solid #f1f5f9',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.03)'
      }}
    >
      {/* Check-In Celebration Particles (pure CSS overlay) */}
      {celebrateCheckIn && (        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(255, 255, 255, 0.96)',
          zIndex: 100,
          borderRadius: 24,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: 20,
          animation: 'fade-in 0.3s ease-out'
        }}>
          <div style={{ 
            position: 'relative', 
            width: 80, 
            height: 80, 
            display: 'grid', 
            placeItems: 'center', 
            background: 'linear-gradient(135deg, #ff1a8c 0%, #ff7b54 100%)', 
            borderRadius: '50%', 
            color: '#ffffff', 
            boxShadow: '0 10px 25px rgba(255, 26, 140, 0.4)' 
          }}>
            <Check size={42} strokeWidth={3} />
            <div style={{ position: 'absolute', inset: -8, borderRadius: '50%', border: '2px dashed #ff1a8c', animation: 'spin 12s linear infinite' }} />
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 900, color: '#0f172a', marginTop: 16, marginBottom: 4 }}>Điểm danh thành công!</h3>
          <p style={{ fontSize: 13, color: '#ff1a8c', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Sparkles size={14} /> +50 kinh nghiệm (XP) tích lũy
          </p>
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginTop: 10 }}>Chuỗi kỷ luật của bạn đạt {streak} ngày</span>
        </div>
      )}

      {/* Header section */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Award size={20} style={{ color: '#ff1a8c' }} />
            Điểm danh & Huy hiệu
          </h2>
          <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500, marginTop: '2px', display: 'block' }}>
            Giữ ngọn lửa kỷ luật để mở khóa thành tựu xuất sắc
          </span>
        </div>

        {/* Level and XP indicator */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 150, background: '#fff0f5', padding: '8px 12px', borderRadius: 12, border: '1px solid rgba(255, 26, 140, 0.15)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#ff1a8c', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Zap size={13} style={{ color: '#ff1a8c', fill: '#ff1a8c' }} />
              Cấp độ {currentLevel}
            </span>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#ff7b54' }}>{xp} XP</span>
          </div>
          <div style={{ width: '100%', height: 6, background: 'rgba(255, 26, 140, 0.15)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${xpPercent}%`, height: '100%', background: 'linear-gradient(90deg, #ff1a8c 0%, #ff7b54 100%)', borderRadius: 3 }} />
          </div>
          <span style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, textAlign: 'right' }}>Còn {500 - xpInCurrentLevel} XP lên cấp</span>
        </div>
      </div>

      {/* Gamification Numbers summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Streak card */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'linear-gradient(135deg, #fff0f5 0%, #ffffff 100%)', border: '1px solid rgba(255, 26, 140, 0.18)', padding: '12px 14px', borderRadius: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #ff1a8c 0%, #ff7b54 100%)', display: 'grid', placeItems: 'center', color: '#ffffff', boxShadow: '0 4px 12px rgba(255, 26, 140, 0.25)' }}>
            <Flame size={22} style={{ fill: '#ffffff' }} />
          </div>
          <div>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#ff1a8c', letterSpacing: '0.5px', textTransform: 'uppercase', display: 'block' }}>CHUỖI HIỆN TẠI</span>
            <strong style={{ fontSize: 18, fontWeight: 900, color: '#0f172a' }}>{streak} ngày</strong>
          </div>
        </div>

        {/* Badges card */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'linear-gradient(135deg, #fff5f8 0%, #ffffff 100%)', border: '1px solid rgba(255, 123, 84, 0.2)', padding: '12px 14px', borderRadius: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg, #ff7b54 0%, #ff1a8c 100%)', display: 'grid', placeItems: 'center', color: '#ffffff', boxShadow: '0 4px 12px rgba(255, 123, 84, 0.25)' }}>
            <Award size={22} />
          </div>
          <div>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#ff7b54', letterSpacing: '0.5px', textTransform: 'uppercase', display: 'block' }}>ĐÃ MỞ KHÓA</span>
            <strong style={{ fontSize: 18, fontWeight: 900, color: '#0f172a' }}>{unlockedBadgesCount} / {badges.length} huy hiệu</strong>
          </div>
        </div>
      </div>

      {/* Attendance Board Calendar Grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, background: '#f8fafc', padding: 16, borderRadius: 18, border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Calendar size={15} style={{ color: '#ff1a8c' }} />
            Bảng điểm danh tuần này
          </span>
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Kỷ lục chuỗi: <strong style={{ color: '#ff1a8c' }}>{longestStreak} ngày</strong></span>
        </div>

        {/* Weekly strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, textAlign: 'center' }}>
          {weekDays.map((day) => {
            const isCompleted = checkedInDates.includes(day.dateStr)
            
            return (
              <div key={day.dateStr} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: day.isToday ? '#ff1a8c' : '#94a3b8' }}>
                  {day.name} {day.isToday && '•'}
                </span>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: isCompleted 
                      ? 'linear-gradient(135deg, #ff1a8c 0%, #ff7b54 100%)' 
                      : (day.isToday ? '#fff0f5' : '#e2e8f0'),
                    color: isCompleted ? '#ffffff' : (day.isToday ? '#ff1a8c' : '#64748b'),
                    border: day.isToday && !isCompleted ? '1.5px solid #ff1a8c' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 900,
                    boxShadow: isCompleted ? '0 4px 10px rgba(255, 26, 140, 0.3)' : 'none',
                  }}
                >
                  {isCompleted ? <Check size={15} strokeWidth={3} /> : day.label}
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
            marginTop: 4,
            width: '100%',
            height: 44,
            borderRadius: 14,
            border: 'none',
            background: isCheckedInToday 
              ? '#e2e8f0' 
              : 'linear-gradient(135deg, #ff1a8c 0%, #ff7b54 100%)',
            color: isCheckedInToday ? '#94a3b8' : '#ffffff',
            fontSize: 14,
            fontWeight: 800,
            cursor: isCheckedInToday ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            boxShadow: isCheckedInToday ? 'none' : '0 6px 20px rgba(255, 26, 140, 0.35)',
            transition: 'all 0.2s'
          }}
        >
          {isCheckedInToday ? (
            <>
              <Check size={16} strokeWidth={3} />
              <span>Đã điểm danh hôm nay (Quay lại vào ngày mai)</span>
            </>
          ) : (
            <>
              <Sparkles size={16} />
              <span>Bấm Điểm Danh Hôm Nay (+50 XP)</span>
            </>
          )}
        </button>
      </div>

      {/* Badges tabs filter */}
      <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid #f1f5f9', paddingBottom: 8, overflowX: 'auto' }}>
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
              padding: '6px 14px',
              borderRadius: 10,
              border: 'none',
              background: activeTab === tab.id ? '#fff0f5' : 'transparent',
              color: activeTab === tab.id ? '#ff1a8c' : '#64748b',
              fontSize: 12,
              fontWeight: 800,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Badges Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(135px, 1fr))', gap: 12 }}>
        {filteredBadges.map((badge) => {
          const isUnlocked = badge.actual >= badge.target
          const percent = Math.min(100, Math.round((badge.actual / badge.target) * 100))

          return (
            <div
              key={badge.id}
              onClick={() => setShowBadgeModal(badge)}
              style={{
                background: isUnlocked ? '#ffffff' : '#f8fafc',
                border: isUnlocked ? '1.5px solid rgba(255, 26, 140, 0.25)' : '1px dashed #cbd5e1',
                borderRadius: 16,
                padding: '14px 10px',
                textAlign: 'center',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                position: 'relative',
                transition: 'all 0.2s',
                boxShadow: isUnlocked ? '0 4px 12px rgba(255, 26, 140, 0.05)' : 'none'
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
                color: isUnlocked ? '#ff1a8c' : '#94a3b8'
              }}>
                {isUnlocked ? (
                  <ShieldCheck size={16} style={{ fill: '#fff0f5' }} />
                ) : (
                  <Lock size={12} />
                )}
              </div>

              {/* Title & Stats */}
              <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: 2 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: isUnlocked ? '#0f172a' : '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {badge.title}
                </span>
                <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, height: 28, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {badge.description}
                </span>
              </div>

              {/* Progress bar for locked badges */}
              <div style={{ width: '100%', marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, fontWeight: 800, color: isUnlocked ? '#ff1a8c' : '#64748b' }}>
                  <span>{percent}%</span>
                  <span>{badge.actual}/{badge.target} {badge.unit}</span>
                </div>
                <div style={{ width: '100%', height: 5, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    width: `${percent}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #ff1a8c 0%, #ff7b54 100%)',
                    borderRadius: 3
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
            borderRadius: 24,
            width: '100%',
            maxWidth: 380,
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            border: '1px solid #f1f5f9',
            overflow: 'hidden',
            animation: 'scale-up 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
          }}>
            {/* Modal Header */}
            <div style={{ position: 'relative', background: 'linear-gradient(135deg, #fff0f5 0%, #ffe4f0 100%)', padding: '28px 20px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
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
                  width: 28,
                  height: 28,
                  display: 'grid',
                  placeItems: 'center',
                  cursor: 'pointer',
                  color: '#475569'
                }}
              >
                <X size={16} />
              </button>
              <div style={{ fontSize: 60, marginBottom: 10, animation: 'bounce 2s infinite' }}>
                {showBadgeModal.icon}
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 900, color: '#0f172a', margin: 0 }}>{showBadgeModal.title}</h3>
              <span style={{ fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 20, background: showBadgeModal.actual >= showBadgeModal.target ? '#fff0f5' : '#f1f5f9', color: showBadgeModal.actual >= showBadgeModal.target ? '#ff1a8c' : '#64748b', marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {showBadgeModal.actual >= showBadgeModal.target ? (
                  <>
                    <ShieldCheck size={14} />
                    Đã hoàn thành
                  </>
                ) : (
                  <>
                    <Lock size={12} />
                    Chưa mở khóa
                  </>
                )}
              </span>
            </div>

            {/* Modal Body */}
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Requirements & Progress */}
              <div style={{ background: '#f8fafc', padding: 14, borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#64748b' }}>YÊU CẦU MỞ KHÓA</span>
                <p style={{ fontSize: 13, color: '#1e293b', fontWeight: 600, margin: 0 }}>
                  {showBadgeModal.description}
                </p>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, fontWeight: 800, color: '#475569', marginTop: 4 }}>
                  <span>Tiến độ:</span>
                  <span style={{ color: showBadgeModal.actual >= showBadgeModal.target ? '#ff1a8c' : '#ff7b54' }}>
                    {showBadgeModal.actual} / {showBadgeModal.target} {showBadgeModal.unit}
                  </span>
                </div>
              </div>

              {/* Coaching/Motivation Tips */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#64748b', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <HelpCircle size={14} style={{ color: '#ff1a8c' }} />
                  Bí kíp của huấn luyện viên Aura:
                </span>
                <p style={{ fontSize: 12, color: '#475569', fontWeight: 500, lineHeight: 1.5, margin: 0 }}>
                  {showBadgeModal.tip}
                </p>
              </div>

              {/* Reward */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Star size={16} style={{ color: '#ff7b54', fill: '#ff7b54' }} />
                  <span style={{ fontSize: 12, color: '#475569', fontWeight: 700 }}>Phần thưởng hoàn thành:</span>
                </div>
                <strong style={{ fontSize: 14, color: '#ff1a8c', fontWeight: 900 }}>+{showBadgeModal.rewardXp} XP</strong>
              </div>

              {/* Close Button */}
              <button
                type="button"
                onClick={() => setShowBadgeModal(null)}
                style={{
                  width: '100%',
                  height: 42,
                  borderRadius: 12,
                  border: 'none',
                  background: 'linear-gradient(135deg, #ff1a8c 0%, #ff7b54 100%)',
                  color: '#ffffff',
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: 'pointer',
                  marginTop: 4,
                  boxShadow: '0 4px 15px rgba(255, 26, 140, 0.3)'
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
