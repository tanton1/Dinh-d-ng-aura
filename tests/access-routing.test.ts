import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { hasRouteCapability } from '../src/identity/access'
import { hiddenNavigationViews, isNavigationViewVisible } from '../src/config/navigationAvailability'

test('Performance navigation and route admission share the same any-of capability rule', () => {
  assert.equal(hasRouteCapability('staff-performance', (capability) => capability === 'performance.self.view'), true)
  assert.equal(hasRouteCapability('staff-performance', (capability) => capability === 'performance.evidence.review'), true)
  assert.equal(hasRouteCapability('staff-performance', (capability) => capability === 'dashboard.view'), false)
})

test('single-capability and public routes keep their existing admission behavior', () => {
  assert.equal(hasRouteCapability('staff-payroll', (capability) => capability === 'payroll.self.view'), true)
  assert.equal(hasRouteCapability('staff-payroll', () => false), false)
  assert.equal(hasRouteCapability('home', () => false), true)
})

test('Admin navigation stays within the mobile dock limit and shares the route admission gate', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'components', 'AppShell.tsx'), 'utf8')
  const legacyDock = source.match(/const adminMobileNav:[\s\S]*?= \[([\s\S]*?)\n\]/)?.[1] || ''
  const v4Dock = source.match(/const adminV4MobileNav:[\s\S]*?= \[([\s\S]*?)\n\]/)?.[1] || ''
  const countRoutes = (block: string) => [...block.matchAll(/\{ id: /g)].length

  // Four direct routes plus the shared “Thêm” button equals five touch targets.
  assert.equal(countRoutes(legacyDock), 4)
  assert.equal(countRoutes(v4Dock), 4)
  assert.match(source, /items: section\.items\.filter\(\(item\) => isNavigationViewVisible\(item\.id\) && hasPermission\(role, item\.permission\) && canNavigate\(item\.id\)\)/)
})

test('unfinished Academy and online coaching modules stay hidden from every shared menu', () => {
  const hiddenViews = [
    'admin-programs',
    'admin-students',
    'admin-academy-students',
    'admin-courses',
    'admin-course-editor',
  ] as const

  hiddenViews.forEach((view) => {
    assert.equal(hiddenNavigationViews.has(view), true)
    assert.equal(isNavigationViewVisible(view), false)
  })
  assert.equal(isNavigationViewVisible('admin-pt-students'), true)

  const shell = readFileSync(join(process.cwd(), 'src', 'components', 'AppShell.tsx'), 'utf8')
  const adminSections = shell.match(/const adminNavSections:[\s\S]*?= \[([\s\S]*?)\n\]/)?.[1] || ''
  hiddenViews.forEach((view) => assert.doesNotMatch(adminSections, new RegExp(`id: ['"]${view}['"]`)))

  const dashboard = readFileSync(join(process.cwd(), 'src', 'pages', 'admin', 'AdminDashboard.tsx'), 'utf8')
  const shortcuts = dashboard.match(/const shortcuts = useMemo\(\(\) => \{([\s\S]*?)\n  \}, \[/)?.[1] || ''
  hiddenViews.forEach((view) => assert.doesNotMatch(shortcuts, new RegExp(`view: ['"]${view}['"]`)))
})

test('shared search opens the active student directory instead of hidden product areas', () => {
  const application = readFileSync(join(process.cwd(), 'src', 'AuraApplication.tsx'), 'utf8')
  const searchHandler = application.match(/onSearch=\{\(query\) => \{([\s\S]*?)\n      \}\}/)?.[1] || ''

  assert.match(searchHandler, /isStaffWorkspace[\s\S]*navigate\('staff-students'\)/)
  assert.match(searchHandler, /navigate\('admin-pt-students'\)/)
  assert.doesNotMatch(searchHandler, /navigate\('admin-courses'\)|navigate\('admin-students'\)/)
})
