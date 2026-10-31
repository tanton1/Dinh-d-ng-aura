'use strict'

const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { createContractRenewalFunctions } = require('./contract-renewals')
const { createContractRenewalRegionalFunctions } = require('./contract-renewal-regional')

// Never allow these financial integration tests to connect to a live database.
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, 'renewal-transaction-tests')
const db = getFirestore(app)
const actor = { uid: 'test-admin', renewalScope: 'system', renewalCanSell: true, branchIds: [] }
const dependencies = { db, onCall: (_options, handler) => handler, resolveActor: async () => actor, logger: { info() {} } }
const legacy = createContractRenewalFunctions(dependencies)
const regional = createContractRenewalRegionalFunctions(dependencies)
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
const day = offset => new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10)

after(async () => { await db.terminate(); await deleteApp(app) })

async function fixture() {
  const key = randomUUID()
  const sourceId = `source-${key}`
  const studentId = `student-${key}`
  const packageId = `package-${key}`
  const cashAccountId = `bank-${key}`
  const batch = db.batch()
  batch.set(db.doc(`contracts/${sourceId}`), {
    studentId, packageId, packageName: 'Gói 3 Tháng', branchId: 'branch-a',
    status: 'active', startDate: day(-60), endDate: day(10), totalSessions: 36,
    usedSessions: 33, totalPrice: 9600000, paidAmount: 9600000, revision: 2,
    trainerIds: [], nutritionPTIds: [],
  })
  batch.set(db.doc(`contractRenewalCases/${sourceId}`), {
    sourceContractId: sourceId, studentId, branchId: 'branch-a', revision: 1,
    sessionsLeft: 3, active: true, stage: 'uncontacted', studentSnapshot: { name: 'Học viên kiểm thử' },
  })
  batch.set(db.doc(`packages/${packageId}`), {
    name: 'Gói 3 Tháng', branchId: 'branch-a', status: 'active', revision: 1,
    price: 9600000, durationMonths: 3, totalSessions: 36,
  })
  batch.set(db.doc(`cashAccounts/${cashAccountId}`), { type: 'bank', status: 'active', branchId: 'branch-a', balance: 0 })
  for (let index = 0; index < 33; index++) batch.set(db.doc(`sessions/${key}-${index}`), {
    contractId: sourceId, studentId, branchId: 'branch-a', date: day(index - 40),
    hour: 9, billingStatus: 'charged', status: 'completed', attendanceStatus: 'present',
  })
  await batch.commit()
  const quote = await legacy.createRenewalQuote({ data: { caseId: sourceId, packageId, expectedRevision: 1, discount: 0, carryOverSessions: 3 } })
  return {
    sourceId, studentId, cashAccountId,
    input: {
      caseId: sourceId, sourceContractId: sourceId, packageId, quoteId: quote.quoteId,
      expectedSourceRevision: 2, expectedCaseRevision: quote.revision,
      startDate: day(11), activationMode: 'automatic', idempotencyKey: key,
      carryOver: true, discount: 0, initialPayment: 9600000,
      paymentMethod: 'transfer', cashAccountId, installments: [], trainerIds: [], nutritionPTIds: [], note: '',
    },
  }
}

