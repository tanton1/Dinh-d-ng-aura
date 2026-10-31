'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { chargeSessionTransaction, createSessionOperationFunctions } = require('./session-operations')
const { activateDueRenewalContractsCore, prepareRenewalCaseCore, createContractRenewalFunctions } = require('./contract-renewals')
const { vietnamDateKey, addDateDays } = require('./pt-policy')
const { renewalActivationProjection, renewalDateSyncPatch } = require('./contract-renewal-handover')
const { effectiveContractStatus } = require('./contract-status')
const { resolveSchedulingContract } = require('./contract-scheduling')
const { summarizeContractUsage } = require('./contract-usage')
const { contractCoversDate, isContractSchedulableOn } = require('./pt-operations-v2')

// A strict transaction fake: writes commit together, transforms are applied,
// and a read after a write fails just as it does in Firestore.
function database(seed) {
  const rows = new Map(Object.entries(seed))
  let sequence = 0
  const ref = (path) => ({ path, id: path.split('/').at(-1), get: async () => snapshot(ref(path)) })
  const query = (path, filters = [], limit = Infinity) => ({
    path, filters, limitValue: limit,
    where: (field, operator, value) => query(path, [...filters, { field, operator, value }], limit),
    limit: (maximum) => query(path, filters, maximum),
    select: () => query(path, filters, limit),
    get: async () => snapshot(query(path, filters, limit)),
    doc: (id = `generated-${++sequence}`) => ref(`${path}/${id}`),
  })
  function snapshot(target) {
    if (!target.filters) return { id: target.id, ref: target, exists: rows.has(target.path), data: () => ({ ...rows.get(target.path) }) }
    const docs = [...rows].filter(([path, value]) => path.startsWith(`${target.path}/`)
      && !path.slice(target.path.length + 1).includes('/')
      && target.filters.every(({ field, operator, value: expected }) => operator === 'in' ? expected.includes(value[field]) : value[field] === expected))
      .slice(0, target.limitValue).map(([path]) => snapshot(ref(path)))
    return { docs, size: docs.length, empty: !docs.length }
  }
  const transform = (value, previous) => {
    if (value?.constructor?.name === 'NumericIncrementTransform') return Number(previous || 0) + value.operand
    if (value?.constructor?.name === 'ArrayUnionTransform') return [...new Set([...(previous || []), ...value.elements])]
    if (value?.constructor?.name === 'ServerTimestampTransform') return '2026-08-20T03:00:00.000Z'
    return value
  }
  const db = {
    doc: ref, collection: query,
    getAll: async (...refs) => refs.map(snapshot),
    runTransaction: async (handler) => {
      const writes = []
      const transaction = {
        get: async (target) => { assert.equal(writes.length, 0, 'All reads precede all writes'); return snapshot(target) },
        create: (target, data) => writes.push({ target, data, create: true }),
        update: (target, data) => writes.push({ target, data }),
        set: (target, data) => writes.push({ target, data }),
      }
      const result = await handler(transaction)
      const staged = new Map(rows)
      for (const { target, data, create } of writes) {
        if (create) assert.equal(staged.has(target.path), false, `Duplicate create: ${target.path}`)
        const previous = staged.get(target.path) || {}
        staged.set(target.path, { ...previous, ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, transform(value, previous[key])])) })
      }
      rows.clear(); for (const [path, value] of staged) rows.set(path, value)
      return result
    },
  }
  return { db, get: (path) => rows.get(path), rows }
}

