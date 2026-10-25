'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  effectiveStudentAvailability,
  invalidateStudentAvailabilityFallbacks,
  loadLatestSubmittedFallbacks,
  normalizeRequestedSessions,
  studentAvailabilityProfilePatch,
} = require('./student-availability')
const { contractDefaultSessionsPerWeek } = require('./pt-operations-v2')

const TARGET_WEEK = '2026-09-07'

test('exact submitted week always wins over inherited and legacy availability', () => {
  const result = effectiveStudentAvailability({
    targetWeek: TARGET_WEEK,
    exact: { weekId: TARGET_WEEK, status: 'submitted', revision: 2, slots: ['T2-6'] },
    inherited: { weekId: '2026-08-31', status: 'submitted', revision: 4, slots: ['T3-7'] },
    profile: { availableSlots: ['T4-8'], isScheduleConfirmed: true },
  })
  assert.equal(result.source, 'weekly')
  assert.deepEqual(result.slots, ['T2-6'])
  assert.equal(result.targetRevision, 2)
})

test('latest submitted week is inherited before the legacy default', () => {
  const result = effectiveStudentAvailability({
    targetWeek: TARGET_WEEK,
    inherited: { weekId: '2026-08-31', status: 'locked', revision: 3, slots: ['T3-7', 'T5-8'] },
    profile: { availableSlots: ['T4-8'], isScheduleConfirmed: true },
  })
  assert.equal(result.source, 'inherited_weekly')
  assert.equal(result.sourceWeekId, '2026-08-31')
  assert.equal(result.sourceRevision, 3)
  assert.equal(result.targetRevision, 0)
  assert.deepEqual(result.slots, ['T3-7', 'T5-8'])
})

test('a future submission is never inherited backwards', () => {
  const result = effectiveStudentAvailability({
    targetWeek: TARGET_WEEK,
    profile: {
      latestSubmittedAvailability: { weekId: '2026-09-14', status: 'submitted', revision: 1, slots: ['T2-6'] },
      legacyDefaultAvailability: { slots: ['T4-8'], confirmed: true },
    },
  })
  assert.equal(result.source, 'legacy_default')
  assert.deepEqual(result.slots, ['T4-8'])
})

test('unconfirmed legacy defaults remain visible but cannot schedule a learner', () => {
  const result = effectiveStudentAvailability({
    targetWeek: TARGET_WEEK,
    profile: { availableSlots: ['T4-8'], isScheduleConfirmed: false },
  })
  assert.equal(result.source, 'legacy_default')
  assert.equal(result.confirmed, false)
  assert.equal(result.status, 'draft')
})

test('submitting a weekly schedule preserves the old default and advances the latest projection', () => {
  const patch = studentAvailabilityProfilePatch({
    availableSlots: ['T4-8'],
    isScheduleConfirmed: true,
    sessionsPerWeek: 3,
  }, {
    weekId: '2026-08-31',
    status: 'submitted',
    revision: 1,
    slots: ['T2-6', 'T3-7'],
    requiredSessions: 3,
    minimumSlots: 5,
  })
  assert.deepEqual(patch.legacyDefaultAvailability.slots, ['T4-8'])
  assert.equal(patch.legacyDefaultAvailability.confirmed, true)
  assert.equal(patch.latestSubmittedAvailability.weekId, '2026-08-31')
  assert.deepEqual(patch.availableSlots, ['T2-6', 'T3-7'])
})

test('editing an older week never rolls the latest projection backwards', () => {
  const patch = studentAvailabilityProfilePatch({
    latestSubmittedAvailability: { weekId: '2026-09-14', status: 'submitted', revision: 1, slots: ['T2-6'] },
    availableSlots: ['T2-6'],
    isScheduleConfirmed: true,
  }, {
    weekId: TARGET_WEEK,
    status: 'submitted',
    revision: 2,
    slots: ['T3-7'],
  })
  assert.equal(patch.latestSubmittedAvailability, undefined)
  assert.equal(patch.availableSlots, undefined)
})

