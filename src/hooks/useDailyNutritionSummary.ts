import { useEffect, useMemo, useState } from 'react'
import type { NutritionProfileDraft } from '../features/nutrition/types'
import {
  readRecentAverageWeight,
  resolveDailyNutritionTargets,
} from '../features/nutrition/dailyNutritionTargets'
import { subscribeToUserMealLogsForDate } from '../services/firebaseNutritionLogService'

interface DailyMealSummary {
  date?: string
  status?: string
  calories?: number
  protein?: number
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function useDailyNutritionSummary(
  ownerId: string,
  profile?: NutritionProfileDraft | null,
  enabled = true,
) {
  const [meals, setMeals] = useState<DailyMealSummary[]>([])

  useEffect(() => {
    if (!enabled || !ownerId || ownerId === 'demo') {
      setMeals([])
      return
    }
    const today = localDateKey()
    return subscribeToUserMealLogsForDate(ownerId, today, (items) => setMeals(items as DailyMealSummary[]), () => setMeals([]))
  }, [enabled, ownerId])

  return useMemo(() => {
    const effectiveWeight = readRecentAverageWeight(ownerId, profile?.weightKg ?? 60)
    const targets = resolveDailyNutritionTargets(profile, effectiveWeight)
    const calorieTarget = Math.max(1, Math.round(targets.calorieGoal))
    const proteinTarget = Math.max(1, Math.round(targets.proteinGoal))
    const today = localDateKey()
    const logged = meals.filter((meal) => meal.date === today && meal.status === 'logged')
    const caloriesConsumed = Math.round(logged.reduce((sum, meal) => sum + (Number(meal.calories) || 0), 0))
    const proteinConsumed = Math.round(logged.reduce((sum, meal) => sum + (Number(meal.protein) || 0), 0))

    return {
      calorieTarget,
      proteinTarget,
      caloriesConsumed,
      proteinConsumed,
      remainingCalories: Math.max(0, calorieTarget - caloriesConsumed),
      remainingProtein: Math.max(0, proteinTarget - proteinConsumed),
    }
  }, [meals, ownerId, profile])
}
