'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { latestReady, servingLatest, assertReadyForPromotion, pinnedTraffic, recoveryBody, validatePlan,
  platformReadinessRevisionName, assertHealthyServingRevision, platformRollbackBody, recoverWithPlatformReadiness } = require('./recover-function-revisions.cjs')
const name = 'projects/gen-lang-client-0815966909/locations/asia-southeast1/services/example'
const image = 'asia-southeast1-docker.pkg.dev/gen-lang-client-0815966909/gcf-artifacts/example@sha256:' + 'a'.repeat(64)
function fixture() {
  return {
    name, etag: 'etag', latestCreatedRevision: `${name}/revisions/example-2`, latestReadyRevision: `${name}/revisions/example-1`,
    trafficStatuses: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', revision: 'example-1', percent: 100 }],
    template: { scaling: { maxInstanceCount: 1 }, containers: [{ image: 'mutable:tag', env: [{ name: 'FUNCTION_TARGET', value: 'example' }, { name: 'SECRET_REF', valueSource: { secretKeyRef: { secret: 'retained', version: '1' } } }], resources: { limits: { cpu: '0.1666', memory: '256Mi' } } }] },
  }
}
test('recovery pins previous traffic and latest immutable image without changing resource or secret configuration', () => {
  const service = fixture()
  const original = structuredClone(service)
  const body = recoveryBody(service, { name: service.latestCreatedRevision, containers: [{ image }] }, 'example')
  assert.deepEqual(body.traffic, [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: 'example-1', percent: 100 }, { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 0, tag: 'rvc' }])
  assert.equal(body.template.revision, '')
  assert.equal(body.template.containers[0].image, image)
  assert.deepEqual(body.template.containers[0].env, service.template.containers[0].env)
  assert.deepEqual(body.template.containers[0].resources, service.template.containers[0].resources)
  assert.equal(body.etag, service.etag)
  assert.deepEqual(service, original)
})
test('custom traffic, concurrent changes, warm instances and wrong entrypoints fail closed', () => {
  assert.throws(() => pinnedTraffic({ ...fixture(), trafficStatuses: [{ revision: 'other', percent: 100 }] }), /traffic/)
  for (const patch of [{ reconciling: true }, { scaling: { minInstanceCount: 1 } }, { latestCreatedRevision: `${name}/revisions/other` }]) {
    assert.throws(() => recoveryBody({ ...fixture(), ...patch }, { name: `${name}/revisions/example-2`, containers: [{ image }] }, 'example'))
  }
  assert.throws(() => recoveryBody(fixture(), { name: `${name}/revisions/example-2`, containers: [{ image }] }, 'other'), /entrypoint/)
  assert.throws(() => recoveryBody(fixture(), { name: `${name}/revisions/example-2`, containers: [{ image: 'untrusted/image:latest' }] }, 'example'), /digest/)
})
test('a service with no ready revision can be recovered without inventing a rollback target', () => {
  const service = { ...fixture(), latestReadyRevision: undefined, trafficStatuses: [] }
  const body = recoveryBody(service, { name: service.latestCreatedRevision, containers: [{ image }] }, 'example')
  assert.equal(body.traffic, undefined)
  assert.equal(latestReady(service), false)
  assert.equal(latestReady({ latestCreatedRevision: 'same', latestReadyRevision: 'same' }), true)
})
test('frozen plans reject outside projects, unsupported regions and duplicate targets', () => {
  const plan = { schemaVersion: 1, project: 'gen-lang-client-0815966909', createdAt: new Date().toISOString(), targets: [{ function: 'example', service: 'example', region: 'asia-southeast1', expectedCreated: `${name}/revisions/example-2` }] }
  assert.doesNotThrow(() => validatePlan(plan))
  assert.throws(() => validatePlan({ ...plan, project: 'other' }))
  assert.throws(() => validatePlan({ ...plan, createdAt: 'not-a-date' }), /date/)
  assert.throws(() => validatePlan({ ...plan, createdAt: new Date(Date.now() + 3600_000).toISOString() }), /date/)
  assert.throws(() => validatePlan({ ...plan, targets: [...plan.targets, ...plan.targets] }), /Duplicate/)
  assert.throws(() => validatePlan({ ...plan, targets: [{ ...plan.targets[0], region: 'asia-east2' }] }), /scope/)
})

test('zero-traffic staging rejects service names exceeding Cloud Run tag limits', () => {
  const service = fixture()
  service.name = service.name.replace('services/example', `services/${'x'.repeat(46)}`)
  assert.throws(() => recoveryBody(service, { name: service.latestCreatedRevision, containers: [{ image }] }, 'example'), /too long/)
})

