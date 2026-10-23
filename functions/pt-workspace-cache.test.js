'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createPtOperationsV2Functions, workspaceCacheVersion } = require('./pt-operations-v2')
const { trustedAccessContext } = require('./identity-access')

const VERSION = (value) => `${String(value).padStart(12, '0')}.000000000`
const USER_SIGNAL = (uid) => `users/${uid}/workspaceChanges/operations`
const STUDENT_RANGE = { from: '2026-10-01', to: '2026-11-01', availabilityWeekId: '2026-10-26' }
const TRAINER_RANGE = { section: 'students', from: '2026-10-01', to: '2026-11-01', limit: 100 }

// Exercise the real handlers, auth resolver and every nested process cache.
// This fake only implements the Firestore read boundary used by these reads.
function memoryDb(initial) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, structuredClone(value)]))
  const reads = []
  const snapshot = (path) => {
    const value = values.has(path) ? structuredClone(values.get(path)) : undefined
    return { id: path.split('/').at(-1), exists: value !== undefined, ref: db.doc(path), data: () => value }
  }
  const fieldValue = (path, value, field) => String(field) === '__name__' ? path.split('/').at(-1) : String(field).split('.').reduce((part, key) => part?.[key], value)
  const matches = (actual, operator, expected) => {
    if (operator === '==') return actual === expected
    if (operator === '>=') return actual >= expected
    if (operator === '<=') return actual <= expected
    if (operator === '<') return actual < expected
    if (operator === 'in') return expected.includes(actual)
    if (operator === 'array-contains') return Array.isArray(actual) && actual.includes(expected)
    throw new Error(`Unexpected fake query operator: ${operator}`)
  }
  function query(collection, conditions = [], ordering = null, maximum = Infinity) {
    return {
      where: (field, operator, value) => query(collection, [...conditions, [String(field), operator, value]], ordering, maximum),
      orderBy: (field, direction = 'asc') => query(collection, conditions, [String(field), direction], maximum),
      limit: (count) => query(collection, conditions, ordering, count),
      async get() {
        const read = { type: 'query', collection, conditions }
        reads.push(read)
        let rows = [...values].filter(([path, value]) => path.slice(0, path.lastIndexOf('/')) === collection
          && conditions.every(([field, operator, expected]) => matches(fieldValue(path, value, field), operator, expected)))
        if (ordering) rows.sort(([aPath, a], [bPath, b]) => {
          const left = fieldValue(aPath, a, ordering[0]), right = fieldValue(bPath, b, ordering[0])
          return (left === right ? 0 : left < right ? -1 : 1) * (ordering[1] === 'desc' ? -1 : 1)
        })
        const docs = rows.slice(0, maximum).map(([path]) => snapshot(path))
        if (db.beforeQueryResult) await db.beforeQueryResult(read)
        return { docs, size: docs.length, empty: docs.length === 0 }
      },
    }
  }
  const db = {
    values, reads, beforeQueryResult: null,
    doc(path) { return { path, id: path.split('/').at(-1), get: async () => { reads.push({ type: 'document', path }); return snapshot(path) } } },
    getAll(...references) { return Promise.all(references.map((reference) => reference.get())) },
    collection: (path) => query(path),
  }
  return db
}

function fixture() {
  const db = memoryDb({
    'users/student': { displayName: 'Student', role: 'student' },
    'users/trainer': { displayName: 'Trainer', role: 'staff' },
    'roleAssignments/student': { accessRole: 'student', authzVersion: 1, status: 'active', crmProfileId: 'student', branchIds: ['branch'] },
    'roleAssignments/trainer': { accessRole: 'staff', authzVersion: 1, status: 'active', crmProfileId: 'trainer', branchIds: ['branch'], positions: ['trainer_pt'] },
    'students/student': { accountUid: 'student', name: 'Before', branchId: 'branch', status: 'active', sessionsPerWeek: 3 },
    'trainers/trainer': { accountUid: 'trainer', name: 'Trainer', branchId: 'branch' },
    'branches/branch': { name: 'Branch' },
    'contracts/contract': { studentId: 'student', trainerId: 'trainer', branchId: 'branch', status: 'active', startDate: '2026-01-01', endDate: '2027-12-31', totalSessions: 36, usedSessions: 0, totalPrice: 9600000, paidAmount: 0 },
    'sessions/session': { studentId: 'student', trainerId: 'trainer', branchId: 'branch', contractId: 'contract', date: '2026-10-26', hour: 8, status: 'scheduled', billingStatus: 'unbilled' },
    'ptAvailability/student_2026-10-19': { studentId: 'student', weekId: '2026-10-19', slots: ['T2-8'], status: 'submitted', revision: 1 },
    [USER_SIGNAL('student')]: { studentScheduleVersion: VERSION(1) },
    [USER_SIGNAL('trainer')]: { trainerWorkspaceVersion: VERSION(1) },
    'workspaceBranchChanges/branch': { trainerWorkspaceVersion: VERSION(1) },
  })
  const handlers = createPtOperationsV2Functions({ db, onCall: (_options, handler) => handler })
  const request = (uid, data) => ({ auth: { uid, token: { accessRole: uid === 'student' ? 'student' : 'staff', authzVersion: 1 } }, data })
  return { db, handlers, request, student: (data = {}) => handlers.listMyStudentPtSchedule(request('student', { ...STUDENT_RANGE, ...data })), trainer: (data = {}) => handlers.getMyTrainerWorkspace(request('trainer', { ...TRAINER_RANGE, ...data })) }
}
const queryCount = (db, collection) => db.reads.filter((read) => read.type === 'query' && read.collection === collection).length
const update = (db, path, patch) => db.values.set(path, { ...db.values.get(path), ...patch })

