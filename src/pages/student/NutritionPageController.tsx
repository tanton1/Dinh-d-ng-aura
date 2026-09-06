import { useNutritionWeight } from '../../hooks/useNutritionWeight'
import { scaleCatalogServing } from '../../features/nutrition/servings'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import type {
  NutritionFoodDetailRecord,
  NutritionServingSelection,
} from './NutritionFoodDetail'
import {
  readRecentAverageWeight,
  resolveDailyNutritionTargets,
} from '../../features/nutrition/dailyNutritionTargets'
import NutritionGroupIcon from '../../components/NutritionGroupIcon'
import NutritionWorkspace, {
  NutritionSectionNav,
  type AuraAssistantImageAttachment,
  type AuraAssistantMessage,
  type NutritionDiaryDaySummary,
  type NutritionMealEntry,
  type NutritionPlannedMeal,
  type NutritionPlanDay,
} from './NutritionWorkspace'
import { firebaseAuth } from '../../lib/firebase'
import { firestoreDb } from '../../lib/firebaseFirestore'
import {
  saveUserMealLog,
  deleteUserMealLog,
  loadRecentUserMealLogs,
  subscribeToUserMealLogsForDate,
  submitMealReview,
  saveUserWaterLog,
  deleteUserWaterLog,
  loadRecentUserWaterLogs,
  subscribeToUserWaterLogsForDate,
  saveUserActivityLog,
  deleteUserActivityLog,
  loadRecentUserActivityLogs,
  subscribeToUserActivityLogsForDate,
} from '../../services/firebaseService'
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Camera,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Droplets,
  Dumbbell,
  Info,
  Plus,
  Salad,
  Search,
  Sparkles,
  Target,
  TrendingDown,
  X,
  CheckCircle2,
} from 'lucide-react'
import '../../styles-nutrition.css'
import '../../styles-nutrition-home.css'
import DataSyncStatusBanner from '../../components/data/DataSyncStatusBanner'
import type { DataSyncState } from '../../dataSync/profileSync'

export type { NutritionGoal, NutritionProfileDraft } from '../../features/nutrition/types'
import type {
  MealLog,
  NutritionActivityDraft,
  NutritionActivityIntensity,
  NutritionActivityKind,
  NutritionActivityLog,
  NutritionFoodCatalogItem,
  NutritionGoal,
  NutritionMealDraft,
  NutritionPageProps,
  NutritionProfileDraft,
  NutritionWaterLog,
} from '../../features/nutrition/types'
import {
  dateFromLocalKey,
  getCalendarStart,
  getRecentDateKeys,
  getWeekDays,
  nutritionFoodIdFromHash,
  nutritionFoodDetailHash,
  nutritionSectionFromHash,
  nutritionSectionHash,
  normalizeNutritionSearch as normalizeSearch,
  resolveNutritionAssistantIntent,
  toLocalDateKey,
  toWorkspaceSection,
  type NutritionPrimarySection,
  type NutritionRouteSection,
} from '../../features/nutrition/routing'
import { useAuraUiSurface } from '../../features/ui-rollout/AuraUiRolloutContext'
import {
  detailNutrientValue,
  loadNutritionCatalog,
  loadNutritionCatalogDetail,
  scaleOptionalNumber,
  toFoodDetailSummary,
} from '../../features/nutrition/catalog'
import { nutritionEvidenceLabel } from '../../features/nutrition/analysis'
import { nutritionQuality, canonicalNutritionProfile, calculateNutritionTargets, NUTRITION_FORMULA_VERSION } from '../../services/nutritionSyncService'
import { useAccessibleDialog } from '../../features/nutrition/useAccessibleDialog'
import { useNutritionAssistantController } from '../../features/nutrition/useNutritionAssistantController'
import { MealEditorSheet, MealLogEditorSheet, type MealEditorContext, type MealLogEditDraft } from './NutritionMealEditors'
import {
  confirmMyNutritionPlan,
  generateMyNutritionPlanDraft,
  getMyNutritionPlanWorkspace,
  mutateMyNutritionPlanMeal,
  nutritionPlanErrorMessage,
  type NutritionPlanMeal,
  type NutritionPlanRecord,
} from '../../services/nutritionPlanService'

const NutritionFoodDetail = React.lazy(() => import('./NutritionFoodDetail'))
const ConnectedMealPlanPage = React.lazy(() => import('./ConnectedMealPlanPage'))
const FoodScanModal = React.lazy(() => import('./NutritionScanFlow'))
const FoodCatalogModal = React.lazy(() => import('./NutritionCatalogFlow'))
const CapturedMealDetail = React.lazy(() => import('./CapturedMealDetail'))
const NutritionProfileEditor = React.lazy(() => import('./NutritionProfileEditor'))
const NutritionDashboardHome = React.lazy(() => import('./NutritionDashboardHome'))
const WorkoutLogSheet = React.lazy(() => import('../../components/workout/WorkoutLogSheet'))
const QuickAddSheet = React.lazy(() => import('./NutritionQuickSheets').then((module) => ({ default: module.NutritionQuickAddSheet })))
const WaterLogSheet = React.lazy(() => import('./NutritionQuickSheets').then((module) => ({ default: module.NutritionWaterLogSheet })))

function canLogCatalogFood(food: NutritionFoodCatalogItem): food is NutritionFoodCatalogItem & {
  calories: number
  protein: number
  carbs: number
  fat: number
} {
  return food.calories !== null && food.protein !== null && food.carbs !== null && food.fat !== null
    && nutritionQuality({ calories: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat }).length === 0
}
const INITIAL_MEALS: Array<Omit<MealLog, 'date'>> = [
  {
    id: 'breakfast',
    type: 'breakfast',
    label: 'Bữa sáng',
    time: '07:30',
    title: 'Bánh mì trứng & bơ',
    description: '2 trứng · ½ quả bơ · rau xanh',
    calories: 420,
    protein: 24,
    carbs: 42,
    fat: 18,
    fiber: 8,
    sugar: 5,
    sodium: 620,
    status: 'logged',
    tone: 'orange',
  },
  {
    id: 'lunch',
    type: 'lunch',
    label: 'Bữa trưa',
    time: '12:15',
    title: 'Cơm gà áp chảo',
    description: 'Cơm trắng · ức gà · rau củ',
    calories: 610,
    protein: 42,
    carbs: 68,
    fat: 18,
    fiber: 6,
    sugar: 4,
    sodium: 710,
    status: 'logged',
    tone: 'green',
  },
  {
    id: 'snack',
    type: 'snack',
    label: 'Bữa phụ',
    time: '15:30',
    title: 'Sữa chua Hy Lạp',
    description: 'Không đường · 1 hũ',
    calories: 120,
    protein: 12,
    carbs: 10,
    fat: 3,
    fiber: 0,
    sugar: 7,
    sodium: 85,
    status: 'logged',
    tone: 'pink',
  },
  {
    id: 'dinner',
    type: 'dinner',
    label: 'Bữa tối',
    time: '19:00',
    title: 'Cá hồi, khoai lang & salad',
    description: 'Theo kế hoạch · khoảng 470 kcal',
    calories: 470,
    protein: 34,
    carbs: 46,
    fat: 17,
    fiber: 9,
    sugar: 8,
    sodium: 410,
    status: 'planned',
    tone: 'violet',
  },
]

const WEEK_PLAN = [
  { time: '07:30', label: 'Bữa sáng', title: 'Yến mạch chuối & hạt', calories: 390, protein: 18 },
  { time: '12:15', label: 'Bữa trưa', title: 'Cơm gà áp chảo', calories: 610, protein: 42 },
  { time: '15:30', label: 'Bữa phụ', title: 'Sữa chua Hy Lạp', calories: 120, protein: 12 },
  { time: '19:00', label: 'Bữa tối', title: 'Cá hồi & khoai lang', calories: 470, protein: 34 },
]


const ACTIVITY_OPTIONS: Array<{ value: NutritionActivityKind; label: string; met: Record<NutritionActivityIntensity, number> }> = [
  { value: 'strength', label: 'Tập tạ', met: { low: 3, moderate: 5, high: 6 } },
  { value: 'running', label: 'Chạy bộ', met: { low: 6, moderate: 8.3, high: 11 } },
  { value: 'walking', label: 'Đi bộ', met: { low: 2.8, moderate: 3.5, high: 4.8 } },
  { value: 'cycling', label: 'Đạp xe', met: { low: 4, moderate: 6.8, high: 10 } },
  { value: 'hiit', label: 'HIIT', met: { low: 5, moderate: 8, high: 10.5 } },
  { value: 'swimming', label: 'Bơi', met: { low: 4.5, moderate: 6, high: 9 } },
  { value: 'yoga', label: 'Yoga', met: { low: 2, moderate: 3, high: 4 } },
  { value: 'other', label: 'Hoạt động khác', met: { low: 2.5, moderate: 4, high: 6 } },
]

const ACTIVITY_INTENSITY_LABELS: Record<NutritionActivityIntensity, string> = {
  low: 'Nhẹ',
  moderate: 'Vừa',
  high: 'Cao',
}

const GOAL_LABELS: Record<string, string> = {
  'lose-fat': 'Giảm mỡ bền vững',
  'gain-muscle': 'Tăng cơ & phục hồi',
  maintain: 'Duy trì thể trạng',
  'fat_loss': 'Giảm mỡ bền vững',
  'muscle_gain': 'Tăng cơ & phục hồi',
  'maintenance': 'Duy trì thể trạng',
  'health': 'Cải thiện sức khỏe'
}

const GOAL_OPTIONS: Array<{ value: NutritionGoal; title: string; description: string; icon: typeof Target }> = [
  { value: 'lose-fat', title: 'Giảm mỡ', description: 'Thâm hụt vừa phải, ưu tiên no lâu', icon: TrendingDown },
  { value: 'gain-muscle', title: 'Tăng cơ', description: 'Đủ đạm và năng lượng để phục hồi', icon: Dumbbell },
  { value: 'maintain', title: 'Duy trì', description: 'Cân bằng thể chất và hiệu suất', icon: Activity },
]

const DEFAULT_PROFILE: NutritionProfileDraft = {
  goal: 'lose-fat',
  age: 28,
  biologicalSex: 'female',
  heightCm: 162,
  weightKg: 58,
  targetWeightDeltaKg: -4,
  targetTimeframeMonths: 3,
  targetSpeedPace: 'standard',
  activityLevel: 'moderate',
  trainingSessions: 4,
  eatingStyle: 'Không giới hạn',
  allergies: '',
  mealsPerDay: 3,
  dislikes: '',
  budget: 'medium',
  prepTime: 'medium',
  favoriteCuisine: 'Đa dạng',
  reminders: {
    water: false,
    breakfast: false,
    lunch: false,
    dinner: false,
  }
}

function normalizeNutritionProfileDraft(profile?: NutritionProfileDraft | null): NutritionProfileDraft {
  const merged = {
    ...DEFAULT_PROFILE,
    ...(profile ?? {}),
    reminders: {
      ...DEFAULT_PROFILE.reminders,
      ...(profile?.reminders ?? {}),
    },
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
    trainingSessions: Number.isFinite(trainingSessions)
      ? Math.min(14, Math.max(0, Math.round(trainingSessions)))
      : DEFAULT_PROFILE.trainingSessions,
    mealsPerDay: Number.isFinite(mealsPerDay)
      ? Math.min(5, Math.max(3, Math.round(mealsPerDay)))
      : DEFAULT_PROFILE.mealsPerDay,
  }
}

function hasCompleteNutritionProfile(profile?: NutritionProfileDraft | null) {
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

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value)
}

function formatDecimal(value: number, maximumFractionDigits = 1) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits }).format(value)
}

function getDailyPlan(calorieGoal: number, profile: NutritionProfileDraft) {
  const eatingStyle = profile.eatingStyle
  const mealsCount = profile.mealsPerDay || 3
  const vegetarian = eatingStyle === 'Ăn chay' || eatingStyle === 'Thuần chay'
  const lowCarb = eatingStyle === 'Ít tinh bột'
  const isVietnamese = profile.favoriteCuisine === 'Món Việt truyền thống'
  const isWestern = profile.favoriteCuisine === 'Món Tây / Âu'
  
  let titles: string[] = []
  let ratios: number[] = []
  let labels: string[] = []
  let times: string[] = []
  
  if (mealsCount === 2) {
    titles = vegetarian ? ['Salad bơ đậu hũ', 'Cơm lứt rau củ nướng'] : lowCarb ? ['Trứng ốp la & bơ', 'Salad ức gà'] : isVietnamese ? ['Phở bò cốt trong', 'Cơm tấm sườn bi'] : ['Sandwich trứng', 'Cá hồi áp chảo']
    ratios = [0.45]
    labels = ['Bữa chính 1', 'Bữa chính 2']
    times = ['11:30', '18:30']
  } else if (mealsCount === 4) {
    titles = vegetarian ? ['Yến mạch', 'Cơm đậu phụ', 'Sữa chua', 'Đậu lăng nướng'] : lowCarb ? ['Trứng bơ', 'Gà salad', 'Hạt', 'Cá áp chảo'] : isVietnamese ? ['Bún mọc', 'Cơm gà', 'Trái cây', 'Cơm cá kho'] : ['Oatmeal', 'Chicken Rice', 'Greek Yogurt', 'Steak']
    ratios = [0.24, 0.32, 0.1]
    labels = ['Bữa sáng', 'Bữa trưa', 'Bữa phụ', 'Bữa tối']
    times = ['07:30', '12:15', '15:30', '19:00']
  } else if (mealsCount === 5) {
    titles = vegetarian ? ['Yến mạch', 'Hạt', 'Cơm đậu phụ', 'Sữa chua', 'Đậu lăng'] : lowCarb ? ['Trứng bơ', 'Hạt', 'Gà salad', 'Sữa chua', 'Cá áp chảo'] : isVietnamese ? ['Bún mọc', 'Chuối', 'Cơm gà', 'Sữa chua', 'Cơm cá kho'] : ['Oatmeal', 'Almonds', 'Chicken Rice', 'Yogurt', 'Steak']
    ratios = [0.20, 0.1, 0.30, 0.1]
    labels = ['Bữa sáng', 'Bữa phụ sáng', 'Bữa trưa', 'Bữa phụ chiều', 'Bữa tối']
    times = ['07:30', '10:00', '12:30', '15:30', '19:00']
  } else {
    titles = vegetarian ? ['Yến mạch', 'Cơm đậu phụ', 'Đậu lăng nướng'] : lowCarb ? ['Trứng bơ', 'Gà salad', 'Cá áp chảo'] : isVietnamese ? ['Phở bò', 'Cơm sườn', 'Cơm cá kho'] : ['Oatmeal', 'Chicken Salad', 'Steak & Veggies']
    ratios = [0.30, 0.40]
    labels = ['Bữa sáng', 'Bữa trưa', 'Bữa tối']
    times = ['07:30', '12:30', '19:00']
  }

  const firstMeals = ratios.map((ratio) => Math.round((calorieGoal * ratio) / 10) * 10)
  const lastMealCalories = calorieGoal - firstMeals.reduce((sum, calories) => sum + calories, 0)
  
  return titles.map((title, index) => {
    const calories = index < firstMeals.length ? firstMeals[index] : lastMealCalories
    const protein = Math.round(calories * 0.3 / 4) // Giả sử 30% năng lượng từ protein
    return {
      time: times[index],
      label: labels[index],
      title,
      calories,
      protein,
    }
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

function loadPersistedMeals(storageKey: string, fallback: MealLog[]) {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return fallback
    const validTypes = new Set<MealLog['type']>(['breakfast', 'lunch', 'dinner', 'snack'])
    const validStatuses = new Set<MealLog['status']>(['logged', 'planned'])
    const validTones = new Set<MealLog['tone']>(['violet', 'orange', 'green', 'pink'])
    return parsed.slice(0, 500).map((value): MealLog | null => {
      const item = asRecord(value)
      if (!item || typeof item.id !== 'string' || typeof item.title !== 'string') return null
      const type = validTypes.has(item.type as MealLog['type']) ? item.type as MealLog['type'] : 'snack'
      const status = validStatuses.has(item.status as MealLog['status']) ? item.status as MealLog['status'] : 'logged'
      const tone = validTones.has(item.tone as MealLog['tone']) ? item.tone as MealLog['tone'] : 'green'
      return {
        id: item.id,
        catalogId: typeof item.catalogId === 'string' ? item.catalogId : undefined,
        plannedMealId: typeof item.plannedMealId === 'string' ? item.plannedMealId : undefined,
        date: typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? item.date : toLocalDateKey(new Date()),
        type,
        label: typeof item.label === 'string' ? item.label : 'Bữa ăn',
        time: typeof item.time === 'string' ? item.time : '',
        title: item.title,
        description: typeof item.description === 'string' ? item.description : '',
        calories: Math.max(0, readNumber(item.calories)),
        protein: Math.max(0, readNumber(item.protein)),
        carbs: Math.max(0, readNumber(item.carbs)),
        fat: Math.max(0, readNumber(item.fat)),
        fiber: readNonNegativeOptionalNumber(item.fiber),
        sugar: readNonNegativeOptionalNumber(item.sugar),
        sodium: readNonNegativeOptionalNumber(item.sodium),
        status,
        tone,
        image: typeof item.image === 'string' && !item.image.startsWith('data:') ? item.image : undefined,
        source: item.source === 'ai-scan' || item.source === 'demo' || item.source === 'catalog' || item.source === 'manual' ? item.source : undefined,
        confidence: item.confidence === 'verified' || item.confidence === 'estimated' || item.confidence === 'needs-review' ? item.confidence : undefined,
        calorieRange: asRecord(item.calorieRange)
          && typeof asRecord(item.calorieRange)?.low === 'number'
          && typeof asRecord(item.calorieRange)?.high === 'number'
          ? { low: Math.max(0, readNumber(asRecord(item.calorieRange)?.low)), high: Math.max(0, readNumber(asRecord(item.calorieRange)?.high)) }
          : undefined,
      }
    }).filter((item): item is MealLog => Boolean(item))
  } catch {
    return fallback
  }
}

function loadPersistedWater(storageKey: string) {
  if (typeof window === 'undefined') return {} as Record<string, number>
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}') as unknown
    const record = asRecord(parsed)
    if (!record) return {} as Record<string, number>
    return Object.fromEntries(Object.entries(record)
      .filter(([date, amount]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && typeof amount === 'number' && Number.isFinite(amount))
      .map(([date, amount]) => [date, Math.min(10000, Math.max(0, Math.round(amount as number))) ]))
  } catch {
    return {} as Record<string, number>
  }
}

function loadPersistedWaterEntries(storageKey: string) {
  if (typeof window === 'undefined') return [] as NutritionWaterLog[]
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return [] as NutritionWaterLog[]
    return parsed.slice(0, 1000).map((value): NutritionWaterLog | null => {
      const item = asRecord(value)
      if (!item || typeof item.id !== 'string' || typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) return null
      if (typeof item.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)) return null
      const amountMl = Math.round(readNumber(item.amountMl))
      if (amountMl <= 0 || amountMl > 10000) return null
      return { id: item.id, date: item.date, time: item.time, amountMl, createdAt: Math.max(0, readNumber(item.createdAt, Date.now())) }
    }).filter((item): item is NutritionWaterLog => Boolean(item))
  } catch {
    return [] as NutritionWaterLog[]
  }
}

