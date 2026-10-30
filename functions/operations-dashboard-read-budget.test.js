'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createOperationsDashboardFunctions } = require('./operations-dashboard')
const { branchReadScope, readDashboardQuery } = require('./operations-dashboard-read-policy')
const { stableDashboardCacheKey, CACHE_SCHEMA_VERSION } = require('./operations-dashboard-cache')
const { dashboardPermissions } = require('./operations-dashboard')
const { Timestamp } = require('firebase-admin/firestore')

// Count returned documents, not just query calls. This makes projection-only
// changes distinguishable from reductions in billable document reads.
function memoryDb(seed) {
  const records = new Map(Object.entries(seed))
  const reads = []
  let transactionTail = Promise.resolve()
  const valueAt = (value, field) => field.split('.').reduce((item, key) => item?.[key], value)
  const compare = (value) => value?.toMillis?.() ?? value
  const matches = (actual, operator, expected) => {
    if (operator === 'in') return expected.includes(actual)
    if (operator === 'array-contains') return Array.isArray(actual) && actual.includes(expected)
    if (operator === '>=') return compare(actual) >= compare(expected)
    if (operator === '<=') return compare(actual) <= compare(expected)
    if (operator === '<') return compare(actual) < compare(expected)
    if (operator === '==') return actual === expected
    throw new Error(`Unexpected operator ${operator}`)
  }
  const project = (value, fields) => {
    if (!fields || value === undefined) return value
    const result = {}
    for (const field of fields) {
      const current = valueAt(value, field)
      if (current === undefined) continue
      const keys = field.split('.')
      let target = result
      for (const key of keys.slice(0, -1)) target = target[key] ||= {}
      target[keys.at(-1)] = current
    }
    return result
  }
  const snapshot = (path, fields) => ({ id: path.split('/').at(-1), exists: records.has(path), data: () => project(records.get(path), fields) })
  const query = (name, filters = [], cap = Infinity, fields = null) => ({
    doc: (id) => db.doc(`${name}/${id}`),
    where: (field, operator, expected) => query(name, [...filters, [field, operator, expected]], cap, fields),
    orderBy: () => query(name, filters, cap, fields),
    select: (...selected) => query(name, filters, cap, selected),
    limit: (maximum) => query(name, filters, maximum, fields),
    async get() {
      const docs = [...records].filter(([path, value]) => path.split('/').length === 2 && path.startsWith(`${name}/`)
        && filters.every(([field, operator, expected]) => matches(valueAt(value, field), operator, expected)))
        .slice(0, cap).map(([path]) => snapshot(path, fields))
      const read = { type: 'query', name, filters, cap, fields, documents: docs.length }
      reads.push(read)
      if (db.beforeQuery) await db.beforeQuery(read)
      return { docs, size: docs.length, empty: !docs.length }
    },
    count: () => ({ get: async () => {
      const count = [...records].filter(([path, value]) => path.split('/').length === 2 && path.startsWith(`${name}/`)
        && filters.every(([field, operator, expected]) => matches(valueAt(value, field), operator, expected))).length
      reads.push({ type: 'aggregate', name, filters, documents: 0 })
      return { data: () => ({ count }) }
    } }),
  })
  const db = {
    records, reads,
    doc(path) { return {
      path,
      get: async () => { reads.push({ type: 'document', path, documents: 1 }); return snapshot(path) },
      set: async (value, options) => { records.set(path, options?.merge ? { ...records.get(path), ...value } : value) },
    } },
    collection: (name) => query(name),
    getAll: async (...input) => {
      const options = input.at(-1)?.fieldMask ? input.pop() : null
      return input.map((ref) => { reads.push({ type: 'document', path: ref.path, documents: 1 }); return snapshot(ref.path, options?.fieldMask) })
    },
    runTransaction(work) {
      const next = transactionTail.then(async () => {
        const writes = []
        const result = await work({ get: reference => reference.get(), set: (...args) => writes.push(args) })
        for (const [reference, value, options] of writes) await reference.set(value, options)
        return result
      })
      transactionTail = next.catch(() => {})
      return next
    },
  }
  return db
}

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
const period = { startAt: `${today}T00:00:00+07:00`, endAt: `${today}T23:59:59.999+07:00`, branchId: 'home' }
const quiet = { info() {}, warn() {} }
function fixture(role = 'admin', logger = quiet) {
  const seed = {
    'users/actor': { role, displayName: 'Actor' },
    'roleAssignments/actor': { accessRole: role, status: 'active', authzVersion: 1, positions: role === 'staff' ? ['trainer_pt'] : [], branchIds: ['home'], crmProfileId: 'trainer' },
    'branches/home': { name: 'Home' },
    'branches/other': { name: 'Other' },
    'trainers/trainer': { branchId: 'home', name: 'Trainer' },
    'staff/trainer': { branchId: 'home', name: 'Trainer' },
    'students/student': { branchId: 'home', name: 'Student', status: 'active' },
  }
  for (let index = 0; index < 600; index += 1) {
    seed[`sessions/foreign-${index}`] = { branchId: 'other', trainerId: 'other', studentId: 'foreign', date: today, status: 'completed' }
    seed[`contracts/foreign-${index}`] = { branchId: 'other', status: 'active', startDate: '2020-01-01', endDate: '2099-12-31', totalSessions: 10, usedSessions: 0 }
    seed[`students/foreign-${index}`] = { branchId: 'other', name: 'Foreign' }
    seed[`ledgerEntries/foreign-${index}`] = { branchId: 'other', status: 'posted', type: 'payment', amount: 1000, effectiveAt: Timestamp.fromDate(new Date(`${today}T08:00:00+07:00`)) }
  }
  for (const [index, status] of ['completed', 'no_show', 'scheduled', 'attended'].entries()) {
    seed[`sessions/own-${index}`] = { branchId: 'home', trainerId: index === 3 ? 'actor' : 'trainer', studentId: 'student', date: today, status, hour: index + 8 }
  }
  seed['contracts/current'] = { branchId: 'home', studentId: 'student', status: 'active', startDate: '2020-01-01', endDate: '2099-12-31', totalSessions: 10, usedSessions: 0, totalPrice: 100, paidAmount: 40, nextPaymentDate: today }
  seed['contractUsageViews/current'] = { entitlementSessions: 10, usedSessions: 10, remainingSessions: 0 }
  seed['ledgerEntries/payment'] = { branchId: 'home', status: 'posted', type: 'payment', amount: 50, cashImpact: 40, effectiveAt: Timestamp.fromDate(new Date(`${today}T08:00:00+07:00`)) }
  seed['ledgerEntries/revenue'] = { branchId: 'home', status: 'posted', type: 'revenue_recognition', amount: 30, effectiveAt: Timestamp.fromDate(new Date(`${today}T08:00:00+07:00`)) }
  for (let index = 0; index < 200; index += 1) {
    seed[`contracts/expired-${index}`] = { branchId: 'home', studentId: 'student', status: 'active', startDate: '2020-01-01', endDate: '2020-12-31', totalSessions: 10, usedSessions: 0, totalPrice: 100, paidAmount: 50 }
  }
  const db = memoryDb(seed)
  const handlers = createOperationsDashboardFunctions({ db, logger, onCall: (_options, handler) => handler })
  const request = (data = {}) => ({ auth: { uid: 'actor', token: { accessRole: role, authzVersion: 1 } }, data: { ...period, ...data } })
  return { db, handlers, request }
}
const queries = (db, name) => db.reads.filter((read) => read.type === 'query' && read.name === name)
const documents = (reads) => reads.reduce((total, read) => total + read.documents, 0)

