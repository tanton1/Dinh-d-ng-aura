'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { canTransitionSopStatus, contentHash, listSopKnowledgePage, normalizeSearch, publicResource } = require('./sop-center')

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

function knowledgeDb(count) {
  const documents = Array.from({ length: count }, (_item, index) => ({
    id: `script__${String(index + 1).padStart(3, '0')}`,
    value: {
      kind: index % 2 ? 'script' : 'sop', status: 'live', code: `S${index + 1}`, title: `Kich ban ${index + 1}`,
      searchText: `kich ban ${index + 1} ${index === 4 ? 'bao luu' : ''}`, payload: { body: 'x'.repeat(4000) },
    },
  }))
  const queries = []
  const make = (state) => ({
    orderBy: () => make(state),
    select: (...fields) => make({ ...state, fields }),
    limit: (limit) => make({ ...state, limit }),
    startAfter: (cursor) => make({ ...state, cursor }),
    get: async () => {
      queries.push(state)
      const docs = documents.filter((item) => !state.cursor || item.id > state.cursor).slice(0, state.limit)
        .map((item) => ({ id: item.id, data: () => Object.fromEntries(Object.entries(item.value).filter(([key]) => state.fields.includes(key))) }))
      return { docs, size: docs.length }
    },
  })
  return { queries, collection: () => make({ fields: [], limit: Infinity, cursor: '' }) }
}

test('an unfiltered SOP list reads one page of summaries, never payloads or the whole library', async () => {
  const db = knowledgeDb(250)
  const seen = []
  let cursor = ''
  let pages = 0
  do {
    const page = await listSopKnowledgePage({ db, pageSize: 100, cursor })
    seen.push(...page.rows.map((row) => row.id))
    cursor = page.nextCursor
    pages += 1
    assert.ok(page.rows.every((row) => row.payload === undefined && row.searchText === undefined))
  } while (cursor && pages < 10)
  assert.equal(pages, 3)
  assert.equal(new Set(seen).size, 250, 'every document is listed exactly once')
  assert.deepEqual(db.queries.map((query) => query.limit), [101, 101, 101])
  assert.ok(db.queries.every((query) => !query.fields.includes('payload') && !query.fields.includes('searchText')))
})

test('a filtered SOP list keeps the wide scan and fetches search text only for a text search', async () => {
  const db = knowledgeDb(250)
  const byKind = await listSopKnowledgePage({ db, pageSize: 100, kinds: new Set(['script']) })
  assert.equal(byKind.rows.length, 100)
  assert.ok(byKind.rows.every((row) => row.kind === 'script'))
  assert.equal(byKind.hasMore, true)
  const bySearch = await listSopKnowledgePage({ db, pageSize: 100, queryTokens: ['bao', 'luu'] })
  assert.deepEqual(bySearch.rows.map((row) => row.id), ['script__005'])
  assert.equal(bySearch.hasMore, false)
  assert.deepEqual(db.queries.map((query) => [query.limit, query.fields.includes('searchText'), query.fields.includes('payload')]),
    [[500, false, false], [500, true, false]])
})
