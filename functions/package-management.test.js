'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const { createPackageManagementFunctions } = require('./package-management')

function clone(value) {
  if (value === undefined) return undefined
  return structuredClone(value)
}

function memoryDb(seed = {}) {
  const documents = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]))
  const reference = (path) => ({ path, id: path.split('/').at(-1) })
  const snapshot = (ref) => ({
    exists: documents.has(ref.path),
    id: ref.id,
    data: () => clone(documents.get(ref.path)),
  })
  const merge = (current, next) => ({ ...(current || {}), ...clone(next) })
  return {
    documents,
    doc: reference,
    async runTransaction(handler) {
      const transaction = {
        get: async (ref) => snapshot(ref),
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
  positions: [],
  branchIds: [],
  capabilities: ['pt.operations.manage'],
}

function managerActor(branchIds = ['branch-a']) {
  return {
    uid: 'manager-1',
    accessRole: 'staff',
    positions: ['branch_manager'],
    branchIds,
    capabilities: ['pt.operations.manage'],
  }
}

function api(db, actor = adminActor) {
  return createPackageManagementFunctions({
    db,
    onCall: (...args) => args.at(-1),
    accessContextResolver: async () => actor,
  })
}

function packageInput(overrides = {}) {
  return {
    expectedRevision: 0,
    idempotencyKey: 'package-attempt-0001',
    name: 'Gói PT 24 buổi',
    totalSessions: 24,
    durationMonths: 3,
    price: 12_000_000,
    branchId: 'branch-a',
    ...overrides,
  }
}

test('creates one revisioned package, audit record and idempotency receipt', async () => {
  const db = memoryDb({ 'branches/branch-a': { name: 'Aura A', status: 'active' } })
  const first = await api(db).upsertTrainingPackage({ data: packageInput(), auth: { uid: adminActor.uid } })
  const second = await api(db).upsertTrainingPackage({ data: packageInput(), auth: { uid: adminActor.uid } })

  assert.equal(first.status, 'active')
  assert.equal(first.revision, 1)
  assert.equal(first.unchanged, false)
  assert.equal(second.packageId, first.packageId)
  assert.equal(second.unchanged, true)
  assert.equal(db.documents.get(`packages/${first.packageId}`).name, 'Gói PT 24 buổi')
  assert.equal(db.documents.get(`packages/${first.packageId}`).revision, 1)
  assert.equal([...db.documents.keys()].filter((path) => path.startsWith('auditLogs/package_command_')).length, 1)
  assert.equal([...db.documents.keys()].filter((path) => path.startsWith('packageCommandReceipts/')).length, 1)
})

test('rejects reuse of an idempotency key with a different payload', async () => {
  const db = memoryDb({ 'branches/branch-a': { name: 'Aura A', status: 'active' } })
  const functions = api(db)
  await functions.upsertTrainingPackage({ data: packageInput(), auth: { uid: adminActor.uid } })
  await assert.rejects(
    functions.upsertTrainingPackage({ data: packageInput({ price: 13_000_000 }), auth: { uid: adminActor.uid } }),
    /Mã chống ghi trùng đã được dùng/,
  )
})

test('updates legacy packages with revision zero and rejects stale revisions', async () => {
  const db = memoryDb({
    'branches/branch-a': { name: 'Aura A', status: 'active' },
    'packages/legacy-package': { id: 'legacy-package', name: 'Gói cũ', totalSessions: 12, durationMonths: 2, price: 5_000_000, branchId: 'branch-a' },
  })
  const functions = api(db)
  const result = await functions.upsertTrainingPackage({ data: packageInput({
    packageId: 'legacy-package',
    idempotencyKey: 'package-attempt-update-1',
    name: 'Gói đã chuẩn hóa',
  }), auth: { uid: adminActor.uid } })

  assert.equal(result.revision, 1)
  assert.equal(db.documents.get('packages/legacy-package').status, 'active')
  await assert.rejects(functions.upsertTrainingPackage({ data: packageInput({
    packageId: 'legacy-package',
    expectedRevision: 0,
    idempotencyKey: 'package-attempt-update-2',
  }), auth: { uid: adminActor.uid } }), /vừa được người khác cập nhật/)
})

test('branch manager can manage only a package in an assigned branch and cannot create a global package', async () => {
  const db = memoryDb({
    'branches/branch-a': { name: 'Aura A', status: 'active' },
    'branches/branch-b': { name: 'Aura B', status: 'active' },
  })
  const functions = api(db, managerActor())
  const local = await functions.upsertTrainingPackage({ data: packageInput(), auth: { uid: 'manager-1' } })
  assert.equal(local.status, 'active')
  await assert.rejects(functions.upsertTrainingPackage({ data: packageInput({
    branchId: 'branch-b', idempotencyKey: 'package-attempt-branch-b',
  }), auth: { uid: 'manager-1' } }), /ngoài phạm vi chi nhánh/)
  await assert.rejects(functions.upsertTrainingPackage({ data: packageInput({
    branchId: null, idempotencyKey: 'package-attempt-global',
  }), auth: { uid: 'manager-1' } }), /Chỉ Admin hệ thống/)
})

test('branch manager cannot take ownership of or archive a legacy global package', async () => {
  const db = memoryDb({
    'branches/branch-a': { name: 'Aura A', status: 'active' },
    'packages/global-package': { id: 'global-package', name: 'Gói toàn hệ thống', totalSessions: 12, durationMonths: 2, price: 5_000_000, branchId: null, status: 'active', revision: 2 },
  })
  const functions = api(db, managerActor())
  await assert.rejects(functions.upsertTrainingPackage({ data: packageInput({
    packageId: 'global-package', branchId: 'branch-a', expectedRevision: 2, idempotencyKey: 'global-package-claim-1',
  }), auth: { uid: 'manager-1' } }), /Chỉ Admin hệ thống/)
  await assert.rejects(functions.archiveTrainingPackage({ data: {
    packageId: 'global-package', expectedRevision: 2, idempotencyKey: 'global-package-archive-1',
  }, auth: { uid: 'manager-1' } }), /Chỉ Admin hệ thống/)
})

test('archive is revisioned, never deletes history and an archived package cannot be edited', async () => {
  const db = memoryDb({
    'branches/branch-a': { name: 'Aura A', status: 'active' },
    'packages/package-a': { id: 'package-a', name: 'Gói A', totalSessions: 12, durationMonths: 2, price: 5_000_000, branchId: 'branch-a', status: 'active', revision: 4 },
  })
  const functions = api(db)
  const archived = await functions.archiveTrainingPackage({ data: {
    packageId: 'package-a', expectedRevision: 4, idempotencyKey: 'package-archive-attempt-1',
  }, auth: { uid: adminActor.uid } })
  assert.equal(archived.status, 'archived')
  assert.equal(archived.revision, 5)
  assert.equal(db.documents.has('packages/package-a'), true)
  assert.equal(db.documents.get('packages/package-a').status, 'archived')
  await assert.rejects(functions.upsertTrainingPackage({ data: packageInput({
    packageId: 'package-a', expectedRevision: 5, idempotencyKey: 'package-edit-archived-1',
  }), auth: { uid: adminActor.uid } }), /không thể chỉnh sửa/)
})

test('package commands require the canonical operations capability', async () => {
  const db = memoryDb({ 'branches/branch-a': { name: 'Aura A', status: 'active' } })
  const actor = { ...managerActor(), capabilities: [] }
  await assert.rejects(api(db, actor).upsertTrainingPackage({ data: packageInput(), auth: { uid: actor.uid } }), /không có quyền/)
})

test('package management source contains no destructive package delete', () => {
  const source = readFileSync(join(__dirname, 'package-management.js'), 'utf8')
  assert.doesNotMatch(source, /transaction\.delete|\.delete\(\)/)
  assert.match(source, /status: PACKAGE_STATUS_ARCHIVED/)
  assert.match(source, /requireCapability\(actor, PACKAGE_CAPABILITY\)/)
  assert.match(source, /withFunctionTelemetry\('upsertTrainingPackage'/)
})
