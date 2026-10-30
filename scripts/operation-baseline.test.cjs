const test = require('node:test')
const assert = require('node:assert/strict')
const { summarize, collect } = require('./operation-baseline.cjs')
const metric = (value = {}) => ({ jsonPayload: { message: 'Aura function metric', operation: 'listTest', outcome: 'success', durationMs: 100, ...value } })
test('baseline weights sampled traffic, retains unknown metrics, and strips source data', () => {
  const report = summarize([metric({ sampleRate: .1, actorUid: 'secret', metrics: { documentsReturned: 3, privateData: 'secret' } }), metric({ outcome: 'error', durationMs: 500 })], { expected: ['unused'] })
  const row = report.operations.find(value => value.operation === 'listTest')
  assert.equal(row.estimatedRequests, 11)
  assert.equal(row.estimatedFailuresPer1000, 1000 / 11)
  assert.equal(row.latencyMs.p95, 500)
  assert.equal(row.measured.documentsReturned.meanWhenMeasured, 3)
  assert.equal(row.measured.logicalQueries.meanWhenMeasured, null)
  assert.equal(report.operations[0].estimatedRequests, null)
  assert.doesNotMatch(JSON.stringify(report), /secret|actorUid|privateData/)
})
test('pagination cap cannot produce complete or zero-traffic evidence', async () => {
  let calls = 0
  const report = await collect({ project: 'test-aura', maxPages: 1, token: 'not-a-real-token', fetcher: async (_url, options) => {
    calls++
    assert.equal(JSON.parse(options.body).pageSize, 1000)
    return { ok: true, json: async () => ({ entries: [metric()], nextPageToken: 'more' }) }
  } })
  assert.equal(calls, 1)
  assert.equal(report.complete, false)
  assert.equal(report.operations.find(row => row.operation === 'listTest').estimatedRequests, null)
})
test('metric log replay is deduplicated but different operations are preserved', () => {
  const entry = { ...metric(), insertId: 'same', logName: 'log1' }
  const report = summarize([entry, entry, metric({ operation: 'getOther' })], { expected: [] })
  assert.equal(report.operations[0].sampleCount, 1)
  assert.equal(report.operations.length, 2)
})