function loadPersistedActivities(storageKey: string, fallback: NutritionActivityLog[]) {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return fallback
    const validKinds = new Set(ACTIVITY_OPTIONS.map((item) => item.value))
    const validIntensities = new Set<NutritionActivityIntensity>(['low', 'moderate', 'high'])
    return parsed.slice(0, 500).map((value): NutritionActivityLog | null => {
      const item = asRecord(value)
      if (!item || typeof item.id !== 'string' || typeof item.title !== 'string') return null
      if (typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) return null
      if (typeof item.startTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.startTime)) return null
      if (!validKinds.has(item.kind as NutritionActivityKind) || !validIntensities.has(item.intensity as NutritionActivityIntensity)) return null
      const durationMinutes = Math.round(readNumber(item.durationMinutes))
      const estimatedCalories = Math.round(readNumber(item.estimatedCalories))
      if (durationMinutes < 1 || durationMinutes > 600 || estimatedCalories < 0 || estimatedCalories > 5000) return null
      return {
        id: item.id,
        date: item.date,
        startTime: item.startTime,
        kind: item.kind as NutritionActivityKind,
        title: item.title.trim() || ACTIVITY_OPTIONS.find((option) => option.value === item.kind)?.label || 'Hoạt động',
        durationMinutes,
        intensity: item.intensity as NutritionActivityIntensity,
        estimatedCalories,
        met: Math.max(0, readNumber(item.met)),
        weightKgAtEstimate: Math.max(0, readNumber(item.weightKgAtEstimate)),
        source: 'manual',
        createdAt: Math.max(0, readNumber(item.createdAt, Date.now())),
      }
    }).filter((item): item is NutritionActivityLog => Boolean(item))
  } catch {
    return fallback
  }
}

interface NutritionToastState {
  text: string
  action?: {
    label: string
    onClick: () => void
  }
}

const MEAL_STORAGE_PREFIX = 'aura:nutrition:meals:v2'
const WATER_STORAGE_PREFIX = 'aura:nutrition:water:v2'
const WATER_ENTRY_STORAGE_PREFIX = 'aura:nutrition:water-entries:v1'
const SAVED_FOOD_STORAGE_PREFIX = 'aura:nutrition:saved-foods:v2'
const ACTIVITY_STORAGE_PREFIX = 'aura:nutrition:activities:v1'
const LEGACY_SCAN_REVIEW_SESSION_KEY = 'aura:nutrition:scan-review:v1'
const SCAN_REVIEW_SESSION_PREFIX = 'aura:nutrition:scan-review:v2'
const SCAN_REVIEW_ACTIVE_OWNER_KEY = 'aura:nutrition:scan-review:active-owner:v2'

function scanReviewSessionKey(ownerId: string) {
  return `${SCAN_REVIEW_SESSION_PREFIX}:${encodeURIComponent(ownerId)}`
}

function clearPendingScanReview(ownerId: string) {
  try {
    window.sessionStorage.removeItem(scanReviewSessionKey(ownerId))
    window.sessionStorage.removeItem(LEGACY_SCAN_REVIEW_SESSION_KEY)
  } catch {
    // Session cleanup must not block the active nutrition flow.
  }
}

function createInitialMeals(): MealLog[] {
  const date = toLocalDateKey(new Date())
  return INITIAL_MEALS.map((meal) => ({ ...meal, date }))
}

function createInitialActivities(): NutritionActivityLog[] {
  const weightKg = DEFAULT_PROFILE.weightKg
  const durationMinutes = 45
  const met = ACTIVITY_OPTIONS[0].met.moderate
  return [{
    id: 'demo-strength',
    date: toLocalDateKey(new Date()),
    startTime: '18:00',
    kind: 'strength',
    title: 'Tập tạ toàn thân',
    durationMinutes,
    intensity: 'moderate',
    estimatedCalories: Math.round((met * 3.5 * weightKg / 200) * durationMinutes),
    met,
    weightKgAtEstimate: weightKg,
    source: 'manual',
    createdAt: Date.now(),
  }]
}

function NutritionSetupPrompt({ onStart }: { onStart?: () => void }) {
  return (
    <div className="page nutrition-page nutrition-page--workspace nutrition-setup-page" data-testid="nutrition-setup-prompt">
      <section className="nutrition-setup-card" aria-labelledby="nutrition-setup-title">
        <div className="nutrition-setup-card__glow nutrition-setup-card__glow--pink" />
        <div className="nutrition-setup-card__glow nutrition-setup-card__glow--orange" />
        <span className="nutrition-setup-card__mark"><Target size={25} /></span>
        <span className="nutrition-kicker">AURA NUTRITION</span>
        <h1 id="nutrition-setup-title">Thiết lập mục tiêu dinh dưỡng</h1>
        <p>Hoàn thành onboarding Aura một lần để tính mục tiêu năng lượng, macro và gợi ý phù hợp với cơ thể của bạn.</p>
        <div className="nutrition-setup-card__facts">
          <span><CheckCircle2 size={16} /> Chỉ số cơ thể</span>
          <span><CheckCircle2 size={16} /> Mục tiêu cá nhân</span>
          <span><CheckCircle2 size={16} /> Nhịp sống & ăn uống</span>
        </div>
        <button type="button" className="nutrition-setup-card__button" onClick={onStart} disabled={!onStart}>
          <Sparkles size={18} /> Thiết lập mục tiêu <ChevronRight size={18} />
        </button>
        <small>Bạn có thể cập nhật lại mục tiêu bất cứ lúc nào trong trang Cá nhân.</small>
      </section>
    </div>
  )
}

function NutritionOnboarding({ onComplete, initialProfile = DEFAULT_PROFILE, onCancel, editing = false }: { onComplete: (profile: NutritionProfileDraft) => void; initialProfile?: NutritionProfileDraft; onCancel?: () => void; editing?: boolean }) {
  const [step, setStep] = useState(1)
  const [profile, setProfile] = useState<NutritionProfileDraft>(initialProfile)

  const setField = <K extends keyof NutritionProfileDraft>(field: K, value: NutritionProfileDraft[K]) => {
    setProfile((current) => {
      const next = { ...current, [field]: value }
      if (field === 'targetWeightDeltaKg') next.targetWeightKg = current.weightKg + Number(value)
      if (field === 'targetSpeedPace') next.targetTimeframeMode = 'pace'
      if (field === 'targetTimeframeMonths') next.targetTimeframeMode = 'duration'
      return next
    })
  }

  return (
    <div className="nutrition-onboarding-shell" data-testid="nutrition-onboarding">
      <div className="nutrition-onboarding-decoration nutrition-onboarding-decoration--one" />
      <div className="nutrition-onboarding-decoration nutrition-onboarding-decoration--two" />
      <section className="nutrition-onboarding" aria-labelledby="nutrition-onboarding-title">
        <header className="nutrition-onboarding__header">
          <span className="nutrition-ai-mark"><Sparkles size={16} /> {editing ? 'Cập nhật kế hoạch' : 'Aura Nutrition AI'}</span>
          <span className="nutrition-onboarding__step">Bước {step} / 4</span>
          <div className="nutrition-onboarding__progress" aria-label={`Tiến độ ${Math.round((step / 4) * 100)}%`}>
            <span style={{ width: `${(step / 4) * 100}%` }} />
          </div>
        </header>

        {step === 1 && (
          <div className="nutrition-onboarding__body">
            <span className="nutrition-kicker">BẮT ĐẦU TỪ MỤC TIÊU</span>
            <h1 id="nutrition-onboarding-title">Bạn muốn thay đổi điều gì?</h1>
            <p>Aura sẽ dùng mục tiêu này để đề xuất năng lượng, macro và thực đơn phù hợp.</p>
            <div className="nutrition-goal-grid">
              {GOAL_OPTIONS.map((option) => {
                const Icon = option.icon
                const active = profile.goal === option.value
                return (
                  <button
                    type="button"
                    className={active ? 'active' : ''}
                    key={option.value}
                    onClick={() => {
                      setField('goal', option.value)
                      if (option.value === 'lose-fat' && (!profile.targetWeightDeltaKg || profile.targetWeightDeltaKg > 0)) {
                        setField('targetWeightDeltaKg', -4)
                      } else if (option.value === 'gain-muscle' && (!profile.targetWeightDeltaKg || profile.targetWeightDeltaKg < 0)) {
                        setField('targetWeightDeltaKg', 3)
                      } else if (option.value === 'maintain') {
                        setField('targetWeightDeltaKg', 0)
                      }
                    }}
                    aria-pressed={active}
                  >
                    <span><Icon size={22} /></span>
                    <strong>{option.title}</strong>
                    <small>{option.description}</small>
                    <i>{active && <Check size={14} />}</i>
                  </button>
                )
              })}
            </div>

            <div className="nutrition-form-grid" style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--nutrition-line, #e5e7eb)' }}>
              {profile.goal !== 'maintain' ? (
                <label className="nutrition-field">
                  <span>Mục tiêu thay đổi (kg)</span>
                  <div>
                    <input
                      type="number"
                      step="0.5"
                      value={profile.targetWeightDeltaKg ?? (profile.goal === 'lose-fat' ? -4 : 3)}
                      onChange={(e) => setField('targetWeightDeltaKg', Number(e.target.value))}
                    />
                    <small>kg</small>
                  </div>
                </label>
              ) : (
                <label className="nutrition-field">
                  <span>Trạng thái</span>
                  <div><input type="text" disabled value="Duy trì vóc dáng hiện tại" /></div>
                </label>
              )}

              <label className="nutrition-field">
                <span>Thời gian hoàn thành</span>
                <select
                  value={profile.targetTimeframeMonths ?? 3}
                  onChange={(e) => setField('targetTimeframeMonths', Number(e.target.value))}
                >
                  <option value={1}>1 tháng (Cực ngắn)</option>
                  <option value={2}>2 tháng</option>
                  <option value={3}>3 tháng (Khuyên dùng)</option>
                  <option value={4}>4 tháng</option>
                  <option value={6}>6 tháng (Bền vững)</option>
                  <option value={9}>9 tháng</option>
                  <option value={12}>12 tháng (1 năm)</option>
                </select>
              </label>

              <label className="nutrition-field" style={{ gridColumn: 'span 2' }}>
                <span>Tốc độ tiến trình kỳ vọng</span>
                <select
                  value={profile.targetSpeedPace || 'standard'}
                  onChange={(e) => setField('targetSpeedPace', e.target.value as any)}
                >
                  <option value="slow">Thong thả & Bền vững (~0.25 - 0.4 kg/tuần)</option>
                  <option value="standard">Tiêu chuẩn & An toàn (~0.5 - 0.7 kg/tuần - Đề xuất)</option>
                  <option value="fast">Nhanh & Quyết liệt (~0.8 - 1.0 kg/tuần)</option>
                </select>
              </label>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="nutrition-onboarding__body">
            <span className="nutrition-kicker">CHỈ SỐ CƠ BẢN</span>
            <h1 id="nutrition-onboarding-title">Hiểu cơ thể của bạn</h1>
            <p>Các số liệu được dùng để ước tính nhu cầu năng lượng ban đầu và có thể chỉnh bất cứ lúc nào.</p>
            <div className="nutrition-form-grid">
              <label className="nutrition-field">
                <span>Tuổi</span>
                <div><input type="number" min="18" max="90" value={profile.age} onChange={(event) => setField('age', Number(event.target.value))} /><small>tuổi</small></div>
              </label>
              <label className="nutrition-field">
                <span>Giới tính sinh học</span>
                <select value={profile.biologicalSex} onChange={(event) => setField('biologicalSex', event.target.value as NutritionProfileDraft['biologicalSex'])}>
                  <option value="female">Nữ</option>
                  <option value="male">Nam</option>
                </select>
              </label>
              <label className="nutrition-field">
                <span>Chiều cao</span>
                <div><input type="number" min="120" max="230" value={profile.heightCm} onChange={(event) => setField('heightCm', Number(event.target.value))} /><small>cm</small></div>
              </label>
              <label className="nutrition-field">
                <span>Cân nặng hiện tại</span>
                <div><input type="number" min="30" max="250" step="0.1" value={profile.weightKg} onChange={(event) => setField('weightKg', Number(event.target.value))} /><small>kg</small></div>
              </label>
            </div>
            <div className="nutrition-privacy-note"><Info size={16} /><span>Dữ liệu sức khỏe chỉ được dùng để cá nhân hóa kế hoạch của bạn.</span></div>
          </div>
        )}

        {step === 3 && (
          <div className="nutrition-onboarding__body">
            <span className="nutrition-kicker">NHỊP SỐNG & ĂN UỐNG</span>
            <h1 id="nutrition-onboarding-title">Một kế hoạch bạn có thể theo lâu dài</h1>
            <p>Cho Aura biết mức vận động và những ràng buộc quan trọng trong bữa ăn.</p>
            <div className="nutrition-form-grid">
              <label className="nutrition-field">
                <span>Mức vận động hằng ngày</span>
                <select value={profile.activityLevel} onChange={(event) => setField('activityLevel', event.target.value as NutritionProfileDraft['activityLevel'])}>
                  <option value="sedentary">Ít vận động, không tập</option><option value="light">Vận động nhẹ</option><option value="low">Vận động nhẹ (hồ sơ cũ)</option>
                  <option value="moderate">Vận động vừa</option>
                  <option value="high">Vận động nhiều</option>
                </select>
              </label>
              <label className="nutrition-field">
                <span>Số buổi tập / tuần</span>
                <div><input type="number" min="0" max="14" value={profile.trainingSessions} onChange={(event) => setField('trainingSessions', Number(event.target.value))} /><small>buổi</small></div>
              </label>
              <label className="nutrition-field">
                <span>Phong cách ăn uống</span>
                <select value={profile.eatingStyle} onChange={(event) => setField('eatingStyle', event.target.value)}>
                  <option>Không giới hạn</option>
                  <option>Ăn chay</option>
                  <option>Thuần chay</option>
                  <option>Ít tinh bột</option>
                  <option>Không gluten</option>
                </select>
              </label>
              <label className="nutrition-field">
                <span>Dị ứng / thực phẩm cần tránh</span>
                <input type="text" value={profile.allergies} placeholder="Ví dụ: hải sản, đậu phộng…" onChange={(event) => setField('allergies', event.target.value)} />
              </label>
            </div>
            <div className="nutrition-safety-note"><CircleAlert size={17} /><span>Nếu bạn đang mang thai, điều trị bệnh hoặc có rối loạn ăn uống, hãy tham khảo chuyên gia trước khi áp dụng.</span></div>
          </div>
        )}

        {step === 4 && (
          <div className="nutrition-onboarding__body">
            <span className="nutrition-kicker">CÁ THỂ HÓA THỰC ĐƠN</span>
            <h1 id="nutrition-onboarding-title">Chi tiết cho kế hoạch 7 ngày</h1>
            <p>Giúp Aura gợi ý thực đơn phù hợp với thời gian, ngân sách và sở thích của bạn.</p>
            <div className="nutrition-form-grid">
              <label className="nutrition-field">
                <span>Số bữa ăn mỗi ngày</span>
                <select value={profile.mealsPerDay || 3} onChange={(event) => setField('mealsPerDay', Number(event.target.value))}>
                  <option value={2}>2 bữa (VD: Nhịn ăn gián đoạn)</option>
                  <option value={3}>3 bữa (Sáng, Trưa, Tối)</option>
                  <option value={4}>4 bữa (Thêm 1 bữa phụ)</option>
                  <option value={5}>5 bữa (Chia nhỏ trong ngày)</option>
                </select>
              </label>
              <label className="nutrition-field">
                <span>Ngân sách thực phẩm</span>
                <select value={profile.budget || 'medium'} onChange={(event) => setField('budget', event.target.value as any)}>
                  <option value="low">Tiết kiệm</option>
                  <option value="medium">Tiêu chuẩn</option>
                  <option value="high">Linh hoạt / Thoải mái</option>
                </select>
              </label>
              <label className="nutrition-field">
                <span>Thời gian nấu nướng</span>
                <select value={profile.prepTime || 'medium'} onChange={(event) => setField('prepTime', event.target.value as any)}>
                  <option value="quick">Nhanh gọn (&lt; 20 phút)</option>
                  <option value="medium">Vừa phải (20 - 45 phút)</option>
                  <option value="long">Có nhiều thời gian (&gt; 45 phút)</option>
                </select>
              </label>
              <label className="nutrition-field">
                <span>Khẩu vị / Vùng miền yêu thích</span>
                <select value={profile.favoriteCuisine || 'Đa dạng'} onChange={(event) => setField('favoriteCuisine', event.target.value)}>
                  <option>Đa dạng</option>
                  <option>Món Việt truyền thống</option>
                  <option>Món Tây / Âu</option>
                  <option>Món Á (Nhật, Hàn, Thái...)</option>
                </select>
              </label>
              <label className="nutrition-field" style={{ gridColumn: 'span 2' }}>
                <span>Món ăn không thích</span>
                <input type="text" value={profile.dislikes || ''} placeholder="Ví dụ: hành, mướp đắng, cá mè..." onChange={(event) => setField('dislikes', event.target.value)} />
              </label>
            </div>
          </div>
        )}

        <footer className="nutrition-onboarding__footer">
          <button type="button" className="nutrition-secondary-button" onClick={() => step === 1 && onCancel ? onCancel() : setStep((current) => Math.max(1, current - 1))} disabled={step === 1 && !onCancel}>
            {step === 1 && onCancel ? <X size={17} /> : <ArrowLeft size={17} />} {step === 1 && onCancel ? 'Hủy' : 'Quay lại'}
          </button>
          <button type="button" className="nutrition-primary-button" onClick={() => step < 4 ? setStep((current) => current + 1) : onComplete(profile)}>
            {step < 4 ? 'Tiếp tục' : 'Tạo kế hoạch của tôi'} {step < 4 ? <ArrowRight size={17} /> : <Sparkles size={17} />}
          </button>
        </footer>
      </section>
    </div>
  )
}

