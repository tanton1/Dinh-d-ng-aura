import type { NutritionFoodCatalogItem } from './types'

export type CatalogEnergyFilter = 'all' | 'lower' | 'middle' | 'higher'
export type IngredientProteinFilter = 'all' | 'at-least-10' | 'at-least-20'
export interface CatalogFilters {
  query: string
  category: string
  energy: CatalogEnergyFilter
  protein: IngredientProteinFilter
  savedOnly: boolean
}
export const emptyCatalogFilters = (): CatalogFilters => ({ query: '', category: 'all', energy: 'all', protein: 'all', savedOnly: false })

export function catalogNutritionMatches(food: NutritionFoodCatalogItem, ingredients: boolean, energy: CatalogEnergyFilter, protein: IngredientProteinFilter) {
  // Ingredients are compared on a common 100 g basis. Missing grams are not guessed.
  const scale = ingredients ? (food.servingGrams && food.servingGrams > 0 ? 100 / food.servingGrams : null) : 1
  const kcal = scale !== null && food.calories !== null ? food.calories * scale : null
  const low = ingredients ? 100 : 300
  const high = ingredients ? 300 : 500
  if (energy !== 'all' && (kcal === null || !Number.isFinite(kcal))) return false
  if (energy === 'lower' && kcal! >= low) return false
  if (energy === 'middle' && (kcal! < low || kcal! > high)) return false
  if (energy === 'higher' && kcal! <= high) return false
  if (ingredients && protein !== 'all') {
    if (scale === null || food.protein === null || !Number.isFinite(food.protein)) return false
    if (food.protein * scale < (protein === 'at-least-20' ? 20 : 10)) return false
  }
  return true
}
