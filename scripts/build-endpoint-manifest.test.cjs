'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildManifest, runCli } = require('./build-endpoint-manifest.cjs')
const project = 'demo-aura-manifest'
const now = '2026-10-30T12:00:00.000Z'
const source = { commit: 'a'.repeat(40), digest: 'b'.repeat(64) }
const region = 'asia-east1'
const exported = name => ({ name, kinds: ['callable'], sourceDefinitions: ['functions/example.js'], bindings: [{ file: 'functions/index.js', line: 2, expression: 'SECRET_DO_NOT_COPY' }] })
const audit = (names = ['getExample', 'getExampleRegional']) => ({ source, snapshotStable: true, backendExports: names.map(exported), frontendCallables: [{ name: names[0], references: [{ file: 'src/services/example.ts', line: 9, directTransport: false, dynamic: true, possibleRegions: [region], nameExpression: 'SECRET_DO_NOT_COPY' }] }], aliasFamilies: [{ base: 'getExample', alias: 'getExampleRegional' }], unresolvedCallableSites: [{ file: 'src/services/example.ts', line: 9, expression: 'SECRET_DO_NOT_COPY' }], unresolvedDynamicImports: [{ file: 'src/Page.tsx', line: 5 }] })
const input = (kind, data) => ({ kind, data: { project, observedAt: now, complete: true, ...data } })
const sdk = (entries = { getExample: [region], getExampleRegional: ['asia-southeast2'] }) => input('sdk', { source, endpoints: Object.fromEntries(Object.entries(entries).map(([name, regions]) => [name, { endpoint: { region: regions, callableTrigger: {}, environmentVariables: { apiKey: 'SECRET_DO_NOT_COPY' } } }])) })
const live = (rows = [{ name: 'getExample', region, service: 'getexample', kind: 'callable', state: 'ACTIVE', latestCreatedRevision: 'getexample-new', latestReadyRevision: 'getexample-old', traffic: [{ revision: 'getexample-old', percent: 100 }] }]) => input('inventory', { functions: rows })
const build = (inputs = [], extra = {}) => buildManifest({ project, source, staticAudit: audit(), inputs, now, ...extra })
const row = (report, name = 'getExample', at = region) => report.entries.find(x => x.name === name && x.region === at)

test('exact project, region, export joins retain aliases and source-only/cloud-only rows', () => {
  const report = build([sdk({ getExample: [region, 'asia-southeast1'], getExampleRegional: ['asia-southeast2'] }), live([{ name: 'getExample', region, service: 'getexample', kind: 'callable' }, { name: 'cloudOnly', region, service: 'cloudonly', kind: 'http' }]), input('inventory', { project: 'other-project', functions: [{ name: 'wrongProject', region }] })])
  assert.equal(report.entries.length, 4)
  assert.equal(row(report).presence, 'source-and-cloud')
  assert.equal(row(report, 'getExample', 'asia-southeast1').presence, 'source-only')
  assert.equal(row(report, 'cloudOnly').presence, 'cloud-only')
  assert.equal(report.summary.rejectedArtifacts, 1)
  assert.equal(report.aliasCandidates[0].status, 'name-similarity-only')
  assert.equal(row(report).ownership.status, 'unknown')
  assert.equal(row(report).handler.status, 'review-required')
  assert.equal(row(report).consumers.references[0].dynamic, true)
  assert.equal(report.unresolved.dynamicImports.length, 1)
  assert.ok(report.entries.every(x => x.deletionAllowed === false))
})

test('source metadata distinguishes task queue and schedules from events', () => {
  const entries = Object.fromEntries(['worker', 'timer', 'event'].map((name, i) => [name, { endpoint: { region: [region], [['taskQueueTrigger', 'scheduleTrigger', 'eventTrigger'][i]]: {} } }]))
  const report = build([input('sdk', { source, endpoints: entries })], { staticAudit: audit(['worker', 'timer', 'event']) })
  assert.deepEqual(report.entries.map(x => x.kind.value).sort(), ['event-trigger', 'scheduled', 'task-queue'])
})

