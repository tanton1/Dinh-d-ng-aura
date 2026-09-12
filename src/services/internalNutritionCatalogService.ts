import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebaseFunctions'

export interface InternalNutritionCatalogQuery {
  query?: string
  kind?: 'all' | 'dish' | 'food'
  category?: string
  limit?: number
  ids?: string[]
  cursor?: string
  catalogVersion?: string
}

export interface InternalNutritionCatalogResponse {
  items: unknown[]
  hasMore: boolean
  nextCursor: string | null
  totalCount: number
  catalogTotal?: number
  filteredCount?: number
  catalogVersion?: string
  categories?: string[]
  restricted: true
}

function requireFunctions() {
  if (!firebaseFunctions) throw new Error('Firebase Catalog chưa sẵn sàng.')
  return firebaseFunctions
}

export async function listInternalNutritionCatalog(input: InternalNutritionCatalogQuery = {}) {
  const callable = httpsCallable<InternalNutritionCatalogQuery, InternalNutritionCatalogResponse>(
    requireFunctions(),
    'listInternalNutritionCatalog',
    // Keep a hung cold start from leaving the Catalog in an endless spinner;
    // the caller has a bounded retry for transient Functions failures.
    { timeout: 30_000 },
  )
  return (await callable(input)).data
}

export async function getInternalNutritionCatalogItem(id: string) {
  const callable = httpsCallable<{ id: string }, { item: unknown; restricted: true }>(
    requireFunctions(),
    'getInternalNutritionCatalogItem',
  )
  return (await callable({ id })).data.item
}
