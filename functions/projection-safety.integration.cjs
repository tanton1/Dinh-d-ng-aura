'use strict'

const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const {
  loadDailyAggregates, rebuildOperationsDailyAggregates, syncDailyAggregateWrite,
} = require('./operations-dashboard-aggregates')

// This file is deliberately excluded from the ordinary unit-test command.
// Never allow the integration fixtures to touch a production Firestore host.
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const projectId = 'demo-aura-fitness'
assert.match(projectId, /^demo-/)
const app = initializeApp({ projectId }, `projection-safety-${randomUUID()}`)
const clients = []
const quiet = { info() {} }
const now = new Date('2026-10-23T10:00:00Z')
const session = { date: '2026-10-23', branchId: 'branch-1', status: 'scheduled' }
const coveragePath = 'operationsAggregateCoverage/dashboard-v2'

after(async () => {
  await Promise.all(clients.map(db => db.terminate()))
  await deleteApp(app)
})

function fixture() {
  // A separate emulator-only database per test also avoids touching fixtures
  // belonging to any other concurrently running integration suite.
  const db = getFirestore(app, `projection-${randomUUID()}`)
  clients.push(db)
  return db
}

function event(db, before, after, id = 'same-delivery') {
  const ref = db.doc('sessions/s1')
  const snapshot = value => ({ exists: value !== undefined, data: () => value, ref })
  return { id, data: { before: snapshot(before), after: snapshot(after) } }
}

const sync = (db, before, after, id) => syncDailyAggregateWrite({ db, source: 'session', event: event(db, before, after, id), logger: quiet })
const rebuild = db => rebuildOperationsDailyAggregates({ db, logger: quiet, days: 3, now })
const load = (db, scope = { unrestricted: true }) => loadDailyAggregates({ db, startDate: '2026-10-21', endDate: '2026-10-23', scope })

// Pause only after a real source query has completed. All reads, transactions,
// increment transforms and locks still run through the real Admin SDK/emulator.
function afterSessionQuery(db, hook) {
  let fired = false
  const fire = async () => { if (!fired) { fired = true; await hook() } }
  const wrap = query => ({
    rawQuery: query,
    where: (...args) => wrap(query.where(...args)),
    limit: (...args) => wrap(query.limit(...args)),
    select: (...args) => wrap(query.select(...args)),
    orderBy: (...args) => wrap(query.orderBy(...args)),
    startAfter: (...args) => wrap(query.startAfter(...args)),
    async get() {
      const result = await query.get()
      await fire()
      return result
    },
  })
  return {
    collection: name => name === 'sessions' ? wrap(db.collection(name)) : db.collection(name),
    runTransaction: (callback, options) => db.runTransaction(options?.readOnly ? transaction => callback({
      get: async target => {
        const result = await transaction.get(target.rawQuery || target)
        if (target.rawQuery) await fire()
        return result
      },
    }) : callback, options),
  }
}

function interceptAggregateQueries(db, hook) {
  const receive = async (name, result) => { await hook(name, result); return result }
  const wrap = (query, name) => ({
    rawQuery: query, name,
    where: (...args) => wrap(query.where(...args), name),
    limit: (...args) => wrap(query.limit(...args), name),
    select: (...args) => wrap(query.select(...args), name),
    orderBy: (...args) => wrap(query.orderBy(...args), name),
    startAfter: (...args) => wrap(query.startAfter(...args), name),
    doc: id => query.doc(id),
    get: async () => receive(name, await query.get()),
  })
  return {
    collection: name => wrap(db.collection(name), name),
    runTransaction: (callback, options) => db.runTransaction(options?.readOnly ? transaction => callback({
      get: async target => {
        const result = await transaction.get(target.rawQuery || target)
        return target.rawQuery ? receive(target.name, result) : result
      },
    }) : callback, options),
  }
}

async function seedPagedSessions(db, count) {
  for (let offset = 0; offset < count; offset += 400) {
    const batch = db.batch()
    for (let index = offset; index < Math.min(count, offset + 400); index++) batch.set(db.doc('sessions/source-' + String(index).padStart(5, '0')), {
      ...session, date: '2026-10-22', ignoredPayload: 'not a reporting input',
    })
    await batch.commit()
  }
}

