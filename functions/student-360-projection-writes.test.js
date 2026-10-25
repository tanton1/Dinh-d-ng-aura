const test = require('node:test')
const assert = require('node:assert/strict')
const { Timestamp } = require('firebase-admin/firestore')
const { atOrBefore, sourceChanged, coalesceProjectionRebuild, upsertChangedTimeline, student360RetryError, student360FailureFields } = require('./student-360-projection-writes')
const { HttpsError } = require('firebase-functions/v2/https')

function memoryDb() {
  const data = new Map()
  const writes = []
  const db = {
    time: 1000, data, writes,
    doc: (path) => ({ path }),
    async runTransaction(work) {
      const pending = []
      const read = async (ref) => ({ exists: data.has(ref.path), data: () => data.get(ref.path), readTime: Timestamp.fromMillis(db.time) })
      const result = await work({
        get: read, getAll: (...refs) => Promise.all(refs.map(read)),
        set: (ref, value, options) => pending.push([ref.path, options?.merge ? { ...data.get(ref.path), ...value } : value]),
      })
      for (const [path, value] of pending) { data.set(path, value); writes.push(path) }
      return result
    },
  }
  return db
}
const eventAt = (ms) => ({ data: { after: { exists: true, updateTime: Timestamp.fromMillis(ms) } } })

test('timeline rebuild only writes missing or materially changed events', async () => {
  const db = memoryDb()
  const events = Array.from({ length: 205 }, (_, id) => ({ id: String(id), metadata: { amount: id }, title: 'Buổi tập' }))
  assert.equal((await upsertChangedTimeline(db, events)).changed, 205)
  db.writes.length = 0
  assert.equal((await upsertChangedTimeline(db, structuredClone(events))).changed, 0)
  assert.equal(db.writes.length, 0)
  events[70] = { ...events[70], metadata: { amount: 25 } }
  assert.equal((await upsertChangedTimeline(db, events)).changed, 1)
  assert.equal(db.data.size, 205)
})

test('same commit mirrors/retries coalesce but a later commit rebuilds', async () => {
  const db = memoryDb()
  let builds = 0
  const run = (event) => coalesceProjectionRebuild({ db, studentId: 'a', event, rebuild: async () => { builds++ } })
  await run(eventAt(999))
  assert.equal((await run(eventAt(999))).rebuilt, false)
  db.time = 1002
  await run(eventAt(1001))
  assert.equal(builds, 2)
  await coalesceProjectionRebuild({ db, studentId: 'b', event: eventAt(999), rebuild: async () => { builds++ } })
  assert.equal(builds, 3, 'never coalesce another learner')
})

test('busy work retries, failures do not advance coverage, and expired leases recover', async () => {
  const db = memoryDb()
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const first = coalesceProjectionRebuild({ db, studentId: 'a', event: eventAt(999), rebuild: () => gate, now: () => 1000 })
  await new Promise((resolve) => setImmediate(resolve))
  await assert.rejects(coalesceProjectionRebuild({ db, studentId: 'a', event: eventAt(999), rebuild: async () => {}, now: () => 1001 }), { code: 'unavailable' })
  release()
  await first
  db.time = 2000
  await assert.rejects(coalesceProjectionRebuild({ db, studentId: 'a', event: eventAt(1999), rebuild: async () => { throw new Error('dependency') }, now: () => 2000 }), /dependency/)
  assert.equal(db.data.get('systemJobs/student360Rebuild/subjects/a').coveredThrough.toMillis(), 1000)
  db.data.set('systemJobs/student360Rebuild/subjects/a', { leaseUntil: Timestamp.fromMillis(1) })
  assert.equal((await coalesceProjectionRebuild({ db, studentId: 'a', event: eventAt(1999), rebuild: async () => {}, now: () => 2000 })).rebuilt, true)
})

test('a write during source loading is not accidentally covered by completion time', async () => {
  const db = memoryDb()
  await coalesceProjectionRebuild({ db, studentId: 'a', event: eventAt(999), rebuild: async () => { db.time = 3000 } })
  assert.equal((await coalesceProjectionRebuild({ db, studentId: 'a', event: eventAt(2000), rebuild: async () => {} })).rebuilt, true)
  assert.equal((await coalesceProjectionRebuild({ db, studentId: 'a', event: { data: { after: { exists: false } } }, rebuild: async () => {} })).rebuilt, true, 'delete never skipped without commit version')
})

test('watermarks retain nanoseconds and no-op source snapshots are ignored', () => {
  assert.equal(atOrBefore(new Timestamp(2, 3), new Timestamp(2, 2)), false)
  assert.equal(atOrBefore(null, Timestamp.now()), false)
  const snap = { exists: true, data: () => ({ revision: 4 }) }
  assert.equal(sourceChanged({ data: { before: snap, after: snap } }), false)
  assert.equal(sourceChanged({ data: { before: snap, after: { exists: false } } }), true)
})

