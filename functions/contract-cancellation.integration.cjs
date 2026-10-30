'use strict'

const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { readContractCancellationPlan, applyContractCancellationPlan } = require('./contract-cancellation')
const { createStudent360Functions, vietnamDateKey } = require('./student-360')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, 'contract-cancel-' + randomUUID())
const clients = []
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })
const cutoff = '2026-10-30'
const contract = { studentId: 'student', branchId: 'branch', packageId: 'package', packageName: 'Synthetic package', status: 'active', startDate: '2026-10-01', endDate: '2027-01-01', totalSessions: 12, usedSessions: 1, totalPrice: 1_200_000, paidAmount: 200_000, revision: 1 }
const session = (patch = {}) => ({ studentId: 'student', contractId: 'contract', branchId: 'branch', trainerId: 'trainer', date: '2026-10-31', hour: 8, status: 'scheduled', billingStatus: 'pending', revision: 2, ...patch })
const data = async (db, path) => (await db.doc(path).get()).data()

async function fixture(rows = {}) {
  const db = getFirestore(app, 'contract-cancel-' + randomUUID()); clients.push(db)
  const initial = {
    'users/admin': { role: 'admin', name: 'Synthetic admin' },
    'students/student': { name: 'Synthetic learner', branchId: 'branch', sessionsPerWeek: 2 },
    'branches/branch': { name: 'Synthetic branch' },
    'packages/package': { name: 'Synthetic package', branchId: 'branch', price: 1_200_000, totalSessions: 12, durationMonths: 3 },
    'contracts/contract': contract,
    ...rows,
  }
  const entries = Object.entries(initial)
  for (let offset = 0; offset < entries.length; offset += 400) {
    const batch = db.batch()
    for (const [path, value] of entries.slice(offset, offset + 400)) batch.set(db.doc(path), value)
    await batch.commit()
  }
  return db
}

async function cancelPlan(db) {
  return db.runTransaction(async transaction => {
    const reference = db.doc('contracts/contract'), snapshot = await transaction.get(reference)
    const plan = await readContractCancellationPlan({ transaction, db, contractId: 'contract', contract: snapshot.data(), cutoffDate: cutoff })
    const result = applyContractCancellationPlan({ transaction, plan, actorUid: 'admin', reason: 'Synthetic cancellation', contractId: 'contract' })
    transaction.update(reference, { status: 'cancelled' })
    return result
  })
}

test('real Firestore: cancellation atomically removes future uncharged sessions from both schedules and closes only related pending requests', async () => {
  const entry = { studentId: 'student', trainerId: 'trainer', scheduleEntryId: 'future-entry' }
  const other = { studentId: 'student', trainerId: 'trainer', scheduleEntryId: 'unrelated-entry' }
  const off = { ...entry, type: 'off' }
  const schedule = { 'T7-8': [entry, other, off] }
  const db = await fixture({
    'sessions/future': session({ scheduleEntryId: 'future-entry' }),
    'sessions/past': session({ date: '2026-10-29' }),
    'sessions/charged-cutoff': session({ date: cutoff, billingStatus: 'charged', countsTowardContract: true }),
    'sessions/another-contract': session({ contractId: 'another-contract' }),
    'ptScheduleDrafts/branch_2026-10-26': { schedule, revision: 4, status: 'published', publishedRevision: 4 },
    'schedules/schedule_2026-10-26': { schedule, draftRevision: 6 },
    'sessionRequests/by-contract': { studentId: 'student', contractId: 'contract', status: 'pending', revision: 1 },
    'sessionRequests/by-session': { studentId: 'student', sessionId: 'future', status: 'pending' },
    'sessionRequests/unrelated': { studentId: 'student', contractId: 'another-contract', status: 'pending' },
    'sessionRequests/approved': { studentId: 'student', contractId: 'contract', status: 'approved' },
    'leaveRequests/related': { studentId: 'student', contractId: 'contract', status: 'pending' },
    'leaveRequests/unrelated': { studentId: 'student', contractId: 'another-contract', status: 'pending' },
  })
  const protectedPaths = ['sessions/past', 'sessions/charged-cutoff', 'sessions/another-contract', 'sessionRequests/unrelated', 'sessionRequests/approved', 'leaveRequests/unrelated']
  const before = await Promise.all(protectedPaths.map(path => data(db, path)))
  assert.deepEqual(await cancelPlan(db), { cancelledSessionCount: 1, closedRequestCount: 3, removedScheduleEntryCount: 2 })
  const cancelled = await data(db, 'sessions/future')
  assert.equal(cancelled.status, 'student_cancelled')
  assert.equal(cancelled.billingStatus, 'exempt')
  assert.equal(cancelled.countsTowardContract, false)
  assert.equal(cancelled.revision, 3)
  assert.equal(cancelled.cancellationSource, 'contract_cancellation')
  assert.ok(cancelled.cancelledAt.toMillis() > 0)
  const draft = await data(db, 'ptScheduleDrafts/branch_2026-10-26')
  assert.deepEqual(draft.schedule['T7-8'], [other, off])
  assert.equal(draft.revision, 5)
  assert.equal(draft.publishedRevision, 5)
  assert.deepEqual((await data(db, 'schedules/schedule_2026-10-26')).schedule['T7-8'], [other, off])
  for (const path of ['sessionRequests/by-contract', 'sessionRequests/by-session', 'leaveRequests/related']) {
    const row = await data(db, path)
    assert.equal(row.status, 'rejected')
    assert.equal(row.rejectionSourceContractId, 'contract')
  }
  assert.deepEqual(await Promise.all(protectedPaths.map(path => data(db, path))), before)
  assert.equal((await data(db, 'contracts/contract')).paidAmount, 200_000)
  assert.equal((await db.collection('ledgerEntries').get()).size, 0)
})

