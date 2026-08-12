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

export async function trackProductEvent(
  name: ProductEventName,
  properties: Record<string, string | number | boolean> = {},
) {
  if (!firebaseFunctions) return
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