test('real Firestore: paginated rebuild publishes over 20000 source baselines and reconciles changes after its snapshot', { timeout: 180000 }, async t => {
  const db = fixture(), count = 20005
  await seedPagedSessions(db, count)
  const pages = [], deliveries = []
  const observed = interceptAggregateQueries(db, async (name, snapshot) => {
    if (name !== 'sessions') return
    pages.push(snapshot.size)
    if (pages.length !== 1) return
    const refs = ['source-00000', 'source-01000', 'source-01500', 'inserted-after-anchor'].map(id => db.doc('sessions/' + id))
    const before = await db.getAll(...refs)
    const batch = db.batch()
    batch.update(refs[0], { date: '2026-10-23', status: 'completed' })
    batch.update(refs[1], { date: '2026-10-21', branchId: 'branch-2' })
    batch.delete(refs[2])
    batch.set(refs[3], { ...session, date: '2026-10-22', branchId: 'branch-2' })
    await batch.commit()
    const after = await db.getAll(...refs)
    refs.forEach((_, index) => deliveries.push({ id: randomUUID(), data: { before: before[index], after: after[index] } }))
  })
  const result = await rebuild(observed)
  assert.equal(result.complete, true)
  assert.equal(result.sourceCounts.session, count)
  assert.equal(result.sourcePages.session, 67)
  assert.equal(Math.max(...pages), 300)
  assert.equal(pages.at(-1), 205)
  assert.equal((await load(db)).totals.sessions, count)
  assert.equal((await load(db)).totals.confirmedSessions, 0)
  assert.deepEqual((await load(db, { branchIds: ['branch-2'] })).totals, {})
  const coverage = (await db.doc(coveragePath).get()).data()
  assert.ok(coverage.sourceReadTime instanceof Timestamp)
  const baselines = await db.collection('operationsAggregateContributions').select('generation').get()
  assert.equal(baselines.size, count)
  assert.ok(baselines.docs.every(doc => doc.data().generation === coverage.generation))
  for (const delivery of deliveries) {
    await syncDailyAggregateWrite({ db, source: 'session', event: delivery, logger: quiet })
    assert.deepEqual(await syncDailyAggregateWrite({ db, source: 'session', event: delivery, logger: quiet }), { updated: 0 })
  }
  assert.equal((await load(db)).totals.sessions, count)
  assert.equal((await load(db)).totals.confirmedSessions, 1)
  assert.equal((await load(db, { branchIds: ['branch-2'] })).totals.sessions, 2)
  t.diagnostic(JSON.stringify({ sourceRows: count, sourcePages: result.sourcePages, maxSourcePageRows: 300, baselineDocuments: baselines.size, postSnapshotChangesReconciled: deliveries.length }))
})

test('real Firestore: continuation failure leaves partial baselines unavailable and retries recover deleted rows', async () => {
  const db = fixture()
  await seedPagedSessions(db, 601)
  let pages = 0
  const failing = interceptAggregateQueries(db, async name => { if (name === 'sessions' && ++pages === 2) throw new Error('injected continuation failure') })
  await assert.rejects(rebuild(failing), /injected continuation failure/)
  assert.equal((await db.doc(coveragePath).get()).data().status, 'failed')
  assert.equal(await load(db), null)
  assert.equal((await db.collection('operationsAggregateContributions').select().get()).size, 300)
  const deletes = db.batch()
  deletes.delete(db.doc('sessions/source-00000'))
  deletes.delete(db.doc('sessions/source-00400'))
  await deletes.commit()
  const recovered = await rebuild(db)
  assert.equal(recovered.sourceCounts.session, 599)
  assert.equal((await load(db)).totals.sessions, 599)
  assert.equal((await db.doc(coveragePath).get()).data().complete, true)
})

