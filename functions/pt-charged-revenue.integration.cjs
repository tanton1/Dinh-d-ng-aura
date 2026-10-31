'use strict'
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { chargeSessionTransaction, recordSessionAttendanceTransaction, assertCancellationEvidenceChange } = require('./session-operations')
const { returnChargedSession } = require('./pt-session-return')
const { renewalRevenueAllocation, allocationForOrdinal } = require('./pt-revenue-allocation')
const { readContractRecognitionState } = require('./finance-recognition-balance')
const { repairOne, repairPostedOrdinal, evidenceHash } = require('../scripts/firebase-pt-charged-revenue-repair.cjs')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(localhost|127\.0\.0\.1):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, 'charged-revenue-' + randomUUID()), clients = []
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })
const read = async (db, path) => (await db.doc(path).get()).data()
const now = new Date('2026-10-31T01:00:00Z')
const session = (id, contractId = 'contract', date = '2026-10-20') => ({ studentId: 'student', trainerId: 'trainer', branchId: 'branch',
  contractId, date, hour: 8, status: 'scheduled', billingStatus: 'pending', revision: 0 })
async function fixture(extra = {}) {
  const db = getFirestore(app, 'charged-revenue-' + randomUUID()); clients.push(db)
  const seed = { 'contracts/contract': { studentId: 'student', status: 'active', totalSessions: 36, usedSessions: 0,
    totalPrice: 9600000, discount: 0, paidAmount: 9600000, startDate: '2026-10-01', endDate: '2027-01-01' },
    'sessions/one': session('one'), ...extra }
  const batch = db.batch(); for (const [path, data] of Object.entries(seed)) batch.set(db.doc(path), data); await batch.commit()
  return db
}
const charge = (db, sessionId = 'one') => chargeSessionTransaction({ db, sessionId, expectedRevision: 0, actorUid: 'system', now })
const confirm = (db, confirmationSource, expectedRevision = 1) => recordSessionAttendanceTransaction({ db, sessionId: 'one',
  actorUid: 'trainer', expectedRevision, attendanceStatus: 'present', confirmationSource, now })
const giveBack = db => returnChargedSession({ db, sessionId: 'one', expectedRevision: 1, actorUid: 'admin', reason: 'Synthetic correction', assertCancellationEvidenceChange })

test('concurrent deduction posts once before attendance; later automatic/manual confirmation cannot post twice, even after the period closes', async () => {
  const db = await fixture()
  const results = await Promise.all([charge(db), charge(db)])
  assert.equal(results.filter(r => !r.unchanged).length, 1)
  assert.equal((await read(db, 'contracts/contract')).usedSessions, 1)
  assert.equal((await read(db, 'attendanceEvents/one')).attendanceStatus, 'pending')
  const original = await read(db, 'ledgerEntries/pt_session_one')
  assert.equal(original.revenueImpact, 266667); assert.equal(original.cashImpact, 0)
  assert.equal((await read(db, 'journalEntries/pt_session_one')).totalDebit, 266667)
  await db.doc('financePeriods/2026-10').set({ status: 'locked' })
  await confirm(db, 'auto_after_48h')
  await confirm(db, 'manual', 2)
  assert.deepEqual(await read(db, 'ledgerEntries/pt_session_one'), original)
  assert.equal((await read(db, 'sessions/one')).recognitionReviewRequired, false)
  assert.equal((await db.collection('ledgerEntries').get()).size, 1)
})

test('journal failure and locked/invalid-value contracts cannot partially deduct an entitlement', async () => {
  const db = await fixture()
  const broken = { doc: db.doc.bind(db), collection: db.collection.bind(db), runTransaction: fn => db.runTransaction(tx => fn(new Proxy(tx, {
    get(target, key) { if (key === 'create') return (ref, data) => { if (ref.path.startsWith('journalEntries/')) throw Error('Synthetic journal failure'); return target.create(ref, data) }; return typeof target[key] === 'function' ? target[key].bind(target) : target[key] },
  }))) }
  await assert.rejects(charge(broken), /Synthetic journal failure/)
  for (const [path, patch, issue] of [
    ['financePeriods/2026-10', { status: 'locked' }, 'FINANCE_PERIOD_LOCKED'],
    ['financePeriods/2026-10', { status: 'open' }, null],
    ['contracts/contract', { totalPrice: null }, 'RECOGNITION_CONTRACT_VALUE_INVALID'],
  ]) {
    await db.doc(path).set(patch, { merge: true })
    if (issue) await assert.rejects(charge(db), error => error.details?.issueCode === issue)
  }
  assert.equal((await read(db, 'contracts/contract')).usedSessions, 0)
  assert.equal((await read(db, 'sessions/one')).billingStatus, 'pending')
  assert.equal((await db.collection('ledgerEntries').get()).size, 0)
  assert.equal((await db.collection('sessionBillingEvents').get()).size, 0)
})

