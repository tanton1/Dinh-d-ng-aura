import type { NutritionWorkspaceSection } from '../../pages/student/NutritionWorkspace'

export type NutritionRouteSection = 'today' | 'diary' | 'scan' | 'catalog' | 'plan' | 'insights' | 'assistant' | 'profile'
export type NutritionPrimarySection = Extract<NutritionRouteSection, NutritionWorkspaceSection>
export type NutritionAssistantIntent = 'hydration' | 'protein' | 'carbs' | 'fat' | 'fiber' | 'sugar' | 'sodium' | 'workout' | 'allergy' | 'next-meal' | 'energy' | 'getting-started' | 'general'

// `plan` remains in the type temporarily for backwards compatibility with old
// saved URLs, but it is no longer an exposed nutrition surface.
const nutritionRouteSections = new Set<NutritionRouteSection>(['today', 'diary', 'scan', 'catalog', 'insights', 'assistant', 'profile'])

export function nutritionFoodIdFromHash() {
  const query = window.location.hash.split('?')[1] ?? ''
  return new URLSearchParams(query).get('foodId')
}

export function nutritionSectionFromHash(): NutritionRouteSection {
  const query = window.location.hash.split('?')[1] ?? ''
  const rawSection = new URLSearchParams(query).get('section')
  return nutritionRouteSections.has(rawSection as NutritionRouteSection) ? rawSection as NutritionRouteSection : 'today'
}

export function nutritionSectionHash(section: NutritionRouteSection) {
  return section === 'today' ? '#/nutrition' : `#/nutrition?section=${section}`
}

export function toWorkspaceSection(section: NutritionRouteSection): NutritionWorkspaceSection {
  return section === 'diary' || section === 'catalog' || section === 'insights' ? section : 'today'
}

export function toLocalDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function dateFromLocalKey(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, Math.max(0, month - 1), day, 12, 0, 0, 0)
}

export function normalizeNutritionSearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function resolveNutritionAssistantIntent(question: string): NutritionAssistantIntent {
  const value = normalizeNutritionSearch(question)
  if (/\b(natri|sodium|muoi|man)\b/.test(value)) return 'sodium'
  if (/\b(chat xo|fiber|xo)\b/.test(value)) return 'fiber'
  if (/\b(duong|sugar|ngot)\b/.test(value) && !/\b(tinh bot|bot duong|carb)\b/.test(value)) return 'sugar'
  if (/\b(carb|tinh bot|bot duong|carbohydrate)\b/.test(value)) return 'carbs'
  if (/\b(chat beo|fat|lipid|dau mo)\b/.test(value)) return 'fat'
  if (/\b(dam|protein|thit nac)\b/.test(value)) return 'protein'
  if (/\b(tap|luyen tap|van dong|truoc tap|sau tap|workout)\b/.test(value)) return 'workout'
  if (/\b(nuoc|uong nuoc|bu nuoc|hydration|khat)\b/.test(value)) return 'hydration'
  if (/\b(di ung|can tranh|khong an duoc)\b/.test(value)) return 'allergy'
  if (/\b(bua tiep|bua toi|bua trua|bua sang|nen an gi|an mon gi|mon phu hop)\b/.test(value)) return 'next-meal'
  if (/\b(kcal|calo|calorie|nang luong|muc tieu)\b/.test(value)) return 'energy'
  if (/\b(bat dau|ghi bua|su dung|lam sao)\b/.test(value)) return 'getting-started'
  return 'general'
}

export function getCalendarStart(date = new Date()) {
  const start = new Date(date)
  start.setHours(12, 0, 0, 0)
  const day = start.getDay()
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1))
  return toLocalDateKey(start)
}

export function getWeekDays(startDateKey: string, todayKey: string) {
  const weekdays = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
  const startDate = dateFromLocalKey(startDateKey)
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(startDate)
    date.setDate(startDate.getDate() + index)
    const id = toLocalDateKey(date)
    return { id, day: weekdays[date.getDay()], date: date.getDate(), isToday: id === todayKey, fullDate: date }
  })
}

export function getRecentDateKeys(endDateKey: string, count: number) {
  const end = dateFromLocalKey(endDateKey)
  return Array.from({ length: Math.max(1, count) }, (_, index) => {
    const date = new Date(end)
    date.setDate(end.getDate() - (count - index - 1))
    return toLocalDateKey(date)
  })
}
