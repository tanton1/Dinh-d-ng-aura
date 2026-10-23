'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { classify, decision, sumPoints, runtimeProfile, mapBounded, sumKnown, configuredMinimumFloor, latestRevisionServing } = require('./audit-function-regions.cjs')

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
