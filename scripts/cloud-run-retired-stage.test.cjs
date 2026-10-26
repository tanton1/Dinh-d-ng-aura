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
function harness({ changeLive = () => {}, changeReady = () => {}, changeOperation = () => {}, promotionError, changePromoted = () => {} } = {}) {
  const state = fixture(), calls = []
  let body, live, ready, promoted = false
  const request = async (url, headers, options = {}) => {
    calls.push({ url, method: options.method || 'GET' })
    if (options.method === 'PATCH' && new URL(url).searchParams.get('updateMask') === 'traffic') {
      const promotion = JSON.parse(options.body)
      assert.deepEqual(promotion, { name, etag: live.etag, traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: body.template.revision, percent: 100 }] })
      assert.equal(new URL(url).searchParams.has('forceNewRevision'), false)
      if (promotionError) throw Error(promotionError)
      promoted = true
      return { name: name.split('/services/')[0] + '/operations/promote-1', done: true }
    }
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
    if (url === 'https://run.googleapis.com/v2/' + name) {
      if (!live) return state.service
      if (!promoted) return live
      const current = { ...live, traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: body.template.revision, percent: 100 }],
        trafficStatuses: [{ revision: body.template.revision, percent: 100 }] }
      changePromoted(current)
      return current
    }
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

test('v2 staging promotes through v2 without a conflicting v1 template conversion', async () => {
  const h = harness()
  await assert.rejects(promoteLatest('gen-lang-client-0815966909', 'asia-southeast1', 'example', {}, { request: h.request, pause: async () => {} }), /not ready/)
  assert.equal(h.calls.some(call => call.method !== 'GET'), false)
  const result = await promoteLatest('gen-lang-client-0815966909', 'asia-southeast1', 'example', {}, { request: h.request, pause: async () => {}, stageRetired: true, trafficApi: 'v1', expectedRevision: 'example-2', expectedImage: image })
  assert.equal(result, h.body().template.revision)
  assert.deepEqual(h.calls.filter(call => call.method !== 'GET').map(call => call.method), ['PATCH', 'PATCH'])
  assert.ok(h.calls.every(call => !call.url.includes('/apis/serving.knative.dev/')), 'staged templates never cross the v1 conversion boundary')
})

test('staged promotion never retries an uncertain v2 mutation or falls back to v1', async t => {
  for (const reason of ['network outcome unknown', 'Cloud Run 409: etag conflict', 'Cloud Run 429: throttled']) await t.test(reason, async () => {
    const h = harness({ promotionError: reason })
    await assert.rejects(promoteLatest('gen-lang-client-0815966909', 'asia-southeast1', 'example', {}, { request: h.request, pause: async () => {}, stageRetired: true, trafficApi: 'v1' }), error => error.message === reason)
    assert.deepEqual(h.calls.filter(call => call.method !== 'GET').map(call => call.method), ['PATCH', 'PATCH'])
    assert.ok(h.calls.every(call => !call.url.includes('/apis/serving.knative.dev/')))
  })
})

