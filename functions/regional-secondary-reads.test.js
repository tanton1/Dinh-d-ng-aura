'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { execFileSync } = require('node:child_process')
const { onCall: firebaseOnCall } = require('firebase-functions/v2/https')
const { createRegionalSecondaryReadAliases, SECONDARY_READ_OPTIONS, SECONDARY_READ_TARGETS } = require('./regional-secondary-reads')
const { createCashbookFunctions } = require('./cashbook')
const { createFinanceLedgerFunctions } = require('./finance-ledger')
const { createContractRenewalFunctions } = require('./contract-renewals')
const { createIdentityAccessFunctions } = require('./identity-access')
const { createExerciseCatalogFunctions } = require('./exercise-catalog')
const { createLoyaltyFunctions } = require('./loyalty')

const capture = (optionsOrHandler, maybeHandler) => typeof optionsOrHandler === 'function'
  ? { options: {}, handler: optionsOrHandler }
  : { options: optionsOrHandler, handler: maybeHandler }
const noDatabase = new Proxy({}, { get() { throw new Error('Unexpected database access') } })
const noAuth = new Proxy({}, { get() { throw new Error('Unexpected Auth mutation or lookup') } })
const expected = [
  ['listAccountingCatalogRegional', 'cashbook', 'asia-east1'],
  ['listCashAccountsRegional', 'cashbook', 'asia-east1'],
  ['listCashTransactionsRegional', 'cashbook', 'asia-east1'],
  ['listExpenseVouchersRegional', 'cashbook', 'asia-east1'],
  ['listFinanceLedgerRegional', 'finance', 'asia-east1'],
  ['listRenewalMessageTemplatesRegional', 'renewal', 'asia-east1'],
  ['listContractRenewalCasesRegional', 'renewal', 'asia-east1'],
  ['getContractRenewalCaseDetailRegional', 'renewal', 'asia-east1'],
  ['listRenewalCalendarRegional', 'renewal', 'asia-east1'],
  ['getRenewalAnalyticsRegional', 'renewal', 'asia-east1'],
  ['listLoyaltyAccountsRegional', 'loyalty', 'asia-southeast2'],
  ['listLoyaltyRedemptionsRegional', 'loyalty', 'asia-southeast2'],
  ['listLoyaltyAdjustmentsRegional', 'loyalty', 'asia-southeast2'],
  ['listLoyaltyReconciliationIssuesRegional', 'loyalty', 'asia-southeast2'],
  ['listExerciseCatalogRegional', 'exercise', 'asia-southeast2'],
  ['getExerciseCatalogItemRegional', 'exercise', 'asia-southeast2'],
  ['getInternalNutritionCatalogItemRegional', 'identity', 'asia-southeast2'],
]
function canonical(db) {
  return {
    cashbook: createCashbookFunctions({ db, onCall: capture }),
    finance: createFinanceLedgerFunctions({ db, onCall: capture }),
    renewal: createContractRenewalFunctions({ db, onCall: capture }),
    exercise: createExerciseCatalogFunctions({ db, onCall: capture }),
    identity: createIdentityAccessFunctions({ db, auth: noAuth, onCall: capture }),
    loyalty: createLoyaltyFunctions({ db, onCall: capture }),
  }
}
const inputs = {
  listCashTransactionsRegional: { accountId: 'account-one', pageSize: 1000 },
  listExpenseVouchersRegional: { pageSize: 1000 },
  listFinanceLedgerRegional: { pageSize: 20 },
  listContractRenewalCasesRegional: { optionsMode: 'filters', pageSize: 20 },
  getContractRenewalCaseDetailRegional: { caseId: 'case-one' },
  listRenewalCalendarRegional: { from: '2026-10-24', to: '2026-10-31' },
  getRenewalAnalyticsRegional: { from: '2026-10-01', to: '2026-10-31' },
  listLoyaltyAccountsRegional: { pageSize: 20 },
  listExerciseCatalogRegional: { pageSize: 12 },
  getExerciseCatalogItemRegional: { exerciseId: 'exercise-one' },
  getInternalNutritionCatalogItemRegional: { id: 'food-one' },
}

