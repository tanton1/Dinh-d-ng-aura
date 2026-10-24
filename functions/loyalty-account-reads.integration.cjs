'use strict'

const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { createLoyaltyFunctions } = require('./loyalty')

// Synthetic fixtures only. Never fall through to ADC or a production database.
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `loyalty-account-reads-${randomUUID()}`)
const clients = []
after(async () => {
  await Promise.all(clients.map(db => db.terminate()))
  await deleteApp(app)
})

async function fixture({ students = {}, wallets = {}, branches = ['a', 'b'], role = 'staff' } = {}) {
  const db = getFirestore(app, `loyalty-account-reads-${randomUUID()}`)
  clients.push(db)
  const entries = [
    ['users/actor', { role: role === 'staff' ? 'manager' : role }],
    ...Object.entries(students).map(([id, value]) => [`students/${id}`, { loyaltyMembership: { managed: true, active: true, state: 'active', activeUntil: '2099-12-31', manageUntil: '2100-01-31', enrolledOn: '2026-10-24' }, ...value }]),
    ...Object.entries(wallets).map(([id, value]) => [`loyaltyAccounts/${id}`, value]),
  ]
  if (role === 'staff') entries.push(['roleAssignments/actor', {
    accessRole: 'staff', positions: ['branch_manager'], branchIds: branches, authzVersion: 1, status: 'active',
  }])
  for (let offset = 0; offset < entries.length; offset += 450) {
    const batch = db.batch()
    entries.slice(offset, offset + 450).forEach(([path, value]) => batch.set(db.doc(path), value))
    await batch.commit()
  }
  const reads = { queries: [], counts: [], documents: [], wallets: [] }
  const query = (target, state = { filters: [], limit: null, cursor: null }) => ({
    where: (...args) => query(target.where(...args), { ...state, filters: [...state.filters, args] }),
    orderBy: (...args) => query(target.orderBy(...args), state),
    limit: limit => query(target.limit(limit), { ...state, limit }),
    startAfter: cursor => query(target.startAfter(cursor), { ...state, cursor }),
    get: async () => {
      assert.ok(state.limit > 0 && state.limit <= 101)
      const snapshot = await target.get()
      reads.queries.push({ ...state, size: snapshot.size })
      return snapshot
    },
    count: () => ({ get: async () => {
      assert.equal(state.limit, null)
      assert.equal(state.cursor, null)
      const snapshot = await target.count().get()
      reads.counts.push({ ...state, count: snapshot.data().count })
      return snapshot
    } }),
  })
  // This facade exposes read methods only; a write-on-read fails immediately.
  const readDb = {
    doc: path => ({ path, get: async () => { reads.documents.push(path); return db.doc(path).get() } }),
    collection: name => { assert.equal(name, 'students'); return query(db.collection(name)) },
    getAll: async (...references) => {
      references.forEach(({ path }) => { assert.ok(path.startsWith('loyaltyAccounts/')); reads.wallets.push(path) })
      return db.getAll(...references.map(({ path }) => db.doc(path)))
    },
  }
  const { listLoyaltyAccounts } = createLoyaltyFunctions({ db: readDb, onCall: (_options, handler) => handler })
  const auth = { uid: 'actor', token: role === 'staff' ? { accessRole: 'staff', authzVersion: 1 } : { role } }
  return { db, reads, run: (data = {}, caller = auth) => listLoyaltyAccounts({ auth: caller, data }) }
}

const compareId = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))
const emptyPage = { accounts: [], totalCount: 0, hasMore: false, nextCursor: null }
function students(count, branches = ['a', 'b']) {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [
    `student-${String(index).padStart(4, '0')}`, { name: `Học viên ${count - index}`, branchId: branches[index % branches.length] },
  ]))
}

test('real Firestore: branch-in + document-ID cursor pages are scoped, complete and bounded', async () => {
  const values = { ...students(240), outside: { name: 'Other branch', branchId: 'c' }, unassigned: { name: 'No branch' } }
  const f = await fixture({ students: values })
  const first = await f.run({ pageSize: 20 })
  assert.equal(first.totalCount, 240)
  assert.equal(first.accounts.length, 20)
  assert.equal(first.nextCursor, 'student-0019')
  assert.deepEqual(f.reads.queries.map(read => read.size), [21])
  assert.deepEqual(f.reads.queries[0].filters, [['loyaltyMembership.managed', '==', true], ['branchId', 'in', ['a', 'b']]])
  assert.equal(f.reads.wallets.length, 20)
  assert.equal(f.reads.queries[0].size + f.reads.wallets.length, 41,
    'old fixture path fetched240 profiles+240 wallets; aggregate scan/bytes not represented by this hydration count')
  const seen = first.accounts.map(row => row.studentId)
  let cursor = first.nextCursor
  while (cursor) {
    const result = await f.run({ pageSize: 20, cursor })
    assert.equal(result.totalCount, 240)
    assert.equal(result.hasMore, Boolean(result.nextCursor))
    seen.push(...result.accounts.map(row => row.studentId))
    cursor = result.nextCursor
  }
  assert.deepEqual(seen.sort(compareId), Object.keys(students(240)))
  assert.equal(new Set(seen).size, 240)
  assert.ok(f.reads.queries.every(read => read.size <= 21))
  assert.equal(f.reads.counts.length, 12)
  assert.ok(f.reads.wallets.every(path => !path.endsWith('/outside') && !path.endsWith('/unassigned')))
})

