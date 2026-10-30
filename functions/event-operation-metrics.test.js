'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { Timestamp } = require('firebase-admin/firestore')
const { withPrivateEventTelemetry, telemetrySampleRate } = require('./observability')
const { withOperationMetrics, recordOperationMetrics } = require('./operation-metrics')
const { observeEventRead, observeEventWrite, recordEventMetrics } = require('./event-operation-metrics')
const { syncStaffManagedClientSummary, refreshStaffManagedClientSummary } = require('./staff-managed-summary')
const { syncOperationalActionSource, upsertOperationalAction } = require('./action-center')

function observed(operation, handler, options = {}) {
  const logs = []
  const logger = Object.fromEntries(['info', 'error'].map(level => [level, (message, value) => logs.push({ level, message, value })]))
  return { logs, run: withPrivateEventTelemetry(operation, handler, { successSampleRate: 1, logger, ...options }), metric: () => logs.find(row => row.message === 'Aura function metric')?.value }
}
const snap = (collection, value) => ({ exists: value !== undefined, ref: { parent: { id: collection } }, data: () => value })
const event = (collection, before, after) => ({ id: 'PRIVATE_EVENT', params: { sourceId: 'PRIVATE_STUDENT' }, data: { before: snap(collection, before), after: snap(collection, after) } })
const forbiddenDb = new Proxy({}, { get() { assert.fail('Guard must not access Firestore') } })

test('event telemetry preserves frozen payload/result identity, omits identifiers and uses unknown auth', async () => {
  const result = { privateValue: 'PRIVATE_RESPONSE' }, input = Object.freeze({ id: 'PRIVATE_EVENT', auth: { uid: 'PRIVATE_USER' }, app: { appId: 'PRIVATE_APP' }, data: { studentId: 'PRIVATE_SOURCE' } })
  const sample = observed('syncStaffOperationalSummary', async received => {
    assert.equal(received, input); recordEventMetrics({ staffRefreshes: 2, eventId: 'PRIVATE_EVENT' }); return result
  })
  assert.equal(await sample.run(input), result)
  assert.equal(sample.metric().invocationType, 'event')
  assert.equal(sample.metric().authenticated, null); assert.equal(sample.metric().appVerified, null)
  assert.equal(sample.metric().metrics.staffRefreshes, 2)
  assert.doesNotMatch(JSON.stringify(sample.logs), /PRIVATE_|actorUid|sourceId|correlationId|eventId/)
  assert.equal(telemetrySampleRate(undefined), .1)
})

test('successful sampling may omit metrics but errors are always logged without retry or changing identity', async () => {
  const success = observed('syncSessionOperationalActions', async () => 1, { successSampleRate: 0 })
  assert.equal(await success.run({}), 1); assert.equal(success.logs.length, 0)
  const failure = Object.assign(Error('PRIVATE_PAYLOAD'), { code: 'PRIVATE_ERROR_CODE' }); let calls = 0
  const sample = observed('syncSessionOperationalActions', async () => { calls++; throw failure }, { successSampleRate: 0 })
  await assert.rejects(sample.run({ id: 'PRIVATE_EVENT' }), error => error === failure)
  assert.equal(calls, 1); assert.equal(sample.metric().sampleRate, 1); assert.equal(sample.metric().failureCode, 'internal')
  assert.equal(sample.metric().authenticated, null)
  assert.doesNotMatch(JSON.stringify(sample.logs), /PRIVATE_/)
})

test('logging failures and never-resolving transports cannot alter or delay business completion', async () => {
  const value = {}, failure = Error('business failure')
  for (const sink of [() => { throw Error('sink failure') }, () => Promise.reject(Error('sink failure')), () => new Promise(() => {})]) {
    const logger = { info: sink, error: sink }
    assert.equal(await withPrivateEventTelemetry('syncStaffOperationalSummary', async () => value, { logger, successSampleRate: 1 })({}), value)
    await assert.rejects(withPrivateEventTelemetry('syncStaffOperationalSummary', async () => { throw failure }, { logger })({}), error => error === failure)
  }
  await new Promise(resolve => setImmediate(resolve))
})

