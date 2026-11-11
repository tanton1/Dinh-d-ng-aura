'use strict'

// The resource profiles pinned here were chosen from a week of production
// measurements (04–11/11/2026, docs/operations/SYSTEM_AUDIT_2026-11-11.md).
// The real Firebase wrappers and the real entry point run in a fresh process
// with networking blocked, so every value is the one a deploy would send.
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

const PROBE_SOURCE = `
const names = JSON.parse(process.env.AURA_CAPACITY_PROBE);
function block(kind) { return () => { throw new Error('Unexpected network: ' + kind); }; }
for (const name of ['node:http', 'node:https']) {
  const api = require(name); api.request = block(name + '.request'); api.get = block(name + '.get');
}
require('node:net').Socket.prototype.connect = block('net.connect');
global.fetch = block('fetch');
const entry = require('./index');
const profile = (endpoint) => endpoint ? {
  region: endpoint.region, cpu: endpoint.cpu, memoryMb: endpoint.availableMemoryMb, concurrency: endpoint.concurrency,
  minInstances: endpoint.minInstances, maxInstances: endpoint.maxInstances, timeoutSeconds: endpoint.timeoutSeconds,
  retry: endpoint.eventTrigger ? endpoint.eventTrigger.retry : undefined,
} : null;
console.log('CAPACITY_PROBE:' + JSON.stringify(Object.fromEntries(names.map((name) => [name, profile(entry[name] && entry[name].__endpoint)]))));
`

// Unset options serialise as null: the platform default applies (256 MiB, and
// one request per instance whenever the CPU is fractional).
const EAST = ['asia-east1']
const SOUTHEAST = ['asia-southeast1']
const EXPECTED = {
  // Hot reads moved to a full vCPU. On 1/6 vCPU their medians were 2.1–2.3 s.
  getPtScheduleWeeklyViewRegional: { region: EAST, cpu: 1, memoryMb: 512, concurrency: 1, minInstances: null, maxInstances: 2, timeoutSeconds: 120 },
  getPtScheduleWeeklyView: { region: EAST, cpu: 1, memoryMb: 512, concurrency: 1, minInstances: null, maxInstances: 2, timeoutSeconds: 120 },
  getMyTrainerWorkspaceRegional: { region: EAST, cpu: 1, memoryMb: 512, concurrency: 8, minInstances: null, maxInstances: 3, timeoutSeconds: 120 },
  getMyPerformanceScoreV2: { region: EAST, cpu: 1, memoryMb: 512, concurrency: 1, minInstances: null, maxInstances: 2, timeoutSeconds: 120 },
  // Memory only: these two ran at 88–89% of 256 MiB at p99. The Gen-1 CPU
  // share follows the memory, 1/3 vCPU at 512 MiB.
  listMyStudentPtScheduleRegional: { region: EAST, cpu: 'gcf_gen1', memoryMb: 512, concurrency: 1, minInstances: null, maxInstances: 2, timeoutSeconds: 120 },
  refreshContractRenewalQueueScheduled: { region: SOUTHEAST, cpu: 'gcf_gen1', memoryMb: 512, concurrency: null, minInstances: null, maxInstances: 1, timeoutSeconds: 540 },
  // Ran out of 256 MiB once and used 93% of it at p99 (28/10–11/11/2026).
  listBusinessPerformanceRegional: { region: EAST, cpu: 'gcf_gen1', memoryMb: 512, concurrency: 1, minInstances: null, maxInstances: 2, timeoutSeconds: 120 },
  listBusinessPerformance: { region: SOUTHEAST, cpu: 'gcf_gen1', memoryMb: 512, concurrency: 1, minInstances: null, maxInstances: 2, timeoutSeconds: null },
  // Triggers that turned away 23% and 43% of their events during bursts.
  processStudent360SourceQueue: { region: SOUTHEAST, cpu: 'gcf_gen1', memoryMb: null, concurrency: null, minInstances: null, maxInstances: 6, timeoutSeconds: 540, retry: true },
  syncPtScheduleWeeklyViewFromSession: { region: SOUTHEAST, cpu: 0.25, memoryMb: null, concurrency: 1, minInstances: null, maxInstances: 3, timeoutSeconds: null, retry: true },
}
// Neighbours built by the same factories that must keep the fractional,
// quota-safe profile: only the measured hot paths were changed.
const UNCHANGED = {
  rebuildPtScheduleWeeklyViewRegional: { region: EAST, cpu: 'gcf_gen1', memoryMb: null, concurrency: 1, minInstances: null, maxInstances: 2, timeoutSeconds: 120 },
  markPtScheduleWeeklyViewDirtyRegional: { region: EAST, cpu: 'gcf_gen1', memoryMb: null, concurrency: 1, minInstances: null, maxInstances: 2, timeoutSeconds: 120 },
  getPtScheduleWorkspaceRegional: { region: EAST, cpu: 'gcf_gen1', memoryMb: null, concurrency: 1, minInstances: null, maxInstances: 2, timeoutSeconds: 120 },
  getMyCoachWorkspaceScopeRegional: { region: EAST, cpu: 'gcf_gen1', memoryMb: null, concurrency: 1, minInstances: null, maxInstances: 2, timeoutSeconds: 120 },
  listMyTrainerScheduleRegional: { region: EAST, cpu: 'gcf_gen1', memoryMb: null, concurrency: 1, minInstances: null, maxInstances: 2, timeoutSeconds: 120 },
  getMyTrainerWorkspace: { region: SOUTHEAST, cpu: 1, memoryMb: null, concurrency: 24, minInstances: null, maxInstances: 6, timeoutSeconds: null },
  listMyStudentPtSchedule: { region: SOUTHEAST, cpu: 1, memoryMb: null, concurrency: 24, minInstances: null, maxInstances: 6, timeoutSeconds: null },
  listStudentTrainingHistoryRegional: { region: EAST, cpu: 'gcf_gen1', memoryMb: null, concurrency: 1, minInstances: null, maxInstances: 2, timeoutSeconds: 120 },
  getStudentContractUsageRegional: { region: EAST, cpu: 'gcf_gen1', memoryMb: null, concurrency: 1, minInstances: null, maxInstances: 2, timeoutSeconds: 120 },
  listMyPerformanceEvidenceV2: { region: EAST, cpu: 'gcf_gen1', memoryMb: 256, concurrency: 1, minInstances: null, maxInstances: 1, timeoutSeconds: 120 },
  getPerformanceStaffScoreV2: { region: EAST, cpu: 'gcf_gen1', memoryMb: 256, concurrency: 1, minInstances: null, maxInstances: 1, timeoutSeconds: 120 },
  recoverStudent360SourceQueueScheduled: { region: SOUTHEAST, cpu: 'gcf_gen1', memoryMb: null, concurrency: null, minInstances: null, maxInstances: 1, timeoutSeconds: 540 },
  syncPtScheduleWeeklyViewFromDraft: { region: SOUTHEAST, cpu: 0.25, memoryMb: null, concurrency: 1, minInstances: null, maxInstances: 1, timeoutSeconds: null, retry: true },
  syncPtScheduleWeeklyViewFromContractUsage: { region: SOUTHEAST, cpu: 0.25, memoryMb: null, concurrency: 1, minInstances: null, maxInstances: 2, timeoutSeconds: null, retry: true },
}

