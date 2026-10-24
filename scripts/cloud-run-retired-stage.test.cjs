'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { stageRetiredCandidate } = require('./cloud-run-retired-stage.cjs')
const { promoteLatest } = require('./cloud-run-functions-promote-latest.cjs')
const name = 'projects/gen-lang-client-0815966909/locations/asia-southeast1/services/example'
const image = `asia-southeast1-docker.pkg.dev/gen-lang-client-0815966909/gcf-artifacts/example@sha256:${'a'.repeat(64)}`
const nonce = '123456abcdef', candidate = `example-stg-${nonce}`
function fixture() {
  const service = {
    name, etag: 'before', latestCreatedRevision: `${name}/revisions/example-2`, latestReadyRevision: `${name}/revisions/example-1`,
    traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: 'example-1', percent: 100 }],
    trafficStatuses: [{ revision: 'example-1', percent: 100 }],
    template: { containers: [{ image: 'build:mutable', env: [{ name: 'FUNCTION_TARGET', value: 'exampleFunction' }], resources: { cpuIdle: true, startupCpuBoost: true } }] },
  }
  const revision = { name: service.latestCreatedRevision, containers: [{ image }], conditions: [
    { type: 'Ready', state: 'CONDITION_SUCCEEDED', revisionReason: 'RETIRED' },
    { type: 'Active', state: 'CONDITION_FAILED', revisionReason: 'RETIRED' },
    { type: 'ContainerReady', state: 'CONDITION_SUCCEEDED' },
  ] }
  const previous = { name: service.latestReadyRevision, containers: [{ image }], conditions: [
    { type: 'Ready', state: 'CONDITION_SUCCEEDED' }, { type: 'ContainerHealthy', state: 'CONDITION_SUCCEEDED' },
  ] }
  return { service, revision, previous }
}
function harness({ changeLive = () => {}, changeReady = () => {}, changeOperation = () => {} } = {}) {
  const state = fixture(), calls = []
  let body, live, ready, promoted = false
  const request = async (url, headers, options = {}) => {
    calls.push({ url, method: options.method || 'GET' })
    if (options.method === 'PATCH') {
      assert.equal(body, undefined, 'never repeat an uncertain staging mutation')
      body = JSON.parse(options.body)
      live = { ...state.service, etag: 'staged', latestCreatedRevision: `${name}/revisions/${body.template.revision}`, latestReadyRevision: `${name}/revisions/${body.template.revision}`, traffic: body.traffic }
      ready = { ...state.previous, name: live.latestCreatedRevision }
      changeLive(live); changeReady(ready)
      const operation = { name: name.split('/services/')[0] + '/operations/stage-1', done: true, response: live }
      changeOperation(operation)
      return operation
    }
    if (options.method === 'PUT') {
      const target = JSON.parse(options.body).spec.traffic
      assert.deepEqual(target, [{ revisionName: body.template.revision, percent: 100 }])
      promoted = true
      return {}
    }
    if (url.includes('/apis/serving.knative.dev/')) return {
      apiVersion: 'serving.knative.dev/v1', kind: 'Service', metadata: { name: 'example', resourceVersion: 'v1-guard', generation: 3 },
      spec: { template: { metadata: { name: body.template.revision }, spec: { containers: [{ image }] } }, traffic: [] },
      status: { latestCreatedRevisionName: body.template.revision, latestReadyRevisionName: body.template.revision, observedGeneration: 3 },
    }
    if (url === 'https://run.googleapis.com/v2/' + state.previous.name) return state.previous
    if (url === 'https://run.googleapis.com/v2/' + state.revision.name) return state.revision
    if (ready && url === 'https://run.googleapis.com/v2/' + ready.name) return ready
    if (url === 'https://run.googleapis.com/v2/' + name) return !live ? state.service : promoted ? {
      ...live, traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: body.template.revision, percent: 100 }],
      trafficStatuses: [{ revision: body.template.revision, percent: 100 }],
    } : live
    throw Error('Unexpected request')
  }
  return { state, request, calls, body: () => body, options: { request, pause: async () => {}, nonce, expectedRevision: 'example-2', expectedImage: image } }
}

test('retired staging pins the same image, preserves old traffic and requires real container health', async () => {
  const h = harness(), before = structuredClone(h.state.service)
  const result = await stageRetiredCandidate(h.state.service, h.state.revision, {}, h.options)
  assert.equal(result.expectedRevision, candidate)
  assert.equal(result.expectedImage, image)
  assert.deepEqual(h.body().traffic, [before.traffic[0], { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: candidate, percent: 0, tag: 'rvc' }])
  assert.equal(h.body().template.containers[0].image, image)
  assert.deepEqual(h.body().template.containers[0].resources, before.template.containers[0].resources)
  assert.equal(h.body().template.healthCheckDisabled, false)
  assert.equal(h.body().etag, 'before')
  assert.deepEqual(h.state.service, before)
  assert.equal(h.calls.filter(call => call.method !== 'GET').length, 1)
  assert.ok(h.calls.every(call => call.url.startsWith('https://run.googleapis.com/v2/')))
})

