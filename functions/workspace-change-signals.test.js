'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  readWorkspaceChangeState, syncWorkspaceChangesFromEvent, writeWorkspacePolicyChange,
  timestampVersion, RECIPIENT_QUERY_LIMIT,
} = require('./workspace-change-signals')

const S = 'studentScheduleVersion'
const T = 'trainerWorkspaceVersion'
const userPath = (uid) => `users/${uid}/workspaceChanges/operations`
const branchPath = (id) => `workspaceBranchChanges/${id}`
const version = (seconds, nanoseconds = 0) => timestampVersion({ seconds, nanoseconds })

function fakeDb(initial = {}) {
  const documents = new Map(Object.entries(initial))
  const reads = []
  const writes = []
  const queries = []
  let lock = Promise.resolve()
  const snapshot = (path, value = documents.get(path)) => ({
    id: path.split('/').at(-1), exists: value !== undefined,
    ref: { path, parent: { id: path.split('/').at(-2) } },
    data: () => value,
  })
  const db = {
    documents, reads, writes, queries,
    doc: (path) => ({ path, get: async () => { reads.push(path); return snapshot(path) } }),
    getAll: async (...references) => references.map((reference) => { reads.push(reference.path); return snapshot(reference.path) }),
    collection: (collection) => {
      const build = (filters = [], maximum = Infinity, after = '', selected = []) => ({
        where: (field, operation, value) => {
          assert.equal(operation, '==')
          return build([...filters, [field, value]], maximum, after, selected)
        },
        limit: (value) => build(filters, value, after, selected),
        orderBy: () => build(filters, maximum, after, selected),
        startAfter: (last) => build(filters, maximum, last.id, selected),
        select: (...fields) => build(filters, maximum, after, fields),
        get: async () => {
          queries.push({ collection, filters, maximum, after, selected })
          const rows = [...documents].filter(([path, value]) => (
            path.split('/').length === collection.split('/').length + 1
            && path.startsWith(`${collection}/`)
            && path.split('/').at(-1) > after
            && filters.every(([field, expected]) => value[field] === expected)
          )).sort(([a], [b]) => a.localeCompare(b)).slice(0, maximum)
          return { docs: rows.map(([path, value]) => snapshot(path, selected.length
            ? Object.fromEntries(selected.filter((field) => Object.hasOwn(value, field)).map((field) => [field, value[field]]))
            : value)) }
        },
      })
      return build()
    },
    runTransaction: (callback) => {
      const current = lock.then(async () => {
        const pending = []
        const transaction = {
          get: async (reference) => {
            assert.equal(pending.length, 0, 'transaction must finish reads before writes')
            reads.push(reference.path)
            return snapshot(reference.path)
          },
          getAll: async (...references) => {
            assert.equal(pending.length, 0, 'transaction must finish reads before writes')
            return references.map((reference) => { reads.push(reference.path); return snapshot(reference.path) })
          },
          set: (reference, value, options) => pending.push([reference.path, value, options]),
        }
        const result = await callback(transaction)
        for (const [path, value, options] of pending) {
          documents.set(path, options?.merge ? { ...(documents.get(path) || {}), ...value } : value)
          writes.push({ path, value })
        }
        return result
      })
      lock = current.catch(() => {})
      return current
    },
  }
  return db
}
function event(source, id, before, after, seconds = 1_700_000_010, nanoseconds = 1) {
  const document = (value, nanos = nanoseconds) => ({
    id, exists: value !== null, data: () => value,
    ref: { parent: { id: source } },
    updateTime: { seconds, nanoseconds: nanos },
  })
  return {
    id: `${source}-${id}-${seconds}-${nanoseconds}`,
    time: new Date(seconds * 1000).toISOString(),
    params: { documentId: id },
    data: { before: document(before, 0), after: document(after) },
  }
}
function assertLane(db, path, lane, expected = version(1_700_000_010, 1)) {
  assert.equal(db.documents.get(path)?.[lane], expected, `${path} ${lane}`)
}

