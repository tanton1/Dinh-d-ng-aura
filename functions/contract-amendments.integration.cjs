'use strict'
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { createStudent360Functions, vietnamDateKey } = require('./student-360')
const { chargeSessionTransaction } = require('./session-operations')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(localhost|127\.0\.0\.1):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `amend-${randomUUID()}`), clients = []
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })
const today = vietnamDateKey(), day = n => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const logger = { info() {}, warn() {}, error() {} }
const read = async (db, path) => (await db.doc(path).get()).data()
const callFor = db => {
  const api = createStudent360Functions({ db, onCall: (_options, handler) => handler, logger })
  return (data, uid = 'admin') => api.mutateStudent360Contract({ auth: { uid, token: { role: uid === 'admin' ? 'admin' : 'student' } }, data })
}
async function fixture(extra = {}) {
  const db = getFirestore(app, `amend-${randomUUID()}`); clients.push(db)
  const rows = {
    'settings/contractAmendments': { enabled: true, allocationVersion: 2 },
    'users/admin': { role: 'admin', name: 'Admin' }, 'users/student': { role: 'student', studentId: 'student' },
    'students/student': { name: 'Test learner', branchId: 'branch' }, 'branches/branch': { name: 'Branch' },
    'packages/six': { name: '6 tháng', branchId: 'branch', price: 18000000, totalSessions: 72, durationMonths: 6 },
    'packages/three': { name: '3 tháng', branchId: 'branch', price: 10800000, totalSessions: 36, durationMonths: 3 },
    'contracts/contract': { studentId: 'student', branchId: 'branch', packageId: 'six', packageName: '6 tháng', status: 'active',
      totalSessions: 72, usedSessions: 24, totalPrice: 18000000, discount: 0, paidAmount: 12000000, startDate: day(-60), signedAt: day(-60), endDate: day(120), revision: 1,
      installments: [{ id: 'paid', amount: 12000000, status: 'paid', date: day(-60) }, { id: 'pending', amount: 6000000, status: 'pending', date: day(15) }] },
    'ledgerEntries/payment': { type: 'payment', source: 'pt_gym', status: 'posted', contractId: 'contract', cashImpact: 12000000, amount: 12000000 },
  }
  for (let n = 0; n < 24; n++) {
    const session = { studentId: 'student', trainerId: 'trainer', branchId: 'branch', contractId: 'contract', date: day(-30 + n), hour: 8,
      status: 'attended', billingStatus: 'charged', serviceOrdinal: n + 1, revision: 1 }
    rows[`sessions/s${n}`] = session
    rows[`sessionBillingEvents/s${n}`] = { ...session, sessionId: `s${n}` }
    rows[`ledgerEntries/pt_session_s${n}`] = { type: 'revenue_recognition', status: 'posted', source: 'pt_gym', contractId: 'contract', studentId: 'student',
      sessionId: `s${n}`, serviceOrdinal: n + 1, revenueImpact: 250000, cashImpact: 0, amount: 250000 }
  }
  const batch = db.batch(); for (const [path, value] of Object.entries({ ...rows, ...extra })) batch.set(db.doc(path), value); await batch.commit()
  return db
}
const previewInput = () => ({ action: 'preview_amendment', studentId: 'student', contractId: 'contract', expectedRevision: 1,
  contract: { packageId: 'three', totalSessions: 36, totalPrice: 10800000, discount: 0, endDate: day(30) } })
const command = preview => ({ ...previewInput(), action: 'amend', expectedRevision: preview.revision, snapshotHash: preview.snapshotHash,
  reason: 'Thỏa thuận hạ gói', cancelAffectedBookings: false })

