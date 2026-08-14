import { useEffect, useMemo, useState } from 'react'
import type { NutritionProfileDraft } from '../features/nutrition/types'
import { subscribeToUserMealLogs } from '../services/firebaseNutritionLogService'
import { calculateNutritionTargets } from '../services/nutritionSyncService'

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
    return subscribeToUserMealLogs(ownerId, (items) => setMeals(items as DailyMealSummary[]), () => setMeals([]))
  }, [enabled, ownerId])

  return useMemo(() => {
    const stored = profile as (NutritionProfileDraft & { targetCalories?: number; protein?: number }) | null | undefined
    const targets = profile ? calculateNutritionTargets(profile) : null
    const calorieTarget = Math.max(1, Math.round(stored?.targetCalories || targets?.targetCaloriesKcal || 2_000))
    const proteinTarget = Math.max(1, Math.round(stored?.protein || targets?.proteinG || 100))
    const today = localDateKey()
    const logged = meals.filter((meal) => meal.date === today && meal.status !== 'planned')
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
  }, [meals, profile])
}