test('unsupported, settings unrelated, source no-op, and profile preference changes do no database work', async () => {
  const db = new Proxy({}, { get: () => { throw new Error('No-op must not reach Firestore') } })
  for (const item of [
    event('students', 's1', { name: 'An', updatedAt: 'old' }, { name: 'An', updatedAt: 'new' }),
    event('contractUsageViews', 'c1', { usedSessions: 4, generatedAt: 'old' }, { usedSessions: 4, generatedAt: 'new' }),
    event('contractUsageViews', 'c1', { usedSessions: 4, sourceFingerprint: 'business-v1' }, { usedSessions: 4, sourceFingerprint: 'business-v1', reconciledAt: 'new', contractSourceFingerprint: 'source-v2', lastSessionSourceFingerprint: 'delivery-v2', reconciliationProjectionFingerprint: 'business-v2' }),
    event('users', 'u1', { role: 'staff', mealReminderTime: '08:00', notificationSettings: { enabled: true } }, { role: 'staff', mealReminderTime: '09:00', notificationSettings: { enabled: false } }),
    event('settings', 'unrelated', {}, { enabled: true }),
    event('trainers', 't1', { name: 'An', status: 'active', availabilitySlots: [], payroll: 1 }, { name: 'An', status: 'inactive', availabilitySlots: ['08:00'], payroll: 2 }),
    event('mealLogs', 'm1', null, { calories: 300 }),
  ]) assert.ok((await syncWorkspaceChangesFromEvent({ db, event: item })).skipped)
})

test('student account/branch moves notify old/new accounts, legacy links and cross-branch session PTs', async () => {
  const before = { accountUid: 'old-account', branchId: 'old-branch', name: 'Old', trainerId: 'old-trainer' }
  const after = { accountUid: 'new-account', branchId: 'new-branch', name: 'New' }
  const db = fakeDb({
    'students/crm-student': after,
    'users/old-account': {}, 'users/new-account': {}, 'users/old-trainer': {}, 'users/visiting-trainer': {},
    'roleAssignments/student-alias': { crmProfileId: 'crm-student', accessRole: 'staff' },
    'roleAssignments/trainer-account': { crmProfileId: 'legacy-trainer', accessRole: 'staff' },
    'contracts/c1': { studentId: 'crm-student', trainerId: 'legacy-trainer', branchId: 'new-branch' },
    'sessions/cross-branch': { studentId: 'crm-student', trainerId: 'visiting-trainer', branchId: 'remote-branch' },
  })
  const result = await syncWorkspaceChangesFromEvent({ db, event: event('students', 'crm-student', before, after) })
  for (const uid of ['old-account', 'new-account', 'student-alias']) assertLane(db, userPath(uid), S)
  for (const uid of ['old-trainer', 'trainer-account', 'visiting-trainer']) assertLane(db, userPath(uid), T)
  for (const id of ['old-branch', 'new-branch', 'remote-branch']) assertLane(db, branchPath(id), T)
  assert.equal(db.documents.has(userPath('crm-student')), false, 'a CRM id must not be guessed to be an Auth uid')
  assert.equal(result.overflowCount, 0)
  assert.equal(db.documents.has('workspaceChanges/policy'), false)
  for (const write of db.writes) assert.deepEqual(Object.keys(write.value).sort(), [Object.keys(write.value).find((key) => key.endsWith('Version')), 'schemaVersion', 'updatedAt'].sort())
})

test('contracts notify removed and added assignees/accounts and a PT teaching under another branch', async () => {
  const before = { studentId: 'old-student', trainerIds: ['old-trainer'], branchId: 'old-branch' }
  const after = { studentId: 'new-student', trainerIds: ['new-trainer'], branchId: 'new-branch' }
  const db = fakeDb({
    'contracts/c1': after,
    'students/old-student': { accountUid: 'old-account', branchId: 'old-branch' },
    'students/new-student': { accountUid: 'new-account', branchId: 'new-branch' },
    'users/old-trainer': {}, 'users/new-trainer': {}, 'users/visiting-trainer': {},
    'sessions/cross': { studentId: 'old-student', trainerId: 'visiting-trainer', branchId: 'remote-branch' },
  })
  await syncWorkspaceChangesFromEvent({ db, event: event('contracts', 'c1', before, after) })
  for (const uid of ['old-account', 'new-account']) assertLane(db, userPath(uid), S)
  for (const uid of ['old-trainer', 'new-trainer', 'visiting-trainer']) assertLane(db, userPath(uid), T)
  for (const branch of ['old-branch', 'new-branch', 'remote-branch']) assertLane(db, branchPath(branch), T)
})

