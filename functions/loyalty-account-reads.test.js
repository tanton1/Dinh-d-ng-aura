'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { FieldPath, Timestamp } = require('firebase-admin/firestore')
const { createLoyaltyFunctions } = require('./loyalty')

const compareId = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))
const emptyPage = { accounts: [], hasMore: false, nextCursor: null, totalCount: 0 }

function fixture({ students = {}, wallets = {}, branches = ['a', 'b'], role = 'staff' } = {}) {
  const records = new Map([
    ['users/actor', { role: role === 'staff' ? 'manager' : role }],
    ...Object.entries(students).map(([id, value]) => [`students/${id}`, value]),
    ...Object.entries(wallets).map(([id, value]) => [`loyaltyAccounts/${id}`, value]),
  ])
  if (role === 'staff') records.set('roleAssignments/actor', {
    accessRole: 'staff', positions: ['branch_manager'], branchIds: branches,
    authzVersion: 1, status: 'active',
  })
  const reads = { queries: [], counts: [], documents: [], wallets: [] }
  const snapshot = (path) => ({
    id: path.split('/').at(-1), exists: records.has(path), data: () => records.get(path),
  })
  const query = (state = { filters: [], limit: null, cursor: null, ordered: false }) => {
    const matches = () => [...records.entries()]
      .filter(([path, value]) => path.startsWith('students/') && state.filters.every(([field, op, expected]) => (
        op === 'in' ? expected.includes(value[field]) : value[field] === expected
      )))
      .map(([path]) => snapshot(path)).sort((left, right) => compareId(left.id, right.id))
    return {
      where: (field, op, value) => {
        assert.equal(state.cursor, null, 'Firestore filters must precede cursor')
        assert.equal(field, 'branchId')
        assert.ok(['in', '=='].includes(op))
        if (op === 'in') assert.ok(value.length > 0 && value.length <= 10)
        return query({ ...state, filters: [...state.filters, [field, op, value]] })
      },
      orderBy: (field) => {
        assert.deepEqual(field, FieldPath.documentId())
        return query({ ...state, ordered: true })
      },
      limit: (limit) => {
        assert.ok(Number.isInteger(limit) && limit >= 11 && limit <= 101)
        return query({ ...state, limit })
      },
      startAfter: (cursor) => {
        assert.equal(state.ordered, true)
        return query({ ...state, cursor })
      },
      get: async () => {
        assert.equal(state.ordered, true)
        assert.ok(state.limit !== null, 'list query must never scan the full collection')
        const docs = matches().filter(doc => !state.cursor || compareId(doc.id, state.cursor) > 0).slice(0, state.limit)
        reads.queries.push({ ...state, size: docs.length })
        return { docs, size: docs.length, empty: !docs.length }
      },
      count: () => ({ get: async () => {
        assert.equal(state.cursor, null, 'count must not be scoped to the remaining page')
        assert.equal(state.limit, null, 'count must not be truncated to page size')
        reads.counts.push(state)
        return { data: () => ({ count: matches().length }) }
      } }),
    }
  }
  // No mutation methods: this callable must never initialize a wallet or write
  // an audit/event document just because someone viewed a list.
  const db = {
    doc: (path) => ({ path, get: async () => { reads.documents.push(path); return snapshot(path) } }),
    collection: (name) => { assert.equal(name, 'students'); return query() },
    getAll: async (...references) => references.map(({ path }) => {
      assert.ok(path.startsWith('loyaltyAccounts/'))
      reads.wallets.push(path)
      return snapshot(path)
    }),
  }
  const { listLoyaltyAccounts } = createLoyaltyFunctions({ db, onCall: (_options, handler) => handler })
  const auth = { uid: 'actor', token: role === 'staff' ? { accessRole: 'staff', authzVersion: 1 } : { role } }
  return { records, reads, run: (data = {}, requestAuth = auth) => listLoyaltyAccounts({ auth: requestAuth, data }) }
}

function students(count, branches = ['a', 'b']) {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [
    `student-${String(index).padStart(4, '0')}`,
    { name: `Học viên ${String(count - index).padStart(4, '0')}`, branchId: branches[index % branches.length], accountUid: `uid-${index}` },
  ]))
}

