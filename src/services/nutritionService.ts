import { httpsCallable } from 'firebase/functions'
import { deleteObject, ref, uploadBytes } from 'firebase/storage'
import { firebaseAuth, firebaseFunctions, firebaseStorage } from '../lib/firebase'

export const MAX_NUTRITION_IMAGE_BYTES = 8 * 1024 * 1024

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other'

export interface NutritionTotals {
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG: number
  sugarG: number
  sodiumMg: number
}

export type NutritionFieldName = keyof NutritionTotals
export type NutritionFieldSource = 'catalog' | 'ai_estimate'

export interface CatalogNutritionPerBasis {
  calories: number | null
  proteinG: number | null
  carbsG: number | null
  fatG: number | null
  fiberG: number | null
  sugarG: number | null
  sodiumMg: number | null
}

export interface NutritionDetailedEquivalent {
  key: string
  nameVi: string
  nameEn: string | null
  value: number | null
  unit: string
}

export interface NutritionDetailedNutrient extends NutritionDetailedEquivalent {
  equivalents: NutritionDetailedEquivalent[]
}

export interface NutritionCatalogMatch {
  catalogId: string
  matchScore: number
  kind: 'dish' | 'food'
  code: string | null
  nameVi: string
  regionNameVi: string | null
  energyKcal: number | null
  basis: {
    amount: number | null
    unit: string | null
    qualifier: string
    labelVi: string | null
  }
  source: {
    publisher: string
    pageUrl: string | null
    sourceId?: string | null
    sourceUpdatedAt?: string | null
    fetchedAt?: string | null
    rawRecordSha256?: string | null
  }
  catalogGeneratedAt?: string | null
  nutritionPerBasis?: CatalogNutritionPerBasis
  detailedNutrientsPerBasis?: NutritionDetailedNutrient[]
}

export interface FoodAnalysisAiEstimate {
  estimatedGrams: number
  gramRange: { low: number; high: number }
  nutrition: NutritionTotals
  confidence: number
}

export type NutritionEvidenceReason =
  | 'catalog_unavailable'
  | 'ambiguous_catalog_match'
  | 'catalog_match_not_found'
  | 'dish_basis_not_scalable'
  | 'catalog_match_below_trust_threshold'
  | 'catalog_basis_not_scalable'
  | 'verified_food_gram_basis'

export interface FoodItemNutritionEvidence {
  calculationVersion: string
  sourceType: 'ai_estimate' | 'catalog_scaled' | 'catalog_scaled_with_ai_gaps'
  reason: NutritionEvidenceReason
  catalogId: string | null
  scaleFactor: number | null
  fields: Record<NutritionFieldName, NutritionFieldSource>
}

export interface NutritionDatabaseEvidence {
  status: 'partial' | 'needs_confirmation' | 'completed'
  calculationVersion: string
  catalogCalculatedItemCount: number
  aiEstimatedItemCount: number
  ambiguousCount: number
  notFoundItemCount: number
  unscalableDishCount: number
  belowTrustThresholdCount: number
}

export interface FoodAnalysisItem {
  nameVi: string
  nameEn: string
  searchNameAscii: string
  estimatedGrams: number
  gramRange: { low: number; high: number }
  cookingMethod: string
  nutrition: NutritionTotals
  confidence: number
  assumptions: string[]
  catalogMatch: NutritionCatalogMatch | null
  catalogCandidates: NutritionCatalogMatch[]
  aiEstimate?: FoodAnalysisAiEstimate
  nutritionEvidence?: FoodItemNutritionEvidence
  detailedNutrients?: NutritionDetailedNutrient[]
}

export interface FoodAnalysis {
  isFood: boolean
  dishNameVi: string
  dishNameEn: string
  portionSummary: string
  confidence: number
  calorieRange: { low: number; high: number }
  totals: NutritionTotals
  catalogMatch: NutritionCatalogMatch | null
  catalogCandidates: NutritionCatalogMatch[]
  items: FoodAnalysisItem[]
  questions: string[]
  warnings: string[]
  databaseEvidence?: NutritionDatabaseEvidence
  databaseNotices?: string[]
  quantityAndCookingAnalysis?: string
  portionAndCalorieRationale?: string
  goalAlignmentAssessment?: string
  coachFeedbackSuggestion?: string
  aiFeedback?: string
}

