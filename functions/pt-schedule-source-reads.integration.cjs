'use strict'

const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { after, test } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { loadBranchData, resolveContract, weeklySessionCoverageForStudents } = require('./pt-schedule-v2')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `pt-source-reads-${randomUUID()}`)
const clients = [], WEEK = '2026-10-26', BRANCH = 'branch-a'
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })
function fixture() { const db = getFirestore(app, `pt-source-reads-${randomUUID()}`); clients.push(db); return db }
async function seed(db, rows) {
  for (let start = 0; start < rows.length; start += 400) {
    const batch = db.batch()
    for (const [path, value] of rows.slice(start, start + 400)) batch.set(db.doc(path), value)
    await batch.commit()
  }
}
const load = db => loadBranchData(db, BRANCH, WEEK, { forceRefresh: true, workspaceMatrixFast: true })
const learner = id => ({ name: id, branchId: BRANCH, status: 'active', sessionsPerWeek: 3 })
const contract = studentId => ({ studentId, branchId: BRANCH, trainerId: 'trainer-a', status: 'active',
  startDate: WEEK, endDate: '2026-11-30', totalSessions: 36, usedSessions: 0 })
const session = (studentId, contractId, patch = {}) => ({ studentId, contractId, trainerId: 'trainer-a', branchId: 'branch-b',
  date: WEEK, hour: 8, status: 'scheduled', billingStatus: 'unbilled', ...patch })
const ids = rows => rows.map(row => row.id).sort()

test('workspace keeps complete renewal chains and cross-branch weekly sessions across three learner batches', async () => {
  const db = fixture(), students = Array.from({ length: 61 }, (_, i) => `student-${String(i).padStart(2, '0')}`)
  const rows = [[`branches/${BRANCH}`, { name: 'Branch A', status: 'active' }]], expectedContracts = [], expectedSessions = []
  for (const studentId of students) {
    const contractId = `contract-${studentId}`
    rows.push([`students/${studentId}`, learner(studentId)], [`contracts/${contractId}`, contract(studentId)])
    expectedContracts.push(contractId)
    for (const [suffix, date, status] of [['monday', WEEK, 'scheduled'], ['sunday', '2026-11-01', 'completed']]) {
      const id = `${studentId}-${suffix}`
      rows.push([`sessions/${id}`, session(studentId, contractId, { date, status })]); expectedSessions.push(id)
    }
    rows.push([`sessions/${studentId}-previous`, session(studentId, contractId, { date: '2026-10-25' })],
      [`sessions/${studentId}-next`, session(studentId, contractId, { date: '2026-11-02' })])
  }
  const studentId = students[0], sourceId = `contract-${studentId}`
  rows.push(['contracts/renewal', { ...contract(studentId), status: 'future', sourceContractId: sourceId, startDate: '2026-12-01', endDate: '2027-02-28' }],
    ['contracts/legacy-history', { studentId, branchId: BRANCH, status: 'cancelled', totalSessions: 12 }],
    ['contracts/unrelated', contract('outside')], ['sessions/unrelated', session('outside', 'unrelated')],
    ['sessions/cancelled', session(studentId, sourceId, { status: 'cancelled' })],
    ['sessions/no-date', { studentId, contractId: sourceId, branchId: 'branch-b', status: 'scheduled' }])
  expectedContracts.push('renewal', 'legacy-history'); expectedSessions.push('cancelled')
  // Reverse insertion order so result correctness cannot depend on seed order.
  await seed(db, rows.reverse())
  const result = await load(db)
  assert.deepEqual(ids(result.students), students)
  assert.deepEqual(ids(result.contracts), expectedContracts.sort())
  assert.deepEqual(ids(result.sessions), expectedSessions.sort())
  assert.equal(result.contracts.find(row => row.id === 'renewal').status, 'future')
  assert.equal(result.contracts.find(row => row.id === 'legacy-history').startDate, undefined)
  const reordered = { ...result, contracts: [...result.contracts].reverse(), sessions: [...result.sessions].reverse(), contractsByStudent: undefined }
  assert.equal(resolveContract(result, studentId, 'trainer-a', '2026-10-27').contract.id, sourceId)
  assert.equal(resolveContract(reordered, studentId, 'trainer-a', '2026-10-27').contract.id, sourceId)
  const coverage = data => weeklySessionCoverageForStudents({ contracts: data.contracts, sessions: data.sessions, weekId: WEEK, branchId: BRANCH, scheduleEntries: [] })
  assert.deepEqual(coverage(reordered), coverage(result))
})

test('weekly coverage includes exactly 1000 sessions and rejects 1001 instead of returning a partial workspace', async () => {
  const db = fixture(), studentId = 'student', contractId = 'contract'
  const rows = [[`branches/${BRANCH}`, { name: 'Branch A' }], [`students/${studentId}`, learner(studentId)],
    [`contracts/${contractId}`, contract(studentId)]]
  for (let i = 0; i < 1000; i++) rows.push([`sessions/session-${String(i).padStart(4, '0')}`, session(studentId, contractId, { status: 'completed' })])
  await seed(db, rows)
  assert.equal((await load(db)).sessions.length, 1000)
  await db.doc('sessions/overflow').set(session(studentId, contractId, { status: 'completed' }))
  await assert.rejects(load(db), error => error.code === 'resource-exhausted' && /đối soát/.test(error.message))
})

test('an empty branch roster returns an empty complete workspace', async () => {
  const db = fixture()
  await seed(db, [[`branches/${BRANCH}`, { name: 'Empty branch' }], ['students/outside', { ...learner('outside'), branchId: 'branch-b' }],
    ['contracts/unrelated', contract('outside')], ['sessions/unrelated', session('outside', 'unrelated')]])
  const result = await load(db)
  assert.deepEqual(result.students, []); assert.deepEqual(result.contracts, []); assert.deepEqual(result.sessions, [])
})
