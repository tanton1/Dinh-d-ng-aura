'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createPtScheduleV2Functions, loadManualMutationData, generateSchedule, historicalSlotCandidate, repairCoverageWithRelocations, compactPairedSlots, candidateForSlot, slotCalendarDateIsPast } = require('./pt-schedule-v2')
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
  const reference = (path) => ({ path, id: path.split('/').at(-1), get: async () => snap({ path }) })
  const collection = (path, filters = []) => {
    const query = { path, where: (key, op, val) => collection(path, [...filters, [key, op, val]]), limit: () => query, orderBy: () => query,
      doc: () => reference(`${path}/audit-${sequence++}`), get: async () => {
        const rows = [...docs].filter(([key, value]) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/') && filters.every(([f, op, val]) => op === '==' ? value[f] === val : op === 'in' ? val.includes(value[f]) : op === '>=' ? value[f] >= val : value[f] < val)).map(([key]) => snap(reference(key)))
        return { docs: rows, size: rows.length }
      } }
    return query
  }
  const db = { doc: reference, collection, getAll: async (...refs) => refs.map(snap), runTransaction: async (fn) => {
    const writes = []
    const result = await fn({ get: async (ref) => ref.get(), set: (ref, value) => writes.push([ref.path, value]), create: (ref, value) => writes.push([ref.path, value]), update: (ref, value) => writes.push([ref.path, { ...docs.get(ref.path), ...value }]) })
    for (const [path, value] of writes) docs.set(path, value)
    return result
  } }
  const actor = options.actor || { uid: 'admin', accessRole: 'admin', branchIds: [BRANCH] }
  const actorForBranch = async (request, _db, branch) => { if (actor.accessRole === 'staff' && !actor.branchIds.includes(branch)) throw Error('permission-denied'); return actor }
  const branchData = async () => ({ ...data, schedule: docs.get(`ptScheduleDrafts/${BRANCH}_${WEEK}`)?.schedule || {}, draft: { revision: docs.get(`ptScheduleDrafts/${BRANCH}_${WEEK}`)?.revision || 0 } })
  return {
    docs,
    db,
    api: createPtScheduleV2Functions({
      db,
      onCall: (...args) => args.at(-1),
      actorForBranch,
      ...(options.realBranchData ? {} : { branchData }),
      ...(options.manualData ? { manualData: options.manualData } : {}),
    }),
  }
}
const command = (name, payload, extra = {}) => ({ data: { branchId: BRANCH, weekId: WEEK, command: name, payload, expectedDraftRevision: 1, idempotencyKey: 'test-command-123', ...extra } })

test('expiry visibility uses one calendar month, ignores cancelled renewals and retains a real renewal', () => {
  const { monthAfter, hiddenExpiredStudent, requireScheduleContract } = require('./schedule-entitlement-policy')
  assert.equal(monthAfter('2026-01-31'), '2026-02-28')
  assert.equal(monthAfter('2028-01-31'), '2028-02-29')
  const contracts = [{ id: 'old', studentId: 'a', startDate: '2026-01-01', endDate: '2026-09-25', status: 'expired' }]
  assert.equal(hiddenExpiredStudent(contracts, 'a', '2026-10-25'), false)
  assert.equal(hiddenExpiredStudent(contracts, 'a', '2026-10-26'), true)
  contracts.push({ ...contracts[0], id: 'cancelled', status: 'CANCELLED', endDate: '2027-12-31' })
  assert.equal(hiddenExpiredStudent(contracts, 'a', '2026-10-26'), true)
  contracts.push({ ...contracts[0], id: 'renewed', status: 'active', startDate: '2026-10-01', endDate: '2027-03-01' })
  assert.equal(hiddenExpiredStudent(contracts, 'a', '2026-10-26'), false)
  assert.equal(requireScheduleContract(contracts, 'a', '2026-10-26', 'old').id, 'renewed')
})

for (const action of ['add_student', 'move_student']) for (const fast of [false, true]) {
  test(`confirmed Admin OFF ${action} persists warnings and counts the booked session, fast=${fast}`, async () => {
    const data = fixture()
    data.contracts[0].pausePeriods = [{ startDate: '2090-01-03', endDate: '2090-01-04' }]
    data.schedule = { 'T2-6': [{ ...entry('a'), source: 'manual_v2' }] }
    const h = harness(data)
    if (!fast) h.docs.get(`ptScheduleDrafts/${BRANCH}_${WEEK}`).status = 'published'
    const input = command(action, { studentId: 'a', trainerId: 't', slotId: 'T3-6', fromSlotId: 'T2-6', fromTrainerId: 't', adminOverride: true, confirmStudentOff: true })
    const result = await h.api.applyPtScheduleDraftCommand(input)
    const row = result.schedule['T3-6'][0]
    assert.equal(row.contractId, 'c-a')
    assert.equal(row.adminOverrideBy, 'admin')
    assert.equal(row.studentOffConfirmedDate, '2090-01-03')
    assert.ok(row.adminOverrideWarnings.includes('CONTRACT_PAUSED'))
    assert.ok(result.warnings.includes('CONTRACT_PAUSED'))
    assert.equal(require('./schedule-entitlement-policy').entryOnApprovedOff(data, 'T3-6', row), false)
    assert.equal(require('./schedule-entitlement-policy').entryOnApprovedOff(data, 'T4-6', row), true)
    assert.deepEqual(await h.api.applyPtScheduleDraftCommand(input), result)
    assert.equal(h.docs.get(`ptScheduleDrafts/${BRANCH}_${WEEK}`).revision, 2)
  })
}

