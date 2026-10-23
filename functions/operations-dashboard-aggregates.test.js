'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { Timestamp } = require('firebase-admin/firestore')
const {
  contribution, contributionDeltas, loadDailyAggregates,
  rebuildOperationsDailyAggregates, syncDailyAggregateWrite,
} = require('./operations-dashboard-aggregates')

test('ledger aggregate separates cash collection and recognised revenue', () => {
  const payment = contribution('ledger', {
    status: 'posted', type: 'payment', amount: 1_000_000,
    effectiveAt: '2026-08-29T10:00:00+07:00', branchId: 'branch-1',
  })
  const revenue = contribution('ledger', {
    status: 'posted', type: 'revenue_recognition', amount: 350_000,
    effectiveAt: '2026-08-29T11:00:00+07:00', branchId: 'branch-1',
  })
  assert.equal(payment.metrics.cashCollected, 1_000_000)
  assert.equal(payment.metrics.netCash, 1_000_000)
  assert.equal(payment.metrics.recognizedRevenue, 0)
  assert.equal(revenue.metrics.netCash, 0)
  assert.equal(revenue.metrics.recognizedRevenue, 350_000)
})

test('session aggregate tracks status, confirmations and no-shows', () => {
  const item = contribution('session', {
    status: 'no_show', date: '2026-08-29', branchId: 'branch-1',
  })
  assert.deepEqual(item.metrics, {
    sessions: 1,
    confirmedSessions: 1,
    noShowSessions: 1,
    sessionStatus__no_show: 1,
  })
})

test('moving a source document subtracts its old daily bucket and adds the new bucket', () => {
  const before = contribution('student', { joinDate: '2026-08-28', branchId: 'branch-1' })
  const after = contribution('student', { joinDate: '2026-08-29', branchId: 'branch-2' })
  assert.deepEqual(contributionDeltas(before, after), [
    { date: '2026-08-28', branchId: 'branch-1', metrics: { newStudents: -1 } },
    { date: '2026-08-29', branchId: 'branch-2', metrics: { newStudents: 1 } },
  ])
})

test('cancelled contracts are removed from contract sales aggregates', () => {
  const before = contribution('contract', {
    status: 'active', totalPrice: 10_000_000, discount: 1_000_000,
    signedAt: '2026-08-20T09:00:00+07:00', branchId: 'branch-1',
  })
  const after = contribution('contract', {
    status: 'cancelled', totalPrice: 10_000_000, discount: 1_000_000,
    signedAt: '2026-08-20T09:00:00+07:00', branchId: 'branch-1',
  })
  assert.equal(after, null)
  assert.deepEqual(contributionDeltas(before, after)[0].metrics, { contractSales: -9_000_000 })
})

const quiet = { info() {} }
const coveragePath = 'operationsAggregateCoverage/dashboard-v2'
const now = new Date('2026-10-23T10:00:00Z')
const defaultSession = { date: '2026-10-23', branchId: 'branch-1', status: 'scheduled' }

function copy(value) {
  if (!value || typeof value !== 'object' || value instanceof Timestamp) return value
  if (Array.isArray(value)) return value.map(copy)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]))
}