test('full-price regional renewal commits contract, receipt, ledger and cash once across retries and regions', async () => {
  const { sourceId, studentId, cashAccountId, input } = await fixture()
  const result = await regional.renewPtContractRegional({ data: input })
  assert.equal(result.unchanged, false)
  const [contract, source, renewalCase, quote, bank] = await db.getAll(
    db.doc(`contracts/${result.contractId}`), db.doc(`contracts/${sourceId}`),
    db.doc(`contractRenewalCases/${sourceId}`), db.doc(`quotes/${input.quoteId}`), db.doc(`cashAccounts/${cashAccountId}`),
  )
  assert.equal(contract.data().status, 'future')
  assert(require('./contract-sales-index').hasCurrentContractSalesIndex(contract.data()))
  assert.equal(contract.data().financeSalesIndex.key, today, 'future activation does not defer the new sale')
  assert.equal(contract.data().totalSessions, 36)
  assert.equal(contract.data().plannedCarryOverSessions, 3)
  assert.equal(contract.data().carriedOverSessions, 0)
  assert.equal(contract.data().paidAmount, 9600000)
  assert.equal(source.data().status, 'active')
  assert.equal(source.data().renewedByContractId, result.contractId)
  assert.equal(renewalCase.data().stage, 'won')
  assert.equal(quote.data().status, 'accepted')
  assert.equal(bank.data().balance, 9600000)
  const payment = await db.doc(`ledgerEntries/${result.paymentEntryId}`).get()
  const receipt = await db.doc(`accountingDocuments/${result.receiptVoucherId}`).get()
  const journal = await db.doc(`journalEntries/${result.paymentEntryId}`).get()
  const movement = await db.doc(`cashTransactions/ledger_${result.paymentEntryId}`).get()
  assert.equal(payment.data().amount, 9600000)
  assert.equal(receipt.data().totalAmount, 9600000)
  assert.equal(journal.data().totalDebit, journal.data().totalCredit)
  assert.equal(movement.data().amount, 9600000)
  const retries = await Promise.all([
    regional.renewPtContractRegional({ data: input }), legacy.renewPtContract({ data: input }),
  ])
  assert.ok(retries.every(retry => retry.unchanged && retry.contractId === result.contractId && retry.paymentEntryId === result.paymentEntryId))
  assert.equal((await db.collection('contracts').where('studentId', '==', studentId).get()).size, 2)
  assert.equal((await db.collection('ledgerEntries').where('studentId', '==', studentId).get()).size, 1)
  assert.equal((await db.doc(`cashAccounts/${cashAccountId}`).get()).data().balance, 9600000)
})

test('simultaneous legacy and regional confirmation produce one contract and one collection', async () => {
  const { studentId, cashAccountId, input } = await fixture()
  const results = await Promise.all([
    legacy.renewPtContract({ data: input }), regional.renewPtContractRegional({ data: input }),
  ])
  assert.equal(results[0].contractId, results[1].contractId)
  assert.equal(results.filter(result => result.unchanged === false).length, 1)
  assert.equal((await db.collection('contracts').where('studentId', '==', studentId).get()).size, 2)
  assert.equal((await db.collection('ledgerEntries').where('studentId', '==', studentId).get()).size, 1)
  assert.equal((await db.doc(`cashAccounts/${cashAccountId}`).get()).data().balance, 9600000)
})

test('a cash account outside the branch cannot create a contract or collect money', async () => {
  const { sourceId, studentId, cashAccountId, input } = await fixture()
  await db.doc(`cashAccounts/${cashAccountId}`).update({ branchId: 'another-branch' })
  await assert.rejects(() => regional.renewPtContractRegional({ data: input }), error => error.code === 'failed-precondition')
  assert.equal((await db.collection('contracts').where('studentId', '==', studentId).get()).size, 1)
  assert.equal((await db.collection('ledgerEntries').where('studentId', '==', studentId).get()).size, 0)
  assert.equal((await db.doc(`cashAccounts/${cashAccountId}`).get()).data().balance, 0)
  assert.equal((await db.doc(`contracts/${sourceId}`).get()).data().renewedByContractId, undefined)
  assert.equal((await db.doc(`quotes/${input.quoteId}`).get()).data().status, 'approved')
})

test('partial upfront renewal creates the receipt immediately and schedules only the unequal remainder', async () => {
  const { studentId, cashAccountId, input } = await fixture()
  input.initialPayment = 3_000_000
  input.installments = [1_000_000, 2_000_000, 3_600_000].map((amount, i) => ({ id: `period-${i}`, date: day(20 + i * 20), amount }))
  const result = await regional.renewPtContractRegional({ data: input })
  const contract = (await db.doc(`contracts/${result.contractId}`).get()).data()
  assert.equal(contract.status, 'future')
  assert.equal(contract.paidAmount, 3_000_000)
  assert.deepEqual(contract.installments.map(item => item.amount), [1_000_000, 2_000_000, 3_600_000])
  assert.equal(contract.installments.reduce((sum, item) => sum + item.amount, 0), contract.totalPrice - contract.discount - contract.paidAmount)
  assert.equal((await db.doc(`accountingDocuments/${result.receiptVoucherId}`).get()).data().totalAmount, 3_000_000)
  await legacy.renewPtContract({ data: input })
  assert.equal((await db.collection('ledgerEntries').where('studentId', '==', studentId).get()).size, 1)
  assert.equal((await db.doc(`cashAccounts/${cashAccountId}`).get()).data().balance, 3_000_000)
})