for (const adminOverride of [false, true]) test('staff cannot forge an Admin OFF confirmation, override=' + adminOverride, async () => {
  const data = fixture()
  data.contracts[0].pausePeriods = [{ startDate: '2090-01-03', endDate: '2090-01-04' }]
  const h = harness(data, { actor: { uid: 'staff', accessRole: 'staff', branchIds: [BRANCH] } })
  const before = JSON.stringify([...h.docs])
  await assert.rejects(h.api.applyPtScheduleDraftCommand(command('add_student', {
    studentId: 'a', trainerId: 't', slotId: 'T3-6', adminOverride, confirmStudentOff: true,
  })), error => error.details?.errors.includes('CONTRACT_PAUSED'))
  assert.equal(JSON.stringify([...h.docs]), before)
})

test('transaction revalidates entitlement after a confirmed OFF candidate was loaded', async () => {
  const data = fixture()
  data.contracts[0].pausePeriods = [{ startDate: '2090-01-03', endDate: '2090-01-04' }]
  const h = harness(data)
  h.docs.get(`ptScheduleDrafts/${BRANCH}_${WEEK}`).status = 'published'
  h.docs.set('contracts/c-a', { ...data.contracts[0], endDate: WEEK })
  const before = JSON.stringify([...h.docs])
  await assert.rejects(h.api.applyPtScheduleDraftCommand(command('add_student', {
    studentId: 'a', trainerId: 't', slotId: 'T3-6', adminOverride: true, confirmStudentOff: true,
  })), error => error.details?.issueCode === 'ACTIVE_CONTRACT_NOT_FOUND')
  assert.equal(JSON.stringify([...h.docs]), before)
})

test('OFF consent cannot create entitlement outside contract dates or bypass renewal handover', () => {
  const { requireScheduleContract } = require('./schedule-entitlement-policy')
  const contract = { id: 'a', studentId: 'a', status: 'frozen', startDate: WEEK, endDate: '2090-01-04' }
  assert.equal(requireScheduleContract([contract], 'a', '2090-01-03', '', true).id, 'a')
  for (const invalid of [
    { ...contract, endDate: WEEK }, { ...contract, startDate: '2090-01-04' },
    { ...contract, status: 'cancelled' },
    { ...contract, sourceContractId: 'prior', handoverStatus: 'pending' },
  ]) assert.throws(() => requireScheduleContract([invalid], 'a', '2090-01-03', '', true))
})

for (const action of ['add_student', 'move_student']) for (const problem of ['off', 'expired', 'future', 'missing']) {
  test(`admin draft ${action} rejects ${problem} without changing matrix or receipt`, async () => {
    const data = fixture()
    data.schedule = { 'T2-6': [{ ...entry('a'), source: 'manual_v2' }] }
    const h = harness(data)
    const contract = { ...h.docs.get('contracts/c-a') }
    if (problem === 'off') contract.pausePeriods = [{ startDate: '2090-01-03', endDate: '2090-01-04' }]
    if (problem === 'expired') contract.endDate = WEEK
    if (problem === 'future') contract.startDate = '2090-01-04'
    if (problem === 'missing') h.docs.delete('contracts/c-a')
    else h.docs.set('contracts/c-a', contract)
    const before = JSON.stringify([...h.docs])
    await assert.rejects(h.api.applyPtScheduleDraftCommand(command(action, {
      studentId: 'a', trainerId: 't', slotId: 'T3-6', fromSlotId: 'T2-6', fromTrainerId: 't', adminOverride: true,
    })), error => error.code === 'failed-precondition' && error.details.errors.includes(problem === 'off' ? 'CONTRACT_PAUSED' : 'ACTIVE_CONTRACT_NOT_FOUND'))
    assert.equal(JSON.stringify([...h.docs]), before)
  })
}

