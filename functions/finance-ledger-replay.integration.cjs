'use strict'

const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { createFinanceLedgerFunctions } = require('./finance-ledger')
const { createContractSettlementFunctions } = require('./contract-settlement')
const { recordSessionAttendanceTransaction, createSessionOperationFunctions } = require('./session-operations')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `finance-replay-${randomUUID()}`)
const databases = []
after(async () => {
  await Promise.all(databases.map(db => db.terminate()))
  await deleteApp(app)
})

async function fixture({ beforeTransaction = async () => {} } = {}) {
  const db = getFirestore(app, `finance-replay-${randomUUID()}`)
  databases.push(db)
  const batch = db.batch()
  for (const uid of ['admin', 'other']) batch.set(db.doc(`users/${uid}`), { role: 'admin' })
  batch.set(db.doc('users/student'), { role: 'student' })
  for (const id of ['example', 'other']) {
    batch.set(db.doc(`contracts/${id}`), { studentId: id, branchId: id, totalPrice: 1000000, paidAmount: 400000, discount: 0, totalSessions: 12, usedSessions: 0, status: 'active', startDate: '2026-10-01', endDate: '2026-12-31' })
    batch.set(db.doc(`students/${id}`), { name: 'Synthetic student' })
    batch.set(db.doc(`cashAccounts/${id}`), { type: 'bank', status: 'active', branchId: id, balance: 1000000 })
  }
  await batch.commit()
  const reads = []
  const observedDb = {
    doc: path => db.doc(path), collection: name => db.collection(name),
    runTransaction: async callback => { await beforeTransaction(); return db.runTransaction(transaction => callback(new Proxy(transaction, {
      get(target, name) {
        if (name === 'get') return async reference => {
          const result = await target.get(reference)
          reads.push({ path: reference.path || null, query: !reference.path, size: result.size ?? (result.exists ? 1 : 0) })
          return result
        }
        const value = target[name]
        return typeof value === 'function' ? value.bind(target) : value
      },
    }))) },
  }
  const handlers = createFinanceLedgerFunctions({ db: observedDb, onCall: handler => handler })
  const input = { contractId: 'example', amount: 100000, effectiveAt: '2026-10-25T12:00:00Z', paymentMethod: 'transfer', cashAccountId: 'example', note: 'Synthetic collection', reason: 'Synthetic refund' }
  const call = (name, key, patch = {}, uid = 'admin') => handlers[name]({ auth: { uid, token: { role: uid === 'student' ? 'student' : 'admin' } }, data: { ...input, ...patch, idempotencyKey: key } })
  const intent = (action, type, key, patch = {}, uid = 'admin', protocol = 1, ownerUid = uid) => handlers.manageFinanceOperation({ auth: { uid, token: { role: uid === 'student' ? 'student' : 'admin' } }, data: { protocol, ownerUid, action, operation: { type, payload: { ...input, expectedPaidAmount: 400000, ...patch, idempotencyKey: key } } } })
  const inspect = async () => {
    const [contract, cash, ledger, movements, journals, vouchers, commissions] = await Promise.all([
      db.doc('contracts/example').get(), db.doc('cashAccounts/example').get(),
      ...['ledgerEntries', 'cashTransactions', 'journalEntries', 'accountingDocuments', 'payrollEarningEvents'].map(name => db.collection(name).get()),
    ])
    return { paid: contract.data().paidAmount, cash: cash.data().balance, ledger: ledger.size, movements: movements.size, journals: journals.size, vouchers: vouchers.size, commissions: commissions.size }
  }
  return { db, input, call, intent, inspect, reads }
}
const mismatch = error => error.code === 'already-exists' && error.details?.reason === 'finance-replay-mismatch'
const changedBalance = error => error.code === 'failed-precondition' && error.details?.reason === 'finance-balance-changed'
const intentKey = () => `aura-finance-v1:${randomUUID()}`

for (const type of ['payment', 'refund']) {
  test(`real Firestore: durable ${type} recovers a committed response without another financial effect`, async () => {
    const f = await fixture(), key = intentKey()
    const original = await f.intent('submit', type, key)
    assert.equal(original.state, 'committed')
    const before = await f.inspect()
    await f.db.doc('financePeriods/2026-10').set({ status: 'locked' })
    await f.db.doc('cashAccounts/example').update({ status: 'inactive' })
    f.reads.length = 0
    const retry = await f.intent('submit', type, key)
    assert.equal(retry.state, 'committed')
    assert.equal(retry.receipt.entryId, original.receipt.entryId)
    assert.equal(retry.receipt.unchanged, true)
    assert.equal(f.reads.length, 2)
    assert.equal(f.reads.filter(row => row.query).length, 0)
    assert.deepEqual(await f.inspect(), before)
    assert.equal((await f.db.collection('financeOperationCancellations').get()).size, 0)
  })

  test(`real Firestore: cancelling ${type} before submit permanently prevents that operation`, async () => {
    const f = await fixture(), key = intentKey(), before = await f.inspect()
    const cancelled = await f.intent('cancel', type, key)
    assert.deepEqual(cancelled, { protocol: 1, idempotencyKey: key, state: 'cancelled' })
    assert.deepEqual(await f.intent('submit', type, key), cancelled)
    assert.deepEqual(await f.intent('cancel', type, key), cancelled)
    assert.deepEqual(await f.inspect(), before)
    assert.equal((await f.db.collection('financeOperationCancellations').get()).size, 1)
    await assert.rejects(f.intent('submit', type, key, { amount: 200000 }), mismatch)
    await assert.rejects(f.intent('cancel', type, key, {}, 'other'), mismatch)
    assert.equal((await f.intent('submit', type, intentKey())).state, 'committed')
  })

  test(`real Firestore: cancelling committed ${type} reports its receipt, never reverses it`, async () => {
    const f = await fixture(), key = intentKey()
    const submitted = await f.intent('submit', type, key), before = await f.inspect()
    const result = await f.intent('cancel', type, key)
    assert.equal(result.state, 'committed')
    assert.equal(result.receipt.entryId, submitted.receipt.entryId)
    assert.deepEqual(await f.inspect(), before)
    assert.equal((await f.db.collection('financeOperationCancellations').get()).size, 0)
    await assert.rejects(f.intent('cancel', type, key, { cashAccountId: 'other' }), mismatch)
  })

  test(`real Firestore: simultaneous ${type} and cancellation agree on one terminal outcome`, async () => {
    const f = await fixture(), key = intentKey(), before = await f.inspect()
    const [submit, cancel, replay] = await Promise.all([f.intent('submit', type, key), f.intent('cancel', type, key), f.intent('submit', type, key)])
    assert.equal(submit.state, cancel.state)
    assert.equal(submit.state, replay.state)
    const after = await f.inspect()
    if (submit.state === 'cancelled') assert.deepEqual(after, before)
    else {
      assert.equal(after.ledger, 1)
      assert.equal(after.movements, 1)
      assert.equal(after.journals, 1)
      assert.equal(after.paid, before.paid + (type === 'payment' ? 100000 : -100000))
      assert.equal(submit.receipt.entryId, cancel.receipt.entryId)
    }
    assert.equal((await f.db.collection('financeOperationCancellations').get()).size, submit.state === 'cancelled' ? 1 : 0)
  })
}