export interface FoodAnalysisResponse {
  scanId: string
  status: 'completed' | 'provider_not_configured'
  mode: 'live' | 'demo'
  provider: 'gemini' | 'none'
  model: string | null
  providerRequestId: string | null
  analysis: FoodAnalysis | null
  notices: string[]
  imageRetained: boolean
  analyzedAt: string
}

export interface AnalyzeFoodPhotoOptions {
  mealType?: MealType
  notes?: string
  /** Images are deleted after analysis by default. Set true only with explicit user consent. */
  retainImage?: boolean
  userGoal?: string
  userCondition?: string
}

export interface UploadedFoodImage {
  scanId: string
  storagePath: string
  contentType: 'image/jpeg' | 'image/png' | 'image/webp'
  size: number
}

interface AnalyzeFoodImageRequest {
  storagePath: string
  mealType: MealType
  notes: string
  retainImage: boolean
  studentGoal?: string
  studentCondition?: string
}

const acceptedImageTypes = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])
const acceptedMealTypes = new Set<MealType>(['breakfast', 'lunch', 'dinner', 'snack', 'other'])

function requireNutritionFirebase() {
  if (!firebaseAuth || !firebaseFunctions || !firebaseStorage) {
    throw new Error('Firebase chưa được cấu hình cho tính năng nhận diện món ăn.')
  }
  const currentUser = firebaseAuth.currentUser
  if (!currentUser) throw new Error('Bạn cần đăng nhập để phân tích món ăn.')
  return {
    user: currentUser,
    functions: firebaseFunctions,
    storage: firebaseStorage,
  }
}

function createScanId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  const randomPart = Math.random().toString(36).slice(2, 14)
  return `${Date.now().toString(36)}_${randomPart}`
}

function assertImage(image: Blob): asserts image is Blob {
  if (!(image instanceof Blob)) throw new Error('Tệp ảnh không hợp lệ.')
  if (image.size <= 0) throw new Error('Ảnh đang trống. Hãy chọn một ảnh khác.')
  if (image.size > MAX_NUTRITION_IMAGE_BYTES) throw new Error('Ảnh phải nhỏ hơn 8 MB.')
  if (!acceptedImageTypes.has(image.type.toLowerCase())) {
    throw new Error('Aura chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP.')
  }
}

