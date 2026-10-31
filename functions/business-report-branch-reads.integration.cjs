'use strict'

const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { createBusinessReportingFunctions } = require('./business-reporting')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `report-branch-${randomUUID()}`)
const clients = []
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })
const date = Timestamp.fromDate(new Date('2026-10-15T12:00:00+07:00'))
const row = (patch = {}) => ({ branchId: 'a', effectiveAt: date, occurredAt: date, paidAt: date, amount: 100, type: 'payment', source: 'pt_gym', status: 'posted', ...patch })
async function fixture(entries = []) {
  const db = getFirestore(app, `report-branch-${randomUUID()}`)
  clients.push(db)
  const documents = [
    ['users/admin', { role: 'admin' }], ['users/manager', { role: 'manager', branchId: 'a' }], ['users/student', { role: 'student' }],
    ['users/disabled', { role: 'admin', disabled: true }], ...entries,
  ]
  for (let offset = 0; offset < documents.length; offset += 1500) {
    await Promise.all([0, 500, 1000].map(async delta => {
      const chunk = documents.slice(offset + delta, Math.min(offset + delta + 500, offset + 1500))
      if (!chunk.length) return
      const batch = db.batch()
      for (const [path, data] of chunk) batch.set(db.doc(path), data)
      await batch.commit()
    }))
  }
  const reads = [], authReads = []
  const query = (target, name, filters = [], orders = [], maximum = Infinity) => ({
    target,
    record: result => reads.push({ collection: name, filters, orders, maximum, returned: result.size }),
    select: (...fields) => query(target.select(...fields), name, filters, orders, maximum),
    where: (...filter) => query(target.where(...filter), name, [...filters, filter], orders, maximum),
    orderBy: (...order) => query(target.orderBy(...order), name, filters, [...orders, order], maximum),
    limit: maximum => query(target.limit(maximum), name, filters, orders, maximum),
    get: async () => {
      const result = await target.get()
      reads.push({ collection: name, filters, orders, maximum, returned: result.size })
      return result
    },
  })
  // The callable can only read, including one consistent sales snapshot.
  const readDb = {
    doc: path => {
      assert.match(path, /^(users|roleAssignments|reportingIndexes)\//)
      const record = () => { if (!path.startsWith('reportingIndexes/')) authReads.push(path) }
      return { target: db.doc(path), record, get: () => { record(); return db.doc(path).get() } }
    },
    runTransaction: (handler, options) => {
      assert.deepEqual(options, { readOnly: true })
      return db.runTransaction(transaction => handler({ get: async reference => {
        const result = await transaction.get(reference.target)
        reference.record(result)
        return result
      } }), options)
    },
    collection: name => { assert(['ledgerEntries', 'cashTransactions', 'payrollRuns', 'attendanceEvents', 'cashAccounts', 'contracts'].includes(name)); return query(db.collection(name), name) },
  }
  const api = createBusinessReportingFunctions({ db: readDb, onCall: (_options, handler) => handler })
  const run = (input = {}, role = 'admin') => api.listBusinessPerformance({ auth: role ? { uid: role, token: { role: role === 'disabled' ? 'admin' : role } } : null,
    data: { startDate: '2026-10-01', endDate: '2026-10-31', branchId: 'a', ...input } })
  return { db, reads, authReads, run }
}

test('real Firestore: over ten thousand foreign rows per source cannot consume branch limits', { timeout: 180000 }, async () => {
  const documents = []
  for (const collection of ['ledgerEntries', 'cashTransactions', 'attendanceEvents']) {
    for (let index = 0; index < 10002; index += 1) documents.push([`${collection}/foreign-${String(index).padStart(5, '0')}`,
      row({ branchId: 'b', sessionId: `foreign-${index}`, effectiveAt: Timestamp.fromMillis(date.toMillis() - 1000) })])
  }
  documents.push(['ledgerEntries/selected', row()], ['cashTransactions/selected', row()], ['attendanceEvents/selected', row({ sessionId: 'selected' })])
  const f = await fixture(documents)
  const result = await f.run({}, 'manager')
  assert.equal(result.cashFlow.cashIn, 100)
  assert.equal(result.dataQuality.unlinkedCashTransactions, 100)
  assert.equal(result.dataQuality.attendanceEvents, 1)
  assert.equal(result.dataQuality.unrecognisedAttendanceEvents, 1)
  assert.equal(result.dataQuality.ledgerTruncated, false)
  assert.equal(result.dataQuality.attendanceTruncated, false)
  assert.equal(result.dataQuality.cashTransactionsTruncated, false)
  assert.equal(f.reads.reduce((sum, read) => sum + read.returned, 0), 3, '3 business documents returned; auth and index units are separate')
  assert(f.reads.filter(read => ['ledgerEntries', 'cashTransactions', 'attendanceEvents'].includes(read.collection))
    .every(read => read.filters.some(([field, op, value]) => field === 'branchId' && op === '==' && value === 'a')))
  // Both legacy endpoint factories share the same handler, so the regional alias
  // gets the same predicates. A system report retains its bounded global view.
  const system = await f.run({ branchId: 'all' })
  assert.equal(system.dataQuality.ledgerTruncated, true)
  assert.equal(system.dataQuality.attendanceTruncated, true)
  assert.equal(system.dataQuality.cashTransactionsTruncated, true)
  assert.match(system.dataQuality.message, /giới hạn tải/)
})

test('real Firestore: scope, Vietnam boundaries, legacy rows and payroll semantics', async () => {
  const start = Timestamp.fromDate(new Date('2026-10-01T00:00:00+07:00'))
  const next = Timestamp.fromDate(new Date('2026-11-01T00:00:00+07:00'))
  const f = await fixture([
    ['ledgerEntries/start', row({ effectiveAt: start })],
    ['ledgerEntries/before', row({ effectiveAt: Timestamp.fromMillis(start.toMillis() - 1) })],
    ['ledgerEntries/end', row({ effectiveAt: next })],
    ['ledgerEntries/unallocated', { effectiveAt: date, amount: 25, type: 'payment', status: 'posted' }],
    ['ledgerEntries/recognised', row({ type: 'revenue_recognition', sessionId: 'recognised', cashImpact: 0, revenueImpact: 30 })],
    ['attendanceEvents/recognised', row({ sessionId: 'recognised' })], ['attendanceEvents/missing', row({ sessionId: 'missing' })],
    ['attendanceEvents/other', row({ branchId: 'b', sessionId: 'other' })], ['attendanceEvents/unallocated', { occurredAt: date, sessionId: 'unallocated' }],
    ['payrollRuns/own', row({ finalAmount: 100 })], ['payrollRuns/other', row({ branchId: 'b', finalAmount: 300 })],
    ['payrollRuns/unallocated', { paidAt: date, finalAmount: 50 }], ['cashAccounts/ready', { status: 'active' }],
    ['contracts/own', { branchId: 'a', status: 'active', totalPrice: 1000, discount: 100, signedAt: start }],
    ['contracts/other', { branchId: 'b', status: 'active', totalPrice: 5000, signedAt: start }],
    ['contracts/cancelled', { branchId: 'a', status: 'cancelled', totalPrice: 0,
      salesCancellationSnapshot: { schemaVersion: 1, netAmount: 400, effectiveAt: date } }],
    ['ledgerEntries/cancel-sales', row({ type: 'adjustment', amount: 0, cashImpact: 0, contractSalesImpact: -300 })],
  ])
  const branch = await f.run(), system = await f.run({ branchId: 'all' })
  assert.equal(branch.cashFlow.cashIn, 100)
  assert.equal(system.cashFlow.cashIn, 125)
  assert.equal(branch.managementPnl.recognisedRevenue, 30)
  assert.equal(branch.dataQuality.unrecognisedAttendanceEvents, 1)
  assert.equal(system.dataQuality.unrecognisedAttendanceEvents, 3)
  assert.equal(branch.dataQuality.payrollPaidOutsideLedger, 150)
  assert.equal(system.dataQuality.payrollPaidOutsideLedger, 450)
  assert.equal(branch.dataQuality.cashAccountsReady, true)
  assert.equal(branch.sales.netContractSales, 1000)
  assert.equal(system.sales.netContractSales, 6000)
  assert.equal(branch.sales.complete, true)
  assert.deepEqual(branch.dailySeries.map(day => [day.date, day.netCash, day.contractSales, day.recognisedRevenue]),
    [['2026-10-01', 100, 900, 0], ['2026-10-15', 0, 100, 30]])
  assert.equal(branch.receipts.net, 100)
  assert.equal((await f.run({ source: 'legacy_unclassified' })).cashFlow.cashIn, 0)
  assert.equal((await f.run({ source: 'legacy_unclassified', branchId: 'all' })).cashFlow.cashIn, 25)
  const before = f.reads.length
  for (const role of ['student', 'disabled', null]) await assert.rejects(f.run({}, role), error => ['permission-denied', 'unauthenticated'].includes(error.code))
  for (const branchId of ['all', 'b']) await assert.rejects(f.run({ branchId }, 'manager'), error => error.code === 'permission-denied')
  assert.equal(f.reads.length, before, 'denied reads never construct business queries')
})
