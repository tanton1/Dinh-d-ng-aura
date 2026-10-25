'use strict'

const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { createRegionalOperationsAggregateFunctions, REGIONAL_AGGREGATE_TARGETS } = require('./operations-aggregate-regional')
const { syncDailyAggregateWrite, rebuildOperationsDailyAggregates, loadDailyAggregates } = require('./operations-dashboard-aggregates')

// Emulator only. Never accept ADC or a live database as an integration target.
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const projectId = 'demo-aura-fitness'
const app = initializeApp({ projectId }, `aggregate-region-migration-${randomUUID()}`)
const clients = []
const quiet = { info() {} }
const now = new Date('2026-10-23T10:00:00Z')
const timestamp = date => Timestamp.fromDate(new Date(`${date}T08:00:00+07:00`))
const samples = {
  ledger: { data: { status: 'posted', type: 'payment', amount: 200, effectiveAt: timestamp('2026-10-23') }, dateField: 'effectiveAt', metric: 'netCash', total: 200 },
  attendance: { data: { occurredAt: timestamp('2026-10-23') }, dateField: 'occurredAt', metric: 'attendanceEvents', total: 1 },
  session: { data: { date: '2026-10-23', status: 'scheduled' }, dateField: 'date', metric: 'sessions', total: 1 },
  contract: { data: { status: 'active', signedAt: timestamp('2026-10-23'), totalPrice: 1000, discount: 100 }, dateField: 'signedAt', metric: 'contractSales', total: 900 },
  student: { data: { joinDate: '2026-10-23' }, dateField: 'joinDate', metric: 'newStudents', total: 1 },
}

after(async () => {
  await Promise.all(clients.map(db => db.terminate()))
  await deleteApp(app)
})

function fixture(target) {
  const databaseId = `aggregate-regional-${randomUUID()}`
  const db = getFirestore(app, databaseId)
  clients.push(db)
  const regional = createRegionalOperationsAggregateFunctions({ db, databaseId, onDocumentWritten, logger: quiet })[target.name]
  return {
    db,
    databaseId,
    original: event => syncDailyAggregateWrite({ db, source: target.source, event, logger: quiet }),
    // Real SDK registration, with the same handler used by the regional export.
    regional: event => regional.run(event),
    ref: db.doc(`${target.document.split('/')[0]}/source-one`),
  }
}

async function sourceWrite({ ref, databaseId }, value) {
  const before = await ref.get()
  if (value === null) await ref.delete()
  else await ref.set(value)
  const after = await ref.get()
  return { id: randomUUID(), location: 'asia-southeast1', database: databaseId, data: { before, after } }
}

async function total(db, metric, branchId) {
  const result = await loadDailyAggregates({
    db, startDate: '2026-10-21', endDate: '2026-10-23',
    scope: branchId ? { branchIds: [branchId] } : { unrestricted: true },
  })
  assert.ok(result, 'the shared generation must remain readable')
  return Number(result.totals[metric] || 0)
}

for (const target of REGIONAL_AGGREGATE_TARGETS) {
  test(`real Firestore: ${target.source} old SG and regional consumers deduplicate concurrent/reordered deliveries`, { timeout: 60000 }, async () => {
    const f = fixture(target)
    const sample = samples[target.source]
    await rebuildOperationsDailyAggregates({ db: f.db, logger: quiet, days: 3, now })
    const first = { ...sample.data, branchId: 'branch-one' }
    const created = await sourceWrite(f, first)
    const results = await Promise.all([
      f.original(created), f.regional(created),
      f.original({ ...created, id: 'different-transport-delivery-id' }), f.regional(created),
    ])
    assert.equal(results.reduce((sum, result) => sum + result.updated, 0), 1)
    assert.equal(await total(f.db, sample.metric), sample.total)

    const moved = {
      ...first, branchId: 'branch-two',
      [sample.dateField]: first[sample.dateField] instanceof Timestamp ? timestamp('2026-10-22') : '2026-10-22',
    }
    const changed = await sourceWrite(f, moved)
    await f.regional(changed)
    await Promise.all([f.original(created), f.regional(created), f.original(changed)])
    assert.equal(await total(f.db, sample.metric, 'branch-one'), 0)
    assert.equal(await total(f.db, sample.metric, 'branch-two'), sample.total)
    assert.equal(await total(f.db, sample.metric), sample.total)

    const deleted = await sourceWrite(f, null)
    await Promise.all([f.original(deleted), f.regional(deleted)])
    await f.regional(created)
    assert.equal(await total(f.db, sample.metric), 0)

    const recreated = await sourceWrite(f, first)
    await Promise.all([f.original(deleted), f.regional(recreated), f.original(created)])
    assert.equal(await total(f.db, sample.metric), sample.total)
    assert.equal(await total(f.db, sample.metric, 'branch-one'), sample.total)
    assert.equal((await f.db.collection('operationsAggregateContributions').get()).size, 1)
    assert.deepEqual((await f.ref.get()).data(), first, 'consumers never change the business source')

    // A scheduled rebuild shares the same baseline; delayed old/new deliveries
    // afterwards must not add the source again or require a second scheduler.
    await rebuildOperationsDailyAggregates({ db: f.db, logger: quiet, days: 3, now })
    const afterRebuild = await Promise.all([f.original(created), f.regional(recreated)])
    assert.equal(afterRebuild.reduce((sum, result) => sum + result.updated, 0), 0)
    assert.equal(await total(f.db, sample.metric), sample.total)
  })
}

