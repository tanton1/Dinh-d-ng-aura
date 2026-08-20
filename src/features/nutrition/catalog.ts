import type { NutritionFoodDetailRecord, NutritionFoodDetailSummary } from '../../pages/student/NutritionFoodDetail'
import type { NutritionFoodCatalogItem } from './types'
import {
  getInternalNutritionCatalogItem,
  listInternalNutritionCatalog,
  type InternalNutritionCatalogQuery,
} from '../../services/internalNutritionCatalogService'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function normalizeCatalogPayload(payload: unknown): NutritionFoodCatalogItem[] {
  const root = asRecord(payload)
  const candidates = Array.isArray(payload) ? payload : Array.isArray(root?.items) ? root.items : Array.isArray(root?.foods) ? root.foods : Array.isArray(root?.records) ? root.records : []
  return candidates.map((candidate, index): NutritionFoodCatalogItem | null => {
    const item = asRecord(candidate)
    if (!item) return null
    const nutrition = asRecord(item.nutrition)
    const macros = asRecord(item.macros)
    const basis = asRecord(item.basis)
    const source = asRecord(item.source)
    const category = asRecord(item.category)
    const region = asRecord(item.region)
    const name = item.nameVi ?? item.name ?? item.foodName ?? item.title
    if (typeof name !== 'string' || !name.trim()) return null
    return {
      id: String(item.id ?? item.catalogId ?? item.code ?? `catalog-${index}`),
      kind: item.kind === 'dish' || item.kind === 'food' ? item.kind : undefined,
      code: typeof item.code === 'string' ? item.code : undefined,
      name: name.trim(),
      nameEn: typeof item.nameEn === 'string' ? item.nameEn : undefined,
      nameAscii: typeof item.nameAscii === 'string' ? item.nameAscii : undefined,
      category: category ? { id: typeof category.id === 'string' ? category.id : null, nameVi: typeof category.nameVi === 'string' ? category.nameVi : null, nameEn: typeof category.nameEn === 'string' ? category.nameEn : null } : undefined,
      region: region ? { id: typeof region.id === 'string' ? region.id : null, nameVi: typeof region.nameVi === 'string' ? region.nameVi : null, code: typeof region.code === 'string' ? region.code : null } : null,
      servingGrams: readNumber(item.servingGrams ?? item.grams ?? item.basisGrams ?? basis?.amount),
      servingLabel: typeof basis?.labelVi === 'string' ? basis.labelVi : undefined,
      calories: readNumber(item.energyKcal ?? item.calories ?? nutrition?.calories),
      protein: readNumber(item.proteinG ?? item.protein ?? nutrition?.proteinG ?? macros?.proteinG),
      carbs: readNumber(item.carbsG ?? item.carbs ?? nutrition?.carbsG ?? macros?.carbohydrateG),
      fat: readNumber(item.fatG ?? item.fat ?? nutrition?.fatG ?? macros?.fatG),
      source: String(item.publisher ?? source?.publisher ?? root?.publisher ?? 'Viện Dinh dưỡng'),
      sourceUrl: typeof item.sourceUrl === 'string' ? item.sourceUrl : typeof item.pageUrl === 'string' ? item.pageUrl : typeof source?.pageUrl === 'string' ? source.pageUrl : undefined,
      sourceId: typeof item.sourceId === 'string' ? item.sourceId : typeof source?.sourceId === 'string' ? source.sourceId : undefined,
      imageUrl: typeof item.imageUrl === 'string' ? item.imageUrl : undefined,
      detailBucket: typeof item.detailBucket === 'string' ? item.detailBucket : undefined,
    }
  }).filter((item): item is NutritionFoodCatalogItem => Boolean(item))
}

export interface NutritionCatalogPage {
  items: NutritionFoodCatalogItem[]
  hasMore: boolean
  nextCursor: string | null
  totalCount: number
  catalogTotal: number
  filteredCount: number
  catalogVersion: string
  categories: string[]
}

const CATALOG_PAGE_CACHE_MS = 2 * 60 * 1000
const catalogRequests = new Map<string, { expiresAt: number; request: Promise<NutritionCatalogPage> }>()

