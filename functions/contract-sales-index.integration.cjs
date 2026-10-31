'use strict'

const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { contractSalesIndexPatch, hasCurrentContractSalesIndex, readContractSalesRange, syncContractSalesIndex, SALES_INDEX_GATE } = require('./contract-sales-index')
const { createBusinessReportingFunctions } = require('./business-reporting')
const { planSalesIndex, applySalesIndexPlan, auditSalesIndex, businessHash, assertDeploymentProof } = require('../scripts/firebase-contract-sales-index.cjs')
const { renewalHandoverPlan } = require('./contract-renewal-handover')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `sales-index-${randomUUID()}`), clients = []
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })
const input = { branchId: 'all', startDate: '2026-10-25', endDate: '2026-10-31' }
const sale = (patch = {}) => ({ branchId: 'a', status: 'active', totalPrice: 1000, discount: 100, signedAt: '2026-10-25', ...patch })
async function fixture(entries, enabled = true) {
  const db = getFirestore(app, `sales-index-${randomUUID()}`); clients.push(db)
  for (let offset = 0; offset < entries.length; offset += 400) {
    const batch = db.batch()
    for (const [id, value] of entries.slice(offset, offset + 400)) batch.set(db.doc(`contracts/${id}`), { ...value, ...contractSalesIndexPatch(value) })
    await batch.commit()
  }
  await db.doc(SALES_INDEX_GATE).set({ schemaVersion: 1, status: 'ready', enabled })
  return db
}

test('indexed callable preserves legacy sales and diagnostics while reading only period contracts and exceptions', async () => {
  const entries = Array.from({ length: 415 }, (_, i) => [`old-${i}`, sale({ signedAt: '2026-09-01', branchId: i % 2 ? 'b' : 'a' })])
  entries.push(['new-a', sale()], ['new-b', sale({ branchId: 'b' })], ['unassigned', sale({ branchId: null })],
    ['missing-date', { status: 'active', branchId: 'a', totalPrice: 900 }], ['cancel-unknown', sale({ status: 'cancelled', branchId: 'b' })],
    ['cancel-known', sale({ status: 'cancelled', salesCancellationSnapshot: { schemaVersion: 1, netAmount: 500, effectiveAt: '2026-10-26' } })],
    ['excluded', sale({ status: 'draft' })], ['future', sale({ status: 'future', startDate: '2027-01-01' })])
  const db = await fixture(entries), count = entries.length
  await db.doc('users/admin').set({ role: 'admin' })
  const api = createBusinessReportingFunctions({ db, onCall: (_options, handler) => handler })
  for (const branchId of ['all', 'a', 'b']) {
    const request = { auth: { uid: 'admin', token: { role: 'admin' } }, data: { ...input, branchId } }
    const indexed = await api.listBusinessPerformance(request)
    await db.doc(SALES_INDEX_GATE).update({ enabled: false })
    const legacy = await api.listBusinessPerformance(request)
    await db.doc(SALES_INDEX_GATE).update({ enabled: true })
    assert.equal(indexed.dataQuality.contractSalesReadMode, 'indexed')
    assert.equal(legacy.dataQuality.contractSalesReadMode, 'legacy_gate')
    assert(indexed.dataQuality.scannedSalesContracts < legacy.dataQuality.scannedSalesContracts / 20)
    for (const result of [indexed, legacy]) {
      delete result.dataQuality.contractSalesReadMode; delete result.dataQuality.scannedSalesContracts
    }
    assert.deepEqual(indexed, legacy, 'all financial totals, warnings and daily series match')
  }
  const audit = await auditSalesIndex(db, input.endDate)
  assert.equal(audit.contracts, count); assert(audit.cases.length >= 9)
  assert(audit.cases.every(row => row.parity))
})

test('incomplete or stale coverage falls back and a delayed legacy event repairs only the latest index', async () => {
  const db = await fixture([['existing', sale()]], false)
  await db.doc('contracts/legacy').set(sale({ signedAt: '2026-09-01', revision: 1 }))
  assert.equal((await readContractSalesRange(db, input)).mode, 'legacy_gate')
  await db.doc(SALES_INDEX_GATE).update({ enabled: true })
  assert.equal((await readContractSalesRange(db, input)).mode, 'legacy_coverage')
  const event = { data: { after: await db.doc('contracts/legacy').get() } }
  await db.doc('contracts/legacy').update({ signedAt: '2026-10-29', revision: 2 })
  const businessBefore = businessHash((await db.doc('contracts/legacy').get()).data())
  assert.deepEqual(await syncContractSalesIndex({ db, event }), { updated: 1 })
  const current = (await db.doc('contracts/legacy').get()).data()
  assert(hasCurrentContractSalesIndex(current)); assert.equal(current.financeSalesIndex.key, '2026-10-29')
  assert.equal(businessHash(current), businessBefore)
  assert.deepEqual(await syncContractSalesIndex({ db, event }), { updated: 0 })
  assert.equal((await readContractSalesRange(db, input)).mode, 'indexed')
  await db.doc('contracts/existing').update({ signedAt: '2026-08-01' })
  assert.equal((await readContractSalesRange(db, input)).mode, 'legacy_stale')
})