function observedAggregateDb(db, queries, onQuery) {
  const wrap = (query, name, filters = []) => ({
    where: (...args) => wrap(query.where(...args), name, [...filters, args]),
    limit: maximum => wrap(query.limit(maximum), name, filters),
    doc: id => query.doc(id),
    async get() {
      const snapshot = await query.get()
      queries.push({ name, filters, returned: snapshot.size })
      if (onQuery) await onQuery(name)
      return snapshot
    },
  })
  return { collection: name => wrap(db.collection(name), name) }
}

test('real Firestore: aggregate readers hydrate only selected branches, including unassigned and empty scopes', async t => {
  const { db } = fixture(REGIONAL_AGGREGATE_TARGETS[2])
  const values = [
    ...Array.from({ length: 1000 }, (_, index) => ({ branchId: `outside-${index}` })),
    ...Array.from({ length: 35 }, (_, index) => ({ branchId: `selected-${index}` })),
    { branchId: 'home' }, {},
  ]
  for (let offset = 0; offset < values.length; offset += 400) {
    const batch = db.batch()
    values.slice(offset, offset + 400).forEach((value, index) => batch.set(db.doc(`sessions/source-${offset + index}`), {
      ...value, date: '2026-10-23', status: 'completed',
    }))
    await batch.commit()
  }
  await rebuildOperationsDailyAggregates({ db, logger: quiet, days: 3, now })
  const queries = [], observed = observedAggregateDb(db, queries)
  const read = scope => loadDailyAggregates({ db: observed, startDate: '2026-10-21', endDate: '2026-10-23', scope })
  assert.equal((await read({ branchId: 'home', branchIds: ['home'] })).totals.sessions, 1)
  assert.deepEqual(queries.map(query => query.returned), [1])
  queries.length = 0
  assert.equal((await read({ branchId: 'none', branchIds: [] })).totals.sessions, 1)
  assert.deepEqual(queries.map(query => query.returned), [1])
  queries.length = 0
  assert.deepEqual((await read({ branchId: 'all', branchIds: [] })).totals, {})
  assert.equal(queries.length, 0)
  const branchIds = Array.from({ length: 35 }, (_, index) => `selected-${index}`)
  assert.equal((await read({ branchIds: [...branchIds, 'selected-0'] })).totals.sessions, 35)
  assert.deepEqual(queries.map(query => query.returned), [30, 5])
  queries.length = 0
  assert.equal((await read({ unrestricted: true })).totals.sessions, values.length)
  assert.deepEqual(queries.map(query => query.returned), [1037])
  t.diagnostic(JSON.stringify({ fixtureBuckets: 1037, selectedBranchBuckets: 1, queryCount: 1, coverageDocumentReads: 2, readerWrites: 0, units: 'logical documents, not billed units' }))
})

test('real Firestore: a generation change between scoped query chunks rejects the entire result', async () => {
  const { db } = fixture(REGIONAL_AGGREGATE_TARGETS[2])
  const branchIds = Array.from({ length: 35 }, (_, index) => `branch-${index}`)
  const batch = db.batch()
  branchIds.forEach(branchId => batch.set(db.doc(`sessions/${branchId}`), { branchId, date: '2026-10-23', status: 'scheduled' }))
  await batch.commit()
  await rebuildOperationsDailyAggregates({ db, logger: quiet, days: 3, now })
  let replaced = false
  const queries = [], observed = observedAggregateDb(db, queries, async name => {
    if (name !== 'operationsDailyAggregatesV2' || replaced) return
    replaced = true
    await rebuildOperationsDailyAggregates({ db, logger: quiet, days: 3, now })
  })
  assert.equal(await loadDailyAggregates({ db: observed, startDate: '2026-10-21', endDate: '2026-10-23', scope: { branchIds } }), null)
  assert.deepEqual(queries.map(query => query.returned), [30, 5])
  assert.equal(await total(db, 'sessions'), 35, 'the complete replacement stays usable')
})