test('an empty draft for the target week falls back to the latest submitted week', () => {
  const result = effectiveStudentAvailability({
    targetWeek: TARGET_WEEK,
    exact: { weekId: TARGET_WEEK, status: 'draft', revision: 1, slots: [] },
    inherited: { weekId: '2026-08-31', status: 'submitted', revision: 4, slots: ['T2-18', 'T5-19'] },
    profile: {},
  })
  assert.equal(result.source, 'inherited_weekly')
  assert.equal(result.sourceWeekId, '2026-08-31')
  assert.deepEqual(result.slots, ['T2-18', 'T5-19'])
})

test('weekly target override is retained and null means follow the contract', () => {
  const result = effectiveStudentAvailability({
    targetWeek: TARGET_WEEK,
    exact: { weekId: TARGET_WEEK, status: 'submitted', revision: 2, slots: ['T2-6'], requestedSessions: 4 },
    profile: { sessionsPerWeek: 3 },
  })
  assert.equal(result.requestedSessions, 4)
  assert.equal(normalizeRequestedSessions('4'), 4)
  assert.equal(normalizeRequestedSessions(0), null)
  assert.equal(normalizeRequestedSessions(null), null)

  const reset = studentAvailabilityProfilePatch({}, {
    weekId: TARGET_WEEK,
    status: 'submitted',
    revision: 3,
    slots: ['T2-6'],
    requestedSessions: null,
  })
  assert.equal(reset.latestSubmittedAvailability.requestedSessions, null)
})

test('the denormalized projection supplies the submitted week on the fast workspace path', () => {
  const result = effectiveStudentAvailability({
    targetWeek: TARGET_WEEK,
    exact: null,
    inherited: null,
    profile: {
      latestSubmittedAvailability: {
        weekId: TARGET_WEEK,
        status: 'submitted',
        revision: 3,
        slots: ['T2-14', 'T3-14', 'T4-14'],
      },
      // The legacy fallback is deliberately absent after a weekly projection
      // is created.  The same-week projection must still be visible.
      availableSlots: ['T2-8'],
      isScheduleConfirmed: true,
    },
  })
  assert.equal(result.source, 'weekly')
  assert.equal(result.sourceWeekId, TARGET_WEEK)
  assert.equal(result.targetRevision, 3)
  assert.deepEqual(result.slots, ['T2-14', 'T3-14', 'T4-14'])
})

test('a future profile projection does not hide an exact current-week submission', () => {
  const result = effectiveStudentAvailability({
    targetWeek: TARGET_WEEK,
    exact: { weekId: TARGET_WEEK, status: 'submitted', revision: 2, slots: ['T2-14', 'T3-14'] },
    profile: {
      latestSubmittedAvailability: {
        weekId: '2026-09-14',
        status: 'submitted',
        revision: 3,
        slots: ['T2-18'],
      },
    },
  })
  assert.equal(result.source, 'weekly')
  assert.equal(result.sourceWeekId, TARGET_WEEK)
  assert.deepEqual(result.slots, ['T2-14', 'T3-14'])
})

test('an admin reopen keeps a new learner editable even before a weekly document exists', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-23T00:00:00.000Z') })
  const targetWeek = '2026-10-19'
  const result = effectiveStudentAvailability({
    targetWeek,
    exact: null,
    inherited: null,
    profile: {
      sessionsPerWeek: 3,
      availabilityReopen: {
        weekId: targetWeek,
        reopenedUntil: '2026-10-25T17:00:00.000Z',
      },
    },
  })
  assert.equal(result.source, 'none')
  assert.equal(result.status, 'missing')
  assert.equal(result.reopenedUntil, '2026-10-25T17:00:00.000Z')
})

test('contract weekly default prefers an explicit contract target and falls back to profile demand', () => {
  assert.equal(contractDefaultSessionsPerWeek([
    { id: 'contract-a', status: 'active', startDate: '2026-09-01', endDate: '2026-12-01', totalSessions: 24, sessionsPerWeek: 2 },
  ], { sessionsPerWeek: 4 }, TARGET_WEEK), 2)
  assert.equal(contractDefaultSessionsPerWeek([
    { id: 'contract-a', status: 'active', startDate: '2026-09-01', endDate: '2026-12-01', totalSessions: 24 },
  ], { sessionsPerWeek: 4 }, TARGET_WEEK), 4)
})

