'use strict'
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { createSessionOperationFunctions } = require('./session-operations')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `admin-off-${randomUUID()}`)
const clients = []
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })
const baseContract = { studentId: 'student', branchId: 'branch', status: 'active', packageId: 'package', startDate: '2026-10-01', endDate: '2026-12-31', totalSessions: 36, usedSessions: 5, revision: 0 }
const input = patch => ({ action: 'create', contractId: 'contract', startDate: '2026-10-26', endDate: '2026-10-28', reason: 'Công tác', idempotencyKey: randomUUID(), expectedContractRevision: 0, ...patch })
const data = async (db, path) => (await db.doc(path).get()).data()
async function fixture(rows = {}) {
  const db = getFirestore(app, `admin-off-${randomUUID()}`); clients.push(db)
  const batch = db.batch()
  for (const [path, value] of Object.entries({
    'users/admin': { role: 'admin' }, 'users/manager': { role: 'manager' }, 'users/student': { role: 'student' },
    'students/student': { name: 'Học viên kiểm tra' }, 'packages/package': { durationMonths: 3 },
    'contracts/contract': baseContract, ...rows,
  })) batch.set(db.doc(path), value)
  await batch.commit()
  return db
}
function callFor(db, uid = 'admin') {
  const api = createSessionOperationFunctions({ db, onCall: handler => handler, now: () => new Date('2026-10-23T02:00:00Z') })
  return command => api.manageStudentOff({ auth: { uid, token: { role: uid } }, data: command })
}

test('real authorization denies manager/student and allows admin context without mutation', async () => {
  const db = await fixture()
  for (const role of ['manager', 'student']) await assert.rejects(callFor(db, role)(input()), { code: 'permission-denied' })
  const context = await callFor(db)({ action: 'context', contractId: 'contract' })
  assert.equal(context.policy.offLimit, 2)
  assert.equal(context.contractRevision, 0)
  assert.equal((await db.collection('leaveRequests').get()).size, 0)
})

test('concurrent replay creates one OFF and one extension; separate commands serialize on contract revision', async () => {
  const db = await fixture(), call = callFor(db), command = input()
  const results = await Promise.all([call(command), call(structuredClone(command))])
  assert.equal(results[0].requestId, results[1].requestId)
  assert.equal(results.filter(item => !item.unchanged).length, 1)
  assert.equal((await data(db, 'contracts/contract')).endDate, '2027-01-03')
  assert.equal((await db.collection('leaveRequests').get()).size, 1)
  assert.equal((await db.collection('contractPauseEvents').get()).size, 1)
  const other = [input({ startDate: '2026-11-02', endDate: '2026-11-03', expectedContractRevision: 1 }), input({ startDate: '2026-11-09', endDate: '2026-11-10', expectedContractRevision: 1 })]
  const settled = await Promise.allSettled(other.map(call))
  assert.equal(settled.filter(item => item.status === 'fulfilled').length, 1)
  assert.equal(settled.find(item => item.status === 'rejected').reason.code, 'aborted')
  assert.equal((await data(db, 'contracts/contract')).endDate, '2027-01-05')
})

test('date corrections adjust only the delta and synchronize the automatic renewal with immutable events', async () => {
  const db = await fixture({
    'contracts/contract': { ...baseContract, renewedByContractId: 'next' },
    'contracts/next': { studentId: 'student', branchId: 'branch', sourceContractId: 'contract', status: 'future', activationMode: 'automatic', signedDate: '2026-10-23', startDate: '2027-01-01', plannedActivationDate: '2027-01-01', endDate: '2027-04-01', revision: 0 },
  }), call = callFor(db)
  const first = await call(input())
  assert.equal((await data(db, 'contracts/next')).startDate, '2027-01-04')
  const command = input({ action: 'edit', requestId: first.requestId, expectedRevision: first.revision, expectedContractRevision: 1, endDate: '2026-10-30' })
  const edited = await call(command)
  assert.equal(edited.deltaDays, 2)
  assert.equal((await data(db, 'contracts/next')).startDate, '2027-01-06')
  const short = await call(input({ action: 'edit', requestId: first.requestId, expectedRevision: edited.revision, expectedContractRevision: 2, endDate: '2026-10-26' }))
  assert.equal(short.deltaDays, -4)
  const contract = await data(db, 'contracts/contract')
  assert.equal(contract.endDate, '2027-01-01')
  assert.equal(contract.usedSessions, 5)
  assert.equal(contract.pausePeriods.length, 1)
  assert.equal((await data(db, 'contracts/next')).startDate, '2027-01-02')
  assert.equal((await db.collection('contractPauseEvents').get()).size, 3)
  assert.equal((await call(command)).unchanged, true)
  assert.equal((await data(db, 'contracts/contract')).endDate, '2027-01-01')
})

test('schedule removal, session cancellation and request rejection commit together and rollback if audit fails', async () => {
  const entry = { studentId: 'student', trainerId: 'trainer', branchId: 'branch', type: 'training' }
  const rows = {
    'sessions/session': { studentId: 'student', contractId: 'contract', trainerId: 'trainer', branchId: 'branch', date: '2026-10-27', hour: 18, status: 'scheduled', scheduleWeekId: '2026-10-26', slotId: 'T3-18', revision: 2 },
    'sessionRequests/change': { studentId: 'student', contractId: 'contract', sessionId: 'session', status: 'pending' },
    'ptScheduleDrafts/branch_2026-10-26': { branchId: 'branch', weekId: '2026-10-26', status: 'published', revision: 2, publishedRevision: 2, schedule: { 'T3-18': [entry] } },
    'schedules/schedule_2026-10-26': { draftRevision: 2, schedule: { 'T3-18': [entry] } },
  }
  const db = await fixture(rows)
  const failing = new Proxy(db, { get(target, key) {
    if (key === 'runTransaction') return work => target.runTransaction(tx => work(new Proxy(tx, { get(transaction, method) {
      if (method === 'create') return (ref, value) => { if (ref.path.startsWith('contractPauseEvents/')) throw new Error('Audit unavailable'); return transaction.create(ref, value) }
      return typeof transaction[method] === 'function' ? transaction[method].bind(transaction) : transaction[method]
    } })))
    return typeof target[key] === 'function' ? target[key].bind(target) : target[key]
  } })
  const command = input()
  await assert.rejects(callFor(failing)(command), /Audit unavailable/)
  assert.equal((await data(db, 'contracts/contract')).endDate, '2026-12-31')
  assert.equal((await data(db, 'sessions/session')).status, 'scheduled')
  assert.equal((await data(db, 'sessionRequests/change')).status, 'pending')
  assert.ok((await data(db, 'ptScheduleDrafts/branch_2026-10-26')).schedule['T3-18'])
  assert.equal((await db.collection('leaveRequests').get()).size, 0)
  const result = await callFor(db)(command)
  assert.equal(result.cancelledSessionCount, 1)
  assert.equal((await data(db, 'sessions/session')).billingStatus, 'exempt')
  assert.equal((await data(db, 'sessionRequests/change')).status, 'rejected')
  assert.deepEqual((await data(db, 'ptScheduleDrafts/branch_2026-10-26')).schedule, {})
  assert.deepEqual((await data(db, 'schedules/schedule_2026-10-26')).schedule, {})
})