const source = { totalPrice: 1200000, discount: 0, paidAmount: 1200000, studentId: 'student-1', branchId: 'branch-1', status: 'active', packageId: 'package-1', startDate: '2026-08-01', endDate: '2026-08-31', totalSessions: 12, usedSessions: 11, renewedByContractId: 'next', revision: 2 }
const next = { totalPrice: 9600000, discount: 0, paidAmount: 9600000, studentId: 'student-1', branchId: 'branch-1', status: 'future', sourceContractId: 'source', startDate: '2026-09-01', endDate: '2026-12-01', signedDate: '2026-08-10', plannedActivationDate: '2026-09-01', activationMode: 'automatic', earlyHandoverRequested: true, handoverStatus: 'pending', packageSessions: 36, totalSessions: 36, usedSessions: 0, durationMonths: 3, plannedCarryOverSessions: 5, carryOverPending: true, revision: 0 }
const session = { studentId: 'student-1', trainerId: 'trainer-1', branchId: 'branch-1', contractId: 'source', status: 'scheduled', billingStatus: 'pending', date: '2026-08-20', hour: 8, revision: 0 }
function fixture(sourcePatch = {}, nextPatch = {}, sessionPatch = {}, extra = {}) {
  return database({ 'contracts/source': { ...source, ...sourcePatch }, 'contracts/next': { ...next, ...nextPatch }, 'sessions/current': { ...session, ...sessionPatch }, ...extra })
}
const charge = (state, overrides = {}) => chargeSessionTransaction({ db: state.db, sessionId: 'current', expectedRevision: 0, actorUid: 'trainer-1', now: new Date('2026-08-20T03:00:00Z'), ...overrides })

test('last actual source charge activates the renewal atomically, preserves sold end, and is idempotent', async () => {
  const state = fixture()
  await charge(state)
  assert.equal(state.get('contracts/source').usedSessions, 12)
  assert.equal(state.get('contracts/source').completionReason, 'quota_exhausted')
  assert.equal(state.get('contracts/next').status, 'active')
  assert.equal(state.get('contracts/next').activationDate, '2026-08-20')
  assert.equal(state.get('contracts/next').plannedActivationDate, '2026-09-01')
  assert.equal(state.get('contracts/next').endDate, '2026-12-01')
  assert.equal(state.get('contracts/next').usedSessions, 0)
  assert.equal(state.get('contracts/next').totalSessions, 36)
  assert.equal((await charge(state)).unchanged, true)
  assert.equal(state.get('contracts/source').usedSessions, 12)
  assert.equal([...state.rows.keys()].filter((path) => path.startsWith('contractRenewalActivities/')).length, 1)
  assert.equal(state.get('contractRenewalActivities/handover-next').caseId, 'source')
})

test('trainer schedule recognizes pending automatic reservations without bypassing fixed dates or preservation', () => {
  const reserved = { ...next, id: 'next' }
  assert.equal(contractCoversDate(reserved, session.date, source), true)
  assert.equal(isContractSchedulableOn(reserved, session.date, undefined, source), true)
  assert.equal(contractCoversDate({ ...reserved, activationMode: 'fixed_date' }, session.date, source), false)
  assert.equal(contractCoversDate(reserved, session.date, { ...source, status: 'frozen' }), false)
  assert.equal(contractCoversDate(reserved, session.date, { ...source, studentId: 'different-student' }), false)
  assert.equal(next.status, 'future')
})

test('approved preservation moves an automatic continuation immediately while retaining fixed dates and payment dates', async () => {
  for (const activationMode of ['automatic', 'fixed_date']) {
    const installments = [{ id: 'payment-1', date: '2026-09-10', amount: 1000000, status: 'pending' }]
    const state = database({
      'contracts/source': source,
      'contracts/next': { ...next, activationMode, installments },
      'leaveRequests/preserve': { status: 'pending', type: 'preservation', studentId: source.studentId, contractId: 'source', startDate: '2026-08-10', endDate: '2026-08-31' },
    })
    const operations = createSessionOperationFunctions({ db: state.db, onCall: (...args) => args.at(-1), authorizeAdmin: async () => ({ uid: 'admin' }), now: () => new Date('2026-08-05T03:00:00Z') })
    await operations.approveContractPauseRequest({ data: { requestId: 'preserve' } })
    assert.equal(state.get('contracts/source').endDate, '2026-09-22')
    assert.equal(state.get('contracts/next').startDate, activationMode === 'automatic' ? '2026-09-23' : '2026-09-01')
    assert.equal(state.get('contracts/next').endDate, activationMode === 'automatic' ? '2026-12-23' : '2026-12-01')
    assert.deepEqual(state.get('contracts/next').installments, installments)
    assert.equal(state.get('contracts/next').status, 'future')
  }
})

