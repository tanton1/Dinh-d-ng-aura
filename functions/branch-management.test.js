'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const { createBranchManagementFunctions } = require('./branch-management')

function clone(value) { return value === undefined ? undefined : structuredClone(value) }

function memoryDb(seed = {}) {
  const documents = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]))
  const reference = (path) => ({ path, id: path.split('/').at(-1) })
  const snapshot = (ref) => ({ exists: documents.has(ref.path), id: ref.id, data: () => clone(documents.get(ref.path)) })
  const merge = (current, next) => ({ ...(current || {}), ...clone(next) })
  return {
    documents,
    doc: reference,
    async runTransaction(handler) {
      const transaction = {
        get: async (ref) => snapshot(ref),
        create(ref, value) { if (documents.has(ref.path)) throw new Error(`already exists: ${ref.path}`); documents.set(ref.path, clone(value)) },
        set(ref, value, options) { documents.set(ref.path, options?.merge ? merge(documents.get(ref.path), value) : clone(value)) },
        update(ref, value) { if (!documents.has(ref.path)) throw new Error(`not found: ${ref.path}`); documents.set(ref.path, merge(documents.get(ref.path), value)) },
      }
      return handler(transaction)
    },
  }
}

const actor = { uid: 'admin-1', accessRole: 'admin', branchIds: [], capabilities: ['identity.staff_position.manage'] }

function api(db, currentActor = actor) {
  return createBranchManagementFunctions({ db, onCall: (...args) => args.at(-1), accessContextResolver: async () => currentActor })
}

function input(overrides = {}) {
  return { expectedRevision: 0, idempotencyKey: 'branch-command-attempt-1', name: 'Aura Hải Châu', address: 'Đà Nẵng', ...overrides }
}

test('creates and retries a branch with deterministic idempotency, revision and audit', async () => {
  const db = memoryDb()
  const functions = api(db)
  const first = await functions.upsertBranch({ data: input(), auth: { uid: actor.uid } })
  const second = await functions.upsertBranch({ data: input(), auth: { uid: actor.uid } })
  assert.equal(first.status, 'active')
  assert.equal(first.revision, 1)
  assert.equal(second.unchanged, true)
  assert.equal(db.documents.get(`branches/${first.branchId}`).name, 'Aura Hải Châu')
  assert.equal([...db.documents.keys()].filter((key) => key.startsWith('auditLogs/branch_command_')).length, 1)
})

test('updates and archives without deleting the branch', async () => {
  const db = memoryDb({ 'branches/branch-a': { id: 'branch-a', name: 'Cũ', address: 'Đà Nẵng', status: 'active', revision: 2 } })
  const functions = api(db)
  const updated = await functions.upsertBranch({ data: input({ branchId: 'branch-a', expectedRevision: 2, idempotencyKey: 'branch-update-attempt-1', name: 'Mới' }), auth: { uid: actor.uid } })
  const archived = await functions.archiveBranch({ data: { branchId: 'branch-a', expectedRevision: updated.revision, idempotencyKey: 'branch-archive-attempt-1' }, auth: { uid: actor.uid } })
  assert.equal(archived.status, 'archived')
  assert.equal(db.documents.get('branches/branch-a').status, 'archived')
  assert.equal(db.documents.has('branches/branch-a'), true)
})

test('rejects stale revisions and capability-less actors', async () => {
  const db = memoryDb({ 'branches/branch-a': { name: 'Aura', address: 'Đà Nẵng', status: 'active', revision: 2 } })
  await assert.rejects(api(db).upsertBranch({ data: input({ branchId: 'branch-a', expectedRevision: 1, idempotencyKey: 'branch-stale-attempt-1' }), auth: { uid: actor.uid } }), /vừa được người khác cập nhật/)
  await assert.rejects(api(db, { ...actor, capabilities: [] }).upsertBranch({ data: input(), auth: { uid: actor.uid } }), /không có quyền/)
})

test('branch commands are callable-only and never hard-delete records', () => {
  const source = readFileSync(join(__dirname, 'branch-management.js'), 'utf8')
  assert.doesNotMatch(source, /transaction\.delete|\.delete\(\)/)
  assert.match(source, /branchCommandReceipts/)
  assert.match(source, /branch\.archived/)
})