test('dashboard telemetry measures executed scoped reads and cache hits without using cached source totals as new reads', async () => {
  const { shouldSampleMetric } = require('./observability')
  const logs = [], logger = { info: (message, value) => logs.push({ message, value }), warn() {}, error: (message, value) => logs.push({ message, value }) }
  const { db, handlers, request } = fixture('admin', logger)
  const correlationId = Array.from({ length: 100 }, (_, index) => `dashboard-test-${index}`).find(id => shouldSampleMetric(id, .1))
  const first = await handlers.getOperationsDashboard(request({ correlationId }))
  const readsBefore = db.reads.length
  const second = await handlers.getOperationsDashboard(request({ correlationId }))
  const metrics = logs.filter(log => log.message === 'Aura function metric')
  assert.equal(metrics.length, 2)
  assert.equal(metrics[0].value.metrics.cacheMisses, 1)
  assert.ok(metrics[0].value.metrics.logicalQueries > 0)
  assert.ok(metrics[0].value.metrics.documentsReturned >= 201)
  assert.equal(metrics[1].value.metrics.cacheHits, 1)
  assert.equal(metrics[1].value.metrics.documentsReturned, undefined)
  assert.equal(metrics[1].value.metrics.logicalQueries, undefined)
  assert.equal(db.reads.slice(readsBefore).filter(read => read.type === 'query').length, 0)
  assert.deepEqual(second.finance, first.finance)
  assert.doesNotMatch(JSON.stringify(metrics), /correlationId|actorUid|sourceId|Actor|Student|Trainer|Foreign/)
})