test('500 check-ins with eight same-commit mirrors require 500 rather than 4000 rebuilds', async () => {
  const db = memoryDb()
  let builds = 0
  for (let student = 0; student < 500; student++) {
    for (let mirror = 0; mirror < 8; mirror++) {
      await coalesceProjectionRebuild({ db, studentId: `student-${student}`, event: eventAt(999), rebuild: async () => { builds++ } })
    }
  }
  assert.equal(builds, 500)
  assert.equal(db.data.size, 500, 'bounded one watermark document per learner')
})

test('nutrition refresh shares the lease but cannot cover an unrelated full-source event', async () => {
  const db = memoryDb()
  await coalesceProjectionRebuild({ db, studentId: 'a', event: eventAt(999), rebuild: async () => {} })
  db.time = 3000
  const partial = () => coalesceProjectionRebuild({ db, studentId: 'a', event: eventAt(2000), scope: 'nutrition', rebuild: async () => {} })
  assert.equal((await partial()).rebuilt, true)
  const state = db.data.get('systemJobs/student360Rebuild/subjects/a')
  assert.equal(state.coveredThrough.toMillis(), 1000)
  assert.equal(state.nutritionCoveredThrough.toMillis(), 3000)
  assert.equal((await partial()).rebuilt, false)
  assert.equal((await coalesceProjectionRebuild({ db, studentId: 'a', event: eventAt(2500), rebuild: async () => {} })).rebuilt, true)
})

test('an in-flight nutrition refresh blocks full rebuilds through the same lease', async () => {
  const db = memoryDb()
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const partial = coalesceProjectionRebuild({ db, studentId: 'a', event: eventAt(999), scope: 'nutrition', rebuild: () => gate })
  await new Promise((resolve) => setImmediate(resolve))
  await assert.rejects(coalesceProjectionRebuild({ db, studentId: 'a', event: eventAt(999), rebuild: async () => {} }), { code: 'unavailable' })
  release()
  await partial
  assert.equal(db.data.get('systemJobs/student360Rebuild/subjects/a').coveredThrough, undefined)
})

test('progress, nutrition and full rebuilds retain independent coverage under one lease', async () => {
  const db = memoryDb()
  const run = (scope, ms) => coalesceProjectionRebuild({ db, studentId: 'a', event: eventAt(ms), scope, rebuild: async () => {} })
  await run('full', 999)
  db.time = 3000
  assert.equal((await run('progress', 2000)).rebuilt, true)
  assert.equal((await run('progress', 2000)).rebuilt, false)
  let state = db.data.get('systemJobs/student360Rebuild/subjects/a')
  assert.equal(state.coveredThrough.toMillis(), 1000)
  assert.equal(state.progressCoveredThrough.toMillis(), 3000)
  assert.equal(state.nutritionCoveredThrough, undefined)
  assert.equal((await run('nutrition', 2500)).rebuilt, true)
  db.time = 4000
  assert.equal((await run('full', 2500)).rebuilt, true)
  assert.equal((await run('progress', 3500)).rebuilt, false, 'full coverage includes progress')
  assert.equal((await run('nutrition', 3500)).rebuilt, false, 'full coverage includes nutrition')
  state = db.data.get('systemJobs/student360Rebuild/subjects/a')
  assert.equal(state.coveredThrough.toMillis(), 4000)
  await assert.rejects(run('unrecognized-domain', 4500), { code: 'invalid-argument' })
  assert.equal(state, db.data.get('systemJobs/student360Rebuild/subjects/a'), 'invalid scope does no database work')
})

function usageEvent(before, after, collection = 'contractUsageViews') {
  const snapshot = (data) => ({ exists: data !== null, data: () => data, ref: { parent: { id: collection } } })
  return { params: { contractId: 'contract-a' }, data: { before: snapshot(before), after: snapshot(after) } }
}

test('usage projection timestamps are ignored but every business/schema field remains significant', () => {
  const before = { studentId: 's1', branchId: 'b1', usedSessions: 2, remainingSessions: 8, schemaVersion: 1, generatedAt: Timestamp.fromMillis(1) }
  const after = { ...before, generatedAt: Timestamp.fromMillis(2) }
  assert.equal(sourceChanged(usageEvent(before, after)), false)
  assert.equal(sourceChanged(usageEvent(before, { ...after, reconciledAt: Timestamp.fromMillis(3), contractSourceFingerprint: 'receipt-v2', lastSessionSourceFingerprint: 'session-v2', reconciliationProjectionFingerprint: 'business-v2' })), false)
  for (const patch of [{ studentId: 's2' }, { branchId: 'b2' }, { usedSessions: 3 }, { remainingSessions: 7 }, { schemaVersion: 2 }, { status: 'expired' }, { sourceFingerprint: 'changed' }, { newFutureField: { value: true } }]) {
    assert.equal(sourceChanged(usageEvent(before, { ...after, ...patch })), true, JSON.stringify(patch))
  }
  assert.equal(sourceChanged(usageEvent(null, after)), true)
  assert.equal(sourceChanged(usageEvent(before, null)), true)
  for (const collection of ['contracts', 'students', 'sessions', 'unknown']) {
    assert.equal(sourceChanged(usageEvent(before, after, collection)), true, 'do not drop timestamps from other source types')
  }
})