// Transaction-aware fake: reads are versioned, writes are atomic, and a
// conflicting transaction retries. Tests exercise the exported production
// sync/rebuild/load functions rather than a separate arithmetic substitute.
function fakeDatabase(seed = {}) {
  const records = new Map(Object.entries(seed).map(([key, value]) => [key, copy(value)]))
  const versions = new Map()
  const stats = { reads: 0, writes: 0, transactions: 0, retries: 0 }
  const transform = (value, prior, merge) => {
    if (value?.constructor?.name === 'NumericIncrementTransform') return (prior || 0) + value.operand
    if (value?.constructor?.name === 'ServerTimestampTransform') return Timestamp.fromDate(now)
    if (!value || typeof value !== 'object' || value instanceof Timestamp) return value
    const result = merge && prior && typeof prior === 'object' ? copy(prior) : {}
    for (const [key, item] of Object.entries(value)) result[key] = transform(item, prior?.[key], merge)
    return result
  }
  const write = (path, value, merge = false) => {
    records.set(path, transform(value, records.get(path), merge))
    versions.set(path, (versions.get(path) || 0) + 1)
    stats.writes += 1
  }
  const remove = (path) => {
    records.delete(path)
    versions.set(path, (versions.get(path) || 0) + 1)
    stats.writes += 1
  }
  const reference = (path) => ({
    path, id: path.split('/').at(-1),
    get: async () => { stats.reads += 1; return snapshot(path) },
  })
  const snapshot = (path) => {
    const data = copy(records.get(path))
    return { exists: data !== undefined, ref: reference(path), id: path.split('/').at(-1), data: () => copy(data) }
  }
  const comparable = (value) => value instanceof Timestamp ? value.toMillis() : value
  const query = (name, filters = [], cap = Infinity) => ({
    name, filters, cap,
    doc: (id) => reference(`${name}/${id}`),
    where: (field, operator, value) => query(name, [...filters, [field, operator, value]], cap),
    limit: (value) => query(name, filters, value),
    async get() {
      stats.reads += 1
      const docs = [...records.keys()].filter((path) => path.startsWith(`${name}/`) && path.split('/').length === 2)
        .filter((path) => filters.every(([field, operator, expected]) => {
          const actual = comparable(records.get(path)[field])
          if (operator === '>=') return actual >= comparable(expected)
          if (operator === '<=') return actual <= comparable(expected)
          if (operator === '<') return actual < comparable(expected)
          return actual === comparable(expected)
        })).slice(0, cap).map(snapshot)
      const result = { docs, size: docs.length }
      if (db.afterQuery) await db.afterQuery({ name, filters, cap }, result)
      return result
    },
  })
  const db = {
    records, stats, write, remove,
    collection: (name) => query(name),
    async runTransaction(callback) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        stats.transactions += 1
        const reads = new Map()
        const operations = []
        const result = await callback({
          async get(ref) {
            assert.equal(operations.length, 0, 'all reads must precede transaction writes')
            stats.reads += 1
            reads.set(ref.path, versions.get(ref.path) || 0)
            return snapshot(ref.path)
          },
          set(ref, value, options) { operations.push({ path: ref.path, value, merge: options?.merge === true }) },
          delete(ref) { operations.push({ path: ref.path, remove: true }) },
        })
        if (db.beforeCommit) await db.beforeCommit(operations)
        if ([...reads].some(([path, version]) => (versions.get(path) || 0) !== version)) {
          stats.retries += 1
          continue
        }
        for (const operation of operations) {
          if (operation.remove) remove(operation.path)
          else write(operation.path, operation.value, operation.merge)
        }
        return result
      }
      throw new Error('FAKE_TRANSACTION_RETRY_LIMIT')
    },
  }
  return db
}

function eventFor(db, path, before, after, id = 'event') {
  const snapshot = (value) => ({ exists: value !== undefined, data: () => value, ref: db.collection(path.split('/')[0]).doc(path.split('/')[1]) })
  return { id, data: { before: snapshot(before), after: snapshot(after) } }
}

function sync(db, path, before, after, source = 'session', id) {
  return syncDailyAggregateWrite({ db, source, event: eventFor(db, path, before, after, id), logger: quiet })
}

function rebuild(db, days = 3) {
  return rebuildOperationsDailyAggregates({ db, logger: quiet, days, now })
}

function load(db, scope = { unrestricted: true }) {
  return loadDailyAggregates({ db, startDate: '2026-10-21', endDate: '2026-10-23', scope })
}

test('v1 or missing baseline falls back and never bootstraps totals from a single event', async () => {
  for (const coverage of [undefined, { schemaVersion: 1, status: 'ready', complete: true, startDate: '2026-01-01', endDate: '2026-12-31' }]) {
    const db = fakeDatabase({ 'sessions/s1': defaultSession, ...(coverage ? { [coveragePath]: coverage } : {}) })
    assert.equal(await load(db), null)
    assert.deepEqual(await sync(db, 'sessions/s1', undefined, defaultSession), { updated: 0, reason: 'awaiting_rebuild' })
    assert.equal(db.stats.writes, 0)
  }
})

test('metadata-only events remain a zero-read no-op', async () => {
  const db = fakeDatabase()
  assert.deepEqual(await sync(db, 'sessions/s1', defaultSession, { ...defaultSession, generatedAt: 123 }), { updated: 0 })
  assert.equal(db.stats.reads, 0)
  assert.equal(db.stats.writes, 0)
})

