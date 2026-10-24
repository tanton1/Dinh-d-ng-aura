import type { NutritionJournalDaySummary } from '../../services/nutritionJournalSummaryService'

export function progressDateKeys(fromDate: string, toDate: string) {
  const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date
  if (!valid(fromDate) || !valid(toDate) || fromDate > toDate) throw new Error('Khoảng ngày tiến độ không hợp lệ.')
  const count = Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000) + 1
  if (count > 90) throw new Error('Mỗi lần chỉ xem tối đa 90 ngày tiến độ.')
  return Array.from({ length: count }, (_, index) => new Date(Date.parse(`${fromDate}T00:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10))
}

export function progressSummaryRanges(fromDate: string, toDate: string) {
  const dates = progressDateKeys(fromDate, toDate)
  const ranges = []
  for (let index = 0; index < dates.length; index += 31) ranges.push({ fromDate: dates[index], toDate: dates[Math.min(index + 30, dates.length - 1)] })
  return ranges
}

export function completeProgressSummary(items: NutritionJournalDaySummary[], fromDate: string, toDate: string) {
  const dates = progressDateKeys(fromDate, toDate)
  const seen = new Set<string>()
  return items.length === dates.length && items.every(item => {
    const occasions = item.mealOccasions
    if (!dates.includes(item.date) || seen.has(item.date) || !occasions
      || !['breakfast', 'lunch', 'dinner'].every(key => typeof occasions[key as 'breakfast'] === 'boolean')
      || !Number.isInteger(occasions.snackCount) || occasions.snackCount < 0
      || !Number.isFinite(item.waterMl) || item.waterMl < 0
      || !Number.isInteger(item.activityCount) || item.activityCount < 0) return false
    seen.add(item.date)
    return true
  })
}

export function progressAdherence(items: NutritionJournalDaySummary[], days: number, mealsPerDay: number, trainingSessions: number, waterGoal: number) {
  const mealDays = items.filter(({ mealOccasions: meal }) => meal?.breakfast && meal.lunch && meal.dinner && meal.snackCount >= Math.max(0, mealsPerDay - 3)).length
  const waterDays = items.filter(day => waterGoal > 0 && day.waterMl >= waterGoal * .8).length
  const activityDays = items.filter(day => day.activityCount > 0).length
  const expectedActivities = Math.max(1, Math.round(days * (trainingSessions / 7)))
  const adherence = Math.round(Math.min(100, mealDays / days * 100) * .5 + Math.min(100, activityDays / expectedActivities * 100) * .3 + Math.min(100, waterDays / days * 100) * .2)
  return { mealDays, waterDays, activityDays, expectedActivities, adherence }
}
