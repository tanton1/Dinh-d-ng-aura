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

function fixture({ actor = systemActor, actualAuth = false, role = 'admin', token = null, disabled = false, forbidFinancialOptions = false, allowPreparation = false, caseCount = 12 } = {}) {
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
  const run = (data = {}, endpoint = 'listContractRenewalCases') => api[endpoint]({ auth: { uid: 'actor', token: token || { role } }, data })
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

const comparableCases = ({ generatedAt, options, optionsMode, optionsScopeKey, optionsReused, pageReset, packages, ...page }) => page
const dictionaryReads = reads => reads.filter(read => ['branches', 'roleAssignments', 'users'].includes(read.collection))

test('matching pagination scope reuses only dictionaries, saving8 fixture reads while all scoped cases/stats remain fresh', async () => {
  for (const endpoint of ['listContractRenewalCases', 'listContractRenewalPipeline']) {
    const f = fixture({ forbidFinancialOptions: true }), baseline = fixture({ forbidFinancialOptions: true })
    const first = await f.run({ pageSize: 3, optionsMode: 'filters' }, endpoint)
    assert.match(first.optionsScopeKey, /^renewal-options-v1:[a-f0-9]{64}$/)
    assert.equal(first.optionsReused, false)
    assert.equal(first.pageReset, false)
    const readOffset = f.reads.length, countBefore = f.readCount()
    const reused = await f.run({ pageSize: 3, cursor: first.nextCursor, optionsMode: 'reuse', optionsScopeKey: first.optionsScopeKey }, endpoint)
    const fresh = await baseline.run({ pageSize: 3, cursor: first.nextCursor, optionsMode: 'filters' }, endpoint)
    assert.deepEqual(comparableCases(reused), comparableCases(fresh))
    assert.equal(reused.optionsReused, true)
    assert.equal(reused.optionsMode, 'reuse')
    assert.equal(reused.pageReset, false)
    assert.equal(reused.optionsScopeKey, first.optionsScopeKey)
    assert.deepEqual(reused.options, { packages: [], cashAccounts: [], branches: [], assignees: [] })
    assert.deepEqual(reused.packages, [])
    assert.deepEqual(dictionaryReads(f.reads.slice(readOffset)), [])
    assert.equal(f.readCount() - countBefore, 12, 'case scan remains complete; options are not reread')
    assert.equal(baseline.readCount(), 20, '12cases+2branches+4assignments+2users')
    assert.equal(reused.stats.total, 12)
    assert.deepEqual(f.writes, [])
  }
})

test('reuse never caches cases, monetary totals, approvals, risk or current actor financial redaction', async () => {
  const f = fixture({ forbidFinancialOptions: true })
  const first = await f.run({ pageSize: 2, optionsMode: 'filters' })
  f.values.contractRenewalCases[11].expectedValue = 999_999
  f.values.contractRenewalCases[11].probability = 0.123
  f.values.contractRenewalCases[11].approvalStatus = 'pending'
  const input = { pageSize: 2, cursor: first.nextCursor }
  const reused = await f.run({ ...input, optionsMode: 'reuse', optionsScopeKey: first.optionsScopeKey })
  const fresh = await f.run({ ...input, optionsMode: 'filters' })
  assert.deepEqual(comparableCases(reused), comparableCases(fresh))
  assert.notEqual(reused.stats.pipelineValue, first.stats.pipelineValue)
  assert.notEqual(reused.stats.weightedPipelineValue, first.stats.weightedPipelineValue)
  assert.equal(reused.stats.pendingApprovals, 1)
  assert.equal(reused.optionsReused, true)
  assert.equal(f.reads.filter(read => read.collection === 'contractRenewalCases').length, 3)
})

test('missing/forged/mismatching key resets to a fresh scoped first page rather than using an invalid cursor', async () => {
  const actor = { ...systemActor, renewalScope: 'branch', branchIds: ['a'] }
  const f = fixture({ actor, forbidFinancialOptions: true })
  const first = await f.run({ pageSize: 2, optionsMode: 'filters' })
  actor.branchIds = ['b']
  f.values.branches.find(row => row.id === 'b').name = 'Fresh changed branch B'
  for (const optionsScopeKey of [first.optionsScopeKey, undefined, 'forged-scope-key']) {
    const reset = await f.run({ pageSize: 2, cursor: first.nextCursor, optionsMode: 'reuse', optionsScopeKey })
    const fresh = await f.run({ pageSize: 2, optionsMode: 'filters' })
    assert.equal(reset.pageReset, true)
    assert.equal(reset.optionsReused, false)
    assert.equal(reset.optionsMode, 'filters')
    assert.deepEqual(comparableCases(reset), comparableCases(fresh))
    assert.deepEqual(reset.options, fresh.options)
    assert.notEqual(reset.optionsScopeKey, first.optionsScopeKey)
    assert.deepEqual(reset.options.branches, [{ id: 'b', name: 'Fresh changed branch B' }])
    assert(reset.rows.every(row => row.branchId === 'b'))
    assert.equal(reset.stats.total, 6)
  }
  assert.deepEqual(f.writes, [])
})

test('key covers identity, trainer mapping, authority version, scope, audience and relevant permissions', async () => {
  for (const change of [
    { uid: 'another-actor' }, { legacyStaffId: 'different-trainer' }, { accessRole: 'super_admin' }, { authzVersion: 2 },
    { renewalAudience: 'sales' }, { branchIds: ['b'] }, { renewalCanSell: false },
    { renewalCanViewSalesCases: false }, { renewalCanViewTrainerCases: false }, { capabilities: [] },
  ]) {
    const actor = { ...systemActor, branchIds: ['a'] }
    const f = fixture({ actor, forbidFinancialOptions: true })
    const first = await f.run({ pageSize: 2, optionsMode: 'filters' })
    Object.assign(actor, change)
    const next = await f.run({ pageSize: 2, cursor: first.nextCursor, optionsMode: 'reuse', optionsScopeKey: first.optionsScopeKey })
    assert.equal(next.optionsReused, false, JSON.stringify(change))
    assert.equal(next.pageReset, true)
    assert.notEqual(next.optionsScopeKey, first.optionsScopeKey)
    if (change.renewalCanSell === false) {
      assert.equal(next.stats.pipelineValue, 0)
      assert(next.rows.every(row => row.expectedValue === 0 && row.contract.totalPrice === 0))
    }
  }
})

test('equivalent branch order/deduplication does not change scope key, but reuse still requires a cursor', async () => {
  const actor = { ...systemActor, renewalScope: 'branch', branchIds: ['a', 'b'] }
  const f = fixture({ actor, forbidFinancialOptions: true })
  const first = await f.run({ optionsMode: 'filters', pageSize: 2 })
  actor.branchIds = ['b', 'a', 'a']
  const next = await f.run({ optionsMode: 'reuse', cursor: first.nextCursor, pageSize: 2, optionsScopeKey: first.optionsScopeKey })
  assert.equal(next.optionsReused, true)
  assert.equal(next.optionsScopeKey, first.optionsScopeKey)
  const offset = f.reads.length
  const unpaged = await f.run({ optionsMode: 'reuse', pageSize: 2, optionsScopeKey: first.optionsScopeKey })
  assert.equal(unpaged.optionsReused, false)
  assert.equal(unpaged.optionsMode, 'filters')
  assert.equal(unpaged.pageReset, false)
  assert(dictionaryReads(f.reads.slice(offset)).length > 0)
  assert.deepEqual(unpaged.rows, first.rows)
})

test('real authority rereads assignment on reuse, preventing a cached branch scope from accepting its old key', async () => {
  const f = fixture({ actualAuth: true, role: 'manager', token: { accessRole: 'staff', authzVersion: 1 }, forbidFinancialOptions: true })
  const assignment = { id: 'actor', accessRole: 'staff', positions: ['branch_manager'], branchIds: ['a'], status: 'active', authzVersion: 1 }
  f.values.roleAssignments.push(assignment)
  const first = await f.run({ pageSize: 2, optionsMode: 'filters' })
  assert.equal(first.scope, 'branch')
  assert(first.rows.every(row => row.branchId === 'a'))
  assignment.branchIds = ['b']
  const offset = f.reads.length
  const next = await f.run({ pageSize: 2, optionsMode: 'reuse', cursor: first.nextCursor, optionsScopeKey: first.optionsScopeKey })
  assert.equal(next.pageReset, true)
  assert.equal(next.optionsReused, false)
  assert(next.rows.every(row => row.branchId === 'b'))
  assert(f.reads.slice(offset).some(read => read.kind === 'document' && read.collection === 'roleAssignments'), 'fresh assignment read is mandatory even inside its process-cache TTL')
  assignment.positions = ['trainer_pt']
  f.values.contractRenewalCases.forEach(row => { row.contractSnapshot.trainerId = 'actor' })
  const trainer = await f.run({ pageSize: 2, optionsMode: 'reuse', cursor: next.nextCursor, optionsScopeKey: next.optionsScopeKey })
  assert.equal(trainer.optionsReused, false)
  assert.equal(trainer.scope, 'self')
  assert.equal(trainer.audience, 'trainer')
  assert.equal(trainer.stats.pipelineValue, 0)
  assert.equal(trainer.stats.weightedPipelineValue, 0)
  assert(trainer.rows.every(row => row.expectedValue === 0 && row.contract.totalPrice === 0 && row.contract.paidAmount === 0))
  assignment.status = 'suspended'
  const beforeDeny = f.reads.length
  await assert.rejects(f.run({ optionsMode: 'reuse', cursor: trainer.nextCursor, optionsScopeKey: trainer.optionsScopeKey }), { code: 'permission-denied' })
  assert(f.reads.slice(beforeDeny).every(read => read.kind === 'document' && ['users', 'roleAssignments'].includes(read.collection)))
})

test('forged comparison keys cannot bypass authentication or obtain another actor scope', async () => {
  const system = fixture({ forbidFinancialOptions: true })
  const adminPage = await system.run({ pageSize: 1, optionsMode: 'filters' })
  const staffActor = { ...systemActor, uid: 'staff-b', renewalScope: 'branch', branchIds: ['b'] }
  const staff = fixture({ actor: staffActor, forbidFinancialOptions: true })
  const result = await staff.run({ optionsMode: 'reuse', cursor: adminPage.nextCursor, optionsScopeKey: adminPage.optionsScopeKey })
  assert(result.rows.every(row => row.branchId === 'b'))
  assert.equal(result.stats.total, 6)
  assert.equal(result.pageReset, true)
  const denied = fixture({ actualAuth: true, role: 'student' })
  await assert.rejects(denied.run({ optionsMode: 'reuse', cursor: adminPage.nextCursor, optionsScopeKey: adminPage.optionsScopeKey }), { code: 'permission-denied' })
  assert(denied.reads.every(read => read.kind === 'document' && ['users', 'roleAssignments'].includes(read.collection)))
  await assert.rejects(denied.api.listContractRenewalCases({ data: { optionsMode: 'reuse', optionsScopeKey: adminPage.optionsScopeKey } }), { code: 'unauthenticated' })
})

test('matching-scope stale cursor still aborts and cap/truncation semantics remain unchanged', async () => {
  const f = fixture({ forbidFinancialOptions: true, caseCount: 5002 })
  const first = await f.run({ optionsMode: 'filters', pageSize: 1 })
  const next = await f.run({ optionsMode: 'reuse', pageSize: 1, cursor: first.nextCursor, optionsScopeKey: first.optionsScopeKey })
  assert.equal(next.truncated, true)
  assert.deepEqual(next.stats, first.stats)
  const missingCursor = Buffer.from(JSON.stringify({ id: 'missing-case' })).toString('base64url')
  await assert.rejects(f.run({ optionsMode: 'reuse', cursor: missingCursor, optionsScopeKey: first.optionsScopeKey }), { code: 'aborted' })
  const legacy = fixture()
  for (const optionsMode of ['full', 'filters']) await assert.rejects(legacy.run({ optionsMode, cursor: missingCursor, optionsScopeKey: 'wrong-key' }), { code: 'aborted' })
})

test('prepare ignores dictionary reuse input and always rereads full sale/payment options', async () => {
  const f = fixture({ allowPreparation: true })
  const first = await f.run({ optionsMode: 'filters', pageSize: 2 })
  await f.run({ optionsMode: 'reuse', pageSize: 2, cursor: first.nextCursor, optionsScopeKey: first.optionsScopeKey })
  f.values.contracts.push({ id: 'source', studentId: 'student', branchId: 'a', status: 'active', totalSessions: 12, usedSessions: 0, startDate: vietnamDateKey(), endDate: addDateDays(vietnamDateKey(), 20), totalPrice: 500 })
  f.values.students.push({ id: 'student', name: 'Member', status: 'active', branchId: 'a' })
  f.values.packages.find(row => row.id === 'package-2').price = 7777
  f.values.cashAccounts.find(row => row.id === 'cash-0').name = 'Fresh payment option'
  const prepared = await f.api.prepareContractRenewal({ data: { sourceContractId: 'source', optionsMode: 'reuse', optionsScopeKey: first.optionsScopeKey } })
  assert.equal(prepared.options.packages.find(row => row.id === 'package-2').price, 7777)
  assert.equal(prepared.options.cashAccounts.find(row => row.id === 'cash-0').name, 'Fresh payment option')
  assert.equal(forbiddenQueries(f.reads).length, 2)
})
