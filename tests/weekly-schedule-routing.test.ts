import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { build } from 'esbuild'
import { weeklyScheduleEndpoint, weeklyScheduleEndpoints } from '../src/services/weeklyScheduleEndpointPolicy'

const bundled = build({
  entryPoints: [resolve('src/services/ptSchedulePublishService.ts')], bundle: true, write: false, platform: 'node', format: 'cjs',
  plugins: [{ name: 'routing-transport-fixture', setup(builder) {
    // Exercise maintenance policy through the real private transport without
    // adding a production export or exposing these commands in the UI.
    builder.onLoad({ filter: /ptSchedulePublishService\.ts$/ }, (args) => ({ loader: 'ts',
      contents: `${readFileSync(args.path, 'utf8')}\nexport const __invokeForRoutingTest = invoke\n`,
    }))
    builder.onResolve({ filter: /^(firebase\/functions|\.\.\/lib\/firebaseFunctions|\.\/clientTelemetryService)$/ }, (args) => ({ path: args.path, namespace: 'routing-fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'routing-fixture' }, (args) => ({ loader: 'js', contents: args.path === 'firebase/functions'
      ? 'export const httpsCallable = (client, name, options) => async (input) => globalThis.routing.invoke(client, name, options, input)'
      : args.path.endsWith('firebaseFunctions')
        ? 'export const firebaseFunctions = { region: "asia-southeast1" }; export const firebaseSchedulePublishFunctions = globalThis.routing.east; export const firebaseScheduleOptimizerFunctions = globalThis.routing.east'
        : 'export const reportClientIssue = (...args) => globalThis.routing.issues.push(args)' }))
  } }],
}).then((result) => result.outputFiles[0].text)

type Request = { region: string; name: string; timeout: number; input: Record<string, unknown> }
async function fixture(errors: string[] = [], region: string | null = 'asia-east1') {
  const requests: Request[] = [], issues: unknown[] = []
  const module = { exports: {} as any }
  runInNewContext(await bundled, {
    module, exports: module.exports,
    setTimeout: (callback: () => void) => { callback(); return 1 },
    routing: {
      east: region === null ? null : { region }, issues,
      invoke: async (client: { region: string }, name: string, options: { timeout: number }, input: Record<string, unknown>) => {
        requests.push({ region: client.region, name, timeout: options.timeout, input })
        const code = errors.shift()
        if (code) throw { code: `functions/${code}`, message: code }
        return { data: { ok: true } }
      },
    },
  })
  return { service: module.exports, requests, issues }
}

test('weekly registry keeps all three logical operations in the existing East pool', () => {
  const entry = readFileSync('functions/index.js', 'utf8')
  for (const [logicalName, policy] of Object.entries(weeklyScheduleEndpoints)) {
    assert.equal(policy.region, 'asia-east1')
    assert.equal(policy.fallback, null)
    assert.ok(entry.includes(`exports.${policy.callableName} =`), `${logicalName} must retain a backend export`)
  }
  assert.equal(weeklyScheduleEndpoint('getPtScheduleWeeklyView')?.callableName, 'getPtScheduleWeeklyViewRegional')
  for (const name of ['rebuildPtScheduleWeeklyView', 'markPtScheduleWeeklyViewDirty']) {
    assert.equal(weeklyScheduleEndpoint(name)?.operation, 'maintenance-command')
    assert.equal(weeklyScheduleEndpoint(name)?.maximumAttempts, 1)
  }
  assert.equal(weeklyScheduleEndpoint('toString'), undefined)
  assert.equal(weeklyScheduleEndpoint('__proto__'), undefined)
})

test('weekly logical read calls its canonical Regional wire endpoint once', async () => {
  const { service, requests } = await fixture()
  const input = { branchId: 'branch', weekId: '2026-10-19', initialPaint: true }
  await service.getPtScheduleWeeklyView(input)
  assert.deepEqual(requests, [{ region: 'asia-east1', name: 'getPtScheduleWeeklyViewRegional', timeout: 20_000, input }])
  assert.equal(requests[0].input, input)
})

test('transient weekly errors retry the same East endpoint once without a Singapore probe', async () => {
  for (const code of ['internal', 'unavailable', 'deadline-exceeded', 'resource-exhausted']) {
    const { service, requests } = await fixture([code])
    const input = { branchId: 'branch', weekId: '2026-10-19' }
    await service.getPtScheduleWeeklyView(input)
    assert.equal(requests.length, 2)
    assert.ok(requests.every((request) => request.region === 'asia-east1' && request.name === 'getPtScheduleWeeklyViewRegional' && request.input === input))
  }
})

test('weekly authorization, validation and missing-endpoint errors never retry', async () => {
  for (const code of ['unauthenticated', 'permission-denied', 'invalid-argument', 'failed-precondition', 'not-found']) {
    const { service, requests } = await fixture([code])
    await assert.rejects(service.getPtScheduleWeeklyView({ branchId: 'branch', weekId: '2026-10-19' }))
    assert.equal(requests.length, 1)
  }
})

