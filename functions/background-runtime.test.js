'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const test = require('node:test')
const { BACKGROUND_RUNTIME_TARGETS, shouldUseBackgroundRuntime, loadBackgroundRuntime } = require('./background-runtime')
const { STUDENT360_SOURCE_DOCUMENTS } = require('./student-360-background-functions')

// Real Firebase wrappers and the real application entry run in fresh processes.
// Business handlers are replaced only for delegation assertions. Every probe
// blocks networking, including ADC and metadata, before application import.
const PROBE_SOURCE = String.raw`
const Module = require('node:module');
const path = require('node:path');
const input = JSON.parse(process.env.AURA_BACKGROUND_RUNTIME_PROBE);
const networkAttempts = [];
function block(kind) { return () => { networkAttempts.push(kind); throw new Error('Unexpected network: ' + kind); }; }
for (const name of ['node:http', 'node:https']) {
  const api = require(name); api.request = block(name + '.request'); api.get = block(name + '.get');
}
require('node:net').Socket.prototype.connect = block('net.connect');
global.fetch = block('fetch');
const calls = [], databaseIds = [], queries = [];
const db = { probe: 'database' };
if (input.emptyQueue) db.collection = collectionPath => {
  if (collectionPath !== 'systemJobs/student360SourceQueue/subjects') throw new Error('Unexpected idle queue read');
  queries.push(collectionPath);
  const query = { where: () => query, orderBy: () => query, limit: () => query, get: async () => ({ docs: [], size: 0 }) };
  return query;
};
const handlerNames = {
  './session-operations': ['chargeDuePtSessions', 'autoConfirmOverduePtAttendance'],
  './staff-managed-summary': ['reconcileStaffManagedClientSummaries'],
  './loyalty': ['reconcilePendingMemberReferrals', 'vestPendingSources'],
  './student-360': ['enqueueStudent360ProjectionFromEvent', 'rebuildStudent360Source', 'reconcileStudent360ProjectionBatch', 'buildStudent360Projection'],
  './student-360-source-queue': ['processStudent360Source', 'recoverStudent360Sources'],
  './workspace-change-signals': ['syncWorkspaceChangesFromEvent'],
  './delivery-workspace-signals': ['syncDeliveryWorkspaceChange'],
  './student-360-refresh-queue': ['processStudent360Refresh'],
};
const originalLoad = Module._load;
const replacements = new Map();
Module._load = function (request, parent, isMain) {
  const actual = originalLoad.apply(this, arguments);
  if (request === 'firebase-admin/firestore') {
    if (!replacements.has(request)) replacements.set(request, { ...actual, getFirestore: (_app, id) => { databaseIds.push(id); return db; } });
    return replacements.get(request);
  }
  if (!input.delegate || !handlerNames[request]) return actual;
  if (replacements.has(request)) return replacements.get(request);
  const replacement = { ...actual };
  for (const name of handlerNames[request]) {
    if (typeof actual[name] !== 'function') throw new Error('Missing real business handler: ' + name);
    replacement[name] = async options => {
      const { logger, fallbackWeekId, rebuild, ...args } = options;
      if (args.now instanceof Date) args.now = 'CURRENT_DATE';
      calls.push({ name, args, hasLogger: !!logger });
      if (name === 'processStudent360Refresh') {
        calls.at(-1).fallbackWeek = fallbackWeekId(new Date('2026-10-29T00:00:00Z'));
        return rebuild({ studentId: 'student-a', weekId: '2026-10-26', lease: { id: 'lease-a' } });
      }
      if (name === 'processStudent360Source' || name === 'recoverStudent360Sources') {
        return rebuild({ studentId: 'student-a', scope: 'operations', lease: { id: 'lease-a' } });
      }
      if (name === 'syncWorkspaceChangesFromEvent') return { overflowCount: 1, source: args.source };
      return { handledBy: name };
    };
  }
  replacements.set(request, replacement);
  return replacement;
};
(async () => {
  const start = process.hrtime.bigint();
  const entry = require('./index');
  const initializationMs = Number(process.hrtime.bigint() - start) / 1e6;
  const targets = require('./background-runtime').BACKGROUND_RUNTIME_TARGETS;
  const metadata = Object.fromEntries(targets.filter(name => entry[name]).map(name => [name, entry[name].__endpoint]));
  let result;
  if (input.invoke) result = await entry[input.target].run(input.noopQueue ? {
    params: { studentId: 'student-a' },
    data: { before: { exists: true, data: () => ({ generation: 1, status: 'processing' }) }, after: { exists: true, data: () => ({ generation: 1, status: 'completed' }) } },
  } : { id: 'event-a', data: { marker: 'event-data' }, params: { studentId: 'student-a' } });
  const modules = Object.keys(require.cache);
  const localModules = modules.filter(name => name.startsWith(process.cwd() + path.sep) && !name.includes(path.sep + 'node_modules' + path.sep))
    .map(name => path.relative(process.cwd(), name).split(path.sep).join('/')).sort();
  console.log('BACKGROUND_PROBE:' + JSON.stringify({ exportNames: Object.keys(entry).sort(), metadata, calls, queries, result, databaseIds, networkAttempts, localModules, moduleCount: modules.length, initializationMs }));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
`

