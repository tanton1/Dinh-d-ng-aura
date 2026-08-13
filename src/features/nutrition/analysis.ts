import type { FoodAnalysisItem } from '../../services/nutritionService'
import type { AiFoodItem, NutritionImageAnalysisResponse } from './types'

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
