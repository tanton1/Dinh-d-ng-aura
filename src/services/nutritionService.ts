import { httpsCallable } from 'firebase/functions'
import { deleteObject, ref, uploadBytes } from 'firebase/storage'
import { firebaseAuth, initializeFirebaseAppCheck } from '../lib/firebase'
import { firebaseFunctions } from '../lib/firebaseFunctions'
import { firebaseStorage } from '../lib/firebaseStorage'
import { reportClientIssue } from './clientTelemetryService'
import { optimizeNutritionImageForUpload } from './nutritionImageOptimizer'

export const MAX_NUTRITION_IMAGE_BYTES = 8 * 1024 * 1024

const legacyFoodAnalysisPlaceholders = new Set([
  'bua an phu hop chi tieu nang luong va dam trong ngay',
  'muc calo vua van phu hop duy tri cho bua an chinh',
  'ham luong dam rat tot cho su phuc hoi co bap',
  'nhan dinh bua an dap ung tot muc tieu tang co va kiem soat calo trong ngay',
  'giu khau phan hien tai va uu tien gia vi it nang luong de kiem soat tong calo',
  'doi chieu luong dam carb chat beo va chat xo truoc khi dieu chinh khau phan',
])

function normalizeAnalysisText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function containsDegenerateAnalysisText(value: string): boolean {
  const unrelatedClaims = value.toLowerCase().match(/xinh xắn|xinh đẹp|quyến rũ|làn da|mịn màng|mượt mà|tỏa sáng|trẻ trung|đáng yêu|sức hút/g) ?? []
  if (unrelatedClaims.length >= 2) return true
  const tokens = normalizeAnalysisText(value).split(' ').filter(Boolean)
  if (tokens.length < 18) return false
  const ignored = new Set(['anh', 'ban', 'cac', 'cho', 'co', 'cua', 'da', 'de', 'duoc', 'khong', 'la', 'mot', 'nay', 'nen', 'nhung', 'qua', 'trong', 'tu', 'va', 'voi'])
  const contentTokens = tokens.filter((token) => token.length > 2 && !ignored.has(token))
  if (contentTokens.length < 10) return false
  const counts = new Map<string, number>()
  contentTokens.forEach((token) => counts.set(token, (counts.get(token) ?? 0) + 1))
  if (Math.max(...counts.values()) >= Math.max(5, Math.ceil(contentTokens.length * 0.14))) return true
  const tail = contentTokens.slice(-30)
  return tail.length >= 16 && new Set(tail).size / tail.length < 0.5
}

export function getUsableFoodAnalysisText(value: unknown): string {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  if (!text) return ''
  const normalized = normalizeAnalysisText(text)
  if (legacyFoodAnalysisPlaceholders.has(normalized)) return ''
  if (containsDegenerateAnalysisText(text)) return ''
  return text
}

export function getFoodAnalysisErrorMessage(error: unknown): string {
  const rawMessage = error instanceof Error
    ? error.message.trim()
    : isRecord(error) && typeof error.message === 'string'
      ? error.message.trim()
      : ''
  const rawCode = isRecord(error) && typeof error.code === 'string' ? error.code : ''
  const code = rawCode.replace(/^functions\//, '')
  const hasUsefulMessage = rawMessage.length > 0
    && !/^(internal|unknown|error)$/i.test(rawMessage)

  if (code === 'failed-precondition') {
    return hasUsefulMessage
      ? rawMessage
      : 'Aura chưa nhận ra món ăn trong ảnh này. Hãy thử ảnh rõ hơn và chụp trọn phần ăn.'
  }
  if (code === 'resource-exhausted') {
    return 'Dịch vụ AI đang bận. Vui lòng chờ một chút rồi thử lại chính ảnh này.'
  }
  if (code === 'deadline-exceeded') {
    return 'Phân tích mất nhiều thời gian hơn dự kiến. Vui lòng thử lại chính ảnh này.'
  }
  if (code === 'unavailable' || code === 'internal' || /^(internal|unknown)$/i.test(rawMessage)) {
    return code === 'unavailable' && hasUsefulMessage
      ? rawMessage
      : 'Aura AI chưa hoàn tất lần phân tích này. Bạn có thể thử lại chính ảnh vừa chọn.'
  }
  if (code === 'unauthenticated') {
    return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại rồi thử phân tích ảnh.'
  }
  if (code.startsWith('storage/') || /network|fetch|offline/i.test(rawMessage)) {
    return 'Không thể tải ảnh lên do kết nối mạng. Vui lòng kiểm tra mạng rồi thử lại.'
  }
  return hasUsefulMessage
    ? rawMessage
    : 'Không thể kết nối dịch vụ phân tích ảnh. Vui lòng kiểm tra mạng và thử lại.'
}

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
  calorieOptimizationTip?: string
  macroBalanceAssessment?: string
  aiFeedback?: string
  coachFeedbackSuggestion?: string
}

