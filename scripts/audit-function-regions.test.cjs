'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { classify, decision, sumPoints, runtimeProfile, mapBounded, sumKnown, configuredMinimumFloor, latestRevisionServing, inspectServiceRuntime, renderInventory } = require('./audit-function-regions.cjs')

test('classification and candidates never encourage duplicate triggers or schedulers', () => {
  assert.equal(classify({ eventTrigger: {}, labels: { 'deployment-callable': 'true' } }), 'event-trigger')
  assert.equal(classify({ labels: { 'deployment-scheduled': 'true' } }), 'scheduled')
  assert.match(decision({ kind: 'event-trigger', region: 'asia-southeast1' }), /^keep-near-database/)
  assert.match(decision({ kind: 'scheduled', region: 'asia-southeast1' }), /^keep single scheduler/)
  assert.match(decision({ kind: 'callable', region: 'asia-southeast1', aliases: [], name: 'getRead', requests7d: 200 }), /^candidate/)
})

test('metric points support doubles and int64 strings without reading cumulative assumptions', () => {
  assert.equal(sumPoints({ points: [{ value: { int64Value: '12' } }, { value: { doubleValue: 0.5 } }] }), 12.5)
  assert.equal(sumPoints({}), 0)
})

test('serving revision warm and CPU settings are inspected separately from failed latest settings', () => {
  const profile = runtimeProfile({ name: 'projects/p/revisions/ready-old', scaling: { minInstanceCount: 2, maxInstanceCount: 5 }, containers: [{ resources: { limits: { cpu: '0.25', memory: '256Mi' }, startupCpuBoost: true } }] })
  assert.deepEqual(profile, { revision: 'ready-old', cpu: 0.25, memory: '256Mi', minInstances: 2, maxInstances: 5, concurrency: null, startupCpuBoost: true })
})

test('inventory lookups respect bounded concurrency and input ordering', async () => {
  let active = 0
  let peak = 0
  const result = await mapBounded([1, 2, 3, 4, 5], async (item) => {
    active++
    peak = Math.max(active, peak)
    await new Promise((resolve) => setImmediate(resolve))
    active--
    return item * 2
  }, 2)
  assert.equal(peak, 2)
  assert.deepEqual(result, [2, 4, 6, 8, 10])
})

test('missing metrics and unknown serving revisions never become a false zero', () => {
  assert.equal(sumKnown([{ requests24h: null }, { requests24h: 10 }], 'requests24h'), null)
  assert.equal(sumKnown([{ requests24h: 0 }, { requests24h: 10 }], 'requests24h'), 10)
  assert.equal(configuredMinimumFloor({ serviceMinInstances: 0, servingRevisions: [] }), null)
  assert.equal(configuredMinimumFloor({ serviceMinInstances: 2, servingRevisions: [{ minInstances: 3 }, { minInstances: 4 }] }), 7)
  assert.equal(configuredMinimumFloor({ serviceMinInstances: 0, revisionMinInstances: 5, servingRevisions: [{ minInstances: 0 }] }), 0)
})

test('Ready candidates behind a zero-traffic staging tag are not reported as serving latest', () => {
  const latest = 'projects/p/locations/r/services/example/revisions/example-2'
  const service = { latestCreatedRevision: latest, latestReadyRevision: latest, trafficStatuses: [{ revision: 'example-1', percent: 100 }, { revision: 'example-2', tag: 'rvc' }] }
  assert.equal(latestRevisionServing(service), false)
  assert.equal(latestRevisionServing({ ...service, trafficStatuses: [{ revision: 'example-2', percent: 50 }, { revision: 'example-1', percent: 50 }] }), false)
  assert.equal(latestRevisionServing({ ...service, trafficStatuses: [{ revision: 'example-2', percent: 100 }] }), true)
  assert.equal(latestRevisionServing(undefined), false)
})

test('audit serving verification is opt-in and reuses an old revision read without fetching latest backlog', async () => {
  const name = 'projects/p/locations/r/services/example'
  const service = { name, latestCreatedRevision: `${name}/revisions/example-2`, latestReadyRevision: `${name}/revisions/example-1`, trafficStatuses: [{ revision: 'example-1', percent: 100 }], template: { containers: [{ resources: { limits: { cpu: '1' } } }] } }
  let reads = []
  const read = async resource => {
    reads.push(resource)
    assert.equal(resource, `${name}/revisions/example-1`)
    return { name: resource, containers: [{ resources: { limits: { cpu: '0.25' } } }], conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }, { type: 'ContainerHealthy', state: 'CONDITION_SUCCEEDED' }] }
  }
  const normal = await inspectServiceRuntime(service, read)
  assert.equal(normal.health.status, 'not_verified')
  assert.equal(normal.health.ready, null)
  assert.equal(reads.length, 1)
  reads = []
  const verified = await inspectServiceRuntime(service, read, { verifyServing: true })
  assert.equal(verified.health.ready, true)
  assert.equal(verified.profiles[0].cpu, 0.25)
  assert.equal(reads.length, 1, 'profile and health must share one metadata GET')
})

test('audit latest-serving profile avoids GET by default but checks actual conditions when opted in', async () => {
  const name = 'projects/p/locations/r/services/example'
  const service = { name, latestCreatedRevision: `${name}/revisions/example-2`, latestReadyRevision: `${name}/revisions/example-2`, trafficStatuses: [{ revision: 'example-2', percent: 100 }], template: { containers: [] } }
  let reads = 0
  const normal = await inspectServiceRuntime(service, async () => { reads++; throw new Error('unexpected') })
  assert.equal(reads, 0)
  assert.equal(normal.health.ready, null)
  const warnings = []
  const unavailable = await inspectServiceRuntime(service, async () => { reads++; throw new Error('403 revision read') }, { verifyServing: true, warn: warning => warnings.push(warning) })
  assert.equal(reads, 1)
  assert.equal(unavailable.health.status, 'unknown')
  assert.equal(unavailable.health.ready, null)
  assert.equal(unavailable.profiles[0].minInstances, null)
  assert.deepEqual(warnings, ['403 revision read'])
})

test('inventory text separates a healthy fleet from release backlog rather than counting candidates as outages', () => {
  const output = renderInventory({ project: 'p', observedAt: 'now', quotas: [], warnings: [], functions: [], summary: [{ region: 'r', functions: 520, byKind: { callable: 448, 'event-trigger': 56, scheduled: 16 }, configuredMinimums: 0, requests24h: 0, requests7d: 0, latestRevisionNotReady: Array(252).fill('candidate'), latestRevisionNotServing: Array(252).fill('candidate'), servingHealth: { verified: true, healthy: 520, unhealthy: [], unknown: [] } }] })
  assert.match(output, /release backlog=252; serving khỏe=520, không khỏe=0, chưa rõ=0/)
  assert.match(output, /--verify-serving/)
})
