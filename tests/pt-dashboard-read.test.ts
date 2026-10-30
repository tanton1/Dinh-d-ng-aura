import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'

const bundled = build({
  entryPoints: ['src/services/ptOperationsV2Service.ts'], bundle: true, write: false, platform: 'node', format: 'cjs',
  plugins: [{ name: 'pt-dashboard-transport', setup(builder) {
    builder.onResolve({ filter: /^(firebase\/functions|\.\.\/lib\/firebase(?:Functions)?|\.\/clientTelemetryService)$/ }, (args) => ({ path: args.path, namespace: 'dashboard-fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'dashboard-fixture' }, ({ path }) => ({ contents:
      path === 'firebase/functions' ? 'export const httpsCallable = (client,name) => (input) => globalThis.fixture.invoke(client,name,input)'
        : path.endsWith('/firebaseFunctions') ? 'export const firebaseFunctions={region:"asia-southeast1"}; export const firebaseTelemetryFunctions=null; export const firebaseScheduleOptimizerFunctions={region:"asia-east1"}'
          : path.endsWith('/firebase') ? 'export const firebaseAuth=globalThis.fixture.auth'
            : 'export const reportClientIssue=()=>{}; export const createClientCorrelationId=()=>"test"',
    }))
  } }],
}).then((result) => result.outputFiles[0].text)

type Request = { region: string; name: string; input: Record<string, unknown> }
const day = '2026-10-24'
async function fixture(onInvoke?: (request: Request) => Promise<unknown>) {
  const requests: Request[] = []
  const auth = { currentUser: { uid: 'trainer-a' } }
  const module = { exports: {} as any }
  const response = { schemaVersion: 4, scope: { staffId: 'trainer-a', counts: { primaryStudents: 8, secondaryStudents: 2, pendingRequests: 3 } }, sessions: [], hasMore: false }
  runInNewContext(await bundled, {
    module, exports: module.exports, console,
    setTimeout: (callback: () => void) => { callback(); return 1 },
    window: { location: { hash: '#/staff-dashboard' }, setTimeout: (callback: () => void) => { callback(); return 1 } },
    fixture: { auth, async invoke(client: { region: string }, name: string, input: Record<string, unknown>) {
      const request = { region: client.region, name, input }
      requests.push(request)
      return { data: onInvoke ? await onInvoke(request) : response }
    } },
  })
  return { service: module.exports, requests, auth, response }
}

test('PT dashboard reuses the existing regional read with additive opt-in and no result TTL', async () => {
  const { service, requests, response } = await fixture()
  assert.deepEqual(await service.getMyTrainerDashboard(day, 500, 'authority-a'), response)
  await service.getMyTrainerDashboard(day, 500, 'authority-a')
  assert.equal(requests.length, 2, 'a later explicit refresh must perform a new server read')
  assert.ok(requests.every((request) => request.name === 'getMyTrainerWorkspaceRegional' && request.region === 'asia-east1'))
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].input)), { section: 'schedule', from: day, to: day, limit: 500, independentTabs: true, dashboardSummary: true })
  assert.equal('authorityKey' in requests[0].input, false, 'client authority only partitions pending requests; it never grants server scope')
})

test('PT dashboard coalesces matching in-flight reads but isolates same-UID authority changes and day changes', async () => {
  const resolvers: Array<(value: unknown) => void> = []
  const { service, requests } = await fixture(() => new Promise((resolve) => resolvers.push(resolve)))
  const first = service.getMyTrainerDashboard(day, 500, 'authority-a')
  const duplicate = service.getMyTrainerDashboard(day, 500, 'authority-a')
  const changedRole = service.getMyTrainerDashboard(day, 500, 'authority-b')
  const changedDay = service.getMyTrainerDashboard('2026-10-25', 500, 'authority-b')
  assert.equal(requests.length, 3)
  resolvers.forEach((resolve) => resolve({ sessions: [] }))
  await Promise.all([first, duplicate, changedRole, changedDay])
})

test('PT dashboard discards a response after account switch instead of displaying prior staff data', async () => {
  let resolve!: (value: unknown) => void
  const { service, auth } = await fixture(() => new Promise((done) => { resolve = done }))
  const pending = service.getMyTrainerDashboard(day)
  const rejected = assert.rejects(pending, /Phiên đăng nhập đã thay đổi/)
  auth.currentUser = { uid: 'trainer-b' }
  resolve({ sessions: [{ studentName: 'Prior staff learner' }] })
  await rejected
})

test('PT dashboard falls back once only for transient failures and remains compatible with old full workspace output', async () => {
  let failures = 0
  const oldOutput = { schemaVersion: 3, scope: { counts: { primaryStudents: 1, secondaryStudents: 0, pendingRequests: 2, nutritionStudents: 9 } }, sessions: [], students: [], requests: [], hasMore: false }
  const { service, requests } = await fixture(async () => {
    if (!failures++) throw { code: 'functions/unavailable', message: 'temporary' }
    return oldOutput
  })
  assert.deepEqual(await service.getMyTrainerDashboard(day), oldOutput)
  assert.deepEqual(requests.map(({ region, name }) => [region, name]), [
    ['asia-east1', 'getMyTrainerWorkspaceRegional'], ['asia-southeast1', 'getMyTrainerWorkspace'],
  ])
  const denied = await fixture(async () => { throw { code: 'functions/permission-denied', message: 'Not permitted' } })
  await assert.rejects(denied.service.getMyTrainerDashboard(day))
  assert.equal(denied.requests.length, 1)
})
