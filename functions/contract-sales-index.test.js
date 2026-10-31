'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { Timestamp } = require('firebase-admin/firestore')
const { contractSalesDateKey, contractSalesIndex, contractSalesIndexPatch, hasCurrentContractSalesIndex,
  syncContractSalesIndex, readContractSalesRange } = require('./contract-sales-index')
const { projectionSourceChanged } = require('./projection-event-policy')
const { workspaceSourceChanged } = require('./workspace-change-signals')
const { syncOperationalActionSource } = require('./action-center')
const { syncPtScheduleWeeklyViewSource } = require('./pt-schedule-weekly-view')
const { syncContractUsageView } = require('./contract-usage-view')
const { syncDailyAggregateWrite } = require('./operations-dashboard-aggregates')

const snapshot = (value, path = 'contracts/c1') => ({ exists: value !== null, data: () => value,
  ref: { path, parent: { id: path.split('/')[0] } } })
const forbidden = new Proxy({}, { get() { throw Error('Unexpected database access') } })

test('sales date preserves Vietnam boundaries and legacy timestamp precedence', () => {
  const boundary = new Date('2026-10-24T17:00:00.000Z')
  for (const value of [boundary, boundary.toISOString(), Timestamp.fromDate(boundary)]) {
    assert.equal(contractSalesDateKey(value), '2026-10-25')
  }
  assert.equal(contractSalesDateKey(new Date(boundary.getTime() - 1)), '2026-10-24')
  for (const value of [undefined, null, '', 'bad', 0, NaN]) assert.equal(contractSalesDateKey(value), '')
  assert.equal(contractSalesIndex({ status: 'future', signedAt: boundary, createdAt: '2026-10-28', startDate: '2027-01-01' }).key, '2026-10-25')
  assert.equal(contractSalesIndex({ createdAt: '2026-10-20', contractDate: '2026-10-21', startDate: '2026-10-22' }).key, '2026-10-20')
  assert.equal(contractSalesIndex({ contractDate: '2026-10-21', startDate: '2026-10-22' }).key, '2026-10-21')
  assert.equal(contractSalesIndex({ startDate: '2026-10-22' }).key, '2026-10-22')
  assert.equal(contractSalesIndex({ signedAt: 'bad', createdAt: boundary }).key, '!missing_date', 'invalid higher-priority dates remain reviewable')
})

test('cancelled baseline, missing dates and excluded status keep separate diagnostics', () => {
  for (const status of ['draft', 'inactive', 'archived']) assert.equal(contractSalesIndex({ status, signedAt: '2026-10-25' }).key, '!excluded')
  assert.equal(contractSalesIndex({ status: 'active' }).key, '!missing_date')
  assert.equal(contractSalesIndex({ status: 'cancelled', totalPrice: 999999, signedAt: '2026-10-25' }).key, '!cancelled_unverified')
  assert.equal(contractSalesIndex({ status: 'cancelled', salesCancellationSnapshot: { schemaVersion: 1, netAmount: 0, effectiveAt: '2026-09-30' } }).key, '2026-09-30')
  assert.equal(contractSalesIndex({ status: 'cancelled', salesCancellationSnapshot: { schemaVersion: 1, netAmount: 5, effectiveAt: 'bad' } }).key, '!missing_date')
})

test('canonical and metadata-only contract deliveries do zero downstream database work', async () => {
  const before = { status: 'active', studentId: 's', startDate: '2026-10-25', totalPrice: 1000 }
  const after = { ...before, ...contractSalesIndexPatch(before) }
  const event = { params: { contractId: 'c1' }, data: { before: snapshot(before), after: snapshot(after) } }
  assert(hasCurrentContractSalesIndex(after))
  assert.equal(projectionSourceChanged(event), false)
  assert.equal(workspaceSourceChanged(before, after, 'contracts'), false)
  assert.equal((await syncContractSalesIndex({ db: forbidden, event })).updated, 0)
  assert.equal((await syncContractUsageView({ db: forbidden, event })).skippedUnchangedSource, 1)
  assert.equal((await syncOperationalActionSource({ db: forbidden, event })).actions, 0)
  assert.equal((await syncPtScheduleWeeklyViewSource({ db: forbidden, event, source: 'contract' })).marked, 0)
  assert.equal((await syncDailyAggregateWrite({ db: forbidden, event, source: 'contract' })).updated, 0)
  for (const patch of [{ totalPrice: 1200 }, { status: 'cancelled' }, { startDate: '2026-11-01' }, { branchId: 'b' }, { newBusinessField: true }]) {
    assert.equal(projectionSourceChanged({ data: { before: snapshot(after), after: snapshot({ ...after, ...patch }) } }), true)
  }
  assert.equal(projectionSourceChanged({ data: { before: snapshot(null), after: snapshot(after) } }), true)
  assert.equal(projectionSourceChanged({ data: { before: snapshot(after), after: snapshot(null) } }), true)
})

test('delayed repair reads current source and only updates the index', async () => {
  const old = { startDate: '2026-09-01' }, current = { startDate: '2026-10-25', revision: 8, totalPrice: 200 }
  const writes = []
  const db = { runTransaction: work => work({ get: async ref => { assert.equal(ref.path, 'contracts/c1'); return snapshot(current) },
    update: (ref, patch) => writes.push([ref.path, patch]) }) }
  assert.deepEqual(await syncContractSalesIndex({ db, event: { data: { after: snapshot(old) } } }), { updated: 1 })
  assert.deepEqual(writes, [['contracts/c1', { financeSalesIndex: { schemaVersion: 1, key: '2026-10-25' } }]])
  assert.deepEqual(await syncContractSalesIndex({ db: forbidden, event: { data: { after: snapshot(null) } } }), { updated: 0 })
})

test('index rollout failure falls back but transport/permission errors remain failures', async () => {
  let reads = 0
  const base = { select: () => base, limit: limit => { assert.equal(limit, 2001); return base },
    get: async () => { reads++; return { size: 1, docs: [snapshot({ startDate: '2026-10-25' })] } } }
  const db = code => ({ collection: () => base, runTransaction: async () => { throw Object.assign(Error('failure'), { code }) } })
  assert.equal((await readContractSalesRange(db(9), { branchId: 'all' })).mode, 'legacy_index')
  for (const code of [7, 14, 'permission-denied']) await assert.rejects(readContractSalesRange(db(code), { branchId: 'all' }))
  assert.equal(reads, 1)
})