test('admin override alone does not consent to cross-branch draft placement', async () => {
  const h = harness()
  h.docs.set('students/a', { ...h.docs.get('students/a'), branchId: 'other' })
  const before = JSON.stringify([...h.docs])
  await assert.rejects(h.api.applyPtScheduleDraftCommand(command('add_student', {
    studentId: 'a', trainerId: 't', slotId: 'T3-6', adminOverride: true,
  })), error => error.details.issueCode === 'STUDENT_BRANCH_CONFIRMATION_REQUIRED')
  assert.equal(JSON.stringify([...h.docs]), before)
})

test('manual search hides long-expired cross-branch names, but Students directory and renewal remain discoverable', async () => {
  const h = harness()
  h.docs.set('students/external', { ...h.docs.get('students/a'), id: 'external', name: 'Thảo My', branchId: 'home' })
  h.docs.set('contracts/c-external', { ...h.docs.get('contracts/c-a'), id: 'c-external', studentId: 'external', branchId: 'home', startDate: '2020-01-01', endDate: '2020-06-30' })
  const input = { branchId: BRANCH, weekId: WEEK, trainerId: 't', slotId: 'T2-6', search: 'thao my', crossBranchOnly: true }
  assert.equal((await h.api.getPtScheduleSlotCandidates({ data: input })).candidates.length, 0)
  const directory = await h.api.getPtScheduleSlotCandidates({ data: { branchId: BRANCH, weekId: WEEK, search: 'thao my', directoryOnly: true } })
  assert.equal(directory.candidates[0].studentId, 'external')
  h.docs.set('contracts/c-renewal', { ...h.docs.get('contracts/c-a'), id: 'c-renewal', studentId: 'external', branchId: 'home' })
  const renewed = await h.api.getPtScheduleSlotCandidates({ data: input })
  assert.equal(renewed.candidates[0].contractId, 'c-renewal')
  assert.equal(renewed.candidates[0].adminManualSelectable, true)
})
test('confirmed reset clears all unpublished bookings only in its branch/week and is idempotent', async () => {
  const data = fixture()
  data.crossBranchStudents = [{ id: 'external', branchId: 'home' }]
  const off = { studentId: 'OFF', trainerId: 't', branchId: BRANCH, type: 'off', source: 'manual_v2', isLocked: true }
  data.schedule = {
    'T2-6': [{ ...entry('a'), source: 'manual_v2', isLocked: true }],
    'T3-6': [{ ...entry('b'), source: 'manual_v2' }],
    'T4-6': [entry('b'), { ...entry('external'), source: 'manual_v2', isLocked: true, studentBranchWarning: true }],
    'T5-6': [off],
  }
  // Old drafts may retain their manual source after a session was published.
  data.sessions = [{ id: 'published-a', studentId: 'a', trainerId: 't', contractId: 'c-a', branchId: BRANCH, date: WEEK, hour: 6, status: 'completed', billingStatus: 'charged' }]
  const h = harness(data)
  const unchangedPaths = ['sessions/published-a', 'contracts/c-a', `ptScheduleDrafts/other_${WEEK}`, 'ptScheduleDrafts/b_2090-01-09']
  h.docs.set(unchangedPaths[0], data.sessions[0])
  for (const path of unchangedPaths.slice(2)) h.docs.set(path, { revision: 9, schedule: structuredClone(data.schedule) })
  const before = unchangedPaths.map((path) => structuredClone(h.docs.get(path)))
  const request = command('reset_draft', {})
  const result = await h.api.applyPtScheduleDraftCommand(request)
  assert.equal(result.draftRevision, 2)
  assert.deepEqual(Object.keys(result.schedule).sort(), ['T2-6', 'T5-6'])
  assert.equal(result.schedule['T2-6'][0].studentId, 'a')
  assert.equal(result.schedule['T2-6'][0].source, 'published_existing')
  assert.equal(result.schedule['T2-6'][0].isLocked, true)
  assert.deepEqual(result.schedule['T5-6'], [off])
  const draft = h.docs.get(`ptScheduleDrafts/${BRANCH}_${WEEK}`)
  assert.deepEqual(draft.schedule, result.schedule)
  assert.deepEqual(draft.weeklySessionTargets, { a: 3, b: 4 })
  assert.deepEqual(draft.unassignedEntries.map((row) => row.studentId).sort(), ['b', 'external'])
  assert.ok(draft.unassignedEntries.every((row) => row.reasonCodes.includes('DRAFT_RESET')))
  assert.deepEqual(unchangedPaths.map((path) => h.docs.get(path)), before)
  assert.deepEqual(await h.api.applyPtScheduleDraftCommand(request), result)
  assert.equal(h.docs.get(`ptScheduleDrafts/${BRANCH}_${WEEK}`).revision, 2)
  const audits = [...h.docs].filter(([path]) => path.startsWith('ptOperationsAuditLogs/'))
  assert.equal(audits.length, 1)
  assert.equal(audits[0][1].affectedStudentCount, 2)
})

