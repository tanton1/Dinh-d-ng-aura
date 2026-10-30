import type { Course } from '../../src/types'
import type { AcademyAnalyticsSummary } from '../../src/services/scopedReportingService'

export const isFirebaseConfigured = true
export const academyDemoFallbackEnabled = false
export const firebaseAuth = { currentUser: { uid: 'admin-a' } as { uid: string } | null }
const authListeners = new Set<(owner: typeof firebaseAuth.currentUser) => void>()
export function onAuthStateChanged(_auth: unknown, callback: (owner: typeof firebaseAuth.currentUser) => void) {
  authListeners.add(callback)
  callback(firebaseAuth.currentUser)
  return () => authListeners.delete(callback)
}
export const catalog = (titles = ['Alpha', 'Beta']): Course[] => titles.map((title, index) => ({
  id: ['alpha', 'beta', 'gamma'][index], title, description: `${title} course`, coach: 'Fixture coach',
  category: 'Dinh dưỡng', level: 'Cơ bản', lessons: 4, duration: '1 giờ', schemaVersion: 2,
  publicationStatus: 'published', settings: { accessTier: 'free' },
} as Course))
export const summary = (learners = 7, complete = true): AcademyAnalyticsSummary => ({
  complete, asOf: '2026-10-30T10:00:00.000Z', sourceDocuments: 10,
  courses: [{ courseId: 'alpha', learners, activeLearners: learners - 1, completedLearners: 1, averageCompletion: 42, rating: null }],
})
type Read = { refresh: boolean; owner: string | undefined; visibility: string; resolve: (value: AcademyAnalyticsSummary) => void; reject: (error: Error) => void }
type Subscription = { active: boolean; success: (items: Course[]) => void; error: (reason: Error) => void }
export const state = {
  calls: [] as Read[], subscriptions: [] as Subscription[], hold: new URLSearchParams(location.search).has('hold'),
  renders: 0, identities: 0, snapshot: {} as Record<string, unknown>,
  refresh: () => {}, invalidate: () => {}, oldInvalidate: () => {},
  switchOwner(uid: string | null) {
    firebaseAuth.currentUser = uid ? { uid } : null
    authListeners.forEach(callback => callback(firebaseAuth.currentUser))
  },
  emit(items = catalog()) { this.subscriptions.filter(item => item.active).forEach(item => item.success(items)) },
  settle(index: number, learners = 7, complete = true) { this.calls[index].resolve(summary(learners, complete)) },
  fail(index: number) { this.calls[index].reject(new Error('fixture unavailable')) },
  visibility(value: 'hidden' | 'visible') {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value })
    document.dispatchEvent(new Event('visibilitychange'))
  },
}
export function subscribeToCourses(_drafts: boolean, success: (items: Course[]) => void, error: (reason: Error) => void) {
  const subscription = { active: true, success, error }
  state.subscriptions.push(subscription)
  queueMicrotask(() => { if (subscription.active) success(catalog()) })
  return () => { subscription.active = false }
}
export function getAcademyAnalyticsSummary(refresh = false) {
  return new Promise<AcademyAnalyticsSummary>((resolve, reject) => {
    state.calls.push({ refresh, owner: firebaseAuth.currentUser?.uid, visibility: document.visibilityState, resolve, reject })
    if (!state.hold) resolve(summary())
  })
}
declare global { interface Window { __academy: typeof state } }
window.__academy = state
