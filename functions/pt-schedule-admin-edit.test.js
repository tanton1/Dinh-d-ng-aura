'use strict'

const { createHash } = require('node:crypto')
const test = require('node:test')
const assert = require('node:assert/strict')
const { applyAdminScheduleEdit } = require('./pt-schedule-admin-edit')
const { draftExpiresAt, safeSchedule, scopedDraftData } = require('./pt-schedule-v2')

const WEEK = '2090-01-02' // Monday
const BRANCH = 'branch-a'
const TRAINER = 'trainer-a'
const STUDENT = 'student-a'
const CONTRACT = 'contract-a'

function deterministicSessionId(slotId = 'T2-6') {
  const digest = createHash('sha256').update(`schedule_${WEEK}|${BRANCH}|${slotId}|${STUDENT}`).digest('hex').slice(0, 40)
  return `pt_${digest}`
}

function makeHarness({ source = 'published_existing', status = 'scheduled', billingStatus = 'pending', studentBranchId = BRANCH } = {}) {
  const docs = new Map()
  const draftPath = `ptScheduleDrafts/${BRANCH}_${WEEK}`
  docs.set(draftPath, {
    branchId: BRANCH,
    weekId: WEEK,
    revision: 1,
    status: 'published',
    schedule: {
      'T2-6': [{ studentId: STUDENT, trainerId: TRAINER, branchId: BRANCH, contractId: CONTRACT, type: 'training', source }],
    },
  })
  docs.set(`branches/${BRANCH}`, { name: 'Aura', status: 'active' })
  docs.set(`students/${STUDENT}`, { id: STUDENT, name: 'Lan', branchId: studentBranchId, status: 'active', sessionsPerWeek: 2 })
  docs.set(`trainers/${TRAINER}`, { id: TRAINER, name: 'Mai', branchId: BRANCH, status: 'active', slotCapacity: 2, availableSlots: ['T2-6', 'T3-6', 'T4-6'], availabilityMode: 'configured' })
  docs.set(`trainerAvailability/${TRAINER}_${WEEK}`, { trainerId: TRAINER, weekId: WEEK, status: 'submitted', slots: ['T2-6', 'T3-6', 'T4-6'] })
  docs.set(`ptAvailability/${STUDENT}_${WEEK}`, { studentId: STUDENT, weekId: WEEK, status: 'submitted', slots: ['T2-6', 'T3-6', 'T4-6'] })
  docs.set(`settings/scheduleConfig`, { workingDays: ['T2', 'T3', 'T4'], workingHours: [6], holidays: [] })
  docs.set(`contracts/${CONTRACT}`, { id: CONTRACT, studentId: STUDENT, branchId: studentBranchId, status: 'active', startDate: WEEK, endDate: '2090-12-31', totalSessions: 20, usedSessions: 0, trainerId: TRAINER })
  docs.set(`sessions/session-a`, {
    id: 'session-a', studentId: STUDENT, trainerId: TRAINER, branchId: BRANCH, contractId: CONTRACT,
    date: WEEK, hour: 6, status, billingStatus, attendanceStatus: 'pending', revision: 0,
    scheduleWeekId: WEEK, scheduleEntryId: `schedule_${WEEK}-T2-6-${STUDENT}`,
  })

  let sequence = 0
  const snapshot = (path) => ({ id: path.split('/').at(-1), ref: reference(path), exists: docs.has(path), data: () => docs.get(path) })
  const reference = (path) => ({ path, id: path.split('/').at(-1), get: async () => snapshot(path) })
  const query = (collectionPath, filters = []) => {
    const value = {
      where(field, op, operand) { return query(collectionPath, [...filters, [field, op, operand]]) },
      limit() { return value },
      select() { return value },
      doc(id = `generated-${sequence++}`) { return reference(`${collectionPath}/${id}`) },
      get: async () => {
        const rows = [...docs.entries()]
          .filter(([path, data]) => path.startsWith(`${collectionPath}/`) && !path.slice(collectionPath.length + 1).includes('/'))
          .filter(([, data]) => filters.every(([field, op, operand]) => op === '==' ? data[field] === operand : op === '>=' ? data[field] >= operand : op === '<' ? data[field] < operand : true))
          .map(([path]) => snapshot(path))
        return { docs: rows, size: rows.length }
      },
    }
    return value
  }
  const db = {
    doc: reference,
    collection: (path) => query(path),
    runTransaction: async (callback) => {
      const writes = []
      const transaction = {
        get: async (ref) => { assert.equal(writes.length, 0, 'All reads precede writes'); return ref.get() },
        set: (ref, value, options = {}) => writes.push({ kind: 'set', ref, value, options }),
        create: (ref, value) => writes.push({ kind: 'create', ref, value }),
        update: (ref, value) => writes.push({ kind: 'update', ref, value }),
      }
      const result = await callback(transaction)
      for (const write of writes) {
        if (write.kind === 'create' && docs.has(write.ref.path)) throw new Error(`duplicate ${write.ref.path}`)
        if (write.kind === 'set' && write.options.merge) {
          const current = docs.get(write.ref.path) || {}
          const merged = { ...current, ...write.value }
          // Firestore merge semantics keep nested map keys that are absent
          // from the incoming value. This catches schedule slots that would
          // otherwise survive a draft removal in the test harness.
          if (current.schedule && write.value.schedule) merged.schedule = { ...current.schedule, ...write.value.schedule }
          docs.set(write.ref.path, merged)
        }
        else if (write.kind === 'set') docs.set(write.ref.path, write.value)
        else if (write.kind === 'update') docs.set(write.ref.path, { ...(docs.get(write.ref.path) || {}), ...write.value })
        else docs.set(write.ref.path, write.value)
      }
      return result
    },
  }
  return { db, docs, draftPath }
}

