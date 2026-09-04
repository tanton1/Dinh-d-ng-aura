import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getCurrentRoute, isSameRoute, student360RouteHash } from '../src/routing/appRouting'

function installWindow(hash: string) {
  const location = { hash }
  ;(globalThis as typeof globalThis & { window: unknown }).window = {
    location,
    history: {
      replaceState: (_state: unknown, _title: string, nextHash: string) => { location.hash = nextHash },
    },
  }
}

test('Student 360 deep link keeps student and source identity', () => {
  installWindow(student360RouteHash('student_123', 'staff-students'))
  const route = getCurrentRoute()
  assert.equal(route.view, 'student-360')
  assert.equal(route.studentId, 'student_123')
  assert.equal(route.source, 'staff-students')
})

test('Student 360 rejects an unknown source without losing the student id', () => {
  installWindow('#/student-360?studentId=student_123&source=student-home')
  const route = getCurrentRoute()
  assert.equal(route.studentId, 'student_123')
  assert.equal(route.source, null)
})

test('route equality includes Student 360 identity', () => {
  installWindow(student360RouteHash('student-a', 'admin-pt-students'))
  const first = getCurrentRoute()
  installWindow(student360RouteHash('student-b', 'admin-pt-students'))
  assert.equal(isSameRoute(first, getCurrentRoute()), false)
})

test('Student 360 contract commands stay inside the 360 workspace instead of reopening legacy StudentDetail', () => {
  const root = process.cwd()
  const application = readFileSync(join(root, 'src', 'AuraApplication.tsx'), 'utf8')
  const page = readFileSync(join(root, 'src', 'features', 'student-360', 'Student360Page.tsx'), 'utf8')
  const workspace = readFileSync(join(root, 'src', 'features', 'student-360', 'Student360ContractWorkspace.tsx'), 'utf8')
  assert.doesNotMatch(application, /onOpenContractOperations=/)
  assert.doesNotMatch(page, /onOpenContractOperations/)
  assert.match(workspace, /mutateStudent360Contract/)
  assert.match(workspace, /Quản lý thu tiền/)
  assert.match(workspace, /Tạo hợp đồng/)
})