test('a renewal reservation returns to the source when a cancellation leaves quota unused', async () => {
  const state = fixture({}, {}, { contractId: 'next', renewalHandoverPending: true })
  await charge(state)
  assert.equal(state.get('sessions/current').contractId, 'source')
  assert.equal(state.get('sessionBillingEvents/current').contractId, 'source')
  assert.equal(state.get('attendanceEvents/current').contractId, 'source')
  assert.equal(state.get('contracts/source').usedSessions, 12)
  assert.equal(state.get('contracts/next').usedSessions, 0)
  assert.equal(state.get('contracts/next').status, 'active')
})

test('a free cancellation of a pending renewal reservation leaves both quotas and activation untouched', async () => {
  const state = fixture({}, {}, { contractId: 'next' }, {
    'sessionRequests/cancel': { status: 'pending', type: 'cancel', sessionId: 'current', studentId: 'student-1', contractId: 'next', requestedBy: 'trainer', originalDate: session.date, originalHour: session.hour, originalSessionRevision: 0, reason: 'PT nghỉ' },
  })
  const operations = createSessionOperationFunctions({ db: state.db, onCall: (...args) => args.at(-1), authorizeAdmin: async () => ({ uid: 'admin' }), now: () => new Date('2026-08-19T03:00:00Z') })
  const result = await operations.approveSessionRequest({ data: { requestId: 'cancel', expectedSessionRevision: 0 } })
  assert.equal(result.countsTowardContract, false)
  assert.equal(state.get('sessions/current').billingStatus, 'exempt')
  assert.equal(state.get('contracts/source').usedSessions, 11)
  assert.equal(state.get('contracts/next').usedSessions, 0)
  assert.equal(state.get('contracts/next').status, 'future')
})

test('a chargeable cancellation consumes the last source entitlement and releases the renewal immediately', async () => {
  // Stored usage lags the eleven charged sessions; billing must use the
  // canonical count and persist twelve rather than increment ten to eleven.
  const state = fixture({ usedSessions: 10, totalPrice: 1_200_000, paidAmount: 1_200_000 }, {}, {}, {
    ...Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`sessions/charged-${index}`, {
      ...session, date: addDateDays('2026-08-01', index), status: 'completed', billingStatus: 'charged', countsTowardContract: true,
    }])),
    'sessionRequests/cancel': { status: 'pending', type: 'cancel', sessionId: 'current', studentId: 'student-1', contractId: 'source', requestedBy: 'student', originalDate: session.date, originalHour: session.hour, originalSessionRevision: 0, reason: 'Bận đột xuất', submittedAtIso: '2026-08-20T00:00:00Z', policyMonth: '2026-08' },
  })
  const operations = createSessionOperationFunctions({ db: state.db, onCall: (...args) => args.at(-1), authorizeAdmin: async () => ({ uid: 'admin' }), now: () => new Date('2026-08-20T03:00:00Z') })
  const result = await operations.approveSessionRequest({ data: { requestId: 'cancel', expectedSessionRevision: 0 } })
  assert.equal(result.countsTowardContract, true)
  assert.equal(state.get('contracts/source').usedSessions, 12)
  assert.equal(state.get('contracts/next').status, 'active')
  assert.equal(state.get('contracts/next').usedSessions, 0)
})

test('a paid policy charge with missing financial terms cannot consume quota or release a renewal', async () => {
  const state = fixture({ totalPrice: null }, {}, {}, {
    'sessionRequests/cancel': { status: 'pending', type: 'cancel', sessionId: 'current', studentId: 'student-1', contractId: 'source', requestedBy: 'student', originalDate: session.date, originalHour: session.hour, originalSessionRevision: 0, reason: 'Bận đột xuất', submittedAtIso: '2026-08-20T00:00:00Z', policyMonth: '2026-08' },
  })
  const operations = createSessionOperationFunctions({ db: state.db, onCall: (...args) => args.at(-1), authorizeAdmin: async () => ({ uid: 'admin' }), now: () => new Date('2026-08-20T03:00:00Z') })
  await assert.rejects(operations.approveSessionRequest({ data: { requestId: 'cancel', expectedSessionRevision: 0 } }),error=>error.details?.issueCode==='POLICY_RECOGNITION_REQUIRES_REVIEW')
  assert.equal(state.get('contracts/source').usedSessions,11)
  assert.equal(state.get('contracts/next').status,'future')
  assert.equal(state.get('sessionRequests/cancel').status,'pending')
  assert.equal(state.get('ledgerEntries/pt_policy_cancel'),undefined)
})