test('preview makes no financial writes; confirmation is atomic and replay safe; next charge uses revised unit', async () => {
  const db = await fixture(), call = callFor(db), before = await read(db, 'contracts/contract')
  const originalLedger = (await db.collection('ledgerEntries').get()).docs.map(doc => [doc.id, doc.data()])
  const { preview } = await call(previewInput())
  assert.deepEqual(preview.blockers, []); assert.equal(preview.after.refundDue, 1200000)
  assert.deepEqual(await read(db, 'contracts/contract'), before)
  assert.equal((await db.collection('contractAmendments').get()).size, 0)
  const input = command(preview)
  const results = await Promise.all([call(input), call(input)])
  assert.deepEqual(results[0], results[1]); assert.deepEqual(await call(input), results[0])
  const updated = await read(db, 'contracts/contract')
  assert.equal(updated.totalSessions, 36); assert.equal(updated.usedSessions, 24)
  assert.equal(updated.paidAmount, 12000000); assert.equal(updated.totalPrice, 10800000)
  assert.deepEqual(updated.installments, [before.installments[0]])
  assert.equal(updated.salesOriginalSnapshot.netAmount, 18000000)
  assert.equal(updated.amendmentHistory.length, 1)
  assert.equal((await db.collection('contractAmendments').get()).size, 1)
  for (const [id, value] of originalLedger) assert.deepEqual(await read(db, `ledgerEntries/${id}`), value)
  const adjustment = await read(db, 'ledgerEntries/contract-amend-2')
  assert.equal(adjustment.contractSalesImpact, -7200000); assert.equal(adjustment.cashImpact, 0); assert.equal(adjustment.revenueImpact, 0)
  await db.doc('sessions/new').set({ studentId: 'student', trainerId: 'trainer', branchId: 'branch', contractId: 'contract',
    date: day(-1), hour: 8, status: 'scheduled', billingStatus: 'pending', revision: 0 })
  await chargeSessionTransaction({ db, sessionId: 'new', expectedRevision: 0, actorUid: 'admin', now: new Date() })
  assert.equal((await read(db, 'ledgerEntries/pt_session_new')).amount, 400000)
  assert.equal((await read(db, 'journalEntries/pt_session_new')).totalDebit, 400000)
  assert.equal((await read(db, 'contracts/contract')).usedSessions, 25)
  await call({ action: 'edit', studentId: 'student', contractId: 'contract', expectedRevision: 3, contract: {
    packageId: 'three', branchId: 'branch', startDate: before.startDate, endDate: day(30), trainerIds: [], nutritionPTIds: [], note: 'Đang chờ hoàn tiền' } })
  assert.equal((await read(db, 'contracts/contract')).note, 'Đang chờ hoàn tiền')
  assert.equal((await read(db, 'contracts/contract')).paidAmount, 12000000)
})

test('cash changes after preview, unauthorized actors and mismatched replay cannot amend', async () => {
  const db = await fixture(), call = callFor(db), input = previewInput()
  await assert.rejects(call(input, 'student'))
  const { preview } = await call(input)
  await db.doc('ledgerEntries/late-payment').set({ type: 'payment', contractId: 'contract', cashImpact: 100000, status: 'posted' })
  await db.doc('contracts/contract').update({ paidAmount: 12100000 })
  await assert.rejects(call(command(preview)), error => error.code === 'aborted')
  assert.equal((await db.collection('contractAmendments').get()).size, 0)
  const fresh = (await call(input)).preview
  await call(command(fresh))
  await assert.rejects(call({ ...command(fresh), reason: 'Nội dung khác' }), error => error.code === 'already-exists')
})

test('bookings beyond reduced term require explicit acknowledgement and close atomically', async () => {
  const db = await fixture({ 'sessions/future': { studentId: 'student', trainerId: 'trainer', branchId: 'branch', contractId: 'contract',
    status: 'scheduled', billingStatus: 'pending', date: day(50), hour: 8, revision: 0 },
    'sessionRequests/request': { studentId: 'student', contractId: 'contract', sessionId: 'future', status: 'pending', revision: 0 } })
  const call = callFor(db), { preview } = await call(previewInput())
  assert.equal(preview.affectedBookings.length, 1)
  await assert.rejects(call(command(preview)), error => error.code === 'failed-precondition')
  assert.equal((await read(db, 'sessions/future')).status, 'scheduled')
  await call({ ...command(preview), cancelAffectedBookings: true })
  assert.equal((await read(db, 'sessions/future')).billingStatus, 'exempt')
  assert.equal((await read(db, 'sessionRequests/request')).status, 'rejected')
})

test('locked current period, missing recognized session and injected write failure leave contract intact', async () => {
  const db = await fixture(), call = callFor(db), original = await read(db, 'contracts/contract')
  await db.doc(`financePeriods/${today.slice(0, 7)}`).set({ status: 'locked' })
  assert.ok((await call(previewInput())).preview.blockers.some(message => message.includes('đã khóa')))
  await db.doc(`financePeriods/${today.slice(0, 7)}`).set({ status: 'open' })
  const { preview } = await call(previewInput())
  const broken = new Proxy(db, { get(target, key) {
    if (key === 'runTransaction') return fn => target.runTransaction(tx => fn(new Proxy(tx, { get(inner, member) {
      if (member === 'create') return (ref, data) => { if (ref.path.startsWith('ledgerEntries/')) throw Error('Synthetic posting failure'); return inner.create(ref, data) }
      return typeof inner[member] === 'function' ? inner[member].bind(inner) : inner[member]
    } })))
    return typeof target[key] === 'function' ? target[key].bind(target) : target[key]
  } })
  await assert.rejects(callFor(broken)(command(preview)), /Synthetic posting failure/)
  assert.deepEqual(await read(db, 'contracts/contract'), original)
  assert.equal((await db.collection('contractAmendments').get()).size, 0)
  await db.doc('ledgerEntries/pt_session_s0').delete()
  assert.ok((await call(previewInput())).preview.blockers.some(message => message.includes('chưa khớp doanh thu')))
})
