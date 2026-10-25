'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { validateRegistry, dependencyTemplate, evaluateLifecycle, coreSymbolsInSource, runCli } = require('./evaluate-function-lifecycle.cjs')

function fixture(overrides = {}) {
  const now = '2027-01-20T12:00:00.000Z'
  const source = { commit: 'current-commit', digest: 'current-source-content' }
  const registry = {
    schemaVersion: 1, project: 'test-project',
    policy: { evidenceMaxAgeHours: 24, clockSkewMinutes: 5, minimumNormalObservationDays: 14, minimumRareOrFinancialObservationDays: 30, deletionAllowed: false },
    entries: [{ name: 'oldReader', region: 'asia-east1', canonical: 'oldReader', replacement: null, reason: 'reviewed obsolete wrapper', status: 'deprecated-observing', observationStart: '2027-01-01T00:00:00.000Z', notBefore: '2027-01-15T00:00:00.000Z', minimumObservationDays: 14, risk: 'normal', minimumBusinessCycleDays: 0, operation: 'read', coreToRetain: [], deletionAllowed: false }],
  }
  Object.assign(registry.entries[0], overrides)
  const dependencies = dependencyTemplate(registry, source, now)
  dependencies.reviewer = 'operations-reviewer'
  const review = dependencies.entries[0]
  review.reviewed = true
  review.owner = 'schedule-owner'
  review.evidence = ['review: client inventory, runbook and dependency scan']
  for (const scope of Object.keys(review.reviewedScopes)) review.reviewedScopes[scope] = true
  review.retirementWithoutReplacementReviewed = true
  review.rollbackReady = true
  const staticAudit = { generatedAt: now, source, snapshotStable: true, coverage: { unresolvedExportSpreads: 0, unresolvedComputedExports: 0, unresolvedDynamicImports: 0 }, frontendCallables: [], backendExports: [{ name: 'oldReader', kinds: ['callable'] }] }
  const metrics = { project: registry.project, observedAt: now, warnings: [], windows: { observation: { status: 'complete', start: '2027-01-01T00:00:00.000Z', end: now, groups: [] } } }
  const inventory = { project: registry.project, observedAt: now, warnings: [], functions: [{ name: 'oldReader', region: 'asia-east1', service: 'oldreader', kind: 'callable', state: 'ACTIVE', servingRevisions: [{ revision: 'oldreader-1' }], traffic: [{ revision: 'oldreader-1', percent: 100 }], latestRevisionServing: false }] }
  return { registry, source, staticAudit, metrics, dependencies, inventory, coreSymbols: {}, now }
}
const first = (input) => evaluateLifecycle(input).entries[0]
const has = (row, code) => row.issues.some((issue) => issue.code === code)

test('a complete source-bound zero-series window permits review readiness, never deletion', () => {
  const report = evaluateLifecycle(fixture())
  assert.deepEqual(report.summary, { total: 1, eligible: 1, review: 0, retain: 0 })
  assert.equal(report.deletionAllowed, false)
  assert.equal(report.entries[0].deletionAllowed, false)
  assert.equal(report.entries[0].windowEvidence[0].matchingSeries, 0)
})

test('missing, failed, malformed and stale metric evidence never becomes zero', () => {
  for (const mutate of [
    (input) => { input.metrics = null },
    (input) => { input.metrics.windows.observation.status = 'failed' },
    (input) => { input.metrics.windows.observation.groups = null },
    (input) => { input.metrics.windows.observation.groups = [{ key: 'asia-east1/oldreader', requests: null }] },
    (input) => { input.metrics.warnings = ['quota exceeded'] },
    (input) => { input.metrics.observedAt = '2027-01-18T00:00:00Z' },
    (input) => { input.metrics.project = 'wrong-project' },
  ]) {
    const input = fixture(); mutate(input)
    assert.equal(first(input).gatePassed, false)
  }
})

test('unknown computed exports and reports predating their coverage block retirement review readiness', () => {
  for (const value of [1, undefined]) {
    const input = fixture()
    input.staticAudit.coverage.unresolvedComputedExports = value
    assert.equal(first(input).gatePassed, false)
    assert.equal(has(first(input), 'STATIC_UNRESOLVED'), true)
  }
})

test('no short rolling window can satisfy a full observation period', () => {
  const input = fixture()
  input.metrics.windows.observation.start = '2027-01-13T00:00:00Z'
  assert.equal(has(first(input), 'METRICS_WINDOW_INCOMPLETE'), true)
  input.metrics.windows.observation.start = '2027-01-01T00:00:00Z'
  input.registry.entries[0].notBefore = '2027-02-01T00:00:00Z'
  assert.equal(has(first(input), 'OBSERVATION_INCOMPLETE'), true)
})

test('old commits, edited source digests and a changing static snapshot block eligibility', () => {
  for (const mutate of [
    (input) => { input.dependencies.source = { ...input.source, commit: 'older-commit' } },
    (input) => { input.dependencies.source = { ...input.source, digest: 'before-local-edit' } },
    (input) => { input.staticAudit.source = { ...input.source, digest: 'before-local-edit' } },
    (input) => { input.staticAudit.snapshotStable = false },
    (input) => { input.dependencies.observedAt = '2027-01-18T00:00:00Z' },
  ]) {
    const input = fixture(); mutate(input)
    assert.equal(first(input).gatePassed, false)
  }
})