function probe({ target, runtime = false, environment = {}, ...input } = {}) {
  const env = { ...process.env }
  for (const key of ['FUNCTION_TARGET', 'FUNCTIONS_CONTROL_API', 'AURA_FIREBASE_DISCOVERY_SCOPE', 'NODE_ENV', 'FIRESTORE_DATABASE_ID',
    'ENFORCE_APP_CHECK', 'ENFORCE_AI_APP_CHECK', 'FIREBASE_DATABASE_URL', 'GOOGLE_APPLICATION_CREDENTIALS']) delete env[key]
  Object.assign(env, {
    GCLOUD_PROJECT: 'demo-aura-background-runtime', GOOGLE_CLOUD_PROJECT: 'demo-aura-background-runtime',
    FIREBASE_CONFIG: JSON.stringify({ projectId: 'demo-aura-background-runtime' }),
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:9',
    AURA_BACKGROUND_RUNTIME_PROBE: JSON.stringify({ target, ...input }),
    ...(runtime ? { FUNCTION_TARGET: target } : {}), ...environment,
  })
  const result = spawnSync(process.execPath, ['-e', PROBE_SOURCE], { cwd: __dirname, env, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr + '\n' + result.stdout)
  const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('BACKGROUND_PROBE:'))
  assert.ok(line, result.stdout)
  const output = JSON.parse(line.slice('BACKGROUND_PROBE:'.length))
  assert.deepEqual(output.networkAttempts, [])
  return output
}

test('target selection is exact and never narrows deployment discovery', () => {
  for (const target of BACKGROUND_RUNTIME_TARGETS) {
    assert.equal(shouldUseBackgroundRuntime({ FUNCTION_TARGET: target }), true)
    for (const flags of [
      { FUNCTIONS_CONTROL_API: 'true' }, { AURA_FIREBASE_DISCOVERY_SCOPE: 'student360' },
      { AURA_FIREBASE_DISCOVERY_SCOPE: 'future-scope' }, { NODE_ENV: 'aura-student360-discovery' },
      { NODE_ENV: 'aura-exercise-catalog-discovery' },
    ]) assert.equal(shouldUseBackgroundRuntime({ FUNCTION_TARGET: target, ...flags }), false)
  }
  for (const target of [undefined, '__proto__', 'syncstudent360session', 'syncStudent360Session ', 'getMyTrainerWorkspaceRegional']) {
    assert.equal(shouldUseBackgroundRuntime({ FUNCTION_TARGET: target }), false)
    assert.throws(() => loadBackgroundRuntime({ FUNCTION_TARGET: target }), /explicitly allowlisted/)
  }
})

test('all background runtimes retain discovery metadata, named database and minimal module graph', () => {
  const discovery = probe()
  assert.equal(discovery.exportNames.length, 571)
  for (const name of ['getAcademyAnalyticsSummary', 'listAcademyEnrollmentsPage', 'listFinanceReceivables', 'listFinanceStudentLabels']) assert.ok(discovery.exportNames.includes(name))
  for (const name of ['getContractSettlement', 'manageContractSettlement']) assert.ok(discovery.exportNames.includes(name))
  for (const name of ['enqueueNutritionScan', 'dispatchNutritionScan', 'processNutritionScanQueue']) assert.ok(discovery.exportNames.includes(name))
  for (const target of BACKGROUND_RUNTIME_TARGETS) {
    const runtime = probe({ target, runtime: true })
    assert.deepEqual(runtime.exportNames, [target])
    assert.deepEqual(runtime.metadata[target], discovery.metadata[target], target)
    assert.deepEqual(runtime.databaseIds, ['ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'])
    for (const unrelated of ['generative-ai.js', 'nutrition.js', 'eat-clean.js', 'academy-authoring.js', 'exercise-catalog.js']) {
      assert.equal(runtime.localModules.includes(unrelated), false, target + ' must not load ' + unrelated)
    }
    assert.ok(runtime.localModules.length < discovery.localModules.length, target)
    if (target === 'processStudent360SourceQueue' || target === 'recoverStudent360SourceQueueScheduled') {
      assert.equal(runtime.localModules.includes('student-360.js'), false, 'idle queue startup must not import the projection module')
    }
  }
})

test('control API and unknown targets retain full discovery; controlled database override is preserved', () => {
  const baseline = probe()
  for (const environment of [
    { FUNCTION_TARGET: 'unknown' },
    { FUNCTION_TARGET: 'syncStudent360Session', FUNCTIONS_CONTROL_API: 'true' },
  ]) assert.deepEqual(probe({ environment }).exportNames, baseline.exportNames)
  const custom = probe({ target: 'syncStudent360Session', runtime: true, environment: { FIRESTORE_DATABASE_ID: 'runtime-test-database' } })
  assert.deepEqual(custom.databaseIds, ['runtime-test-database'])
  assert.equal(custom.metadata.syncStudent360Session.eventTrigger.eventFilters.database, 'runtime-test-database')
})

