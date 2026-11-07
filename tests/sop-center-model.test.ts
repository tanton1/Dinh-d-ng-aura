import assert from 'node:assert/strict'
import test from 'node:test'
import catalog from '../src/features/sop-center/data/catalog.json'
import { canTransitionSopStatus, filterSopResources, normalizeSopSearch } from '../src/features/sop-center/model'
import type { SopCatalogEnvelope } from '../src/features/sop-center/types'

const typedCatalog = catalog as SopCatalogEnvelope

test('catalog migration excludes the operational scopes and keeps only knowledge kinds', () => {
  assert.equal(typedCatalog.schemaVersion, 1)
  assert.deepEqual(typedCatalog.excludedScopes, ['lead_pipeline', 'member_360', 'renewal_operations', 'operational_records'])
  assert.equal(typedCatalog.resources.some((resource) => ['lead', 'member', 'contract', 'renewal'].includes(resource.kind as string)), false)
  assert.equal(typedCatalog.resources.every((resource) => resource.schemaVersion === 1 && resource.revision === 1), true)
})

test('Vietnamese search is accent-insensitive and works across sections', () => {
  assert.equal(normalizeSopSearch('Đón tiếp & Chăm sóc'), 'don tiep cham soc')
  const results = filterSopResources(typedCatalog.resources, 'lookup', 'don tiep')
  assert.ok(results.some((resource) => resource.title.toLowerCase().includes('đón tiếp')))
  const policies = filterSopResources(typedCatalog.resources, 'policies', '')
  assert.equal(policies.every((resource) => ['policy', 'variable', 'kpi', 'escalation', 'price', 'promotion', 'voice'].includes(resource.kind)), true)
})

test('search reaches the phrases inside a script, not only its title', () => {
  const results = filterSopResources(typedCatalog.resources, 'lookup', 'xin loi chi vi phai bao doi lich')
  assert.ok(results.some((resource) => resource.kind === 'script'))
})

test('publication workflow only allows reviewed transitions', () => {
  assert.equal(canTransitionSopStatus('draft', 'review'), true)
  assert.equal(canTransitionSopStatus('draft', 'live'), false)
  assert.equal(canTransitionSopStatus('review', 'approved'), true)
  assert.equal(canTransitionSopStatus('approved', 'live'), true)
  assert.equal(canTransitionSopStatus('live', 'draft'), true)
})