test('branch dashboard reduces document reads before limits while preserving canonical package/debt/session metrics', async () => {
  const { db, handlers, request } = fixture()
  const result = await handlers.getOperationsDashboard(request())
  assert.equal(result.clients.total, 1)
  assert.equal(result.clients.exhaustedContracts, 1, 'canonical usage, not stored usedSessions, controls exhaustion')
  assert.equal(result.clients.activeContracts, 0)
  assert.equal(result.finance.receivables, 60 + 200 * 50, 'historical outstanding debt must remain included')
  assert.equal(result.finance.cashCollected, 40)
  assert.equal(result.finance.recognizedRevenue, 30)
  assert.equal(result.operations.sessions, 4)
  assert.equal(result.analytics.attendance.confirmedSessions, 3)
  assert.equal(result.analytics.attendance.noShowSessions, 1)
  assert.equal(result.today.rows.length, 4, 'own rows beyond 500 unrelated sessions cannot disappear')
  assert.equal(result.today.rows[0].studentName, 'Student')
  assert.equal(result.quality.truncated, false)
  assert.equal(documents(queries(db, 'contracts')), 201, 'was 801 documents before branch filter')
  assert.equal(documents(queries(db, 'students')), 1, 'was 601 documents before branch filter')
  assert.equal(documents(queries(db, 'ledgerEntries')), 2, 'was 602 documents before branch filter')
  assert.equal(queries(db, 'sessions').length, 2, 'one range query and one today query, not three overlapping ranges')
  assert.equal(documents(queries(db, 'sessions')), 8, 'was 604 + 603 + 1 + 500 returned documents')
  assert.deepEqual(db.reads.filter((read) => read.path?.startsWith('contractUsageViews/')).map((read) => read.path), ['contractUsageViews/current'])
})

test('trainer dashboard queries both current and legacy trainer IDs without unrelated contracts or OFF analytics', async () => {
  const { db, handlers, request } = fixture('staff')
  const result = await handlers.getOperationsDashboard(request({ branchId: 'all' }))
  assert.equal(result.operations.sessions, 4)
  assert.equal(result.analytics.attendance.confirmedSessions, 3)
  assert.equal(documents(queries(db, 'sessions')), 8)
  for (const read of queries(db, 'sessions')) assert.ok(read.filters.some(([field]) => field === 'trainerId'))
  assert.equal(queries(db, 'contracts').every((read) => read.filters.some(([field]) => field === 'nutritionPTIds')), true)
  assert.equal(queries(db, 'leaveRequests').every((read) => read.filters.some(([field]) => field === 'trainerId')), true)
  assert.equal(db.reads.some((read) => read.path?.startsWith('contractUsageViews/')), false)
})

test('projected ledger rows exclude expense refunds and payroll corrections from net receipts', async () => {
  const { db, handlers, request } = fixture()
  const common = { branchId: 'home', status: 'posted', effectiveAt: Timestamp.fromDate(new Date(`${today}T08:00:00+07:00`)) }
  for (const [index, row] of [
    { type: 'reversal', source: 'accounting', cashImpact: 500, expenseImpact: 0 },
    { type: 'reversal', eventClass: 'expense_voucher_reversal', cashImpact: 600, expenseImpact: 0 },
    { type: 'adjustment', source: 'payroll', cashImpact: 700 },
    { type: 'adjustment', cashImpact: 800, expenseImpact: -800 },
    { type: 'payment', source: 'other', eventClass: 'manual_cash_receipt', cashImpact: 100 },
    { type: 'reversal', source: 'other', eventClass: 'manual_cash_receipt_reversal', cashImpact: -20 },
    { type: 'refund', amount: -10 },
    { type: 'adjustment', amount: 5 },
  ].entries()) db.records.set(`ledgerEntries/classified-${index}`, { ...common, ...row })
  const result = await handlers.getOperationsDashboard(request())
  assert.equal(result.finance.cashCollected, 140)
  assert.equal(result.finance.netCash, 115)
  assert.equal(result.finance.refunds, 10)
  assert.equal(result.finance.reversals, 20)
  assert.equal(result.finance.adjustments, 5)
  assert.equal(result.finance.recognizedRevenue, 30)
  assert.equal(result.analytics.revenue.points.reduce((sum, point) => sum + point.netCash, 0), 115)
})

