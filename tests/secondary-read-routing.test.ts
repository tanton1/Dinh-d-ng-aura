import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { build } from 'esbuild'

// Bundle the actual callers and their dynamic transport import, not a replica
// of the routing policy. Only Firebase I/O, auth and telemetry are substituted.
const bundled = build({
  stdin: { contents: `
    export * as cashbook from './src/services/cashbookService';
    export * as finance from './src/services/financeLedgerService';
    export * as renewal from './src/services/contractRenewalService';
    export * as exercise from './src/services/exerciseCatalogService';
    export * as nutrition from './src/services/internalNutritionCatalogService';
    export * as loyalty from './src/features/loyalty/loyaltyService';
    export { callSecondaryRead } from './src/services/secondaryReadService';
  `, resolveDir: resolve('.'), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs',
  plugins: [{ name: 'secondary-read-fixture', setup(builder) {
    builder.onResolve({ filter: /^(firebase\/(?:functions|firestore)|(?:\.\.\/)+lib\/firebase(?:Functions|Firestore)?|\.\/clientTelemetryService)$/ },
      (args) => ({ path: args.path, namespace: 'secondary-read-fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'secondary-read-fixture' }, (args) => ({ loader: 'js', contents:
      args.path === 'firebase/functions'
        ? 'export const httpsCallable = (client, name, options) => async (input) => globalThis.routing.invoke(client, name, options, input)'
        : args.path === 'firebase/firestore'
          ? 'export const doc = () => { throw new Error("Unexpected Firestore read") }; export const onSnapshot = doc'
        : args.path.endsWith('firebaseFirestore')
          ? 'export const firestoreDb = null'
        : args.path.endsWith('firebaseFunctions')
          ? 'export const firebaseFunctions = globalThis.routing.sg; export const firebaseStudent360Functions = globalThis.routing.east; export const firebaseRegionalReadFunctions = globalThis.routing.jakarta'
          : args.path.endsWith('/firebase')
            ? 'export const firebaseAuth = globalThis.routing.auth'
            : 'export const createClientCorrelationId = () => globalThis.routing.correlation(); export const reportClientIssue = (...args) => globalThis.routing.report(...args)',
    }))
  } }],
}).then((result) => result.outputFiles[0].text)

type Request = { region: string; name: string; timeout?: number; input: Record<string, unknown> }
type Auth = { currentUser: { uid: string; getIdToken: () => Promise<string> } | null }
type FixtureOptions = {
  errors?: unknown[]
  east?: string | null
  jakarta?: string | null
  sg?: string | null
  uid?: string | null
  response?: unknown
  onInvoke?: (request: Request, auth: Auth, count: number) => Promise<void> | void
  telemetryThrows?: boolean
}

function callableError(code: string, message = code) {
  return { code: `functions/${code}`, message, details: { fixture: true } }
}

function responseFor(name: string) {
  switch (name.replace(/Regional$/, '')) {
    case 'listAccountingCatalog': return { accounts: [], expensePurposes: [], receiptPurposes: [], approvalSeparationThreshold: 100 }
    case 'listCashAccounts': return { accounts: [{ id: 'account-one', balance: 75 }] }
    case 'listCashTransactions': return { transactions: [{ id: 'transaction-one' }], hasMore: false }
    case 'listExpenseVouchers': return { vouchers: [{ id: 'voucher-one' }], hasMore: true }
    case 'listFinanceLedger': return { entries: [], summary: { collectedAmount: '12', refundedAmount: 2 }, hasMore: false, nextCursor: null }
    case 'listRenewalMessageTemplates': return { schemaVersion: 1, templates: [{ id: 'template-one' }] }
    case 'listContractRenewalCases': return { rows: [], optionsMode: 'filters', options: { branches: [], assignees: [], packages: [], cashAccounts: [] }, stats: { totalCases: 0 } }
    case 'listLoyaltyAccounts': return { accounts: [{ studentId: 'student-one', availablePoints: 17 }], hasMore: true, nextCursor: 'student-one', totalCount: 101 }
    case 'getExerciseCatalogItem': return { item: { id: 'exercise-one', nameVi: ' Bài tập ', status: 'published' } }
    case 'getInternalNutritionCatalogItem': return { item: { id: 'food-one' }, restricted: true }
    default: return { ok: true }
  }
}

async function fixture(options: FixtureOptions = {}) {
  const requests: Request[] = [], issues: unknown[][] = []
  const errors = [...(options.errors ?? [])]
  let correlationCount = 0, authRefreshes = 0
  const auth: Auth = { currentUser: options.uid === null ? null : {
    uid: options.uid ?? 'actor-one', getIdToken: async () => { authRefreshes += 1; return 'fixture-token' },
  } }
  const client = (region: string | null | undefined, defaultRegion: string) => region === null ? null : { region: region ?? defaultRegion }
  const module = { exports: {} as any }
  runInNewContext(await bundled, {
    module, exports: module.exports,
    setTimeout: (callback: () => void) => { callback(); return 1 },
    crypto: { randomUUID: () => 'mutation-operation-id' },
    routing: {
      east: client(options.east, 'asia-east1'), jakarta: client(options.jakarta, 'asia-southeast2'), sg: client(options.sg, 'asia-southeast1'), auth,
      correlation: () => `correlation-${++correlationCount}`,
      report: (...args: unknown[]) => { issues.push(args); if (options.telemetryThrows) throw new Error('telemetry fixture failure') },
      invoke: async (functions: { region: string }, name: string, callableOptions: { timeout?: number } | undefined, input: Record<string, unknown>) => {
        const request = { region: functions.region, name, timeout: callableOptions?.timeout, input }
        requests.push(request)
        await options.onInvoke?.(request, auth, requests.length)
        const error = errors.shift()
        if (error) throw error
        return { data: 'response' in options ? options.response : responseFor(name) }
      },
    },
  })
  return { service: module.exports, requests, issues, auth, authRefreshes: () => authRefreshes }
}

const operations = [
  { group: 'cashbook', name: 'listAccountingCatalog', region: 'asia-east1', args: [], input: {} },
  { group: 'cashbook', name: 'listCashAccounts', region: 'asia-east1', args: [], input: {} },
  { group: 'cashbook', name: 'listCashTransactions', region: 'asia-east1', args: [{ accountId: 'account-one', pageSize: 17 }], input: { accountId: 'account-one', pageSize: 17 } },
  { group: 'cashbook', name: 'listExpenseVouchers', region: 'asia-east1', args: [{ pageSize: 19 }], input: { pageSize: 19 } },
  { group: 'finance', name: 'listFinanceLedger', region: 'asia-east1', args: [{ branchId: 'branch-one', pageSize: 23, status: 'posted', cursor: 'opaque-cursor', types: ['payment'] }], input: { pageSize: 23, status: 'posted', branchId: 'branch-one', cursor: 'opaque-cursor', types: ['payment'] } },
  { group: 'renewal', name: 'listRenewalMessageTemplates', region: 'asia-east1', args: [], input: {} },
  { group: 'renewal', name: 'listContractRenewalCases', region: 'asia-east1', args: [{ pageSize: 50, optionsMode: 'filters', cursor: 'case-one' }], input: { pageSize: 50, optionsMode: 'filters', cursor: 'case-one' } },
  { group: 'renewal', name: 'getContractRenewalCaseDetail', region: 'asia-east1', args: ['case-one'], input: { caseId: 'case-one' } },
  { group: 'renewal', name: 'listRenewalCalendar', region: 'asia-east1', args: [{ from: '2026-10-01', to: '2026-10-31' }], input: { from: '2026-10-01', to: '2026-10-31' } },
  { group: 'renewal', name: 'getRenewalAnalytics', region: 'asia-east1', args: [{ from: '2026-10-01', to: '2026-10-31' }], input: { from: '2026-10-01', to: '2026-10-31' } },
  { group: 'loyalty', name: 'listLoyaltyAccounts', region: 'asia-southeast2', args: [{ pageSize: 100, studentId: 'student-one' }], input: { pageSize: 100, studentId: 'student-one' } },
  { group: 'loyalty', name: 'listLoyaltyRedemptions', region: 'asia-southeast2', args: ['pending'], input: { status: 'pending' } },
  { group: 'loyalty', name: 'listLoyaltyAdjustments', region: 'asia-southeast2', args: [], input: { status: 'pending_approval' } },
  { group: 'loyalty', name: 'listLoyaltyReconciliationIssues', region: 'asia-southeast2', args: [], input: { status: 'open' } },
  { group: 'exercise', name: 'listExerciseCatalog', region: 'asia-southeast2', args: [{ query: 'squat', pageSize: 12, cursor: 'exercise-one' }], input: { query: 'squat', pageSize: 12, cursor: 'exercise-one' } },
  { group: 'exercise', name: 'getExerciseCatalogItem', region: 'asia-southeast2', args: ['exercise-one'], input: { exerciseId: 'exercise-one' } },
  { group: 'nutrition', name: 'getInternalNutritionCatalogItem', region: 'asia-southeast2', args: ['food-one'], input: { id: 'food-one' } },
].map((operation) => ({ ...operation, timeout: operation.name === 'listRenewalMessageTemplates' ? 18_000 : operation.name === 'getInternalNutritionCatalogItem' ? 30_000 : 70_000 }))
const plain = (value: unknown) => JSON.parse(JSON.stringify(value))
const invoke = (service: any, operation: typeof operations[number]) => service[operation.group][operation.name](...operation.args)

test('all seventeen real service callers use the correct regional export with one bounded request', async () => {
  const backend = readFileSync('functions/index.js', 'utf8')
  for (const operation of operations) {
    const { service, requests, issues } = await fixture()
    const originalArgs = plain(operation.args)
    await invoke(service, operation)
    assert.equal(requests.length, 1, operation.name)
    assert.equal(requests[0].region, operation.region)
    assert.equal(requests[0].name, `${operation.name}Regional`)
    assert.equal(requests[0].timeout, operation.timeout)
    assert.deepEqual(plain(requests[0].input), { ...operation.input, correlationId: 'correlation-1' })
    assert.deepEqual(plain(operation.args), originalArgs, 'caller input is not mutated')
    assert.equal(issues.length, 0)
    assert.ok(backend.includes(`exports.${operation.name}Regional =`))
  }
})

test('only four explicit infrastructure codes permit one Singapore fallback with the same correlation and payload', async () => {
  for (const operation of operations) {
    for (const code of ['unavailable', 'internal', 'deadline-exceeded', 'resource-exhausted']) {
      const { service, requests, issues, authRefreshes } = await fixture({ errors: [callableError(code)] })
      await invoke(service, operation)
      assert.deepEqual(requests.map(({ name, region }) => ({ name, region })), [
        { name: `${operation.name}Regional`, region: operation.region },
        { name: operation.name, region: 'asia-southeast1' },
      ])
      assert.equal(requests[0].input, requests[1].input)
      assert.equal(requests[0].input.correlationId, 'correlation-1')
      assert.ok(requests.every((request) => request.timeout === operation.timeout))
      assert.equal(issues.length, 0, 'successful recovery is not reported as a failure')
      assert.equal(authRefreshes(), 0)
    }
  }
})

test('business, auth, missing endpoint and unknown errors preserve identity and never cross regions', async () => {
  for (const operation of operations) {
    for (const code of ['unauthenticated', 'permission-denied', 'invalid-argument', 'failed-precondition', 'not-found', 'already-exists', 'aborted', 'cancelled', 'unknown']) {
      // A misleading message must not turn a business rejection into a retry.
      const error = callableError(code, '503 network failed quota 429')
      const { service, requests, authRefreshes } = await fixture({ errors: [error] })
      await assert.rejects(invoke(service, operation), (actual) => actual === error)
      assert.equal(requests.length, 1, `${operation.name}/${code}`)
      assert.equal(authRefreshes(), 0)
    }
  }
  for (const error of [new Error('Failed to fetch'), { message: 'rate exceeded' }, { code: 'auth/network-request-failed' }]) {
    const { service, requests } = await fixture({ errors: [error] })
    await assert.rejects(service.cashbook.listCashAccounts(), (actual) => actual === error)
    assert.equal(requests.length, 1)
  }
})

test('a failing Singapore fallback stops at two requests and reports only its original final failure', async () => {
  for (const operation of operations) {
    const finalError = callableError('unavailable', 'second region unavailable')
    const { service, requests, issues } = await fixture({ errors: [callableError('internal'), finalError], telemetryThrows: true })
    await assert.rejects(invoke(service, operation), (actual) => actual === finalError)
    assert.equal(requests.length, 2)
    assert.equal(issues.length, 1)
    assert.equal(issues[0][1], finalError)
    assert.equal((issues[0][2] as any).correlationId, requests[0].input.correlationId)
    assert.equal((issues[0][2] as any).phase, `secondary_read_${operation.name}`)
    assert.equal(JSON.stringify(issues[0][2]).includes('account-one'), false, 'no request data in telemetry')
  }
})

test('missing regional clients use Singapore once, while wrong-region clients fail closed', async () => {
  for (const operation of operations) {
    const key = operation.region === 'asia-east1' ? 'east' : 'jakarta'
    const missing = await fixture({ [key]: null })
    await invoke(missing.service, operation)
    assert.equal(missing.requests.length, 1)
    assert.equal(missing.requests[0].region, 'asia-southeast1')
    assert.equal(missing.requests[0].name, operation.name)
    const failure = callableError('unavailable')
    const failedMissing = await fixture({ [key]: null, errors: [failure] })
    await assert.rejects(invoke(failedMissing.service, operation), (actual) => actual === failure)
    assert.equal(failedMissing.requests.length, 1)
    const misconfigured = await fixture({ [key]: 'asia-southeast1' })
    await assert.rejects(invoke(misconfigured.service, operation), (error: any) => error.code === 'functions/failed-precondition')
    assert.equal(misconfigured.requests.length, 0)
  }
})

test('regional success does not require Singapore, and absent/wrong Singapore never creates an unbounded fallback', async () => {
  const regionalOnly = await fixture({ sg: null })
  await regionalOnly.service.cashbook.listCashAccounts()
  assert.equal(regionalOnly.requests.length, 1)
  const error = callableError('unavailable')
  const unavailable = await fixture({ sg: null, errors: [error] })
  await assert.rejects(unavailable.service.cashbook.listCashAccounts(), (actual) => actual === error)
  assert.equal(unavailable.requests.length, 1)
  const wrong = await fixture({ sg: 'asia-east1', errors: [error] })
  await assert.rejects(wrong.service.cashbook.listCashAccounts(), (actual: any) => actual.code === 'functions/failed-precondition')
  assert.equal(wrong.requests.length, 1)
  const absent = await fixture({ sg: null, east: null })
  await assert.rejects(absent.service.cashbook.listCashAccounts())
  assert.equal(absent.requests.length, 0)
})

test('unauthenticated callers are rejected locally without a read or token refresh', async () => {
  for (const operation of operations) {
    const { service, requests, authRefreshes } = await fixture({ uid: null })
    await assert.rejects(invoke(service, operation), (error: any) => error.code === 'functions/unauthenticated')
    assert.equal(requests.length, 0)
    assert.equal(authRefreshes(), 0)
  }
})

test('account switch/logout during a primary response prevents stale data and cross-account fallback', async () => {
  for (const operation of operations) {
    for (const logout of [true, false]) {
      for (const errors of [[], [callableError('unavailable')]]) {
        const { service, requests } = await fixture({ errors, onInvoke: (_request, auth) => {
          auth.currentUser = logout ? null : { uid: 'actor-two', getIdToken: async () => 'other-token' }
        } })
        await assert.rejects(invoke(service, operation), (error: any) => error.code === 'functions/unauthenticated')
        assert.equal(requests.length, 1)
      }
    }
  }
})

test('account change during a fallback or direct Singapore response also discards stale data', async () => {
  for (const operation of operations) {
    for (const missingRegional of [false, true]) {
      const key = operation.region === 'asia-east1' ? 'east' : 'jakarta'
      const { service, requests } = await fixture({ ...(missingRegional ? { [key]: null } : { errors: [callableError('unavailable')] }),
        onInvoke: (request, auth) => { if (request.region === 'asia-southeast1') auth.currentUser = null },
      })
      await assert.rejects(invoke(service, operation), (error: any) => error.code === 'functions/unauthenticated')
      assert.equal(requests.length, missingRegional ? 1 : 2)
    }
  }
})

test('all callers retain response parsing, defaults and staged exercise-detail compatibility', async () => {
  const { service, requests } = await fixture()
  assert.deepEqual(plain(await service.cashbook.listCashAccounts()), responseFor('listCashAccounts'))
  assert.deepEqual(plain(await service.cashbook.listAccountingCatalog()), responseFor('listAccountingCatalog'))
  assert.deepEqual(plain(await service.cashbook.listCashTransactions()), responseFor('listCashTransactions'))
  assert.deepEqual(plain(await service.cashbook.listExpenseVouchers()), responseFor('listExpenseVouchers'))
  assert.deepEqual(plain(await service.renewal.listRenewalMessageTemplates()), responseFor('listRenewalMessageTemplates'))
  assert.deepEqual(plain(await service.nutrition.getInternalNutritionCatalogItem('food-one')), { id: 'food-one' })
  const ledger = await service.finance.listFinanceLedger()
  assert.equal(ledger.summary.collectedAmount, 12)
  assert.equal(ledger.summary.cashNet, 10)
  assert.equal(ledger.source, 'ledgerEntries')
  assert.equal(ledger.canonicalOnly, true)
  assert.deepEqual(plain(requests.at(-1)?.input), { pageSize: 50, status: 'all', correlationId: 'correlation-7' })
  const detail = await service.exercise.getExerciseCatalogItem('exercise-one')
  assert.equal(detail.item.nameVi, 'Bài tập')
  assert.equal(detail.item, detail.editItem)
  const editable = await fixture({ response: { item: { id: 'one', nameVi: 'Published' }, editItem: { id: 'one', nameVi: 'Draft', revision: 2 } } })
  assert.equal((await editable.service.exercise.getExerciseCatalogItem('one')).editItem.nameVi, 'Draft')
  for (const response of [{}, { item: null }, { item: { id: 'one' } }]) {
    const invalid = await fixture({ response })
    await assert.rejects(invalid.service.exercise.getExerciseCatalogItem('one'), /Dữ liệu bài tập không hợp lệ/)
    assert.equal(invalid.requests.length, 1, 'a parse failure is not a transport failure')
  }
})

test('regional exercise listing preserves populated pages, cursor metadata and full coaching fields', async () => {
  const response = { schemaVersion: 2, items: [
    { id: 'exercise-one', nameVi: ' Bài tập chân ', status: 'published', instructionsVi: ['Giữ lưng thẳng'],
      cuesVi: ['Thở đều'], breathingVi: 'Thở ra khi đứng lên', bodyParts: ['legs'],
      media: { images: [{ id: 'image-one', url: 'https://example.com/one.webp', role: 'start', order: 0 }], videos: [] } },
    { id: 'invalid-no-name' },
  ], hasMore: true, nextCursor: 'last-inspected', total: null, scanned: 37, pageSize: 36 }
  const { service, requests } = await fixture({ response })
  const page = await service.exercise.listExerciseCatalogPage({ pageSize: 36 })
  assert.equal(page.items.length, 1)
  assert.equal(page.items[0].nameVi, 'Bài tập chân')
  assert.deepEqual(plain(page.items[0].instructionsVi), ['Giữ lưng thẳng'])
  assert.deepEqual(plain(page.items[0].cuesVi), ['Thở đều'])
  assert.equal(page.items[0].media.images[0].url, 'https://example.com/one.webp')
  assert.equal(page.hasMore, true)
  assert.equal(page.nextCursor, 'last-inspected')
  assert.equal(page.total, null)
  assert.equal(page.scanned, 37)
  assert.equal(page.pageSize, 36)
  assert.equal(requests[0].name, 'listExerciseCatalogRegional')
  assert.equal(requests[0].region, 'asia-southeast2')
  assert.equal(requests.length, 1)
})

test('concurrent and repeated money reads are not cached or coalesced, including across mutation', async () => {
  const { service, requests } = await fixture()
  await Promise.all([service.cashbook.listCashAccounts(), service.cashbook.listCashAccounts()])
  await service.cashbook.recordCashExpense({ accountId: 'account-one', amount: 5, category: 'other', effectiveAt: '2026-10-24', idempotencyKey: 'operation-one' })
  await service.cashbook.listCashAccounts()
  await Promise.all([service.finance.listFinanceLedger(), service.finance.listFinanceLedger()])
  assert.equal(requests.filter((request) => request.name === 'listCashAccountsRegional').length, 3)
  assert.equal(requests.filter((request) => request.name === 'listFinanceLedgerRegional').length, 2)
  const reads = requests.filter((request) => request.name.endsWith('Regional'))
  assert.equal(new Set(reads.map((request) => request.input.correlationId)).size, 5)
  const mutation = requests.find((request) => request.name === 'recordCashExpense')!
  assert.equal(mutation.region, 'asia-southeast1')
  assert.equal(mutation.input.idempotencyKey, 'operation-one')
  assert.equal('correlationId' in mutation.input, false)
})

test('runtime allowlist rejects every mutation and prototype key before Firebase I/O', async () => {
  const { service, requests } = await fixture()
  for (const name of ['recordContractPayment', 'recordRefund', 'recordCashExpense', 'transferCash', 'renewPtContract', 'saveExerciseCatalogDraft', 'publishExerciseCatalogItem', 'listReceiptVouchers', 'toString', '__proto__', 'constructor']) {
    await assert.rejects(service.callSecondaryRead(name, {}), (error: any) => error.code === 'functions/invalid-argument')
  }
  assert.equal(requests.length, 0)
})

test('actual mutation callers remain single-attempt with their existing region and idempotency key', async () => {
  const mutations = [
    { group: 'cashbook', name: 'initializeCashAccount', args: [{ idempotencyKey: 'operation-one' }], region: 'asia-southeast1' },
    { group: 'cashbook', name: 'recordCashExpense', args: [{ idempotencyKey: 'operation-one' }], region: 'asia-southeast1' },
    { group: 'cashbook', name: 'transferCash', args: [{ idempotencyKey: 'operation-one' }], region: 'asia-southeast1' },
    { group: 'cashbook', name: 'approveAndPostExpenseVoucher', args: [{ voucherId: 'voucher-one', expectedRevision: 2 }], region: 'asia-southeast1' },
    { group: 'finance', name: 'recordContractPayment', args: [{ idempotencyKey: 'operation-one' }], region: 'asia-southeast1' },
    { group: 'finance', name: 'recordRefund', args: [{ idempotencyKey: 'operation-one' }], region: 'asia-southeast1' },
    { group: 'finance', name: 'reverseContractPayment', args: ['entry-one', 'reason'], region: 'asia-southeast1' },
    { group: 'renewal', name: 'renewPtContract', args: [{ idempotencyKey: 'operation-one' }], region: 'asia-east1', wireName: 'renewPtContractRegional' },
    { group: 'loyalty', name: 'adjustLoyaltyBalance', args: [{ studentId: 'student-one', points: 10, reason: 'fixture', idempotencyKey: 'operation-one' }], region: 'asia-southeast1' },
    { group: 'exercise', name: 'saveExerciseCatalogDraft', args: [{ exerciseId: 'exercise-one', expectedRevision: 2, draft: {} }], region: 'asia-southeast1' },
    { group: 'exercise', name: 'publishExerciseCatalogItem', args: ['exercise-one', 2], region: 'asia-southeast1' },
  ]
  for (const mutation of mutations) {
    for (const code of ['internal', 'unavailable', 'deadline-exceeded', 'resource-exhausted']) {
      const { service, requests } = await fixture({ errors: [callableError(code)] })
      await assert.rejects(service[mutation.group][mutation.name](...mutation.args))
      assert.equal(requests.length, 1, `${mutation.name}/${code}`)
      assert.equal(requests[0].region, mutation.region)
      assert.equal(requests[0].name, mutation.wireName ?? mutation.name)
      if ('idempotencyKey' in Object(mutation.args[0])) assert.equal(requests[0].input.idempotencyKey, 'operation-one')
      if (mutation.name === 'reverseContractPayment') assert.equal(requests[0].input.idempotencyKey, 'mutation-operation-id')
    }
  }
})

test('out-of-wave reads retain their original wire endpoints', async () => {
  const { service, requests } = await fixture()
  await service.cashbook.listReceiptVouchers({ pageSize: 7 })
  await service.loyalty.getStudentLoyaltySummary('student-one')
  await service.nutrition.listInternalNutritionCatalog({ limit: 11 })
  assert.deepEqual(requests.map(({ region, name }) => ({ region, name })), [
    { region: 'asia-southeast1', name: 'listReceiptVouchers' },
    { region: 'asia-southeast2', name: 'getStudentLoyaltySummaryRegional' },
    { region: 'asia-southeast1', name: 'listInternalNutritionCatalog' },
  ])
})