test('session reassignment routes directly without scanning student history', async () => {
  const before = { studentId: 's1', contractId: 'c1', trainerId: 'old-trainer', branchId: 'old-branch' }
  const after = { ...before, trainerId: 'new-trainer', branchId: 'new-branch', status: 'completed' }
  const db = fakeDb({
    'students/s1': { accountUid: 'student-account', branchId: 'roster-branch' },
    'contracts/c1': { studentId: 's1', trainerId: 'primary-trainer', branchId: 'contract-branch' },
    'users/old-trainer': {}, 'users/new-trainer': {}, 'users/primary-trainer': {},
  })
  await syncWorkspaceChangesFromEvent({ db, event: event('sessions', 'session-1', before, after) })
  assertLane(db, userPath('student-account'), S)
  for (const uid of ['old-trainer', 'new-trainer', 'primary-trainer']) assertLane(db, userPath(uid), T)
  assertLane(db, branchPath('roster-branch'), T)
  assert.equal(db.queries.some((query) => ['sessions', 'contracts'].includes(query.collection)), false)
})

test('attendance with only a session reference finds the student, actual PT, and contract assignee', async () => {
  const db = fakeDb({
    'sessions/session-1': { studentId: 's1', contractId: 'c1', trainerId: 'visiting-trainer', branchId: 'remote' },
    'contracts/c1': { studentId: 's1', trainerId: 'assigned-trainer' },
    'students/s1': { accountUid: 'u1' }, 'users/visiting-trainer': {}, 'users/assigned-trainer': {},
  })
  await syncWorkspaceChangesFromEvent({ db, event: event('attendanceEvents', 'a1', null, { sessionId: 'session-1', status: 'present' }) })
  assertLane(db, userPath('u1'), S)
  assertLane(db, userPath('visiting-trainer'), T)
  assertLane(db, userPath('assigned-trainer'), T)
})

test('availability and leave updates change only student schedule lanes', async () => {
  for (const source of ['ptAvailability', 'leaveRequests']) {
    const db = fakeDb({ 'students/s1': { accountUid: 'u1', branchId: 'b1', trainerId: 't1' }, 'users/t1': {} })
    await syncWorkspaceChangesFromEvent({ db, event: event(source, 's1_2026-10-19', null, { studentId: 's1', accountUid: 'u1', trainerId: 't1', branchId: 'b1' }) })
    assertLane(db, userPath('u1'), S)
    assert.equal(db.documents.has(userPath('t1')), false)
    assert.equal(db.documents.has(branchPath('b1')), false)
  }
})

test('retries, concurrent delivery and out-of-order events never rewrite or decrease a watermark', async () => {
  const db = fakeDb()
  const newest = event('users', 'u1', { authzVersion: 1 }, { authzVersion: 2 }, 1_700_000_100, 5)
  const results = await Promise.all([
    syncWorkspaceChangesFromEvent({ db, event: newest }),
    syncWorkspaceChangesFromEvent({ db, event: newest }),
  ])
  assert.equal(results.reduce((sum, row) => sum + row.changedDocuments, 0), 1)
  assert.equal(db.writes.length, 1)
  const older = await syncWorkspaceChangesFromEvent({ db, event: event('users', 'u1', { authzVersion: 0 }, { authzVersion: 1 }, 1_700_000_100, 4) })
  assert.equal(older.changedDocuments, 0)
  assertLane(db, userPath('u1'), S, version(1_700_000_100, 5))
  assertLane(db, userPath('u1'), T, version(1_700_000_100, 5))
})