test('unknown, stale, partial and conflicting evidence never becomes a fabricated authoritative value', () => {
  const stale = live(); stale.data.observedAt = '2026-10-23T12:00:00Z'
  let report = build([sdk(), stale])
  assert.equal(row(report).deploymentState.status, 'stale')
  assert.equal(row(report).deploymentState.value, null)
  const partial = live(); partial.data.complete = false
  report = build([sdk(), partial])
  assert.equal(row(report).deploymentState.status, 'partial')
  report = build([sdk(), live(), live([{ name: 'getExample', region, service: 'different-service', kind: 'http' }])])
  assert.equal(row(report).service.status, 'conflicting')
  assert.equal(row(report).kind.status, 'conflicting')
  const unbound = sdk(); delete unbound.data.source
  report = build([unbound])
  assert.equal(row(report).sourceRegionConfirmed, false)
  assert.equal(row(report).kind.status, 'unknown')
  const mismatched = sdk(); mismatched.data.source = { ...source, digest: 'c'.repeat(64) }
  assert.equal(row(build([mismatched])).kind.status, 'stale')
  const malformed = build([sdk(), input('inventory', { functions: 'SECRET_DO_NOT_COPY' })])
  assert.equal(malformed.summary.rejectedArtifacts, 1)
  assert.ok(malformed.artifacts[1].issues.includes('INPUT_SHAPE_INVALID'))
  assert.equal(row(malformed).deploymentState.status, 'unknown')
})

test('latest backlog is separate from healthy old serving traffic; release failure is not an outage', () => {
  const health = input('health', { region, mode: 'serving', services: [{ name: 'getexample', servingHealth: { status: 'healthy', revisions: [{ revision: 'getexample-old', percent: 100 }] } }] })
  const failedRelease = input('health', { region, mode: 'release', services: [{ name: 'getexample', status: 'unhealthy', ready: false, readyRevision: 'getexample-old', createdRevision: 'getexample-new' }] })
  const report = build([sdk(), live(), health, failedRelease])
  assert.equal(row(report).latestRevision.value.created, 'getexample-new')
  assert.equal(row(report).servingRouting.value.health, 'not_verified')
  assert.equal(row(report).observations[0].value.health, 'healthy')
  assert.equal(row(report).observations[1].value.health, 'not_verified')
  assert.deepEqual(row(report).servingRouting.value.traffic, [{ revision: 'getexample-old', percent: 100 }])
})

test('split traffic is retained and health requires exact unambiguous service mapping', () => {
  const inventory = live([{ name: 'getExample', region, service: 'shared', traffic: [{ revision: 'shared-a', percent: 20 }, { revision: 'shared-b', percent: 80 }] }, { name: 'getExampleRegional', region, service: 'shared' }])
  const report = build([sdk(), inventory, input('health', { region, services: [{ name: 'shared', status: 'healthy' }] })])
  assert.equal(row(report).servingRouting.value.traffic.length, 2)
  assert.equal(row(report).observations.length, 0)
  assert.ok(report.unmatchedEvidence.some(x => x.reason === 'AMBIGUOUS_SERVICE_MAPPING'))
  const noMapping = build([sdk(), input('health', { region, services: [{ name: 'getexample', status: 'healthy' }] })])
  assert.equal(row(noMapping).observations.length, 0, 'lowercasing the function name must not invent a mapping')
})

test('resource references cannot cross a project, region or service even when short names match', () => {
  const inventory = live([{ name: 'getExample', region, service: `projects/${project}/locations/${region}/services/getexample`, latestCreatedRevision: `projects/other-project/locations/${region}/services/getexample/revisions/getexample-new`, traffic: [{ revision: `projects/${project}/locations/${region}/services/wrong/revisions/getexample-old`, percent: 100 }] }])
  const report = build([sdk(), inventory, input('health', { region, services: [{ name: `projects/other-project/locations/${region}/services/getexample`, servingHealth: { status: 'healthy' } }] })])
  assert.equal(row(report).service.status, 'partial')
  assert.equal(row(report).service.observations[0].value, 'getexample')
  assert.equal(row(report).latestRevision.value, null)
  assert.deepEqual(row(report).servingRouting.observations[0].value.traffic, [])
  assert.equal(row(report).observations.length, 0)
  const wrong = live([{ name: 'getExample', region, service: `projects/${project}/locations/asia-southeast1/services/getexample` }])
  assert.equal(row(build([sdk(), wrong])).service.status, 'unknown')
})

