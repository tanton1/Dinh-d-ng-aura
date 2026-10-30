import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'

test('business history coalesces simultaneous matching reads, but isolates accounts, filters and later refreshes', async () => {
  const state = {
    auth: { currentUser: { uid: 'account-a' } as { uid: string } | null },
    calls: [] as Array<{ name: string; input: unknown }>,
    resolvers: [] as Array<(value: unknown) => void>,
  }
  ;(globalThis as any).__businessHistoryReadTest = state
  const result = await build({
    entryPoints: ['src/services/businessReportingService.ts'], bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'business-read-transport', setup(builder) {
      builder.onResolve({ filter: /(?:lib\/firebase(?:Functions)?|clientTelemetryService|readOnlyCallableService)$/ }, (args) => ({ path: args.path, namespace: 'business-read-fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'business-read-fixture' }, ({ path }) => ({ contents:
        path.endsWith('/firebaseFunctions') ? 'export const firebaseFunctions = {}; export const firebaseBusinessReportingFunctions = {}'
          : path.endsWith('/firebase') ? 'export const firebaseAuth = globalThis.__businessHistoryReadTest.auth'
            : path.endsWith('/clientTelemetryService') ? 'export const createClientCorrelationId = () => "test-correlation"'
              : `export function callReadOnlyFunction(name, input) {
                const state = globalThis.__businessHistoryReadTest;
                state.calls.push({ name, input });
                return new Promise((resolve) => state.resolvers.push(resolve));
              }
              export const runReadOnlyWithFallback = (primary) => primary();`,
      }))
    } }],
  })
  const service = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
  const query = { startDate: '2026-10-19', endDate: '2026-10-25', pageSize: 50 }
  const first = service.listStudentTrainingHistory('student-1', query)
  const duplicate = service.listStudentTrainingHistory('student-1', query)
  await Promise.resolve()
  assert.equal(state.calls.length, 1)
  state.auth.currentUser = { uid: 'account-b' }
  const otherAccount = service.listStudentTrainingHistory('student-1', query)
  const otherFilter = service.listStudentTrainingHistory('student-1', { ...query, status: 'no_show' })
  const trainer = service.listTrainerTeachingHistory('student-1', query)
  await Promise.resolve()
  assert.equal(state.calls.length, 4)
  assert.equal(state.calls[0].name, 'listStudentTrainingHistoryRegional')
  assert.equal(state.calls[3].name, 'listTrainerTeachingHistoryRegional')
  state.resolvers.forEach((resolve) => resolve({ records: [] }))
  await Promise.all([first, duplicate, otherAccount, otherFilter, trainer])

  const refreshed = service.listStudentTrainingHistory('student-1', query)
  await Promise.resolve()
  assert.equal(state.calls.length, 5, 'settled results are not reused after a correction or refresh')
  state.resolvers[4]({ records: [] })
  await refreshed

  state.auth.currentUser = null
  const anonymousFirst = service.listStudentTrainingHistory('student-1', query)
  const anonymousSecond = service.listStudentTrainingHistory('student-1', query)
  assert.equal(state.calls.length, 7, 'pre-auth reads cannot share an account cache')
  state.resolvers[5]({ records: [] })
  state.resolvers[6]({ records: [] })
  await Promise.all([anonymousFirst, anonymousSecond])
  delete (globalThis as any).__businessHistoryReadTest
})

test('a 21-second cold period report completes once without a duplicate fallback read', async () => {
  const state = {
    calls: [] as Array<{ name: string; options: { timeoutMs: number; maximumAttempts: number } }>,
    response: { managementPnl: { recognisedRevenue: 12345 } },
  }
  ;(globalThis as any).__businessColdReportTest = state
  const result = await build({
    entryPoints: ['src/services/businessReportingService.ts'], bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'cold-report-transport', setup(builder) {
      builder.onResolve({ filter: /(?:lib\/firebase(?:Functions)?|clientTelemetryService|readOnlyCallableService)$/ }, (args) => ({ path: args.path, namespace: 'cold-report-fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'cold-report-fixture' }, ({ path }) => ({ contents:
        path.endsWith('/firebaseFunctions') ? 'export const firebaseFunctions = {}; export const firebaseBusinessReportingFunctions = {}'
          : path.endsWith('/firebase') ? 'export const firebaseAuth = { currentUser: { uid: "finance-admin" } }'
            : path.endsWith('/clientTelemetryService') ? 'export const createClientCorrelationId = () => "cold-report"'
              : `export async function callReadOnlyFunction(name, input, options) {
                const state = globalThis.__businessColdReportTest;
                state.calls.push({ name, options });
                const responseTime = name.startsWith('listBusinessPerformance') ? 21_000 : 100;
                if (options.timeoutMs < responseTime) throw { code: 'functions/deadline-exceeded' };
                return state.response;
              }
              export async function runReadOnlyWithFallback(primary, fallback) {
                try { return await primary(); } catch { return fallback(); }
              }`,
      }))
    } }],
  })
  try {
    const service = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
    const query = { startDate: '2026-10-02', endDate: '2026-10-31' }
    assert.deepEqual(await service.listBusinessPerformance(query), state.response)
    assert.equal(state.calls.length, 1, 'a successful cold report must not read both regions')
    assert.equal(state.calls[0].name, 'listBusinessPerformanceRegional')
    assert.equal(state.calls[0].options.maximumAttempts, 1)
    assert.ok(state.calls[0].options.timeoutMs < 60_000, 'report wait remains bounded below the server deadline')
    await service.listStudentTrainingHistory('student-1', query)
    assert.equal(state.calls[1].options.timeoutMs, 18_000, 'ordinary history keeps its existing deadline')
  } finally {
    delete (globalThis as any).__businessColdReportTest
  }
})
