import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isStaffPersonalRoute, shouldOpenStaffDashboard } from '../src/routing/staffWorkspace'
import { hasRouteCapability } from '../src/identity/access'
import type { ViewId } from '../src/types'

test('staff personal workspace includes learner modules without changing route identity', () => {
  const views: ViewId[] = ['home', 'nutrition', 'eat-clean', 'schedule', 'student-availability', 'pt-workout', 'workout', 'progress', 'courses', 'course-detail', 'profile', 'aura-club']
  for (const view of views) {
    assert.equal(isStaffPersonalRoute({ view, studentId: null }), true, view)
    assert.equal(hasRouteCapability(view, () => false), true, view)
  }
})

test('work routes and another learner photo studio never become personal data', () => {
  for (const view of ['staff-dashboard', 'staff-students', 'staff-payroll', 'admin-pt-schedule', 'student-360', 'delivery'] as ViewId[]) {
    assert.equal(isStaffPersonalRoute({ view, studentId: null }), false, view)
  }
  assert.equal(isStaffPersonalRoute({ view: 'progress-photo-studio', studentId: 'student-a' }), false)
  assert.equal(isStaffPersonalRoute({ view: 'progress-photo-studio', studentId: null }), true)
  assert.equal(hasRouteCapability('staff-payroll', () => false), false)
  assert.equal(hasRouteCapability('admin-pt-schedule', () => false), false)
})

test('root opens work but explicit Home deep links, reloads and Back keep personal mode', () => {
  for (const hash of ['', '#', '#/', '#/unknown']) {
    assert.equal(shouldOpenStaffDashboard('home', hash), true, hash)
  }
  for (const hash of ['#/home', '#home', '#/home?section=today']) {
    assert.equal(shouldOpenStaffDashboard('home', hash), false, hash)
  }
  assert.equal(shouldOpenStaffDashboard('nutrition', '#/nutrition'), false)
})

test('workspace switching navigates only and keeps the authenticated identity unchanged', () => {
  const application = readFileSync(join(process.cwd(), 'src', 'AuraApplication.tsx'), 'utf8')
  const switchHandler = application.match(/onStaffWorkspaceChange=\{\(personal\) => \{([\s\S]*?)\n      \}\}/)?.[1] || ''
  assert.match(switchHandler, /navigate\(personal \? 'home' : 'staff-dashboard'\)/)
  assert.doesNotMatch(switchHandler, /setPreviewRole|updateUserRole|saveProfileChanges|signOut/)
  assert.match(application, /const isStaffWorkspace = isStaffAccount && !isStaffPersonalRoute\(route\)/)
})

test('the personal mobile dock has four routes plus More regardless of shell rollout', () => {
  const shell = readFileSync(join(process.cwd(), 'src', 'components', 'AppShell.tsx'), 'utf8')
  const dock = shell.match(/const studentV4MobileNav:[\s\S]*?= \[([\s\S]*?)\n\]/)?.[1] || ''
  assert.equal([...dock.matchAll(/\{ id: /g)].length, 4)
  assert.match(shell, /useCompactStudentDock = shellV4 \|\| isStaffAccount/)
  assert.match(shell, /showAiCoach = mode === 'student' && !isStaffWorkspace/)
})

test('shell exposes an explicit staff-to-personal workspace switch', () => {
  const shell = readFileSync(join(process.cwd(), 'src', 'components', 'AppShell.tsx'), 'utf8')
  const application = readFileSync(join(process.cwd(), 'src', 'AuraApplication.tsx'), 'utf8')
  assert.match(shell, /Công việc/)
  assert.match(shell, /Cá nhân/)
  assert.match(shell, /isStaffAccount/)
  assert.match(application, /isStaffPersonalRoute\(route\)/)
  assert.match(application, /onStaffWorkspaceChange=/)
})
