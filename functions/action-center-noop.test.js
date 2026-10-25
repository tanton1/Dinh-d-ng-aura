'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { studentProjectionActionSourceChanged, sessionActionSourceChanged, syncOperationalActionSource } = require('./action-center')

const original = { studentId: 's1', generatedAt: 'old', generatedAtMillis: 1, assignments: { branchId: 'b1', trainerIds: ['t1'] }, alerts: [], health: { status: 'good' } }
function snapshot(value, collection = 'studentOperationalViews') { return { exists: value !== null, data: () => value, ref: { parent: { id: collection } } } }

test('note and metadata changes to a session perform zero Action Center reads or writes', async () => {
  const original = { studentId: 's1', date: '2026-10-25', hour: 8, status: 'completed', attendanceStatus: 'present', trainerId: 't1', branchId: 'b1' }
  const changed = { ...original, note: 'Private session note', updatedAt: 12, updatedBy: 'staff', revision: 9 }
  const result = await syncOperationalActionSource({
    db: new Proxy({}, { get() { throw new Error('Unexpected database access') } }),
    event: { params: { sessionId: 'session' }, data: { before: snapshot(original, 'sessions'), after: snapshot(changed, 'sessions') } },
  })
  assert.equal(result.skipped, 'session_fields_unchanged')
  assert.equal(result.actions, 0)
  for (const field of ['studentId', 'branchId', 'trainerId', 'date', 'startAt', 'scheduledAt', 'hour', 'status', 'attendanceStatus', 'userId', 'accountUid']) {
    assert.equal(sessionActionSourceChanged(original, { ...original, [field]: 'changed' }), true, field)
  }
  assert.equal(sessionActionSourceChanged(null, original), true)
  assert.equal(sessionActionSourceChanged(original, null), true)
})

test('moving a session reconciles no-show alerts for both students without touching unrelated alerts', async () => {
  const queries = []
  const writes = []
  const db = { collection(collection) {
    let subject
    const query = {
      where(_field, _operator, value) { subject = value; return query },
      orderBy() { return query }, limit() { return query },
      async get() {
        queries.push([collection, subject])
        return { docs: collection === 'sessions' ? [] : [
          { id: `no-show-${subject}`, data: () => ({ sourceType: 'student', actionType: 'three_no_shows', status: 'open' }), ref: { set: async value => writes.push([subject, value]) } },
          { id: `health-${subject}`, data: () => ({ sourceType: 'student', actionType: 'health_alert', status: 'open' }), ref: { set: async () => { throw new Error('unrelated alert changed') } } },
        ] }
      },
    }
    return query
  } }
  await syncOperationalActionSource({ db, event: { params: { sessionId: 'session' }, data: {
    before: snapshot({ studentId: 'old', status: 'no_show' }, 'sessions'), after: snapshot({ studentId: 'new', status: 'no_show' }, 'sessions'),
  } } })
  assert.deepEqual(queries, [['sessions', 'old'], ['operationalActions', 'old'], ['sessions', 'new'], ['operationalActions', 'new']])
  assert.deepEqual(writes.map(([subject, value]) => [subject, value.status]), [['old', 'resolved'], ['new', 'resolved']])
})

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