test('full rebuild absorbs delayed create and update events already included in baseline', async () => {
  const updated = { ...defaultSession, status: 'completed' }
  const db = fakeDatabase({ 'sessions/s1': updated })
  await rebuild(db)
  assert.deepEqual(await sync(db, 'sessions/s1', undefined, defaultSession), { updated: 0 })
  assert.deepEqual(await sync(db, 'sessions/s1', defaultSession, updated), { updated: 0 })
  const value = await load(db)
  assert.equal(value.totals.sessions, 1)
  assert.equal(value.totals.confirmedSessions, 1)
})

test('duplicate simultaneous deliveries apply one contribution transactionally', async () => {
  const db = fakeDatabase()
  await rebuild(db)
  db.write('sessions/s1', defaultSession)
  const results = await Promise.all([
    sync(db, 'sessions/s1', undefined, defaultSession),
    sync(db, 'sessions/s1', undefined, defaultSession),
  ])
  assert.equal(results.reduce((sum, item) => sum + item.updated, 0), 1)
  assert.equal((await load(db)).totals.sessions, 1)
  assert.ok(db.stats.retries >= 1)
})

test('out-of-order events reconcile latest branch/date/status rather than stale event payload', async () => {
  const db = fakeDatabase({ 'sessions/s1': defaultSession })
  await rebuild(db)
  const intermediate = { ...defaultSession, branchId: 'branch-2', status: 'completed' }
  const current = { ...defaultSession, branchId: 'branch-3', date: '2026-10-22', status: 'no_show' }
  db.write('sessions/s1', current)
  await sync(db, 'sessions/s1', intermediate, current, 'session', 'newer')
  await sync(db, 'sessions/s1', defaultSession, intermediate, 'session', 'older')
  assert.equal((await load(db)).totals.sessions, 1)
  assert.equal((await load(db, { branchIds: ['branch-1'] })).totals.sessions, 0)
  assert.equal((await load(db, { branchIds: ['branch-2'] })).totals.sessions, undefined)
  const latest = await load(db, { branchIds: ['branch-3'] })
  assert.equal(latest.totals.sessions, 1)
  assert.equal(latest.totals.noShowSessions, 1)
  assert.equal(latest.days[0].date, '2026-10-22')
})

test('delete and replay subtract exactly once; late older creates cannot resurrect deleted sources', async () => {
  const db = fakeDatabase({ 'sessions/s1': defaultSession })
  await rebuild(db)
  db.remove('sessions/s1')
  await sync(db, 'sessions/s1', defaultSession, undefined)
  await sync(db, 'sessions/s1', defaultSession, undefined)
  await sync(db, 'sessions/s1', undefined, defaultSession)
  assert.equal((await load(db)).totals.sessions, 0)
})

test('delayed deletion after document recreation preserves the current document', async () => {
  const db = fakeDatabase({ 'sessions/s1': defaultSession })
  await rebuild(db)
  const recreated = { ...defaultSession, branchId: 'branch-2', status: 'completed' }
  db.remove('sessions/s1')
  db.write('sessions/s1', recreated)
  await sync(db, 'sessions/s1', defaultSession, undefined)
  await sync(db, 'sessions/s1', undefined, recreated)
  assert.equal((await load(db)).totals.sessions, 1)
  assert.equal((await load(db, { branchIds: ['branch-2'] })).totals.confirmedSessions, 1)
})

test('deleted before rebuild plus delayed deletion does not create negative totals', async () => {
  const db = fakeDatabase({ 'sessions/s1': defaultSession })
  await rebuild(db)
  db.remove('sessions/s1')
  await rebuild(db)
  assert.deepEqual(await sync(db, 'sessions/s1', defaultSession, undefined), { updated: 0 })
  assert.equal((await load(db)).totals.sessions, undefined)
})

test('moves into and out of coverage clip both sides to the active generation range', async () => {
  const outside = { ...defaultSession, date: '2026-10-01' }
  const db = fakeDatabase({ 'sessions/s1': outside })
  await rebuild(db)
  db.write('sessions/s1', defaultSession)
  await sync(db, 'sessions/s1', outside, defaultSession)
  assert.equal((await load(db)).totals.sessions, 1)
  db.write('sessions/s1', outside)
  await sync(db, 'sessions/s1', defaultSession, outside)
  assert.equal((await load(db)).totals.sessions, 0)
})