test('projected financial rows retain imported contract labels when the student profile is missing', async () => {
  const { db, handlers, request } = fixture()
  db.records.set('contracts/current', { ...db.records.get('contracts/current'), studentId: 'missing', studentName: 'Imported student', studentPhone: '0901234567' })
  const result = await handlers.getOperationsDashboard(request())
  const row = result.receivables.rows.find((value) => value.contractId === 'current')
  assert.equal(row.studentName, 'Imported student')
  assert.equal(row.phone, '0901234567')
})

test('projected dashboard retains cancellation snapshots, commercial impacts, approved debt and quality warnings', async () => {
  const { db, handlers, request } = fixture()
  const effectiveAt = Timestamp.fromDate(new Date(`${today}T08:00:00+07:00`))
  db.records.set('contracts/new-cancel', { branchId: 'home', status: 'cancelled', studentId: 'student', totalPrice: 12000000, paidAmount: 3000000,
    salesCancellationSnapshot: { schemaVersion: 1, netAmount: 12000000, effectiveAt },
    cancellationSettlement: { schemaVersion: 1, status: 'approved', settlementAmount: 5000000, canonicalCash: 3000000 },
    installments: [{ status: 'pending', amount: 9000000, date: today }], nextPaymentDate: today })
  db.records.set('contracts/legacy-cancel', { branchId: 'home', status: 'cancelled', studentId: 'student', totalPrice: 9000000, paidAmount: 0 })
  db.records.set('ledgerEntries/cancellation', { branchId: 'home', status: 'posted', type: 'adjustment', effectiveAt, amount: 0, cashImpact: 0, revenueImpact: 0, contractSalesImpact: -7000000 })
  const result = await handlers.getOperationsDashboard(request())
  assert.equal(result.finance.contractSales, 5000000)
  assert.equal(result.finance.grossContractSales, 12000000)
  assert.equal(result.finance.salesAdjustment, -7000000)
  assert.equal(result.finance.receivables, 60 + 200 * 50 + 2000000)
  assert.equal(result.receivables.rows.some(row => row.contractId === 'new-cancel'), false)
  assert.equal(result.quality.cancelledSalesBaselineUnverified, 1)
  assert.equal(result.quality.cancelledSettlementReviewRequired, 1)
  assert.equal(result.quality.completeness, 'partial')
  assert.equal(result.analytics.revenue.points.reduce((sum, point) => sum + point.contractSales, 0), result.finance.contractSales)
})

test('system-wide admin keeps count aggregates instead of downloading historical session documents', async () => {
  const { db, handlers, request } = fixture()
  const result = await handlers.getOperationsDashboard(request({ branchId: 'all' }))
  assert.equal(result.operations.sessions, 604)
  assert.equal(result.analytics.attendance.confirmedSessions, 603)
  assert.equal(result.analytics.attendance.noShowSessions, 1)
  assert.equal(db.reads.filter((read) => read.type === 'aggregate' && read.name === 'sessions').length, 3)
  assert.equal(queries(db, 'sessions').length, 1, 'only the dedicated today list downloads session rows')
  assert.equal(result.today.truncated, true, 'the existing day limit must remain visible')
})

test('concurrent authorized dashboard loads share their expensive reads but still check each caller live', async () => {
  const { db, handlers, request } = fixture()
  const [first, second] = await Promise.all([handlers.getOperationsDashboard(request()), handlers.getOperationsDashboard(request())])
  assert.deepEqual(first, second)
  assert.equal(queries(db, 'contracts').length, 1)
  assert.equal(db.reads.filter((read) => read.path === 'users/actor').length, 2)
  assert.equal(db.reads.filter((read) => read.path === 'roleAssignments/actor').length, 2)
  db.records.set('users/actor', { role: 'admin', disabled: true })
  await assert.rejects(handlers.getOperationsDashboard(request()), { code: 'permission-denied' })
})

test('today sessions use scoped reads and coalesce without finance or directory scans', async () => {
  const { db, handlers, request } = fixture('staff')
  const [first, second] = await Promise.all([handlers.getTodaySessions(request()), handlers.getTodaySessions(request())])
  assert.deepEqual(first, second)
  assert.equal(first.today.rows.length, 4)
  assert.equal(first.today.truncated, false)
  assert.equal(documents(queries(db, 'sessions')), 4)
  assert.equal(queries(db, 'contracts').length, 0)
  assert.equal(queries(db, 'students').length, 0)
  assert.equal(db.reads.filter((read) => read.path?.startsWith('students/')).length, 1)
  db.records.set('roleAssignments/actor', { ...db.records.get('roleAssignments/actor'), authzVersion: 2 })
  await assert.rejects(handlers.getTodaySessions(request()), { code: 'permission-denied' })
})

