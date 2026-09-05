import type { FoodAnalysisItem } from '../../services/nutritionService'
import type { AiFoodItem, NutritionImageAnalysisResponse } from './types'

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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
  const hasUsefulMessage = rawMessage.length > 0 && !/^(internal|unknown|error)$/i.test(rawMessage)

  if (code === 'failed-precondition') return hasUsefulMessage ? rawMessage : 'Aura chưa nhận ra món ăn trong ảnh này. Hãy thử ảnh rõ hơn và chụp trọn phần ăn.'
  if (code === 'resource-exhausted') return 'Dịch vụ AI đang bận. Vui lòng chờ một chút rồi thử lại chính ảnh này.'
  if (code === 'deadline-exceeded') return 'Phân tích mất nhiều thời gian hơn dự kiến. Vui lòng thử lại chính ảnh này.'
  if (code === 'unavailable' || code === 'internal' || /^(internal|unknown)$/i.test(rawMessage)) {
    return code === 'unavailable' && hasUsefulMessage ? rawMessage : 'Aura AI chưa hoàn tất lần phân tích này. Bạn có thể thử lại chính ảnh vừa chọn.'
  }
  if (code === 'unauthenticated') return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại rồi thử phân tích ảnh.'
  if (code.startsWith('storage/') || /network|fetch|offline/i.test(rawMessage)) return 'Không thể tải ảnh lên do kết nối mạng. Vui lòng kiểm tra mạng rồi thử lại.'
  return hasUsefulMessage ? rawMessage : 'Không thể kết nối dịch vụ phân tích ảnh. Vui lòng kiểm tra mạng và thử lại.'
}

export function perGramNutrition(item: Pick<AiFoodItem, 'grams' | 'calories' | 'protein' | 'carbs' | 'fat' | 'fiber' | 'sugar' | 'sodium'>) {
  const grams = Math.max(item.grams, .001)
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
      : item.nutritionEvidence?.sourceType === 'catalog_scaled_with_ai_gaps' ? 'mixed' : 'ai-estimate',
  }
  return { ...normalized, perGram: perGramNutrition(normalized) }
}

export function nutritionEvidenceLabel(item: AiFoodItem) {
  if (item.nutritionEvidence?.sourceType === 'catalog_scaled') return 'Nguồn số: CSDL đã quy đổi'
  if (item.nutritionEvidence?.sourceType === 'catalog_scaled_with_ai_gaps') {
    const catalogFields = Object.values(item.nutritionEvidence.fields).filter((source) => source === 'catalog').length
    return `Nguồn số: CSDL ${catalogFields}/7 trường · AI bổ sung phần thiếu`
  }
  if (item.calculationSource === 'manual') return 'Nguồn số: bạn đã chỉnh · cần xác nhận'
  return 'Nguồn số: AI ước tính · cần bạn chấp nhận'
}

export function nutritionConfidenceLabel(item: AiFoodItem) {
  if (item.confidenceValue !== undefined && Number.isFinite(item.confidenceValue)) {
    return `${Math.round(Math.max(0, Math.min(1, item.confidenceValue)) * 100)}%`
  }
  if (item.confidence === 'low') return 'Cần kiểm tra khẩu phần'
  if (item.catalogMatch || item.calculationSource === 'database') return 'Có đối chiếu thư viện'
  return 'Ước tính từ ảnh'
}

export function normalizeAnalysis(response: NutritionImageAnalysisResponse) {
  const analysis = response.analysis
  if (!analysis?.isFood) return null
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
    quantityAndCookingAnalysis: analysis.quantityAndCookingAnalysis,
    portionAndCalorieRationale: analysis.portionAndCalorieRationale,
    goalAlignmentAssessment: analysis.goalAlignmentAssessment,
    calorieOptimizationTip: analysis.calorieOptimizationTip,
    macroBalanceAssessment: analysis.macroBalanceAssessment,
    coachFeedbackSuggestion: analysis.coachFeedbackSuggestion,
  }
}
