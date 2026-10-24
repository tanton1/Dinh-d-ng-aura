'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createContractRenewalFunctions } = require('./contract-renewals')
const { vietnamDateKey, addDateDays } = require('./pt-policy')

const systemActor = { uid: 'actor', renewalScope: 'system', renewalAudience: 'operations', renewalCanSell: true,
  renewalCanViewSalesCases: true, renewalCanViewTrainerCases: true, branchIds: [], capabilities: ['renewals.approval.manage'] }
const actors = [
  systemActor,
  { ...systemActor, renewalScope: 'branch', branchIds: ['a'] },
  { ...systemActor, uid: 'sales-a', renewalScope: 'self', renewalAudience: 'sales', branchIds: ['a'], renewalCanViewTrainerCases: false },
  { ...systemActor, uid: 'trainer', renewalScope: 'self', renewalAudience: 'trainer', renewalCanSell: false, renewalCanViewSalesCases: false, branchIds: ['a'] },
]
const queueCase = index => ({
  id: `case-${String(index).padStart(4, '0')}`, branchId: index % 2 ? 'b' : 'a', branchName: index % 2 ? 'Branch B' : 'Branch A',
  assignedSalesId: index % 2 ? 'sales-b' : 'sales-a', assignedSalesName: index % 2 ? 'Sales B' : 'Sales A',
  studentId: `student-${index}`, studentSnapshot: { name: `Member ${index}`, phone: `09${index}` },
  active: true, stage: ['uncontacted', 'contacted', 'follow_up'][index % 3], revision: 4,
  expectedValue: 1000 + index, priorityScore: 50 - index, riskCategory: 'critical', daysLeft: index - 4, sessionsLeft: index % 5,
  nextActionAt: addDateDays(vietnamDateKey(), index - 4), slaDueAt: addDateDays(vietnamDateKey(), 2),
  contractSnapshot: { id: `source-${index}`, trainerId: 'trainer', trainerIds: ['trainer'], totalPrice: 1000, paidAmount: 200, discount: 50 },
})

function fixture({ actor = systemActor, actualAuth = false, role = 'admin', disabled = false, forbidFinancialOptions = false, allowPreparation = false, caseCount = 12 } = {}) {
  const values = {
    contractRenewalCases: Array.from({ length: caseCount }, (_, index) => queueCase(index)),
    branches: [{ id: 'a', name: 'Branch A' }, { id: 'b', name: 'Branch B' }],
    packages: Array.from({ length: 30 }, (_, index) => ({ id: `package-${index}`, name: `Package ${index}`, price: 1000 + index, totalSessions: 12, durationMonths: 1, branchId: index % 3 === 0 ? '' : index % 2 ? 'b' : 'a', status: index === 0 ? 'archived' : index === 1 ? 'inactive' : 'active' })),
    cashAccounts: Array.from({ length: 8 }, (_, index) => ({ id: `cash-${index}`, name: `Account ${index}`, status: 'active', branchId: index % 2 ? 'b' : 'a', type: 'bank' })),
    roleAssignments: [
      { id: 'sales-a', status: 'active', positions: ['sales'], branchIds: ['a'] },
      { id: 'sales-b', status: 'active', positions: ['sales'], branchIds: ['b'] },
      { id: 'inactive', status: 'suspended', positions: ['sales'], branchIds: ['a'] },
      { id: 'trainer', status: 'active', positions: ['trainer_pt'], branchIds: ['a'] },
    ],
    users: [{ id: 'sales-a', displayName: 'Fresh Sales A' }, { id: 'actor', role, disabled }],
    contracts: [], students: [], sessions: [],
  }
  // Budget counts returned query documents plus explicit document lookups;
  // excludes minimum charges for empty queries and index-entry billing.
  const reads = [], writes = []
  const snapshot = (value, id = value?.id) => ({ id, exists: Boolean(value), data: () => value })
  const field = (value, dotted) => dotted.split('.').reduce((result, key) => result?.[key], value)
  const query = (collection, filters = [], maximum = Infinity) => ({
    where: (key, operator, expected) => query(collection, [...filters, [key, operator, expected]], maximum),
    limit: count => query(collection, filters, count),
    get: async () => {
      const selected = values[collection].filter(value => filters.every(([key, operator, expected]) => {
        const actual = field(value, key)
        if (operator === '==') return actual === expected
        if (operator === 'array-contains') return Array.isArray(actual) && actual.includes(expected)
        throw new Error(`Unexpected filter ${operator}`)
      })).slice(0, maximum)
      reads.push({ kind: 'query', collection, filters, maximum, returned: selected.length })
      return { docs: selected.map(value => snapshot(value)), size: selected.length, empty: !selected.length }
    },
  })
  const db = {
    collection(collection) {
      assert(Object.hasOwn(values, collection), `Unexpected collection ${collection}`)
      if (forbidFinancialOptions) assert(!['packages', 'cashAccounts'].includes(collection), 'Filter list must not even construct financial-option queries')
      return query(collection)
    },
    doc(path) {
      const [collection, id] = path.split('/')
      assert(Object.hasOwn(values, collection), `Unexpected document ${path}`)
      return { path, id, get: async () => {
        reads.push({ kind: 'document', collection, returned: 1 })
        return snapshot(values[collection].find(item => item.id === id), id)
      } }
    },
    getAll: (...references) => Promise.all(references.map(reference => reference.get())),
    runTransaction: async callback => {
      assert(allowPreparation, 'List call must not start transactions or write business data')
      return callback({ get: reference => reference.get(), set: (reference, value, options) => {
        assert.equal(reference.path.split('/')[0], 'contractRenewalCases', 'Prepare may only update its existing case projection')
        writes.push({ path: reference.path, value, options })
      } })
    },
    batch: () => { throw new Error('No batch/business writes permitted') },
  }
  const api = createContractRenewalFunctions({ db, onCall: (_options, handler) => handler,
    ...(actualAuth ? {} : { resolveActor: async () => actor }),
  })
  const run = (data = {}, endpoint = 'listContractRenewalCases') => api[endpoint]({ auth: { uid: 'actor', token: { role } }, data })
  return { api, values, reads, writes, run, readCount: () => reads.reduce((sum, item) => sum + item.returned, 0) }
}
const comparablePage = ({ generatedAt, options, optionsMode, packages, ...page }) => page
const forbiddenQueries = reads => reads.filter(read => ['packages', 'cashAccounts'].includes(read.collection))

