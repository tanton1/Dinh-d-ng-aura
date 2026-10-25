'use strict'
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { test, after } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { refreshRenewalQueueCore, prepareRenewalCaseCore } = require('./contract-renewals')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `renewal-queue-${randomUUID()}`)
const clients = []
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const actor = { uid: 'admin', renewalScope: 'system', renewalCanSell: true, renewalCanViewSalesCases: true, branchIds: [] }
async function fixture() {
  const db = getFirestore(app, `renewal-${randomUUID()}`)
  clients.push(db)
  const ref = db.doc('contractRenewalCases/z-contract')
  const batch = db.batch()
  batch.set(db.doc('contracts/z-contract'), { studentId: 'z-student', status: 'active', startDate: '2025-01-01', endDate: today, totalSessions: 12, usedSessions: 11, totalPrice: 1200, packageId: 'package', branchId: 'branch' })
  batch.set(db.doc('students/z-student'), { name: 'Member', status: 'active', branchId: 'branch' })
  batch.set(db.doc('packages/package'), { name: 'Package', price: 1200 })
  batch.set(db.doc('branches/branch'), { name: 'Branch' })
  batch.set(ref, { sourceContractId: 'z-contract', studentId: 'z-student', active: true, stage: 'contacted', revision: 3, note: 'Original', quoteId: 'quote-old', approvalId: 'approval-old' })
  await batch.commit()
  return { db, ref }
}
const refresh = db => refreshRenewalQueueCore({ db, dryRun: false })
function beforeFirstTransaction(db, mutate) {
  let pending = true
  return new Proxy(db, { get(target, key) {
    if (key === 'runTransaction') return async (...args) => {
      if (pending) { pending = false; await mutate() }
      return target.runTransaction(...args)
    }
    const value = target[key]
    return typeof value === 'function' ? value.bind(target) : value
  } })
}

test('opening the same wizard leaves the case and revision untouched until business data changes', async () => {
  const { db, ref } = await fixture()
  const prepare = () => prepareRenewalCaseCore({ db, actor, sourceContractId: 'z-contract' })
  const first = await prepare()
  const before = await ref.get()
  const second = await prepare()
  assert.equal(second.revision, first.revision)
  assert.equal((await ref.get()).updateTime.isEqual(before.updateTime), true)
  await db.doc('students/z-student').update({ name: 'Updated member' })
  const changed = await prepare()
  assert.equal(changed.revision, first.revision + 1)
  assert.equal(changed.studentSnapshot.name, 'Updated member')
  assert.equal(changed.note, 'Original')
})

test('a Sales win after the inventory scan cannot be reopened or overwritten', async () => {
  const { db, ref } = await fixture()
  const result = await refresh(beforeFirstTransaction(db, () => ref.update({ stage: 'won', active: false, revision: 4, note: 'Signed', quoteId: 'quote-won' })))
  assert.equal(result.plannedWrites, 1)
  assert.equal(result.appliedWrites, 0)
  const value = (await ref.get()).data()
  assert.equal(value.stage, 'won')
  assert.equal(value.revision, 4)
  assert.equal(value.note, 'Signed')
  assert.equal(value.quoteId, 'quote-won')
})

test('refresh preserves concurrently edited stage, note, quote, approval and follow-up; replay writes nothing', async () => {
  const { db, ref } = await fixture()
  const edits = { stage: 'quote_sent', note: 'Sales update', quoteId: 'quote-new', approvalId: 'approval-new', approvalStatus: 'approved', nextActionAt: '2027-01-01', revision: 8 }
  const result = await refresh(beforeFirstTransaction(db, () => ref.update(edits)))
  assert.equal(result.appliedWrites, 1)
  const value = (await ref.get()).data()
  for (const key of Object.keys(edits).filter(key => key !== 'revision')) assert.deepEqual(value[key], edits[key])
  assert.equal(value.revision, 9)
  const before = await ref.get()
  assert.equal((await refresh(db)).appliedWrites, 0)
  assert.equal((await ref.get()).updateTime.isEqual(before.updateTime), true)
})

test('new follow-on contracts are rechecked before the old case can stay active', async () => {
  const { db, ref } = await fixture()
  await refresh(beforeFirstTransaction(db, () => db.doc('contracts/follow-on').set({ studentId: 'z-student', status: 'future', startDate: today, endDate: '2099-01-01' })))
  const value = (await ref.get()).data()
  assert.equal(value.active, false)
  assert.equal(value.note, 'Original')
  assert.equal(value.quoteId, 'quote-old')
})

test('complete paginated inventories include contracts, cases and students after 5,000 documents', async () => {
  const { db, ref } = await fixture()
  for (let offset = 0; offset < 5000; offset += 125) {
    const batch = db.batch()
    for (let index = offset; index < offset + 125; index++) {
      const id = `a-${String(index).padStart(5, '0')}`
      batch.set(db.doc(`contracts/${id}`), { status: 'cancelled' })
      batch.set(db.doc(`students/${id}`), { status: 'inactive' })
      batch.set(db.doc(`contractRenewalCases/${id}`), { active: false, stage: 'won' })
    }
    await batch.commit()
  }
  const result = await refresh(db)
  assert.equal(result.contractsScanned, 5001)
  assert.equal(result.casesScanned, 5001)
  assert.equal(result.truncated, false)
  assert.equal(result.appliedWrites, 1)
  assert.equal((await ref.get()).data().active, true)
  assert.equal((await ref.get()).data().studentSnapshot.name, 'Member')

  // A failed later page must not cause absence-based cleanup or any writes.
  const before = await ref.get()
  const faulted = new Proxy(db, { get(target, key) {
    if (key === 'collection') return path => {
      const wrap = (query, afterCursor = false) => new Proxy(query, { get(q, method) {
        if (method === 'get') return () => {
          if (afterCursor) throw new Error('page unavailable')
          return q.get()
        }
        const value = q[method]
        if (['orderBy', 'limit', 'startAfter'].includes(method)) return (...args) => wrap(value.apply(q, args), afterCursor || method === 'startAfter')
        return typeof value === 'function' ? value.bind(q) : value
      } })
      return path === 'contracts' ? wrap(target.collection(path)) : target.collection(path)
    }
    const value = target[key]
    return typeof value === 'function' ? value.bind(target) : value
  } })
  await assert.rejects(refresh(faulted), /page unavailable/)
  assert.equal((await ref.get()).updateTime.isEqual(before.updateTime), true)
})
