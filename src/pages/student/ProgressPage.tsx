import React, { useState, useEffect, useMemo } from 'react'
import { safeLocalStorageSet } from '../../lib/safeStorage'
import '../../styles-progress.css'
import { AlertCircle, LoaderCircle, Plus } from 'lucide-react'

import type { Course, CourseProgress } from '../../types'
import type { BodyMeasurements, ProgressCategory, ProgressPeriod, WeightRecord } from '../../types/progressTypes'

import { ProgressHeader } from '../../components/progress/ProgressHeader'
import { WeeklyScoreCard } from '../../components/progress/WeeklyScoreCard'
import { DailyActionsCard } from '../../components/progress/DailyActionsCard'
import { WeightTrackerCard } from '../../components/progress/WeightTrackerCard'
import { WeightChartCard } from '../../components/progress/WeightChartCard'
import { BodyMetricsCard } from '../../components/progress/BodyMetricsCard'
import { NutritionProgressCard } from '../../components/progress/NutritionProgressCard'
import { NutritionChartsCard } from '../../components/progress/NutritionChartsCard'
import { EnergyBalanceCard } from '../../components/progress/EnergyBalanceCard'
import { ProgressPhotosCard } from '../../components/progress/ProgressPhotosCard'
import { StreaksAndBadgesCard } from '../../components/progress/StreaksAndBadgesCard'
import { AiWeeklyAnalysisCard } from '../../components/progress/AiWeeklyAnalysisCard'

import { QuickLogBottomSheet } from '../../components/progress/QuickLogBottomSheet'
import { WeightLogModal } from '../../components/progress/WeightLogModal'
import { BodyMeasurementsModal } from '../../components/progress/BodyMeasurementsModal'
import { firebaseAuth } from '../../lib/firebase'
import { AiCoachBottomSheet } from '../../components/progress/AiCoachBottomSheet'
import { prewarmAiCoachAppCheck } from '../../services/nutritionService'
import { calculateProgressScore } from '../../utils/progressScoreCalculator'
import type { NutritionProfileDraft } from '../../features/nutrition/types'
import { resolveDailyNutritionTargets } from '../../features/nutrition/dailyNutritionTargets'
import { toLocalDateKey } from '../../features/nutrition/routing'
import {
  saveUserWeightLog,
  subscribeToUserWeightLogs,
  saveUserBodyMeasurements,
  subscribeToUserBodyMeasurements,
  subscribeToUserGamification,
  subscribeToRecentUserMealLogs,
  subscribeToRecentUserWaterLogs,
  subscribeToRecentUserActivityLogs,
} from '../../services/firebaseService'

interface ProgressPageProps {
  courseItems?: Course[]
  progressItems?: CourseProgress[]
  loading?: boolean
  error?: string | null
  onOpenCourse?: (courseId: string) => void
  onNavigate?: (view: any) => void
  ownerId?: string
  weightKg?: number | null
  targetWeightDeltaKg?: number | null
  targetTimeframeMonths?: number | null
  heightCm?: number | null
  nutritionProfile?: NutritionProfileDraft | null
}

