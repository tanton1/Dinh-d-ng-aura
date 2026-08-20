import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebase'

export interface InternalNutritionCatalogQuery {
  query?: string
  kind?: 'all' | 'dish' | 'food'
  limit?: number
  ids?: string[]
  cursor?: string
}

export interface InternalNutritionCatalogResponse {
  items: unknown[]
  hasMore: boolean
  nextCursor: string | null
  totalCount: number
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
