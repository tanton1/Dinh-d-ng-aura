'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildPtScheduleWeeklyView,
  compactCoverage,
  compactSchedule,
  weeklyViewId,
  rebuildPtScheduleWeeklyView,
  markPtScheduleWeeklyViewDirty,
  syncPtScheduleWeeklyViewSource,
  createPtScheduleWeeklyViewFunctions,
} = require('./pt-schedule-weekly-view')

const WEEK = '2026-10-19'
const BRANCH = 'branch-a'

function workspace(overrides = {}) {
  return {
    weekId: WEEK,
    readMode: 'reconciled',
    partial: false,
    branch: { id: BRANCH, name: 'Aura A' },
    draft: { revision: 4, status: 'draft', publishedVersion: 0, publishedRevision: -1 },
    schedule: {
      'T2-6': [{ studentId: 'student-a', trainerId: 'trainer-a', branchId: BRANCH, type: 'training', contractId: 'contract-a', source: 'manual_v2' }],
    },
    students: [{
      id: 'student-a', name: 'Lan', phone: '0901', email: 'lan@example.com', status: 'active', branchId: BRANCH,
      sessionsPerWeek: 2, activeScheduledThisWeek: 1, remainingSchedulableSessions: 10,
      availabilityStatus: 'submitted', availabilityRevision: 2, contractStatus: 'active', eligibleContractIds: ['contract-a'],
    }],
    crossBranchStudents: [],
    trainers: [{ id: 'trainer-a', name: 'Mai', branchId: BRANCH, availabilityMode: 'configured', slotCapacity: 2 }],
    sessions: [],
    weeklySessionCoverage: {},
    ...overrides,
  }
}

test('weekly view id is deterministic by branch and Monday week', () => {
  assert.equal(weeklyViewId(BRANCH, WEEK), 'branch-a_2026-10-19')
})

test('compact schedule strips raw fields but keeps editable identity', () => {
  const schedule = compactSchedule({
    'T2-6': [{ studentId: 's', trainerId: 't', branchId: BRANCH, contractId: 'c', type: 'training', source: 'manual_v2', secret: 'do-not-copy' }],
  })
  assert.deepEqual(schedule['T2-6'][0], {
    studentId: 's', trainerId: 't', branchId: BRANCH, type: 'training', contractId: 'c', source: 'manual_v2', isLocked: false,
  })
  assert.equal(schedule['T2-6'][0].secret, undefined)
})

test('display coverage is explicitly estimated, never verified', () => {
  const value = compactCoverage({
    students: [{ id: 's', sessionsPerWeek: 2 }],
    schedule: { 'T2-6': [{ studentId: 's', trainerId: 't', type: 'training' }] },
    exact: false,
  })
  assert.equal(value.status, 'estimated')
  assert.equal(value.verification, 'draft_only')
  assert.equal(value.verified, false)
  assert.equal(value.missingSessions, 1)
})

test('weekly view enriches incomplete profiles and missing-session warnings', () => {
  const view = buildPtScheduleWeeklyView({
    branchId: BRANCH,
    weekId: WEEK,
    data: workspace({
      partial: false,
      students: [{
        id: 'student-a', name: '', phone: '', email: '', status: 'active', branchId: BRANCH,
        sessionsPerWeek: 2, availabilityStatus: 'missing', contractStatus: 'missing', eligibleContractIds: [],
      }],
    }),
  })
  assert.equal(view.freshness, 'verified')
  assert.equal(view.verification, 'exact')
  assert.equal(view.coverage.byStudent['student-a'].missingSessions, 1)
  assert.ok(view.warnings.some((warning) => warning.code === 'PROFILE_DATA_INCOMPLETE' && warning.studentId === 'student-a'))
  assert.ok(view.warnings.some((warning) => warning.code === 'STUDENT_MISSING_SESSIONS' && warning.missingSessions === 1))
  assert.equal(view.students[0].profileComplete, false)
  assert.deepEqual(view.students[0].missingFields.sort(), ['availability', 'contract', 'email', 'name', 'phone'])
})