test('malformed or duplicate cloud rows cannot preserve a complete known coverage claim', () => {
  const cases = [
    null,
    { name: 'invalid/name', region, service: 'invalid' },
    { name: 'getExample', region: 'bad-region', service: 'getexample' },
    { name: 'getExample', region: 'asia-southeast1', service: 'getexample' },
    { name: 'getExample', region, service: `projects/other-project/locations/${region}/services/getexample` },
    { name: 'getExample', region, service: 'getexample', traffic: [{ revision: 'getexample-old', percent: 101 }] },
    { name: 'getExample', region, service: 'getexample', traffic: [null] },
  ]
  for (const bad of cases) {
    const inventory = live([bad]); inventory.data.scope = { regions: [region] }
    const report = build([sdk(), inventory])
    assert.equal(report.artifacts[1].complete, false)
    assert.equal(report.artifacts[1].status, 'partial')
    assert.equal(report.artifacts[1].invalidRows, 1)
    assert.ok(report.artifacts[1].issues.includes('INVALID_OR_DUPLICATE_INVENTORY_ROWS'))
    assert.equal(report.cloudCoverage[0].complete, false)
    assert.equal(report.deletionAllowed, false)
  }
  const duplicated = live(); duplicated.data.functions.push({ ...duplicated.data.functions[0] })
  assert.equal(build([sdk(), duplicated]).artifacts[1].complete, false)
})

test('a stale service mapping cannot borrow a different fresh mapping to attach current health or activity', () => {
  const old = live([{ name: 'getExample', region, service: 'old-service' }]); old.data.observedAt = '2026-10-23T00:00:00Z'
  const current = live([{ name: 'getExample', region, service: 'new-service' }])
  const health = input('health', { region, services: [{ name: 'old-service', servingHealth: { status: 'healthy' } }, { name: 'new-service', servingHealth: { status: 'healthy' } }] })
  const activity = input('activity', { windows: { now: { start: '2026-10-29T00:00:00Z', end: now, status: 'complete', groups: [{ key: region + '/old-service', requests: 6 }] } } })
  const telemetry = input('telemetry', { range: { start: '2026-10-29T00:00:00Z', end: now }, operations: [{ operation: 'getExample', cohorts: [{ region, service: 'old-service', sampleCount: 3 }] }] })
  const report = build([sdk(), old, current, health, activity, telemetry])
  assert.equal(row(report).service.value, 'new-service')
  assert.equal(row(report).observations.length, 1)
  assert.equal(row(report).observations[0].status, 'known')
  assert.equal(report.unmatchedEvidence.filter(x => x.reason === 'SERVICE_MAPPING_UNKNOWN').length, 3)
})

test('request windows remain separate, missing series stay unknown and sampled auth errors do not prove usage', () => {
  const activity = input('activity', { windows: { a: { start: '2026-10-29T00:00:00Z', end: now, status: 'complete', groups: [{ key: region + '/getexample', requests: 5 }] }, b: { start: '2026-10-29T12:00:00Z', end: now, status: 'partial', groups: [{ key: region + '/getexample', requests: 2 }] } } })
  const telemetry = input('telemetry', { range: { start: '2026-10-29T00:00:00Z', end: now }, operations: [{ operation: 'getExample', cohorts: [{ region, service: 'getexample', release: 'getexample-old', outcome: 'error', authenticated: false, sampleCount: 3, actorUid: 'SECRET_DO_NOT_COPY' }] }] })
  const report = build([sdk(), live(), activity, telemetry])
  const observations = row(report).observations
  assert.equal(observations.length, 3)
  assert.equal(observations[1].status, 'partial')
  assert.equal(observations[2].value.authenticated, false)
  assert.equal(row(report, 'getExampleRegional', 'asia-southeast2').observations.length, 0)
  assert.equal('totalRequests' in row(report), false)
  const staleMapping = live(); staleMapping.data.observedAt = '2026-10-23T00:00:00Z'
  assert.equal(row(build([sdk(), staleMapping, telemetry])).observations[0].status, 'stale')
})

