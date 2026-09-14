import { canonicalNutritionProfile } from '../../services/nutritionSyncService'
import type {
  MealLog,
  NutritionActivityIntensity,
  NutritionActivityKind,
  NutritionActivityLog,
  NutritionProfileDraft,
  NutritionWaterLog,
} from './types'
import { toLocalDateKey } from './routing'
import { DEFAULT_PROFILE } from './profileDefaults'

export const NUTRITION_STORAGE_PREFIXES = {
  meals: 'aura:nutrition:meals:v2',
  water: 'aura:nutrition:water:v2',
  waterEntries: 'aura:nutrition:water-entries:v1',
  savedFoods: 'aura:nutrition:saved-foods:v2',
  activities: 'aura:nutrition:activities:v1',
} as const

export const SCAN_REVIEW_ACTIVE_OWNER_KEY = 'aura:nutrition:scan-review:active-owner:v2'

const LEGACY_SCAN_REVIEW_SESSION_KEY = 'aura:nutrition:scan-review:v1'
const SCAN_REVIEW_SESSION_PREFIX = 'aura:nutrition:scan-review:v2'

const INITIAL_MEALS: Array<Omit<MealLog, 'date'>> = [
  { id: 'breakfast', type: 'breakfast', label: 'Bữa sáng', time: '07:30', title: 'Bánh mì trứng & bơ', description: '2 trứng · ½ quả bơ · rau xanh', calories: 420, protein: 24, carbs: 42, fat: 18, fiber: 8, sugar: 5, sodium: 620, status: 'logged', tone: 'orange' },
  { id: 'lunch', type: 'lunch', label: 'Bữa trưa', time: '12:15', title: 'Cơm gà áp chảo', description: 'Cơm trắng · ức gà · rau củ', calories: 610, protein: 42, carbs: 68, fat: 18, fiber: 6, sugar: 4, sodium: 710, status: 'logged', tone: 'green' },
  { id: 'snack', type: 'snack', label: 'Bữa phụ', time: '15:30', title: 'Sữa chua Hy Lạp', description: 'Không đường · 1 hũ', calories: 120, protein: 12, carbs: 10, fat: 3, fiber: 0, sugar: 7, sodium: 85, status: 'logged', tone: 'pink' },
  { id: 'dinner', type: 'dinner', label: 'Bữa tối', time: '19:00', title: 'Cá hồi, khoai lang & salad', description: 'Theo kế hoạch · khoảng 470 kcal', calories: 470, protein: 34, carbs: 46, fat: 17, fiber: 9, sugar: 8, sodium: 410, status: 'planned', tone: 'violet' },
]

export const NUTRITION_ACTIVITY_OPTIONS: Array<{
  value: NutritionActivityKind
  label: string
  met: Record<NutritionActivityIntensity, number>
}> = [
  { value: 'strength', label: 'Tập tạ', met: { low: 3, moderate: 5, high: 6 } },
  { value: 'running', label: 'Chạy bộ', met: { low: 6, moderate: 8.3, high: 11 } },
  { value: 'walking', label: 'Đi bộ', met: { low: 2.8, moderate: 3.5, high: 4.8 } },
  { value: 'cycling', label: 'Đạp xe', met: { low: 4, moderate: 6.8, high: 10 } },
  { value: 'hiit', label: 'HIIT', met: { low: 5, moderate: 8, high: 10.5 } },
  { value: 'swimming', label: 'Bơi', met: { low: 4.5, moderate: 6, high: 9 } },
  { value: 'yoga', label: 'Yoga', met: { low: 2, moderate: 3, high: 4 } },
  { value: 'other', label: 'Hoạt động khác', met: { low: 2.5, moderate: 4, high: 6 } },
]