test('filter mode eliminates both financial-option queries and saves exactly their returned documents', async () => {
  const full = fixture(), filters = fixture({ forbidFinancialOptions: true })
  const baseline = await full.run(), reduced = await filters.run({ optionsMode: 'filters' })
  assert.equal(full.readCount(), 58, '12 cases + 30 packages + 2 branches + 8 accounts + 4 assignments + 2 user lookups')
  assert.equal(filters.readCount(), 20, 'only 12 cases + 2 branches + 4 assignments + 2 user lookups')
  assert.equal(full.readCount() - filters.readCount(), 38)
  assert.equal(forbiddenQueries(filters.reads).length, 0)
  assert.deepEqual(reduced.options, { ...baseline.options, packages: [], cashAccounts: [] })
  assert.deepEqual(reduced.packages, [])
  assert.equal(reduced.optionsMode, 'filters')
  assert.deepEqual(comparablePage(reduced), comparablePage(baseline))
  assert.deepEqual(filters.writes, [])
})

test('omitted mode remains full and equals explicit full mode for both list endpoints', async () => {
  for (const endpoint of ['listContractRenewalCases', 'listContractRenewalPipeline']) {
    const f = fixture()
    const legacy = await f.run({}, endpoint), full = await f.run({ optionsMode: 'full' }, endpoint)
    assert.equal(legacy.optionsMode, 'full')
    assert.deepEqual({ ...legacy, generatedAt: '' }, { ...full, generatedAt: '' })
    assert(legacy.options.packages.length && legacy.options.cashAccounts.length)
    assert.deepEqual(legacy.packages, legacy.options.packages)
    assert.equal(forbiddenQueries(f.reads).length, 4)
  }
})

test('mode does not change scope, authorized filter dictionaries or trainer financial redaction', async () => {
  for (const actor of actors) {
    const full = fixture({ actor }), filters = fixture({ actor, forbidFinancialOptions: true })
    const baseline = await full.run(), reduced = await filters.run({ optionsMode: 'filters' })
    assert.deepEqual(comparablePage(reduced), comparablePage(baseline))
    assert.deepEqual(reduced.options.branches, baseline.options.branches)
    assert.deepEqual(reduced.options.assignees, baseline.options.assignees)
    if (actor.renewalScope !== 'system') assert.deepEqual(reduced.options.branches.map(branch => branch.id), ['a'])
    if (actor.renewalCanSell && actor.renewalScope !== 'system') assert.deepEqual(reduced.options.assignees.map(item => item.id), ['sales-a'])
    if (!actor.renewalCanSell) {
      assert.deepEqual(reduced.options.assignees, [])
      assert.equal(reduced.stats.pipelineValue, 0)
      assert(reduced.rows.every(row => row.expectedValue === 0 && row.contract.totalPrice === 0 && row.contract.paidAmount === 0))
    }
  }
})

