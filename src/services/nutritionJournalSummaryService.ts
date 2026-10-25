import { httpsCallable } from 'firebase/functions'
import { firebaseAuth } from '../lib/firebase'
import { firebaseFunctions } from '../lib/firebaseFunctions'
import { runKeyedSingleFlight } from '../utils/singleFlight'

export interface NutritionJournalDaySummary {
  date: string
  mealCount: number
  calories: number
  protein: number
  carbs: number
  fat: number
  waterMl: number
  activityCount: number
  activityMinutes: number
  reviewCount: number
  revision: number
  updatedAt: string | null
  /** Available after the v2 daily-summary writers/readers are deployed. */
  mealOccasions?: { breakfast: boolean; lunch: boolean; dinner: boolean; snackCount: number }
}
export interface NutritionJournalSummaryResponse {
  items: NutritionJournalDaySummary[]
  coverage: 'ready' | 'pending' | 'partial'
  fromDate: string
  toDate: string
  retryAfterMs?: number
  refreshAfter?: string
}
const pending = new Map<string, Promise<NutritionJournalSummaryResponse>>()

export function getMyNutritionJournalSummary(ownerId: string, fromDate: string, toDate: string, authorityKey = '', forceRefresh = false, refreshAfter?: string) {
  if (!firebaseFunctions || firebaseAuth?.currentUser?.uid !== ownerId) return Promise.reject(new Error('Phiên đăng nhập không còn khớp nhật ký.'))
  const key = JSON.stringify([ownerId, authorityKey, fromDate, toDate, forceRefresh, refreshAfter ?? null])
  if (forceRefresh) pending.delete(JSON.stringify([ownerId, authorityKey, fromDate, toDate, false, null]))
  if (!pending.has(key) && pending.size >= 64) pending.delete(pending.keys().next().value!)
  return runKeyedSingleFlight(pending, key, async () => {
    if (firebaseAuth?.currentUser?.uid !== ownerId) throw new Error('Phiên đăng nhập đã thay đổi.')
    const invoke = httpsCallable<{ fromDate: string; toDate: string; forceRefresh?: true; refreshAfter?: string }, NutritionJournalSummaryResponse>(firebaseFunctions!, 'getMyNutritionJournalSummary')
    const result = (await invoke({ fromDate, toDate, ...(forceRefresh ? { forceRefresh: true as const } : {}), ...(refreshAfter ? { refreshAfter } : {}) })).data
    if (firebaseAuth?.currentUser?.uid !== ownerId) throw new Error('Phiên đăng nhập đã thay đổi.')
    if (result.fromDate !== fromDate || result.toDate !== toDate || !Array.isArray(result.items) || !['ready', 'pending', 'partial'].includes(result.coverage)) throw new Error('Phạm vi tổng hợp nhật ký không hợp lệ.')
    return result
  })
}
