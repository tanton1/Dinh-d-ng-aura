import React, { useState, useEffect, useMemo } from 'react'
import { safeLocalStorageSet } from '../../lib/safeStorage'
import {
  ArrowRight,
  CalendarDays,
  Trophy,
} from 'lucide-react'
import type { Course, ViewId, CourseProgress } from '../../types'
import AuraTodayFlow from '../../components/AuraTodayFlow'
import {
  asStudentPtScheduleError,
  listMyStudentPtSchedule,
  type StudentPtSession,
} from '../../services/studentPtScheduleService'
import { buildStudentHomeSchedule } from '../../features/home/studentHomeSchedule'
import {
  readRecentAverageWeight,
  resolveDailyNutritionTargets,
} from '../../features/nutrition/dailyNutritionTargets'
import {
  saveUserGamification,
  subscribeToUserGamification,
  subscribeToUserMealLogsForDate,
  subscribeToUserWaterLogsForDate,
} from '../../services/firebaseService'
import type { NutritionProfileDraft } from './NutritionPage'

interface DailyPulseMeal {
  id?: string
  date?: string
  status?: string
  time?: string
  label?: string
  title?: string
  calories?: number
  protein?: number
}

interface DailyPulseWaterEntry {
  id?: string
  date?: string
  amountMl?: number
}

function toLocalDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function readStoredArray<T>(key: string): T[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? '[]')
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

