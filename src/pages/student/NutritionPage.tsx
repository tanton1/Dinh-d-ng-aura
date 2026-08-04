import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react'
import NutritionFoodDetail, {
  type NutritionFoodDetailRecord,
  type NutritionFoodDetailSummary,
  type NutritionServingSelection,
} from './NutritionFoodDetail'
import CapturedMealDetail from './CapturedMealDetail'
import NutritionGroupIcon from '../../components/NutritionGroupIcon'
import NutritionDashboardHome from './NutritionDashboardHome'
import NutritionProfileEditor from './NutritionProfileEditor'
import NutritionWorkspace, {
  NutritionSectionNav,
  type AuraAssistantMessage,
  type NutritionInsightsPeriod,
  type NutritionMealEntry,
  type NutritionPlannedMeal,
  type NutritionPlanDay,
  type NutritionWorkspaceSection,
} from './NutritionWorkspace'
import type {
  AnalyzeFoodPhotoOptions,
  FoodAnalysisItem,
  FoodAnalysisResponse,
  NutritionCatalogMatch,
} from '../../services/nutritionService'
import { firebaseAuth, firestoreDb } from '../../lib/firebase'
import {
  saveUserMealLog,
  deleteUserMealLog,
  subscribeToUserMealLogs,
  saveUserWaterLog,
  deleteUserWaterLog,
  subscribeToUserWaterLogs,
  saveUserActivityLog,
  deleteUserActivityLog,
  subscribeToUserActivityLogs,
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
  Columns2,
  Droplets,
  Dumbbell,
  ImagePlus,
  Info,
  LoaderCircle,
  Plus,
  RefreshCw,
  Rows2,
  Salad,
  Scale,
  ScanLine,
  Search,
  Sparkles,
  Target,
  Trash2,
  TrendingDown,
  Utensils,
  X,
} from 'lucide-react'
import '../../styles-nutrition.css'
import '../../styles-nutrition-home.css'

export type NutritionGoal = 'lose-fat' | 'gain-muscle' | 'maintain'

export interface NutritionProfileDraft {
  goal: NutritionGoal
  age: number
  biologicalSex: 'female' | 'male'
  heightCm: number
  weightKg: number
  activityLevel: 'low' | 'moderate' | 'high'
  trainingSessions: number
  eatingStyle: string
  allergies: string
}

export interface AiFoodItem {
  id: string
  name: string
  grams: number
  gramRange?: { low: number; high: number }
  cookingMethod?: string
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber?: number
  sugar?: number
  sodium?: number
  confidence: 'high' | 'medium' | 'low'
  confidenceValue?: number
  assumptions?: string[]
  catalogMatch?: NutritionCatalogMatch | null
  catalogCandidates?: NutritionCatalogMatch[]
  nutritionEvidence?: FoodAnalysisItem['nutritionEvidence']
  calculationSource?: 'database' | 'mixed' | 'ai-estimate' | 'manual'
  perGram?: {
    calories: number
    protein: number
    carbs: number
    fat: number
    fiber: number
    sugar: number
    sodium: number
  }
}

export interface NutritionMealDraft {
  name: string
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  mealDate?: string
  mealTime?: string
  image?: string
  calories: number
  protein?: number
  carbs?: number
  fat?: number
  calorieRange?: { low: number; high: number }
  items: AiFoodItem[]
  source: 'ai-scan' | 'demo'
}

export type NutritionImageAnalysisResponse = FoodAnalysisResponse

export interface NutritionFoodCatalogItem {
  id: string
  kind?: 'dish' | 'food'
  code?: string
  name: string
  nameEn?: string
  nameAscii?: string
  category?: { id?: string | null; nameVi?: string | null; nameEn?: string | null }
  region?: { id?: string | null; nameVi?: string | null; code?: string | null } | null
  servingGrams: number | null
  servingLabel?: string
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  fiber?: number | null
  sugar?: number | null
  sodium?: number | null
  source?: string
  sourceUrl?: string
  sourceId?: string
  imageUrl?: string
  detailBucket?: string
}

type NutritionClarificationResponse = 'confirmed' | 'adjust' | 'unknown'

interface PersistedScanReview {
  ownerId: string
  dishName: string
  items: AiFoodItem[]
  resultMode: 'live' | 'demo'
  resultNotice: string
  serverRange: { low: number; high: number } | null
  baselineCalories: number
  analysisConfidence: number | null
  analysisQuestions: string[]
  analysisWarnings: string[]
  analysisModel: string | null
  confirmedItemIds: string[]
  questionResponses: Record<string, NutritionClarificationResponse>
  mealType: NutritionMealDraft['mealType']
  mealDate: string
  mealTime: string
  fileName: string
}

interface NutritionPageProps {
  displayName?: string
  isDemo?: boolean
  storageOwnerId?: string
  hasProfile?: boolean
  profile?: NutritionProfileDraft
  onProfileComplete?: (profile: NutritionProfileDraft) => void
  onMealSaved?: (meal: NutritionMealDraft) => void
  onAnalyzeImage?: (file: File, options?: AnalyzeFoodPhotoOptions) => Promise<NutritionImageAnalysisResponse>
  foodCatalog?: NutritionFoodCatalogItem[]
}

function canLogCatalogFood(food: NutritionFoodCatalogItem): food is NutritionFoodCatalogItem & {
  calories: number
  protein: number
  carbs: number
  fat: number
} {
  return food.calories !== null && food.protein !== null && food.carbs !== null && food.fat !== null
}

interface MealLog {
  id: string
  date: string
  type: NutritionMealDraft['mealType']
  label: string
  time: string
  title: string
  description: string
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber?: number
  sugar?: number
  sodium?: number
  status: 'logged' | 'planned'
  tone: 'violet' | 'orange' | 'green' | 'pink'
  image?: string
  source?: 'ai-scan' | 'demo' | 'catalog' | 'manual'
  confidence?: 'verified' | 'estimated' | 'needs-review'
  calorieRange?: { low: number; high: number }
  items?: AiFoodItem[]
}

interface NutritionWaterLog {
  id: string
  date: string
  time: string
  amountMl: number
  createdAt: number
}

type NutritionActivityKind = 'strength' | 'running' | 'walking' | 'cycling' | 'hiit' | 'swimming' | 'yoga' | 'other'
type NutritionActivityIntensity = 'low' | 'moderate' | 'high'

interface NutritionActivityLog {
  id: string
  date: string
  startTime: string
  kind: NutritionActivityKind
  title: string
  durationMinutes: number
  intensity: NutritionActivityIntensity
  estimatedCalories: number
  met: number
  weightKgAtEstimate: number
  source: 'manual'
  createdAt: number
}

interface NutritionActivityDraft {
  startTime: string
  kind: NutritionActivityKind
  title: string
  durationMinutes: number
  intensity: NutritionActivityIntensity
  estimatedCalories: number
  met: number
  weightKgAtEstimate: number
}

const INITIAL_ANALYSIS: AiFoodItem[] = [
  { id: 'rice', name: 'Cơm trắng', grams: 180, calories: 234, protein: 4.7, carbs: 51.5, fat: 0.5, confidence: 'high' },
  { id: 'chicken', name: 'Ức gà áp chảo', grams: 125, calories: 206, protein: 38.8, carbs: 0, fat: 4.5, confidence: 'high' },
  { id: 'vegetables', name: 'Rau củ luộc', grams: 110, calories: 54, protein: 2.6, carbs: 10.3, fat: 0.4, confidence: 'medium' },
  { id: 'sauce', name: 'Sốt / dầu chế biến', grams: 12, calories: 78, protein: 0.2, carbs: 2.5, fat: 7.4, confidence: 'low' },
]

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

const ACTIVITY_FACTORS: Record<NutritionProfileDraft['activityLevel'], number> = {
  low: 1.25,
  moderate: 1.45,
  high: 1.65,
}

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

const GOAL_LABELS: Record<NutritionGoal, string> = {
  'lose-fat': 'Giảm mỡ bền vững',
  'gain-muscle': 'Tăng cơ & phục hồi',
  maintain: 'Duy trì thể trạng',
}

const DEMO_CATALOG: NutritionFoodCatalogItem[] = [
  { id: 'demo-pho-bo', code: 'MA-001', name: 'Phở bò', servingGrams: 500, calories: 394, protein: 26.8, carbs: 51.4, fat: 9.1, source: 'Viện Dinh dưỡng' },
  { id: 'demo-com-trang', code: 'TP-001', name: 'Cơm trắng', servingGrams: 100, calories: 130, protein: 2.7, carbs: 28.2, fat: 0.3, source: 'Viện Dinh dưỡng' },
  { id: 'demo-uc-ga', code: 'TP-002', name: 'Ức gà chín', servingGrams: 100, calories: 165, protein: 31, carbs: 0, fat: 3.6, source: 'Dữ liệu minh họa' },
  { id: 'demo-banh-mi-trung', code: 'MA-002', name: 'Bánh mì trứng', servingGrams: 180, calories: 385, protein: 17, carbs: 44, fat: 16, source: 'Dữ liệu minh họa' },
  { id: 'demo-ca-hoi', code: 'TP-003', name: 'Cá hồi áp chảo', servingGrams: 100, calories: 208, protein: 22, carbs: 0, fat: 13, source: 'Dữ liệu minh họa' },
  { id: 'demo-khoai-lang', code: 'TP-004', name: 'Khoai lang luộc', servingGrams: 100, calories: 86, protein: 1.6, carbs: 20.1, fat: 0.1, source: 'Dữ liệu minh họa' },
]

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
  activityLevel: 'moderate',
  trainingSessions: 4,
  eatingStyle: 'Không giới hạn',
  allergies: '',
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value)
}

function formatDecimal(value: number, maximumFractionDigits = 1) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits }).format(value)
}

function getNutritionTargets(profile: NutritionProfileDraft) {
  const sexOffset = profile.biologicalSex === 'male' ? 5 : -161
  const restingCalories = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.age + sexOffset
  const maintenanceCalories = restingCalories * ACTIVITY_FACTORS[profile.activityLevel]
  const goalMultiplier = profile.goal === 'lose-fat' ? 0.85 : profile.goal === 'gain-muscle' ? 1.1 : 1
  const calorieGoal = Math.min(4000, Math.max(1200, Math.round((maintenanceCalories * goalMultiplier) / 50) * 50))
  const proteinPerKg = profile.goal === 'gain-muscle' ? 2 : profile.goal === 'lose-fat' ? 1.8 : 1.6
  const proteinGoal = Math.round(profile.weightKg * proteinPerKg)
  const fatGoal = Math.max(45, Math.round(profile.weightKg * 0.8))
  const carbGoal = Math.max(80, Math.round((calorieGoal - proteinGoal * 4 - fatGoal * 9) / 4))
  const waterGoal = Math.min(4000, Math.max(1500, Math.round((profile.weightKg * 35) / 100) * 100))
  return { calorieGoal, proteinGoal, carbGoal, fatGoal, waterGoal }
}

function getDailyPlan(calorieGoal: number, eatingStyle: string) {
  const vegetarian = eatingStyle === 'Ăn chay' || eatingStyle === 'Thuần chay'
  const lowCarb = eatingStyle === 'Ít tinh bột'
  const titles = vegetarian
    ? ['Yến mạch, trái cây & hạt', 'Cơm đậu phụ & rau xanh', 'Sữa chua thực vật', 'Đậu lăng & rau củ nướng']
    : lowCarb
      ? ['Trứng, bơ & rau xanh', 'Gà nướng & salad', 'Sữa chua không đường', 'Cá & rau củ áp chảo']
      : WEEK_PLAN.map((item) => item.title)
  const ratios = [0.24, 0.32, 0.1]
  const firstMeals = ratios.map((ratio) => Math.round((calorieGoal * ratio) / 10) * 10)
  const dinnerCalories = calorieGoal - firstMeals.reduce((sum, calories) => sum + calories, 0)
  return WEEK_PLAN.map((item, index) => ({
    ...item,
    title: titles[index],
    calories: index < firstMeals.length ? firstMeals[index] : dinnerCalories,
  }))
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

function perGramNutrition(item: Pick<AiFoodItem, 'grams' | 'calories' | 'protein' | 'carbs' | 'fat' | 'fiber' | 'sugar' | 'sodium'>) {
  const grams = Math.max(item.grams, 0.001)
  return {
    calories: item.calories / grams,
    protein: item.protein / grams,
    carbs: item.carbs / grams,
    fat: item.fat / grams,
    fiber: (item.fiber ?? 0) / grams,
    sugar: (item.sugar ?? 0) / grams,
    sodium: (item.sodium ?? 0) / grams,
  }
}

function normalizeAnalysisItem(item: FoodAnalysisItem, index: number): AiFoodItem {
  const confidence: AiFoodItem['confidence'] = item.confidence >= .78 ? 'high' : item.confidence >= .5 ? 'medium' : 'low'
  const normalized: AiFoodItem = {
    id: `live-${index}-${item.searchNameAscii || item.nameVi || 'item'}`,
    name: item.nameVi || `Thành phần ${index + 1}`,
    grams: item.estimatedGrams,
    gramRange: item.gramRange,
    cookingMethod: item.cookingMethod,
    calories: item.nutrition.calories,
    protein: item.nutrition.proteinG,
    carbs: item.nutrition.carbsG,
    fat: item.nutrition.fatG,
    fiber: item.nutrition.fiberG,
    sugar: item.nutrition.sugarG,
    sodium: item.nutrition.sodiumMg,
    confidence,
    confidenceValue: item.confidence,
    assumptions: item.assumptions,
    catalogMatch: item.catalogMatch,
    catalogCandidates: item.catalogCandidates,
    nutritionEvidence: item.nutritionEvidence,
    calculationSource: item.nutritionEvidence?.sourceType === 'catalog_scaled'
      ? 'database'
      : item.nutritionEvidence?.sourceType === 'catalog_scaled_with_ai_gaps'
        ? 'mixed'
        : 'ai-estimate',
  }
  return { ...normalized, perGram: perGramNutrition(normalized) }
}

function nutritionEvidenceLabel(item: AiFoodItem) {
  if (item.nutritionEvidence?.sourceType === 'catalog_scaled') return 'Nguồn số: CSDL đã quy đổi'
  if (item.nutritionEvidence?.sourceType === 'catalog_scaled_with_ai_gaps') {
    const catalogFields = Object.values(item.nutritionEvidence.fields).filter((source) => source === 'catalog').length
    return `Nguồn số: CSDL ${catalogFields}/7 trường · AI bổ sung phần thiếu`
  }
  if (item.calculationSource === 'manual') return 'Nguồn số: bạn đã chỉnh · cần xác nhận'
  return 'Nguồn số: AI ước tính · cần bạn chấp nhận'
}

function normalizeAnalysis(response: NutritionImageAnalysisResponse) {
  const analysis = response.analysis
  if (!analysis || !analysis.isFood) return null
  const items = analysis.items.map(normalizeAnalysisItem)
  if (!items.length) return null
  return {
    items,
    dishName: analysis.dishNameVi,
    range: analysis.calorieRange,
    confidence: analysis.confidence,
    questions: analysis.questions,
    warnings: [...analysis.warnings, ...(analysis.databaseNotices ?? [])],
    catalogMatch: analysis.catalogMatch,
    catalogCandidates: analysis.catalogCandidates,
    notices: response.notices,
    model: response.model,
  }
}

function normalizeCatalogPayload(payload: unknown): NutritionFoodCatalogItem[] {
  const root = asRecord(payload)
  const candidates = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.items) ? root.items
      : Array.isArray(root?.foods) ? root.foods
        : Array.isArray(root?.records) ? root.records
          : []
  return candidates.map((candidate, index): NutritionFoodCatalogItem | null => {
    const item = asRecord(candidate)
    if (!item) return null
    const nutrition = asRecord(item.nutrition)
    const macros = asRecord(item.macros)
    const basis = asRecord(item.basis)
    const source = asRecord(item.source)
    const name = item.nameVi ?? item.name ?? item.foodName ?? item.title
    if (typeof name !== 'string' || !name.trim()) return null
    return {
      id: String(item.id ?? item.catalogId ?? item.code ?? `catalog-${index}`),
      kind: item.kind === 'dish' || item.kind === 'food' ? item.kind : undefined,
      code: typeof item.code === 'string' ? item.code : undefined,
      name: name.trim(),
      nameEn: typeof item.nameEn === 'string' ? item.nameEn : undefined,
      nameAscii: typeof item.nameAscii === 'string' ? item.nameAscii : undefined,
      category: asRecord(item.category) ? {
        id: typeof asRecord(item.category)?.id === 'string' ? String(asRecord(item.category)?.id) : null,
        nameVi: typeof asRecord(item.category)?.nameVi === 'string' ? String(asRecord(item.category)?.nameVi) : null,
        nameEn: typeof asRecord(item.category)?.nameEn === 'string' ? String(asRecord(item.category)?.nameEn) : null,
      } : undefined,
      region: asRecord(item.region) ? {
        id: typeof asRecord(item.region)?.id === 'string' ? String(asRecord(item.region)?.id) : null,
        nameVi: typeof asRecord(item.region)?.nameVi === 'string' ? String(asRecord(item.region)?.nameVi) : null,
        code: typeof asRecord(item.region)?.code === 'string' ? String(asRecord(item.region)?.code) : null,
      } : null,
      servingGrams: typeof (item.servingGrams ?? item.grams ?? item.basisGrams ?? basis?.amount) === 'number'
        ? readNumber(item.servingGrams ?? item.grams ?? item.basisGrams ?? basis?.amount)
        : null,
      servingLabel: typeof basis?.labelVi === 'string' ? basis.labelVi : undefined,
      calories: readOptionalNumber(item.energyKcal ?? item.calories ?? nutrition?.calories),
      protein: readOptionalNumber(item.proteinG ?? item.protein ?? nutrition?.proteinG ?? macros?.proteinG),
      carbs: readOptionalNumber(item.carbsG ?? item.carbs ?? nutrition?.carbsG ?? macros?.carbohydrateG),
      fat: readOptionalNumber(item.fatG ?? item.fat ?? nutrition?.fatG ?? macros?.fatG),
      source: String(item.publisher ?? source?.publisher ?? root?.publisher ?? 'Viện Dinh dưỡng'),
      sourceUrl: typeof item.sourceUrl === 'string' ? item.sourceUrl : typeof item.pageUrl === 'string' ? item.pageUrl : typeof source?.pageUrl === 'string' ? source.pageUrl : undefined,
      sourceId: typeof item.sourceId === 'string' ? item.sourceId : typeof source?.sourceId === 'string' ? source.sourceId : undefined,
      imageUrl: typeof item.imageUrl === 'string' ? item.imageUrl : undefined,
      detailBucket: typeof item.detailBucket === 'string' ? item.detailBucket : undefined,
    }
  }).filter((item): item is NutritionFoodCatalogItem => Boolean(item))
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

function toLocalDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateFromLocalKey(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, Math.max(0, month - 1), day, 12, 0, 0, 0)
}