test('display workspace keeps stale semantics and source changes advance revision', () => {
  const first = buildPtScheduleWeeklyView({
    branchId: BRANCH,
    weekId: WEEK,
    data: workspace({ partial: true, readMode: 'display' }),
  })
  assert.equal(first.freshness, 'display')
  assert.equal(first.dirty, false)
  const second = buildPtScheduleWeeklyView({
    branchId: BRANCH,
    weekId: WEEK,
    previousView: first,
    data: workspace({ partial: true, readMode: 'display', draft: { ...workspace().draft, revision: 5 } }),
  })
  assert.equal(second.viewRevision, first.viewRevision + 1)
  assert.notEqual(second.sourceRevision, first.sourceRevision)
})

test('semantic revision covers contact, trainer, contract, configuration and diagnostics fields', () => {
  const data = workspace({ contracts: [{ id: 'contract-a', studentId: 'student-a', packageName: 'PT', status: 'active' }], config: { slotCapacity: 2 } })
  const first = buildPtScheduleWeeklyView({ branchId: BRANCH, weekId: WEEK, data })
  const changes = [
    (value) => { value.students[0].name = 'Lan updated' },
    (value) => { value.students[0].phone = '0902' },
    (value) => { value.students[0].email = 'new@example.com' },
    (value) => { value.trainers[0].name = 'Mai updated' },
    (value) => { value.contracts[0].packageName = 'PT premium' },
    (value) => { value.config.slotCapacity = 3 },
    (value) => { value.draft.warnings = [{ code: 'CUSTOM_WARNING', studentId: 'student-a', message: 'Check this' }] },
    (value) => { value.draft.unassignedEntries = [{ studentId: 'student-a', missingSessions: 1, reasons: ['No availability'] }] },
    (value) => { value.draft.optimizationSummary = { generationMode: 'refill', optimalityGap: 1 } },
    (value) => { value.weeklySessionCoverage = { 'student-a': { otherBranches: 1, total: 2 } } },
  ]
  for (const change of changes) {
    const updated = structuredClone(data)
    change(updated)
    const next = buildPtScheduleWeeklyView({ branchId: BRANCH, weekId: WEEK, data: updated, previousView: first })
    assert.notEqual(next.sourceRevision, first.sourceRevision, String(change))
    assert.equal(next.viewRevision, first.viewRevision + 1)
  }
})

test('semantic hash ignores projection clocks and key order, but retains business dates', () => {
  const data = workspace({ config: { capacity: 2, nested: { a: 1, b: 2 } } })
  const first = buildPtScheduleWeeklyView({ branchId: BRANCH, weekId: WEEK, data, now: new Date('2026-10-20') })
  const updated = structuredClone(data)
  updated.config = { nested: { b: 2, a: 1 }, capacity: 2 }
  updated.draft.updatedAt = '2026-10-21T01:00:00Z'
  const same = buildPtScheduleWeeklyView({ branchId: BRANCH, weekId: WEEK, data: updated, previousView: first, now: new Date('2026-10-21') })
  assert.equal(same.sourceRevision, first.sourceRevision)
  assert.equal(same.viewRevision, first.viewRevision)
  updated.students[0].availabilityCutoffAt = '2026-10-22T01:00:00Z'
  assert.notEqual(buildPtScheduleWeeklyView({ branchId: BRANCH, weekId: WEEK, data: updated }).sourceRevision, first.sourceRevision)
})