test('an empty authorized branch scope performs no collection read; unassigned legacy records remain readable', async () => {
  const db = memoryDb({ 'students/legacy': { name: 'Missing branch' }, 'students/current': { branchId: 'home' } })
  assert.equal((await readDashboardQuery(db.collection('students'), branchReadScope({ branchId: 'all', branchIds: [], unrestricted: false }), 100)).size, 0)
  assert.equal(db.reads.length, 0)
  assert.equal((await readDashboardQuery(db.collection('students'), branchReadScope({ branchId: 'none', branchIds: [], unrestricted: false }), 100)).size, 2)
})

test('attendance scopes preserve legacy missing/null/blank branch semantics and avoid unrelated branch reads', async () => {
  const { db, handlers, request } = fixture()
  const occurredAt = Timestamp.fromDate(new Date(`${today}T08:00:00+07:00`))
  db.records.set('attendanceEvents/home', { branchId: 'home', trainerId: 'trainer', occurredAt })
  db.records.set('attendanceEvents/legacy-missing', { trainerId: 'trainer', occurredAt })
  db.records.set('attendanceEvents/legacy-empty', { branchId: '', trainerId: 'trainer', occurredAt })
  db.records.set('attendanceEvents/legacy-null', { branchId: null, trainerId: 'actor', occurredAt })
  for (let index = 0; index < 600; index += 1) db.records.set(`attendanceEvents/foreign-${index}`, { branchId: 'other', trainerId: 'other', occurredAt })
  const branch = await handlers.getOperationsDashboard(request())
  assert.equal(branch.operations.attendanceEvents, 1, 'explicit branch already excludes legacy records without a matching branch')
  assert.equal(documents(queries(db, 'attendanceEvents')), 1, 'was 604 downloaded events before branch filtering')
  assert.ok(queries(db, 'attendanceEvents')[0].filters.some(([field, operator, value]) => field === 'branchId' && operator === '==' && value === 'home'))
  db.reads.length = 0
  const unassigned = await handlers.getOperationsDashboard(request({ branchId: 'none' }))
  assert.equal(unassigned.operations.attendanceEvents, 3, 'none must retain missing, empty and null branches')
  assert.equal(documents(queries(db, 'attendanceEvents')), 604, 'legacy none scope deliberately retains its bounded fallback')
  assert.equal(queries(db, 'attendanceEvents')[0].filters.some(([field]) => field === 'branchId'), false)
  db.reads.length = 0
  const all = await handlers.getOperationsDashboard(request({ branchId: 'all' }))
  assert.equal(all.operations.attendanceEvents, 604)
  assert.equal(queries(db, 'attendanceEvents').length, 0, 'unrestricted totals retain server count aggregation')
})

test('trainer attendance remains trainer scoped even when legacy events have no branch', async () => {
  const { db, handlers, request } = fixture('staff')
  const occurredAt = Timestamp.fromDate(new Date(`${today}T08:00:00+07:00`))
  db.records.set('attendanceEvents/own-home', { branchId: 'home', trainerId: 'trainer', occurredAt })
  db.records.set('attendanceEvents/own-missing', { trainerId: 'trainer', occurredAt })
  db.records.set('attendanceEvents/own-null', { branchId: null, trainerId: 'actor', occurredAt })
  db.records.set('attendanceEvents/foreign', { branchId: 'home', trainerId: 'different-trainer', occurredAt })
  const result = await handlers.getOperationsDashboard(request({ branchId: 'all' }))
  assert.equal(result.operations.attendanceEvents, 3)
  assert.equal(documents(queries(db, 'attendanceEvents')), 3)
  assert.ok(queries(db, 'attendanceEvents')[0].filters.some(([field]) => field === 'trainerId'))
  assert.equal(queries(db, 'attendanceEvents')[0].filters.some(([field]) => field === 'branchId'), false)
})

test('the explicit branch attendance range has its required composite index', () => {
  const indexes = require('../firestore.indexes.json').indexes
  assert.ok(indexes.some((index) => index.collectionGroup === 'attendanceEvents' && index.queryScope === 'COLLECTION'
    && index.fields[0]?.fieldPath === 'branchId' && index.fields[0]?.order === 'ASCENDING'
    && index.fields[1]?.fieldPath === 'occurredAt' && index.fields[1]?.order === 'ASCENDING'))
})