function baseInput(harness, command, payload, actor = { uid: 'admin-a', accessRole: 'admin' }) {
  return {
    db: harness.db,
    actor,
    branchId: BRANCH,
    week: WEEK,
    command,
    payload,
    reason: 'Admin xác nhận điều chỉnh lịch',
    expectedRevision: 1,
    receipt: harness.db.doc(`ptScheduleAdminEditReceipts/${command}-receipt`),
    safeSchedule,
    scopedDraftData,
    draftExpiresAt,
  }
}

for (const fast of [false, true]) test(`moving a charged session updates financial attribution atomically, fast=${fast}`, async () => {
  const NativeDate = Date
  global.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : ['2090-01-05T03:00:00Z'])) }
    static now() { return NativeDate.parse('2090-01-05T03:00:00Z') }
  }
  try {
    const h = makeHarness({ status: 'completed', billingStatus: 'charged' })
    const session = h.docs.get('sessions/session-a'), contract = h.docs.get(`contracts/${CONTRACT}`)
    Object.assign(session, { serviceOrdinal: 1, attendanceEventId: 'session-a', attendanceStatus: 'present' })
    Object.assign(contract, { totalPrice: 2000000, discount: 0, paidAmount: 2000000, usedSessions: 1 })
    h.docs.set('attendanceEvents/session-a', { sessionId: 'session-a', contractId: CONTRACT, studentId: STUDENT,
      trainerId: TRAINER, billingStatus: 'charged', attendanceStatus: 'present', serviceOrdinal: 1 })
    h.docs.set('sessionBillingEvents/session-a', { sessionId: 'session-a', contractId: CONTRACT, studentId: STUDENT, billingStatus: 'charged', serviceOrdinal: 1 })
    const recognition = require('./finance-recognition').ptRevenueRecognitionWrite({ sessionId: 'session-a', session,
      contractId: CONTRACT, contract, attendanceEventId: 'session-a', actorUid: 'system', serviceOrdinal: 1, recognisedRevenueBefore: 0 })
    h.docs.set('ledgerEntries/pt_session_session-a', recognition)
    h.docs.set('journalEntries/pt_session_session-a', require('./pt-charged-revenue').ptRevenueJournalWrite({ recognition, contract, sessionId: 'session-a', actorUid: 'system' }))
    await applyAdminScheduleEdit(baseInput(h, 'move_student', { studentId: STUDENT, trainerId: TRAINER, slotId: 'T3-6',
      fromTrainerId: TRAINER, fromSlotId: 'T2-6', ...(fast ? { adminOverride: true, sessionId: 'session-a' } : {}) }))
    const ledger = [...h.docs].filter(([path]) => path.startsWith('ledgerEntries/')).map(([, row]) => row)
    assert.equal(ledger.length, 3); assert.equal(ledger.reduce((sum, row) => sum + row.revenueImpact, 0), 100000)
    assert.equal(ledger.reduce((sum, row) => sum + row.cashImpact, 0), 0)
    assert.equal(h.docs.get('sessions/session-a').date, '2090-01-03')
    assert.equal(h.docs.get(`contracts/${CONTRACT}`).usedSessions, 1)
    assert.equal(h.docs.get('attendanceEvents/session-a').attendanceStatus, 'present')
  } finally { global.Date = NativeDate }
})

