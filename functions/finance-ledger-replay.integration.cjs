'use strict'

const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const { createFinanceLedgerFunctions } = require('./finance-ledger')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `finance-replay-${randomUUID()}`)
const databases = []
after(async () => {
  await Promise.all(databases.map(db => db.terminate()))
  await deleteApp(app)
})

async function fixture() {
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
    runTransaction: callback => db.runTransaction(transaction => callback(new Proxy(transaction, {
      get(target, name) {
        if (name === 'get') return async reference => {
          const result = await target.get(reference)
          reads.push({ path: reference.path || null, query: !reference.path, size: result.size ?? (result.exists ? 1 : 0) })
          return result
        }
        const value = target[name]
        return typeof value === 'function' ? value.bind(target) : value
      },
    }))),
  }
  const handlers = createFinanceLedgerFunctions({ db: observedDb, onCall: handler => handler })
  const input = { contractId: 'example', amount: 100000, effectiveAt: '2026-10-25T12:00:00Z', paymentMethod: 'transfer', cashAccountId: 'example', note: 'Synthetic collection', reason: 'Synthetic refund' }
  const call = (name, key, patch = {}, uid = 'admin') => handlers[name]({ auth: { uid, token: { role: uid === 'student' ? 'student' : 'admin' } }, data: { ...input, ...patch, idempotencyKey: key } })
  const inspect = async () => {
    const [contract, cash, ledger, movements, journals, vouchers, commissions] = await Promise.all([
      db.doc('contracts/example').get(), db.doc('cashAccounts/example').get(),
      ...['ledgerEntries', 'cashTransactions', 'journalEntries', 'accountingDocuments', 'payrollEarningEvents'].map(name => db.collection(name).get()),
    ])
    return { paid: contract.data().paidAmount, cash: cash.data().balance, ledger: ledger.size, movements: movements.size, journals: journals.size, vouchers: vouchers.size, commissions: commissions.size }
  }
  return { db, input, call, inspect, reads }
}
const mismatch = error => error.code === 'already-exists' && error.details?.reason === 'finance-replay-mismatch'
const changedBalance = error => error.code === 'failed-precondition' && error.details?.reason === 'finance-balance-changed'

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
