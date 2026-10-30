import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('application uses the tested summary lifecycle and invalidates only after source writes succeed', () => {
  const app = readFileSync('src/AuraApplication.tsx', 'utf8')
  assert.match(app, /useAcademyAnalyticsSummary\(\{[\s\S]*?enabled: adminAcademyAnalyticsEnabled && !profile\?\.disabled && hasPermission\(role, 'analytics.view_all'\)/)
  assert.match(app, /useCourses\(adminAcademyEnabled, true, adminAcademyAccessRevision\)/)
  assert.match(app, /JSON\.stringify\(\[user\?\.uid, role, profile\?\.authzVersion, profile\?\.disabled\]\)/)
  assert.match(app, /onClick=\{adminAnalytics\.refresh\}/)
  assert.match(app, /analytics=\{adminAnalytics\.analytics\}/)
  assert.match(app, /analyticsComplete=\{adminAnalytics\.complete\}/)
  assert.match(app, /await manageAcademyEnrollment\(input\); adminAnalytics\.invalidate\(\)/)
  assert.match(app, /await markLessonComplete\([^\n]+\)\s+adminAnalytics\.invalidate\(\)/)
  assert.match(app, /await enrollInCourse\([^\n]+\)\s+adminAnalytics\.invalidate\(\)/)
  assert.doesNotMatch(app, /adminAnalyticsRefreshConsumed|getAcademyAnalyticsSummary\(/)
})