test('schedule adapters preserve business arguments and sequencing in discovery and runtime', () => {
  const expectedHandlers = {
    chargeDuePtSessionsScheduled: ['chargeDuePtSessions'],
    autoConfirmOverduePtAttendanceScheduled: ['autoConfirmOverduePtAttendance'],
    vestPendingLoyaltySourcesScheduled: ['reconcilePendingMemberReferrals', 'vestPendingSources'],
    reconcileStaffManagedClientSummariesScheduled: ['reconcileStaffManagedClientSummaries'],
    reconcileStudent360ProjectionsScheduled: ['reconcileStudent360ProjectionBatch'],
    recoverStudent360SourceQueueScheduled: ['recoverStudent360Sources', 'rebuildStudent360Source'],
  }
  for (const [target, handlers] of Object.entries(expectedHandlers)) {
    const runtime = probe({ target, runtime: true, delegate: true, invoke: true })
    const discovery = probe({ target, delegate: true, invoke: true })
    assert.deepEqual(runtime.calls, discovery.calls, target)
    assert.deepEqual(runtime.calls.map(call => call.name), handlers)
    assert.deepEqual(runtime.result, discovery.result)
    if (target === 'chargeDuePtSessionsScheduled' || target === 'autoConfirmOverduePtAttendanceScheduled') {
      assert.deepEqual(runtime.calls[0].args, { db: { probe: 'database' }, now: 'CURRENT_DATE', limit: 500, includeRecent: true, includeCatchUp: false, pendingOnly: true })
    }
    if (target === 'vestPendingLoyaltySourcesScheduled') assert.deepEqual(runtime.calls.map(call => call.args.limit), [100, 300])
  }
})

test('source adapters preserve workspace audiences and profile delivery signals while enqueueing', () => {
  for (const target of ['syncStudent360Session', 'syncStudent360Profile', 'syncStudent360MealLog']) {
    const runtime = probe({ target, runtime: true, delegate: true, invoke: true })
    const discovery = probe({ target, delegate: true, invoke: true })
    assert.deepEqual(runtime.calls, discovery.calls)
    assert.deepEqual(runtime.result, { handledBy: 'enqueueStudent360ProjectionFromEvent' })
    assert.deepEqual(runtime.calls.map(call => call.name), ['enqueueStudent360ProjectionFromEvent', 'syncWorkspaceChangesFromEvent',
      ...(target === 'syncStudent360Profile' ? ['syncDeliveryWorkspaceChange'] : [])])
    const document = STUDENT360_SOURCE_DOCUMENTS[target]
    assert.equal(runtime.calls[1].args.source, document.includes('/{accountUid}/') ? document.split('/')[2] : document.split('/')[0])
  }
})

test('both queue adapters use canonical workers and preserve stale refresh lease arguments', () => {
  for (const target of ['processStudent360SourceQueue', 'refreshStudent360ProjectionFromQueue']) {
    const runtime = probe({ target, runtime: true, delegate: true, invoke: true })
    const discovery = probe({ target, delegate: true, invoke: true })
    assert.deepEqual(runtime.calls, discovery.calls)
    assert.deepEqual(runtime.result, discovery.result)
    if (target === 'refreshStudent360ProjectionFromQueue') {
      assert.deepEqual(runtime.calls.map(call => call.name), ['processStudent360Refresh', 'buildStudent360Projection'])
      assert.deepEqual(runtime.calls[1].args, { db: { probe: 'database' }, studentId: 'student-a', weekId: '2026-10-26', persist: true, lease: { id: 'lease-a' } })
    } else {
      assert.deepEqual(runtime.calls.map(call => call.name), ['processStudent360Source', 'rebuildStudent360Source'])
      assert.deepEqual(runtime.calls[1].args, { db: { probe: 'database' }, studentId: 'student-a', scope: 'operations', lease: { id: 'lease-a' } })
    }
  }
})

test('real status-only deliveries and empty recovery scans do not load projection code', () => {
  const noop = probe({ target: 'processStudent360SourceQueue', runtime: true, invoke: true, noopQueue: true })
  assert.deepEqual(noop.result, { skipped: true, reason: 'status_update' })
  assert.deepEqual(noop.queries, [])
  assert.equal(noop.localModules.includes('student-360.js'), false)
  const empty = probe({ target: 'recoverStudent360SourceQueueScheduled', runtime: true, invoke: true, emptyQueue: true })
  assert.equal(empty.result.scanned, 0)
  assert.equal(empty.result.completed, 0)
  assert.deepEqual(empty.queries, ['systemJobs/student360SourceQueue/subjects'])
  assert.equal(empty.localModules.includes('student-360.js'), false)
  assert.equal(empty.metadata.recoverStudent360SourceQueueScheduled.scheduleTrigger.schedule, 'every 5 minutes')
})
