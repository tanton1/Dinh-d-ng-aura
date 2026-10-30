'use strict'

const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { createFinanceLedgerFunctions, normalizeLedgerListInput, summarizeLedgerDocuments } = require('./finance-ledger')

// Never permit this synthetic-data integration test to reach a live database.
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `finance-read-budget-${randomUUID()}`)
const clients = []
after(async () => {
  await Promise.all(clients.map(db => db.terminate()))
  await deleteApp(app)
})

async function fixture(values) {
  const db = getFirestore(app, `finance-read-budget-${randomUUID()}`)
  clients.push(db)
  const batch = db.batch()
  batch.set(db.doc('users/admin'), { role: 'admin' })
  batch.set(db.doc('users/student'), { role: 'student' })
  for (const [index, value] of values.entries()) batch.set(db.doc(`ledgerEntries/row-${String(index).padStart(4, '0')}`), value)
  await batch.commit()
  const reads = [], metadataReads = []
  const query = (target, state = { filters: [], limited: false, summary: false }) => ({
    orderBy: (...args) => query(target.orderBy(...args), state),
    where: (...args) => query(target.where(...args), { ...state, filters: [...state.filters, args] }),
    startAfter: (...args) => query(target.startAfter(...args), state),
    limit: (...args) => query(target.limit(...args), { ...state, limited: true }),
    select: (...args) => query(target.select(...args), { ...state, summary: true }),
    get: async () => {
      const snapshot = await target.get()
      reads.push({ ...state, size: snapshot.size })
      return snapshot
    },
  })
  // The callable receives only read methods. A surprise business write fails.
  const readDb = {
    doc: path => ({ path, id: path.split('/').at(-1), get: () => db.doc(path).get() }),
    getAll: async (...refs) => {
      const options = refs.pop()
      metadataReads.push({ paths: refs.map(ref => ref.path), fields: options.fieldMask })
      return db.getAll(...refs.map(ref => db.doc(ref.path)), options)
    },
    collection: name => { assert.equal(name, 'ledgerEntries'); return query(db.collection(name)) },
  }
  const { listFinanceLedger } = createFinanceLedgerFunctions({ db: readDb, onCall: handler => handler })
  const run = (data, role = 'admin') => listFinanceLedger({ auth: { uid: role, token: { role } }, data })
  return { db, run, reads, metadataReads }
}

const value = (index, patch = {}) => ({
  type: 'payment', status: 'posted', branchId: 'a', amount: 100,
  effectiveAt: Timestamp.fromMillis(Date.parse('2026-10-22T17:00:00Z') - index * 1000),
  ...patch,
})

test('real Firestore: reversal hints follow current canonical settlement state with bounded private joins', async () => {
  const f = await fixture([value(0, { contractId: 'normal' }), value(1, { contractId: 'review' }),
    value(2, { contractId: 'stale' }), value(3, { contractId: 'missing' }), value(4, { contractId: 'normal', type: 'refund' }),
    value(5, { contractId: 'malformed' })])
  const batch = f.db.batch()
  batch.set(f.db.doc('contracts/normal'), { status: 'active', privateNote: 'private' })
  batch.set(f.db.doc('contracts/review'), { status: 'cancelled', cancellationSettlement: { status: 'review_required', canonicalCash: 100 } })
  batch.set(f.db.doc('contractSettlements/review'), { status: 'review_required' })
  batch.set(f.db.doc('contracts/stale'), { status: 'cancelled', cancellationSettlement: { status: 'review_required' } })
  batch.set(f.db.doc('contractSettlements/stale'), { status: 'approved' })
  batch.set(f.db.doc('contracts/malformed'), { status: 'active', cancellationSettlement: { revision: 1 } })
  await batch.commit()
  const page = await f.run({ includeSummary: false })
  assert.deepEqual(page.entries.map(entry => entry.canReverse), [true, true, false, false, false, false])
  assert.equal(JSON.stringify(page).includes('canonicalCash'), false)
  assert.equal(JSON.stringify(page).includes('privateNote'), false)
  assert.deepEqual(f.metadataReads, [
    { paths: ['contracts/normal', 'contracts/review', 'contracts/stale', 'contracts/missing', 'contracts/malformed'], fields: ['status', 'cancellationSettlement'] },
    { paths: ['contractSettlements/review', 'contractSettlements/stale'], fields: ['status'] },
  ])
  await f.db.doc('contractSettlements/review').update({ status: 'approved' })
  assert.equal((await f.run({ includeSummary: false })).entries[1].canReverse, false, 'no stale TTL hint after approval')
  const before = f.metadataReads.length
  await assert.rejects(f.run({ includeSummary: false }, 'student'), { code: 'permission-denied' })
  assert.equal(f.metadataReads.length, before, 'authorization precedes private metadata reads')
})

