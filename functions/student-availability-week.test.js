'use strict'

// Regression suite for the 2026-11-22 week mix-up: the admin screen painted a
// learner's newest submitted week under the week on screen, and saving from it
// overwrote that week because the two weeks happened to share a revision.
const test = require('node:test')
const assert = require('node:assert/strict')
const { nextAvailabilityWeek, availabilityWeekNotOpen } = require('./pt-policy')
const { createPtScheduleV2Functions, loadBranchData } = require('./pt-schedule-v2')
const { availabilityState, createPtOperationsV2Functions } = require('./pt-operations-v2')
const { buildPtScheduleWeeklyView } = require('./pt-schedule-weekly-view')
const { buildStudent360Projection } = require('./student-360')
const { inheritedAvailabilityForWeek, loadLatestSubmittedFallbacks } = require('./student-availability')

const BRANCH = 'branch-a'
const PAST = '2026-11-16'
const WEEK = '2026-11-23'
const LATER = '2026-11-30'
const SUNDAY_MORNING = Date.parse('2026-11-22T09:00:00+07:00')
const THIS_WEEK = ['T4-17', 'T5-17', 'T7-16']
const NEXT_WEEK = ['T2-17', 'T3-17', 'T5-17']
const EARLIER = ['T6-18', 'T7-18']
const LEGACY = ['T2-6']

function memoryDb(seed) {
  const docs = new Map(Object.entries(seed))
  let generated = 0
  const fieldName = (field) => (typeof field === 'string' ? field : '__name__')
  const snapshot = (path) => ({ id: path.split('/').at(-1), ref: reference(path), exists: docs.has(path), data: () => docs.get(path) })
  const reference = (path) => ({
    path,
    id: path.split('/').at(-1),
    get: async () => snapshot(path),
    set: async (value, options) => { docs.set(path, options?.merge ? { ...docs.get(path), ...value } : value) },
    collection: (name) => collection(`${path}/${name}`),
  })
  function collection(root, filters = [], order = null, maximum = Infinity) {
    return {
      doc: (id = `generated-${generated++}`) => reference(`${root}/${id}`),
      where: (field, op, value) => collection(root, [...filters, [fieldName(field), op, value]], order, maximum),
      orderBy: (field, direction = 'asc') => collection(root, filters, order || [fieldName(field), direction], maximum),
      limit: (count) => collection(root, filters, order, count),
      select() { return this },
      startAfter() { return this },
      get: async () => {
        const read = (row, field) => (field === '__name__' ? row.id : row.data()[field])
        const matches = (row) => filters.every(([field, op, value]) => {
          const actual = read(row, field)
          if (op === '==') return actual === value
          if (op === 'in') return value.includes(actual)
          if (op === '>=') return actual >= value
          if (op === '<=') return actual <= value
          if (op === '>') return actual > value
          if (op === '<') return actual < value
          if (op === 'array-contains') return actual?.includes(value)
          throw new Error(`Unsupported operator ${op}`)
        })
        let rows = [...docs.keys()]
          .filter((path) => path.startsWith(`${root}/`) && !path.slice(root.length + 1).includes('/'))
          .map(snapshot)
          .filter(matches)
        if (order) rows.sort((left, right) => String(read(left, order[0])).localeCompare(String(read(right, order[0]))) * (order[1] === 'desc' ? -1 : 1))
        rows = rows.slice(0, maximum)
        return { docs: rows, size: rows.length, empty: rows.length === 0, forEach: (callback) => rows.forEach(callback) }
      },
    }
  }
  const db = {
    docs,
    doc: reference,
    collection,
    getAll: async (...refs) => refs.map((ref) => snapshot(ref.path)),
    runTransaction: async (callback) => {
      const writes = []
      const get = async (target) => {
        assert.equal(writes.length, 0, 'every read must precede the first write')
        return target.get()
      }
      const result = await callback({
        get,
        getAll: async (...refs) => Promise.all(refs.map(get)),
        create: (ref, value) => writes.push([ref, value, false]),
        set: (ref, value, options) => writes.push([ref, value, options?.merge === true]),
        update: (ref, value) => writes.push([ref, value, true]),
      })
      for (const [ref, value, merge] of writes) await ref.set(value, { merge })
      return result
    },
  }
  return db
}

const submission = (studentId, weekId, slots, revision = 2) => ({
  studentId, weekId, slots, revision, status: 'submitted', requiredSessions: 3, minimumSlots: 5, requestedSessions: null,
})

function learner(id, latest, extra = {}) {
  return {
    name: id, status: 'active', branchId: BRANCH, accountUid: id, sessionsPerWeek: 3,
    isScheduleConfirmed: true,
    ...(latest ? { latestSubmittedAvailability: latest, availableSlots: latest.slots, availabilityRevision: latest.revision } : {}),
    legacyDefaultAvailability: { slots: LEGACY, confirmed: true },
    ...extra,
  }
}