test('real Firestore: an earlier delayed request cannot commit after cancellation returns', async () => {
  let release, entered, count = 0
  const pending = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  const f = await fixture({ beforeTransaction: async () => { if (++count === 1) { entered(); await pending } } }), key = intentKey()
  const before = await f.inspect(), delayed = f.intent('submit', 'payment', key)
  await started
  try { assert.equal((await f.intent('cancel', 'payment', key)).state, 'cancelled') }
  finally { release() }
  assert.equal((await delayed).state, 'cancelled')
  assert.deepEqual(await f.inspect(), before)
})

test('real Firestore: a stale failed attempt remains recoverable and can be durably cancelled', async () => {
  const f = await fixture(), key = intentKey()
  await f.db.doc('contracts/example').update({ paidAmount: 500000 })
  await assert.rejects(f.intent('submit', 'payment', key), changedBalance)
  const before = await f.inspect()
  assert.equal((await f.intent('cancel', 'payment', key)).state, 'cancelled')
  await f.db.doc('contracts/example').update({ paidAmount: 400000 })
  assert.equal((await f.intent('submit', 'payment', key)).state, 'cancelled', 'change-and-revert must not revive a cancelled attempt')
  assert.equal((await f.inspect()).ledger, before.ledger)
})

test('real Firestore: durable reversal cancellation and replay retain the original payment', async () => {
  const f = await fixture()
  const original = await f.call('recordContractPayment', randomUUID()), stopped = intentKey()
  const patch = { entryId: original.entryId, reason: 'Synthetic reversal' }, before = await f.inspect()
  assert.equal((await f.intent('cancel', 'reversal', stopped, patch)).state, 'cancelled')
  assert.equal((await f.intent('submit', 'reversal', stopped, patch)).state, 'cancelled')
  assert.deepEqual(await f.inspect(), before)
  const key = intentKey(), posted = await f.intent('submit', 'reversal', key, patch)
  assert.equal(posted.state, 'committed')
  const after = await f.inspect()
  assert.equal(after.ledger, 2)
  assert.equal(after.movements, 2)
  assert.equal(after.paid, 400000)
  assert.equal((await f.intent('cancel', 'reversal', key, patch)).receipt.entryId, posted.receipt.entryId)
  assert.equal((await f.intent('submit', 'reversal', key, patch)).receipt.entryId, posted.receipt.entryId)
  assert.deepEqual(await f.inspect(), after)
})

test('real Firestore: cancelled intent binds every payment field, type and authority', async () => {
  const f = await fixture(), key = intentKey()
  await f.intent('cancel', 'payment', key)
  for (const patch of [{ contractId: 'other' }, { amount: 50000 }, { effectiveAt: '2026-10-25T12:00:01Z' }, { paymentMethod: 'cash' }, { cashAccountId: 'other' }, { installmentId: 'i' }, { note: 'Changed' }, { expectedPaidAmount: 500000 }]) {
    await assert.rejects(f.intent('cancel', 'payment', key, patch), mismatch)
  }
  await assert.rejects(f.intent('submit', 'refund', key), mismatch)
  await assert.rejects(f.intent('cancel', 'payment', key, {}, 'student'), error => error.code === 'permission-denied')
  await f.db.doc('users/admin').update({ disabled: true })
  await assert.rejects(f.intent('cancel', 'payment', key), error => error.code === 'permission-denied')
  assert.equal((await f.inspect()).ledger, 0)
})

test('real Firestore: versioned intents never fall through legacy mutations or unknown actions', async () => {
  const f = await fixture(), key = intentKey(), before = await f.inspect()
  for (const name of ['recordContractPayment', 'recordRefund', 'reverseContractPayment']) await assert.rejects(async () => f.call(name, key), error => error.code === 'failed-precondition')
  for (const action of ['discard', '', undefined]) await assert.rejects(f.intent(action, 'payment', key), error => error.code === 'invalid-argument')
  await assert.rejects(f.intent('submit', 'payment', key, {}, 'admin', 2), error => error.code === 'invalid-argument')
  await assert.rejects(f.intent('submit', 'payment', randomUUID()), error => error.code === 'invalid-argument')
  await assert.rejects(f.intent('submit', 'payment', key, { expectedPaidAmount: undefined }), error => error.code === 'invalid-argument')
  await assert.rejects(f.intent('submit', 'payment', key, {}, 'other', 1, 'admin'), error => error.details?.reason === 'finance-owner-changed')
  for (const type of ['payment', 'refund']) {
    await assert.rejects(f.intent('submit', type, key, { cashAccountId: '' }), error => error.code === 'invalid-argument')
    await assert.rejects(f.call(type === 'payment' ? 'recordContractPayment' : 'recordRefund', randomUUID(), { cashAccountId: '' }), error => error.code === 'invalid-argument')
  }
  assert.deepEqual(await f.inspect(), before)
  assert.equal((await f.db.collection('financeOperationCancellations').get()).size, 0)
})