test('concurrent event and callable metric contexts stay isolated and event observers are opt-in', async () => {
  let release; const waiting = new Promise(resolve => { release = resolve })
  const a = observed('syncStaffOperationalSummary', async () => { recordEventMetrics({ staffRefreshes: 1 }); await waiting; recordEventMetrics({ staffRefreshes: 2 }) })
  const b = observed('syncStudent360OperationalActions', async () => { recordEventMetrics({ guardSkips: 1 }); release() })
  await Promise.all([a.run({}), b.run({}), withOperationMetrics(async metrics => {
    recordEventMetrics({ staffRefreshes: 99 }); await observeEventRead('query', async () => ({ size: 20 })); recordOperationMetrics({ cacheHit: true })
    assert.deepEqual(metrics, { cacheHits: 1 })
  })])
  assert.equal(a.metric().metrics.staffRefreshes, 3); assert.equal(a.metric().metrics.guardSkips, 0)
  assert.equal(b.metric().metrics.staffRefreshes, 0); assert.equal(b.metric().metrics.guardSkips, 1)
})

test('all three actual source guards skip before reads and retain existing returns', async () => {
  const cases = [
    ['syncStaffOperationalSummary', 'contracts', { status: 'active', trainerId: 'PRIVATE_STAFF', usedSessions: 1 }, { status: 'active', trainerId: 'PRIVATE_STAFF', usedSessions: 2 }, (input) => syncStaffManagedClientSummary({ db: forbiddenDb, event: input }), { refreshed: 0 }],
    ['syncSessionOperationalActions', 'sessions', { studentId: 'PRIVATE_STUDENT', note: 'old' }, { studentId: 'PRIVATE_STUDENT', note: 'new' }, (input) => syncOperationalActionSource({ db: forbiddenDb, event: input }), { collection: 'sessions', sourceId: 'PRIVATE_STUDENT', actions: 0, skipped: 'session_fields_unchanged' }],
    ['syncStudent360OperationalActions', 'studentOperationalViews', { generatedAtMillis: 1, health: {} }, { generatedAtMillis: 2, health: {} }, (input) => syncOperationalActionSource({ db: forbiddenDb, event: input }), { collection: 'studentOperationalViews', sourceId: 'PRIVATE_STUDENT', actions: 0, skipped: 'projection_timestamps_only' }],
  ]
  for (const [name, collection, before, after, handler, expected] of cases) {
    const sample = observed(name, handler)
    assert.deepEqual(await sample.run(event(collection, before, after)), expected)
    const metrics = sample.metric().metrics
    assert.equal(metrics.guardSkips, 1); assert.equal(metrics.queryAttempts, 0); assert.equal(metrics.documentReadAttempts, 0)
    assert.equal(metrics.writesCompleted, 0); assert.equal(metrics.transactionWritesCommitted, 0)
  }
})

test('executed operations count successful reads, attempted failures and writes once', async () => {
  const error = Error('read failed'), expected = { exists: true }, sample = observed('syncSessionOperationalActions', async () => {
    assert.equal(await observeEventRead('document', async () => expected), expected)
    await observeEventRead('query', async () => ({ size: 3 }))
    await observeEventWrite(async () => 'written')
    await observeEventRead('query', async () => { throw error })
  })
  await assert.rejects(sample.run({}), value => value === error)
  assert.equal(sample.metric().metrics.queryAttempts, 2); assert.equal(sample.metric().metrics.logicalQueries, 1)
  assert.equal(sample.metric().metrics.documentReads, 1); assert.equal(sample.metric().metrics.documentsReturned, 4)
  assert.equal(sample.metric().metrics.writeAttempts, 1); assert.equal(sample.metric().metrics.writesCompleted, 1)
})

test('session reassignment keeps both subjects and observes each cleanup query without unnecessary enrichment', async () => {
  const subjects = [], reads = []
  const db = { doc: () => assert.fail('No alert means no enrichment'), collection(name) {
    const query = { where(field, _op, value) { if (name === 'sessions') subjects.push(value); return query }, orderBy: () => query, limit: () => query, get: async () => { reads.push(name); return { docs: [], size: 0 } } }; return query
  } }
  const sample = observed('syncSessionOperationalActions', input => syncOperationalActionSource({ db, event: input }))
  const result = await sample.run(event('sessions', { studentId: 'old' }, { studentId: 'new' }))
  assert.equal(result.actions, 0); assert.deepEqual(subjects, ['old', 'new'])
  assert.deepEqual(reads, ['sessions', 'operationalActions', 'sessions', 'operationalActions'])
  assert.equal(sample.metric().metrics.logicalQueries, 4); assert.equal(sample.metric().metrics.writesCompleted, 0)
})