test('reset rejects a stale revision without removing newly edited manual bookings', async () => {
  const data = fixture()
  data.schedule = { 'T2-6': [{ ...entry('a'), source: 'manual_v2', isLocked: true }] }
  const h = harness(data)
  const path = `ptScheduleDrafts/${BRANCH}_${WEEK}`
  h.docs.set(path, { ...h.docs.get(path), revision: 2 })
  const before = JSON.stringify([...h.docs])
  await assert.rejects(h.api.applyPtScheduleDraftCommand(command('reset_draft', {})), { code: 'aborted' })
  assert.equal(JSON.stringify([...h.docs]), before)
})

test('slot candidates complete for Admin and scoped staff, including cross-branch search', async () => {
  for (const actor of [{ uid: 'admin', accessRole: 'admin', branchIds: [BRANCH] }, { uid: 'staff', accessRole: 'staff', branchIds: [BRANCH] }]) {
    const { api } = harness(fixture(), { actor })
    const result = await api.getPtScheduleSlotCandidates({ data: { branchId: BRANCH, weekId: WEEK, trainerId: 't', slotId: 'T2-6', search: 'Lan' } })
    assert.equal(result.candidates[0].studentId, 'a')
    assert.equal(result.candidates[0].eligible, true)
  }
})

function crossBranchHarness(role = 'admin') {
  const data = fixture(), week = '2020-01-06'
  data.weekId = week
  data.contracts.forEach((c) => { c.startDate = week; c.endDate = '2020-12-31'; c.status = 'expired' })
  const h = harness(data, { actor: { uid: role, accessRole: role, branchIds: [BRANCH] } })
  h.docs.set('students/external', { ...data.students[0], id: 'external', name: 'Lan ngoài cơ sở', branchId: 'home', isScheduleConfirmed: true })
  h.docs.set('contracts/c-external', { ...data.contracts[0], id: 'c-external', studentId: 'external', branchId: 'home' })
  const input = { weekId: week, branchId: BRANCH, trainerId: 't', studentId: 'external', contractId: 'c-external', slotId: 'T2-6', reason: 'Admin xác nhận buổi tập lịch sử', idempotencyKey: 'historical-cross-branch', confirmCrossBranchStudent: true }
  return { ...h, input }
}

test('historical search returns cross-branch learners only to Admin with an explicit search', async () => {
  for (const role of ['admin', 'staff']) {
    const h = crossBranchHarness(role)
    const result = await h.api.getPtScheduleSlotCandidates({ data: { ...h.input, search: 'Lan ngoai', historical: true } })
    if (role === 'staff') assert.equal(result.candidates.length, 0)
    else {
      assert.equal(result.candidates[0]?.studentId, 'external')
      assert.equal(result.candidates[0].manualSelectable, true)
      assert.equal(result.candidates[0].studentBranchWarning, true)
    }
  }
})

test('Admin draft search can resolve a cross-branch learner without a full workspace scan', async () => {
  const h = crossBranchHarness()
  h.docs.set('contracts/c-external', { ...h.docs.get('contracts/c-external'), endDate: '2099-12-31' })
  const result = await h.api.getPtScheduleSlotCandidates({ data: {
    branchId: BRANCH,
    weekId: h.input.weekId,
    trainerId: 't',
    slotId: 'T2-6',
    search: 'Lan ngoai',
    crossBranchOnly: true,
  } })
  assert.equal(result.candidates[0]?.studentId, 'external')
  assert.equal(result.candidates[0]?.studentBranchWarning, true)
})

test('Admin cross-branch search checks bounded contract matches without full manual validation', async () => {
  const data = fixture()
  const h = harness(data, {
    manualData: async () => { throw new Error('manual validation should wait for the write') },
  })
  h.docs.set('students/external', { ...data.students[0], id: 'external', name: 'Lan ngoài cơ sở', branchId: 'home' })
  const result = await h.api.getPtScheduleSlotCandidates({ data: {
    branchId: BRANCH,
    weekId: WEEK,
    trainerId: 't',
    slotId: 'T2-6',
    search: 'Lan ngoai',
    crossBranchOnly: true,
  } })
  assert.equal(result.candidates[0]?.studentId, 'external')
  assert.equal(result.candidates[0]?.contractId, null)
  assert.deepEqual(result.candidates[0]?.reasons, ['ACTIVE_CONTRACT_NOT_FOUND', 'STUDENT_BRANCH_MISMATCH'])
  assert.equal(result.candidates[0]?.adminManualSelectable, false)
})

