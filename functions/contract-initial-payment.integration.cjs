'use strict'
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { createStudent360Functions, vietnamDateKey } = require('./student-360')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `initial-payment-${randomUUID()}`)
const clients = []
const today = vietnamDateKey()
const day = n => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const logger = { info() {}, warn() {}, error() {} }
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })

async function fixture(rows = {}) {
  const db = getFirestore(app, `initial-payment-${randomUUID()}`); clients.push(db)
  const batch = db.batch()
  for (const [path, value] of Object.entries({
    'users/admin': { role: 'admin', name: 'Test admin' },
    'students/student': { name: 'Test learner', branchId: 'branch' },
    'branches/branch': { name: 'Test branch' },
    'packages/package': { name: 'PT package', branchId: 'branch', price: 12_000_000, totalSessions: 36, durationMonths: 3 },
    'cashAccounts/bank': { name: 'Test bank', type: 'bank', branchId: 'branch', status: 'active', balance: 0 },
    ...rows,
  })) batch.set(db.doc(path), value)
  await batch.commit()
  return db
}
const callFor = db => {
  const api = createStudent360Functions({ db, onCall: (_options, handler) => handler, logger })
  return data => api.mutateStudent360Contract({ auth: { uid: 'admin', token: { role: 'admin' } }, data })
}
const input = () => ({
  action: 'create', studentId: 'student', contractId: 'new-contract',
  initialPayment: { amount: 3_000_000, cashAccountId: 'bank', paymentMethod: 'transfer' },
  contract: { packageId: 'package', branchId: 'branch', startDate: today, endDate: day(90), totalSessions: 36,
    totalPrice: 12_000_000, discount: 1_000_000, trainerIds: [], nutritionPTIds: [],
    installments: [2_000_000, 2_000_000, 4_000_000].map((amount, i) => ({ id: `period-${i}`, date: day((i + 1) * 20), amount, status: 'pending' })),
  },
})
const data = async (db, path) => (await db.doc(path).get()).data()
async function assertNoCollection(db) {
  assert.equal((await db.doc('contracts/new-contract').get()).exists, false)
  for (const collection of ['ledgerEntries', 'accountingDocuments', 'cashTransactions', 'journalEntries', 'contractMutationReceipts']) assert.equal((await db.collection(collection).get()).size, 0, collection)
  assert.equal((await data(db, 'cashAccounts/bank')).balance, 0)
}

test('upfront creation atomically posts one receipt, cash movement and unequal remaining installments, including concurrent replay', async () => {
  const db = await fixture(), call = callFor(db), command = input()
  // A cold projection can ask one caller to retry before reaching the write.
  // Replaying that same command must still resolve to the one committed receipt.
  const first = await Promise.allSettled([call(command), call(structuredClone(command))])
  assert.ok(first.some(result => result.status === 'fulfilled'))
  for (const result of first) if (result.status === 'rejected') assert.equal(result.reason.code, 'unavailable')
  const responses = await Promise.all([call(command), call(structuredClone(command))])
  assert.deepEqual(responses[0], responses[1])
  const result = responses[0], contract = await data(db, 'contracts/new-contract')
  assert.equal(contract.paidAmount, 3_000_000)
  assert.deepEqual(contract.installments, command.contract.installments)
  assert.equal(contract.nextPaymentDate, day(20))
  assert.equal((await data(db, 'cashAccounts/bank')).balance, 3_000_000)
  const receipt = await data(db, `accountingDocuments/${result.receiptVoucherId}`)
  assert.equal(receipt.totalAmount, 3_000_000)
  assert.equal(receipt.contractId, 'new-contract')
  assert.equal(receipt.payerName, 'Test learner')
  assert.equal(receipt.paymentMethod, 'transfer')
  const journal = await data(db, `journalEntries/${result.paymentEntryId}`)
  assert.equal(journal.totalDebit, journal.totalCredit)
  assert.equal(journal.totalDebit, 3_000_000)
  assert.equal((await data(db, `cashTransactions/ledger_${result.paymentEntryId}`)).accountingDocumentId, result.receiptVoucherId)
  for (const collection of ['ledgerEntries', 'accountingDocuments', 'cashTransactions', 'journalEntries', 'contracts']) assert.equal((await db.collection(collection).get()).size, 1, collection)
  assert.deepEqual(await call(command), result)
  const changed = structuredClone(command); changed.initialPayment.amount++
  await assert.rejects(call(changed), { code: 'already-exists' })
  assert.equal((await data(db, 'cashAccounts/bank')).balance, 3_000_000)
})