test('real Firestore: twenty-branch merge matches UTF-8 order without lost or duplicated students', async () => {
  const branches = Array.from({ length: 20 }, (_, index) => `b-${index}`)
  const values = students(55, branches)
  for (const [index, id] of ['A', 'Z', '_', 'a', 'z', 'é', 'Ω', '中'].entries()) values[id] = { name: id, branchId: branches[index % 2 ? 19 : 0] }
  const f = await fixture({ students: values, branches })
  const expected = Object.keys(values).sort(compareId)
  let cursor
  let offset = 0
  const seen = []
  do {
    const result = await f.run({ pageSize: 10, cursor })
    assert.equal(result.totalCount, expected.length)
    assert.deepEqual(result.accounts.map(row => row.studentId).sort(compareId), expected.slice(offset, offset + 10))
    seen.push(...result.accounts.map(row => row.studentId))
    offset += 10
    cursor = result.nextCursor
  } while (cursor)
  assert.deepEqual(seen.sort(compareId), expected)
  assert.equal(f.reads.queries.length, Math.ceil(expected.length / 10) * 2)
  assert.ok(f.reads.queries.every(read => read.size <= 11))
})

test('real Firestore: balances and count refresh after changes, exact lookup is bounded and inaccessible IDs do not leak', async () => {
  const f = await fixture({ students: students(120), wallets: { 'student-0119': { availablePoints: 17, revision: 1 } } })
  assert.equal((await f.run()).totalCount, 120)
  await f.db.doc('students/student-0001').update({ branchId: 'outside' })
  await f.db.doc('students/new-member').set({ name: 'New', branchId: 'a', loyaltyMembership: { managed: true, active: true, state: 'active', activeUntil: '2099-12-31', manageUntil: '2100-01-31', enrolledOn: '2026-10-24' } })
  await f.db.doc('students/new-member-2').set({ name: 'New2', branchId: 'b', loyaltyMembership: { managed: true } })
  await f.db.doc('loyaltyAccounts/student-0119').update({ availablePoints: 25, revision: 2 })
  assert.equal((await f.run()).totalCount, 121)
  const before = { queries: f.reads.queries.length, counts: f.reads.counts.length, wallets: f.reads.wallets.length }
  const exact = await f.run({ studentId: 'student-0119' })
  assert.equal(exact.totalCount, 1)
  assert.equal(exact.accounts[0].availablePoints, 25)
  assert.equal(exact.accounts[0].revision, 2)
  assert.equal(f.reads.queries.length, before.queries)
  assert.equal(f.reads.counts.length, before.counts)
  assert.equal(f.reads.wallets.length, before.wallets + 1)
  assert.deepEqual(await f.run({ studentId: 'student-0001' }), emptyPage)
  assert.deepEqual(await f.run({ studentId: 'missing' }), emptyPage)
  const withoutWallet = await f.run({ studentId: 'new-member' })
  assert.equal(withoutWallet.accounts[0].availablePoints, 0)
  assert.equal(withoutWallet.accounts[0].walletInitialized, false)
  assert.equal((await f.db.doc('loyaltyAccounts/new-member').get()).exists, false)
  await f.db.doc('roleAssignments/actor').update({ branchIds: ['outside'] })
  const beforeRevoked = f.reads.wallets.length
  assert.deepEqual(await f.run({ studentId: 'student-0119' }), emptyPage, 'exact lookup ignores any earlier cached assignment')
  assert.equal(f.reads.wallets.length, beforeRevoked)
})

test('real Firestore: auth denial and empty branch scope perform no business queries or wallet/policy reads', async () => {
  const f = await fixture({ students: students(5), role: 'student' })
  await assert.rejects(f.run({}, null), { code: 'unauthenticated' })
  await assert.rejects(f.run(), { code: 'permission-denied' })
  const empty = await fixture({ students: students(5), branches: [] })
  assert.deepEqual(await empty.run(), emptyPage)
  assert.deepEqual(await empty.run({ studentId: 'student-0000' }), emptyPage)
  for (const item of [f, empty]) {
    assert.deepEqual(item.reads.queries, [])
    assert.deepEqual(item.reads.counts, [])
    assert.deepEqual(item.reads.wallets, [])
    assert.ok(item.reads.documents.every(path => path.startsWith('users/') || path.startsWith('roleAssignments/')))
  }
})

test('real Firestore: returned whitespace cursor and Unicode exact IDs preserve canonical document identity', async () => {
  const values = { ...students(16), 'student-0008 ': { name: 'Trailing space', branchId: 'a' }, 'Học-viên': { name: 'Unicode', branchId: 'b' } }
  const f = await fixture({ students: values })
  const first = await f.run({ pageSize: 10, cursor: 'Học-viên' })
  assert.equal(first.nextCursor, 'student-0008 ')
  const next = await f.run({ pageSize: 10, cursor: first.nextCursor })
  assert.deepEqual([...first.accounts, ...next.accounts].map(row => row.studentId).sort(compareId), Object.keys(values).filter(id => id !== 'Học-viên').sort(compareId))
  assert.equal(next.hasMore, false)
  const exact = await f.run({ studentId: 'Học-viên' })
  assert.equal(exact.accounts[0].studentId, 'Học-viên')
  const whitespace = await f.run({ studentId: 'student-0008 ' })
  assert.equal(whitespace.accounts[0].studentId, 'student-0008 ')
})
