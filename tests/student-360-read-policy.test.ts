import assert from 'node:assert/strict'
import test from 'node:test'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { canFailOverStudent360, readStudent360WithFailover, STUDENT360_READ_TIMEOUT_MS } from '../src/features/student-360/student360ReadPolicy'

test('Student 360 fails over only on explicit infrastructure errors', () => {
  for (const code of ['internal', 'unavailable', 'resource-exhausted', 'deadline-exceeded']) {
    assert.equal(canFailOverStudent360(new Error('friendly', { cause: { code: `functions/${code}` } })), true)
  }
  for (const code of ['not-found', 'permission-denied', 'unauthenticated', 'invalid-argument', 'failed-precondition', 'unknown']) {
    assert.equal(canFailOverStudent360({ code: `functions/${code}` }), false)
  }
  assert.equal(canFailOverStudent360(new Error('network problem')), false)
  assert.equal(STUDENT360_READ_TIMEOUT_MS, 12_000)
})

test('at most two total attempts, primary first, even if both regions fail', async () => {
  const calls: string[] = []
  const outage = { code: 'functions/unavailable' }
  await assert.rejects(readStudent360WithFailover(
    async () => { calls.push('primary'); throw outage },
    async () => { calls.push('overflow'); throw outage },
    async () => { calls.push('backoff') },
  ), (error) => error === outage)
  assert.deepEqual(calls, ['primary', 'backoff', 'overflow'])
})

test('successful primary and permission failures never call overflow', async () => {
  let overflowCalls = 0
  const overflow = async () => { overflowCalls++; return 2 }
  assert.equal(await readStudent360WithFailover(async () => 1, overflow), 1)
  const error = { code: 'functions/permission-denied' }
  await assert.rejects(readStudent360WithFailover(async () => { throw error }, overflow), (value) => value === error)
  assert.equal(overflowCalls, 0)
})

const bundledService = build({
  entryPoints: [resolve('src/features/student-360/student360Service.ts')],
  bundle: true, write: false, platform: 'node', format: 'cjs',
  plugins: [{ name: 'student360-routing-fixture', setup(builder) {
    builder.onResolve({ filter: /^(firebase\/functions|\.\.\/\.\.\/lib\/firebaseFunctions|\.\.\/\.\.\/services\/(readOnlyCallableService|clientTelemetryService))$/ },
      (args) => ({ path: args.path, namespace: 'student360-fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'student360-fixture' }, (args) => ({ loader: 'js', contents:
      args.path === 'firebase/functions'
        ? 'export const httpsCallable = (client, name, options) => async (input) => ({ data: await globalThis.routing.invoke(client, name, options, input, "write") })'
        : args.path.endsWith('firebaseFunctions')
          ? 'export const firebaseFunctions = { region: "asia-southeast1" }; export const firebaseStudent360Functions = globalThis.routing.east'
          : args.path.endsWith('readOnlyCallableService')
            ? 'export const callReadOnlyFunction = (name, input, options) => globalThis.routing.invoke(options.functionsClient || { region: "asia-southeast1" }, name, options, input, "read")'
            : 'export const createClientCorrelationId = () => `correlation-${++globalThis.routing.correlations}`',
    }))
  } }],
}).then((result) => result.outputFiles[0].text)

type TransportRequest = {
  region: string; name: string; input: unknown; kind: string
  options: { maximumAttempts?: number; correlationId?: string; timeoutMs?: number }
}
async function serviceFixture(errors: unknown[] = [], regional = true) {
  const requests: TransportRequest[] = []
  const module = { exports: {} as any }
  const routing = {
    east: regional ? { region: 'asia-east1' } : null, correlations: 0,
    invoke: async (client: { region: string }, name: string, options: TransportRequest['options'], input: unknown, kind: string) => {
      requests.push({ region: client.region, name, options, input, kind })
      const error = errors.shift()
      if (error) throw typeof error === 'string' ? { code: `functions/${error}`, message: error } : error
      return { ok: true }
    },
  }
  runInNewContext(await bundledService, {
    module, exports: module.exports, routing,
    setTimeout: (callback: () => void) => { callback(); return 1 },
  })
  return { service: module.exports, requests, routing }
}

const student360Reads = [
  { name: 'getStudent360Overview', args: ['student', '2026-10-19', true] },
  { name: 'listStudent360Directory', args: [{ query: 'student', branchId: 'branch', cursor: 'cursor', pageSize: 20 }] },
  { name: 'listStudent360Timeline', args: [{ studentId: 'student', types: ['session'], cursor: 123, pageSize: 20 }] },
  { name: 'getStudent360NutritionActivityDetail', args: [{ studentId: 'student', mealId: 'meal', reviewId: 'review' }] },
  { name: 'getStudent360ProgressPhotos', args: ['student', 'cursor'] },
  { name: 'getStudent360ContractWorkspace', args: ['student'] },
]

