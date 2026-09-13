import type { ViewId } from '../types'

/**
 * Product areas that are still kept for compatibility and future rollout, but
 * are not ready to be advertised in the shared navigation yet. Direct routes
 * remain intact so existing bookmarks, data and permission contracts are not
 * destroyed by a menu-only release.
 */
export const hiddenNavigationViews = new Set<ViewId>([
  'admin-programs',
  'admin-students',
  'admin-academy-students',
  'admin-courses',
  'admin-course-editor',
])

export function isNavigationViewVisible(view: ViewId) {
  return !hiddenNavigationViews.has(view)
}
