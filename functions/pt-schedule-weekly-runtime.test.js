'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const test = require('node:test')
const {
  WEEKLY_READ_TARGETS,
  shouldUseWeeklyReadRuntime,
  loadWeeklyReadRuntime,
} = require('./pt-schedule-weekly-runtime')
const { buildPtScheduleWeeklyView } = require('./pt-schedule-weekly-view')

const CANONICAL_DATABASE = 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'
const BRANCH = 'branch-a'
const WEEK = '2026-10-19'
const VIEW_PATH = `ptScheduleWeeklyViews/${BRANCH}_${WEEK}`
const STATE_PATH = `ptScheduleWeeklyViewStates/${BRANCH}_${WEEK}`
const PROBE_PREFIX = 'WEEKLY_RUNTIME_PROBE:'
const AGGREGATE_TARGETS = Object.freeze({
  syncOperationsLedgerDailyAggregate: 'ledgerEntries/{entryId}',
  syncOperationsSessionDailyAggregate: 'sessions/{sessionId}',
  syncOperationsAttendanceDailyAggregate: 'attendanceEvents/{eventId}',
  syncOperationsContractDailyAggregate: 'contracts/{contractId}',
  syncOperationsStudentDailyAggregate: 'students/{studentId}',
})

// Exercise the real CommonJS entry point and Firebase onCall wrapper in fresh
// processes. Only Firestore access is replaced; request auth uses the actual
// scheduleActor/trustedAccessContext implementation. A network tripwire makes
// it impossible for this test to read production data or contact metadata/ADC.
const PROBE_SOURCE = String.raw`
const path = require('node:path');
const Module = require('node:module');
const input = JSON.parse(process.env.AURA_WEEKLY_RUNTIME_PROBE);
const reads = [];
const queries = [];
const writes = [];
let transactions = 0;
const databaseIds = [];
const networkAttempts = [];
const documents = { ...(input.documents || {}) };
function blockedNetwork(kind) {
  return function () {
    networkAttempts.push(kind);
    throw new Error('Runtime probe blocked network: ' + kind);
  };
}
for (const name of ['node:http', 'node:https']) {
  const api = require(name);
  api.request = blockedNetwork(name + '.request');
  api.get = blockedNetwork(name + '.get');
}
require('node:net').Socket.prototype.connect = blockedNetwork('net.connect');
global.fetch = blockedNetwork('fetch');
const db = {
  doc(documentPath) {
    return {
      path: documentPath,
      async get() {
        reads.push(documentPath);
        const exists = Object.prototype.hasOwnProperty.call(documents, documentPath);
        return { exists, id: documentPath.split('/').at(-1), data: () => documents[documentPath] };
      },
    };
  },
  collection(collectionPath) {
    queries.push(collectionPath);
    throw new Error('Unexpected collection fan-out: ' + collectionPath);
  },
  async runTransaction(action) {
    transactions += 1;
    if (!input.allowMetadataTransactions) {
      throw Object.assign(new Error('Runtime probe reached canonical rebuild transaction'), { code: 'probe-rebuild-required' });
    }
    const pendingWrites = [];
    const result = await action({
      get: (reference) => reference.get(),
      getAll: (...references) => Promise.all(references.map(reference => reference.get())),
      set(reference, value, options) {
        const expectedKeys = ['branchId', 'schemaVersion', 'updatedAt', 'validationDirty', 'weekId'];
        if (options?.merge !== true || !reference.path.startsWith('ptScheduleWeeklyViewStates/')
          || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys)
          || value.schemaVersion !== 1 || value.validationDirty !== true) {
          throw new Error('Runtime probe rejected non-metadata transaction write');
        }
        pendingWrites.push({ path: reference.path, value, options });
      },
    });
    for (const write of pendingWrites) {
      documents[write.path] = { ...documents[write.path], ...write.value };
      writes.push(write);
    }
    return result;
  },
};
const originalLoad = Module._load;
const replacements = new Map();
Module._load = function (request, parent, isMain) {
  const actual = originalLoad.apply(this, arguments);
  if (request !== 'firebase-admin/firestore' && request !== 'firebase-functions/v2/https') return actual;
  if (replacements.has(request)) return replacements.get(request);
  const replacement = request === 'firebase-admin/firestore'
    ? { ...actual, getFirestore: (_app, databaseId) => { databaseIds.push(databaseId); return db; } }
    : { ...actual, onCall: (optionsOrHandler, maybeHandler) => {
      const handler = typeof optionsOrHandler === 'function'
        ? actual.onCall(optionsOrHandler)
        : actual.onCall(optionsOrHandler, maybeHandler);
      handler.__runtimeProbeOptions = typeof optionsOrHandler === 'function' ? {} : optionsOrHandler;
      return handler;
    } };
  replacements.set(request, replacement);
  return replacement;
};
(async () => {
  const entry = require('./index.js');
  const exportNames = Object.keys(entry).sort();
  const selectedName = input.selectedName || 'getPtScheduleWeeklyViewRegional';
  const selected = entry[selectedName];
  const handlers = {};
  for (const name of ['getPtScheduleWeeklyView', 'getPtScheduleWeeklyViewRegional', ...Object.keys(${JSON.stringify(AGGREGATE_TARGETS)})]) {
    if (entry[name]) handlers[name] = {
      endpoint: entry[name].__endpoint,
      trigger: entry[name].__trigger,
      callableOptions: entry[name].__runtimeProbeOptions,
    };
  }
  const results = [];
  for (const request of input.requests || []) {
    Object.assign(documents, request.documentUpdates || {});
    const beforeReads = reads.length;
    try {
      const value = await selected.run(request.call);
      results.push({ ok: true, value, reads: reads.slice(beforeReads) });
    } catch (error) {
      results.push({ ok: false, code: error.code || null, message: error.message, reads: reads.slice(beforeReads) });
    }
  }
  const localModules = Object.keys(require.cache)
    .filter((filename) => filename.startsWith(process.cwd() + path.sep) && !filename.includes(path.sep + 'node_modules' + path.sep))
    .map((filename) => path.relative(process.cwd(), filename).split(path.sep).join('/'))
    .sort();
  console.log('${PROBE_PREFIX}' + JSON.stringify({ exportNames, handlers, results, reads, queries, writes, transactions, databaseIds, networkAttempts, localModules }));
})().catch((error) => { console.error(error.stack); process.exitCode = 1; });
`

