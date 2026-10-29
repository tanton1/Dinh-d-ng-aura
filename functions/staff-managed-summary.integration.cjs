'use strict'

const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { managedClientCountsFromContracts, readStaffManagedClientCounts, refreshStaffManagedClientSummary, syncStaffManagedClientSummary, reconcileStaffManagedClientSummaries } = require('./staff-managed-summary')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `staff-summary-${randomUUID()}`)
const clients = []
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

async function fixture(contracts = []) {
  const db = getFirestore(app, `staff-summary-${randomUUID()}`)
  clients.push(db)
  for (let offset = 0; offset < contracts.length; offset += 400) {
    const batch = db.batch()
    for (const [id, value] of contracts.slice(offset, offset + 400)) batch.set(db.doc(`contracts/${id}`), value)
    await batch.commit()
  }
  return db
}

// Wrap the real SDK at the IO boundary to deterministically pause deliveries,
// fail a page, and measure source reads without replacing query semantics.
function observe(db, { firstPage, continuation, beforePublish } = {}) {
  const reads = [], writes = [], options = []
  const wrap = query => new Proxy(query, {
    get(target, name) {
      if (name === 'get') return async () => {
        const snapshot = await target.get()
        reads.push(snapshot.size)
        if (firstPage) await firstPage(snapshot)
        return snapshot
      }
      const value = target[name]
      return typeof value === 'function' ? (...args) => {
        const result = value.apply(target, args)
        return ['where', 'orderBy', 'select', 'limit', 'startAfter'].includes(name) ? wrap(result) : result
      } : value
    },
  })
  const reader = {
    collection: name => { assert.equal(name, 'contracts'); return wrap(db.collection(name)) },
    doc: name => { assert.match(name, /^staffOperationalSummaries\//); return db.doc(name) },
    runTransaction: async (action, settings) => {
      options.push(settings)
      if (!settings?.readOnly && beforePublish) await beforePublish()
      return db.runTransaction(tx => action({
        get: async target => {
          if (settings?.readOnly && continuation) await continuation()
          const result = await tx.get(target)
          if (settings?.readOnly) reads.push(result.size)
          return result
        },
        set: (reference, ...args) => { assert.match(reference.path, /^staffOperationalSummaries\//); writes.push(reference.path); return tx.set(reference, ...args) },
      }), settings)
    },
  }
  return { reader, reads, writes, options }
}

test('all assignment aliases deduplicate contracts but preserve multiple roles and contracts per learner', async () => {
  const rows = [
    ['all', { status: 'active', studentId: 'same', trainerId: 'pt', secondaryTrainerId: 'pt', trainerIds: ['pt', 'pt'], nutritionTrainerId: 'pt', nutritionTrainerIds: ['pt'], nutritionPTIds: ['pt'] }],
    ['another', { status: 'future', studentId: 'same', trainerIds: ['pt'] }],
    ['secondary', { status: 'frozen', trainerIds: ['other', 'pt'] }],
    ['nutrition', { status: 'active', nutritionPTIds: ['pt'] }],
    ['excluded', { status: 'cancelled', trainerId: 'pt' }],
    ['missing-status', { trainerId: 'pt' }],
    ['other', { status: 'active', trainerId: 'other' }],
  ]
  const db = await fixture(rows), f = observe(db)
  const result = await refreshStaffManagedClientSummary(f.reader, 'pt')
  assert.deepEqual(result, { ...managedClientCountsFromContracts('pt', rows.map(([, value]) => value)), stale: false, truncated: false })
  assert.deepEqual(f.reads, [1, 1, 3, 1, 1, 2])
  assert.equal(f.writes.length, 1)
  const value = (await db.doc('staffOperationalSummaries/pt').get()).data()
  assert.equal(value.refreshVersion, 1)
  assert.ok(value.sourceReadTime instanceof Timestamp)
})

test('pagination counts more than 750 contracts without capping or duplicating aliases', async () => {
  const rows = Array.from({ length: 1001 }, (_, index) => [`row-${String(index).padStart(4, '0')}`, { status: ['active', 'future', 'frozen'][index % 3], trainerId: 'pt', trainerIds: ['pt'], nutritionTrainerIds: ['pt'] }])
  const db = await fixture(rows), f = observe(db)
  const result = await readStaffManagedClientCounts(f.reader, 'pt')
  assert.deepEqual(result.counts, { main: 1001, secondary: 0, nutrition: 1001 })
  assert.deepEqual(f.reads, [250, 250, 250, 250, 1, 0, 250, 250, 250, 250, 1, 0, 250, 250, 250, 250, 1, 0])
  assert.equal(result.contractsRead, 3003)
  assert.equal(result.uniqueContractsRead, 1001)
  assert.equal(result.queryPages, 18)
  assert.ok(f.options.every(option => option.readOnly && option.readTime.isEqual(result.sourceReadTime)))
  assert.equal(f.writes.length, 0)
})

test('an exactly full last page completes only after an empty continuation', async () => {
  const db = await fixture(Array.from({ length: 250 }, (_, index) => [`row-${index}`, { status: 'active', trainerId: 'pt' }]))
  const f = observe(db), result = await readStaffManagedClientCounts(f.reader, 'pt')
  assert.equal(result.counts.main, 250)
  assert.deepEqual(f.reads, [250, 0, 0, 0, 0, 0, 0])
})

test('a delayed older refresh cannot overwrite a newer completed refresh', async () => {
  const db = await fixture([['row', { status: 'active', trainerId: 'pt' }]])
  const captured = gate(), release = gate()
  const older = observe(db, { beforePublish: async () => { captured.resolve(); await release.promise } })
  const pending = refreshStaffManagedClientSummary(older.reader, 'pt')
  await captured.promise
  await db.doc('contracts/row').update({ status: 'cancelled' })
  const newer = await refreshStaffManagedClientSummary(db, 'pt')
  release.resolve()
  assert.deepEqual(await pending, newer)
  assert.equal((await db.doc('staffOperationalSummaries/pt').get()).data().managedClientCounts.main, 0)
  assert.equal(older.writes.length, 0)
})

test('equal counts still advance the watermark to fence an intervening delayed change', async () => {
  const db = await fixture([['row', { status: 'active', trainerId: 'pt' }]])
  await refreshStaffManagedClientSummary(db, 'pt')
  const original = (await db.doc('staffOperationalSummaries/pt').get()).data().sourceReadTime
  await db.doc('contracts/row').update({ status: 'cancelled' })
  const captured = gate(), release = gate()
  const delayed = observe(db, { beforePublish: async () => { captured.resolve(); await release.promise } })
  const pending = refreshStaffManagedClientSummary(delayed.reader, 'pt')
  await captured.promise
  await db.doc('contracts/row').update({ status: 'active' })
  await refreshStaffManagedClientSummary(db, 'pt')
  const restored = (await db.doc('staffOperationalSummaries/pt').get()).data()
  assert.ok(restored.sourceReadTime.toMillis() > original.toMillis())
  release.resolve(); await pending
  assert.equal((await db.doc('staffOperationalSummaries/pt').get()).data().managedClientCounts.main, 1)
})

test('status changes, deletion and insertion between pages cannot mix snapshots', async () => {
  const db = await fixture(Array.from({ length: 251 }, (_, index) => [`row-${String(index).padStart(4, '0')}`, { status: 'active', trainerId: 'pt' }]))
  const f = observe(db, { firstPage: async () => {
    const batch = db.batch()
    batch.delete(db.doc('contracts/row-0250'))
    batch.update(db.doc('contracts/row-0000'), { status: 'cancelled' })
    batch.set(db.doc('contracts/earlier-new'), { status: 'active', trainerId: 'pt' })
    await batch.commit()
  } })
  assert.equal((await refreshStaffManagedClientSummary(f.reader, 'pt')).main, 251)
  assert.equal((await refreshStaffManagedClientSummary(db, 'pt')).main, 250)
})

test('an empty first alias still fences all later aliases to its original snapshot', async () => {
  const db = await fixture([['nutrition', { status: 'active', nutritionPTIds: ['pt'] }]])
  const f = observe(db, { firstPage: async snapshot => {
    assert.equal(snapshot.size, 0)
    const batch = db.batch()
    batch.update(db.doc('contracts/nutrition'), { nutritionPTIds: ['other'] })
    batch.set(db.doc('contracts/new-a'), { status: 'active', nutritionPTIds: ['pt'] })
    batch.set(db.doc('contracts/new-b'), { status: 'active', nutritionPTIds: ['pt'] })
    await batch.commit()
  } })
  const result = await readStaffManagedClientCounts(f.reader, 'pt')
  assert.deepEqual(result.counts, { main: 0, secondary: 0, nutrition: 1 })
  assert.deepEqual(f.reads, [0, 0, 0, 0, 0, 1])
  assert.ok(f.options.every(option => option.readOnly && option.readTime.isEqual(result.sourceReadTime)))
  assert.equal((await readStaffManagedClientCounts(db, 'pt')).counts.nutrition, 2)
})

test('a later alias failure cannot publish a successfully read primary count', async () => {
  const db = await fixture([['primary', { status: 'active', trainerId: 'pt' }]])
  const f = observe(db, { continuation: async () => { throw Error('injected alias failure') } })
  await assert.rejects(refreshStaffManagedClientSummary(f.reader, 'pt'), /injected alias failure/)
  assert.deepEqual(f.reads, [1])
  assert.equal(f.writes.length, 0)
  assert.equal((await db.doc('staffOperationalSummaries/pt').get()).exists, false)
})

test('page failure publishes nothing; retry starts from current source and completes', async () => {
  const db = await fixture(Array.from({ length: 251 }, (_, index) => [`row-${index}`, { status: 'active', trainerId: 'pt' }]))
  await db.doc('staffOperationalSummaries/pt').set({ managedClientCounts: { main: 7 }, marker: 'keep' })
  const f = observe(db, { continuation: async () => { throw Error('injected page failure') } })
  await assert.rejects(refreshStaffManagedClientSummary(f.reader, 'pt'), /injected page failure/)
  assert.equal(f.writes.length, 0)
  assert.equal((await db.doc('staffOperationalSummaries/pt').get()).data().managedClientCounts.main, 7)
  assert.equal((await refreshStaffManagedClientSummary(db, 'pt')).main, 251)
  assert.equal((await db.doc('staffOperationalSummaries/pt').get()).data().marker, 'keep')
})

test('reassign, delayed duplicate events, deletion and cancelled contracts use current source', async () => {
  const db = await fixture([['row', { status: 'active', trainerId: 'old' }]])
  const before = await db.doc('contracts/row').get()
  await db.doc('contracts/row').update({ trainerId: 'new' })
  const after = await db.doc('contracts/row').get()
  const moved = { data: { before, after } }
  await syncStaffManagedClientSummary({ db, event: moved })
  assert.equal((await db.doc('staffOperationalSummaries/old').get()).data().managedClientCounts.main, 0)
  assert.equal((await db.doc('staffOperationalSummaries/new').get()).data().managedClientCounts.main, 1)
  await db.doc('contracts/row').delete()
  const deleted = await db.doc('contracts/row').get()
  await syncStaffManagedClientSummary({ db, event: { data: { before: after, after: deleted } } })
  await syncStaffManagedClientSummary({ db, event: moved })
  await syncStaffManagedClientSummary({ db, event: moved })
  assert.equal((await db.doc('staffOperationalSummaries/new').get()).data().managedClientCounts.main, 0)
  assert.equal((await db.doc('staffOperationalSummaries/old').get()).data().managedClientCounts.main, 0)
})

test('repair upgrades fresh legacy summaries and keeps its cursor on failure', async () => {
  const db = await fixture([['row', { status: 'active', trainerId: 'pt' }]])
  await db.doc('roleAssignments/pt').set({ accessRole: 'staff' })
  await db.doc('staffOperationalSummaries/pt').set({ schemaVersion: 2, managedClientCounts: { main: 9 }, generatedAt: Timestamp.now() })
  await db.doc('systemJobs/staffManagedClientSummaryReconciliation').set({ cursor: 'z-legacy-tail' })
  await assert.rejects(reconcileStaffManagedClientSummaries({ db, refresh: async () => { throw Error('injected refresh failure') } }), /injected refresh failure/)
  assert.equal((await db.doc('systemJobs/staffManagedClientSummaryReconciliation').get()).data().cursor, 'z-legacy-tail')
  const logger = { info() {} }
  assert.equal((await reconcileStaffManagedClientSummaries({ db, logger })).refreshed, 1)
  assert.equal((await db.doc('staffOperationalSummaries/pt').get()).data().managedClientCounts.main, 1)
  assert.equal((await reconcileStaffManagedClientSummaries({ db, logger })).refreshed, 0)
})

test('healthy summaries use indexed due dates and skip staff discovery between passes', async () => {
  const db = await fixture()
  await db.doc('roleAssignments/pt').set({ accessRole: 'staff' })
  await refreshStaffManagedClientSummary(db, 'pt')
  const reference = db.doc('staffOperationalSummaries/pt')
  const original = (await reference.get()).data()
  assert.equal(original.nextReconcileAt.toMillis(), original.sourceReadTime.toMillis() + 6 * 3600_000)
  const logger = { info() {} }
  assert.equal((await reconcileStaffManagedClientSummaries({ db, logger })).checked, 1)
  const checked = []
  const reader = new Proxy(db, { get(target, key) {
    if (key === 'collection') return name => { checked.push(name); return target.collection(name) }
    return typeof target[key] === 'function' ? target[key].bind(target) : target[key]
  } })
  assert.deepEqual(await reconcileStaffManagedClientSummaries({ db: reader, logger }), { checked: 0, refreshed: 0, cursor: '' })
  assert.deepEqual(checked, ['staffOperationalSummaries'])
  assert.ok((await reference.get()).data().sourceReadTime.isEqual(original.sourceReadTime))
})

test('an exactly full discovery page completes at its empty tail and restarts only when due', async () => {
  const db = await fixture(), logger = { info() {} }, now = Date.now()
  for (const id of ['a', 'b']) await db.doc(`roleAssignments/${id}`).set({ accessRole: 'staff' })
  const first = await reconcileStaffManagedClientSummaries({ db, logger, now, batchSize: 2 })
  assert.equal(first.cursor, 'b')
  const second = await reconcileStaffManagedClientSummaries({ db, logger, now, batchSize: 2 })
  assert.deepEqual(second, { checked: 0, refreshed: 0, cursor: '' })
  await db.doc('roleAssignments/new').set({ accessRole: 'staff' })
  assert.equal((await reconcileStaffManagedClientSummaries({ db, logger, now })).checked, 0)
  const later = await reconcileStaffManagedClientSummaries({ db, logger, now: now + 6 * 3600_000 + 1 })
  assert.ok(later.refreshed >= 1)
  assert.equal((await db.doc('staffOperationalSummaries/new').get()).exists, true)
})

test('fresh fenced legacy summaries get due dates without scanning contracts', async () => {
  const db = await fixture(), logger = { info() {} }
  await db.doc('roleAssignments/pt').set({ accessRole: 'staff' })
  const reference = db.doc('staffOperationalSummaries/pt')
  const sourceReadTime = Timestamp.now()
  await reference.set({ schemaVersion: 2, refreshVersion: 1, truncated: false, sourceReadTime,
    generatedAt: sourceReadTime, managedClientCounts: { main: 2, secondary: 1, nutrition: 0 } })
  const result = await reconcileStaffManagedClientSummaries({ db, logger, refresh: async () => { throw Error('unexpected scan') } })
  assert.equal(result.refreshed, 0)
  assert.equal((await reference.get()).data().nextReconcileAt.toMillis(), sourceReadTime.toMillis() + 6 * 3600_000)
})

test('due repair is bounded, leaves failed items due and removes deleted staff from recurring scans', async () => {
  const db = await fixture(), logger = { info() {} }, now = Date.now()
  await db.doc('systemJobs/staffManagedClientSummaryReconciliation').set({ cursor: '', nextDiscoveryAt: Timestamp.fromMillis(now + 3600_000) })
  for (const id of ['a', 'b', 'removed']) {
    if (id !== 'removed') await db.doc(`roleAssignments/${id}`).set({ accessRole: 'staff' })
    await db.doc(`staffOperationalSummaries/${id}`).set({ nextReconcileAt: Timestamp.fromMillis(now - 1000), managedClientCounts: { main: 8 } })
  }
  await assert.rejects(reconcileStaffManagedClientSummaries({ db, logger, now, batchSize: 1, refresh: async () => { throw Error('retry me') } }), /retry me/)
  assert.ok((await db.doc('staffOperationalSummaries/a').get()).data().nextReconcileAt.toMillis() < now)
  assert.equal((await reconcileStaffManagedClientSummaries({ db, logger, now, batchSize: 1 })).refreshed, 1)
  assert.equal((await reconcileStaffManagedClientSummaries({ db, logger, now, batchSize: 1 })).refreshed, 1)
  assert.equal((await reconcileStaffManagedClientSummaries({ db, logger, now })).refreshed, 0)
  const removed = (await db.doc('staffOperationalSummaries/removed').get()).data()
  assert.equal(removed.nextReconcileAt, undefined)
  assert.equal(removed.managedClientCounts.main, 8)
})