test('first renewal session activates and charges its own quota before the nightly worker', async () => {
  const state = fixture({ usedSessions: 12 }, {}, { contractId: 'next' })
  await charge(state)
  assert.equal(state.get('contracts/next').usedSessions, 1)
  assert.equal(state.get('sessionBillingEvents/current').contractId, 'next')
  assert.equal(state.get('contracts/source').usedSessions, 12)
})

test('fixed-date renewal remains unavailable when the source exhausts early', async () => {
  const state = fixture({ usedSessions: 12 }, { activationMode: 'fixed_date', earlyHandoverRequested: false }, { contractId: 'next' })
  await assert.rejects(charge(state), /trạng thái/)
  assert.equal(state.get('contracts/next').status, 'future')
  assert.equal(state.get('sessionBillingEvents/current'), undefined)
})

test('fixed-date handover caps carry-over at the quoted maximum and closes the source', async () => {
  const state = fixture({ usedSessions: 8 }, { activationMode: 'fixed_date', earlyHandoverRequested: false, startDate: '2026-08-20', plannedActivationDate: '2026-08-20', plannedCarryOverSessions: 2 }, { contractId: 'next' })
  await charge(state)
  assert.equal(state.get('contracts/next').totalSessions, 38)
  assert.equal(state.get('contracts/next').carriedOverSessions, 2)
  assert.equal(state.get('contracts/source').carryOverTransferredSessions, 2)
  assert.equal(state.get('contracts/source').status, 'expired')
})

test('nightly expiry handover uses actual usage, transfers once, and removes source availability', async () => {
  const state = fixture({ usedSessions: 10 })
  const first = await activateDueRenewalContractsCore({ db: state.db, today: '2026-09-01' })
  assert.equal(first.transferredSessions, 2)
  assert.equal(state.get('contracts/next').totalSessions, 38)
  assert.equal(summarizeContractUsage(state.get('contracts/source'), []).remainingSessions, 0)
  const second = await activateDueRenewalContractsCore({ db: state.db, today: '2026-09-01' })
  assert.equal(second.activated, 0)
  assert.equal(state.get('contracts/next').totalSessions, 38)
})

test('frozen/cancelled sources never release a pending renewal even after its planned date', async () => {
  for (const status of ['frozen', 'cancelled']) {
    const state = fixture({ status, usedSessions: 12 })
    assert.equal((await activateDueRenewalContractsCore({ db: state.db, today: '2026-09-02' })).activated, 0)
    assert.equal(effectiveContractStatus(state.get('contracts/next'), '2026-09-02'), 'future')
    const contracts = [{ id: 'source', ...state.get('contracts/source') }, { id: 'next', ...state.get('contracts/next') }]
    assert.equal(resolveSchedulingContract({ contracts, studentId: 'student-1', branchId: 'branch-1', date: '2026-09-02' }).contract, null)
  }
})

test('unfreezing/extending the source moves automatic dates but preserves fixed dates and original sale dates', () => {
  const extended = { ...source, endDate: '2026-09-10' }
  assert.deepEqual(renewalDateSyncPatch(extended, next), { startDate: '2026-09-11', plannedActivationDate: '2026-09-11', endDate: '2026-12-11' })
  assert.deepEqual(renewalDateSyncPatch(extended, { ...next, activationMode: 'fixed_date' }), {})
  assert.equal(renewalActivationProjection(extended, next, '2026-09-01').handoverDue, false)
  assert.equal(next.endDate, '2026-12-01')
})

test('a future booking is never consumption and cannot activate before its start time or sale date', async () => {
  const state = fixture({ usedSessions: 12 }, {}, { contractId: 'next' })
  await assert.rejects(charge(state, { now: new Date('2026-08-19T03:00:00Z') }), /Chưa đến giờ/)
  assert.equal(state.get('contracts/next').status, 'future')
  assert.equal(renewalActivationProjection({ ...source, usedSessions: 12 }, next, '2026-08-09').handoverDue, false)
})