test('more than thirty authorized branches share one document budget and retain the truncation sentinel', async () => {
  const ids = Array.from({ length: 61 }, (_, index) => `branch-${index}`)
  const db = memoryDb({
    'students/a1': { branchId: ids[0] },
    'students/a2': { branchId: ids[0] },
    'students/b1': { branchId: ids[30] },
    'students/c1': { branchId: ids[60] },
    'students/c2': { branchId: ids[60] },
  })
  const snapshot = await readDashboardQuery(db.collection('students'), { field: 'branchId', ids: [...ids, ids[0]] }, 4)
  assert.equal(snapshot.size, 4, 'three visible rows plus the overflow sentinel')
  assert.equal(snapshot.size > 3, true)
  assert.equal(documents(queries(db, 'students')), 4)
  assert.deepEqual(queries(db, 'students').map((query) => query.cap), [4, 2, 1])

  const saturated = memoryDb(Object.fromEntries(ids.flatMap((branchId, index) => Array.from({ length: 4 }, (_, row) => [`students/${index}-${row}`, { branchId }]))))
  assert.equal((await readDashboardQuery(saturated.collection('students'), { field: 'branchId', ids }, 4)).size, 4)
  assert.equal(queries(saturated, 'students').length, 1, 'later chunks are never read after the global budget is full')
  assert.equal(documents(queries(saturated, 'students')), 4, 'previous implementation read twelve documents for this request')
})

test('failed dashboard loads do not poison pending reads or later retries', async () => {
  const { db, handlers, request } = fixture()
  db.beforeQuery = async (read) => { if (read.name === 'contracts') throw new Error('transient read failure') }
  await assert.rejects(handlers.getOperationsDashboard(request()), /transient read failure/)
  db.beforeQuery = null
  assert.equal((await handlers.getOperationsDashboard(request())).clients.total, 1)
})

test('a forced refresh supersedes an earlier in-flight response without repopulating stale caches', async () => {
  const { db, handlers, request } = fixture()
  let unblock
  let signalRead
  const entered = new Promise((resolve) => { signalRead = resolve })
  const blocked = new Promise((resolve) => { unblock = resolve })
  let blockedOnce = false
  db.beforeQuery = async (read) => {
    if (read.name === 'students' && !blockedOnce) { blockedOnce = true; signalRead(); await blocked }
  }
  const old = handlers.getOperationsDashboard(request())
  await entered
  db.records.set('students/new', { branchId: 'home', name: 'New student', status: 'active' })
  const refreshed = await handlers.getOperationsDashboard(request({ forceRefresh: true }))
  assert.equal(refreshed.clients.total, 2)
  unblock()
  assert.equal((await old).clients.total, 1)
  assert.equal((await handlers.getOperationsDashboard(request())).clients.total, 2)
  const shared = [...db.records].find(([path]) => path.startsWith('systemOperationsDashboardCache/'))?.[1]
  assert.equal(shared.value.clients.total, 2)
})

test('a shared cache near expiry cannot gain another minute when promoted into memory', async () => {
  const { db, handlers, request } = fixture()
  const actor = { uid: 'actor', accessRole: 'admin', positions: [], capabilities: [] }
  const key = stableDashboardCacheKey({ actor, permissions: dashboardPermissions(actor), scope: { branchId: 'home', branchIds: ['home'], unrestricted: false },
    startDate: today, endDate: today, startAt: new Date(period.startAt).toISOString(), endAt: new Date(period.endAt).toISOString(), today })
  const now = Date.now()
  db.records.set(`systemOperationsDashboardCache/${key}`, { schemaVersion: CACHE_SCHEMA_VERSION, valueExpiresAt: Timestamp.fromMillis(now + 5_000), expiresAt: Timestamp.fromMillis(now + 5_000), value: { clients: { total: 999 } } })
  const originalNow = Date.now
  try {
    Date.now = () => now
    assert.equal((await handlers.getOperationsDashboard(request())).clients.total, 999)
    assert.equal(queries(db, 'contracts').length, 0)
    Date.now = () => now + 6_000
    assert.equal((await handlers.getOperationsDashboard(request())).clients.total, 1)
    assert.equal(queries(db, 'contracts').length, 1)
  } finally { Date.now = originalNow }
})
