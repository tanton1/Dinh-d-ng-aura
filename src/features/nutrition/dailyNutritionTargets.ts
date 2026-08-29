import type { NutritionProfileDraft } from './types'
import { calculateNutritionTargets } from '../../services/nutritionSyncService'

export interface NutritionWeightRecord {
  date?: string
  weightKg?: number
}

export interface DailyNutritionTargets {
  calorieGoal: number
  proteinGoal: number
  carbGoal: number
  fatGoal: number
  waterGoal: number
  maintenanceCalories: number
  dailyAdjustment: number
  targetDelta: number
  timeframeMonths: number
}

function localDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Returns the average of valid weight entries from the latest 30-day window.
 * Old or malformed entries must not silently change today's nutrition target.
 */
export function recentAverageWeight(
  records: NutritionWeightRecord[],
  fallbackWeight: number,
  today = new Date(),
) {
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  from.setDate(from.getDate() - 30)
  const fromKey = localDateKey(from)
  const todayKey = localDateKey(today)
  const recent = records
    .filter((record) => typeof record.date === 'string'
      && record.date >= fromKey
      && record.date <= todayKey
      && Number.isFinite(Number(record.weightKg))
      && Number(record.weightKg) > 0)
    .map((record) => Number(record.weightKg))

  if (!recent.length) return fallbackWeight
  return Number((recent.reduce((sum, weight) => sum + weight, 0) / recent.length).toFixed(1))
}

export function readRecentAverageWeight(ownerId: string, fallbackWeight: number) {
  if (typeof window === 'undefined' || !ownerId) return fallbackWeight
  try {
    const raw = window.localStorage.getItem(`aura:progress:weight-records:${ownerId}`)
    const parsed = raw ? JSON.parse(raw) : []
    return recentAverageWeight(Array.isArray(parsed) ? parsed : [], fallbackWeight)
  } catch {
    return fallbackWeight
  }
}

/**
 * Canonical daily target shared by Home, Nutrition and Eat Clean.
 * Legacy fields such as targetCalories are intentionally ignored because the
 * Nutrition page derives its target from the current profile and recent weight.
 */
export function resolveDailyNutritionTargets(
  profile?: NutritionProfileDraft | null,
  effectiveWeight?: number,
): DailyNutritionTargets {
  if (!profile) {
    return {
      calorieGoal: 2_000,
      proteinGoal: 100,
      carbGoal: 250,
      fatGoal: 55,
      waterGoal: 2_000,
      maintenanceCalories: 2_000,
      dailyAdjustment: 0,
      targetDelta: 0,
      timeframeMonths: 3,
    }
  }

  const targets = calculateNutritionTargets({
    ...profile,
    weightKg: effectiveWeight ?? profile.weightKg,
  })

  return {
    calorieGoal: targets.targetCaloriesKcal,
    proteinGoal: targets.proteinG,
    carbGoal: targets.carbsG,
    fatGoal: targets.fatG,
    waterGoal: targets.waterLiters * 1_000,
    maintenanceCalories: targets.tdee,
    dailyAdjustment: targets.targetCaloriesKcal - targets.tdee,
    targetDelta: profile.targetWeightDeltaKg ?? 0,
    timeframeMonths: profile.targetTimeframeMonths ?? 3,
  }
}
