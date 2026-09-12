'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const { createStudentManagementFunctions } = require('./student-management')

function clone(value) {
  if (value === undefined) return undefined
  return structuredClone(value)
}

function memoryDb(seed = {}) {
  const documents = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]))
  const reference = (path) => ({ path, id: path.split('/').at(-1) })
  const documentSnapshot = (ref) => ({
    exists: documents.has(ref.path),
    id: ref.id,
    data: () => clone(documents.get(ref.path)),
  })
  const querySnapshot = (query) => {
    const prefix = `${query.collectionPath}/`
    const rows = [...documents.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .filter(([, value]) => query.filters.every(([field, expected]) => value?.[field] === expected))
      .slice(0, query.maximum)
      .map(([path]) => documentSnapshot(reference(path)))
    return { docs: rows, empty: rows.length === 0, size: rows.length }
  }
  const collection = (collectionPath, filters = [], maximum = Number.MAX_SAFE_INTEGER) => ({
    collectionPath,
    filters,
    maximum,
    where(field, operator, value) {
      if (operator !== '==') throw new Error(`unsupported operator ${operator}`)
      return collection(collectionPath, [...filters, [field, value]], maximum)
    },
    limit(value) { return collection(collectionPath, filters, value) },
  })
  const merge = (current, next) => ({ ...(current || {}), ...clone(next) })
  return {
    documents,
    doc: reference,
    collection,
    async runTransaction(handler) {
      const transaction = {
        get: async (target) => target.collectionPath ? querySnapshot(target) : documentSnapshot(target),
        create(ref, value) {
          if (documents.has(ref.path)) throw new Error(`already exists: ${ref.path}`)
          documents.set(ref.path, clone(value))
        },
        set(ref, value, options) {
          documents.set(ref.path, options?.merge ? merge(documents.get(ref.path), value) : clone(value))
        },
        update(ref, value) {
          if (!documents.has(ref.path)) throw new Error(`not found: ${ref.path}`)
          documents.set(ref.path, merge(documents.get(ref.path), value))
        },
      }
      return handler(transaction)
    },
  }
}

const adminActor = {
  uid: 'admin-1',
  accessRole: 'admin',
  branchIds: [],
  capabilities: ['pt.operations.manage'],
}

const managerActor = {
  uid: 'manager-1',
  accessRole: 'staff',
  branchIds: ['branch-a'],
  capabilities: ['branch.students.manage'],
}

const trainerActor = {
  uid: 'trainer-1',
  legacyStaffId: 'trainer-1',
  accessRole: 'staff',
  branchIds: ['branch-a'],
  capabilities: ['pt.session.self.manage'],
}

function api(db, actor = adminActor) {
  return createStudentManagementFunctions({
    db,
    onCall: (...args) => args.at(-1),
    accessContextResolver: async () => actor,
  })
}

function input(overrides = {}) {
  return {
    studentId: 'student-a',
    expectedRevision: 0,
    idempotencyKey: 'student-update-attempt-1',
    updates: { name: 'Nguyễn Aura', sessionsPerWeek: 3 },
    ...overrides,
  }
}

test('updates a legacy student once with revision, receipt, audit and linked profile projection', async () => {
  const db = memoryDb({
    'students/student-a': { name: 'Tên cũ', branchId: 'branch-a', status: 'active', accountUid: 'member-1' },
    'users/member-1': { displayName: 'Tên cũ', branchId: 'branch-a' },
    'branches/branch-a': { name: 'Aura A', status: 'active' },
  })
  const first = await api(db).updateStudentProfile({ data: input(), auth: { uid: adminActor.uid } })
  const second = await api(db).updateStudentProfile({ data: input(), auth: { uid: adminActor.uid } })

  assert.equal(first.revision, 1)
  assert.equal(first.unchanged, false)
  assert.equal(second.unchanged, true)
  assert.equal(db.documents.get('students/student-a').name, 'Nguyễn Aura')
  assert.equal(db.documents.get('students/student-a').revision, 1)
  assert.equal(db.documents.get('users/member-1').displayName, 'Nguyễn Aura')
  assert.equal([...db.documents.keys()].filter((path) => path.startsWith('studentCommandReceipts/')).length, 1)
  assert.equal([...db.documents.keys()].filter((path) => path.startsWith('auditLogs/student_command_')).length, 1)
})

test('rejects stale revisions and reuse of a receipt for different changes', async () => {
  const db = memoryDb({
    'students/student-a': { name: 'Tên cũ', branchId: 'branch-a', status: 'active' },
    'branches/branch-a': { name: 'Aura A', status: 'active' },
  })
  const functions = api(db)
  await functions.updateStudentProfile({ data: input(), auth: { uid: adminActor.uid } })
  await assert.rejects(functions.updateStudentProfile({ data: input({
    updates: { name: 'Nội dung khác' },
  }), auth: { uid: adminActor.uid } }), /Mã chống ghi trùng đã được dùng/)
  await assert.rejects(functions.updateStudentProfile({ data: input({
    idempotencyKey: 'student-update-attempt-2',
  }), auth: { uid: adminActor.uid } }), /vừa được người khác cập nhật/)
})

test('branch manager cannot read or move a student outside assigned branches', async () => {
  const db = memoryDb({
    'students/student-a': { name: 'Học viên A', branchId: 'branch-b', status: 'active' },
    'branches/branch-a': { name: 'Aura A', status: 'active' },
    'branches/branch-b': { name: 'Aura B', status: 'active' },
  })
  await assert.rejects(api(db, managerActor).updateStudentProfile({
    data: input({ updates: { branchId: 'branch-a' } }),
    auth: { uid: managerActor.uid },
  }), /ngoài phạm vi chi nhánh/)
})

test('assigned PT can update scheduling fields but cannot edit CRM identity', async () => {
  const db = memoryDb({
    'students/student-a': { name: 'Học viên A', branchId: 'branch-a', status: 'active', revision: 2 },
    'contracts/contract-a': { studentId: 'student-a', trainerId: 'trainer-1', status: 'active' },
  })
  const functions = api(db, trainerActor)
  const result = await functions.updateStudentProfile({ data: input({
    expectedRevision: 2,
    idempotencyKey: 'trainer-schedule-attempt-1',
    updates: { availableSlots: ['T2-10', 'T4-10'], sessionsPerWeek: 2, isScheduleConfirmed: true },
  }), auth: { uid: trainerActor.uid } })
  assert.equal(result.revision, 3)
  await assert.rejects(functions.updateStudentProfile({ data: input({
    expectedRevision: 3,
    idempotencyKey: 'trainer-profile-attempt-1',
    updates: { phone: '0901234567' },
  }), auth: { uid: trainerActor.uid } }), /chỉ được cập nhật thông tin phục vụ xếp lịch/)
})

test('student management never hard-deletes a learner and is callable-only', () => {
  const source = readFileSync(join(__dirname, 'student-management.js'), 'utf8')
  assert.doesNotMatch(source, /transaction\.delete|\.delete\(\)/)
  assert.match(source, /withFunctionTelemetry\('updateStudentProfile'/)
  assert.match(source, /student\.archived/)
})
