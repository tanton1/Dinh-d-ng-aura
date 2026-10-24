import { useNutritionWeight } from './useNutritionWeight'
import { useEffect, useMemo, useState } from 'react'
import type { NutritionProfileDraft } from '../features/nutrition/types'
import {
  readRecentAverageWeight,
  resolveDailyNutritionTargets,
} from '../features/nutrition/dailyNutritionTargets'
import { subscribeToUserMealLogsForDate } from '../services/firebaseNutritionLogService'
import { readDailyNutritionCache, writeDailyNutritionCache } from '../features/nutrition/dailyNutritionSummaryCache'
import { useNutritionDate } from '../features/nutrition/useNutritionDate'

interface DailyMealSummary {
  date?: string
  status?: string
  calories?: number
  protein?: number
}

export function useDailyNutritionSummary(
  ownerId: string,
  profile?: NutritionProfileDraft | null,
  enabled = true,
) {
  const effectiveWeight = useNutritionWeight(ownerId, profile?.weightKg ?? 0, enabled)
  const today = useNutritionDate()
  const [state, setState] = useState<{ ownerId: string; date: string; meals: DailyMealSummary[] }>({ ownerId, date: today, meals: [] })

  useEffect(() => {
    if (!enabled || !ownerId || ownerId === 'demo') {
      setState({ ownerId, date: today, meals: [] })
      return
    }
    const cached = readDailyNutritionCache(ownerId, today)
    setState({ ownerId, date: today, meals: cached?.meals as DailyMealSummary[] ?? [] })
    let active = true
    const stop = subscribeToUserMealLogsForDate(ownerId, today, (items) => {
      if (!active) return
      const next = items as DailyMealSummary[]
      setState({ ownerId, date: today, meals: next })
      writeDailyNutritionCache(ownerId, today, { meals: next as any })
    }, () => { if (active) setState({ ownerId, date: today, meals: [] }) })
    return () => { active = false; stop() }
  }, [enabled, ownerId, today])

  return useMemo(() => {
    const targets = resolveDailyNutritionTargets(profile, effectiveWeight)
    const calorieTarget = Math.max(0, Math.round(targets.calorieGoal))
    const proteinTarget = Math.max(0, Math.round(targets.proteinGoal))
    const meals = state.ownerId === ownerId && state.date === today && enabled ? state.meals : []
    const logged = meals.filter((meal) => meal.date === today && meal.status === 'logged')
    const caloriesConsumed = Math.round(logged.reduce((sum, meal) => sum + (Number(meal.calories) || 0), 0))
    const proteinConsumed = Math.round(logged.reduce((sum, meal) => sum + (Number(meal.protein) || 0), 0))

    return {
      calorieTarget,
      proteinTarget,
      caloriesConsumed,
      proteinConsumed,
      configured: targets.configured,
      remainingCalories: Math.max(0, calorieTarget - caloriesConsumed),
      remainingProtein: Math.max(0, proteinTarget - proteinConsumed),
    }
  }, [state, ownerId, profile, effectiveWeight, today, enabled])
}
