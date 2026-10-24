import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { build } from 'esbuild'

const bundled = build({
  entryPoints: [resolve('src/services/contractRenewalService.ts')],
  bundle: true, write: false, platform: 'node', format: 'cjs',
  plugins: [{ name: 'renewal-contract-fixture', setup(builder) {
    builder.onResolve({ filter: /^(firebase\/functions|\.\.\/lib\/firebaseFunctions|\.\/readOnlyCallableService|\.\/secondaryReadService)$/ },
      (args) => ({ path: args.path, namespace: 'renewal-contract-fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'renewal-contract-fixture' }, (args) => ({ loader: 'js', contents:
      args.path === 'firebase/functions'
        ? 'export const httpsCallable = (client, name, options) => async input => ({ data: await globalThis.fixture.invoke("callable", name, input, client.region, options) })'
        : args.path.endsWith('firebaseFunctions')
          ? 'export const firebaseFunctions = {region:"asia-southeast1"}; export const firebaseStudent360Functions = {region:"asia-east1"}'
          : args.path.endsWith('readOnlyCallableService')
            ? 'export const callReadOnlyFunction = (name, input) => globalThis.fixture.invoke("read", name, input)'
            : 'export const callSecondaryRead = (name, input) => globalThis.fixture.invoke("secondary", name, input)',
    }))
  } }],
}).then((result) => result.outputFiles[0].text)

async function fixture(error?: unknown) {
  const requests: Array<{ transport: string; name: string; input: unknown; region?: string }> = []
  const responses: unknown[] = []
  const module = { exports: {} as any }
  runInNewContext(await bundled, { module, exports: module.exports, fixture: {
    invoke: async (transport: string, name: string, input: unknown, region?: string) => {
      requests.push({ transport, name, input, region })
      if (error) throw error
      const response = name === 'prepareContractRenewal' ? {
        row: { sourceContractId: (input as { sourceContractId: string }).sourceContractId },
        options: { packages: [{ id: 'fresh-package', price: requests.length * 1000 }], cashAccounts: [{ id: 'fresh-cash' }], branches: [], assignees: [] },
        scope: 'branch',
      } : { optionsMode: (input as { optionsMode?: string }).optionsMode ?? 'full', rows: [], options: { packages: [], cashAccounts: [], branches: [], assignees: [] } }
      responses.push(response)
      return response
    },
  } })
  return { service: module.exports, requests, responses }
}

test('real renewal list caller preserves legacy default and explicit filters opt-in without mutating inputs', async () => {
  const { service, requests } = await fixture()
  assert.equal((await service.listContractRenewalCases()).optionsMode, 'full')
  await service.listContractRenewalPipeline()
  const input = { optionsMode: 'filters', search: 'student', branchId: 'branch-one', cursor: 'page-two', pageSize: 30 }
  assert.equal((await service.listContractRenewalCases(input)).optionsMode, 'filters')
  assert.deepEqual(JSON.parse(JSON.stringify(requests.map(({ input }) => input))), [{}, { pageSize: 50 }, input])
  assert.equal(requests[2].input, input)
  assert.ok(requests.every((request) => request.transport === 'secondary' && request.name === 'listContractRenewalCases'))
})

test('prepare caller fetches a complete fresh object on every open, retaining authorized options and scope', async () => {
  const { service, requests, responses } = await fixture()
  const first = await service.prepareContractRenewal('source-one')
  const second = await service.prepareContractRenewal('source-one')
  assert.equal(first, responses[0])
  assert.equal(second, responses[1])
  assert.notEqual(first, second)
  assert.equal(first.options.packages[0].price, 1000)
  assert.equal(second.options.packages[0].price, 2000)
  assert.equal(second.options.cashAccounts[0].id, 'fresh-cash')
  assert.equal(second.scope, 'branch')
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [1, 2].map(() => ({ transport: 'callable', name: 'prepareContractRenewal', input: { sourceContractId: 'source-one' }, region: 'asia-southeast1' })))
})

test('list and prepare auth/business failures remain visible without stale or zero-option substitutes', async () => {
  for (const code of ['permission-denied', 'failed-precondition', 'invalid-argument', 'unauthenticated']) {
    const error = { code: `functions/${code}`, message: 'Fresh access denied' }
    const { service, requests } = await fixture(error)
    await assert.rejects(service.listContractRenewalCases({ optionsMode: 'filters' }), (actual) => actual === error)
    await assert.rejects(service.prepareContractRenewal('source-one'), code === 'unauthenticated' ? /Phiên đăng nhập đã hết hạn/ : /Fresh access denied/)
    assert.equal(requests.length, 2)
  }
})
