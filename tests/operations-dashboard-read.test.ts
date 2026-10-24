import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'

test('admin dashboard isolates account/query reads and coalesces pending requests without retaining results', async () => {
  const state = {
    auth: { currentUser: { uid: 'admin-a' } as { uid: string } | null },
    calls: [] as Array<{ name: string; input: unknown }>,
    pending: [] as Array<{ resolve: (value: unknown) => void; reject: (reason: unknown) => void }>,
  }
  ;(globalThis as any).__dashboardReads = state
  const result = await build({
    entryPoints: ['src/services/operationsDashboardService.ts'], bundle: true, write: false, platform: 'node', format: 'esm',
    define: { 'import.meta.env.MODE': '"test"' },
    plugins: [{ name: 'dashboard-read-transport', setup(builder) {
      builder.onResolve({ filter: /(?:firebase\/functions|lib\/firebase(?:Functions)?|clientTelemetryService|readOnlyCallableService)$/ }, (args) => ({ path: args.path, namespace: 'dashboard-reads' }))
      builder.onLoad({ filter: /.*/, namespace: 'dashboard-reads' }, ({ path }) => ({ contents:
        path === 'firebase/functions' ? 'export const httpsCallable = () => { throw new Error("Unexpected legacy attendance read") }'
          : path.endsWith('/firebaseFunctions') ? 'export const firebaseFunctions = {}; export const firebaseScheduleOptimizerFunctions = {}'
            : path.endsWith('/firebase') ? 'export const firebaseAuth = globalThis.__dashboardReads.auth'
              : path.endsWith('/clientTelemetryService') ? 'export const createClientCorrelationId = () => "test"; export const reportClientIssue = () => {}'
                : `export function callReadOnlyFunction(name, input) {
                  const state = globalThis.__dashboardReads;
                  state.calls.push({ name, input });
                  return new Promise((resolve, reject) => state.pending.push({ resolve, reject }));
                }
                export const runReadOnlyWithFallback = (primary) => primary();`,
      }))
    } }],
  })
  const service = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
  const query = { startAt: '2026-10-01T00:00:00+07:00', endAt: '2026-10-24T12:00:00+07:00', branchId: 'branch-a' }
  const first = service.getOperationsDashboard(query)
  const duplicate = service.getOperationsDashboard({ ...query })
  await Promise.resolve()
  assert.equal(state.calls.length, 1, 'concurrent equal dashboard requests use one callable')
  const forced = service.getOperationsDashboard({ ...query, forceRefresh: true })
  const forcedDuplicate = service.getOperationsDashboard({ ...query, forceRefresh: true })
  await Promise.resolve()
  assert.equal(state.calls.length, 2, 'explicit refresh starts a fresh flight but double-clicks share it')
  state.auth.currentUser = { uid: 'admin-b' }
  const otherAccount = service.getOperationsDashboard(query)
  const otherBranch = service.getOperationsDashboard({ ...query, branchId: 'branch-b' })
  const otherRange = service.getOperationsDashboard({ ...query, endAt: '2026-10-23T12:00:00+07:00' })
  await Promise.resolve()
  assert.equal(state.calls.length, 5)
  assert.ok(state.calls.every((call) => call.name === 'getOperationsDashboardRegional'))
  state.pending[1].resolve({ finance: { cashCollected: 200 } })
  assert.equal((await forced).finance.cashCollected, 200)
  await forcedDuplicate
  state.pending[0].resolve({ finance: { cashCollected: 100 } })
  for (const pending of state.pending.slice(2)) pending.resolve({ finance: { cashCollected: 300 } })
  await Promise.all([first, duplicate, otherAccount, otherBranch, otherRange])
  state.auth.currentUser = { uid: 'admin-a' }
  const fresh = service.getOperationsDashboard(query)
  await Promise.resolve()
  assert.equal(state.calls.length, 6, 'late old responses cannot poison a result cache; every later load reaches server')
  state.pending[5].resolve({ finance: { cashCollected: 400 } })
  assert.equal((await fresh).finance.cashCollected, 400)

  const failed = service.getOperationsDashboard(query)
  await Promise.resolve()
  state.pending[6].reject(new Error('temporary transport failure'))
  await assert.rejects(failed, /temporary transport failure/)
  const retry = service.getOperationsDashboard(query)
  await Promise.resolve()
  assert.equal(state.calls.length, 8, 'a rejected flight does not block retry')
  state.pending[7].resolve({})
  await retry

  const previousAuthority = service.getOperationsDashboard(query, { authorizationVersion: 1 })
  const changedAuthority = service.getOperationsDashboard(query, { authorizationVersion: 2 })
  await Promise.resolve()
  assert.equal(state.calls.length, 10, 'a permission revision cannot join an older authorized response')
  state.pending[8].resolve({})
  state.pending[9].resolve({})
  await Promise.all([previousAuthority, changedAuthority])

  const previousBranchScope = service.getOperationsDashboard(query, { authorizationVersion: 2, authorityKey: 'active:branch-a:payroll' })
  const sameBranchScope = service.getOperationsDashboard(query, { authorizationVersion: 2, authorityKey: 'active:branch-a:payroll' })
  const changedBranchScope = service.getOperationsDashboard(query, { authorizationVersion: 2, authorityKey: 'active:branch-b:dashboard-only' })
  await Promise.resolve()
  assert.equal(state.calls.length, 12, 'same-version branch/role changes cannot join the previous authority flight')
  assert.deepEqual(state.calls[10].input, query, 'authority fingerprints stay client-side instead of altering the callable request')
  assert.deepEqual(state.calls[11].input, query)
  state.pending[10].resolve({})
  state.pending[11].resolve({})
  await Promise.all([previousBranchScope, sameBranchScope, changedBranchScope])

  state.auth.currentUser = null
  const anonymous = service.getOperationsDashboard(query)
  const anonymousDuplicate = service.getOperationsDashboard(query)
  assert.equal(state.calls.length, 14, 'unresolved auth cannot use a shared account flight')
  state.pending[12].resolve({})
  state.pending[13].resolve({})
  await Promise.all([anonymous, anonymousDuplicate])
  delete (globalThis as any).__dashboardReads
})