test('two-branch staff reads one bounded page and hydrates only its wallets, not 1000 per branch', async () => {
  const f = fixture({ students: students(2600) })
  const result = await f.run({ pageSize: 100 })
  assert.equal(result.accounts.length, 100)
  assert.equal(result.totalCount, 2600)
  assert.equal(result.hasMore, true)
  assert.equal(result.nextCursor, 'student-0099')
  assert.deepEqual(f.reads.queries.map(item => item.size), [101])
  assert.deepEqual(f.reads.queries[0].filters, [['branchId', 'in', ['a', 'b']]])
  assert.equal(f.reads.wallets.length, 100)
  assert.equal(f.reads.counts.length, 1)
  assert.equal(f.reads.queries[0].size + f.reads.wallets.length, 201,
    'old path fetched 2000 profiles +1000 wallets; excludes auth/policy and separately billed aggregation/index work')
  assert.deepEqual(result.accounts.map(row => row.studentName), [...result.accounts.map(row => row.studentName)].sort((a, b) => a.localeCompare(b, 'vi')))
})

test('staff cursor pages cover every authorized student once and never read unauthorized wallets', async () => {
  const values = students(137, ['a', 'b', 'outside'])
  const f = fixture({ students: values, branches: ['a', 'b', 'a'] })
  const expected = Object.keys(values).filter(id => values[id].branchId !== 'outside').sort(compareId)
  const seen = []
  let cursor
  do {
    const result = await f.run({ pageSize: 10, cursor })
    assert.equal(result.totalCount, expected.length)
    assert.ok(result.accounts.length <= 10)
    seen.push(...result.accounts.map(row => row.studentId))
    cursor = result.nextCursor
    assert.equal(result.hasMore, Boolean(cursor))
  } while (cursor)
  assert.deepEqual(seen.sort(compareId), expected)
  assert.equal(new Set(seen).size, seen.length)
  assert.ok(f.reads.wallets.every(path => values[path.split('/').at(-1)].branchId !== 'outside'))
  assert.ok(f.reads.queries.every(read => read.size <= 11))
})

test('twenty branches use at most two disjoint bounded queries and UTF-8 document-ID merge order', async () => {
  const branches = Array.from({ length: 20 }, (_, index) => `branch-${index}`)
  const values = students(61, branches)
  for (const [index, id] of ['A', 'Z', '_', 'a', 'z', 'é', 'Ω', '中'].entries()) values[id] = { branchId: branches[index % 2 ? 12 : 0], name: id }
  const f = fixture({ students: values, branches })
  const expected = Object.keys(values).sort(compareId)
  let cursor
  let offset = 0
  const seen = []
  do {
    const result = await f.run({ pageSize: 10, cursor })
    const expectedPage = expected.slice(offset, offset + 10)
    assert.deepEqual(result.accounts.map(row => row.studentId).sort(compareId), expectedPage)
    assert.equal(result.totalCount, expected.length)
    assert.equal(result.nextCursor, offset + 10 < expected.length ? expectedPage.at(-1) : null)
    seen.push(...result.accounts.map(row => row.studentId))
    offset += 10
    cursor = result.nextCursor
  } while (cursor)
  assert.equal(new Set(seen).size, expected.length)
  assert.ok(f.reads.queries.every(read => read.size <= 11 && read.filters[0][2].length <= 10))
  assert.equal(f.reads.queries.length, Math.ceil(expected.length / 10) * 2)
  assert.equal(f.reads.counts.length, f.reads.queries.length)
})

test('admin page is bounded, includes missing branch profiles and counts even after the final cursor', async () => {
  const values = students(21)
  values.unassigned = { displayName: 'Không có chi nhánh' }
  const f = fixture({ students: values, role: 'admin' })
  const result = await f.run({ pageSize: 10 })
  assert.equal(result.totalCount, 22)
  assert.equal(result.nextCursor, 'student-0009')
  const end = await f.run({ cursor: 'student-0020', pageSize: 10 })
  assert.equal(end.totalCount, 22)
  assert.deepEqual(end.accounts.map(row => row.studentId), ['unassigned'])
  assert.equal(end.accounts[0].branchId, '')
  assert.equal(end.hasMore, false)
  assert.equal(end.nextCursor, null)
  assert.ok(f.reads.queries.every(read => read.filters.length === 0))
  const pastEnd = await f.run({ cursor: 'zzzz' })
  assert.deepEqual(pastEnd, { ...emptyPage, totalCount: 22 })
})

test('no staff branches returns empty without policy, student, wallet, query or aggregate reads', async () => {
  const f = fixture({ students: students(10), branches: [] })
  assert.deepEqual(await f.run(), emptyPage)
  assert.deepEqual(await f.run({ studentId: 'student-0001' }), emptyPage)
  assert.deepEqual(f.reads.queries, [])
  assert.deepEqual(f.reads.counts, [])
  assert.deepEqual(f.reads.wallets, [])
  assert.ok(f.reads.documents.every(path => path.startsWith('users/') || path.startsWith('roleAssignments/')))
})