test('carried credits retain original seller and rounding, then new credits use the purchased package denominator', async () => {
  const source = { studentId: 'student', status: 'expired', totalSessions: 36, usedSessions: 33,
    totalPrice: 9600000, discount: 600000, paidAmount: 9000000 }
  const next = { studentId: 'student', status: 'active', sourceContractId: 'source', totalSessions: 39, packageSessions: 36,
    carriedOverSessions: 3, usedSessions: 0, totalPrice: 9600000, discount: 0, paidAmount: 9600000,
    startDate: '2026-10-01', endDate: '2027-01-01' }
  next.revenueAllocation = renewalRevenueAllocation({ sourceId: 'source', source, nextId: 'next', next, carriedOverSessions: 3 })
  const db = await fixture({ 'contracts/source': { ...source, carryOverTransferredSessions: 3 }, 'contracts/next': next,
    ...Object.fromEntries(Array.from({ length: 4 }, (_, n) => [`sessions/carry-${n}`, session(`carry-${n}`, 'next', `2026-10-${20 + n}`)])) })
  for (let n = 0; n < 4; n++) await charge(db, `carry-${n}`)
  for (let n = 0; n < 3; n++) {
    const entry = await read(db, `ledgerEntries/pt_session_carry-${n}`)
    assert.equal(entry.contractId, 'source'); assert.equal(entry.entitlementContractId, 'next')
    assert.equal(entry.serviceOrdinal, 34 + n); assert.equal(entry.entitlementOrdinal, n + 1); assert.equal(entry.revenueImpact, 250000)
  }
  const own = await read(db, 'ledgerEntries/pt_session_carry-3')
  assert.equal(own.contractId, 'next'); assert.equal(own.serviceOrdinal, 1); assert.equal(own.entitlementOrdinal, 4)
  assert.equal(own.revenueImpact, 266667); assert.equal(own.serviceTotal, 36)
  assert.equal((await read(db, 'contracts/source')).usedSessions, 33)
  assert.equal((await read(db, 'contracts/next')).usedSessions, 4)
  const third = { studentId: 'student', packageSessions: 12, totalSessions: 14, totalPrice: 3600000, discount: 0 }
  third.revenueAllocation = renewalRevenueAllocation({ sourceId: 'next', source: { ...next, usedSessions: 1 }, nextId: 'third', next: third, carriedOverSessions: 2 })
  assert.equal(allocationForOrdinal('third', third, 1).contractId, 'source')
  assert.equal(allocationForOrdinal('third', third, 1).serviceOrdinal, 35)
  assert.equal(allocationForOrdinal('third', third, 3).contractId, 'third')
})

test('concurrent return reverses exactly the original posting and releases its share without touching cash or confirmation', async () => {
  const db = await fixture({ 'payrollRuns/2026-10': { status: 'draft' } })
  await charge(db)
  const before = await read(db, 'attendanceEvents/one')
  const results = await Promise.all([giveBack(db), giveBack(db)])
  assert.equal(results.filter(r => !r.unchanged).length, 1)
  const original = await read(db, 'ledgerEntries/pt_session_one'), reversal = await read(db, 'ledgerEntries/pt_return_one')
  assert.equal(original.status, 'reversed'); assert.equal(original.revenueImpact + reversal.revenueImpact, 0)
  assert.equal(original.receivableImpact + reversal.receivableImpact, 0)
  assert.equal(original.deferredRevenueImpact + reversal.deferredRevenueImpact, 0)
  assert.equal(reversal.cashImpact, 0)
  const contract = await read(db, 'contracts/contract'), attendance = await read(db, 'attendanceEvents/one')
  assert.equal(contract.usedSessions, 0); assert.equal(contract.paidAmount, 9600000)
  assert.equal(attendance.confirmedAt, before.confirmedAt); assert.equal(attendance.attendanceStatus, before.attendanceStatus)
  assert.equal((await read(db, 'payrollRuns/2026-10')).requiresRebuild, true)
  await db.doc('sessions/two').set(session('two', 'contract', '2026-10-21'))
  await charge(db, 'two')
  assert.equal((await read(db, 'ledgerEntries/pt_session_two')).serviceOrdinal, 1)
  const state = await db.runTransaction(tx => readContractRecognitionState(tx, db, 'contract'))
  assert.equal(state.recognizedRevenue, 266667)
  assert.equal((await read(db, 'contracts/contract')).usedSessions, 1)
})