test('explicit background startup-boost optimization preserves CPU, memory and all other resources', () => {
  const service = fixture()
  service.template.containers[0].resources.startupCpuBoost = true
  service.template.containers[0].resources.cpuIdle = true
  const revision = { name: service.latestCreatedRevision, containers: [{ image }] }
  assert.equal(recoveryBody(service, revision, 'example').template.containers[0].resources.startupCpuBoost, true)
  const resources = recoveryBody(service, revision, 'example', { disableStartupBoost: true }).template.containers[0].resources
  assert.deepEqual(resources, { ...service.template.containers[0].resources, startupCpuBoost: false })
  assert.equal(service.template.containers[0].resources.startupCpuBoost, true)
})

test('promotion requires the exact healthy image; retired, unready and concurrent revisions fail closed', () => {
  const service = fixture()
  service.latestReadyRevision = service.latestCreatedRevision
  const revision = { name: service.latestCreatedRevision, containers: [{ image }], conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }, { type: 'ContainerHealthy', state: 'CONDITION_SUCCEEDED' }] }
  assert.doesNotThrow(() => assertReadyForPromotion(service, revision, image))
  assert.equal(servingLatest(service), false, 'ready zero-traffic candidates are not yet live')
  assert.throws(() => assertReadyForPromotion(service, revision, 'another-image'), /digest/)
  assert.throws(() => assertReadyForPromotion(service, { ...revision, conditions: [] }, image), /health/)
  assert.throws(() => assertReadyForPromotion(service, { ...revision, conditions: [{ type: 'Ready', state: 'CONDITION_FAILED' }, revision.conditions[1]] }, image), /health/)
  assert.throws(() => assertReadyForPromotion(service, { ...revision, conditions: [...revision.conditions, { revisionReason: 'RETIRED' }] }, image), /health/)
  assert.throws(() => assertReadyForPromotion({ ...service, reconciling: true }, revision, image), /ready/)
  assert.throws(() => assertReadyForPromotion(fixture(), revision, image), /ready/)
})

const longId = 'rebuildoperationsdashboardaggregatesscheduled'
const oldImage = image.replace('a'.repeat(64), 'b'.repeat(64))
function longFixture() {
  const service = fixture()
  service.name = name.replace('services/example', `services/${longId}`)
  service.latestCreatedRevision = `${service.name}/revisions/${longId}-00002-bad`
  service.latestReadyRevision = `${service.name}/revisions/${longId}-00001-old`
  service.trafficStatuses = [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: `${longId}-00001-old`, percent: 100 }]
  service.traffic = structuredClone(service.trafficStatuses)
  service.template.scaling.minInstanceCount = 0
  service.scaling = { minInstanceCount: 0, maxInstanceCount: 3 }
  return service
}
function healthyRevision(service, revisionName, resolvedImage) {
  return { name: `${service.name}/revisions/${revisionName.split('/').at(-1)}`, containers: [{ image: resolvedImage }],
    conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }, { type: 'ContainerHealthy', state: 'CONDITION_SUCCEEDED' }],
  }
}

test('platform mode is explicit, restricted to long services, uniquely named and bounded', () => {
  for (const length of [44, 45, 47, 49]) {
    const id = 's'.repeat(length)
    const candidate = platformReadinessRevisionName(id, 'a'.repeat(32))
    assert.ok(candidate.startsWith(`${id}-prg-`))
    assert.ok(candidate.length <= 63)
    assert.notEqual(platformReadinessRevisionName(id), platformReadinessRevisionName(id))
  }
  assert.throws(() => platformReadinessRevisionName('short'), /only for long/)
  assert.throws(() => platformReadinessRevisionName('x'.repeat(50)), /only for long/)
  const service = longFixture()
  const revision = { name: service.latestCreatedRevision, containers: [{ image }] }
  assert.throws(() => recoveryBody(service, revision, 'example'), /too long/)
  assert.throws(() => recoveryBody(service, revision, 'example', { platformReadinessGate: true }), /candidate revision/)
  const shortService = fixture()
  assert.throws(() => recoveryBody(shortService, { ...revision, name: shortService.latestCreatedRevision }, 'example', { platformReadinessGate: true, candidateRevision: 'example-new' }), /long service/)
})

