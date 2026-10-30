import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'

const bundled = build({
  entryPoints: ['src/services/nutritionReviewService.ts'], bundle: true, write: false, platform: 'node', format: 'cjs',
  plugins: [{ name: 'review-transport', setup(builder) {
    builder.onResolve({ filter: /^(firebase\/functions|\.\.\/lib\/firebase(?:Functions)?|\.\/clientTelemetryService)$/ }, (args) => ({ path: args.path, namespace: 'review-fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'review-fixture' }, ({ path }) => ({ contents:
      path === 'firebase/functions' ? 'export const httpsCallable = (client,name) => (input) => globalThis.fixture.invoke(client,name,input)'
        : path.endsWith('/firebaseFunctions') ? 'export const firebaseFunctions={region:"legacy"}; export const firebaseTelemetryFunctions=null; export const firebaseScheduleOptimizerFunctions={region:"regional"}'
          : path.endsWith('/firebase') ? 'export const firebaseAuth=globalThis.fixture.auth'
            : 'export const reportClientIssue=()=>{}; export const createClientCorrelationId=()=>"test"',
    }))
  } }],
}).then((result) => result.outputFiles[0].text)

async function fixture() {
  const auth = { currentUser: { uid: 'coach-a' } as { uid: string } | null }
  const requests: Array<{ name: string; uid: string | undefined; input: unknown; resolve: (value: unknown) => void; reject: (error: unknown) => void }> = []
  const module = { exports: {} as any }
  runInNewContext(await bundled, {
    module, exports: module.exports, console,
    setTimeout: (callback: () => void) => { callback(); return 1 },
    fixture: { auth, invoke(_client: unknown, name: string, input: unknown) {
      return new Promise((resolve, reject) => requests.push({ name, uid: auth.currentUser?.uid, input, resolve: (data) => resolve({ data }), reject }))
    } },
  })
  return { service: module.exports, auth, requests }
}

for (const nextUid of ['coach-b', null]) test(`review fallback is blocked after ${nextUid ? 'account switch' : 'sign-out'}`, async () => {
  const { service, auth, requests } = await fixture()
  const pending = service.listNutritionMealReviews({ section: 'page', cursor: 'coach-a-cursor' }, 'authority-a')
  const rejected = assert.rejects(pending, /Tài khoản đã thay đổi/)
  assert.equal(requests.length, 1)
  auth.currentUser = nextUid ? { uid: nextUid } : null
  requests[0].reject({ code: 'functions/unavailable', message: 'regional unavailable' })
  await rejected
  assert.equal(requests.length, 1, 'no legacy callable is dispatched with the old scope')
})

test('unchanged owner retains one transient regional fallback', async () => {
  const { service, requests } = await fixture()
  const pending = service.listNutritionMealReviews({ section: 'summary' }, 'authority-a')
  requests[0].reject({ code: 'functions/unavailable', message: 'regional unavailable' })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(requests.map(({ name, uid }) => [name, uid]), [['listNutritionMealReviewsRegional', 'coach-a'], ['listNutritionMealReviews', 'coach-a']])
  requests[1].resolve({ reviews: [], summary: { pending: 2 } })
  assert.equal((await pending).summary.pending, 2)
})

test('review flights isolate same-UID authority changes and reject late old-account results', async () => {
  const { service, auth, requests } = await fixture()
  const first = service.listNutritionMealReviews({ section: 'page' }, 'authority-a')
  const duplicate = service.listNutritionMealReviews({ section: 'page' }, 'authority-a')
  const changed = service.listNutritionMealReviews({ section: 'page' }, 'authority-b')
  assert.equal(requests.length, 2)
  const rejected = [first, duplicate, changed].map((result) => assert.rejects(result, /Tài khoản đã thay đổi/))
  auth.currentUser = { uid: 'coach-b' }
  requests.forEach((request) => request.resolve({ reviews: [] }))
  await Promise.all(rejected)
})