test('full payment produces no pending periods; zero upfront produces no receipt', async () => {
  for (const amount of [0, 11_000_000]) {
    const db = await fixture(), command = input()
    command.initialPayment.amount = amount
    command.contract.installments = amount ? [] : [{ id: 'all', date: day(20), amount: 11_000_000, status: 'pending' }]
    const result = await callFor(db)(command)
    const contract = await data(db, 'contracts/new-contract')
    assert.equal(contract.paidAmount, amount)
    assert.equal(contract.installments.length, amount ? 0 : 1)
    assert.equal((await db.collection('accountingDocuments').get()).size, amount ? 1 : 0)
    assert.equal(Boolean(result.receiptVoucherId), Boolean(amount))
  }
})

test('invalid collection amount, mismatched allocation, inactive/wrong-branch funds and locked period cannot create partial records', async () => {
  const cases = [
    { update: command => { command.initialPayment.amount = 12_000_000 } },
    { update: command => { command.initialPayment.amount = -1 } },
    { update: command => { command.initialPayment.amount = 1.5 } },
    { update: command => { command.contract.installments[0].amount-- } },
    { rows: { 'cashAccounts/bank': { type: 'bank', branchId: 'other', status: 'active', balance: 0 } } },
    { rows: { 'cashAccounts/bank': { type: 'bank', branchId: 'branch', status: 'inactive', balance: 0 } } },
    { rows: { [`financePeriods/${today.slice(0, 7)}`]: { status: 'locked' } } },
  ]
  for (const scenario of cases) {
    const db = await fixture(scenario.rows), command = input(); scenario.update?.(command)
    await assert.rejects(callFor(db)(command))
    await assertNoCollection(db)
  }
})

test('receipt write failure rolls back the contract, audit and cash together', async () => {
  const db = await fixture()
  const failing = new Proxy(db, { get(target, key) {
    if (key === 'runTransaction') return work => target.runTransaction(tx => work(new Proxy(tx, { get(transaction, method) {
      if (method === 'create') return (reference, value) => { if (reference.path.startsWith('accountingDocuments/')) throw new Error('Receipt unavailable'); return transaction.create(reference, value) }
      const value = Reflect.get(transaction, method, transaction); return typeof value === 'function' ? value.bind(transaction) : value
    } })))
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value
  } })
  await assert.rejects(callFor(failing)(input()), /Receipt unavailable/)
  await assertNoCollection(db)
  assert.equal((await db.collection('contractAuditLogs').get()).size, 0)
})

test('payment-only editing preserves paid periods and trainer history while rejecting stale or unbalanced changes', async () => {
  const db = await fixture(), call = callFor(db)
  await call(input())
  const paid = { id: 'collected', date: today, amount: 1_000_000, status: 'paid' }
  await db.doc('contracts/new-contract').update({ paidAmount: 4_000_000, trainerIds: ['retired-pt'], installments: [paid, { id: 'remaining', date: day(20), amount: 7_000_000, status: 'pending' }] })
  const command = { studentId: 'student', contractId: 'new-contract', action: 'edit_payment_plan', expectedRevision: 1,
    installments: [paid, { id: 'a', date: day(30), amount: 2_000_000, status: 'pending' }, { id: 'b', date: day(60), amount: 5_000_000, status: 'pending' }] }
  await call(command)
  const contract = await data(db, 'contracts/new-contract')
  assert.deepEqual(contract.trainerIds, ['retired-pt'])
  assert.equal(contract.paidAmount, 4_000_000)
  assert.equal(contract.nextPaymentDate, day(30))
  await assert.rejects(call(command), { code: 'aborted' })
  for (const installments of [command.installments.slice(1), command.installments.map(item => ({ ...item, amount: item.amount + 1 })), [paid, { id: 'bad', date: day(20), amount: 0, status: 'pending' }]]) {
    await assert.rejects(call({ ...command, expectedRevision: 2, installments }))
  }
  assert.deepEqual((await data(db, 'contracts/new-contract')).installments, command.installments)
})