test('all list filters/order/cursors keep original global-within-scope stats and identical case queries', async () => {
  for (const input of [
    { pageSize: 3 }, { branchId: 'a', stage: 'contacted', sort: 'value', pageSize: 1 },
    { assignedSalesId: 'sales-b', sort: 'follow_up', pageSize: 2 },
    { segment: 'expired_last_30d', pageSize: 2 }, { sla: 'overdue', search: 'member', pageSize: 2 },
  ]) {
    const full = fixture(), filters = fixture({ forbidFinancialOptions: true })
    let cursor
    do {
      const baseline = await full.run({ ...input, cursor })
      const reduced = await filters.run({ ...input, cursor, optionsMode: 'filters' })
      assert.deepEqual(comparablePage(reduced), comparablePage(baseline))
      assert.equal(reduced.stats.total, 12, 'stats remain across all accessible cases, not only selected list filter')
      cursor = baseline.nextCursor
    } while (cursor)
    assert.deepEqual(filters.reads.filter(read => read.collection === 'contractRenewalCases'), full.reads.filter(read => read.collection === 'contractRenewalCases'))
  }
})

test('case scan cap/truncated marker are unchanged and stale cursors still fail closed', async () => {
  const full = fixture({ caseCount: 5002 }), filters = fixture({ caseCount: 5002, forbidFinancialOptions: true })
  const baseline = await full.run({ pageSize: 1 }), reduced = await filters.run({ pageSize: 1, optionsMode: 'filters' })
  assert.deepEqual(comparablePage(reduced), comparablePage(baseline))
  assert.equal(reduced.truncated, true)
  assert.equal(reduced.stats.total, 5001)
  const cursor = Buffer.from(JSON.stringify({ id: 'missing-case' })).toString('base64url')
  await assert.rejects(full.run({ cursor, optionsMode: 'full' }), error => error.code === 'aborted')
  await assert.rejects(filters.run({ cursor, optionsMode: 'filters' }), error => error.code === 'aborted')
})

test('invalid mode types/values fail before business queries, with no coercion or silent fallback', async () => {
  for (const optionsMode of [null, '', false, 0, [], {}, 'FULL', ' filters ', 'compact']) {
    const f = fixture()
    await assert.rejects(f.run({ optionsMode }), error => error.code === 'invalid-argument')
    assert.deepEqual(f.reads, [])
    assert.deepEqual(f.writes, [])
  }
  const authenticated = fixture({ actualAuth: true })
  await assert.rejects(authenticated.run({ optionsMode: 'invalid' }), error => error.code === 'invalid-argument')
  assert(authenticated.reads.every(read => read.kind === 'document' && ['users', 'roleAssignments'].includes(read.collection)), 'only live authorization reads may precede input validation')
})

test('real authorization path still rejects missing auth, student and disabled accounts before collection reads', async () => {
  const absent = fixture({ actualAuth: true })
  await assert.rejects(absent.api.listContractRenewalCases({ data: { optionsMode: 'filters' } }), error => error.code === 'unauthenticated')
  assert.deepEqual(absent.reads, [])
  for (const options of [{ role: 'student' }, { disabled: true }]) {
    const f = fixture({ ...options, actualAuth: true })
    await assert.rejects(f.run({ optionsMode: 'filters' }), error => error.code === 'permission-denied')
    assert(f.reads.every(read => read.kind === 'document' && ['users', 'roleAssignments'].includes(read.collection)))
    assert.deepEqual(f.writes, [])
  }
  const allowed = fixture({ actualAuth: true, forbidFinancialOptions: true })
  assert.equal((await allowed.run({ optionsMode: 'filters' })).scope, 'system')
})

test('prepare always rereads fresh full sale/payment options, even after a filter-only list or misleading request mode', async () => {
  const f = fixture({ allowPreparation: true })
  await f.run({ optionsMode: 'filters' })
  assert.equal(forbiddenQueries(f.reads).length, 0)
  f.values.contracts.push({ id: 'source', studentId: 'student', branchId: 'a', status: 'active', totalSessions: 12, usedSessions: 0, startDate: vietnamDateKey(), endDate: addDateDays(vietnamDateKey(), 20), totalPrice: 500 })
  f.values.students.push({ id: 'student', name: 'Member', status: 'active', branchId: 'a' })
  const prepare = () => f.api.prepareContractRenewal({ data: { sourceContractId: 'source', optionsMode: 'filters' } })
  const first = await prepare()
  assert(first.options.packages.length && first.options.cashAccounts.length)
  f.values.packages.find(value => value.id === 'package-2').price = 8888
  f.values.cashAccounts.find(value => value.id === 'cash-0').name = 'Updated account'
  const second = await prepare()
  assert.equal(second.options.packages.find(value => value.id === 'package-2').price, 8888)
  assert.equal(second.options.cashAccounts.find(value => value.id === 'cash-0').name, 'Updated account')
  assert.equal(forbiddenQueries(f.reads).length, 4, 'packages and cash accounts reread on every prepare')
  assert.equal(f.writes.length, 2, 'unchanged prepare case projection write only, never a list write')
  assert(f.writes.every(write => write.path === 'contractRenewalCases/source'))
})