test('wallet fields, missing-wallet defaults, names, policy tiers and revisions are retained', async () => {
  const f = fixture({
    students: { a: { name: 'Ánh', branchId: 'a', accountUid: 'a-uid' }, b: { displayName: 'Bình', branchId: 'b' }, c: { branchId: 'a' } },
    wallets: { a: { studentId: 'a', status: 'suspended', availablePoints: 300, pendingPoints: 20, reservedPoints: 30, debtPoints: 40, lifetimeEarnedPoints: 500, lifetimeRedeemedPoints: 110, tierQualifyingValue: 40_000_000, revision: 7, updatedAt: Timestamp.fromMillis(1000) } },
  })
  const result = await f.run()
  const a = result.accounts.find(row => row.studentId === 'a')
  assert.deepEqual(Object.keys(a).sort(), ['studentId', 'status', 'availablePoints', 'pendingPoints', 'reservedPoints', 'debtPoints', 'lifetimeEarnedPoints', 'lifetimeRedeemedPoints', 'tierQualifyingValue', 'tier', 'tierProgress', 'revision', 'updatedAt', 'studentName', 'branchId', 'walletInitialized'].sort())
  assert.deepEqual([a.status, a.availablePoints, a.pendingPoints, a.reservedPoints, a.debtPoints, a.lifetimeEarnedPoints, a.lifetimeRedeemedPoints, a.tierQualifyingValue, a.tier, a.revision, a.updatedAt, a.walletInitialized],
    ['suspended', 300, 20, 30, 40, 500, 110, 40_000_000, 'gold', 7, '1970-01-01T00:00:01.000Z', true])
  const b = result.accounts.find(row => row.studentId === 'b')
  assert.equal(b.studentName, 'Bình')
  assert.equal(b.walletInitialized, false)
  assert.equal(b.tier, 'member')
  assert.equal(b.availablePoints, 0)
  assert.equal(b.revision, 0)
  assert.equal(result.accounts.find(row => row.studentId === 'c').studentName, 'Học viên Aura')
  assert.equal(f.records.has('loyaltyAccounts/b'), false, 'reading default wallet never initializes persisted money')
})

test('counts, branch membership and balances are fresh after edits; no cached financial results', async () => {
  const f = fixture({ students: students(12), wallets: { 'student-0000': { availablePoints: 5 } } })
  assert.equal((await f.run()).totalCount, 12)
  f.records.set('students/student-0001', { name: 'Moved out', branchId: 'outside' })
  f.records.set('students/new', { name: 'New member', branchId: 'a' })
  f.records.set('students/another', { name: 'Another', branchId: 'b' })
  f.records.set('loyaltyAccounts/student-0000', { availablePoints: 123, revision: 2 })
  const updated = await f.run()
  assert.equal(updated.totalCount, 13)
  assert.ok(!updated.accounts.some(row => row.studentId === 'student-0001'))
  assert.equal(updated.accounts.find(row => row.studentId === 'student-0000').availablePoints, 123)
  assert.equal(f.reads.counts.length, 2)
})

test('exact student lookup works beyond page one with one profile plus wallet and no list/count scan', async () => {
  const f = fixture({ students: students(150), wallets: { 'student-0149': { availablePoints: 987, revision: 3 } } })
  const result = await f.run({ studentId: 'student-0149' })
  assert.equal(result.accounts.length, 1)
  assert.equal(result.accounts[0].availablePoints, 987)
  assert.equal(result.totalCount, 1)
  assert.equal(result.hasMore, false)
  assert.equal(result.nextCursor, null)
  assert.deepEqual(f.reads.queries, [])
  assert.deepEqual(f.reads.counts, [])
  assert.deepEqual(f.reads.wallets, ['loyaltyAccounts/student-0149'])
  assert.deepEqual(f.reads.documents.filter(path => path.startsWith('students/')), ['students/student-0149'])
})

