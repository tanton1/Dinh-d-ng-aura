'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const { createOperationsDashboardFunctions } = require('./operations-dashboard')
const { createStudent360Functions, OVERVIEW_SCHEMA_VERSION } = require('./student-360')
const { createContractRenewalFunctions } = require('./contract-renewals')
const { createContractRenewalRegionalFunctions, RENEWAL_CONFIRMATION_OPTIONS } = require('./contract-renewal-regional')
const { shouldSampleMetric } = require('./observability')
const { withOperationMetrics } = require('./operation-metrics')
const { readDashboardQuery, observedDashboardRead } = require('./operations-dashboard-read-policy')
const sampledId = Array.from({ length: 100 }, (_, index) => `coverage-sample-${index}`).find(id => shouldSampleMetric(id, .1))
const request = (data = {}) => ({ auth: { uid: 'PRIVATE_ACTOR', token: { role: 'admin' } }, data: { correlationId: sampledId, ...data } })
function loggerFixture() {
  const logs = []
  return { logs, logger: Object.fromEntries(['info', 'warn', 'error'].map(level => [level, (message, value) => logs.push({ level, message, value })])) }
}
const onCall = (options, handler) => ({ options, handler })
const metricEvents = logs => logs.filter(log => log.message === 'Aura function metric')
const snap = value => ({ exists: value !== undefined, data: () => value })

test('canonical handlers and regional aliases retain options and log exactly one AUTH failure without accessing Firestore', async () => {
  const { logs, logger } = loggerFixture()
  const db = new Proxy({}, { get() { throw Error('Unauthorized request must not access Firestore') } })
  const regionalCall = (options, handler) => onCall({ region: 'asia-east1', invoker: 'public', ...options }, handler)
  const canonicalDashboard = createOperationsDashboardFunctions({ db, logger, onCall }).getOperationsDashboard
  const regionalDashboard = createOperationsDashboardFunctions({ db, logger, onCall: regionalCall, dashboardCallOptions: { memory: '512MiB', cpu: 1, maxInstances: 1, concurrency: 4, timeoutSeconds: 120 } }).getOperationsDashboard
  const canonicalStudent = createStudent360Functions({ db, logger, onCall }).getStudent360Overview
  const regionalStudent = createStudent360Functions({ db, logger, onCall: regionalCall }).getStudent360Overview
  const canonicalRenewal = createContractRenewalFunctions({ db, logger, onCall }).renewPtContract
  const regionalRenewal = createContractRenewalRegionalFunctions({ db, logger, onCall }).renewPtContractRegional
  assert.deepEqual(canonicalDashboard.options, { memory: '512MiB', cpu: 1, maxInstances: 1, concurrency: 8 })
  assert.deepEqual(regionalDashboard.options, { region: 'asia-east1', invoker: 'public', memory: '512MiB', cpu: 1, maxInstances: 1, concurrency: 4, timeoutSeconds: 120 })
  assert.deepEqual(canonicalStudent.options, { cpu: 'gcf_gen1', concurrency: 1, maxInstances: 8, invoker: 'public' })
  assert.deepEqual(regionalStudent.options, { region: 'asia-east1', ...canonicalStudent.options })
  assert.deepEqual(canonicalRenewal.options, { cpu: 'gcf_gen1', concurrency: 1, maxInstances: 2, invoker: 'public' })
  assert.deepEqual(regionalRenewal.options, RENEWAL_CONFIRMATION_OPTIONS)
  for (const [endpoint, operation] of [[canonicalDashboard, 'getOperationsDashboard'], [regionalDashboard, 'getOperationsDashboard'],
    [canonicalStudent, 'getStudent360Overview'], [regionalStudent, 'getStudent360Overview'], [canonicalRenewal, 'renewPtContract'], [regionalRenewal, 'renewPtContract']]) {
    const before = metricEvents(logs).length
    await assert.rejects(endpoint.handler({ data: { sourceId: 'PRIVATE_SOURCE', correlationId: 'PRIVATE_CORRELATION' } }), { code: 'unauthenticated' })
    const events = metricEvents(logs)
    assert.equal(events.length, before + 1); assert.equal(events.at(-1).value.operation, operation)
    assert.equal(events.at(-1).value.authenticated, false); assert.equal(events.at(-1).value.errorCode, 'AUTH')
    assert.deepEqual(events.at(-1).value.metrics, {})
  }
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE_|actorUid|sourceId|correlationId/)
})

