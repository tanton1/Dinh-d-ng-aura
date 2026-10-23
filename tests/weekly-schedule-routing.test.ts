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

test('ordinary branch workspace reads retain their Singapore-to-East fallback', async () => {
  const { service, requests } = await fixture(['resource-exhausted'])
  await service.getPtScheduleWorkspace({ branchId: 'branch', weekId: '2026-10-19' })
  assert.deepEqual(requests.map(({ region, name }) => ({ region, name })), [
    { region: 'asia-southeast1', name: 'getPtScheduleWorkspace' },
    { region: 'asia-east1', name: 'getPtScheduleWorkspaceRegional' },
  ])
})
