import type {
  AnalyzeFoodPhotoOptions,
  FoodAnalysisItem,
  FoodAnalysisResponse,
  NutritionCatalogMatch,
} from '../../services/nutritionService'
import type { DataSyncState } from '../../dataSync/profileSync'

export type NutritionGoal = 'lose-fat' | 'gain-muscle' | 'maintain'

export interface NutritionProfileDraft {
  goal: NutritionGoal
  age: number
  biologicalSex: 'female' | 'male'
  heightCm: number
  weightKg: number
  targetWeightDeltaKg?: number
  targetTimeframeMonths?: number
  targetSpeedPace?: 'slow' | 'standard' | 'fast'
  activityLevel: 'low' | 'moderate' | 'high'
  trainingSessions: number
  eatingStyle: string
  allergies: string
  mealsPerDay?: number
  mealTimes?: string[]
  dislikes?: string
  budget?: 'low' | 'medium' | 'high' | 'unlimited'
  prepTime?: 'quick' | 'medium' | 'long'
  favoriteCuisine?: string
  reminders?: { water: boolean; breakfast: boolean; lunch: boolean; dinner: boolean }
  waterLiters?: number
}

export interface AiFoodItem {
  id: string
  name: string
  category?: string
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
  perGram?: { calories: number; protein: number; carbs: number; fat: number; fiber: number; sugar: number; sodium: number }
}

export interface NutritionMealDraft {
  quantityCookingAnalysis?: string
  portionCalorieRationale?: string
  goalAlignmentAssessment?: string
  calorieOptimizationTip?: string
  macroBalanceAssessment?: string
  coachFeedbackSuggestion?: string
  aiAnalysis?: any
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
  submitForReview?: boolean
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

export type NutritionClarificationResponse = 'confirmed' | 'adjust' | 'unknown'

export interface PersistedScanReview {
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
  quantityCookingAnalysis?: string
  portionCalorieRationale?: string
  goalAlignmentAssessment?: string
  calorieOptimizationTip?: string
  macroBalanceAssessment?: string
  coachFeedbackSuggestion?: string
}

export interface NutritionPageProps {
  displayName?: string
  isDemo?: boolean
  storageOwnerId?: string
  hasProfile?: boolean
  profile?: NutritionProfileDraft
  onProfileComplete?: (profile: NutritionProfileDraft) => void
  onMealSaved?: (meal: NutritionMealDraft) => void
  onAnalyzeImage?: (file: File, options?: AnalyzeFoodPhotoOptions) => Promise<NutritionImageAnalysisResponse>
  foodCatalog?: NutritionFoodCatalogItem[]
  onOpenEatClean?: () => void
  syncState?: DataSyncState
}

export interface MealLog {
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
  reviewStatus?: 'pending' | 'reviewed'
  coachFeedback?: string
  aiAnalysis?: any
  studentGoal?: string
  studentCondition?: string
}

export interface NutritionWaterLog { id: string; date: string; time: string; amountMl: number; createdAt: number }
export type NutritionActivityKind = 'strength' | 'running' | 'walking' | 'cycling' | 'hiit' | 'swimming' | 'yoga' | 'other'
export type NutritionActivityIntensity = 'low' | 'moderate' | 'high'
export interface NutritionActivityLog {
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
export interface NutritionActivityDraft extends Omit<NutritionActivityLog, 'id' | 'date' | 'source' | 'createdAt'> {}