test('any observed traffic, including preflight/error-only traffic, retains the wrapper', () => {
  const input = fixture()
  input.metrics.windows.recent = { status: 'complete', start: '2027-01-20T00:00:00Z', end: input.now, groups: [{ key: 'ASIA-EAST1/OLDREADER', requests: 2, codes: { 204: 1, 503: 1 } }] }
  const row = first(input)
  assert.equal(row.decision, 'retain')
  assert.equal(has(row, 'RECORDED_TRAFFIC'), true)
})

test('a reviewed fallback/script/external caller blocks retirement despite zero traffic', () => {
  for (const scope of ['fallback', 'scripts', 'external', 'internalRpc']) {
    const input = fixture()
    input.dependencies.entries[0].callers[scope] = ['still-supported-client']
    assert.equal(first(input).decision, 'retain')
  }
})

function addReplacement(input) {
  input.registry.entries[0].replacement = { name: 'regionalReader', region: 'asia-east1' }
  input.registry.entries[0].canonical = 'regionalReader'
  input.staticAudit.backendExports.push({ name: 'regionalReader', kinds: ['callable'] })
  input.inventory.functions.push({ name: 'regionalReader', region: 'asia-east1', kind: 'callable', state: 'ACTIVE', servingRevisions: [{ revision: 'regionalReader-old' }], traffic: [{ revision: 'regionalReader-old', percent: 100 }], latestRevisionServing: false })
  input.dependencies.entries[0].replacementVerified = true
}

test('reviewed logical Map names may be excluded while a serving older replacement stays valid', () => {
  const input = fixture(); addReplacement(input)
  const ref = { file: 'src/service.ts', line: 7, transport: 'invoke', directTransport: false }
  input.staticAudit.frontendCallables = [{ name: 'oldReader', references: [ref] }]
  input.dependencies.entries[0].logicalReferenceOverrides = [{ ...ref, kind: 'logical-name-only', noWireCall: true, replacement: 'regionalReader', evidence: ['route-policy.test: confirmed transport name'] }]
  const row = first(input)
  assert.equal(row.decision, 'eligible')
  assert.equal(row.excludedLogicalReferences.length, 1)
  input.dependencies.source = { ...input.source, digest: 'stale-route-policy' }
  assert.equal(first(input).decision, 'retain')
})

test('logical overrides cannot suppress a direct callable or its fallback request', () => {
  const input = fixture(); addReplacement(input)
  const ref = { file: 'src/service.ts', line: 8, transport: 'httpsCallable', directTransport: true }
  input.staticAudit.frontendCallables = [{ name: 'oldReader', references: [ref] }]
  input.dependencies.entries[0].logicalReferenceOverrides = [{ ...ref, kind: 'logical-name-only', noWireCall: true, replacement: 'regionalReader', evidence: ['invalid attempt to suppress fallback'] }]
  assert.equal(has(first(input), 'STATIC_CALLER_ACTIVE'), true)
})

test('replacement absent, unserved or in the wrong region blocks review readiness', () => {
  for (const mutate of [
    (input) => { input.inventory.functions[1].traffic = [] },
    (input) => { input.inventory.functions[1].region = 'asia-southeast1' },
    (input) => { input.staticAudit.backendExports.pop() },
    (input) => { input.inventory.functions[1].kind = 'scheduled' },
    (input) => { input.dependencies.entries[0].replacementVerified = false },
  ]) {
    const input = fixture(); addReplacement(input); mutate(input)
    assert.equal(has(first(input), 'REPLACEMENT_UNVERIFIED'), true)
  }
})

test('source triggers and reviewed scheduler bindings are retained regardless of zero requests', () => {
  const input = fixture()
  input.staticAudit.backendExports[0].kinds = ['scheduled']
  assert.equal(first(input).decision, 'retain')
  input.staticAudit.backendExports[0].kinds = ['callable']
  input.dependencies.entries[0].schedulerBindings = ['monthly-reconciliation']
  assert.equal(first(input).decision, 'retain')
})

test('maintenance status and shared-core protection cannot be relaxed by empty traffic', () => {
  const input = fixture({ status: 'retained-maintenance', notBefore: null, coreToRetain: [{ file: 'functions/core.js', symbol: 'rebuildCore' }] })
  input.coreSymbols['functions/core.js#rebuildCore'] = true
  input.dependencies.entries[0].preserveCore = { verified: true, testEvidence: ['core callers integration passed'] }
  assert.equal(first(input).decision, 'retain')
  input.registry.entries[0].status = 'deprecated-observing'
  input.registry.entries[0].notBefore = '2027-01-15T00:00:00Z'
  assert.equal(first(input).decision, 'eligible')
  input.coreSymbols['functions/core.js#rebuildCore'] = false
  assert.equal(has(first(input), 'RETAINED_CORE_MISSING'), true)
  assert.equal(first(input).decision, 'retain')
})