test('source mutation after rebuild query retries during build then reconciles against seeded baseline', async () => {
  const db = fakeDatabase({ 'sessions/s1': defaultSession })
  const updated = { ...defaultSession, status: 'completed', branchId: 'branch-2' }
  let changed = false
  db.afterQuery = async ({ name }) => {
    if (name !== 'sessions' || changed) return
    changed = true
    db.write('sessions/s1', updated)
    await assert.rejects(sync(db, 'sessions/s1', defaultSession, updated), /REBUILD_IN_PROGRESS/)
  }
  await rebuild(db)
  await sync(db, 'sessions/s1', defaultSession, updated)
  assert.equal((await load(db)).totals.sessions, 1)
  assert.equal((await load(db, { branchIds: ['branch-2'] })).totals.confirmedSessions, 1)
})

test('source change concurrent with incremental transaction forces retry to current document', async () => {
  const db = fakeDatabase()
  await rebuild(db)
  db.write('sessions/s1', defaultSession)
  let changed = false
  db.beforeCommit = async (operations) => {
    if (changed || !operations.some((item) => item.path.startsWith('operationsAggregateContributions/'))) return
    changed = true
    db.write('sessions/s1', { ...defaultSession, status: 'completed' })
  }
  await sync(db, 'sessions/s1', undefined, defaultSession)
  assert.equal((await load(db)).totals.confirmedSessions, 1)
  assert.ok(db.stats.retries >= 1)
})

test('a second rebuild cannot take an unexpired owner lock', async () => {
  const db = fakeDatabase()
  let checked = false
  db.afterQuery = async ({ name }) => {
    if (name !== 'sessions' || checked) return
    checked = true
    await assert.rejects(rebuild(db), /REBUILD_IN_PROGRESS/)
  }
  await rebuild(db)
  assert.equal(db.records.get(coveragePath).status, 'ready')
})

test('lost rebuild owner cannot write any source baseline or publish over a replacement', async () => {
  const db = fakeDatabase({ 'sessions/s1': defaultSession })
  let replaced = false
  db.afterQuery = async ({ name }) => {
    if (name !== 'sessions' || replaced) return
    replaced = true
    db.write(coveragePath, { schemaVersion: 2, generation: 'replacement', status: 'building', complete: false })
  }
  await assert.rejects(rebuild(db), /OWNERSHIP_LOST/)
  assert.equal(db.records.get(coveragePath).generation, 'replacement')
  assert.equal(db.records.get(coveragePath).status, 'building')
  assert.equal([...db.records.keys()].some((key) => key.startsWith('operationsAggregateContributions/')), false)
})

test('failed partial rebuild is never readable and recovery replaces the complete baseline', async () => {
  const db = fakeDatabase({ 'sessions/s1': defaultSession })
  await rebuild(db)
  let failed = false
  db.beforeCommit = async (operations) => {
    if (!failed && operations.some((item) => item.path.startsWith('operationsDailyAggregatesV2/') && item.remove)) {
      failed = true
      throw new Error('injected write failure')
    }
  }
  await assert.rejects(rebuild(db), /injected write failure/)
  assert.equal(db.records.get(coveragePath).status, 'failed')
  assert.equal(await load(db), null)
  db.beforeCommit = null
  await rebuild(db)
  assert.equal((await load(db)).totals.sessions, 1)
})

test('reader rejects a rebuild that starts or finishes between coverage read and bucket query', async () => {
  for (const status of ['building', 'ready']) {
    const db = fakeDatabase({ 'sessions/s1': defaultSession })
    await rebuild(db)
    db.afterQuery = async ({ name }) => {
      if (name !== 'operationsDailyAggregatesV2') return
      db.write(coveragePath, { ...db.records.get(coveragePath), generation: 'new-generation', status })
    }
    assert.equal(await load(db), null)
  }
})

