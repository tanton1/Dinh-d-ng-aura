import { request } from './services'
export function loadNutritionCatalogPage(input: any = {}) {
  if (input.ids?.length) return request('catalog', input, { items: input.ids.filter((id: string) => id !== 'missing').map((id: string) => ({ id, name: id, kind: 'dish', servingGrams: 100, calories: 300, protein: 20, carbs: 25, fat: 8 })), categories: [], filteredCount: input.ids.length, catalogVersion: 'v1', nextCursor: null, hasMore: false })
  const name = input.query || (input.kind === 'food' ? 'ingredient' : 'original')
  const page = input.cursor ? 2 : 1
  return request('catalog', input, { items: [{ id: `${name}-${page}`, name: `${name} page ${page}`, kind: input.kind === 'food' ? 'food' : 'dish', category: { nameVi: 'Main' }, servingGrams: 100, calories: 300, protein: 20, carbs: 25, fat: 8 }], categories: ['Main'], filteredCount: 2, catalogTotal: 2, catalogVersion: 'v1', nextCursor: page === 1 ? `${name}-cursor` : null, hasMore: page === 1 })
}
export const loadNutritionCatalog = (input?: any) => loadNutritionCatalogPage(input).then(result => result.items)
export const loadNutritionCatalogDetail = async (id: string) => request('detail', { id }, { id, kind: 'dish', nameVi: id, energyKcal: 300, basis: { amount: 100, unit: 'g' }, nutrients: [] })
export const resetNutritionCatalog = () => {}
export const scaleOptionalNumber = (value: number, factor: number) => value * factor
export const toFoodDetailSummary = (value: any) => ({ ...value, nameVi: value.name, energyKcal: value.calories, macros: { proteinG: value.protein, carbohydrateG: value.carbs, fatG: value.fat } })
export const detailNutrientValue = () => undefined