export function loadNutritionCatalogPage(input: InternalNutritionCatalogQuery = {}) {
  const key = JSON.stringify({
    query: input.query?.trim() ?? '',
    kind: input.kind ?? 'all',
    category: input.category?.trim() ?? '',
    limit: input.limit ?? 60,
    ids: input.ids ? [...input.ids].sort() : [],
    cursor: input.cursor ?? '',
    catalogVersion: input.catalogVersion ?? '',
  })
  const cached = catalogRequests.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.request
  if (cached) catalogRequests.delete(key)
  if (!catalogRequests.has(key)) {
    const request = listInternalNutritionCatalog(input).then((payload) => {
      if (!Array.isArray(payload.items)) throw new Error('catalog_response_invalid')
      const legacyTotal = Number.isInteger(payload.totalCount) && payload.totalCount >= 0 ? payload.totalCount : 0
      const catalogTotal = typeof payload.catalogTotal === 'number' && Number.isInteger(payload.catalogTotal) && payload.catalogTotal >= 0
        ? payload.catalogTotal
        : legacyTotal
      const filteredCount = typeof payload.filteredCount === 'number' && Number.isInteger(payload.filteredCount) && payload.filteredCount >= 0
        ? payload.filteredCount
        : legacyTotal
      return {
        items: normalizeCatalogPayload(payload.items),
        hasMore: payload.hasMore === true,
        nextCursor: typeof payload.nextCursor === 'string' && payload.nextCursor ? payload.nextCursor : null,
        totalCount: legacyTotal,
        catalogTotal,
        filteredCount,
        catalogVersion: typeof payload.catalogVersion === 'string' && payload.catalogVersion ? payload.catalogVersion : `legacy-${legacyTotal}`,
        categories: Array.isArray(payload.categories)
          ? payload.categories.filter((category): category is string => typeof category === 'string' && Boolean(category.trim()))
          : [],
      }
    }).catch((error: unknown) => {
      catalogRequests.delete(key)
      throw error
    })
    catalogRequests.set(key, { expiresAt: Date.now() + CATALOG_PAGE_CACHE_MS, request })
  }
  return catalogRequests.get(key)!.request
}

export function loadNutritionCatalog(input: InternalNutritionCatalogQuery = {}) {
  return loadNutritionCatalogPage(input).then((page) => page.items)
}

export function resetNutritionCatalog() {
  catalogRequests.clear()
}

export async function loadNutritionCatalogDetail(id: string): Promise<NutritionFoodDetailRecord> {
  const payload = await getInternalNutritionCatalogItem(id)
  const record = findNutritionDetailRecord(payload, id)
  if (!record) throw new Error('catalog_detail_invalid')
  return record as NutritionFoodDetailRecord
}

export function toFoodDetailSummary(food: NutritionFoodCatalogItem): NutritionFoodDetailSummary {
  const kind = food.kind ?? (food.servingGrams === null ? 'dish' : 'food')
  const sourceId = food.sourceId ?? food.id.split(':').at(-1) ?? ''
  return {
    id: food.id,
    kind,
    detailBucket: food.detailBucket ?? [...sourceId].reverse().find((character) => /[0-9a-f]/i.test(character))?.toLowerCase() ?? 'other',
    code: food.code,
    nameVi: food.name,
    nameEn: food.nameEn,
    category: food.category,
    region: food.region,
    basis: { amount: food.servingGrams, unit: food.servingGrams === null ? null : 'g', qualifier: kind === 'food' ? 'edible_raw_fresh' : 'not_specified_by_source', labelVi: food.servingLabel ?? (kind === 'food' ? '100 g phần ăn được' : 'Khẩu phần tham chiếu theo nguồn') },
    energyKcal: food.calories,
    macros: { proteinG: food.protein, carbohydrateG: food.carbs, fatG: food.fat },
    imageUrl: food.imageUrl,
    sourceUrl: food.sourceUrl,
  }
}

export function detailNutrientValue(record: NutritionFoodDetailRecord, key: string) {
  const value = record.nutrients?.find((nutrient) => nutrient.key === key)?.value
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isNutritionDetailRecord(value: unknown): value is NutritionFoodDetailRecord {
  const record = asRecord(value)
  return Boolean(record && typeof record.id === 'string' && typeof record.nameVi === 'string' && (record.kind === 'dish' || record.kind === 'food'))
}

export function findNutritionDetailRecord(payload: unknown, id: string) {
  if (Array.isArray(payload)) return payload.find((record) => isNutritionDetailRecord(record) && record.id === id) ?? null
  const root = asRecord(payload)
  if (!root) return null
  if (Array.isArray(root.records)) return root.records.find((record) => isNutritionDetailRecord(record) && record.id === id) ?? null
  return isNutritionDetailRecord(root[id]) ? root[id] : null
}

export function scaleOptionalNumber(value: number | null | undefined, multiplier: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * multiplier * 10) / 10 : null
}