export function normalizeNutritionProfileDraft(profile?: NutritionProfileDraft | null): NutritionProfileDraft {
  const merged = {
    ...DEFAULT_PROFILE,
    ...(profile ?? {}),
    reminders: { ...DEFAULT_PROFILE.reminders, ...(profile?.reminders ?? {}) },
  }
  const trainingSessions = Number(merged.trainingSessions)
  const mealsPerDay = Number(merged.mealsPerDay)
  return {
    ...merged,
    ...canonicalNutritionProfile(merged),
    reminders: {
      water: merged.reminders.water ?? false,
      breakfast: merged.reminders.breakfast ?? false,
      lunch: merged.reminders.lunch ?? false,
      dinner: merged.reminders.dinner ?? false,
    },
    trainingSessions: Number.isFinite(trainingSessions) ? Math.min(14, Math.max(0, Math.round(trainingSessions))) : DEFAULT_PROFILE.trainingSessions,
    mealsPerDay: Number.isFinite(mealsPerDay) ? Math.min(5, Math.max(3, Math.round(mealsPerDay))) : DEFAULT_PROFILE.mealsPerDay,
  }
}

export function hasCompleteNutritionProfile(profile?: NutritionProfileDraft | null) {
  if (!profile) return false
  const age = Number(profile.age)
  const height = Number(profile.heightCm)
  const weight = Number(profile.weightKg)
  return Number.isFinite(age) && age >= 13 && age <= 100
    && Number.isFinite(height) && height >= 80 && height <= 250
    && Number.isFinite(weight) && weight >= 20 && weight <= 300
    && ['female', 'male', 'other'].includes(String(profile.biologicalSex))
    && ['lose-fat', 'gain-muscle', 'maintain'].includes(String(profile.goal))
}

export function formatNutritionNumber(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value)
}