test('timestamp-only usage refresh invokes all three projection consumers with zero database access', async () => {
  const { syncStudent360ProjectionFromEvent } = require('./student-360')
  const { syncOperationalActionSource } = require('./action-center')
  const { syncPtScheduleWeeklyViewSource } = require('./pt-schedule-weekly-view')
  const db = new Proxy({}, { get: () => { throw new Error('Unexpected database access') } })
  const before = { studentId: 's1', branchId: 'b1', usedSessions: 2, generatedAt: Timestamp.fromMillis(1) }
  const event = usageEvent(before, { ...before, generatedAt: Timestamp.fromMillis(2), reconciledAt: Timestamp.fromMillis(3), contractSourceFingerprint: 'receipt-v2', lastSessionSourceFingerprint: 'session-v2', reconciliationProjectionFingerprint: 'business-v2' })
  assert.deepEqual(await syncStudent360ProjectionFromEvent({ db, event }), { skipped: true, reason: 'source_unchanged' })
  assert.equal((await syncOperationalActionSource({ db, event })).skipped, 'projection_timestamps_only')
  assert.deepEqual(await syncPtScheduleWeeklyViewSource({ db, event, source: 'contractUsage' }), { source: 'contractUsage', marked: 0, skipped: 'projection_timestamps_only' })
})

test('verification receipt fields remain meaningful outside usage projections', () => {
  for (const collection of ['contracts', 'students', 'sessions', 'unknown']) {
    for (const field of ['reconciledAt', 'contractSourceFingerprint', 'lastSessionSourceFingerprint', 'reconciliationProjectionFingerprint']) {
      assert.equal(sourceChanged(usageEvent({ [field]: 'before' }, { [field]: 'after' }, collection)), true, `${collection}.${field}`)
    }
  }
})

test('usage business changes and deletes still reach database reconciliation in all three consumers', async () => {
  const { syncStudent360ProjectionFromEvent } = require('./student-360')
  const { syncOperationalActionSource } = require('./action-center')
  const { syncPtScheduleWeeklyViewSource } = require('./pt-schedule-weekly-view')
  const db = new Proxy({}, { get: () => { throw new Error('Reconciliation reached database') } })
  const logger = { info() {}, error() {} }
  const before = { studentId: 's1', branchId: 'b1', usedSessions: 2, generatedAt: Timestamp.fromMillis(1) }
  for (const event of [usageEvent(before, { ...before, usedSessions: 3 }), usageEvent(before, null), usageEvent(null, before)]) {
    await assert.rejects(syncStudent360ProjectionFromEvent({ db, event, logger }), /Reconciliation reached database/)
    await assert.rejects(syncOperationalActionSource({ db, event, logger }), /Reconciliation reached database/)
    await assert.rejects(syncPtScheduleWeeklyViewSource({ db, event, source: 'contractUsage', logger }), /Reconciliation reached database/)
  }
})

test('failure classifications remain server-local and preserve callable error envelopes', () => {
  for (const reason of ['lease_busy', 'lease_replaced_during_write', 'lease_expired_during_write', 'lease_replaced_before_completion', 'progress_authority_changed']) {
    const error = student360RetryError(reason)
    assert.equal(error.code, 'unavailable')
    assert.deepEqual(error.toJSON(), new HttpsError('unavailable', error.message).toJSON())
    assert.equal(JSON.stringify(error).includes('failureReason'), false)
    assert.equal(student360FailureFields(error).failureReason, reason)
    student360FailureFields(error).failureReason = 'modified-by-consumer'
    assert.equal(student360FailureFields(error).failureReason, reason)
  }
  assert.throws(() => student360RetryError('arbitrary user content'), /Unknown Student 360 retry classification/)
})

test('untagged unavailable and transport errors remain unclassified without logging their payloads', () => {
  for (const error of [null, 'private payload', new HttpsError('unavailable', 'private account data'),
    Object.assign(new Error('private account data'), { code: 14, failureReason: 'lease_busy', details: 'secret' })]) {
    assert.deepEqual(student360FailureFields(error), { failureReason: 'unclassified', failurePhase: 'unknown' })
  }
})