// Any persistent mutation on DB, query, document, batch or Auth is a tripwire.
// Only the actual canonical read handlers run; no mocked authorization helpers.
function readOnlyDb({ role = 'admin', disabled = false, assignment, profileExists = true, exerciseStatus = 'published', seed = {} } = {}) {
  const reads = [], writes = []
  const records = new Map(Object.entries({
    'users/reader': { role, disabled, displayName: 'Test reader', branchId: 'branch-one' },
    'exercises/exercise-one': { status: exerciseStatus, nameVi: 'Test exercise', nameEn: 'Test exercise' },
    'nutritionCatalog/food-one': { kind: 'food', nameVi: 'Test food', energyKcal: 100 },
    'cashAccounts/account-one': { name: 'Account one', branchId: 'branch-one', balance: 100 },
    'cashTransactions/transaction-one': { accountId: 'account-one', amount: 100, branchId: 'branch-one' },
    'accountingDocuments/voucher-one': { documentType: 'expense_voucher', amount: 100, status: 'draft' },
    'contractRenewalCases/case-one': { studentId: 'student-one', branchId: 'branch-one', active: true, contractSnapshot: {} },
    ...seed,
  }))
  if (!profileExists) records.delete('users/reader')
  if (assignment) records.set('roleAssignments/reader', assignment)
  const mutation = operation => (...args) => { writes.push(operation); throw new Error(`Persistent write forbidden: ${operation}`) }
  const guard = object => new Proxy(object, { get(target, key) {
    if (['set', 'create', 'update', 'delete', 'add', 'commit', 'runTransaction', 'batch', 'bulkWriter', 'setCustomUserClaims', 'updateUser'].includes(key)) return mutation(String(key))
    return Reflect.get(target, key)
  } })
  const snapshot = reference => ({
    id: reference.id, ref: reference, exists: records.has(reference.path),
    data: () => records.get(reference.path),
  })
  const document = path => guard({
    path, id: path.split('/').at(-1),
    async get() { reads.push({ path, type: 'document' }); return snapshot(this) },
  })
  function collection(path, operations = []) {
    const reference = { path, doc: id => document(`${path}/${id}`) }
    for (const operation of ['orderBy', 'where', 'limit', 'select', 'startAfter']) {
      reference[operation] = (...args) => collection(path, [...operations, { operation, args }])
    }
    reference.get = async () => {
      reads.push({ path, type: 'query', operations })
      let rows = [...records].filter(([key]) => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length+1)
      for (const { operation, args } of operations) {
        if (operation === 'where' && args[1] === '==') rows = rows.filter(([, value]) => value[args[0]] === args[2])
        if (operation === 'where' && args[1] === 'in') rows = rows.filter(([, value]) => args[2].includes(value[args[0]]))
        if (operation === 'limit') rows = rows.slice(0, args[0])
      }
      const docs = rows.map(([key]) => snapshot(document(key)))
      return { docs, size: docs.length, empty: !docs.length }
    }
    reference.count = () => ({ get: async () => { const result = await reference.get(); return { data: () => ({ count: result.size }) } } })
    return guard(reference)
  }
  return { db: guard({ doc: document, collection, getAll: (...refs) => Promise.all(refs.map(ref => ref.get())) }), reads, writes, records }
}
const request = (data = {}, role = 'admin') => ({ auth: { uid: 'reader', token: { role } }, data })

