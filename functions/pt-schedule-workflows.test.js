'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createPtScheduleV2Functions, loadManualMutationData, generateSchedule, repairCoverageWithRelocations, compactPairedSlots, candidateForSlot } = require('./pt-schedule-v2')
const WEEK = '2090-01-02', BRANCH = 'b'
const entry = (id = 'a', trainerId = 't') => ({ studentId: id, trainerId, contractId: `c-${id}`, branchId: BRANCH, type: 'training', source: 'auto_v4' })
function fixture() {
  const students = ['a', 'b'].map((id) => ({ id, name: id === 'a' ? 'Lan' : 'Ngọc', branchId: BRANCH, status: 'active', sessionsPerWeek: 2, maxWeeklySessions: 7, defaultSessionsPerWeek: 2, availableSlots: ['T2-6', 'T3-6', 'T4-6'], availabilityStatus: 'submitted', eligibleForWeek: true }))
  return { branch: { id: BRANCH, name: 'Aura' }, weekId: WEEK, students, trainers: [{ id: 't', name: 'Mai', branchId: BRANCH, status: 'active', slotCapacity: 2, availableSlots: ['T2-6', 'T3-6', 'T4-6'], availabilityMode: 'configured' }],
    contracts: students.map((s) => ({ id: `c-${s.id}`, studentId: s.id, branchId: BRANCH, status: 'active', startDate: WEEK, endDate: '2091-12-31', totalSessions: 40, usedSessions: 0 })),
    sessions: [], leaves: [], schedule: {}, config: { workingDays: ['T2', 'T3', 'T4'], workingHours: [6], holidays: [] }, draft: { revision: 1 } }
}
function harness(data = fixture(), options = {}) {
  const docs = new Map([
    [`ptScheduleDrafts/${BRANCH}_${WEEK}`, { revision: 1, schedule: data.schedule, weeklySessionTargets: { a: 3, b: 4 } }],
    [`branches/${BRANCH}`, { name: 'Aura', status: 'active' }], ['settings/scheduleConfig', data.config],
    ...data.students.flatMap((s) => [[`students/${s.id}`, s], [`ptAvailability/${s.id}_${WEEK}`, { studentId: s.id, weekId: WEEK, status: 'submitted', slots: s.availableSlots, revision: 1 }]]),
    ...data.trainers.map((t) => [`trainers/${t.id}`, t]), ...data.contracts.map((c) => [`contracts/${c.id}`, c]),
  ])
  const snap = (ref) => ({ id: ref.path.split('/').at(-1), exists: docs.has(ref.path), data: () => docs.get(ref.path) })
  let sequence = 0
  const reference = (path) => ({ path, get: async () => snap({ path }) })
  const collection = (path, filters = []) => {
    const query = { path, where: (key, op, val) => collection(path, [...filters, [key, op, val]]), limit: () => query,
      doc: () => reference(`${path}/audit-${sequence++}`), get: async () => {
        const rows = [...docs].filter(([key, value]) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/') && filters.every(([f, op, val]) => op === '==' ? value[f] === val : op === 'in' ? val.includes(value[f]) : op === '>=' ? value[f] >= val : value[f] < val)).map(([key]) => snap(reference(key)))
        return { docs: rows, size: rows.length }
      } }
    return query
  }
  const db = { doc: reference, collection, getAll: async (...refs) => refs.map(snap), runTransaction: async (fn) => {
    const writes = []
    const result = await fn({ get: async (ref) => snap(ref), set: (ref, value) => writes.push([ref.path, value]), create: (ref, value) => writes.push([ref.path, value]) })
    for (const [path, value] of writes) docs.set(path, value)
    return result
  } }
  const actor = options.actor || { uid: 'admin', accessRole: 'admin', branchIds: [BRANCH] }
  const actorForBranch = async (request, _db, branch) => { if (actor.accessRole === 'staff' && !actor.branchIds.includes(branch)) throw Error('permission-denied'); return actor }
  const branchData = async () => ({ ...data, schedule: docs.get(`ptScheduleDrafts/${BRANCH}_${WEEK}`)?.schedule || {}, draft: { revision: docs.get(`ptScheduleDrafts/${BRANCH}_${WEEK}`)?.revision || 0 } })
  return { docs, db, api: createPtScheduleV2Functions({ db, onCall: (...args) => args.at(-1), actorForBranch, branchData }) }
}
const command = (name, payload, extra = {}) => ({ data: { branchId: BRANCH, weekId: WEEK, command: name, payload, expectedDraftRevision: 1, idempotencyKey: 'test-command-123', ...extra } })
test('slot candidates complete for Admin and scoped staff, including cross-branch search', async () => {
  for (const actor of [{ uid: 'admin', accessRole: 'admin', branchIds: [BRANCH] }, { uid: 'staff', accessRole: 'staff', branchIds: [BRANCH] }]) {
    const { api } = harness(fixture(), { actor })
    const result = await api.getPtScheduleSlotCandidates({ data: { branchId: BRANCH, weekId: WEEK, trainerId: 't', slotId: 'T2-6', search: 'Lan' } })
    assert.equal(result.candidates[0].studentId, 'a')
    assert.equal(result.candidates[0].eligible, true)
  }
})
test('actual manual loader uses weekly override and add preserves every other override', async () => {
  const { api, db, docs } = harness()
  const loaded = await loadManualMutationData(db, BRANCH, WEEK, 't', 'a')
  assert.equal(loaded.students[0].sessionsPerWeek, 3)
  const result = await api.applyPtScheduleDraftCommand(command('add_student', { studentId: 'a', trainerId: 't', slotId: 'T2-6' }))
  assert.deepEqual(result.weeklySessionTargets, { a: 3, b: 4 })
  assert.equal(docs.get(`ptScheduleDrafts/${BRANCH}_${WEEK}`).schedule['T2-6'][0].studentId, 'a')
  const replay = await api.applyPtScheduleDraftCommand(command('add_student', { studentId: 'a', trainerId: 't', slotId: 'T2-6' }))
  assert.deepEqual(replay, result)
})
test('move writes destination atomically, respects source PT and never loses other learners', async () => {
  const data = fixture(); data.schedule = { 'T2-6': [entry('a'), entry('b')] }
  const { api } = harness(data)
  const result = await api.applyPtScheduleDraftCommand(command('move_student', { studentId: 'a', trainerId: 't', fromTrainerId: 't', fromSlotId: 'T2-6', slotId: 'T3-6' }))
  assert.equal(result.schedule['T2-6'][0].studentId, 'b')
  assert.equal(result.schedule['T3-6'][0].studentId, 'a')
  assert.deepEqual(result.weeklySessionTargets, { a: 3, b: 4 })
})
test('move between PTs at the same time does not restore old source', async () => {
  const data = fixture(); data.trainers.push({ ...data.trainers[0], id: 'u' }); data.schedule = { 'T2-6': [entry('a')] }
  const { api } = harness(data)
  const result = await api.applyPtScheduleDraftCommand(command('move_student', { studentId: 'a', trainerId: 'u', fromTrainerId: 't', fromSlotId: 'T2-6', slotId: 'T2-6' }))
  assert.equal(result.schedule['T2-6'].length, 1); assert.equal(result.schedule['T2-6'][0].trainerId, 'u')
})
test('locked or missing source, invalid destination and stale revision never mutate draft', async () => {
  for (const scenario of ['locked', 'missing', 'invalid', 'stale']) {
    const data = fixture(); data.schedule = { 'T2-6': [{ ...entry('a'), ...(scenario === 'locked' ? { isLocked: true } : {}) }] }
    const { api, docs } = harness(data); const before = JSON.stringify([...docs])
    await assert.rejects(api.applyPtScheduleDraftCommand(command('move_student', { studentId: 'a', trainerId: 't', fromSlotId: scenario === 'missing' ? 'T4-6' : 'T2-6', slotId: scenario === 'invalid' ? 'T5-22' : 'T3-6' }, scenario === 'stale' ? { expectedDraftRevision: 0 } : {})))
    assert.equal(JSON.stringify([...docs]), before)
  }
})
test('published locked reservation counts once regardless of draft source', () => {
  const data = fixture(); data.students = data.students.slice(0, 1); data.contracts[0].totalSessions = 2
  data.schedule = { 'T2-6': [{ ...entry(), source: 'manual_v2', isLocked: true }] }
  data.sessions = [{ ...entry(), id: 'existing', date: WEEK, hour: 6, status: 'scheduled', billingStatus: 'pending' }]
  assert.equal(Object.values(generateSchedule(data).schedule).flat().length, 2)
})
test('all optimization modes retain audited manual outside-availability sessions', () => {
  const data = fixture(); const manual = { ...entry(), source: 'manual_v2', availabilityOverride: true, availabilityOverrideReason: 'OUTSIDE_STUDENT_AVAILABILITY' }
  data.schedule = { 'T2-6': [manual] }; data.students[0].availableSlots = ['T3-6']
  for (const generationMode of ['optimize', 'continue', 'supplement']) assert.ok(generateSchedule({ ...data, generationMode }).schedule['T2-6'].some((e) => e.studentId === 'a' && e.source === 'manual_v2' && e.availabilityOverride))
})
test('continuation frees branch capacity even when no PT is full', () => {
  const data = fixture(); data.students.forEach((s) => s.sessionsPerWeek = 1); data.students[1].availableSlots = ['T2-6']; data.config.branchCapacityBySlot = { [BRANCH]: { default: 1 } }
  data.schedule = { 'T2-6': [entry('a')] }
  const result = generateSchedule({ ...data, generationMode: 'continue' })
  assert.equal(Object.values(result.schedule).flat().length, 2)
  assert.equal(result.schedule['T2-6'][0].studentId, 'b')
  assert.equal(result.optimizationSummary.rescueAssignments, 1)
  const supplement = generateSchedule({ ...data, generationMode: 'supplement' })
  assert.equal(supplement.schedule['T2-6'][0].studentId, 'a')
  assert.equal(Object.values(supplement.schedule).flat().length, 1)
})
test('pair two singles into their common third slot without losing any learner', () => {
  const data = fixture(); data.students[0].availableSlots = ['T2-6', 'T4-6']; data.students[1].availableSlots = ['T3-6', 'T4-6']
  data.schedule = { 'T2-6': [entry('a')], 'T3-6': [entry('b')] }
  const result = compactPairedSlots(data, data.schedule)
  assert.equal(result.schedule['T4-6'].length, 2); assert.equal(Object.keys(result.schedule).length, 1)
})

test('first manual save creates a week draft that did not exist', async () => {
  const { api, docs } = harness()
  docs.delete(`ptScheduleDrafts/${BRANCH}_${WEEK}`)
  const result = await api.applyPtScheduleDraftCommand(command('add_student', { studentId: 'a', trainerId: 't', slotId: 'T2-6' }, { expectedDraftRevision: 0 }))
  assert.equal(result.draftRevision, 1)
  assert.equal(result.schedule['T2-6'][0].studentId, 'a')
})

test('continuation never loses protected or already covered learners across seeded workloads', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const data = fixture(); data.students = Array.from({ length: 9 }, (_, i) => ({ ...data.students[i % 2], id: `s${i}`, name: `S${i}`, sessionsPerWeek: 1 + (i % 3), availableSlots: ['T2-6', 'T3-6', 'T4-6'].filter((_, j) => (i + j + seed) % 4 !== 0) }))
    data.contracts = data.students.map((s) => ({ ...data.contracts[0], id: `c-${s.id}`, studentId: s.id }))
    const first = generateSchedule(data)
    const continued = generateSchedule({ ...data, schedule: first.schedule, generationMode: 'continue', searchOffset: seed })
    const counts = (schedule) => Object.values(schedule).flat().reduce((map, e) => map.set(e.studentId, (map.get(e.studentId) || 0) + 1), new Map())
    const before = counts(first.schedule), after = counts(continued.schedule)
    for (const [id, count] of before) assert.ok(after.get(id) >= count)
    assert.ok(Object.values(continued.schedule).flat().length >= Object.values(first.schedule).flat().length)
    for (const [slotId, entries] of Object.entries(continued.schedule)) {
      assert.ok(entries.length <= 2)
      for (const e of entries) {
        const student = data.students.find((s) => s.id === e.studentId)
        assert.ok(student.availableSlots.includes(slotId))
        assert.ok(after.get(student.id) <= student.sessionsPerWeek)
      }
    }
  }
})
