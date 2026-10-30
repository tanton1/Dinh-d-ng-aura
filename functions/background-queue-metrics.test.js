'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { Timestamp } = require('firebase-admin/firestore')
const { withPrivateEventTelemetry } = require('./observability')
const { processStudent360Source, recoverStudent360Sources } = require('./student-360-source-queue')
const { rebuildDirtyPtScheduleWeeklyViews } = require('./pt-schedule-weekly-view')
const { pushDeliveryFixture } = require('./test-support/push-delivery-fixture')

function observe(name, handler) {
  const logs = []
  const logger = { info: (message, value) => logs.push({ message, value }), error: (message, value) => logs.push({ message, value }) }
  return { run: withPrivateEventTelemetry(name, handler, { logger, successSampleRate: 1 }), logs,
    metrics: () => logs.find(row => row.message === 'Aura function metric')?.value.metrics }
}
const logger = { info() {}, error() {} }
test('status-only queue delivery is measured as a zero-read guard with no identity in metrics', async () => {
  const db = new Proxy({}, { get: () => assert.fail('status-only event must not access the database') })
  const event = { id: 'PRIVATE_EVENT', params: { studentId: 'PRIVATE_STUDENT' }, data: {
    before: { exists: true, data: () => ({ generation: 1 }) }, after: { exists: true, data: () => ({ generation: 1 }) },
  } }
  const o = observe('processStudent360SourceQueue', event => processStudent360Source({ db, event, rebuild: () => assert.fail(), logger }))
  assert.deepEqual(await o.run(event), { skipped: true, reason: 'status_update' })
  assert.equal(o.metrics().guardSkips, 1); assert.equal(o.metrics().documentReadAttempts, 0)
  assert.doesNotMatch(JSON.stringify(o.logs), /PRIVATE_STUDENT|PRIVATE_EVENT/)
})
test('source worker counts only queue-control transactions and latest request wait, not projection internals', async () => {
  const h = pushDeliveryFixture(); const studentId = 'PRIVATE_STUDENT'
  h.documents.set(`systemJobs/student360SourceQueue/subjects/${studentId}`, {
    generation: 1, completedGeneration: 0, fullGeneration: 1, requestedAt: Timestamp.fromMillis(h.now() - 1250), dueAt: Timestamp.fromMillis(h.now()),
  })
  const event = { params: { studentId }, data: { before: { exists: false }, after: { exists: true, data: () => ({ generation: 1 }) } } }
  let rebuilds = 0
  const o = observe('processStudent360SourceQueue', event => processStudent360Source({ db: h.db, event, now: h.now, logger, rebuild: async () => { rebuilds++ } }))
  assert.equal((await o.run(event)).completed, true); assert.equal(rebuilds, 1)
  assert.equal(o.metrics().transactionAttempts, 2); assert.equal(o.metrics().documentReads, 2)
  assert.equal(o.metrics().transactionWritesCommitted, 2); assert.equal(o.metrics().queueWaitMs, 1250)
  assert.doesNotMatch(JSON.stringify(o.logs), /PRIVATE_STUDENT/)
})
test('empty recovery scans record one bounded query and no writes', async () => {
  let gets = 0
  const query = { where() { return this }, orderBy() { return this }, limit(value) { assert.equal(value, 25); return this }, async get() { gets++; return { docs: [], size: 0, empty: true } } }
  const o = observe('recoverStudent360SourceQueueScheduled', () => recoverStudent360Sources({ db: { collection: () => query }, logger, rebuild: () => assert.fail() }))
  assert.equal((await o.run({})).scanned, 0); assert.equal(gets, 1)
  assert.equal(o.metrics().logicalQueries, 1); assert.equal(o.metrics().documentsReturned, 0)
  assert.equal(o.metrics().guardSkips, 1); assert.equal(o.metrics().writesCompleted, 0)
})
test('empty weekly worker observes existing checkpoint and four projected queue reads only', async () => {
  let gets = 0
  const db = { doc: () => ({ get: async () => ({ exists: false, data: () => undefined }) }), collection: () => ({
    where() { return this }, orderBy() { return this }, select(...fields) { assert.deepEqual(fields, ['branchId', 'weekId']); return this },
    limit(value) { assert.equal(value, 20); return this }, async get() { gets++; return { docs: [], size: 0 } },
  }) }
  const o = observe('rebuildDirtyPtScheduleWeeklyViewsScheduled', () => rebuildDirtyPtScheduleWeeklyViews({ db, limit: 20, logger }))
  assert.deepEqual(await o.run({}), { scanned: 0, rebuilt: 0, failed: 0 })
  assert.equal(gets, 4); assert.equal(o.metrics().logicalQueries, 4); assert.equal(o.metrics().documentReads, 1)
  assert.equal(o.metrics().writeAttempts, 0); assert.equal(o.metrics().guardSkips, 1)
})
