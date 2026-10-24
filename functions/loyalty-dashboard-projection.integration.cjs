'use strict'
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { test, after } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { VERSION, SHARDS, COLLECTIONS, syncLoyaltyDashboardRecord: sync, syncLoyaltyDashboardEvent, readLoyaltyDashboardSummary: read } = require('./loyalty-dashboard-projection')
const { createLoyaltyFunctions } = require('./loyalty')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `club-reads-${randomUUID()}`)
const clients = []
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })
const admin = { accessRole: 'admin' }
const staff = (...branchIds) => ({ accessRole: 'staff', branchIds })
async function fixture(seed = {}) {
  const db = getFirestore(app, `club-read-${randomUUID()}`); clients.push(db)
  await db.doc('loyaltyDashboardState/current').set({ schemaVersion: VERSION, shards: SHARDS, status: 'ready' })
  for (const [key, value] of Object.entries(seed)) await db.doc(key).set(value)
  return db
}
async function backfill(db) {
  for (const collection of COLLECTIONS) {
    const page = await db.collection(collection).get()
    for (let offset = 0; offset < page.size; offset += 12) await Promise.all(page.docs.slice(offset, offset + 12).map(doc => sync({ db, collection, id: doc.id })))
  }
}
const change = (id, before, after) => ({ params: { documentId: id }, data: {
  before: { exists: before !== null, data: () => before }, after: { exists: after !== null, data: () => after },
} })

test('transactions converge across duplicate/backfill/old events without changing the wallet', async () => {
  const wallet = { availablePoints: 200, pendingPoints: 150, tierQualifyingValue: 25_000_000, revision: 7 }
  const db = await fixture({ 'students/s': { branchId: 'a' }, 'loyaltyAccounts/s': wallet })
  await Promise.all([backfill(db), sync({ db, collection: 'loyaltyAccounts', id: 's' }), sync({ db, collection: 'loyaltyAccounts', id: 's' })])
  assert.equal((await read({ db, actor: admin })).metrics.availablePoints, 200)
  await db.doc('loyaltyAccounts/s').update({ availablePoints: 225 })
  await syncLoyaltyDashboardEvent({ db, collection: 'loyaltyAccounts', event: change('s', null, wallet) })
  const result = await read({ db, actor: admin })
  assert.equal(result.metrics.availablePoints, 225)
  assert.equal(result.metrics.tier_gold, 1)
  assert.deepEqual((await db.doc('loyaltyAccounts/s').get()).data(), { ...wallet, availablePoints: 225 })
  assert.equal((await db.collection('loyaltyLedgerEntries').get()).size, 0)
})

test('moving and deleting a student transfers dependent scopes, preserving cross-branch redemption restrictions', async () => {
  const db = await fixture({ 'students/s': { branchId: 'a' }, 'loyaltyAccounts/s': { availablePoints: 10 },
    'loyaltyRedemptions/r': { studentId: 's', branchId: 'a', status: 'pending' },
    'memberReferrals/r': { referrerStudentId: 's', status: 'vested' }, 'ambassadorProfiles/s': { studentId: 's', status: 'approved' } })
  await backfill(db)
  await db.doc('students/s').update({ branchId: 'b' })
  await syncLoyaltyDashboardEvent({ db, collection: 'students', event: change('s', { branchId: 'a' }, { branchId: 'b' }) })
  const old = (await read({ db, actor: staff('a') })).metrics
  const moved = (await read({ db, actor: staff('b') })).metrics
  assert.equal(old.availablePoints, 0); assert.equal(old.memberCount, 0)
  assert.equal(moved.availablePoints, 10); assert.equal(moved.qualifiedReferrals, 1); assert.equal(moved.approvedAmbassadors, 1)
  assert.equal(moved.pendingRedemptions, 0)
  assert.equal((await read({ db, actor: staff('a', 'b') })).metrics.pendingRedemptions, 1)
  await db.doc('students/s').delete()
  await syncLoyaltyDashboardEvent({ db, collection: 'students', event: change('s', { branchId: 'b' }, null) })
  assert.equal((await read({ db, actor: staff('a', 'b') })).metrics.availablePoints, 0)
  const all = (await read({ db, actor: admin })).metrics
  assert.equal(all.availablePoints, 10); assert.equal(all.memberCount, 0); assert.equal(all.pendingRedemptions, 1)
})

