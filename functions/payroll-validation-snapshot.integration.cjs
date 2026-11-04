'use strict'
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { createPayrollFunctions, readPayrollSessionValidation } = require('./payroll')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `payroll-validation-${randomUUID()}`)
const clients = []
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })
const periodId = '2025-01'
const request = { auth: { uid: 'admin', token: { role: 'admin' } }, data: { runId: periodId } }
async function fixture() {
  const db = getFirestore(app, `payroll-validation-${randomUUID()}`); clients.push(db)
  await db.doc('users/admin').set({ role: 'admin' })
  await db.doc(`payrollRuns/${periodId}`).set({ periodId, schemaVersion: 7, commissionFormulaVersion: 2, status: 'draft', finalAmount: 100000, attendanceReviewRequired: false })
  await db.doc('payrollRunItems/item').set({ runId: periodId, trainerId: 'pt', trainerSnapshot: { name: 'PT Snapshot' }, teachingSlots: [], finalAmount: 100000 })
  await db.doc('sessions/s1').set({ trainerId: 'pt', studentId: 's', date: '2025-01-10', hour: 10, branchId: 'a', status: 'completed' })
  return db
}

test('review and lock validate current sessions; verified locked reads skip session and identity hydration', async () => {
  const db = await fixture()
  const handlers = createPayrollFunctions({ db, onCall: (_options, handler) => handler })
  await handlers.reviewPayrollRun(request)
  assert.equal((await db.doc(`payrollRuns/${periodId}`).get()).data().sessionValidation.phase, 'reviewed')
  await handlers.lockPayrollRun(request)
  const stored = (await db.doc(`payrollRuns/${periodId}`).get()).data()
  assert.equal(stored.sessionValidation.phase, 'locked')
  assert.equal(stored.status, 'locked')
  const facade = { doc: path => db.doc(path), collection: name => { assert.notEqual(name, 'sessions'); return db.collection(name) }, getAll: () => { throw Error('A complete trainer snapshot must not hydrate identity') } }
  const reader = createPayrollFunctions({ db: facade, onCall: (_options, handler) => handler })
  const result = await reader.getPayrollRun(request)
  assert.equal(result.run.finalAmount, stored.finalAmount)
  assert.deepEqual(result.run.validationViolations, [])
  assert.equal(result.items[0].trainerSnapshot.name, 'PT Snapshot')
  await db.doc(`payrollRuns/${periodId}`).update({ status: 'paid' })
  assert.equal((await reader.getPayrollRun(request)).run.status, 'paid')
})

test('source change after review cannot be locked or create financial entries', async () => {
  const db = await fixture()
  const handlers = createPayrollFunctions({ db, onCall: (_options, handler) => handler })
  await handlers.reviewPayrollRun(request)
  await db.doc('sessions/s1').update({ hour: 11 })
  await assert.rejects(handlers.lockPayrollRun(request), { code: 'failed-precondition' })
  assert.equal((await db.doc(`payrollRuns/${periodId}`).get()).data().status, 'reviewed')
  assert.equal((await db.collection('ledgerEntries').get()).size, 0)
  assert.equal((await db.collection('journalEntries').get()).size, 0)
})

test('live draft validation includes makeup flags and still detects real duplicate days', async () => {
  const db = await fixture()
  await db.doc('sessions/s2').set({ trainerId: 'pt', studentId: 's', date: '2025-01-10', hour: 11, status: 'completed', makeupSession: true })
  const first = await readPayrollSessionValidation(db, periodId)
  assert.deepEqual(first.violations, [])
  await db.doc('sessions/s2').update({ makeupSession: false })
  assert.equal((await readPayrollSessionValidation(db, periodId)).violations[0].code, 'STUDENT_MULTIPLE_COMPLETED_SESSIONS_PER_DAY')
  await db.doc(`payrollRuns/${periodId}`).update({ sourceDataStale: true })
  const handlers = createPayrollFunctions({ db, onCall: (_options, handler) => handler })
  await assert.rejects(handlers.reviewPayrollRun(request), { code: 'failed-precondition' })
})

test('persisted duplicate exclusions are read by both run creation and validation', async () => {
  const db = await fixture()
  await db.doc(`payrollRuns/${periodId}`).delete()
  await db.doc('sessions/s2').set({ trainerId: 'pt', studentId: 's', date: '2025-01-10', hour: 11, status: 'completed',
    duplicateOfSessionId: 's1', billingStatus: 'exempt', countsTowardContract: false })
  const first = await readPayrollSessionValidation(db, periodId)
  assert.deepEqual(first.violations, [])
  // Intercept the creation query using real Firestore projection semantics.
  // Stop before policy/payout writes; only the source filtering is under test.
  let projected = null
  const facade = { doc: path => db.doc(path), collection: name => db.collection(name), runTransaction: callback => db.runTransaction(tx => callback({
    get: async query => {
      const snap = await tx.get(query)
      if (snap.docs?.some(doc => doc.ref.path === 'sessions/s2')) {
        projected = snap.docs
        throw Error('projection verified')
      }
      return snap
    },
  })) }
  const handlers = createPayrollFunctions({ db: facade, onCall: (_options, handler) => handler })
  await assert.rejects(handlers.createPayrollRun({ ...request, data: { periodId } }))
  assert.ok(projected)
  assert.equal(projected.find(doc => doc.id === 's2').data().duplicateOfSessionId, 's1')
  const { teachingSlotsFromSessions } = require('./payroll')
  assert.equal(teachingSlotsFromSessions(projected, { ratePerSession: 20000 }).teachingSlotCount, 1)
  assert.equal((await db.doc(`payrollRuns/${periodId}`).get()).exists, false)
  await db.doc('sessions/s2').update({ billingStatus: 'charged', countsTowardContract: true })
  const changed = await readPayrollSessionValidation(db, periodId)
  assert.equal(changed.violations.length, 1)
  assert.notEqual(changed.fingerprint, first.fingerprint)
})
