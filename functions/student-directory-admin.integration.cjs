'use strict'

const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { test, after } = require('node:test')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { listAdminStudentDirectory } = require('./student-directory-admin')
const { vietnamDateKey, addDateDays } = require('./pt-policy')

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const app = initializeApp({ projectId: 'demo-aura-fitness' }, `student-directory-${randomUUID()}`)
const clients = []
after(async () => { await Promise.all(clients.map(db => db.terminate())); await deleteApp(app) })
const actor = { uid: 'admin', accessRole: 'admin', authzVersion: 1, branchIds: [] }
async function fixture(rows = {}) {
  const db = getFirestore(app, `student-directory-${randomUUID()}`); clients.push(db)
  const entries = Object.entries(rows)
  for (let offset = 0; offset < entries.length; offset += 400) {
    const batch = db.batch()
    for (const [path, value] of entries.slice(offset, offset + 400)) batch.set(db.doc(path), value)
    await batch.commit()
  }
  return db
}
async function drain(db, data) {
  const rows = []
  let cursor = null, result, calls = 0
  do {
    result = await listAdminStudentDirectory({ db, actor, data: { ...data, cursor } })
    rows.push(...result.rows); cursor = result.nextCursor; calls++
    assert.ok(calls < 100, 'bounded fixture must finish')
  } while (cursor)
  assert.equal(new Set(rows.map(row => row.studentId)).size, rows.length)
  assert.equal(result.totalMatched, rows.length)
  return { rows, result, calls }
}

test('canonical admin directory finds a matching profile after 2,500 without a projection and reports resumable partial counts', { timeout: 120000 }, async () => {
  const db = await fixture(Object.fromEntries(Array.from({ length: 2501 }, (_, index) => [`students/s${String(index).padStart(5, '0')}`, { name: index === 2500 ? 'Nguyễn Đích' : `Other ${index}`, branchId: 'a', status: 'active', joinDate: vietnamDateKey() }])))
  const input = { query: 'nguyen dich', contractStatus: 'all' }
  const first = await listAdminStudentDirectory({ db, actor, data: input })
  assert.equal(first.rows.length, 0)
  assert.equal(first.scanned, 500)
  assert.equal(first.truncated, true)
  assert.equal(first.totalMatched, null)
  assert.equal(first.matchedSoFar, 0)
  await assert.rejects(listAdminStudentDirectory({ db, actor, data: { ...input, cursor: first.nextCursor, contractStatus: 'active' } }), { code: 'invalid-argument' })
  await assert.rejects(listAdminStudentDirectory({ db, actor: { ...actor, authzVersion: 2 }, data: { ...input, cursor: first.nextCursor } }), { code: 'invalid-argument' })
  const all = await drain(db, input)
  assert.equal(all.calls, 6)
  assert.deepEqual(all.rows.map(row => row.studentId), ['s02500'])
  assert.equal(all.rows[0].healthAvailable, false)
  assert.equal(all.result.scannedTotal, 2501)
  assert.equal(all.result.countComplete, true)
})

test('new-month cohort and active-week cohort stay distinct for future, frozen and cross-branch contracts', async () => {
  const today = vietnamDateKey(), monthStart = `${today.slice(0, 7)}-01`
  const rows = { 'branches/a': { name: 'Branch A' } }
  for (let index = 0; index < 31; index++) {
    const id = `s${String(index).padStart(2, '0')}`
    rows[`students/${id}`] = { name: id, status: 'active', branchId: 'a', joinDate: today }
    rows[`contracts/${id}`] = { studentId: id, branchId: index === 30 ? 'b' : 'a', status: 'active', startDate: index === 29 ? addDateDays(today, 14) : monthStart, endDate: addDateDays(today, 90), totalSessions: 24, usedSessions: 0, trainerId: 'pt' }
  }
  rows['students/frozen'] = { name: 'Frozen learner', status: 'active', branchId: 'a', joinDate: '2000-01-01' }
  rows['contracts/frozen'] = { studentId: 'frozen', branchId: 'a', status: 'frozen', startDate: monthStart, endDate: addDateDays(today, 90), totalSessions: 24, usedSessions: 0 }
  const db = await fixture(rows)
  const all = await drain(db, { joinedFrom: monthStart, joinedTo: today, contractStatus: 'all', pageSize: 10 })
  assert.equal(all.rows.length, 31)
  const active = await drain(db, { joinedFrom: monthStart, joinedTo: today, contractStatus: 'active', trainerId: 'pt', pageSize: 10 })
  assert.equal(active.rows.length, 29)
  assert.ok(active.rows.every(row => row.weeklyEligible && row.branchName === 'Branch A'))
  const paused = await drain(db, { contractStatus: 'paused' })
  assert.deepEqual(paused.rows.map(row => row.studentId), ['frozen'])
})

test('fixed snapshot pagination keeps rows/counts stable when profiles change between pages', async () => {
  const today = vietnamDateKey()
  const db = await fixture({ 'students/a': { name: 'A', status: 'active', joinDate: today }, 'students/b': { name: 'B', status: 'active', joinDate: today } })
  const data = { pageSize: 1, joinedFrom: today, joinedTo: today }
  const first = await listAdminStudentDirectory({ db, actor, data })
  await db.doc('students/b').update({ joinDate: '2000-01-01' })
  await db.doc('students/aa').set({ name: 'New after first page', status: 'active', joinDate: today })
  const second = await listAdminStudentDirectory({ db, actor, data: { ...data, cursor: first.nextCursor } })
  assert.deepEqual(second.rows.map(row => row.studentId), ['b'])
  assert.equal(second.totalMatched, 2)
  assert.equal(second.asOf, first.asOf)
  const refreshed = await drain(db, data)
  assert.deepEqual(refreshed.rows.map(row => row.studentId), ['a', 'aa'])
})