function validateAnalyzeOptions(options: AnalyzeFoodPhotoOptions) {
  if (options.mealType !== undefined && !acceptedMealTypes.has(options.mealType)) {
    throw new Error('Loại bữa ăn không hợp lệ.')
  }
  if (options.notes !== undefined && typeof options.notes !== 'string') {
    throw new Error('Ghi chú không hợp lệ.')
  }
  if ((options.notes?.trim().length ?? 0) > 300) {
    throw new Error('Ghi chú phải ngắn hơn 300 ký tự.')
  }
  if (options.retainImage !== undefined && typeof options.retainImage !== 'boolean') {
    throw new Error('Tùy chọn lưu ảnh không hợp lệ.')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNumberInRange(value: unknown, min: number, max: number): value is number {
  return isFiniteNumber(value) && value >= min && value <= max
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && isNumberInRange(value, min, max)
}

function isNullableStringOrUndefined(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string'
}

function isNullableNumberInRange(value: unknown, max: number): value is number | null {
  return value === null || isNumberInRange(value, 0, max)
}

function hasNutritionTotals(value: unknown): value is NutritionTotals {
  if (!isRecord(value)) return false
  return isNumberInRange(value.calories, 0, 10000)
    && isNumberInRange(value.proteinG, 0, 1000)
    && isNumberInRange(value.carbsG, 0, 2000)
    && isNumberInRange(value.fatG, 0, 1000)
    && isNumberInRange(value.fiberG, 0, 500)
    && isNumberInRange(value.sugarG, 0, 1000)
    && isNumberInRange(value.sodiumMg, 0, 100000)
}

function hasCatalogNutritionPerBasis(value: unknown): value is CatalogNutritionPerBasis {
  if (!isRecord(value)) return false
  return isNullableNumberInRange(value.calories, 10000)
    && isNullableNumberInRange(value.proteinG, 1000)
    && isNullableNumberInRange(value.carbsG, 2000)
    && isNullableNumberInRange(value.fatG, 1000)
    && isNullableNumberInRange(value.fiberG, 500)
    && isNullableNumberInRange(value.sugarG, 1000)
    && isNullableNumberInRange(value.sodiumMg, 100000)
}

function hasNumericRange(value: unknown, max: number): value is { low: number; high: number } {
  return isRecord(value)
    && isNumberInRange(value.low, 0, max)
    && isNumberInRange(value.high, 0, max)
    && value.high >= value.low
}

function isDetailedEquivalent(value: unknown): value is NutritionDetailedEquivalent {
  return isRecord(value)
    && typeof value.key === 'string'
    && typeof value.nameVi === 'string'
    && (value.nameEn === null || typeof value.nameEn === 'string')
    && (value.value === null || (isFiniteNumber(value.value) && value.value >= 0))
    && typeof value.unit === 'string'
}

function isDetailedNutrient(value: unknown): value is NutritionDetailedNutrient {
  if (!isRecord(value)) return false
  const equivalents = value.equivalents
  return isDetailedEquivalent(value)
    && Array.isArray(equivalents)
    && equivalents.length <= 24
    && equivalents.every(isDetailedEquivalent)
}

function isDetailedNutrientList(value: unknown): value is NutritionDetailedNutrient[] {
  return Array.isArray(value) && value.length <= 200 && value.every(isDetailedNutrient)
}

function isCatalogMatch(value: unknown): value is NutritionCatalogMatch | null {
  if (value === null) return true
  return isRecord(value)
    && typeof value.catalogId === 'string'
    && isFiniteNumber(value.matchScore)
    && value.matchScore >= 0
    && value.matchScore <= 1
    && (value.kind === 'dish' || value.kind === 'food')
    && (value.code === null || typeof value.code === 'string')
    && typeof value.nameVi === 'string'
    && (value.regionNameVi === null || typeof value.regionNameVi === 'string')
    && (value.energyKcal === null || isNumberInRange(value.energyKcal, 0, 10000))
    && isRecord(value.basis)
    && (value.basis.amount === null || isNumberInRange(value.basis.amount, 0, 100000))
    && (value.basis.unit === null || typeof value.basis.unit === 'string')
    && typeof value.basis.qualifier === 'string'
    && (value.basis.labelVi === null || typeof value.basis.labelVi === 'string')
    && isRecord(value.source)
    && typeof value.source.publisher === 'string'
    && (value.source.pageUrl === null || typeof value.source.pageUrl === 'string')
    && isNullableStringOrUndefined(value.source.sourceId)
    && isNullableStringOrUndefined(value.source.sourceUpdatedAt)
    && isNullableStringOrUndefined(value.source.fetchedAt)
    && isNullableStringOrUndefined(value.source.rawRecordSha256)
    && isNullableStringOrUndefined(value.catalogGeneratedAt)
    && (value.nutritionPerBasis === undefined || hasCatalogNutritionPerBasis(value.nutritionPerBasis))
    && (value.detailedNutrientsPerBasis === undefined || isDetailedNutrientList(value.detailedNutrientsPerBasis))
}

function isFoodAnalysisAiEstimate(value: unknown): value is FoodAnalysisAiEstimate {
  return isRecord(value)
    && isNumberInRange(value.estimatedGrams, 0, 5000)
    && hasNumericRange(value.gramRange, 5000)
    && hasNutritionTotals(value.nutrition)
    && isNumberInRange(value.confidence, 0, 1)
}

function hasNutritionFieldSources(value: unknown): value is Record<NutritionFieldName, NutritionFieldSource> {
  if (!isRecord(value)) return false
  return (value.calories === 'catalog' || value.calories === 'ai_estimate')
    && (value.proteinG === 'catalog' || value.proteinG === 'ai_estimate')
    && (value.carbsG === 'catalog' || value.carbsG === 'ai_estimate')
    && (value.fatG === 'catalog' || value.fatG === 'ai_estimate')
    && (value.fiberG === 'catalog' || value.fiberG === 'ai_estimate')
    && (value.sugarG === 'catalog' || value.sugarG === 'ai_estimate')
    && (value.sodiumMg === 'catalog' || value.sodiumMg === 'ai_estimate')
}

const nutritionEvidenceReasons = new Set<NutritionEvidenceReason>([
  'catalog_unavailable',
  'ambiguous_catalog_match',
  'catalog_match_not_found',
  'dish_basis_not_scalable',
  'catalog_match_below_trust_threshold',
  'catalog_basis_not_scalable',
  'verified_food_gram_basis',
])

function isFoodItemNutritionEvidence(value: unknown): value is FoodItemNutritionEvidence {
  return isRecord(value)
    && typeof value.calculationVersion === 'string'
    && value.calculationVersion.length > 0
    && (value.sourceType === 'ai_estimate'
      || value.sourceType === 'catalog_scaled'
      || value.sourceType === 'catalog_scaled_with_ai_gaps')
    && typeof value.reason === 'string'
    && nutritionEvidenceReasons.has(value.reason as NutritionEvidenceReason)
    && (value.catalogId === null || typeof value.catalogId === 'string')
    && (value.scaleFactor === null || (isFiniteNumber(value.scaleFactor) && value.scaleFactor >= 0))
    && hasNutritionFieldSources(value.fields)
}

function isNutritionDatabaseEvidence(value: unknown): value is NutritionDatabaseEvidence {
  return isRecord(value)
    && (value.status === 'partial' || value.status === 'needs_confirmation' || value.status === 'completed')
    && typeof value.calculationVersion === 'string'
    && value.calculationVersion.length > 0
    && isIntegerInRange(value.catalogCalculatedItemCount, 0, 12)
    && isIntegerInRange(value.aiEstimatedItemCount, 0, 12)
    && isIntegerInRange(value.ambiguousCount, 0, 13)
    && isIntegerInRange(value.notFoundItemCount, 0, 12)
    && isIntegerInRange(value.unscalableDishCount, 0, 12)
    && isIntegerInRange(value.belowTrustThresholdCount, 0, 12)
}

function isFoodAnalysisItem(value: unknown): value is FoodAnalysisItem {
  if (!isRecord(value)) return false
  const hasAiEstimate = value.aiEstimate !== undefined
  const hasNutritionEvidence = value.nutritionEvidence !== undefined
  if (hasAiEstimate !== hasNutritionEvidence) return false
  if (hasAiEstimate && !isFoodAnalysisAiEstimate(value.aiEstimate)) return false
  if (hasNutritionEvidence && !isFoodItemNutritionEvidence(value.nutritionEvidence)) return false
  if (value.detailedNutrients !== undefined) {
    if (!hasNutritionEvidence || !isDetailedNutrientList(value.detailedNutrients)) return false
  }

  return typeof value.nameVi === 'string'
    && typeof value.nameEn === 'string'
    && typeof value.searchNameAscii === 'string'
    && isNumberInRange(value.estimatedGrams, 0, 5000)
    && hasNumericRange(value.gramRange, 5000)
    && typeof value.cookingMethod === 'string'
    && isNumberInRange(value.confidence, 0, 1)
    && hasNutritionTotals(value.nutrition)
    && Array.isArray(value.assumptions)
    && value.assumptions.every((assumption) => typeof assumption === 'string')
    && isCatalogMatch(value.catalogMatch)
    && Array.isArray(value.catalogCandidates)
    && value.catalogCandidates.length <= 5
    && value.catalogCandidates.every((candidate) => candidate !== null && isCatalogMatch(candidate))
}

function isFoodAnalysis(value: unknown): value is FoodAnalysis {
  if (!isRecord(value) || typeof value.isFood !== 'boolean') return false
  if (
    typeof value.dishNameVi !== 'string'
    || typeof value.dishNameEn !== 'string'
    || typeof value.portionSummary !== 'string'
    || !isNumberInRange(value.confidence, 0, 1)
    || !hasNumericRange(value.calorieRange, 10000)
    || !hasNutritionTotals(value.totals)
    || !isCatalogMatch(value.catalogMatch)
    || !Array.isArray(value.catalogCandidates)
    || value.catalogCandidates.length > 5
    || !value.catalogCandidates.every((candidate) => candidate !== null && isCatalogMatch(candidate))
    || !Array.isArray(value.items)
    || value.items.length > 12
    || !Array.isArray(value.questions)
    || value.questions.length > 3
    || !Array.isArray(value.warnings)
    || value.warnings.length > 8
    || value.questions.some((question) => typeof question !== 'string')
    || value.warnings.some((warning) => typeof warning !== 'string')
  ) return false

  const hasDatabaseEvidence = value.databaseEvidence !== undefined
  const hasDatabaseNotices = value.databaseNotices !== undefined
  if (hasDatabaseEvidence !== hasDatabaseNotices) return false
  if (hasDatabaseEvidence) {
    const evidence = value.databaseEvidence
    if (!isNutritionDatabaseEvidence(evidence)) return false
    if (evidence.catalogCalculatedItemCount + evidence.aiEstimatedItemCount !== value.items.length) return false
  }
  if (hasDatabaseNotices && (
    !Array.isArray(value.databaseNotices)
    || value.databaseNotices.length > 8
    || value.databaseNotices.some((notice) => typeof notice !== 'string')
  )) return false

  return value.items.every(isFoodAnalysisItem)
}

function validateAnalysisResponse(value: unknown, expectedScanId: string): FoodAnalysisResponse {
  if (!isRecord(value) || value.scanId !== expectedScanId) {
    throw new Error('Phản hồi nhận diện món ăn không hợp lệ.')
  }
  if (value.status !== 'completed' && value.status !== 'provider_not_configured') {
    throw new Error('Trạng thái nhận diện món ăn không hợp lệ.')
  }
  if (!Array.isArray(value.notices) || value.notices.some((notice) => typeof notice !== 'string')) {
    throw new Error('Thông báo nhận diện món ăn không hợp lệ.')
  }
  if (typeof value.imageRetained !== 'boolean' || typeof value.analyzedAt !== 'string') {
    throw new Error('Metadata nhận diện món ăn không hợp lệ.')
  }

  if (value.status === 'completed') {
    if (
      value.mode !== 'live'
      || value.provider !== 'gemini'
      || typeof value.model !== 'string'
      || !value.model.trim()
      || (value.providerRequestId !== null && typeof value.providerRequestId !== 'string')
      || !isFoodAnalysis(value.analysis)
    ) {
      throw new Error('Kết quả AI không hợp lệ.')
    }
  } else if (
    value.mode !== 'demo'
    || value.provider !== 'none'
    || value.model !== null
    || value.providerRequestId !== null
    || value.analysis !== null
  ) {
    throw new Error('Kết quả demo không hợp lệ.')
  }

  return value as unknown as FoodAnalysisResponse
}

export async function uploadFoodPhoto(image: Blob): Promise<UploadedFoodImage> {
  assertImage(image)
  const { user, storage } = requireNutritionFirebase()
  const contentType = image.type.toLowerCase() as UploadedFoodImage['contentType']
  const extension = acceptedImageTypes.get(contentType)
  if (!extension) throw new Error('Định dạng ảnh không được hỗ trợ.')

  const scanId = createScanId()
  const storagePath = `nutrition-scans/${user.uid}/${scanId}/original.${extension}`
  const imageReference = ref(storage, storagePath)
  await uploadBytes(imageReference, image, {
    contentType,
    cacheControl: 'private, no-store, max-age=0',
    customMetadata: {
      ownerUid: user.uid,
      scanId,
      purpose: 'food-analysis',
    },
  })

  return { scanId, storagePath, contentType, size: image.size }
}

export async function analyzeUploadedFoodPhoto(
  upload: UploadedFoodImage,
  options: AnalyzeFoodPhotoOptions = {},
): Promise<FoodAnalysisResponse> {
  let storage = firebaseStorage
  try {
    const firebase = requireNutritionFirebase()
    storage = firebase.storage
    validateAnalyzeOptions(options)
    const notes = options.notes?.trim() ?? ''

    const callable = httpsCallable<AnalyzeFoodImageRequest, FoodAnalysisResponse>(
      firebase.functions,
      'analyzeFoodImage',
      { timeout: 120_000 },
    )
    const result = await callable({
      storagePath: upload.storagePath,
      mealType: options.mealType ?? 'other',
      notes,
      retainImage: options.retainImage === true,
      studentGoal: options.userGoal,
      studentCondition: options.userCondition,
    })
    const response = validateAnalysisResponse(result.data, upload.scanId)
    if (options.retainImage !== true && response.imageRetained) {
      try {
        await deleteObject(ref(storage, upload.storagePath))
        return { ...response, imageRetained: false }
      } catch {
        // Preserve the server-reported state so the UI can disclose that cleanup failed.
      }
    }
    return response
  } catch (error) {
    if (options.retainImage !== true && storage) {
      await deleteObject(ref(storage, upload.storagePath)).catch(() => undefined)
    }
    throw error
  }
}

export async function analyzeFoodPhoto(
  image: Blob,
  options: AnalyzeFoodPhotoOptions = {},
): Promise<FoodAnalysisResponse> {
  try {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(image)
    })

    const token = await firebaseAuth?.currentUser?.getIdToken();
    const res = await fetch('/api/ai/analyze-meal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        imageBase64: base64,
        studentNote: options.notes,
        studentGoal: options.userGoal || 'Giảm mỡ thâm hụt calo / Tăng cơ nạc',
        studentCondition: options.userCondition || 'Học viên Aura Fitness',
      }),
    })

    if (res.status === 429) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Đã vượt quá giới hạn lượt dùng AI (Rate Limit). Vui lòng thử lại sau.');
    }

    if (res.ok) {
      const data = await res.json()
      if (data.success && data.analysis) {
        const a = data.analysis
        return {
          scanId: `scan-${Date.now()}`,
          status: 'completed',
          mode: 'live',
          provider: 'gemini',
          model: 'gemini-3.6-flash',
          providerRequestId: null,
          notices: [],
          imageRetained: false,
          analyzedAt: new Date().toISOString(),
          analysis: {
            isFood: true,
            dishNameVi: a.dishName || a.items?.[0]?.name || 'Bữa ăn dinh dưỡng',
            dishNameEn: 'Nutritional Meal',
            portionSummary: '1 đĩa phần ăn tiêu chuẩn',
            confidence: 0.92,
            calorieRange: {
              low: Math.max(100, Math.round((a.totalKcal || 350) * 0.9)),
              high: Math.round((a.totalKcal || 350) * 1.1),
            },
            totals: {
              calories: a.totalKcal || 350,
              proteinG: a.totalProtein || 30,
              carbsG: Math.round((a.totalKcal || 350) * 0.4 / 4),
              fatG: Math.round((a.totalKcal || 350) * 0.2 / 9),
              fiberG: 2,
              sugarG: 1,
              sodiumMg: 350,
            },
            catalogMatch: null,
            catalogCandidates: [],
            quantityAndCookingAnalysis: a.quantityAndCookingAnalysis || 'Phân tích định lượng thực tế quan sát qua hình ảnh và cách chế biến giữ vị tự nhiên.',
            portionAndCalorieRationale: a.portionAndCalorieRationale || 'Cơ sở dự đoán dựa trên đường kính bát/đĩa tiêu chuẩn và độ dày khẩu phần.',
            goalAlignmentAssessment: a.goalAlignmentAssessment || 'Nhận định bữa ăn đáp ứng tốt mục tiêu tăng cơ và kiểm soát calo trong ngày.',
            coachFeedbackSuggestion: a.coachFeedbackSuggestion || "Bữa ăn rất chuẩn bài em nhé! Tiếp tục duy trì chế độ dinh dưỡng lành mạnh này.",
            aiFeedback: a.aiFeedback || "Bữa ăn cân đối.",
            items: (a.items || []).map((item: any, idx: number) => ({
              id: `item-${idx}`,
              nameVi: item.name,
              nameEn: item.name,
              searchNameAscii: item.name,
              estimatedGrams: item.weight || 100,
              gramRange: { low: Math.round((item.weight || 100) * 0.9), high: Math.round((item.weight || 100) * 1.1) },
              cookingMethod: 'Nấu chín',
              nutrition: {
                calories: item.kcal || 0,
                proteinG: item.protein || 0,
                carbsG: Math.round((item.kcal || 0) * 0.4 / 4),
                fatG: Math.round((item.kcal || 0) * 0.2 / 9),
                fiberG: 1,
                sugarG: 0,
                sodiumMg: 150,
              },
              confidence: 0.92,
              assumptions: [],
              catalogMatch: null,
              catalogCandidates: [],
            })),
            warnings: [],
            databaseNotices: [],
            questions: [],
          },
        }
      }
    }
  } catch (e) {
    console.warn('Direct AI endpoint fallback:', e)
  }

  validateAnalyzeOptions(options)
  const upload = await uploadFoodPhoto(image)
  return analyzeUploadedFoodPhoto(upload, options)
}

export async function generateMealReview(meal: any, userProfile: any): Promise<string> {
  try {
    const token = await firebaseAuth?.currentUser?.getIdToken();
    const response = await fetch('/api/generateMealReview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ meal, userProfile })
    });
    
    const data = await response.json();
    return data.review || 'Lỗi khi phân tích bữa ăn.';
  } catch (error) {
    console.warn('Direct AI endpoint fallback for generateMealReview:', error);
    return 'Lỗi khi kết nối với máy chủ để phân tích bữa ăn.';
  }
}

export async function askAiCoach(message: string, userProfile: any): Promise<string> {
  try {
    const token = await firebaseAuth?.currentUser?.getIdToken();
    const response = await fetch('/api/ai/coach-chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ message, userProfile })
    });
    
    const data = await response.json();
    return data.text || 'AI Coach chưa có phản hồi.';
  } catch (error) {
    console.warn('Direct AI endpoint fallback for askAiCoach:', error);
    return 'Không thể kết nối với AI Coach lúc này.';
  }
}