function formatScheduleDay(dateId: string) {
  const target = new Date(`${dateId}T12:00:00`)
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const targetStart = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  const dayDelta = Math.round((targetStart.getTime() - todayStart.getTime()) / 86_400_000)
  if (dayDelta === 0) return 'Hôm nay'
  if (dayDelta === 1) return 'Ngày mai'
  if (dayDelta > 1 && dayDelta <= 7) return `Còn ${dayDelta} ngày`
  return new Intl.DateTimeFormat('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(target)
}

function formatScheduleHour(hour: number | null) {
  return hour === null ? 'Chưa rõ giờ' : `${String(hour).padStart(2, '0')}:00`
}

interface HomePageProps {
  onNavigate: (view: ViewId) => void
  onOpenCourse: (courseId: string) => void
  courseItems?: Course[]
  displayName?: string
  isDemo?: boolean
  ownerId?: string
  progressItems?: CourseProgress[]
  nutritionProfile?: NutritionProfileDraft | null
}

export default function HomePage({
  onNavigate,
  displayName = 'Thành viên Aura',
  isDemo = true,
  ownerId = 'demo',
  nutritionProfile,
}: HomePageProps) {
  const now = new Date()
  const firstName = displayName.trim().split(/\s+/).slice(-1)[0] || 'bạn'
  const todayDateId = toLocalDateKey(now)

  const [dailyPulseMeals, setDailyPulseMeals] = useState<DailyPulseMeal[]>(() =>
    readStoredArray<DailyPulseMeal>(`aura:nutrition:meals:v2:${ownerId}`)
  )
  const [dailyPulseWater, setDailyPulseWater] = useState<DailyPulseWaterEntry[]>(() =>
    readStoredArray<DailyPulseWaterEntry>(`aura:nutrition:water-entries:v1:${ownerId}`)
  )
  const [upcomingSchedule, setUpcomingSchedule] = useState<StudentPtSession[]>([])
  const [todaySessionCount, setTodaySessionCount] = useState(0)
  const [scheduleState, setScheduleState] = useState<'loading' | 'linked' | 'unlinked' | 'unavailable'>('loading')
  const [weeklyScheduleMinutesByDate, setWeeklyScheduleMinutesByDate] = useState<Record<string, number>>({})
  const [weekPanel, setWeekPanel] = useState<'activity' | 'schedule'>('activity')

  useEffect(() => {
    setDailyPulseMeals(readStoredArray<DailyPulseMeal>(`aura:nutrition:meals:v2:${ownerId}`))
    setDailyPulseWater(readStoredArray<DailyPulseWaterEntry>(`aura:nutrition:water-entries:v1:${ownerId}`))

    if (isDemo || !ownerId || ownerId === 'anonymous') return

    try {
      const unsubscribeMeals = subscribeToUserMealLogsForDate(ownerId, todayDateId, (remoteMeals) => {
        setDailyPulseMeals(Array.isArray(remoteMeals) ? remoteMeals as DailyPulseMeal[] : [])
      })
      const unsubscribeWater = subscribeToUserWaterLogsForDate(ownerId, todayDateId, (remoteWater) => {
        setDailyPulseWater(Array.isArray(remoteWater) ? remoteWater as DailyPulseWaterEntry[] : [])
      })
      return () => {
        unsubscribeMeals()
        unsubscribeWater()
      }
    } catch (error) {
      console.warn('Aura Today Flow đang dùng dữ liệu gần nhất trên thiết bị:', error)
    }
  }, [isDemo, ownerId, todayDateId])

  useEffect(() => {
    let active = true
    const currentDate = new Date()
    const today = toLocalDateKey(currentDate)
    const through = new Date(currentDate)
    through.setDate(through.getDate() + 30)
    const currentDay = currentDate.getDay()
    const monday = new Date(currentDate)
    monday.setDate(currentDate.getDate() + (currentDay === 0 ? -6 : 1 - currentDay))
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    const weekFromDate = toLocalDateKey(monday)
    const weekToDate = toLocalDateKey(sunday)

    const applySessions = (sessions: StudentPtSession[]) => {
      const summary = buildStudentHomeSchedule(sessions, today, weekFromDate, weekToDate)
      setUpcomingSchedule(summary.upcomingSessions)
      setTodaySessionCount(summary.todaySessionCount)
      setWeeklyScheduleMinutesByDate(summary.weeklyCompletedMinutesByDate)
    }

    setScheduleState('loading')
    applySessions([])

    if (isDemo) {
      const tomorrow = new Date(currentDate)
      tomorrow.setDate(tomorrow.getDate() + 1)
      const later = new Date(currentDate)
      later.setDate(later.getDate() + 3)
      applySessions([
        { id: 'demo-home-1', date: toLocalDateKey(tomorrow), hour: 18, status: 'scheduled', trainerId: 'demo-trainer', trainerName: 'PT Minh', branchId: 'demo-branch', verifiedByStudent: false, scheduleEntryId: '', revision: 1, timeZone: 'Asia/Ho_Chi_Minh' },
        { id: 'demo-home-2', date: toLocalDateKey(later), hour: 19, status: 'scheduled', trainerId: 'demo-trainer', trainerName: 'PT Minh', branchId: 'demo-branch', verifiedByStudent: false, scheduleEntryId: '', revision: 1, timeZone: 'Asia/Ho_Chi_Minh' },
      ])
      setScheduleState('linked')
      return () => { active = false }
    }

    if (!ownerId || ownerId === 'anonymous') {
      setScheduleState('unlinked')
      return () => { active = false }
    }

    // This is the same identity-aware callable used by the student's Schedule page.
    listMyStudentPtSchedule(weekFromDate, toLocalDateKey(through), weekFromDate)
      .then((data) => {
        if (!active) return
        applySessions(data.sessions)
        setScheduleState(data.linked ? 'linked' : 'unlinked')
      })
      .catch((error) => {
        if (!active) return
        const issue = asStudentPtScheduleError(error)
        setScheduleState(issue.issueCode === 'PROFILE_NOT_LINKED' ? 'unlinked' : 'unavailable')
      })

    return () => { active = false }
  }, [isDemo, ownerId])

  const effectiveNutritionWeight = useMemo(
    () => readRecentAverageWeight(ownerId, nutritionProfile?.weightKg ?? 0),
    [nutritionProfile?.weightKg, ownerId],
  )
  const dailyPulseTargets = useMemo(
    () => resolveDailyNutritionTargets(nutritionProfile, effectiveNutritionWeight),
    [effectiveNutritionWeight, nutritionProfile],
  )

  const todayPulseMeals = useMemo(() => dailyPulseMeals.filter((meal) =>
    meal.date === todayDateId && meal.status === 'logged'
  ), [dailyPulseMeals, todayDateId])
  const todayCalories = todayPulseMeals.reduce((sum, meal) => sum + (Number(meal.calories) || 0), 0)
  const todayProtein = todayPulseMeals.reduce((sum, meal) => sum + (Number(meal.protein) || 0), 0)
  const todayWaterMl = dailyPulseWater
    .filter((entry) => entry.date === todayDateId)
    .reduce((sum, entry) => sum + (Number(entry.amountMl) || 0), 0)
  const nutritionGoalLabel = nutritionProfile?.goal === 'lose-fat'
    ? 'Giảm mỡ bền vững'
    : nutritionProfile?.goal === 'gain-muscle'
      ? 'Tăng cơ & phục hồi'
      : 'Duy trì thể trạng'
  
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
        toLocalDateKey(yesterday),
        toLocalDateKey(d2),
        toLocalDateKey(d3),
        toLocalDateKey(d4),
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
        toLocalDateKey(yesterday),
        toLocalDateKey(d2),
        toLocalDateKey(d3),
        toLocalDateKey(d4),
      ])
    } else {
      setCheckedInDates([])
    }
  }, [ownerId])

  // Subscribe to real-time gamification stats from Firestore
  useEffect(() => {
    if (isDemo || !ownerId || ownerId === 'demo' || ownerId === 'anonymous') return

    const unsubscribe = subscribeToUserGamification(ownerId, (remote) => {
      if (remote) {
        if (typeof remote.streak === 'number') {
          setStreak(remote.streak)
          safeLocalStorageSet(`aura:gamification:streak:${ownerId}`, remote.streak.toString())
        }
        if (typeof remote.longestStreak === 'number') {
          setLongestStreak(remote.longestStreak)
          safeLocalStorageSet(`aura:gamification:longest-streak:${ownerId}`, remote.longestStreak.toString())
        }
        if (typeof remote.xp === 'number') {
          setXp(remote.xp)
          safeLocalStorageSet(`aura:gamification:xp:${ownerId}`, remote.xp.toString())
        }
        if (Array.isArray(remote.checkedInDates)) {
          setCheckedInDates(remote.checkedInDates)
          safeLocalStorageSet(`aura:gamification:checked-in-dates:${ownerId}`, JSON.stringify(remote.checkedInDates))
        }
      }
    }, (err) => {
      console.warn('Error syncing gamification stats from Firestore:', err)
    })

    return () => unsubscribe()
  }, [isDemo, ownerId])

  const todayStr = useMemo(() => toLocalDateKey(new Date()), [])
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
    return count
  }, [journalMetrics, streak])

  // Dynamic weekly activity tracking based on current calendar week
  const dynamicWeeklyActivity = useMemo(() => {
    // Determine the dates of the current week (Monday to Sunday)
    const today = new Date()
    const currentDay = today.getDay() // 0 = Sunday, 1 = Monday, ...
    const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay // Offset to get Monday
    
    const monday = new Date(today)
    monday.setDate(today.getDate() + mondayOffset)

    const localMinutesByDate: Record<string, number> = {}
    try {
      const rawActivities = localStorage.getItem(`aura:nutrition:activities:v1:${ownerId}`)
      const activities = rawActivities ? JSON.parse(rawActivities) : []
      if (Array.isArray(activities)) {
        for (const activity of activities) {
          if (typeof activity?.date !== 'string') continue
          localMinutesByDate[activity.date] = (localMinutesByDate[activity.date] ?? 0)
            + (Number(activity.durationMinutes) || 0)
        }
      }
    } catch (error) {
      console.warn('Không thể đọc nhật ký vận động gần nhất:', error)
    }

    const daysLabel = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
    const result = daysLabel.map((label, idx) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + idx)
      const dateStr = toLocalDateKey(d)

      // A completed PT session can also be mirrored into the activity journal.
      // Use the larger total so Home neither loses the schedule nor double-counts it.
      const activeMinutes = Math.max(
        weeklyScheduleMinutesByDate[dateStr] ?? 0,
        localMinutesByDate[dateStr] ?? 0,
      )
      
      return {
        day: label,
        minutes: activeMinutes,
        completed: activeMinutes > 0,
      }
    })
    
    return result
  }, [ownerId, weeklyScheduleMinutesByDate])

  const dynamicTotalWeeklyMinutes = useMemo(() => {
    const minutesSum = dynamicWeeklyActivity.reduce((sum, item) => sum + item.minutes, 0)
    return minutesSum
  }, [dynamicWeeklyActivity])

  const todayActivityIndex = now.getDay() === 0 ? 6 : now.getDay() - 1
  const todayMovementMinutes = dynamicWeeklyActivity[todayActivityIndex]?.minutes ?? 0
  const nextMilestone = useMemo(() => {
    const levelStartXp = (currentLevel - 1) * 500
    const earnedInLevel = Math.max(0, xp - levelStartXp)
    const badgeTarget = Math.max(1, Math.min(8, unlockedBadgesCount + 1))
    const candidates = [
      {
        title: `Tiến tới Cấp ${currentLevel + 1}`,
        detail: `Còn ${Math.max(0, 500 - earnedInLevel)} XP để mở cấp độ tiếp theo.`,
        progress: Math.round((earnedInLevel / 500) * 100),
        label: `${earnedInLevel}/500 XP`,
      },
      {
        title: 'Mở huy hiệu tiếp theo',
        detail: `Bạn đã mở ${unlockedBadgesCount} huy hiệu. Duy trì thói quen để hoàn tất bộ sưu tập.`,
        progress: Math.min(100, Math.round((unlockedBadgesCount / badgeTarget) * 100)),
        label: `${unlockedBadgesCount}/${badgeTarget} huy hiệu`,
      },
    ]
    return candidates
      .filter((candidate) => candidate.progress < 100)
      .sort((left, right) => right.progress - left.progress)[0] ?? candidates[0]
  }, [currentLevel, unlockedBadgesCount, xp])

  const handleCheckIn = () => {
    if (isCheckedInToday) return

    const newDates = [...checkedInDates, todayStr]
    
    // Calculate new streak
    let newStreak = streak
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = toLocalDateKey(yesterday)

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

    // Save to firebase if not demo
    if (!isDemo && ownerId && ownerId !== 'demo' && ownerId !== 'anonymous') {
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
      <AuraTodayFlow
        firstName={firstName}
        streak={streak}
        goalLabel={dailyPulseTargets.configured ? nutritionGoalLabel : 'chưa thiết lập mục tiêu'}
        nutritionConfigured={dailyPulseTargets.configured}
        caloriesConsumed={todayCalories}
        calorieGoal={dailyPulseTargets.calorieGoal}
        proteinConsumed={todayProtein}
        proteinGoal={dailyPulseTargets.proteinGoal}
        waterMl={todayWaterMl}
        waterGoalMl={dailyPulseTargets.waterGoal}
        mealsCount={todayPulseMeals.length}
        checkedIn={isCheckedInToday}
        movementMinutesToday={todayMovementMinutes}
        weeklyMovementMinutes={dynamicTotalWeeklyMinutes}
        todayMeals={todayPulseMeals}
        onOpenNutrition={() => onNavigate('nutrition')}
        onOpenEatClean={() => onNavigate('eat-clean')}
        onCheckIn={handleCheckIn}
        onOpenProgress={() => onNavigate('progress')}
        onOpenSchedule={() => onNavigate('schedule')}
        scheduleState={scheduleState}
        todaySessionCount={todaySessionCount}
        nextSession={upcomingSchedule[0] ? {
          dateLabel: formatScheduleDay(upcomingSchedule[0].date),
          timeLabel: formatScheduleHour(upcomingSchedule[0].hour),
          trainerName: upcomingSchedule[0].trainerName || 'Huấn luyện viên Aura',
        } : null}
      />

      <section className="home-v3-week" aria-labelledby="home-week-title">
        <header className="home-v3-week__header">
          <div><span>NHỊP TUẦN</span><h2 id="home-week-title">Tuần của bạn</h2></div>
          <div className="home-v3-week__tabs" role="tablist" aria-label="Thông tin tuần">
            <button type="button" role="tab" aria-selected={weekPanel === 'activity'} className={weekPanel === 'activity' ? 'is-active' : ''} onClick={() => setWeekPanel('activity')}>Hoạt động</button>
            <button type="button" role="tab" aria-selected={weekPanel === 'schedule'} className={weekPanel === 'schedule' ? 'is-active' : ''} onClick={() => setWeekPanel('schedule')}>Lịch sắp tới</button>
          </div>
        </header>

        {weekPanel === 'activity' ? (
          <div className="home-v3-week__panel" role="tabpanel">
            <div className="home-v3-week__summary">
              <div><strong>{dynamicTotalWeeklyMinutes}</strong><span>phút vận động</span></div>
              <small>{dynamicTotalWeeklyMinutes >= 150 ? 'Đã đạt mốc 150 phút' : `Còn ${Math.max(0, 150 - dynamicTotalWeeklyMinutes)} phút để đạt mục tiêu tuần`}</small>
            </div>
            <div className="home-v3-week__chart" aria-label={`${dynamicTotalWeeklyMinutes} phút vận động tuần này`}>
              {dynamicWeeklyActivity.map((item, index) => (
                <div key={item.day} className={index === todayActivityIndex ? 'is-today' : ''}>
                  <span><i className={item.completed ? 'is-done' : ''} style={{ height: `${Math.min(68, Math.max(6, item.minutes * 1.2))}px` }} /></span>
                  <small>{item.day}</small>
                </div>
              ))}
            </div>
            <div className="home-v3-week__footer">
              <span>{dynamicTotalWeeklyMinutes > 0 ? 'Mỗi phút vận động đều được cộng vào nhịp tuần.' : 'Chưa có vận động được ghi trong tuần này.'}</span>
              <button type="button" onClick={() => onNavigate(dynamicTotalWeeklyMinutes > 0 ? 'progress' : 'schedule')}>{dynamicTotalWeeklyMinutes > 0 ? 'Xem tiến độ' : 'Lên lịch'} <ArrowRight size={17} /></button>
            </div>
          </div>
        ) : (
          <div className="home-v3-week__panel home-v3-schedule" role="tabpanel">
            {upcomingSchedule.length > 0 ? (
              <div className="home-v3-schedule__list">
                {upcomingSchedule.map((event) => (
                  <button type="button" key={event.id} className="home-v3-schedule__item" onClick={() => onNavigate('schedule')}>
                    <span className="home-v3-schedule__date"><strong>{formatScheduleDay(event.date)}</strong><small>{formatScheduleHour(event.hour)}</small></span>
                    <span className="home-v3-schedule__copy"><small>BUỔI TẬP PT</small><strong>{event.trainerName || 'Huấn luyện viên Aura'}</strong><em>Đã xếp lịch</em></span>
                    <ArrowRight size={18} />
                  </button>
                ))}
              </div>
            ) : (
              <button type="button" className="home-v3-schedule__empty" onClick={() => onNavigate('schedule')}>
                <span><CalendarDays size={22} /></span>
                <span><strong>Chưa có lịch PT sắp tới</strong><small>Buổi mới sẽ xuất hiện ngay sau khi vận hành xếp lịch.</small></span>
                <ArrowRight size={18} />
              </button>
            )}
            <button type="button" className="home-v3-schedule__open" onClick={() => onNavigate('schedule')}>Mở lịch đầy đủ <ArrowRight size={17} /></button>
          </div>
        )}
      </section>

      <section className="home-v3-milestone" aria-labelledby="home-milestone-title">
          <span className="home-v3-milestone__icon"><Trophy size={24} /></span>
          <div className="home-v3-milestone__copy">
            <span>DẤU MỐC TIẾP THEO</span>
            <h2 id="home-milestone-title">{nextMilestone.title}</h2>
            <p>{nextMilestone.detail}</p>
          </div>
          <div className="home-v3-milestone__progress">
            <span><i style={{ width: `${nextMilestone.progress}%` }} /></span>
            <strong>{nextMilestone.label}</strong>
          </div>
          <button type="button" onClick={() => onNavigate('progress')}>Xem hành trình tiến độ <ArrowRight size={18} /></button>
      </section>
    </div>
  )
}