test('financial write requires a full observed business cycle and proven retry/atomic-core semantics', () => {
  const input = fixture({ risk: 'financial', operation: 'write', minimumObservationDays: 30, minimumBusinessCycleDays: 30, observationStart: '2026-12-01T00:00:00Z', notBefore: '2026-12-31T00:00:00Z' })
  input.metrics.windows.observation.start = '2026-12-01T00:00:00Z'
  const review = input.dependencies.entries[0]
  assert.equal(has(first(input), 'BUSINESS_CYCLE_INCOMPLETE'), true)
  assert.equal(has(first(input), 'FINANCIAL_RETRY_UNVERIFIED'), true)
  review.businessCycle = { start: '2026-12-01T00:00:00Z', end: '2027-01-01T00:00:00Z', evidence: ['full December settlement cycle reconciled'] }
  for (const flag of ['sharedIdempotencyKey', 'payloadConflictRejected', 'resultLookupAfterTimeout', 'noBlindCrossRegionRetry', 'sameAtomicCore']) review.financialRetry[flag] = true
  review.financialRetry.testEvidence = ['timeout + duplicate key + conflicting payload + cross-region attempt tests passed']
  assert.equal(first(input).decision, 'eligible')
  review.financialRetry.resultLookupAfterTimeout = false
  assert.equal(has(first(input), 'FINANCIAL_RETRY_UNVERIFIED'), true)
  review.businessCycle.start = '2026-11-01T00:00:00Z'
  assert.equal(has(first(input), 'BUSINESS_CYCLE_INCOMPLETE'), true)
})

test('source declaration check does not mistake comments or property text for a preserved core', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-lifecycle-test-'))
  try {
    fs.mkdirSync(path.join(root, 'functions'))
    const registry = fixture({ coreToRetain: [{ file: 'functions/core.js', symbol: 'rebuildCore' }] }).registry
    fs.writeFileSync(path.join(root, 'functions/core.js'), '// function rebuildCore() {}\nconst x = "rebuildCore"\n')
    assert.equal(coreSymbolsInSource(root, registry)['functions/core.js#rebuildCore'], false)
    fs.writeFileSync(path.join(root, 'functions/core.js'), 'async function rebuildCore() { return 1 }\n')
    assert.equal(coreSymbolsInSource(root, registry)['functions/core.js#rebuildCore'], true)
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.match(path.basename(root), /^aura-lifecycle-test-/)
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('manifest validation rejects deletion switches, shortened windows and duplicate endpoints', () => {
  for (const mutate of [
    (registry) => { registry.entries[0].deletionAllowed = true },
    (registry) => { registry.policy.deletionAllowed = true },
    (registry) => { registry.entries[0].minimumObservationDays = 7 },
    (registry) => { registry.entries[0].notBefore = '2027-01-02T00:00:00Z' },
    (registry) => { registry.entries.push({ ...registry.entries[0] }) },
    (registry) => { registry.entries[0].coreToRetain = [{ file: 'functions/../outside.js', symbol: 'core' }] },
  ]) {
    const input = fixture(); mutate(input.registry)
    assert.ok(validateRegistry(input.registry).length > 0)
    assert.throws(() => evaluateLifecycle(input))
  }
})

test('committed registry covers the 24 audit candidates, 4 retained wrappers and one weekly base only', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '../ops/function-lifecycle.json'), 'utf8'))
  assert.deepEqual(validateRegistry(registry), [])
  assert.equal(registry.entries.length, 29)
  assert.equal(registry.entries.filter((row) => row.status === 'retained-maintenance').length, 4)
  assert.deepEqual(registry.entries.filter((row) => row.status === 'retained-maintenance').map((row) => row.name).sort(), ['markPtScheduleWeeklyViewDirty', 'markPtScheduleWeeklyViewDirtyRegional', 'rebuildPtScheduleWeeklyView', 'rebuildPtScheduleWeeklyViewRegional'].sort())
  assert.equal(registry.entries.find((row) => row.name === 'getPtScheduleWeeklyView').replacement.name, 'getPtScheduleWeeklyViewRegional')
  assert.ok(registry.entries.every((row) => row.deletionAllowed === false))
  assert.ok(registry.entries.filter((row) => row.risk !== 'normal').every((row) => row.minimumObservationDays >= 30 && row.minimumBusinessCycleDays >= 30))
})

test('CLI rejects writes to source, root config, input evidence and overlapping artifacts before scanning', () => {
  const root = path.resolve(__dirname, '..')
  for (const args of [
    ['--output=package.json'],
    ['--output=functions/package.json'],
    ['--output=ops/function-lifecycle.json'],
    ['--output=../outside.json'],
    ['--output=tmp/live.json', '--inventory=tmp/live.json'],
    ['--output=tmp/report.json', '--dependency-template=tmp/report.json'],
    ['--output=tmp/report.txt'],
  ]) assert.throws(() => runCli([`--root=${root}`, ...args]), /Artifact|distinct|\.json artifact/)
})