test('staging refuses unsafe candidates before any mutation', async t => {
  const cases = [
    ['missing etag', s => { delete s.service.etag }, /stable earlier/],
    ['concurrent revision', s => { s.revision.name += '-other' }, /stable earlier/],
    ['reconciling', s => { s.service.reconciling = true }, /stable earlier/],
    ['non-retired', s => { s.revision.conditions = [] }, /retired/],
    ['container crash', s => { s.revision.conditions.push({ type: 'ContainerHealthy', state: 'CONDITION_FAILED' }) }, /startup failure/],
    ['image not imported', s => { s.revision.conditions.pop() }, /startup failure/],
    ['image mismatch', s => { s.revision.containers[0].image += '-other' }, /approved image/],
    ['floating traffic', s => { s.service.traffic[0].type = 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST' }, /exact previous/],
    ['custom tags', s => { s.service.traffic.push({ revision: 'example-3', percent: 0, tag: 'other' }) }, /no existing tags/],
    ['effective traffic split', s => { s.service.trafficStatuses = [{ revision: 'example-1', percent: 90 }, { revision: 'example-2', percent: 10 }] }, /100 percent|ambiguous/],
    ['manual scaling', s => { s.service.scaling = { scalingMode: 'MANUAL' } }, /Manual scaling/],
    ['warm floor', s => { s.service.template.scaling = { minInstanceCount: 1 } }, /Warm floor/],
    ['previous retired', s => { s.previous.conditions.push({ revisionReason: 'RETIRED' }) }, /health/],
    ['previous warm floor', s => { s.previous.scaling = { minInstanceCount: 1 } }, /warm floor/],
    ['entrypoint missing', s => { s.service.template.containers[0].env = [] }, /entrypoint/],
  ]
  for (const [label, mutate, message] of cases) await t.test(label, async () => {
    const h = harness(); mutate(h.state)
    await assert.rejects(stageRetiredCandidate(h.state.service, h.state.revision, {}, h.options), message)
    assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0)
  })
})

test('staging rejects expected-revision conflicts and unsupported long service names', async () => {
  const h = harness()
  await assert.rejects(stageRetiredCandidate(h.state.service, h.state.revision, {}, { ...h.options, expectedRevision: 'example-3' }), /Concurrent release/)
  const longName = 'x'.repeat(44), resource = name.replace(/example$/, longName)
  const replace = value => JSON.parse(JSON.stringify(value).replaceAll(name, resource).replaceAll('example-1', longName + '-1').replaceAll('example-2', longName + '-2'))
  await assert.rejects(stageRetiredCandidate(replace(h.state.service), replace(h.state.revision), {}, { ...h.options, expectedRevision: longName + '-2' }), /too long/)
  assert.equal(h.calls.length, 0)
})

test('pending operations have a finite wait and cannot switch operation identities', async t => {
  for (const switchIdentity of [false, true]) await t.test(switchIdentity ? 'different operation' : 'still pending', async () => {
    const h = harness({ changeOperation: o => { o.done = false; delete o.response } })
    let polls = 0, pauses = 0
    const request = async (url, ...args) => {
      if (url.includes('/operations/')) { polls++; return { name: name.split('/services/')[0] + '/operations/' + (switchIdentity ? 'someone-else' : 'stage-1'), done: false } }
      return h.request(url, ...args)
    }
    await assert.rejects(stageRetiredCandidate(h.state.service, h.state.revision, {}, { ...h.options, request, pause: async () => { pauses++ } }), switchIdentity ? /operation identity/ : /still pending/)
    assert.equal(polls, switchIdentity ? 1 : 240)
    assert.equal(pauses, polls)
    assert.equal(h.calls.filter(c => c.method !== 'GET').length, 1)
  })
})

test('staging never treats operation completion, changed image or traffic as health proof', async t => {
  const cases = [
    ['operation failure', { changeOperation: o => { o.error = { code: 13 } } }, /Staging failed/],
    ['wrong operation', { changeOperation: o => { o.name = 'projects/other/locations/other/operations/1' } }, /operation identity/],
    ['wrong operation output', { changeOperation: o => { o.response = { name } } }, /exact candidate/],
    ['candidate crash', { changeReady: r => { r.conditions[1] = { type: 'ContainerHealthy', state: 'CONDITION_FAILED' } } }, /health/],
    ['wrong image', { changeReady: r => { r.containers = [{ image: image.replace(/a{64}/, 'b'.repeat(64)) }] } }, /digest/],
    ['unexpected traffic', { changeLive: s => { s.trafficStatuses = [{ revision: candidate, percent: 100 }] } }, /preserves/],
    ['floating stage', { changeLive: s => { s.traffic = [s.traffic[0], { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', tag: 'rvc' }] } }, /preserves/],
  ]
  for (const [label, setup, message] of cases) await t.test(label, async () => {
    const h = harness(setup)
    await assert.rejects(stageRetiredCandidate(h.state.service, h.state.revision, {}, h.options), message)
    assert.equal(h.calls.filter(call => call.method !== 'GET').length, 1)
    assert.equal(h.calls.some(call => call.method === 'PUT'), false)
  })
})

test('an uncertain staging response is never retried or followed by promotion', async () => {
  const h = harness(); let writes = 0
  const request = async (...args) => {
    if (args[2]?.method) { writes++; throw Error('Connection timed out') }
    return h.request(...args)
  }
  await assert.rejects(stageRetiredCandidate(h.state.service, h.state.revision, {}, { ...h.options, request }), /timed out/)
  assert.equal(writes, 1)
})

test('normal promotion explicitly opts into staging and retains the v1 health and traffic gates', async () => {
  const h = harness()
  await assert.rejects(promoteLatest('gen-lang-client-0815966909', 'asia-southeast1', 'example', {}, { request: h.request, pause: async () => {} }), /not ready/)
  assert.equal(h.calls.some(call => call.method !== 'GET'), false)
  const result = await promoteLatest('gen-lang-client-0815966909', 'asia-southeast1', 'example', {}, { request: h.request, pause: async () => {}, stageRetired: true, trafficApi: 'v1', expectedRevision: 'example-2', expectedImage: image })
  assert.equal(result, h.body().template.revision)
  assert.deepEqual(h.calls.filter(call => call.method !== 'GET').map(call => call.method), ['PATCH', 'PUT'])
})