function loadPendingScanReview(ownerId: string): PersistedScanReview | null {
  const storageKey = scanReviewSessionKey(ownerId)
  try {
    window.sessionStorage.removeItem(LEGACY_SCAN_REVIEW_SESSION_KEY)
    const value = JSON.parse(window.sessionStorage.getItem(storageKey) ?? 'null') as unknown
    const record = asRecord(value)
    const valid = record
      && record.ownerId === ownerId
      && Array.isArray(record.items)
      && record.items.length > 0
      && (record.resultMode === 'live' || record.resultMode === 'demo')
      && /^\d{4}-\d{2}-\d{2}$/.test(String(record.mealDate ?? ''))
      && ['breakfast', 'lunch', 'dinner', 'snack'].includes(String(record.mealType ?? ''))
    if (!valid) {
      window.sessionStorage.removeItem(storageKey)
      return null
    }
    return value as PersistedScanReview
  } catch {
    try {
      window.sessionStorage.removeItem(storageKey)
    } catch {
      // Ignore unavailable session storage.
    }
    return null
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

let catalogRequest: Promise<NutritionFoodCatalogItem[]> | null = null

function loadNutritionCatalog() {
  if (!catalogRequest) {
    catalogRequest = fetch(`${import.meta.env.BASE_URL}data/nutrition-catalog.json`)
      .then((response) => {
        if (!response.ok) throw new Error('catalog_unavailable')
        return response.json() as Promise<unknown>
      })
      .then((payload) => {
        const items = normalizeCatalogPayload(payload)
        if (!items.length) throw new Error('catalog_empty')
        return items
      })
      .catch((error: unknown) => {
        catalogRequest = null
        throw error
      })
  }
  return catalogRequest
}

function nutritionFoodIdFromHash() {
  const query = window.location.hash.split('?')[1] ?? ''
  return new URLSearchParams(query).get('foodId')
}

type NutritionRouteSection = 'today' | 'diary' | 'scan' | 'catalog' | 'plan' | 'insights' | 'assistant' | 'profile'
type NutritionPrimarySection = Extract<NutritionRouteSection, NutritionWorkspaceSection>

const NUTRITION_ROUTE_SECTIONS = new Set<NutritionRouteSection>(['today', 'diary', 'scan', 'catalog', 'plan', 'insights', 'assistant', 'profile'])

function nutritionSectionFromHash(): NutritionRouteSection {
  const query = window.location.hash.split('?')[1] ?? ''
  const rawSection = new URLSearchParams(query).get('section')
  return NUTRITION_ROUTE_SECTIONS.has(rawSection as NutritionRouteSection) ? rawSection as NutritionRouteSection : 'today'
}

function nutritionSectionHash(section: NutritionRouteSection) {
  return section === 'today' ? '#/nutrition' : `#/nutrition?section=${section}`
}

function toWorkspaceSection(section: NutritionRouteSection): NutritionWorkspaceSection {
  return section === 'diary' || section === 'plan' || section === 'catalog' || section === 'insights' ? section : 'today'
}

function toFoodDetailSummary(food: NutritionFoodCatalogItem): NutritionFoodDetailSummary {
  const inferredKind = food.kind ?? (food.servingGrams === null ? 'dish' : 'food')
  const sourceId = food.sourceId ?? food.id.split(':').at(-1) ?? ''
  const detailBucket = food.detailBucket ?? [...sourceId].reverse().find((character) => /[0-9a-f]/i.test(character))?.toLowerCase() ?? 'other'
  return {
    id: food.id,
    kind: inferredKind,
    detailBucket,
    code: food.code,
    nameVi: food.name,
    nameEn: food.nameEn,
    category: food.category,
    region: food.region,
    basis: {
      amount: food.servingGrams,
      unit: food.servingGrams === null ? null : 'g',
      qualifier: inferredKind === 'food' ? 'edible_raw_fresh' : 'not_specified_by_source',
      labelVi: food.servingLabel ?? (inferredKind === 'food' ? '100 g phần ăn được' : 'Khẩu phần tham chiếu theo nguồn'),
    },
    energyKcal: food.calories,
    macros: {
      proteinG: food.protein,
      carbohydrateG: food.carbs,
      fatG: food.fat,
    },
    imageUrl: food.imageUrl,
    sourceUrl: food.sourceUrl,
  }
}

function detailNutrientValue(record: NutritionFoodDetailRecord, key: string) {
  const value = record.nutrients?.find((nutrient) => nutrient.key === key)?.value
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isNutritionDetailRecord(value: unknown): value is NutritionFoodDetailRecord {
  const record = asRecord(value)
  return Boolean(record
    && typeof record.id === 'string'
    && typeof record.nameVi === 'string'
    && (record.kind === 'dish' || record.kind === 'food'))
}

function findNutritionDetailRecord(payload: unknown, id: string) {
  if (Array.isArray(payload)) return payload.find((record) => isNutritionDetailRecord(record) && record.id === id) ?? null
  const root = asRecord(payload)
  if (!root) return null
  if (Array.isArray(root.records)) return root.records.find((record) => isNutritionDetailRecord(record) && record.id === id) ?? null
  return isNutritionDetailRecord(root[id]) ? root[id] : null
}

function nutritionDetailBucketUrl(bucket: string) {
  const basePath = String(import.meta.env.BASE_URL ?? '/').replace(/\/$/, '')
  return `${basePath}/data/nutrition-details/${encodeURIComponent(bucket.replace(/\.json$/i, ''))}.json`
}

function scaleOptionalNumber(value: number | null | undefined, multiplier: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * multiplier * 10) / 10 : null
}

function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

type NutritionAssistantIntent = 'hydration' | 'protein' | 'carbs' | 'fat' | 'fiber' | 'sugar' | 'sodium' | 'workout' | 'allergy' | 'next-meal' | 'energy' | 'getting-started' | 'general'

function resolveNutritionAssistantIntent(question: string): NutritionAssistantIntent {
  const value = normalizeSearch(question)
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

function getCalendarStart(date = new Date()) {
  const start = new Date(date)
  start.setHours(12, 0, 0, 0)
  const day = start.getDay()
  const distanceFromMonday = day === 0 ? 6 : day - 1
  start.setDate(start.getDate() - distanceFromMonday)
  return toLocalDateKey(start)
}

function getWeekDays(startDateKey: string, todayKey: string) {
  const VI_WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
  const startDate = dateFromLocalKey(startDateKey)
  startDate.setHours(12, 0, 0, 0)
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(startDate)
    date.setDate(startDate.getDate() + index)
    const shortDay = VI_WEEKDAYS[date.getDay()]
    const id = toLocalDateKey(date)
    return { id, day: shortDay, date: date.getDate(), isToday: id === todayKey, fullDate: date }
  })
}

function getRecentDateKeys(endDateKey: string, count: number) {
  const end = dateFromLocalKey(endDateKey)
  return Array.from({ length: Math.max(1, count) }, (_, index) => {
    const date = new Date(end)
    date.setDate(end.getDate() - (count - index - 1))
    return toLocalDateKey(date)
  })
}

function NutritionOnboarding({ onComplete, initialProfile = DEFAULT_PROFILE, onCancel, editing = false }: { onComplete: (profile: NutritionProfileDraft) => void; initialProfile?: NutritionProfileDraft; onCancel?: () => void; editing?: boolean }) {
  const [step, setStep] = useState(1)
  const [profile, setProfile] = useState<NutritionProfileDraft>(initialProfile)

  const setField = <K extends keyof NutritionProfileDraft>(field: K, value: NutritionProfileDraft[K]) => {
    setProfile((current) => ({ ...current, [field]: value }))
  }

  return (
    <div className="nutrition-onboarding-shell" data-testid="nutrition-onboarding">
      <div className="nutrition-onboarding-decoration nutrition-onboarding-decoration--one" />
      <div className="nutrition-onboarding-decoration nutrition-onboarding-decoration--two" />
      <section className="nutrition-onboarding" aria-labelledby="nutrition-onboarding-title">
        <header className="nutrition-onboarding__header">
          <span className="nutrition-ai-mark"><Sparkles size={16} /> {editing ? 'Cập nhật kế hoạch' : 'Aura Nutrition AI'}</span>
          <span className="nutrition-onboarding__step">Bước {step} / 3</span>
          <div className="nutrition-onboarding__progress" aria-label={`Tiến độ ${Math.round((step / 3) * 100)}%`}>
            <span style={{ width: `${(step / 3) * 100}%` }} />
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
                    onClick={() => setField('goal', option.value)}
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
                  <option value="low">Ít vận động</option>
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

        <footer className="nutrition-onboarding__footer">
          <button type="button" className="nutrition-secondary-button" onClick={() => step === 1 && onCancel ? onCancel() : setStep((current) => Math.max(1, current - 1))} disabled={step === 1 && !onCancel}>
            {step === 1 && onCancel ? <X size={17} /> : <ArrowLeft size={17} />} {step === 1 && onCancel ? 'Hủy' : 'Quay lại'}
          </button>
          <button type="button" className="nutrition-primary-button" onClick={() => step < 3 ? setStep((current) => current + 1) : onComplete(profile)}>
            {step < 3 ? 'Tiếp tục' : 'Tạo kế hoạch của tôi'} {step < 3 ? <ArrowRight size={17} /> : <Sparkles size={17} />}
          </button>
        </footer>
      </section>
    </div>
  )
}

function useAccessibleDialog(onClose: () => void) {
  const dialogRef = useRef<HTMLElement | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const focusables = () => [...dialog.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => !element.hidden && element.offsetParent !== null && element.tabIndex >= 0)
    const initialFocus = dialog.querySelector<HTMLElement>('[data-dialog-autofocus]') ?? focusables()[0]
    window.requestAnimationFrame(() => initialFocus?.focus())

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const elements = focusables()
      if (!elements.length) {
        event.preventDefault()
        return
      }
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previousActive?.focus()
    }
  }, [])

  return dialogRef
}

function QuickAddSheet({ savedCount, onClose, onScan, onCatalog, onSaved, onWater, onExercise }: { savedCount: number; onClose: () => void; onScan?: () => void; onCatalog: () => void; onSaved: () => void; onWater: () => void; onExercise: () => void }) {
  const dialogRef = useAccessibleDialog(onClose)
  const actions = [
    ...(onScan ? [{ title: 'Chụp / Quét ảnh món ăn', copy: 'Phân tích calo & dinh dưỡng bằng AI', icon: <Camera size={22} />, action: onScan, featured: true }] : []),
    { title: 'Tìm món ăn', copy: 'Tra 2.103 món & thực phẩm', icon: <Search size={22} />, action: onCatalog, primary: true },
    { title: 'Ghi luyện tập', copy: 'Thời gian & cường độ', icon: <Dumbbell size={22} />, action: onExercise },
    { title: 'Ghi lượng nước', copy: '250, 500, 750 ml hoặc tùy chỉnh', icon: <Droplets size={22} />, action: onWater },
    { title: 'Món đã lưu', copy: savedCount ? `${savedCount} món trong thư viện` : 'Chưa có món đã lưu', icon: <Bookmark size={22} />, action: onSaved, wide: true },
  ]
  return (
    <div className="nutrition-sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="nutrition-quick-sheet" role="dialog" aria-modal="true" aria-labelledby="nutrition-quick-sheet-title">
        <header><div><span className="nutrition-kicker">THÊM NHANH</span><h2 id="nutrition-quick-sheet-title">Bạn muốn ghi lại gì?</h2></div><button type="button" onClick={onClose} aria-label="Đóng bảng thêm nhanh"><X size={20} /></button></header>
        <div className="nutrition-quick-sheet__grid">
          {actions.map((item, index) => <button type="button" key={item.title} className={`${item.featured ? 'is-featured' : ''} ${item.primary ? 'is-primary' : ''} ${item.wide ? 'is-wide' : ''}`} data-dialog-autofocus={index === 0 ? '' : undefined} onClick={() => { onClose(); item.action() }}><span>{item.icon}</span><strong>{item.title}</strong><small>{item.copy}</small></button>)}
        </div>
      </section>
    </div>
  )
}