test('real Firestore: committed durable receipt remains recoverable after source deletion', async () => {
  const f = await fixture(), key = intentKey(), posted = await f.intent('submit', 'payment', key)
  await f.db.doc('contracts/example').delete()
  assert.equal((await f.intent('submit', 'payment', key)).receipt.entryId, posted.receipt.entryId)
  assert.equal((await f.intent('cancel', 'payment', key)).receipt.entryId, posted.receipt.entryId)
  assert.equal((await f.db.collection('ledgerEntries').get()).size, 1)
})

for (const name of ['recordContractPayment', 'recordRefund']) {
  const sign = name === 'recordContractPayment' ? 1 : -1
  test(`real Firestore: ${name} concurrent and lost-response retries have one financial effect`, async () => {
    const f = await fixture(), key = randomUUID()
    const results = await Promise.all(Array.from({ length: 4 }, () => f.call(name, key)))
    assert.equal(new Set(results.map(row => row.entryId)).size, 1)
    assert.equal(results.filter(row => !row.unchanged).length, 1)
    const expected = { paid: 400000 + sign * 100000, cash: 1000000 + sign * 100000, ledger: 1, movements: 1, journals: 1, vouchers: sign === 1 ? 1 : 0, commissions: 0 }
    assert.deepEqual(await f.inspect(), expected)
    f.reads.length = 0
    const replay = await f.call(name, key)
    assert.equal(replay.unchanged, true)
    assert.equal(replay.entryId, results[0].entryId)
    assert.equal(f.reads.filter(row => row.query).length, 0, 'canonical replays need no legacy query')
    assert.equal(f.reads.length, 2, 'contract and canonical operation; authority reads counted separately')
    assert.deepEqual(await f.inspect(), expected)
  })

  test(`real Firestore: ${name} replays bind actor and every accepted input`, async () => {
    const f = await fixture(), key = randomUUID()
    await f.call(name, key)
    const before = await f.inspect()
    for (const patch of [
      { amount: 50000 }, { contractId: 'other' }, { cashAccountId: 'other' },
      { installmentId: 'new-installment' }, { paymentMethod: 'cash' },
      { effectiveAt: '2026-10-25T12:00:01Z' }, { expectedPaidAmount: 400000 },
      name === 'recordContractPayment' ? { note: 'Changed collection' } : { reason: 'Changed refund' },
    ]) await assert.rejects(f.call(name, key, patch), mismatch, JSON.stringify(patch))
    await assert.rejects(f.call(name, key, {}, 'other'), mismatch)
    await assert.rejects(f.call(name === 'recordContractPayment' ? 'recordRefund' : 'recordContractPayment', key), mismatch)
    assert.deepEqual(await f.inspect(), before)
  })

  test(`real Firestore: ${name} expected balance fences distinct stale form keys`, async () => {
    const f = await fixture()
    const result = await Promise.allSettled([f.call(name, randomUUID(), { expectedPaidAmount: 400000 }), f.call(name, randomUUID(), { expectedPaidAmount: 400000 })])
    assert.equal(result.filter(row => row.status === 'fulfilled').length, 1)
    assert.ok(result.some(row => row.status === 'rejected' && changedBalance(row.reason)))
    assert.equal((await f.inspect()).ledger, 1)
    for (const expectedPaidAmount of [null, -1, 1.2, '400000']) await assert.rejects(f.call(name, randomUUID(), { expectedPaidAmount }), error => error.code === 'invalid-argument')
    assert.equal((await f.inspect()).ledger, 1)
  })

  test(`real Firestore: ${name} committed replay survives changed balances, locked periods and inactive funds`, async () => {
    const f = await fixture(), key = randomUUID()
    const original = await f.call(name, key, { expectedPaidAmount: 400000 })
    await f.db.doc('financePeriods/2026-10').set({ status: 'locked' })
    await f.db.doc('cashAccounts/example').update({ status: 'inactive' })
    const before = await f.inspect()
    const replay = await f.call(name, key, { expectedPaidAmount: 400000 })
    assert.equal(replay.entryId, original.entryId)
    assert.equal(replay.unchanged, true)
    await assert.rejects(f.call(name, randomUUID()), error => error.code === 'failed-precondition')
    await assert.rejects(f.call(name, key, { expectedPaidAmount: 400000 }, 'student'), error => error.code === 'permission-denied')
    await f.db.doc('users/admin').update({ disabled: true })
    await assert.rejects(f.call(name, key, { expectedPaidAmount: 400000 }), error => error.code === 'permission-denied')
    assert.deepEqual(await f.inspect(), before)
  })
}

test('real Firestore: a shared key cannot post to two independent contracts and cash accounts', async () => {
  const f = await fixture(), key = randomUUID()
  const results = await Promise.allSettled([
    f.call('recordContractPayment', key),
    f.call('recordContractPayment', key, { contractId: 'other', cashAccountId: 'other' }, 'other'),
  ])
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1)
  assert.ok(results.some(row => row.status === 'rejected' && mismatch(row.reason)))
  assert.equal((await f.inspect()).ledger, 1)
  assert.equal((await f.inspect()).movements, 1)
})

