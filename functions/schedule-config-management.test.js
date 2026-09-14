'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const { createHash } = require('node:crypto')
const { createScheduleConfigManagementFunctions, normalizeScheduleConfig } = require('./schedule-config-management')

function clone(value) { return value === undefined ? undefined : structuredClone(value) }
function memoryDb(seed = {}) {
  const documents = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]))
  const reference = (path) => ({ path, id: path.split('/').at(-1) })
  const snapshot = (ref) => ({ exists: documents.has(ref.path), id: ref.id, data: () => clone(documents.get(ref.path)) })
  return {
    documents,
    doc: reference,
    async runTransaction(handler) {
      return handler({
        get: async (ref) => snapshot(ref),
        create(ref, value) { if (documents.has(ref.path)) throw new Error(`already exists: ${ref.path}`); documents.set(ref.path, clone(value)) },
        set(ref, value) { documents.set(ref.path, clone(value)) },
      })
    },
  }
}

const actor = { uid: 'admin-1', accessRole: 'admin', branchIds: [], positions: [], capabilities: ['pt.operations.manage'] }
function api(db, currentActor = actor) {
  return createScheduleConfigManagementFunctions({ db, onCall: (...args) => args.at(-1), accessContextResolver: async () => currentActor })
}
function config(overrides = {}) {
  return {
    workingDays: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7'],
    workingHours: [6, 7, 8, 17, 18, 19],
    isAutoLockEnabled: true,
    lockDayOfWeek: 6,
    lockHour: 12,
    holidays: ['2026-09-02'],
    holidayDetails: [{ date: '2026-09-02', name: 'Quốc khánh', paid: true }],
    branchCapacityBySlot: { 'branch-a': { default: 12, 'T2-18': 10 } },
    complimentaryChangeCancelPerMonth: 1,
    sessionChangeDeadlineHours: 12,
    offMaxDaysPerRequest: 14,
    offRegistrationCutoffHour: 10,
    offLimitsByDuration: { threeMonths: 1, sixMonths: 3, twelveMonths: 6 },
    ...overrides,
  }
}

test('saves the full normalized schedule policy with revision, receipt and audit', async () => {
  const db = memoryDb({ 'branches/branch-a': { status: 'active' } })
  const input = { config: config(), expectedRevision: 0, idempotencyKey: 'schedule-config-0001' }
  const first = await api(db).saveScheduleConfig({ data: input })
  const second = await api(db).saveScheduleConfig({ data: input })
  assert.equal(first.revision, 1)
  assert.equal(first.unchanged, false)
  assert.equal(second.unchanged, true)
  assert.equal(db.documents.get('settings/scheduleConfig').revision, 1)
  assert.equal(db.documents.get('settings/scheduleConfig').schemaVersion, 3)
  assert.equal(db.documents.get('settings/scheduleConfig').branchCapacityBySlot['branch-a']['T2-18'], 10)
  assert.equal(db.documents.get('settings/scheduleConfig').operationsPolicy.version, 'pt-operations-r1')
  assert.match(db.documents.get('settings/scheduleConfig').operationsPolicy.hash, /^[a-f0-9]{64}$/)
  assert.equal([...db.documents.keys()].filter((path) => path.startsWith('scheduleConfigCommandReceipts/')).length, 1)
  assert.equal([...db.documents.keys()].filter((path) => path.startsWith('auditLogs/schedule_config_')).length, 1)
})

test('keeps the same policy version when only layout settings change', async () => {
  const db = memoryDb({ 'branches/branch-a': { status: 'active' } })
  const functions = api(db)
  const first = await functions.saveScheduleConfig({ data: { config: config(), expectedRevision: 0, idempotencyKey: 'schedule-config-keep-policy-1' } })
  const second = await functions.saveScheduleConfig({ data: { config: { ...first.config, lockHour: 13 }, expectedRevision: 1, idempotencyKey: 'schedule-config-keep-policy-2' } })
  assert.equal(second.config.operationsPolicy.version, 'pt-operations-r1')
  assert.equal(second.config.operationsPolicy.hash, first.config.operationsPolicy.hash)
})

test('legacy config saves preserve the newer load policy when the field is omitted', async () => {
  const db = memoryDb({
    'branches/branch-a': { status: 'active' },
    'settings/scheduleConfig': {
      ...config(),
      revision: 4,
      scheduleLoadPolicy: { schemaVersion: 1, defaultDailyTargets: { full_time: 6, part_time: 5, collaborator: 3 } },
    },
  })
  const legacyConfig = config({ lockHour: 13 })
  delete legacyConfig.scheduleLoadPolicy
  const result = await api(db).saveScheduleConfig({ data: { config: legacyConfig, expectedRevision: 4, idempotencyKey: 'schedule-legacy-policy-1' } })
  assert.deepEqual(result.config.scheduleLoadPolicy.defaultDailyTargets, { full_time: 6, part_time: 5, collaborator: 3 })
})