for (const charged of [{ billingStatus: 'charged' }, { chargedAt: '2026-10-31T01:00:00Z' }, { revenueRecognitionEntryId: 'recognition' }, { status: 'completed' }, { status: 'no_show' }]) {
  test(`real Firestore: future charged evidence ${JSON.stringify(charged)} rejects without partial cancellation`, async () => {
    const db = await fixture({ 'sessions/uncharged': session(), 'sessions/charged': session(charged), 'sessionRequests/pending': { studentId: 'student', contractId: 'contract', status: 'pending' } })
    const paths = ['contracts/contract', 'sessions/uncharged', 'sessions/charged', 'sessionRequests/pending']
    const before = await Promise.all(paths.map(path => data(db, path)))
    await assert.rejects(cancelPlan(db), error => error.code === 'failed-precondition')
    assert.deepEqual(await Promise.all(paths.map(path => data(db, path))), before)
  })
}

for (const [collection, count] of [['sessions', 501], ['sessionRequests', 201], ['leaveRequests', 201]]) {
  test(`real Firestore: ${collection} read overflow rejects before any mutation`, async () => {
    const rows = Object.fromEntries(Array.from({ length: count }, (_, index) => [`${collection}/row-${index}`, collection === 'sessions' ? session() : { studentId: 'student', contractId: 'contract', status: 'pending' }]))
    const db = await fixture(rows), before = await data(db, 'contracts/contract')
    await assert.rejects(cancelPlan(db), error => error.code === 'resource-exhausted')
    assert.deepEqual(await data(db, 'contracts/contract'), before)
    assert.deepEqual(await data(db, `${collection}/row-0`), rows[`${collection}/row-0`])
  })
}

test('real Firestore: planned write overflow rejects without changing sessions or contract', async () => {
  const rows = Object.fromEntries(Array.from({ length: 401 }, (_, index) => [`sessions/row-${index}`, session()]))
  const db = await fixture(rows)
  await assert.rejects(cancelPlan(db), error => error.code === 'resource-exhausted')
  assert.equal((await data(db, 'contracts/contract')).status, 'active')
  assert.equal((await data(db, 'sessions/row-0')).status, 'scheduled')
})

test('real Firestore: actual contract callable preserves create ID on exact retry and rejects altered replay', async () => {
  const db = await fixture()
  await db.doc('contracts/contract').delete()
  const handlers = createStudent360Functions({ db, onCall: (_options, handler) => handler, logger: { info() {}, warn() {}, error() {} } })
  const input = { action: 'create', studentId: 'student', contractId: 'stable-created-id', contract: { packageId: 'package', branchId: 'branch', startDate: '2026-10-01', endDate: '2027-01-01', totalSessions: 12, totalPrice: 1_200_000, discount: 0, trainerIds: [], nutritionPTIds: [] } }
  const call = data => handlers.mutateStudent360Contract({ auth: { uid: 'admin', token: { role: 'admin' } }, data })
  const first = await call(input)
  assert.equal(first.contractId, input.contractId)
  assert.deepEqual(await call(input), first)
  assert.equal((await db.collection('contracts').get()).size, 1)
  assert.equal((await db.collection('contractAuditLogs').get()).size, 1)
  assert.equal((await data(db, `contracts/${input.contractId}`)).paidAmount, 0)
  await assert.rejects(call({ ...input, contract: { ...input.contract, totalPrice: 1_300_000 } }), error => error.code === 'already-exists')
  assert.equal((await data(db, `contracts/${input.contractId}`)).totalPrice, 1_200_000)
})

test('real Firestore: actual cancellation callable replays once, retains cash and flags legacy settlement review', async () => {
  const today = vietnamDateKey()
  const future = new Date(Date.parse(today + 'T12:00:00Z') + 86_400_000).toISOString().slice(0, 10)
  const db = await fixture({ 'sessions/future': session({ date: future }), 'sessionRequests/pending': { studentId: 'student', contractId: 'contract', status: 'pending' } })
  const handlers = createStudent360Functions({ db, onCall: (_options, handler) => handler, logger: { info() {}, warn() {}, error() {} } })
  const input = { studentId: 'student', contractId: 'contract', action: 'cancel', expectedRevision: 1, cutoffDate: today, reason: 'Synthetic agreed cancellation', cancelDebt: false }
  const call = data => handlers.mutateStudent360Contract({ auth: { uid: 'admin', token: { role: 'admin' } }, data })
  const first = await call(input), stored = await data(db, 'contracts/contract')
  assert.equal(stored.status, 'cancelled')
  assert.equal(stored.paidAmount, 200_000)
  assert.equal(stored.totalPrice, 1_200_000)
  assert.deepEqual(stored.cancellationSettlement, { schemaVersion: 1, status: 'review_required', revision: 0, cutoffDate: today })
  assert.equal((await data(db, 'sessions/future')).status, 'student_cancelled')
  assert.deepEqual(await call(input), first)
  assert.deepEqual(await data(db, 'contracts/contract'), stored)
  assert.equal((await db.collection('contractAuditLogs').get()).size, 1)
  assert.equal((await db.collection('contractMutationReceipts').get()).size, 1)
  assert.equal((await db.collection('ledgerEntries').get()).size, 0)
  await assert.rejects(call({ ...input, reason: 'Altered replay' }), error => error.code === 'already-exists')
})
