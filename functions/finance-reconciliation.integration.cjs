'use strict'
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { readCase, resolveCase, createFinanceReconciliationFunctions } = require('./finance-reconciliation')
const { returnChargedSession } = require('./pt-session-return')
const { recordSessionAttendanceTransaction, assertCancellationEvidenceChange } = require('./session-operations')
const { attendanceReconciliation } = require('./attendance-reconciliation')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(localhost|127\.0\.0\.1):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, 'finance-review-' + randomUUID()), clients = []
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })
const actor = { uid: 'admin', actorName: 'Admin test', accessRole: 'admin', capabilities: ['finance.operations.manage'], branchIds: [] }
const read = async (db, path) => (await db.doc(path).get()).data()
const contract = { studentId: 'student', branchId: 'branch', status: 'active', totalSessions: 36, usedSessions: 1,
  totalPrice: 9600000, discount: 9600000, paidAmount: 0, startDate: '2026-10-01', endDate: '2027-01-01', chargedSessionIds: ['one'], attendedClasses: ['one'] }
const session = { studentId: 'student', trainerId: 'trainer', branchId: 'branch', contractId: 'contract', date: '2026-10-20', hour: 8,
  billingStatus: 'charged', attendanceStatus: 'present', status: 'completed', serviceOrdinal: 1, revision: 1, recognitionReviewRequired: true }
const attendance = { sessionId: 'one', ...session, occurredAt: Timestamp.fromDate(new Date('2026-10-20T01:00:00Z')),
  recognitionReviewIssueCode: 'RECOGNITION_ZERO_VALUE_REQUIRES_REVIEW' }
async function fixture(override = {}) {
  const db = getFirestore(app, 'finance-review-' + randomUUID()); clients.push(db)
  const seed = { 'users/admin': { role: 'admin', displayName: 'Admin test' }, 'contracts/contract': contract, 'sessions/one': session,
    'attendanceEvents/one': attendance, 'sessionBillingEvents/one': { sessionId: 'one', contractId: 'contract', studentId: 'student', billingStatus: 'charged', serviceOrdinal: 1 },
    'revenueRecognitionReviews/one': { status: 'open', issueCode: 'RECOGNITION_ZERO_VALUE_REQUIRES_REVIEW' }, ...override }
  const batch = db.batch(); for (const [path, value] of Object.entries(seed)) if (value !== null) batch.set(db.doc(path), value)
  await batch.commit(); return db
}
const preview = (db, targetContractId = '', who = actor) => db.runTransaction(transaction => readCase({ db, transaction, attendanceId: 'one', actor: who, targetContractId }))
const request = (state, action, targetContractId = '') => ({ attendanceId: 'one', action, token: state.token, targetContractId, reason: 'Đã đối chiếu hợp đồng và chứng từ gốc', requestId: randomUUID() })
const resolve = (db, input, who = actor) => resolveCase({ db, actor: who, input })
const quota = () => ({
  'contracts/contract': { ...contract, usedSessions: 36, chargedSessionIds: [], attendedClasses: [] },
  'sessions/one': { ...session, serviceOrdinal: null, billingStatus: 'review_required' },
  'attendanceEvents/one': { ...attendance, serviceOrdinal: null, billingStatus: 'review_required', billingIssueCode: 'CONTRACT_QUOTA_EXHAUSTED' },
  'sessionBillingEvents/one': null,
  'sessionBillingIssues/one': { status: 'open' },
})

test('acknowledgement preserves the financial exception and deduplicates concurrent retries; stale evidence is rejected', async () => {
  const db = await fixture(), state = await preview(db), input = request(state, 'acknowledge')
  const before = await read(db, 'sessions/one')
  const outcomes = await Promise.all([resolve(db, input), resolve(db, input)])
  assert.equal(outcomes.filter(o => !o.unchanged).length, 1)
  assert.deepEqual(await read(db, 'sessions/one'), before)
  assert.equal((await db.doc('financeReconciliationCases/one').collection('actions').get()).size, 1)
  await assert.rejects(resolve(db, { ...input, reason: 'Different decision' }), /nội dung khác/)
  await db.doc('contracts/contract').update({ discount: 0 })
  await assert.rejects(resolve(db, request(state, 'confirm_zero')), e => e.code === 'aborted')
  assert.equal((await db.collection('ledgerEntries').get()).size, 0)
})

