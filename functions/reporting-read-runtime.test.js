'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const test = require('node:test')
const { REPORTING_READ_TARGETS, shouldUseReportingReadRuntime, loadReportingReadRuntime } = require('./reporting-read-runtime')

const DATABASE = 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'
const PREFIX = 'REPORTING_RUNTIME_PROBE:'
const PROBE_NOW_MS = Date.UTC(2026, 9, 30)
// Use the real entry point, SDK registration and trustedAccessContext.
// Firestore and wall clock are fixtures; network and writes fail closed even on discovery.
const SOURCE = String.raw`
const Module = require('node:module');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const input = JSON.parse(process.env.AURA_REPORTING_RUNTIME_PROBE);
// Discovery and targeted runtime run in separate child processes. Freeze the
// fixture clock and use one stored expiration, as a Firestore Timestamp does.
// Recomputing expiry inside toMillis can turn 60s into 61s across a 1ms tick.
Date.now = () => ${PROBE_NOW_MS};
const cachedSummaryExpiresAtMillis = ${PROBE_NOW_MS} + 60_000;
const reads = [], queries = [], databaseIds = [], networkAttempts = [];
const documents = { ...(input.documents || {}) };
const blocked = kind => function () { networkAttempts.push(kind); throw new Error('Blocked network: ' + kind); };
for (const name of ['node:http', 'node:https']) { const api = require(name); api.request = blocked(name); api.get = blocked(name); }
require('node:net').Socket.prototype.connect = blocked('net.connect');
global.fetch = blocked('fetch');
function snapshot(documentPath, mask) {
  const exists = Object.prototype.hasOwnProperty.call(documents, documentPath);
  const value = documents[documentPath];
  return { id: documentPath.split('/').at(-1), ref: { path: documentPath }, exists,
    data: () => mask && value ? Object.fromEntries(mask.filter(field => field in value).map(field => [field, value[field]])) : value };
}
function query(collection, filters = [], mask = null, maximum = Infinity, after = '') {
  return {
    doc: id => db.doc(collection + '/' + id),
    where: (field, operator, value) => { if (operator !== '==') throw new Error('Unexpected operator'); return query(collection, [...filters, [field, value]], mask, maximum, after); },
    select: (...fields) => query(collection, filters, fields, maximum, after),
    orderBy: () => query(collection, filters, mask, maximum, after),
    limit: size => query(collection, filters, mask, size, after),
    startAfter: id => query(collection, filters, mask, maximum, id),
    async get() {
      if (!Number.isFinite(maximum)) throw new Error('Unbounded reporting query');
      queries.push({ collection, filters, mask, maximum, after });
      const docs = Object.keys(documents).filter(key => key.startsWith(collection + '/') && key.split('/').length === 2)
        .sort().filter(key => key.split('/').at(-1) > after && filters.every(([field, value]) => documents[key][field] === value))
        .slice(0, maximum).map(key => snapshot(key, mask));
      return { docs, size: docs.length, empty: !docs.length };
    },
  };
}
const db = {
  doc(documentPath) { return { path: documentPath, async get() {
    reads.push(documentPath);
    if (documentPath.startsWith('systemOperationsDashboardCache/') && input.cachedSummary) return {
      exists: true, data: () => ({ schemaVersion: 3, valueExpiresAt: { toMillis: () => cachedSummaryExpiresAtMillis }, value: input.cachedSummary }),
    };
    return snapshot(documentPath);
  } }; },
  collection: name => query(name),
  collectionGroup: () => { throw new Error('Unexpected source scan instead of summary cache'); },
  async getAll(...refs) { const mask = refs.pop().fieldMask; return refs.map(ref => { reads.push(ref.path); return snapshot(ref.path, mask); }); },
  runTransaction: () => { throw new Error('Unexpected transaction in cached read probe'); },
};
const originalLoad = Module._load;
const replacements = new Map();
Module._load = function (request) {
  const actual = originalLoad.apply(this, arguments);
  if (request !== 'firebase-admin/firestore' && request !== 'firebase-functions/v2/https') return actual;
  if (replacements.has(request)) return replacements.get(request);
  const replacement = request === 'firebase-admin/firestore'
    ? { ...actual, getFirestore: (_app, databaseId) => { databaseIds.push(databaseId); return db; } }
    : { ...actual, onCall: (optionsOrHandler, maybeHandler) => {
      const handler = typeof optionsOrHandler === 'function' ? actual.onCall(optionsOrHandler) : actual.onCall(optionsOrHandler, maybeHandler);
      handler.__probeOptions = typeof optionsOrHandler === 'function' ? {} : optionsOrHandler;
      return handler;
    } };
  replacements.set(request, replacement); return replacement;
};
(async () => {
  const started = performance.now();
  const entry = require('./index.js');
  const initializationMs = performance.now() - started;
  const loadedModuleCount = Object.keys(require.cache).length;
  const metadata = Object.fromEntries(Object.entries(entry).map(([name, value]) => [name, {
    endpoint: value.__endpoint, trigger: value.__trigger, options: value.__probeOptions,
  }]));
  const results = [];
  for (const request of input.requests || []) {
    Object.assign(documents, request.documentUpdates || {});
    const beforeReads = reads.length, beforeQueries = queries.length;
    try { results.push({ ok: true, value: await entry[request.name].run(request.call), reads: reads.slice(beforeReads), queries: queries.slice(beforeQueries) }); }
    catch (error) { results.push({ ok: false, code: error.code || null, message: error.message, reads: reads.slice(beforeReads), queries: queries.slice(beforeQueries) }); }
  }
  const localModules = Object.keys(require.cache).filter(file => file.startsWith(process.cwd() + path.sep) && !file.includes(path.sep + 'node_modules' + path.sep))
    .map(file => path.relative(process.cwd(), file).split(path.sep).join('/')).sort();
  console.log('${PREFIX}' + JSON.stringify({ exportNames: Object.keys(entry).sort(), metadata, results, reads, queries, databaseIds, networkAttempts, localModules, loadedModuleCount, initializationMs }));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
`