test('historical cross-branch write requires Admin confirmation and acknowledgement, without partial writes', async () => {
  for (const scenario of ['staff', 'no-confirmation', 'no-warning']) {
    const h = crossBranchHarness(scenario === 'staff' ? 'staff' : 'admin')
    const before = JSON.stringify([...h.docs])
    await assert.rejects(h.api.createHistoricalPtSession({ data: { ...h.input, confirmCrossBranchStudent: scenario !== 'no-confirmation', acknowledgedWarnings: [] } }))
    assert.equal(JSON.stringify([...h.docs]), before)
  }
})

test('historical cross-branch save is idempotent and audited without charging attendance or quota', async () => {
  const h = crossBranchHarness()
  const result = await h.api.getPtScheduleSlotCandidates({ data: { ...h.input, search: 'Lan ngoai', historical: true } })
  assert.equal(result.candidates.length, 1)
  const request = { data: { ...h.input, acknowledgedWarnings: result.candidates[0].warningReasons } }
  const before = structuredClone(h.docs.get('contracts/c-external'))
  const saved = await h.api.createHistoricalPtSession(request)
  const session = h.docs.get(`sessions/${saved.sessionId}`)
  assert.equal(session.branchId, BRANCH)
  assert.equal(session.studentHomeBranchId, 'home')
  assert.equal(session.studentBranchWarning, true)
  assert.equal(session.attendanceStatus, 'pending')
  assert.equal(session.billingStatus, 'pending')
  assert.equal(session.requiresPtConfirmation, true)
  assert.deepEqual(h.docs.get('contracts/c-external'), before)
  assert.deepEqual(await h.api.createHistoricalPtSession(request), saved)
  for (const collection of ['sessions', 'sessionEvents', 'ptOperationsAuditLogs']) assert.equal([...h.docs].filter(([p]) => p.startsWith(`${collection}/`)).length, 1)
})

test('legacy workspace loads an external learner by PT scope without leaking a local learner assigned elsewhere', async () => {
  const h = harness(fixture(), { realBranchData: true })
  h.docs.set('students/external', { id: 'external', name: 'Cross branch', status: 'active', branchId: 'home' })
  h.docs.set('trainers/external-pt', { id: 'external-pt', status: 'active', branchId: 'home' })
  h.docs.set('contracts/c-external', { studentId: 'external', branchId: 'home', startDate: WEEK, endDate: '2091-12-31', status: 'active', totalSessions: 40 })
  h.docs.delete(`ptScheduleDrafts/${BRANCH}_${WEEK}`)
  h.docs.set(`schedules/schedule_${WEEK}`, { schedule: { 'T2-6': [
    { studentId: 'external', trainerId: 't', branchId: 'all', contractId: 'c-external' },
    { studentId: 'a', trainerId: 'external-pt', branchId: 'all', contractId: 'c-a' },
  ] } })
  const result = await h.api.getPtScheduleWorkspace({ data: { weekId: WEEK, branchId: BRANCH } })
  assert.equal(result.students.find((s) => s.id === 'external').isCrossBranchDisplayOnly, true)
  assert.equal(result.students.find((s) => s.id === 'external').eligibleForWeek, false)
  assert.equal(result.schedule['T2-6'].length, 1)
  assert.equal(result.schedule['T2-6'][0].studentId, 'external')
})

test('workspace exposes weekly session coverage from every branch without returning raw sessions', async () => {
  const h = harness(fixture(), { realBranchData: true })
  h.docs.set('sessions/cross-branch-a', {
    id: 'cross-branch-a',
    studentId: 'a',
    trainerId: 'other-trainer',
    contractId: 'c-a',
    branchId: 'branch-b',
    date: WEEK,
    hour: 7,
    status: 'completed',
  })
  const result = await h.api.getPtScheduleWorkspace({ data: { weekId: WEEK, branchId: BRANCH } })
  assert.equal(result.weeklySessionCoverage.a.total, 1)
  assert.equal(result.weeklySessionCoverage.a.otherBranches, 1)
  assert.equal(result.weeklySessionCoverage.a.byBranch['branch-b'], 1)
  assert.deepEqual(result.weeklySessionCoverage.a.entries, [{
    id: 'cross-branch-a',
    branchId: 'branch-b',
    date: WEEK,
    hour: 7,
    trainerId: 'other-trainer',
  }])
  assert.deepEqual(result.sessions, [])
  assert.equal(result.quickCoverage.status, 'verified')
  assert.equal(result.quickCoverage.verification, 'exact')
  assert.equal(result.quickCoverage.verified, true)
  assert.equal(result.quickCoverage.otherBranchScheduledEntries, 1)
})