test('real Firestore: ownership replacement between pages prevents further contribution writes', async () => {
  const db = fixture()
  await seedPagedSessions(db, 601)
  let pages = 0
  const replaced = interceptAggregateQueries(db, async name => {
    if (name === 'sessions' && ++pages === 2) await db.doc(coveragePath).set({
      schemaVersion: 2, generation: 'replacement-owner', status: 'building', complete: false,
      lockExpiresAt: Timestamp.fromMillis(Date.now() + 120000),
    })
  })
  await assert.rejects(rebuild(replaced), /OWNERSHIP_LOST/)
  const coverage = (await db.doc(coveragePath).get()).data()
  assert.equal(coverage.generation, 'replacement-owner')
  assert.equal(coverage.status, 'building')
  assert.equal((await db.collection('operationsAggregateContributions').select().get()).size, 300)
  assert.equal((await db.collection('operationsDailyAggregatesV2').select().get()).size, 0)
  assert.equal(await load(db), null)
})

test('real Firestore: projected rebuild reads omit payloads and reuse buckets with one replacement write', async t => {
  const db = fixture()
  const at = Timestamp.fromDate(now)
  const common = { branchId: 'branch-1', unrelatedPayload: 'x'.repeat(50000) }
  const rows = {
    'sessions/s1': { ...common, ...session },
    'ledgerEntries/l1': { ...common, status: 'posted', type: 'payment', effectiveAt: at, amount: 999, cashImpact: 150, revenueImpact: 7 },
    'attendanceEvents/a1': { ...common, occurredAt: at, date: '2000-01-01' },
    'contracts/c1': { ...common, status: 'active', contractDate: '2026-10-23', startDate: '2000-01-01', totalPrice: 1000, discount: 100 },
    'students/u1': { ...common, createdAt: at },
  }
  const seed = db.batch()
  Object.entries(rows).forEach(([path, value]) => seed.set(db.doc(path), value))
  await seed.commit()
  await rebuild(db)
  const bucket = (await db.collection('operationsDailyAggregatesV2').get()).docs[0]
  await bucket.ref.update({ 'metrics.obsoleteMetric': 999, obsoleteField: true })

  const queries = [], writes = []
  const wrap = (query, name) => ({
    rawQuery: query, name,
    where: (...args) => wrap(query.where(...args), name),
    limit: (...args) => wrap(query.limit(...args), name),
    select: (...args) => wrap(query.select(...args), name),
    orderBy: (...args) => wrap(query.orderBy(...args), name),
    startAfter: (...args) => wrap(query.startAfter(...args), name),
    doc: id => query.doc(id),
    async get() {
      const result = await query.get()
      queries.push({ name, rows: result.docs.map(doc => doc.data()) })
      return result
    },
  })
  const observed = {
    collection: name => wrap(db.collection(name), name),
    runTransaction: async (callback, options) => {
      if (options?.readOnly) return db.runTransaction(transaction => callback({
        get: async target => {
          const result = await transaction.get(target.rawQuery || target)
          if (target.rawQuery) queries.push({ name: target.name, rows: result.docs.map(doc => doc.data()) })
          return result
        },
      }), options)
      let committed = []
      const result = await db.runTransaction(async transaction => {
        committed = []
        return callback({
          get: (...args) => transaction.get(...args),
          set: (...args) => { committed.push({ kind: 'set', path: args[0].path, options: args[2] }); transaction.set(...args) },
          delete: (...args) => { committed.push({ kind: 'delete', path: args[0].path }); transaction.delete(...args) },
        })
      })
      writes.push(...committed)
      return result
    },
  }
  const result = await rebuild(observed)
  assert.equal(result.reusedBuckets, 1)
  assert.equal(result.deletedBuckets, 0)
  assert.equal(queries.length, 6)
  queries.forEach(query => query.rows.forEach(row => assert.equal(row.unrelatedPayload, undefined)))
  assert.deepEqual(queries.find(query => query.name === 'operationsDailyAggregatesV2').rows, [{}])
  const replacements = writes.filter(item => item.path.startsWith('operationsDailyAggregatesV2/'))
  assert.deepEqual(replacements, [{ kind: 'set', path: bucket.ref.path, options: undefined }])
  assert.equal((await bucket.ref.get()).data().obsoleteField, undefined)
  const report = await load(db, { branchIds: ['branch-1'] })
  assert.deepEqual(report.totals, {
    ledgerEntries: 1, cashCollected: 150, refunds: 0, reversals: 0, adjustments: 0,
    netCash: 150, grossCash: 150, recognizedRevenue: 7,
    sessions: 1, confirmedSessions: 0, noShowSessions: 0, sessionStatus__scheduled: 1,
    attendanceEvents: 1, contractSales: 900, newStudents: 1,
  })
  for (const [path, value] of Object.entries(rows)) assert.deepEqual((await db.doc(path).get()).data(), value)
  const projectedBytes = Buffer.byteLength(JSON.stringify(queries.flatMap(query => query.rows)))
  const fullFixtureBytes = Buffer.byteLength(JSON.stringify(Object.values(rows)))
  assert.ok(projectedBytes < fullFixtureBytes / 100)
  t.diagnostic(JSON.stringify({ fullFixtureBytes, projectedBytes, sourceRows: 5, stableBucketWrites: 1, stableBucketDeletes: 0, units: 'synthetic JSON payload bytes and logical writes, not billed units' }))

  // Removing every old source and moving the session leaves no reusable bucket.
  const moved = db.batch()
  Object.keys(rows).filter(path => path !== 'sessions/s1').forEach(path => moved.delete(db.doc(path)))
  moved.set(db.doc('sessions/s1'), { ...session, branchId: 'branch-2' })
  await moved.commit()
  writes.length = 0
  const changed = await rebuild(observed)
  assert.equal(changed.deletedBuckets, 1)
  assert.equal(changed.reusedBuckets, 0)
  assert.equal((await bucket.ref.get()).exists, false)
  assert.equal((await db.collection('operationsDailyAggregatesV2').get()).size, 1)
  assert.equal((await load(db, { branchIds: ['branch-2'] })).totals.sessions, 1)
  assert.deepEqual((await load(db, { branchIds: ['branch-1'] })).totals, {})
})