test('health projection cleanup and idempotent action refresh report real writes versus no-ops', async () => {
  let writes = 0, stored
  const db = { doc: () => ({ get: async () => ({ exists: Boolean(stored), data: () => stored }), set: async value => { stored = value; writes++ } }) }
  const input = { sourceType: 'student', sourceId: 'PRIVATE_STUDENT', actionType: 'health_alert', title: 'alert' }
  const sample = observed('syncStudent360OperationalActions', async () => {
    await upsertOperationalAction({ db, input, logger: {} }); await upsertOperationalAction({ db, input, logger: {} })
  })
  await sample.run({})
  assert.equal(writes, 1); assert.equal(sample.metric().metrics.documentReads, 2)
  assert.equal(sample.metric().metrics.writesCompleted, 1); assert.equal(sample.metric().metrics.writeNoops, 1)
  const closed = observed('syncStudent360OperationalActions', e => syncOperationalActionSource({ event: e, db: {
    collection: () => { const q = { where: () => q, limit: () => q, get: async () => ({ size: 1, docs: [{ id: 'student:PRIVATE_STUDENT:health_alert', data: () => ({ sourceType: 'student', actionType: 'health_alert', status: 'open' }), ref: { set: async () => { writes++ } } }] }) }; return q },
  } }))
  await closed.run(event('studentOperationalViews', { health: { status: 'action_required' } }, undefined))
  assert.equal(closed.metric().metrics.logicalQueries, 1); assert.equal(closed.metric().metrics.writesCompleted, 1)
})

function staffDb({ attempts = 1, failCommit = false, current, error = Error('transaction rejected') } = {}) {
  const readTime = Timestamp.fromMillis(10000), counts = { main: 0, secondary: 0, nutrition: 0 }
  const summary = { path: 'summary' }; let queued = 0
  const snapshot = { docs: [], size: 0, readTime }
  const db = { collection: () => { const q = { where: () => q, orderBy: () => q, select: () => q, limit: () => q, get: async () => snapshot }; return q }, doc: () => summary,
    runTransaction: async (callback, options) => {
      if (options?.readOnly) return callback({ get: async () => snapshot })
      let result
      for (let i = 0; i < attempts; i++) result = await callback({ get: async () => ({ exists: Boolean(current), data: () => current }), set: () => { queued++ } })
      if (failCommit) throw error
      return result
    } }
  return { db, counts, readTime, queued: () => queued, error }
}

test('staff transaction retries count attempts separately and preserve committed watermark semantics', async () => {
  const fixture = staffDb({ attempts: 2 })
  const sample = observed('syncStaffOperationalSummary', async () => refreshStaffManagedClientSummary(fixture.db, 'PRIVATE_STAFF'))
  assert.deepEqual(await sample.run({}), { main: 0, secondary: 0, nutrition: 0, stale: false, truncated: false })
  const m = sample.metric().metrics
  assert.equal(m.logicalQueries, 6); assert.equal(m.documentReadAttempts, 2); assert.equal(m.transactionAttempts, 2)
  assert.equal(m.transactionWriteAttempts, 2); assert.equal(m.transactionWritesCommitted, 1); assert.equal(fixture.queued(), 2)
  const fresh = staffDb({ current: { schemaVersion: 2, refreshVersion: 1, sourceReadTime: fixture.readTime, generatedAt: Timestamp.now(), truncated: false, managedClientCounts: fixture.counts, nextReconcileAt: Timestamp.now() } })
  const noop = observed('syncStaffOperationalSummary', () => refreshStaffManagedClientSummary(fresh.db, 'PRIVATE_STAFF'))
  await noop.run({}); assert.equal(noop.metric().metrics.transactionWritesCommitted, 0); assert.equal(noop.metric().metrics.writeNoops, 1)
})

test('failed transaction never reports queued writes as committed; refresh progress counts only completed staff', async () => {
  const fixture = staffDb({ attempts: 2, failCommit: true })
  const sample = observed('syncStaffOperationalSummary', () => refreshStaffManagedClientSummary(fixture.db, 'PRIVATE_STAFF'))
  await assert.rejects(sample.run({}), error => error === fixture.error)
  assert.equal(sample.metric().metrics.transactionWriteAttempts, 2); assert.equal(sample.metric().metrics.transactionWritesCommitted, 0)
  const done = [], stopped = Error('refresh failed')
  const partial = observed('syncStaffOperationalSummary', e => syncStaffManagedClientSummary({ event: e, refresh: async (_db, uid) => { if (uid === 'second') throw stopped; done.push(uid) } }))
  await assert.rejects(partial.run(event('contracts', { status: 'active', trainerIds: ['first', 'second'] }, undefined)), error => error === stopped)
  assert.deepEqual(done, ['first']); assert.equal(partial.metric().metrics.staffRefreshes, 1)
})