test('platform body explicitly enables startup gate and pins exact new revision preserving all other settings', () => {
  const service = longFixture()
  const original = structuredClone(service)
  const candidateRevision = platformReadinessRevisionName(service.name, 'c'.repeat(32))
  const body = recoveryBody(service, { name: service.latestCreatedRevision, containers: [{ image }] }, 'example', { platformReadinessGate: true, candidateRevision })
  assert.equal(body.template.healthCheckDisabled, false)
  assert.equal(body.template.revision, candidateRevision)
  assert.equal(body.etag, service.etag)
  assert.equal(body.template.containers[0].image, image)
  assert.deepEqual(body.template.containers[0].env, service.template.containers[0].env)
  assert.deepEqual(body.template.containers[0].resources, service.template.containers[0].resources)
  assert.deepEqual(body.traffic, [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: candidateRevision, percent: 100 }])
  assert.equal(body.template.scaling, undefined, 'scaling omitted from patch, never reset')
  assert.deepEqual(service, original)
  for (const patch of [{ scaling: { minInstanceCount: 1 } }, { scaling: { scalingMode: 'MANUAL', manualInstanceCount: 1 } }, { etag: '' }]) {
    assert.throws(() => recoveryBody({ ...service, ...patch }, { name: service.latestCreatedRevision, containers: [{ image }] }, 'example', { platformReadinessGate: true, candidateRevision }))
  }
  assert.throws(() => recoveryBody({ ...service, template: { ...service.template, scaling: { minInstanceCount: 1 } } }, { name: service.latestCreatedRevision, containers: [{ image }] }, 'example', { platformReadinessGate: true, candidateRevision }), /Warm/)
})

function platformHarness(mode = 'success') {
  const service = longFixture()
  const candidateRevision = platformReadinessRevisionName(service.name, 'd'.repeat(32))
  const previousRevision = service.latestReadyRevision.split('/').at(-1)
  const url = `https://run.googleapis.com/v2/${service.name}`
  let current = structuredClone(service)
  const previous = healthyRevision(service, previousRevision, oldImage)
  if (mode === 'bad-prior') previous.conditions = []
  const candidate = healthyRevision(service, candidateRevision, mode === 'wrong-image' ? oldImage : image)
  if (['unhealthy', 'rollback-uncertain', 'rollback-unhealthy'].includes(mode)) candidate.conditions[1].state = 'CONDITION_FAILED'
  const patches = []
  const records = []
  const api = async (request, options = {}) => {
    if (options.method === 'PATCH') {
      const body = JSON.parse(options.body)
      patches.push({ request, body })
      assert.equal(body.etag, current.etag)
      if (body.template) {
        assert.equal(body.template.healthCheckDisabled, false)
        if (mode === 'rejected') throw new Error('API 400: validation rejected')
        current = { ...current, etag: 'candidate-etag', latestCreatedRevision: candidate.name, traffic: body.traffic,
          terminalCondition: { state: mode === 'operation-failed' || mode === 'concurrent' ? 'CONDITION_FAILED' : 'CONDITION_SUCCEEDED' },
        }
        if (mode === 'ambiguous') {
          current.reconciling = true
          throw new Error('uncertain PATCH timeout')
        }
        if (mode === 'operation-failed') return { name: 'candidate-operation', done: true, error: { message: 'startup quota failed' } }
        if (mode === 'concurrent') {
          current.latestCreatedRevision = `${service.name}/revisions/${longId}-other`
          return { name: 'candidate-operation', done: true, error: { message: 'startup quota failed' } }
        }
        current.latestReadyRevision = candidate.name
        current.trafficStatuses = structuredClone(body.traffic)
        return { name: 'candidate-operation', done: true }
      }
      assert.equal(body.traffic[0].revision, previousRevision)
      assert.equal(body.traffic[0].percent, 100)
      if (mode === 'rollback-uncertain') throw new Error('rollback PATCH timeout')
      current.traffic = body.traffic
      current.trafficStatuses = structuredClone(body.traffic)
      current.etag = 'rollback-etag'
      current.terminalCondition = { state: 'CONDITION_SUCCEEDED' }
      if (mode === 'rollback-unhealthy') previous.conditions[1].state = 'CONDITION_FAILED'
      return { name: 'rollback-operation', done: true }
    }
    if (request === url) return structuredClone(current)
    if (request === `${url}/revisions/${previousRevision}`) return structuredClone(previous)
    if (request === `${url}/revisions/${candidateRevision}`) return structuredClone(candidate)
    throw new Error(`Unexpected API request ${request}`)
  }
  const operationDone = async (operation) => { if (operation.error) throw new Error(operation.error.message); return operation }
  const run = () => recoverWithPlatformReadiness({ api, operationDone, service, revision: { name: service.latestCreatedRevision, containers: [{ image }] }, functionName: 'example', candidateRevision, record: (entry) => records.push(entry) })
  return { run, service, candidateRevision, previousRevision, patches, records }
}