test('real Firestore: bounded legacy lookup preserves valid replays and refuses ambiguous keys', async () => {
  const f = await fixture(), key = randomUUID()
  const value = { ...f.input, type: 'payment', idempotencyKey: key, effectiveAt: Timestamp.fromDate(new Date(f.input.effectiveAt)), createdBy: 'admin', status: 'posted', referenceCode: 'LEGACY' }
  await f.db.doc('ledgerEntries/legacy-random-id').set(value)
  const before = await f.inspect()
  const result = await f.call('recordContractPayment', key)
  assert.equal(result.entryId, 'legacy-random-id')
  assert.equal(result.unchanged, true)
  assert.deepEqual(await f.inspect(), before)
  await assert.rejects(f.call('recordContractPayment', key, { amount: 50000 }), mismatch)
  await f.db.doc('ledgerEntries/legacy-second-id').set(value)
  await assert.rejects(f.call('recordContractPayment', key), error => error.code === 'failed-precondition' && error.details?.reason === 'finance-replay-ambiguous')
  assert.equal((await f.inspect()).ledger, 2)
  assert.equal((await f.inspect()).movements, 0)
})

test('real Firestore: legacy refunds and reversals replay without creating replacement entries', async () => {
  const f = await fixture(), refundKey = randomUUID(), reverseKey = randomUUID()
  const payment = await f.call('recordContractPayment', randomUUID())
  await f.db.doc(`ledgerEntries/${payment.entryId}`).update({ status: 'reversed' })
  await f.db.doc('ledgerEntries/legacy-refund').set({ ...f.input, type: 'refund', amount: -f.input.amount, idempotencyKey: refundKey, effectiveAt: Timestamp.fromDate(new Date(f.input.effectiveAt)), createdBy: 'admin', status: 'posted' })
  await f.db.doc('ledgerEntries/legacy-reversal').set({ type: 'reversal', idempotencyKey: reverseKey, createdBy: 'admin', reversedEntryId: payment.entryId, reason: 'Legacy reversal', status: 'posted' })
  const before = await f.inspect()
  assert.equal((await f.call('recordRefund', refundKey)).entryId, 'legacy-refund')
  assert.equal((await f.call('reverseContractPayment', reverseKey, { entryId: payment.entryId, reason: 'Legacy reversal' })).entryId, 'legacy-reversal')
  await assert.rejects(f.call('recordRefund', refundKey, { reason: 'Changed legacy refund' }), mismatch)
  await assert.rejects(f.call('reverseContractPayment', reverseKey, { entryId: payment.entryId, reason: 'Different reversal' }), mismatch)
  assert.deepEqual(await f.inspect(), before)
})

test('real Firestore: replay comparison uses the accepted normalized note and timestamp', async () => {
  const f = await fixture(), key = randomUUID()
  const first = await f.call('recordContractPayment', key)
  const replay = await f.call('recordContractPayment', key, { note: '  Synthetic \n collection  ', effectiveAt: '2026-10-25T19:00:00+07:00' })
  assert.equal(replay.entryId, first.entryId)
  assert.equal(replay.unchanged, true)
  assert.equal((await f.inspect()).ledger, 1)
})

test('real Firestore: expected total paid is not capped to the per-payment amount limit', async () => {
  const f = await fixture()
  await f.db.doc('contracts/example').update({ totalPrice: 2000000000, paidAmount: 1200000000 })
  const key = randomUUID()
  const payment = await f.call('recordContractPayment', key, { expectedPaidAmount: 1200000000 })
  assert.equal((await f.inspect()).paid, 1200100000)
  assert.equal((await f.call('recordContractPayment', key, { expectedPaidAmount: 1200000000 })).entryId, payment.entryId)
})

test('real Firestore: initial-registration stable keys preserve their first timestamp only', async () => {
  for (const legacy of [false, true]) {
    const f = await fixture(), key = 'initial-payment:example'
    if (legacy) await f.db.doc('ledgerEntries/legacy-initial').set({ ...f.input, type: 'payment', idempotencyKey: key, effectiveAt: Timestamp.fromDate(new Date(f.input.effectiveAt)), createdBy: 'admin', status: 'posted' })
    const result = await f.call('recordContractPayment', key)
    const before = await f.inspect()
    const replay = await f.call('recordContractPayment', key, { effectiveAt: '2026-11-01T12:00:00Z' })
    assert.equal(replay.entryId, result.entryId)
    assert.equal(replay.unchanged, true)
    assert.equal((await f.db.doc(`ledgerEntries/${result.entryId}`).get()).data().effectiveAt.toMillis(), Date.parse(f.input.effectiveAt))
    await assert.rejects(f.call('recordContractPayment', key, { amount: 50000 }), mismatch)
    await assert.rejects(f.call('recordContractPayment', key, {}, 'other'), mismatch)
    assert.deepEqual(await f.inspect(), before)
  }
})

test('real Firestore: reversal replays bind reason, actor, operation and original entry', async () => {
  const f = await fixture(), paymentKey = randomUUID(), reverseKey = randomUUID()
  const payment = await f.call('recordContractPayment', paymentKey)
  const data = { entryId: payment.entryId, reason: 'Synthetic reversal' }
  await assert.rejects(f.call('reverseContractPayment', paymentKey, data), mismatch)
  const result = await f.call('reverseContractPayment', reverseKey, data)
  const before = await f.inspect()
  assert.deepEqual(before, { paid: 400000, cash: 1000000, ledger: 2, movements: 2, journals: 2, vouchers: 2, commissions: 0 })
  const replay = await f.call('reverseContractPayment', reverseKey, data)
  assert.equal(replay.entryId, result.entryId)
  assert.equal(replay.receiptVoucherId, result.receiptVoucherId)
  await assert.rejects(f.call('reverseContractPayment', reverseKey, { ...data, reason: 'Different reversal' }), mismatch)
  await assert.rejects(f.call('reverseContractPayment', reverseKey, data, 'other'), mismatch)
  const other = await f.call('recordContractPayment', randomUUID(), { contractId: 'other', cashAccountId: 'other' })
  await assert.rejects(f.call('reverseContractPayment', reverseKey, { ...data, entryId: other.entryId }), mismatch)
  await assert.rejects(f.call('reverseContractPayment', randomUUID(), data), error => error.code === 'already-exists')
  assert.equal((await f.call('recordContractPayment', paymentKey)).unchanged, true, 'replaying an already reversed collection never reposts it')
  assert.equal((await f.inspect()).ledger, 3)
})