function WaterLogSheet({ current, goal, dateLabel, onClose, onLog }: { current: number; goal: number; dateLabel: string; onClose: () => void; onLog: (amount: number) => void }) {
  const [amount, setAmount] = useState(250)
  const dialogRef = useAccessibleDialog(onClose)
  const safeAmount = Number.isFinite(amount) ? Math.min(5000, Math.max(0, Math.round(amount))) : 0
  return (
    <div className="nutrition-sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="nutrition-water-sheet" role="dialog" aria-modal="true" aria-labelledby="nutrition-water-sheet-title" aria-describedby="nutrition-water-sheet-description">
        <header><div><span className="nutrition-kicker">HYDRATION</span><h2 id="nutrition-water-sheet-title">Ghi lượng nước</h2></div><button type="button" onClick={onClose} aria-label="Đóng bảng ghi nước"><X size={20} /></button></header>
        <p id="nutrition-water-sheet-description">Trong {dateLabel.toLocaleLowerCase('vi-VN')}, bạn đã uống <strong>{formatNumber(current)} / {formatNumber(goal)} ml</strong>.</p>
        <label className="nutrition-water-sheet__input"><span>Lượng muốn thêm</span><div><input type="number" inputMode="numeric" min="1" max="5000" step="50" value={amount || ''} onChange={(event) => setAmount(Number(event.target.value))} aria-describedby="nutrition-water-limit" /><b>ml</b></div><small id="nutrition-water-limit">Tối đa 5.000 ml mỗi lần ghi.</small></label>
        <div className="nutrition-water-presets" role="group" aria-label="Chọn nhanh lượng nước">
          {[250, 500, 750].map((preset) => <button type="button" key={preset} className={amount === preset ? 'active' : ''} aria-pressed={amount === preset} onClick={() => setAmount(preset)}><Droplets size={18} /><strong>+{preset} ml</strong><small>{preset === 250 ? '1 ly' : preset === 500 ? '1 chai' : '1 bình lớn'}</small></button>)}
        </div>
        <button type="button" className="nutrition-water-sheet__submit" disabled={safeAmount <= 0} onClick={() => onLog(safeAmount)}>Ghi +{formatNumber(safeAmount)} ml</button>
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

interface MealEditorContext {
  date: string
  mealType: NutritionMealDraft['mealType']
  time: string
}

function MealEditorSheet({ food, initialDate, onClose, onConfirm }: { food: NutritionFoodCatalogItem; initialDate: string; onClose: () => void; onConfirm: (food: NutritionFoodCatalogItem, context: MealEditorContext) => void }) {
  const [date, setDate] = useState(initialDate)
  const [mealType, setMealType] = useState<NutritionMealDraft['mealType']>('lunch')
  const [time, setTime] = useState(() => new Date().toTimeString().slice(0, 5))
  const dialogRef = useAccessibleDialog(onClose)
  const hasCompleteCoreNutrition = canLogCatalogFood(food)

  return (
    <div className="nutrition-sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="nutrition-meal-editor" role="dialog" aria-modal="true" aria-labelledby="nutrition-meal-editor-title">
        <header><div><span className="nutrition-kicker">THÊM VÀO NHẬT KÝ</span><h2 id="nutrition-meal-editor-title">Kiểm tra bữa ăn</h2></div><button type="button" onClick={onClose} aria-label="Đóng"><X size={20} /></button></header>
        <div className="nutrition-meal-editor__food">
          <span><NutritionGroupIcon categoryName={food.category?.nameVi} kind={food.kind ?? 'food'} size={24} /></span>
          <div><strong>{food.name}</strong><p>{food.servingLabel ?? (food.servingGrams !== null ? `${formatNumber(food.servingGrams)} g` : 'Khẩu phần theo nguồn')} · {food.calories === null ? 'Chưa có kcal' : `${formatNumber(food.calories)} kcal`}</p></div>
        </div>
        <div className="nutrition-meal-editor__grid">
          <label><span>Ngày</span><input data-dialog-autofocus type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label><span>Thời gian</span><input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label>
          <label><span>Loại bữa</span><select value={mealType} onChange={(event) => setMealType(event.target.value as NutritionMealDraft['mealType'])}><option value="breakfast">Bữa sáng</option><option value="lunch">Bữa trưa</option><option value="dinner">Bữa tối</option><option value="snack">Bữa phụ</option></select></label>
          <div><span>Nguồn dữ liệu</span><strong>{food.source ?? 'Viện Dinh dưỡng Quốc gia'}</strong><small>Giá trị được lưu thành snapshot tại thời điểm ghi.</small></div>
        </div>
        <p className="nutrition-meal-editor__notice"><Info size={14} /> {hasCompleteCoreNutrition ? 'Dữ liệu được lưu thành snapshot; vi chất còn thiếu vẫn giữ là “—”.' : 'Bản ghi nguồn còn thiếu kcal hoặc macro nên chưa thể thêm vào nhật ký; Aura không tự chuyển phần thiếu thành 0.'}</p>
        <button type="button" className="nutrition-primary-button" disabled={!date || !time || !hasCompleteCoreNutrition} onClick={() => onConfirm(food, { date, mealType, time })}><Check size={17} /> Thêm vào nhật ký</button>
      </section>
    </div>
  )
}

interface MealLogEditDraft {
  date: string
  time: string
  mealType: NutritionMealDraft['mealType']
  portionMultiplier: number
}

function MealLogEditorSheet({ meal, onClose, onConfirm }: { meal: MealLog; onClose: () => void; onConfirm: (draft: MealLogEditDraft) => void }) {
  const [date, setDate] = useState(meal.date)
  const [time, setTime] = useState(meal.time)
  const [mealType, setMealType] = useState(meal.type)
  const [portionMultiplier, setPortionMultiplier] = useState(1)
  const dialogRef = useAccessibleDialog(onClose)
  const safeMultiplier = Math.min(10, Math.max(.1, Number.isFinite(portionMultiplier) ? portionMultiplier : 1))

  return (
    <div className="nutrition-sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="nutrition-meal-editor" role="dialog" aria-modal="true" aria-labelledby="nutrition-meal-log-editor-title">
        <header><div><span className="nutrition-kicker">CHỈNH NHẬT KÝ</span><h2 id="nutrition-meal-log-editor-title">{meal.title}</h2></div><button type="button" onClick={onClose} aria-label="Đóng"><X size={20} /></button></header>
        <div className="nutrition-meal-editor__food">
          <span><Scale size={24} /></span>
          <div><strong>{formatNumber(meal.calories * safeMultiplier)} kcal</strong><p>{formatNumber(meal.protein * safeMultiplier)}g đạm · {formatNumber(meal.carbs * safeMultiplier)}g carb · {formatNumber(meal.fat * safeMultiplier)}g béo</p></div>
        </div>
        <div className="nutrition-meal-editor__grid">
          <label><span>Ngày</span><input data-dialog-autofocus type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label><span>Thời gian</span><input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label>
          <label><span>Loại bữa</span><select value={mealType} onChange={(event) => setMealType(event.target.value as NutritionMealDraft['mealType'])}><option value="breakfast">Bữa sáng</option><option value="lunch">Bữa trưa</option><option value="dinner">Bữa tối</option><option value="snack">Bữa phụ</option></select></label>
          <label><span>Hệ số khẩu phần</span><input type="number" min="0.1" max="10" step="0.1" value={portionMultiplier} onChange={(event) => setPortionMultiplier(Number(event.target.value))} /></label>
        </div>
        <p className="nutrition-meal-editor__notice"><Info size={14} /> Khẩu phần thay đổi sẽ scale kcal, macro, vi chất và từng thành phần theo cùng tỷ lệ.</p>
        <button type="button" className="nutrition-primary-button" disabled={!date || !time || portionMultiplier < .1 || portionMultiplier > 10} onClick={() => onConfirm({ date, time, mealType, portionMultiplier: safeMultiplier })}><Check size={17} /> Lưu thay đổi</button>
      </section>
    </div>
  )
}

function getDynamicQuestionOptions(questionText: string, rawBaseCalories: number) {
  const norm = questionText.toLowerCase()
  const baseCalories = Math.max(80, rawBaseCalories || 300)

  // 1. Meat Cut / Fat Type check (sườn nạc vs sườn mỡ, thịt nạc vs mỡ/da)
  if (
    norm.includes('nạc') ||
    norm.includes('nhiều mỡ') ||
    norm.includes('phần mỡ') ||
    norm.includes('sườn mỡ') ||
    norm.includes('da gà') ||
    norm.includes('da heo') ||
    norm.includes('ba chỉ') ||
    norm.includes('thịt mỡ')
  ) {
    const fattyCal = Math.min(100, Math.max(25, Math.round(baseCalories * 0.15)))
    const fattyFat = Math.max(3, Math.round(fattyCal / 9))
    const leanCal = -Math.min(80, Math.max(20, Math.round(baseCalories * 0.12)))
    const leanFat = -Math.max(2, Math.round(Math.abs(leanCal) / 9))

    return [
      { id: 'fatty-cut', label: 'Nhiều phần mỡ / ăn cả da', calorieDelta: fattyCal, proteinDelta: 0, carbsDelta: 0, fatDelta: fattyFat, badge: `+${fattyCal} kcal, +${fattyFat}g béo` },
      { id: 'std-cut', label: 'Vừa nạc vừa mỡ (AI đã tính)', calorieDelta: 0, proteinDelta: 0, carbsDelta: 0, fatDelta: 0, badge: 'Giữ nguyên' },
      { id: 'lean-cut', label: 'Thịt nạc / bỏ bớt mỡ & da', calorieDelta: leanCal, proteinDelta: 1, carbsDelta: 0, fatDelta: leanFat, badge: `${leanCal} kcal, ${leanFat}g béo` },
    ]
  }

  // 2. Sauce / Gravy / Dipping Sauce check (nước xốt, xốt rim, sốt, nước kho, rưới lên)
  if (
    norm.includes('xốt') ||
    norm.includes('sốt') ||
    norm.includes('rim') ||
    norm.includes('rưới') ||
    norm.includes('chan') ||
    norm.includes('nước kho') ||
    norm.includes('nước mắm')
  ) {
    const sauceCal = Math.min(90, Math.max(20, Math.round(baseCalories * 0.14)))
    const sauceFat = Math.max(2, Math.round(sauceCal * 0.5 / 9))
    const sauceCarb = Math.max(2, Math.round(sauceCal * 0.5 / 4))

    const noSauceCal = -Math.min(70, Math.max(15, Math.round(baseCalories * 0.10)))
    const noSauceFat = -Math.max(2, Math.round(Math.abs(noSauceCal) * 0.5 / 9))
    const noSauceCarb = -Math.max(2, Math.round(Math.abs(noSauceCal) * 0.5 / 4))

    return [
      { id: 'more-sauce', label: 'Rưới nhiều nước xốt / đẫm vị', calorieDelta: sauceCal, proteinDelta: 0, carbsDelta: sauceCarb, fatDelta: sauceFat, badge: `+${sauceCal} kcal` },
      { id: 'std-sauce', label: 'Lượng xốt vừa phải (AI đã tính)', calorieDelta: 0, proteinDelta: 0, carbsDelta: 0, fatDelta: 0, badge: 'Giữ nguyên' },
      { id: 'less-sauce', label: 'Ít xốt / không rưới nước xốt', calorieDelta: noSauceCal, proteinDelta: 0, carbsDelta: noSauceCarb, fatDelta: noSauceFat, badge: `${noSauceCal} kcal` },
    ]
  }

  // 3. Soup / Broth check (nước dùng, nước lèo, nước canh, húp)
  if (
    norm.includes('nước dùng') ||
    norm.includes('nước lèo') ||
    norm.includes('nước canh') ||
    norm.includes('húp')
  ) {
    const brothCal = Math.min(60, Math.max(15, Math.round(baseCalories * 0.10)))
    const noBrothCal = -Math.min(50, Math.max(15, Math.round(baseCalories * 0.08)))

    return [
      { id: 'full-broth', label: 'Uống hết toàn bộ nước dùng', calorieDelta: brothCal, proteinDelta: 0, carbsDelta: 2, fatDelta: 3, badge: `+${brothCal} kcal` },
      { id: 'std-broth', label: 'Húp 1/2 nước dùng (AI đã tính)', calorieDelta: 0, proteinDelta: 0, carbsDelta: 0, fatDelta: 0, badge: 'Giữ nguyên' },
      { id: 'no-broth', label: 'Chỉ ăn cái, bỏ nước dùng', calorieDelta: noBrothCal, proteinDelta: 0, carbsDelta: -1, fatDelta: -3, badge: `${noBrothCal} kcal` },
    ]
  }

  // 4. Sugar / Sweetness / Drink check (đường, ngọt, sữa, trà sữa, cà phê, nước ngọt - not broth or sauce)
  if (
    norm.includes('đường') ||
    norm.includes('ngọt') ||
    norm.includes('sữa') ||
    norm.includes('trà') ||
    norm.includes('cà phê') ||
    norm.includes('sinh tố') ||
    norm.includes('chè')
  ) {
    const moreCal = Math.min(100, Math.max(20, Math.round(baseCalories * 0.15)))
    const moreCarb = Math.max(4, Math.round(moreCal / 4))
    const lessCal = -Math.min(70, Math.max(15, Math.round(baseCalories * 0.10)))
    const lessCarb = -Math.max(3, Math.round(Math.abs(lessCal) / 4))

    return [
      { id: 'more-sugar', label: 'Nhiều đường / ngọt đậm (100% đường)', calorieDelta: moreCal, proteinDelta: 0, carbsDelta: moreCarb, fatDelta: 0, badge: `+${moreCal} kcal, +${moreCarb}g carb` },
      { id: 'std-sugar', label: 'Độ ngọt vừa (AI đã tính)', calorieDelta: 0, proteinDelta: 0, carbsDelta: 0, fatDelta: 0, badge: 'Giữ nguyên' },
      { id: 'less-sugar', label: 'Ít ngọt / ít sữa (30% - 50% đường)', calorieDelta: lessCal, proteinDelta: 0, carbsDelta: lessCarb, fatDelta: 0, badge: `${lessCal} kcal, ${lessCarb}g carb` },
      { id: 'no-sugar', label: 'Không đường / không sữa', calorieDelta: -Math.round(moreCal * 1.2), proteinDelta: 0, carbsDelta: -Math.round(moreCarb * 1.2), fatDelta: 0, badge: `-${Math.round(moreCal * 1.2)} kcal` },
    ]
  }

  // 5. Oil / Frying / Cooking method check
  if (
    norm.includes('dầu') ||
    norm.includes('mỡ hành') ||
    norm.includes('chiên') ||
    norm.includes('xào') ||
    norm.includes('nướng bơ') ||
    norm.includes('ngập dầu')
  ) {
    const moreCal = Math.min(120, Math.max(25, Math.round(baseCalories * 0.18)))
    const moreFat = Math.max(3, Math.round(moreCal / 9))
    const lessCal = -Math.min(90, Math.max(20, Math.round(baseCalories * 0.14)))
    const lessFat = -Math.max(2, Math.round(Math.abs(lessCal) / 9))

    return [
      { id: 'more-oil', label: 'Chiên ngập dầu / nhiều mỡ hành', calorieDelta: moreCal, proteinDelta: 0, carbsDelta: 0, fatDelta: moreFat, badge: `+${moreCal} kcal, +${moreFat}g béo` },
      { id: 'std-oil', label: 'Dầu mỡ vừa phải (AI đã tính)', calorieDelta: 0, proteinDelta: 0, carbsDelta: 0, fatDelta: 0, badge: 'Giữ nguyên' },
      { id: 'less-oil', label: 'Luộc / hấp / ít dầu mỡ', calorieDelta: lessCal, proteinDelta: 0, carbsDelta: 0, fatDelta: lessFat, badge: `${lessCal} kcal, ${lessFat}g béo` },
    ]
  }

  // 6. Topping / Add-ons check
  if (
    norm.includes('trứng') ||
    norm.includes('chả') ||
    norm.includes('quẩy') ||
    norm.includes('phô mai') ||
    norm.includes('topping') ||
    norm.includes('ăn kèm')
  ) {
    const topCal = Math.min(100, Math.max(30, Math.round(baseCalories * 0.16)))
    const topPro = Math.max(3, Math.round(topCal * 0.3 / 4))
    const topFat = Math.max(3, Math.round(topCal * 0.5 / 9))

    return [
      { id: 'add-topping', label: 'Có ăn kèm topping (Trứng/Chả...)', calorieDelta: topCal, proteinDelta: topPro, carbsDelta: 2, fatDelta: topFat, badge: `+${topCal} kcal, +${topPro}g đạm` },
      { id: 'std-topping', label: 'Theo đĩa chuẩn (AI đã tính)', calorieDelta: 0, proteinDelta: 0, carbsDelta: 0, fatDelta: 0, badge: 'Giữ nguyên' },
      { id: 'no-topping', label: 'Bỏ phần ăn kèm', calorieDelta: -topCal, proteinDelta: -topPro, carbsDelta: -2, fatDelta: -topFat, badge: `-${topCal} kcal` },
    ]
  }

  // 7. Portion size check
  if (
    norm.includes('khẩu phần') ||
    norm.includes('kích thước') ||
    norm.includes('phần ăn') ||
    norm.includes('tô') ||
    norm.includes('bát') ||
    norm.includes('đĩa') ||
    norm.includes('chén') ||
    norm.includes('cơm') ||
    norm.includes('ăn hết') ||
    norm.includes('bao nhiêu')
  ) {
    const largeCal = Math.max(25, Math.round(baseCalories * 0.25))
    const largePro = Math.max(2, Math.round(largeCal * 0.08))
    const largeCarb = Math.max(3, Math.round(largeCal * 0.14))

    const smallCal = -Math.max(20, Math.round(baseCalories * 0.25))
    const smallPro = -Math.max(1, Math.round(Math.abs(smallCal) * 0.08))
    const smallCarb = -Math.max(2, Math.round(Math.abs(smallCal) * 0.14))

    return [
      { id: 'large-portion', label: 'Khẩu phần lớn (+25%)', calorieDelta: largeCal, proteinDelta: largePro, carbsDelta: largeCarb, fatDelta: 2, badge: `+${largeCal} kcal, +${largePro}g đạm` },
      { id: 'std-portion', label: 'Khẩu phần vừa chuẩn đĩa', calorieDelta: 0, proteinDelta: 0, carbsDelta: 0, fatDelta: 0, badge: 'Giữ nguyên' },
      { id: 'small-portion', label: 'Khẩu phần nhỏ / ăn 1/2', calorieDelta: smallCal, proteinDelta: smallPro, carbsDelta: smallCarb, fatDelta: -2, badge: `${smallCal} kcal` },
    ]
  }

  // 8. Fallback default options
  const defaultMore = Math.max(15, Math.round(baseCalories * 0.10))
  const defaultLess = -Math.max(15, Math.round(baseCalories * 0.10))

  return [
    { id: 'full-eat', label: 'Ăn hết toàn bộ đĩa', calorieDelta: defaultMore, proteinDelta: 2, carbsDelta: 3, fatDelta: 1, badge: `+${defaultMore} kcal` },
    { id: 'std-eat', label: 'Theo tiêu chuẩn AI', calorieDelta: 0, proteinDelta: 0, carbsDelta: 0, fatDelta: 0, badge: 'Giữ nguyên' },
    { id: 'leftovers', label: 'Chừa lại 1 phần / bỏ bớt', calorieDelta: defaultLess, proteinDelta: -1, carbsDelta: -2, fatDelta: -3, badge: `${defaultLess} kcal` },
  ]
}

function FoodScanModal({ initialDate, storageOwnerId, allowDemo = false, onClose, onOpenCatalog, onSave, onAnalyzeImage, presentation = 'modal' }: { initialDate: string; storageOwnerId: string; allowDemo?: boolean; onClose: () => void; onOpenCatalog: () => void; onSave: (meal: NutritionMealDraft) => void; onAnalyzeImage?: NutritionPageProps['onAnalyzeImage']; presentation?: 'modal' | 'page' }) {
  const reviewStorageKey = scanReviewSessionKey(storageOwnerId)
  const [restoredReview] = useState(() => {
    const step = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('step')
    return step === 'review' ? loadPendingScanReview(storageOwnerId) : null
  })
  const [stage, setStage] = useState<'upload' | 'analyzing' | 'result' | 'error'>(() => {
    const step = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('step')
    if (step === 'review') return restoredReview ? 'result' : 'error'
    return 'upload'
  })
  const [previewUrl, setPreviewUrl] = useState<string>('')
  const [fileName, setFileName] = useState(restoredReview?.fileName ?? '')
  const [uploadError, setUploadError] = useState('')
  const [mealType, setMealType] = useState<NutritionMealDraft['mealType']>(() => restoredReview?.mealType ?? (() => {
    const hour = new Date().getHours()
    if (hour < 10) return 'breakfast'
    if (hour < 14) return 'lunch'
    if (hour < 17) return 'snack'
    return 'dinner'
  })())
  const [mealDate, setMealDate] = useState(restoredReview?.mealDate ?? initialDate)
  const [mealTime, setMealTime] = useState(restoredReview?.mealTime ?? new Date().toTimeString().slice(0, 5))
  const [items, setItems] = useState<AiFoodItem[]>(restoredReview?.items ?? INITIAL_ANALYSIS)
  const [resultMode, setResultMode] = useState<'live' | 'demo'>(restoredReview?.resultMode ?? 'demo')
  const [resultNotice, setResultNotice] = useState(restoredReview?.resultNotice ?? '')
  const [serverRange, setServerRange] = useState<{ low: number; high: number } | null>(restoredReview?.serverRange ?? null)
  const [baselineCalories, setBaselineCalories] = useState(restoredReview?.baselineCalories ?? 0)
  const [dishName, setDishName] = useState(restoredReview?.dishName ?? '')
  const [analysisConfidence, setAnalysisConfidence] = useState<number | null>(restoredReview?.analysisConfidence ?? null)
  const [analysisQuestions, setAnalysisQuestions] = useState<string[]>(restoredReview?.analysisQuestions ?? [])
  const [analysisWarnings, setAnalysisWarnings] = useState<string[]>(restoredReview?.analysisWarnings ?? [])
  const [analysisModel, setAnalysisModel] = useState<string | null>(restoredReview?.analysisModel ?? null)
  const [confirmedItemIds, setConfirmedItemIds] = useState<Set<string>>(() => new Set(restoredReview?.confirmedItemIds ?? []))
  const [questionResponses, setQuestionResponses] = useState<Record<string, NutritionClarificationResponse>>(restoredReview?.questionResponses ?? {})
  const [dynamicAnswers, setDynamicAnswers] = useState<Record<string, { optionId: string; calorieDelta: number; proteinDelta: number; carbsDelta: number; fatDelta: number; customText?: string }>>({})
  const [hasAnalysisResult, setHasAnalysisResult] = useState(Boolean(restoredReview))
  const [analysisError, setAnalysisError] = useState(() => {
    const step = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('step')
    return step === 'review' && !restoredReview ? 'Kết quả phân tích của phiên trước không còn trong tab này. Hãy chọn lại ảnh để phân tích; Aura chưa lưu món vào nhật ký.' : ''
  })
  const [lastFile, setLastFile] = useState<File | null>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputId = useId()
  const cameraInputId = useId()
  const analyzeTimerRef = useRef<number | null>(null)
  const dialogRef = useAccessibleDialog(onClose)

  const totals = useMemo(() => items.reduce((sum, item) => ({
    calories: sum.calories + item.calories,
    protein: sum.protein + item.protein,
    carbs: sum.carbs + item.carbs,
    fat: sum.fat + item.fat,
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 }), [items])

  const questionDeltas = useMemo(() => {
    return Object.values(dynamicAnswers).reduce((sum, res) => {
      if (!res) return sum
      let customCalorie = 0
      let customProtein = 0
      let customCarbs = 0
      let customFat = 0

      if (res.customText) {
        const text = res.customText.toLowerCase()
        if (text.includes('trung') || text.includes('trứng')) { customCalorie += 70; customProtein += 6; customFat += 5 }
        if (text.includes('bo da') || text.includes('không da') || text.includes('bỏ da')) { customCalorie -= 60; customFat -= 7 }
        if (text.includes('them com') || text.includes('thêm cơm')) { customCalorie += 90; customCarbs += 20 }
        if (text.includes('them thit') || text.includes('thêm thịt') || text.includes('ức gà')) { customCalorie += 100; customProtein += 18 }
      }

      return {
        calories: sum.calories + (res.calorieDelta ?? 0) + customCalorie,
        protein: sum.protein + (res.proteinDelta ?? 0) + customProtein,
        carbs: sum.carbs + (res.carbsDelta ?? 0) + customCarbs,
        fat: sum.fat + (res.fatDelta ?? 0) + customFat,
      }
    }, { calories: 0, protein: 0, carbs: 0, fat: 0 })
  }, [dynamicAnswers])

  const adjustedTotals = useMemo(() => ({
    calories: Math.max(10, Math.round(totals.calories + questionDeltas.calories)),
    protein: Math.max(0, Math.round((totals.protein + questionDeltas.protein) * 10) / 10),
    carbs: Math.max(0, Math.round((totals.carbs + questionDeltas.carbs) * 10) / 10),
    fat: Math.max(0, Math.round((totals.fat + questionDeltas.fat) * 10) / 10),
  }), [totals, questionDeltas])

  const mealHealthAssessment = useMemo(() => {
    const c = adjustedTotals.calories
    const p = adjustedTotals.protein
    const f = adjustedTotals.fat
    const carbs = adjustedTotals.carbs

    let score = 7.5
    if (p >= 25) score += 1.2
    else if (p >= 15) score += 0.6
    else if (p < 8) score -= 0.8

    if (f * 9 > c * 0.45) score -= 1.0
    if (c > 850) score -= 0.8
    if (p >= 18 && carbs >= 20 && f <= 20) score += 0.8

    const finalScore = Math.round(Math.min(10, Math.max(2, score)) * 10) / 10
    const badge = finalScore >= 8.5
      ? 'Rất lành mạnh 🥗'
      : finalScore >= 7.0
        ? 'Cân bằng 👍'
        : finalScore >= 5.5
          ? 'Cần chú ý calo/mỡ ⚖️'
          : 'Mật độ calo & béo cao ⚠️'
    
    const description = finalScore >= 8.5
      ? 'Bữa ăn giàu đạm, tỷ lệ chất béo tối ưu. Đạt chuẩn sức khỏe xuất sắc!'
      : finalScore >= 7.0
        ? 'Chỉ số dinh dưỡng cân đối. Đáp ứng tốt mục tiêu phát triển cơ bắp và duy trì năng lượng.'
        : 'Khẩu phần có lượng béo hoặc calo khá cao. Nên tăng cường uống nước và bổ sung rau xanh ở bữa sau.'

    return { score: finalScore, badge, description }
  }, [adjustedTotals])

  const adjustedRange = useMemo(() => {
    if (!serverRange || baselineCalories <= 0) return { low: Math.round(adjustedTotals.calories * .88), high: Math.round(adjustedTotals.calories * 1.12) }
    const multiplier = adjustedTotals.calories / baselineCalories
    return { low: Math.max(0, Math.round(serverRange.low * multiplier)), high: Math.max(0, Math.round(serverRange.high * multiplier)) }
  }, [baselineCalories, serverRange, adjustedTotals.calories])

  const unresolvedItems = items.filter((item) => (item.confidence === 'low' || item.calculationSource !== 'database') && !confirmedItemIds.has(item.id))
  const unresolvedQuestions: string[] = []
  const canSaveMeal = adjustedTotals.calories > 0
    && items.some((item) => item.name.trim().length > 0 && item.calories > 0)
    && unresolvedItems.length === 0
    && Boolean(mealDate && mealTime)
    && (resultMode === 'live' || allowDemo)

  useEffect(() => () => {
    if (analyzeTimerRef.current) window.clearTimeout(analyzeTimerRef.current)
  }, [])

  useEffect(() => {
    if (presentation !== 'page') return
    const query = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
    query.set('section', 'scan')
    if (stage === 'result') query.set('step', 'review')
    else if (stage === 'error') query.set('step', 'error')
    else query.delete('step')
    const nextHash = `#/nutrition?${query.toString()}`
    if (window.location.hash === nextHash) return
    if (stage === 'result') window.history.pushState(window.history.state, '', nextHash)
    else window.history.replaceState(window.history.state, '', nextHash)
  }, [presentation, stage])

  useEffect(() => {
    if (presentation !== 'page') return
    const syncStageFromRoute = () => {
      const step = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('step')
      if (step === 'review') {
        if (hasAnalysisResult) setStage('result')
        else {
          setAnalysisError('Kết quả phân tích không còn trong phiên này. Hãy chọn lại ảnh; Aura chưa lưu món vào nhật ký.')
          setStage('error')
        }
      } else if (step === 'error') setStage('error')
      else setStage('upload')
    }
    window.addEventListener('popstate', syncStageFromRoute)
    window.addEventListener('hashchange', syncStageFromRoute)
    return () => {
      window.removeEventListener('popstate', syncStageFromRoute)
      window.removeEventListener('hashchange', syncStageFromRoute)
    }
  }, [hasAnalysisResult, presentation])

  useEffect(() => {
    if (stage !== 'result' || !hasAnalysisResult) return
    const review: PersistedScanReview = {
      ownerId: storageOwnerId,
      dishName,
      items,
      resultMode,
      resultNotice,
      serverRange,
      baselineCalories,
      analysisConfidence,
      analysisQuestions,
      analysisWarnings,
      analysisModel,
      confirmedItemIds: [...confirmedItemIds],
      questionResponses,
      mealType,
      mealDate,
      mealTime,
      fileName,
    }
    try {
      window.sessionStorage.setItem(reviewStorageKey, JSON.stringify(review))
    } catch {
      // A review remains usable in memory even when session storage is unavailable.
    }
  }, [analysisConfidence, analysisModel, analysisQuestions, analysisWarnings, baselineCalories, confirmedItemIds, dishName, fileName, hasAnalysisResult, items, mealDate, mealTime, mealType, questionResponses, resultMode, resultNotice, reviewStorageKey, serverRange, stage, storageOwnerId])

  const startDemoAnalysis = (notice = 'Đây là dữ liệu minh họa để bạn trải nghiệm luồng chỉnh sửa. Chưa có kết quả từ mô hình AI.') => {
    setResultMode('demo')
    setResultNotice(notice)
    setServerRange(null)
    setBaselineCalories(INITIAL_ANALYSIS.reduce((sum, item) => sum + item.calories, 0))
    setDishName('')
    setAnalysisConfidence(null)
    setAnalysisQuestions(['Bạn có dùng hết phần sốt hoặc dầu trong đĩa không?'])
    setQuestionResponses({})
    setAnalysisWarnings([])
    setAnalysisModel(null)
    setConfirmedItemIds(new Set())
    setItems(INITIAL_ANALYSIS.map((item) => ({ ...item, perGram: perGramNutrition(item) })))
    setHasAnalysisResult(true)
    setStage('analyzing')
    if (analyzeTimerRef.current) window.clearTimeout(analyzeTimerRef.current)
    analyzeTimerRef.current = window.setTimeout(() => setStage('result'), 1450)
  }

  const runImageAnalysis = async (file: File) => {
    setLastFile(file)
    setAnalysisError('')
    setHasAnalysisResult(false)
    if (!onAnalyzeImage) {
      setAnalysisError('Tính năng AI chưa sẵn sàng trong phiên này. Hãy đăng nhập lại hoặc thử lại sau; ảnh của bạn chưa được phân tích.')
      setStage('error')
      return
    }
    setStage('analyzing')
    try {
      const response = await onAnalyzeImage(file, { mealType })
      const normalized = normalizeAnalysis(response)
      if (!normalized) {
        setAnalysisError(response.analysis?.isFood === false
          ? 'Aura chưa nhận ra món ăn trong ảnh này. Hãy chụp trọn phần ăn ở nơi đủ sáng hoặc tìm món thủ công trong thư viện.'
          : response.notices?.[0] ?? 'AI chưa trả về kết quả hợp lệ. Aura không thay thế bằng dữ liệu giả; vui lòng thử lại với ảnh rõ hơn.')
        setStage('error')
        return
      } else {
        setResultMode(response.mode === 'demo' ? 'demo' : 'live')
        setResultNotice(response.mode === 'demo' ? 'Nhà cung cấp trả về chế độ minh họa. Hãy kiểm tra kỹ trước khi lưu.' : '')
        setServerRange(normalized.range)
        setBaselineCalories(normalized.items.reduce((sum, item) => sum + item.calories, 0))
        setDishName(normalized.dishName)
        setItems(normalized.items)
        setAnalysisConfidence(normalized.confidence)
        setAnalysisQuestions(normalized.questions)
        setQuestionResponses({})
        setAnalysisWarnings([
          ...normalized.warnings,
          ...normalized.notices,
          ...(response.imageRetained ? ['Aura chưa xác nhận đã dọn xong ảnh tạm. Ảnh sẽ tiếp tục được xử lý theo chính sách vòng đời lưu trữ.'] : []),
        ])
        setAnalysisModel(normalized.model)
        setConfirmedItemIds(new Set(normalized.items.filter((item) => item.confidence !== 'low' && item.calculationSource === 'database').map((item) => item.id)))
        setHasAnalysisResult(true)
      }
      setStage('result')
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message
        : 'Không thể kết nối dịch vụ phân tích ảnh. Vui lòng kiểm tra mạng và thử lại.'
      setAnalysisError(message)
      setStage('error')
    }
  }

  const handleFile = (file?: File) => {
    if (!file) return
    setUploadError('')
    setHasAnalysisResult(false)
    clearPendingScanReview(storageOwnerId)
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type.toLowerCase())) {
      setUploadError('Vui lòng chọn tệp ảnh JPEG, PNG hoặc WebP.')
      setStage('upload')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      setUploadError('Ảnh lớn hơn 8 MB. Hãy chọn ảnh nhẹ hơn.')
      setStage('upload')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setPreviewUrl(String(reader.result ?? ''))
      setFileName(file.name)
      void runImageAnalysis(file)
    }
    reader.onerror = () => {
      setStage('upload')
      setUploadError('Không thể đọc tệp ảnh này. Vui lòng chọn một ảnh khác.')
    }
    reader.onabort = () => {
      setStage('upload')
      setUploadError('Việc đọc ảnh đã bị gián đoạn. Vui lòng thử lại.')
    }
    reader.readAsDataURL(file)
  }

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    handleFile(file)
  }

  const updateItem = (id: string, field: keyof Pick<AiFoodItem, 'name' | 'grams' | 'calories'>, value: string) => {
    setItems((current) => current.map((item) => {
      if (item.id !== id) return item
      if (field === 'name') return { ...item, name: value, calculationSource: 'manual' }
      const nextValue = Math.max(0, Number(value))
      const perGram = item.perGram ?? perGramNutrition(item)
      if (field === 'grams') {
        return {
          ...item,
          grams: nextValue,
          calories: Math.round(perGram.calories * nextValue * 10) / 10,
          protein: Math.round(perGram.protein * nextValue * 10) / 10,
          carbs: Math.round(perGram.carbs * nextValue * 10) / 10,
          fat: Math.round(perGram.fat * nextValue * 10) / 10,
          fiber: Math.round(perGram.fiber * nextValue * 10) / 10,
          sugar: Math.round(perGram.sugar * nextValue * 10) / 10,
          sodium: Math.round(perGram.sodium * nextValue),
          perGram,
          calculationSource: item.calculationSource === 'database' ? 'database' : item.calculationSource === 'mixed' ? 'mixed' : 'manual',
        }
      }
      const nextPerGram = { ...perGram, calories: item.grams > 0 ? nextValue / item.grams : 0 }
      return { ...item, calories: nextValue, perGram: nextPerGram, calculationSource: 'manual' }
    }))
    setConfirmedItemIds((current) => new Set(current).add(id))
  }

  const addItem = () => {
    setItems((current) => [...current, {
      id: `custom-${Date.now()}`,
      name: 'Thành phần mới',
      grams: 50,
      calories: 50,
      protein: 0,
      carbs: 0,
      fat: 0,
      confidence: 'low',
      calculationSource: 'manual',
      perGram: { calories: 1, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 },
    }])
  }

  const saveMeal = () => {
    if (!canSaveMeal) return
    clearPendingScanReview(storageOwnerId)
    onSave({
      name: items.map((item) => item.name.trim()).filter(Boolean).slice(0, 2).join(', '),
      mealType,
      mealDate,
      mealTime,
      image: previewUrl || undefined,
      calories: Math.round(adjustedTotals.calories),
      protein: Math.round(adjustedTotals.protein),
      carbs: Math.round(adjustedTotals.carbs),
      fat: Math.round(adjustedTotals.fat),
      calorieRange: adjustedRange,
      items,
      source: resultMode === 'live' ? 'ai-scan' : 'demo',
    })
  }

  return (
    <div className={presentation === 'page' ? 'nutrition-route-page nutrition-route-page--scan' : 'nutrition-modal-backdrop'} role="presentation" onMouseDown={(event) => presentation === 'modal' && event.target === event.currentTarget && onClose()}>
      <section ref={presentation === 'modal' ? dialogRef : undefined} className={`nutrition-scan-modal ${presentation === 'page' ? 'nutrition-scan-modal--page' : ''}`} role={presentation === 'modal' ? 'dialog' : 'region'} aria-modal={presentation === 'modal' ? true : undefined} aria-labelledby="nutrition-scan-title" data-testid="nutrition-scan-modal">
        <header className="nutrition-scan-modal__header">
          <div>
            <span className="nutrition-ai-mark"><Sparkles size={15} /> Aura Vision</span>
            <h2 id="nutrition-scan-title">{stage === 'result' ? 'Kiểm tra kết quả AI' : 'Phân tích món ăn'}</h2>
          </div>
          <button type="button" className="nutrition-close-button" onClick={onClose} aria-label={presentation === 'page' ? 'Quay lại trang dinh dưỡng' : 'Đóng'}>{presentation === 'page' ? <ArrowLeft size={20} /> : <X size={20} />}</button>
        </header>

        <input ref={galleryInputRef} id={galleryInputId} className="nutrition-visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" tabIndex={-1} aria-hidden="true" data-testid="nutrition-file-input" onChange={handleInputChange} />
        <input ref={cameraInputRef} id={cameraInputId} className="nutrition-visually-hidden" type="file" accept="image/jpeg,image/png" capture="environment" tabIndex={-1} aria-hidden="true" data-testid="nutrition-camera-input" onChange={handleInputChange} />

        {stage === 'upload' && (
          <div className="nutrition-upload-step">
            <label
              htmlFor={galleryInputId}
              className="nutrition-dropzone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); handleFile(event.dataTransfer.files[0]) }}
              aria-describedby="nutrition-upload-requirements"
            >
              <span className="nutrition-dropzone__icon"><ImagePlus size={28} /></span>
              <strong>Thả ảnh món ăn vào đây</strong>
              <small>hoặc chọn nguồn ảnh bên dưới</small>
              <em id="nutrition-upload-requirements">JPEG, PNG, WebP · tối đa 8 MB</em>
            </label>
            <div className="nutrition-upload-actions">
              <label htmlFor={galleryInputId} tabIndex={0} role="button" data-dialog-autofocus onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); galleryInputRef.current?.click() } }}><ImagePlus size={18} /><span><strong>Chọn từ thiết bị</strong><small>Thư viện ảnh hoặc tệp</small></span></label>
              <label htmlFor={cameraInputId} tabIndex={0} role="button" onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); cameraInputRef.current?.click() } }}><Camera size={18} /><span><strong>Chụp ảnh mới</strong><small>Mở camera sau</small></span></label>
            </div>
            {uploadError && <p className="nutrition-upload-error" role="alert"><CircleAlert size={15} /> {uploadError}</p>}
            <div className="nutrition-photo-tips">
              <div><Camera size={18} /><span><strong>Ảnh rõ và đủ sáng</strong><small>Chụp trọn đĩa ở góc 45°</small></span></div>
              <div><Scale size={18} /><span><strong>Có vật tham chiếu</strong><small>Muỗng hoặc kích thước bát</small></span></div>
              <div><Utensils size={18} /><span><strong>Tách phần ăn</strong><small>Tránh chụp cả mâm chung</small></span></div>
            </div>
            <p className="nutrition-upload-privacy"><Info size={15} /> Ảnh được xử lý qua máy chủ Aura và Gemini để nhận diện món. Aura tự động yêu cầu dọn ảnh tạm sau phân tích; nếu việc dọn dẹp bị gián đoạn, ảnh có thể được giữ đến đợt xóa theo vòng đời lưu trữ. Aura không tự ghi kết quả khi bạn chưa xác nhận.</p>
            {allowDemo && <button type="button" className="nutrition-demo-scan" onClick={() => startDemoAnalysis()} data-testid="nutrition-demo-scan"><ScanLine size={17} /> Xem kết quả phân tích mẫu</button>}
          </div>
        )}

        {stage === 'analyzing' && (
          <div className="nutrition-analyzing" aria-live="polite" data-testid="nutrition-scan-analyzing">
            <div className="nutrition-scan-preview">
              {previewUrl ? <img src={previewUrl} alt="Món ăn đang được phân tích" /> : <div className="nutrition-food-placeholder"><Salad size={48} /></div>}
              <span className="nutrition-scan-line" />
              <i><ScanLine size={23} /></i>
            </div>
            <LoaderCircle size={26} className="nutrition-spinner" />
            <h3>AI đang nhận diện món ăn…</h3>
            <p>Phân tách thành phần, ước tính khẩu phần và đối chiếu cơ sở dữ liệu dinh dưỡng.</p>
            <div className="nutrition-analysis-steps">
              <span className="done"><Check size={12} /> Kiểm tra ảnh</span>
              <span className="active"><Sparkles size={12} /> Nhận diện thành phần</span>
              <span>Ước tính năng lượng</span>
            </div>
          </div>
        )}

        {stage === 'error' && (
          <div className="nutrition-scan-error" role="alert" data-testid="nutrition-scan-error">
            <div className="nutrition-scan-error__visual">{previewUrl ? <img src={previewUrl} alt="Ảnh món ăn chưa phân tích thành công" /> : <CircleAlert size={38} />}</div>
            <span><CircleAlert size={22} /></span>
            <h3>Chưa thể phân tích ảnh</h3>
            <p>{analysisError}</p>
            <div>
              <button type="button" className="nutrition-primary-button" onClick={() => lastFile && void runImageAnalysis(lastFile)} disabled={!lastFile}><Sparkles size={17} /> Thử lại</button>
              <label className="nutrition-secondary-button" htmlFor={galleryInputId} tabIndex={0} role="button" onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); galleryInputRef.current?.click() } }}><ImagePlus size={17} /> Chọn ảnh khác</label>
              <button type="button" className="nutrition-secondary-button" onClick={onOpenCatalog}><Search size={17} /> Tìm món thủ công</button>
            </div>
            {allowDemo && <button type="button" className="nutrition-demo-scan" onClick={() => startDemoAnalysis('Bạn đã chủ động mở bản minh họa. Các số liệu này không được tạo từ ảnh vừa tải và cần được chỉnh sửa trước khi lưu.')}><Info size={16} /> Xem bản minh họa thay thế</button>}
          </div>
        )}

        {stage === 'result' && (
          <div className="nutrition-result-step" data-testid="nutrition-scan-result">
            <div className="nutrition-result-hero">
              <div className="nutrition-result-image">
                {previewUrl ? <img src={previewUrl} alt="Ảnh món ăn đã tải lên" /> : <div className="nutrition-food-placeholder"><Salad size={54} /></div>}
                <span>{resultMode === 'live' ? <><Check size={13} /> Đã phân tích bằng AI</> : <><Info size={13} /> Dữ liệu minh họa</>}</span>
              </div>
              <div className="nutrition-result-summary">
                <span className="nutrition-kicker">ƯỚC TÍNH TỔNG (ĐÃ ĐIỀU CHỈNH)</span>
                <strong>{formatNumber(adjustedTotals.calories)} <small>kcal</small></strong>
                <p>{dishName ? `${dishName} · ` : ''}Khoảng hợp lý {formatNumber(adjustedRange.low)}–{formatNumber(adjustedRange.high)} kcal</p>
                <div>
                  <span><b>{adjustedTotals.protein.toFixed(0)}g</b> Đạm</span>
                  <span><b>{adjustedTotals.carbs.toFixed(0)}g</b> Carb</span>
                  <span><b>{adjustedTotals.fat.toFixed(0)}g</b> Béo</span>
                </div>
              </div>
            </div>

            <div className={`nutrition-confidence-note ${resultMode === 'demo' ? 'nutrition-confidence-note--demo' : ''}`}>
              <Info size={16} />
              <span>{resultMode === 'live'
                ? `Độ tin cậy tổng thể ${analysisConfidence === null ? 'chưa xác định' : `${Math.round(analysisConfidence * 100)}%`}. ${unresolvedItems.length ? `${unresolvedItems.length} thành phần cần bạn xác nhận.` : 'Các thành phần chính đã đủ điều kiện để kiểm tra và lưu.'}`
                : resultNotice}</span>
            </div>

            <div className="nutrition-result-toolbar">
              <div><strong>Thành phần nhận diện</strong><small>{items.length} thành phần · có thể chỉnh sửa</small></div>
              <button type="button" onClick={addItem}><Plus size={15} /> Thêm</button>
            </div>

            <div className="nutrition-ingredient-list">
              {items.map((item) => (
                <div className="nutrition-ingredient" key={item.id}>
                  <span className={`nutrition-confidence-dot nutrition-confidence-dot--${item.confidence}`} title={`Độ tin cậy ${item.confidence}`} />
                  <label>
                    <span className="nutrition-visually-hidden">Tên thành phần</span>
                    <input value={item.name} onChange={(event) => updateItem(item.id, 'name', event.target.value)} />
                    <small>{item.confidence === 'high' ? 'Tin cậy cao' : item.confidence === 'medium' ? 'Tin cậy vừa' : 'Cần xác nhận'}{item.confidenceValue !== undefined ? ` · ${Math.round(item.confidenceValue * 100)}%` : ''}</small>
                    <small>{item.catalogMatch ? `Đối chiếu: ${item.catalogMatch.nameVi}` : item.catalogCandidates?.length ? `${item.catalogCandidates.length} ứng viên database` : 'AI ước tính · chưa có đối chiếu duy nhất'}</small>
                    <small>{nutritionEvidenceLabel(item)}</small>
                  </label>
                  <label className="nutrition-inline-field"><input type="number" min="0" value={item.grams} onChange={(event) => updateItem(item.id, 'grams', event.target.value)} /><span>g</span></label>
                  <label className="nutrition-inline-field"><input type="number" min="0" value={item.calories} onChange={(event) => updateItem(item.id, 'calories', event.target.value)} /><span>kcal</span></label>
                  {(item.confidence === 'low' || item.calculationSource !== 'database') && <button type="button" className={`nutrition-confirm-item ${confirmedItemIds.has(item.id) ? 'is-confirmed' : ''}`} onClick={() => setConfirmedItemIds((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next })} aria-pressed={confirmedItemIds.has(item.id)}>{confirmedItemIds.has(item.id) ? <Check size={15} /> : <CircleAlert size={15} />} {confirmedItemIds.has(item.id) ? 'Đã xác nhận' : item.calculationSource === 'ai-estimate' ? 'Dùng ước tính AI' : 'Xác nhận chỉnh sửa'}</button>}
                  <button type="button" className="nutrition-remove-item" onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))} aria-label={`Xóa ${item.name}`}><Trash2 size={16} /></button>
                </div>
              ))}
            </div>

            {/* Flexible Dynamic Q&A Section */}
            {!!analysisQuestions.length && (
              <div className="nutrition-result-questions">
                <div className="questions-section-header">
                  <Sparkles size={18} className="sparkles-icon" />
                  <div>
                    <strong>Aura cần bạn làm rõ chi tiết</strong>
                    <p>Chọn phương án thực tế hoặc gõ phản hồi riêng để Aura tự động tính lại Calo & Điểm sức khỏe.</p>
                  </div>
                </div>

                {analysisQuestions.map((question, index) => {
                  const options = getDynamicQuestionOptions(question, totals.calories)
                  const currentAns = dynamicAnswers[String(index)]
                  return (
                    <div className="nutrition-result-question-card" key={`q-${index}`}>
                      <div className="q-title">
                        <span className="q-badge">Câu {index + 1}</span>
                        <p>{question}</p>
                      </div>

                      <div className="q-options-grid">
                        {options.map((opt) => {
                          const selected = currentAns?.optionId === opt.id
                          return (
                            <button
                              type="button"
                              key={opt.id}
                              className={`q-option-pill ${selected ? 'is-selected' : ''}`}
                              onClick={() => {
                                setDynamicAnswers((prev) => ({
                                  ...prev,
                                  [String(index)]: {
                                    optionId: opt.id,
                                    calorieDelta: opt.calorieDelta,
                                    proteinDelta: opt.proteinDelta,
                                    carbsDelta: opt.carbsDelta,
                                    fatDelta: opt.fatDelta,
                                    customText: prev[String(index)]?.customText || '',
                                  },
                                }))
                              }}
                            >
                              <span className="opt-label">{opt.label}</span>
                              <span className="opt-badge">{opt.badge}</span>
                            </button>
                          )
                        })}
                      </div>

                      <div className="q-custom-text-box">
                        <input
                          type="text"
                          placeholder="Hoặc gõ chi tiết thêm (Ví dụ: Ăn thêm 1 trứng, bỏ da gà...)"
                          value={currentAns?.customText ?? ''}
                          onChange={(e) => {
                            const text = e.target.value
                            setDynamicAnswers((prev) => ({
                              ...prev,
                              [String(index)]: {
                                ...(prev[String(index)] || {
                                  optionId: 'custom',
                                  calorieDelta: 0,
                                  proteinDelta: 0,
                                  carbsDelta: 0,
                                  fatDelta: 0,
                                }),
                                customText: text,
                              },
                            }))
                          }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Live Re-evaluated Meal Health Score Banner */}
            <div className="nutrition-reevaluated-score-card">
              <div className="score-card-header">
                <div className="score-badge-circle">
                  <span className="score-num">{mealHealthAssessment.score}</span>
                  <span className="score-max">/10</span>
                </div>
                <div className="score-title-info">
                  <span className="score-pill-tag">{mealHealthAssessment.badge}</span>
                  <h4>Đánh giá chỉ số & Điểm sức khỏe bữa ăn</h4>
                  <p>{mealHealthAssessment.description}</p>
                </div>
              </div>

              <div className="evaluated-macros-row">
                <div className="eval-macro">
                  <span className="label">Tổng Calo:</span>
                  <strong className={questionDeltas.calories !== 0 ? 'is-adjusted' : ''}>
                    {formatNumber(adjustedTotals.calories)} kcal
                    {questionDeltas.calories !== 0 && (
                      <small className="delta-tag">
                        {questionDeltas.calories > 0 ? ` (+${questionDeltas.calories})` : ` (${questionDeltas.calories})`}
                      </small>
                    )}
                  </strong>
                </div>
                <div className="eval-macro">
                  <span className="label">Đạm:</span>
                  <strong>{adjustedTotals.protein}g</strong>
                </div>
                <div className="eval-macro">
                  <span className="label">Carb:</span>
                  <strong>{adjustedTotals.carbs}g</strong>
                </div>
                <div className="eval-macro">
                  <span className="label">Béo:</span>
                  <strong>{adjustedTotals.fat}g</strong>
                </div>
              </div>
            </div>

            {(analysisWarnings.length > 0 || items.some((item) => item.assumptions?.length)) && <details className="nutrition-analysis-evidence">
              <summary><Info size={15} /> Cách Aura tính và các giả định</summary>
              <div>
                {analysisWarnings.map((warning, index) => <p key={`warning-${index}`}><CircleAlert size={14} /> {warning}</p>)}
                {items.flatMap((item) => (item.assumptions ?? []).map((assumption) => `${item.name}: ${assumption}`)).map((assumption, index) => <p key={`assumption-${index}`}><Info size={14} /> {assumption}</p>)}
                <p><Check size={14} /> Nguồn: Gemini {analysisModel ? `(${analysisModel})` : ''} + đối chiếu database Viện Dinh dưỡng.</p>
              </div>
            </details>}

            <footer className="nutrition-result-footer">
              <label><span>Thêm vào</span><select value={mealType} onChange={(event) => setMealType(event.target.value as NutritionMealDraft['mealType'])}><option value="breakfast">Bữa sáng</option><option value="lunch">Bữa trưa</option><option value="dinner">Bữa tối</option><option value="snack">Bữa phụ</option></select></label>
              <label><span>Ngày</span><input type="date" value={mealDate} onChange={(event) => setMealDate(event.target.value)} /></label>
              <label><span>Thời gian</span><input type="time" value={mealTime} onChange={(event) => setMealTime(event.target.value)} /></label>
              <label className="nutrition-secondary-button" htmlFor={galleryInputId} tabIndex={0} role="button" onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); galleryInputRef.current?.click() } }}><ImagePlus size={17} /> Chọn ảnh khác</label>
              <button type="button" className="nutrition-primary-button" onClick={saveMeal} disabled={!canSaveMeal} title={!canSaveMeal ? resultMode === 'demo' && !allowDemo ? 'Dữ liệu minh họa không thể ghi vào nhật ký thật' : unresolvedItems.length ? 'Hãy xác nhận các thành phần có độ tin cậy thấp' : unresolvedQuestions.length ? 'Hãy trả lời các câu hỏi cần làm rõ' : 'Cần ngày, giờ và ít nhất một thành phần có tên cùng năng lượng lớn hơn 0' : undefined} data-testid="nutrition-save-scan"><Check size={17} /> Xác nhận và ghi nhật ký</button>
            </footer>
            <p className="nutrition-source-note">Dữ liệu dinh dưỡng sẽ được đối chiếu từ CSDL Viện Dinh dưỡng; kết quả AI luôn cần người dùng xác nhận.</p>
          </div>
        )}

        {stage !== 'result' && fileName && <small className="nutrition-file-name">{fileName}</small>}
      </section>
    </div>
  )
}

