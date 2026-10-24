'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createPtOperationsV2Functions, workspaceCacheVersion } = require('./pt-operations-v2')
const { trustedAccessContext } = require('./identity-access')
const { summarizeContractUsage } = require('./contract-usage')
const { viewFromSummary } = require('./contract-usage-view')

const VERSION = (value) => `${String(value).padStart(12, '0')}.000000000`
const USER_SIGNAL = (uid) => `users/${uid}/workspaceChanges/operations`
const STUDENT_RANGE = { from: '2026-10-01', to: '2026-11-01', availabilityWeekId: '2026-10-26' }
const TRAINER_RANGE = { section: 'students', from: '2026-10-01', to: '2026-11-01', limit: 100, independentTabs: true }

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
        const read = { type: 'query', collection, conditions, maximum }
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

test('request tab reads its own requests and student names without hydrating other workspaces', async () => {
  const { db, trainer } = fixture()
  db.values.set('students/old-student', { name: 'Old student' })
  db.values.set('sessionRequests/own', { trainerId: 'trainer', requestedBy: 'trainer', studentId: 'old-student', sessionId: 'old-session', type: 'reschedule', status: 'pending', originalDate: '2026-01-01', originalHour: 7, newDate: '2026-01-02', newHour: 8, submittedAtIso: '2026-01-01T01:00:00Z' })
  db.values.set('sessionRequests/student-request', { trainerId: 'trainer', requestedBy: 'student', studentId: 'student', type: 'cancel', status: 'pending' })
  db.values.set('sessionRequests/other-trainer', { trainerId: 'different-trainer', requestedBy: 'trainer', studentId: 'student', type: 'cancel', status: 'pending' })
  const result = await trainer({ section: 'requests' })
  assert.deepEqual(result.sessions, [])
  assert.deepEqual(result.students, [])
  assert.deepEqual(result.branches, [])
  assert.equal(result.scope.tabs.requests, true)
  assert.equal(result.scope.counts.pendingRequests, 1)
  assert.equal(result.requests.length, 1)
  assert.equal(result.requests[0].id, 'own')
  assert.equal(result.requests[0].studentName, 'Old student')
  assert.equal(result.requests[0].originalHour, 7)
  assert.equal(result.requests[0].newDate, '2026-01-02')
  assert.equal(queryCount(db, 'contracts'), 0)
  assert.equal(queryCount(db, 'students'), 0)
  assert.equal(queryCount(db, 'sessionRequests'), 1)
  assert.deepEqual(db.reads.filter((read) => read.collection === 'sessions').map((read) => read.maximum), [1])
  assert.equal(db.reads.some((read) => read.path?.startsWith('contractUsageViews/')), false)
  assert.deepEqual(db.reads.filter((read) => read.path?.startsWith('students/')).map((read) => read.path), ['students/old-student'])
})

test('request tab keeps contract-based visibility for a trainer without sessions', async () => {
  const { db, trainer } = fixture()
  db.values.delete('sessions/session')
  assert.equal((await trainer({ section: 'requests' })).scope.tabs.requests, true)
  assert.equal(db.reads.some((read) => read.collection === 'contracts' && read.conditions.some(([field]) => field === 'nutritionPTIds')), false)
  update(db, 'contracts/contract', { status: 'cancelled' })
  update(db, USER_SIGNAL('trainer'), { trainerWorkspaceVersion: VERSION(2) })
  assert.equal((await trainer({ section: 'requests' })).scope.tabs.requests, false)
})

test('request payload coalesces repeated reads and refreshes after its workspace signal changes', async () => {
  const { db, trainer } = fixture()
  db.values.set('sessionRequests/own', { trainerId: 'trainer', requestedBy: 'trainer', studentId: 'student', type: 'cancel', status: 'pending' })
  const [first, same] = await Promise.all([trainer({ section: 'requests' }), trainer({ section: 'requests' })])
  assert.deepEqual(first.requests, same.requests)
  assert.equal(queryCount(db, 'sessionRequests'), 1)
  update(db, 'sessionRequests/own', { status: 'approved' })
  update(db, 'students/student', { name: 'Updated name' })
  update(db, USER_SIGNAL('trainer'), { trainerWorkspaceVersion: VERSION(2) })
  const fresh = await trainer({ section: 'requests' })
  assert.equal(fresh.requests[0].status, 'approved')
  assert.equal(fresh.requests[0].studentName, 'Updated name')
  assert.equal(queryCount(db, 'sessionRequests'), 2)
})

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
  const { db, trainer, handlers, request } = fixture()
  const first = await trainer({ section: 'schedule' })
  assert.equal(first.sessions[0].contract.usedSessions, 0)
  update(db, USER_SIGNAL('trainer'), { trainerWorkspaceVersion: VERSION(2) })
  await trainer({ section: 'schedule' })
  db.values.set('contractUsageViews/contract', { schemaVersion: 3, sourceVersion: 'contract-usage-v3-daily', contractId: 'contract', studentId: 'student', entitlementSessions: 36, storedUsedSessions: 0, usedSessions: 7, remainingSessions: 29, generatedAt: new Date().toISOString() })
  update(db, USER_SIGNAL('trainer'), { trainerWorkspaceVersion: VERSION(3) })
  const projected = await trainer({ section: 'schedule' })
  assert.equal(projected.sessions[0].contract.usedSessions, 7)
  assert.deepEqual(projected.students, [])
  const roster = await handlers.listMyAssignedStudents(request('trainer', { limit: 500 }))
  assert.equal(roster.students[0].contract.remainingSessions, 29)
  assert.equal(projected.syncState.userVersion, VERSION(3))
})

