import React, { useState, useEffect, useMemo } from 'react'
import {
  ArrowRight,
  Award,
  BookOpen,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Dumbbell,
  Flame,
  Play,
  Sparkles,
  Trophy,
  Check,
  Zap,
} from 'lucide-react'
import { courses as demoCourses, weeklyActivity } from '../../data'
import type { Course, ViewId, CourseProgress } from '../../types'
import { ProgressBar, ProgressRing, SectionHeader, StatCard } from '../../components/ui'
import { saveUserGamification, subscribeToUserGamification } from '../../services/firebaseService'

interface HomePageProps {
  onNavigate: (view: ViewId) => void
  onOpenCourse: (courseId: string) => void
  courseItems?: Course[]
  displayName?: string
  isDemo?: boolean
  ownerId?: string
  progressItems?: CourseProgress[]
}

export default function HomePage({
  onNavigate,
  onOpenCourse,
  courseItems = demoCourses,
  displayName = 'Thành viên Aura',
  isDemo = true,
  ownerId = 'demo',
  progressItems = [],
}: HomePageProps) {
  const now = new Date()
  const dateLabel = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' }).format(now).toUpperCase()
  const greeting = now.getHours() < 11 ? 'Chào buổi sáng' : now.getHours() < 18 ? 'Chào buổi chiều' : 'Chào buổi tối'
  const firstName = displayName.trim().split(/\s+/).slice(-1)[0] || 'bạn'
  
  const continueCourses = courseItems.filter((course) => course.status !== 'Khám phá').slice(0, 2)
  const learningCourses = courseItems.filter((course) => course.status !== 'Khám phá')
  
  const overallCourseProgress = learningCourses.length 
    ? Math.round(learningCourses.reduce((total, course) => total + course.progress, 0) / learningCourses.length) 
    : 0
  const completedCourses = learningCourses.filter((course) => course.progress >= 100)
  
  // Dynamic completed lessons calculation based on real lesson progress state
  const completedLessonsCount = useMemo(() => {
    if (!progressItems || !Array.isArray(progressItems)) return 0
    return progressItems.reduce((acc, progress) => acc + (progress.completedLessonIds?.length || 0), 0)
  }, [progressItems])

  const totalLessons = learningCourses.reduce((total, course) => total + course.lessons, 0)

  // Gamification stats state with offline local storage fallback
  const [streak, setStreak] = useState<number>(() => {
    const isDemoUser = ownerId === 'demo'
    const cached = localStorage.getItem(`aura:gamification:streak:${ownerId}`)
    return cached ? parseInt(cached, 10) : (isDemoUser ? 5 : 0)
  })
  const [longestStreak, setLongestStreak] = useState<number>(() => {
    const isDemoUser = ownerId === 'demo'
    const cached = localStorage.getItem(`aura:gamification:longest-streak:${ownerId}`)
    return cached ? parseInt(cached, 10) : (isDemoUser ? 10 : 0)
  })
  const [xp, setXp] = useState<number>(() => {
    const isDemoUser = ownerId === 'demo'
    const cached = localStorage.getItem(`aura:gamification:xp:${ownerId}`)
    return cached ? parseInt(cached, 10) : (isDemoUser ? 300 : 0)
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
      // Generate default mock dates for a friendly beginning for demo user
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
    setLongestStreak(cachedLongest ? parseInt(cachedLongest, 10) : (isDemoUser ? 10 : 0))

    const cachedXp = localStorage.getItem(`aura:gamification:xp:${ownerId}`)
    setXp(cachedXp ? parseInt(cachedXp, 10) : (isDemoUser ? 300 : 0))

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

  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], [])
  const isCheckedInToday = checkedInDates.includes(todayStr)
  const currentLevel = Math.floor(xp / 500) + 1

  // Local physical logs query for badge count
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
      console.error('Error computing home badge metrics:', e)
    }

    return {
      mealsCount,
      waterDaysCount,
      workoutsCount,
      weightLogsCount
    }
  }, [ownerId])

  const unlockedBadgesCount = useMemo(() => {
    let count = 0
    if (journalMetrics.mealsCount >= 7) count++
    if (journalMetrics.workoutsCount >= 10) count++
    if (journalMetrics.waterDaysCount >= 5) count++
    if (streak >= 7) count++
    if (journalMetrics.weightLogsCount >= 5) count++
    if (journalMetrics.weightLogsCount > 0) count++
    if (completedLessonsCount >= 5) count++
    if (completedLessonsCount >= 15) count++
    return count
  }, [journalMetrics, streak, completedLessonsCount])

  // Dynamic weekly activity tracking based on current calendar week
  const dynamicWeeklyActivity = useMemo(() => {
    const isDemoUser = ownerId === 'demo'
    
    // Determine the dates of the current week (Monday to Sunday)
    const today = new Date()
    const currentDay = today.getDay() // 0 = Sunday, 1 = Monday, ...
    const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay // Offset to get Monday
    
    const monday = new Date(today)
    monday.setDate(today.getDate() + mondayOffset)
    
    const daysLabel = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
    let hasAnyLogs = false
    
    const result = daysLabel.map((label, idx) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + idx)
      const dateStr = d.toISOString().split('T')[0]
      
      let activeMinutes = 0
      try {
        const actRaw = localStorage.getItem(`aura:nutrition:activities:v1:${ownerId}`)
        if (actRaw) {
          const acts = JSON.parse(actRaw)
          if (Array.isArray(acts)) {
            const dayActs = acts.filter(a => a.date === dateStr)
            if (dayActs.length > 0) {
              hasAnyLogs = true
            }
            activeMinutes = dayActs.reduce((sum, a) => sum + (Number(a.durationMinutes) || 0), 0)
          }
        }
      } catch (e) {
        console.error(e)
      }
      
      return {
        day: label,
        minutes: activeMinutes,
        completed: activeMinutes > 0,
      }
    })
    
    // Fallback to static weeklyActivity if it's the demo user and no workouts are logged yet
    if (!hasAnyLogs && isDemoUser) {
      return weeklyActivity
    }
    
    return result
  }, [ownerId])

  const dynamicTotalWeeklyMinutes = useMemo(() => {
    // If it's a real user and there are no logged workouts yet, show 0 instead of hardcoded 160
    const minutesSum = dynamicWeeklyActivity.reduce((sum, item) => sum + item.minutes, 0)
    if (minutesSum === 0 && ownerId !== 'demo') {
      return 0
    }
    // For demo/unlogged users with fallback, use 160 + journal workouts or the actual sum
    return minutesSum || (160 + journalMetrics.workoutsCount * 30)
  }, [dynamicWeeklyActivity, ownerId, journalMetrics.workoutsCount])

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

    // Save to firebase if not demo
    if (ownerId && ownerId !== 'demo' && ownerId !== 'anonymous') {
      saveUserGamification(ownerId, {
        streak: newStreak,
        longestStreak: newLongest,
        xp: newXp,
        checkedInDates: newDates,
        updatedAt: new Date().toISOString()
      }).catch((err) => {
        console.error('Failed to save gamification stats:', err)
      })
    }
  }

  return (
    <div className="page home-page">
      {/* Header with Welcome and Level stats */}
      <section className="welcome-row">
        <div>
          <span className="eyebrow">{dateLabel}</span>
          <h1>{greeting}, {firstName}! <span>👋</span></h1>
          <p>Học kiến thức tại Aura Academy và theo dõi kế hoạch tập luyện PT trong hai không gian độc lập.</p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <div className="streak-pill" style={{ background: 'rgba(247, 37, 103, 0.08)', color: '#f72567', border: '1px solid rgba(247, 37, 103, 0.15)' }}>
            <Flame size={18} fill="currentColor" />
            <strong>{streak}</strong>
            <span>ngày liên tiếp</span>
          </div>
          <div className="streak-pill" style={{ background: 'rgba(255, 122, 56, 0.08)', color: '#ff7a38', border: '1px solid rgba(255, 122, 56, 0.15)' }}>
            <Zap size={18} fill="currentColor" />
            <strong>Cấp {currentLevel}</strong>
            <span>({xp} XP)</span>
          </div>
        </div>
      </section>

      {/* Interactive Attendance Check-in Banner */}
      {!isCheckedInToday && (
        <section style={{ marginBottom: 24 }}>
          <div 
            style={{
              background: 'linear-gradient(135deg, #f72567 0%, #ff7a38 100%)',
              borderRadius: 16,
              padding: '20px 24px',
              color: '#ffffff',
              boxShadow: '0 10px 30px rgba(247, 37, 103, 0.2)',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              transition: 'all 0.3s ease'
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div 
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    background: 'rgba(255, 255, 255, 0.18)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22
                  }}
                >
                  🔥
                </div>
                <div>
                  <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: '#ffffff', lineHeight: 1.3 }}>
                    Chưa điểm danh hôm nay!
                  </h3>
                  <p style={{ fontSize: 14, margin: '4px 0 0 0', opacity: 0.9, fontWeight: 500 }}>
                    Điểm danh ngay bây giờ để nhận +50 XP và tích lũy chuỗi thói quen sắt đá!
                  </p>
                </div>
              </div>

              <button
                onClick={handleCheckIn}
                style={{
                  background: '#ffffff',
                  color: '#f72567',
                  border: 'none',
                  padding: '12px 24px',
                  borderRadius: 12,
                  fontWeight: 800,
                  fontSize: 14,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: '0 4px 15px rgba(0, 0, 0, 0.08)',
                  transition: 'transform 0.2s ease, opacity 0.2s ease'
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = 'scale(0.96)'
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = 'scale(1)'
                }}
              >
                <Flame size={18} fill="currentColor" />
                <span>Bấm điểm danh (+50 XP)</span>
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Hero Grid with current learning info and course progression */}
      <section className="hero-grid">
        <article className="today-workout">
          <div className="today-workout__content">
            <span className="hero-label"><span /> AURA ACADEMY · TIẾP TỤC HỌC</span>
            <h2>{continueCourses[0]?.title ?? 'Nền tảng dinh dưỡng ứng dụng'}</h2>
            <div className="workout-meta">
              <span><Clock3 size={17} /> {continueCourses[0]?.duration ?? '6 tuần'}</span>
              <span><BookOpen size={17} /> {continueCourses[0]?.lessons ?? 24} bài học</span>
              <span><BrainCircuit size={17} /> Học · Ôn · Kiểm tra</span>
            </div>
            <button className="primary-button light" onClick={() => continueCourses[0] ? onOpenCourse(String(continueCourses[0].id)) : onNavigate('courses')}><Play size={18} fill="currentColor" /> {continueCourses[0] ? 'Tiếp tục học' : 'Khám phá khóa học'}</button>
          </div>
          <div className="hero-visual" aria-hidden="true" style={{ overflow: 'hidden' }}>
            <div className="hero-orbit orbit-one" />
            <div className="hero-orbit orbit-two" />
            <div className="hero-number">A+</div>
            <div className="hero-dumbbell academy-orbit-mark"><BrainCircuit size={62} /></div>
            <small style={{ letterSpacing: '0.15em' }}>DINH DƯỠNG CHUYÊN SÂU</small>
          </div>
        </article>

        <article className="weekly-goal card">
          <div className="weekly-goal__top">
            <div>
              <span className="eyebrow">TIẾN ĐỘ HỌC TẬP</span>
              <h3>{learningCourses.length ? 'Tiếp tục hành trình của bạn' : 'Chọn khóa học đầu tiên'}</h3>
            </div>
            <ProgressRing value={learningCourses.length ? overallCourseProgress : 0} size={76} stroke={8} />
          </div>
          
          <div className="goal-row">
            <span><CheckCircle2 size={18} /> Khóa học đang tham gia</span>
            <strong>{completedCourses.length}/{learningCourses.length}</strong>
          </div>
          <ProgressBar value={learningCourses.length ? Math.round((completedCourses.length / learningCourses.length) * 100) : 0} />
          
          <div className="goal-row" style={{ marginTop: 12 }}>
            <span><BookOpen size={18} /> Bài lý thuyết đã xong</span>
            <strong>{completedLessonsCount}/{totalLessons || 24}</strong>
          </div>
          <ProgressBar value={totalLessons ? Math.round((completedLessonsCount / totalLessons) * 100) : 0} tone="green" />
          
          <div className="goal-tip" style={{ marginTop: 16 }}>
            <Sparkles size={17} />
            <span>Tiến độ được cập nhật tức thì khi bạn học xong mỗi bài lý thuyết.</span>
          </div>
        </article>
      </section>

      {/* Courses in progress section */}
      <section>
        <SectionHeader title="Tiếp tục hành trình" action="Xem tất cả" onAction={() => onNavigate('courses')} />
        <div className="continue-grid">
          {continueCourses.map((course, index) => (
            <article className="continue-card" key={course.id} role="link" tabIndex={0} onClick={() => onOpenCourse(String(course.id))} onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onOpenCourse(String(course.id))
              }
            }}>
              <div className={`course-thumb ${course.accent}`}>
                <span className="course-thumb__mesh" />
                {index === 0 ? <BookOpen size={42} /> : <span className="nutrition-glyph">A+</span>}
                <span className="course-type">AURA ACADEMY</span>
              </div>
              <div className="continue-card__body">
                <div className="course-kicker">{course.category} · {course.level}</div>
                <h3>{course.title}</h3>
                <span className="lesson-position">{course.progress > 0 ? `${course.progress}% lộ trình đã hoàn thành` : `${course.lessons} bài học đang chờ bạn`}</span>
                <div className="course-progress-row"><ProgressBar value={course.progress} tone={course.accent} /><strong>{course.progress}%</strong></div>
              </div>
              <span className="round-arrow" aria-hidden="true"><ArrowRight size={18} /></span>
            </article>
          ))}
          {continueCourses.length === 0 && (
            <div className="empty-state card">
              <BookOpen size={30} />
              <h3>Chọn khóa học đầu tiên</h3>
              <p>Khám phá thư viện Aura và bắt đầu một lộ trình phù hợp với bạn.</p>
              <button className="primary-button" onClick={() => onNavigate('courses')}>Khám phá khóa học</button>
            </div>
          )}
        </div>
      </section>

      {/* Activities tracking view */}
      <section className="overview-grid">
        <article className="activity-card card">
          <SectionHeader title="Hoạt động tuần này" action="Chi tiết" onAction={() => onNavigate('progress')} />
          <div className="activity-summary">
            <strong>{dynamicTotalWeeklyMinutes}</strong>
            <span>phút vận động</span>
            <small>Tập trung kỷ luật</small>
          </div>
          <div className="mini-chart">
            {dynamicWeeklyActivity.map((item) => (
              <div className="mini-chart__column" key={item.day}>
                <div className="bar-track"><span className={item.completed ? 'done' : ''} style={{ height: `${Math.max(item.minutes * 1.35, 8)}px` }} /></div>
                <small>{item.day}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="next-events card">
          <SectionHeader title="Lịch sắp tới" action="Mở lịch" onAction={() => onNavigate('schedule')} />
          <div className="event-row">
            <div className="event-date"><strong>+1</strong><small>NGÀY</small></div>
            <div>
              <strong>Mobility Flow</strong>
              <span><CalendarDays size={14} /> 07:30 · 25 phút</span>
            </div>
            <ChevronRight size={18} />
          </div>
          <div className="event-row">
            <div className="event-date orange"><strong>+2</strong><small>NGÀY</small></div>
            <div>
              <strong>Q&A Dinh dưỡng cùng PT</strong>
              <span><CalendarDays size={14} /> 20:00 · Trực tuyến</span>
            </div>
            <ChevronRight size={18} />
          </div>
        </article>
      </section>

      {/* Gamified streaks and badges display directly on student dashboard */}
      <section>
        <SectionHeader title="Thành tích đạt được" action="Mở bộ sưu tập" onAction={() => { onNavigate('progress') }} />
        <div className="achievement-row">
          <StatCard 
            icon={<Flame />} 
            value={`${streak} ngày`} 
            label="Chuỗi điểm danh" 
            detail={`Kỷ lục dài nhất: ${longestStreak} ngày`} 
            tone="orange" 
          />
          <StatCard 
            icon={<Trophy />} 
            value={`${completedLessonsCount} bài`} 
            label="Bài học hoàn thành" 
            detail="Tích lũy lý thuyết dinh dưỡng" 
            tone="purple" 
          />
          <StatCard 
            icon={<Award />} 
            value={`${unlockedBadgesCount} huy hiệu`} 
            label="Huy hiệu đã mở" 
            detail="Hành trình kỷ luật toàn diện" 
            tone="green" 
          />
        </div>
      </section>
    </div>
  )
}