test('native platform success requires actual candidate health, image and exclusive traffic', async () => {
  const harness = platformHarness()
  const result = await harness.run()
  assert.equal(result.latestReadyRevision.split('/').at(-1), harness.candidateRevision)
  assert.equal(harness.patches.length, 1, 'platform mode has no later floating-latest promotion')
  assert.match(harness.patches[0].request, /template.healthCheckDisabled/)
  assert.equal(harness.records.at(-1).status, 'recovered')
  assert.equal(harness.records[0].previousImageDigest, oldImage.split('@')[1])
})

test('bad prior serving health fails before any platform mutation', async () => {
  const harness = platformHarness('bad-prior')
  await assert.rejects(harness.run(), /health/)
  assert.equal(harness.patches.length, 0)
})

test('failed native startup restores exact old traffic intent and verifies it, never claiming recovery', async () => {
  const harness = platformHarness('operation-failed')
  await assert.rejects(harness.run(), /startup quota failed/)
  assert.equal(harness.patches.length, 2)
  assert.equal(harness.records.at(-1).status, 'platform_rolled_back')
  assert.equal(harness.records.some((entry) => entry.status === 'recovered'), false)
  assert.equal(harness.patches[1].body.etag, 'candidate-etag')
})

test('unhealthy or wrong-image candidate is never accepted, even when service metadata says ready', async () => {
  for (const mode of ['unhealthy', 'wrong-image']) {
    const harness = platformHarness(mode)
    await assert.rejects(harness.run(), /health|digest/)
    assert.equal(harness.patches.length, 2)
    assert.equal(harness.records.at(-1).status, 'platform_rolled_back')
    assert.equal(harness.records.some((entry) => entry.status === 'recovered'), false)
  }
})

test('uncertain or concurrent platform operations stop without a blind rollback or PATCH retry', async () => {
  for (const mode of ['ambiguous', 'concurrent']) {
    const harness = platformHarness(mode)
    await assert.rejects(harness.run(), /rollback not verified/)
    assert.equal(harness.patches.length, 1)
    assert.equal(harness.records.at(-1).status, 'platform_needs_review')
  }
})

test('a rejected platform PATCH confirms original healthy traffic without writing a rollback', async () => {
  const harness = platformHarness('rejected')
  await assert.rejects(harness.run(), /validation rejected/)
  assert.equal(harness.patches.length, 1)
  assert.equal(harness.records.at(-1).status, 'platform_failed_prior_preserved')
  assert.equal(harness.records.some((entry) => entry.status === 'recovered'), false)
})

test('failed rollback or unhealthy restored container requires review without retrying writes', async () => {
  for (const mode of ['rollback-uncertain', 'rollback-unhealthy']) {
    const harness = platformHarness(mode)
    await assert.rejects(harness.run(), /rollback not verified/)
    assert.equal(harness.patches.length, 2)
    assert.equal(harness.records.at(-1).status, 'platform_needs_review')
    assert.equal(harness.records.some((entry) => entry.status === 'recovered' || entry.status === 'platform_rolled_back'), false)
  }
})

test('CLI platform flag requires an explicit function selection before auth or any API access', () => {
  const { spawnSync } = require('node:child_process')
  const result = spawnSync(process.execPath, [require.resolve('./recover-function-revisions.cjs'), '--apply', '--platform-readiness-gate'], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /requires explicit --functions/)
  assert.equal(result.stdout, '')
})

test('rollback only targets captured prior revision and refuses custom or concurrent traffic', () => {
  const service = longFixture()
  const candidateRevision = platformReadinessRevisionName(service.name, 'e'.repeat(32))
  const previousRevision = service.latestReadyRevision.split('/').at(-1)
  const proof = { serviceName: service.name, candidateRevision, previousRevision }
  const current = { ...service, latestCreatedRevision: `${service.name}/revisions/${candidateRevision}`, traffic: [{ revision: candidateRevision, percent: 100 }] }
  assert.equal(platformRollbackBody(current, proof).traffic[0].revision, previousRevision)
  for (const patch of [{ reconciling: true }, { etag: '' }, { latestCreatedRevision: `${service.name}/revisions/other` }, { traffic: [{ revision: candidateRevision, percent: 50 }, { revision: previousRevision, percent: 50 }] }, { trafficStatuses: [{ revision: 'other', percent: 100 }] }]) {
    assert.throws(() => platformRollbackBody({ ...current, ...patch }, proof))
  }
  const prior = healthyRevision(service, previousRevision, oldImage)
  assert.doesNotThrow(() => assertHealthyServingRevision(service, prior, oldImage, previousRevision))
  assert.throws(() => assertHealthyServingRevision({ ...service, trafficStatuses: [...service.trafficStatuses, { revision: candidateRevision, percent: 0, tag: 'extra' }] }, prior, oldImage, previousRevision), /100 percent/)
})