test('opening the teaching calendar defers branch roster hydration until explicitly requested', async () => {
  const { db, trainer, handlers, request } = fixture()
  db.values.set('students/branch-student', { name: 'Branch learner', branchId: 'branch', status: 'active' })
  db.values.set('contracts/branch-contract', { studentId: 'branch-student', trainerId: 'other-trainer', branchId: 'branch', status: 'active', startDate: '2026-01-01', endDate: '2027-12-31', totalSessions: 36, usedSessions: 0 })
  const calendar = await trainer({ section: 'schedule' })
  assert.deepEqual(calendar.students, [])
  assert.deepEqual(calendar.branches, [])
  assert.equal(calendar.sessions[0].studentName, 'Before')
  assert.equal(queryCount(db, 'students'), 0)
  assert.equal(db.reads.some((read) => read.path === 'students/branch-student'), false)
  assert.equal(db.reads.some((read) => read.path === 'contractUsageViews/branch-contract'), false)
  const roster = await handlers.listMyAssignedStudents(request('trainer', { limit: 500 }))
  assert.equal(roster.students.find((student) => student.id === 'branch-student')?.assignmentRole, 'branch')
  assert.ok(queryCount(db, 'students') > 0)
})

test('legacy calendar callers retain their initial roster until they opt into independent tabs', async () => {
  const { db, trainer } = fixture()
  const legacy = await trainer({ section: 'schedule', independentTabs: undefined })
  assert.equal(legacy.schemaVersion, 2)
  assert.equal(legacy.students[0].id, 'student')
  assert.equal(legacy.branches[0].id, 'branch')
  assert.equal(legacy.sessions[0].studentName, 'Before')
  assert.ok(queryCount(db, 'students') > 0)
  const independent = await trainer({ section: 'schedule' })
  assert.deepEqual(independent.students, [])
  assert.deepEqual(independent.branches, [])
})

test('legacy request callers retain session names and complete scope while new callers receive isolated request names', async () => {
  const { db, trainer } = fixture()
  db.values.set('sessionRequests/own', { trainerId: 'trainer', requestedBy: 'trainer', studentId: 'student', sessionId: 'session', type: 'cancel', status: 'pending', originalDate: '2026-10-26', originalHour: 8 })
  const legacy = await trainer({ section: 'requests', independentTabs: undefined })
  assert.equal(legacy.schemaVersion, 2)
  assert.equal(legacy.scope.tabs.schedule, true)
  assert.equal(legacy.sessions[0].studentName, 'Before')
  assert.equal(legacy.requests[0].studentId, legacy.sessions[0].studentId)
  const independent = await trainer({ section: 'requests' })
  assert.deepEqual(independent.sessions, [])
  assert.equal(independent.requests[0].studentName, 'Before')
  assert.equal(independent.scope.section, 'requests')
})

test('healthy trainer roster avoids contract-history scans and duplicate profile reads while retaining cross-branch reserved sessions', async () => {
  const { db, trainer } = fixture()
  const contract = db.values.get('contracts/contract')
  const current = db.values.get('sessions/session')
  db.values.set('contractUsageViews/contract', viewFromSummary('contract', contract, summarizeContractUsage(contract, [current])))
  db.values.set('students/cross-branch', { name: 'Cross branch learner', phone: 'test-phone', email: 'test@example.invalid', branchId: 'other-branch', status: 'active' })
  db.values.set('branches/other-branch', { name: 'Other branch' })
  db.values.set('contracts/cross-contract', { studentId: 'cross-branch', trainerId: 'other-trainer', branchId: 'other-branch', status: 'active', startDate: '2026-01-01', endDate: '2027-12-31', totalSessions: 36, usedSessions: 36 })
  db.values.set('sessions/cross-reserved', { studentId: 'cross-branch', trainerId: 'trainer', branchId: 'branch', contractId: 'cross-contract', date: '2026-10-27', hour: 9, status: 'scheduled', billingStatus: 'unbilled' })
  const result = await trainer()
  assert.equal(result.students.length, 1)
  assert.equal(result.students[0].contract.remainingSessions, 36)
  assert.equal(result.sessions.length, 2)
  const reserved = result.sessions.find((session) => session.id === 'cross-reserved')
  assert.equal(reserved.studentName, 'Cross branch learner')
  assert.equal(reserved.studentPhone, 'test-phone')
  assert.equal(reserved.studentEmail, 'test@example.invalid')
  assert.equal(reserved.studentBranchId, 'other-branch')
  assert.equal(reserved.contractEffective, true)
  assert.equal(reserved.contractSchedulable, false)
  assert.equal(reserved.contract.remainingSessions, 0)
  assert.equal(result.branches.some((branch) => branch.id === 'other-branch'), true)
  assert.equal(db.reads.filter((read) => read.type === 'query' && read.collection === 'sessions' && read.conditions.some(([field]) => field === 'contractId')).length, 0)
  // One read remains for the separately authorized schedule payload. The
  // roster reuses its branch query snapshot rather than getting it again.
  assert.equal(db.reads.filter((read) => read.path === 'students/student').length, 1)
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