test('explicit zero-value confirmation retains one deduction, survives later confirmation in a locked period, and can be returned once', async () => {
  const db = await fixture(), state = await preview(db)
  assert.ok(state.actions.some(a => a.id === 'confirm_zero'))
  await resolve(db, request(state, 'confirm_zero'))
  const a = await read(db, 'attendanceEvents/one')
  assert.equal(a.revenueRecognitionState, 'zero_value_confirmed'); assert.equal(a.attendanceStatus, 'present')
  assert.equal(attendanceReconciliation([{ ...a, id: 'one' }], []).zeroValueConfirmed, 1)
  assert.equal((await read(db, 'contracts/contract')).usedSessions, 1)
  assert.equal((await db.collection('ledgerEntries').get()).size, 0)
  await db.doc('financePeriods/2026-10').set({ status: 'locked' })
  await recordSessionAttendanceTransaction({ db, sessionId: 'one', actorUid: 'trainer', expectedRevision: 2,
    attendanceStatus: 'present', confirmationSource: 'manual', now: new Date('2026-10-31T01:00:00Z') })
  assert.equal((await read(db, 'sessions/one')).recognitionReviewRequired, false)
  await db.doc('financePeriods/2026-10').update({ status: 'open' })
  const revision = (await read(db, 'sessions/one')).revision
  await returnChargedSession({ db, sessionId: 'one', expectedRevision: revision, actorUid: 'admin', reason: 'Hoàn buổi 0đ đã xác minh', assertCancellationEvidenceChange })
  assert.equal((await read(db, 'contracts/contract')).usedSessions, 0)
  assert.equal((await read(db, 'sessionReturns/one')).revenueReversed, 0)
  assert.equal((await db.collection('ledgerEntries').get()).size, 0)
})

test('changing approved zero-value evidence cannot bypass a locked finance period', async () => {
  const db = await fixture(); await resolve(db, request(await preview(db), 'confirm_zero'))
  await db.doc('contracts/contract').update({ discount: 0 })
  await db.doc('financePeriods/2026-10').set({ status: 'locked' })
  await recordSessionAttendanceTransaction({ db, sessionId: 'one', actorUid: 'trainer', expectedRevision: 2,
    attendanceStatus: 'present', confirmationSource: 'manual', now: new Date('2026-10-31T01:00:00Z') })
  assert.equal((await read(db, 'attendanceEvents/one')).recognitionReviewRequired, true)
  assert.equal((await db.collection('ledgerEntries').get()).size, 0)
})

test('quota exemption never refunds an unconsumed entitlement or changes attendance; finalized payroll blocks it', async () => {
  const db = await fixture(quota())
  await db.doc('payrollRuns/2026-10').set({ status: 'approved' })
  assert.ok(!(await preview(db)).actions.some(a => a.id === 'exempt'))
  await db.doc('payrollRuns/2026-10').update({ status: 'draft' })
  await resolve(db, request(await preview(db), 'exempt'))
  assert.equal((await read(db, 'contracts/contract')).usedSessions, 36)
  assert.equal((await read(db, 'attendanceEvents/one')).attendanceStatus, 'present')
  assert.equal((await read(db, 'sessions/one')).billingStatus, 'exempt')
  assert.equal((await read(db, 'sessionBillingIssues/one')).status, 'resolved')
  assert.equal((await read(db, 'payrollRuns/2026-10')).requiresRebuild, true)
  assert.equal((await db.collection('sessionBillingEvents').get()).size, 0)
})

test('assigning an eligible contract atomically deducts once and posts revenue; concurrent decisions cannot double charge', async () => {
  const db = await fixture({ ...quota(), 'contracts/next': { ...contract, usedSessions: 0, chargedSessionIds: [], attendedClasses: [], discount: 0, paidAmount: 9600000 } })
  const state = await preview(db, 'next')
  assert.equal(state.actions.find(a => a.id === 'assign_contract').revenueDelta, 266667)
  const outcomes = await Promise.allSettled([resolve(db, request(state, 'assign_contract', 'next')), resolve(db, request(state, 'assign_contract', 'next'))])
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1)
  assert.equal((await read(db, 'contracts/next')).usedSessions, 1)
  assert.equal((await read(db, 'contracts/contract')).usedSessions, 36)
  assert.equal((await read(db, 'attendanceEvents/one')).attendanceStatus, 'present')
  const entry = await read(db, 'ledgerEntries/pt_session_one')
  assert.equal(entry.contractId, 'next'); assert.equal(entry.revenueImpact, 266667); assert.equal(entry.cashImpact, 0)
  assert.equal((await read(db, 'journalEntries/pt_session_one')).totalDebit, 266667)
})

