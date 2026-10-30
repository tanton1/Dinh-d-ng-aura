'use strict'
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { directoryValue, readLoyaltyMemberPage, syncLoyaltyMemberDirectory } = require('./loyalty-member-directory')
const { createLoyaltyFunctions } = require('./loyalty')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `loyalty-directory-${randomUUID()}`)
const clients = []
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })
const membership = { managed: true, active: true, state: 'active', manageUntil: '2100-01-01', activeUntil: '2099-12-31' }
async function fixture(count = 1001) {
  const db = getFirestore(app, `member-directory-${randomUUID()}`); clients.push(db)
  const documents = [['loyaltyDirectoryState/current', { schemaVersion: 2, status: 'ready' }], ['users/admin', { role: 'admin' }], ['users/staff', { role: 'manager' }], ['roleAssignments/staff', { accessRole: 'staff', positions: ['branch_manager'], branchIds: ['a'], authzVersion: 1, status: 'active' }]]
  for (let i = 0; i < count; i++) {
    const id = `s${String(i).padStart(4, '0')}`
    const student = { name: i === 1000 ? 'Phạm Đỗ Mai' : `Thành viên ${i}`, branchId: i % 2 ? 'b' : 'a', loyaltyMembership: membership }
    const wallet = { tierQualifyingValue: i % 3 === 0 ? 25_000_000 : 0 }
    documents.push([`students/${id}`, student], [`loyaltyAccounts/${id}`, wallet], [`loyaltyMemberDirectory/${id}`, directoryValue(id, student, wallet)])
  }
  for (let i = 0; i < documents.length; i += 400) { const batch = db.batch(); for (const [path, value] of documents.slice(i, i + 400)) batch.set(db.doc(path), value); await batch.commit() }
  return db
}

test('1001 members have exact tier counts and bounded explicit pages; search finds a member beyond page one', async () => {
  const db = await fixture()
  const actor = { uid: 'admin', accessRole: 'admin', branchIds: [] }
  const first = await readLoyaltyMemberPage({ db, actor, data: { pageSize: 30 } })
  assert.equal(first.ids.length, 30); assert.equal(first.totalCount, 1001); assert.equal(first.tierCounts.gold, 334)
  assert.equal(first.hasMore, true)
  const second = await readLoyaltyMemberPage({ db, actor, data: { pageSize: 30, cursor: first.nextCursor, includeTotal: false } })
  assert.equal(second.ids.length, 30); assert.equal(second.totalCount, null); assert.equal(second.tierCounts, undefined)
  assert.equal(first.ids.filter(id => second.ids.includes(id)).length, 0)
  const found = await readLoyaltyMemberPage({ db, actor, data: { query: 'do mai' } })
  assert.deepEqual(found.ids, ['s1000']); assert.equal(found.totalCount, 1)
  const scoped = await readLoyaltyMemberPage({ db, actor: { uid: 'staff', accessRole: 'staff', branchIds: ['a'] }, data: { tier: 'gold' } })
  assert.equal(scoped.totalCount, 167); assert.equal(scoped.tierCounts.member, 334)
  assert.ok(scoped.ids.every(id => Number(id.slice(1)) % 2 === 0))
})

test('event replay converges to current source; moving a member cannot expose a stale branch wallet', async () => {
  const db = await fixture(2)
  await db.doc('students/s0000').update({ branchId: 'b' })
  const walletsRead = []
  const facade = { doc: path => db.doc(path), collection: name => db.collection(name), getAll: (...refs) => { walletsRead.push(...refs.filter(ref => ref.path.startsWith('loyaltyAccounts/')).map(ref => ref.path)); return db.getAll(...refs) } }
  const handlers = createLoyaltyFunctions({ db: facade, onCall: (_options, handler) => handler })
  const result = await handlers.listLoyaltyAccounts({ auth: { uid: 'staff', token: { accessRole: 'staff', authzVersion: 1 } }, data: { directoryVersion: 2 } })
  assert.deepEqual(result.accounts, []); assert.equal(result.directoryStale, true); assert.equal(result.totalCount, null)
  assert.deepEqual(walletsRead, [])
  const synced = await Promise.all([syncLoyaltyMemberDirectory({ db, studentId: 's0000' }), syncLoyaltyMemberDirectory({ db, studentId: 's0000' })])
  assert.equal(synced.filter(item => item.changed).length, 1)
  assert.equal((await db.doc('loyaltyMemberDirectory/s0000').get()).data().branchId, 'b')
  await db.doc('students/s0000').delete()
  await syncLoyaltyMemberDirectory({ db, studentId: 's0000' })
  assert.equal((await db.doc('loyaltyMemberDirectory/s0000').get()).exists, false)
})

test('new directory fails closed until backfill is ready, exact deep links remain available', async () => {
  const db = await fixture(2)
  await db.doc('loyaltyDirectoryState/current').delete()
  const handlers = createLoyaltyFunctions({ db, onCall: (_options, handler) => handler })
  const auth = { uid: 'admin', token: { role: 'admin' } }
  await assert.rejects(handlers.listLoyaltyAccounts({ auth, data: { directoryVersion: 2 } }), { code: 'unavailable' })
  const found = await handlers.listLoyaltyAccounts({ auth, data: { directoryVersion: 2, studentId: 's0001' } })
  assert.equal(found.schemaVersion, 2); assert.equal(found.accounts.length, 1)
  const missing = await handlers.listLoyaltyAccounts({ auth, data: { directoryVersion: 2, studentId: 'missing' } })
  assert.equal(missing.schemaVersion, 2); assert.equal(missing.totalCount, 0)
})
