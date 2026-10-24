'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { createRegionalOperationsAggregateFunctions, REGIONAL_AGGREGATE_TARGETS, REGIONAL_AGGREGATE_OPTIONS } = require('./operations-aggregate-regional')

const databaseId = 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7'
const noDatabase = new Proxy({}, { get() { throw new Error('Unexpected database access') } })
const captureTrigger = (options, handler) => ({ options, handler })
const expected = [
  ['syncOpsLedgerDailyAggregateRegional', 'ledger', 'ledgerEntries/{entryId}', 'asia-east1'],
  ['syncOpsAttendanceDailyAggregateRegional', 'attendance', 'attendanceEvents/{eventId}', 'asia-southeast2'],
  ['syncOpsSessionDailyAggregateRegional', 'session', 'sessions/{sessionId}', 'asia-southeast2'],
  ['syncOpsContractDailyAggregateRegional', 'contract', 'contracts/{contractId}', 'asia-southeast2'],
  ['syncOpsStudentDailyAggregateRegional', 'student', 'students/{studentId}', 'asia-southeast2'],
]

test('only the five approved aggregate consumers are exported with unchanged bounded runtime resources', () => {
  assert.deepEqual(REGIONAL_AGGREGATE_TARGETS.map(({ name, source, document, region }) => [name, source, document, region]), expected)
  const functions = createRegionalOperationsAggregateFunctions({ db: noDatabase, databaseId, onDocumentWritten: captureTrigger })
  assert.deepEqual(Object.keys(functions), expected.map(([name]) => name))
  for (const [name, , document, region] of expected) {
    assert.deepEqual(functions[name].options, { ...REGIONAL_AGGREGATE_OPTIONS, document, database: databaseId, region })
    assert.ok(name.toLowerCase().length + 3 <= 46, 'keep room for the reviewed zero-traffic readiness tag')
  }
  assert.deepEqual(REGIONAL_AGGREGATE_OPTIONS, { cpu: 1, memory: '256MiB', minInstances: 0, maxInstances: 2, concurrency: 80, retry: true })
  assert.equal(functions.rebuildOperationsDashboardAggregatesScheduled, undefined)
})

test('every alias delegates the original event and shared DB to the same transactional core', async () => {
  const calls = []
  const logger = { info() {} }
  const functions = createRegionalOperationsAggregateFunctions({
    db: noDatabase, databaseId, logger, onDocumentWritten: captureTrigger,
    synchronize: async (input) => { calls.push(input); return { updated: 7 } },
  })
  for (const [name, source] of expected) {
    const event = { id: 'same-old-and-new-delivery', location: 'asia-southeast1', database: databaseId, data: {} }
    assert.deepEqual(await functions[name].handler(event), { updated: 7 })
    assert.equal(calls.at(-1).event, event)
    assert.equal(calls.at(-1).db, noDatabase)
    assert.equal(calls.at(-1).logger, logger)
    assert.equal(calls.at(-1).source, source)
  }
})

test('real Firebase SDK metadata preserves Firestore filters and does not expose an HTTP/callable or scheduler', () => {
  const functions = createRegionalOperationsAggregateFunctions({ db: noDatabase, databaseId, onDocumentWritten })
  for (const [name, , document, region] of expected) {
    const endpoint = functions[name].__endpoint
    assert.deepEqual(endpoint.region, [region])
    assert.equal(endpoint.eventTrigger.eventType, 'google.cloud.firestore.document.v1.written')
    assert.equal(endpoint.eventTrigger.eventFilters.database, databaseId)
    assert.equal(endpoint.eventTrigger.eventFilters.namespace, '(default)')
    assert.equal(endpoint.eventTrigger.eventFilterPathPatterns.document, document)
    assert.equal(endpoint.eventTrigger.retry, true)
    // Do not accidentally set Eventarc's location to the compute location.
    // firebase-tools resolves this omitted field from database.locationId.
    assert.equal(endpoint.eventTrigger.region, undefined)
    assert.equal(endpoint.callableTrigger, undefined)
    assert.equal(endpoint.httpsTrigger, undefined)
    assert.equal(endpoint.scheduleTrigger, undefined)
    assert.equal(endpoint.minInstances, 0)
    assert.equal(endpoint.maxInstances, 2)
    assert.equal(endpoint.cpu, 1)
    assert.equal(endpoint.availableMemoryMb, 256)
    assert.equal(endpoint.concurrency, 80)
  }
})

test('production handler preserves the zero-read metadata no-op on all five aliases', async () => {
  const functions = createRegionalOperationsAggregateFunctions({ db: noDatabase, databaseId, onDocumentWritten: captureTrigger })
  for (const [name] of expected) {
    const value = { status: 'scheduled', date: '2026-10-23', branchId: 'branch-one' }
    const snapshot = data => ({ exists: true, data: () => data })
    const result = await functions[name].handler({ data: { before: snapshot(value), after: snapshot({ ...value, updatedAt: 123 }) } })
    assert.deepEqual(result, { updated: 0 })
  }
})

test('only regional aggregate triggers are registered while the one SG scheduler remains unchanged', () => {
  const source = readFileSync(join(__dirname, 'index.js'), 'utf8')
  assert.doesNotMatch(source, /operationsAggregateTriggerOptions/)
  for (const [name, kind] of expected) {
    const original = `syncOperations${kind[0].toUpperCase()}${kind.slice(1)}DailyAggregate`
    assert.doesNotMatch(source, new RegExp(`exports\\.${original}\\b`))
    assert.equal((source.match(new RegExp(`exports\\.${name} = regionalOperationsAggregateFunctions\\.${name}\\b`, 'g')) || []).length, 1)
  }
  assert.equal((source.match(/exports\.rebuildOperationsDashboardAggregatesScheduled = onSchedule\(/g) || []).length, 1)
  const scheduler = source.match(/exports\.rebuildOperationsDashboardAggregatesScheduled = onSchedule\(\{[\s\S]*?days: 366 \}\)\)/)?.[0]
  assert.equal(scheduler?.replace(/\r\n/g, '\n'), `exports.rebuildOperationsDashboardAggregatesScheduled = onSchedule({
  schedule: '15 1 * * *',
  region: 'asia-southeast1',
  timeZone: 'Asia/Ho_Chi_Minh',
  retryCount: 1,
  maxInstances: 1,
  timeoutSeconds: 540,
  memory: '1GiB',
}, async () => rebuildOperationsDailyAggregates({ db, logger, days: 366 }))`)
})

test('missing database configuration is rejected before registering a trigger', () => {
  assert.throws(() => createRegionalOperationsAggregateFunctions({ db: noDatabase, onDocumentWritten: captureTrigger }), /named database/)
})