// Small serial transactional fixture: source loading occurs outside the lock,
// so tests can interleave dirty writes, lease expiry and a replacement worker.
function fakeDb(seed = {}) {
  const values = new Map(Object.entries(seed).map(([key, value]) => [key, structuredClone(value)]))
  const versions = new Map(Object.keys(seed).map((key) => [key, 1]))
  const queries = []
  let queue = Promise.resolve()
  const snapshot = (path, fields) => {
    const value = values.get(path)
    const selected = fields && value ? Object.fromEntries(fields.filter((key) => value[key] !== undefined).map((key) => [key, value[key]])) : value
    return { id: path.split('/').pop(), ref: { path }, exists: value !== undefined, updateTime: value === undefined ? undefined : { seconds: versions.get(path) || 1, nanoseconds: 0 }, data: () => selected === undefined ? undefined : structuredClone(selected) }
  }
  const write = (path, value, options) => {
    const result = options?.merge ? { ...(values.get(path) || {}) } : {}
    for (const [key, item] of Object.entries(value)) {
      if (item?.constructor?.name === 'NumericIncrementTransform') result[key] = Number(values.get(path)?.[key] || 0) + item.operand
      else if (item?.constructor?.name === 'ServerTimestampTransform') result[key] = '2026-10-23T00:00:00.000Z'
      else result[key] = structuredClone(item)
    }
    values.set(path, result)
    versions.set(path, (versions.get(path) || 0) + 1)
  }
  const makeQuery = (collection, filters = [], count = Infinity, cursor = '', fields = null) => ({
    where: (...filter) => makeQuery(collection, [...filters, filter], count, cursor, fields),
    orderBy: () => makeQuery(collection, filters, count, cursor, fields),
    limit: (nextCount) => makeQuery(collection, filters, nextCount, cursor, fields),
    startAfter: (document) => makeQuery(collection, filters, count, document.id, fields),
    select: (...nextFields) => makeQuery(collection, filters, count, cursor, nextFields),
    get: async () => {
      queries.push({ collection, filters, count, cursor })
      const docs = [...values.keys()].filter((path) => path.split('/').length === 2 && path.startsWith(`${collection}/`) && path.split('/').pop() > cursor)
        .filter((path) => filters.every(([key, op, expected]) => op === '==' ? values.get(path)[key] === expected : op === 'array-contains-any' && (values.get(path)[key] || []).some((item) => expected.includes(item))))
        .sort().slice(0, count).map((path) => snapshot(path, fields))
      return { docs, size: docs.length }
    },
  })
  return {
    values, queries,
    doc: (path) => ({ path, get: async () => snapshot(path), set: async (value, options) => write(path, value, options) }),
    collection: (name) => makeQuery(name),
    runTransaction: (callback) => {
      const run = queue.then(async () => {
        const writes = []
        const result = await callback({
          get: async (reference) => snapshot(reference.path),
          getAll: async (...references) => references.map((reference) => snapshot(reference.path)),
          set: (reference, value, options) => writes.push(() => write(reference.path, value, options)),
          delete: (reference) => writes.push(() => values.delete(reference.path)),
        })
        writes.forEach((apply) => apply())
        return result
      })
      queue = run.catch(() => {})
      return run
    },
  }
}

const viewPath = (branchId = BRANCH, weekId = WEEK) => `ptScheduleWeeklyViews/${weeklyViewId(branchId, weekId)}`
const leasePath = `systemJobs/ptScheduleWeeklyViewRebuild/views/${weeklyViewId(BRANCH, WEEK)}`
const initialView = () => buildPtScheduleWeeklyView({ branchId: BRANCH, weekId: WEEK, data: workspace() })
function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

test('concurrent viewers share a lease before expensive reads, including bootstrap', async () => {
  for (const bootstrap of [false, true]) {
    const db = fakeDb(bootstrap ? {} : { [viewPath()]: { ...initialView(), dirty: true, dirtyGeneration: 1 } })
    const entered = deferred()
    const resume = deferred()
    let loads = 0
    const branchData = async () => { loads += 1; entered.resolve(); await resume.promise; return workspace() }
    const first = rebuildPtScheduleWeeklyView({ db, branchId: BRANCH, weekId: WEEK, branchData })
    await entered.promise
    const second = rebuildPtScheduleWeeklyView({ db, branchId: BRANCH, weekId: WEEK, branchData })
    if (bootstrap) await assert.rejects(second, (error) => error.code === 'unavailable' && error.details.rebuildStatus === 'busy')
    else assert.equal((await second).rebuildStatus, 'busy')
    assert.equal(loads, 1)
    resume.resolve()
    assert.equal((await first).dirty, false)
    assert.equal(db.values.has(leasePath), false)
  }
})