for (const action of ['add_student', 'move_student']) for (const fast of [false, true]) {
  test(`published ${action}, fast=${fast}: explicit OFF consent creates an audited session`, async () => {
    const h = makeHarness()
    h.docs.get(`contracts/${CONTRACT}`).pausePeriods = [{ startDate: '2090-01-03', endDate: '2090-01-04' }]
    const result = await applyAdminScheduleEdit(baseInput(h, action, {
      studentId: STUDENT, trainerId: TRAINER, slotId: 'T3-6', fromTrainerId: TRAINER, fromSlotId: 'T2-6', confirmStudentOff: true,
      ...(fast ? { adminOverride: true, ...(action === 'move_student' ? { sessionId: 'session-a' } : {}) } : {}),
    }))
    assert.ok(result.schedule['T3-6'][0].adminOverrideWarnings.includes('CONTRACT_PAUSED'))
    const saved = [...h.docs].find(([path, row]) => path.startsWith('sessions/') && row.date === '2090-01-03')[1]
    assert.ok(saved.adminOverrideWarnings.includes('CONTRACT_PAUSED'))
    assert.equal(saved.adminOverrideBy, 'admin-a')
    assert.equal(saved.studentOffConfirmedDate, '2090-01-03')
    assert.equal(result.schedule['T3-6'][0].studentOffConfirmedDate, '2090-01-03')
    assert.ok([...h.docs].some(([path, row]) => path.startsWith('ptOperationsAuditLogs/') && row.warnings.includes('CONTRACT_PAUSED')))
  })
}

for (const action of ['add_student', 'move_student']) for (const fast of [false, true]) for (const problem of ['off', 'expired']) {
  test(`published ${action}, fast=${fast}: ${problem} without explicit OFF consent is rejected atomically`, async () => {
    const h = makeHarness()
    const contract = { ...h.docs.get(`contracts/${CONTRACT}`) }
    if (problem === 'off') contract.pausePeriods = [{ startDate: '2090-01-03', endDate: '2090-01-04' }]
    else contract.endDate = WEEK
    h.docs.set(`contracts/${CONTRACT}`, contract)
    const before = JSON.stringify([...h.docs])
    await assert.rejects(applyAdminScheduleEdit(baseInput(h, action, {
      studentId: STUDENT, trainerId: TRAINER, slotId: 'T3-6', fromTrainerId: TRAINER, fromSlotId: 'T2-6',
      ...(fast ? { adminOverride: true, ...(action === 'move_student' ? { sessionId: 'session-a' } : {}) } : {}),
    })), error => error.code === 'failed-precondition' && error.details.errors.includes(problem === 'off' ? 'CONTRACT_PAUSED' : 'ACTIVE_CONTRACT_NOT_FOUND'))
    assert.equal(JSON.stringify([...h.docs]), before)
  })
}

test('published fast add and move require cross-branch confirmation even for Admin', async () => {
  for (const action of ['add_student', 'move_student']) {
    const h = makeHarness({ studentBranchId: 'home' })
    const before = JSON.stringify([...h.docs])
    await assert.rejects(applyAdminScheduleEdit(baseInput(h, action, {
      studentId: STUDENT, trainerId: TRAINER, slotId: 'T3-6', fromTrainerId: TRAINER, fromSlotId: 'T2-6',
      adminOverride: true, ...(action === 'move_student' ? { sessionId: 'session-a' } : {}),
    })), error => error.details.issueCode === 'STUDENT_BRANCH_CONFIRMATION_REQUIRED')
    assert.equal(JSON.stringify([...h.docs]), before)
  }
})

test('Admin can move a published session and reconciles the real session in one edit', async () => {
  const harness = makeHarness()
  const result = await applyAdminScheduleEdit(baseInput(harness, 'move_student', {
    studentId: STUDENT, fromTrainerId: TRAINER, fromSlotId: 'T2-6', trainerId: TRAINER, slotId: 'T3-6',
    confirmCrossBranchStudent: false,
  }))
  assert.equal(result.draftRevision, 2)
  assert.equal(result.schedule['T2-6'], undefined)
  assert.equal(result.schedule['T3-6'][0].studentId, STUDENT)
  const session = harness.docs.get('sessions/session-a')
  assert.equal(session.date, '2090-01-03')
  assert.equal(session.hour, 6)
  assert.equal(session.scheduleStatus, 'rescheduled')
  assert.equal(session.revision, 1)
})