test('future contracts, duplicate daily charges, missing identity and locked periods cannot be charged or exempted', async () => {
  const db = await fixture({ ...quota(), 'contracts/next': { ...contract, usedSessions: 0, discount: 0, startDate: '2026-10-21' } })
  assert.equal((await preview(db)).candidates.length, 0)
  await db.doc('contracts/next').update({ startDate: '2026-10-01' })
  await db.doc('sessions/other').set({ ...session, contractId: 'next' })
  assert.ok(!(await preview(db, 'next')).actions.some(a => a.id === 'assign_contract'))
  await db.doc('financePeriods/2026-10').set({ status: 'locked' })
  assert.deepEqual((await preview(db)).actions.map(a => a.id), ['acknowledge'])
  await assert.rejects(preview(db, '', { ...actor, capabilities: ['branch.finance.view'], branchIds: ['other'] }), e => e.code === 'permission-denied')
  await assert.rejects(resolve(db, request(await preview(db), 'acknowledge'), { ...actor, accessRole: 'staff' }), e => e.code === 'permission-denied')
})

test('read API bounds pages and does not permit anonymous or unauthorized access', async () => {
  const db = await fixture(), handlers = createFinanceReconciliationFunctions({ db, onCall: (_, handler) => handler })
  await assert.rejects(handlers.listFinanceReconciliationCases({ data: { attendanceIds: ['one'] } }), e => e.code === 'unauthenticated')
  const auth = { uid: 'admin', token: { role: 'admin' } }
  await assert.rejects(handlers.listFinanceReconciliationCases({ auth, data: { attendanceIds: Array(26).fill('one') } }), e => e.code === 'invalid-argument')
  const detail = await handlers.getFinanceReconciliationCase({ auth, data: { attendanceId: 'one' } })
  assert.equal(detail.studentId, 'student'); assert.ok(detail.actions.some(a => a.id === 'confirm_zero'))
  assert.equal((await db.collection('financeReconciliationCases').get()).size, 0)
})

test('carry-over zero approval uses the original price while preserving the new paid package', async () => {
  const next = { ...contract, totalSessions: 37, packageSessions: 36, carriedOverSessions: 1, sourceContractId: 'contract', discount: 0, paidAmount: 9600000,
    revenueAllocation: { version: 1, segments: [
      { contractId: 'contract', startOrdinal: 36, count: 1, totalSessions: 36, totalPrice: 9600000, discount: 9600000 },
      { contractId: 'next', startOrdinal: 1, count: 36, totalSessions: 36, totalPrice: 9600000, discount: 0 },
    ] } }
  const db = await fixture({ 'contracts/contract': { ...contract, status: 'expired', usedSessions: 35, carryOverTransferredSessions: 1 }, 'contracts/next': next,
    'sessions/one': { ...session, contractId: 'next' }, 'attendanceEvents/one': { ...attendance, contractId: 'next' },
    'sessionBillingEvents/one': { sessionId: 'one', contractId: 'next', studentId: 'student', billingStatus: 'charged', serviceOrdinal: 1 } })
  const state = await preview(db)
  assert.equal(state.plans.confirm_zero.allocation.contractId, 'contract')
  await resolve(db, request(state, 'confirm_zero'))
  assert.equal((await read(db, 'attendanceEvents/one')).revenueContractId, 'contract')
  assert.deepEqual(await read(db, 'contracts/next'), next)
  assert.equal((await db.collection('ledgerEntries').get()).size, 0)
})

test('paused entitlements and submitted cancellation evidence cannot be bypassed by financial review', async () => {
  const db = await fixture({ ...quota(), 'contracts/next': { ...contract, usedSessions: 0, discount: 0, pausePeriods: [{ startDate: '2026-10-19', endDate: '2026-10-22' }] } })
  assert.equal((await preview(db)).candidates.length, 0)
  await db.doc('contracts/contract').update({ cancellationSettlement: { status: 'submitted' } })
  assert.deepEqual((await preview(db)).actions.map(a => a.id), ['acknowledge'])
})

test('recognition repair posts the already consumed entitlement without deducting it again', async () => {
  const db = await fixture({ 'contracts/contract': { ...contract, discount: 0, paidAmount: 9600000 } })
  const state = await preview(db), input = request(state, 'recognize')
  await resolve(db, input); await resolve(db, input)
  assert.equal((await read(db, 'contracts/contract')).usedSessions, 1)
  assert.equal((await read(db, 'ledgerEntries/pt_session_one')).revenueImpact, 266667)
  assert.equal((await db.collection('ledgerEntries').get()).size, 1)
  assert.ok(!(await preview(db)).actions.some(a => a.id === 'recognize'))
})