test('v2 staging retains exact effective traffic and concurrent-release checks', async t => {
  for (const [label, mutate, message] of [
    ['traffic is not effective', value => { value.trafficStatuses = [{ revision: 'example-1', percent: 100 }] }, /100%/],
    ['candidate changed', value => { value.latestCreatedRevision = name + '/revisions/example-other' }, /Concurrent/],
    ['floating intent', value => { value.traffic = [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST', percent: 100 }] }, /pinned traffic/],
  ]) await t.test(label, async () => {
    const h = harness({ changePromoted: mutate })
    await assert.rejects(promoteLatest('gen-lang-client-0815966909', 'asia-southeast1', 'example', {}, { request: h.request, pause: async () => {}, stageRetired: true, trafficApi: 'v1' }), message)
    assert.deepEqual(h.calls.filter(call => call.method !== 'GET').map(call => call.method), ['PATCH', 'PATCH'])
  })
})

function platformHarness({ changeReady = () => {}, changeLive = () => {}, operationFailure = false, pending = false, switchOperation = false } = {}) {
  const serviceId = 'rebuildoperationsdashboardaggregatesscheduled'
  const resource = name.replace(/example$/, serviceId)
  const replace = value => JSON.parse(JSON.stringify(value).replaceAll(name, resource).replaceAll('example-1', serviceId + '-1').replaceAll('example-2', serviceId + '-2'))
  const state = replace(fixture()), calls = [], records = []
  state.previous.containers[0].image = image.replace(/a{64}/, 'b'.repeat(64))
  let live, ready, body, polls = 0
  const request = async (url, headers, options = {}) => {
    calls.push({ url, method: options.method || 'GET' })
    if (options.method === 'PATCH') {
      const payload = JSON.parse(options.body)
      if (new URL(url).searchParams.get('updateMask') === 'traffic') {
        assert.deepEqual(payload.traffic, state.service.traffic, 'rollback is limited to captured old traffic')
        live = { ...live, etag: 'restored', latestReadyRevision: state.previous.name, traffic: payload.traffic, trafficStatuses: payload.traffic }
        return { name: resource.split('/services/')[0] + '/operations/rollback', done: true, response: structuredClone(live) }
      }
      assert.equal(body, undefined, 'an uncertain template change is never retried')
      body = payload
      live = { ...state.service, etag: 'candidate', latestCreatedRevision: `${resource}/revisions/${body.template.revision}`,
        latestReadyRevision: `${resource}/revisions/${body.template.revision}`, traffic: body.traffic, trafficStatuses: body.traffic }
      ready = { name: live.latestCreatedRevision, containers: [{ image }], conditions: structuredClone(state.previous.conditions) }
      changeLive(live); changeReady(ready)
      if (operationFailure || pending) {
        live.latestReadyRevision = state.previous.name
        live.trafficStatuses = state.service.trafficStatuses
      }
      if (pending) live.reconciling = true
      return { name: resource.split('/services/')[0] + '/operations/platform', done: !pending,
        ...(operationFailure ? { error: { code: 13 } } : {}), response: structuredClone(live) }
    }
    if (url.includes('/operations/')) {
      polls++
      return { name: resource.split('/services/')[0] + '/operations/' + (switchOperation ? 'other' : 'platform'), done: false }
    }
    if (url === 'https://run.googleapis.com/v2/' + state.previous.name) return state.previous
    if (url === 'https://run.googleapis.com/v2/' + state.revision.name) return state.revision
    if (ready && url === 'https://run.googleapis.com/v2/' + ready.name) return ready
    if (url === 'https://run.googleapis.com/v2/' + resource) return live || state.service
    throw Error('Unexpected platform request')
  }
  return { serviceId, state, calls, records, body: () => body, polls: () => polls,
    options: { request, pause: async () => {}, stageRetired: true, platformReadinessGate: true, trafficApi: 'v1',
      expectedRevision: serviceId + '-2', expectedImage: image, log: value => records.push(value) } }
}

test('explicit long-name promotion reuses native readiness and never creates a conflicting second traffic update', async () => {
  const h = platformHarness()
  const revision = await promoteLatest('gen-lang-client-0815966909', 'asia-southeast1', h.serviceId, {}, h.options)
  assert.equal(revision, h.body().template.revision)
  assert.match(revision, new RegExp('^' + h.serviceId + '-prg-[a-f0-9]{12}$'))
  assert.ok(revision.length <= 63)
  assert.equal(h.body().template.healthCheckDisabled, false)
  assert.equal(h.body().template.containers[0].image, image)
  assert.deepEqual(h.body().template.containers[0].resources, h.state.service.template.containers[0].resources)
  assert.deepEqual(h.body().traffic, [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision, percent: 100 }])
  assert.equal(h.calls.filter(row => row.method !== 'GET').length, 1)
  assert.ok(h.calls.every(row => !row.url.includes('/apis/serving.knative.dev/')))
  assert.deepEqual(h.records.map(row => row.status), ['platform_started', 'platform_operation', 'recovered'])
})

test('long-name promotion stays opt-in and rejects unsafe scope or candidates before mutation', async t => {
  const cases = [
    ['no explicit opt-in', h => { h.options.platformReadinessGate = false }, /too long/],
    ['no retired staging', h => { h.options.stageRetired = false }, /requires --stage-retired/],
    ['expected revision changed', h => { h.options.expectedRevision += '-other' }, /Concurrent release/],
    ['expected image changed', h => { h.options.expectedImage += '-other' }, /approved image/],
    ['old container unhealthy', h => { h.state.previous.conditions[1].state = 'CONDITION_FAILED' }, /health/],
    ['new container failed', h => { h.state.revision.conditions.push({ type: 'ContainerHealthy', state: 'CONDITION_FAILED' }) }, /startup failure/],
    ['custom traffic', h => { h.state.service.traffic.push({ tag: 'someone-else' }) }, /exact previous/],
  ]
  for (const [label, mutate, message] of cases) await t.test(label, async () => {
    const h = platformHarness(); mutate(h)
    await assert.rejects(promoteLatest('gen-lang-client-0815966909', 'asia-southeast1', h.serviceId, {}, h.options), message)
    assert.equal(h.calls.some(row => row.method !== 'GET'), false)
  })
})

test('failed native startup, wrong image and false healthy metadata restore old traffic without reporting success', async t => {
  for (const [label, options, message] of [
    ['operation failed', { operationFailure: true }, /startup failed/],
    ['container failed', { changeReady: r => { r.conditions[1].state = 'CONDITION_FAILED' } }, /health/],
    ['image differs', { changeReady: r => { r.containers[0].image = image.replace(/a{64}/, 'c'.repeat(64)) } }, /digest/],
  ]) await t.test(label, async () => {
    const h = platformHarness(options)
    await assert.rejects(promoteLatest('gen-lang-client-0815966909', 'asia-southeast1', h.serviceId, {}, h.options), message)
    assert.equal(h.calls.filter(row => row.method !== 'GET').length, 2, 'one creation and one verified rollback')
    assert.equal(h.records.some(row => row.status === 'recovered'), false)
    assert.equal(h.records.at(-1).status, 'platform_rolled_back')
  })
})

test('pending or switched native operations are bounded and never retried or overwritten while reconciling', async t => {
  for (const switchOperation of [false, true]) await t.test(switchOperation ? 'operation changed' : 'still pending', async () => {
    const h = platformHarness({ pending: true, switchOperation })
    await assert.rejects(promoteLatest('gen-lang-client-0815966909', 'asia-southeast1', h.serviceId, {}, h.options), switchOperation ? /operation identity/ : /still pending/)
    assert.equal(h.polls(), switchOperation ? 1 : 240)
    assert.equal(h.calls.filter(row => row.method !== 'GET').length, 1)
    assert.equal(h.records.at(-1).status, 'platform_needs_review')
  })
})

test('native promotion never overwrites a concurrent revision during recovery', async () => {
  const h = platformHarness({ changeLive: s => { s.latestCreatedRevision += '-someone-else' } })
  await assert.rejects(promoteLatest('gen-lang-client-0815966909', 'asia-southeast1', h.serviceId, {}, h.options), /exact candidate/)
  assert.equal(h.calls.filter(row => row.method !== 'GET').length, 1)
  assert.equal(h.records.at(-1).status, 'platform_needs_review')
})

test('platform CLI scope is checked before credentials or API access', () => {
  const { spawnSync } = require('node:child_process')
  for (const args of [[], ['--stage-retired'], ['--stage-retired', '--functions=' + 'x'.repeat(44) + ',' + 'y'.repeat(44)]]) {
    const result = spawnSync(process.execPath, [require.resolve('./cloud-run-functions-promote-latest.cjs'),
      '--confirm=gen-lang-client-0815966909/asia-southeast1', '--platform-readiness-gate', ...args,
      ...(args.some(arg => arg.startsWith('--functions=')) ? [] : ['--functions=example'])], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Platform readiness gate requires/)
  }
})