export function getDailyPlan(calorieGoal: number, profile: NutritionProfileDraft) {
  const vegetarian = profile.eatingStyle === 'Ăn chay' || profile.eatingStyle === 'Thuần chay'
  const lowCarb = profile.eatingStyle === 'Ít tinh bột'
  const isVietnamese = profile.favoriteCuisine === 'Món Việt truyền thống'
  const mealsCount = profile.mealsPerDay || 3
  let titles: string[]
  let ratios: number[]
  let labels: string[]
  let times: string[]

  if (mealsCount === 2) {
    titles = vegetarian ? ['Salad bơ đậu hũ', 'Cơm lứt rau củ nướng'] : lowCarb ? ['Trứng ốp la & bơ', 'Salad ức gà'] : isVietnamese ? ['Phở bò cốt trong', 'Cơm tấm sườn bì'] : ['Sandwich trứng', 'Cá hồi áp chảo']
    ratios = [0.45]; labels = ['Bữa chính 1', 'Bữa chính 2']; times = ['11:30', '18:30']
  } else if (mealsCount === 4) {
    titles = vegetarian ? ['Yến mạch', 'Cơm đậu phụ', 'Sữa chua', 'Đậu lăng nướng'] : lowCarb ? ['Trứng bơ', 'Gà salad', 'Hạt', 'Cá áp chảo'] : isVietnamese ? ['Bún mọc', 'Cơm gà', 'Trái cây', 'Cơm cá kho'] : ['Oatmeal', 'Chicken Rice', 'Greek Yogurt', 'Steak']
    ratios = [0.24, 0.32, 0.1]; labels = ['Bữa sáng', 'Bữa trưa', 'Bữa phụ', 'Bữa tối']; times = ['07:30', '12:15', '15:30', '19:00']
  } else if (mealsCount === 5) {
    titles = vegetarian ? ['Yến mạch', 'Hạt', 'Cơm đậu phụ', 'Sữa chua', 'Đậu lăng'] : lowCarb ? ['Trứng bơ', 'Hạt', 'Gà salad', 'Sữa chua', 'Cá áp chảo'] : isVietnamese ? ['Bún mọc', 'Chuối', 'Cơm gà', 'Sữa chua', 'Cơm cá kho'] : ['Oatmeal', 'Almonds', 'Chicken Rice', 'Yogurt', 'Steak']
    ratios = [0.20, 0.1, 0.30, 0.1]; labels = ['Bữa sáng', 'Bữa phụ sáng', 'Bữa trưa', 'Bữa phụ chiều', 'Bữa tối']; times = ['07:30', '10:00', '12:30', '15:30', '19:00']
  } else {
    titles = vegetarian ? ['Yến mạch', 'Cơm đậu phụ', 'Đậu lăng nướng'] : lowCarb ? ['Trứng bơ', 'Gà salad', 'Cá áp chảo'] : isVietnamese ? ['Phở bò', 'Cơm sườn', 'Cơm cá kho'] : ['Oatmeal', 'Chicken Salad', 'Steak & Veggies']
    ratios = [0.30, 0.40]; labels = ['Bữa sáng', 'Bữa trưa', 'Bữa tối']; times = ['07:30', '12:30', '19:00']
  }

  const firstMeals = ratios.map((ratio) => Math.round((calorieGoal * ratio) / 10) * 10)
  const lastMealCalories = calorieGoal - firstMeals.reduce((sum, calories) => sum + calories, 0)
  return titles.map((title, index) => {
    const calories = index < firstMeals.length ? firstMeals[index] : lastMealCalories
    return { time: times[index], label: labels[index], title, calories, protein: Math.round(calories * 0.3 / 4) }
  })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readOptionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readNonNegativeOptionalNumber(value: unknown) {
  const parsed = readOptionalNumber(value)
  return parsed === null ? undefined : Math.max(0, parsed)
}

export function loadPersistedMeals(storageKey: string, fallback: MealLog[]) {
  if (typeof window === 'undefined') return fallback
  try {
    // A missing key means this is the first demo session, not an empty diary.
    // Keep an explicitly persisted [] as an intentional user-cleared state.
    const raw = window.localStorage.getItem(storageKey)
    if (raw === null) return fallback
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return fallback
    const validTypes = new Set<MealLog['type']>(['breakfast', 'lunch', 'dinner', 'snack'])
    const validStatuses = new Set<MealLog['status']>(['logged', 'planned'])
    const validTones = new Set<MealLog['tone']>(['violet', 'orange', 'green', 'pink'])
    return parsed.slice(0, 500).map((value): MealLog | null => {
      const item = asRecord(value)
      if (!item || typeof item.id !== 'string' || typeof item.title !== 'string') return null
      return {
        id: item.id,
        catalogId: typeof item.catalogId === 'string' ? item.catalogId : undefined,
        plannedMealId: typeof item.plannedMealId === 'string' ? item.plannedMealId : undefined,
        date: typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? item.date : toLocalDateKey(new Date()),
        type: validTypes.has(item.type as MealLog['type']) ? item.type as MealLog['type'] : 'snack',
        label: typeof item.label === 'string' ? item.label : 'Bữa ăn',
        time: typeof item.time === 'string' ? item.time : '',
        title: item.title,
        description: typeof item.description === 'string' ? item.description : '',
        calories: Math.max(0, readNumber(item.calories)), protein: Math.max(0, readNumber(item.protein)), carbs: Math.max(0, readNumber(item.carbs)), fat: Math.max(0, readNumber(item.fat)),
        fiber: readNonNegativeOptionalNumber(item.fiber), sugar: readNonNegativeOptionalNumber(item.sugar), sodium: readNonNegativeOptionalNumber(item.sodium),
        status: validStatuses.has(item.status as MealLog['status']) ? item.status as MealLog['status'] : 'logged',
        tone: validTones.has(item.tone as MealLog['tone']) ? item.tone as MealLog['tone'] : 'green',
        image: typeof item.image === 'string' && !item.image.startsWith('data:') ? item.image : undefined,
        source: item.source === 'ai-scan' || item.source === 'demo' || item.source === 'catalog' || item.source === 'manual' ? item.source : undefined,
        confidence: item.confidence === 'verified' || item.confidence === 'estimated' || item.confidence === 'needs-review' ? item.confidence : undefined,
        calorieRange: asRecord(item.calorieRange) && typeof asRecord(item.calorieRange)?.low === 'number' && typeof asRecord(item.calorieRange)?.high === 'number'
          ? { low: Math.max(0, readNumber(asRecord(item.calorieRange)?.low)), high: Math.max(0, readNumber(asRecord(item.calorieRange)?.high)) }
          : undefined,
      }
    }).filter((item): item is MealLog => Boolean(item))
  } catch { return fallback }
}

export function loadPersistedWater(storageKey: string) {
  if (typeof window === 'undefined') return {} as Record<string, number>
  try {
    const record = asRecord(JSON.parse(window.localStorage.getItem(storageKey) ?? '{}') as unknown)
    if (!record) return {} as Record<string, number>
    return Object.fromEntries(Object.entries(record)
      .filter(([date, amount]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && typeof amount === 'number' && Number.isFinite(amount))
      .map(([date, amount]) => [date, Math.min(10000, Math.max(0, Math.round(amount as number))) ]))
  } catch { return {} as Record<string, number> }
}

export function loadPersistedWaterEntries(storageKey: string) {
  if (typeof window === 'undefined') return [] as NutritionWaterLog[]
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return [] as NutritionWaterLog[]
    return parsed.slice(0, 1000).map((value): NutritionWaterLog | null => {
      const item = asRecord(value)
      if (!item || typeof item.id !== 'string' || typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date) || typeof item.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)) return null
      const amountMl = Math.round(readNumber(item.amountMl))
      return amountMl > 0 && amountMl <= 10000 ? { id: item.id, date: item.date, time: item.time, amountMl, createdAt: Math.max(0, readNumber(item.createdAt, Date.now())) } : null
    }).filter((item): item is NutritionWaterLog => Boolean(item))
  } catch { return [] as NutritionWaterLog[] }
}

