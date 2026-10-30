'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createReadBudgetObserver, installLocalNetworkGuard } = require('./test-helpers/reporting-read-budget.cjs')

function nativeDouble({ retry = false, failCommit = false } = {}) {
  const raw = {
    doc(path) { return { path, get() { return raw.getAll(this).then(rows => rows[0]) } } },
    collection(path) { return {
      path, select() { return this }, orderBy() { return this }, limit() { return this },
      doc(id) { return raw.doc(`${path}/${id}`) },
      async get() { return { size: 2, docs: [{}, {}] } },
    } },
    async getAll(...refs) { return refs.filter(ref => ref.path).map(ref => ({ ref, exists: !ref.path.endsWith('/missing') })) },
    async runTransaction(callback) {
      const transaction = { get(input) { return input.get() }, set() { return transaction } }
      if (retry) await callback(transaction)
      const result = await callback(transaction)
      if (failCommit) throw new Error('fixture commit failure')
      return result
    },
  }
  return raw
}

test('observer counts direct/getAll documents once, including missing records and field masks', async () => {
  const { db, measure } = createReadBudgetObserver(nativeDouble(), { actorId: 'admin' })
  const { counters } = await measure(async () => {
    await db.doc('users/admin').get()
    await db.getAll(db.doc('students/one'), db.doc('students/missing'), { fieldMask: ['name'] })
    await db.collection('contracts').select('paidAmount').orderBy('id').limit(2).get()
  })
  assert.equal(counters.buckets.auth.pointReadCalls, 1)
  assert.equal(counters.buckets.auth.pointReadAttempts, 1)
  assert.equal(counters.buckets.auth.pointDocumentSnapshots, 1)
  assert.equal(counters.buckets.label.pointReadCalls, 1)
  assert.equal(counters.buckets.label.pointReadAttempts, 2)
  assert.equal(counters.buckets.label.pointDocumentSnapshots, 1)
  assert.equal(counters.buckets.label.missingDocumentSnapshots, 1)
  assert.equal(counters.buckets.source.queryAttempts, 1)
  assert.equal(counters.buckets.source.queryDocumentSnapshots, 2)
})

test('observer unwraps chained transaction queries and separates retried writes from committed writes', async () => {
  const { db, measure } = createReadBudgetObserver(nativeDouble({ retry: true }), { actorId: 'admin' })
  const { counters } = await measure(() => db.runTransaction(async transaction => {
    await transaction.get(db.collection('contracts').select('paidAmount').orderBy('id').limit(2))
    await transaction.get(db.doc('systemOperationsDashboardCache/fixture'))
    transaction.set(db.doc('systemOperationsDashboardCache/fixture'), { value: 'test' })
  }))
  assert.equal(counters.transactions.readWriteCalls, 1)
  assert.equal(counters.transactions.readWriteCallbackAttempts, 2)
  assert.equal(counters.transactions.completedCalls, 1)
  assert.equal(counters.buckets.source.queryDocumentSnapshots, 4)
  assert.equal(counters.buckets.cache.pointReadAttempts, 2)
  assert.equal(counters.buckets.cache.writeAttempts, 2)
  assert.equal(counters.buckets.cache.committedWrites, 1)
})

test('failed commit is not counted as committed; measured errors retain identity', async () => {
  const raw = nativeDouble({ failCommit: true })
  const { db, measure } = createReadBudgetObserver(raw, { actorId: 'admin' })
  const { counters } = await measure(async () => {
    await assert.rejects(db.runTransaction(transaction => transaction.set(db.doc('systemOperationsDashboardCache/fixture'), {})), /fixture commit failure/)
    const expected = new Error('read failure')
    raw.getAll = async () => { throw expected }
    await assert.rejects(db.doc('users/admin').get(), error => error === expected)
  })
  assert.equal(counters.transactions.failedCalls, 1)
  assert.equal(counters.buckets.cache.writeAttempts, 1)
  assert.equal(counters.buckets.cache.committedWrites, 0)
  assert.equal(counters.buckets.auth.pointReadAttempts, 1)
  assert.equal(counters.buckets.auth.pointReadCompletions, 0)
  assert.equal(counters.errors, 1)
})

test('overlapping measurement contexts stay separate and unsupported/unclassified reads fail closed', async () => {
  const { db, measure } = createReadBudgetObserver(nativeDouble(), { actorId: 'admin' })
  const [left, right] = await Promise.all([
    measure(async () => { await Promise.resolve(); await db.doc('users/admin').get() }),
    measure(async () => { await db.doc('students/one').get(); await db.doc('students/two').get() }),
  ])
  assert.equal(left.counters.buckets.auth.pointReadAttempts, 1)
  assert.equal(left.counters.buckets.label.pointReadAttempts, 0)
  assert.equal(right.counters.buckets.auth.pointReadAttempts, 0)
  assert.equal(right.counters.buckets.label.pointReadAttempts, 2)
  await assert.rejects(measure(() => db.doc('unknown/one').get()), /Unclassified/)
  assert.throws(() => db.collection('contracts').count(), /Unobserved/)
  await assert.rejects(db.doc('users/admin').get(), /measurement phase/)
})

test('loopback-only guard rejects nonlocal SDK transport and fetch before opening sockets', async () => {
  const before = process.env.FIRESTORE_EMULATOR_HOST
  process.env.FIRESTORE_EMULATOR_HOST = 'production.invalid:443'
  assert.throws(() => installLocalNetworkGuard(), /loopback/)
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8287'
  const guard = installLocalNetworkGuard()
  try {
    assert.throws(() => require('node:http').get('https://example.com'), /non-loopback/)
    assert.throws(() => require('node:tls').connect({ host: 'example.com', port: 443 }), /non-loopback/)
    assert.throws(() => require('node:net').connect({ host: 'example.com', port: 443 }), /non-loopback/)
    assert.throws(() => fetch('https://example.com'), /non-loopback/)
    assert.equal(guard.blocked.length, 4)
  } finally {
    guard.restore()
    if (before === undefined) delete process.env.FIRESTORE_EMULATOR_HOST
    else process.env.FIRESTORE_EMULATOR_HOST = before
  }
})