test('only seventeen reviewed reads register real callable endpoints; regional resources stay fractional and min0', () => {
  const registrations = []
  const aliases = createRegionalSecondaryReadAliases({ db: noDatabase, auth: noAuth, onCall: (...args) => { registrations.push(args); return capture(...args) } })
  assert.deepEqual(SECONDARY_READ_TARGETS.map(({name,factory,region}) => [name,factory,region]), expected)
  assert.deepEqual(Object.keys(aliases), expected.map(([name]) => name))
  assert.equal(registrations.length, 17)
  for (const [name, , region] of expected) {
    const options = aliases[name].options
    assert.equal(options.region, region)
    for (const [key, value] of Object.entries(SECONDARY_READ_OPTIONS)) {
      assert.equal(options[key], key === 'maxInstances' && name === 'listCashAccountsRegional' ? 1 : value, `${name}.${key}`)
    }
    assert.equal(options.secrets, undefined)
  }
  assert.equal(aliases.renewPtContractRegional, undefined)
  assert.equal(aliases.saveExerciseCatalogDraftRegional, undefined)
  assert.equal(aliases.initializeCashAccountRegional, undefined)
  assert.equal(aliases.refreshContractRenewalQueueScheduled, undefined)
})

test('aliases use the exact canonical handlers and reject unauthenticated requests before any DB/Auth access', async () => {
  const aliases = createRegionalSecondaryReadAliases({ db: noDatabase, auth: noAuth, onCall: capture })
  const originals = canonical(noDatabase)
  for (const {name,canonical:originalName,factory} of SECONDARY_READ_TARGETS) {
    assert.equal(aliases[name].handler.toString(), originals[factory][originalName].handler.toString())
    await assert.rejects(() => aliases[name].handler({data:inputs[name] || {}}), {code:'unauthenticated'}, name)
  }
})

test('real SDK metadata retains caller App Check/invoker policy and exports no background or secret-bound endpoints', () => {
  for (const enforceAppCheck of [false, true]) {
    const optionsByHandler = new Map()
    const aliases = createRegionalSecondaryReadAliases({ db:noDatabase, auth:noAuth, onCall(options, handler) {
      const inherited = { invoker:'public', enforceAppCheck, ...options }
      optionsByHandler.set(handler, inherited)
      const endpoint = firebaseOnCall(inherited, handler)
      endpoint.capturedOptions = inherited
      return endpoint
    } })
    for (const [name, , region] of expected) {
      const endpoint = aliases[name].__endpoint
      assert.deepEqual(endpoint.region, [region])
      assert.ok(endpoint.callableTrigger)
      assert.equal(endpoint.eventTrigger, undefined)
      assert.equal(endpoint.scheduleTrigger, undefined)
      assert.equal(endpoint.availableMemoryMb, 256)
      assert.equal(endpoint.cpu, 0.1666)
      assert.equal(endpoint.minInstances, 0)
      assert.equal(endpoint.maxInstances, name === 'listCashAccountsRegional' ? 1 : 2)
      assert.equal(endpoint.concurrency, 1)
      assert.equal(endpoint.timeoutSeconds, 60)
      assert.equal(aliases[name].capturedOptions.enforceAppCheck, enforceAppCheck)
      assert.equal(aliases[name].capturedOptions.invoker, 'public')
      assert.equal(aliases[name].capturedOptions.secrets, undefined)
    }
    assert.equal(optionsByHandler.size, 17)
  }
})

test('authenticated success paths preserve canonical responses without any persistent writes', async () => {
  for (const {name,canonical:originalName,factory} of SECONDARY_READ_TARGETS) {
    const state = readOnlyDb()
    const aliases = createRegionalSecondaryReadAliases({ db:state.db, auth:noAuth, onCall:capture })
    const originals = canonical(state.db)
    const input = request(inputs[name])
    const result = await aliases[name].handler(input)
    const original = await originals[factory][originalName].handler(input)
    if (name === 'listContractRenewalCasesRegional') {
      assert.ok(result.generatedAt)
      assert.deepEqual({ ...result, generatedAt: '' }, { ...original, generatedAt: '' }, name)
    } else assert.deepEqual(result, original, name)
    assert.deepEqual(state.writes, [], name)
    assert.ok(state.reads.some(read => read.path === 'users/reader'), name)
  }
})