test('real Firestore: installment state, vouchers and renewal commission reversal remain atomic', async () => {
  const f = await fixture(), payKey = randomUUID(), refundKey = randomUUID()
  await f.db.doc('contracts/example').update({ installments: [{ id: 'one', amount: 100000, date: '2026-10-25', status: 'pending' }], renewalCaseId: 'renewal-example' })
  await f.db.doc('contractRenewalCases/renewal-example').set({ collectedValue: 400000 })
  await f.db.doc('payrollEarningEvents/commission').set({ type: 'renew_commission', status: 'approved', originalRate: 5, attributionPercent: 100, sourceId: 'renewal-example', staffId: 'synthetic' })
  await f.db.doc('payrollRuns/2026-10').set({ status: 'locked' })
  const payment = await f.call('recordContractPayment', payKey, { installmentId: 'one' })
  assert.equal((await f.db.doc('contracts/example').get()).data().installments[0].status, 'paid')
  const refund = await f.call('recordRefund', refundKey, { installmentId: 'one' })
  assert.equal((await f.call('recordRefund', refundKey, { installmentId: 'one' })).entryId, refund.entryId)
  assert.equal((await f.db.doc('contracts/example').get()).data().installments[0].status, 'pending')
  assert.equal((await f.db.doc('contractRenewalCases/renewal-example').get()).data().collectedValue, 400000)
  assert.deepEqual(await f.inspect(), { paid: 400000, cash: 1000000, ledger: 2, movements: 2, journals: 2, vouchers: 1, commissions: 2 })
  const commission = (await f.db.doc(`payrollEarningEvents/reversal_${refund.entryId}_commission`).get()).data()
  assert.equal(commission.periodId, '2026-11')
  assert.equal(commission.signedAmount, -5000)
  const receipt = (await f.db.doc(`accountingDocuments/${payment.receiptVoucherId}`).get()).data()
  assert.equal(receipt.ledgerEntryId, payment.entryId)
  assert.equal(receipt.totalCredit, receipt.totalDebit)
  for (const journal of (await f.db.collection('journalEntries').get()).docs) assert.equal(journal.data().totalDebit, journal.data().totalCredit)
})

test('real Firestore: an unposted payment cannot be reversed into a cash outflow', async () => {
  const f = await fixture()
  const payment = await f.call('recordContractPayment', randomUUID())
  await f.db.doc(`ledgerEntries/${payment.entryId}`).update({ status: 'pending' })
  const before = await f.inspect()
  await assert.rejects(f.call('reverseContractPayment', randomUUID(), { entryId: payment.entryId }),
    error => error.code === 'failed-precondition' && /đã ghi sổ/.test(error.message))
  assert.deepEqual(await f.inspect(), before)
  assert.equal((await f.db.doc(`ledgerEntries/${payment.entryId}`).get()).data().status, 'pending')
})

test('real Firestore: a partial refund blocks reversal beyond the remaining paid balance', async () => {
  const f = await fixture()
  const payment = await f.call('recordContractPayment', randomUUID(), { amount: 500000 })
  await f.call('recordRefund', randomUUID(), { amount: 600000 })
  const before = await f.inspect()
  assert.equal(before.paid, 300000)
  await assert.rejects(f.call('reverseContractPayment', randomUUID(), { entryId: payment.entryId }),
    error => error.code === 'failed-precondition' && error.details?.reason === 'finance-reversal-exceeds-paid')
  assert.deepEqual(await f.inspect(), before)
  assert.equal((await f.db.doc(`ledgerEntries/${payment.entryId}`).get()).data().status, 'posted')
})

test('real Firestore: a concurrent refund and reversal cannot exceed the contract paid balance', async () => {
  const f = await fixture()
  await f.db.doc('contracts/example').update({ paidAmount: 0 })
  const first = await f.call('recordContractPayment', randomUUID(), { amount: 500000 })
  await f.call('recordContractPayment', randomUUID(), { amount: 500000 })
  const before = await f.inspect()
  const results = await Promise.allSettled([
    f.call('recordRefund', randomUUID(), { amount: 600000 }),
    f.call('reverseContractPayment', randomUUID(), { entryId: first.entryId }),
  ])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'failed-precondition').length, 1)
  const after = await f.inspect()
  assert.ok([400000, 500000].includes(after.paid))
  assert.equal(after.ledger, before.ledger + 1)
  assert.equal(after.movements, before.movements + 1)
  assert.equal(after.cash - before.cash, after.paid - before.paid)
})

test('real Firestore: cash settlement uses posted recognition instead of consumed sessions', async () => {
  for (const [operation, expectedReceivable, expectedDeferred] of [
    ['recordContractPayment', 0, 100000],
    ['recordRefund', 0, -100000],
  ]) {
    const f = await fixture()
    await f.db.doc('contracts/example').update({ usedSessions: 8 })
    await f.db.doc('ledgerEntries/confirmed-service').set({ contractId: 'example', type: 'revenue_recognition', status: 'posted', amount: 200000, revenueImpact: 200000 })
    await f.db.doc('ledgerEntries/unconfirmed-service').set({ contractId: 'example', type: 'revenue_recognition', status: 'pending', amount: 500000, revenueImpact: 500000 })
    const result = await f.call(operation, randomUUID())
    const ledger = (await f.db.doc(`ledgerEntries/${result.entryId}`).get()).data()
    assert.ok(ledger.receivableImpact === expectedReceivable)
    assert.equal(ledger.deferredRevenueImpact, expectedDeferred)
    const journal = (await f.db.doc(`journalEntries/${ledger.journalEntryId}`).get()).data()
    assert.equal(journal.totalDebit, journal.totalCredit)
  }
})