test('real SDK registration opts in exactly three exports and their actual guard handlers require no database access', () => {
  const source = String.raw`
    const Module = require('node:module');
    const blocked = () => { throw Error('Network forbidden during event registration test'); };
    for (const name of ['node:http', 'node:https']) { const api = require(name); api.request = blocked; api.get = blocked; }
    require('node:net').Socket.prototype.connect = blocked;
    require('node:tls').connect = blocked; require('node:dns').lookup = blocked; global.fetch = blocked;
    const original = Module._load, registered = [], logs = [];
    const logger = { info: (message, value) => logs.push({ message, value }), error: (message, value) => logs.push({ message, value }) };
    Module._load = function(name) {
      const actual = original.apply(this, arguments);
      if (name === 'firebase-admin/firestore') return { ...actual, getFirestore: () => new Proxy({}, { get() { throw Error('Guard accessed Firestore'); } }) };
      if (name === './observability') return { ...actual, withPrivateEventTelemetry: (name, handler, options) => {
        registered.push(name); return actual.withPrivateEventTelemetry(name, handler, { ...options, logger, successSampleRate: 1 });
      } };
      return actual;
    };
    const snap = (collection, data) => ({ exists: true, ref: { parent: { id: collection } }, data: () => data });
    const input = (collection, before, after) => Object.freeze({ id: 'PRIVATE_EVENT', params: { sourceId: 'PRIVATE_SOURCE' }, data: { before: snap(collection, before), after: snap(collection, after) } });
    (async () => {
      const entry = require('./index.js');
      const results = [];
      results.push(await entry.syncStaffOperationalSummary.run(input('contracts', { usedSessions: 1 }, { usedSessions: 2 })));
      results.push(await entry.syncSessionOperationalActions.run(input('sessions', { note: 'before' }, { note: 'after' })));
      results.push(await entry.syncStudent360OperationalActions.run(input('studentOperationalViews', { generatedAtMillis: 1 }, { generatedAtMillis: 2 })));
      console.log('EVENT_REGISTRATION:' + JSON.stringify({ count: Object.keys(entry).length, registered, results, logs }));
    })().catch(() => { process.exitCode = 1; });
  `
  const env = { ...process.env }
  for (const key of ['FUNCTION_TARGET', 'FUNCTIONS_CONTROL_API', 'AURA_FIREBASE_DISCOVERY_SCOPE', 'NODE_ENV', 'FIRESTORE_DATABASE_ID',
    'ENFORCE_APP_CHECK', 'ENFORCE_AI_APP_CHECK', 'FIREBASE_DATABASE_URL', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_OAUTH_ACCESS_TOKEN', 'FIREBASE_TOKEN']) delete env[key]
  Object.assign(env, { GCLOUD_PROJECT: 'demo-aura-event-metrics', GOOGLE_CLOUD_PROJECT: 'demo-aura-event-metrics',
    FIREBASE_CONFIG: JSON.stringify({ projectId: 'demo-aura-event-metrics' }), FIRESTORE_EMULATOR_HOST: '127.0.0.1:9' })
  const result = spawnSync(process.execPath, ['-e', source], { cwd: __dirname, env, encoding: 'utf8', timeout: 30_000, maxBuffer: 4e6, windowsHide: true })
  assert.ifError(result.error); assert.equal(result.status, 0, 'Blocked-network SDK event registration and invocation must succeed')
  const row = result.stdout.split(/\r?\n/).find(line => line.startsWith('EVENT_REGISTRATION:'))
  assert.ok(row)
  const value = JSON.parse(row.slice('EVENT_REGISTRATION:'.length))
  const targets = ['syncSessionOperationalActions', 'syncStaffOperationalSummary', 'syncStudent360OperationalActions']
  assert.equal(value.count, 571); assert.deepEqual(value.registered.sort(), targets)
  assert.equal(value.logs.length, 3)
  assert.deepEqual(value.logs.map(row => row.value.operation).sort(), targets)
  for (const { value: metric } of value.logs) {
    assert.equal(metric.invocationType, 'event'); assert.equal(metric.metrics.guardSkips, 1)
    assert.equal(metric.metrics.queryAttempts, 0); assert.equal(metric.metrics.documentReadAttempts, 0)
  }
  assert.doesNotMatch(JSON.stringify(value.logs), /PRIVATE_|actorUid|sourceId|correlationId|eventId/)
})