test('event logging identifies contention with one lease read, no writes and a rejected event', async () => {
  const { syncStudent360ProjectionFromEvent } = require('./student-360')
  const db = memoryDb(), logs = []
  let transactionCalls = 0
  const transaction = db.runTransaction.bind(db)
  db.runTransaction = work => { transactionCalls++; return transaction(work) }
  db.data.set('systemJobs/student360Rebuild/subjects/s1', { token: 'another-owner', leaseUntil: Timestamp.fromMillis(Date.now() + 180_000) })
  const event = usageEvent({ studentId: 's1', usedSessions: 1 }, { studentId: 's1', usedSessions: 2 })
  await assert.rejects(syncStudent360ProjectionFromEvent({ db, event, logger: { info() { throw Error('failed event must not log success') }, error: (...args) => logs.push(args) } }), error => {
    assert.equal(error.code, 'unavailable')
    assert.equal(student360FailureFields(error).failureReason, 'lease_busy')
    return true
  })
  assert.equal(transactionCalls, 1)
  assert.deepEqual(db.writes, [])
  assert.deepEqual(logs, [['student_360_projection_sync_failed', { studentId: 's1', code: 'unavailable', projectionScope: 'full', failureReason: 'lease_busy', failurePhase: 'lease_acquire' }]])
})

test('event logging preserves unknown dependency errors and never labels them as lease contention', async () => {
  const { syncStudent360ProjectionFromEvent } = require('./student-360')
  const error = Object.assign(new Error('private transport diagnostics'), { code: 14 }), logs = []
  const db = { doc: path => ({ path }), runTransaction: async () => { throw error } }
  const event = usageEvent({ studentId: 's1', usedSessions: 1 }, { studentId: 's1', usedSessions: 2 })
  await assert.rejects(syncStudent360ProjectionFromEvent({ db, event, logger: { info() {}, error: (...args) => logs.push(args) } }), received => received === error)
  assert.equal(logs.length, 1)
  assert.deepEqual(logs[0][1], { studentId: 's1', code: 14, projectionScope: 'full', failureReason: 'unclassified', failurePhase: 'unknown' })
  assert.equal(JSON.stringify(logs).includes('private transport diagnostics'), false)
})

test('expired and replaced write leases stay fenced and do not advance coverage', async t => {
  for (const replaced of [false, true]) {
    await t.test(replaced ? 'replaced' : 'expired', async () => {
      const db = memoryDb()
      await assert.rejects(coalesceProjectionRebuild({ db, studentId: 'a', event: eventAt(999), now: () => 1000,
        rebuild: async lease => {
          const key = 'systemJobs/student360Rebuild/subjects/a'
          db.data.set(key, { ...db.data.get(key), ...(replaced ? { token: 'new-owner' } : { leaseUntil: Timestamp.fromMillis(999) }) })
          await lease.runTransaction(async transaction => transaction.set(db.doc('studentOperationalViews/a'), { forbidden: true }))
        },
      }), error => {
        assert.equal(error.code, 'unavailable')
        assert.deepEqual(student360FailureFields(error), { failureReason: replaced ? 'lease_replaced_during_write' : 'lease_expired_during_write', failurePhase: 'projection_write' })
        return true
      })
      assert.equal(db.data.has('studentOperationalViews/a'), false)
      assert.equal(db.data.get('systemJobs/student360Rebuild/subjects/a').coveredThrough, undefined)
      if (replaced) assert.equal(db.data.get('systemJobs/student360Rebuild/subjects/a').token, 'new-owner')
    })
  }
})

test('a replaced completion lease retains the successor and a failed dependency retains its identity', async () => {
  const db = memoryDb()
  await assert.rejects(coalesceProjectionRebuild({ db, studentId: 'a', event: eventAt(999), rebuild: async () => {
    db.data.set('systemJobs/student360Rebuild/subjects/a', { token: 'new-owner', leaseUntil: Timestamp.fromMillis(Date.now() + 180_000) })
  } }), error => {
    assert.deepEqual(student360FailureFields(error), { failureReason: 'lease_replaced_before_completion', failurePhase: 'lease_complete' })
    return true
  })
  assert.equal(db.data.get('systemJobs/student360Rebuild/subjects/a').token, 'new-owner')
  const dependency = new Error('dependency failed')
  await assert.rejects(coalesceProjectionRebuild({ db, studentId: 'b', event: eventAt(999), rebuild: async () => { throw dependency } }), error => error === dependency)
  assert.equal(db.data.get('systemJobs/student360Rebuild/subjects/b').coveredThrough, undefined)
  assert.deepEqual(student360FailureFields(dependency), { failureReason: 'unclassified', failurePhase: 'unknown' })
})
