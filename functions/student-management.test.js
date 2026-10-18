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
  const reference = (path) => ({
    path,
    id: path.split('/').at(-1),
    async get() { return documentSnapshot(this) },
    collection(name) { return collection(`${path}/${name}`) },
  })
  const documentSnapshot = (ref) => ({
    exists: documents.has(ref.path),
    id: ref.id,
    ref,
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
    doc(id) { return reference(`${collectionPath}/${id}`) },
    where(field, operator, value) {
      if (operator !== '==') throw new Error(`unsupported operator ${operator}`)
      return collection(collectionPath, [...filters, [field, value]], maximum)
    },
    limit(value) { return collection(collectionPath, filters, value) },
    async get() { return querySnapshot(this) },
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
      delete(ref) {
        documents.delete(ref.path)
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

test('student management remains callable-only and exposes a guarded hard-delete command', () => {
  const source = readFileSync(join(__dirname, 'student-management.js'), 'utf8')
  assert.match(source, /withFunctionTelemetry\('updateStudentProfile'/)
  assert.match(source, /student\.archived/)
  assert.match(source, /withFunctionTelemetry\('hardDeleteStudent'/)
  assert.match(source, /XÓA VĨNH VIỄN/)
  assert.match(source, /isHardDeleteActor/)
  assert.match(source, /preservedSessionCount/)
  assert.match(source, /uniqueReferencesToDelete\.forEach\(\(reference\) => transaction\.delete\(reference\)/)
  assert.doesNotMatch(source, /transaction\.delete\(db\.doc\(`sessions\//)
})

test('hard delete removes profile-side documents but preserves sessions and contracts for payroll/audit', async () => {
  const db = memoryDb({
    'students/student-a': { name: 'Học viên A', branchId: 'branch-a', status: 'inactive', accountUid: 'member-1' },
    'users/member-1': { uid: 'member-1', role: 'student' },
    'roleAssignments/member-1': { uid: 'member-1', accessRole: 'student' },
    'coachClients/member-1': { clientId: 'member-1', coachingStatus: 'onboarding' },
    'accountIdentityLinks/member-1': { studentId: 'student-a', status: 'active' },
    'users/member-1/mealLogs/meal-a': { id: 'meal-a', calories: 420 },
    'users/member-1/progressCheckIns/checkin-a': { id: 'checkin-a', date: '2026-10-12' },
    'studentOperationalViews/student-a': { studentId: 'student-a' },
    'ptTrainingPrograms/student-a': { studentId: 'student-a' },
    'ptTrainingPrograms/student-a/revisions/1': { studentId: 'student-a' },
    'contractRenewalCases/renewal-a': { studentId: 'student-a', status: 'open' },
    'operationalActions/action-a': { studentId: 'student-a', status: 'open' },
    'sessionKudos/kudos-a': { studentId: 'student-a', xp: 5 },
    'ptAvailability/student-a_2026-10-12': { studentId: 'student-a' },
    'sessionRequests/request-a': { studentId: 'student-a' },
    'sessions/session-a': { studentId: 'student-a', trainerId: 'trainer-1', status: 'completed' },
    'contracts/contract-a': { studentId: 'student-a', status: 'cancelled' },
  })
  const result = await api(db).hardDeleteStudent({ data: { studentId: 'student-a', confirmation: 'XÓA VĨNH VIỄN' }, auth: { uid: adminActor.uid } })
  assert.equal(result.deleted, true)
  assert.equal(result.preservedSessionCount, 1)
  assert.equal(result.preservedContractCount, 1)
  assert.equal(db.documents.has('students/student-a'), false)
  assert.equal(db.documents.has('sessions/session-a'), true)
  assert.equal(db.documents.has('contracts/contract-a'), true)
  assert.equal(db.documents.has('ptAvailability/student-a_2026-10-12'), false)
  assert.equal(db.documents.has('users/member-1/mealLogs/meal-a'), false)
  assert.equal(db.documents.has('users/member-1/progressCheckIns/checkin-a'), false)
  assert.equal(db.documents.has('ptTrainingPrograms/student-a/revisions/1'), false)
  assert.equal(db.documents.has('contractRenewalCases/renewal-a'), false)
  assert.equal(db.documents.has('operationalActions/action-a'), false)
  assert.equal(db.documents.has('sessionKudos/kudos-a'), false)
  assert.equal([...db.documents.keys()].some((path) => path.startsWith('identityAuditLogs/')), true)
})

test('hard delete accepts the alternate Vietnamese accent placement', async () => {
  const db = memoryDb({
    'students/student-accent': { name: 'Học viên dấu', status: 'inactive' },
  })
  const result = await api(db).hardDeleteStudent({ data: { studentId: 'student-accent', confirmation: 'XOÁ VĨNH VIỄN' }, auth: { uid: adminActor.uid } })
  assert.equal(result.deleted, true)
  assert.equal(db.documents.has('students/student-accent'), false)

  const unaccentedDb = memoryDb({
    'students/student-unaccented': { name: 'Học viên không dấu', status: 'inactive' },
  })
  await assert.rejects(api(unaccentedDb).hardDeleteStudent({ data: { studentId: 'student-unaccented', confirmation: 'XOA VINH VIEN' }, auth: { uid: adminActor.uid } }), /Cần nhập đúng/)
})

test('hard delete blocks active contracts and non-admin actors', async () => {
  const activeDb = memoryDb({
    'students/student-a': { name: 'Học viên A', status: 'inactive' },
    'contracts/contract-a': { studentId: 'student-a', status: 'active' },
  })
  await assert.rejects(api(activeDb).hardDeleteStudent({ data: { studentId: 'student-a', confirmation: 'XÓA VĨNH VIỄN' }, auth: { uid: adminActor.uid } }), /hợp đồng đang hiệu lực/)
  const legacyActiveDb = memoryDb({
    'students/student-a': { name: 'Học viên A', status: 'inactive' },
    'contracts/contract-legacy': { crmProfileId: 'student-a', status: 'future' },
  })
  await assert.rejects(api(legacyActiveDb).hardDeleteStudent({ data: { studentId: 'student-a', confirmation: 'XÓA VĨNH VIỄN' }, auth: { uid: adminActor.uid } }), /hợp đồng đang hiệu lực/)
  const staffDb = memoryDb({ 'students/student-a': { name: 'Học viên A', status: 'inactive' } })
  await assert.rejects(api(staffDb, managerActor).hardDeleteStudent({ data: { studentId: 'student-a', confirmation: 'XÓA VĨNH VIỄN' }, auth: { uid: managerActor.uid } }), /Chỉ Admin hoặc Super Admin/)
})
