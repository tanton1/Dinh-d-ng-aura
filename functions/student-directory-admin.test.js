'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { directoryWeekEligibility, directoryMatches, listAdminStudentDirectory, configFor } = require('./student-directory-admin')

const student = { id: 'a', name: 'Nguyễn Ánh', phone: '0900 123 456', joinDate: '2026-10-24', branchId: 'a', status: 'active' }
const base = { id: 'c', studentId: 'a', branchId: 'a', status: 'active', startDate: '2026-10-01', endDate: '2026-12-31', totalSessions: 24, usedSessions: 0, trainerId: 'pt', nutritionPTIds: ['coach'] }
const filters = { query: '', branchId: '', trainerId: '', nutritionPTId: '', attention: '', contractStatus: 'all', joinedFrom: '', joinedTo: '', weekId: '2026-10-26', referenceDate: '2026-10-30' }
const eligible = contracts => directoryWeekEligibility(student, contracts, filters.weekId, filters.referenceDate)
const matches = (contracts, patch = {}, person = student) => directoryMatches(person, contracts, directoryWeekEligibility(person, contracts, filters.weekId, filters.referenceDate), null, { ...filters, ...patch })

test('directory active-week eligibility excludes future, frozen, exhausted and other-branch contracts', () => {
  assert.equal(eligible([base]).eligible, true)
  for (const patch of [{ startDate: '2026-11-05' }, { status: 'frozen' }, { usedSessions: 24 }, { branchId: 'b' }, { endDate: '2026-10-29' }, { status: 'cancelled' }]) assert.equal(eligible([{ ...base, ...patch }]).eligible, false, JSON.stringify(patch))
  assert.equal(matches([{ ...base, startDate: '2026-11-05' }], { joinedFrom: '2026-10-01', joinedTo: '2026-10-31' }), true)
  assert.equal(matches([{ ...base, startDate: '2026-11-05' }], { contractStatus: 'active', joinedFrom: '2026-10-01', joinedTo: '2026-10-31' }), false)
})

test('directory contract, trainer, nutrition and joined-date filters use the same predicate for rows/counts', () => {
  assert.equal(matches([base], { trainerId: 'pt', nutritionPTId: 'coach' }), true)
  assert.equal(matches([base], { trainerId: 'other' }), false)
  assert.equal(matches([base], { nutritionPTId: 'none' }), false)
  assert.equal(matches([{ ...base, status: 'frozen' }], { contractStatus: 'paused' }), true)
  const approvedPause = { ...base, pausePeriods: [{ startDate: '2026-10-26', endDate: '2026-11-01' }] }
  assert.equal(matches([approvedPause], { contractStatus: 'paused' }), true)
  assert.equal(matches([approvedPause], { contractStatus: 'active' }), false)
  assert.deepEqual(eligible([approvedPause]).pausedDates, ['2026-10-30', '2026-10-31', '2026-11-01'])
  assert.equal(matches([{ ...base, status: 'cancelled' }], { contractStatus: 'cancelled' }), true)
  assert.equal(matches([], { contractStatus: 'all' }), true, 'empty profiles remain visible in the admin directory')
  assert.equal(matches([base], { query: 'nguyen anh' }), true)
  assert.equal(matches([base], { query: '0900123456' }), true)
  assert.equal(matches([base], { joinedFrom: '2026-10-25' }), false)
  assert.equal(matches([base], { joinedFrom: '2026-10-25', joinedTo: '2026-10-25' }, { ...student, joinDate: '2026-10-24T18:00:00Z' }), true)
  assert.equal(matches([base], { attention: 'stable' }), false, 'missing health projection is not a verified stable state')
})

test('admin directory denies staff before any canonical source read and validates filters', async () => {
  const db = { collection() { throw new Error('Unauthorized source read') }, runTransaction() { throw new Error('Unauthorized transaction') } }
  await assert.rejects(listAdminStudentDirectory({ db, actor: { uid: 'manager', accessRole: 'staff', branchIds: ['a'] }, data: {} }), { code: 'permission-denied' })
  assert.throws(() => configFor({ uid: 'admin', accessRole: 'admin' }, { joinedFrom: '2026-02-30' }), { code: 'invalid-argument' })
  assert.throws(() => configFor({ uid: 'admin', accessRole: 'admin' }, { contractStatus: 'made_up' }), { code: 'invalid-argument' })
})

test('directory continuation supports Unicode document IDs up to the Firestore 1,500-byte boundary', () => {
  const actor = { uid: 'admin', accessRole: 'admin', authzVersion: 1 }
  const config = configFor(actor, {})
  const cursor = after => Buffer.from(JSON.stringify({ v: 2, scope: config.scope, after, matched: 1, scanned: 1, seconds: Math.floor(Date.now() / 1000), nanos: 0 })).toString('base64url')
  const id = '学'.repeat(500)
  assert.equal(configFor(actor, { cursor: cursor(id) }).after, id)
  assert.throws(() => configFor(actor, { cursor: cursor(`${id}学`) }), { code: 'invalid-argument' })
  assert.throws(() => configFor(actor, { cursor: cursor('students/a') }), { code: 'invalid-argument' })
})