test('Student360 fresh projection hit has measured age, only actual projection reads, and still rejects a disabled actor', async () => {
  const { logs, logger } = loggerFixture(), reads = []
  const weekId = '2026-10-26'
  const projection = { schemaVersion: OVERVIEW_SCHEMA_VERSION, generatedAtMillis: Date.now(),
    identity: { branchId: null, name: 'PRIVATE_PERSON' }, assignments: { trainerIds: [], nutritionCoachIds: [], salesIds: [], scheduledTrainerIds: [] },
    contract: {}, schedule: { weekId }, alerts: [], nextActions: [], health: null }
  const data = new Map([['users/PRIVATE_ACTOR', { role: 'admin', displayName: 'PRIVATE_ADMIN' }], ['studentOperationalViews/PRIVATE_STUDENT', projection]])
  const db = { doc: path => ({ get: async () => { reads.push(path); return snap(data.get(path)) } }) }
  const endpoint = createStudent360Functions({ db, logger, onCall }).getStudent360Overview
  const first = await endpoint.handler(request({ studentId: 'PRIVATE_STUDENT', weekId }))
  const second = await endpoint.handler(request({ studentId: 'PRIVATE_STUDENT', weekId }))
  assert.equal(first.identity.name, projection.identity.name); assert.deepEqual(second, first)
  assert.equal(first.cache.hit, true, 'this is projection freshness, not a count of avoided Firestore reads')
  const events = metricEvents(logs)
  assert.equal(events.length, 2)
  assert.equal(events[0].value.metrics.logicalQueries, 1); assert.equal(events[0].value.metrics.documentsReturned, 1)
  assert.equal(events[1].value.metrics.logicalQueries, undefined)
  assert.equal(events[1].value.metrics.documentsReturned, undefined)
  assert.equal(events[0].value.metrics.cacheHits, 1); assert.equal(events[1].value.metrics.cacheHits, 1)
  assert.ok(events[0].value.metrics.projectionAgeMs >= 0)
  assert.equal(reads.filter(path => path.startsWith('studentOperationalViews/')).length, 1)
  data.set('users/PRIVATE_ACTOR', { role: 'admin', disabled: true })
  await assert.rejects(endpoint.handler(request({ studentId: 'PRIVATE_STUDENT', weekId })), { code: 'permission-denied' })
  assert.equal(metricEvents(logs).at(-1).value.errorCode, 'PERMISSION')
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE_|actorUid|sourceId|correlationId/)
})

test('renewal regional handler retains idempotent transaction result identity, error identity and no retry with a failing log sink', async () => {
  const sourceId = 'PRIVATE_SOURCE', idempotencyKey = 'PRIVATE_IDEMPOTENCY'
  let transactions = 0, transactionResult, failure
  const records = new Map([
    [`contracts/${sourceId}`, { status: 'active', renewalIdempotencyKey: idempotencyKey, renewedByContractId: 'PRIVATE_RENEWED' }],
    ['packages/package', { status: 'active' }], ['contractRenewalCases/case', { sourceContractId: sourceId }],
  ])
  const db = {
    doc: path => ({ path, id: path.split('/').at(-1) }), collection: name => ({ doc: () => ({ path: `${name}/new`, id: 'new' }) }),
    runTransaction: async callback => {
      transactions++
      if (failure) throw failure
      transactionResult = await callback({ get: async reference => snap(records.get(reference.path)), create: assert.fail, set: assert.fail, update: assert.fail })
      return transactionResult
    },
  }
  const logger = { info() { throw Error('sink down') }, error() { return Promise.reject(Error('sink down')) } }
  const resolveActor = async () => ({ uid: 'PRIVATE_ACTOR', accessRole: 'admin', renewalScope: 'system', renewalCanSell: true })
  const endpoint = createContractRenewalRegionalFunctions({ db, logger, onCall, resolveActor }).renewPtContractRegional
  const input = { caseId: 'case', sourceContractId: sourceId, packageId: 'package', startDate: '2026-10-30', idempotencyKey }
  const result = await endpoint.handler(request(input))
  assert.equal(result, transactionResult); assert.deepEqual(result, { contractId: 'PRIVATE_RENEWED', paymentEntryId: null, unchanged: true })
  assert.equal(transactions, 1)
  failure = Object.assign(new Error('PRIVATE_FAILURE'), { code: 'unavailable' })
  await assert.rejects(endpoint.handler(request(input)), error => error === failure)
  assert.equal(transactions, 2, 'one caller request adds exactly one transaction attempt, with no telemetry retry')
  await new Promise(resolve => setImmediate(resolve))
})

test('scoped dashboard metrics count executed chunks and never report aggregate counts as returned documents', async () => {
  let queries = 0
  const query = { select() { return this }, where() { return this }, limit(maximum) { assert.ok(maximum <= 50); return this },
    async get() { queries++; return { docs: [{ id: `row-${queries}` }], size: 1 } } }
  const rows = await withOperationMetrics(async metrics => {
    const result = await readDashboardQuery(query, { field: 'branchId', ids: Array.from({ length: 31 }, (_, i) => String(i)) }, 50)
    assert.equal(result.size, 2)
    return { ...metrics }
  })
  assert.deepEqual(rows, { logicalQueries: 2, documentsReturned: 2 }); assert.equal(queries, 2)
  const count = await withOperationMetrics(async metrics => {
    const aggregate = { data: () => ({ count: 99999 }) }
    assert.equal(await observedDashboardRead(Promise.resolve(aggregate)), aggregate)
    return { ...metrics }
  })
  assert.deepEqual(count, { logicalQueries: 1 })
  await withOperationMetrics(async metrics => {
    assert.equal((await readDashboardQuery(query, { field: 'branchId', ids: [] }, 50)).size, 0)
    assert.deepEqual(metrics, {}, 'no executed query means unknown observations stay absent')
  })
})
