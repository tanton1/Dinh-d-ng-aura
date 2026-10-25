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
  rebuildDirtyPtScheduleWeeklyViews,
  createPtScheduleWeeklyViewFunctions,
  mergeWeeklyViewState,
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
  const reads = []
  const writes = []
  let queue = Promise.resolve()
  const snapshot = (path, fields) => {
    reads.push(path)
    const value = values.get(path)
    const selected = fields && value ? Object.fromEntries(fields.filter((key) => value[key] !== undefined).map((key) => [key, value[key]])) : value
    return { id: path.split('/').pop(), ref: { path }, exists: value !== undefined, updateTime: value === undefined ? undefined : { seconds: versions.get(path) || 1, nanoseconds: 0 }, data: () => selected === undefined ? undefined : structuredClone(selected) }
  }
  const write = (path, value, options) => {
    writes.push({ path, value, options })
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
    startAfter: (document) => makeQuery(collection, filters, count, typeof document === 'string' ? document : document.id, fields),
    select: (...nextFields) => makeQuery(collection, filters, count, cursor, nextFields),
    get: async () => {
      queries.push({ collection, filters, count, cursor, fields })
      const docs = [...values.keys()].filter((path) => path.split('/').length === 2 && path.startsWith(`${collection}/`) && path.split('/').pop() > cursor)
        .filter((path) => filters.every(([key, op, expected]) => op === '==' ? values.get(path)[key] === expected : op === 'array-contains-any' && (values.get(path)[key] || []).some((item) => expected.includes(item))))
        .sort().slice(0, count).map((path) => snapshot(path, fields))
      return { docs, size: docs.length }
    },
  })
  return {
    values, queries, reads, writes,
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
const statePath = (branchId = BRANCH, weekId = WEEK) => `ptScheduleWeeklyViewStates/${weeklyViewId(branchId, weekId)}`
const effectiveView = (db, branchId = BRANCH, weekId = WEEK) => mergeWeeklyViewState(db.values.get(viewPath(branchId, weekId)), db.values.get(statePath(branchId, weekId)))
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
  assert.equal(effectiveView(db).dirtyGeneration, 2)
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

test('profile and contract timestamp touches perform no weekly discovery reads or invalidation writes', async () => {
  const db = new Proxy({}, { get() { throw new Error('A timestamp-only touch must not access Firestore') } })
  for (const source of ['student', 'trainer', 'contract']) {
    const body = { branchId: BRANCH, name: 'Same profile', details: { updatedAt: 'meaningful-nested-value' } }
    for (const [previous, next] of [[undefined, '2026-10-25'], ['2026-10-24', undefined], ['2026-10-24', '2026-10-25'], [undefined, undefined]]) {
      const result = await syncPtScheduleWeeklyViewSource({ db, source, logger: silentLogger, event: sourceEvent(
        { ...body, ...(previous ? { updatedAt: previous } : {}) },
        { ...body, ...(next ? { updatedAt: next } : {}) },
        { [`${source}Id`]: `${source}-a` },
      ) })
      assert.deepEqual(result, { source, marked: 0, skipped: 'source_metadata_only' })
    }
  }
})

test('profile and contract business edits still invalidate historical and cross-branch dependent weeks', async () => {
  for (const source of ['student', 'trainer', 'contract']) {
    for (const change of [{ name: 'Renamed' }, { revision: 2 }, { endDate: '2026-12-31' }, { futureBusinessField: true }, { details: { updatedAt: 'new-nested-business-value' } }]) {
      const past = '2025-01-06'
      const db = fakeDb({
        [viewPath()]: initialView(),
        [viewPath(BRANCH, past)]: { ...initialView(), weekId: past },
        [viewPath('branch-c', past)]: { ...initialView(), branchId: 'branch-c', weekId: past, sourceStudentIds: ['student-a'], sourceTrainerIds: ['trainer-a'], sourceContractIds: ['contract-a'] },
      })
      const before = { branchId: BRANCH, name: 'Original', studentId: 'student-a', updatedAt: '2026-10-24' }
      const result = await syncPtScheduleWeeklyViewSource({ db, source, logger: silentLogger, event: sourceEvent(before, { ...before, ...change, updatedAt: '2026-10-25' }, { [`${source}Id`]: `${source}-a` }) })
      assert.equal(result.marked, 3, `${source}: ${JSON.stringify(change)}`)
      for (const target of [statePath(), statePath(BRANCH, past), statePath('branch-c', past)]) assert.equal(db.values.get(target)?.dirtyGeneration, 1)
    }
  }
})

test('profile and contract creation and deletion remain meaningful even with identical remaining fields', async () => {
  for (const source of ['student', 'trainer', 'contract']) {
    for (const removing of [false, true]) {
      const db = fakeDb({ [viewPath()]: initialView() })
      const value = { branchId: BRANCH, updatedAt: '2026-10-25' }
      const result = await syncPtScheduleWeeklyViewSource({ db, source, logger: silentLogger, event: sourceEvent(removing ? value : undefined, removing ? undefined : value, { [`${source}Id`]: `${source}-a` }) })
      assert.equal(result.marked, 1)
      assert.equal(db.values.get(statePath()).dirtyGeneration, 1)
    }
  }
})

test('draft timestamps retain their displayed meaning and still invalidate their week', async () => {
  const db = fakeDb({ [viewPath()]: initialView() })
  const result = await syncPtScheduleWeeklyViewSource({ db, source: 'draft', logger: silentLogger, event: sourceEvent(
    { branchId: BRANCH, weekId: WEEK, updatedAt: '2026-10-24' },
    { branchId: BRANCH, weekId: WEEK, updatedAt: '2026-10-25' }, { documentId: weeklyViewId(BRANCH, WEEK) },
  ) })
  assert.equal(result.marked, 1)
  assert.equal(db.values.get(statePath()).dirtyGeneration, 1)
})

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
  for (const path of [statePath(), statePath('branch-b', '2026-10-26'), statePath('branch-c', WEEK), statePath('branch-c', '2026-10-26')]) assert.equal(db.values.get(path).dirty, true, path)
})