test('reader rejects mixed-generation buckets even when coverage says ready', async () => {
  const db = fakeDatabase({ 'sessions/s1': defaultSession })
  await rebuild(db)
  const path = [...db.records.keys()].find((key) => key.startsWith('operationsDailyAggregatesV2/'))
  db.write(path, { ...db.records.get(path), generation: 'older' })
  assert.equal(await load(db), null)
})

test('repeated rebuilds reuse source state and bucket keys rather than accumulating generations', async () => {
  const db = fakeDatabase({ 'sessions/s1': defaultSession })
  await rebuild(db)
  const firstSize = db.records.size
  const generation = db.records.get(coveragePath).generation
  await rebuild(db)
  await rebuild(db)
  assert.equal(db.records.size, firstSize)
  assert.notEqual(db.records.get(coveragePath).generation, generation)
  await sync(db, 'sessions/s1', undefined, defaultSession)
  assert.equal((await load(db)).totals.sessions, 1)
})

test('rebuild uses Vietnam midnight boundaries for timestamp sources', async () => {
  const lastNanosecond = new Timestamp(Timestamp.fromDate(new Date('2026-10-23T16:59:59Z')).seconds, 999_999_999)
  const db = fakeDatabase({
    'ledgerEntries/before': { status: 'posted', type: 'payment', amount: 10, effectiveAt: Timestamp.fromDate(new Date('2026-10-20T16:59:59Z')) },
    'ledgerEntries/start': { status: 'posted', type: 'payment', amount: 20, effectiveAt: Timestamp.fromDate(new Date('2026-10-20T17:00:00Z')) },
    'ledgerEntries/end': { status: 'posted', type: 'payment', amount: 30, effectiveAt: Timestamp.fromDate(new Date('2026-10-23T16:59:59.999Z')) },
    'ledgerEntries/last-nanosecond': { status: 'posted', type: 'payment', amount: 5, effectiveAt: lastNanosecond },
    'ledgerEntries/after': { status: 'posted', type: 'payment', amount: 40, effectiveAt: Timestamp.fromDate(new Date('2026-10-23T17:00:00Z')) },
    'attendanceEvents/last-nanosecond': { occurredAt: lastNanosecond },
    'attendanceEvents/after': { occurredAt: Timestamp.fromDate(new Date('2026-10-23T17:00:00Z')) },
  })
  await rebuild(db)
  const value = await load(db)
  assert.equal(value.totals.ledgerEntries, 3)
  assert.equal(value.totals.netCash, 55)
  assert.equal(value.totals.attendanceEvents, 1)
})

test('capped source query leaves coverage incomplete and does not publish partial data', async () => {
  const db = fakeDatabase()
  db.afterQuery = async ({ name }, result) => {
    if (name === 'students') result.size = 20_001
  }
  await assert.rejects(rebuild(db), /SOURCE_LIMIT/)
  assert.equal(await load(db), null)
  assert.equal(db.records.get(coveragePath).complete, false)
  assert.equal([...db.records.keys()].some((key) => key.startsWith('operationsDailyAggregatesV2/')), false)
})

test('all five source types share idempotent baseline semantics, including financial amounts', async () => {
  const db = fakeDatabase()
  await rebuild(db)
  const timestamp = Timestamp.fromDate(now)
  const sources = [
    ['ledger', 'ledgerEntries/l1', { branchId: 'branch-1', status: 'posted', type: 'payment', effectiveAt: timestamp, amount: 900 }],
    ['session', 'sessions/s1', defaultSession],
    ['attendance', 'attendanceEvents/a1', { branchId: 'branch-1', occurredAt: timestamp }],
    ['contract', 'contracts/c1', { branchId: 'branch-1', status: 'active', signedAt: timestamp, totalPrice: 1000, discount: 100 }],
    ['student', 'students/u1', { branchId: 'branch-1', createdAt: timestamp }],
  ]
  for (const [source, path, value] of sources) {
    db.write(path, value)
    await sync(db, path, undefined, value, source)
    await sync(db, path, undefined, value, source)
  }
  const totals = (await load(db)).totals
  assert.equal(totals.netCash, 900)
  assert.equal(totals.contractSales, 900)
  assert.equal(totals.sessions, 1)
  assert.equal(totals.attendanceEvents, 1)
  assert.equal(totals.newStudents, 1)
  await rebuild(db)
  for (const [source, path, value] of sources) await sync(db, path, undefined, value, source)
  assert.deepEqual((await load(db)).totals, totals)
})

