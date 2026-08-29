import { httpsCallable } from 'firebase/functions'
import { firebaseFunctions } from '../lib/firebase'

export type ProductEventName =
  | 'page_view'
  | 'course_opened'
  | 'course_enrolled'
  | 'lesson_completed'
  | 'nutrition_scan_started'
  | 'nutrition_scan_completed'
  | 'workout_completed'
  | 'eat_clean_order_created'
  | 'eat_clean_consumption_confirmed'

const recentPageViews = new Map<string, number>()
const PAGE_VIEW_DEDUPLICATION_MS = 5_000

function pageViewKey(properties: Record<string, string | number | boolean>) {
  return JSON.stringify(Object.entries(properties).sort(([left], [right]) => left.localeCompare(right)))
}

function deferPageViewUntilIdle() {
  if (typeof window === 'undefined') return Promise.resolve()
  return new Promise<void>((resolve) => {
    const requestIdle = (window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
    }).requestIdleCallback
    if (requestIdle) {
      requestIdle(() => resolve(), { timeout: 1_500 })
      return
    }
    window.setTimeout(resolve, 250)
  })
}

export async function trackProductEvent(
  name: ProductEventName,
  properties: Record<string, string | number | boolean> = {},
) {
  if (!firebaseFunctions) return

  if (name === 'page_view') {
    const key = pageViewKey(properties)
    const now = Date.now()
    const lastTrackedAt = recentPageViews.get(key) ?? 0
    if (now - lastTrackedAt < PAGE_VIEW_DEDUPLICATION_MS) return
    recentPageViews.set(key, now)
    if (recentPageViews.size > 50) {
      for (const [storedKey, trackedAt] of recentPageViews) {
        if (now - trackedAt > 60_000) recentPageViews.delete(storedKey)
      }
    }
    await deferPageViewUntilIdle()
  }

  try {
    const callable = httpsCallable<{
      name: ProductEventName
      properties: Record<string, string | number | boolean>
    }, { accepted: boolean }>(firebaseFunctions, 'trackProductEvent')
    await callable({ name, properties })
  } catch (error) {
    if (import.meta.env.DEV) console.warn('Analytics event was not accepted', error)
  }
}