test('published Admin workspace paints from profile projections without weekly evidence fan-out', async () => {
  const h = harness(fixture(), { realBranchData: true })
  const draftPath = `ptScheduleDrafts/${BRANCH}_${WEEK}`
  h.docs.set(draftPath, { ...h.docs.get(draftPath), status: 'published', publishedVersion: 1, publishedRevision: 1 })
  const student = h.docs.get('students/a')
  h.docs.set('students/a', {
    ...student,
    latestSubmittedAvailability: { weekId: '2090-01-01', status: 'submitted', slots: ['T2-6'], revision: 1 },
  })
  h.docs.delete(`ptAvailability/a_${WEEK}`)
  const result = await h.api.getPtScheduleWorkspace({ data: { weekId: WEEK, branchId: BRANCH } })
  assert.equal(result.draftStatus, 'published')
  assert.equal(result.readMode, 'reconciled')
  assert.deepEqual(result.students.find((studentRow) => studentRow.id === 'a').availableSlots, ['T2-6'])
})

test('initial paint returns a display projection without reconciliation evidence', async () => {
  const h = harness(fixture(), { realBranchData: true })
  const draftPath = `ptScheduleDrafts/${BRANCH}_${WEEK}`
  h.docs.set(draftPath, { ...h.docs.get(draftPath), status: 'published', publishedVersion: 1, publishedRevision: 1 })
  const result = await h.api.getPtScheduleWorkspace({
    data: { weekId: WEEK, branchId: BRANCH, initialPaint: true },
  })
  assert.equal(result.readMode, 'display')
  assert.equal(result.partial, true)
  assert.deepEqual(result.contracts, [])
  assert.deepEqual(result.sessions, [])
  assert.deepEqual(result.weeklySessionCoverage, {})
  assert.equal(result.quickCoverage.status, 'ready')
  assert.equal(result.quickCoverage.verification, 'unverified')
  assert.equal(result.quickCoverage.verified, false)
  assert.equal(result.quickCoverage.targetStudents, 2)
  assert.equal(result.quickCoverage.totalTargetSessions, 7)
  assert.equal(result.quickCoverage.missingSessions, 7)
})

test('initial paint and published fast workspace both use exact PT weekly availability', async () => {
  for (const initialPaint of [true, false]) {
    const h = harness(fixture(), { realBranchData: true })
    const draftPath = `ptScheduleDrafts/${BRANCH}_${WEEK}`
    h.docs.set(draftPath, { ...h.docs.get(draftPath), status: 'published', publishedVersion: 1, publishedRevision: 1 })
    h.docs.set(`trainerAvailability/t_${WEEK}`, { trainerId: 't', weekId: WEEK, status: 'submitted', slots: ['T5-6'], offDates: [WEEK], revision: 3 })
    const result = await h.api.getPtScheduleWorkspace({ data: { weekId: WEEK, branchId: BRANCH, initialPaint } })
    assert.deepEqual(result.trainers[0].availableSlots, ['T5-6'])
    assert.equal(result.trainers[0].availabilityRevision, 3)
    assert.equal(result.trainers[0].availabilitySource, 'weekly')
    assert.deepEqual(result.trainers[0].offDates, [WEEK])
  }
})