test('dirty write during source loading cannot be cleared or overwritten by stale builder', async () => {
  const before = initialView()
  const db = fakeDb({ [viewPath()]: { ...before, dirty: true, dirtyGeneration: 1 } })
  const result = await rebuildPtScheduleWeeklyView({
    db, branchId: BRANCH, weekId: WEEK,
    branchData: async () => {
      await markPtScheduleWeeklyViewDirty({ db, branchId: BRANCH, weekId: WEEK, reason: 'mid_build' })
      return workspace({ draft: { revision: 5 } })
    },
  })
  assert.equal(result.rebuildStatus, 'superseded')
  assert.equal(result.dirty, true)
  assert.equal(db.values.get(viewPath()).dirtyGeneration, 2)
  assert.equal(db.values.get(viewPath()).sourceRevision, before.sourceRevision)
  assert.equal(db.values.has(leasePath), false)
  const retry = await rebuildPtScheduleWeeklyView({ db, branchId: BRANCH, weekId: WEEK, branchData: async () => workspace({ draft: { revision: 6 } }) })
  assert.equal(retry.dirty, false)
  assert.equal(retry.dirtyGeneration, 2)
  assert.equal(retry.viewRevision, before.viewRevision + 1)
})

test('failed builder releases its lease and leaves dirty state retryable', async () => {
  const db = fakeDb({ [viewPath()]: { ...initialView(), dirty: true, dirtyGeneration: 7 } })
  await assert.rejects(rebuildPtScheduleWeeklyView({ db, branchId: BRANCH, weekId: WEEK, branchData: async () => { throw new Error('source failed') } }), /source failed/)
  assert.equal(db.values.has(leasePath), false)
  assert.equal(db.values.get(viewPath()).dirty, true)
  const result = await rebuildPtScheduleWeeklyView({ db, branchId: BRANCH, weekId: WEEK, branchData: async () => workspace() })
  assert.equal(result.dirtyGeneration, 7)
  assert.equal(result.dirty, false)
})

test('legacy dirty writes without generation increments are protected during rollout', async () => {
  const before = initialView()
  const db = fakeDb({ [viewPath()]: { ...before, dirty: true, dirtyGeneration: 1 } })
  const result = await rebuildPtScheduleWeeklyView({
    db, branchId: BRANCH, weekId: WEEK,
    branchData: async () => {
      await db.doc(viewPath()).set({ dirty: true, dirtyAt: '2026-10-23T00:01:00Z' }, { merge: true })
      return workspace({ draft: { revision: 9 } })
    },
  })
  assert.equal(result.rebuildStatus, 'superseded')
  assert.equal(db.values.get(viewPath()).dirty, true)
  assert.equal(db.values.get(viewPath()).sourceRevision, before.sourceRevision)
})

test('expired builder cannot overwrite a replacement or delete the replacement lease', async () => {
  const db = fakeDb({ [viewPath()]: { ...initialView(), dirty: true, dirtyGeneration: 3 } })
  let millis = 1000
  const firstEntered = deferred()
  const firstResume = deferred()
  const secondEntered = deferred()
  const secondResume = deferred()
  const first = rebuildPtScheduleWeeklyView({ db, branchId: BRANCH, weekId: WEEK, clock: () => millis, branchData: async () => { firstEntered.resolve(); await firstResume.promise; return workspace({ draft: { revision: 10 } }) } })
  await firstEntered.promise
  millis += 180_001
  const second = rebuildPtScheduleWeeklyView({ db, branchId: BRANCH, weekId: WEEK, clock: () => millis, branchData: async () => { secondEntered.resolve(); await secondResume.promise; return workspace({ draft: { revision: 11 } }) } })
  await secondEntered.promise
  const token = db.values.get(leasePath).token
  firstResume.resolve()
  assert.equal((await first).rebuildStatus, 'superseded')
  assert.equal(db.values.get(leasePath).token, token)
  secondResume.resolve()
  assert.equal((await second).draft.revision, 11)
  assert.equal(db.values.get(viewPath()).draft.revision, 11)
})