test('real Firestore: parallel duplicate deliveries, out-of-order moves and deletion converge once', async () => {
  const db = fixture()
  await rebuild(db)
  await db.doc('sessions/s1').set(session)
  const deliveries = await Promise.all(Array.from({ length: 4 }, () => sync(db, undefined, session)))
  assert.equal(deliveries.reduce((sum, result) => sum + result.updated, 0), 1)
  assert.equal((await load(db)).totals.sessions, 1)

  const intermediate = { ...session, branchId: 'branch-2', status: 'completed' }
  const current = { ...session, branchId: 'branch-3', date: '2026-10-22', status: 'no_show' }
  await db.doc('sessions/s1').set(current)
  await sync(db, intermediate, current, 'newer')
  await sync(db, session, intermediate, 'older')
  assert.equal((await load(db, { branchIds: ['branch-1'] })).totals.sessions, 0)
  assert.equal((await load(db, { branchIds: ['branch-3'] })).totals.noShowSessions, 1)
  assert.equal((await load(db)).totals.sessions, 1)

  await db.doc('sessions/s1').delete()
  await Promise.all([sync(db, current, undefined), sync(db, current, undefined)])
  await sync(db, undefined, session, 'very-old-create')
  assert.equal((await load(db)).totals.sessions, 0)
})

test('real Firestore: rebuild baseline absorbs delayed events and catches a change after its query', async () => {
  const db = fixture()
  await db.doc('sessions/s1').set(session)
  await rebuild(db)
  assert.deepEqual(await sync(db, undefined, session), { updated: 0 })
  assert.equal((await load(db)).totals.sessions, 1)

  const current = { ...session, branchId: 'branch-2', status: 'completed' }
  const wrapped = afterSessionQuery(db, async () => {
    await db.doc('sessions/s1').set(current)
    await assert.rejects(sync(db, session, current), /REBUILD_IN_PROGRESS/)
    assert.equal(await load(db), null)
  })
  await rebuild(wrapped)
  await sync(db, session, current)
  await sync(db, undefined, session, 'old-create-replayed')
  assert.equal((await load(db)).totals.sessions, 1)
  assert.equal((await load(db, { branchIds: ['branch-2'] })).totals.confirmedSessions, 1)

  await db.doc('sessions/s1').delete()
  await rebuild(db)
  await sync(db, current, undefined, 'old-delete-after-rebuild')
  assert.equal((await load(db)).totals.sessions, undefined)
})