test('load policy save is audited, replay-safe and rejects invalid configuration', async () => {
  const db = memoryDb({ 'branches/branch-a': { status: 'active' } })
  const policy = { schemaVersion: 1, defaultDailyTargets: { full_time: 4, part_time: 3, collaborator: 2 } }
  const input = { config: config({ scheduleLoadPolicy: policy }), expectedRevision: 0, idempotencyKey: 'schedule-load-policy-1' }
  const saved = await api(db).saveScheduleConfig({ data: input })
  assert.deepEqual(saved.config.scheduleLoadPolicy, policy)
  assert.equal((await api(db).saveScheduleConfig({ data: input })).unchanged, true)
  const audit = [...db.documents].find(([path]) => path.startsWith('auditLogs/'))[1]
  assert.equal(audit.loadPolicyChanged, true)
  assert.equal(audit.beforeLoadPolicy.defaultDailyTargets.full_time, 8)
  assert.deepEqual(audit.afterLoadPolicy, policy)
  for (const invalid of [null, { ...policy, schemaVersion: 2 }, { ...policy, defaultDailyTargets: { full_time: 13 } }, { ...policy, defaultDailyTargets: { ...policy.defaultDailyTargets, full_time: 0 } }]) {
    await assert.rejects(api(db).saveScheduleConfig({ data: { ...input, config: config({ scheduleLoadPolicy: invalid }), expectedRevision: 1, idempotencyKey: 'schedule-invalid-policy' } }), (cause) => cause.code === 'invalid-argument')
  }
  assert.equal(db.documents.get('settings/scheduleConfig').revision, 1)
})

test('receipts written before load policy rollout remain replayable', async () => {
  const idempotencyKey = 'schedule-pre-rollout-retry'
  const sha = (text) => createHash('sha256').update(text).digest('hex')
  const { scheduleLoadPolicy: _loadPolicy, ...legacyNormalized } = normalizeScheduleConfig(config())
  const receiptId = sha(`${actor.uid}\n${idempotencyKey}`).slice(0, 48)
  const db = memoryDb({ [`scheduleConfigCommandReceipts/${receiptId}`]: {
    operation: 'save', payloadHash: sha(JSON.stringify({ operation: 'save', expectedRevision: 0, config: legacyNormalized })),
    result: { revision: 1, config: legacyNormalized, unchanged: false },
  } })
  const result = await api(db).saveScheduleConfig({ data: { config: config(), expectedRevision: 0, idempotencyKey } })
  assert.equal(result.unchanged, true)
  assert.equal(result.revision, 1)
  assert.equal(db.documents.size, 1)
})

test('rejects stale revision and idempotency key reuse with a different policy', async () => {
  const db = memoryDb({ 'branches/branch-a': { status: 'active' } })
  const functions = api(db)
  await functions.saveScheduleConfig({ data: { config: config(), expectedRevision: 0, idempotencyKey: 'schedule-config-0001' } })
  await assert.rejects(functions.saveScheduleConfig({ data: { config: config({ lockHour: 13 }), expectedRevision: 0, idempotencyKey: 'schedule-config-0002' } }), /vừa được người khác cập nhật/)
  await assert.rejects(functions.saveScheduleConfig({ data: { config: config({ lockHour: 13 }), expectedRevision: 0, idempotencyKey: 'schedule-config-0001' } }), /được dùng cho nội dung khác/)
})

test('validates days, hours, holidays, capacities and active branches', async () => {
  const db = memoryDb({ 'branches/branch-a': { status: 'archived' } })
  const functions = api(db)
  await assert.rejects(functions.saveScheduleConfig({ data: { config: config({ workingDays: [] }), expectedRevision: 0, idempotencyKey: 'schedule-invalid-days' } }), /ít nhất một ngày/)
  await assert.rejects(functions.saveScheduleConfig({ data: { config: config({ workingHours: [24] }), expectedRevision: 0, idempotencyKey: 'schedule-invalid-hours' } }), /khung giờ/)
  await assert.rejects(functions.saveScheduleConfig({ data: { config: config({ holidays: ['bad-date'], holidayDetails: [] }), expectedRevision: 0, idempotencyKey: 'schedule-invalid-date' } }), /Ngày nghỉ lễ/)
  await assert.rejects(functions.saveScheduleConfig({ data: { config: config(), expectedRevision: 0, idempotencyKey: 'schedule-archived-branch' } }), /chi nhánh không còn hoạt động/)
})

test('requires canonical operations capability and contains no destructive mutation', async () => {
  const db = memoryDb()
  await assert.rejects(api(db, { ...actor, capabilities: [] }).saveScheduleConfig({ data: { config: config({ branchCapacityBySlot: {} }), expectedRevision: 0, idempotencyKey: 'schedule-no-capability' } }), /không có quyền/)
  const source = readFileSync(join(__dirname, 'schedule-config-management.js'), 'utf8')
  assert.doesNotMatch(source, /transaction\.delete|\.delete\(\)/)
  assert.match(source, /requireCapability\(actor, SCHEDULE_CONFIG_CAPABILITY\)/)
  assert.match(source, /scheduleConfigCommandReceipts/)
})