function LegacyQuickAddSheet({ savedCount, onClose, onScan, onCatalog, onSaved, onWater, onExercise }: { savedCount: number; onClose: () => void; onScan?: () => void; onCatalog?: () => void; onSaved?: () => void; onWater: () => void; onExercise: () => void }) {
  const dialogRef = useAccessibleDialog(onClose)
  const actions = [
    ...(onScan ? [{ title: 'Chụp / Quét ảnh món ăn', copy: 'Phân tích calo & dinh dưỡng bằng AI', icon: <Camera size={22} />, action: onScan, primary: true }] : []),
    { title: 'Ghi lượng nước', copy: '250, 500, 750, 1000 ml', icon: <Droplets size={22} />, action: onWater, highlight: true },
    ...(onCatalog ? [{ title: 'Catalog dinh dưỡng', copy: 'Tra cứu món ăn và thực phẩm', icon: <Search size={22} />, action: onCatalog }] : []),
    { title: 'Ghi luyện tập', copy: 'Thời gian & cường độ', icon: <Dumbbell size={22} />, action: onExercise },
    ...(onSaved ? [{ title: 'Món đã lưu', copy: savedCount ? `${savedCount} món trong catalog` : 'Chưa có món đã lưu', icon: <Bookmark size={22} />, action: onSaved }] : []),
  ]
  return (
    <div className="nutrition-sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="nutrition-quick-sheet pink-orange-sheet" role="dialog" aria-modal="true" aria-labelledby="nutrition-quick-sheet-title">
        <header>
          <div>
            <span className="nutrition-kicker pink-orange-badge"><Sparkles size={12} /> THÊM NHANH</span>
            <h2 id="nutrition-quick-sheet-title">Bạn muốn ghi lại gì?</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng bảng thêm nhanh"><X size={20} /></button>
        </header>
        <div className="nutrition-quick-sheet__grid">
          {actions.map((item, index) => (
            <button 
              type="button" 
              key={item.title} 
              className={`${item.primary ? 'is-primary' : ''} ${item.highlight ? 'is-highlight-water' : ''}`}
              data-dialog-autofocus={index === 0 ? '' : undefined} 
              onClick={() => { onClose(); item.action() }}
            >
              <span>{item.icon}</span>
              <strong>{item.title}</strong>
              <small>{item.copy}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function LegacyWaterLogSheet({
  current, 
  goal, 
  dateLabel, 
  todayEntries = [], 
  onClose, 
  onLog,
  onRemoveEntry
}: { 
  current: number; 
  goal: number; 
  dateLabel: string; 
  todayEntries?: { id: string; time: string; amountMl: number }[];
  onClose: () => void; 
  onLog: (amount: number) => void;
  onRemoveEntry?: (id: string) => void;
}) {
  const [amount, setAmount] = useState(250)
  const dialogRef = useAccessibleDialog(onClose)
  const safeAmount = Number.isFinite(amount) ? Math.min(5000, Math.max(0, Math.round(amount))) : 0
  const percentage = Math.min(100, Math.round((current / (goal || 2000)) * 100))

  return (
    <div className="nutrition-sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="nutrition-water-sheet pink-orange-sheet" role="dialog" aria-modal="true" aria-labelledby="nutrition-water-sheet-title" aria-describedby="nutrition-water-sheet-description">
        <header>
          <div>
            <span className="nutrition-kicker pink-orange-badge"><Sparkles size={12} /> HYDRATION TRACKER</span>
            <h2 id="nutrition-water-sheet-title">Ghi lượng nước uống</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng bảng ghi nước"><X size={20} /></button>
        </header>

        {/* Visual Progress Banner with Pink-Orange Gradient */}
        <div className="water-progress-card-po">
          <div className="water-progress-header-po">
            <div className="water-progress-info-po">
              <span className="water-droplet-emoji">💧</span>
              <div>
                <small>Đã uống trong {dateLabel.toLocaleLowerCase('vi-VN')}</small>
                <strong>{formatNumber(current)} <span className="goal-sub-po">/ {formatNumber(goal)} ml</span></strong>
              </div>
            </div>
            <div className="water-pct-pill-po">{percentage}%</div>
          </div>
          <div className="water-progress-track-po">
            <div className="water-progress-fill-po" style={{ width: `${percentage}%` }} />
          </div>
        </div>

        <label className="nutrition-water-sheet__input">
          <span>Lượng muốn thêm (ml)</span>
          <div className="water-input-stepper-po">
            <button type="button" className="water-step-btn-po" onClick={() => setAmount(Math.max(50, (amount || 250) - 50))}>-50</button>
            <input type="number" inputMode="numeric" min="1" max="5000" step="50" value={amount || ''} onChange={(event) => setAmount(Number(event.target.value))} aria-describedby="nutrition-water-limit" />
            <b>ml</b>
            <button type="button" className="water-step-btn-po" onClick={() => setAmount(Math.min(5000, (amount || 0) + 50))}>+50</button>
          </div>
          <small id="nutrition-water-limit">Tối đa 5.000 ml mỗi lần ghi.</small>
        </label>

        <div className="nutrition-water-presets pink-orange-presets" role="group" aria-label="Chọn nhanh lượng nước">
          {[
            { value: 250, label: '+250 ml', desc: '1 cốc nhỏ' },
            { value: 500, label: '+500 ml', desc: '1 chai tiêu chuẩn' },
            { value: 750, label: '+750 ml', desc: '1 bình thể thao' },
            { value: 1000, label: '+1.000 ml', desc: '1 lít nước' },
          ].map((preset) => (
            <button 
              type="button" 
              key={preset.value} 
              className={amount === preset.value ? 'active' : ''} 
              aria-pressed={amount === preset.value} 
              onClick={() => setAmount(preset.value)}
            >
              <Droplets size={18} />
              <strong>{preset.label}</strong>
              <small>{preset.desc}</small>
            </button>
          ))}
        </div>

        <button type="button" className="nutrition-water-sheet__submit pink-orange-submit" disabled={safeAmount <= 0} onClick={() => onLog(safeAmount)}>
          <Plus size={18} /> Ghi +{formatNumber(safeAmount)} ml nước
        </button>

        {todayEntries.length > 0 && (
          <div className="water-today-entries-po">
            <span className="entries-title-po">Nhật ký nước hôm nay ({todayEntries.length} lần ghi)</span>
            <div className="entries-chips-po">
              {todayEntries.map((entry) => (
                <div key={entry.id} className="entry-chip-po">
                  <span>💧 +{formatNumber(entry.amountMl)} ml ({entry.time})</span>
                  {onRemoveEntry && (
                    <button type="button" onClick={() => onRemoveEntry(entry.id)} aria-label="Xóa lần ghi này" title="Xóa">
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function ExerciseLogSheet({ dateLabel, weightKg, onClose, onSave }: { dateLabel: string; weightKg: number; onClose: () => void; onSave: (activity: NutritionActivityDraft) => void }) {
  const now = new Date()
  const [kind, setKind] = useState<NutritionActivityKind>('strength')
  const [startTime, setStartTime] = useState(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`)
  const [durationMinutes, setDurationMinutes] = useState(30)
  const [intensity, setIntensity] = useState<NutritionActivityIntensity>('moderate')
  const dialogRef = useAccessibleDialog(onClose)
  const option = ACTIVITY_OPTIONS.find((item) => item.value === kind) ?? ACTIVITY_OPTIONS[0]
  const safeDuration = Number.isFinite(durationMinutes) ? Math.min(600, Math.max(0, Math.round(durationMinutes))) : 0
  const met = option.met[intensity]
  const estimatedCalories = Math.round((met * 3.5 * Math.max(30, weightKg) / 200) * safeDuration)
  const intensityHelp: Record<NutritionActivityIntensity, string> = {
    low: 'Có thể nói chuyện bình thường',
    moderate: 'Thở nhanh hơn nhưng vẫn kiểm soát',
    high: 'Khó nói trọn câu khi vận động',
  }

  const submit = () => {
    if (!safeDuration || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) return
    onSave({
      startTime,
      kind,
      title: option.label,
      durationMinutes: safeDuration,
      intensity,
      estimatedCalories,
      met,
      weightKgAtEstimate: weightKg,
    })
  }

  return (
    <div className="nutrition-sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="nutrition-exercise-sheet" role="dialog" aria-modal="true" aria-labelledby="nutrition-exercise-sheet-title" aria-describedby="nutrition-exercise-sheet-description">
        <header><div><span className="nutrition-kicker">VẬN ĐỘNG</span><h2 id="nutrition-exercise-sheet-title">Ghi nhanh buổi tập</h2></div><button type="button" onClick={onClose} aria-label="Đóng bảng ghi luyện tập"><X size={20} /></button></header>
        <p id="nutrition-exercise-sheet-description">Thêm hoạt động cho {dateLabel.toLocaleLowerCase('vi-VN')}. Kcal được ước tính theo cân nặng hiện tại.</p>

        <div className="nutrition-exercise-form">
          <label className="nutrition-exercise-field"><span>Loại hoạt động</span><select data-dialog-autofocus value={kind} onChange={(event) => setKind(event.target.value as NutritionActivityKind)}>{ACTIVITY_OPTIONS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
          <label className="nutrition-exercise-field"><span>Giờ bắt đầu</span><div className="nutrition-exercise-time"><Clock3 size={17} /><input type="time" value={startTime} onInput={(event) => setStartTime(event.currentTarget.value)} /></div></label>
        </div>

        <div className="nutrition-exercise-section">
          <div className="nutrition-exercise-section__heading"><span>Thời lượng</span><small>Tối đa 600 phút</small></div>
          <div className="nutrition-exercise-duration" role="group" aria-label="Chọn thời lượng buổi tập">
            {[15, 30, 45, 60].map((minutes) => <button type="button" key={minutes} className={safeDuration === minutes ? 'active' : ''} aria-pressed={safeDuration === minutes} onClick={() => setDurationMinutes(minutes)}>{minutes} phút</button>)}
            <label><input type="number" inputMode="numeric" min="1" max="600" value={durationMinutes || ''} onChange={(event) => { const next = Number(event.target.value); setDurationMinutes(Number.isFinite(next) ? Math.min(600, Math.max(0, Math.round(next))) : 0) }} /><span>phút</span></label>
          </div>
        </div>

        <div className="nutrition-exercise-section">
          <div className="nutrition-exercise-section__heading"><span>Cường độ</span><small>{intensityHelp[intensity]}</small></div>
          <div className="nutrition-exercise-intensity" role="group" aria-label="Chọn cường độ luyện tập">
            {(['low', 'moderate', 'high'] as NutritionActivityIntensity[]).map((level) => <button type="button" key={level} className={intensity === level ? 'active' : ''} aria-pressed={intensity === level} onClick={() => setIntensity(level)}><span>{ACTIVITY_INTENSITY_LABELS[level]}</span><small>{level === 'low' ? 'Nhẹ nhàng' : level === 'moderate' ? 'Ổn định' : 'Nỗ lực cao'}</small></button>)}
          </div>
        </div>

        <div className="nutrition-exercise-estimate"><span><Activity size={21} /></span><div><small>KCAL ƯỚC TÍNH</small><strong>≈ {formatNumber(estimatedCalories)} kcal</strong><p>{safeDuration} phút · {option.label} · cường độ {ACTIVITY_INTENSITY_LABELS[intensity].toLocaleLowerCase('vi-VN')}</p></div></div>
        <p className="nutrition-exercise-note"><Info size={14} /> Vận động được theo dõi riêng và không tự cộng lại vào ngân sách ăn để tránh tính trùng.</p>
        <button type="button" className="nutrition-exercise-submit" disabled={!safeDuration || !startTime} onClick={submit}><Check size={17} /> Lưu buổi tập</button>
      </section>
    </div>
  )
}

export default function NutritionPageController({ displayName = 'Thành viên Aura', isDemo = false, storageOwnerId, hasProfile = true, profile, onProfileComplete, onStartOnboarding, onMealSaved, onAnalyzeImage, foodCatalog, onOpenEatClean, syncState }: NutritionPageProps) {
  const nutritionV4 = useAuraUiSurface('member-nutrition')
  const resolvedOwnerId = storageOwnerId ?? firebaseAuth?.currentUser?.uid ?? 'anonymous'
  const mealStorageKey = `${MEAL_STORAGE_PREFIX}:${resolvedOwnerId}`
  const waterStorageKey = `${WATER_STORAGE_PREFIX}:${resolvedOwnerId}`
  const waterEntryStorageKey = `${WATER_ENTRY_STORAGE_PREFIX}:${resolvedOwnerId}`
  const savedFoodStorageKey = `${SAVED_FOOD_STORAGE_PREFIX}:${resolvedOwnerId}`
  const activityStorageKey = `${ACTIVITY_STORAGE_PREFIX}:${resolvedOwnerId}`
  const profileIsComplete = isDemo || (hasProfile && hasCompleteNutritionProfile(profile))
  const [profileReady, setProfileReady] = useState(profileIsComplete)
  const [profileDraft, setProfileDraft] = useState<NutritionProfileDraft>(() => normalizeNutritionProfileDraft(profile))
  const [todayKey, setTodayKey] = useState(() => toLocalDateKey(new Date()))
  const recentNutritionFromDate = useMemo(() => {
    const firstDay = new Date()
    firstDay.setHours(0, 0, 0, 0)
    firstDay.setDate(firstDay.getDate() - 89)
    return toLocalDateKey(firstDay)
  }, [todayKey])
  const [selectedDate, setSelectedDate] = useState(todayKey)
  const [planWeekStart, setPlanWeekStart] = useState(() => getCalendarStart(dateFromLocalKey(todayKey)))
  const [planSelectedDay, setPlanSelectedDay] = useState(todayKey)
  const [homeWeekStart, setHomeWeekStart] = useState(() => getCalendarStart())
  const [activeSection, setActiveSection] = useState<NutritionRouteSection>(() => nutritionSectionFromHash())
  const [catalogSavedOnly, setCatalogSavedOnly] = useState(false)
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [waterSheetOpen, setWaterSheetOpen] = useState(false)
  const [exerciseSheetOpen, setExerciseSheetOpen] = useState(false)
  const [selectedFood, setSelectedFood] = useState<NutritionFoodCatalogItem | null>(null)
  const [foodDetailReturnSection, setFoodDetailReturnSection] = useState<'catalog' | 'plan' | 'menu'>('catalog')
  const [pendingFood, setPendingFood] = useState<NutritionFoodCatalogItem | null>(null)
  const [diaryCatalogDefaults, setDiaryCatalogDefaults] = useState<{
    date: string
    type: NutritionMealDraft['mealType']
    time: string
    plannedMealId?: string
    servingMultiplier?: number
  } | null>(null)
  const [planCatalogAction, setPlanCatalogAction] = useState<{
    action: 'add' | 'replace'
    dayId: string
    mealId?: string
    type: NutritionMealDraft['mealType']
    time: string
    servingMultiplier: number
  } | null>(null)
  const [editingMealId, setEditingMealId] = useState<string | null>(null)
  const [selectedLoggedMealId, setSelectedLoggedMealId] = useState<string | null>(null)
  const [catalogSnapshot, setCatalogSnapshot] = useState<NutritionFoodCatalogItem[]>(foodCatalog ?? [])
  const [savedFoodIds, setSavedFoodIds] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(savedFoodStorageKey) ?? '[]') as unknown
      return new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [])
    } catch {
      return new Set()
    }
  })
  const [meals, setMeals] = useState<MealLog[]>(() => isDemo ? loadPersistedMeals(mealStorageKey, createInitialMeals()) : [])
  const [waterByDate, setWaterByDate] = useState<Record<string, number>>(() => isDemo ? loadPersistedWater(waterStorageKey) : {})
  const [activities, setActivities] = useState<NutritionActivityLog[]>(() => isDemo ? loadPersistedActivities(activityStorageKey, createInitialActivities()) : [])
  const [waterEntries, setWaterEntries] = useState<NutritionWaterLog[]>(() => isDemo ? loadPersistedWaterEntries(waterEntryStorageKey) : [])
  const [nutritionLogSyncState, setNutritionLogSyncState] = useState<DataSyncState>({ status: 'synced', revision: 0, cachedAt: null })
  const [nutritionMutation, setNutritionMutation] = useState<{ scope: 'meals' | 'water' | 'activities'; id: string } | null>(null)
  const [historySyncStarted, setHistorySyncStarted] = useState(false)
  const nutritionSyncScopes = useRef<Record<'meals' | 'water' | 'activities', DataSyncState>>({
    meals: { status: 'synced', revision: 0, cachedAt: null },
    water: { status: 'synced', revision: 0, cachedAt: null },
    activities: { status: 'synced', revision: 0, cachedAt: null },
  })
  const [planGenerated, setPlanGenerated] = useState(isDemo)
  const [nutritionPlan, setNutritionPlan] = useState<NutritionPlanRecord | null>(null)
  const [activeNutritionPlan, setActiveNutritionPlan] = useState<NutritionPlanRecord | null>(null)
  const [nutritionPlanLoading, setNutritionPlanLoading] = useState(false)
  const [nutritionPlanSaving, setNutritionPlanSaving] = useState(false)
  const [nutritionPlanGenerating, setNutritionPlanGenerating] = useState(false)
  const [nutritionPlanError, setNutritionPlanError] = useState('')
  const [nutritionPlanReloadToken, setNutritionPlanReloadToken] = useState(0)
  const [assistantReturnSection, setAssistantReturnSection] = useState<NutritionPrimarySection>('today')
  const [taskReturnSection, setTaskReturnSection] = useState<NutritionPrimarySection>('today')
  const assistantImageUrlsRef = useRef(new Set<string>())
  const [toast, setToast] = useState<NutritionToastState | null>(null)
  const messageTimer = useRef<number | null>(null)

  useEffect(() => () => {
    assistantImageUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    assistantImageUrlsRef.current.clear()
  }, [])
  const catalogDetailCache = useRef(new Map<string, NutritionFoodDetailRecord>())
  const updateNutritionSync = useCallback((scope: 'meals' | 'water' | 'activities', next: DataSyncState) => {
    nutritionSyncScopes.current[scope] = next
    const priority: Record<DataSyncState['status'], number> = {
      conflict: 6,
      'sync-failed': 5,
      'offline-readonly': 4,
      'stale-cache': 3,
      'pending-local-change': 2,
      synced: 1,
    }
    const combined = Object.values(nutritionSyncScopes.current).sort((left, right) => priority[right.status] - priority[left.status])[0]
    setNutritionLogSyncState(combined)
  }, [])
  const days = useMemo(() => getWeekDays(homeWeekStart, todayKey), [homeWeekStart, todayKey])
  const planDays = useMemo(() => getWeekDays(planWeekStart, todayKey), [planWeekStart, todayKey])
  const loggedDateIds = useMemo(() => new Set([
    ...meals.filter((meal) => meal.status === 'logged').map((meal) => meal.date),
    ...activities.map((activity) => activity.date),
    ...Object.entries(waterByDate).filter(([_, amount]) => amount > 0).map(([date]) => date),
  ]), [activities, meals, waterByDate])
  const firstName = displayName.trim().split(/\s+/).slice(-1)[0] || 'bạn'

  // Get actual weight in the last 30 days based on weight history of this user
  const actual30DayWeight = useNutritionWeight(resolvedOwnerId, profileDraft.weightKg, !isDemo)

  const nutritionTargets = resolveDailyNutritionTargets(profileDraft, actual30DayWeight)
  const { calorieGoal, proteinGoal, carbGoal, fatGoal, waterGoal } = nutritionTargets
  const targetSnapshot = nutritionTargets.configured ? { formulaVersion: NUTRITION_FORMULA_VERSION, calories: calorieGoal, protein: proteinGoal, carbs: carbGoal, fat: fatGoal, tdee: nutritionTargets.maintenanceCalories, waterMl: waterGoal, capturedAt: new Date().toISOString() } : undefined
  const dailyPlan = getDailyPlan(calorieGoal, profileDraft)
  const selectedDayMeals = meals.filter((meal) => meal.date === selectedDate)
  const loggedMeals = selectedDayMeals.filter((meal) => meal.status === 'logged')
  const selectedDayActivities = activities.filter((activity) => activity.date === selectedDate)
  const activityCalories = selectedDayActivities.reduce((sum, activity) => sum + activity.estimatedCalories, 0)
  const activityMinutes = selectedDayActivities.reduce((sum, activity) => sum + activity.durationMinutes, 0)
  const caloriesConsumed = loggedMeals.reduce((sum, meal) => sum + meal.calories, 0)
  const proteinConsumed = Math.round(loggedMeals.reduce((sum, meal) => sum + meal.protein, 0))
  const carbsConsumed = Math.round(loggedMeals.reduce((sum, meal) => sum + meal.carbs, 0))
  const fatConsumed = Math.round(loggedMeals.reduce((sum, meal) => sum + meal.fat, 0))
  // Do not manufacture micronutrients from calories/carbs. Missing source
  // values remain incomplete and are explained in the UI instead of being
  // presented as measured intake.
  const fiberConsumed = Math.round(loggedMeals.reduce((sum, meal) => sum + (meal.fiber ?? 0), 0))
  const sugarConsumed = Math.round(loggedMeals.reduce((sum, meal) => sum + (meal.sugar ?? 0), 0))
  const sodiumConsumed = Math.round(loggedMeals.reduce((sum, meal) => sum + (meal.sodium ?? 0), 0))
  const hasVerifiedNutrient = (meal: MealLog, nutrient: 'fiber' | 'sugar' | 'sodium') => {
    if (typeof meal[nutrient] !== 'number' || !Number.isFinite(meal[nutrient])) return false
    const source = meal.nutrientSources?.[nutrient]
    if (source) return source === 'catalog' || source === 'manual' || source === 'user-confirmed'
    return meal.source === 'catalog' || meal.source === 'manual'
  }
  const fiberDataComplete = loggedMeals.length > 0 && loggedMeals.every((meal) => hasVerifiedNutrient(meal, 'fiber'))
  const sugarDataComplete = loggedMeals.length > 0 && loggedMeals.every((meal) => hasVerifiedNutrient(meal, 'sugar'))
  const sodiumDataComplete = loggedMeals.length > 0 && loggedMeals.every((meal) => hasVerifiedNutrient(meal, 'sodium'))
  const water = waterByDate[selectedDate] ?? 0
  const caloriePercent = calorieGoal > 0
    ? Math.min(100, Math.max(0, Math.round((caloriesConsumed / calorieGoal) * 100)))
    : 0
  const qualityMetrics = [
    { label: 'Chất xơ', value: fiberConsumed, goal: 25, unit: 'g', tone: 'fiber', inverse: false, complete: fiberDataComplete },
    // Total sugar is not free sugar; do not score it against the WHO free-sugar limit.

    { label: 'Natri', value: sodiumConsumed, goal: 2000, unit: 'mg', tone: 'sodium', inverse: true, complete: sodiumDataComplete },
  ]
  const assistantSuggestions = !nutritionTargets.configured
    ? ['Tôi cần bổ sung gì để thiết lập mục tiêu?', 'Cách cập nhật hồ sơ dinh dưỡng?', 'Phân tích các bữa tôi đã ghi']
    : loggedMeals.length
    ? [
        'Bữa tiếp theo nên ăn gì?',
        proteinConsumed < proteinGoal ? 'Tôi còn thiếu bao nhiêu đạm?' : 'Lượng đạm của tôi đã vượt chưa?',
        water < waterGoal ? 'Tôi cần uống thêm bao nhiêu nước?' : 'Lượng nước ngày này ổn chưa?',
        !fiberDataComplete ? 'Dữ liệu chất xơ của tôi đã đủ chưa?' : 'Tôi còn thiếu bao nhiêu chất xơ?',
      ]
    : ['Tôi nên bắt đầu ghi bữa như thế nào?', 'Mục tiêu năng lượng ngày này là gì?', 'Tôi cần uống thêm bao nhiêu nước?']
  const selectedDateLabel = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' }).format(dateFromLocalKey(selectedDate))
  const { assistantMessages, assistantLoading, submitAssistantQuestion } = useNutritionAssistantController({
    resetKey: selectedDate,
    profileDraft,
    selectedDateLabel,
    loggedMeals,
    selectedDayActivities,
    calorieGoal,
    proteinGoal,
    carbGoal,
    fatGoal,
    waterGoal,
    caloriesConsumed,
    proteinConsumed,
    carbsConsumed,
    fatConsumed,
    fiberConsumed,
    sugarConsumed,
    sodiumConsumed,
    water,
    activityMinutes,
    activityCalories,
    fiberDataComplete,
    sugarDataComplete,
    sodiumDataComplete,
    nutritionTargetsConfigured: nutritionTargets.configured,
    catalogSnapshot,
    setCatalogSnapshot,
  })
  const workspaceSection = !nutritionV4 && activeSection === 'explore' ? 'today' : toWorkspaceSection(activeSection)
  const workspaceDiaryMeals: NutritionMealEntry[] = loggedMeals.map((meal) => ({
    id: meal.id,
    time: meal.time,
    type: meal.type,
    label: meal.label,
    title: meal.title,
    description: meal.calorieRange
      ? `${meal.description} · khoảng ${formatNumber(meal.calorieRange.low)}–${formatNumber(meal.calorieRange.high)} kcal`
      : meal.description,
    calories: meal.calories,
    protein: meal.protein,
    carbs: meal.carbs,
    fat: meal.fat,
    image: meal.image,
    confidence: meal.confidence ?? (meal.source === 'ai-scan' ? 'estimated' : 'verified'),
    sourceLabel: meal.source === 'ai-scan' ? 'Aura Vision + dữ liệu dinh dưỡng' : meal.source === 'catalog' ? 'Thư viện dinh dưỡng Aura' : meal.source === 'manual' ? 'Học viên nhập tay' : undefined,
    reviewStatus: meal.reviewStatus,
    cookingNote: meal.cookingNote,
    portionNote: meal.portionNote,
    coachFeedback: meal.coachFeedback,
  }))
  const diaryDaySummaries = useMemo<NutritionDiaryDaySummary[]>(() => {
    const summaries = new Map<string, NutritionDiaryDaySummary>()
    const read = (date: string) => {
      const existing = summaries.get(date)
      if (existing) return existing
      const created = { date, mealCount: 0, calories: 0, protein: 0, waterMl: 0, activityCount: 0, reviewCount: 0 }
      summaries.set(date, created)
      return created
    }
    meals.filter((meal) => meal.status === 'logged').forEach((meal) => {
      const summary = read(meal.date)
      summary.mealCount += 1
      summary.calories += Math.max(0, Number(meal.calories) || 0)
      summary.protein += Math.max(0, Number(meal.protein) || 0)
      const confidence = meal.confidence ?? (meal.source === 'ai-scan' ? 'estimated' : 'verified')
      if (meal.reviewStatus === 'pending' || confidence !== 'verified') summary.reviewCount += 1
    })
    activities.forEach((activity) => { read(activity.date).activityCount += 1 })
    Object.entries(waterByDate).forEach(([date, amount]) => { read(date).waterMl = Math.max(0, Number(amount) || 0) })
    return [...summaries.values()].sort((left, right) => right.date.localeCompare(left.date))
  }, [activities, meals, waterByDate])
  const workspacePlanDays: NutritionPlanDay[] = planDays.map((day) => ({
    id: day.id,
    weekday: day.day,
    date: day.date,
    label: day.isToday ? 'Hôm nay' : undefined,
    isToday: day.isToday,
  }))
  const cloudPlannedMeals: NutritionPlannedMeal[] = nutritionPlan?.days.flatMap((day) => day.meals.map((meal) => ({
    id: meal.id,
    catalogId: meal.catalogId,
    dayId: meal.dayId || day.id,
    time: meal.time,
    type: meal.type,
    label: meal.type === 'breakfast' ? 'Bữa sáng' : meal.type === 'lunch' ? 'Bữa trưa' : meal.type === 'dinner' ? 'Bữa tối' : 'Bữa phụ',
    title: meal.title,
    description: meal.description || `${formatNumber(meal.calories)} kcal · ${formatNumber(meal.protein)}g đạm`,
    calories: meal.calories,
    protein: meal.protein,
    carbs: meal.carbs,
    fat: meal.fat,
    image: meal.image,
    rationale: meal.rationale,
    source: meal.source,
    servingMultiplier: meal.servingMultiplier,
  }))) ?? []
  const activePlannedMeals: NutritionPlannedMeal[] = activeNutritionPlan?.days.flatMap((day) => day.meals.map((meal) => ({
    id: meal.id,
    catalogId: meal.catalogId,
    dayId: meal.dayId || day.id,
    time: meal.time,
    type: meal.type,
    label: meal.type === 'breakfast' ? 'Bữa sáng' : meal.type === 'lunch' ? 'Bữa trưa' : meal.type === 'dinner' ? 'Bữa tối' : 'Bữa phụ',
    title: meal.title,
    description: meal.description || `${formatNumber(meal.calories)} kcal · ${formatNumber(meal.protein)}g đạm`,
    calories: meal.calories,
    protein: meal.protein,
    carbs: meal.carbs,
    fat: meal.fat,
    image: meal.image,
    rationale: meal.rationale,
    source: meal.source,
    servingMultiplier: meal.servingMultiplier,
  }))) ?? []
  const demoPlannedMeals: NutritionPlannedMeal[] = planGenerated ? workspacePlanDays.flatMap((day) => dailyPlan.map((meal, index) => ({
    id: `${day.id}-plan-${index}`,
    dayId: day.id,
    time: meal.time,
    type: index === 0 ? 'breakfast' : index === dailyPlan.length - 1 ? 'dinner' : dailyPlan.length === 2 ? 'lunch' : 'snack',
    label: meal.label,
    title: meal.title,
    description: `${formatNumber(meal.calories)} kcal · khoảng ${formatNumber(meal.protein)}g đạm`,
    calories: meal.calories,
    protein: meal.protein,
    prepMinutes: profileDraft.prepTime === 'quick' ? 10 : profileDraft.prepTime === 'long' ? 45 : 20,
    rationale: index === 0 ? 'Ưu tiên năng lượng ổn định đầu ngày' : index === dailyPlan.length - 1 ? 'Bù phần macro còn thiếu trong ngày' : 'Phân bổ theo mục tiêu cá nhân',
  }))) : []
  const workspacePlannedMeals = nutritionPlan ? cloudPlannedMeals : isDemo ? demoPlannedMeals : []
  const workspaceMenuMeals = activeNutritionPlan ? activePlannedMeals : isDemo ? demoPlannedMeals : []
  const loggedPlanMealKeys = useMemo(() => new Set(meals.filter((meal) => meal.status === 'logged').flatMap((meal) => [
    meal.plannedMealId ? `${meal.date}|${meal.plannedMealId}` : '',
    `${meal.date}|${meal.catalogId || meal.title.trim().toLocaleLowerCase('vi-VN')}`,
  ].filter(Boolean))), [meals])
  const selectedFoodSummary = useMemo(() => selectedFood ? toFoodDetailSummary(selectedFood) : null, [selectedFood])
  const relatedFoodSummaries = useMemo(() => {
    if (!selectedFood) return []
    const category = selectedFood.category?.nameVi
    return catalogSnapshot
      .filter((item) => item.id !== selectedFood.id && (!category || item.category?.nameVi === category))
      .sort((left, right) => Math.abs((left.calories ?? 0) - (selectedFood.calories ?? 0)) - Math.abs((right.calories ?? 0) - (selectedFood.calories ?? 0)))
      .slice(0, 4)
      .map(toFoodDetailSummary)
  }, [catalogSnapshot, selectedFood])

  useEffect(() => () => {
    if (messageTimer.current) window.clearTimeout(messageTimer.current)
  }, [])

  useEffect(() => {
    try {
      const previousOwnerId = window.sessionStorage.getItem(SCAN_REVIEW_ACTIVE_OWNER_KEY)
      if (previousOwnerId && previousOwnerId !== resolvedOwnerId) clearPendingScanReview(previousOwnerId)
      window.sessionStorage.setItem(SCAN_REVIEW_ACTIVE_OWNER_KEY, resolvedOwnerId)
    } catch {
      // Owner validation in the scoped review payload remains the fallback.
    }
  }, [resolvedOwnerId])

  useEffect(() => {
    const timer = window.setInterval(() => setTodayKey(toLocalDateKey(new Date())), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (isDemo || resolvedOwnerId === 'anonymous' || historySyncStarted) return
    const needsHistory = activeSection === 'diary' || activeSection === 'classic-diary' || activeSection === 'plan' || activeSection === 'menu' || activeSection === 'insights' || activeSection === 'assistant'
    if (needsHistory) {
      setHistorySyncStarted(true)
    }
  }, [activeSection, historySyncStarted, isDemo, resolvedOwnerId])

  useEffect(() => {
    if ((activeSection !== 'plan' && activeSection !== 'menu') || isDemo || resolvedOwnerId === 'anonymous') return
    let active = true
    setNutritionPlanLoading(true)
    setNutritionPlanError('')
    void getMyNutritionPlanWorkspace(planWeekStart).then((workspace) => {
      if (!active) return
      setNutritionPlan(workspace.plan)
      setActiveNutritionPlan(workspace.activePlan ?? (workspace.plan?.status === 'active' ? workspace.plan : null))
    }).catch((error) => {
      if (!active) return
      setNutritionPlan(null)
      setActiveNutritionPlan(null)
      setNutritionPlanError(nutritionPlanErrorMessage(error))
    }).finally(() => {
      if (active) setNutritionPlanLoading(false)
    })
    return () => { active = false }
  }, [activeSection, isDemo, nutritionPlanReloadToken, planWeekStart, resolvedOwnerId])

  useEffect(() => {
    if ((activeSection !== 'diary' && activeSection !== 'classic-diary') || selectedDate <= todayKey) return
    setHomeWeekStart(getCalendarStart(dateFromLocalKey(todayKey)))
    setSelectedDate(todayKey)
  }, [activeSection, selectedDate, todayKey])

  useEffect(() => {
    if (!planDays.some((day) => day.id === planSelectedDay)) {
      setPlanSelectedDay(planDays.find((day) => day.isToday)?.id ?? planDays[0]?.id ?? planWeekStart)
    }
  }, [planDays, planSelectedDay, planWeekStart])

  useEffect(() => {
    if (!firestoreDb || resolvedOwnerId === 'anonymous' || !historySyncStarted) return
    let active = true
    void Promise.all([
      loadRecentUserMealLogs(resolvedOwnerId, recentNutritionFromDate, (state) => updateNutritionSync('meals', state)),
      loadRecentUserWaterLogs(resolvedOwnerId, recentNutritionFromDate, (state) => updateNutritionSync('water', state)),
      loadRecentUserActivityLogs(resolvedOwnerId, recentNutritionFromDate, (state) => updateNutritionSync('activities', state)),
    ]).then(([remoteMeals, remoteWater, remoteActivities]) => {
      if (!active) return
      const recentMeals = Array.isArray(remoteMeals) ? remoteMeals.filter((item): item is MealLog => Boolean(item && typeof item === 'object' && item.id)) : []
      const recentWater = Array.isArray(remoteWater) ? remoteWater.filter((item): item is NutritionWaterLog => Boolean(item && typeof item === 'object' && item.id)) : []
      const recentActivities = Array.isArray(remoteActivities) ? remoteActivities.filter((item): item is NutritionActivityLog => Boolean(item && typeof item === 'object' && item.id)) : []
      setMeals((current) => [...recentMeals, ...current.filter((item) => item.date < recentNutritionFromDate)])
      setWaterEntries((current) => [...recentWater, ...current.filter((item) => item.date < recentNutritionFromDate)])
      const recentTotals = recentWater.reduce<Record<string, number>>((result, entry) => {
        result[entry.date] = (result[entry.date] ?? 0) + Math.max(0, Number(entry.amountMl) || 0)
        return result
      }, {})
      setWaterByDate((current) => ({
        ...Object.fromEntries(Object.entries(current).filter(([date]) => date < recentNutritionFromDate)),
        ...recentTotals,
      }))
      setActivities((current) => [...recentActivities, ...current.filter((item) => item.date < recentNutritionFromDate)])
    }).catch((error) => {
      if (active) console.error('Error loading nutrition history:', error)
    })
    return () => { active = false }
  }, [historySyncStarted, recentNutritionFromDate, resolvedOwnerId, updateNutritionSync])

  useEffect(() => {
    const coveredByRecentSubscription = historySyncStarted && selectedDate >= recentNutritionFromDate
    if (!firestoreDb || resolvedOwnerId === 'anonymous' || coveredByRecentSubscription) return

    const unsubscribeMeals = subscribeToUserMealLogsForDate(resolvedOwnerId, selectedDate, (remoteMeals) => {
      const dayItems = Array.isArray(remoteMeals) ? remoteMeals.filter((item): item is MealLog => Boolean(item && typeof item === 'object' && item.id)) : []
      setMeals((current) => [...current.filter((item) => item.date !== selectedDate), ...dayItems])
    })
    const unsubscribeWater = subscribeToUserWaterLogsForDate(resolvedOwnerId, selectedDate, (remoteWater) => {
      const dayItems = Array.isArray(remoteWater) ? remoteWater.filter((item): item is NutritionWaterLog => Boolean(item && typeof item === 'object' && item.id)) : []
      setWaterEntries((current) => [...current.filter((item) => item.date !== selectedDate), ...dayItems])
      setWaterByDate((current) => ({
        ...current,
        [selectedDate]: dayItems.reduce((sum, item) => sum + Math.max(0, Number(item.amountMl) || 0), 0),
      }))
    })
    const unsubscribeActivities = subscribeToUserActivityLogsForDate(resolvedOwnerId, selectedDate, (remoteActivities) => {
      const dayItems = Array.isArray(remoteActivities) ? remoteActivities.filter((item): item is NutritionActivityLog => Boolean(item && typeof item === 'object' && item.id)) : []
      setActivities((current) => [...current.filter((item) => item.date !== selectedDate), ...dayItems])
    })

    return () => {
      unsubscribeMeals()
      unsubscribeWater()
      unsubscribeActivities()
    }
  }, [historySyncStarted, recentNutritionFromDate, resolvedOwnerId, selectedDate])

  useEffect(() => {
    if (!isDemo) return
    try {
      // Keep full meal objects including images in local storage
      window.localStorage.setItem(mealStorageKey, JSON.stringify(meals))
    } catch {
      try {
        // Fallback for quota limits: trim oversized base64 images if local storage exceeds quota
        const persistableMeals = meals.map((meal) => ({
          ...meal,
          image: meal.image?.length && meal.image.length > 250000 ? undefined : meal.image,
        }))
        window.localStorage.setItem(mealStorageKey, JSON.stringify(persistableMeals))
      } catch {
        // Fallback for restricted storage environments
      }
    }
  }, [isDemo, mealStorageKey, meals])

  useEffect(() => {
    if (!isDemo) return
    try {
      window.localStorage.setItem(waterStorageKey, JSON.stringify(waterByDate))
    } catch {
      // Keep the current session usable if browser storage is unavailable.
    }
  }, [isDemo, waterByDate, waterStorageKey])

  useEffect(() => {
    if (!isDemo) return
    try {
      window.localStorage.setItem(waterEntryStorageKey, JSON.stringify(waterEntries))
    } catch {
      // Keep the current session usable if browser storage is unavailable.
    }
  }, [isDemo, waterEntries, waterEntryStorageKey])

  useEffect(() => {
    if (!isDemo) return
    try {
      window.localStorage.setItem(activityStorageKey, JSON.stringify(activities))
    } catch {
      // Keep the current session usable if browser storage is unavailable.
    }
  }, [activities, activityStorageKey, isDemo])

  useEffect(() => {
    setProfileReady(profileIsComplete)
  }, [profileIsComplete])

  useEffect(() => {
    if (profile) setProfileDraft(normalizeNutritionProfileDraft(profile))
  }, [profile])

  useEffect(() => {
    setQuickAddOpen(false)
    setWaterSheetOpen(false)
    setExerciseSheetOpen(false)
    setPendingFood(null)
    setDiaryCatalogDefaults(null)
    setEditingMealId(null)
    setSelectedLoggedMealId(null)
  }, [activeSection])

  useEffect(() => {
    let active = true
    const syncFoodDetail = () => {
      const section = nutritionSectionFromHash()
      setActiveSection(section)
      
      const queryStr = window.location.hash.split('?')[1] ?? ''
      const params = new URLSearchParams(queryStr)
      if (params.get('action') === 'water') {
        setWaterSheetOpen(true)
      }

      const foodId = nutritionFoodIdFromHash()
      if (!foodId) {
        setSelectedFood(null)
        return
      }
      const suppliedItems = foodCatalog?.length ? foodCatalog : null
      const knownItem = suppliedItems?.find((item) => item.id === foodId)
      if (knownItem && suppliedItems) {
        setCatalogSnapshot(suppliedItems)
        setSelectedFood(knownItem)
        return
      }
      void loadNutritionCatalog({ ids: [foodId] }).then((items) => {
        if (!active) return
        setCatalogSnapshot(items)
        setSelectedFood(items.find((item) => item.id === foodId) ?? null)
      }).catch(() => {
        if (active) setSelectedFood(null)
      })
    }
    syncFoodDetail()
    window.addEventListener('hashchange', syncFoodDetail)
    window.addEventListener('popstate', syncFoodDetail)
    return () => {
      active = false
      window.removeEventListener('hashchange', syncFoodDetail)
      window.removeEventListener('popstate', syncFoodDetail)
    }
  }, [foodCatalog])

  const showMessage = (text: string, action?: NutritionToastState['action']) => {
    setToast({ text, action })
    if (messageTimer.current) window.clearTimeout(messageTimer.current)
    messageTimer.current = window.setTimeout(() => setToast(null), action ? 5000 : 2800)
  }

  const navigateNutrition = (section: NutritionRouteSection) => {
    const nextHash = nutritionSectionHash(section, nutritionV4)
    setSelectedFood(null)
    if (section !== 'catalog') setPlanCatalogAction(null)
    setActiveSection(section)
    if (window.location.hash !== nextHash) window.location.hash = nextHash
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const openCatalog = (savedOnly = false) => {
    setCatalogSavedOnly(savedOnly)
    navigateNutrition('catalog')
  }

  const openScan = () => {
    if (activeSection === 'today' || activeSection === 'diary' || activeSection === 'classic-diary' || activeSection === 'plan' || activeSection === 'menu' || activeSection === 'explore' || activeSection === 'catalog' || activeSection === 'insights') {
      setTaskReturnSection(activeSection)
    }
    navigateNutrition('scan')
  }

  const closeScan = () => navigateNutrition(taskReturnSection)
  const closeCatalog = () => {
    if (planCatalogAction) {
      setPlanCatalogAction(null)
      navigateNutrition('plan')
      return
    }
    navigateNutrition(nutritionV4 ? 'explore' : 'today')
  }

  const openAssistant = () => {
    if (activeSection === 'today' || activeSection === 'diary' || activeSection === 'classic-diary' || activeSection === 'plan' || activeSection === 'menu' || activeSection === 'explore' || activeSection === 'catalog' || activeSection === 'insights') {
      setAssistantReturnSection(activeSection)
    }
    navigateNutrition('assistant')
  }

  const closeAssistant = () => navigateNutrition(assistantReturnSection)

  const reloadNutritionPlan = () => setNutritionPlanReloadToken((current) => current + 1)

  const shiftPlanWeek = (direction: -1 | 1) => {
    const nextStart = dateFromLocalKey(planWeekStart)
    nextStart.setDate(nextStart.getDate() + direction * 7)
    const nextWeekStart = toLocalDateKey(nextStart)
    setPlanCatalogAction(null)
    setNutritionPlan(null)
    setActiveNutritionPlan(null)
    setPlanWeekStart(nextWeekStart)
    setPlanSelectedDay(nextWeekStart)
  }

  const generateNutritionPlan = async () => {
    if (isDemo) {
      setPlanGenerated(true)
      showMessage('Đã tạo thực đơn minh họa 7 ngày')
      return
    }
    setNutritionPlanGenerating(true)
    setNutritionPlanError('')
    try {
      const plan = await generateMyNutritionPlanDraft({
        weekStart: planWeekStart,
        expectedRevision: nutritionPlan?.source === 'aura-catalog' ? nutritionPlan.revision : 0,
        calorieGoal,
        proteinGoal,
        mealsPerDay: Math.min(5, Math.max(3, profileDraft.mealsPerDay || 3)),
        goal: profileDraft.goal,
        allergies: profileDraft.allergies,
        dislikes: profileDraft.dislikes,
        aiAssist: true,
        profile: {
          age: profileDraft.age,
          biologicalSex: profileDraft.biologicalSex,
          activityLevel: profileDraft.activityLevel,
          trainingSessions: profileDraft.trainingSessions,
          eatingStyle: profileDraft.eatingStyle,
          favoriteCuisine: profileDraft.favoriteCuisine,
          budget: profileDraft.budget,
          prepTime: profileDraft.prepTime,
        },
      })
      setNutritionPlan(plan)
      setPlanSelectedDay(plan.days.find((day) => day.id === todayKey)?.id ?? plan.days[0]?.id ?? planWeekStart)
      showMessage(plan.planner === 'gemini' ? 'Gemini đã hỗ trợ tạo kế hoạch theo hồ sơ của bạn' : 'Đã tạo bản nháp từ thư viện món Aura')
    } catch (error) {
      const message = nutritionPlanErrorMessage(error)
      setNutritionPlanError(message)
      if (String((error as { code?: unknown })?.code ?? '').endsWith('aborted')) reloadNutritionPlan()
    } finally {
      setNutritionPlanGenerating(false)
    }
  }

  const confirmNutritionPlan = async () => {
    if (!nutritionPlan || nutritionPlan.source !== 'aura-catalog') return
    setNutritionPlanSaving(true)
    setNutritionPlanError('')
    try {
      const result = await confirmMyNutritionPlan(planWeekStart, nutritionPlan.revision)
      setNutritionPlan(result.plan)
      setActiveNutritionPlan(result.activePlan)
      showMessage('Đã xác nhận thực đơn tuần')
    } catch (error) {
      const message = nutritionPlanErrorMessage(error)
      setNutritionPlanError(message)
      showMessage(message)
      if (String((error as { code?: unknown })?.code ?? '').endsWith('aborted')) reloadNutritionPlan()
    } finally {
      setNutritionPlanSaving(false)
    }
  }

  const openPlanCatalog = (action: 'add' | 'replace', dayId: string, meal?: NutritionPlanMeal) => {
    if (!nutritionPlan || nutritionPlan.source !== 'aura-catalog') {
      showMessage('Hãy tạo bản nháp riêng trước khi chọn món từ thư viện')
      return
    }
    setPlanCatalogAction({
      action,
      dayId,
      mealId: meal?.id,
      type: meal?.type ?? 'lunch',
      time: meal?.time ?? '12:00',
      servingMultiplier: 1,
    })
    openCatalog(false)
  }

  const removeNutritionPlanMeal = async (mealId: string) => {
    if (!nutritionPlan || nutritionPlan.source !== 'aura-catalog') return
    const meal = nutritionPlan.days.flatMap((day) => day.meals).find((candidate) => candidate.id === mealId)
    if (!meal || !window.confirm(`Xóa ${meal.title} khỏi thực đơn ${meal.dayId}?`)) return
    setNutritionPlanSaving(true)
    setNutritionPlanError('')
    try {
      const plan = await mutateMyNutritionPlanMeal({
        action: 'remove',
        weekStart: planWeekStart,
        dayId: meal.dayId,
        mealId: meal.id,
        type: meal.type,
        time: meal.time,
        expectedRevision: nutritionPlan.revision,
      })
      setNutritionPlan(plan)
      showMessage(`Đã xóa ${meal.title}`)
    } catch (error) {
      const message = nutritionPlanErrorMessage(error)
      setNutritionPlanError(message)
      showMessage(message)
      if (String((error as { code?: unknown })?.code ?? '').endsWith('aborted')) reloadNutritionPlan()
    } finally {
      setNutritionPlanSaving(false)
    }
  }


  const selectDiaryDate = (nextDateKey: string) => {
    if (nextDateKey < recentNutritionFromDate || nextDateKey > todayKey) return
    const nextDate = dateFromLocalKey(nextDateKey)
    setHomeWeekStart(getCalendarStart(nextDate))
    setSelectedDate(nextDateKey)
  }

  const selectTodayInDiary = () => selectDiaryDate(todayKey)

  const shiftHomeWeek = (direction: -1 | 1) => {
    const nextStart = dateFromLocalKey(homeWeekStart)
    nextStart.setDate(nextStart.getDate() + direction * 7)
    const nextSelectedDate = dateFromLocalKey(selectedDate)
    nextSelectedDate.setDate(nextSelectedDate.getDate() + direction * 7)
    setHomeWeekStart(toLocalDateKey(nextStart))
    setSelectedDate(toLocalDateKey(nextSelectedDate))
  }

  const logWater = async (amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) return
    const date = selectedDate
    const previous = waterByDate[date] ?? 0
    const next = Math.min(10000, previous + Math.round(amount))
    const loggedAmount = next - previous
    if (loggedAmount <= 0) {
      showMessage('Bạn đã đạt giới hạn ghi nước 10.000 ml trong ngày')
      return
    }
    const entry: NutritionWaterLog = {
      id: `water-${Date.now()}`,
      date,
      time: new Date().toTimeString().slice(0, 5),
      amountMl: loggedAmount,
      createdAt: Date.now(),
    }
    setWaterByDate((current) => ({ ...current, [date]: next }))
    setWaterEntries((current) => [entry, ...current])
    beginNutritionMutation('water', entry.id)
    try {
      if (isCloudLogEnabled) await saveUserWaterLog(resolvedOwnerId, entry as any)
      completeNutritionMutation('water')
    } catch (error) {
      setWaterByDate((current) => ({ ...current, [date]: previous }))
      setWaterEntries((current) => current.filter((item) => item.id !== entry.id))
      failNutritionMutation('water', error)
      showMessage('Không thể lưu lượng nước. Dữ liệu đã được hoàn tác, hãy thử lại.')
      return
    }
    setWaterSheetOpen(false)
    showMessage(`Đã thêm ${formatNumber(loggedAmount)} ml nước vào ${selectedDateLabel.toLocaleLowerCase('vi-VN')}`, {
      label: 'Hoàn tác',
      onClick: () => { void (async () => {
        setWaterByDate((current) => ({ ...current, [date]: previous }))
        setWaterEntries((current) => current.filter((item) => item.id !== entry.id))
        beginNutritionMutation('water', entry.id)
        try {
          if (isCloudLogEnabled) await deleteUserWaterLog(resolvedOwnerId, entry.id)
          completeNutritionMutation('water')
        } catch (error) {
          setWaterByDate((current) => ({ ...current, [date]: next }))
          setWaterEntries((current) => [entry, ...current])
          failNutritionMutation('water', error)
          showMessage('Không thể hoàn tác lượng nước vì máy chủ chưa xác nhận.')
          return
        }
        showMessage('Đã hoàn tác lần ghi nước')
      })() },
    })
  }

  const deleteWaterEntry = async (entryId: string) => {
    const deletedEntry = waterEntries.find((entry) => entry.id === entryId)
    if (!deletedEntry) return
    const removeLocalEntry = () => {
      setWaterEntries((current) => current.filter((entry) => entry.id !== entryId))
      setWaterByDate((current) => ({
        ...current,
        [deletedEntry.date]: Math.max(0, (current[deletedEntry.date] ?? 0) - deletedEntry.amountMl),
      }))
    }
    const restoreLocalEntry = () => {
      setWaterEntries((current) => current.some((entry) => entry.id === entryId) ? current : [deletedEntry, ...current])
      setWaterByDate((current) => ({
        ...current,
        [deletedEntry.date]: Math.min(10000, (current[deletedEntry.date] ?? 0) + deletedEntry.amountMl),
      }))
    }
    removeLocalEntry()
    beginNutritionMutation('water', entryId)
    try {
      if (isCloudLogEnabled) await deleteUserWaterLog(resolvedOwnerId, entryId)
      completeNutritionMutation('water')
    } catch (error) {
      restoreLocalEntry()
      failNutritionMutation('water', error)
      showMessage('Không thể xóa lần ghi nước. Dữ liệu đã được giữ lại.')
      return
    }
    showMessage(`Đã xóa ${formatNumber(deletedEntry.amountMl)} ml nước`, {
      label: 'Hoàn tác',
      onClick: () => { void (async () => {
        restoreLocalEntry()
        beginNutritionMutation('water', entryId)
        try {
          if (isCloudLogEnabled) await saveUserWaterLog(resolvedOwnerId, deletedEntry as any)
          completeNutritionMutation('water')
        } catch (error) {
          removeLocalEntry()
          failNutritionMutation('water', error)
          showMessage('Không thể khôi phục lần ghi nước vì máy chủ chưa xác nhận.')
          return
        }
        showMessage('Đã khôi phục lần ghi nước')
      })() },
    })
  }

  const saveActivity = async (draft: NutritionActivityDraft) => {
    const activity: NutritionActivityLog = {
      ...draft,
      id: `activity-${Date.now()}`,
      date: selectedDate,
      source: 'manual',
      createdAt: Date.now(),
    }
    setActivities((current) => [activity, ...current])
    beginNutritionMutation('activities', activity.id)
    try {
      if (isCloudLogEnabled) await saveUserActivityLog(resolvedOwnerId, activity as any)
      completeNutritionMutation('activities')
    } catch (error) {
      setActivities((current) => current.filter((item) => item.id !== activity.id))
      failNutritionMutation('activities', error)
      showMessage('Không thể lưu buổi vận động. Dữ liệu đã được hoàn tác, hãy thử lại.')
      return
    }
    setExerciseSheetOpen(false)
    showMessage(`Đã ghi ${activity.title} · ${activity.durationMinutes} phút`, {
      label: 'Hoàn tác',
      onClick: () => { void (async () => {
        setActivities((current) => current.filter((item) => item.id !== activity.id))
        beginNutritionMutation('activities', activity.id)
        try {
          if (isCloudLogEnabled) await deleteUserActivityLog(resolvedOwnerId, activity.id)
          completeNutritionMutation('activities')
        } catch (error) {
          setActivities((current) => [activity, ...current])
          failNutritionMutation('activities', error)
          showMessage('Không thể hoàn tác buổi vận động vì máy chủ chưa xác nhận.')
          return
        }
        showMessage('Đã hoàn tác buổi tập')
      })() },
    })
  }

  const deleteActivity = async (activityId: string) => {
    const deletedActivity = activities.find((activity) => activity.id === activityId)
    if (!deletedActivity) return
    setActivities((current) => current.filter((activity) => activity.id !== activityId))
    beginNutritionMutation('activities', activityId)
    try {
      if (isCloudLogEnabled) await deleteUserActivityLog(resolvedOwnerId, activityId)
      completeNutritionMutation('activities')
    } catch (error) {
      setActivities((current) => [deletedActivity, ...current])
      failNutritionMutation('activities', error)
      showMessage('Không thể xóa buổi vận động. Dữ liệu đã được giữ lại.')
      return
    }
    showMessage(`Đã xóa ${deletedActivity.title}`, {
      label: 'Hoàn tác',
      onClick: () => { void (async () => {
        setActivities((current) => current.some((activity) => activity.id === deletedActivity.id) ? current : [deletedActivity, ...current])
        beginNutritionMutation('activities', deletedActivity.id)
        try {
          if (isCloudLogEnabled) await saveUserActivityLog(resolvedOwnerId, deletedActivity as any)
          completeNutritionMutation('activities')
        } catch (error) {
          setActivities((current) => current.filter((activity) => activity.id !== deletedActivity.id))
          failNutritionMutation('activities', error)
          showMessage('Không thể khôi phục buổi vận động vì máy chủ chưa xác nhận.')
          return
        }
        showMessage('Đã khôi phục buổi tập')
      })() },
    })
  }

  const deleteMeal = async (mealId: string) => {
    const deletedMeal = meals.find((meal) => meal.id === mealId)
    if (!deletedMeal) return
    setMeals((current) => current.filter((meal) => meal.id !== mealId))
    beginNutritionMutation('meals', mealId)
    try {
      if (isCloudLogEnabled) await deleteUserMealLog(resolvedOwnerId, mealId)
      completeNutritionMutation('meals')
    } catch (error) {
      setMeals((current) => [deletedMeal, ...current])
      failNutritionMutation('meals', error)
      showMessage('Không thể xóa bữa ăn. Dữ liệu đã được giữ lại.')
      return
    }
    showMessage(`Đã xóa ${deletedMeal.title}`, {
      label: 'Hoàn tác',
      onClick: () => { void (async () => {
        setMeals((current) => current.some((meal) => meal.id === deletedMeal.id) ? current : [deletedMeal, ...current])
        beginNutritionMutation('meals', deletedMeal.id)
        try {
          if (isCloudLogEnabled) await saveUserMealLog(resolvedOwnerId, deletedMeal as any)
          completeNutritionMutation('meals')
        } catch (error) {
          setMeals((current) => current.filter((meal) => meal.id !== deletedMeal.id))
          failNutritionMutation('meals', error)
          showMessage('Không thể khôi phục bữa ăn vì máy chủ chưa xác nhận.')
          return
        }
        showMessage('Đã khôi phục món ăn')
      })() },
    })
  }

  const editMeal = async (mealId: string, draft: MealLogEditDraft) => {
    const original = meals.find((meal) => meal.id === mealId)
    if (!original) return
    const multiplier = Math.min(10, Math.max(.1, draft.portionMultiplier))
    const scaleOneDecimal = (value: number) => Math.round(value * multiplier * 10) / 10
    const mealLabels: Record<NutritionMealDraft['mealType'], string> = { breakfast: 'Bữa sáng', lunch: 'Bữa trưa', dinner: 'Bữa tối', snack: 'Bữa phụ' }
    const updated: MealLog = {
      ...original,
      date: draft.date,
      time: draft.time,
      type: draft.mealType,
      label: mealLabels[draft.mealType],
      calories: Math.round(original.calories * multiplier),
      protein: scaleOneDecimal(original.protein),
      carbs: scaleOneDecimal(original.carbs),
      fat: scaleOneDecimal(original.fat),
      fiber: original.fiber === undefined ? undefined : scaleOneDecimal(original.fiber),
      sugar: original.sugar === undefined ? undefined : scaleOneDecimal(original.sugar),
      sodium: original.sodium === undefined ? undefined : Math.round(original.sodium * multiplier),
      calorieRange: original.calorieRange ? { low: Math.round(original.calorieRange.low * multiplier), high: Math.round(original.calorieRange.high * multiplier) } : undefined,
      items: original.items?.map((item) => ({
        ...item,
        grams: scaleOneDecimal(item.grams),
        calories: scaleOneDecimal(item.calories),
        protein: scaleOneDecimal(item.protein),
        carbs: scaleOneDecimal(item.carbs),
        fat: scaleOneDecimal(item.fat),
        fiber: item.fiber === undefined ? undefined : scaleOneDecimal(item.fiber),
        sugar: item.sugar === undefined ? undefined : scaleOneDecimal(item.sugar),
        sodium: item.sodium === undefined ? undefined : Math.round(item.sodium * multiplier),
      })),
    }
    setMeals((current) => current.map((meal) => meal.id === mealId ? updated : meal))
    beginNutritionMutation('meals', mealId)
    try {
      if (isCloudLogEnabled) await saveUserMealLog(resolvedOwnerId, updated as any)
      completeNutritionMutation('meals')
    } catch (error) {
      setMeals((current) => current.map((meal) => meal.id === mealId ? original : meal))
      failNutritionMutation('meals', error)
      showMessage('Không thể cập nhật bữa ăn. Dữ liệu cũ đã được giữ lại.')
      return
    }
    setEditingMealId(null)
    setHomeWeekStart(getCalendarStart(dateFromLocalKey(draft.date)))
    setSelectedDate(draft.date)
    showMessage(`Đã cập nhật ${updated.title}`, {
      label: 'Hoàn tác',
      onClick: () => { void (async () => {
        setMeals((current) => current.map((meal) => meal.id === mealId ? original : meal))
        beginNutritionMutation('meals', mealId)
        try {
          if (isCloudLogEnabled) await saveUserMealLog(resolvedOwnerId, original as any)
          completeNutritionMutation('meals')
        } catch (error) {
          setMeals((current) => current.map((meal) => meal.id === mealId ? updated : meal))
          failNutritionMutation('meals', error)
          showMessage('Không thể hoàn tác chỉnh sửa vì máy chủ chưa xác nhận.')
          return
        }
        setHomeWeekStart(getCalendarStart(dateFromLocalKey(original.date)))
        setSelectedDate(original.date)
        showMessage('Đã hoàn tác chỉnh sửa bữa ăn')
      })() },
    })
  }

  const completeProfile = async (input: NutritionProfileDraft) => {
    const next = canonicalNutritionProfile(input)
    await onProfileComplete?.(next)
    setProfileDraft(next)
    setProfileReady(true)
  }

  const saveScannedMeal = async (meal: NutritionMealDraft) => {
    const loggedDate = meal.mealDate ?? selectedDate
    const fiberComplete = meal.items.length > 0 && meal.items.every((item) => item.fiber !== undefined)
    const sugarComplete = meal.items.length > 0 && meal.items.every((item) => item.sugar !== undefined)
    const sodiumComplete = meal.items.length > 0 && meal.items.every((item) => item.sodium !== undefined)
    const macros = meal.items.reduce((sum, item) => ({
      protein: sum.protein + item.protein,
      carbs: sum.carbs + item.carbs,
      fat: sum.fat + item.fat,
      fiber: sum.fiber + (item.fiber ?? 0),
      sugar: sum.sugar + (item.sugar ?? 0),
      sodium: sum.sodium + (item.sodium ?? 0),
    }), { protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 })
    const finalNutrition = meal.finalNutrition
    const canonicalDishName = meal.dishName?.trim() || meal.name.trim() || 'Bữa ăn dinh dưỡng'
    const mealLabels: Record<NutritionMealDraft['mealType'], string> = { breakfast: 'Bữa sáng', lunch: 'Bữa trưa', dinner: 'Bữa tối', snack: 'Bữa phụ' }
    const newMealLog: MealLog = {
      targetSnapshot: loggedDate === todayKey ? targetSnapshot : undefined,
      id: `ai-${Date.now()}`,
      date: loggedDate,
      type: meal.mealType,
      label: mealLabels[meal.mealType],
      time: meal.mealTime ?? new Date().toTimeString().slice(0, 5),
      title: canonicalDishName,
      dishName: canonicalDishName,
      description: meal.source === 'demo'
        ? `${meal.items.length} thành phần · Dữ liệu minh họa, chưa phân tích từ ảnh`
        : finalNutrition?.confidence === 'needs-review'
          ? `${meal.items.length} thành phần · AI ước tính, còn giả định cần kiểm tra`
          : `${meal.items.length} thành phần · AI ước tính`,
      calories: Math.round(finalNutrition?.calories ?? meal.calories),
      protein: Math.round(finalNutrition?.protein ?? meal.protein ?? macros.protein),
      carbs: Math.round(finalNutrition?.carbs ?? meal.carbs ?? macros.carbs),
      fat: Math.round(finalNutrition?.fat ?? meal.fat ?? macros.fat),
      fiber: finalNutrition?.fiber !== undefined ? Math.round(finalNutrition.fiber) : fiberComplete ? Math.round(macros.fiber) : undefined,
      sugar: finalNutrition?.sugar !== undefined ? Math.round(finalNutrition.sugar) : sugarComplete ? Math.round(macros.sugar) : undefined,
      sodium: finalNutrition?.sodium !== undefined ? Math.round(finalNutrition.sodium) : sodiumComplete ? Math.round(macros.sodium) : undefined,
      nutrientSources: finalNutrition?.nutrientSources,
      unresolvedQuestions: finalNutrition?.unresolvedQuestions,
      status: 'logged',
      tone: 'green',
      image: meal.image,
      source: meal.source,
      confidence: finalNutrition?.confidence ?? (meal.source === 'ai-scan' ? 'estimated' : 'needs-review'),
      calorieRange: meal.calorieRange ?? { low: Math.max(0, Math.round(meal.calories * .88)), high: Math.round(meal.calories * 1.12) },
      items: meal.items,
      reviewStatus: meal.submitForReview ? 'pending' : undefined,
      aiAnalysis: {
        dishName: canonicalDishName,
        quantityAndCookingAnalysis: meal.quantityCookingAnalysis,
        portionAndCalorieRationale: meal.portionCalorieRationale,
        goalAlignmentAssessment: meal.goalAlignmentAssessment,
        calorieOptimizationTip: meal.calorieOptimizationTip,
        macroBalanceAssessment: meal.macroBalanceAssessment,
        coachFeedbackSuggestion: meal.coachFeedbackSuggestion,
        cookingNote: meal.cookingNote,
        portionNote: meal.portionNote,
        clarifications: meal.clarifications,
        finalNutrition: meal.finalNutrition,
      },
      studentGoal: profileDraft.goal === 'lose-fat'
        ? `Giảm mỡ thâm hụt calo (${profileDraft.targetWeightDeltaKg ? `Giảm ${Math.abs(profileDraft.targetWeightDeltaKg)}kg` : 'Thâm hụt calo'})`
        : profileDraft.goal === 'gain-muscle'
        ? `Tăng cơ nạc (${profileDraft.targetWeightDeltaKg ? `Tăng ${profileDraft.targetWeightDeltaKg}kg` : 'Thặng dư đạm'})`
        : 'Duy trì vóc dáng & Sức khỏe',
      studentCondition: [
        profileDraft.biologicalSex === 'female' ? 'Nữ' : 'Nam',
        profileDraft.age ? `${profileDraft.age} tuổi` : '',
        profileDraft.heightCm ? `Cao ${profileDraft.heightCm}cm` : '',
        (actual30DayWeight || profileDraft.weightKg) ? `Nặng ${actual30DayWeight || profileDraft.weightKg}kg` : '',
        profileDraft.trainingSessions ? `Tập ${profileDraft.trainingSessions} buổi/tuần` : '',
        calorieGoal ? `Calo MT: ${calorieGoal} kcal` : '',
        proteinGoal ? `Đạm MT: ${proteinGoal}g` : ''
      ].filter(Boolean).join(', '),
    }
    setMeals((current) => [newMealLog, ...current])
    beginNutritionMutation('meals', newMealLog.id)
    try {
      if (isCloudLogEnabled) {
        await saveUserMealLog(resolvedOwnerId, newMealLog as any)
        if (meal.submitForReview) {
          try {
            await submitMealReview(resolvedOwnerId, firstName || 'Học viên', newMealLog as any)
          } catch {
            showMessage('Đã lưu bữa ăn, nhưng chưa gửi được yêu cầu PT kiểm tra.')
          }
        }
      }
      completeNutritionMutation('meals')
    } catch (error) {
      setMeals((current) => current.filter((item) => item.id !== newMealLog.id))
      failNutritionMutation('meals', error)
      showMessage('Không thể lưu bữa ăn. Dữ liệu chưa được ghi nhận trên máy chủ.')
      return
    }
    onMealSaved?.(meal)
    setHomeWeekStart(getCalendarStart(dateFromLocalKey(loggedDate)))
    setSelectedDate(loggedDate)
    navigateNutrition('today')
    const loggedDateLabel = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' }).format(dateFromLocalKey(loggedDate))
    showMessage(`Đã lưu món ăn vào ${loggedDateLabel.toLocaleLowerCase('vi-VN')}`)
  }

  const queueCatalogFood = async (food: NutritionFoodCatalogItem, multiplier = 1, hydrateDetails = true) => {
    if (planCatalogAction) {
      setPlanCatalogAction((current) => current ? { ...current, servingMultiplier: multiplier } : current)
    }
    let pending = scaleCatalogServing(food, multiplier)
    if (hydrateDetails) {
      try {
        let detail = catalogDetailCache.current.get(food.id) ?? null
        if (!detail) {
          detail = await loadNutritionCatalogDetail(food.id)
          catalogDetailCache.current.set(food.id, detail)
        }
        pending = {
          ...pending,
          fiber: scaleOptionalNumber(detailNutrientValue(detail, 'fiber'), multiplier),
          sugar: scaleOptionalNumber(detailNutrientValue(detail, 'sugars_total') ?? detailNutrientValue(detail, 'sugar'), multiplier),
          sodium: scaleOptionalNumber(detailNutrientValue(detail, 'sodium'), multiplier),
        }
      } catch {
        showMessage('Chưa tải được vi chất chi tiết; kcal và macro vẫn giữ đúng theo bản ghi nguồn')
      }
    }
    setPendingFood(pending)
  }

  const commitCatalogFood = async (food: NutritionFoodCatalogItem, context: MealEditorContext) => {
    if (!canLogCatalogFood(food)) {
      showMessage(nutritionQuality(food).join('; ') || 'Món chưa đủ dữ liệu kcal/macro')
      return
    }
    if (planCatalogAction) {
      if (!nutritionPlan || nutritionPlan.source !== 'aura-catalog') {
        showMessage('Bản nháp kế hoạch không còn sẵn sàng. Hãy tải lại.')
        return
      }
      setNutritionPlanSaving(true)
      setNutritionPlanError('')
      try {
        const plan = await mutateMyNutritionPlanMeal({
          action: planCatalogAction.action,
          weekStart: planWeekStart,
          dayId: planCatalogAction.dayId,
          mealId: planCatalogAction.mealId,
          catalogId: food.id,
          type: context.mealType,
          time: context.time,
          servingMultiplier: planCatalogAction.servingMultiplier,
          expectedRevision: nutritionPlan.revision,
        })
        setNutritionPlan(plan)
        setPendingFood(null)
        setPlanCatalogAction(null)
        setPlanSelectedDay(context.date)
        navigateNutrition('plan')
        showMessage(planCatalogAction.action === 'replace' ? `Đã đổi sang ${food.name}` : `Đã thêm ${food.name} vào thực đơn`)
      } catch (error) {
        const message = nutritionPlanErrorMessage(error)
        setNutritionPlanError(message)
        showMessage(message)
        if (String((error as { code?: unknown })?.code ?? '').endsWith('aborted')) reloadNutritionPlan()
      } finally {
        setNutritionPlanSaving(false)
      }
      return
    }
    const mealLabels: Record<NutritionMealDraft['mealType'], string> = { breakfast: 'Bữa sáng', lunch: 'Bữa trưa', dinner: 'Bữa tối', snack: 'Bữa phụ' }
    const newMealLog: MealLog = {
      targetSnapshot: context.date === todayKey ? targetSnapshot : undefined,
      id: `catalog-${Date.now()}`,
      catalogId: food.id,
      plannedMealId: diaryCatalogDefaults?.plannedMealId,
      servingMultiplier: diaryCatalogDefaults?.servingMultiplier ?? 1,
      date: context.date,
      type: context.mealType,
      label: mealLabels[context.mealType],
      time: context.time,
      title: food.name,
      description: `${food.servingGrams !== null ? `${formatNumber(food.servingGrams)} g` : food.servingLabel ?? 'Theo một suất món'} · ${food.source ?? 'Viện Dinh dưỡng'}`,
      calories: food.calories,
      protein: food.protein,
      carbs: food.carbs,
      fat: food.fat,
      fiber: food.fiber ?? undefined,
      sugar: food.sugar ?? undefined,
      sodium: food.sodium ?? undefined,
      status: 'logged',
      tone: 'green',
      image: food.imageUrl,
      source: 'catalog',
      confidence: food.servingGrams === null ? 'needs-review' : 'verified',
    }
    setMeals((current) => [newMealLog, ...current])
    beginNutritionMutation('meals', newMealLog.id)
    try {
      if (isCloudLogEnabled) await saveUserMealLog(resolvedOwnerId, newMealLog as any)
      completeNutritionMutation('meals')
    } catch (error) {
      setMeals((current) => current.filter((meal) => meal.id !== newMealLog.id))
      failNutritionMutation('meals', error)
      showMessage('Không thể thêm món ăn. Dữ liệu nguồn chưa được ghi nhận.')
      return
    }
    setPendingFood(null)
    setDiaryCatalogDefaults(null)
    setHomeWeekStart(getCalendarStart(dateFromLocalKey(context.date)))
    setSelectedDate(context.date)
    navigateNutrition('today')
    showMessage(`Đã thêm ${food.name} vào ${mealLabels[context.mealType].toLocaleLowerCase('vi-VN')}`)
  }

  const openFoodDetail = (food: NutritionFoodCatalogItem, items: NutritionFoodCatalogItem[] = catalogSnapshot, returnSection: 'catalog' | 'plan' | 'menu' = 'catalog') => {
    setFoodDetailReturnSection(returnSection)
    setSelectedFood(food)
    if (items.length) setCatalogSnapshot(items)
    const nextHash = nutritionFoodDetailHash(food.id, nutritionV4)
    if (window.location.hash !== nextHash) window.location.hash = nextHash
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const closeFoodDetail = () => {
    setSelectedFood(null)
    navigateNutrition(foodDetailReturnSection)
  }

  const openPlanRecordMeal = async (record: NutritionPlanRecord | null, mealId: string, returnSection: 'plan' | 'menu') => {
    const plannedMeal = record?.days.flatMap((day) => day.meals).find((meal) => meal.id === mealId)
    if (!plannedMeal?.catalogId) {
      showMessage('Món từ thực đơn được giao chưa liên kết với thư viện Aura')
      return
    }
    try {
      const known = catalogSnapshot.find((item) => item.id === plannedMeal.catalogId)
      const items = known ? [known] : await loadNutritionCatalog({ ids: [plannedMeal.catalogId] })
      const item = known ?? items[0]
      if (!item) throw new Error('not-found')
      openFoodDetail(item, [...items, ...catalogSnapshot.filter((candidate) => candidate.id !== item.id)], returnSection)
    } catch {
      showMessage('Chưa mở được chi tiết món trong thư viện')
    }
  }
  const openPlannedMeal = (mealId: string) => openPlanRecordMeal(nutritionPlan, mealId, 'plan')
  const openMenuMeal = (mealId: string) => openPlanRecordMeal(activeNutritionPlan, mealId, 'menu')

  const logPlannedMeal = async (meal: NutritionPlannedMeal) => {
    const exactKey = `${meal.dayId}|${meal.id}`
    const legacyKey = `${meal.dayId}|${meal.catalogId || meal.title.trim().toLocaleLowerCase('vi-VN')}`
    if (loggedPlanMealKeys.has(exactKey) || loggedPlanMealKeys.has(legacyKey)) {
      showMessage('Món này đã có trong nhật ký của ngày đã chọn')
      return
    }
    if (!meal.catalogId) {
      showMessage('Món này chưa liên kết với thư viện Aura nên chưa thể ghi tự động')
      return
    }
    try {
      const known = catalogSnapshot.find((item) => item.id === meal.catalogId)
      const loaded = known ? [known] : await loadNutritionCatalog({ ids: [meal.catalogId] })
      const food = known ?? loaded[0]
      if (!food) throw new Error('catalog-item-not-found')
      setDiaryCatalogDefaults({ date: meal.dayId, type: meal.type, time: meal.time, plannedMealId: meal.id, servingMultiplier: meal.servingMultiplier || 1 })
      await queueCatalogFood(food, meal.servingMultiplier || 1, !isDemo)
    } catch {
      setDiaryCatalogDefaults(null)
      showMessage('Chưa tải được dữ liệu món để ghi nhật ký')
    }
  }

  const addFoodFromDetail = (record: NutritionFoodDetailRecord, serving: NutritionServingSelection) => {
    void queueCatalogFood({
      id: record.id,
      kind: record.kind,
      code: record.code ?? undefined,
      name: record.nameVi,
      nameEn: record.nameEn ?? undefined,
      category: record.category ?? undefined,
      region: record.region ?? null,
      servingGrams: record.basis?.unit === 'g' ? record.basis.amount ?? null : null,
      servingLabel: record.basis?.labelVi ?? 'Khẩu phần theo nguồn',
      calories: scaleOptionalNumber(record.energyKcal, 1),
      protein: scaleOptionalNumber(detailNutrientValue(record, 'protein'), 1),
      carbs: scaleOptionalNumber(detailNutrientValue(record, 'carbohydrate'), 1),
      fat: scaleOptionalNumber(detailNutrientValue(record, 'fat'), 1),
      fiber: scaleOptionalNumber(detailNutrientValue(record, 'fiber'), 1),
      sugar: scaleOptionalNumber(detailNutrientValue(record, 'sugars_total') ?? detailNutrientValue(record, 'sugar'), 1),
      sodium: scaleOptionalNumber(detailNutrientValue(record, 'sodium'), 1),
      source: record.source?.publisher ?? 'Viện Dinh dưỡng Quốc gia',
      sourceUrl: record.source?.pageUrl ?? undefined,
      sourceId: record.source?.sourceId ?? undefined,
      imageUrl: record.imageUrl ?? undefined,
      detailBucket: selectedFood?.detailBucket,
    }, serving.multiplier, false)
    closeFoodDetail()
  }

  const setFoodSaved = (foodId: string, saved: boolean) => {
    setSavedFoodIds((current) => {
      const next = new Set(current)
      if (saved) next.add(foodId)
      else next.delete(foodId)
      try {
        window.localStorage.setItem(savedFoodStorageKey, JSON.stringify([...next]))
      } catch {
        // Keep the current browser session usable when storage is unavailable.
      }
      return next
    })
  }

  const isCloudLogEnabled = Boolean(firestoreDb && resolvedOwnerId !== 'anonymous')
  const beginNutritionMutation = (scope: 'meals' | 'water' | 'activities', id: string) => {
    setNutritionMutation({ scope, id })
    updateNutritionSync(scope, {
      status: 'pending-local-change',
      revision: Date.now(),
      cachedAt: new Date().toISOString(),
      message: 'Aura đang xác nhận thay đổi với máy chủ…',
    })
  }
  const completeNutritionMutation = (scope: 'meals' | 'water' | 'activities') => {
    setNutritionMutation(null)
    updateNutritionSync(scope, { status: 'synced', revision: Date.now(), cachedAt: new Date().toISOString() })
  }
  const failNutritionMutation = (scope: 'meals' | 'water' | 'activities', error: unknown) => {
    setNutritionMutation(null)
    updateNutritionSync(scope, {
      status: 'sync-failed',
      revision: Date.now(),
      cachedAt: new Date().toISOString(),
      message: error instanceof Error && error.message ? error.message : 'Aura chưa ghi nhận thay đổi. Hãy thử lại.',
    })
  }

  const saveFood = (record: NutritionFoodDetailRecord, saved: boolean) => setFoodSaved(record.id, saved)

  const scanFromFoodDetail = () => {
    setSelectedFood(null)
    setTaskReturnSection('catalog')
    navigateNutrition('scan')
  }

  if (!profileReady) return <NutritionSetupPrompt onStart={onStartOnboarding} />

  const profileReadOnly = Boolean(syncState && syncState.status !== 'synced')
  const mutationSyncState: DataSyncState = nutritionMutation
    ? { status: 'pending-local-change', revision: nutritionMutation.id.length, cachedAt: new Date().toISOString(), message: 'Aura đang xác nhận thay đổi với máy chủ…' }
    : nutritionLogSyncState
  const displayedSyncState = syncState && syncState.status !== 'synced' ? syncState : mutationSyncState
  const profileSyncBanner = <><DataSyncStatusBanner state={displayedSyncState} compact={displayedSyncState.status === 'synced'} />
    {calculateNutritionTargets(profileDraft, actual30DayWeight).issues.map((issue) => <p className="nutrition-profile-sync-guard" role="status" key={issue}>{issue} Nhật ký và thực đơn đã xác nhận vẫn được giữ.</p>)}</>

  if (activeSection === 'profile') return profileReadOnly ? (
    <div className={`page nutrition-page nutrition-page--workspace ${nutritionV4 ? 'nutrition-page--v4 aura-ui-v4-surface aura-ui-v4-member' : ''}`.trim()} data-testid="nutrition-profile-readonly">
      <div className="nutrition-workspace">
        <NutritionSectionNav activeSection="today" onSectionChange={(section) => navigateNutrition(section)} onScan={openScan} onOpenCatalog={() => openCatalog(false)} onOpenAskAura={openAssistant} v4={nutritionV4} />
        <div className="nutrition-profile-sync-guard">
          {profileSyncBanner}
          <button type="button" className="nutrition-catalog-load-more" onClick={() => navigateNutrition('today')}>Quay lại Hôm nay</button>
        </div>
      </div>
    </div>
  ) : (
    <React.Suspense fallback={<div role="status" aria-live="polite">Đang tải hồ sơ dinh dưỡng…</div>}>
      <NutritionProfileEditor
        onSave={async (nextProfile) => { await completeProfile(nextProfile); navigateNutrition('today') }}
        initialProfile={profileDraft}
        effectiveWeight={actual30DayWeight || profileDraft.weightKg}
        onCancel={() => navigateNutrition('today')}
      />
    </React.Suspense>
  )

  if (selectedFood && selectedFoodSummary) return (
    <React.Suspense fallback={<div role="status" aria-live="polite">Đang tải chi tiết món ăn…</div>}>
      <NutritionFoodDetail
        item={selectedFoodSummary}
        relatedItems={relatedFoodSummaries}
        initialSaved={savedFoodIds.has(selectedFood.id)}
        loadRecord={loadNutritionCatalogDetail}
        onBack={closeFoodDetail}
        onAdd={addFoodFromDetail}
        onSave={saveFood}
        onScan={scanFromFoodDetail}
        onSelectRelated={(item) => {
          const selected = catalogSnapshot.find((candidate) => candidate.id === item.id)
          if (selected) openFoodDetail(selected, catalogSnapshot)
        }}
      />
    </React.Suspense>
  )

  const selectedLoggedMeal = selectedLoggedMealId ? meals.find((meal) => meal.id === selectedLoggedMealId) ?? null : null

  const toastContent = toast && <div className="nutrition-toast" role="status"><Check size={16} /><span>{toast.text}</span>{toast.action && <button type="button" onClick={() => { if (messageTimer.current) window.clearTimeout(messageTimer.current); setToast(null); toast.action?.onClick() }}>{toast.action.label}</button>}</div>

  if (selectedLoggedMeal) return (
    <div className={`page nutrition-page nutrition-page--workspace ${nutritionV4 ? 'nutrition-page--v4 aura-ui-v4-surface aura-ui-v4-member' : ''}`.trim()} data-testid="captured-meal-detail-page">
      {toastContent}
      <React.Suspense fallback={<div role="status" aria-live="polite">Đang tải bữa ăn…</div>}>
        <CapturedMealDetail
          meal={selectedLoggedMeal}
          dailyCalorieGoal={calorieGoal}
          userGoal={profileDraft.goal}
          onBack={() => setSelectedLoggedMealId(null)}
          onEdit={(mealId) => {
            setSelectedLoggedMealId(null)
            setEditingMealId(mealId)
          }}
          onDelete={(mealId) => {
            void deleteMeal(mealId)
            setSelectedLoggedMealId(null)
          }}
        />
      </React.Suspense>
    </div>
  )
  const editingMeal = editingMealId ? meals.find((meal) => meal.id === editingMealId) ?? null : null
  const quickSheets = <>
    {quickAddOpen && <React.Suspense fallback={<div role="status" aria-live="polite">Đang mở bảng thêm nhanh…</div>}><QuickAddSheet
      savedCount={savedFoodIds.size}
      onClose={() => setQuickAddOpen(false)}
      onScan={() => { setQuickAddOpen(false); openScan() }}
      onCatalog={() => { setQuickAddOpen(false); openCatalog(false) }}
      onSaved={() => { setQuickAddOpen(false); openCatalog(true) }}
      onWater={() => { setQuickAddOpen(false); setWaterSheetOpen(true) }}
      onExercise={() => { setQuickAddOpen(false); setExerciseSheetOpen(true) }}
    /></React.Suspense>}
    {waterSheetOpen && <React.Suspense fallback={<div role="status" aria-live="polite">Đang mở nhật ký nước…</div>}><WaterLogSheet
      current={water} 
      goal={waterGoal} 
      dateLabel={selectedDateLabel} 
      todayEntries={waterEntries.filter((e) => e.date === selectedDate).map((e) => ({ id: e.id, time: e.time, amountMl: e.amountMl }))}
      onRemoveEntry={(id) => { void (async () => {
        const entry = waterEntries.find((e) => e.id === id)
        if (!entry) return
        const previousTotal = waterByDate[selectedDate] ?? 0
        setWaterEntries((prev) => prev.filter((e) => e.id !== id))
        setWaterByDate((prev) => ({ ...prev, [selectedDate]: Math.max(0, previousTotal - entry.amountMl) }))
        beginNutritionMutation('water', id)
        try {
          if (isCloudLogEnabled) await deleteUserWaterLog(resolvedOwnerId, id)
          completeNutritionMutation('water')
          showMessage('Đã xóa lượt ghi nước.')
        } catch (error) {
          setWaterEntries((prev) => [entry, ...prev])
          setWaterByDate((prev) => ({ ...prev, [selectedDate]: previousTotal }))
          failNutritionMutation('water', error)
          showMessage('Không thể xóa lượt ghi nước. Dữ liệu đã được giữ lại.')
        }
      })() }}
      onClose={() => {
        setWaterSheetOpen(false)
        const queryStr = window.location.hash.split('?')[1] ?? ''
        const params = new URLSearchParams(queryStr)
        if (params.get('action') === 'water') {
          params.delete('action')
          const nextQuery = params.toString()
          window.location.hash = `#/nutrition${nextQuery ? `?${nextQuery}` : ''}`
        }
      }} 
      onLog={logWater} 
    /></React.Suspense>}
    {exerciseSheetOpen && <React.Suspense fallback={<div role="status" aria-live="polite">Đang tải nhật ký vận động…</div>}><WorkoutLogSheet dateLabel={selectedDateLabel} weightKg={profileDraft.weightKg} onClose={() => setExerciseSheetOpen(false)} onSave={saveActivity} /></React.Suspense>}
    {pendingFood && <MealEditorSheet
      food={pendingFood}
      initialDate={planCatalogAction?.dayId ?? diaryCatalogDefaults?.date ?? selectedDate}
      initialMealType={planCatalogAction?.type ?? diaryCatalogDefaults?.type}
      initialTime={planCatalogAction?.time ?? diaryCatalogDefaults?.time}
      mode={planCatalogAction ? 'plan' : 'diary'}
      lockDate={Boolean(planCatalogAction)}
      isSaving={nutritionPlanSaving || nutritionMutation?.scope === 'meals'}
      onClose={() => { setPendingFood(null); setDiaryCatalogDefaults(null) }}
      onConfirm={commitCatalogFood}
    />}
    {editingMeal && <MealLogEditorSheet meal={editingMeal} onClose={() => setEditingMealId(null)} onConfirm={(draft) => editMeal(editingMeal.id, draft)} />}
  </>

  if (activeSection === 'scan') return (
    <div className={`page nutrition-page nutrition-page--workspace ${nutritionV4 ? 'nutrition-page--v4 aura-ui-v4-surface aura-ui-v4-member' : ''}`.trim()} data-testid="nutrition-dashboard">
      {toastContent}
      <div className="nutrition-workspace">
        <NutritionSectionNav activeSection="today" onSectionChange={(section) => navigateNutrition(section)} onScan={openScan} onOpenCatalog={() => openCatalog(false)} onOpenAskAura={openAssistant} v4={nutritionV4} />
        {profileSyncBanner && <div className="nutrition-sync-banner-wrap">{profileSyncBanner}</div>}
        <FoodScanModal key={resolvedOwnerId} initialDate={selectedDate} storageOwnerId={resolvedOwnerId} allowDemo={isDemo} presentation="page" onClose={closeScan} onSave={saveScannedMeal} onAnalyzeImage={onAnalyzeImage} />
      </div>
      {quickSheets}
    </div>
  )

  if (activeSection === 'catalog') return (
    <div className={`page nutrition-page nutrition-page--workspace ${nutritionV4 ? 'nutrition-page--v4 aura-ui-v4-surface aura-ui-v4-member' : ''}`.trim()} data-testid="nutrition-dashboard">
      {toastContent}
      <div className="nutrition-workspace">
        <NutritionSectionNav activeSection="catalog" onSectionChange={(section) => navigateNutrition(section)} onScan={openScan} onOpenCatalog={() => openCatalog(false)} onOpenAskAura={openAssistant} v4={nutritionV4} />
        {profileSyncBanner && <div className="nutrition-sync-banner-wrap">{profileSyncBanner}</div>}
        <FoodCatalogModal presentation="page" catalog={foodCatalog} savedFoodIds={savedFoodIds} initialSavedOnly={catalogSavedOnly} allowDemo={isDemo} onClose={closeCatalog} onAdd={queueCatalogFood} onOpenDetail={openFoodDetail} onToggleSaved={(food, saved) => setFoodSaved(food.id, saved)} />
      </div>
      {quickSheets}
    </div>
  )

  return (
    <div className={`page nutrition-page nutrition-page--workspace ${nutritionV4 ? 'nutrition-page--v4 aura-ui-v4-surface aura-ui-v4-member' : ''}`.trim()} data-testid="nutrition-dashboard">
      {toastContent}
      <NutritionWorkspace
        v4={nutritionV4}
        activeSection={workspaceSection}
        onSectionChange={(section) => navigateNutrition(section)}
        onScan={openScan}
        onOpenCatalog={() => openCatalog(false)}
        onOpenSaved={() => openCatalog(true)}
        onOpenEatClean={onOpenEatClean}
        onOpenAskAura={openAssistant}
        weightKg={profileDraft.weightKg}
        targetWeightDeltaKg={profileDraft.targetWeightDeltaKg}
        targetTimeframeMonths={profileDraft.targetTimeframeMonths}
        heightCm={profileDraft.heightCm}
        nutritionProfile={profileDraft}
        ownerId={resolvedOwnerId}
        legacyPlanContent={<React.Suspense fallback={<div role="status">Đang tải kế hoạch…</div>}><ConnectedMealPlanPage
          days={workspacePlanDays}
          selectedDayId={planSelectedDay}
          meals={workspacePlannedMeals}
          dailyCalorieGoal={nutritionPlan?.targets.calories ?? calorieGoal}
          status={nutritionPlan?.status ?? (isDemo && planGenerated ? 'active' : undefined)}
          sourceTitle={nutritionPlan?.sourceTitle}
          weekLabel={`${new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' }).format(dateFromLocalKey(planWeekStart))} – ${new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(dateFromLocalKey(planDays[6]?.id ?? planWeekStart))}`}
          errorMessage={nutritionPlanError || nutritionPlan?.validationIssues?.slice(0, 3).join(' · ')}
          isLoading={nutritionPlanLoading}
          isGenerating={nutritionPlanGenerating}
          isSaving={nutritionPlanSaving}
          canEdit={nutritionPlan?.source === 'aura-catalog'}
          strategyTitle={profileDraft.goal === 'gain-muscle' ? 'Đủ đạm, ưu tiên phục hồi' : profileDraft.goal === 'lose-fat' ? 'No lâu, thâm hụt vừa phải' : 'Cân bằng và dễ duy trì'}
          strategyDescription={nutritionPlan?.source === 'assigned'
            ? 'Thực đơn do đội ngũ Aura giao. Bạn có thể theo dõi hoặc tạo bản nháp riêng từ thư viện.'
            : `Dựa trên mục tiêu ${(GOAL_LABELS[profileDraft.goal] || '').toLocaleLowerCase('vi-VN')}, ${profileDraft.trainingSessions} buổi tập/tuần và ${profileDraft.mealsPerDay || 3} bữa/ngày.`}
          constraints={[
            profileDraft.allergies ? `Tránh: ${profileDraft.allergies}` : 'Chưa ghi nhận dị ứng',
            profileDraft.dislikes ? `Không thích: ${profileDraft.dislikes}` : 'Không có món kén ăn',
            `Mục tiêu ${formatNumber(calorieGoal)} kcal/ngày`,
            `${profileDraft.trainingSessions} buổi tập/tuần`,
          ]}
          initialCatalog={foodCatalog}
          savedFoodIds={savedFoodIds}
          allowDemo={isDemo}
          loggedMealKeys={loggedPlanMealKeys}
          onSelectDay={setPlanSelectedDay}
          onGeneratePlan={generateNutritionPlan}
          onAddMeal={(dayId) => openPlanCatalog('add', dayId)}
          onReplaceMeal={(mealId) => {
            const meal = nutritionPlan?.days.flatMap((day) => day.meals).find((candidate) => candidate.id === mealId)
            if (meal) openPlanCatalog('replace', meal.dayId, meal)
          }}
          onRemoveMeal={removeNutritionPlanMeal}
          onOpenMeal={nutritionPlan ? openPlannedMeal : undefined}
          onConfirmPlan={confirmNutritionPlan}
          onReload={reloadNutritionPlan}
          onShiftWeek={shiftPlanWeek}
          onOpenCatalogFood={(food, items) => openFoodDetail(food, items, 'plan')}
          onLogCatalogFood={(food) => { setDiaryCatalogDefaults(null); return queueCatalogFood(food, 1, !isDemo) }}
          onLogPlannedMeal={logPlannedMeal}
          onToggleSaved={(food, saved) => setFoodSaved(food.id, saved)}
        /></React.Suspense>}
        todayContent={<>{profileSyncBanner}<React.Suspense fallback={<div className="nutrition-dashboard-loading" role="status" aria-live="polite">Đang tải tổng quan dinh dưỡng…</div>}><NutritionDashboardHome
          selectedDate={selectedDate}
          days={days}
          loggedDateIds={loggedDateIds}
          meals={loggedMeals}
          activities={selectedDayActivities}
          activityCalories={activityCalories}
          activityMinutes={activityMinutes}
          caloriesConsumed={caloriesConsumed}
          calorieGoal={calorieGoal}
          caloriePercent={caloriePercent}
          proteinConsumed={proteinConsumed}
          proteinGoal={proteinGoal}
          carbsConsumed={carbsConsumed}
          carbGoal={carbGoal}
          fatConsumed={fatConsumed}
          fatGoal={fatGoal}
          qualityMetrics={qualityMetrics}
          water={water}
          waterGoal={waterGoal}
          trainingSessions={profileDraft.trainingSessions}
          dailyPlan={dailyPlan}
          allergies={profileDraft.allergies}
          onSelectDate={setSelectedDate}
          onShiftWeek={shiftHomeWeek}
          onOpenQuickAdd={() => setQuickAddOpen(true)}
          onOpenCatalog={() => openCatalog(false)}
          onOpenEatClean={onOpenEatClean}
          onOpenWater={() => setWaterSheetOpen(true)}
          onOpenExercise={() => setExerciseSheetOpen(true)}
          onAskAura={openAssistant}
          onLogWater={logWater}
          onOpenMeal={setSelectedLoggedMealId}
          onDeleteMeal={deleteMeal}
          onDeleteActivity={deleteActivity}
        /></React.Suspense></>}
        diary={{
          dateKey: selectedDate,
          dateLabel: selectedDateLabel,
          todayKey,
          historyFromDate: recentNutritionFromDate,
          daySummaries: diaryDaySummaries,
          targets: { calories: calorieGoal, protein: proteinGoal, carbs: carbGoal, fat: fatGoal, waterMl: waterGoal },
          meals: workspaceDiaryMeals,
          activities: selectedDayActivities.map((activity) => ({ id: activity.id, time: activity.startTime, title: activity.title, durationMinutes: activity.durationMinutes, intensity: activity.intensity, estimatedCalories: activity.estimatedCalories })),
          waterEntries: waterEntries.filter((entry) => entry.date === selectedDate).map((entry) => ({ id: entry.id, time: entry.time, amountMl: entry.amountMl })),
          waterMl: water,
          onSelectDate: selectDiaryDate,
          onGoToday: selectTodayInDiary,
          onAddMeal: () => setQuickAddOpen(true),
          onAddWater: () => setWaterSheetOpen(true),
          onAddExercise: () => setExerciseSheetOpen(true),
          onOpenMeal: setSelectedLoggedMealId,
          onEditMeal: setEditingMealId,
          onDeleteMeal: deleteMeal,
          onDeleteActivity: deleteActivity,
          onDeleteWater: deleteWaterEntry,
        }}
        plan={{
          days: workspacePlanDays,
          selectedDayId: planSelectedDay,
          meals: workspacePlannedMeals,
          dailyCalorieGoal: nutritionPlan?.targets.calories ?? calorieGoal,
          status: nutritionPlan?.status ?? (isDemo && planGenerated ? 'active' : undefined),
          sourceTitle: nutritionPlan?.sourceTitle,
          weekLabel: `${new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' }).format(dateFromLocalKey(planWeekStart))} – ${new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(dateFromLocalKey(planDays[6]?.id ?? planWeekStart))}`,
          errorMessage: nutritionPlanError || nutritionPlan?.validationIssues?.slice(0, 3).join(' · '),
          isLoading: nutritionPlanLoading,
          isGenerating: nutritionPlanGenerating,
          isSaving: nutritionPlanSaving,
          canEdit: nutritionPlan?.source === 'aura-catalog',
          strategyTitle: profileDraft.goal === 'gain-muscle' ? 'Đủ đạm, ưu tiên phục hồi' : profileDraft.goal === 'lose-fat' ? 'No lâu, thâm hụt vừa phải' : 'Cân bằng và dễ duy trì',
          strategyDescription: nutritionPlan?.source === 'assigned'
            ? 'Thực đơn do đội ngũ Aura giao. Bạn có thể dùng ngay hoặc tạo một bản nháp riêng từ thư viện món.'
            : `Gợi ý dựa trên mục tiêu ${(GOAL_LABELS[profileDraft.goal] || '').toLocaleLowerCase('vi-VN')}, ${profileDraft.trainingSessions} buổi tập/tuần và ${profileDraft.mealsPerDay || 3} bữa/ngày.`,
          constraints: [
            profileDraft.allergies ? `Tránh: ${profileDraft.allergies}` : 'Chưa ghi nhận dị ứng',
            profileDraft.dislikes ? `Không thích: ${profileDraft.dislikes}` : 'Không có món kén ăn',
            `Mục tiêu ${formatNumber(calorieGoal)} kcal/ngày`,
            `${profileDraft.trainingSessions} buổi tập/tuần`
          ],
          onSelectDay: setPlanSelectedDay,
          onGeneratePlan: generateNutritionPlan,
          onAddMeal: (dayId) => openPlanCatalog('add', dayId),
          onReplaceMeal: (mealId) => {
            const meal = nutritionPlan?.days.flatMap((day) => day.meals).find((candidate) => candidate.id === mealId)
            if (meal) openPlanCatalog('replace', meal.dayId, meal)
          },
          onRemoveMeal: removeNutritionPlanMeal,
          onOpenMeal: nutritionPlan ? openPlannedMeal : undefined,
          onConfirmPlan: confirmNutritionPlan,
          onReload: reloadNutritionPlan,
          onShiftWeek: shiftPlanWeek,
        }}
        menu={{
          days: workspacePlanDays,
          selectedDayId: planSelectedDay,
          meals: workspaceMenuMeals,
          dailyCalorieGoal: activeNutritionPlan?.targets.calories ?? calorieGoal,
          sourceTitle: activeNutritionPlan?.sourceTitle,
          weekLabel: `${new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' }).format(dateFromLocalKey(planWeekStart))} – ${new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(dateFromLocalKey(planDays[6]?.id ?? planWeekStart))}`,
          errorMessage: nutritionPlanError || nutritionPlan?.validationIssues?.slice(0, 3).join(' · '),
          isLoading: nutritionPlanLoading,
          onSelectDay: setPlanSelectedDay,
          onOpenMeal: activeNutritionPlan ? openMenuMeal : undefined,
          onOpenPlan: () => navigateNutrition('plan'),
          onReload: reloadNutritionPlan,
          onShiftWeek: shiftPlanWeek,
        }}
        assistant={{
          open: activeSection === 'assistant',
          variant: 'page',
          title: 'Trợ lý quyết định bữa tiếp theo',
          messages: assistantMessages,
          context: [
            { id: 'goal', label: 'Mục tiêu', value: GOAL_LABELS[profileDraft.goal] },
            { id: 'remaining', label: 'Còn lại', value: `${formatNumber(Math.max(0, calorieGoal - caloriesConsumed))} kcal · ${formatNumber(Math.max(0, proteinGoal - proteinConsumed))}g đạm` },
            { id: 'evidence', label: 'Căn cứ', value: catalogSnapshot.length ? `${loggedMeals.length} bữa · ${formatNumber(catalogSnapshot.length)} bản ghi đã tải` : `${loggedMeals.length} bữa · hồ sơ cá nhân` },
          ],
          suggestions: assistantSuggestions,
          isLoading: assistantLoading,
          onClose: closeAssistant,
          onSubmit: submitAssistantQuestion,
        }}
      />

      {activeSection === 'today' && (
        <div className="nutrition-pink-fab-container">
          <button
            type="button"
            className={`nutrition-pink-fab ${quickAddOpen ? 'is-open' : ''}`}
            onClick={() => setQuickAddOpen((current) => !current)}
            aria-label={quickAddOpen ? 'Đóng thêm nhanh' : 'Thêm nhanh'}
            title="Thêm nhanh"
          >
            <Plus size={28} className="pink-fab-icon" />
          </button>
        </div>
      )}
      {quickSheets}
    </div>
  )
}
