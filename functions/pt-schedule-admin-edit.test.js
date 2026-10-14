'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { applyAdminScheduleEdit } = require('./pt-schedule-admin-edit')
const { draftExpiresAt, safeSchedule, scopedDraftData } = require('./pt-schedule-v2')

const WEEK = '2090-01-02' // Monday
const BRANCH = 'branch-a'
const TRAINER = 'trainer-a'
const STUDENT = 'student-a'
const CONTRACT = 'contract-a'

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
        get: async (ref) => ref.get(),
        set: (ref, value, options = {}) => writes.push({ kind: 'set', ref, value, options }),
        create: (ref, value) => writes.push({ kind: 'create', ref, value }),
        update: (ref, value) => writes.push({ kind: 'update', ref, value }),
      }
      const result = await callback(transaction)
      for (const write of writes) {
        if (write.kind === 'create' && docs.has(write.ref.path)) throw new Error(`duplicate ${write.ref.path}`)
        if (write.kind === 'set' && write.options.merge) docs.set(write.ref.path, { ...(docs.get(write.ref.path) || {}), ...write.value })
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

test('Admin can move an explicitly confirmed cross-branch learner', async () => {
  const harness = makeHarness({ studentBranchId: 'branch-home' })
  const result = await applyAdminScheduleEdit(baseInput(harness, 'move_student', {
    studentId: STUDENT, fromTrainerId: TRAINER, fromSlotId: 'T2-6', trainerId: TRAINER, slotId: 'T3-6', confirmCrossBranchStudent: true,
  }))
  assert.deepEqual(result.warnings, ['STUDENT_BRANCH_MISMATCH'])
  assert.equal(result.schedule['T3-6'][0].studentBranchWarning, true)
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
