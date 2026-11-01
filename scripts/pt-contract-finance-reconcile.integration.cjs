'use strict'
const { randomUUID } = require('node:crypto')
const { createRequire } = require('node:module')
const path = require('node:path')
const assert = require('node:assert/strict')
const { test, after } = require('node:test')
const backend = createRequire(path.join(__dirname, '../functions/package.json'))
const { initializeApp, deleteApp } = backend('firebase-admin/app')
const { getFirestore, Timestamp } = backend('firebase-admin/firestore')
const { reconcileContract } = require('./firebase-pt-contract-finance-reconcile.cjs')
const { amendmentProjection } = require('../functions/contract-amendments')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `contract-finance-${randomUUID()}`)
const clients = []
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })
async function fixture() {
  const db = getFirestore(app, `contract-finance-${randomUUID()}`); clients.push(db)
  const c = { studentId: 's', branchId: 'b', status: 'active', packageId: 'p', totalSessions: 6, usedSessions: 3, totalPrice: 600, discount: 0,
    paidAmount: 600, startDate: '2026-09-01', endDate: '2090-12-01', revision: 7 }
  const values = { 'contracts/c': c, 'ledgerEntries/payment': { contractId: 'c', type: 'payment', status: 'posted', amount: 600, cashImpact: 600 },
    'ledgerEntries/pt_session_s1': { contractId: 'c', studentId: 's', sessionId: 's1', attendanceEventId: 's1', serviceOrdinal: 1,
      type: 'revenue_recognition', status: 'posted', amount: 100, revenueImpact: 100, cashImpact: 0, deferredRevenueImpact: -100,
      branchId: 'b', source: 'pt_gym', effectiveAt: Timestamp.fromDate(new Date('2026-09-01T08:00:00Z')) } }
  for (const n of [1, 2, 3]) {
    const s = { studentId: 's', contractId: 'c', trainerId: 't', branchId: 'b', date: `2026-09-0${n}`, hour: 15, status: 'completed',
      ...(n > 1 ? { billingStatus: 'charged', serviceOrdinal: n } : {}) }
    values[`sessions/s${n}`] = s
    if (n > 1) {
      values[`sessionBillingEvents/s${n}`] = { ...s, sessionId: `s${n}`, type: 'session_charge' }
      values[`attendanceEvents/s${n}`] = { ...s, sessionId: `s${n}`, type: 'attended', attendanceStatus: 'present',
        confirmationSource: n === 2 ? 'auto_after_48h' : 'manual', confirmedBy: n === 2 ? 'system:auto-after-48h' : 'pt',
        occurredAt: Timestamp.fromDate(new Date(`${s.date}T08:00:00Z`)) }
    }
  }
  values['sessions/duplicate'] = { ...values['sessions/s2'], status: 'cancelled', billingStatus: 'exempt', serviceOrdinal: 3, duplicateRepairVersion: 1 }
  values['sessionBillingEvents/duplicate'] = { ...values['sessionBillingEvents/s2'], sessionId: 'duplicate', serviceOrdinal: 3 }
  values['revenueRecognitionReviews/s2'] = { contractId: 'c', sessionId: 's2', status: 'open', issueCode: 'AUTO_CONFIRMATION_REQUIRES_REVIEW' }
  const batch = db.batch(); for (const [key, value] of Object.entries(values)) batch.create(db.doc(key), value); await batch.commit()
  return { db, values }
}
test('dry run writes nothing; atomic repair enables amendment, preserves money and confirmations, and is idempotent', async () => {
  const { db, values } = await fixture(), before = (await db.doc('ledgerEntries/pt_session_s1').get()).data()
  const plan = await reconcileContract(db, 'c')
  assert.equal(plan.usedSessions, 3); assert.equal(plan.additionalRevenue, 200); assert.equal(plan.duplicatesVoided, 1)
  assert.equal((await db.collection('ledgerEntries').get()).size, 2)
  assert.equal((await db.doc('sessionBillingEvents/duplicate').get()).data().billingStatus, 'charged')
  const options = { apply: true, expectedDigest: plan.sourceDigest, expectedRuntime: plan.runtimeHash }
  const applied = await reconcileContract(db, 'c', options)
  assert.equal(applied.applied, true); assert.equal((await reconcileContract(db, 'c', options)).alreadyApplied, true)
  assert.deepEqual((await db.doc('contracts/c').get()).data(), values['contracts/c'])
  assert.deepEqual((await db.doc('ledgerEntries/pt_session_s1').get()).data(), before)
  assert.deepEqual((await db.doc('ledgerEntries/payment').get()).data(), values['ledgerEntries/payment'])
  assert.equal((await db.doc('sessionBillingEvents/duplicate').get()).data().billingStatus, 'void_duplicate')
  const legacy = (await db.doc('attendanceEvents/s1').get()).data()
  assert.equal(legacy.type, 'legacy_charge'); assert.equal(legacy.attendanceStatus, 'pending'); assert.equal(legacy.confirmedBy, undefined)
  const automatic = (await db.doc('attendanceEvents/s2').get()).data()
  assert.equal(automatic.confirmationSource, 'auto_after_48h'); assert.equal(automatic.confirmedBy, 'system:auto-after-48h')
  assert.equal((await db.doc('revenueRecognitionReviews/s2').get()).data().status, 'resolved')
  const all = {}; for (const col of ['sessions','sessionBillingEvents','ledgerEntries','revenueRecognitionReviews']) all[col] = (await db.collection(col).get()).docs.map(d => ({ ...d.data(), id: d.id }))
  const p = amendmentProjection({ contractId: 'c', contract: values['contracts/c'], target: { packageId: 'three', totalSessions: 4, totalPrice: 400, discount: 0, endDate: '2090-12-01' },
    sessions: all.sessions, billings: all.sessionBillingEvents, ledger: all.ledgerEntries, reviews: all.revenueRecognitionReviews })
  assert.deepEqual(p.blockers, []); assert.equal(p.after.remainingSessions, 1); assert.equal(p.after.refundDue, 200)
})
test('stale dry-run digest and a locked period cannot commit any partial repair', async () => {
  const { db } = await fixture(), plan = await reconcileContract(db, 'c')
  await db.doc('sessions/s1').update({ revision: 99 })
  await assert.rejects(reconcileContract(db, 'c', { apply: true, expectedDigest: plan.sourceDigest, expectedRuntime: plan.runtimeHash }), /Source data changed/)
  assert.equal((await db.collection('ledgerEntries').get()).size, 2)
  assert.equal((await db.doc('sessionBillingEvents/s1').get()).exists, false)
  await db.doc('financePeriods/2026-09').set({ status: 'locked' })
  await assert.rejects(reconcileContract(db, 'c'), /Finance period is locked/)
  assert.equal((await db.collection('financeReconciliationRepairs').get()).size, 0)
})