function sourceEvent(before, after, params = {}) {
  return { params, data: { before: { exists: Boolean(before), data: () => before }, after: { exists: Boolean(after), data: () => after } } }
}
const silentLogger = { info() {} }

test('session moves invalidate both old/new weeks and cross-branch coverage', async () => {
  const db = fakeDb({
    [viewPath('branch-c', WEEK)]: { ...initialView(), branchId: 'branch-c', sourceStudentIds: ['student-a'] },
    [viewPath('branch-c', '2026-10-26')]: { ...initialView(), branchId: 'branch-c', weekId: '2026-10-26', sourceStudentIds: ['student-a'] },
  })
  const result = await syncPtScheduleWeeklyViewSource({ db, source: 'session', logger: silentLogger, event: sourceEvent(
    { branchId: BRANCH, date: '2026-10-20', studentId: 'student-a' },
    { branchId: 'branch-b', date: '2026-10-27', studentId: 'student-a' }, { sessionId: 'session-a' },
  ) })
  assert.equal(result.marked, 4)
  assert.equal(db.queries.length, 2, 'only the two changed weeks are queried, never all weekly history')
  for (const path of [viewPath(), viewPath('branch-b', '2026-10-26'), viewPath('branch-c', WEEK), viewPath('branch-c', '2026-10-26')]) assert.equal(db.values.get(path).dirty, true, path)
})

test('contracts invalidate every cached week, not only the contract start week', async () => {
  const db = fakeDb({
    [viewPath()]: initialView(),
    [viewPath(BRANCH, '2026-11-02')]: { ...initialView(), weekId: '2026-11-02' },
    [viewPath('branch-b', WEEK)]: { ...initialView(), branchId: 'branch-b', schemaVersion: 1 },
  })
  const result = await syncPtScheduleWeeklyViewSource({ db, source: 'contract', logger: silentLogger, event: sourceEvent(null, { branchId: BRANCH, studentId: 'student-a', startDate: '2026-01-01', endDate: '2026-12-31' }, { contractId: 'contract-a' }) })
  assert.equal(result.marked, 3)
  assert.equal(db.values.get(viewPath(BRANCH, '2026-11-02')).dirty, true)
  assert.equal(db.values.get(viewPath('branch-b', WEEK)).dirty, true, 'legacy cross-branch view is covered during schema migration')
})

test('leave ranges invalidate intersecting weeks for before and after intervals', async () => {
  const weeks = ['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16']
  const db = fakeDb(Object.fromEntries(weeks.map((weekId) => [viewPath(BRANCH, weekId), { ...initialView(), weekId }])))
  const result = await syncPtScheduleWeeklyViewSource({ db, source: 'leave', logger: silentLogger, event: sourceEvent(
    { branchId: BRANCH, trainerId: 'trainer-a', startDate: '2026-10-23', endDate: '2026-10-28' },
    { branchId: BRANCH, trainerId: 'trainer-a', startDate: '2026-11-04', endDate: '2026-11-11' }, { requestId: 'leave-a' },
  ) })
  assert.equal(result.marked, 4)
  assert.notEqual(db.values.get(viewPath(BRANCH, '2026-11-16')).dirty, true)
})

test('global configuration invalidation paginates past 200 views with no 16-view truncation', async () => {
  const seed = {}
  for (let index = 0; index < 205; index += 1) {
    const branchId = `branch-${String(index).padStart(3, '0')}`
    seed[viewPath(branchId)] = { branchId, weekId: WEEK, schemaVersion: 1 }
  }
  const db = fakeDb(seed)
  const result = await syncPtScheduleWeeklyViewSource({ db, source: 'scheduleConfig', logger: silentLogger, event: sourceEvent({}, { maxConsecutiveDays: 3 }, { documentId: 'scheduleConfig' }) })
  assert.equal(result.marked, 205)
  assert.equal([...db.values.values()].filter((value) => value.dirty === true).length, 205)
  assert.equal(db.queries.length, 3)
  assert.ok(db.queries[1].cursor)
})

