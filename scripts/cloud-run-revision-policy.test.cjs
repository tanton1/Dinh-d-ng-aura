'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { assertHealthyRevision, servesRevision } = require('./cloud-run-revision-policy.cjs')
const { promoteLatest } = require('./cloud-run-functions-promote-latest.cjs')
const { serviceHealth } = require('./cloud-run-functions-health.cjs')
const name = 'projects/gen-lang-client-0815966909/locations/asia-southeast1/services/example'
const image = `asia-southeast1-docker.pkg.dev/gen-lang-client-0815966909/gcf-artifacts/example@sha256:${'a'.repeat(64)}`
function fixture() {
  const service = { name, etag: 'etag', latestCreatedRevision: `${name}/revisions/example-2`, latestReadyRevision: `${name}/revisions/example-2`, traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: 'example-2', percent: 100 }], trafficStatuses: [{ revision: 'example-2', percent: 100 }] }
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

test('floating latest is pinned even when the checked revision already serves all traffic', async () => {
  const { service, revision } = fixture()
  let patch
  await promoteLatest('gen-lang-client-0815966909', 'asia-southeast1', 'example', {}, {
    request: async (url, headers, options = {}) => {
      if (options.method) { patch = JSON.parse(options.body); return { done: true } }
      if (url.includes('/revisions/')) return revision
      return patch ? service : { ...service, traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }] }
    },
  })
  assert.deepEqual(patch.traffic, service.traffic)
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

function v1Fixture() {
  return {
    apiVersion: 'serving.knative.dev/v1', kind: 'Service',
    metadata: { name: 'example', namespace: '123456789', resourceVersion: 'opaque-resource-version', generation: 8,
      labels: { 'cloudfunctions.net/managed-by': 'cloudfunctions' }, annotations: { 'run.googleapis.com/ingress': 'all' } },
    spec: {
      template: {
        metadata: { name: 'example-2', annotations: { 'autoscaling.knative.dev/minScale': '0', 'run.googleapis.com/startup-cpu-boost': 'true' } },
        spec: { serviceAccountName: 'runtime@example.iam.gserviceaccount.com', containerConcurrency: 80,
          containers: [{ image, env: [{ name: 'EXAMPLE', value: 'preserved' }], resources: { limits: { cpu: '1', memory: '512Mi' } }, startupProbe: { tcpSocket: { port: 8080 } } }] },
      },
      traffic: [{ latestRevision: true, percent: 100 }],
    },
    status: { latestCreatedRevisionName: 'example-2', latestReadyRevisionName: 'example-2', observedGeneration: 8,
      conditions: [{ type: 'Ready', status: 'True' }], traffic: [{ revisionName: 'example-2', percent: 100 }] },
  }
}

test('explicit v1 promotion preserves the fresh full spec and resourceVersion, changes only traffic, and rechecks health', async () => {
  const { service, revision } = fixture()
  const v1 = v1Fixture()
  const original = structuredClone(v1)
  const calls = []
  let body
  const result = await promoteLatest('gen-lang-client-0815966909', 'asia-southeast1', 'example', {}, {
    trafficApi: 'v1', expectedRevision: 'example-2', expectedImage: image,
    request: async (url, headers, options = {}) => {
      calls.push([url, options.method || 'GET'])
      if (options.method) { assert.equal(options.method, 'PUT'); body = JSON.parse(options.body); return { ...v1, spec: body.spec } }
      if (url.includes('/revisions/')) return revision
      if (url.includes('/apis/serving.knative.dev/')) return v1
      return body ? service : { ...service, traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }] }
    },
  })
  assert.equal(result, 'example-2')
  const expected = structuredClone(v1)
  delete expected.status
  expected.spec.traffic = [{ revisionName: 'example-2', percent: 100 }]
  assert.deepEqual(body, expected)
  assert.deepEqual(v1, original, 'the source read is not modified in place')
  assert.equal(body.spec.template.metadata.annotations['autoscaling.knative.dev/minScale'], '0')
  assert.equal(calls.filter(([url]) => url.includes('/revisions/')).length, 3, 'initial, immediately before PUT, and actual post-promotion health')
  assert.deepEqual(calls.map(([url, method]) => `${url.includes('/revisions/') ? 'revision' : url.includes('/apis/') ? 'v1' : 'v2'}:${method}`),
    ['v2:GET', 'revision:GET', 'v1:GET', 'v2:GET', 'revision:GET', 'v1:PUT', 'v2:GET', 'revision:GET'])
  assert.match(calls.find(([, method]) => method === 'PUT')[0], /^https:\/\/asia-southeast1-run\.googleapis\.com\/apis\/serving\.knative\.dev\/v1\/namespaces\/gen-lang-client-0815966909\/services\/example$/)
})