test('missing/disabled accounts and stale role claims remain denied for every alias', async () => {
  for (const fixture of [
    { profileExists:false },
    { disabled:true },
    { assignment:{accessRole:'staff',positions:['trainer_pt'],branchIds:['branch-one'],status:'active',authzVersion:2} },
  ]) for (const [name] of expected) {
    const state = readOnlyDb(fixture)
    const aliases = createRegionalSecondaryReadAliases({db:state.db,auth:noAuth,onCall:capture})
    await assert.rejects(() => aliases[name].handler(request(inputs[name])), {code:'permission-denied'}, name)
    assert.deepEqual(state.writes, [])
    assert.ok(state.reads.every(read => read.path.startsWith('users/') || read.path.startsWith('roleAssignments/')), name)
  }
})

test('finance and renewal capability guards are unchanged; learners cannot enumerate protected data', async () => {
  for (const [name] of expected.filter(([, factory]) => ['cashbook', 'finance', 'renewal', 'loyalty'].includes(factory))) {
    const state = readOnlyDb({role:'student'})
    const aliases = createRegionalSecondaryReadAliases({db:state.db,auth:noAuth,onCall:capture})
    await assert.rejects(() => aliases[name].handler(request(inputs[name],'student')), {code:'permission-denied'}, name)
    assert.ok(state.reads.every(read => /^(users|roleAssignments)\//.test(read.path)), name)
    assert.deepEqual(state.writes, [])
  }
})

test('exercise detail preserves published-only learner access and staff draft access', async () => {
  for (const [role,status,allowed] of [['student','published',true],['student','draft',false],['trainer','draft',true]]) {
    const state = readOnlyDb({role,exerciseStatus:status})
    const aliases = createRegionalSecondaryReadAliases({db:state.db,auth:noAuth,onCall:capture})
    const read = () => aliases.getExerciseCatalogItemRegional.handler(request(inputs.getExerciseCatalogItemRegional,role))
    if (allowed) assert.equal((await read()).item.status,status)
    else await assert.rejects(read,{code:'permission-denied'})
    assert.deepEqual(state.writes, [])
  }
})

test('canonical finance query bounds and account filters are preserved by the alias', async () => {
  const state = readOnlyDb()
  const aliases = createRegionalSecondaryReadAliases({db:state.db,auth:noAuth,onCall:capture})
  for (const name of ['listCashAccountsRegional','listCashTransactionsRegional','listExpenseVouchersRegional']) await aliases[name].handler(request(inputs[name]))
  const query = collection => state.reads.find(read => read.path === collection && read.type === 'query')
  assert.deepEqual(query('cashAccounts').operations.find(item => item.operation === 'limit').args,[200])
  assert.deepEqual(query('cashTransactions').operations.find(item => item.operation === 'limit').args,[100])
  assert.deepEqual(query('cashTransactions').operations.find(item => item.operation === 'where').args,['accountId','==','account-one'])
  assert.deepEqual(query('accountingDocuments').operations.find(item => item.operation === 'limit').args,[300])
  assert.deepEqual(state.writes, [])
})

test('Student360 discovery omits exercise alias without loading its provider secret module', () => {
  const script = `const assert=require('node:assert/strict');const {createRegionalSecondaryReadAliases}=require('./regional-secondary-reads');const result=createRegionalSecondaryReadAliases({db:{},auth:{},onCall:(options,handler)=>({options,handler}),includeExerciseCatalog:false});assert.equal(Object.keys(result).length,15);assert.equal(result.getExerciseCatalogItemRegional,undefined);assert.equal(result.listExerciseCatalogRegional,undefined);assert.equal(Object.keys(require.cache).some(file=>file.endsWith('/exercise-catalog.js')||file.endsWith('\\\\exercise-catalog.js')),false);`
  execFileSync(process.execPath,['-e',script],{cwd:__dirname,stdio:'pipe'})
  const source = readFileSync(join(__dirname,'index.js'),'utf8')
  assert.match(source,/includeExerciseCatalog: !isStudent360Discovery/)
  for (const [name] of expected) assert.match(source,new RegExp(`exports\\.${name} = regionalSecondaryReads\\.${name}\\b`))
  assert.doesNotMatch(source,/Object\.assign\(exports, regionalSecondaryReads\)/)
})