export interface FoodAnalysisResponse {
  scanId: string
  status: 'completed' | 'provider_not_configured'
  mode: 'live' | 'demo'
  provider: 'apikey_fun' | 'openrouter' | 'gemini' | 'none'
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

export type AiCoachImageKind = 'body' | 'meal'

export interface AiCoachImageAttachment extends UploadedFoodImage {
  kind: AiCoachImageKind
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
    || !Array.isArray(value.questions)
    || value.questions.length > 3
    || !Array.isArray(value.warnings)
    || value.warnings.length > 8
    || value.questions.some((question) => typeof question !== 'string')
    || value.warnings.some((warning) => typeof warning !== 'string')
    || ['quantityAndCookingAnalysis', 'portionAndCalorieRationale', 'goalAlignmentAssessment', 'calorieOptimizationTip', 'macroBalanceAssessment', 'aiFeedback', 'coachFeedbackSuggestion']
      .some((field) => value[field] !== undefined && typeof value[field] !== 'string')
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
      || (value.provider !== 'apikey_fun' && value.provider !== 'openrouter' && value.provider !== 'gemini')
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

async function uploadPrivateNutritionPhoto(
  image: Blob,
  purpose: 'food-analysis' | 'ai-coach-body' | 'ai-coach-meal',
): Promise<UploadedFoodImage> {
  assertImage(image)
  const { user, storage } = requireNutritionFirebase()
  const optimizedImage = await optimizeNutritionImageForUpload(image)
  const uploadImage = optimizedImage.size <= MAX_NUTRITION_IMAGE_BYTES ? optimizedImage : image
  assertImage(uploadImage)
  const contentType = uploadImage.type.toLowerCase() as UploadedFoodImage['contentType']
  const extension = acceptedImageTypes.get(contentType)
  if (!extension) throw new Error('Định dạng ảnh không được hỗ trợ.')

  const scanId = createScanId()
  const storagePath = `nutrition-scans/${user.uid}/${scanId}/original.${extension}`
  const imageReference = ref(storage, storagePath)
  await uploadBytes(imageReference, uploadImage, {
    contentType,
    cacheControl: 'private, no-store, max-age=0',
    customMetadata: {
      ownerUid: user.uid,
      scanId,
      purpose,
    },
  })

  return { scanId, storagePath, contentType, size: uploadImage.size }
}

export async function uploadFoodPhoto(image: Blob): Promise<UploadedFoodImage> {
  return uploadPrivateNutritionPhoto(image, 'food-analysis')
}

export async function uploadAiCoachPhoto(image: Blob, kind: AiCoachImageKind): Promise<AiCoachImageAttachment> {
  if (kind !== 'body' && kind !== 'meal') throw new Error('Loại ảnh tư vấn không hợp lệ.')
  await initializeFirebaseAppCheck()
  const upload = await uploadPrivateNutritionPhoto(image, `ai-coach-${kind}`)
  return { ...upload, kind }
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
    reportClientIssue('apikey_fun', error, { phase: 'analyze_food_callable', provider: 'apikey_fun', retryable: true })
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
  assertImage(image)
  validateAnalyzeOptions(options)
  try {
    await initializeFirebaseAppCheck()
    const upload = await uploadFoodPhoto(image)
    return await analyzeUploadedFoodPhoto(upload, options)
  } catch (error) {
    reportClientIssue('apikey_fun', error, { phase: 'analyze_food_pipeline', provider: 'apikey_fun', retryable: true })
    throw error
  }
}
export async function generateMealReview(meal: any, userProfile: any): Promise<string> {
  try {
    await initializeFirebaseAppCheck()
    const firebase = requireNutritionFirebase();
    const callable = httpsCallable<{ meal: any, userProfile: any }, { review: string }>(
      firebase.functions,
      'generateMealReview',
      { timeout: 30_000 },
    );
    const result = await callable({ meal, userProfile });
    return result.data.review || 'Lỗi khi phân tích bữa ăn.';
  } catch (err) {
    console.error('Error calling generateMealReview function:', err);
    return 'Lỗi khi kết nối với máy chủ để phân tích bữa ăn.';
  }
}

export type AiCoachSafetyLevel = 'standard' | 'caution' | 'urgent'

export interface AiCoachContextSnapshot {
  goalLabel?: string | null
  latestWeightKg?: number | null
  targetWeightKg?: number | null
  todayCalories?: number | null
  calorieGoal?: number | null
  todayProteinG?: number | null
  proteinGoalG?: number | null
  loggedDays7?: number | null
  workoutDays7?: number | null
  updatedAt?: string | null
}

export interface AiCoachLearningContext {
  courseTitle?: string
  chapter?: string
  lessonTitle?: string
  summary?: string
  takeaways?: string[]
  workbookSummary?: string
}

export interface AiCoachHistoryMessage {
  id: string
  sender: 'ai' | 'user'
  text: string
  createdAt?: string | null
}

export interface AiCoachOverview {
  history: AiCoachHistoryMessage[]
  context: AiCoachContextSnapshot
  dataUsed: string[]
  missingData: string[]
  suggestedReplies: string[]
}

export interface AiCoachResponse {
  text: string
  dataUsed: string[]
  missingData: string[]
  suggestedReplies: string[]
  safetyLevel: AiCoachSafetyLevel
  imageProcessed?: boolean
  provider?: 'apikey_fun' | 'openrouter' | 'none'
  model?: string | null
  providerRequestId?: string | null
}

const AI_COACH_OVERVIEW_TTL_MS = 3 * 60_000
const aiCoachOverviewCache = new Map<string, { expiresAt: number; value: AiCoachOverview }>()
const aiCoachOverviewRequests = new Map<string, Promise<AiCoachOverview>>()
const aiCoachOverviewExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>()

function aiCoachOverviewCacheKey(conversationId: string) {
  const uid = firebaseAuth?.currentUser?.uid || 'anonymous'
  return `${uid}:${conversationId}`
}

function readCachedAiCoachOverview(cacheKey: string): AiCoachOverview | null {
  const now = Date.now()
  const memoryEntry = aiCoachOverviewCache.get(cacheKey)
  if (memoryEntry && memoryEntry.expiresAt > now) return memoryEntry.value
  if (memoryEntry) aiCoachOverviewCache.delete(cacheKey)
  return null
}

function cacheAiCoachOverview(cacheKey: string, value: AiCoachOverview) {
  // Conversation history can contain sensitive health or emotional content.
  // Keep this short-lived cache in memory only; never persist it in Web Storage.
  const expiresAt = Date.now() + AI_COACH_OVERVIEW_TTL_MS
  aiCoachOverviewCache.set(cacheKey, { expiresAt, value })
  const previousTimer = aiCoachOverviewExpiryTimers.get(cacheKey)
  if (previousTimer) clearTimeout(previousTimer)
  const timer = setTimeout(() => {
    const current = aiCoachOverviewCache.get(cacheKey)
    if (current && current.expiresAt <= Date.now()) aiCoachOverviewCache.delete(cacheKey)
    aiCoachOverviewExpiryTimers.delete(cacheKey)
  }, AI_COACH_OVERVIEW_TTL_MS + 100)
  aiCoachOverviewExpiryTimers.set(cacheKey, timer)
}

function invalidateAiCoachOverview(conversationId: string) {
  const cacheKey = aiCoachOverviewCacheKey(conversationId)
  aiCoachOverviewCache.delete(cacheKey)
  const timer = aiCoachOverviewExpiryTimers.get(cacheKey)
  if (timer) clearTimeout(timer)
  aiCoachOverviewExpiryTimers.delete(cacheKey)
}

export function prewarmAiCoachAppCheck() {
  void initializeFirebaseAppCheck().catch(() => undefined)
}

function boundedStringList(value: unknown, maximum = 8): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map((item) => item.trim().slice(0, 180))
    .slice(0, maximum)
}

function optionalFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function validateAiCoachContext(value: unknown): AiCoachContextSnapshot {
  if (!isRecord(value)) return {}
  return {
    goalLabel: typeof value.goalLabel === 'string' ? value.goalLabel.slice(0, 120) : null,
    latestWeightKg: optionalFiniteNumber(value.latestWeightKg),
    targetWeightKg: optionalFiniteNumber(value.targetWeightKg),
    todayCalories: optionalFiniteNumber(value.todayCalories),
    calorieGoal: optionalFiniteNumber(value.calorieGoal),
    todayProteinG: optionalFiniteNumber(value.todayProteinG),
    proteinGoalG: optionalFiniteNumber(value.proteinGoalG),
    loggedDays7: optionalFiniteNumber(value.loggedDays7),
    workoutDays7: optionalFiniteNumber(value.workoutDays7),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
  }
}

function validateAiCoachOverview(value: unknown): AiCoachOverview {
  if (!isRecord(value)) throw new Error('Dữ liệu khởi tạo AI Coach không hợp lệ.')
  const history = Array.isArray(value.history) ? value.history.flatMap((item): AiCoachHistoryMessage[] => {
    if (!isRecord(item) || typeof item.text !== 'string' || !item.text.trim()) return []
    const sender = item.sender === 'user' ? 'user' : item.sender === 'ai' || item.sender === 'assistant' ? 'ai' : null
    if (!sender) return []
    return [{
      id: typeof item.id === 'string' ? item.id : `${sender}-${Math.random().toString(36).slice(2)}`,
      sender,
      text: item.text.trim().slice(0, 6000),
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : null,
    }]
  }).slice(-20) : []

  return {
    history,
    context: validateAiCoachContext(value.context),
    dataUsed: boundedStringList(value.dataUsed),
    missingData: boundedStringList(value.missingData),
    suggestedReplies: boundedStringList(value.suggestedReplies, 6),
  }
}

function validateAiCoachResponse(value: unknown): AiCoachResponse {
  if (!isRecord(value) || typeof value.text !== 'string' || !value.text.trim()) {
    throw new Error('AI Coach chưa trả về nội dung hợp lệ.')
  }
  const safetyLevel: AiCoachSafetyLevel = value.safetyLevel === 'urgent'
    ? 'urgent'
    : value.safetyLevel === 'caution'
      ? 'caution'
      : 'standard'
  const provider = value.provider === 'apikey_fun' || value.provider === 'openrouter' || value.provider === 'none'
    ? value.provider
    : undefined
  return {
    text: value.text.trim().slice(0, 6000),
    dataUsed: boundedStringList(value.dataUsed),
    missingData: boundedStringList(value.missingData),
    suggestedReplies: boundedStringList(value.suggestedReplies, 6),
    safetyLevel,
    imageProcessed: value.imageProcessed === true,
    provider,
    model: typeof value.model === 'string' ? value.model : null,
    providerRequestId: typeof value.providerRequestId === 'string' ? value.providerRequestId : null,
  }
}

export async function getAiCoachOverview(
  conversationId: string,
  options: { forceRefresh?: boolean } = {},
): Promise<AiCoachOverview> {
  const cacheKey = aiCoachOverviewCacheKey(conversationId)
  const pending = aiCoachOverviewRequests.get(cacheKey)
  if (pending) return pending
  if (!options.forceRefresh) {
    const cached = readCachedAiCoachOverview(cacheKey)
    if (cached) return cached
  }

  const request = (async () => {
    await initializeFirebaseAppCheck()
    const firebase = requireNutritionFirebase()
    const callable = httpsCallable<{ conversationId: string }, unknown>(
      firebase.functions,
      'getAiCoachOverview',
      { timeout: 30_000 },
    )
    const result = await callable({ conversationId })
    const overview = validateAiCoachOverview(result.data)
    cacheAiCoachOverview(cacheKey, overview)
    return overview
  })()
  aiCoachOverviewRequests.set(cacheKey, request)
  try {
    return await request
  } finally {
    if (aiCoachOverviewRequests.get(cacheKey) === request) aiCoachOverviewRequests.delete(cacheKey)
  }
}

export async function askAiCoachDetailed(
  message: string,
  conversationId: string,
  attachment?: AiCoachImageAttachment | null,
  clientTurnId?: string,
  learningContext?: AiCoachLearningContext | null,
): Promise<AiCoachResponse> {
  const normalizedMessage = message.trim()
  if ((!normalizedMessage && !attachment) || normalizedMessage.length > 3000) {
    throw new Error('Tin nhắn cần có từ 1 đến 3.000 ký tự.')
  }
  if (attachment && attachment.kind !== 'body' && attachment.kind !== 'meal') {
    throw new Error('Loại ảnh tư vấn không hợp lệ.')
  }
  await initializeFirebaseAppCheck()
  const firebase = requireNutritionFirebase()
  const callable = httpsCallable<{
    message: string
    conversationId: string
    clientTurnId?: string
    attachment?: { kind: AiCoachImageKind; storagePath: string }
    learningContext?: AiCoachLearningContext
  }, unknown>(
    firebase.functions,
    'askAiCoach',
    // The backend reserves up to 45 seconds for provider fallbacks, then still
    // needs time to persist the exchange and idempotency receipt.
    { timeout: attachment ? 75_000 : 65_000 },
  )
  try {
    const result = await callable({
      message: normalizedMessage,
      conversationId,
      ...(clientTurnId ? { clientTurnId } : {}),
      ...(attachment ? { attachment: { kind: attachment.kind, storagePath: attachment.storagePath } } : {}),
      ...(learningContext ? { learningContext } : {}),
    })
    const response = validateAiCoachResponse(result.data)
    invalidateAiCoachOverview(conversationId)
    return response
  } catch (error) {
    if (attachment && firebase.storage) {
      await deleteObject(ref(firebase.storage, attachment.storagePath)).catch(() => undefined)
    }
    throw error
  }
}

/**
 * Compatibility wrapper for the Nutrition assistant. Profile data is intentionally
 * ignored because the server rebuilds trusted context from the authenticated UID.
 */
export async function askAiCoach(message: string, _legacyUserProfile?: unknown): Promise<string> {
  const response = await askAiCoachDetailed(message, 'nutrition-assistant')
  return response.text
}