test('real Firestore: posted recognition corrections determine the receivable settlement', async () => {
  const f = await fixture()
  await f.db.doc('ledgerEntries/old-service').set({ contractId: 'example', type: 'revenue_recognition', status: 'reversed', amount: 700000, revenueImpact: 700000 })
  await f.db.doc('ledgerEntries/correction').set({ contractId: 'example', type: 'reversal', status: 'posted', amount: -100000, revenueImpact: -100000, cashImpact: 0 })
  const result = await f.call('recordContractPayment', randomUUID())
  const ledger = (await f.db.doc(`ledgerEntries/${result.entryId}`).get()).data()
  assert.equal(ledger.receivableImpact, -100000)
  assert.equal(ledger.deferredRevenueImpact, 0)
})

test('real Firestore: distinct accepted operations retain distinct reference and voucher identities', async () => {
  const f = await fixture()
  const a = await f.call('recordContractPayment', randomUUID())
  const b = await f.call('recordContractPayment', randomUUID())
  assert.notEqual(a.entryId, b.entryId)
  assert.notEqual(a.referenceCode, b.referenceCode)
  assert.notEqual(a.receiptVoucherNumber, b.receiptVoucherNumber)
  assert.match(a.referenceCode, /-[A-F0-9]{16}$/)
  assert.match(a.receiptVoucherNumber, /-[A-F0-9]{16}$/)
  assert.equal((await f.db.collection('ledgerEntries').where('idempotencyKey', '==', (await f.db.doc(`ledgerEntries/${a.entryId}`).get()).data().idempotencyKey).get()).docs[0].id, a.entryId, 'older query-based readers still find new canonical records')
})

test('real Firestore: cancelled contracts require approved settlement for new cash but existing receipts remain replayable', async () => {
  const f = await fixture(), key = intentKey()
  const posted = await f.intent('submit', 'payment', key)
  await f.db.doc('contracts/example').update({ status: 'cancelled' })
  const before = await f.inspect()
  for (const type of ['payment', 'refund']) {
    await assert.rejects(f.intent('submit', type, intentKey(), { expectedPaidAmount: 500000 }),
      error => error.details?.reason === 'contract-settlement-required')
  }
  assert.equal((await f.intent('submit', 'payment', key)).receipt.entryId, posted.receipt.entryId)
  assert.deepEqual(await f.inspect(), before)
})

test('real Firestore: cancelled review permits receipt correction without reviving a cancelled installment', async () => {
  const f = await fixture(), key = intentKey()
  await f.db.doc('contracts/example').update({ installments: [{ id: 'one', amount: 100000, date: '2026-10-25', status: 'pending' }] })
  const payment = await f.call('recordContractPayment', randomUUID(), { installmentId: 'one' })
  await f.db.doc('contracts/example').update({ status: 'cancelled', cancellationSettlement: { schemaVersion: 1, status: 'review_required', revision: 0 },
    installments: [{ id: 'one', amount: 100000, date: '2026-10-25', status: 'cancelled' }], nextPaymentDate: null })
  const reversed = await f.intent('submit', 'reversal', key, { entryId: payment.entryId })
  assert.equal(reversed.state, 'committed')
  const contract = (await f.db.doc('contracts/example').get()).data()
  assert.equal(contract.paidAmount, 400000)
  assert.equal(contract.installments[0].status, 'cancelled')
  assert.equal(contract.nextPaymentDate, null)
  await f.db.doc('contracts/example').update({ 'cancellationSettlement.status': 'approved' })
  assert.equal((await f.intent('submit', 'reversal', key, { entryId: payment.entryId })).receipt.entryId, reversed.receipt.entryId)
})

test('real Firestore: pending and approved settlement cases block receipt reversal even with a stale contract summary', async () => {
  const f = await fixture()
  const payment = await f.call('recordContractPayment', randomUUID())
  await f.db.doc('contracts/example').update({ status: 'cancelled', cancellationSettlement: { schemaVersion: 1, status: 'review_required', revision: 0 } })
  const before = await f.inspect()
  for (const status of ['pending_approval', 'approved', 'settled']) {
    await f.db.doc('contractSettlements/example').set({ status, revision: 1 })
    await assert.rejects(f.intent('submit', 'reversal', intentKey(), { entryId: payment.entryId }),
      error => error.details?.reason === 'contract-settlement-reversal-blocked')
    assert.deepEqual(await f.inspect(), before)
  }
})