function scaleCatalogFood(food: NutritionFoodCatalogItem, multiplier: number): NutritionFoodCatalogItem {
  const safeMultiplier = Math.min(5, Math.max(0, Math.round(multiplier * 10) / 10))
  const scaledGrams = food.servingGrams === null ? null : Math.round(food.servingGrams * safeMultiplier * 10) / 10
  const basisLabel = food.servingGrams !== null
    ? `${formatDecimal(safeMultiplier)} khẩu phần · ${formatDecimal(scaledGrams ?? 0)} g`
    : `${formatDecimal(safeMultiplier)} suất theo nguồn`
  return {
    ...food,
    servingGrams: scaledGrams,
    servingLabel: basisLabel,
    calories: scaleOptionalNumber(food.calories, safeMultiplier),
    protein: scaleOptionalNumber(food.protein, safeMultiplier),
    carbs: scaleOptionalNumber(food.carbs, safeMultiplier),
    fat: scaleOptionalNumber(food.fat, safeMultiplier),
    fiber: scaleOptionalNumber(food.fiber, safeMultiplier),
    sugar: scaleOptionalNumber(food.sugar, safeMultiplier),
    sodium: scaleOptionalNumber(food.sodium, safeMultiplier),
  }
}

function FoodCatalogModal({ catalog, savedFoodIds, initialSavedOnly = false, allowDemo = false, onClose, onAdd, onOpenDetail, presentation = 'modal' }: { catalog?: NutritionFoodCatalogItem[]; savedFoodIds?: Set<string>; initialSavedOnly?: boolean; allowDemo?: boolean; onClose: () => void; onAdd: (food: NutritionFoodCatalogItem, multiplier: number) => void | Promise<void>; onOpenDetail: (food: NutritionFoodCatalogItem, catalog: NutritionFoodCatalogItem[]) => void; presentation?: 'modal' | 'page' }) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<NutritionFoodCatalogItem[]>(catalog?.length ? catalog : [])
  const [catalogState, setCatalogState] = useState<'loading' | 'live' | 'demo' | 'error'>(catalog?.length ? 'live' : 'loading')
  const [retryToken, setRetryToken] = useState(0)
  const [kindFilter, setKindFilter] = useState<'all' | 'dish' | 'food'>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [visibleCount, setVisibleCount] = useState(36)
  const [savedOnly, setSavedOnly] = useState(initialSavedOnly)
  const [layoutMode, setLayoutMode] = useState<'single' | 'grid'>(() => {
    try {
      const savedLayout = window.localStorage.getItem('aura:nutrition:catalog-layout')
      if (savedLayout === 'single' || savedLayout === 'grid') return savedLayout
    } catch {
      // A blocked storage surface should not prevent the catalog from opening.
    }
    return window.matchMedia('(max-width: 760px)').matches ? 'single' : 'grid'
  })
  const [portionById, setPortionById] = useState<Record<string, number>>({})
  const [addingFoodId, setAddingFoodId] = useState<string | null>(null)
  const dialogRef = useAccessibleDialog(onClose)

  const setLayout = (layout: 'single' | 'grid') => {
    setLayoutMode(layout)
    try {
      window.localStorage.setItem('aura:nutrition:catalog-layout', layout)
    } catch {
      // Keep the in-memory choice when localStorage is unavailable.
    }
  }

  const updatePortion = (foodId: string, value: number) => {
    const nextValue = Math.min(5, Math.max(0, Math.round(value * 10) / 10))
    setPortionById((current) => ({ ...current, [foodId]: nextValue }))
  }

  const addCatalogFood = async (food: NutritionFoodCatalogItem, multiplier: number) => {
    setAddingFoodId(food.id)
    try {
      await onAdd(scaleCatalogFood(food, multiplier), multiplier)
    } finally {
      setAddingFoodId(null)
    }
  }

  useEffect(() => {
    if (catalog?.length) {
      setItems(catalog)
      setCatalogState('live')
      return
    }
    let active = true
    loadNutritionCatalog()
      .then((normalized) => {
        if (!active) return
        setItems(normalized)
        setCatalogState('live')
      })
      .catch(() => {
        if (!active) return
        setItems(allowDemo ? DEMO_CATALOG : [])
        setCatalogState(allowDemo ? 'demo' : 'error')
      })
    return () => { active = false }
  }, [allowDemo, catalog, retryToken])

  const retryCatalog = () => {
    catalogRequest = null
    setItems([])
    setCatalogState('loading')
    setRetryToken((current) => current + 1)
  }

  const categories = useMemo(() => [...new Set(items
    .filter((item) => (kindFilter === 'all' || item.kind === kindFilter) && (!savedOnly || savedFoodIds?.has(item.id)))
    .map((item) => item.category?.nameVi)
    .filter((value): value is string => Boolean(value)))]
    .sort((left, right) => left.localeCompare(right, 'vi')), [items, kindFilter, savedFoodIds, savedOnly])

  useEffect(() => {
    if (categoryFilter !== 'all' && !categories.includes(categoryFilter)) setCategoryFilter('all')
  }, [categories, categoryFilter])

  const matchingItems = useMemo(() => {
    const normalizedQuery = normalizeSearch(query)
    return items.filter((item) => {
      if (kindFilter !== 'all' && item.kind !== kindFilter) return false
      if (savedOnly && !savedFoodIds?.has(item.id)) return false
      if (categoryFilter !== 'all' && item.category?.nameVi !== categoryFilter) return false
      if (!normalizedQuery) return true
      return normalizeSearch(`${item.name} ${item.nameEn ?? ''} ${item.nameAscii ?? ''} ${item.code ?? ''} ${item.category?.nameVi ?? ''} ${item.region?.nameVi ?? ''}`).includes(normalizedQuery)
    })
  }, [categoryFilter, items, kindFilter, query, savedFoodIds, savedOnly])

  useEffect(() => setVisibleCount(36), [categoryFilter, kindFilter, query, savedOnly])

  const filteredItems = matchingItems.slice(0, visibleCount)

  return (
    <div className={presentation === 'page' ? 'nutrition-route-page nutrition-route-page--catalog' : 'nutrition-modal-backdrop'} role="presentation" onMouseDown={(event) => presentation === 'modal' && event.target === event.currentTarget && onClose()}>
      <section ref={presentation === 'modal' ? dialogRef : undefined} className={`nutrition-catalog-modal ${presentation === 'page' ? 'nutrition-catalog-modal--page' : ''}`} role={presentation === 'modal' ? 'dialog' : 'region'} aria-modal={presentation === 'modal' ? true : undefined} aria-labelledby="nutrition-catalog-title" data-testid="nutrition-food-search-modal">
        <header className="nutrition-scan-modal__header">
          <div><span className="nutrition-ai-mark"><Search size={15} /> Cơ sở dữ liệu</span><h2 id="nutrition-catalog-title">Tìm món & thực phẩm</h2></div>
          <button type="button" className="nutrition-close-button" onClick={onClose} aria-label={presentation === 'page' ? 'Quay lại trang dinh dưỡng' : 'Đóng'}>{presentation === 'page' ? <ArrowLeft size={20} /> : <X size={20} />}</button>
        </header>
        <div className="nutrition-catalog-body">
          <label className="nutrition-catalog-search"><Search size={18} /><input autoFocus={presentation === 'modal'} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên món, mã, nhóm hoặc vùng miền…" data-testid="nutrition-food-search-input" /><kbd>{formatNumber(matchingItems.length)} kết quả</kbd></label>
          <div className="nutrition-catalog-filters" aria-label="Lọc danh mục">
            <div className="nutrition-catalog-kind-filter">
              {([['all', 'Tất cả'], ['dish', 'Món ăn'], ['food', 'Thực phẩm']] as const).map(([value, label]) => <button type="button" key={value} className={kindFilter === value ? 'active' : ''} onClick={() => setKindFilter(value)} aria-pressed={kindFilter === value}>{label}</button>)}
            </div>
            <button type="button" className={`nutrition-catalog-saved-filter ${savedOnly ? 'active' : ''}`} onClick={() => setSavedOnly((current) => !current)} aria-pressed={savedOnly}><Bookmark size={15} /> Đã lưu{savedFoodIds?.size ? ` (${savedFoodIds.size})` : ''}</button>
            <label><span>Nhóm</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">Tất cả nhóm</option>{categories.map((category) => <option value={category} key={category}>{category}</option>)}</select></label>
            <div className="nutrition-catalog-layout-toggle" role="group" aria-label="Kiểu hiển thị thư viện">
              <button type="button" className={layoutMode === 'single' ? 'active' : ''} onClick={() => setLayout('single')} aria-pressed={layoutMode === 'single'} title="Hiển thị một cột"><Rows2 size={16} /><span>1 cột</span></button>
              <button type="button" className={layoutMode === 'grid' ? 'active' : ''} onClick={() => setLayout('grid')} aria-pressed={layoutMode === 'grid'} title="Hiển thị hai cột"><Columns2 size={16} /><span>2 cột</span></button>
            </div>
            <span className="nutrition-catalog-count"><strong>{formatNumber(items.length)}</strong> bản ghi</span>
          </div>
          <div className={`nutrition-catalog-status nutrition-catalog-status--${catalogState}`}>
            {catalogState === 'loading' ? <LoaderCircle size={15} className="nutrition-spinner" /> : catalogState === 'live' ? <Check size={15} /> : catalogState === 'error' ? <CircleAlert size={15} /> : <Info size={15} />}
            <span>{catalogState === 'loading' ? 'Đang tải dữ liệu dinh dưỡng…' : catalogState === 'live' ? 'Dữ liệu được nạp từ danh mục Viện Dinh dưỡng.' : catalogState === 'error' ? 'Không tải được thư viện. Dữ liệu minh họa không được thay thế cho dữ liệu thật.' : 'Chưa tìm thấy tệp dữ liệu. Đang hiển thị một số bản ghi minh họa.'}</span>
            {catalogState === 'error' && <button type="button" onClick={retryCatalog}><RefreshCw size={14} /> Thử lại</button>}
          </div>
          <div className={`nutrition-catalog-list nutrition-catalog-list--${layoutMode}`} data-layout={layoutMode}>
            {filteredItems.map((food) => {
              const portion = portionById[food.id] ?? 1
              const scaledFood = scaleCatalogFood(food, portion)
              const canAdd = portion > 0 && canLogCatalogFood(food)
              const portionLabel = food.servingGrams !== null
                ? `${formatDecimal(portion)} khẩu phần · ${formatDecimal((food.servingGrams ?? 0) * portion)} g`
                : `${formatDecimal(portion)} suất theo nguồn`
              return (
                <article className="nutrition-catalog-card" key={food.id}>
                  <button type="button" className="nutrition-catalog-card__identity" onClick={() => onOpenDetail(food, items)} aria-label={`Xem chi tiết ${food.name}`}>
                    <span className="nutrition-catalog-card__media"><NutritionGroupIcon categoryName={food.category?.nameVi} kind={food.kind ?? 'food'} size={28} className="nutrition-catalog-card__placeholder" />{food.imageUrl && <img src={food.imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none' }} />}</span>
                    <span className="nutrition-catalog-card__name"><small>{food.kind === 'dish' ? 'Món ăn' : food.kind === 'food' ? 'Thực phẩm' : 'Dữ liệu dinh dưỡng'}{food.category?.nameVi ? ` · ${food.category.nameVi}` : ''}</small><strong>{food.name}</strong>{food.region?.nameVi && <em>{food.region.nameVi}</em>}</span>
                    <ChevronRight size={17} />
                  </button>

                  <div className="nutrition-catalog-card__summary">
                    <span><small>Khẩu phần đang chọn</small><strong>{portionLabel}</strong></span>
                    <span><small>Năng lượng</small><strong>{scaledFood.calories !== null ? formatNumber(scaledFood.calories) : '—'} <em>kcal</em></strong></span>
                  </div>

                  <div className="nutrition-catalog-card__macros" aria-label={`Dinh dưỡng của ${portionLabel}`}>
                    <span><small>Đạm</small><strong>{scaledFood.protein !== null ? `${formatDecimal(scaledFood.protein)}g` : '—'}</strong></span>
                    <span><small>Carb</small><strong>{scaledFood.carbs !== null ? `${formatDecimal(scaledFood.carbs)}g` : '—'}</strong></span>
                    <span><small>Chất béo</small><strong>{scaledFood.fat !== null ? `${formatDecimal(scaledFood.fat)}g` : '—'}</strong></span>
                  </div>

                  <div className="nutrition-catalog-card__portion">
                    <div><label htmlFor={`catalog-portion-${food.id}`}>Khẩu phần</label><output htmlFor={`catalog-portion-${food.id}`}>{formatDecimal(portion)}×</output></div>
                    <input id={`catalog-portion-${food.id}`} type="range" min="0" max="5" step="0.1" value={portion} onChange={(event) => updatePortion(food.id, Number(event.target.value))} aria-valuetext={portionLabel} />
                    <div className="nutrition-catalog-card__portion-quick" role="group" aria-label={`Chọn nhanh khẩu phần ${food.name}`}>
                      {[0.5, 1, 1.5, 2].map((value) => <button type="button" key={value} className={portion === value ? 'active' : ''} onClick={() => updatePortion(food.id, value)} aria-pressed={portion === value}>{formatDecimal(value)}×</button>)}
                    </div>
                  </div>

                  <div className="nutrition-catalog-card__actions">
                    <button type="button" className="view" onClick={() => onOpenDetail(food, items)}><Search size={15} /> Chi tiết</button>
                    <button type="button" className="add" onClick={() => addCatalogFood(food, portion)} disabled={!canAdd || addingFoodId !== null} title={!canLogCatalogFood(food) ? 'Bản ghi nguồn còn thiếu kcal hoặc macro để thêm an toàn' : portion === 0 ? 'Hãy chọn khẩu phần lớn hơn 0' : undefined}>{addingFoodId === food.id ? <LoaderCircle className="nutrition-spin" size={16} /> : <Plus size={16} />} {addingFoodId === food.id ? 'Đang nạp' : 'Thêm món'}</button>
                  </div>
                </article>
              )
            })}
            {catalogState !== 'loading' && catalogState !== 'error' && !filteredItems.length && <div className="nutrition-catalog-empty"><Search size={25} /><strong>Không tìm thấy món phù hợp</strong><span>Thử tên ngắn hơn hoặc bỏ dấu tiếng Việt.</span></div>}
          </div>
          {matchingItems.length > filteredItems.length && <button type="button" className="nutrition-catalog-load-more" onClick={() => setVisibleCount((current) => current + 36)}>Hiển thị thêm {Math.min(36, matchingItems.length - filteredItems.length)} kết quả <ArrowRight size={14} /></button>}
          <footer className="nutrition-catalog-footer"><Info size={14} /><span>Giá trị dinh dưỡng phụ thuộc khẩu phần và cách chế biến. Hãy kiểm tra lại lượng thực tế trước khi lưu.</span></footer>
        </div>
      </section>
    </div>
  )
}

export default function NutritionPage({ displayName = 'Thành viên Aura', isDemo = false, storageOwnerId, hasProfile = true, profile, onProfileComplete, onMealSaved, onAnalyzeImage, foodCatalog }: NutritionPageProps) {
  const resolvedOwnerId = storageOwnerId ?? firebaseAuth?.currentUser?.uid ?? 'anonymous'
  const mealStorageKey = `${MEAL_STORAGE_PREFIX}:${resolvedOwnerId}`
  const waterStorageKey = `${WATER_STORAGE_PREFIX}:${resolvedOwnerId}`
  const waterEntryStorageKey = `${WATER_ENTRY_STORAGE_PREFIX}:${resolvedOwnerId}`
  const savedFoodStorageKey = `${SAVED_FOOD_STORAGE_PREFIX}:${resolvedOwnerId}`
  const activityStorageKey = `${ACTIVITY_STORAGE_PREFIX}:${resolvedOwnerId}`
  const [profileReady, setProfileReady] = useState(hasProfile)
  const [profileDraft, setProfileDraft] = useState<NutritionProfileDraft>(profile ?? DEFAULT_PROFILE)
  const [todayKey, setTodayKey] = useState(() => toLocalDateKey(new Date()))
  const [selectedDate, setSelectedDate] = useState(todayKey)
  const [planSelectedDay, setPlanSelectedDay] = useState(todayKey)
  const [homeWeekStart, setHomeWeekStart] = useState(() => getCalendarStart())
  const [activeSection, setActiveSection] = useState<NutritionRouteSection>(() => nutritionSectionFromHash())
  const [catalogSavedOnly, setCatalogSavedOnly] = useState(false)
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [waterSheetOpen, setWaterSheetOpen] = useState(false)
  const [exerciseSheetOpen, setExerciseSheetOpen] = useState(false)
  const [selectedFood, setSelectedFood] = useState<NutritionFoodCatalogItem | null>(null)
  const [pendingFood, setPendingFood] = useState<NutritionFoodCatalogItem | null>(null)
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
  const [meals, setMeals] = useState<MealLog[]>(() => loadPersistedMeals(mealStorageKey, isDemo ? createInitialMeals() : []))
  const [waterByDate, setWaterByDate] = useState<Record<string, number>>(() => loadPersistedWater(waterStorageKey))
  const [activities, setActivities] = useState<NutritionActivityLog[]>(() => loadPersistedActivities(activityStorageKey, isDemo ? createInitialActivities() : []))
  const [waterEntries, setWaterEntries] = useState<NutritionWaterLog[]>(() => loadPersistedWaterEntries(waterEntryStorageKey))
  const [insightsPeriod, setInsightsPeriod] = useState<NutritionInsightsPeriod>('7d')
  const [planGenerated, setPlanGenerated] = useState(isDemo)
  const [assistantMessages, setAssistantMessages] = useState<AuraAssistantMessage[]>([])
  const [assistantLoading, setAssistantLoading] = useState(false)
  const [assistantReturnSection, setAssistantReturnSection] = useState<NutritionPrimarySection>('today')
  const [toast, setToast] = useState<NutritionToastState | null>(null)
  const messageTimer = useRef<number | null>(null)
  const catalogDetailCache = useRef(new Map<string, NutritionFoodDetailRecord>())
  const days = useMemo(() => getWeekDays(homeWeekStart, todayKey), [homeWeekStart, todayKey])
  const planDays = useMemo(() => getWeekDays(getCalendarStart(dateFromLocalKey(todayKey)), todayKey), [todayKey])
  const loggedDateIds = useMemo(() => new Set([
    ...meals.filter((meal) => meal.status === 'logged').map((meal) => meal.date),
    ...activities.map((activity) => activity.date),
    ...Object.entries(waterByDate).filter(([_, amount]) => amount > 0).map(([date]) => date),
  ]), [activities, meals, waterByDate])
  const firstName = displayName.trim().split(/\s+/).slice(-1)[0] || 'bạn'
  const { calorieGoal, proteinGoal, carbGoal, fatGoal, waterGoal } = getNutritionTargets(profileDraft)
  const dailyPlan = getDailyPlan(calorieGoal, profileDraft.eatingStyle)
  const selectedDayMeals = meals.filter((meal) => meal.date === selectedDate)
  const loggedMeals = selectedDayMeals.filter((meal) => meal.status === 'logged')
  const selectedDayActivities = activities.filter((activity) => activity.date === selectedDate)
  const activityCalories = selectedDayActivities.reduce((sum, activity) => sum + activity.estimatedCalories, 0)
  const activityMinutes = selectedDayActivities.reduce((sum, activity) => sum + activity.durationMinutes, 0)
  const caloriesConsumed = loggedMeals.reduce((sum, meal) => sum + meal.calories, 0)
  const proteinConsumed = Math.round(loggedMeals.reduce((sum, meal) => sum + meal.protein, 0))
  const carbsConsumed = Math.round(loggedMeals.reduce((sum, meal) => sum + meal.carbs, 0))
  const fatConsumed = Math.round(loggedMeals.reduce((sum, meal) => sum + meal.fat, 0))
  const fiberConsumed = Math.round(loggedMeals.reduce((sum, meal) => sum + (meal.fiber ?? Math.round(meal.carbs * 0.12)), 0))
  const sugarConsumed = Math.round(loggedMeals.reduce((sum, meal) => sum + (meal.sugar ?? Math.round(meal.carbs * 0.15)), 0))
  const sodiumConsumed = Math.round(loggedMeals.reduce((sum, meal) => sum + (meal.sodium ?? Math.round(meal.calories * 1.1)), 0))
  const fiberDataComplete = loggedMeals.length > 0
  const sugarDataComplete = loggedMeals.length > 0
  const sodiumDataComplete = loggedMeals.length > 0
  const qualityDataComplete = loggedMeals.length > 0
  const water = waterByDate[selectedDate] ?? 0
  const caloriePercent = Math.min(100, Math.round((caloriesConsumed / calorieGoal) * 100))
  const qualityMetrics = [
    { label: 'Chất xơ', value: fiberConsumed, goal: 25, unit: 'g', tone: 'fiber', inverse: false, complete: fiberDataComplete },
    { label: 'Đường', value: sugarConsumed, goal: 50, unit: 'g', tone: 'sugar', inverse: true, complete: sugarDataComplete },
    { label: 'Natri', value: sodiumConsumed, goal: 2300, unit: 'mg', tone: 'sodium', inverse: true, complete: sodiumDataComplete },
  ]
  const assistantSuggestions = loggedMeals.length
    ? [
        'Bữa tiếp theo nên ăn gì?',
        proteinConsumed < proteinGoal ? 'Tôi còn thiếu bao nhiêu đạm?' : 'Lượng đạm của tôi đã vượt chưa?',
        water < waterGoal ? 'Tôi cần uống thêm bao nhiêu nước?' : 'Lượng nước ngày này ổn chưa?',
        !fiberDataComplete ? 'Dữ liệu chất xơ của tôi đã đủ chưa?' : 'Tôi còn thiếu bao nhiêu chất xơ?',
      ]
    : ['Tôi nên bắt đầu ghi bữa như thế nào?', 'Mục tiêu năng lượng ngày này là gì?', 'Tôi cần uống thêm bao nhiêu nước?']
  const selectedDateLabel = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' }).format(dateFromLocalKey(selectedDate))
  const workspaceSection = toWorkspaceSection(activeSection)
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
    sourceLabel: meal.source === 'ai-scan' ? 'Aura Vision + dữ liệu dinh dưỡng' : meal.source === 'catalog' ? 'Viện Dinh dưỡng' : undefined,
  }))
  const workspacePlanDays: NutritionPlanDay[] = planDays.map((day) => ({
    id: day.id,
    weekday: day.day,
    date: day.date,
    label: day.isToday ? 'Hôm nay' : undefined,
    isToday: day.isToday,
  }))
  const planMealTypes: NutritionMealDraft['mealType'][] = ['breakfast', 'lunch', 'snack', 'dinner']
  const workspacePlannedMeals: NutritionPlannedMeal[] = planGenerated ? workspacePlanDays.flatMap((day) => dailyPlan.map((meal, index) => ({
    id: `${day.id}-plan-${index}`,
    dayId: day.id,
    time: meal.time,
    type: planMealTypes[index],
    label: meal.label,
    title: meal.title,
    description: `${formatNumber(meal.calories)} kcal · khoảng ${formatNumber(meal.protein)}g đạm`,
    calories: meal.calories,
    protein: meal.protein,
    prepMinutes: index === 2 ? 5 : 20,
    rationale: index === 0 ? 'Ưu tiên năng lượng ổn định đầu ngày' : index === 3 ? 'Bù phần macro còn thiếu trong ngày' : 'Phân bổ theo mục tiêu cá nhân',
  }))) : []
  const insightWindowDays = insightsPeriod === '7d' ? 7 : insightsPeriod === '30d' ? 30 : 90
  const insightDateKeys = getRecentDateKeys(todayKey, insightWindowDays)
  const insightMeals = meals.filter((meal) => meal.status === 'logged' && insightDateKeys.includes(meal.date))
  const insightActivities = activities.filter((activity) => insightDateKeys.includes(activity.date))
  const insightDaysWithMeals = new Set(insightMeals.map((meal) => meal.date)).size
  const insightWaterDateKeys = insightDateKeys.filter((date) => (waterByDate[date] ?? 0) > 0)
  const insightDaysWithAnyData = new Set([
    ...insightMeals.map((meal) => meal.date),
    ...insightActivities.map((activity) => activity.date),
    ...insightWaterDateKeys,
  ]).size
  const loggedDayDivisor = Math.max(1, insightDaysWithMeals)
  const averageCalories = insightMeals.reduce((sum, meal) => sum + meal.calories, 0) / loggedDayDivisor
  const averageProtein = insightMeals.reduce((sum, meal) => sum + meal.protein, 0) / loggedDayDivisor
  const averageWater = insightWaterDateKeys.reduce((sum, date) => sum + (waterByDate[date] ?? 0), 0) / Math.max(1, insightWaterDateKeys.length)
  const insightTrendKeys = insightDateKeys.slice(-7)
  const insightTrend = insightDaysWithMeals >= 3 ? insightTrendKeys.map((date) => ({
    label: new Intl.DateTimeFormat('vi-VN', { weekday: 'short' }).format(dateFromLocalKey(date)).replace('.', ''),
    value: Math.round(insightMeals.filter((meal) => meal.date === date).reduce((sum, meal) => sum + meal.calories, 0)),
    target: calorieGoal,
  })) : []
  const dataCompleteness = Math.min(100, (insightDaysWithAnyData / insightWindowDays) * 100)
  const proteinCoverage = Math.round((averageProtein / Math.max(1, proteinGoal)) * 100)
  const waterCoverage = Math.round((averageWater / Math.max(1, waterGoal)) * 100)
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
    setAssistantMessages([])
    setAssistantLoading(false)
  }, [selectedDate])

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
    if (!planDays.some((day) => day.id === planSelectedDay)) setPlanSelectedDay(todayKey)
  }, [planDays, planSelectedDay, todayKey])

  useEffect(() => {
    if (!firestoreDb || resolvedOwnerId === 'anonymous') return
    const unsubscribeMeals = subscribeToUserMealLogs(resolvedOwnerId, (remoteMeals) => {
      if (Array.isArray(remoteMeals) && remoteMeals.length > 0) {
        setMeals((current) => {
          const map = new Map<string, MealLog>()
          remoteMeals.forEach((item) => {
            if (item && typeof item === 'object' && item.id) {
              map.set(item.id, item as MealLog)
            }
          })
          current.forEach((item) => {
            if (!map.has(item.id)) {
              map.set(item.id, item)
            }
          })
          return Array.from(map.values())
        })
      }
    })

    const unsubscribeWater = subscribeToUserWaterLogs(resolvedOwnerId, (remoteWater) => {
      if (Array.isArray(remoteWater) && remoteWater.length > 0) {
        setWaterEntries((current) => {
          const map = new Map<string, NutritionWaterLog>()
          remoteWater.forEach((item) => {
            if (item && typeof item === 'object' && item.id) {
              map.set(item.id, item as NutritionWaterLog)
            }
          })
          current.forEach((item) => {
            if (!map.has(item.id)) map.set(item.id, item)
          })
          return Array.from(map.values())
        })
      }
    })

    const unsubscribeActivities = subscribeToUserActivityLogs(resolvedOwnerId, (remoteActivities) => {
      if (Array.isArray(remoteActivities) && remoteActivities.length > 0) {
        setActivities((current) => {
          const map = new Map<string, NutritionActivityLog>()
          remoteActivities.forEach((item) => {
            if (item && typeof item === 'object' && item.id) {
              map.set(item.id, item as NutritionActivityLog)
            }
          })
          current.forEach((item) => {
            if (!map.has(item.id)) map.set(item.id, item)
          })
          return Array.from(map.values())
        })
      }
    })

    return () => {
      unsubscribeMeals()
      unsubscribeWater()
      unsubscribeActivities()
    }
  }, [resolvedOwnerId])

  useEffect(() => {
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
  }, [mealStorageKey, meals])

  useEffect(() => {
    try {
      window.localStorage.setItem(waterStorageKey, JSON.stringify(waterByDate))
    } catch {
      // Keep the current session usable if browser storage is unavailable.
    }
  }, [waterByDate, waterStorageKey])

  useEffect(() => {
    try {
      window.localStorage.setItem(waterEntryStorageKey, JSON.stringify(waterEntries))
    } catch {
      // Keep the current session usable if browser storage is unavailable.
    }
  }, [waterEntries, waterEntryStorageKey])

  useEffect(() => {
    try {
      window.localStorage.setItem(activityStorageKey, JSON.stringify(activities))
    } catch {
      // Keep the current session usable if browser storage is unavailable.
    }
  }, [activities, activityStorageKey])

  useEffect(() => {
    setProfileReady(hasProfile)
  }, [hasProfile])

  useEffect(() => {
    if (profile) setProfileDraft(profile)
  }, [profile])

  useEffect(() => {
    setQuickAddOpen(false)
    setWaterSheetOpen(false)
    setExerciseSheetOpen(false)
    setPendingFood(null)
    setEditingMealId(null)
    setSelectedLoggedMealId(null)
  }, [activeSection])

  useEffect(() => {
    let active = true
    const syncFoodDetail = () => {
      setActiveSection(nutritionSectionFromHash())
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
      void loadNutritionCatalog().then((items) => {
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
    const nextHash = nutritionSectionHash(section)
    setSelectedFood(null)
    setActiveSection(section)
    if (window.location.hash !== nextHash) window.location.hash = nextHash
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const openCatalog = (savedOnly = false) => {
    setCatalogSavedOnly(savedOnly)
    navigateNutrition('catalog')
  }

  const openAssistant = () => {
    if (activeSection === 'today' || activeSection === 'diary' || activeSection === 'plan' || activeSection === 'catalog' || activeSection === 'insights') {
      setAssistantReturnSection(activeSection)
    }
    navigateNutrition('assistant')
  }

  const closeAssistant = () => navigateNutrition(assistantReturnSection)

  const submitAssistantQuestion = async (question: string) => {
    const userMessage: AuraAssistantMessage = { id: `aura-user-${Date.now()}`, role: 'user', content: question }
    setAssistantMessages((current) => [...current, userMessage])
    setAssistantLoading(true)
    try {
      const intent = resolveNutritionAssistantIntent(question)
      const caloriesRemaining = calorieGoal - caloriesConsumed
      const proteinRemaining = proteinGoal - proteinConsumed
      const waterRemaining = waterGoal - water
      let content = ''
      let evidence: string[] = []
      let confidenceLabel = 'Căn cứ từ dữ liệu ngày đã chọn'

      const answerMacro = (label: string, consumed: number, goal: number) => {
        if (!loggedMeals.length) {
          confidenceLabel = 'Chưa đủ nhật ký bữa ăn'
          return `Mình chưa thể kết luận lượng ${label.toLocaleLowerCase('vi-VN')} còn thiếu vì ${selectedDateLabel.toLocaleLowerCase('vi-VN')} chưa có bữa ăn nào được ghi. Mục tiêu tham chiếu hiện tại là ${formatNumber(goal)}g; hãy ghi bữa đầu tiên để Aura tính phần còn lại.`
        }
        const difference = goal - consumed
        if (difference > 0) return `Bạn đã ghi khoảng ${formatNumber(consumed)}g ${label.toLocaleLowerCase('vi-VN')} và còn thiếu khoảng ${formatNumber(difference)}g so với mục tiêu ${formatNumber(goal)}g của ngày.`
        if (difference < 0) return `Bạn đã ghi khoảng ${formatNumber(consumed)}g ${label.toLocaleLowerCase('vi-VN')}, cao hơn mục tiêu tham chiếu ${formatNumber(Math.abs(difference))}g. Không cần cố bổ sung thêm chỉ để đạt một con số.`
        return `Bạn đang ở đúng mức mục tiêu ${formatNumber(goal)}g ${label.toLocaleLowerCase('vi-VN')} theo các bữa đã ghi.`
      }

      const answerQualityMetric = (label: string, value: number, goal: number, unit: string, complete: boolean, inverse: boolean) => {
        if (!complete) {
          confidenceLabel = 'Thiếu dữ liệu thành phần từ một hoặc nhiều món'
          return `Mình chưa thể đánh giá ${label.toLocaleLowerCase('vi-VN')} vì ít nhất một món trong nhật ký chưa có chỉ số này. Aura giữ trạng thái “chưa đủ dữ liệu” thay vì xem phần thiếu là 0.`
        }
        const difference = goal - value
        if (inverse) {
          return difference >= 0
            ? `Bạn đã ghi ${formatNumber(value)}${unit} ${label.toLocaleLowerCase('vi-VN')}, còn khoảng ${formatNumber(difference)}${unit} trước giới hạn tham chiếu ${formatNumber(goal)}${unit}.`
            : `Bạn đã vượt giới hạn tham chiếu ${label.toLocaleLowerCase('vi-VN')} khoảng ${formatNumber(Math.abs(difference))}${unit}. Hãy ưu tiên các lựa chọn ít ${label.toLocaleLowerCase('vi-VN')} hơn trong phần còn lại của ngày.`
        }
        return difference > 0
          ? `Bạn đã ghi ${formatNumber(value)}${unit} ${label.toLocaleLowerCase('vi-VN')} và còn thiếu khoảng ${formatNumber(difference)}${unit} so với mục tiêu ${formatNumber(goal)}${unit}.`
          : `Bạn đã đạt mục tiêu ${label.toLocaleLowerCase('vi-VN')} tham chiếu của ngày với ${formatNumber(value)}${unit}.`
      }

      if (intent === 'hydration') {
        content = waterRemaining > 0
          ? `Bạn còn thiếu khoảng ${formatNumber(waterRemaining)} ml nước so với mục tiêu tham chiếu. Chia thành vài lần nhỏ trong phần còn lại của ngày sẽ dễ thực hiện hơn.`
          : 'Bạn đã đạt mục tiêu nước tham chiếu của ngày. Tiếp tục uống theo cảm giác khát và điều kiện vận động.'
        evidence = [`Nước đã ghi ${formatNumber(water)} / ${formatNumber(waterGoal)} ml`]
      } else if (intent === 'protein') {
        content = answerMacro('Đạm', proteinConsumed, proteinGoal)
        evidence = [`${loggedMeals.length} bữa đã ghi`, `Mục tiêu ${formatNumber(proteinGoal)}g đạm`]
      } else if (intent === 'carbs') {
        content = answerMacro('Carb', carbsConsumed, carbGoal)
        evidence = [`${loggedMeals.length} bữa đã ghi`, `Mục tiêu ${formatNumber(carbGoal)}g carb`]
      } else if (intent === 'fat') {
        content = answerMacro('Chất béo', fatConsumed, fatGoal)
        evidence = [`${loggedMeals.length} bữa đã ghi`, `Mục tiêu ${formatNumber(fatGoal)}g chất béo`]
      } else if (intent === 'fiber') {
        content = answerQualityMetric('Chất xơ', fiberConsumed, 25, 'g', fiberDataComplete, false)
        evidence = [`${loggedMeals.length} bữa đã ghi`, fiberDataComplete ? 'Tất cả bữa đã ghi có dữ liệu chất xơ' : 'Có món thiếu dữ liệu chất xơ']
      } else if (intent === 'sugar') {
        content = answerQualityMetric('Đường', sugarConsumed, 50, 'g', sugarDataComplete, true)
        evidence = [`${loggedMeals.length} bữa đã ghi`, sugarDataComplete ? 'Tất cả bữa đã ghi có dữ liệu đường' : 'Có món thiếu dữ liệu đường']
      } else if (intent === 'sodium') {
        content = answerQualityMetric('Natri', sodiumConsumed, 2300, 'mg', sodiumDataComplete, true)
        evidence = [`${loggedMeals.length} bữa đã ghi`, sodiumDataComplete ? 'Tất cả bữa đã ghi có dữ liệu natri' : 'Có món thiếu dữ liệu natri']
      } else if (intent === 'energy') {
        content = !loggedMeals.length
          ? `Mục tiêu năng lượng tham chiếu của bạn là ${formatNumber(calorieGoal)} kcal. Ngày này chưa có bữa ăn được ghi nên Aura chưa thể đánh giá mức còn lại một cách có ý nghĩa.`
          : caloriesRemaining >= 0
            ? `Bạn đã ghi ${formatNumber(caloriesConsumed)} kcal và còn khoảng ${formatNumber(caloriesRemaining)} kcal so với mục tiêu ${formatNumber(calorieGoal)} kcal.`
            : `Bạn đã ghi ${formatNumber(caloriesConsumed)} kcal, cao hơn mục tiêu tham chiếu khoảng ${formatNumber(Math.abs(caloriesRemaining))} kcal. Không cần nhịn bù; hãy quay về nhịp ăn bình thường ở bữa tiếp theo.`
        evidence = [`${loggedMeals.length} bữa đã ghi`, `Mục tiêu ${formatNumber(calorieGoal)} kcal`]
      } else if (intent === 'workout') {
        const normalizedQuestion = normalizeSearch(question)
        content = normalizedQuestion.includes('truoc tap')
          ? 'Trước tập, ưu tiên một khẩu phần dễ tiêu có carb và một ít đạm; lượng cụ thể còn phụ thuộc thời gian đến buổi tập và khẩu phần bạn đã ăn.'
          : normalizedQuestion.includes('sau tap')
            ? `Sau tập, hãy ưu tiên bữa có đạm và carb. Theo nhật ký ngày này, bạn ${proteinRemaining > 0 ? `còn khoảng ${formatNumber(proteinRemaining)}g đạm` : 'đã đạt mục tiêu đạm tham chiếu'}.`
            : selectedDayActivities.length
              ? `Bạn đã ghi ${activityMinutes} phút vận động, ước tính ${formatNumber(activityCalories)} kcal. Aura theo dõi phần này riêng và không tự cộng toàn bộ vào ngân sách ăn.`
              : 'Ngày này chưa có buổi tập được ghi. Bạn có thể thêm thời gian và cường độ để Aura đặt gợi ý bữa ăn đúng ngữ cảnh hơn.'
        evidence = [`${selectedDayActivities.length} buổi tập · ${activityMinutes} phút`, `Kcal vận động được theo dõi riêng`]
      } else if (intent === 'allergy') {
        content = profileDraft.allergies.trim()
          ? `Hồ sơ đang ghi cần tránh: ${profileDraft.allergies}. Tuy nhiên tên món và dữ liệu dinh dưỡng không đủ để xác nhận món an toàn dị ứng; bạn vẫn cần kiểm tra nguyên liệu và cách chế biến trực tiếp.`
          : 'Hồ sơ chưa có thực phẩm cần tránh. Nếu bạn có dị ứng, hãy cập nhật hồ sơ trước khi dùng gợi ý món; Aura không thể xác nhận an toàn dị ứng chỉ từ tên món.'
        evidence = [profileDraft.allergies.trim() ? `Hồ sơ: tránh ${profileDraft.allergies}` : 'Hồ sơ chưa ghi dị ứng']
        confidenceLabel = 'Không thay thế xác nhận thành phần trực tiếp'
      } else if (intent === 'next-meal') {
        if (!loggedMeals.length) {
          content = 'Ngày này chưa có bữa ăn được ghi, nên mình chưa thể chọn “bữa tiếp theo” theo phần dinh dưỡng còn thiếu. Hãy quét hoặc chọn bữa đầu tiên; Aura sẽ không tự lưu khi bạn chưa xác nhận.'
          evidence = ['Chưa có bữa ăn trong ngày đã chọn']
          confidenceLabel = 'Cần thêm một bữa để cá nhân hóa'
        } else {
          let availableCatalog = catalogSnapshot
          if (!availableCatalog.length) {
            try {
              availableCatalog = await loadNutritionCatalog()
              setCatalogSnapshot(availableCatalog)
            } catch {
              availableCatalog = []
            }
          }
          const hasAllergyConstraint = Boolean(profileDraft.allergies.trim())
          const canNameCandidates = caloriesRemaining > 0 && !hasAllergyConstraint
          const targetCalories = Math.min(650, Math.max(40, caloriesRemaining))
          const calorieCeiling = Math.min(750, targetCalories + Math.min(60, Math.max(15, targetCalories * .12)))
          const rankedCandidates = canNameCandidates ? availableCatalog
            .filter((item) => item.kind === 'dish' && canLogCatalogFood(item) && item.calories > 0 && item.calories <= calorieCeiling)
            .sort((left, right) => {
              const leftEnergy = Math.abs((left.calories ?? 0) - targetCalories) / targetCalories
              const rightEnergy = Math.abs((right.calories ?? 0) - targetCalories) / targetCalories
              const leftProteinBoost = proteinRemaining > 12 ? Math.min(1, (left.protein ?? 0) / Math.max(1, proteinRemaining)) * .18 : 0
              const rightProteinBoost = proteinRemaining > 12 ? Math.min(1, (right.protein ?? 0) / Math.max(1, proteinRemaining)) * .18 : 0
              return (leftEnergy - leftProteinBoost) - (rightEnergy - rightProteinBoost)
            }) : []
          const candidateNames = new Set<string>()
          const candidates = rankedCandidates
            .filter((item) => {
              const key = normalizeSearch(item.name)
              if (candidateNames.has(key)) return false
              candidateNames.add(key)
              return true
            })
            .slice(0, 3)
          const focus = proteinRemaining > 12 ? `ưu tiên đạm vì còn thiếu khoảng ${formatNumber(proteinRemaining)}g` : carbsConsumed < carbGoal * .65 ? 'bổ sung carb vừa phải cùng rau và đạm' : 'giữ khẩu phần cân bằng và dễ duy trì'
          const candidateCopy = hasAllergyConstraint
            ? ' Hồ sơ có thực phẩm cần tránh, nên Aura chưa nêu tên món khi thư viện chưa xác nhận đầy đủ thành phần.'
            : candidates.length
              ? ` Trong thư viện, các lựa chọn gần ngân sách hiện tại gồm ${candidates.map((item) => `${item.name} (${formatNumber(item.calories ?? 0)} kcal theo khẩu phần nguồn)`).join(', ')}.`
              : caloriesRemaining > 0
                ? ' Chưa có khẩu phần nguồn nào nằm gần ngưỡng kcal này; hãy mở Thư viện và giảm khẩu phần thực tế trước khi ghi.'
                : ''
          content = caloriesRemaining <= 0
            ? `Bạn đã chạm ngân sách năng lượng tham chiếu. Nếu vẫn đói, hãy chọn một bữa nhẹ, ưu tiên rau và đạm, không cần nhịn bù.${candidateCopy}`
            : `Bữa tiếp theo nên ${focus}; bạn còn khoảng ${formatNumber(caloriesRemaining)} kcal.${candidateCopy}`
          const candidateEvidence = candidates.length
            ? `${candidates.length} món được xếp hạng từ thư viện`
            : hasAllergyConstraint
              ? 'Không xếp hạng tên món khi chưa xác nhận thành phần dị ứng'
              : caloriesRemaining <= 0
                ? 'Không đề xuất thêm món khi đã chạm ngân sách tham chiếu'
                : availableCatalog.length ? 'Không có khẩu phần nguồn phù hợp ngưỡng kcal còn lại' : 'Chưa tải được thư viện món'
          evidence = [`${loggedMeals.length} bữa đã ghi`, `${formatNumber(Math.max(0, caloriesRemaining))} kcal và ${formatNumber(Math.max(0, proteinRemaining))}g đạm còn lại`, candidateEvidence]
          confidenceLabel = candidates.length ? 'Gợi ý theo dữ liệu đã ghi và khẩu phần nguồn' : hasAllergyConstraint ? 'An toàn dị ứng cần kiểm tra thành phần trực tiếp' : 'Gợi ý theo mục tiêu; cần kiểm tra khẩu phần thực tế'
        }
      } else if (intent === 'getting-started') {
        content = 'Bắt đầu bằng một thao tác: quét ảnh hoặc chọn món trong Thư viện, kiểm tra khẩu phần rồi xác nhận bữa và thời gian. Sau một đến hai bữa, Aura có thể trả lời phần còn thiếu cụ thể hơn.'
        evidence = [`${loggedMeals.length} bữa đã ghi trong ngày đã chọn`]
      } else {
        content = 'Mình chưa nhận ra bạn đang hỏi về chỉ số hay bữa ăn nào. Bạn có thể hỏi cụ thể về bữa tiếp theo, kcal, đạm, carb, chất béo, chất xơ, đường, natri, nước hoặc dinh dưỡng quanh buổi tập.'
        evidence = ['Cần một câu hỏi cụ thể hơn để tránh suy đoán']
        confidenceLabel = 'Cần làm rõ ý định'
      }
      setAssistantMessages((current) => [...current, {
        id: `aura-assistant-${Date.now()}`,
        role: 'assistant',
        content,
        evidence,
        confidenceLabel,
      }])
    } catch {
      setAssistantMessages((current) => [...current, {
        id: `aura-assistant-error-${Date.now()}`,
        role: 'assistant',
        content: 'Aura chưa thể đối chiếu dữ liệu lúc này. Bạn có thể thử lại hoặc mở Nhật ký để kiểm tra trực tiếp các chỉ số đã ghi.',
        evidence: ['Không có dữ liệu nào được tự suy đoán trong lần trả lời này'],
        confidenceLabel: 'Chưa thể phân tích',
      }])
    } finally {
      setAssistantLoading(false)
    }
  }

  const shiftSelectedDate = (direction: -1 | 1) => {
    const nextDate = dateFromLocalKey(selectedDate)
    nextDate.setDate(nextDate.getDate() + direction)
    const nextDateKey = toLocalDateKey(nextDate)
    setHomeWeekStart(getCalendarStart(nextDate))
    setSelectedDate(nextDateKey)
  }

  const shiftHomeWeek = (direction: -1 | 1) => {
    const nextStart = dateFromLocalKey(homeWeekStart)
    nextStart.setDate(nextStart.getDate() + direction * 7)
    const nextSelectedDate = dateFromLocalKey(selectedDate)
    nextSelectedDate.setDate(nextSelectedDate.getDate() + direction * 7)
    setHomeWeekStart(toLocalDateKey(nextStart))
    setSelectedDate(toLocalDateKey(nextSelectedDate))
  }

  const logWater = (amount: number) => {
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
    if (firestoreDb && resolvedOwnerId !== 'anonymous') {
      saveUserWaterLog(resolvedOwnerId, entry as any).catch((err) => console.error('Error saving water log to Firestore:', err))
    }
    setWaterSheetOpen(false)
    showMessage(`Đã thêm ${formatNumber(loggedAmount)} ml nước vào ${selectedDateLabel.toLocaleLowerCase('vi-VN')}`, {
      label: 'Hoàn tác',
      onClick: () => {
        setWaterByDate((current) => ({ ...current, [date]: previous }))
        setWaterEntries((current) => current.filter((item) => item.id !== entry.id))
        if (firestoreDb && resolvedOwnerId !== 'anonymous') {
          deleteUserWaterLog(resolvedOwnerId, entry.id).catch((err) => console.error('Error deleting water log from Firestore:', err))
        }
        showMessage('Đã hoàn tác lần ghi nước')
      },
    })
  }

  const saveActivity = (draft: NutritionActivityDraft) => {
    const activity: NutritionActivityLog = {
      ...draft,
      id: `activity-${Date.now()}`,
      date: selectedDate,
      source: 'manual',
      createdAt: Date.now(),
    }
    setActivities((current) => [activity, ...current])
    if (firestoreDb && resolvedOwnerId !== 'anonymous') {
      saveUserActivityLog(resolvedOwnerId, activity as any).catch((err) => console.error('Error saving activity log to Firestore:', err))
    }
    setExerciseSheetOpen(false)
    showMessage(`Đã ghi ${activity.title} · ${activity.durationMinutes} phút`, {
      label: 'Hoàn tác',
      onClick: () => {
        setActivities((current) => current.filter((item) => item.id !== activity.id))
        if (firestoreDb && resolvedOwnerId !== 'anonymous') {
          deleteUserActivityLog(resolvedOwnerId, activity.id).catch((err) => console.error('Error deleting activity log from Firestore:', err))
        }
        showMessage('Đã hoàn tác buổi tập')
      },
    })
  }

  const deleteActivity = (activityId: string) => {
    const deletedActivity = activities.find((activity) => activity.id === activityId)
    if (!deletedActivity) return
    setActivities((current) => current.filter((activity) => activity.id !== activityId))
    if (firestoreDb && resolvedOwnerId !== 'anonymous') {
      deleteUserActivityLog(resolvedOwnerId, activityId).catch((err) => console.error('Error deleting activity from Firestore:', err))
    }
    showMessage(`Đã xóa ${deletedActivity.title}`, {
      label: 'Hoàn tác',
      onClick: () => {
        setActivities((current) => current.some((activity) => activity.id === deletedActivity.id) ? current : [deletedActivity, ...current])
        if (firestoreDb && resolvedOwnerId !== 'anonymous') {
          saveUserActivityLog(resolvedOwnerId, deletedActivity as any).catch((err) => console.error('Error restoring activity to Firestore:', err))
        }
        showMessage('Đã khôi phục buổi tập')
      },
    })
  }

  const deleteMeal = (mealId: string) => {
    const deletedMeal = meals.find((meal) => meal.id === mealId)
    if (!deletedMeal) return
    setMeals((current) => current.filter((meal) => meal.id !== mealId))
    if (firestoreDb && resolvedOwnerId !== 'anonymous') {
      deleteUserMealLog(resolvedOwnerId, mealId).catch((err) => console.error('Error deleting meal from Firestore:', err))
    }
    showMessage(`Đã xóa ${deletedMeal.title}`, {
      label: 'Hoàn tác',
      onClick: () => {
        setMeals((current) => current.some((meal) => meal.id === deletedMeal.id) ? current : [deletedMeal, ...current])
        if (firestoreDb && resolvedOwnerId !== 'anonymous') {
          saveUserMealLog(resolvedOwnerId, deletedMeal as any).catch((err) => console.error('Error restoring meal to Firestore:', err))
        }
        showMessage('Đã khôi phục món ăn')
      },
    })
  }

  const editMeal = (mealId: string, draft: MealLogEditDraft) => {
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
    if (firestoreDb && resolvedOwnerId !== 'anonymous') {
      saveUserMealLog(resolvedOwnerId, updated as any).catch((err) => console.error('Error saving updated meal to Firestore:', err))
    }
    setEditingMealId(null)
    setHomeWeekStart(getCalendarStart(dateFromLocalKey(draft.date)))
    setSelectedDate(draft.date)
    showMessage(`Đã cập nhật ${updated.title}`, {
      label: 'Hoàn tác',
      onClick: () => {
        setMeals((current) => current.map((meal) => meal.id === mealId ? original : meal))
        if (firestoreDb && resolvedOwnerId !== 'anonymous') {
          saveUserMealLog(resolvedOwnerId, original as any).catch((err) => console.error('Error restoring edited meal to Firestore:', err))
        }
        setHomeWeekStart(getCalendarStart(dateFromLocalKey(original.date)))
        setSelectedDate(original.date)
        showMessage('Đã hoàn tác chỉnh sửa bữa ăn')
      },
    })
  }

  const completeProfile = (profile: NutritionProfileDraft) => {
    setProfileDraft(profile)
    setProfileReady(true)
    onProfileComplete?.(profile)
  }

  const saveScannedMeal = (meal: NutritionMealDraft) => {
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
    const mealLabels: Record<NutritionMealDraft['mealType'], string> = { breakfast: 'Bữa sáng', lunch: 'Bữa trưa', dinner: 'Bữa tối', snack: 'Bữa phụ' }
    const newMealLog: MealLog = {
      id: `ai-${Date.now()}`,
      date: loggedDate,
      type: meal.mealType,
      label: mealLabels[meal.mealType],
      time: meal.mealTime ?? new Date().toTimeString().slice(0, 5),
      title: meal.name,
      description: meal.source === 'demo'
        ? `${meal.items.length} thành phần · Dữ liệu minh họa, chưa phân tích từ ảnh`
        : `${meal.items.length} thành phần · AI ước tính`,
      calories: meal.calories,
      protein: Math.round(macros.protein),
      carbs: Math.round(macros.carbs),
      fat: Math.round(macros.fat),
      fiber: fiberComplete ? Math.round(macros.fiber) : undefined,
      sugar: sugarComplete ? Math.round(macros.sugar) : undefined,
      sodium: sodiumComplete ? Math.round(macros.sodium) : undefined,
      status: 'logged',
      tone: 'green',
      image: meal.image,
      source: meal.source,
      confidence: meal.source === 'ai-scan' ? 'estimated' : 'needs-review',
      calorieRange: meal.calorieRange ?? { low: Math.max(0, Math.round(meal.calories * .88)), high: Math.round(meal.calories * 1.12) },
      items: meal.items,
    }
    setMeals((current) => [newMealLog, ...current])
    if (firestoreDb && resolvedOwnerId !== 'anonymous') {
      saveUserMealLog(resolvedOwnerId, newMealLog as any).catch((err) => console.error('Error saving scanned meal to Firestore:', err))
    }
    onMealSaved?.(meal)
    setHomeWeekStart(getCalendarStart(dateFromLocalKey(loggedDate)))
    setSelectedDate(loggedDate)
    navigateNutrition('today')
    const loggedDateLabel = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' }).format(dateFromLocalKey(loggedDate))
    showMessage(`Đã lưu món ăn vào ${loggedDateLabel.toLocaleLowerCase('vi-VN')}`)
  }

  const queueCatalogFood = async (food: NutritionFoodCatalogItem, multiplier = 1, hydrateDetails = true) => {
    let pending = food
    if (hydrateDetails) {
      try {
        let detail = catalogDetailCache.current.get(food.id) ?? null
        if (!detail) {
          const bucket = toFoodDetailSummary(food).detailBucket
          const response = await fetch(nutritionDetailBucketUrl(bucket))
          if (!response.ok) throw new Error(`Nutrition detail ${response.status}`)
          detail = findNutritionDetailRecord(await response.json(), food.id)
          if (!detail) throw new Error('Nutrition detail not found')
          catalogDetailCache.current.set(food.id, detail)
        }
        pending = {
          ...food,
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

  const commitCatalogFood = (food: NutritionFoodCatalogItem, context: MealEditorContext) => {
    if (!canLogCatalogFood(food)) {
      showMessage('Bản ghi nguồn còn thiếu kcal hoặc macro nên chưa thể thêm an toàn')
      return
    }
    const mealLabels: Record<NutritionMealDraft['mealType'], string> = { breakfast: 'Bữa sáng', lunch: 'Bữa trưa', dinner: 'Bữa tối', snack: 'Bữa phụ' }
    const newMealLog: MealLog = {
      id: `catalog-${Date.now()}`,
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
      confidence: 'verified',
    }
    setMeals((current) => [newMealLog, ...current])
    if (firestoreDb && resolvedOwnerId !== 'anonymous') {
      saveUserMealLog(resolvedOwnerId, newMealLog as any).catch((err) => console.error('Error saving catalog meal to Firestore:', err))
    }
    setPendingFood(null)
    setHomeWeekStart(getCalendarStart(dateFromLocalKey(context.date)))
    setSelectedDate(context.date)
    navigateNutrition('today')
    showMessage(`Đã thêm ${food.name} vào ${mealLabels[context.mealType].toLocaleLowerCase('vi-VN')}`)
  }

  const openFoodDetail = (food: NutritionFoodCatalogItem, items: NutritionFoodCatalogItem[] = catalogSnapshot) => {
    setSelectedFood(food)
    if (items.length) setCatalogSnapshot(items)
    const nextHash = `#/nutrition?section=catalog&foodId=${encodeURIComponent(food.id)}`
    if (window.location.hash !== nextHash) window.location.hash = nextHash
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const closeFoodDetail = () => {
    setSelectedFood(null)
    navigateNutrition('catalog')
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
      servingGrams: serving.unit === 'g' ? serving.amount : null,
      servingLabel: serving.label,
      calories: scaleOptionalNumber(record.energyKcal, serving.multiplier),
      protein: scaleOptionalNumber(detailNutrientValue(record, 'protein'), serving.multiplier),
      carbs: scaleOptionalNumber(detailNutrientValue(record, 'carbohydrate'), serving.multiplier),
      fat: scaleOptionalNumber(detailNutrientValue(record, 'fat'), serving.multiplier),
      fiber: scaleOptionalNumber(detailNutrientValue(record, 'fiber'), serving.multiplier),
      sugar: scaleOptionalNumber(detailNutrientValue(record, 'sugars_total') ?? detailNutrientValue(record, 'sugar'), serving.multiplier),
      sodium: scaleOptionalNumber(detailNutrientValue(record, 'sodium'), serving.multiplier),
      source: record.source?.publisher ?? 'Viện Dinh dưỡng Quốc gia',
      sourceUrl: record.source?.pageUrl ?? undefined,
      sourceId: record.source?.sourceId ?? undefined,
      imageUrl: record.imageUrl ?? undefined,
      detailBucket: selectedFood?.detailBucket,
    }, 1, false)
    closeFoodDetail()
  }

  const saveFood = (record: NutritionFoodDetailRecord, saved: boolean) => {
    setSavedFoodIds((current) => {
      const next = new Set(current)
      if (saved) next.add(record.id)
      else next.delete(record.id)
      try {
        window.localStorage.setItem(savedFoodStorageKey, JSON.stringify([...next]))
      } catch {
        // Keep the current browser session usable when storage is unavailable.
      }
      return next
    })
  }

  const scanFromFoodDetail = () => {
    setSelectedFood(null)
    navigateNutrition('scan')
  }

  if (!profileReady) return <NutritionOnboarding onComplete={completeProfile} initialProfile={profileDraft} editing={false} />

  if (activeSection === 'profile') return <NutritionProfileEditor
    onSave={(nextProfile) => { completeProfile(nextProfile); navigateNutrition('today') }}
    initialProfile={profileDraft}
    onCancel={() => navigateNutrition('today')}
  />

  if (selectedFood && selectedFoodSummary) return <NutritionFoodDetail
    item={selectedFoodSummary}
    relatedItems={relatedFoodSummaries}
    initialSaved={savedFoodIds.has(selectedFood.id)}
    detailsBasePath={`${import.meta.env.BASE_URL}data/nutrition-details`}
    onBack={closeFoodDetail}
    onAdd={addFoodFromDetail}
    onSave={saveFood}
    onScan={scanFromFoodDetail}
    onSelectRelated={(item) => {
      const selected = catalogSnapshot.find((candidate) => candidate.id === item.id)
      if (selected) openFoodDetail(selected, catalogSnapshot)
    }}
  />

  const selectedLoggedMeal = selectedLoggedMealId ? meals.find((meal) => meal.id === selectedLoggedMealId) ?? null : null

  const toastContent = toast && <div className="nutrition-toast" role="status"><Check size={16} /><span>{toast.text}</span>{toast.action && <button type="button" onClick={() => { if (messageTimer.current) window.clearTimeout(messageTimer.current); setToast(null); toast.action?.onClick() }}>{toast.action.label}</button>}</div>

  if (selectedLoggedMeal) return (
    <div className="page nutrition-page nutrition-page--workspace" data-testid="captured-meal-detail-page">
      {toastContent}
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
          deleteMeal(mealId)
          setSelectedLoggedMealId(null)
          showMessage(`Đã xóa bữa ăn ${selectedLoggedMeal.title}`)
        }}
      />
    </div>
  )
  const editingMeal = editingMealId ? meals.find((meal) => meal.id === editingMealId) ?? null : null
  const quickSheets = <>
    {quickAddOpen && <QuickAddSheet
      savedCount={savedFoodIds.size}
      onClose={() => setQuickAddOpen(false)}
      onScan={() => { setQuickAddOpen(false); navigateNutrition('scan') }}
      onCatalog={() => { setQuickAddOpen(false); openCatalog(false) }}
      onSaved={() => { setQuickAddOpen(false); openCatalog(true) }}
      onWater={() => { setQuickAddOpen(false); setWaterSheetOpen(true) }}
      onExercise={() => { setQuickAddOpen(false); setExerciseSheetOpen(true) }}
    />}
    {waterSheetOpen && <WaterLogSheet current={water} goal={waterGoal} dateLabel={selectedDateLabel} onClose={() => setWaterSheetOpen(false)} onLog={logWater} />}
    {exerciseSheetOpen && <ExerciseLogSheet dateLabel={selectedDateLabel} weightKg={profileDraft.weightKg} onClose={() => setExerciseSheetOpen(false)} onSave={saveActivity} />}
    {pendingFood && <MealEditorSheet food={pendingFood} initialDate={selectedDate} onClose={() => setPendingFood(null)} onConfirm={commitCatalogFood} />}
    {editingMeal && <MealLogEditorSheet meal={editingMeal} onClose={() => setEditingMealId(null)} onConfirm={(draft) => editMeal(editingMeal.id, draft)} />}
  </>

  if (activeSection === 'scan') return (
    <div className="page nutrition-page nutrition-page--workspace" data-testid="nutrition-dashboard">
      {toastContent}
      <div className="nutrition-workspace">
        <NutritionSectionNav activeSection="today" onSectionChange={(section) => navigateNutrition(section)} onScan={() => navigateNutrition('scan')} onOpenCatalog={() => openCatalog(false)} onOpenAskAura={openAssistant} />
        <FoodScanModal key={resolvedOwnerId} initialDate={selectedDate} storageOwnerId={resolvedOwnerId} allowDemo={isDemo} presentation="page" onClose={() => navigateNutrition('today')} onOpenCatalog={() => openCatalog(false)} onSave={saveScannedMeal} onAnalyzeImage={onAnalyzeImage} />
      </div>
      {quickSheets}
    </div>
  )

  if (activeSection === 'catalog') return (
    <div className="page nutrition-page nutrition-page--workspace" data-testid="nutrition-dashboard">
      {toastContent}
      <div className="nutrition-workspace">
        <NutritionSectionNav activeSection="catalog" onSectionChange={(section) => navigateNutrition(section)} onScan={() => navigateNutrition('scan')} onOpenCatalog={() => openCatalog(false)} onOpenAskAura={openAssistant} />
        <FoodCatalogModal presentation="page" catalog={foodCatalog} savedFoodIds={savedFoodIds} initialSavedOnly={catalogSavedOnly} allowDemo={isDemo} onClose={() => navigateNutrition('today')} onAdd={queueCatalogFood} onOpenDetail={openFoodDetail} />
      </div>
      {quickSheets}
    </div>
  )

  return (
    <div className="page nutrition-page nutrition-page--workspace" data-testid="nutrition-dashboard">
      {toastContent}
      <NutritionWorkspace
        activeSection={workspaceSection}
        onSectionChange={(section) => navigateNutrition(section)}
        onScan={() => navigateNutrition('scan')}
        onOpenCatalog={() => openCatalog(false)}
        onOpenAskAura={openAssistant}
        todayContent={<NutritionDashboardHome
          firstName={firstName}
          selectedDate={selectedDate}
          selectedDateLabel={selectedDateLabel}
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
          qualityDataComplete={qualityDataComplete}
          water={water}
          waterGoal={waterGoal}
          goalLabel={GOAL_LABELS[profileDraft.goal]}
          trainingSessions={profileDraft.trainingSessions}
          dailyPlan={dailyPlan}
          allergies={profileDraft.allergies}
          onSelectDate={setSelectedDate}
          onShiftWeek={shiftHomeWeek}
          onOpenQuickAdd={() => setQuickAddOpen(true)}
          onOpenCatalog={() => openCatalog(false)}
          onOpenWater={() => setWaterSheetOpen(true)}
          onOpenExercise={() => setExerciseSheetOpen(true)}
          onAskAura={openAssistant}
          onLogWater={logWater}
          onEditProfile={() => navigateNutrition('profile')}
          onOpenMeal={setSelectedLoggedMealId}
          onDeleteMeal={deleteMeal}
          onDeleteActivity={deleteActivity}
        />}
        diary={{
          dateLabel: selectedDateLabel,
          targets: { calories: calorieGoal, protein: proteinGoal, carbs: carbGoal, fat: fatGoal, waterMl: waterGoal },
          meals: workspaceDiaryMeals,
          activities: selectedDayActivities.map((activity) => ({ id: activity.id, time: activity.startTime, title: activity.title, durationMinutes: activity.durationMinutes, intensity: activity.intensity, estimatedCalories: activity.estimatedCalories })),
          waterEntries: waterEntries.filter((entry) => entry.date === selectedDate).map((entry) => ({ id: entry.id, time: entry.time, amountMl: entry.amountMl })),
          waterMl: water,
          assistantBrief: loggedMeals.length ? `Bạn còn ${formatNumber(Math.max(0, calorieGoal - caloriesConsumed))} kcal và ${formatNumber(Math.max(0, proteinGoal - proteinConsumed))}g đạm. Hãy dùng đây như gợi ý, không phải chỉ định.` : undefined,
          onShiftDate: shiftSelectedDate,
          onAddMeal: () => navigateNutrition('scan'),
          onAddWater: () => setWaterSheetOpen(true),
          onAddExercise: () => setExerciseSheetOpen(true),
          onOpenMeal: setSelectedLoggedMealId,
          onEditMeal: setEditingMealId,
          onDeleteMeal: deleteMeal,
          onDeleteActivity: deleteActivity,
        }}
        plan={{
          days: workspacePlanDays,
          selectedDayId: planSelectedDay,
          meals: workspacePlannedMeals,
          dailyCalorieGoal: calorieGoal,
          strategyTitle: profileDraft.goal === 'gain-muscle' ? 'Đủ đạm, ưu tiên phục hồi' : profileDraft.goal === 'lose-fat' ? 'No lâu, thâm hụt vừa phải' : 'Cân bằng và dễ duy trì',
          strategyDescription: `Bản nháp dựa trên mục tiêu ${GOAL_LABELS[profileDraft.goal].toLocaleLowerCase('vi-VN')}, ${profileDraft.trainingSessions} buổi tập/tuần và phong cách ${profileDraft.eatingStyle.toLocaleLowerCase('vi-VN')}.`,
          constraints: [profileDraft.allergies ? `Tránh: ${profileDraft.allergies}` : 'Chưa ghi nhận dị ứng', `Mục tiêu ${formatNumber(calorieGoal)} kcal/ngày`, `${profileDraft.trainingSessions} buổi tập/tuần`],
          onSelectDay: setPlanSelectedDay,
          onGeneratePlan: () => { setPlanGenerated(true); showMessage('Đã tạo bản nháp 7 ngày; Aura chưa tự lưu hoặc thay đổi mục tiêu của bạn') },
          onAddMeal: () => openCatalog(false),
          onReplaceMeal: () => { openCatalog(false); showMessage('Chọn món có macro tương đương trong thư viện') },
        }}
        insights={{
          period: insightsPeriod,
          periodLabel: `${insightWindowDays} ngày gần nhất`,
          assistantSummary: insightDaysWithMeals < 3
            ? `Aura mới có ${insightDaysWithMeals} ngày bữa ăn. Ghi thêm ${3 - insightDaysWithMeals} ngày để mở phân tích xu hướng đáng tin cậy.`
            : undefined,
          metrics: [
            { id: 'energy', label: 'Kcal trung bình', value: insightDaysWithMeals ? `${formatNumber(averageCalories)} kcal` : '—', detail: `${insightDaysWithMeals} ngày có bữa ăn`, state: insightDaysWithMeals && averageCalories > calorieGoal * 1.12 ? 'warning' : 'neutral' },
            { id: 'protein', label: 'Đạt mục tiêu đạm', value: insightDaysWithMeals ? `${proteinCoverage}%` : '—', detail: insightDaysWithMeals ? `Trung bình ${formatNumber(averageProtein)}g/ngày có log` : 'Chưa có nhật ký bữa ăn', state: !insightDaysWithMeals ? 'neutral' : proteinCoverage >= 85 ? 'positive' : 'warning' },
            { id: 'water', label: 'Đạt mục tiêu nước', value: insightWaterDateKeys.length ? `${waterCoverage}%` : '—', detail: insightWaterDateKeys.length ? `Trung bình ${formatNumber(averageWater)} ml · ${insightWaterDateKeys.length} ngày có log` : 'Chưa có nhật ký nước', state: !insightWaterDateKeys.length ? 'neutral' : waterCoverage >= 80 ? 'positive' : 'warning' },
            { id: 'activity', label: 'Vận động', value: `${formatNumber(insightActivities.reduce((sum, activity) => sum + activity.durationMinutes, 0))} phút`, detail: `${insightActivities.length} buổi · kcal theo dõi riêng`, state: insightActivities.length ? 'positive' : 'neutral' },
          ],
          trend: insightTrend,
          insights: [
            { id: 'protein', title: !insightDaysWithMeals ? 'Chưa có dữ liệu đạm' : proteinCoverage >= 85 ? 'Đạm đang khá đều' : 'Ưu tiên đạm ở bữa tiếp theo', description: !insightDaysWithMeals ? 'Ghi bữa ăn để Aura so sánh lượng đạm với mục tiêu.' : proteinCoverage >= 85 ? 'Mức trung bình các ngày có nhật ký đang gần mục tiêu.' : `Các ngày có nhật ký mới đạt khoảng ${proteinCoverage}% mục tiêu đạm.`, action: insightDaysWithMeals ? 'Tìm món giàu đạm' : 'Mở nhật ký', tone: !insightDaysWithMeals ? 'neutral' : proteinCoverage >= 85 ? 'positive' : 'attention', evidence: insightDaysWithMeals ? [`${formatNumber(averageProtein)}g trung bình`, `${formatNumber(proteinGoal)}g mục tiêu`] : ['Chưa có ngày bữa ăn'] },
            { id: 'water', title: !insightWaterDateKeys.length ? 'Chưa có dữ liệu nước' : waterCoverage >= 80 ? 'Nước đang trong nhịp tốt' : 'Dữ liệu nước còn thấp', description: !insightWaterDateKeys.length ? 'Ghi từng lần uống để Aura bắt đầu phân tích.' : waterCoverage >= 80 ? 'Tiếp tục chia đều lượng nước trong ngày.' : 'Ghi từng lần uống để Aura phân tích đáng tin cậy hơn.', action: 'Ghi nước', tone: !insightWaterDateKeys.length ? 'neutral' : waterCoverage >= 80 ? 'positive' : 'attention', evidence: insightWaterDateKeys.length ? [`${formatNumber(averageWater)} ml trung bình trên ${insightWaterDateKeys.length} ngày có log`] : ['Chưa có ngày ghi nước'] },
            { id: 'completeness', title: 'Độ đầy đủ quyết định độ tin cậy', description: `Có dữ liệu ở ${insightDaysWithAnyData}/${insightWindowDays} ngày. Aura không suy đoán cho ngày trống.`, action: 'Mở nhật ký', tone: 'neutral', evidence: [`${Math.round(dataCompleteness)}% đầy đủ`] },
          ],
          dataCompleteness,
          onPeriodChange: setInsightsPeriod,
          onInsightAction: (id) => { if (id === 'protein' && insightDaysWithMeals) openCatalog(false); else if (id === 'water') setWaterSheetOpen(true); else navigateNutrition('diary') },
          onAskAura: openAssistant,
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