test('v1 promotion fails closed on stale, unobserved, or unguarded full-service reads', async (t) => {
  for (const [label, mutate, message] of [
    ['missing resourceVersion', (value) => { delete value.metadata.resourceVersion }, /resourceVersion/],
    ['wrong service', (value) => { value.metadata.name = 'other' }, /identity/],
    ['missing full template', (value) => { delete value.spec.template }, /template/],
    ['different created revision', (value) => { value.status.latestCreatedRevisionName = 'example-3' }, /Concurrent/],
    ['candidate not ready', (value) => { value.status.latestReadyRevisionName = 'example-1' }, /Concurrent/],
    ['unobserved generation', (value) => { value.metadata.generation = 9 }, /unobserved/],
    ['missing generation', (value) => { delete value.status.observedGeneration }, /unobserved/],
  ]) {
    await t.test(label, async () => {
      const { service, revision } = fixture()
      const v1 = v1Fixture()
      mutate(v1)
      let mutations = 0
      await assert.rejects(promoteLatest('gen-lang-client-0815966909', 'asia-southeast1', 'example', {}, {
        trafficApi: 'v1', request: async (url, headers, options = {}) => {
          if (options.method) mutations++
          if (url.includes('/revisions/')) return revision
          if (url.includes('/apis/')) return v1
          return { ...service, traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }] }
        },
      }), message)
      assert.equal(mutations, 0)
    })
  }
})

test('v1 rechecks concurrency and actual container health after reading the guarded body', async (t) => {
  for (const [label, change, message] of [
    ['new etag', ({ service }) => { service.etag = 'changed' }, /Concurrent/],
    ['new created candidate', ({ service }) => { service.latestCreatedRevision = `${name}/revisions/example-3` }, /Concurrent/],
    ['reconciling', ({ service }) => { service.reconciling = true }, /ready/],
    ['container degraded', ({ revision }) => { revision.conditions[1].state = 'CONDITION_FAILED' }, /health/],
    ['image changed', ({ revision }) => { revision.containers[0].image = image.replace('a'.repeat(64), 'b'.repeat(64)) }, /digest/],
  ]) {
    await t.test(label, async () => {
      const initial = fixture()
      const fresh = structuredClone(initial)
      change(fresh)
      let fullRead = false
      let mutations = 0
      await assert.rejects(promoteLatest('gen-lang-client-0815966909', 'asia-southeast1', 'example', {}, {
        trafficApi: 'v1', request: async (url, headers, options = {}) => {
          if (options.method) mutations++
          if (url.includes('/apis/')) { fullRead = true; return v1Fixture() }
          const value = fullRead ? fresh : initial
          if (url.includes('/revisions/')) return value.revision
          return { ...value.service, traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }] }
        },
      }), message)
      assert.equal(mutations, 0)
    })
  }
})

test('v1 PUT acceptance alone is never reported as success without exact healthy effective traffic', async (t) => {
  for (const [label, change, message] of [
    ['floating intent', ({ service }) => { service.traffic = [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }] }, /pinned traffic/],
    ['new candidate', ({ service }) => { service.latestCreatedRevision = `${name}/revisions/example-3` }, /Concurrent/],
    ['not effective 100%', ({ service }) => { service.trafficStatuses = [{ revision: 'example-1', percent: 1 }, { revision: 'example-2', percent: 99 }] }, /100%/],
    ['container unhealthy', ({ revision }) => { revision.conditions[1].state = 'CONDITION_FAILED' }, /health/],
    ['image changed', ({ revision }) => { revision.containers[0].image = image.replace('a'.repeat(64), 'b'.repeat(64)) }, /digest/],
  ]) {
    await t.test(label, async () => {
      const initial = fixture()
      const live = structuredClone(initial)
      change(live)
      let mutations = 0
      await assert.rejects(promoteLatest('gen-lang-client-0815966909', 'asia-southeast1', 'example', {}, {
        trafficApi: 'v1', pause: async () => {}, request: async (url, headers, options = {}) => {
          if (options.method) { mutations++; return v1Fixture() }
          if (url.includes('/apis/')) return v1Fixture()
          if (url.includes('/revisions/')) return mutations ? live.revision : initial.revision
          return mutations ? live.service : { ...initial.service, traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }] }
        },
      }), message)
      assert.equal(mutations, 1)
    })
  }
})

test('v1 ambiguous or conflicting PUT is never retried or switched to another mutation API', async (t) => {
  for (const reason of ['network outcome unknown', 'Cloud Run 409: resourceVersion conflict', 'Cloud Run 429: throttled']) {
    await t.test(reason, async () => {
      const { service, revision } = fixture()
      let mutations = 0
      await assert.rejects(promoteLatest('gen-lang-client-0815966909', 'asia-southeast1', 'example', {}, {
        trafficApi: 'v1', request: async (url, headers, options = {}) => {
          if (options.method) { mutations++; assert.equal(options.method, 'PUT'); throw new Error(reason) }
          if (url.includes('/apis/')) return v1Fixture()
          return url.includes('/revisions/') ? revision : { ...service, traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }] }
        },
      }), (error) => error.message === reason)
      assert.equal(mutations, 1)
    })
  }
})

test('default v2 conflict does not silently fall back to v1', async () => {
  const { service, revision } = fixture()
  let mutations = 0
  await assert.rejects(promoteLatest('gen-lang-client-0815966909', 'asia-southeast1', 'example', {}, {
    request: async (url, headers, options = {}) => {
      assert.ok(!url.includes('/apis/'))
      if (options.method) { mutations++; assert.equal(options.method, 'PATCH'); throw new Error('Cloud Run 409: revision configuration conflict') }
      return url.includes('/revisions/') ? revision : { ...service, traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }] }
    },
  }), /409/)
  assert.equal(mutations, 1)
})

test('invalid traffic API is rejected before any request', async () => {
  let requests = 0
  await assert.rejects(promoteLatest('gen-lang-client-0815966909', 'asia-southeast1', 'example', {}, {
    trafficApi: 'auto', request: async () => { requests++ },
  }), /Traffic API/)
  assert.equal(requests, 0)
})