export function loadPersistedActivities(storageKey: string, fallback: NutritionActivityLog[]) {
  if (typeof window === 'undefined') return fallback
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return fallback
    const validKinds = new Set(NUTRITION_ACTIVITY_OPTIONS.map((item) => item.value))
    const validIntensities = new Set<NutritionActivityIntensity>(['low', 'moderate', 'high'])
    return parsed.slice(0, 500).map((value): NutritionActivityLog | null => {
      const item = asRecord(value)
      if (!item || typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date) || typeof item.startTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.startTime) || !validKinds.has(item.kind as NutritionActivityKind) || !validIntensities.has(item.intensity as NutritionActivityIntensity)) return null
      const durationMinutes = Math.round(readNumber(item.durationMinutes)); const estimatedCalories = Math.round(readNumber(item.estimatedCalories))
      if (durationMinutes < 1 || durationMinutes > 600 || estimatedCalories < 0 || estimatedCalories > 5000) return null
      return { id: item.id, date: item.date, startTime: item.startTime, kind: item.kind as NutritionActivityKind, title: item.title.trim() || NUTRITION_ACTIVITY_OPTIONS.find((option) => option.value === item.kind)?.label || 'Hoạt động', durationMinutes, intensity: item.intensity as NutritionActivityIntensity, estimatedCalories, met: Math.max(0, readNumber(item.met)), weightKgAtEstimate: Math.max(0, readNumber(item.weightKgAtEstimate)), source: 'manual', createdAt: Math.max(0, readNumber(item.createdAt, Date.now())) }
    }).filter((item): item is NutritionActivityLog => Boolean(item))
  } catch { return fallback }
}

export function createInitialMeals(): MealLog[] {
  const date = toLocalDateKey(new Date())
  return INITIAL_MEALS.map((meal) => ({ ...meal, date }))
}

export function createInitialActivities(): NutritionActivityLog[] {
  const durationMinutes = 45
  const met = NUTRITION_ACTIVITY_OPTIONS[0].met.moderate
  return [{ id: 'demo-strength', date: toLocalDateKey(new Date()), startTime: '18:00', kind: 'strength', title: 'Tập tạ toàn thân', durationMinutes, intensity: 'moderate', estimatedCalories: Math.round((met * 3.5 * DEFAULT_PROFILE.weightKg / 200) * durationMinutes), met, weightKgAtEstimate: DEFAULT_PROFILE.weightKg, source: 'manual', createdAt: Date.now() }]
}

export function clearPendingScanReview(ownerId: string) {
  try {
    window.sessionStorage.removeItem(`${SCAN_REVIEW_SESSION_PREFIX}:${encodeURIComponent(ownerId)}`)
    window.sessionStorage.removeItem(LEGACY_SCAN_REVIEW_SESSION_KEY)
  } catch {
    // Session cleanup must never block the active nutrition flow.
  }
}
