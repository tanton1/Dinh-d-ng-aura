'use strict'
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { syncMembership, processDueMemberships, processMembershipActivation, todayKey } = require('./loyalty-membership')
const { DEFAULT_POLICY } = require('./loyalty-core')
const { applySourceTarget, createLoyaltyFunctions } = require('./loyalty')
const { syncLoyaltyDashboardRecord, readLoyaltyDashboardSummary, VERSION, SHARDS } = require('./loyalty-dashboard-projection')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(localhost|127\.0\.0\.1):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `membership-${randomUUID()}`)
const clients = []
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })
async function fixture(extra = {}) {
  const db = getFirestore(app, `membership-${randomUUID()}`); clients.push(db)
  const rows = { 'loyaltySettings/current': { membershipStartDate: todayKey() },
    'loyaltyDashboardState/current': { schemaVersion: VERSION, shards: SHARDS, status: 'ready' },
    'users/admin': { role: 'admin' }, 'students/live': { name: 'Live', branchId: 'a', status: 'active' },
    'students/old': { name: 'Old', branchId: 'a', status: 'active' },
    'contracts/live': { studentId: 'live', status: 'active', startDate: '2026-01-01', endDate: '2099-12-31' },
    'contracts/old': { studentId: 'old', status: 'expired', startDate: '2020-01-01', endDate: '2020-12-31' }, ...extra }
  await Promise.all(Object.entries(rows).map(([path, value]) => db.doc(path).set(value)))
  return db
}
const credit = (db, studentId, targetPoints, options = {}) => applySourceTarget({ db, studentId, sourceKey: `test:${studentId}`, sourceType: 'test', sourceId: studentId, description: 'Test', targetPoints, desiredState: 'available', ...options })

test('inactive history cannot create a wallet, source or ledger; active enrollment and retry credit exactly once', async () => {
  const db = await fixture()
  const old = await credit(db, 'old', 200)
  assert.equal(old.skipped, 'membership_inactive')
  assert.equal((await db.doc('loyaltyAccounts/old').get()).exists, false)
  assert.equal((await db.collection('loyaltyLedgerEntries').get()).size, 0)
  await Promise.all([credit(db, 'live', 200), credit(db, 'live', 200), syncMembership({ db, studentId: 'live' })])
  assert.equal((await db.doc('loyaltyAccounts/live').get()).data().availablePoints, 200)
  assert.equal((await db.collection('loyaltyLedgerEntries').get()).size, 1)
  assert.equal((await db.doc('students/live').get()).data().loyaltyMembership.active, true)
})

test('archive preserves wallet and ledger, prevents new credit, permits reversal and later reactivation', async () => {
  const db = await fixture()
  await credit(db, 'live', 200)
  const initial = (await db.doc('loyaltyAccounts/live').get()).data()
  await db.doc('contracts/live').update({ endDate: '2026-01-31', status: 'expired' })
  await syncMembership({ db, studentId: 'live' })
  assert.deepEqual((await db.doc('loyaltyAccounts/live').get()).data(), initial)
  assert.equal((await credit(db, 'live', 300)).skipped, 'membership_inactive')
  await credit(db, 'live', 100)
  assert.equal((await db.doc('loyaltyAccounts/live').get()).data().availablePoints, 100)
  await db.doc('contracts/new').set({ studentId: 'live', status: 'active', startDate: todayKey(), endDate: '2099-12-31' })
  await syncMembership({ db, studentId: 'live' })
  assert.equal((await db.doc('loyaltyAccounts/live').get()).data().availablePoints, 100)
  assert.equal((await db.collection('loyaltyLedgerEntries').get()).size, 2)
})

test('due worker advances only due dates, preserves money, and active count excludes enrolled grace members', async () => {
  const db = await fixture({ 'contracts/live': { studentId: 'live', status: 'active', startDate: '2026-10-01', endDate: '2026-10-31' },
    'loyaltyAccounts/live': { availablePoints: 200 } })
  await syncMembership({ db, studentId: 'live', today: '2026-10-24', startDate: '2026-10-24' })
  await syncLoyaltyDashboardRecord({ db, collection: 'students', id: 'live' })
  await syncLoyaltyDashboardRecord({ db, collection: 'loyaltyAccounts', id: 'live' })
  assert.equal((await readLoyaltyDashboardSummary({ db, actor: { accessRole: 'admin' } })).metrics.memberCount, 1)
  await processDueMemberships({ db, today: '2026-11-01' })
  await syncLoyaltyDashboardRecord({ db, collection: 'students', id: 'live' })
  await syncLoyaltyDashboardRecord({ db, collection: 'loyaltyAccounts', id: 'live' })
  const grace = (await readLoyaltyDashboardSummary({ db, actor: { accessRole: 'admin' } })).metrics
  assert.equal(grace.memberCount, 0); assert.equal(grace.availablePoints, 200); assert.equal(grace.tier_member, 0)
  await processDueMemberships({ db, today: '2026-11-30' })
  await syncLoyaltyDashboardRecord({ db, collection: 'students', id: 'live' })
  await syncLoyaltyDashboardRecord({ db, collection: 'loyaltyAccounts', id: 'live' })
  assert.equal((await readLoyaltyDashboardSummary({ db, actor: { accessRole: 'admin' } })).metrics.availablePoints, 0)
  assert.equal((await db.doc('loyaltyAccounts/live').get()).data().availablePoints, 200)
  assert.deepEqual(await processDueMemberships({ db, today: '2026-12-01' }), { processed: 0 })
})

