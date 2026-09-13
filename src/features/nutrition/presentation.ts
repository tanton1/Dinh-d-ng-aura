import type { NutritionMealType, NutritionActivityIntensity, NutritionDataConfidence } from '../../pages/student/NutritionWorkspace'

export const MEAL_TYPE_LABELS: Record<NutritionMealType, string> = {
  breakfast: 'Bữa sáng',
  lunch: 'Bữa trưa',
  dinner: 'Bữa tối',
  snack: 'Bữa phụ',
}

export const INTENSITY_LABELS: Record<NutritionActivityIntensity, string> = {
  low: 'Nhẹ',
  moderate: 'Vừa',
  high: 'Cao',
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value)
}

export function clampPercent(value: number, goal: number) {
  return Math.min(100, Math.max(0, Math.round((value / Math.max(goal, 1)) * 100)))
}

export function confidenceCopy(confidence: NutritionDataConfidence | undefined) {
  if (confidence === 'estimated') return 'AI ước tính'
  if (confidence === 'needs-review') return 'Cần xác nhận'
  return 'Đã kiểm chứng'
}