test('return cannot mutate a locked period, finalized payroll or superseded source contract', async () => {
  for (const [path, data, issue] of [
    ['financePeriods/2026-10', { status: 'locked' }, 'FINANCE_PERIOD_LOCKED'],
    ['payrollRuns/2026-10', { status: 'approved' }, 'PAYROLL_RUN_IMMUTABLE'],
    ['contracts/contract', { renewalSupersededBy: 'next' }, 'SESSION_RETURN_HANDOVER_REVIEW'],
  ]) {
    const db = await fixture(); await charge(db); await db.doc(path).set(data, { merge: true })
    await assert.rejects(giveBack(db), error => error.details?.issueCode === issue)
    assert.equal((await read(db, 'contracts/contract')).usedSessions, 1)
    assert.equal((await db.collection('ledgerEntries').get()).size, 1)
  }
})

async function historical(db, id = 'one', ordinal = 1, date = '2026-10-20', revision = 1) {
  const identity = { sessionId: id, contractId: 'contract', studentId: 'student', trainerId: 'trainer', branchId: 'branch',
    billingStatus: 'charged', serviceOrdinal: ordinal }
  await db.doc(`sessions/${id}`).set({ ...session(id, 'contract', date), ...identity, revision, attendanceStatus: 'pending' })
  await db.doc(`attendanceEvents/${id}`).set({ ...identity, type: 'pending_confirmation', attendanceStatus: 'pending',
    confirmedAt: null, confirmedBy: '', note: 'Original note', occurredAt: new Date(`${date}T01:00:00Z`) })
  await db.doc(`sessionBillingEvents/${id}`).set(identity)
}
async function repairRow(db, sessionId = 'one') {
  const [session, attendance, billing, contract] = await Promise.all([`sessions/${sessionId}`, `attendanceEvents/${sessionId}`, `sessionBillingEvents/${sessionId}`, 'contracts/contract'].map(path => read(db, path)))
  return { sessionId, contractId: 'contract', evidenceHash: evidenceHash({ session, attendance, billing, contract }) }
}
test('historical pending repair is read-only in preview, preserves attendance and usage, and replays safely under concurrency', async () => {
  const db = await fixture(); await historical(db); await db.doc('contracts/contract').update({ usedSessions: 1 })
  const row = await repairRow(db), beforeAttendance = await read(db, 'attendanceEvents/one'), beforeContract = await read(db, 'contracts/contract')
  row.preview = await repairOne(db, row, { dryRun: true })
  assert.equal(row.preview.revenue, 266667); assert.equal((await db.collection('ledgerEntries').get()).size, 0)
  const results = await Promise.all([repairOne(db, row), repairOne(db, row)])
  assert.equal(results.filter(r => r.alreadyApplied).length, 1)
  const attendance = await read(db, 'attendanceEvents/one')
  for (const key of ['attendanceStatus','confirmedBy','confirmedAt','note']) assert.equal(attendance[key], beforeAttendance[key])
  assert.deepEqual(await read(db, 'contracts/contract'), beforeContract)
  assert.equal((await read(db, 'sessions/one')).revision, 1)
  assert.equal((await db.collection('journalEntries').get()).size, 1)
})
test('historical duplicate already excluded from usage becomes exempt without returning a second entitlement', async () => {
  const db = await fixture(); await historical(db, 'one', 1, '2026-10-20', 1); await historical(db, 'canonical', 2, '2026-10-20', 2)
  await db.doc('contracts/contract').update({ usedSessions: 1 })
  const row = await repairRow(db); row.preview = await repairOne(db, row, { dryRun: true })
  assert.equal(row.preview.outcome, 'duplicate_exempt'); assert.equal(row.preview.duplicateOf, 'canonical')
  await repairOne(db, row)
  assert.equal((await read(db, 'contracts/contract')).usedSessions, 1)
  assert.equal((await read(db, 'sessionBillingEvents/one')).billingStatus, 'void_duplicate')
  assert.equal((await db.collection('ledgerEntries').get()).size, 0)
})
test('reviewed historical ordinal allocation remains deterministic after preceding collision repairs', async () => {
  const db = await fixture(); await historical(db, 'one', 2, '2026-10-20'); await historical(db, 'two', 2, '2026-10-21')
  await db.doc('contracts/contract').update({ usedSessions: 2 })
  const first = await repairRow(db, 'one'), second = await repairRow(db, 'two')
  first.preview = await repairOne(db, first, { dryRun: true })
  second.preview = await repairOne(db, second, { dryRun: true, reserved: [first.preview.allocatedOrdinal] })
  assert.equal(first.preview.allocatedOrdinal, 1); assert.equal(second.preview.allocatedOrdinal, 3)
  await repairOne(db, first); await repairOne(db, second)
  assert.equal((await read(db, 'ledgerEntries/pt_session_one')).serviceOrdinal, 1)
  assert.equal((await read(db, 'ledgerEntries/pt_session_two')).serviceOrdinal, 3)
  assert.equal((await read(db, 'contracts/contract')).usedSessions, 2)
})
test('a second appointment cannot deduct again for the same learner and day', async () => {
  const db = await fixture({ 'sessions/duplicate': session('duplicate') })
  await charge(db)
  await assert.rejects(charge(db, 'duplicate'), error => error.details?.issueCode === 'SESSION_DUPLICATE_DAILY_CHARGE')
  assert.equal((await read(db, 'contracts/contract')).usedSessions, 1)
  assert.equal((await db.collection('ledgerEntries').get()).size, 1)
})