test('historical supplement accepts an expired contract that was valid on the actual session date', () => {
  const data = fixture()
  data.contracts[0].status = 'expired'
  data.students[0].availabilityStatus = 'missing'
  data.students[0].availableSlots = []
  const result = historicalSlotCandidate(data, { student: data.students[0], trainer: data.trainers[0], slotId: 'T2-6' })
  assert.equal(result.manualSelectable, true)
  assert.equal(result.contractId, 'c-a')
  assert.ok(result.warningReasons.includes('AVAILABILITY_NOT_SUBMITTED'))
  assert.equal(result.hardReasons.length, 0)
})
test('historical supplement blocks duplicate learner days and exhausted contracts', () => {
  const data = fixture()
  data.sessions = [{ id: 'existing', studentId: 'a', trainerId: 't', contractId: 'c-a', branchId: BRANCH, date: WEEK, hour: 6, status: 'completed', billingStatus: 'charged' }]
  let result = historicalSlotCandidate(data, { student: data.students[0], trainer: data.trainers[0], slotId: 'T2-6' })
  assert.equal(result.manualSelectable, false)
  assert.ok(result.hardReasons.includes('STUDENT_MULTIPLE_SESSIONS_PER_DAY'))
  data.sessions = []
  data.contracts[0].remainingSchedulableSessions = 0
  result = historicalSlotCandidate(data, { student: data.students[0], trainer: data.trainers[0], slotId: 'T2-6' })
  assert.equal(result.manualSelectable, false)
  assert.ok(result.hardReasons.includes('CONTRACT_SESSION_QUOTA_EXCEEDED'))
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

test('manual add keeps an audited override when the learner is outside the selected slot', async () => {
  const data = fixture()
  data.students[0].availableSlots = ['T2-6', 'T3-6']
  data.trainers[0].availableSlots = ['T2-6', 'T3-6', 'T4-6']
  const { api, docs } = harness(data)
  const result = await api.applyPtScheduleDraftCommand(command('add_student', {
    studentId: 'a', trainerId: 't', slotId: 'T4-6', allowOutsideStudentAvailability: true,
  }, { idempotencyKey: 'outside-availability' }))
  const saved = docs.get(`ptScheduleDrafts/${BRANCH}_${WEEK}`).schedule['T4-6'][0]
  assert.equal(result.schedule['T4-6'][0].studentId, 'a')
  assert.equal(saved.availabilityOverride, true)
  assert.equal(saved.availabilityOverrideReason, 'OUTSIDE_STUDENT_AVAILABILITY')
})

test('Admin manual placement keeps every scheduling conflict as a warning', async () => {
  const data = fixture()
  data.students[0].availableSlots = ['T2-6']
  data.trainers[0].availableSlots = ['T2-6']
  const h = harness(data)
  const result = await h.api.applyPtScheduleDraftCommand(command('add_student', {
    studentId: 'a', trainerId: 't', slotId: 'T3-6', adminOverride: true,
  }, { idempotencyKey: 'admin-override-conflicts' }))
  const saved = h.docs.get(`ptScheduleDrafts/${BRANCH}_${WEEK}`).schedule['T3-6'][0]
  assert.equal(result.schedule['T3-6'][0].studentId, 'a')
  assert.equal(saved.adminOverride, true)
  assert.ok(saved.adminOverrideWarnings.includes('OUTSIDE_STUDENT_AVAILABILITY'))
  assert.ok(saved.adminOverrideWarnings.includes('OUTSIDE_TRAINER_AVAILABILITY'))
})

test('Admin manual placement can add a learner from another branch', async () => {
  const h = harness()
  h.docs.set('students/external', { ...h.docs.get('students/a'), id: 'external', name: 'Lan ngoài cơ sở', branchId: 'home' })
  h.docs.set(`ptAvailability/external_${WEEK}`, { studentId: 'external', weekId: WEEK, status: 'submitted', slots: ['T2-6'] })
  h.docs.set('contracts/c-external', { ...h.docs.get('contracts/c-a'), id: 'c-external', studentId: 'external', branchId: 'home' })
  const result = await h.api.applyPtScheduleDraftCommand(command('add_student', {
    studentId: 'external', trainerId: 't', slotId: 'T2-6', adminOverride: true, confirmCrossBranchStudent: true,
  }, { idempotencyKey: 'admin-cross-branch' }))
  const saved = h.docs.get(`ptScheduleDrafts/${BRANCH}_${WEEK}`).schedule['T2-6'][0]
  assert.equal(result.schedule['T2-6'][0].studentId, 'external')
  assert.equal(saved.studentBranchWarning, true)
  assert.equal(saved.adminOverride, true)
  assert.ok(saved.adminOverrideWarnings.includes('STUDENT_BRANCH_MISMATCH'))
})

test('Admin draft add, move and remove use one lightweight atomic path', async () => {
  const h = harness()
  const call = (commandName, payload, revision, key) => h.api.applyPtScheduleDraftCommand({ data: {
    branchId: BRANCH,
    weekId: WEEK,
    command: commandName,
    payload: { ...payload, adminOverride: true },
    expectedDraftRevision: revision,
    idempotencyKey: key,
  } })
  const added = await call('add_student', { studentId: 'a', trainerId: 't', slotId: 'T2-6' }, 1, 'fast-admin-add')
  assert.equal(added.draftRevision, 2)
  const moved = await call('move_student', { studentId: 'a', fromTrainerId: 't', fromSlotId: 'T2-6', trainerId: 't', slotId: 'T3-6' }, 2, 'fast-admin-move')
  assert.equal(moved.draftRevision, 3)
  assert.equal(moved.schedule['T2-6'], undefined)
  assert.equal(moved.schedule['T3-6'][0].source, 'manual_v2')
  const removed = await call('remove_student', { studentId: 'a', trainerId: 't', slotId: 'T3-6' }, 3, 'fast-admin-remove')
  assert.equal(removed.draftRevision, 4)
  assert.deepEqual(removed.schedule, {})
})

test('manual placement preserves blocker diagnostics for other missing learners', async () => {
  const h = harness()
  const draftPath = `ptScheduleDrafts/${BRANCH}_${WEEK}`
  h.docs.set(draftPath, {
    ...h.docs.get(draftPath),
    unassignedEntries: [{
      studentId: 'b',
      studentName: 'Ngọc',
      missingSessions: 2,
      blockerType: 'input_or_capacity',
      blockerCategory: 'trainer_capacity',
      primaryReasonCode: 'ALL_MATCHING_TRAINERS_FULL',
      reasonCodes: ['ALL_MATCHING_TRAINERS_FULL'],
    }],
  })
  const result = await h.api.applyPtScheduleDraftCommand(command('add_student', {
    studentId: 'a', trainerId: 't', slotId: 'T2-6', adminOverride: true,
  }, { idempotencyKey: 'preserve-warning-diagnostics' }))
  const saved = h.docs.get(draftPath)
  assert.equal(result.schedule['T2-6'][0].studentId, 'a')
  assert.equal(saved.unassignedEntries.length, 1)
  assert.equal(saved.unassignedEntries[0].studentId, 'b')
  assert.equal(saved.unassignedEntries[0].blockerCategory, 'trainer_capacity')
  assert.deepEqual(saved.unassignedEntries[0].reasonCodes, ['ALL_MATCHING_TRAINERS_FULL'])
})

test('manual validation rehydrates published occupancy when an old draft is missing the row', async () => {
  const data = fixture()
  data.students[0].availableSlots = ['T2-6', 'T3-6']
  data.students[1].availableSlots = ['T2-6', 'T3-6']
  data.trainers[0].availableSlots = ['T2-6', 'T3-6']
  const { api, docs } = harness(data)
  docs.set('sessions/published-b', {
    id: 'published-b', studentId: 'b', trainerId: 't', contractId: 'c-b', branchId: BRANCH,
    date: WEEK, hour: 6, status: 'scheduled', billingStatus: 'pending',
  })
  const result = await api.applyPtScheduleDraftCommand(command('add_student', {
    studentId: 'a', trainerId: 't', slotId: 'T2-6',
  }, { idempotencyKey: 'published-seat-check' }))
  assert.deepEqual(result.schedule['T2-6'].map((entry) => entry.studentId).sort(), ['a', 'b'])
  assert.equal(result.schedule['T2-6'].find((entry) => entry.studentId === 'b').source, 'published_existing')
})

test('draft mutations use the calendar-day boundary shown by the matrix', () => {
  assert.equal(slotCalendarDateIsPast('2090-01-02', 'T2-6', '2090-01-02'), false)
  assert.equal(slotCalendarDateIsPast('2090-01-02', 'T2-6', '2090-01-03'), true)
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

test('weekly target change can create a missing week draft', async () => {
  const { api, docs } = harness()
  docs.delete(`ptScheduleDrafts/${BRANCH}_${WEEK}`)
  const result = await api.applyPtScheduleDraftCommand(command('set_student_weekly_target', {
    studentId: 'a',
    targetSessions: 3,
  }, { expectedDraftRevision: 0, idempotencyKey: 'target-create-123' }))
  assert.equal(result.draftRevision, 1)
  assert.equal(result.weeklySessionTargets.a, 3)
  assert.equal(docs.get(`ptScheduleDrafts/${BRANCH}_${WEEK}`).weeklySessionTargets.a, 3)
  assert.equal(docs.get(`ptScheduleDrafts/${BRANCH}_${WEEK}`).optimizationSummary, undefined)
})

test('quick weekly target writes an override without creating or revising the schedule draft', async () => {
  const { api, docs } = harness()
  const beforeDraft = structuredClone(docs.get(`ptScheduleDrafts/${BRANCH}_${WEEK}`))
  const result = await api.setPtStudentWeeklyTarget({ data: {
    branchId: BRANCH,
    weekId: WEEK,
    studentId: 'a',
    targetSessions: 0,
    idempotencyKey: 'quick-target-zero-123',
  } })
  assert.equal(result.changed, true)
  assert.equal(result.targetSessions, 0)
  assert.equal(result.weeklySessionTargetOverride, 0)
  assert.equal(docs.get(`ptScheduleTargetOverrides/${BRANCH}_${WEEK}`).targets.a, 0)
  assert.deepEqual(docs.get(`ptScheduleDrafts/${BRANCH}_${WEEK}`), beforeDraft)
})

test('quick weekly target works before a draft exists', async () => {
  const { api, docs } = harness()
  docs.delete(`ptScheduleDrafts/${BRANCH}_${WEEK}`)
  const result = await api.setPtStudentWeeklyTarget({ data: {
    branchId: BRANCH,
    weekId: WEEK,
    studentId: 'a',
    targetSessions: 0,
    idempotencyKey: 'quick-target-no-draft-123',
  } })
  assert.equal(result.targetSessions, 0)
  assert.equal(docs.has(`ptScheduleDrafts/${BRANCH}_${WEEK}`), false)
  assert.equal(docs.get(`ptScheduleTargetOverrides/${BRANCH}_${WEEK}`).targets.a, 0)
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