test('contracts invalidate every cached week, not only the contract start week', async () => {
  const db = fakeDb({
    [viewPath()]: initialView(),
    [viewPath(BRANCH, '2026-11-02')]: { ...initialView(), weekId: '2026-11-02' },
    [viewPath('branch-b', WEEK)]: { ...initialView(), branchId: 'branch-b', schemaVersion: 1 },
  })
  const result = await syncPtScheduleWeeklyViewSource({ db, source: 'contract', logger: silentLogger, event: sourceEvent(null, { branchId: BRANCH, studentId: 'student-a', startDate: '2026-01-01', endDate: '2026-12-31' }, { contractId: 'contract-a' }) })
  assert.equal(result.marked, 3)
  assert.equal(db.values.get(statePath(BRANCH, '2026-11-02')).dirty, true)
  assert.equal(db.values.get(statePath('branch-b', WEEK)).dirty, true, 'legacy cross-branch view is covered during schema migration')
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
  assert.equal(effectiveView(db, BRANCH, '2026-01-05').dirtyGeneration, 2)
  assert.equal(db.values.get(statePath('branch-b')).dirtyGeneration, 1)
})

test('opening a clean legacy view upgrades lightly once and retains only existing exact evidence', async () => {
  for (const exact of [true, false]) {
    const legacy = { ...initialView(), schemaVersion: 1, dirty: false, verification: exact ? 'exact' : 'draft_only' }
    delete legacy.validationSnapshot
    delete legacy.validationState
    delete legacy.validationDirty
    const db = fakeDb({ [viewPath()]: legacy })
    let loads = 0
    let checks = 0
    const functions = createPtScheduleWeeklyViewFunctions({
      db, onCall: (handler) => handler,
      actorForBranch: async () => { checks += 1 },
      branchData: async (_db, _branch, _week, options) => {
        loads += 1
        assert.equal(options.initialPaint, true)
        return workspace({ partial: true, readMode: 'display' })
      },
    })
    const request = { data: { branchId: BRANCH, weekId: WEEK, initialPaint: true } }
    const first = await functions.getPtScheduleWeeklyView(request)
    assert.equal(first.schemaVersion, 2)
    assert.equal(first.verification, 'draft_only')
    assert.equal(first.validationState, exact ? 'stale' : 'unknown')
    assert.equal(Boolean(first.validationSnapshot), exact)
    assert.equal(first.validationDirty, true)
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
  assert.equal(db.values.get(statePath(BRANCH, '2026-10-26')).dirty, true)
  assert.equal(db.values.get(statePath('branch-b', '2026-10-26')).dirty, true)
})

test('deleted draft invalidates its week and cross-branch student coverage', async () => {
  const db = fakeDb({ [viewPath('branch-b')]: { ...initialView(), branchId: 'branch-b' } })
  const result = await syncPtScheduleWeeklyViewSource({ db, source: 'draft', logger: silentLogger, event: sourceEvent(
    { schedule: workspace().schedule }, null, { documentId: weeklyViewId(BRANCH, WEEK) },
  ) })
  assert.equal(result.marked, 2)
  assert.equal(db.values.get(statePath()).dirty, true)
  assert.equal(db.values.get(statePath('branch-b')).dirty, true)
})

test('exact validation has an independent bounded snapshot and light refresh retains it unchanged', () => {
  const data = workspace({
    contracts: [{ id: 'contract-a', studentId: 'student-a', packageName: 'PT full', totalSessions: 20, usedSessions: 10 }],
    weeklySessionCoverage: { 'student-a': { total: 1, currentBranch: 1, otherBranches: 0 } },
    draft: { ...workspace().draft, unassignedEntries: [{ studentId: 'student-a', missingSessions: 1 }], optimizationSummary: { missingSessions: 1 } },
  })
  const exact = buildPtScheduleWeeklyView({ branchId: BRANCH, weekId: WEEK, data })
  assert.equal(exact.validationState, 'current')
  assert.equal(exact.validationDirty, false)
  assert.equal(exact.validationSnapshot.schemaVersion, 1)
  assert.equal(exact.validationSnapshot.draftRevision, 4)
  assert.equal(exact.validationSnapshot.schedule, undefined)
  assert.equal(exact.validationSnapshot.students, undefined)
  assert.equal(exact.validationSnapshot.storage, 'top_level')
  assert.equal(exact.validationSnapshot.coverage, undefined, 'exact evidence is not duplicated')
  assert.equal(exact.coverage.missingSessions, 1)
  const lightData = workspace({ partial: true, readMode: 'display', contracts: [], schedule: {}, draft: { revision: 5 } })
  lightData.students[0] = {
    ...lightData.students[0], name: 'Lan updated', phone: '0909', email: 'updated@example.com', sessionsPerWeek: 3,
    eligibleForWeek: false, eligibleContractIds: [], contractStatus: 'hydrating', remainingSchedulableSessions: 0,
  }
  const light = buildPtScheduleWeeklyView({ branchId: BRANCH, weekId: WEEK, data: lightData, previousView: exact })
  assert.equal(light.validationSnapshot.storage, 'embedded')
  assert.equal(light.validationSnapshot.sourceRevision, exact.validationSnapshot.sourceRevision)
  assert.equal(light.validationSnapshot.validatedAt, exact.validationSnapshot.validatedAt)
  assert.deepEqual(light.validationSnapshot.coverage, exact.coverage)
  assert.deepEqual(light.validationSnapshot.warnings, exact.warnings)
  assert.deepEqual(light.validationSnapshot.contracts, exact.contracts)
  assert.equal(light.validationState, 'stale')
  assert.equal(light.validationDirty, true)
  assert.equal(light.coverage.verified, false, 'matrix estimates never impersonate retained validation')
  assert.equal(light.coverage.missingSessions, 3)
  assert.equal(light.students[0].name, 'Lan updated')
  assert.equal(light.students[0].phone, '0909')
  assert.equal(light.students[0].sessionsPerWeek, 3)
  assert.equal(light.students[0].remainingSchedulableSessions, 10)
  assert.deepEqual(light.students[0].eligibleContractIds, ['contract-a'])
  assert.equal(light.students[0].contract.packageName, 'PT full')
  assert.deepEqual(light.sourceContractIds, ['contract-a'], 'unscheduled retained contracts keep their invalidation dependency')
  assert.deepEqual(light.contracts, [], 'retained contracts live only in the validation plane')
  assert.equal(light.validationSnapshot.contracts[0].id, 'contract-a')
})

test('display-only bootstrap has unknown validation, never a fabricated exact zero', () => {
  const view = buildPtScheduleWeeklyView({ branchId: BRANCH, weekId: WEEK, data: workspace({ partial: true, readMode: 'display', students: [], schedule: {} }) })
  assert.equal(view.validationState, 'unknown')
  assert.equal(view.validationDirty, true)
  assert.equal(view.validationSnapshot, null)
  assert.equal(view.coverage.verified, false)
})

test('clean legacy draft-only read queues validation once with metadata and no source load', async () => {
  const legacy = buildPtScheduleWeeklyView({ branchId: BRANCH, weekId: WEEK, data: workspace({ partial: true, readMode: 'display' }) })
  delete legacy.validationSnapshot
  delete legacy.validationState
  delete legacy.validationDirty
  const db = fakeDb({ [viewPath()]: legacy })
  const transaction = db.runTransaction
  let transactions = 0
  let checks = 0
  db.runTransaction = (callback) => { transactions += 1; return transaction(callback) }
  const functions = createPtScheduleWeeklyViewFunctions({
    db, onCall: (handler) => handler, actorForBranch: async () => { checks += 1 },
    branchData: async () => { throw new Error('Reading a complete display snapshot must not load sources') },
  })
  const first = await functions.getPtScheduleWeeklyView({ data: { branchId: BRANCH, weekId: WEEK, initialPaint: true } })
  const second = await functions.getPtScheduleWeeklyView({ data: { branchId: BRANCH, weekId: WEEK, initialPaint: true } })
  assert.equal(first.validationState, 'unknown')
  assert.equal(first.validationSnapshot, null)
  assert.equal(second.validationDirty, true)
  assert.equal(transactions, 1)
  assert.equal(checks, 2)
  assert.deepEqual(db.values.get(viewPath()).schedule, legacy.schedule)
})

test('read refresh stays light; worker later validates a clean matrix through the separate queue', async () => {
  const db = fakeDb({ [viewPath()]: initialView() })
  await markPtScheduleWeeklyViewDirty({ db, branchId: BRANCH, weekId: WEEK })
  let lightLoads = 0
  const functions = createPtScheduleWeeklyViewFunctions({
    db, onCall: (handler) => handler, actorForBranch: async () => {},
    branchData: async (_db, _branch, _week, options) => {
      lightLoads += 1
      assert.equal(options.initialPaint, true, 'even forceRefresh reads do not run reconciliation')
      return workspace({ partial: true, readMode: 'display', draft: { revision: 5 } })
    },
  })
  const light = await functions.getPtScheduleWeeklyView({ data: { branchId: BRANCH, weekId: WEEK, forceRefresh: true } })
  assert.equal(light.dirty, false)
  assert.equal(light.validationDirty, true)
  assert.equal(light.validationState, 'stale')
  assert.equal(lightLoads, 1)
  let exactLoads = 0
  const result = await rebuildDirtyPtScheduleWeeklyViews({ db, limit: 1, logger: { error() {} }, branchData: async (_db, _branch, _week, options) => {
    exactLoads += 1
    assert.equal(options.initialPaint, false)
    return workspace({ draft: { revision: 5 } })
  } })
  assert.deepEqual(result, { scanned: 1, rebuilt: 1, failed: 0 })
  assert.equal(exactLoads, 1)
  const current = db.values.get(viewPath())
  assert.equal(current.validationState, 'current')
  assert.equal(current.validationDirty, false)
  assert.equal(current.dirty, false)
  assert.equal(current.validationSnapshot.draftRevision, 5)
  assert.equal(current.validationSnapshot.dirtyGeneration, 1)
})

test('worker merges legacy matrix and validation queues within one deduplicated bound', async () => {
  const db = fakeDb({
    [viewPath()]: { ...initialView(), dirty: true, validationDirty: true },
    [viewPath('branch-b')]: { ...initialView(), branchId: 'branch-b', dirty: true, validationDirty: false },
    [viewPath('branch-c')]: { ...initialView(), branchId: 'branch-c', dirty: false, validationDirty: true },
  })
  const loads = []
  const result = await rebuildDirtyPtScheduleWeeklyViews({ db, limit: 2, logger: { error() {} }, branchData: async (_db, branchId) => {
    loads.push(branchId)
    return workspace()
  } })
  assert.equal(result.scanned, 2)
  assert.equal(loads.length, 2)
  assert.equal(new Set(loads).size, 2)
  assert.equal(db.queries.length, 4)
  assert.ok(db.queries.every((query) => query.count === 2))
})

test('dirty events during exact source reads cannot clear the pending validation plane', async () => {
  const db = fakeDb({ [viewPath()]: { ...initialView(), dirty: false, validationDirty: true } })
  const result = await rebuildDirtyPtScheduleWeeklyViews({ db, limit: 1, logger: { error() {} }, branchData: async () => {
    await markPtScheduleWeeklyViewDirty({ db, branchId: BRANCH, weekId: WEEK, reason: 'concurrent-session' })
    return workspace({ draft: { revision: 9 } })
  } })
  assert.equal(result.rebuilt, 0)
  assert.equal(effectiveView(db).validationDirty, true)
  assert.equal(effectiveView(db).dirty, true)
  assert.equal(db.values.get(viewPath()).validationSnapshot.draftRevision, 4)
})

test('validation clock alone never advances the semantic revision', () => {
  const first = buildPtScheduleWeeklyView({ branchId: BRANCH, weekId: WEEK, data: workspace(), now: new Date('2026-10-20') })
  const next = buildPtScheduleWeeklyView({ branchId: BRANCH, weekId: WEEK, data: workspace(), previousView: first, now: new Date('2026-10-22') })
  assert.notEqual(next.validationSnapshot.validatedAt, first.validationSnapshot.validatedAt)
  assert.equal(next.validationSnapshot.sourceRevision, first.validationSnapshot.sourceRevision)
  assert.equal(next.sourceRevision, first.sourceRevision)
  assert.equal(next.viewRevision, first.viewRevision)
})

test('pointer and embedded planes fit a representative 350-student Firestore protobuf without duplicating exact evidence', () => {
  // SDK internals are test-only: measure the actual wire document, not JSON
  // length. This is a representative regression fixture, not a guarantee that
  // every possible 350-student/700-entry payload fits Firestore's limit.
  const path = require('node:path')
  const sdkSource = path.dirname(require.resolve('@google-cloud/firestore'))
  const { Serializer } = require(path.join(sdkSource, 'serializer.js'))
  const { google } = require(path.join(sdkSource, '../protos/firestore_v1_proto_api.js'))
  const students = Array.from({ length: 350 }, (_, index) => ({
    id: `student-${index}`, name: `Student Name ${index}`, phone: '0901234567', email: `student${index}@example.com`,
    branchId: BRANCH, status: 'active', sessionsPerWeek: 2, availabilityStatus: 'submitted',
    availableSlots: Array.from({ length: 48 }, (_, slot) => `T${2 + Math.floor(slot / 8)}-${6 + slot % 8}`),
    eligibleContractIds: [`contract-${index}`], contractStatus: 'active', eligibleForWeek: true, remainingSchedulableSessions: 10,
  }))
  const contracts = students.map((student, index) => ({
    id: `contract-${index}`, studentId: student.id, packageName: 'Standard PT package', status: 'active',
    startDate: '2026-01-01', endDate: '2026-12-31', totalSessions: 50, usedSessions: 5, branchId: BRANCH,
  }))
  const data = workspace({ students, contracts, trainers: [], schedule: {} })
  const exact = buildPtScheduleWeeklyView({ branchId: BRANCH, weekId: WEEK, data })
  const light = buildPtScheduleWeeklyView({ branchId: BRANCH, weekId: WEEK, data: { ...data, contracts: [], partial: true, readMode: 'display' }, previousView: exact })
  const serializer = new Serializer({ _settings: {} })
  const encodedSize = (value) => google.firestore.v1.Document.encode({
    name: `projects/test/databases/test/documents/${viewPath()}`, fields: serializer.encodeFields(value),
  }).finish().length
  for (const [name, value] of Object.entries({ exact, light })) {
    assert.ok(encodedSize(value) < 1024 * 1024, `${name}: ${encodedSize(value)} encoded bytes`)
    assert.equal(value.students.length, 350, 'do not silently trim profile data to fit')
  }
  assert.equal(exact.validationSnapshot.storage, 'top_level')
  assert.equal(exact.contracts.length, 350)
  assert.equal(light.validationSnapshot.contracts.length, 350)
  assert.equal(light.contracts.length, 0)
  const duplicated = { ...exact, validationSnapshot: light.validationSnapshot }
  assert.ok(encodedSize(duplicated) > 1024 * 1024, 'fixture catches the old duplicated-evidence layout')
})

test('failed light publication preserves queued validation and prior exact evidence', async () => {
  const db = fakeDb({ [viewPath()]: initialView() })
  await markPtScheduleWeeklyViewDirty({ db, branchId: BRANCH, weekId: WEEK })
  const before = structuredClone(db.values.get(viewPath()))
  const transaction = db.runTransaction
  db.runTransaction = (callback) => transaction((tx) => callback({
    ...tx,
    set: (reference, value, options) => {
      if (reference.path === viewPath()) throw new Error('Firestore document exceeds maximum size')
      return tx.set(reference, value, options)
    },
  }))
  await assert.rejects(rebuildPtScheduleWeeklyView({
    db, branchId: BRANCH, weekId: WEEK, initialPaint: true,
    branchData: async () => workspace({ partial: true, readMode: 'display', draft: { revision: 99 } }),
  }), /maximum size/)
  assert.deepEqual(db.values.get(viewPath()), before)
  assert.equal(db.values.get(statePath()).dirty, true)
  assert.equal(db.values.get(statePath()).validationDirty, true)
  assert.equal(db.values.has(leasePath), false)
})

test('invalidation writes only a tiny state, with no payload read/write even for an existing large view', async () => {
  const original = { ...initialView(), ballast: 'x'.repeat(600_000), dirtyGeneration: 8 }
  const db = fakeDb({ [viewPath()]: original })
  for (let index = 0; index < 3; index += 1) await markPtScheduleWeeklyViewDirty({ db, branchId: BRANCH, weekId: WEEK })
  assert.deepEqual(db.reads, [])
  assert.equal(db.writes.length, 3)
  assert.ok(db.writes.every(write => write.path === statePath()))
  assert.deepEqual(db.values.get(viewPath()), original)
  assert.ok(JSON.stringify(db.values.get(statePath())).length < 1024)
  assert.equal(effectiveView(db).dirtyGeneration, 11)
})

test('consumed control deltas are not counted again across publish, legacy edits and new invalidations', async () => {
  const db = fakeDb({ [viewPath()]: { ...initialView(), dirtyGeneration: 8 } })
  await markPtScheduleWeeklyViewDirty({ db, branchId: BRANCH, weekId: WEEK })
  const first = await rebuildPtScheduleWeeklyView({ db, branchId: BRANCH, weekId: WEEK, branchData: async () => workspace() })
  assert.equal(first.dirtyGeneration, 9)
  assert.equal(first.controlGeneration, 1)
  assert.equal(effectiveView(db).dirtyGeneration, 9)
  await db.doc(viewPath()).set({ dirty: true, dirtyGeneration: 10 }, { merge: true })
  await markPtScheduleWeeklyViewDirty({ db, branchId: BRANCH, weekId: WEEK })
  assert.equal(effectiveView(db).dirtyGeneration, 11)
  const second = await rebuildPtScheduleWeeklyView({ db, branchId: BRANCH, weekId: WEEK, branchData: async () => workspace() })
  assert.equal(second.dirtyGeneration, 11)
  assert.equal(second.controlGeneration, 2)
  assert.equal(effectiveView(db).dirty, false)
  assert.equal(effectiveView(db).dirtyGeneration, 11)
})

test('metadata-only control race is fenced even without a generation increment', async () => {
  const db = fakeDb({ [viewPath()]: initialView() })
  const result = await rebuildPtScheduleWeeklyView({ db, branchId: BRANCH, weekId: WEEK, branchData: async () => {
    await db.doc(statePath()).set({ branchId: BRANCH, weekId: WEEK, validationDirty: true })
    return workspace({ draft: { revision: 50 } })
  } })
  assert.equal(result.rebuildStatus, 'superseded')
  assert.equal(db.values.get(viewPath()).draft.revision, 4)
  assert.equal(db.values.get(statePath()).validationDirty, true)
})

test('bounded queue checkpoints make progress past failures, across legacy/new queues, and wrap for retries', async () => {
  const db = fakeDb({
    [viewPath()]: initialView(),
    [viewPath('branch-b')]: { ...initialView(), branchId: 'branch-b', dirty: true },
    [viewPath('branch-c')]: { ...initialView(), branchId: 'branch-c' },
  })
  for (const branchId of [BRANCH, 'branch-c']) await markPtScheduleWeeklyViewDirty({ db, branchId, weekId: WEEK })
  const attempts = []
  for (let index = 0; index < 8; index += 1) {
    const report = await rebuildDirtyPtScheduleWeeklyViews({ db, limit: 1, logger: { error() {} }, branchData: async (_db, branchId) => {
      attempts.push(branchId)
      if (branchId === BRANCH) throw new Error('permanent source failure')
      return workspace()
    } })
    assert.ok(report.scanned <= 1)
  }
  assert.ok(attempts.includes('branch-b'), 'legacy queue is not starved by a failing state row')
  assert.ok(attempts.includes('branch-c'), 'later state rows are not starved')
  assert.ok(attempts.filter(branch => branch === BRANCH).length > 1, 'failed rows retry after cursor wrap')
  assert.equal(effectiveView(db).dirty, true)
  assert.ok(db.queries.filter(query => query.collection === 'ptScheduleWeeklyViews').every(query => (
    query.filters.some(([field, op, value]) => ['dirty', 'validationDirty'].includes(field) && op === '==' && value === true)
      && JSON.stringify(query.fields) === JSON.stringify(['branchId', 'weekId'])
  )), 'legacy discovery never fetches clean or full payload documents')
})

test('an empty queue does not create checkpoint writes or read clean payloads', async () => {
  const db = fakeDb({ [viewPath()]: initialView() })
  const result = await rebuildDirtyPtScheduleWeeklyViews({ db, branchData: async () => { throw new Error('unexpected source fanout') } })
  assert.deepEqual(result, { scanned: 0, rebuilt: 0, failed: 0 })
  assert.deepEqual(db.writes, [])
  assert.deepEqual(db.reads, ['systemJobs/ptScheduleWeeklyViewQueue'])
})

test('state-only dirty before the first payload bootstraps lightly and publishes exact evidence at the same generation', async () => {
  for (const initialPaint of [true, false]) {
    const db = fakeDb()
    await markPtScheduleWeeklyViewDirty({ db, branchId: BRANCH, weekId: WEEK })
    await markPtScheduleWeeklyViewDirty({ db, branchId: BRANCH, weekId: WEEK })
    assert.equal(db.values.has(viewPath()), false)
    const result = await rebuildPtScheduleWeeklyView({ db, branchId: BRANCH, weekId: WEEK, initialPaint,
      branchData: async () => workspace({ partial: initialPaint, readMode: initialPaint ? 'display' : 'reconciled' }) })
    assert.equal(result.dirtyGeneration, 2)
    assert.equal(result.controlGeneration, 2)
    assert.equal(result.dirty, false)
    assert.equal(result.validationState, initialPaint ? 'unknown' : 'current')
    assert.equal(result.validationDirty, initialPaint)
    assert.equal(db.values.has(leasePath), false)
    if (initialPaint) {
      assert.equal(result.validationSnapshot, null)
      const report = await rebuildDirtyPtScheduleWeeklyViews({ db, limit: 1, branchData: async () => workspace() })
      assert.deepEqual(report, { scanned: 1, rebuilt: 1, failed: 0 })
    }
    const exact = effectiveView(db)
    assert.equal(exact.validationState, 'current')
    assert.equal(exact.validationDirty, false)
    assert.equal(exact.validationSnapshot.dirtyGeneration, 2)
  }
})

test('a new invalidation during state-only bootstrap remains queued and a retry can create the first payload', async () => {
  const db = fakeDb()
  await markPtScheduleWeeklyViewDirty({ db, branchId: BRANCH, weekId: WEEK })
  await assert.rejects(rebuildPtScheduleWeeklyView({ db, branchId: BRANCH, weekId: WEEK, branchData: async () => {
    await markPtScheduleWeeklyViewDirty({ db, branchId: BRANCH, weekId: WEEK })
    return workspace()
  } }), (error) => error.code === 'unavailable' && error.details.rebuildStatus === 'superseded')
  assert.equal(db.values.has(viewPath()), false)
  assert.equal(db.values.get(statePath()).dirtyGeneration, 2)
  assert.equal(db.values.get(statePath()).dirty, true)
  assert.equal(db.values.has(leasePath), false)
  const result = await rebuildPtScheduleWeeklyView({ db, branchId: BRANCH, weekId: WEEK, branchData: async () => workspace() })
  assert.equal(result.dirtyGeneration, 2)
  assert.equal(result.validationSnapshot.dirtyGeneration, 2)
  assert.equal(result.dirty, false)
})