test('review must be attributed and source-bound; registry and historical252 never authorize deletion', () => {
  const review = input('review', { source, reviewer: 'Ops team', entries: [{ name: 'getExample', region, owner: 'Platform team', canonical: 'getExample', reviewed: true }] })
  const historical = input('historical', { observedAt: '2026-10-23T15:33:20Z', sourceCommit: 'd'.repeat(40), summary: { latestNotServing: 252 }, mismatchedEndpoints: [{ name: 'SECRET_DO_NOT_COPY' }] })
  const registry = { project, entries: [{ name: 'getExample', region, canonical: 'getExample', status: 'deprecated-observing', observationStart: '2026-10-23T15:56:19Z', notBefore: '2026-11-06T15:56:19Z' }] }
  let report = build([sdk(), review, historical], { registry })
  assert.equal(row(report).ownership.value.owner, 'Platform team')
  assert.equal(row(report).compatibility.status, 'registry-declared')
  assert.equal(report.historical[0].latestNotServing, 252)
  assert.equal(report.historical[0].historicalOnly, true)
  assert.equal(row(report).latestRevision.status, 'unknown')
  assert.equal(report.deletionAllowed, false)
  delete historical.data.project
  assert.equal(build([sdk(), historical]).historical[0].latestNotServing, 252, 'legacy routing summaries remain historical even without project binding')
  review.data.source = { ...source, commit: 'e'.repeat(40) }
  report = build([sdk(), review])
  assert.equal(row(report).ownership.status, 'stale')
  assert.equal(row(report).ownership.value, null)
})

test('existing raw SDK and selected parity formats remain useful without inventing source provenance or coverage', () => {
  const raw = { kind: 'sdk', data: { getExample: { endpoint: { region: [region], callableTrigger: {} } } } }
  let report = build([raw])
  assert.equal(row(report).kind.status, 'unknown')
  const selected = input('sdk', { source, matrix: [{ selectedEndpoints: raw.data }] })
  report = build([selected])
  assert.equal(report.artifacts[0].complete, false)
  assert.ok(report.artifacts[0].issues.includes('SELECTED_ENDPOINTS_ONLY'))
  assert.equal(row(report, 'getExampleRegional', null).presence, 'source-only')
  assert.equal(row(report, 'getExampleRegional', null).sourceRegionConfirmed, false)
  const old = { kind: 'sdk', data: { removedExport: raw.data.getExample } }
  assert.equal(row(build([old]), 'removedExport').presence, 'sdk-only', 'an old SDK export is not a cloud observation')
})

test('whitelist drops raw credentials, request payloads, error text and source expressions from all inputs', () => {
  const inventory = live(); Object.assign(inventory.data.functions[0], { environmentVariables: { API_KEY: 'SECRET_DO_NOT_COPY' }, token: 'SECRET_DO_NOT_COPY', error: 'SECRET_DO_NOT_COPY' })
  inventory.data.warnings = ['SECRET_DO_NOT_COPY']
  const report = build([sdk(), inventory, input('historical', { notes: 'SECRET_DO_NOT_COPY', summary: { latestNotServing: 252, token: 'SECRET_DO_NOT_COPY' } })])
  assert.doesNotMatch(JSON.stringify(report), /SECRET_DO_NOT_COPY|environmentVariables|API_KEY|nameExpression|actorUid/)
})

test('CLI source stability fence, protected paths and fixture execution are enforced', () => {
  const unbound = { commit: 'not-a-commit', digest: 'not-a-digest' }
  assert.throws(() => buildManifest({ project, source: unbound, staticAudit: { ...audit(), source: unbound }, now }), /stable/)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-endpoint-manifest-test-'))
  try {
    fs.mkdirSync(path.join(root, 'functions'))
    fs.mkdirSync(path.join(root, 'src'))
    fs.writeFileSync(path.join(root, 'functions/index.js'), "throw Error('BUSINESS HANDLER MUST NOT EXECUTE'); exports.getExample = onCall(() => {});\n")
    const args = [`--root=${root}`, `--project=${project}`, '--out=tmp/endpoints.json']
    const report = runCli(args, { sourceSnapshot: () => source })
    assert.equal(report.summary.sourceExports, 1)
    assert.ok(fs.existsSync(path.join(root, 'tmp/endpoints.json')))
    assert.throws(() => runCli([...args.slice(0, -1), '--out=functions/index.js'], { sourceSnapshot: () => source }), /Output must/)
    let calls = 0
    assert.throws(() => runCli([...args.slice(0, -1), '--out=tmp/changed.json'], { sourceSnapshot: () => (++calls === 1 ? source : { ...source, digest: 'c'.repeat(64) }) }), /stable/)
    assert.equal(fs.existsSync(path.join(root, 'tmp/changed.json')), false)
    assert.throws(() => runCli([...args, '--delete=true']), /Unknown/)
    assert.throws(() => runCli([...args, '--inventory=tmp/endpoints.json']), /overwritten/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