test('Admin can remove a pending published session without leaving a reappearing draft row', async () => {
  const harness = makeHarness()
  const result = await applyAdminScheduleEdit(baseInput(harness, 'remove_student', {
    studentId: STUDENT, trainerId: TRAINER, slotId: 'T2-6',
  }))
  assert.equal(result.schedule['T2-6'], undefined)
  const session = harness.docs.get('sessions/session-a')
  assert.equal(session.status, 'cancelled')
  assert.equal(session.billingStatus, 'exempt')
  assert.equal(session.scheduleStatus, 'cancelled')
})

test('Admin removal with a session reference uses the direct reconciliation path', async () => {
  const harness = makeHarness()
  const result = await applyAdminScheduleEdit(baseInput(harness, 'remove_student', {
    studentId: STUDENT, trainerId: TRAINER, slotId: 'T2-6', sessionId: 'session-a', expectedSessionRevision: 0,
  }))
  assert.equal(result.sessionChanged, true)
  assert.equal(result.sessionId, 'session-a')
  assert.equal(result.sessionRevision, 1)
  assert.equal(harness.docs.get('sessions/session-a').status, 'cancelled')
  assert.equal(harness.docs.get(harness.draftPath).status, 'published')
})

test('Admin removal replaces the draft schedule map instead of retaining deleted slots', async () => {
  const harness = makeHarness({ source: 'auto_v4' })
  const draft = harness.docs.get(harness.draftPath)
  draft.schedule['T7-20'] = [{ studentId: 'stale-student', trainerId: TRAINER, branchId: BRANCH, type: 'training', source: 'auto_v4' }]
  harness.docs.set(harness.draftPath, draft)
  const result = await applyAdminScheduleEdit(baseInput(harness, 'remove_student', {
    studentId: STUDENT, trainerId: TRAINER, slotId: 'T2-6', sessionId: 'session-a', expectedSessionRevision: 0,
  }))
  assert.equal(result.schedule['T2-6'], undefined)
  assert.equal(harness.docs.get(harness.draftPath).schedule['T2-6'], undefined)
  assert.deepEqual(harness.docs.get(harness.draftPath).schedule['T7-20'], [{
    studentId: 'stale-student', trainerId: TRAINER, branchId: BRANCH, type: 'training', source: 'auto_v4',
  }])
})

test('Admin can move a published draft-only row and create its missing live session', async () => {
  const harness = makeHarness({ source: 'manual_v2' })
  harness.docs.delete('sessions/session-a')
  const result = await applyAdminScheduleEdit(baseInput(harness, 'move_student', {
    studentId: STUDENT, fromTrainerId: TRAINER, fromSlotId: 'T2-6', trainerId: TRAINER, slotId: 'T3-6',
  }))
  assert.equal(result.sessionChanged, true)
  assert.equal(result.draftRevision, 2)
  assert.equal(result.schedule['T2-6'], undefined)
  assert.equal(result.schedule['T3-6'][0].studentId, STUDENT)
  const session = harness.docs.get(`sessions/${result.sessionId}`)
  assert.equal(session.status, 'scheduled')
  assert.equal(session.date, '2090-01-03')
  assert.equal(harness.docs.get(harness.draftPath).status, 'published')
})

test('Admin can remove a published draft-only row without another Publish', async () => {
  const harness = makeHarness({ source: 'manual_v2' })
  harness.docs.delete('sessions/session-a')
  const result = await applyAdminScheduleEdit(baseInput(harness, 'remove_student', {
    studentId: STUDENT, trainerId: TRAINER, slotId: 'T2-6',
  }))
  assert.equal(result.sessionChanged, true)
  assert.equal(result.schedule['T2-6'], undefined)
  assert.equal(harness.docs.get(harness.draftPath).status, 'published')
})

test('Admin can move an explicitly confirmed cross-branch learner', async () => {
  const harness = makeHarness({ studentBranchId: 'branch-home' })
  const result = await applyAdminScheduleEdit(baseInput(harness, 'move_student', {
    studentId: STUDENT, fromTrainerId: TRAINER, fromSlotId: 'T2-6', trainerId: TRAINER, slotId: 'T3-6', confirmCrossBranchStudent: true,
  }))
  assert.deepEqual(result.warnings, ['STUDENT_BRANCH_MISMATCH'])
  assert.equal(result.schedule['T3-6'][0].studentBranchWarning, true)
})

test('Admin can add a learner after publish and creates the live session without another Publish', async () => {
  const harness = makeHarness()
  const result = await applyAdminScheduleEdit(baseInput(harness, 'add_student', {
    studentId: STUDENT, trainerId: TRAINER, slotId: 'T3-6', adminOverride: true,
  }))
  assert.equal(result.sessionChanged, true)
  assert.equal(result.draftRevision, 2)
  assert.equal(result.schedule['T3-6'][0].studentId, STUDENT)
  assert.equal(result.schedule['T3-6'][0].adminOverride, true)
  const session = harness.docs.get(`sessions/${result.sessionId}`)
  assert.equal(session.status, 'scheduled')
  assert.equal(session.date, '2090-01-03')
  assert.equal(session.hour, 6)
  assert.equal(session.source, 'admin_manual')
  assert.equal(harness.docs.get(harness.draftPath).status, 'published')
  assert.equal(harness.docs.get(harness.draftPath).publishedRevision, 2)
})

