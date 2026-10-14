import type { ViewId } from '../types'

const personalViews = new Set<ViewId>([
  'home',
  'aura-club',
  'courses',
  'course-detail',
  'schedule',
  'student-availability',
  'pt-workout',
  'workout',
  'nutrition',
  'eat-clean',
  'progress',
  'profile',
])

/** Presentation only: never changes the signed-in actor or their capabilities. */
export function isStaffPersonalRoute(route: { view: ViewId; studentId: string | null }) {
  // The same photo editor also opens from Student 360 on behalf of a learner.
  // That route must stay in the operational workspace, not the actor's own data.
  if (route.view === 'progress-photo-studio') return !route.studentId
  return personalViews.has(route.view)
}

export function shouldOpenStaffDashboard(view: ViewId, hash: string) {
  // Root/unknown URLs still open work first. Explicit Home links, refresh and
  // browser Back must remain in the personal workspace once the actor enters it.
  const path = hash.replace(/^#\/?/, '').split('?')[0]
  return view === 'home' && path !== 'home'
}
