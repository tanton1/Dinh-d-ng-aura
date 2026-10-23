'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { loadTrainerRosterUsage, studentContractProjection } = require('./pt-operations-v2')
const { summarizeContractUsage } = require('./contract-usage')
const { MAX_SESSION_EVIDENCE, viewFromSummary } = require('./contract-usage-view')

const TODAY = '2026-10-23'
const NOW = new Date('2026-10-23T14:00:00Z')
const contract = (id = 'contract', patch = {}) => ({
  id, studentId: `student-${id}`, status: 'active', branchId: 'branch-one',
  totalSessions: 36, usedSessions: 4, startDate: '2026-01-01', endDate: '2027-12-31',
  ...patch,
})
const evidence = (value) => [
  { id: 'charged', studentId: value.studentId, contractId: value.id, trainerId: 'trainer', date: '2026-09-01', hour: 8, scheduleEntryId: 'entry-one', status: 'completed', billingStatus: 'charged', attendanceStatus: 'present', branchId: 'all' },
  { id: 'mirror', studentId: value.studentId, contractId: value.id, trainerId: 'trainer', date: '2026-09-01', hour: 8, scheduleEntryId: 'entry-one', status: 'cancelled', billingStatus: 'exempt', branchId: 'branch-one' },
  { id: 'same-day', studentId: value.studentId, contractId: value.id, trainerId: 'trainer', date: '2026-09-01', hour: 10, status: 'completed', billingStatus: 'charged' },
  { id: 'no-show', studentId: value.studentId, contractId: value.id, trainerId: 'trainer', date: '2026-09-02', hour: 9, status: 'no_show', billingStatus: 'charged' },
  { id: 'legacy', studentId: value.studentId, contractId: value.id, trainerId: 'trainer', date: '2026-09-03', hour: 9, status: 'attended' },
  { id: 'cancelled', studentId: value.studentId, contractId: value.id, trainerId: 'trainer', date: '2026-09-04', hour: 9, status: 'cancelled', billingStatus: 'exempt' },
  { id: 'reserved', studentId: value.studentId, contractId: value.id, trainerId: 'trainer', date: '2026-10-26', hour: 9, status: 'scheduled', billingStatus: 'unbilled' },
]
const view = (value, rows = evidence(value)) => viewFromSummary(value.id, value, summarizeContractUsage(value, rows))

function memoryDb(views = {}, sessions = []) {
  const reads = []
  const snapshot = (path, data) => ({ id: path.split('/').at(-1), exists: Boolean(data), data: () => structuredClone(data) })
  const db = {
    reads,
    doc(path) { return { path } },
    async getAll(...references) {
      return references.map(({ path }) => {
        reads.push({ type: 'document', path })
        return snapshot(path, views[path.split('/').at(-1)])
      })
    },
    collection(name) {
      assert.equal(name, 'sessions')
      return {
        where(field, operator, value) {
          assert.equal(field, 'contractId')
          assert.equal(operator, '==')
          return {
            limit(maximum) {
              return {
                async get() {
                  reads.push({ type: 'evidence', contractId: value, maximum })
                  const docs = sessions.filter((row) => row.contractId === value).slice(0, maximum)
                    .map((row) => snapshot(`sessions/${row.id}`, row))
                  return { docs, size: docs.length, empty: !docs.length }
                },
              }
            },
          }
        },
      }
    },
  }
  return db
}

test('healthy canonical views replace full history scans with identical roster output', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW })
  const value = contract()
  const rows = evidence(value)
  const projection = view(value, rows)
  const db = memoryDb({ [value.id]: projection }, rows)
  const result = await loadTrainerRosterUsage(db, [value], TODAY)
  assert.deepEqual(result.get(value.id), studentContractProjection(value.id, value, TODAY, rows, true, projection))
  assert.equal(result.get(value.id).usedSessions, 4) // preserves audited legacy adjustment
  assert.equal(result.get(value.id).chargedSessions, 3) // mirror and same-day duplicates are not charged twice
  assert.equal(result.get(value.id).remainingSessions, 32)
  assert.deepEqual(db.reads, [{ type: 'document', path: 'contractUsageViews/contract' }])
})