test('a mismatched source cannot charge or transfer another learner entitlement', async () => {
  const state = fixture({ studentId: 'other-student', usedSessions: 12 }, {}, { contractId: 'next' })
  await assert.rejects(charge(state), /Liên kết/)
  assert.equal(state.get('contracts/next').status, 'future')
})

test('single-source preparation works before sales queue eligibility and enforces branch/sales ownership', async () => {
  const state = database({ 'contracts/source': { ...source, renewedByContractId: null }, 'students/student-1': { name: 'Học viên', status: 'active', branchId: 'branch-1' } })
  const actor = { uid: 'admin', branchIds: [], renewalCanSell: true, renewalScope: 'system' }
  const row = await prepareRenewalCaseCore({ db: state.db, actor, sourceContractId: 'source' })
  assert.equal(row.sourceContractId, 'source')
  assert.equal(row.manuallyOpened, true)
  assert.equal(row.contractSnapshot.usedSessions, 11)
  await assert.rejects(prepareRenewalCaseCore({ db: state.db, actor: { ...actor, renewalScope: 'branch', branchIds: ['other-branch'] }, sourceContractId: 'source' }), /phạm vi/)
  assert.equal(state.get('contractRenewalCases/source').revision, 1)
})

for (const scenario of [{ mode: 'automatic', frozen: false }, { mode: 'fixed_date', frozen: false }, { mode: 'automatic', frozen: true }]) test(`creating a ${scenario.mode} renewal records payment and preserves ${scenario.frozen ? 'preservation' : 'source availability'}`, async () => {
  const { mode, frozen } = scenario
  const today = vietnamDateKey()
  const endDate = addDateDays(today, 10)
  const startDate = addDateDays(endDate, 1)
  const state = database({
    'contracts/source': { ...source, status: frozen ? 'frozen' : 'active', usedSessions: frozen ? 12 : 11, renewedByContractId: null, startDate: addDateDays(today, -10), endDate },
    'contractRenewalCases/source': { sourceContractId: 'source', studentId: 'student-1', branchId: 'branch-1', revision: 1, stage: 'uncontacted' },
    'packages/package-1': { name: 'Gói mới', totalSessions: 36, durationMonths: 3, price: 9000000, status: 'active', revision: 0 },
    'quotes/quote': { caseId: 'source', packageId: 'package-1', discount: 0, carryOverSessions: 0, packageRevision: 0 },
    'cashAccounts/cash': { status: 'active', type: 'cash', branchId: 'branch-1', balance: 0, name: 'Quỹ thu' },
  })
  const operations = createContractRenewalFunctions({ db: state.db, onCall: (...args) => args.at(-1), resolveActor: async () => ({ uid: 'admin', branchIds: [], renewalCanSell: true, renewalScope: 'system' }) })
  const data = { sourceContractId: 'source', caseId: 'source', packageId: 'package-1', quoteId: 'quote', activationMode: mode, startDate,
    expectedSourceRevision: 2, expectedCaseRevision: 1, idempotencyKey: `sale-${mode}`, carryOver: false, discount: 0,
    initialPayment: 1000000, paymentMethod: 'cash', cashAccountId: 'cash', installments: [{ id: 'one', date: startDate, amount: 8000000 }], trainerIds: [], nutritionPTIds: [] }
  const result = await operations.renewPtContract({ data })
  const created = state.get(`contracts/${result.contractId}`)
  assert.equal(created.status, 'future')
  assert.equal(created.handoverStatus, 'pending')
  assert.equal(created.activationDate, null)
  assert.equal(created.signedDate, today)
  assert.equal(created.totalSessions, 36)
  assert.equal(created.paidAmount, 1000000)
  assert.equal(created.earlyHandoverRequested, mode === 'automatic')
  assert.equal(state.get('contracts/source').status, frozen ? 'frozen' : 'active')
  assert.equal(state.get(`ledgerEntries/${result.paymentEntryId}`).contractId, result.contractId)
  assert.equal((await operations.renewPtContract({ data })).unchanged, true)
})