test('deletions use deletion event time instead of the old document update time', async () => {
  const db = fakeDb({ [userPath('u1')]: { [S]: version(1_700_000_020), [T]: version(1_700_000_020) } })
  const deleted = event('users', 'u1', { role: 'staff' }, null, 1_700_000_010)
  deleted.time = new Date(1_700_000_100 * 1000).toISOString()
  await syncWorkspaceChangesFromEvent({ db, event: deleted })
  assertLane(db, userPath('u1'), S, version(1_700_000_100))
  assertLane(db, userPath('u1'), T, version(1_700_000_100))
})

test('large session audiences explicitly fall back to trainer policy without touching student policy', async () => {
  const initial = { 'students/s1': { accountUid: 'u1' }, 'contracts/c1': { studentId: 's1' } }
  for (let index = 0; index <= RECIPIENT_QUERY_LIMIT; index += 1) {
    initial[`sessions/session-${String(index).padStart(4, '0')}`] = { studentId: 's1', trainerId: `trainer-${index}` }
  }
  const db = fakeDb(initial)
  const result = await syncWorkspaceChangesFromEvent({ db, event: event('contractUsageViews', 'c1', { studentId: 's1', usedSessions: 1 }, { studentId: 's1', usedSessions: 2 }) })
  assert.equal(result.overflowCount, 1)
  assert.deepEqual(result.overflowSources, ['sessions.studentId'])
  assertLane(db, 'workspaceChanges/policy', T)
  assert.equal(db.documents.get('workspaceChanges/policy')[S], undefined)
  assertLane(db, userPath('u1'), S)
  assert.ok(db.queries.every((query) => query.maximum <= RECIPIENT_QUERY_LIMIT + 1))
})

test('all legacy Auth accounts are notified across identity pages and metadata transaction chunks', async () => {
  const initial = { 'students/s1': { name: 'New' } }
  for (let index = 0; index < RECIPIENT_QUERY_LIMIT + 3; index += 1) initial[`roleAssignments/u-${String(index).padStart(4, '0')}`] = { crmProfileId: 's1', accessRole: 'student' }
  const db = fakeDb(initial)
  const result = await syncWorkspaceChangesFromEvent({ db, event: event('students', 's1', { name: 'Old' }, { name: 'New' }) })
  assert.equal(result.userCount, RECIPIENT_QUERY_LIMIT + 3)
  assert.equal(result.changedDocuments, RECIPIENT_QUERY_LIMIT + 3)
  assertLane(db, userPath(`u-${String(RECIPIENT_QUERY_LIMIT + 2).padStart(4, '0')}`), S)
  assert.equal(db.documents.has('workspaceChanges/policy'), false)
})

test('legacy student document keyed by a real Auth uid is covered without accountUid', async () => {
  const db = fakeDb({ 'students/u1': { name: 'New' }, 'users/u1': { role: 'student' } })
  await syncWorkspaceChangesFromEvent({ db, event: event('students', 'u1', { name: 'Old' }, { name: 'New' }) })
  assertLane(db, userPath('u1'), S)
})

test('read state is stable, account/lane scoped, includes selected branches and never writes', async () => {
  const db = fakeDb({
    [userPath('u1')]: { [S]: version(1_700_000_001), [T]: version(1_700_000_002) },
    [branchPath('b1')]: { [T]: version(1_700_000_003) },
    [branchPath('outside')]: { [T]: version(1_700_000_004) },
    'workspaceChanges/policy': { [S]: version(1_700_000_005), [T]: version(1_700_000_006) },
  })
  const first = await readWorkspaceChangeState({ db, uid: 'u1', kind: 'trainer', branchIds: ['b2', 'b1', 'b1'] })
  const reordered = await readWorkspaceChangeState({ db, uid: 'u1', kind: 'trainer', branchIds: ['b1', 'b2'] })
  assert.deepEqual(first, reordered)
  assert.deepEqual(first.branchVersions, { b1: version(1_700_000_003), b2: '0' })
  assert.equal(first.userVersion, version(1_700_000_002))
  const student = await readWorkspaceChangeState({ db, uid: 'u1', kind: 'student', branchIds: ['b1'] })
  assert.equal(student.userVersion, version(1_700_000_001))
  assert.deepEqual(student.branchVersions, {})
  assert.notEqual(first.version, student.version)
  assert.notEqual(first.version, (await readWorkspaceChangeState({ db, uid: 'other', kind: 'trainer', branchIds: ['b1', 'b2'] })).version)
  assert.equal(db.reads.includes(branchPath('outside')), false)
  assert.equal(db.writes.length, 0)
})

