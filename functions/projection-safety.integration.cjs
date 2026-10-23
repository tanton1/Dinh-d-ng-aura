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
  const wrap = query => ({
    where: (...args) => wrap(query.where(...args)),
    limit: (...args) => wrap(query.limit(...args)),
    async get() {
      const result = await query.get()
      if (!fired) { fired = true; await hook() }
      return result
    },
  })
  return {
    collection: name => name === 'sessions' ? wrap(db.collection(name)) : db.collection(name),
    runTransaction: (...args) => db.runTransaction(...args),
  }
}

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