test('coverage and selected contracts use one read-only snapshot during a legacy create', async () => {
  const db = await fixture([['original', sale()]]), newRef = db.doc('contracts/racing')
  let injected = false
  const proxy = { collection: db.collection.bind(db), doc: db.doc.bind(db),
    runTransaction: (handler, options) => db.runTransaction(tx => handler({ get: async reference => {
      const snapshot = await tx.get(reference)
      if (reference.path === SALES_INDEX_GATE && !injected) {
        injected = true
        await newRef.set(sale())
      }
      return snapshot
    } }), options) }
  const result = await readContractSalesRange(proxy, input)
  assert.equal(result.mode, 'indexed'); assert.equal(result.coverageContracts, 1); assert.equal(result.docs.length, 1)
  const after = await readContractSalesRange(db, input)
  assert.equal(after.mode, 'legacy_coverage'); assert.equal(after.docs.length, 2)
})

test('shared document cap includes missing-date and cancellation evidence; foreign history does not consume branch cap', async () => {
  const db = await fixture([['date1', sale()], ['date2', sale()], ['date3', sale()],
    ['missing', { branchId: 'a', status: 'active' }], ['cancel', { branchId: 'a', status: 'cancelled' }],
    ...Array.from({ length: 15 }, (_, i) => [`foreign-${i}`, sale({ branchId: 'b' })])])
  const result = await readContractSalesRange(db, { ...input, branchId: 'a' }, 3)
  assert.equal(result.mode, 'indexed'); assert.equal(result.truncated, true); assert.equal(result.scanned, 4); assert.equal(result.docs.length, 3)
  assert(result.docs.every(doc => doc.data().branchId === 'a'))
})

test('backfill is metadata-only, resumable, and refuses unreviewed source changes or tampered plans', async () => {
  const db = await fixture([], false)
  const original = sale({ paidAmount: 123, totalSessions: 36, usedSessions: 4, revision: 7, note: 'Synthetic business evidence' })
  await db.doc('contracts/c1').set(original)
  const plan = await planSalesIndex(db)
  await assert.rejects(applySalesIndexPlan(db, { ...plan, rows: [] }), /digest/)
  await db.doc('contracts/c1').update({ totalPrice: 1500 })
  await assert.rejects(applySalesIndexPlan(db, plan), /source changed/)
  const fresh = await planSalesIndex(db), before = businessHash((await db.doc('contracts/c1').get()).data())
  assert.deepEqual(await applySalesIndexPlan(db, fresh), { changed: 1, alreadyCurrent: 0, total: 1 })
  assert.equal(businessHash((await db.doc('contracts/c1').get()).data()), before)
  assert.deepEqual(await applySalesIndexPlan(db, fresh), { changed: 0, alreadyCurrent: 1, total: 1 })
  assert.equal((await db.doc(SALES_INDEX_GATE).get()).data().enabled, false, 'backfill never enables itself')
  assert.throws(() => assertDeploymentProof({}, 'a'.repeat(40)))
})

test('early handover updates a legacy activation-based index atomically and preserves signed dates', () => {
  const source = { studentId: 's', status: 'active', startDate: '2026-08-01', endDate: '2026-11-15', totalSessions: 12, usedSessions: 12, totalPrice: 1200 }
  const next = { studentId: 's', sourceContractId: 'source', status: 'future', activationMode: 'automatic', startDate: '2026-11-16', endDate: '2027-02-16', totalSessions: 12, totalPrice: 2400 }
  for (const signedAt of [undefined, Timestamp.fromDate(new Date('2026-10-01T17:00:00Z'))]) {
    const value = signedAt ? { ...next, signedAt } : next
    const plan = renewalHandoverPlan({ sourceId: 'source', source, nextId: 'next', next: value, date: '2026-10-31', actorUid: 'a' })
    assert(plan.projection.earlyHandover)
    assert.equal(plan.nextPatch.financeSalesIndex.key, signedAt ? '2026-10-02' : '2026-10-31')
    assert(hasCurrentContractSalesIndex({ ...value, ...plan.nextPatch }))
    assert(hasCurrentContractSalesIndex({ ...source, ...plan.sourcePatch }))
  }
})
