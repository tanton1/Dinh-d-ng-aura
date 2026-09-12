import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { validateRetiredEntries, verifyRetiredSurfaces } from '../scripts/verification/legacy-cleanup.mjs'
import { canonicalRouteHash, resolveSupportedView } from '../src/routing/appRouting'
import type { ViewId } from '../src/types'

const root = process.cwd()
const hash = 'a'.repeat(40)

test('retired source and patch scripts have immutable recovery references and are absent', () => {
  assert.deepEqual(verifyRetiredSurfaces(root), [])
  const manifest = JSON.parse(readFileSync('scripts/archive-manifest.json', 'utf8'))
  assert.equal(manifest.schemaVersion, 2)
  assert.ok(manifest.entries.length > 0)
  assert.ok(manifest.entries.every((entry: { status: string }) => entry.status === 'archived_in_git'))
  assert.deepEqual(validateRetiredEntries(root, manifest.entries), [])
})

test('cleanup guard rejects path traversal, missing recovery metadata and resurrected source', () => {
  assert.ok(validateRetiredEntries(root, [{ path: '../outside' }], hash).length)
  assert.ok(validateRetiredEntries(root, [{ path: 'src/old.ts' }], hash).length)
  assert.ok(validateRetiredEntries(root, [null], hash).length)
  assert.ok(validateRetiredEntries(root, [{ path: 'src/main.tsx', archiveBlob: hash }], hash).some((error: string) => error.includes('restored')))
  const entry = { path: 'src/retired-example.ts', archiveBlob: hash }
  assert.ok(validateRetiredEntries(root, [entry, entry], hash).some((error: string) => error.includes('Duplicate')))
})

test('legacy deep links keep their canonical destinations after source removal', () => {
  const redirects = [
    ['admin-report', 'admin-dashboard', '#/admin-dashboard'],
    ['admin-roles', 'admin-hr', '#/admin-hr'],
    ['trainer-portal', 'staff-students', '#/staff-students'],
    ['sales-portal', 'staff-quotes', '#/staff-quotes'],
    ['meal-plan', 'nutrition', '#/nutrition?section=plan'],
    ['food-database', 'nutrition', '#/nutrition'],
    ['dish-collection', 'nutrition', '#/nutrition'],
    ['schedule-pt', 'schedule', '#/schedule'],
    ['admin-workout-plans', 'admin-programs', '#/admin-programs'],
    ['admin-meal-plans', 'admin-eat-clean', '#/admin-eat-clean'],
  ]
  for (const [old, canonical, expectedHash] of redirects) {
    assert.equal(resolveSupportedView(old as ViewId), canonical)
    assert.equal(canonicalRouteHash(old as ViewId), expectedHash)
  }
})