test('imported Unicode and whitespace IDs round-trip in exact lookup and document cursors', async () => {
  const values = students(16)
  values[' student-0000 '] = { name: 'Imported', branchId: 'a' }
  values['student-0008 '] = { name: 'Cursor includes trailing space', branchId: 'b' }
  values['é'.repeat(750)] = { name: 'Maximum byte length', branchId: 'a' }
  values['Học-viên'] = { name: 'Unicode ID', branchId: 'b' }
  const f = fixture({ students: values })
  for (const studentId of [' student-0000 ', 'é'.repeat(750), 'Học-viên']) {
    const result = await f.run({ studentId })
    assert.equal(result.totalCount, 1)
    assert.equal(result.accounts[0].studentId, studentId)
    assert.equal(f.reads.wallets.at(-1), `loyaltyAccounts/${studentId}`)
  }
  const pagedValues = { ...students(16), 'student-0008 ': values['student-0008 '] }
  const paged = fixture({ students: pagedValues })
  const first = await paged.run({ pageSize: 10 })
  assert.equal(first.nextCursor, 'student-0008 ')
  const next = await paged.run({ pageSize: 10, cursor: first.nextCursor })
  assert.equal(paged.reads.queries.at(-1).cursor, 'student-0008 ')
  assert.deepEqual([...first.accounts, ...next.accounts].map(row => row.studentId).sort(compareId), Object.keys(pagedValues).sort(compareId))
  assert.equal(next.hasMore, false)
})

test('missing and unauthorized exact IDs have identical empty responses and never hydrate a wallet', async () => {
  const f = fixture({ students: { hidden: { branchId: 'outside', name: 'Private' } }, wallets: { hidden: { availablePoints: 999 } } })
  assert.deepEqual(await f.run({ studentId: 'hidden' }), emptyPage)
  assert.deepEqual(await f.run({ studentId: 'missing' }), emptyPage)
  assert.deepEqual(f.reads.wallets, [])
  assert.ok(!f.reads.documents.some(path => path.startsWith('loyalty')))
})

test('exact lookup bypasses role-assignment process cache after access is revoked', async () => {
  const f = fixture({ students: students(5) })
  assert.equal((await f.run()).accounts.length, 5)
  f.records.set('roleAssignments/actor', { accessRole: 'staff', positions: ['branch_manager'], branchIds: ['outside'], authzVersion: 1, status: 'active' })
  const previousWalletReads = f.reads.wallets.length
  assert.deepEqual(await f.run({ studentId: 'student-0000' }), emptyPage)
  assert.equal(f.reads.wallets.length, previousWalletReads)
  f.records.set('roleAssignments/actor', { accessRole: 'staff', positions: ['branch_manager'], branchIds: ['a'], authzVersion: 1, status: 'suspended' })
  await assert.rejects(f.run({ studentId: 'student-0000' }), { code: 'permission-denied' })
})

test('unauthenticated, student and disabled callers read no business data', async () => {
  const f = fixture({ students: students(20), role: 'student' })
  await assert.rejects(f.run({}, null), { code: 'unauthenticated' })
  await assert.rejects(f.run(), { code: 'permission-denied' })
  const admin = fixture({ students: students(20), role: 'admin' })
  admin.records.set('users/actor', { role: 'admin', disabled: true })
  await assert.rejects(admin.run(), { code: 'permission-denied' })
  for (const item of [f, admin]) {
    assert.deepEqual(item.reads.queries, [])
    assert.deepEqual(item.reads.counts, [])
    assert.deepEqual(item.reads.wallets, [])
    assert.ok(item.reads.documents.every(path => path.startsWith('users/') || path.startsWith('roleAssignments/')))
  }
})

test('page size retains default and safe clamp but rejects malformed/infinite/fractional input before business reads', async () => {
  for (const [input, expected] of [[undefined, 50], [1, 10], ['25', 25], [1000, 100]]) {
    const f = fixture({ students: students(150) })
    assert.equal((await f.run({ pageSize: input })).accounts.length, expected)
  }
  for (const pageSize of [0, -1, 1.5, NaN, Infinity, 'not-a-number', '', ' ', true, {}, [], Number.MAX_SAFE_INTEGER + 1]) {
    const f = fixture()
    await assert.rejects(f.run({ pageSize }), { code: 'invalid-argument' })
    assert.deepEqual(f.reads.queries, [])
    assert.deepEqual(f.reads.wallets, [])
  }
})

test('invalid cursors and ambiguous/path-injection exact lookup fail closed before business reads', async () => {
  for (const data of [{ cursor: 'students/a' }, { cursor: 10 }, { cursor: 'x'.repeat(1501) }, { cursor: '.' }, { cursor: '..' }, { cursor: '__reserved__' }, { cursor: '\ud800' }, { studentId: '' }, { studentId: 'é'.repeat(751) }, { studentId: '../secret' }, { studentId: 'a', cursor: 'b' }]) {
    const f = fixture()
    await assert.rejects(f.run(data), { code: 'invalid-argument' })
    assert.deepEqual(f.reads.queries, [])
    assert.deepEqual(f.reads.wallets, [])
    assert.ok(f.reads.documents.every(path => path.startsWith('users/') || path.startsWith('roleAssignments/')))
  }
})