function fixture() {
  const seed = {
    [`branches/${BRANCH}`]: { name: 'Aura', status: 'active' },
    'settings/scheduleConfig': { workingDays: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7'], workingHours: [6, 16, 17, 18], holidays: [] },
    'trainers/pt': { name: 'PT', status: 'active', branchId: BRANCH, employmentType: 'full_time', availabilityMode: 'unrestricted', slotCapacity: 2 },
    [`ptScheduleDrafts/${BRANCH}_${WEEK}`]: { branchId: BRANCH, weekId: WEEK, revision: 1, status: 'draft', schedule: {} },
    // Has this week and the week after, with the same revision in both.
    'students/both': learner('both', submission('both', LATER, NEXT_WEEK)),
    [`ptAvailability/both_${WEEK}`]: submission('both', WEEK, THIS_WEEK),
    [`ptAvailability/both_${LATER}`]: submission('both', LATER, NEXT_WEEK),
    // Skipped this week: the nearest earlier week applies.
    'students/skipped': learner('skipped', submission('skipped', LATER, NEXT_WEEK)),
    [`ptAvailability/skipped_2026-11-09`]: submission('skipped', '2026-11-09', ['T2-18']),
    [`ptAvailability/skipped_${PAST}`]: submission('skipped', PAST, EARLIER),
    [`ptAvailability/skipped_${LATER}`]: submission('skipped', LATER, NEXT_WEEK),
    // Never submitted before this week: the old default applies, never the future week.
    'students/first': learner('first', submission('first', LATER, NEXT_WEEK)),
    [`ptAvailability/first_${LATER}`]: submission('first', LATER, NEXT_WEEK),
    // Newest submission is earlier: inherited straight from the profile.
    'students/earlier': learner('earlier', submission('earlier', PAST, EARLIER)),
    [`ptAvailability/earlier_${PAST}`]: submission('earlier', PAST, EARLIER),
  }
  for (const id of ['both', 'skipped', 'first', 'earlier']) {
    seed[`users/${id}`] = { name: id, role: 'student' }
    seed[`contracts/contract-${id}`] = {
      studentId: id, branchId: BRANCH, status: 'active', trainerId: 'pt', startDate: '2026-10-01', endDate: '2027-03-31', totalSessions: 48, usedSessions: 0,
    }
  }
  return memoryDb(seed)
}

const handler = (...args) => args.at(-1)

function scheduleFunctions(db) {
  return createPtScheduleV2Functions({
    db,
    onCall: handler,
    actorForBranch: async () => ({ uid: 'admin', accessRole: 'admin', status: 'active', capabilities: [] }),
  })
}

function save(db, studentId, data) {
  return scheduleFunctions(db).savePtStudentAvailability({
    data: { weekId: WEEK, branchId: BRANCH, studentId, confirmBelowMinimum: true, ...data },
  })
}

function learnerSave(db, uid, weekId) {
  return createPtOperationsV2Functions({ db, onCall: handler }).saveMyStudentAvailability({
    auth: { uid, token: { role: 'student' } },
    data: { weekId, availableSlots: EARLIER, expectedRevision: 0, confirmBelowMinimum: true },
  })
}

const issue = (code) => (error) => error.details?.issueCode === code

test.beforeEach((t) => t.mock.timers.enable({ apis: ['Date'], now: SUNDAY_MORNING }))

test('next week follows the Vietnam calendar across Sunday midnight', () => {
  for (const [at, expected] of [
    ['2026-11-16T00:00:00+07:00', '2026-11-23'],
    ['2026-11-19T12:00:00+07:00', '2026-11-23'],
    ['2026-11-22T23:59:59+07:00', '2026-11-23'],
    ['2026-11-23T00:00:00+07:00', '2026-11-30'],
    ['2026-12-28T08:00:00+07:00', '2027-01-04'],
  ]) assert.equal(nextAvailabilityWeek(new Date(at)), expected, at)
  assert.equal(availabilityWeekNotOpen(WEEK), false)
  assert.equal(availabilityWeekNotOpen(LATER), true)
})

test('the week after next reads as locked for learners, including older app bundles', () => {
  assert.equal(availabilityState(WEEK, { slots: EARLIER, status: 'submitted' }).locked, false)
  assert.equal(availabilityState(LATER, { slots: EARLIER, status: 'submitted' }).locked, true)
})

test('a learner can register next week and cannot register the week after', async () => {
  const db = fixture()
  await assert.rejects(learnerSave(db, 'earlier', LATER), issue('AVAILABILITY_WEEK_NOT_OPEN'))
  assert.equal(db.docs.has(`ptAvailability/earlier_${LATER}`), false)
  await learnerSave(db, 'earlier', WEEK)
  assert.deepEqual([...db.docs.get(`ptAvailability/earlier_${WEEK}`).slots].sort(), EARLIER)
})

test('the week after next opens once it becomes next week', async (t) => {
  t.mock.timers.setTime(Date.parse('2026-11-23T00:00:01+07:00'))
  const db = fixture()
  await learnerSave(db, 'earlier', LATER)
  assert.deepEqual([...db.docs.get(`ptAvailability/earlier_${LATER}`).slots].sort(), EARLIER)
})

test('staff can neither save nor reopen the week after next', async () => {
  const db = fixture()
  await assert.rejects(
    save(db, 'earlier', { weekId: LATER, availableSlots: EARLIER, expectedSlots: EARLIER, expectedRevision: 0 }),
    issue('AVAILABILITY_WEEK_NOT_OPEN'),
  )
  await assert.rejects(
    scheduleFunctions(db).reopenPtStudentAvailability({ data: { weekId: LATER, branchId: BRANCH, studentId: 'earlier', expectedRevision: 0 } }),
    issue('AVAILABILITY_WEEK_NOT_OPEN'),
  )
})

const MODES = {
  reconciled: {},
  'initial paint': { initialPaint: true },
  'admin matrix': { workspaceMatrixFast: true, publishedMatrixFast: true, skipLegacyAvailabilityFallback: true },
}

for (const [mode, options] of Object.entries(MODES)) {
  test(`${mode}: every learner shows the viewed week or the nearest earlier one`, async () => {
    const data = await loadBranchData(fixture(), BRANCH, WEEK, { forceRefresh: true, ...options })
    const shown = Object.fromEntries(data.students.map((row) => [row.id, [row.availableSlots, row.availabilitySource, row.availabilitySourceWeekId, row.availabilityRevision, row.availabilityStatus]]))
    assert.deepEqual(shown, {
      both: [THIS_WEEK, 'weekly', WEEK, 2, 'submitted'],
      skipped: [EARLIER, 'inherited_weekly', PAST, 0, 'inherited'],
      first: [LEGACY, 'legacy_default', null, 0, 'recurring'],
      earlier: [EARLIER, 'inherited_weekly', PAST, 0, 'inherited'],
    })
  })

  test(`${mode}: an ineligible learner still never shows a future week`, async () => {
    const db = fixture()
    db.docs.delete('contracts/contract-skipped')
    const data = await loadBranchData(db, BRANCH, WEEK, { forceRefresh: true, ...options })
    assert.deepEqual(data.students.find((row) => row.id === 'skipped').availableSlots, EARLIER)
  })
}

test('resolving the week reads only learners who need it', async () => {
  for (const [mode, options, expected] of [
    ['initial paint', { initialPaint: true }, ['both', 'first', 'skipped']],
    ['admin matrix', MODES['admin matrix'], ['both', 'first', 'skipped']],
    ['reconciled', {}, ['both', 'earlier', 'first', 'skipped']],
  ]) {
    const db = fixture()
    // Expired long ago and never ahead: such profiles must not cost a read.
    db.docs.set('students/expired', learner('expired', submission('expired', PAST, EARLIER)))
    const read = new Set()
    const getAll = db.getAll
    db.getAll = async (...refs) => {
      for (const ref of refs) if (ref.path.startsWith('ptAvailability/')) read.add(ref.id.replace(`_${WEEK}`, ''))
      return getAll(...refs)
    }
    await loadBranchData(db, BRANCH, WEEK, { forceRefresh: true, ...options })
    assert.deepEqual([...read].sort(), expected, mode)
  }
})

test('initial paint keeps a target the learner requested for that week', async () => {
  const db = fixture()
  db.docs.set(`ptAvailability/both_${WEEK}`, { ...submission('both', WEEK, THIS_WEEK), requestedSessions: 2 })
  const data = await loadBranchData(db, BRANCH, WEEK, { forceRefresh: true, initialPaint: true })
  assert.equal(data.students.find((row) => row.id === 'both').sessionsPerWeek, 2)
})

test('the weekly view does not truncate slots that the editor will save back', () => {
  const availableSlots = Array.from({ length: 84 }, (_, index) => `T${2 + (index % 6)}-${6 + Math.floor(index / 6)}`)
  const view = buildPtScheduleWeeklyView({
    branchId: BRANCH, weekId: WEEK, data: { students: [{ id: 'wide', branchId: BRANCH, availableSlots }], schedule: {}, draft: {} },
  })
  assert.deepEqual(view.students[0].availableSlots, availableSlots)
})

test('saving another week\'s slots is refused even when both weeks share a revision', async () => {
  const db = fixture()
  await assert.rejects(
    save(db, 'both', { availableSlots: NEXT_WEEK, expectedSlots: NEXT_WEEK, expectedRevision: 2 }),
    issue('REVISION_CONFLICT'),
  )
  assert.deepEqual(db.docs.get(`ptAvailability/both_${WEEK}`).slots, THIS_WEEK)
})

test('an older client without the starting slots is asked to reload', async () => {
  const db = fixture()
  await assert.rejects(save(db, 'both', { availableSlots: NEXT_WEEK, expectedRevision: 2 }), issue('AVAILABILITY_RELOAD_REQUIRED'))
  assert.deepEqual(db.docs.get(`ptAvailability/both_${WEEK}`).slots, THIS_WEEK)
})

test('a real edit saves this week and leaves the newer week and profile alone', async () => {
  const db = fixture()
  const edited = [...THIS_WEEK, 'T6-17']
  await save(db, 'both', { availableSlots: edited, expectedSlots: [...THIS_WEEK].reverse(), expectedRevision: 2 })
  assert.deepEqual([...db.docs.get(`ptAvailability/both_${WEEK}`).slots].sort(), [...edited].sort())
  assert.deepEqual(db.docs.get(`ptAvailability/both_${LATER}`).slots, NEXT_WEEK)
  assert.equal(db.docs.get('students/both').latestSubmittedAvailability.weekId, LATER)
})

test('editing an inherited week starts from the nearest earlier slots', async () => {
  const db = fixture()
  await save(db, 'skipped', { availableSlots: [...EARLIER, 'T2-17'], expectedSlots: EARLIER, expectedRevision: 0 })
  assert.equal(db.docs.get(`ptAvailability/skipped_${WEEK}`).revision, 1)
  assert.deepEqual(db.docs.get(`ptAvailability/skipped_${PAST}`).slots, EARLIER)
})

test('manual placement judges availability by the nearest earlier week', async () => {
  for (const [slotId, outside] of [['T6-18', false], ['T2-17', true]]) {
    const db = fixture()
    await scheduleFunctions(db).applyPtScheduleDraftCommand({ data: {
      weekId: WEEK, branchId: BRANCH, expectedDraftRevision: 1, command: 'add_student', idempotencyKey: `manual-${slotId}`,
      payload: { slotId, studentId: 'skipped', trainerId: 'pt', adminOverride: true },
    } })
    const [entry] = db.docs.get(`ptScheduleDrafts/${BRANCH}_${WEEK}`).schedule[slotId]
    assert.equal((entry.adminOverrideWarnings || []).includes('OUTSIDE_STUDENT_AVAILABILITY'), outside, slotId)
  }
})

test('the single-learner lookup reads history only when the profile is ahead', async () => {
  const db = fixture()
  const lookup = (studentId, exact = null) => inheritedAvailabilityForWeek({
    db, studentId, profile: db.docs.get(`students/${studentId}`), exact, targetWeek: WEEK,
  })
  assert.deepEqual((await lookup('skipped')).slots, EARLIER)
  assert.equal(await lookup('first'), null)
  const offline = { ...db, collection: () => assert.fail('history must not be read') }
  for (const [studentId, exact] of [['earlier', null], ['both', submission('both', WEEK, THIS_WEEK)]]) {
    assert.equal(await inheritedAvailabilityForWeek({ db: offline, studentId, profile: db.docs.get(`students/${studentId}`), exact, targetWeek: WEEK }), null)
  }
})

test('a cached fallback does not outlive an edit of an older week', async () => {
  const db = fixture()
  const load = () => loadLatestSubmittedFallbacks(db, new Map([['skipped', db.docs.get('students/skipped')]]), new Map(), WEEK)
  assert.deepEqual((await load()).get('skipped').slots, EARLIER)
  db.docs.set(`ptAvailability/skipped_${PAST}`, submission('skipped', PAST, ['T4-6'], 3))
  db.docs.set('students/skipped', { ...db.docs.get('students/skipped'), latestAvailabilityUpdatedAt: '2026-11-22T02:00:00Z' })
  assert.deepEqual((await load()).get('skipped').slots, ['T4-6'])
})

test('Student 360 shows this week\'s effective availability, not the newest submission', async () => {
  for (const [studentId, expected] of [['both', THIS_WEEK], ['skipped', EARLIER], ['first', LEGACY]]) {
    const projection = await buildStudent360Projection({ db: fixture(), studentId, weekId: WEEK, persist: false })
    assert.deepEqual([...projection.schedule.availability.slots].sort(), [...expected].sort(), studentId)
  }
})