test('weekly read stops after its second failure and reports only the final error', async () => {
  const { service, requests, issues } = await fixture(['unavailable', 'deadline-exceeded'])
  await assert.rejects(service.getPtScheduleWeeklyView({ branchId: 'branch', weekId: '2026-10-19' }))
  assert.equal(requests.length, 2)
  assert.equal(issues.length, 1)
})

test('missing or wrongly configured East client fails before any Singapore request', async () => {
  for (const region of [null, 'asia-southeast1']) {
    const { service, requests } = await fixture([], region)
    await assert.rejects(service.getPtScheduleWeeklyView({ branchId: 'branch', weekId: '2026-10-19' }), (error: any) => error.issueCode === 'SYNC_UNAVAILABLE')
    assert.equal(requests.length, 0)
  }
})

test('schedule commands make one attempt and preserve the caller idempotency key', async () => {
  for (const code of ['unavailable', 'deadline-exceeded', 'resource-exhausted']) {
    const { service, requests } = await fixture([code])
    const input = { branchId: 'branch', weekId: '2026-10-19', expectedDraftRevision: 3, command: 'remove_student', idempotencyKey: 'same-operation', payload: {} }
    await assert.rejects(service.applyAdminPtScheduleEdit(input))
    assert.deepEqual(requests, [{ region: 'asia-east1', name: 'adminEditPtScheduleRegional', timeout: 60_000, input }])
    assert.equal(requests[0].input, input)
    assert.equal(requests[0].input.idempotencyKey, 'same-operation')
  }
})

test('weekly maintenance commands execute one East request without any automatic retry or fallback', async () => {
  for (const name of ['rebuildPtScheduleWeeklyView', 'markPtScheduleWeeklyViewDirty']) {
    for (const code of ['', 'internal', 'unavailable', 'deadline-exceeded', 'resource-exhausted']) {
      const { service, requests } = await fixture(code ? [code] : [])
      const input = { branchId: 'branch', weekId: '2026-10-19', idempotencyKey: 'same-maintenance-command' }
      if (code) await assert.rejects(service.__invokeForRoutingTest(name, input))
      else await service.__invokeForRoutingTest(name, input)
      assert.deepEqual(requests, [{ region: 'asia-east1', name, timeout: 60_000, input }])
      assert.equal(requests[0].input, input)
    }
  }
})

const workspaceReads = [
  { name: 'listPtScheduleBranches', input: undefined },
  { name: 'getPtScheduleWorkspace', input: { branchId: 'branch', weekId: '2026-10-19', initialPaint: true } },
  { name: 'getPtScheduleSlotCandidates', input: { branchId: 'branch', weekId: '2026-10-19', trainerId: 'trainer', date: '2026-10-20', hour: 9, query: 'student' } },
]

test('all three workspace reads prefer East and do not probe Singapore after success', async () => {
  for (const { name, input } of workspaceReads) {
    const { service, requests } = await fixture()
    await service[name](input)
    assert.equal(requests.length, 1)
    assert.equal(requests[0].region, 'asia-east1')
    assert.equal(requests[0].name, `${name}Regional`)
    assert.equal(requests[0].timeout, 20_000)
    if (input) assert.equal(requests[0].input, input)
  }
})

test('workspace infrastructure failures fall back to Singapore exactly once, never a second East request', async () => {
  for (const { name, input } of workspaceReads) {
    for (const code of ['internal', 'unavailable', 'deadline-exceeded', 'resource-exhausted']) {
      const { service, requests } = await fixture([code])
      await service[name](input)
      assert.deepEqual(requests.map(({ region, name }) => ({ region, name })), [
        { region: 'asia-east1', name: `${name}Regional` },
        { region: 'asia-southeast1', name },
      ])
      assert.equal(requests[0].input, requests[1].input)
    }
  }
})

test('workspace authorization, validation and missing-data errors never cross regions', async () => {
  for (const { name, input } of workspaceReads) {
    for (const code of ['unauthenticated', 'permission-denied', 'invalid-argument', 'failed-precondition', 'not-found', 'unknown', 'cancelled', 'aborted']) {
      const { service, requests } = await fixture([code])
      await assert.rejects(service[name](input))
      assert.equal(requests.length, 1)
      assert.equal(requests[0].region, 'asia-east1')
    }
  }
})

test('workspace reads stop after East and Singapore fail and report only the final failure', async () => {
  for (const { name, input } of workspaceReads) {
    const { service, requests, issues } = await fixture(['unavailable', 'resource-exhausted'])
    await assert.rejects(service[name](input))
    assert.deepEqual(requests.map((request) => request.region), ['asia-east1', 'asia-southeast1'])
    assert.equal(issues.length, 1)
  }
})

test('missing East client allows one legacy workspace read without retrying Singapore', async () => {
  for (const { name, input } of workspaceReads) {
    for (const errors of [[], ['unavailable']]) {
      const { service, requests } = await fixture(errors, null)
      if (errors.length) await assert.rejects(service[name](input))
      else await service[name](input)
      assert.equal(requests.length, 1)
      assert.equal(requests[0].region, 'asia-southeast1')
      assert.equal(requests[0].name, name)
    }
  }
})
