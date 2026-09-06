import type { MealLog } from './types'
import type { DailyNutritionTargets } from './dailyNutritionTargets'

/** Enough meal occasions to compare a recorded day. This is coverage, not proof of intake. */
export function completeMealDates(meals: Array<Partial<MealLog>>, mealsPerDay = 3) {
  const dates = new Map<string, Array<Partial<MealLog>>>()
  for (const meal of meals) {
    if (!meal.date || meal.status && meal.status !== 'logged') continue
    dates.set(meal.date, [...(dates.get(meal.date) || []), meal])
  }
  return new Set([...dates].filter(([, entries]) => {
    const mainTypes = new Set(entries.map((m) => m.type))
    const snacks = new Set(entries.filter((m) => m.type === 'snack').map((m) => m.time))
    return ['breakfast', 'lunch', 'dinner'].every((type) => mainTypes.has(type as MealLog['type'])) && snacks.size >= Math.max(0, mealsPerDay - 3)
  }).map(([date]) => date))
}

export function periodEnergy(meals: Array<Partial<MealLog>>, dateKeys: string[], targets: DailyNutritionTargets, mealsPerDay = 3) {
  const within = meals.filter((m) => dateKeys.includes(m.date || '') && (!m.status || m.status === 'logged'))
  const complete = completeMealDates(within, mealsPerDay)
  let intake = 0, expenditure = 0, snapshotDays = 0
  for (const date of complete) {
    const day = within.filter((m) => m.date === date)
    const snapshot = day.find((m) => m.targetSnapshot && m.targetSnapshot.tdee > 0)?.targetSnapshot
    intake += day.reduce((sum, m) => sum + (Number(m.calories) || 0), 0)
    expenditure += snapshot?.tdee ?? (targets.configured ? targets.maintenanceCalories : 0)
    if (snapshot) snapshotDays++
  }
  const count = complete.size
  return { intake, basal: Math.round(expenditure), dailyActivity: 0, workout: 0, thermicEffect: 0,
    periodDays: count, totalPeriodDays: dateKeys.length, activeDays: count, snapshotDays,
    confidence: count / Math.max(1, dateKeys.length) >= .8 && snapshotDays === count ? 'Trung bình' as const : 'Thấp' as const }
}
