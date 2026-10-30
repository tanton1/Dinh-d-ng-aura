'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { domainForOperation, errorTaxonomy, retryableError } = require('./observability')
const { withPrivateFunctionTelemetry } = require('./observability')
const { recordOperationMetrics } = require('./operation-metrics')

test('observability maps callable failures to the Aura error taxonomy', () => {
  assert.equal(errorTaxonomy('functions/unauthenticated'), 'AUTH')
  assert.equal(errorTaxonomy('permission-denied'), 'PERMISSION')
  assert.equal(errorTaxonomy('invalid-argument'), 'VALIDATION')
  assert.equal(errorTaxonomy('failed-precondition'), 'BUSINESS_RULE')
  assert.equal(errorTaxonomy('aborted'), 'CONFLICT')
  assert.equal(errorTaxonomy('deadline-exceeded'), 'TIMEOUT')
  assert.equal(errorTaxonomy('unavailable'), 'DEPENDENCY')
  assert.equal(errorTaxonomy('unknown'), 'INTERNAL')
})

test('observability identifies retryable infrastructure errors', () => {
  assert.equal(retryableError('unavailable'), true)
  assert.equal(retryableError('deadline-exceeded'), true)
  assert.equal(retryableError('permission-denied'), false)
})

test('operation names receive stable domain labels', () => {
  assert.equal(domainForOperation('getStudent360Overview'), 'student360')
  assert.equal(domainForOperation('reconcileContractUsage'), 'contract')
  assert.equal(domainForOperation('listOperationalActions'), 'action')
  assert.equal(domainForOperation('saveMealReview'), 'nutrition')
})

test('sales, finance and people operations receive product domains', () => {
  assert.equal(domainForOperation('createSalesQuote'), 'sales')
  assert.equal(domainForOperation('postFinanceLedgerEntry'), 'finance')
  assert.equal(domainForOperation('getMyPerformanceScore'), 'people')
})

test('private telemetry preserves response identity and sampled measurements without request or response identities', async () => {
  const logs = [], response = Object.freeze({ contractId: 'PRIVATE_CONTRACT', name: 'PRIVATE_PERSON' })
  let calls = 0
  const handler = withPrivateFunctionTelemetry('renewPtContract', async () => {
    calls++; recordOperationMetrics({ logicalQueries: 2, documentsReturned: 3, cacheHit: true, unknown: 'PRIVATE_VALUE' })
    return response
  }, { successSampleRate: 1, logger: { info: (message, value) => logs.push({ message, value }) } })
  const actual = await handler({ auth: { uid: 'PRIVATE_UID' }, app: { appId: 'PRIVATE_APP' }, data: {
    correlationId: 'PRIVATE_CORRELATION', contractId: 'PRIVATE_CONTRACT', sourceId: 'PRIVATE_SOURCE', token: 'PRIVATE_TOKEN',
  } })
  assert.equal(actual, response); assert.equal(calls, 1); assert.equal(logs.length, 1)
  assert.equal(logs[0].value.authenticated, true); assert.equal(logs[0].value.appVerified, true)
  assert.equal(logs[0].value.operation, 'renewPtContract'); assert.equal(logs[0].value.schemaVersion, 2)
  assert.deepEqual(logs[0].value.metrics, { logicalQueries: 2, documentsReturned: 3, cacheHits: 1, responseBytes: Buffer.byteLength(JSON.stringify(response)) })
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE_|actorUid|sourceId|correlationId|contractId|token/)
})

test('private telemetry emits all failures with known classifications while preserving original exception identity', async () => {
  for (const [code, expectedCode, taxonomy] of [['permission-denied', 'permission-denied', 'PERMISSION'], ['PRIVATE_FAILURE', 'internal', 'INTERNAL']]) {
    const logs = [], error = Object.assign(new Error('PRIVATE_MESSAGE'), { code, details: { studentId: 'PRIVATE_ID' } })
    let calls = 0
    const handler = withPrivateFunctionTelemetry('getStudent360Overview', async () => { calls++; throw error }, {
      successSampleRate: 0, logger: { info: (message, value) => logs.push({ message, value }), error: (message, value) => logs.push({ message, value }) },
    })
    await assert.rejects(handler({ auth: { uid: 'PRIVATE_UID' }, data: { studentId: 'PRIVATE_ID', correlationId: 'PRIVATE_CORRELATION' } }), actual => actual === error)
    assert.equal(calls, 1); assert.equal(logs.length, 2)
    assert.equal(logs[1].value.failureCode, expectedCode); assert.equal(logs[1].value.errorCode, taxonomy)
    assert.equal(logs[1].value.sampleRate, 1); assert.deepEqual(logs[1].value.metrics, {})
    assert.doesNotMatch(JSON.stringify(logs), /PRIVATE_|actorUid|sourceId|correlationId|studentId/)
  }
})

test('sync and async logging failures cannot change results, errors or cause a business retry', async () => {
  for (const fail of [() => { throw Error('sink down') }, () => Promise.reject(Error('sink down'))]) {
    const response = {}, failure = new Error('original'), logger = { info: fail, error: fail }
    let successCalls = 0, failedCalls = 0
    assert.equal(await withPrivateFunctionTelemetry('renewPtContract', async () => { successCalls++; return response }, { logger, successSampleRate: 1 })({}), response)
    await assert.rejects(withPrivateFunctionTelemetry('renewPtContract', async () => { failedCalls++; throw failure }, { logger })({}), error => error === failure)
    assert.equal(successCalls, 1); assert.equal(failedCalls, 1)
    await new Promise(resolve => setImmediate(resolve))
  }
})

test('private success sampling can omit an observation without inventing unknown measurements', async () => {
  const logs = [], logger = { info: (_message, value) => logs.push(value) }
  const response = { ok: true }
  assert.equal(await withPrivateFunctionTelemetry('getOperationsDashboard', async () => response, { logger, successSampleRate: 0 })({}), response)
  assert.equal(logs.length, 0)
  await withPrivateFunctionTelemetry('getOperationsDashboard', async () => response, { logger, successSampleRate: 1 })({})
  assert.equal(logs[0].metrics.logicalQueries, undefined)
  assert.equal(logs[0].metrics.documentsReturned, undefined)
  assert.equal(logs[0].metrics.cacheHits, undefined)
})