export default function ProgressPage({
  courseItems = [],
  progressItems = [],
  loading = false,
  error = null,
  onOpenCourse,
  onNavigate,
  ownerId = 'demo',
  weightKg,
  targetWeightDeltaKg,
  targetTimeframeMonths,
  heightCm,
  nutritionProfile = null,
}: ProgressPageProps) {
  useEffect(() => {
    // Mobile users do not have a hover event. Warm App Check only while the
    // browser is idle so it cannot compete with the progress page's first paint.
    if (!window.matchMedia('(hover: none), (pointer: coarse)').matches) return undefined
    const idleWindow = window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }
    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(prewarmAiCoachAppCheck, { timeout: 2_500 })
      return () => idleWindow.cancelIdleCallback?.(handle)
    }
    const timer = window.setTimeout(prewarmAiCoachAppCheck, 1_500)
    return () => window.clearTimeout(timer)
  }, [])

  const [period, setPeriod] = useState<ProgressPeriod>('7-days')
  const [category, setCategory] = useState<ProgressCategory>('overview')

  // Keep demo data isolated even when Firebase Auth still has a signed-in
  // session (for example role preview/E2E). Replacing `demo` with that UID
  // would start Firestore subscriptions while the app is intentionally using
  // the local backend and can crash the whole progress route.
  const resolvedOwnerId = ownerId?.trim() || firebaseAuth?.currentUser?.uid || 'demo'
  const recentNutritionFromDate = useMemo(() => {
    const firstDay = new Date()
    firstDay.setDate(firstDay.getDate() - 89)
    return toLocalDateKey(firstDay)
  }, [])

  // Modals & Bottom Sheets state
  const [quickLogOpen, setQuickLogOpen] = useState(false)
  const [weightModalOpen, setWeightModalOpen] = useState(false)
  const [metricsModalOpen, setMetricsModalOpen] = useState(false)
  const [coachSheetOpen, setCoachSheetOpen] = useState(false)
  const [triggerPhotoUpload, setTriggerPhotoUpload] = useState(false)
  const [progressMutationError, setProgressMutationError] = useState<string | null>(null)

  // Do not invent a measurement for a real account. Demo mode keeps its
  // sample value, while production stays empty until the member records one.
  const baseWeight = weightKg ?? nutritionProfile?.weightKg ?? (ownerId === 'demo' ? 65.0 : 0)
  const startWeightKg = baseWeight
  const configuredTargetDelta = targetWeightDeltaKg ?? nutritionProfile?.targetWeightDeltaKg ?? null
  const goalWeightKg = baseWeight > 0 && configuredTargetDelta !== null
    ? Number((baseWeight + configuredTargetDelta).toFixed(1))
    : 0

  // Live Nutrition Data States
  const [allMeals, setAllMeals] = useState<any[]>(() => {
    try {
      const raw = localStorage.getItem(`aura:nutrition:meals:v2:${resolvedOwnerId}`)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })

  const [allActivities, setAllActivities] = useState<any[]>(() => {
    try {
      const raw = localStorage.getItem(`aura:nutrition:activities:v1:${resolvedOwnerId}`)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })

  const [allWater, setAllWater] = useState<any[]>(() => {
    try {
      const raw = localStorage.getItem(`aura:nutrition:water-entries:v1:${resolvedOwnerId}`)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    const loadFromStorage = () => {
      try {
        const rawM = localStorage.getItem(`aura:nutrition:meals:v2:${resolvedOwnerId}`)
        if (rawM) setAllMeals(JSON.parse(rawM))
        const rawA = localStorage.getItem(`aura:nutrition:activities:v1:${resolvedOwnerId}`)
        if (rawA) setAllActivities(JSON.parse(rawA))
        const rawW = localStorage.getItem(`aura:nutrition:water-entries:v1:${resolvedOwnerId}`)
        if (rawW) setAllWater(JSON.parse(rawW))
      } catch (e) {
        console.error(e)
      }
    }

    loadFromStorage()

    const handleStorage = () => loadFromStorage()
    window.addEventListener('storage', handleStorage)
    window.addEventListener('aura:nutrition:updated', handleStorage)

    if (resolvedOwnerId && resolvedOwnerId !== 'anonymous' && resolvedOwnerId !== 'demo') {
      const unsubM = subscribeToRecentUserMealLogs(resolvedOwnerId, recentNutritionFromDate, (remote) => {
        if (remote && Array.isArray(remote)) {
          setAllMeals(remote)
        }
      })
      const unsubW = subscribeToRecentUserWaterLogs(resolvedOwnerId, recentNutritionFromDate, (remote) => {
        if (remote && Array.isArray(remote)) {
          setAllWater(remote)
        }
      })
      const unsubA = subscribeToRecentUserActivityLogs(resolvedOwnerId, recentNutritionFromDate, (remote) => {
        if (remote && Array.isArray(remote)) {
          setAllActivities(remote)
        }
      })
      return () => {
        window.removeEventListener('storage', handleStorage)
        window.removeEventListener('aura:nutrition:updated', handleStorage)
        unsubM()
        unsubW()
        unsubA()
      }
    }

    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('aura:nutrition:updated', handleStorage)
    }
  }, [recentNutritionFromDate, resolvedOwnerId])

  // Weight Data State
  const [weightRecords, setWeightRecords] = useState<WeightRecord[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(`aura:progress:weight-records:${ownerId}`)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed) && parsed.length > 0) return parsed
        }
      } catch (e) {
        console.error('Error loading weight records:', e)
      }
    }
    // Generate initial default records if empty
    if (ownerId === 'demo') {
      return [
        { id: '1', date: '2026-07-29', label: '29/07', weightKg: Number((baseWeight + 0.1).toFixed(1)), trendKg: Number((baseWeight + 0.4).toFixed(1)) },
        { id: '2', date: '2026-07-30', label: '30/07', weightKg: Number((baseWeight + 0.7).toFixed(1)), trendKg: Number((baseWeight + 0.3).toFixed(1)) },
        { id: '3', date: '2026-07-31', label: '31/07', weightKg: Number((baseWeight + 0.5).toFixed(1)), trendKg: Number((baseWeight + 0.2).toFixed(1)) },
        { id: '4', date: '2026-08-01', label: '01/08', weightKg: Number((baseWeight - 0.5).toFixed(1)), trendKg: Number((baseWeight + 0.1).toFixed(1)) },
        { id: '5', date: '2026-08-02', label: '02/08', weightKg: Number((baseWeight + 0.2).toFixed(1)), trendKg: Number((baseWeight + 0.0).toFixed(1)) },
        { id: '6', date: '2026-08-03', label: '03/08', weightKg: Number((baseWeight - 0.5).toFixed(1)), trendKg: Number((baseWeight - 0.1).toFixed(1)) },
        { id: '7', date: '2026-08-04', label: '04/08', weightKg: Number((baseWeight).toFixed(1)), trendKg: Number((baseWeight - 0.1).toFixed(1)) },
      ]
    }
    return []
  })

  // Body Metrics State
  const [bodyMetrics, setBodyMetrics] = useState<BodyMeasurements>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(`aura:progress:body-measurements:${ownerId}`)
        if (raw) return JSON.parse(raw)
      } catch (e) {
        console.error('Error loading body metrics:', e)
      }
    }
    const isDemo = ownerId === 'demo'
    return {
      bmi: isDemo ? 23.0 : 0,
      bmiCategory: isDemo ? 'Khỏe mạnh' : 'Chưa cập nhật',
      bodyFatPercentage: isDemo ? 21.3 : 0,
      bodyFatStatus: isDemo ? 'Ổn định' : 'Chưa cập nhật',
      muscleMassKg: isDemo ? 27.6 : 0,
      muscleStatus: isDemo ? 'Tốt' : 'Chưa cập nhật',
      waistCm: isDemo ? 76 : 0,
      waistStatus: isDemo ? 'Tốt' : 'Chưa cập nhật',
      updatedAt: isDemo ? '2026-08-04' : '',
    }
  })

  // Streak state
  const [streak, setStreak] = useState<number>(() => {
    const isDemoUser = ownerId === 'demo'
    const cached = typeof window !== 'undefined' ? localStorage.getItem(`aura:gamification:streak:${ownerId}`) : null
    return cached ? parseInt(cached, 10) : (isDemoUser ? 5 : 0)
  })

  // Dynamically calculate target date based on targetTimeframeMonths
  const targetDateText = useMemo(() => {
    const timeframe = targetTimeframeMonths ?? nutritionProfile?.targetTimeframeMonths ?? (ownerId === 'demo' ? 3 : null)
    if (!timeframe || timeframe <= 0) return 'Chưa thiết lập'
    const targetDate = new Date()
    targetDate.setMonth(targetDate.getMonth() + timeframe)
    return `${String(targetDate.getDate()).padStart(2, '0')}/${String(targetDate.getMonth() + 1).padStart(2, '0')}/${targetDate.getFullYear()}`
  }, [ownerId, targetTimeframeMonths, nutritionProfile?.targetTimeframeMonths])

  const currentWeight = weightRecords[weightRecords.length - 1]?.weightKg ?? baseWeight

  // Subscribe to weight records and body measurements in Firestore
  useEffect(() => {
    const isDemoUser = ownerId === 'demo'
    
    // Reset / load local storage values or defaults first
    let initialWeightRecords = []
    try {
      const raw = window.localStorage.getItem(`aura:progress:weight-records:${ownerId}`)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) initialWeightRecords = parsed
      }
    } catch (e) {
      console.error(e)
    }
    
    if (initialWeightRecords.length > 0) {
      setWeightRecords(initialWeightRecords)
    } else if (isDemoUser) {
      setWeightRecords([
        { id: '1', date: '2026-07-29', label: '29/07', weightKg: Number((baseWeight + 0.1).toFixed(1)), trendKg: Number((baseWeight + 0.4).toFixed(1)) },
        { id: '2', date: '2026-07-30', label: '30/07', weightKg: Number((baseWeight + 0.7).toFixed(1)), trendKg: Number((baseWeight + 0.3).toFixed(1)) },
        { id: '3', date: '2026-07-31', label: '31/07', weightKg: Number((baseWeight + 0.5).toFixed(1)), trendKg: Number((baseWeight + 0.2).toFixed(1)) },
        { id: '4', date: '2026-08-01', label: '01/08', weightKg: Number((baseWeight - 0.5).toFixed(1)), trendKg: Number((baseWeight + 0.1).toFixed(1)) },
        { id: '5', date: '2026-08-02', label: '02/08', weightKg: Number((baseWeight + 0.2).toFixed(1)), trendKg: Number((baseWeight + 0.0).toFixed(1)) },
        { id: '6', date: '2026-08-03', label: '03/08', weightKg: Number((baseWeight - 0.5).toFixed(1)), trendKg: Number((baseWeight - 0.1).toFixed(1)) },
        { id: '7', date: '2026-08-04', label: '04/08', weightKg: Number((baseWeight).toFixed(1)), trendKg: Number((baseWeight - 0.1).toFixed(1)) },
      ])
    } else {
      setWeightRecords([])
    }

    let initialBodyMetrics = null
    try {
      const raw = window.localStorage.getItem(`aura:progress:body-measurements:${ownerId}`)
      if (raw) initialBodyMetrics = JSON.parse(raw)
    } catch (e) {
      console.error(e)
    }

    if (initialBodyMetrics) {
      setBodyMetrics(initialBodyMetrics)
    } else if (isDemoUser) {
      setBodyMetrics({
        bmi: 23.0,
        bmiCategory: 'Khỏe mạnh',
        bodyFatPercentage: 21.3,
        bodyFatStatus: 'Ổn định',
        muscleMassKg: 27.6,
        muscleStatus: 'Tốt',
        waistCm: 76,
        waistStatus: 'Tốt',
        updatedAt: '2026-08-04',
      })
    } else {
      setBodyMetrics({
        bmi: 0,
        bmiCategory: 'Chưa cập nhật',
        bodyFatPercentage: 0,
        bodyFatStatus: 'Chưa cập nhật',
        muscleMassKg: 0,
        muscleStatus: 'Chưa cập nhật',
        waistCm: 0,
        waistStatus: 'Chưa cập nhật',
        updatedAt: '',
      })
    }

    if (!ownerId || ownerId === 'demo' || ownerId === 'anonymous') return

    let unsubscribeWeight: (() => void) | undefined
    let unsubscribeMetrics: (() => void) | undefined
    let unsubscribeGamification: (() => void) | undefined

    try {
      unsubscribeWeight = subscribeToUserWeightLogs(ownerId, (remoteRecords) => {
        if (!Array.isArray(remoteRecords)) return
        const sorted = [...remoteRecords].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        // An empty server snapshot is authoritative; do not resurrect deleted
        // records from the local cache after a refresh.
        setWeightRecords(sorted)
        safeLocalStorageSet(`aura:progress:weight-records:${ownerId}`, JSON.stringify(sorted))
      }, (err) => {
        console.warn('Error subscribing to weight logs:', err)
      })

      unsubscribeMetrics = subscribeToUserBodyMeasurements(ownerId, (remoteMetrics) => {
        const nextMetrics: BodyMeasurements = remoteMetrics && typeof remoteMetrics === 'object'
          ? remoteMetrics as BodyMeasurements
          : { bmi: 0, bmiCategory: 'Chưa cập nhật', bodyFatPercentage: 0, bodyFatStatus: 'Chưa cập nhật', muscleMassKg: 0, muscleStatus: 'Chưa cập nhật', waistCm: 0, waistStatus: 'Chưa cập nhật', updatedAt: '' }
        setBodyMetrics(nextMetrics)
        safeLocalStorageSet(`aura:progress:body-measurements:${ownerId}`, JSON.stringify(nextMetrics))
      }, (err) => {
        console.warn('Error subscribing to body measurements:', err)
      })

      unsubscribeGamification = subscribeToUserGamification(ownerId, (remote) => {
        if (remote && typeof remote === 'object' && remote !== null) {
          const remoteStreak = Number(remote.streak) || 0
          setStreak(remoteStreak)
          safeLocalStorageSet(`aura:gamification:streak:${ownerId}`, String(remoteStreak))
        }
      }, (err) => {
        console.warn('Error subscribing to gamification:', err)
      })
    } catch (e) {
      console.warn('Failed to register Firestore subscriptions:', e)
    }

    return () => {
      if (unsubscribeWeight) unsubscribeWeight()
      if (unsubscribeMetrics) unsubscribeMetrics()
      if (unsubscribeGamification) unsubscribeGamification()
    }
  }, [ownerId, baseWeight])

  const handleSaveWeight = async (weightKgVal: number, note?: string) => {
    const today = new Date()
    const label = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}`
    const newRecord: WeightRecord = {
      id: Date.now().toString(),
      date: today.toISOString().split('T')[0],
      label,
      weightKg: weightKgVal,
      trendKg: Number(((currentWeight + weightKgVal) / 2).toFixed(1)),
      note,
    }
    const updated = [...weightRecords, newRecord]
    const previous = weightRecords
    setProgressMutationError(null)
    setWeightRecords(updated)
    safeLocalStorageSet(`aura:progress:weight-records:${ownerId}`, JSON.stringify(updated))

    if (ownerId && ownerId !== 'anonymous' && ownerId !== 'demo') {
      try {
        await saveUserWeightLog(ownerId, newRecord as any)
      } catch (err) {
        setWeightRecords(previous)
        safeLocalStorageSet(`aura:progress:weight-records:${ownerId}`, JSON.stringify(previous))
        const message = 'Chưa thể đồng bộ cân nặng. Vui lòng thử lại.'
        setProgressMutationError(message)
        throw err instanceof Error ? err : new Error(message)
      }
    }
  }

  const handleSaveMetrics = async (updated: Partial<BodyMeasurements>) => {
    const next = { ...bodyMetrics, ...updated }
    const previous = bodyMetrics
    setProgressMutationError(null)
    setBodyMetrics(next)
    safeLocalStorageSet(`aura:progress:body-measurements:${ownerId}`, JSON.stringify(next))

    if (ownerId && ownerId !== 'anonymous' && ownerId !== 'demo') {
      try {
        await saveUserBodyMeasurements(ownerId, next as any)
      } catch (err) {
        setBodyMetrics(previous)
        safeLocalStorageSet(`aura:progress:body-measurements:${ownerId}`, JSON.stringify(previous))
        const message = 'Chưa thể đồng bộ chỉ số cơ thể. Vui lòng thử lại.'
        setProgressMutationError(message)
        throw err instanceof Error ? err : new Error(message)
      }
    }
  }

  const userProfile = nutritionProfile
  const isFemale = userProfile?.biologicalSex === 'female'

  // Get actual weight in the last 30 days based on weight history of this user
  const actual30DayWeight = useMemo(() => {
    const today = new Date()
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(today.getDate() - 30)
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0]
    const todayStr = today.toISOString().split('T')[0]

    // Filter records within the last 30 days
    const last30DaysRecords = weightRecords.filter(r => r.date >= thirtyDaysAgoStr && r.date <= todayStr)
    
    if (last30DaysRecords.length > 0) {
      const sumWeight = last30DaysRecords.reduce((sum, r) => sum + (Number(r.weightKg) || 0), 0)
      return Number((sumWeight / last30DaysRecords.length).toFixed(1))
    } else if (weightRecords.length > 0) {
      // Fallback to the latest record
      return Number(weightRecords[weightRecords.length - 1].weightKg) || baseWeight
    }
    return baseWeight
  }, [weightRecords, baseWeight])

  // Progress, Home and Nutrition must read the same canonical targets.  Do
  // not silently invent age/height/sex/goal values for a real member; an
  // incomplete profile is shown as "chưa thiết lập" by the cards instead.
  const nutritionTargets = useMemo(() => {
    return resolveDailyNutritionTargets(userProfile, actual30DayWeight > 0 ? actual30DayWeight : undefined)
  }, [userProfile, actual30DayWeight])

  // Calculate body metrics dynamically so BMI is NEVER 0
  const currentBmi = useMemo(() => {
    const w = actual30DayWeight
    const h = heightCm ?? 0
    const hM = h / 100
    if (hM <= 0 || w <= 0) return 0
    return Number((w / (hM * hM)).toFixed(1))
  }, [heightCm, actual30DayWeight])

  const currentBmiCategory = useMemo(() => {
    if (currentBmi <= 0) return 'Chưa cập nhật'
    if (currentBmi < 18.5) return 'Thiếu cân'
    if (currentBmi < 25.0) return 'Khỏe mạnh'
    if (currentBmi < 30.0) return 'Thừa cân'
    return 'Béo phì'
  }, [currentBmi])

  const mergedBodyMetrics = useMemo(() => {
    return {
      ...bodyMetrics,
      bmi: currentBmi,
      bmiCategory: currentBmiCategory,
      bodyFatPercentage: bodyMetrics.bodyFatPercentage || 0,
      bodyFatStatus: bodyMetrics.bodyFatPercentage ? bodyMetrics.bodyFatStatus : 'Chưa cập nhật',
      muscleMassKg: bodyMetrics.muscleMassKg || 0,
      muscleStatus: bodyMetrics.muscleMassKg ? bodyMetrics.muscleStatus : 'Chưa cập nhật',
      waistCm: bodyMetrics.waistCm || 0,
      waistStatus: bodyMetrics.waistCm ? bodyMetrics.waistStatus : 'Chưa cập nhật',
    }
  }, [bodyMetrics, currentBmi, currentBmiCategory])

  // Energy balance calculation based on real local storage log history and actual 30-day weight
  const energyBalanceData = useMemo(() => {
    const daysCount = period === '7-days' ? 7 : period === '30-days' ? 30 : 90
    const today = new Date()
    const dateKeys: string[] = []
    for (let i = daysCount - 1; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      const yr = d.getFullYear()
      const mo = String(d.getMonth() + 1).padStart(2, '0')
      const dy = String(d.getDate()).padStart(2, '0')
      dateKeys.push(`${yr}-${mo}-${dy}`)
    }

    const configuredProfile = nutritionTargets.configured
      && userProfile
      && Number(userProfile.heightCm) > 0
      && Number(userProfile.age) > 0
      && actual30DayWeight > 0
    const goal = configuredProfile ? userProfile.goal : 'chưa thiết lập'
    const h = configuredProfile ? Number(userProfile.heightCm) : 0
    const w = configuredProfile ? actual30DayWeight : 0
    const age = configuredProfile ? Number(userProfile.age) : 0
    const act = configuredProfile ? userProfile.activityLevel : 'low'

    const sexOffset = configuredProfile && userProfile.biologicalSex === 'male' ? 5 : -161
    const resting = configuredProfile ? 10 * w + 6.25 * h - 5 * age + sexOffset : 0
    const factors: Record<string, number> = { low: 1.375, moderate: 1.55, high: 1.725 }
    const dailyBase = configuredProfile ? Math.round(resting * factors[act]) : 0
    
    const isMealLogged = (m: any) => !m.status || m.status === 'logged'
    const periodMeals = allMeals.filter((m: any) => isMealLogged(m) && dateKeys.includes(m.date))
    const totalIntake = periodMeals.reduce((sum: number, m: any) => sum + (Number(m.calories) || 0), 0)
    
    const periodActivities = allActivities.filter((a: any) => dateKeys.includes(a.date))
    
    const activeMealDates = new Set(periodMeals.map((m: any) => m.date))
    const uniqueDaysWithMeals = activeMealDates.size
    
    // Only sum workouts on days where meals are logged to make the energy balance 100% mathematically sound
    const periodActivitiesOnLoggedDays = periodActivities.filter((a: any) => activeMealDates.has(a.date))
    const totalWorkout = periodActivitiesOnLoggedDays.reduce((sum: number, a: any) => sum + (Number(a.estimatedCalories) || 0), 0)
    
    const daysWithWorkout = new Set(periodActivities.map((a: any) => a.date)).size
    const nutritionCoverage = uniqueDaysWithMeals / daysCount
    const activityCoverage = Math.min(1.0, daysWithWorkout / Math.max(1, Math.round(daysCount * 0.4)))
    const confidenceScore = nutritionCoverage * 0.6 + activityCoverage * 0.4
    const confidence: 'Cao' | 'Trung bình' | 'Thấp' = confidenceScore > 0.75 ? 'Cao' : (confidenceScore > 0.4 ? 'Trung bình' : 'Thấp')

    // BMR and Daily Activities are only calculated for the days where data is logged (uniqueDaysWithMeals)
    const totalBasal = configuredProfile ? Math.round(resting * uniqueDaysWithMeals) : 0
    const totalDailyActivity = configuredProfile ? Math.round((dailyBase - resting) * uniqueDaysWithMeals) : 0
    const totalThermicEffect = configuredProfile ? Math.round(totalIntake * 0.10) : 0

    return {
      intake: totalIntake,
      workout: totalWorkout,
      basal: totalBasal,
      dailyActivity: totalDailyActivity,
      thermicEffect: totalThermicEffect,
      confidence,
      goal,
      periodDays: uniqueDaysWithMeals,
      totalPeriodDays: daysCount,
      activeDays: uniqueDaysWithMeals,
      workoutDays: daysWithWorkout,
      configured: Boolean(configuredProfile),
    }
  }, [period, resolvedOwnerId, actual30DayWeight, allMeals, allActivities, userProfile, nutritionTargets])

  // Nutrition progress calculation based on real log history and actual 30-day weight
  const nutritionProgressData = useMemo(() => {
    const daysCount = period === '7-days' ? 7 : period === '30-days' ? 30 : 90
    const today = new Date()
    const dateKeys: string[] = []
    for (let i = daysCount - 1; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      const yr = d.getFullYear()
      const mo = String(d.getMonth() + 1).padStart(2, '0')
      const dy = String(d.getDate()).padStart(2, '0')
      dateKeys.push(`${yr}-${mo}-${dy}`)
    }

    const calorieGoal = nutritionTargets.calorieGoal
    const proteinGoal = nutritionTargets.proteinGoal
    const carbGoal = nutritionTargets.carbGoal
    const fatGoal = nutritionTargets.fatGoal
    const fiberGoal = nutritionTargets.configured ? 30 : 0
    const waterGoal = nutritionTargets.waterGoal

    const isMealLogged = (m: any) => !m.status || m.status === 'logged'
    const periodMeals = allMeals.filter((m: any) => isMealLogged(m) && dateKeys.includes(m.date))
    const uniqueDaysWithMeals = new Set(periodMeals.map((m: any) => m.date)).size
    const divisor = Math.max(1, uniqueDaysWithMeals)
    
    const avgCalories = Math.round(periodMeals.reduce((sum: number, m: any) => sum + (Number(m.calories) || 0), 0) / divisor)
    const avgProtein = Math.round(periodMeals.reduce((sum: number, m: any) => sum + (Number(m.protein) || 0), 0) / divisor)
    const avgCarbs = Math.round(periodMeals.reduce((sum: number, m: any) => sum + (Number(m.carbs) || 0), 0) / divisor)
    const avgFat = Math.round(periodMeals.reduce((sum: number, m: any) => sum + (Number(m.fat) || 0), 0) / divisor)
    const avgFiber = Math.round(periodMeals.reduce((sum: number, m: any) => sum + (Number(m.fiber) || 0), 0) / divisor)

    const periodWater = allWater.filter((w: any) => dateKeys.includes(w.date))
    const avgWater = uniqueDaysWithMeals > 0 ? Math.round(periodWater.reduce((sum: number, w: any) => sum + (Number(w.amountMl) || 0), 0) / divisor) : 0

    return {
      avgCalories: uniqueDaysWithMeals > 0 ? avgCalories : 0,
      targetCalories: calorieGoal,
      avgProtein: uniqueDaysWithMeals > 0 ? avgProtein : 0,
      proteinGoal,
      avgCarbs: uniqueDaysWithMeals > 0 ? avgCarbs : 0,
      carbGoal,
      avgFat: uniqueDaysWithMeals > 0 ? avgFat : 0,
      fatGoal,
      avgFiber: uniqueDaysWithMeals > 0 ? avgFiber : 0,
      fiberGoal,
      avgWater: uniqueDaysWithMeals > 0 ? avgWater : 0,
      waterGoal,
      activeDays: uniqueDaysWithMeals,
      configured: nutritionTargets.configured,
    }
  }, [period, resolvedOwnerId, allMeals, allWater, nutritionTargets])

  // Real Progress Score calculation based on real user logged data
  const realProgressInput = useMemo(() => {
    const daysCount = period === '7-days' ? 7 : period === '30-days' ? 30 : 90
    const today = new Date()
    const dateKeys: string[] = []
    for (let i = daysCount - 1; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      const yr = d.getFullYear()
      const mo = String(d.getMonth() + 1).padStart(2, '0')
      const dy = String(d.getDate()).padStart(2, '0')
      dateKeys.push(`${yr}-${mo}-${dy}`)
    }

    const isMealLogged = (m: any) => !m.status || m.status === 'logged'
    const periodMeals = allMeals.filter((m: any) => isMealLogged(m) && dateKeys.includes(m.date))
    const uniqueDaysWithMeals = new Set(periodMeals.map((m: any) => m.date)).size
    const mealLoggingRate = Math.round((uniqueDaysWithMeals / daysCount) * 100)

    // Calculate calorie and protein adherence per day
    let totalCalorieScoreSum = 0
    let totalProteinScoreSum = 0
    const targetCal = nutritionProgressData.targetCalories
    const targetProt = nutritionProgressData.proteinGoal
    const canScoreNutrition = nutritionTargets.configured && targetCal > 0 && targetProt > 0

    dateKeys.forEach(date => {
      const dayMeals = periodMeals.filter((m: any) => m.date === date)
      if (dayMeals.length > 0 && canScoreNutrition) {
        const dayCalories = dayMeals.reduce((sum: number, m: any) => sum + (Number(m.calories) || 0), 0)
        const dayProtein = dayMeals.reduce((sum: number, m: any) => sum + (Number(m.protein) || 0), 0)
        
        const cRatio = targetCal > 0 ? dayCalories / targetCal : 0
        const cScore = cRatio === 0 ? 0 : cRatio >= 0.85 && cRatio <= 1.15 ? 100 : Math.max(30, Math.round((1 - Math.min(1, Math.abs(1 - cRatio))) * 100))
        totalCalorieScoreSum += cScore

        const pRatio = targetProt > 0 ? dayProtein / targetProt : 0
        const pScore = pRatio === 0 ? 0 : pRatio >= 0.85 && pRatio <= 1.15 ? 100 : Math.max(30, Math.round((1 - Math.min(1, Math.abs(1 - pRatio))) * 100))
        totalProteinScoreSum += pScore
      }
    })

    const calorieTargetRate = uniqueDaysWithMeals > 0 ? Math.round(totalCalorieScoreSum / uniqueDaysWithMeals) : 0
    const proteinTargetRate = uniqueDaysWithMeals > 0 ? Math.round(totalProteinScoreSum / uniqueDaysWithMeals) : 0

    // Hydration rate
    const periodWater = allWater.filter((w: any) => dateKeys.includes(w.date))
    let hydrationOnTargetDays = 0
    const waterGoal = nutritionProgressData.waterGoal
    dateKeys.forEach(date => {
      const dayWater = periodWater.filter((w: any) => w.date === date)
      const totalWater = dayWater.reduce((sum: number, w: any) => sum + (Number(w.amountMl) || 0), 0)
      if (waterGoal > 0 && totalWater >= waterGoal * 0.8) {
        hydrationOnTargetDays++
      }
    })
    const hydrationRate = Math.round((hydrationOnTargetDays / daysCount) * 100)

    // Workouts
    const periodActivities = allActivities.filter((a: any) => dateKeys.includes(a.date))
    const daysWithWorkout = new Set(periodActivities.map((a: any) => a.date)).size
    const expectedWorkouts = Math.max(1, Math.round(daysCount * (3 / 7))) // target 3 workouts/week
    const workoutCompletionScore = Math.min(100, Math.round((daysWithWorkout / expectedWorkouts) * 100))

    // Weight tracking rate
    const limitDateStr = new Date(today.getTime() - daysCount * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const periodWeights = weightRecords.filter(w => w.date >= limitDateStr)
    const expectedWeightLogs = Math.max(1, Math.round(daysCount / 7)) // 1 log per week
    const weightTrackingRate = Math.min(100, Math.round((periodWeights.length / expectedWeightLogs) * 100))

    return {
      adherence: {
        mealLoggingRate,
        calorieTargetRate,
        proteinTargetRate,
        hydrationRate,
        dailyTaskRate: Math.round((mealLoggingRate + hydrationRate + weightTrackingRate) / 3),
      },
      nutrition: {
        calorieScore: calorieTargetRate,
        proteinScore: proteinTargetRate,
        fiberScore: undefined,
        fruitVegetableScore: undefined,
        mealDistributionScore: undefined,
      },
      activity: {
        workoutCompletionScore,
        activeMinutesScore: workoutCompletionScore,
        consistencyScore: Math.round((daysWithWorkout / daysCount) * 100),
      },
      body: {
        // A measurement is evidence, not a score. Without a user target or a
        // prior comparison point Aura must keep the progress score neutral
        // instead of manufacturing 65/70/80-point estimates.
        weightTrendScore: undefined,
        measurementTrendScore: undefined,
        bodyCompositionScore: undefined,
        progressPhotoScore: undefined,
      },
      tracking: {
        mealTrackingRate: mealLoggingRate,
        weightTrackingRate,
        workoutTrackingRate: workoutCompletionScore,
        hydrationTrackingRate: hydrationRate,
        measurementTrackingRate: bodyMetrics.updatedAt ? 100 : 0,
      }
    }
  }, [allMeals, allWater, allActivities, weightRecords, nutritionProgressData, nutritionTargets, period])

  const trackedDataDays = useMemo(() => {
    const dates = new Set<string>()
    for (const item of [...allMeals, ...allWater, ...allActivities, ...weightRecords]) {
      if (typeof item?.date === 'string' && item.date) dates.add(item.date)
    }
    if (bodyMetrics.updatedAt) dates.add(bodyMetrics.updatedAt)
    return dates.size
  }, [allActivities, allMeals, allWater, bodyMetrics.updatedAt, weightRecords])
  const progressScore = useMemo(() => {
    const daysCount = period === '7-days' ? 7 : period === '30-days' ? 30 : 90
    return calculateProgressScore(realProgressInput, Math.min(daysCount, trackedDataDays))
  }, [realProgressInput, period, trackedDataDays])

  // Calculate weight difference over the period
  const weightChangeText = useMemo(() => {
    const daysCount = period === '7-days' ? 7 : period === '30-days' ? 30 : 90
    const today = new Date()
    const limitDate = new Date(today.getTime() - daysCount * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    
    const sortedWeights = [...weightRecords].sort((a, b) => a.date.localeCompare(b.date))
    const periodWeights = sortedWeights.filter(w => w.date >= limitDate)
    
    if (periodWeights.length >= 2) {
      const diff = periodWeights[periodWeights.length - 1].weightKg - periodWeights[0].weightKg
      return `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} kg`
    } else if (weightRecords.length >= 2) {
      const diff = weightRecords[weightRecords.length - 1].weightKg - weightRecords[0].weightKg
      return `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} kg`
    }
    return '--'
  }, [weightRecords, period])

  const handleSelectQuickAction = (action: 'weight' | 'meal' | 'workout' | 'measurement' | 'photo' | 'water') => {
    setQuickLogOpen(false)
    if (action === 'weight') {
      setWeightModalOpen(true)
    } else if (action === 'meal') {
      window.location.hash = '#/nutrition?section=scan'
    } else if (action === 'workout') {
      onNavigate?.('pt-workout')
    } else if (action === 'measurement') {
      setMetricsModalOpen(true)
    } else if (action === 'photo') {
      onNavigate?.('progress-photo-studio')
    } else if (action === 'water') {
      window.location.hash = '#/nutrition?action=water'
    }
  }

  const todayStr = useMemo(() => {
    const d = new Date()
    const yr = d.getFullYear()
    const mo = String(d.getMonth() + 1).padStart(2, '0')
    const dy = String(d.getDate()).padStart(2, '0')
    return `${yr}-${mo}-${dy}`
  }, [])

  const todayMealsCount = useMemo(() => {
    return allMeals.filter((m: any) => (!m.status || m.status === 'logged') && m.date === todayStr).length
  }, [allMeals, todayStr])

  const todayWaterMl = useMemo(() => {
    return allWater.filter((w: any) => w.date === todayStr).reduce((sum: number, w: any) => sum + (Number(w.amountMl) || 0), 0)
  }, [allWater, todayStr])

  const todayWeightLogged = useMemo(() => {
    return weightRecords.some(r => r.date === todayStr)
  }, [weightRecords, todayStr])

  const todayWorkoutLogged = useMemo(() => {
    return allActivities.some(a => a.date === todayStr)
  }, [allActivities, todayStr])

  const aiWeeklySummary = useMemo(() => {
    const recentDates = new Set<string>()
    const today = new Date()
    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(today)
      date.setDate(today.getDate() - offset)
      recentDates.add(toLocalDateKey(date))
    }
    const loggedMeals = allMeals.filter((meal: any) => (
      recentDates.has(meal.date) && (!meal.status || meal.status === 'logged')
    ))
    const recentWater = allWater.filter((entry: any) => recentDates.has(entry.date))
    const recentActivities = allActivities.filter((activity: any) => recentDates.has(activity.date))
    const oldestDate = [...recentDates].sort()[0]
    return {
      mealLoggedDays: new Set(loggedMeals.map((meal: any) => meal.date)).size,
      mealCount: loggedMeals.length,
      waterLoggedDays: new Set(recentWater.map((entry: any) => entry.date)).size,
      workoutDays: new Set(recentActivities.map((activity: any) => activity.date)).size,
      weightLogCount: weightRecords.filter((record) => record.date >= oldestDate && recentDates.has(record.date)).length,
    }
  }, [allActivities, allMeals, allWater, weightRecords])

  return (
    <div className="progress-center-page">
      {loading && <div className="pg-data-state is-loading" role="status" aria-live="polite">
        <LoaderCircle className="spin" size={17} aria-hidden="true" />
        <span className="pg-data-state__copy"><strong>Đang đồng bộ dữ liệu tiến độ</strong><span>Aura đang tải nhật ký học tập mới nhất. Các chỉ số sẽ cập nhật sau khi đồng bộ xong.</span></span>
      </div>}
      {!loading && error && <div className="pg-data-state is-error" role="alert">
        <AlertCircle size={17} aria-hidden="true" />
        <span className="pg-data-state__copy"><strong>Chưa thể tải đầy đủ dữ liệu tiến độ</strong><span>{error}</span></span>
      </div>}
      {progressMutationError && <div className="pg-inline-error" role="alert">{progressMutationError}</div>}
      {/* Header with Time Selector & Category Pills & Coach Button */}
      <ProgressHeader
        period={period}
        onPeriodChange={setPeriod}
        category={category}
        onCategoryChange={setCategory}
        onOpenCoach={() => setCoachSheetOpen(true)}
      />

      {/* Overview: one scan-friendly summary. Heavy charts, photos and AI stay in their own tabs. */}
      {category === 'overview' && (
        <>
          <WeeklyScoreCard
            scoreResult={progressScore}
            maxScore={100}
            weightChangeText={weightChangeText}
            weightSubText={period === '7-days' ? "So với đầu tuần" : period === '30-days' ? "So với 30 ngày trước" : "So với 90 ngày trước"}
            nutritionPercent={Math.round((realProgressInput.adherence.mealLoggingRate + realProgressInput.adherence.calorieTargetRate) / 2)}
            workoutsCount={energyBalanceData.workoutDays}
            streakDays={streak}
            insightText={
              progressScore.total >= 85 ? (
                <><strong style={{ color: '#14805e' }}>Tiến độ xuất sắc!</strong> Bạn đang duy trì kỷ luật và thói quen rất tốt.</>
              ) : progressScore.total >= 60 ? (
                <><strong style={{ color: '#a65a16' }}>Tiến độ ổn định.</strong> Hãy tiếp tục bổ sung thông tin đều đặn nhé!</>
              ) : (
                <><strong style={{ color: '#b82850' }}>Cần thêm dữ liệu.</strong> Hãy ghi nhận dinh dưỡng và vận động đầy đủ để theo dõi tốt hơn!</>
              )
            }
          />
          <DailyActionsCard
            todayMealCount={todayMealsCount}
            todayWaterMl={todayWaterMl}
            waterTargetMl={nutritionProgressData.waterGoal}
            todayWeightLogged={todayWeightLogged}
            todayWorkoutLogged={todayWorkoutLogged}
            onOpenQuickLog={(type) => {
              if (type === 'weight') setWeightModalOpen(true)
              else if (type === 'meal') onNavigate?.('nutrition')
              else setQuickLogOpen(true)
            }}
          />
          <div className="pg-overview-weight">
            <WeightTrackerCard currentWeightKg={currentWeight} startWeightKg={startWeightKg} goalWeightKg={goalWeightKg} targetDateText={targetDateText} onOpenLogWeight={() => setWeightModalOpen(true)} />
          </div>
          <BodyMetricsCard metrics={mergedBodyMetrics} heightCm={heightCm} isFemale={isFemale} onOpenDetails={() => setMetricsModalOpen(true)} />
          <div className="pg-overview-nutrition">
            <NutritionProgressCard
              onOpenDetails={() => onNavigate?.('nutrition')}
              onLogMeal={() => onNavigate?.('nutrition')}
              avgCalories={nutritionProgressData.avgCalories}
              targetCalories={nutritionProgressData.targetCalories}
              proteinGrams={nutritionProgressData.avgProtein}
              proteinGoal={nutritionProgressData.proteinGoal}
              carbGrams={nutritionProgressData.avgCarbs}
              carbGoal={nutritionProgressData.carbGoal}
              fatGrams={nutritionProgressData.avgFat}
              fatGoal={nutritionProgressData.fatGoal}
              fiberGrams={nutritionProgressData.avgFiber}
              fiberGoal={nutritionProgressData.fiberGoal}
              waterMl={nutritionProgressData.avgWater}
              waterGoal={nutritionProgressData.waterGoal}
              activeDays={nutritionProgressData.activeDays}
            />
          </div>
        </>
      )}

      {category === 'body' && (
        <>
          <BodyMetricsCard metrics={mergedBodyMetrics} heightCm={heightCm} isFemale={isFemale} onOpenDetails={() => setMetricsModalOpen(true)} />
          <div className="pg-weight-grid">
            <WeightTrackerCard currentWeightKg={currentWeight} startWeightKg={startWeightKg} goalWeightKg={goalWeightKg} targetDateText={targetDateText} onOpenLogWeight={() => setWeightModalOpen(true)} />
            <WeightChartCard records={weightRecords} goalWeightKg={goalWeightKg} />
          </div>
          <ProgressPhotosCard ownerId={resolvedOwnerId} triggerAddPhoto={triggerPhotoUpload} onAddPhotoTriggered={() => setTriggerPhotoUpload(false)} onNavigateToStudio={() => onNavigate?.('progress-photo-studio')} />
        </>
      )}

      {category === 'nutrition' && (
        <>
          <div className="pg-nutrition-grid">
            <NutritionProgressCard
              onOpenDetails={() => onNavigate?.('nutrition')}
              onLogMeal={() => onNavigate?.('nutrition')}
              avgCalories={nutritionProgressData.avgCalories}
              targetCalories={nutritionProgressData.targetCalories}
              proteinGrams={nutritionProgressData.avgProtein}
              proteinGoal={nutritionProgressData.proteinGoal}
              carbGrams={nutritionProgressData.avgCarbs}
              carbGoal={nutritionProgressData.carbGoal}
              fatGrams={nutritionProgressData.avgFat}
              fatGoal={nutritionProgressData.fatGoal}
              fiberGrams={nutritionProgressData.avgFiber}
              fiberGoal={nutritionProgressData.fiberGoal}
              waterMl={nutritionProgressData.avgWater}
              waterGoal={nutritionProgressData.waterGoal}
              activeDays={nutritionProgressData.activeDays}
            />
            <EnergyBalanceCard onOpenDetails={() => onNavigate?.('nutrition')} onLogMeal={() => onNavigate?.('nutrition')} onLogWorkout={() => onNavigate?.('pt-workout')} intake={energyBalanceData.intake} basal={energyBalanceData.basal} dailyActivity={energyBalanceData.dailyActivity} workout={energyBalanceData.workout} thermicEffect={energyBalanceData.thermicEffect} confidence={energyBalanceData.confidence} goal={energyBalanceData.goal} periodDays={energyBalanceData.periodDays} totalPeriodDays={energyBalanceData.totalPeriodDays} activeDays={energyBalanceData.activeDays} workoutDays={energyBalanceData.workoutDays} />
          </div>
          <NutritionChartsCard mealLogs={allMeals} waterLogs={allWater} />
        </>
      )}

      {category === 'workout' && (
        <>
          <DailyActionsCard todayMealCount={todayMealsCount} todayWaterMl={todayWaterMl} waterTargetMl={nutritionProgressData.waterGoal} todayWeightLogged={todayWeightLogged} todayWorkoutLogged={todayWorkoutLogged} onOpenQuickLog={(type) => type === 'weight' ? setWeightModalOpen(true) : type === 'meal' ? onNavigate?.('nutrition') : setQuickLogOpen(true)} />
          <WeightChartCard records={weightRecords} goalWeightKg={goalWeightKg} />
          <ProgressPhotosCard ownerId={resolvedOwnerId} triggerAddPhoto={triggerPhotoUpload} onAddPhotoTriggered={() => setTriggerPhotoUpload(false)} onNavigateToStudio={() => onNavigate?.('progress-photo-studio')} />
        </>
      )}

      {category === 'achievements' && (
        <>
          <StreaksAndBadgesCard ownerId={resolvedOwnerId} progressItems={progressItems} />
          <AiWeeklyAnalysisCard summary={aiWeeklySummary} onPrepareCoach={prewarmAiCoachAppCheck} onOpenCoach={() => setCoachSheetOpen(true)} />
        </>
      )}

      {/* Floating Quick Log Button */}
      <div className="pg-floating-log">
        <button
          type="button"
          onClick={() => setQuickLogOpen(true)}
          className="pg-primary-action pg-quick-log-action"
        >
          <Plus size={20} strokeWidth={3} />
          <span>Ghi nhanh</span>
        </button>
      </div>

      {/* Modals and Bottom Sheets */}
      {quickLogOpen && (
        <QuickLogBottomSheet
          onClose={() => setQuickLogOpen(false)}
          onSelectAction={handleSelectQuickAction}
        />
      )}

      {weightModalOpen && (
        <WeightLogModal
          currentWeight={currentWeight}
          onClose={() => setWeightModalOpen(false)}
          onSave={handleSaveWeight}
        />
      )}

      {metricsModalOpen && (
        <BodyMeasurementsModal
          metrics={mergedBodyMetrics}
          isFemale={isFemale}
          onClose={() => setMetricsModalOpen(false)}
          onSave={handleSaveMetrics}
        />
      )}

      {coachSheetOpen && (
        <AiCoachBottomSheet
          onClose={() => setCoachSheetOpen(false)}
          conversationScope={`progress-${resolvedOwnerId}`}
        />
      )}
    </div>
  )
}
