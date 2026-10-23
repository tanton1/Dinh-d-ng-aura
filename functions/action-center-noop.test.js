'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { studentProjectionActionSourceChanged, syncOperationalActionSource } = require('./action-center')

const original = { studentId: 's1', generatedAt: 'old', generatedAtMillis: 1, assignments: { branchId: 'b1', trainerIds: ['t1'] }, alerts: [], health: { status: 'good' } }
function snapshot(value) { return { exists: value !== null, data: () => value, ref: { parent: { id: 'studentOperationalViews' } } } }

test('timestamp-only Student 360 rebuilds perform zero downstream database operations', async () => {
  const current = { ...original, generatedAt: 'new', generatedAtMillis: 2 }
  const result = await syncOperationalActionSource({
    db: new Proxy({}, { get() { throw new Error('Unexpected database access') } }),
    event: { params: { studentId: 's1' }, data: { before: snapshot(original), after: snapshot(current) } },
  })
  assert.equal(result.skipped, 'projection_timestamps_only')
  assert.equal(result.actions, 0)
})

test('creation, deletion and all semantic fields still reconcile including alert removal and branch scope', () => {
  for (const value of [
    null,
    { ...original, alerts: [{ severity: 'red', title: 'Attention' }] },
    { ...original, assignments: { branchId: 'b2', trainerIds: ['t1'] } },
    { ...original, assignments: { branchId: 'b1', trainerIds: ['t2'] } },
    { ...original, health: { status: 'action_required' } },
    { ...original, contract: { endDate: '2026-10-23' } },
    { ...original, schemaVersion: 2 },
  ]) {
    assert.equal(studentProjectionActionSourceChanged(original, value), true)
    assert.equal(studentProjectionActionSourceChanged(value, original), true)
  }
})

test('changed events never take the no-op path before normal reconciliation', async () => {
  const db = new Proxy({}, { get() { throw new Error('Database reached for a real change') } })
  await assert.rejects(() => syncOperationalActionSource({ db, event: {
    params: { studentId: 's1' },
    data: { before: snapshot(original), after: snapshot({ ...original, health: { status: 'action_required' } }) },
  } }), /Database reached/)
})
