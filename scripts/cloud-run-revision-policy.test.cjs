'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { assertHealthyRevision, servesRevision } = require('./cloud-run-revision-policy.cjs')
const { promoteLatest } = require('./cloud-run-functions-promote-latest.cjs')
const { serviceHealth } = require('./cloud-run-functions-health.cjs')
const name = 'projects/gen-lang-client-0815966909/locations/asia-southeast1/services/example'
const image = `asia-southeast1-docker.pkg.dev/gen-lang-client-0815966909/gcf-artifacts/example@sha256:${'a'.repeat(64)}`
function fixture() {
  const service = { name, etag: 'etag', latestCreatedRevision: `${name}/revisions/example-2`, latestReadyRevision: `${name}/revisions/example-2`, trafficStatuses: [{ revision: 'example-2', percent: 100 }] }
  const revision = { name: service.latestCreatedRevision, containers: [{ image }], conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }, { type: 'ContainerHealthy', state: 'CONDITION_SUCCEEDED' }] }
  return { service, revision }
}
test('requires actual healthy immutable revision and effective traffic, not intent', () => {
  const { service, revision } = fixture()
  assert.doesNotThrow(() => assertHealthyRevision(service, revision, { requireServing: true }))
  assert.equal(servesRevision({ ...service, trafficStatuses: [], traffic: service.trafficStatuses }, revision.name), false)
  assert.throws(() => assertHealthyRevision(service, { ...revision, conditions: [revision.conditions[0]] }), /health/)
  assert.throws(() => assertHealthyRevision(service, { ...revision, containers: [{ image: 'mutable:latest' }] }), /immutable/)
  assert.throws(() => assertHealthyRevision(service, revision, { expectedRevision: 'example-3' }), /Concurrent/)
  assert.throws(() => assertHealthyRevision(service, revision, { expectedImage: image.replace(/a/g, 'b') }), /digest/)
  assert.throws(() => assertHealthyRevision({ ...service, reconciling: true }, revision), /ready/)
})
test('health reads actual container even when created and ready match', async () => {
  const { service, revision } = fixture()
  let reads = 0
  const failed = await serviceHealth(service, async () => { reads++; return { ...revision, conditions: [{ type: 'Ready', state: 'CONDITION_SUCCEEDED' }, { type: 'ContainerHealthy', state: 'CONDITION_FAILED' }] } })
  assert.equal(reads, 1)
  assert.equal(failed.ready, false)
  const good = await serviceHealth(service, async () => revision)
  assert.equal(good.ready, true)
})
test('promotion refuses unhealthy candidate before any mutation', async () => {
  const { service, revision } = fixture()
  let mutations = 0
  await assert.rejects(promoteLatest('gen-lang-client-0815966909', 'asia-southeast1', 'example', {}, {
    request: async (url, headers, options = {}) => {
      if (options.method) mutations++
      return url.includes('/revisions/') ? { ...revision, conditions: [] } : service
    },
  }), /health/)
  assert.equal(mutations, 0)
})
test('promotion pins only checked revision with etag, then verifies live image', async () => {
  const { service, revision } = fixture()
  let promoted = false
  let patch
  const result = await promoteLatest('gen-lang-client-0815966909', 'asia-southeast1', 'example', {}, {
    pause: async () => {},
    request: async (url, headers, options = {}) => {
      if (options.method) { patch = JSON.parse(options.body); promoted = true; assert.match(url, /updateMask=traffic/); return { done: true } }
      if (url.includes('/revisions/')) return revision
      return promoted ? service : { ...service, trafficStatuses: [{ revision: 'example-1', percent: 100 }] }
    },
  })
  assert.equal(result, 'example-2')
  assert.deepEqual(patch, { name, etag: 'etag', traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: 'example-2', percent: 100 }] })
})
test('concurrent deploy during promotion is not silently accepted', async () => {
  const { service, revision } = fixture()
  let serviceReads = 0
  await assert.rejects(promoteLatest('gen-lang-client-0815966909', 'asia-southeast1', 'example', {}, {
    request: async (url) => url.includes('/revisions/') ? revision : ++serviceReads === 1 ? service : { ...service, latestCreatedRevision: `${name}/revisions/example-3` },
  }), /Concurrent/)
})
test('uncertain traffic mutation is not automatically retried', async () => {
  const { service, revision } = fixture()
  let mutations = 0
  await assert.rejects(promoteLatest('gen-lang-client-0815966909', 'asia-southeast1', 'example', {}, {
    request: async (url, headers, options = {}) => {
      if (options.method) { mutations++; throw new Error('network outcome unknown') }
      return url.includes('/revisions/') ? revision : { ...service, trafficStatuses: [{ revision: 'example-1', percent: 100 }] }
    },
  }), /unknown/)
  assert.equal(mutations, 1)
})
