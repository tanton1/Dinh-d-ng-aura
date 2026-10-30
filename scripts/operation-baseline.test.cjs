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

test('auth rejections and different serving revisions cannot masquerade as successful user latency', () => {
  const report = summarize([
    metric({ schemaVersion: 2, release: 'report-00001-old', outcome: 'error', authenticated: false, appVerified: false, errorCode: 'AUTH', durationMs: 2 }),
    metric({ schemaVersion: 2, release: 'report-00002-new', outcome: 'error', authenticated: false, appVerified: false, errorCode: 'AUTH', durationMs: 3 }),
    metric({ schemaVersion: 2, release: 'report-00002-new', authenticated: true, appVerified: true, durationMs: 800, sampleRate: .1, metrics: { documentsReturned: 20 } }),
  ], { expected: [] })
  const row = report.operations[0]
  assert.equal(report.schemaVersion, 2)
  assert.equal(row.evidence.mixedReleases, true)
  assert.equal(row.evidence.unauthenticatedErrorSamples, 2)
  assert.equal(row.evidence.authenticatedSuccessSamples, 1)
  assert.equal(row.evidence.representativeWindow, 'not-established')
  assert.deepEqual(row.successLatencyMs, { sampleCount: 1, p50: 800, p95: 800 })
  assert.equal(row.cohorts.length, 3)
  const success = row.cohorts.find(value => value.authenticated === true)
  assert.equal(success.estimatedRequests, 10)
  assert.equal(success.release, 'report-00002-new')
  assert.equal(success.measured.documentsReturned.meanWhenMeasured, 20)
  const rejection = row.cohorts.find(value => value.release === 'report-00001-old')
  assert.equal(rejection.failureCategory, 'AUTH')
  assert.equal(rejection.successLatencyMs.p95, null)
  assert.equal(rejection.measured.documentsReturned.p95, null)
})

test('queue latency quantiles retain sample weighting and missing measurements', () => {
  const row = summarize([
    metric({ sampleRate: .1, metrics: { queueWaitMs: 10, processingMs: 100 } }),
    metric({ metrics: { queueWaitMs: 500, processingMs: 1000 } }),
    metric({ outcome: 'error' }),
  ], { expected: [] }).operations[0]
  assert.deepEqual(row.measured.queueWaitMs, { sampleCount: 2, measuredRequestShare: 11 / 12,
    meanWhenMeasured: 600 / 11, p50: 10, p95: 500 })
  assert.equal(row.measured.processingMs.p50, 100)
  assert.equal(row.measured.processingMs.p95, 1000)
  assert.equal(row.measured.projectionAgeMs.p95, null)
})

test('resource revision provides explicit legacy provenance without inferring authentication', () => {
  const entry = metric({ schemaVersion: 1, actorUid: 'private-person', sourceId: 'private-contract' })
  entry.resource = { labels: { revision_name: 'coach-00005-abc', service_name: 'coach', location: 'asia-southeast2', privateLabel: 'private-value' } }
  const row = summarize([entry], { expected: [] }).operations[0]
  assert.deepEqual(row.releases, ['coach-00005-abc'])
  assert.equal(row.cohorts[0].releaseSource, 'cloud_run_resource')
  assert.equal(row.cohorts[0].schemaVersion, 1)
  assert.equal(row.cohorts[0].region, 'asia-southeast2')
  assert.equal(row.cohorts[0].service, 'coach')
  assert.equal(row.cohorts[0].authenticated, null)
  assert.equal(row.evidence.unknownAuthenticationSamples, 1)
  assert.doesNotMatch(JSON.stringify(row), /private-|actorUid|sourceId|privateLabel/)
})

test('partial windows do not publish complete cohort counts and unknown operations retain no cohorts', () => {
  const report = summarize([metric({ authenticated: true, release: 'report-00001-old' })], { expected: ['unobserved'], complete: false })
  assert.equal(report.operations[0].status, 'unknown')
  assert.deepEqual(report.operations[0].cohorts, [])
  assert.equal(report.operations[0].successLatencyMs.p95, null)
  const observed = report.operations[1]
  assert.equal(observed.status, 'partial')
  assert.equal(observed.estimatedRequests, null)
  assert.equal(observed.cohorts[0].status, 'partial')
  assert.equal(observed.cohorts[0].estimatedRequests, null)
})

test('unknown metadata and arbitrary failure codes are never serialized into cohorts', () => {
  const row = summarize([metric({ schemaVersion: 123, release: 'bad/private-name', authenticated: 'private-uid',
    appVerified: 'private-app', outcome: 'error', errorCode: 'private-error' })], { expected: [] }).operations[0]
  assert.equal(row.cohorts[0].failureCategory, 'unknown')
  assert.equal(row.cohorts[0].schemaVersion, null)
  assert.equal(row.cohorts[0].release, null)
  assert.equal(row.cohorts[0].authenticated, null)
  assert.equal(row.cohorts[0].appVerified, null)
  assert.doesNotMatch(JSON.stringify(row), /private-/)
})

test('an explicit observation window stays identical across all bounded log pages', async () => {
  const filters = []
  const report = await collect({ project: 'test-aura', token: 'not-a-real-token', maxPages: 3,
    start: '2026-10-29T09:05:54.623Z', end: '2026-10-30T09:05:54.623Z', now: Date.parse('2026-10-30T10:00:00Z'),
    fetcher: async (_url, options) => {
      const request = JSON.parse(options.body)
      filters.push(request.filter)
      return { ok: true, json: async () => filters.length === 1
        ? { entries: [metric()], nextPageToken: 'second-page' }
        : { entries: [metric({ outcome: 'error' })] } }
    } })
  assert.equal(filters.length, 2)
  assert.equal(filters[0], filters[1])
  assert.match(filters[0], /timestamp>="2026-10-29T09:05:54.623Z" AND timestamp<"2026-10-30T09:05:54.623Z"/)
  assert.deepEqual(report.range, { start: '2026-10-29T09:05:54.623Z', end: '2026-10-30T09:05:54.623Z' })
  assert.deepEqual(report.collection, { pagesRead: 2, entryCount: 2, pageLimit: 3, pageSize: 1000 })
  assert.equal(report.complete, true)
})

test('invalid or unbounded observation windows are rejected before any network request', async () => {
  const now = Date.parse('2026-10-30T10:00:00Z')
  for (const window of [
    { start: '2026-10-29T10:00:00Z' }, { end: '2026-10-30T10:00:00Z' },
    { start: 'invalid', end: '2026-10-30T10:00:00Z' },
    { start: '2026-10-30T10:00:00Z', end: '2026-10-29T10:00:00Z' },
    { start: '2026-10-30T10:00:00Z', end: '2026-10-31T10:00:00Z' },
    { start: '2026-10-01T10:00:00Z', end: '2026-10-30T10:00:00Z' },
  ]) await assert.rejects(collect({ project: 'test-aura', token: 'not-a-real-token', now, ...window,
    fetcher: async () => assert.fail('Invalid window must not query Cloud Logging') }), /window|range/)
})
