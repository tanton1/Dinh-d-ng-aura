import assert from 'node:assert/strict'
import test from 'node:test'
import catalog from '../src/features/sop-center/data/catalog.json'
import { canTransitionSopStatus, filterSopResources, normalizeSopSearch } from '../src/features/sop-center/model'
import type { SopCatalogEnvelope } from '../src/features/sop-center/types'

const typedCatalog = catalog as SopCatalogEnvelope

test('catalog migration excludes the three rejected operational scopes', () => {
  assert.equal(typedCatalog.schemaVersion, 1)
  assert.deepEqual(
    ['lead_pipeline', 'member_360', 'renewal'].filter((scope) => !typedCatalog.excludedScopes.includes(scope)),
    [],
  )
  assert.equal(typedCatalog.resources.some((resource) => ['sop03', 'sop05'].includes(resource.sourceId)), false)
  assert.equal(typedCatalog.resources.some((resource) => [20, 22, 23, 24].includes(Number(resource.sourceId)) && resource.kind === 'skill'), false)
  assert.equal(typedCatalog.resources.some((resource) => resource.kind === 'script' && ['renewal', 'longterm'].includes(String(resource.payload.category))), false)
  assert.equal(typedCatalog.resources.some((resource) => ['lead', 'member', 'contract', 'renewal'].includes(resource.kind as string)), false)
})

test('catalog contains only controlled knowledge and no prices or promotions', () => {
  assert.equal(typedCatalog.stats.total, 231)
  assert.equal(typedCatalog.stats.byKind.sop, 7)
  assert.equal(typedCatalog.stats.byKind.skill, 20)
  assert.equal(typedCatalog.resources.some((resource) => ['price', 'promotion'].includes(resource.kind as string)), false)
  assert.equal(typedCatalog.resources.every((resource) => resource.schemaVersion === 1 && resource.revision === 1), true)
})

test('Vietnamese search is accent-insensitive and works across sections', () => {
  assert.equal(normalizeSopSearch('Đón tiếp & Chăm sóc'), 'don tiep cham soc')
  const results = filterSopResources(typedCatalog.resources, 'overview', 'don tiep')
  assert.ok(results.some((resource) => resource.title.toLowerCase().includes('đón tiếp')))
  const policies = filterSopResources(typedCatalog.resources, 'policies', '')
  assert.equal(policies.every((resource) => ['policy', 'variable', 'kpi', 'escalation'].includes(resource.kind)), true)
})

test('publication workflow only allows reviewed transitions', () => {
  assert.equal(canTransitionSopStatus('draft', 'review'), true)
  assert.equal(canTransitionSopStatus('draft', 'live'), false)
  assert.equal(canTransitionSopStatus('review', 'approved'), true)
  assert.equal(canTransitionSopStatus('approved', 'live'), true)
  assert.equal(canTransitionSopStatus('live', 'draft'), true)
})

