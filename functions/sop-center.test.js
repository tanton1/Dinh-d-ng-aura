'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { canTransitionSopStatus, contentHash, normalizeSearch, publicResource } = require('./sop-center')

test('SOP status transitions fail closed', () => {
  assert.equal(canTransitionSopStatus('draft', 'review'), true)
  assert.equal(canTransitionSopStatus('review', 'approved'), true)
  assert.equal(canTransitionSopStatus('approved', 'live'), true)
  assert.equal(canTransitionSopStatus('live', 'draft'), true)
  assert.equal(canTransitionSopStatus('draft', 'live'), false)
  assert.equal(canTransitionSopStatus('unknown', 'live'), false)
})

test('content hashes are stable and include payload changes', () => {
  const base = {
    kind: 'sop', code: 'SOP 01', title: 'Đón tiếp', summary: 'Chuẩn', ownerRole: 'admin',
    audiences: ['sales'], branchScope: ['all'], tags: ['welcome'], payload: { actions: ['Chào khách'] },
  }
  assert.equal(contentHash(base), contentHash({ ...base }))
  assert.notEqual(contentHash(base), contentHash({ ...base, payload: { actions: ['Chào khách bằng tên'] } }))
})

test('search normalization handles Vietnamese text', () => {
  assert.equal(normalizeSearch('Đón tiếp & Xử lý khiếu nại'), 'don tiep xu ly khieu nai')
})

test('public resources default to a safe all-branch scope', () => {
  const resource = publicResource('sop__demo', {
    kind: 'sop', code: 'SOP', title: 'Demo', status: 'draft', revision: 1,
    payload: {}, updatedAt: '2026-11-06T00:00:00.000Z', branchScope: [],
  })
  assert.deepEqual(resource.branchScope, ['all'])
  assert.equal(resource.schemaVersion, 1)
})

test('public resources retain SOP-skill traceability metadata', () => {
  const resource = publicResource('script__demo', {
    kind: 'script', code: 'SCRIPT', title: 'Demo', status: 'live', revision: 1,
    payload: {}, updatedAt: '2026-11-06T00:00:00.000Z',
    relatedSopIds: ['sop01'], relatedSkillIds: ['8'],
    contentMetrics: { phraseCount: 3, situationCount: 1, variantCount: 2 },
  })
  assert.deepEqual(resource.relatedSopIds, ['sop01'])
  assert.deepEqual(resource.relatedSkillIds, ['8'])
  assert.deepEqual(resource.contentMetrics, { phraseCount: 3, situationCount: 1, variantCount: 2 })
})