async function approvedSettlementFixture({ paidAmount = 400000, writeOffAmount = 0 } = {}) {
  const f = await fixture()
  const batch = f.db.batch()
  batch.update(f.db.doc('contracts/example'), { totalPrice: 1200000, usedSessions: 6, paidAmount, status: 'cancelled', cancelledAt: '2026-10-25T10:00:00Z',
    installments: [{ id: 'old', amount: 1200000 - paidAmount, date: '2026-10-25', status: 'cancelled' }], nextPaymentDate: null })
  batch.set(f.db.doc('ledgerEntries/settlement-initial-payment'), { contractId: 'example', type: 'payment', source: 'pt_gym', status: 'posted', amount: paidAmount, cashImpact: paidAmount, revenueImpact: 0, effectiveAt: Timestamp.fromDate(new Date('2026-10-01T10:00:00Z')) })
  for (let ordinal = 1; ordinal <= 6; ordinal += 1) {
    const sessionId = `service-${ordinal}`, recognitionId = `pt_session_${sessionId}`
    batch.set(f.db.doc(`sessions/${sessionId}`), { contractId: 'example', studentId: 'example', branchId: 'example', status: 'completed', billingStatus: 'charged', attendanceStatus: 'present', date: '2026-10-20', hour: ordinal + 8, serviceOrdinal: ordinal, revenueRecognitionEntryId: recognitionId })
    batch.set(f.db.doc(`ledgerEntries/${recognitionId}`), { contractId: 'example', type: 'revenue_recognition', eventClass: 'revenue_recognition', source: 'pt_gym', status: 'posted', sessionId, serviceOrdinal: ordinal, amount: 100000, revenueImpact: 100000, cashImpact: 0, effectiveAt: Timestamp.fromDate(new Date('2026-10-20T10:00:00Z')) })
  }
  await batch.commit()
  const handlers = createContractSettlementFunctions({ db: f.db, onCall: handler => handler, logger: { info() {} } })
  const get = () => handlers.getContractSettlement({ auth: { uid: 'admin', token: { role: 'admin' } }, data: { contractId: 'example', cutoffDate: '2026-10-25' } })
  const manage = (action, current, proposal) => handlers.manageContractSettlement({ auth: { uid: 'admin', token: { role: 'admin' } }, data: { contractId: 'example', action, operationId: randomUUID(), expectedRevision: current.revision, expectedSnapshotHash: current.preview.snapshotHash, ...(proposal ? { proposal } : {}) } })
  const first = await get()
  assert.deepEqual(first.preview.blockers, [])
  const submitted = await manage('submit', first, { cutoffDate: '2026-10-25', reason: 'Synthetic settlement', waivedFutureAmount: 600000, feeAmount: 0, serviceReductionAmount: 0, writeOffAmount, writeOffReason: writeOffAmount ? 'Approved earned debt writeoff' : '', effectiveAt: '2026-10-25T10:00:00Z' })
  const approved = await manage('approve', submitted)
  assert.equal(approved.status, 'approved')
  return { ...f, getSettlement: get, manageSettlement: manage, approved }
}

test('real Firestore: approved earned-debt settlement collects only the post-writeoff target and closes explicitly', async () => {
  const f = await approvedSettlementFixture({ writeOffAmount: 100000 }), key = intentKey()
  const patch = { expectedPaidAmount: 400000, expectedSettlementRevision: f.approved.revision, amount: 100000 }
  const result = await f.intent('submit', 'payment', key, patch)
  const contract = (await f.db.doc('contracts/example').get()).data()
  const caseData = (await f.db.doc('contractSettlements/example').get()).data()
  assert.equal(contract.paidAmount, 500000)
  assert.equal(contract.cancellationSettlement.status, 'approved')
  assert.equal(caseData.status, 'approved')
  assert.equal(caseData.remainingReceivable, 0)
  assert.equal(caseData.refundDue, 0)
  assert.equal(caseData.revision, f.approved.revision + 1)
  assert.equal(contract.cancellationSettlement.revision, caseData.revision)
  assert.equal(contract.installments[0].status, 'cancelled')
  assert.equal(contract.nextPaymentDate, null)
  const ledger = (await f.db.doc(`ledgerEntries/${result.receipt.entryId}`).get()).data()
  assert.equal(ledger.receivableImpact, -100000)
  assert.equal(ledger.deferredRevenueImpact, 0)
  assert.equal(ledger.requestExpectedSettlementRevision, f.approved.revision)
  const before = await f.inspect()
  assert.equal((await f.intent('submit', 'payment', key, patch)).receipt.entryId, result.receipt.entryId)
  await assert.rejects(f.intent('submit', 'payment', key, { ...patch, expectedSettlementRevision: f.approved.revision + 1 }), mismatch)
  await assert.rejects(f.intent('submit', 'payment', intentKey(), { amount: 1, expectedPaidAmount: 500000, expectedSettlementRevision: caseData.revision }), error => error.details?.reason === 'contract-settlement-cash-limit')
  const closed = await f.manageSettlement('close', await f.getSettlement())
  assert.equal(closed.status, 'settled')
  assert.deepEqual(await f.inspect(), before, 'explicit closure changes no cash or ledger totals')
  assert.equal((await f.intent('submit', 'payment', key, patch)).receipt.entryId, result.receipt.entryId, 'lost response remains replayable after closure')
})

test('real Firestore: settlement refund preserves earned revenue and cancelled installments, with one effect across stale concurrent intents', async () => {
  const f = await approvedSettlementFixture({ paidAmount: 800000 })
  const patch = { amount: 200000, expectedPaidAmount: 800000, expectedSettlementRevision: f.approved.revision }
  const keys = [intentKey(), intentKey()]
  const before = await f.inspect()
  const results = await Promise.allSettled(keys.map(key => f.intent('submit', 'refund', key, patch)))
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1, JSON.stringify(results.map(row => row.status === 'rejected' ? { code: row.reason.code, message: row.reason.message, details: row.reason.details } : row.status)))
  assert.equal(results.filter(row => row.status === 'rejected' && ['failed-precondition', 'aborted', 10].includes(row.reason.code)).length, 1)
  const winningIndex = results.findIndex(row => row.status === 'fulfilled')
  const receipt = results[winningIndex].value.receipt
  assert.equal((await f.intent('submit', 'refund', keys[winningIndex], patch)).receipt.entryId, receipt.entryId)
  const contract = (await f.db.doc('contracts/example').get()).data()
  assert.equal(contract.paidAmount, 600000)
  assert.equal(contract.cancellationSettlement.refundDue, 0)
  assert.equal(contract.cancellationSettlement.recognizedRevenueAfterAdjustments, 600000)
  assert.equal(contract.installments[0].status, 'cancelled')
  assert.equal(contract.nextPaymentDate, null)
  const ledger = (await f.db.doc(`ledgerEntries/${receipt.entryId}`).get()).data()
  assert.equal(ledger.revenueImpact, 0)
  assert.equal(ledger.receivableImpact, 0)
  assert.equal(ledger.deferredRevenueImpact, -200000)
  const after = await f.inspect()
  assert.equal(after.ledger, before.ledger + 1)
  assert.equal(after.movements, before.movements + 1)
  assert.equal(after.cash, before.cash - 200000)
})