function inheritedAvailabilityDb() {
  const values = new Map(['student-a', 'student-b'].map((studentId) => [studentId, {
    studentId, weekId: '2026-08-31', status: 'submitted', revision: 1, slots: ['T2-8'],
  }]))
  const reads = []
  const db = {
    values, reads, beforeResult: null,
    collection(name) {
      assert.equal(name, 'ptAvailability')
      let studentId
      const query = {
        where(_field, operator, value) {
          if (operator === '>=') studentId = value.replace(/_0000-00-00$/, '')
          return query
        },
        orderBy: () => query,
        limit: () => query,
        async get() {
          reads.push(studentId)
          const captured = structuredClone(values.get(studentId))
          if (db.beforeResult) await db.beforeResult(studentId)
          return { docs: captured ? [{ data: () => captured }] : [] }
        },
      }
      return query
    },
  }
  return db
}

function inheritedAvailability(db, studentId = 'student-a', version) {
  return loadLatestSubmittedFallbacks(db, new Map([[studentId, {}]]), new Map(), TARGET_WEEK, version)
}

test('inherited availability keeps legacy caching and coalesces separately for each authoritative revision', async () => {
  const db = inheritedAvailabilityDb()
  const [legacy, sameLegacy] = await Promise.all([inheritedAvailability(db), inheritedAvailability(db)])
  assert.deepEqual(legacy, sameLegacy)
  assert.equal(db.reads.length, 1)
  db.values.get('student-a').slots = ['T3-9']
  const stillCached = await inheritedAvailability(db)
  assert.deepEqual(stillCached.get('student-a').slots, ['T2-8'])

  const [revised, sameRevision] = await Promise.all([
    inheritedAvailability(db, 'student-a', 'server-revision-2'),
    inheritedAvailability(db, 'student-a', 'server-revision-2'),
  ])
  assert.deepEqual(revised, sameRevision)
  assert.deepEqual(revised.get('student-a').slots, ['T3-9'])
  assert.equal(db.reads.length, 2)
})

test('manual availability invalidation clears every revision only for the changed learner', async () => {
  const db = inheritedAvailabilityDb()
  await Promise.all([
    inheritedAvailability(db),
    inheritedAvailability(db, 'student-a', 'revision-2'),
    inheritedAvailability(db, 'student-b', 'revision-2'),
  ])
  db.values.get('student-a').slots = ['T4-10']
  db.values.get('student-b').slots = ['T5-11']
  invalidateStudentAvailabilityFallbacks(db, 'student-a')
  const [legacy, revised, unaffected] = await Promise.all([
    inheritedAvailability(db),
    inheritedAvailability(db, 'student-a', 'revision-2'),
    inheritedAvailability(db, 'student-b', 'revision-2'),
  ])
  assert.deepEqual(legacy.get('student-a').slots, ['T4-10'])
  assert.deepEqual(revised.get('student-a').slots, ['T4-10'])
  assert.deepEqual(unaffected.get('student-b').slots, ['T2-8'])
  assert.equal(db.reads.length, 5)
})

test('an invalidated pending inherited lookup cannot replace the post-save result', async () => {
  const db = inheritedAvailabilityDb()
  let release, reached
  const pending = new Promise((resolve) => { reached = resolve })
  db.beforeResult = () => {
    db.beforeResult = null
    reached()
    return new Promise((resolve) => { release = resolve })
  }
  const oldRequest = inheritedAvailability(db)
  await pending
  db.values.get('student-a').slots = ['T6-12']
  invalidateStudentAvailabilityFallbacks(db, 'student-a')
  const afterSave = await inheritedAvailability(db)
  release()
  assert.deepEqual((await oldRequest).get('student-a').slots, ['T2-8'])
  assert.deepEqual(afterSave.get('student-a').slots, ['T6-12'])
  assert.deepEqual((await inheritedAvailability(db)).get('student-a').slots, ['T6-12'])
  assert.equal(db.reads.length, 2)
})
