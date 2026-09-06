import type { NutritionFoodCatalogItem } from './types'
export function scaleCatalogServing(food: NutritionFoodCatalogItem, multiplier = 1): NutritionFoodCatalogItem {
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 5) throw new Error('Khẩu phần phải lớn hơn 0 và không quá 5 lần nguồn.')
  const scale = (value: number | null | undefined) => value == null ? value : Math.round(value * multiplier * 10) / 10
  return { ...food, servingGrams: scale(food.servingGrams) ?? null,
    calories: scale(food.calories) ?? null, protein: scale(food.protein) ?? null,
    carbs: scale(food.carbs) ?? null, fat: scale(food.fat) ?? null,
    fiber: scale(food.fiber), sugar: scale(food.sugar), sodium: scale(food.sodium),
    servingLabel: multiplier === 1 ? food.servingLabel : `${multiplier} khẩu phần theo nguồn` }
}