test('mixed roster reads history only for missing summaries, bounded per contract', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW })
  const healthy = contract('healthy'), legacy = contract('legacy', { usedSessions: 1 })
  const rows = [...evidence(healthy), ...evidence(legacy)]
  const db = memoryDb({ healthy: view(healthy) }, rows)
  const result = await loadTrainerRosterUsage(db, [healthy, legacy], TODAY)
  assert.deepEqual(result.get('legacy'), studentContractProjection('legacy', legacy, TODAY, evidence(legacy), true))
  assert.equal(result.get('legacy').usedSessions, 3)
  assert.deepEqual(db.reads.filter((read) => read.type === 'evidence'), [{ type: 'evidence', contractId: 'legacy', maximum: MAX_SESSION_EVIDENCE + 1 }])
})

test('stale, inconsistent, wrong-owner, wrong-version and truncated summaries cannot suppress evidence fallback', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW })
  const value = contract()
  const patches = [
    { contractId: 'other-contract' },
    { studentId: 'other-student' },
    { schemaVersion: 2 },
    { sourceVersion: 'contract-usage-v2' },
    { evidenceTruncated: true },
    { generatedAt: '2026-09-01T00:00:00Z' },
    { entitlementSessions: 37 },
    { storedUsedSessions: 2 },
    { transferredSessions: 3 },
    { usedSessions: 'not-a-number' },
    { contractSourceFingerprint: 'different-source' },
  ]
  for (const patch of patches) {
    const db = memoryDb({ [value.id]: { ...view(value), ...patch } }, evidence(value))
    const result = await loadTrainerRosterUsage(db, [value], TODAY)
    assert.deepEqual(result.get(value.id), studentContractProjection(value.id, value, TODAY, evidence(value), true), JSON.stringify(patch))
    assert.equal(db.reads.filter((read) => read.type === 'evidence').length, 1, JSON.stringify(patch))
  }
})

test('successful unchanged reconciliation keeps an older business snapshot on the cheap path', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW })
  const value = contract()
  const projection = { ...view(value), generatedAt: '2026-09-01T00:00:00Z', reconciledAt: NOW.toISOString() }
  const db = memoryDb({ [value.id]: projection }, evidence(value))
  const result = await loadTrainerRosterUsage(db, [value], TODAY)
  assert.equal(result.get(value.id).remainingSessions, 32)
  assert.equal(db.reads.filter((read) => read.type === 'evidence').length, 0)
})

test('transferred entitlement stays deducted on both summary and full-evidence paths', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW })
  const value = contract('transferred', { totalSessions: 7, carryOverTransferredSessions: 3 })
  const rows = evidence(value)
  const withView = await loadTrainerRosterUsage(memoryDb({ transferred: view(value) }, rows), [value], TODAY)
  const fallback = await loadTrainerRosterUsage(memoryDb({}, rows), [value], TODAY)
  assert.equal(withView.get(value.id).remainingSessions, 0)
  assert.equal(withView.get(value.id).schedulableToday, false)
  assert.deepEqual(withView.get(value.id), fallback.get(value.id))
  const partial = studentContractProjection(value.id, value, TODAY, [], false)
  assert.equal(partial.remainingSessions, 0)
  assert.equal(partial.schedulableToday, false)
})

test('fallback never uses truncated evidence as a complete remaining-session count', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW })
  const value = contract()
  const rows = Array.from({ length: MAX_SESSION_EVIDENCE + 1 }, (_, index) => ({ id: `session-${index}`, contractId: value.id }))
  const db = memoryDb({}, rows)
  await assert.rejects(loadTrainerRosterUsage(db, [value], TODAY), (error) => error.code === 'resource-exhausted')
  assert.deepEqual(db.reads.filter((read) => read.type === 'evidence'), [{ type: 'evidence', contractId: value.id, maximum: MAX_SESSION_EVIDENCE + 1 }])
})

test('empty roster does no usage or session reads', async () => {
  const db = memoryDb()
  assert.equal((await loadTrainerRosterUsage(db, [], TODAY)).size, 0)
  assert.deepEqual(db.reads, [])
})