test('canonical branch edits advance trainer policy even with the same time or clock drift', async () => {
  const db = fakeDb({ 'workspaceChanges/policy': { [S]: version(1_700_000_001) } })
  const next = await db.runTransaction((transaction) => writeWorkspacePolicyChange({ db, transaction, at: { seconds: 1_700_000_050, nanoseconds: 1 }, student: false }))
  assert.equal(next.changed, true)
  assertLane(db, 'workspaceChanges/policy', T, version(1_700_000_050, 1))
  assertLane(db, 'workspaceChanges/policy', S, version(1_700_000_001))
  const same = await db.runTransaction((transaction) => writeWorkspacePolicyChange({ db, transaction, at: { seconds: 1_700_000_050, nanoseconds: 1 }, student: false }))
  assert.equal(same.changed, true)
  assertLane(db, 'workspaceChanges/policy', T, version(1_700_000_050, 2))
  const prior = await db.runTransaction((transaction) => writeWorkspacePolicyChange({ db, transaction, at: { seconds: 1_700_000_049, nanoseconds: 0 }, student: false }))
  assert.equal(prior.changed, true)
  assertLane(db, 'workspaceChanges/policy', T, version(1_700_000_050, 3))
  assertLane(db, 'workspaceChanges/policy', S, version(1_700_000_001))
  assert.equal(db.writes.length, 3)
})

test('canonical policy advances across a nanosecond rollover and both selected lanes', async () => {
  const db = fakeDb({ 'workspaceChanges/policy': { [S]: version(1_700_000_051, 999_999_999), [T]: version(1_700_000_050) } })
  await db.runTransaction((transaction) => writeWorkspacePolicyChange({ db, transaction, at: { seconds: 1_700_000_050, nanoseconds: 1 } }))
  assertLane(db, 'workspaceChanges/policy', S, version(1_700_000_052))
  assertLane(db, 'workspaceChanges/policy', T, version(1_700_000_052))
})

test('trainer names and existence affect only student policy; scheduleConfig affects both lanes', async () => {
  for (const [before, after] of [[{ name: 'An' }, { name: 'Binh' }], [null, { name: 'An' }], [{ name: 'An' }, null]]) {
    const db = fakeDb()
    const item = event('trainers', 't1', before, after)
    await syncWorkspaceChangesFromEvent({ db, event: item })
    assertLane(db, 'workspaceChanges/policy', S, version(1_700_000_010, after ? 1 : 0))
    assert.equal(db.documents.get('workspaceChanges/policy')[T], undefined)
  }
  const db = fakeDb()
  await syncWorkspaceChangesFromEvent({ db, event: event('settings', 'scheduleConfig', { cutoffHour: 12 }, { cutoffHour: 13 }) })
  assertLane(db, 'workspaceChanges/policy', S)
  assertLane(db, 'workspaceChanges/policy', T)
})

test('source timestamps keep nanoseconds and malformed timestamps fail before publishing', async () => {
  assert.equal(timestampVersion('2026-10-23T12:30:00.000000123Z'), timestampVersion({ seconds: Date.parse('2026-10-23T12:30:00Z') / 1000, nanoseconds: 123 }))
  const db = fakeDb()
  const malformed = event('users', 'u1', null, { role: 'student' })
  delete malformed.time
  delete malformed.data.after.updateTime
  await assert.rejects(syncWorkspaceChangesFromEvent({ db, event: malformed }), /source commit\/event timestamp/)
  assert.equal(db.writes.length, 0)
})