function probe({ environment = {}, ...input } = {}) {
  const env = { ...process.env }
  for (const key of [
    'FUNCTION_TARGET', 'FUNCTIONS_CONTROL_API', 'AURA_FIREBASE_DISCOVERY_SCOPE',
    'NODE_ENV', 'FIRESTORE_DATABASE_ID', 'ENFORCE_APP_CHECK', 'ENFORCE_AI_APP_CHECK',
    'FIREBASE_DATABASE_URL', 'GOOGLE_APPLICATION_CREDENTIALS',
  ]) delete env[key]
  Object.assign(env, {
    GCLOUD_PROJECT: 'demo-aura-weekly-runtime-test',
    GOOGLE_CLOUD_PROJECT: 'demo-aura-weekly-runtime-test',
    FIREBASE_CONFIG: JSON.stringify({ projectId: 'demo-aura-weekly-runtime-test' }),
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:9',
    AURA_WEEKLY_RUNTIME_PROBE: JSON.stringify(input),
    ...environment,
  })
  const result = spawnSync(process.execPath, ['-e', PROBE_SOURCE], {
    cwd: __dirname,
    env,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, `Runtime probe failed:\n${result.stderr}\n${result.stdout}`)
  const line = result.stdout.split(/\r?\n/).find((value) => value.startsWith(PROBE_PREFIX))
  assert.ok(line, `Missing runtime probe output:\n${result.stdout}`)
  const output = JSON.parse(line.slice(PROBE_PREFIX.length))
  assert.deepEqual(output.networkAttempts, [], 'Neither startup nor clean snapshot reads may perform real network I/O')
  return output
}

function cleanView(workspaceOverrides = {}) {
  const view = buildPtScheduleWeeklyView({
    branchId: BRANCH,
    weekId: WEEK,
    now: new Date('2026-10-23T00:00:00.000Z'),
    data: {
      weekId: WEEK,
      readMode: 'reconciled',
      partial: false,
      branch: { id: BRANCH, name: 'Test branch' },
      draft: { revision: 4, status: 'draft', publishedVersion: 0, publishedRevision: -1 },
      schedule: {
        'T2-6': [{ studentId: 'student-a', trainerId: 'trainer-a', branchId: BRANCH, type: 'training', contractId: 'contract-a', source: 'manual_v2' }],
      },
      students: [{
        id: 'student-a', name: 'Test student', phone: '0000000000', email: 'student@example.invalid',
        status: 'active', branchId: BRANCH, sessionsPerWeek: 2, activeScheduledThisWeek: 1,
        remainingSchedulableSessions: 10, availabilityStatus: 'submitted', availabilityRevision: 2,
        availableSlots: ['T2-6'], contractStatus: 'active', eligibleContractIds: ['contract-a'], eligibleForWeek: true,
      }],
      crossBranchStudents: [],
      trainers: [{ id: 'trainer-a', name: 'Test trainer', branchId: BRANCH, availabilityMode: 'configured', slotCapacity: 2 }],
      contracts: [{ id: 'contract-a', studentId: 'student-a', branchId: BRANCH, status: 'active', startDate: '2026-01-01', endDate: '2027-01-01' }],
      sessions: [],
      weeklySessionCoverage: {},
      config: { workingDays: ['T2'], workingHours: [6] },
      ...workspaceOverrides,
    },
  })
  return { ...view, viewRevision: 12 }
}

function assignment(accessRole, positions = [], branchIds = []) {
  return { accessRole, positions, branchIds, status: 'active', authzVersion: 1 }
}

function authenticatedCall(uid, accessRole, overrides = {}) {
  return {
    auth: { uid, token: { accessRole, authzVersion: 1, ...overrides } },
    data: { branchId: BRANCH, weekId: WEEK, initialPaint: true },
  }
}

test('weekly runtime selection is exact, runtime-only and has no request-controlled fallback', () => {
  assert.deepEqual(WEEKLY_READ_TARGETS, ['getPtScheduleWeeklyView', 'getPtScheduleWeeklyViewRegional'])
  for (const target of WEEKLY_READ_TARGETS) {
    assert.equal(shouldUseWeeklyReadRuntime({ FUNCTION_TARGET: target }), true)
    for (const forbidden of [
      { FUNCTIONS_CONTROL_API: 'true' },
      { AURA_FIREBASE_DISCOVERY_SCOPE: 'student360' },
      { AURA_FIREBASE_DISCOVERY_SCOPE: 'exerciseCatalog' },
      { AURA_FIREBASE_DISCOVERY_SCOPE: 'future-discovery-scope' },
      { NODE_ENV: 'aura-student360-discovery' },
      { NODE_ENV: 'aura-exercise-catalog-discovery' },
    ]) assert.equal(shouldUseWeeklyReadRuntime({ FUNCTION_TARGET: target, ...forbidden }), false)
  }
  for (const environment of [
    {}, { FUNCTION_TARGET: 'getPtScheduleWorkspaceRegional' },
    { FUNCTION_TARGET: 'getPtScheduleWeeklyViewRegional ' },
    { FUNCTION_TARGET: 'getptscheduleweeklyviewregional' },
    { FUNCTION_TARGET: '__proto__' },
    { FIREBASE_FUNCTION_TARGET: 'getPtScheduleWeeklyViewRegional' },
  ]) {
    assert.equal(shouldUseWeeklyReadRuntime(environment), false)
    assert.throws(() => loadWeeklyReadRuntime(environment), /explicitly allowlisted runtime target/)
  }
})

test('normal, unknown-target and control-API discovery expose the unchanged complete manifest', () => {
  const baseline = probe()
  assert.equal(baseline.exportNames.length, 518)
  assert.equal(baseline.exportNames.includes('cleanupOperationsDashboardCache'), false)
  assert.equal(baseline.exportNames.includes('syncPtContractUsageProjection'), false)
  assert.equal(baseline.exportNames.includes('syncSessionContractUsageView'), true)
  for (const environment of [
    { FUNCTION_TARGET: 'getPtScheduleWorkspaceRegional' },
    { FUNCTION_TARGET: 'getPtScheduleWeeklyViewRegional', FUNCTIONS_CONTROL_API: 'true' },
  ]) {
    const actual = probe({ environment })
    assert.deepEqual(actual.exportNames, baseline.exportNames)
    assert.deepEqual(actual.handlers, baseline.handlers)
  }
})

test('existing scoped discovery stays scoped even if the parent has an allowlisted target', () => {
  for (const environment of [
    { AURA_FIREBASE_DISCOVERY_SCOPE: 'student360' },
    { NODE_ENV: 'aura-exercise-catalog-discovery' },
  ]) {
    const baseline = probe({ environment })
    const actual = probe({ environment: { ...environment, FUNCTION_TARGET: 'getPtScheduleWeeklyViewRegional' } })
    assert.deepEqual(actual.exportNames, baseline.exportNames)
    assert.ok(actual.exportNames.length > 400)
    assert.deepEqual(actual.handlers, baseline.handlers)
  }
})

test('aggregate writer manifests cap instances at two while preserving retry and exact event sources', () => {
  const full = probe()
  for (const [name, document] of Object.entries(AGGREGATE_TARGETS)) {
    const endpoint = full.handlers[name].endpoint
    assert.equal(endpoint.maxInstances, 2)
    assert.equal(endpoint.eventTrigger.retry, true)
    assert.deepEqual(endpoint.region, ['asia-southeast1'])
    assert.equal(endpoint.eventTrigger.eventFilters.database, CANONICAL_DATABASE)
    assert.equal(endpoint.eventTrigger.eventFilterPathPatterns.document, document)
  }
})

test('both lean readers retain real SDK metadata and transport security options', () => {
  for (const enforced of ['true', 'false']) {
    const full = probe({ environment: { ENFORCE_APP_CHECK: enforced } })
    for (const target of WEEKLY_READ_TARGETS) {
      const lean = probe({ environment: { FUNCTION_TARGET: target, ENFORCE_APP_CHECK: enforced } })
      assert.deepEqual(lean.exportNames, [target])
      assert.deepEqual(lean.handlers[target], full.handlers[target])
      const options = lean.handlers[target].callableOptions
      assert.equal(options.invoker, 'public')
      assert.equal(options.enforceAppCheck, enforced === 'true')
      assert.equal(options.region, 'asia-east1')
      assert.equal(options.cpu, 'gcf_gen1')
      assert.equal(options.maxInstances, 2)
      assert.equal(options.concurrency, 1)
      assert.equal(options.timeoutSeconds, 120)
      assert.ok(lean.localModules.includes('pt-schedule-v2.js'), 'Reuse the canonical scheduleActor, not duplicated authorization')
      for (const omitted of ['nutrition.js', 'generative-ai.js', 'payroll.js', 'loyalty.js', 'operations-dashboard.js', 'student-360.js', 'eat-clean.js']) {
        assert.ok(!lean.localModules.includes(omitted), `${omitted} must not initialize for a weekly read`)
      }
      assert.deepEqual(lean.databaseIds, [CANONICAL_DATABASE])
    }
  }
})

test('lean runtime uses the configured database override without changing authorization', () => {
  const output = probe({ environment: {
    FUNCTION_TARGET: 'getPtScheduleWeeklyViewRegional',
    FIRESTORE_DATABASE_ID: 'runtime-test-database',
  } })
  assert.deepEqual(output.databaseIds, ['runtime-test-database'])
})

test('both runtime readers preserve canonical authorization failures before reading the weekly view', () => {
  const documents = {
    [VIEW_PATH]: cleanView(),
    'users/disabled': { role: 'admin', disabled: true },
    'roleAssignments/disabled': assignment('admin'),
    'users/wrong-branch': { role: 'manager' },
    'roleAssignments/wrong-branch': assignment('staff', ['branch_manager'], ['branch-b']),
    'users/student': { role: 'student' },
    'roleAssignments/student': assignment('student'),
    'users/stale-claims': { role: 'admin' },
    'roleAssignments/stale-claims': assignment('admin'),
  }
  const requests = [
    { call: { data: { branchId: BRANCH, weekId: WEEK } } },
    { call: authenticatedCall('disabled', 'admin') },
    { call: authenticatedCall('wrong-branch', 'staff') },
    { call: authenticatedCall('student', 'student') },
    { call: authenticatedCall('stale-claims', 'admin', { authzVersion: 99 }) },
    { call: authenticatedCall('missing-profile', 'admin') },
  ]
  const full = probe({ documents, requests })
  for (const target of WEEKLY_READ_TARGETS) {
    const lean = probe({ environment: { FUNCTION_TARGET: target }, selectedName: target, documents, requests })
    assert.deepEqual(lean.results, full.results)
    assert.deepEqual(lean.results.map((result) => result.code), [
      'unauthenticated', 'permission-denied', 'permission-denied',
      'permission-denied', 'permission-denied', 'permission-denied',
    ])
    assert.ok(!lean.reads.includes(VIEW_PATH))
    assert.deepEqual(lean.results[0].reads, [])
    assert.deepEqual(lean.queries, [])
    assert.equal(lean.transactions, 0)
  }
})

test('clean pointer reads serve one weekly payload and small control, retain live account checks and never fan out', () => {
  const documents = {
    [VIEW_PATH]: cleanView(),
    'users/admin': { role: 'admin', disabled: false },
    'roleAssignments/admin': assignment('admin'),
    'users/manager': { role: 'manager', disabled: false },
    'roleAssignments/manager': assignment('staff', ['branch_manager'], [BRANCH]),
  }
  const requests = [
    { call: authenticatedCall('admin', 'admin') },
    { call: authenticatedCall('manager', 'staff') },
    {
      call: authenticatedCall('admin', 'admin'),
      documentUpdates: { 'users/admin': { role: 'admin', disabled: true } },
    },
  ]
  const full = probe({ documents, requests })
  for (const target of WEEKLY_READ_TARGETS) {
    const lean = probe({ environment: { FUNCTION_TARGET: target }, selectedName: target, documents, requests })
    assert.deepEqual(lean.results, full.results)
    for (let index = 0; index < 2; index += 1) {
      const result = lean.results[index]
      assert.equal(result.ok, true)
      assert.equal(result.value.viewRevision, 12)
      assert.equal(result.value.validationSnapshot.storage, 'top_level')
      assert.equal(result.value.validationState, 'current')
      assert.equal(result.value.validationDirty, false)
      assert.equal(result.value.coverage.verified, true)
      assert.deepEqual(result.value.students, cleanView().students)
      assert.deepEqual(result.reads.filter((entry) => entry.startsWith('ptScheduleWeeklyViews/')), [VIEW_PATH])
      assert.equal(result.reads.length, 4, 'Only account, role assignment, weekly snapshot and small control are read')
    }
    assert.equal(lean.results[2].code, 'permission-denied')
    assert.deepEqual(lean.results[2].reads, ['users/admin'], 'Cached assignment must not hide a newly disabled account')
    assert.deepEqual(lean.queries, [])
    assert.deepEqual(lean.writes, [])
    assert.equal(lean.transactions, 0)
  }
})

test('legacy draft-only reads queue validation once with metadata only in full and lean runtimes', () => {
  const legacy = cleanView({ readMode: 'display', partial: true, contracts: [] })
  delete legacy.validationSnapshot
  delete legacy.validationState
  delete legacy.validationDirty
  assert.equal(legacy.verification, 'draft_only')
  assert.equal(legacy.coverage.verified, false)
  const documents = {
    [VIEW_PATH]: legacy,
    'users/admin': { role: 'admin', disabled: false },
    'roleAssignments/admin': assignment('admin'),
  }
  const requests = Array.from({ length: 3 }, () => ({ call: authenticatedCall('admin', 'admin') }))
  const input = { documents, requests, allowMetadataTransactions: true }
  const full = probe(input)
  for (const target of WEEKLY_READ_TARGETS) {
    const lean = probe({ ...input, environment: { FUNCTION_TARGET: target }, selectedName: target })
    assert.deepEqual(lean.results, full.results)
    assert.deepEqual(lean.writes, full.writes)
    for (const result of lean.results) {
      assert.equal(result.ok, true)
      assert.equal(result.value.viewRevision, 12)
      assert.equal(result.value.verification, 'draft_only')
      assert.equal(result.value.validationSnapshot, null)
      assert.equal(result.value.validationState, 'unknown')
      assert.equal(result.value.validationDirty, true)
      assert.equal(result.value.coverage.verified, false)
      assert.deepEqual(result.value.schedule, legacy.schedule)
      assert.deepEqual(result.value.students, legacy.students)
    }
    assert.equal(lean.results[0].reads.length, 6, 'One queue transaction rechecks payload/control after authorization and initial read')
    for (const result of lean.results.slice(1)) {
      assert.deepEqual(result.reads, ['users/admin', VIEW_PATH, STATE_PATH], 'Already queued snapshots require only live account, payload and control reads')
    }
    assert.equal(lean.transactions, 1)
    assert.deepEqual(lean.writes.map(write => ({ ...write, value: { ...write.value, updatedAt: undefined } })), [{
      path: STATE_PATH,
      value: { schemaVersion: 1, branchId: BRANCH, weekId: WEEK, validationDirty: true, updatedAt: undefined },
      options: { merge: true },
    }])
    assert.deepEqual(lean.queries, [])
  }
})

test('missing, dirty, legacy and metadata-only snapshots still enter the canonical rebuild path', () => {
  const documents = {
    'users/admin': { role: 'admin', disabled: false },
    'roleAssignments/admin': assignment('admin'),
  }
  const requests = [
    { call: authenticatedCall('admin', 'admin') },
    {
      call: authenticatedCall('admin', 'admin'),
      documentUpdates: { [VIEW_PATH]: { ...cleanView(), dirty: true } },
    },
    {
      call: authenticatedCall('admin', 'admin'),
      documentUpdates: { [VIEW_PATH]: { ...cleanView(), schemaVersion: 1 } },
    },
    {
      call: authenticatedCall('admin', 'admin'),
      documentUpdates: { [VIEW_PATH]: { branchId: BRANCH, weekId: WEEK, schemaVersion: 2, dirty: true } },
    },
    {
      call: authenticatedCall('admin', 'admin'),
      documentUpdates: { [VIEW_PATH]: cleanView() },
    },
  ]
  const full = probe({ documents, requests })
  for (const target of WEEKLY_READ_TARGETS) {
    const lean = probe({ environment: { FUNCTION_TARGET: target }, selectedName: target, documents, requests })
    assert.deepEqual(lean.results, full.results)
    assert.deepEqual(lean.results.slice(0, 4).map((result) => result.code), Array(4).fill('probe-rebuild-required'))
    assert.equal(lean.results[4].ok, true)
    assert.equal(lean.transactions, 4)
  }
})