test('real Firestore: selective exhausted first snapshot supplies exact totals with one read pass', async () => {
  const values = Array.from({ length: 200 }, (_, index) => value(index, { branchId: index < 20 ? 'a' : 'b' }))
  const f = await fixture(values)
  const result = await f.run({ branchId: 'a' })
  assert.equal(result.entries.length, 20)
  assert.equal(result.hasMore, false)
  assert.deepEqual(result.summary, summarizeLedgerDocuments(values, normalizeLedgerListInput({ branchId: 'a' })))
  assert.deepEqual(f.reads.map(read => read.size), [20], 'old broad page + summary returned 400 documents')
  assert.deepEqual(f.reads[0].filters, [['branchId', '==', 'a']])
})

test('real Firestore: complete filtered totals preserve legacy data, dates and cursor pagination', async () => {
  const values = Array.from({ length: 180 }, (_, index) => {
    const entry = value(index, {
      branchId: ['a', 'b', '', null, false, 0][index % 6],
      type: ['payment', 'refund', 'reversal', 'expense', 'revenue_recognition', 'adjustment'][index % 6],
      status: ['posted', 'posted', 'reversed', 'pending'][index % 4],
      amount: ['100', -25, 12.5, null, 'bad', 0][index % 6],
      cashImpact: [null, '7.5', -5, 0][index % 4],
      expenseImpact: index % 2 ? -2 : 0,
      currency: index % 2 ? 'VND' : 'USD',
    })
    if (index % 7 === 0) delete entry.branchId
    if (index % 5 === 0) delete entry.cashImpact
    return entry
  })
  const f = await fixture(values)
  const inputs = [
    {}, { branchId: 'a' }, { branchId: 'none' },
    { types: ['payment', 'refund', 'refund'] }, { status: 'reversed' }, { status: 'pending' },
    { branchId: 'none', types: ['refund', 'adjustment'], status: 'posted' },
    { startAt: '2026-10-22T16:58:00Z', endAt: '2026-10-22T17:00:00Z', types: ['payment', 'refund'] },
  ]
  for (const input of inputs) {
    const expectedRows = values.filter(row => (!input.startAt || row.effectiveAt.toMillis() >= Date.parse(input.startAt)) && (!input.endAt || row.effectiveAt.toMillis() <= Date.parse(input.endAt)))
    const result = await f.run({ ...input, pageSize: 10 })
    const expected = summarizeLedgerDocuments(expectedRows, normalizeLedgerListInput(input))
    assert.deepEqual(result.summary, expected, JSON.stringify(input))
    if (result.nextCursor) {
      const next = await f.run({ ...input, pageSize: 10, cursor: result.nextCursor })
      assert.deepEqual(next.summary, expected, 'cursor never scopes the summary')
      assert.equal(new Set([...result.entries, ...next.entries].map(row => row.id)).size, result.entries.length + next.entries.length)
    }
  }
  assert.ok(f.reads.every(read => read.filters.filter(([field]) => field !== 'effectiveAt').length <= 1))
  assert.ok(f.reads.some(read => read.summary && !read.limited), 'large totals use a complete, unbounded query')
})

test('real Firestore: no stale totals cache and denied users cause no ledger reads', async () => {
  const f = await fixture([value(0)])
  await assert.rejects(f.run({}, 'student'), error => error.code === 'permission-denied')
  assert.equal(f.reads.length, 0)
  assert.equal((await f.run({})).summary.cashNet, 100)
  await f.db.doc('ledgerEntries/row-0000').update({ amount: 175 })
  assert.equal((await f.run({})).summary.cashNet, 175)
  assert.equal(f.reads.length, 2, 'each request rereads its authoritative snapshot exactly once')
})

test('real Firestore: entry-only consumers avoid all-period scans on first and cursor pages', async () => {
  const f = await fixture(Array.from({ length: 240 }, (_, index) => value(index)))
  const first = await f.run({ pageSize: 10, includeSummary: false })
  const second = await f.run({ pageSize: 10, cursor: first.nextCursor, includeSummary: false })
  assert.equal(first.summary, null)
  assert.equal(second.summary, null)
  assert.equal(new Set([...first.entries, ...second.entries].map(row => row.id)).size, 20)
  assert.equal(f.reads.length, 2)
  assert.ok(f.reads.every(read => read.limited && !read.summary && read.size === 100))
  await assert.rejects(f.run({ includeSummary: false }, 'student'), error => error.code === 'permission-denied')
  assert.equal(f.reads.length, 2, 'omitting the summary never bypasses authorization')
  const complete = await f.run({ pageSize: 10 })
  assert.equal(complete.summary.cashNet, 24000, 'legacy/default callers still receive exact complete totals')
  await f.db.doc('ledgerEntries/row-0000').update({ amount: 175 })
  assert.equal((await f.run({ pageSize: 10, includeSummary: true })).summary.cashNet, 24075)
})
