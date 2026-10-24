import { request } from './services'
export function loadNutritionCatalogPage(input: any = {}) {
  const name = input.query || 'original'
  const page = input.cursor ? 2 : 1
  return request('catalog', input, { items: [{ id: `${name}-${page}`, name: `${name} page ${page}`, kind: 'dish', category: { nameVi: 'Main' }, servingGrams: 100, calories: 300, protein: 20, carbs: 25, fat: 8 }], categories: ['Main'], filteredCount: 2, catalogTotal: 2, catalogVersion: 'v1', nextCursor: page === 1 ? `${name}-cursor` : null, hasMore: page === 1 })
}
export const loadNutritionCatalog = (input?: any) => loadNutritionCatalogPage(input).then(result => result.items)
export const loadNutritionCatalogDetail = async (id: string) => ({ id })
export const resetNutritionCatalog = () => {}
export const scaleOptionalNumber = (value: number, factor: number) => value * factor
export const toFoodDetailSummary = (value: any) => value
export const detailNutrientValue = () => undefined