test('deletes and reassignment read current state and reverse the previous contribution once', async () => {
  const db = await fixture({ 'students/a': { branchId: 'a' }, 'students/b': { branchId: 'b' },
    'memberReferrals/r': { referrerStudentId: 'a', status: 'qualified' } })
  await backfill(db)
  await db.doc('memberReferrals/r').update({ referrerStudentId: 'b' })
  await sync({ db, collection: 'memberReferrals', id: 'r' })
  assert.equal((await read({ db, actor: staff('a') })).metrics.qualifiedReferrals, 0)
  assert.equal((await read({ db, actor: staff('b') })).metrics.qualifiedReferrals, 1)
  await db.doc('memberReferrals/r').delete()
  await Promise.all([sync({ db, collection: 'memberReferrals', id: 'r' }), sync({ db, collection: 'memberReferrals', id: 'r' })])
  assert.equal((await read({ db, actor: admin })).metrics.qualifiedReferrals, 0)
})

test('more than 1,000 members remain exact and reading a global overview costs five projection documents', async () => {
  const db = await fixture()
  for (let offset = 0; offset < 1010; offset += 400) {
    const batch = db.batch()
    for (let i = offset; i < Math.min(1010, offset + 400); i++) batch.set(db.doc(`students/s${i}`), { branchId: 'a' })
    await batch.commit()
  }
  await backfill(db)
  const reads = []
  const instrumented = { doc: path => ({ path, get: () => { reads.push(path); return db.doc(path).get() } }),
    getAll: (...refs) => { reads.push(...refs.map(ref => ref.path)); return db.getAll(...refs.map(ref => db.doc(ref.path))) },
    collection() { throw new Error('A global dashboard must never query source collections') } }
  const result = await read({ db: instrumented, actor: admin })
  assert.equal(result.metrics.memberCount, 1010)
  assert.equal(reads.length, 5)
  assert.equal((await read({ db, actor: staff('a') })).metrics.memberCount, 1010)
})

test('a branch beyond the old ten-branch cutoff is counted and unready summaries fail closed', async () => {
  const db = await fixture({ 'students/s': { branchId: 'branch-19' }, 'loyaltyAccounts/s': { availablePoints: 12 } })
  await backfill(db)
  const result = await read({ db, actor: staff(...Array.from({ length: 20 }, (_, i) => `branch-${i}`)) })
  assert.equal(result.metrics.availablePoints, 12)
  assert.equal((await read({ db, actor: staff() })).metrics.availablePoints, 0)
  await db.doc('loyaltyDashboardState/current').update({ status: 'building' })
  await assert.rejects(read({ db, actor: admin }), { code: 'unavailable' })
})

test('open redemption queue finds actionable requests beyond 300 fulfilled records without scanning them', async () => {
  const db = await fixture({ 'users/admin': { role: 'admin' }, 'students/s': { branchId: 'a' } })
  const batch = db.batch()
  for (let i = 0; i < 310; i++) batch.set(db.doc(`loyaltyRedemptions/a${i}`), { studentId: 's', status: 'fulfilled', branchId: 'a' })
  batch.set(db.doc('loyaltyRedemptions/zpending'), { studentId: 's', status: 'pending', branchId: 'a' })
  batch.set(db.doc('loyaltyRedemptions/zapproved'), { studentId: 's', status: 'approved', branchId: 'a' })
  await batch.commit()
  const handlers = createLoyaltyFunctions({ db, onCall: (_opts, handler) => handler })
  const result = await handlers.listLoyaltyRedemptions({ auth: { uid: 'admin', token: { role: 'admin' } }, data: { status: 'open' } })
  assert.deepEqual(result.redemptions.map(row => row.id).sort(), ['zapproved', 'zpending'])
})