function probe({ environment = {}, ...input } = {}) {
  const env = { ...process.env }
  for (const key of ['FUNCTION_TARGET', 'FUNCTIONS_CONTROL_API', 'AURA_FIREBASE_DISCOVERY_SCOPE', 'NODE_ENV', 'FIRESTORE_DATABASE_ID', 'ENFORCE_APP_CHECK', 'ENFORCE_AI_APP_CHECK', 'FIREBASE_DATABASE_URL', 'GOOGLE_APPLICATION_CREDENTIALS']) delete env[key]
  Object.assign(env, {
    GCLOUD_PROJECT: 'demo-aura-reporting-runtime-test', GOOGLE_CLOUD_PROJECT: 'demo-aura-reporting-runtime-test',
    FIREBASE_CONFIG: JSON.stringify({ projectId: 'demo-aura-reporting-runtime-test' }), FIRESTORE_EMULATOR_HOST: '127.0.0.1:9',
    AURA_REPORTING_RUNTIME_PROBE: JSON.stringify(input), ...environment,
  })
  const result = spawnSync(process.execPath, ['-e', SOURCE], { cwd: __dirname, env, encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })
  assert.ifError(result.error)
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`)
  const line = result.stdout.split(/\r?\n/).find(value => value.startsWith(PREFIX))
  assert.ok(line, result.stdout)
  const output = JSON.parse(line.slice(PREFIX.length))
  assert.deepEqual(output.networkAttempts, [])
  return output
}

function profile(uid, accessRole, overrides = {}) {
  return {
    [`users/${uid}`]: { displayName: uid, ...overrides },
    [`roleAssignments/${uid}`]: { accessRole, status: 'active', authzVersion: 1, positions: [], branchIds: ['a'] },
  }
}
function call(uid = 'admin', accessRole = 'admin', data = {}) {
  return { auth: { uid, token: { accessRole, authzVersion: 1 } }, data }
}
const cachedSummary = { complete: true, courses: [{ courseId: 'course-a', learners: 1 }], asOf: '2026-10-30T00:00:00.000Z' }

test('reporting runtime selects only exact allowlisted targets outside every discovery mode', () => {
  assert.deepEqual(REPORTING_READ_TARGETS, ['getAcademyAnalyticsSummary', 'listAcademyEnrollmentsPage', 'listFinanceReceivables', 'listFinanceStudentLabels'])
  for (const target of REPORTING_READ_TARGETS) {
    assert.equal(shouldUseReportingReadRuntime({ FUNCTION_TARGET: target }), true)
    for (const environment of [{ FUNCTIONS_CONTROL_API: 'true' }, { AURA_FIREBASE_DISCOVERY_SCOPE: 'student360' }, { AURA_FIREBASE_DISCOVERY_SCOPE: 'exerciseCatalog' }, { AURA_FIREBASE_DISCOVERY_SCOPE: 'future-scope' }, { NODE_ENV: 'aura-student360-discovery' }, { NODE_ENV: 'aura-exercise-catalog-discovery' }]) {
      assert.equal(shouldUseReportingReadRuntime({ FUNCTION_TARGET: target, ...environment }), false)
      assert.throws(() => loadReportingReadRuntime({ FUNCTION_TARGET: target, ...environment }), /explicitly allowlisted/)
    }
  }
  for (const target of [undefined, '', 'unknown', 'listFinanceLedger', 'listFinanceReceivablesRegional', 'getAcademyAnalyticsSummary ']) {
    assert.equal(shouldUseReportingReadRuntime({ FUNCTION_TARGET: target }), false)
    assert.throws(() => loadReportingReadRuntime({ FUNCTION_TARGET: target }), /explicitly allowlisted/)
  }
})

test('all four targets preserve real SDK metadata, named database, public IAM and App Check without unrelated domains', () => {
  for (const environment of [{}, { ENFORCE_APP_CHECK: 'true' }, { ENFORCE_AI_APP_CHECK: 'true', FIRESTORE_DATABASE_ID: 'reporting-test-database' }]) {
    const discovery = probe({ environment })
    assert.equal(discovery.exportNames.length, 571)
    for (const target of REPORTING_READ_TARGETS) {
      const runtime = probe({ environment: { ...environment, FUNCTION_TARGET: target } })
      assert.deepEqual(runtime.exportNames, [target])
      assert.deepEqual(runtime.metadata[target], discovery.metadata[target], target)
      assert.deepEqual(runtime.databaseIds, [environment.FIRESTORE_DATABASE_ID || DATABASE])
      assert.deepEqual(runtime.metadata[target].options, {
        region: 'asia-east1', invoker: 'public', memory: '512MiB', timeoutSeconds: 180, maxInstances: 2, concurrency: 4,
        enforceAppCheck: environment.ENFORCE_APP_CHECK === 'true',
      }, 'CPU remains the existing SDK default; no new secret binding or resource override')
      assert.deepEqual(runtime.metadata[target].endpoint.labels, { 'aura-release': 'quota-safe-v1-20260830' })
      for (const unrelated of ['generative-ai.js', 'nutrition.js', 'nutrition-scan-queue.js', 'eat-clean.js', 'academy-authoring.js', 'exercise-catalog.js', 'finance-ledger.js', 'loyalty.js', 'student-360.js', 'pt-schedule-v2.js']) {
        assert.equal(runtime.localModules.includes(unrelated), false, `${target} must not load ${unrelated}`)
      }
      assert.ok(runtime.loadedModuleCount < discovery.loadedModuleCount)
      assert.ok(runtime.localModules.length < discovery.localModules.length)
      assert.deepEqual(runtime.reads, [], 'startup must not read Firestore')
      assert.deepEqual(runtime.queries, [])
    }
  }
})

test('unknown targets and control API keep all discovery registrations and metadata', () => {
  const baseline = probe()
  for (const environment of [{ FUNCTION_TARGET: 'unknown' }, { FUNCTION_TARGET: 'listFinanceReceivables', FUNCTIONS_CONTROL_API: 'true' }]) {
    const controlled = probe({ environment })
    assert.deepEqual(controlled.exportNames, baseline.exportNames)
    assert.deepEqual(controlled.metadata, baseline.metadata)
  }
  for (const environment of [{ AURA_FIREBASE_DISCOVERY_SCOPE: 'student360' }, { NODE_ENV: 'aura-exercise-catalog-discovery' }]) {
    const scoped = probe({ environment })
    const targeted = probe({ environment: { ...environment, FUNCTION_TARGET: 'listFinanceReceivables' } })
    assert.deepEqual(targeted.exportNames, scoped.exportNames)
    assert.deepEqual(targeted.metadata, scoped.metadata)
  }
})

test('canonical authorization rejects anonymous, student, staff, stale and disabled callers before any reporting read', () => {
  const documents = { ...profile('student', 'student'), ...profile('staff', 'staff'), ...profile('admin', 'admin'), ...profile('disabled', 'admin', { disabled: true }) }
  for (const name of REPORTING_READ_TARGETS) {
    const requests = [{ data: {} }, call('student', 'student'), call('staff', 'staff'), { ...call(), auth: { uid: 'admin', token: { accessRole: 'admin', authzVersion: 0 } } }, call('disabled')]
      .map(value => ({ name, call: value }))
    const discovery = probe({ documents, cachedSummary, requests })
    const runtime = probe({ environment: { FUNCTION_TARGET: name }, documents, cachedSummary, requests })
    assert.deepEqual(runtime.results, discovery.results)
    assert.deepEqual(runtime.results.map(row => row.code), ['unauthenticated', 'permission-denied', 'permission-denied', 'permission-denied', 'permission-denied'])
    assert.deepEqual(runtime.queries, [])
    assert.ok(runtime.reads.every(path => /^(users|roleAssignments)\//.test(path)))
  }
})

test('authorized bounded pages, masked labels and cached summaries retain canonical results; disabled profile is checked on each call', () => {
  const documents = {
    ...profile('admin', 'admin'),
    'enrollments/e1': { userId: 'learner', courseId: 'course-a', status: 'active', privateNote: 'hidden' },
    'users/learner': { displayName: 'Learner', email: 'learner@example.invalid', privateNote: 'hidden' },
    'students/s1': { name: 'Learner', phone: '000', email: 'learner@example.invalid', healthNotes: 'hidden' },
    'contracts/c1': { studentId: 's1', branchId: 'a', totalPrice: 100, paidAmount: 20, status: 'active', internalNote: 'hidden' },
  }
  const inputByName = {
    getAcademyAnalyticsSummary: {}, listAcademyEnrollmentsPage: { pageSize: 2 },
    listFinanceReceivables: { branchId: 'a', pageSize: 2, today: '2026-10-30', includeSummary: false },
    listFinanceStudentLabels: { studentIds: ['s1', 's1'] },
  }
  function stable(results) { return results.map(row => ({ ...row, value: row.value ? { ...row.value, ...(row.value.asOf ? { asOf: 'AS_OF' } : {}) } : undefined })) }
  for (const name of REPORTING_READ_TARGETS) {
    const requests = [
      { name, call: call('admin', 'admin', inputByName[name]) },
      { name, call: call('admin', 'admin', inputByName[name]), documentUpdates: { 'users/admin': { displayName: 'admin', disabled: true } } },
    ]
    const discovery = probe({ documents, cachedSummary, requests })
    const runtime = probe({ environment: { FUNCTION_TARGET: name }, documents, cachedSummary, requests })
    assert.deepEqual(stable(runtime.results), stable(discovery.results))
    assert.equal(runtime.results[0].ok, true, name)
    assert.equal(runtime.results[1].code, 'permission-denied')
    assert.deepEqual(runtime.results[1].queries, [])
    assert.doesNotMatch(JSON.stringify(runtime.results[0].value), /hidden|privateNote|healthNotes|internalNote/)
    if (name === 'listAcademyEnrollmentsPage') assert.equal(runtime.results[0].value.enrollments.length, 1)
    if (name === 'listFinanceReceivables') assert.equal(runtime.results[0].value.contracts.length, 1)
    if (name === 'listFinanceStudentLabels') assert.equal(runtime.results[0].value.students.length, 1)
    if (name === 'getAcademyAnalyticsSummary') {
      assert.equal(runtime.results[0].value.cache.hit, true)
      assert.equal(runtime.results[0].value.cache.ttlSeconds, 60)
      assert.equal(runtime.results[0].value.cache.expiresAtMillis, PROBE_NOW_MS + 60_000)
    }
  }
})

test('targeted and discovery finance runtimes project the selected category from the shared v5 cache', () => {
  const documents = profile('admin', 'admin')
  const categorySummaries = Object.fromEntries(['all', 'installments', 'frozen', 'debt'].map((category, index) => [category, {
    complete: true, totals: { debt: index * 100, overdue: 0, thisMonth: 0 }, counts: { all: index },
  }]))
  const summary = { categorySummaries, source: 'contracts', sourceDocuments: 42, asOf: '2026-10-30T00:00:00.000Z' }
  const requests = ['frozen', 'debt'].map(category => ({ name: 'listFinanceReceivables', call: call('admin', 'admin', {
    branchId: 'a', category, today: '2026-10-30',
  }) }))
  const results = [probe({ documents, cachedSummary: summary, requests }),
    probe({ environment: { FUNCTION_TARGET: 'listFinanceReceivables' }, documents, cachedSummary: summary, requests })]
  for (const result of results) {
    assert.ok(result.results.every(row => row.ok))
    assert.deepEqual(result.results.map(row => row.value.summary.totals.debt), [200, 300])
    for (const row of result.results) {
      assert.equal(row.value.summary.cache.hit, true)
      assert.equal(row.value.summary.sourceDocuments, 42)
      assert.equal(row.value.summary.asOf, summary.asOf)
      assert.equal(row.value.summary.categorySummaries, undefined)
      assert.equal(row.reads.filter(path => path.startsWith('systemOperationsDashboardCache/receivables-v5-')).length, 1)
    }
  }
  assert.deepEqual(results[0].results.map(row => row.value.summary), results[1].results.map(row => row.value.summary))
})