test('deletion after a rebuild source read removes its seeded contribution on retry', async () => {
  const db = fakeDatabase({ 'sessions/s1': defaultSession })
  let deleted = false
  db.afterQuery = async ({ name }) => {
    if (name === 'sessions' && !deleted) {
      deleted = true
      db.remove('sessions/s1')
    }
  }
  await rebuild(db)
  await sync(db, 'sessions/s1', defaultSession, undefined)
  await sync(db, 'sessions/s1', defaultSession, undefined)
  assert.equal((await load(db)).totals.sessions, 0)
})

test('rebuild starting during an incremental commit fences the old generation transaction', async () => {
  const db = fakeDatabase()
  await rebuild(db)
  db.write('sessions/s1', defaultSession)
  let rebuilding = false
  db.beforeCommit = async (operations) => {
    if (rebuilding || !operations.some((item) => item.path.startsWith('operationsDailyAggregatesV2/'))) return
    rebuilding = true
    db.write(coveragePath, { ...db.records.get(coveragePath), status: 'building', generation: 'next' })
  }
  await assert.rejects(sync(db, 'sessions/s1', undefined, defaultSession), /REBUILD_IN_PROGRESS/)
  assert.equal([...db.records.keys()].some((key) => key.startsWith('operationsDailyAggregatesV2/')), false)
  assert.ok(db.stats.retries >= 1)
})

test('expired rebuild lock can be reclaimed and partial old-generation states are ignored', async () => {
  const db = fakeDatabase({
    'sessions/s1': defaultSession,
    [coveragePath]: { schemaVersion: 2, generation: 'dead-worker', status: 'building', complete: false, lockExpiresAt: Timestamp.fromMillis(1) },
  })
  await rebuild(db)
  assert.notEqual(db.records.get(coveragePath).generation, 'dead-worker')
  assert.equal((await load(db)).totals.sessions, 1)
})

test('a failed source query marks coverage failed without changing source documents', async () => {
  const db = fakeDatabase({ 'sessions/s1': defaultSession })
  db.afterQuery = async ({ name }) => { if (name === 'students') throw new Error('query unavailable') }
  await assert.rejects(rebuild(db), /query unavailable/)
  assert.equal(db.records.get(coveragePath).status, 'failed')
  assert.deepEqual(db.records.get('sessions/s1'), defaultSession)
  assert.equal(await load(db), null)
})

test('old v1 writer and scheduler activity cannot contaminate v2 or be modified by its rebuild', async () => {
  const legacyCoveragePath = 'operationsAggregateCoverage/dashboard-v1'
  const legacyCoverage = { schemaVersion: 1, status: 'ready', complete: true, startDate: '2026-10-21', endDate: '2026-10-23' }
  const db = fakeDatabase({ 'sessions/s1': defaultSession, [legacyCoveragePath]: legacyCoverage })
  // A legacy ready marker is not permission to serve or increment v2.
  assert.equal(await load(db), null)
  assert.equal((await sync(db, 'sessions/s1', undefined, defaultSession)).reason, 'awaiting_rebuild')
  await rebuild(db)
  const v2BucketPath = [...db.records.keys()].find((key) => key.startsWith('operationsDailyAggregatesV2/'))
  const legacyBucketPath = v2BucketPath.replace('operationsDailyAggregatesV2/', 'operationsDailyAggregates/')
  // Simulate an old trigger in flight followed by the old scheduled rebuild.
  db.write(legacyBucketPath, { schemaVersion: 1, date: '2026-10-23', branchId: 'branch-1', metrics: { sessions: 9999 } })
  db.write(legacyCoveragePath, { ...legacyCoverage, status: 'building' })
  assert.equal((await load(db)).totals.sessions, 1)
  const updated = { ...defaultSession, status: 'completed' }
  db.write('sessions/s1', updated)
  await sync(db, 'sessions/s1', defaultSession, updated)
  assert.equal((await load(db)).totals.confirmedSessions, 1)
  await rebuild(db)
  assert.equal((await load(db)).totals.sessions, 1)
  assert.equal(db.records.get(legacyBucketPath).metrics.sessions, 9999)
  assert.equal(db.records.get(legacyCoveragePath).status, 'building')
})
