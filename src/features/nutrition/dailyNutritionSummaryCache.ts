import type { MealLog, NutritionWaterLog } from './types'

export interface DailyNutritionCacheEntry {
  meals: MealLog[]
  water: NutritionWaterLog[]
  updatedAt: number
}

const cache = new Map<string, DailyNutritionCacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_CACHE_DAYS = 90

function key(ownerId: string, date: string) {
  return `${ownerId}:${date}`
}

export function readDailyNutritionCache(ownerId: string, date: string): DailyNutritionCacheEntry | null {
  const entry = cache.get(key(ownerId, date))
  if (!entry) return null
  if (Date.now() - entry.updatedAt > CACHE_TTL_MS) {
    cache.delete(key(ownerId, date))
    return null
  }
  return entry
}

export function writeDailyNutritionCache(
  ownerId: string,
  date: string,
  update: Partial<Pick<DailyNutritionCacheEntry, 'meals' | 'water'>>,
) {
  for (const [storedKey, entry] of cache) if (Date.now() - entry.updatedAt > CACHE_TTL_MS) cache.delete(storedKey)
  if (!cache.has(key(ownerId, date)) && cache.size >= MAX_CACHE_DAYS) cache.delete(cache.keys().next().value!)
  const previous = cache.get(key(ownerId, date))
  cache.set(key(ownerId, date), {
    meals: update.meals ?? previous?.meals ?? [],
    water: update.water ?? previous?.water ?? [],
    updatedAt: Date.now(),
  })
}

export function clearDailyNutritionCache(ownerId?: string) {
  if (!ownerId) {
    cache.clear()
    return
  }
  for (const cacheKey of cache.keys()) if (cacheKey.startsWith(`${ownerId}:`)) cache.delete(cacheKey)
}
