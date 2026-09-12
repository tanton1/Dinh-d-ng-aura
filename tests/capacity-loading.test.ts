import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { mergeJournalHistory } from '../src/features/nutrition/journalMerge'

test('late history cannot overwrite a reviewed meal or resurrect a deleted live day', () => {
  const stale = [
    { id: 'meal-a', date: '2026-09-12', status: 'pending' },
    { id: 'meal-b', date: '2026-09-11', status: 'pending' },
    { id: 'meal-c', date: '2026-09-10', status: 'approved' },
  ]
  const live = new Map([
    ['2026-09-12', [{ id: 'meal-a', date: '2026-09-12', status: 'approved' }]],
    ['2026-09-11', []],
  ])
  assert.deepEqual(mergeJournalHistory(stale, live), [stale[2], live.get('2026-09-12')![0]])
})

test('metadata reads never resolve all image URLs before returning totals', () => {
  const source = readFileSync('src/services/firebaseNutritionLogService.ts', 'utf8')
  const subscriptions = source.slice(source.indexOf('function subscribeToUserLog'), source.indexOf('export async function saveUserMealLog'))
  assert.doesNotMatch(subscriptions, /hydrateMealImages|await mealPhotoUrl/)
  const image = readFileSync('src/components/nutrition/MealImage.tsx', 'utf8')
  assert.match(image, /IntersectionObserver/)
  assert.match(image, /useMealImage\(image, storagePath, visible\)/)
})

test('opening diary does not disable day subscriptions', () => {
  const source = readFileSync('src/pages/student/NutritionPageController.tsx', 'utf8')
  assert.doesNotMatch(source, /coveredByRecentSubscription/)
  assert.match(source, /mergeJournalHistory<MealLog>/)
  assert.match(source, /\[isDemo, resolvedOwnerId, selectedDate\]/)
})

test('progress reads the selected period without Academy data', () => {
  const page = readFileSync('src/pages/student/ProgressPage.tsx', 'utf8')
  const app = readFileSync('src/AuraApplication.tsx', 'utf8')
  assert.match(page, /daysAgoKey\(period === '7-days' \? 7 : period === '90-days' \? 90 : 30\)/)
  assert.match(app, /learnerAcademyViews = new Set<ViewId>\(\['courses', 'course-detail'\]\)/)
  assert.doesNotMatch(page, /return <main/)
})

test('schedule background refresh preserves data and guards stale requests', () => {
  const page = readFileSync('src/pages/student/SchedulePage.tsx', 'utf8')
  assert.match(page, /setLoading\(!background\)/)
  assert.match(page, /requestId !== requestIdRef.current/)
  assert.match(page, /document.hidden \|\| loading \|\| refreshing/)
  assert.doesNotMatch(page, /!loading && !loadIssue && data\?\.student/)
  const availability = readFileSync('src/pages/student/StudentAvailabilityPage.tsx', 'utf8')
  assert.match(availability, /background && dirtyRef.current/)
})

test('Staff primary data settles independently from payroll and performance', () => {
  const source = readFileSync('src/pages/operations/StaffDashboardPage.tsx', 'utf8')
  assert.match(source, /primaryTask = Promise.allSettled\(\[workspaceTask, salesTask\]\)/)
  assert.match(source, /payrollTask[\s\S]*?setPayrollLoading\(false\)/)
  assert.match(source, /performanceTask[\s\S]*?setPerformanceLoading\(false\)/)
  assert.doesNotMatch(source, /const \[workspaceResult, salesResult, payrollResult, performanceResult\]/)
})