function probe(names) {
  const env = { ...process.env }
  for (const key of ['FUNCTION_TARGET', 'FUNCTIONS_CONTROL_API', 'AURA_FIREBASE_DISCOVERY_SCOPE', 'NODE_ENV', 'FIRESTORE_DATABASE_ID',
    'ENFORCE_APP_CHECK', 'ENFORCE_AI_APP_CHECK', 'FIREBASE_DATABASE_URL', 'GOOGLE_APPLICATION_CREDENTIALS']) delete env[key]
  Object.assign(env, {
    GCLOUD_PROJECT: 'demo-aura-capacity-profile', GOOGLE_CLOUD_PROJECT: 'demo-aura-capacity-profile',
    FIREBASE_CONFIG: JSON.stringify({ projectId: 'demo-aura-capacity-profile' }),
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:9',
    AURA_CAPACITY_PROBE: JSON.stringify(names),
  })
  const result = spawnSync(process.execPath, ['-e', PROBE_SOURCE], { cwd: __dirname, env, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr + '\n' + result.stdout)
  const line = result.stdout.split(/\r?\n/).find((value) => value.startsWith('CAPACITY_PROBE:'))
  assert.ok(line, result.stdout)
  return JSON.parse(line.slice('CAPACITY_PROBE:'.length))
}

test('measured hot paths deploy with their chosen capacity and their neighbours stay fractional', () => {
  const actual = probe([...Object.keys(EXPECTED), ...Object.keys(UNCHANGED)])
  for (const [name, expected] of Object.entries({ ...EXPECTED, ...UNCHANGED })) assert.deepEqual(actual[name], expected, name)
  // None of them may keep a paid idle instance: scale to zero is what kept the
  // baseline at 30–45 thousand vCPU-seconds a day.
  for (const [name, profile] of Object.entries(actual)) assert.equal(profile.minInstances, null, name)
  // A fractional CPU cannot serve two requests at once; Cloud Run rejects the deploy.
  for (const [name, profile] of Object.entries(actual)) {
    if (profile.cpu !== 1) assert.ok(profile.concurrency === null || profile.concurrency === 1, name)
  }
  // The full-vCPU overflow callables can together hold 9 of the 20 vCPU of
  // the asia-east1 quota when every one of them is at its instance cap.
  const reserved = Object.values(actual)
    .filter((profile) => profile.region[0] === 'asia-east1' && profile.cpu === 1)
    .reduce((total, profile) => total + profile.maxInstances, 0)
  assert.equal(reserved, 9)
})