test('account filtering precedes pagination and excludes historical deep links, without creating wallets', async () => {
  const db = await fixture()
  const batch = db.batch()
  for (let i = 0; i < 150; i++) batch.set(db.doc(`students/a-${i}`), { name: 'Historic', branchId: 'a' })
  await batch.commit(); await syncMembership({ db, studentId: 'live' })
  const handlers = createLoyaltyFunctions({ db, onCall: (_opts, fn) => fn })
  const auth = { uid: 'admin', token: { role: 'admin' } }
  const page = await handlers.listLoyaltyAccounts({ auth, data: { pageSize: 10 } })
  assert.equal(page.totalCount, 1); assert.deepEqual(page.accounts.map(r => r.studentId), ['live'])
  assert.equal(page.hasMore, false)
  assert.equal((await handlers.listLoyaltyAccounts({ auth, data: { studentId: 'old' } })).accounts.length, 0)
  assert.equal((await db.collection('loyaltyAccounts').get()).size, 0)
})

test('future prepayment is recovered once by a durable activation, including duplicate deliveries', async () => {
  const db = await fixture({
    'loyaltySettings/current': { membershipStartDate: todayKey(), launchDate: '2026-01-01', activePolicyVersion: 'p' },
    'loyaltyPolicyVersions/p': { ...DEFAULT_POLICY, earnEnabled: true, paymentHoldDays: 0 },
    'contracts/live': { studentId: 'live', status: 'future', startDate: '2099-01-01', endDate: '2099-12-31' },
    'ledgerEntries/payment': { contractId: 'live', type: 'payment', status: 'posted', cashImpact: 1000000, effectiveAt: new Date() },
  })
  const { reconcileContractSpend } = require('./loyalty')
  await reconcileContractSpend({ db, contractId: 'live', logger: { info() {} } })
  assert.equal((await db.doc('loyaltyAccounts/live').get()).exists, false)
  await db.doc('contracts/live').update({ status: 'active', startDate: todayKey() })
  await syncMembership({ db, studentId: 'live' })
  assert.equal((await db.doc('loyaltyMembershipActivations/live').get()).data().pending, true)
  await Promise.all([processMembershipActivation({ db, studentId: 'live' }), processMembershipActivation({ db, studentId: 'live' })])
  assert.equal((await db.doc('loyaltyAccounts/live').get()).data().availablePoints, 100)
  assert.equal((await db.collection('loyaltyLedgerEntries').get()).size, 1)
  assert.equal((await db.doc('loyaltyMembershipActivations/live').get()).data().pending, false)
})

test('legacy admin commands cannot initialize an archived or never-enrolled wallet', async () => {
  const db = await fixture()
  const handlers = createLoyaltyFunctions({ db, onCall: (_opts, fn) => fn })
  const auth = { uid: 'admin', token: { role: 'admin' } }
  await assert.rejects(handlers.reconcileLoyaltyAccount({ auth, data: { studentId: 'old' } }), { code: 'failed-precondition' })
  await assert.rejects(handlers.adjustLoyaltyBalance({ auth, data: { studentId: 'old', points: 100, reason: 'Test', idempotencyKey: 'test-adjust' } }), { code: 'failed-precondition' })
  assert.equal((await db.doc('loyaltyAccounts/old').get()).exists, false)
  assert.equal((await db.collection('loyaltyLedgerEntries').get()).size, 0)
})

test('legacy ISO expiry remains active and can initialize its first wallet', async () => {
  const db = await fixture({ 'contracts/live': { studentId: 'live', status: 'active', startDate: '2026-01-01', endDate: '2099-12-31T00:00:00.000Z' } })
  await syncMembership({ db, studentId: 'live', enqueueActivation: false })
  const member = (await db.doc('students/live').get()).data().loyaltyMembership
  assert.equal(member.state, 'active'); assert.equal(member.activeUntil, '2099-12-31')
  assert.equal(member.nextCheckOn, '2100-01-01')
  await credit(db, 'live', 200)
  assert.equal((await db.doc('loyaltyAccounts/live').get()).data().availablePoints, 200)
})