test('all six Student360 reads use East once and retain their input and retry budget', async () => {
  for (const { name, args } of student360Reads) {
    const { service, requests, routing } = await serviceFixture()
    await service[name](...args)
    assert.equal(requests.length, 1)
    assert.equal(requests[0].region, 'asia-east1')
    assert.equal(requests[0].name, `${name}Regional`)
    assert.equal(requests[0].options.maximumAttempts, 1)
    assert.equal(requests[0].options.timeoutMs, STUDENT360_READ_TIMEOUT_MS)
    assert.equal(requests[0].kind, 'read')
    if (typeof args[0] === 'object') assert.equal(requests[0].input, args[0])
    assert.equal(routing.correlations, 1)
  }
})

test('Student360 transient failures call East then Singapore once with one correlation and identical scope', async () => {
  for (const { name, args } of student360Reads) {
    for (const code of ['internal', 'unavailable', 'resource-exhausted', 'deadline-exceeded']) {
      const { service, requests, routing } = await serviceFixture([code])
      await service[name](...args)
      assert.deepEqual(requests.map(({ region, name }) => ({ region, name })), [
        { region: 'asia-east1', name: `${name}Regional` },
        { region: 'asia-southeast1', name },
      ])
      assert.equal(requests[0].input, requests[1].input)
      assert.ok(requests.every((request) => request.options.maximumAttempts === 1))
      assert.equal(requests[0].options.correlationId, requests[1].options.correlationId)
      assert.equal(routing.correlations, 1)
    }
  }
})

test('Student360 auth and business errors do not probe Singapore for any read', async () => {
  for (const { name, args } of student360Reads) {
    for (const code of ['unauthenticated', 'permission-denied', 'invalid-argument', 'failed-precondition', 'not-found', 'unknown', 'cancelled', 'aborted']) {
      const { service, requests } = await serviceFixture([code])
      await assert.rejects(service[name](...args))
      assert.equal(requests.length, 1)
      assert.equal(requests[0].region, 'asia-east1')
    }
  }
})

test('Student360 overview and contract reads preserve auth codes through friendly transport errors', async () => {
  for (const name of ['getStudent360Overview', 'getStudent360ContractWorkspace']) {
    for (const code of ['functions/permission-denied', 'permission-denied', 'functions/unauthenticated', 'unauthenticated']) {
      for (const wrapped of [false, true]) {
        const original = { code, message: 'Access revoked' }
        const transportError = wrapped ? new Error('Friendly transport failure', { cause: original }) : original
        const { service, requests } = await serviceFixture([transportError])
        await assert.rejects(service[name]('student'), (error: any) => {
          assert.equal(error.code, code, 'view can distinguish revocation from a recoverable read failure')
          assert.equal(error.cause, transportError)
          assert.equal(error.message, code.endsWith('unauthenticated')
            ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' : 'Access revoked')
          return true
        })
        assert.equal(requests.length, 1, 'auth rejection never tries a different region')
      }
    }
  }
})

test('Student360 friendly outage errors retain their transient code without becoming auth failures', async () => {
  const { service, requests } = await serviceFixture(['unavailable', 'deadline-exceeded'])
  await assert.rejects(service.getStudent360ContractWorkspace('student'), (error: any) => {
    assert.equal(error.code, 'functions/deadline-exceeded')
    assert.equal(error.message, 'Student 360 đang bận. Aura chưa thay đổi dữ liệu; vui lòng thử lại.')
    return true
  })
  assert.equal(requests.length, 2)
})

test('Student360 never retries East or Singapore after both regions fail', async () => {
  for (const { name, args } of student360Reads) {
    const { service, requests } = await serviceFixture(['unavailable', 'resource-exhausted'])
    await assert.rejects(service[name](...args))
    assert.deepEqual(requests.map((request) => request.region), ['asia-east1', 'asia-southeast1'])
  }
})

test('Student360 without an East client performs only one legacy attempt', async () => {
  for (const { name, args } of student360Reads) {
    for (const errors of [[], ['unavailable']]) {
      const { service, requests } = await serviceFixture(errors, false)
      if (errors.length) await assert.rejects(service[name](...args))
      else await service[name](...args)
      assert.equal(requests.length, 1)
      assert.equal(requests[0].region, 'asia-southeast1')
      assert.equal(requests[0].name, name)
    }
  }
})

test('all Student360 mutations retain one East attempt and never cross-region retry', async () => {
  for (const { name, args } of [
    { name: 'saveStudent360ProgressCheckIn', args: [{ studentId: 'student', checkIn: {} }] },
    { name: 'createStudentCareActivity', args: [{ studentId: 'student', type: 'note', note: 'test' }] },
    { name: 'refreshStudent360Projection', args: ['student'] },
    { name: 'mutateStudent360Contract', args: [{ studentId: 'student', idempotencyKey: 'same-command' }] },
  ]) {
    const { service, requests } = await serviceFixture(['unavailable'])
    await assert.rejects(service[name](...args))
    assert.equal(requests.length, 1)
    assert.equal(requests[0].region, 'asia-east1')
    assert.equal(requests[0].name, `${name}Regional`)
    assert.equal(requests[0].kind, 'write')
  }
})