test('real Firestore: settlement cash refuses stale evidence, projection drift, old installment and old revision before financial writes', async () => {
  const f = await approvedSettlementFixture()
  const patch = { expectedPaidAmount: 400000, expectedSettlementRevision: f.approved.revision }
  const before = await f.inspect()
  await assert.rejects(f.intent('submit', 'payment', intentKey(), { ...patch, expectedSettlementRevision: undefined }), error => error.details?.reason === 'contract-settlement-revision-changed')
  await assert.rejects(f.intent('submit', 'payment', intentKey(), { ...patch, installmentId: 'old' }), error => error.details?.reason === 'contract-settlement-installment')
  for (const value of [null, -1, 1.5, '2']) await assert.rejects(f.intent('submit', 'payment', intentKey(), { ...patch, expectedSettlementRevision: value }), error => error.code === 'invalid-argument')
  await f.db.doc('sessions/service-1').update({ hour: 20 })
  await assert.rejects(f.intent('submit', 'payment', intentKey(), patch), error => error.details?.reason === 'contract-settlement-evidence-changed')
  await f.db.doc('sessions/service-1').update({ hour: 9 })
  await f.db.doc('ledgerEntries/settlement-initial-payment').update({ amount: 300000, cashImpact: 300000 })
  await assert.rejects(f.intent('submit', 'payment', intentKey(), patch), error => error.details?.reason === 'contract-settlement-cash-mismatch')
  await f.db.doc('ledgerEntries/settlement-initial-payment').update({ amount: 400000, cashImpact: 400000 })
  await f.db.doc('financePeriods/2026-10').set({ status: 'locked' })
  await assert.rejects(f.intent('submit', 'payment', intentKey(), patch), error => error.code === 'failed-precondition' && /đã khóa/.test(error.message))
  assert.deepEqual(await f.inspect(), before)
  assert.equal((await f.db.doc('contractSettlements/example').get()).data().revision, f.approved.revision)
})

test('real Firestore: cancelled attendance and teaching corrections repair pre-cutoff evidence only before submission, while true retries stay unchanged', async () => {
  const f = await fixture()
  const batch = f.db.batch()
  batch.update(f.db.doc('contracts/example'), { status: 'cancelled' })
  for (const trainerId of ['trainer-1', 'trainer-2']) batch.set(f.db.doc(`trainers/${trainerId}`), { status: 'active', branchId: 'example', slotCapacity: 2 })
  batch.set(f.db.doc('sessions/cancelled-evidence'), { contractId: 'example', studentId: 'example', trainerId: 'trainer-1', branchId: 'example',
    status: 'scheduled', billingStatus: 'charged', attendanceStatus: 'pending', date: '2026-10-20', hour: 9, serviceOrdinal: 1, revision: 0, attendanceEventId: 'cancelled-evidence' })
  batch.set(f.db.doc('attendanceEvents/cancelled-evidence'), { sessionId: 'cancelled-evidence', contractId: 'example', studentId: 'example', trainerId: 'trainer-1',
    billingStatus: 'charged', attendanceStatus: 'pending', serviceOrdinal: 1 })
  batch.set(f.db.doc('sessionBillingEvents/cancelled-evidence'), { sessionId: 'cancelled-evidence', contractId: 'example', serviceOrdinal: 1, billingStatus: 'charged' })
  await batch.commit()
  const attendance = (overrides = {}) => recordSessionAttendanceTransaction({ db: f.db, sessionId: 'cancelled-evidence', expectedRevision: 0, actorUid: 'admin', attendanceStatus: 'present', now: new Date('2026-10-30T03:00:00Z'), ...overrides })
  await assert.rejects(attendance(), error => error.details?.issueCode === 'CONTRACT_CANCELLATION_CUTOFF_REQUIRED')
  assert.equal((await f.db.collection('ledgerEntries').get()).size, 0)
  await f.db.doc('contracts/example').update({ cancelledAt: '2026-10-19T10:00:00Z' })
  await assert.rejects(attendance(), error => error.details?.issueCode === 'CONTRACT_CANCELLATION_SERVICE_AFTER_CUTOFF')
  await f.db.doc('contracts/example').update({ cancelledAt: '2026-10-25T10:00:00Z', cancellationSettlement: { status: 'review_required', cutoffDate: '2026-10-25' } })
  assert.equal((await attendance()).unchanged, false)
  const operations = createSessionOperationFunctions({ db: f.db, onCall: (...args) => args.at(-1), authorizeAdmin: async () => ({ uid: 'admin', accessRole: 'admin' }), now: () => new Date('2026-10-30T03:00:00Z') })
  const correction = (overrides = {}) => operations.correctTeachingShift({ data: { items: [{ sessionId: 'cancelled-evidence', expectedRevision: 1, attendanceStatus: 'present' }],
    date: '2026-10-20', hour: 9, trainerId: 'trainer-1', reason: 'Synthetic evidence correction', ...overrides } })
  const before = await f.inspect()
  for (const status of ['pending_approval', 'approved', 'settled']) {
    await f.db.doc('contracts/example').update({ cancellationSettlement: { status, cutoffDate: '2026-10-25' } })
    assert.equal((await attendance({ expectedRevision: 1 })).unchanged, true)
    assert.equal((await correction()).unchanged, true)
    await assert.rejects(attendance({ expectedRevision: 1, note: 'Changed evidence' }), error => error.details?.issueCode === 'CONTRACT_SETTLEMENT_EVIDENCE_LOCKED')
    await assert.rejects(correction({ trainerId: 'trainer-2' }), error => error.details?.issueCode === 'CONTRACT_SETTLEMENT_EVIDENCE_LOCKED')
    assert.deepEqual(await f.inspect(), before)
    assert.equal((await f.db.doc('sessions/cancelled-evidence').get()).data().revision, 1)
  }
})