test('student branch changes paginate both branches and keep dirty counters monotonic', async () => {
  const seed = {}
  for (let index = 0; index < 105; index += 1) {
    const date = new Date('2026-01-05T00:00:00Z')
    date.setUTCDate(date.getUTCDate() + index * 7)
    const weekId = date.toISOString().slice(0, 10)
    seed[viewPath(BRANCH, weekId)] = { branchId: BRANCH, weekId, schemaVersion: 2, dirtyGeneration: 1 }
  }
  seed[viewPath('branch-b')] = { branchId: 'branch-b', weekId: WEEK, schemaVersion: 2 }
  const db = fakeDb(seed)
  const result = await syncPtScheduleWeeklyViewSource({ db, source: 'student', logger: silentLogger, event: sourceEvent({ branchId: BRANCH }, { branchId: 'branch-b' }, { studentId: 'student-a' }) })
  assert.equal(result.marked, 106)
  assert.equal(db.values.get(viewPath(BRANCH, '2026-01-05')).dirtyGeneration, 2)
  assert.equal(db.values.get(viewPath('branch-b')).dirtyGeneration, 1)
})

test('opening a clean legacy view upgrades once and preserves its verification level', async () => {
  for (const exact of [true, false]) {
    const legacy = { ...initialView(), schemaVersion: 1, dirty: false, verification: exact ? 'exact' : 'draft_only' }
    const db = fakeDb({ [viewPath()]: legacy })
    let loads = 0
    let checks = 0
    const functions = createPtScheduleWeeklyViewFunctions({
      db, onCall: (handler) => handler,
      actorForBranch: async () => { checks += 1 },
      branchData: async (_db, _branch, _week, options) => {
        loads += 1
        assert.equal(options.initialPaint, !exact)
        return workspace({ partial: !exact, readMode: exact ? 'reconciled' : 'display' })
      },
    })
    const request = { data: { branchId: BRANCH, weekId: WEEK, initialPaint: true } }
    const first = await functions.getPtScheduleWeeklyView(request)
    assert.equal(first.schemaVersion, 2)
    assert.equal(first.verification, exact ? 'exact' : 'draft_only')
    assert.deepEqual(first.sourceStudentIds, ['student-a'])
    await functions.getPtScheduleWeeklyView(request)
    assert.equal(loads, 1, 'clean v2 snapshots stay on the one-document path')
    assert.equal(checks, 2, 'every read retains branch authorization')
  }
})

test('availability edits invalidate subsequent inherited weeks and the old/new home branch', async () => {
  const db = fakeDb({
    [viewPath(BRANCH, '2026-10-12')]: { ...initialView(), weekId: '2026-10-12' },
    [viewPath()]: initialView(),
    [viewPath(BRANCH, '2026-10-26')]: { ...initialView(), weekId: '2026-10-26' },
    [viewPath('branch-b', '2026-10-26')]: { ...initialView(), branchId: 'branch-b', weekId: '2026-10-26' },
  })
  const result = await syncPtScheduleWeeklyViewSource({ db, source: 'availability', logger: silentLogger, event: sourceEvent(
    { branchId: BRANCH }, { branchId: 'branch-b' }, { availabilityId: `student-a_${WEEK}` },
  ) })
  assert.equal(result.marked, 4)
  assert.notEqual(db.values.get(viewPath(BRANCH, '2026-10-12')).dirty, true)
  assert.equal(db.values.get(viewPath(BRANCH, '2026-10-26')).dirty, true)
  assert.equal(db.values.get(viewPath('branch-b', '2026-10-26')).dirty, true)
})

test('deleted draft invalidates its week and cross-branch student coverage', async () => {
  const db = fakeDb({ [viewPath('branch-b')]: { ...initialView(), branchId: 'branch-b' } })
  const result = await syncPtScheduleWeeklyViewSource({ db, source: 'draft', logger: silentLogger, event: sourceEvent(
    { schedule: workspace().schedule }, null, { documentId: weeklyViewId(BRANCH, WEEK) },
  ) })
  assert.equal(result.marked, 2)
  assert.equal(db.values.get(viewPath()).dirty, true)
  assert.equal(db.values.get(viewPath('branch-b')).dirty, true)
})