test('student change versions refresh source and inherited availability inside TTL; unchanged concurrent reads coalesce', async () => {
  const { db, student } = fixture()
  const [first, same] = await Promise.all([student(), student()])
  assert.equal(queryCount(db, 'sessions'), 1)
  assert.equal(queryCount(db, 'contracts'), 1)
  assert.equal(queryCount(db, 'ptAvailability'), 1)
  assert.deepEqual(first.syncState, same.syncState)
  assert.deepEqual(first.student.availability.slots, ['T2-8'])
  const firstSignalIndex = db.reads.findIndex((read) => read.path === USER_SIGNAL('student'))
  const firstQueryIndex = db.reads.findIndex((read) => read.type === 'query')
  assert.ok(firstSignalIndex >= 0 && firstSignalIndex < firstQueryIndex)

  update(db, 'sessions/session', { hour: 9 })
  update(db, 'contracts/contract', { paidAmount: 9600000 })
  update(db, 'ptAvailability/student_2026-10-19', { slots: ['T3-9'], revision: 2 })
  const cached = await student({ version: 'caller-cannot-invent-a-version' })
  assert.equal(cached.sessions[0].hour, 8)
  assert.deepEqual(cached.syncState, first.syncState)
  assert.equal(queryCount(db, 'sessions'), 1)

  update(db, USER_SIGNAL('student'), { studentScheduleVersion: VERSION(2) })
  const changed = await student()
  assert.notEqual(changed.syncState.version, first.syncState.version)
  assert.equal(changed.syncState.userVersion, VERSION(2))
  assert.equal(changed.sessions[0].hour, 9)
  assert.equal(changed.contracts[0].paidAmount, 9600000)
  assert.deepEqual(changed.student.availability.slots, ['T3-9'])
  assert.equal(queryCount(db, 'sessions'), 2)
  assert.equal(queryCount(db, 'contracts'), 2)
  assert.equal(queryCount(db, 'ptAvailability'), 2)
})

test('trainer branch revisions invalidate scope, assigned-contract and roster/schedule caches together', async () => {
  const { db, trainer } = fixture()
  const first = await trainer()
  assert.equal(first.scope.counts.primaryStudents, 1)
  assert.equal(first.students.length, 1)
  const queries = queryCount(db, 'contracts')
  await trainer()
  assert.equal(queryCount(db, 'contracts'), queries)

  update(db, 'contracts/contract', { status: 'cancelled' })
  update(db, 'sessions/session', { hour: 10 })
  update(db, 'students/student', { name: 'After' })
  update(db, 'workspaceBranchChanges/branch', { trainerWorkspaceVersion: VERSION(2) })
  const changed = await trainer()
  assert.equal(changed.syncState.branchVersions.branch, VERSION(2))
  assert.equal(changed.scope.counts.primaryStudents, 0)
  assert.equal(changed.students.length, 0)
  assert.equal(changed.sessions[0].hour, 10)
  assert.equal(changed.sessions[0].studentName, 'After')
  assert.ok(queryCount(db, 'contracts') > queries)
})

test('a later usage-projection revision updates trainer quota instead of reusing the earlier source refresh', async () => {
  const { db, trainer } = fixture()
  const first = await trainer({ section: 'schedule' })
  assert.equal(first.sessions[0].contract.usedSessions, 0)
  update(db, USER_SIGNAL('trainer'), { trainerWorkspaceVersion: VERSION(2) })
  await trainer({ section: 'schedule' })
  db.values.set('contractUsageViews/contract', { schemaVersion: 3, sourceVersion: 'contract-usage-v3-daily', studentId: 'student', entitlementSessions: 36, usedSessions: 7, remainingSessions: 29 })
  update(db, USER_SIGNAL('trainer'), { trainerWorkspaceVersion: VERSION(3) })
  const projected = await trainer({ section: 'schedule' })
  assert.equal(projected.sessions[0].contract.usedSessions, 7)
  assert.equal(projected.students[0].contract.remainingSessions, 29)
  assert.equal(projected.syncState.userVersion, VERSION(3))
})