test('Admin re-add never selects a cancelled contract with a later end date', async () => {
  const harness = makeHarness()
  harness.docs.set('contracts/contract-cancelled-late', {
    id: 'contract-cancelled-late',
    studentId: STUDENT,
    branchId: BRANCH,
    status: 'cancelled',
    startDate: WEEK,
    endDate: '2091-01-01',
    totalSessions: 20,
    usedSessions: 0,
  })
  const result = await applyAdminScheduleEdit(baseInput(harness, 'add_student', {
    studentId: STUDENT, trainerId: TRAINER, slotId: 'T3-6', adminOverride: true,
  }))
  const session = harness.docs.get(`sessions/${result.sessionId}`)
  assert.equal(session.contractId, CONTRACT)
  assert.ok(!result.warnings.includes('ACTIVE_CONTRACT_NOT_FOUND'))
})

test('Admin move with a published session uses the scoped fast path', async () => {
  const harness = makeHarness()
  const result = await applyAdminScheduleEdit(baseInput(harness, 'move_student', {
    studentId: STUDENT,
    fromTrainerId: TRAINER,
    fromSlotId: 'T2-6',
    trainerId: TRAINER,
    slotId: 'T3-6',
    sessionId: 'session-a',
    expectedSessionRevision: 0,
    adminOverride: true,
  }))
  assert.equal(result.sessionId, 'session-a')
  assert.equal(result.sessionRevision, 1)
  assert.equal(result.schedule['T2-6'], undefined)
  assert.equal(result.schedule['T3-6'][0].adminOverride, true)
  assert.equal(harness.docs.get('sessions/session-a').scheduleStatus, 'rescheduled')
  assert.equal(harness.docs.get('sessions/session-a').slotId, 'T3-6')
})

test('Admin can re-add a cancelled cell while keeping the cancelled session as history', async () => {
  const harness = makeHarness()
  const draft = harness.docs.get(harness.draftPath)
  harness.docs.set(harness.draftPath, { ...draft, schedule: {} })
  const cancelledId = deterministicSessionId()
  const cancelled = { ...harness.docs.get('sessions/session-a'), id: cancelledId, status: 'cancelled', scheduleStatus: 'cancelled', billingStatus: 'exempt' }
  harness.docs.delete('sessions/session-a')
  harness.docs.set(`sessions/${cancelledId}`, cancelled)

  const result = await applyAdminScheduleEdit(baseInput(harness, 'add_student', {
    studentId: STUDENT, trainerId: TRAINER, slotId: 'T2-6', adminOverride: true,
  }))
  assert.notEqual(result.sessionId, cancelledId)
  assert.ok(result.warnings.includes('CANCELLED_SESSION_REINTRODUCED'))
  assert.equal(harness.docs.get(`sessions/${cancelledId}`).status, 'cancelled')
  const replacement = harness.docs.get(`sessions/${result.sessionId}`)
  assert.equal(replacement.status, 'scheduled')
  assert.equal(replacement.reintroducedFromSessionId, cancelledId)
  assert.equal(replacement.scheduleEntryId, `schedule_${WEEK}-T2-6-${STUDENT}`)
})

test('Admin cannot delete a charged or attended session through schedule removal', async () => {
  for (const fixture of [{ billingStatus: 'charged' }, { status: 'completed', billingStatus: '' }]) {
    const harness = makeHarness(fixture)
    await assert.rejects(
      applyAdminScheduleEdit(baseInput(harness, 'remove_student', { studentId: STUDENT, trainerId: TRAINER, slotId: 'T2-6' })),
      (error) => error.code === 'failed-precondition' && error.details?.issueCode === 'TEACHING_SHIFT_STATUS_NOT_EDITABLE',
    )
  }
})

test('Staff cannot call the Admin edit path', async () => {
  const harness = makeHarness()
  await assert.rejects(
    applyAdminScheduleEdit(baseInput(harness, 'remove_student', { studentId: STUDENT, trainerId: TRAINER, slotId: 'T2-6' }, { uid: 'staff-a', accessRole: 'staff' })),
    (error) => error.code === 'permission-denied',
  )
})