test('real Firestore: a replaced builder is fenced before writing baselines or publishing', async () => {
  const db = fixture()
  await db.doc('sessions/s1').set(session)
  const wrapped = afterSessionQuery(db, async () => {
    const coverage = await db.doc(coveragePath).get()
    await db.doc(coveragePath).set({
      ...coverage.data(), generation: 'replacement-owner', status: 'building',
      lockExpiresAt: Timestamp.fromMillis(Date.now() + 120000),
    })
  })
  await assert.rejects(rebuild(wrapped), /OWNERSHIP_LOST/)
  assert.equal((await db.doc(coveragePath).get()).data().generation, 'replacement-owner')
  assert.equal((await db.collection('operationsAggregateContributions').get()).size, 0)
  assert.equal((await db.collection('operationsDailyAggregatesV2').get()).size, 0)
  assert.equal(await load(db), null)
})

test('real Firestore: stale schema and mixed generation never leak partial totals', async () => {
  const db = fixture()
  await db.doc('sessions/s1').set(session)
  await db.doc(coveragePath).set({ schemaVersion: 1, status: 'ready', complete: true, startDate: '2026-10-21', endDate: '2026-10-23' })
  assert.equal(await load(db), null)
  assert.equal((await sync(db, undefined, session)).reason, 'awaiting_rebuild')
  await rebuild(db)
  const bucket = (await db.collection('operationsDailyAggregatesV2').get()).docs[0]
  await bucket.ref.update({ generation: 'stale-generation' })
  assert.equal(await load(db), null)
})

test('real Firestore: v1 in-flight writes and old scheduler markers remain isolated from v2', async () => {
  const db = fixture()
  const legacyCoverage = db.doc('operationsAggregateCoverage/dashboard-v1')
  await legacyCoverage.set({ schemaVersion: 1, status: 'ready', complete: true, startDate: '2026-10-21', endDate: '2026-10-23' })
  await db.doc('sessions/s1').set(session)
  assert.equal(await load(db), null)
  assert.equal((await sync(db, undefined, session)).reason, 'awaiting_rebuild')
  await rebuild(db)
  const currentBucket = (await db.collection('operationsDailyAggregatesV2').get()).docs[0]
  const legacyBucket = db.doc(`operationsDailyAggregates/${currentBucket.id}`)
  await legacyBucket.set({ schemaVersion: 1, date: '2026-10-23', branchId: 'branch-1', metrics: { sessions: 9999 } })
  await legacyCoverage.update({ status: 'building' })
  assert.equal((await load(db)).totals.sessions, 1)
  const updated = { ...session, status: 'completed' }
  await db.doc('sessions/s1').set(updated)
  await sync(db, session, updated)
  assert.equal((await load(db)).totals.confirmedSessions, 1)
  await rebuild(db)
  assert.equal((await load(db)).totals.sessions, 1)
  assert.equal((await legacyBucket.get()).data().metrics.sessions, 9999)
  assert.equal((await legacyCoverage.get()).data().status, 'building')
})

test('real Firestore: timestamp ranges include final nanosecond but exclude next Vietnam midnight', async () => {
  const db = fixture()
  const lastNanosecond = new Timestamp(Timestamp.fromDate(new Date('2026-10-23T16:59:59Z')).seconds, 999_999_999)
  const nextMidnight = Timestamp.fromDate(new Date('2026-10-23T17:00:00Z'))
  const batch = db.batch()
  batch.set(db.doc('ledgerEntries/last-nanosecond'), { status: 'posted', type: 'payment', amount: 77, effectiveAt: lastNanosecond })
  batch.set(db.doc('ledgerEntries/next-midnight'), { status: 'posted', type: 'payment', amount: 88, effectiveAt: nextMidnight })
  batch.set(db.doc('attendanceEvents/last-nanosecond'), { occurredAt: lastNanosecond })
  batch.set(db.doc('attendanceEvents/next-midnight'), { occurredAt: nextMidnight })
  await batch.commit()
  await rebuild(db)
  const value = await load(db)
  assert.equal(value.totals.ledgerEntries, 1)
  assert.equal(value.totals.netCash, 77)
  assert.equal(value.totals.attendanceEvents, 1)
})
