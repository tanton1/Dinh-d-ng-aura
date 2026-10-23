'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { latestReady, servingLatest, assertReadyForPromotion, pinnedTraffic, recoveryBody, validatePlan } = require('./recover-function-revisions.cjs')
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