test('posted ordinal repair preserves signed revenue, cash, original confirmation and contract usage', async () => {
  const db = await fixture(); await charge(db)
  const original = await read(db, 'ledgerEntries/pt_session_one'), originalContract = await read(db, 'contracts/contract')
  await db.doc('sessions/one').update({ serviceOrdinal: 2 })
  await db.doc('attendanceEvents/one').update({ serviceOrdinal: 2 })
  await db.doc('sessionBillingEvents/one').update({ serviceOrdinal: 2 })
  const input = { sessionId: 'one', targetOrdinal: 3 }
  const preview = await repairPostedOrdinal(db, input, { dryRun: true }); input.sourceHash = preview.sourceHash
  assert.equal(preview.revenueChange, 0); assert.equal((await db.collection('ledgerEntries').get()).size, 1)
  await repairPostedOrdinal(db, input)
  assert.equal((await repairPostedOrdinal(db, input)).alreadyApplied, true)
  const entries = (await db.collection('ledgerEntries').get()).docs.map(d => d.data())
  assert.equal(entries.reduce((s, e) => s + e.revenueImpact, 0), original.revenueImpact)
  assert.equal(entries.reduce((s, e) => s + e.cashImpact, 0), 0)
  assert.equal((await read(db, 'sessions/one')).revision, 1)
  assert.equal((await read(db, 'attendanceEvents/one')).confirmedAt, null)
  assert.deepEqual(await read(db, 'contracts/contract'), originalContract)
  assert.equal((await read(db, 'ledgerEntries/pt_session_one')).status, 'reversed')
  assert.equal((await read(db, 'sessionBillingEvents/one')).serviceOrdinal, 3)
})
test('posted ordinal repair cannot change rounding value or overwrite an occupied share', async () => {
  const db = await fixture(); await charge(db)
  await assert.rejects(repairPostedOrdinal(db, { sessionId: 'one', targetOrdinal: 36 }, { dryRun: true }), /change posted revenue/)
  await db.doc('sessionBillingEvents/other').set({ contractId: 'contract', billingStatus: 'charged', serviceOrdinal: 3 })
  await assert.rejects(repairPostedOrdinal(db, { sessionId: 'one', targetOrdinal: 3 }, { dryRun: true }), /already billed/)
  assert.equal((await db.collection('ledgerEntries').get()).size, 1)
})