test('finishing an older in-flight student read cannot populate the newer signal cache or acknowledge its revision', async () => {
  const { db, student } = fixture()
  let release
  let reached
  const blocked = new Promise((resolve) => { reached = resolve })
  db.beforeQueryResult = (read) => {
    if (read.collection !== 'sessions') return
    db.beforeQueryResult = null
    reached()
    return new Promise((resolve) => { release = resolve })
  }
  const oldRequest = student()
  await blocked
  update(db, 'sessions/session', { hour: 11 })
  update(db, USER_SIGNAL('student'), { studentScheduleVersion: VERSION(2) })
  const newer = await student()
  release()
  const older = await oldRequest
  assert.equal(older.sessions[0].hour, 8)
  assert.equal(older.syncState.userVersion, VERSION(1))
  assert.equal(newer.sessions[0].hour, 11)
  assert.equal(newer.syncState.userVersion, VERSION(2))
  const again = await student()
  assert.equal(again.sessions[0].hour, 11)
  assert.deepEqual(again.syncState, newer.syncState)
})

test('Vietnam midnight changes every workspace cache namespace while retaining the real server signal', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-23T16:59:59.000Z') })
  const { db, trainer, student } = fixture()
  update(db, 'contracts/contract', { endDate: '2026-10-23' })
  const before = await trainer()
  await student()
  assert.equal(before.students.length, 1)
  const queryReads = queryCount(db, 'contracts')
  t.mock.timers.tick(1000)
  const after = await trainer()
  await student()
  assert.equal(after.students.length, 0)
  assert.equal(after.scope.counts.primaryStudents, 0)
  assert.deepEqual(after.syncState, before.syncState)
  assert.ok(queryCount(db, 'contracts') > queryReads)
  assert.notEqual(workspaceCacheVersion(before.syncState, new Date('2026-10-23T16:59:59Z')), workspaceCacheVersion(before.syncState, new Date('2026-10-23T17:00:00Z')))
})

test('fresh workspace authorization rejects revoked assignment even with a warm legacy auth cache', async () => {
  const { db, trainer, request } = fixture()
  await trustedAccessContext(request('trainer', {}), db)
  await trainer()
  const queries = queryCount(db, 'contracts')
  update(db, 'roleAssignments/trainer', { status: 'suspended', authzVersion: 2 })
  update(db, USER_SIGNAL('trainer'), { trainerWorkspaceVersion: VERSION(2) })
  await assert.rejects(trainer(), (error) => error.code === 'permission-denied')
  assert.equal(queryCount(db, 'contracts'), queries)
})

test('a changed authorized branch set gets a new cache namespace even before a role signal arrives', async () => {
  const { db, trainer } = fixture()
  const before = await trainer()
  db.values.set('branches/other-branch', { name: 'Other branch' })
  db.values.set('students/other-student', { name: 'New branch learner', branchId: 'other-branch', status: 'active' })
  db.values.set('contracts/other-contract', {
    studentId: 'other-student', branchId: 'other-branch', status: 'active',
    startDate: '2026-01-01', endDate: '2027-12-31', totalSessions: 36,
  })
  // Keep the revision unchanged to isolate the authorized branch fingerprint.
  // Production role commands also advance authzVersion and notify the user.
  update(db, 'roleAssignments/trainer', { branchIds: ['other-branch'] })
  const after = await trainer({ branchIds: ['branch', 'forbidden'] })
  assert.notEqual(after.syncState.version, before.syncState.version)
  assert.deepEqual(after.syncState.branchVersions, { 'other-branch': '0' })
  assert.deepEqual(after.scope.branchIds, ['other-branch'])
  assert.equal(after.students.some((student) => student.id === 'other-student'), true)
  assert.equal(db.reads.some((read) => read.path === 'workspaceBranchChanges/forbidden'), false)
})

test('unlinked students still receive sync state and policy changes invalidate without caller scope escalation', async () => {
  const { db, student } = fixture()
  db.values.delete('students/student')
  const first = await student({ branchIds: ['forbidden'], uid: 'trainer' })
  assert.equal(first.linked, false)
  assert.deepEqual(first.syncState.branchVersions, {})
  db.values.set('workspaceChanges/policy', { studentScheduleVersion: VERSION(3) })
  const changed = await student()
  assert.notEqual(changed.syncState.version, first.syncState.version)
  assert.equal(changed.syncState.policyVersion, VERSION(3))
  assert.equal(queryCount(db, 'sessions'), 0)
  assert.equal(db.reads.some((read) => read.path === 'workspaceBranchChanges/forbidden'), false)
})
